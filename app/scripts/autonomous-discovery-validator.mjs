#!/usr/bin/env node
/** Deterministic oracle and receipt sanitizer for the autonomous journey. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capabilityPresent,
  canonicalJson,
  receiptContainsHostPath,
  redactCapability,
  reversibleDecodedStrings,
  verifySourceModuleClosure,
  verifySourceProvenance,
} from '../../evals/receipt.mjs';
import { validateAutonomousReceiptSchema } from '../../evals/validate-autonomous-receipt-schema.mjs';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const BLOCKED_TARGET = /(?:^|_)(?:publish|remix|export)(?:_|$)/i;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function targetResult(event) {
  return event.response?.value?.result;
}

function compactState(event) {
  const result = targetResult(event);
  invariant(result && result.isError !== true, `${event.request?.name} did not return a successful result`);
  invariant(result.structuredContent && typeof result.structuredContent === 'object',
    `${event.request?.name} returned no structuredContent`);
  return result.structuredContent;
}

function trackMap(state) {
  return new Map((state?.tracks ?? []).map((track) => [track.track_id, track]));
}

function applyStepChanges(activeSteps, changes) {
  const steps = new Set(activeSteps ?? []);
  for (const change of changes ?? []) {
    if (change.value === true) steps.add(change.step);
    else if (change.value === false) steps.delete(change.step);
  }
  return [...steps].sort((left, right) => left - right);
}

function verifyEditPostState(editCall, before, after) {
  invariant(before.tempo === after.tempo, 'post-edit verification observed an unrelated tempo change');
  const edit = editCall.request.arguments?.edit;
  const beforeTracks = trackMap(before);
  const afterTracks = trackMap(after);
  if (edit.operation === 'add_track') {
    invariant(!beforeTracks.has(edit.track_id) && afterTracks.has(edit.track_id),
      'post-add verification did not observe the added track');
    invariant(afterTracks.size === beforeTracks.size + 1,
      'post-add verification observed an unexpected track-count change');
    invariant(afterTracks.get(edit.track_id).sample_id === edit.sample_id,
      'post-add verification observed the wrong instrument');
  } else if (edit.operation === 'set_steps') {
    invariant(beforeTracks.has(edit.track_id) && afterTracks.has(edit.track_id),
      'post-step verification could not correlate the target track');
    const expected = applyStepChanges(beforeTracks.get(edit.track_id).active_steps, edit.changes);
    const observed = [...(afterTracks.get(edit.track_id).active_steps ?? [])]
      .sort((left, right) => left - right);
    invariant(JSON.stringify(observed) === JSON.stringify(expected),
      'post-step verification did not observe the requested assignments');
  }
  for (const [trackId, beforeTrack] of beforeTracks) {
    const afterTrack = afterTracks.get(trackId);
    invariant(afterTrack, `post-edit verification lost track ${trackId}`);
    if (edit.operation === 'set_steps' && trackId === edit.track_id) {
      const { active_steps: _beforeSteps, ...beforeRest } = beforeTrack;
      const { active_steps: _afterSteps, ...afterRest } = afterTrack;
      invariant(JSON.stringify(beforeRest) === JSON.stringify(afterRest),
        'post-step verification observed unrelated target-track changes');
    } else {
      invariant(JSON.stringify(beforeTrack) === JSON.stringify(afterTrack),
        `post-edit verification observed unrelated changes to ${trackId}`);
    }
  }
}

function deriveEndpoint(skill, origin) {
  const relative = skill.match(/Connect[\s\S]{0,240}?`(\/[^`\s]+)` on the same origin/i)
    ?? skill.match(/Connect[\s\S]{0,240}?same-origin\s+`(\/[^`\s]+)`/i);
  invariant(relative, 'verified skill does not advertise a same-origin MCP endpoint');
  return new URL(relative[1], origin).href;
}

function ordered(events, phase, after = -1) {
  return events.findIndex((event, index) => index > after && event.phase === phase &&
    event.response?.success === true);
}

export function validateAutonomousTrace(events, { origin }) {
  invariant(Array.isArray(events) && events.length > 0, 'trace is empty');
  const normalizedOrigin = new URL(origin).origin;
  const requestIds = new Set();
  let priorSequence = 0;
  for (const event of events) {
    invariant(Number.isInteger(event.sequence) && event.sequence > priorSequence,
      'trace sequences must be strictly increasing');
    priorSequence = event.sequence;
    invariant(typeof event.request_id === 'string' && event.request_id.length > 0,
      `trace event ${event.sequence} has no request correlation id`);
    invariant(!requestIds.has(event.request_id), `duplicate request correlation id ${event.request_id}`);
    requestIds.add(event.request_id);
    invariant(event.response && typeof event.response.success === 'boolean',
      `trace event ${event.sequence} has no correlated result`);
  }

  const indexIndex = events.findIndex((event) => {
    if (event.phase !== 'fetch' || event.response?.success !== true) return false;
    const url = new URL(event.request.url);
    return url.origin === normalizedOrigin && url.pathname === '/.well-known/agent-skills/index.json';
  });
  invariant(indexIndex >= 0, 'agent did not fetch the well-known skill catalog');
  invariant(indexIndex === 0,
    'the well-known skill catalog must be the agent\'s first network action');
  invariant(!events.slice(0, indexIndex).some((event) => event.phase.startsWith('mcp_')),
    'agent attempted MCP before fetching the catalog');
  const indexFetch = events[indexIndex];
  const index = parseJson(indexFetch.response.value.body, 'discovery catalog');
  invariant(Array.isArray(index.skills) && index.skills.length > 0, 'catalog contains no skills');

  const skillEntry = index.skills[0];
  invariant(typeof skillEntry.url === 'string', 'catalog skill has no URL');
  invariant(/^sha256:[0-9a-f]{64}$/i.test(skillEntry.digest), 'catalog skill has no SHA-256 digest');
  const expectedSkillUrl = new URL(skillEntry.url, indexFetch.request.url).href;
  const skillIndex = events.findIndex((event, indexPosition) => indexPosition > indexIndex &&
    event.phase === 'fetch' && event.request.url === expectedSkillUrl && event.response?.success === true);
  invariant(skillIndex > indexIndex, 'agent did not fetch the indexed skill URL');
  const skillFetch = events[skillIndex];
  const independentlyHashed = `sha256:${createHash('sha256')
    .update(Buffer.from(skillFetch.response.value.body, 'utf8')).digest('hex')}`;
  invariant(independentlyHashed.toLowerCase() === skillEntry.digest.toLowerCase(),
    'fetched skill bytes do not match the catalog digest');

  const verifyIndex = events.findIndex((event, indexPosition) => indexPosition > skillIndex &&
    event.phase === 'digest_verify' && event.response?.success === true &&
    event.request.handle === skillFetch.response.value.handle);
  invariant(verifyIndex > skillIndex, 'agent did not verify the fetched skill bytes');
  const verification = events[verifyIndex];
  invariant(verification.request.expected_digest.toLowerCase() === skillEntry.digest.toLowerCase(),
    'agent verified against a digest other than the catalog digest');
  invariant(verification.response.value.matches === true, 'skill digest did not match');
  invariant(verification.response.value.actual_digest.toLowerCase() === skillEntry.digest.toLowerCase(),
    'verified digest is not the indexed digest');

  const expectedEndpoint = deriveEndpoint(skillFetch.response.value.body, normalizedOrigin);
  const connectIndex = ordered(events, 'mcp_initialize', verifyIndex);
  invariant(connectIndex > verifyIndex, 'agent did not initialize MCP after verification');
  const connection = events[connectIndex];
  invariant(connection.request.verified_handle === skillFetch.response.value.handle,
    'MCP connection was not derived from the verified skill handle');
  invariant(connection.request.endpoint_url === expectedEndpoint,
    `MCP endpoint ${connection.request.endpoint_url} was not derived from verified skill bytes`);
  invariant(Array.isArray(connection.response.value.http) &&
    connection.response.value.http.length > 0 &&
    connection.response.value.http.every((exchange) => exchange.success === true),
  'MCP initialization has no successful correlated HTTP exchange');
  const connectionId = connection.response.value.connection_id;

  const listIndex = ordered(events, 'mcp_tools_list', connectIndex);
  invariant(listIndex > connectIndex, 'agent did not call tools/list after MCP initialization');
  const list = events[listIndex];
  invariant(list.request.connection_id === connectionId, 'tools/list used a different connection');
  const liveTools = list.response.value.tools;
  invariant(Array.isArray(liveTools), 'tools/list returned no tool array');
  const liveNames = new Set(liveTools.map((tool) => tool.name));
  for (const required of ['create_session', 'get_session', 'edit_session']) {
    invariant(liveNames.has(required), `tools/list did not expose ${required}`);
  }

  const calls = events.slice(listIndex + 1).filter((event) => event.phase === 'mcp_tool_call');
  invariant(calls.length > 0, 'agent made no target MCP calls');
  for (const call of calls) {
    invariant(call.response.success === true,
      `target call ${call.request.name} failed: ${call.response.error ?? 'unknown error'}`);
    invariant(call.request.connection_id === connectionId, 'target call used a different connection');
    invariant(liveNames.has(call.request.name), `target call ${call.request.name} was not listed`);
    invariant(!BLOCKED_TARGET.test(call.request.name), `forbidden target call: ${call.request.name}`);
    invariant(targetResult(call)?.isError !== true, `target call ${call.request.name} returned isError`);
  }

  const createPositions = calls.map((call, index) => [call, index])
    .filter(([call]) => call.request.name === 'create_session');
  invariant(createPositions.length === 1, `expected exactly one create_session, got ${createPositions.length}`);
  const [create, createPosition] = createPositions[0];
  const created = compactState(create);
  invariant(created.immutable === false, 'created session is not editable');
  invariant(typeof created.session_id === 'string' && created.session_id.length > 0,
    'create_session returned no capability');
  const sessionId = created.session_id;

  const readPositions = calls.map((call, index) => [call, index])
    .filter(([call]) => call.request.name === 'get_session' &&
      call.request.arguments?.session_id === sessionId);
  invariant(readPositions.length >= 2, 'expected an initial and final get_session for the created session');
  const [initialRead, initialPosition] = readPositions[0];
  const [finalRead, finalPosition] = readPositions.at(-1);
  invariant(initialPosition > createPosition, 'initial read did not follow session creation');

  const edits = calls.map((call, index) => [call, index])
    .filter(([call, position]) => call.request.name === 'edit_session' &&
      call.request.arguments?.session_id === sessionId &&
      position > initialPosition && position < finalPosition);
  invariant(edits.length >= 1, 'no successful edit occurred between the initial and final reads');
  invariant(finalPosition > edits.at(-1)[1], 'final read did not follow the edits');
  invariant(calls.filter((call) => call.request.name === 'edit_session').length === edits.length,
    'an edit targeted a different session, occurred outside read/edit/read, or lacked its verification get_session');
  for (const [, editPosition] of edits) {
    const verificationRead = calls[editPosition + 1];
    invariant(verificationRead?.request.name === 'get_session' &&
      verificationRead.request.arguments?.session_id === sessionId,
    'every edit_session must be followed immediately by a verification get_session');
    invariant(compactState(verificationRead).session_id === sessionId,
      'post-edit verification read returned a different session');
    const priorRead = calls[editPosition - 1];
    invariant(priorRead?.request.name === 'get_session'
      && priorRead.request.arguments?.session_id === sessionId,
    'every edit_session must be preceded by the state it intends to change');
    verifyEditPostState(calls[editPosition], compactState(priorRead), compactState(verificationRead));
  }

  const operations = edits.map(([call]) => call.request.arguments?.edit?.operation);
  invariant(operations[0] === 'add_track', 'first edit did not add the requested track');
  invariant(operations.includes('set_steps'), 'edits did not assign the requested steps');
  invariant(operations.every((operation) => ['add_track', 'set_steps'].includes(operation)),
    `unexpected edit operation: ${operations.join(', ')}`);

  const initial = compactState(initialRead);
  const final = compactState(finalRead);
  invariant(initial.session_id === sessionId && final.session_id === sessionId,
    'read results do not correlate to the created session');
  invariant(initial.immutable === false && final.immutable === false, 'session became immutable');
  invariant(final.tempo === initial.tempo, 'tempo changed during the narrow edit');
  invariant(Array.isArray(initial.tracks) && initial.tracks.length === 0,
    'initial disposable session was not empty');
  invariant(Array.isArray(final.tracks) && final.tracks.length === 1,
    'final session must contain exactly one added track');
  const track = final.tracks[0];
  invariant(track.sample_id === 'kick', 'added track is not a kick');
  invariant(JSON.stringify([...track.active_steps].sort((a, b) => a - b)) === '[0,4,8,12]',
    `kick steps are not exactly 0,4,8,12: ${JSON.stringify(track.active_steps)}`);

  return {
    passed: true,
    endpoint: expectedEndpoint,
    skill_digest: skillEntry.digest,
    event_count: events.length,
    target_call_count: calls.length,
  };
}

export function validateOriginOnlyPrompt(prompt, { origin }) {
  invariant(typeof prompt === 'string' && prompt.length > 0, 'agent prompt is empty');
  const normalizedOrigin = new URL(origin).origin;
  const urls = [...prompt.matchAll(/https?:\/\/[^\s]+/g)].map(([url]) => url.replace(/[.,;:]$/, ''));
  invariant(urls.length === 1 && new URL(urls[0]).origin === normalizedOrigin &&
    new URL(urls[0]).pathname === '/', 'agent prompt must contain only the starting origin URL');
  const forbidden = [
    /\.well-known\/agent-skills/i,
    /\/mcp\b/i,
    /\b(?:create|get|edit|publish|remix|export)_session\b/i,
    /\btools\/list\b/i,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  ];
  invariant(!forbidden.some((pattern) => pattern.test(prompt)),
    'agent prompt contains target path, tool knowledge, schema, or capability');
  return true;
}

export function validateRawAnswerCapabilities(answer, capabilities) {
  invariant(typeof answer === 'string', 'raw autonomous answer is not text');
  const registered = [...capabilities];
  invariant(registered.length > 0, 'raw-answer capability scan has an empty registry');
  for (const capability of registered) {
    invariant(!capabilityPresent(answer, String(capability)),
      'raw autonomous answer disclosed an editable session capability');
  }
  return { registered_capabilities: registered.length, passed: true };
}

export function validateAutonomousReceipt(receipt) {
  const schemaErrors = validateAutonomousReceiptSchema(receipt);
  invariant(schemaErrors.length === 0, schemaErrors.join('; '));
  invariant(receipt?.version === 1, 'unsupported autonomous receipt version');
  invariant(receipt?.kind === 'origin-only-autonomous-skill-discovery',
    'unexpected autonomous receipt kind');
  invariant(typeof receipt.created_at === 'string' && !Number.isNaN(Date.parse(receipt.created_at)),
    'autonomous receipt created_at is invalid');
  invariant(receipt.agent?.adapter === 'claude-discovery',
    'autonomous receipt has an unexpected agent adapter');
  invariant(receipt?.target_mcp_preconfigured === false,
    'receipt does not prove the target MCP was unconfigured');
  validateOriginOnlyPrompt(receipt.prompt, { origin: receipt.origin });
  invariant(receipt.prompt_sha256 === createHash('sha256').update(receipt.prompt).digest('hex'),
    'prompt SHA-256 does not match the recorded prompt');
  invariant(receipt.trace_sha256 === createHash('sha256')
    .update(JSON.stringify(receipt.trace)).digest('hex'),
  'trace SHA-256 does not match the recorded trace');
  invariant(receipt.answer_sha256 === createHash('sha256').update(receipt.answer).digest('hex'),
    'answer SHA-256 does not match the recorded answer');
  invariant(receipt.cli_trace_sha256 === createHash('sha256')
    .update(JSON.stringify(receipt.cli_trace)).digest('hex'),
  'CLI trace SHA-256 does not match the recorded trace');
  invariant(receipt.adapter_argv_sha256 === createHash('sha256')
    .update(JSON.stringify(receipt.adapter_argv)).digest('hex'),
  'adapter argv SHA-256 does not match the recorded argv');
  invariant(receipt.raw_answer_capability_scan?.passed === true
    && receipt.raw_answer_capability_scan.registered_capabilities > 0,
  'receipt does not attest a non-empty raw-answer capability scan');
  invariant(Number.isInteger(receipt.redacted_uuids) && receipt.redacted_uuids > 0
    && receipt.raw_answer_capability_scan.registered_capabilities === receipt.redacted_uuids,
  'receipt redaction count does not match its pre-sanitization capability registry');
  const phaseToTool = new Map([
    ['fetch', 'mcp__discovery_transport__fetch_url'],
    ['digest_verify', 'mcp__discovery_transport__verify_sha256'],
    ['mcp_initialize', 'mcp__discovery_transport__connect_mcp'],
    ['mcp_tools_list', 'mcp__discovery_transport__list_mcp_tools'],
    ['mcp_tool_call', 'mcp__discovery_transport__call_mcp_tool'],
    ['random_uuid', 'mcp__discovery_transport__random_uuid'],
  ]);
  const transportCalls = receipt.trace.map((event) => ({
    name: phaseToTool.get(event.phase),
    arguments: event.request,
  }));
  invariant(transportCalls.every((event) => event.name), 'trace contains an unknown transport phase');
  const cliCalls = receipt.cli_trace.filter((event) => event.name !== 'ToolSearch');
  invariant(cliCalls.length === transportCalls.length,
    'CLI tool trace does not correlate to the audited transport trace');
  for (let index = 0; index < transportCalls.length; index += 1) {
    invariant(cliCalls[index].name === transportCalls[index].name
      && canonicalJson(cliCalls[index].arguments ?? {})
        === canonicalJson(transportCalls[index].arguments ?? {}),
    `CLI tool trace event ${index + 1} does not correlate to the audited transport request`);
  }
  const targetEndpoint = new URL('/mcp', receipt.origin).href;
  const argv = JSON.stringify(receipt.adapter_argv ?? []);
  invariant(!argv.includes(targetEndpoint), 'adapter argv preconfigured the target endpoint');
  invariant(!/\b(?:create|get|edit|publish|remix|export)_session\b/i.test(argv),
    'adapter argv preconfigured a target tool');
  const modelIndex = receipt.adapter_argv.indexOf('--model');
  invariant(modelIndex >= 0 && receipt.adapter_argv[modelIndex + 1] === receipt.agent?.model,
    'autonomous receipt model does not match the adapter invocation');

  const sourceSkill = (receipt.source?.files ?? []).filter((file) => file.role === 'skill');
  const sourceCatalog = (receipt.source?.files ?? []).filter((file) => file.role === 'manifest');
  invariant(sourceSkill.length === 1 && sourceCatalog.length === 1,
    'autonomous receipt must bind exactly one skill and discovery catalog');
  const catalogFetch = receipt.trace.find((event) => event.phase === 'fetch'
    && new URL(event.request.url).pathname === '/.well-known/agent-skills/index.json'
    && event.response?.success === true);
  const skillFetch = receipt.trace.find((event) => event.phase === 'fetch'
    && new URL(event.request.url).pathname.endsWith('/SKILL.md')
    && event.response?.success === true);
  invariant(catalogFetch?.response?.value?.body === sourceCatalog[0].content,
    'served discovery catalog bytes do not match the bound source');
  invariant(skillFetch?.response?.value?.body === sourceSkill[0].content,
    'served skill bytes do not match the bound source');

  const liveFields = {
    answer: receipt.answer,
    cli_trace: receipt.cli_trace,
    adapter_argv: receipt.adapter_argv,
    trace: receipt.trace.filter((event) => ['mcp_tool_call', 'random_uuid'].includes(event.phase)),
  };
  invariant(sensitiveUuidsFromValue(liveFields).size === 0,
    'sanitized autonomous receipt still contains a UUID capability');
  const placeholders = [...JSON.stringify(liveFields).matchAll(/<redacted-uuid-(\d+)>/g)]
    .map((match) => Number(match[1]));
  const uniquePlaceholders = [...new Set(placeholders)].sort((left, right) => left - right);
  invariant(JSON.stringify(uniquePlaceholders)
    === JSON.stringify(Array.from({ length: receipt.redacted_uuids }, (_, index) => index + 1)),
  'receipt redaction placeholders do not match redacted_uuids');
  invariant(receiptContainsHostPath(receipt) === false,
    'autonomous receipt contains a host-specific path');

  const computed = validateAutonomousTrace(receipt.trace, { origin: receipt.origin });
  invariant(JSON.stringify(receipt.validation) === JSON.stringify(computed),
    'stored autonomous validation does not match the recomputed projection');
  return computed;
}

function decodeEscapes(value) {
  let decoded = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const unicode = decoded.replace(/\\u([0-9a-f]{4})/gi,
      (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    const percent = unicode.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
      try { return decodeURIComponent(encoded); } catch { return encoded; }
    });
    if (percent === decoded) break;
    decoded = percent;
  }
  return decoded;
}

export function sensitiveUuidsFromTrace(events) {
  const values = new Set();
  for (const event of events) {
    if (!['mcp_tool_call', 'random_uuid'].includes(event.phase)) continue;
    for (const match of JSON.stringify(event).matchAll(UUID)) values.add(match[0].toLowerCase());
  }
  return values;
}

function sensitiveUuidsFromValue(value) {
  const values = new Set();
  const visit = (entry) => {
    if (typeof entry === 'string') {
      for (const decoded of reversibleDecodedStrings(entry)) {
        for (const match of decoded.matchAll(UUID)) values.add(match[0].toLowerCase());
      }
      return;
    }
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (entry && typeof entry === 'object') {
      for (const [key, child] of Object.entries(entry)) {
        visit(key);
        visit(child);
      }
    }
  };
  visit(value);
  return values;
}

export function sanitizeForReceipt(value, { onlyUuids } = {}) {
  const replacements = new Map();
  const allowed = onlyUuids ? new Set([...onlyUuids].map((uuid) => uuid.toLowerCase())) : null;
  function token(uuid) {
    const key = uuid.toLowerCase();
    if (allowed && !allowed.has(key)) return uuid;
    if (!replacements.has(key)) replacements.set(key, `<redacted-uuid-${replacements.size + 1}>`);
    return replacements.get(key);
  }
  function visit(entry) {
    if (typeof entry === 'string') {
      let redacted = decodeEscapes(entry).replace(UUID, token);
      for (const capability of allowed ?? []) {
        if (!capabilityPresent(redacted, capability)) continue;
        redacted = redactCapability(redacted, capability)
          .replaceAll('<redacted-session-id>', token(capability));
      }
      return redacted;
    }
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).map(([key, child]) => [visit(key), visit(child)]));
    }
    return entry;
  }
  return { sanitized: visit(value), redacted_uuids: replacements.size };
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function git(repoRoot, args, { bytes = false, optional = false } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: bytes ? null : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (optional) return null;
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr ?? '').trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return bytes ? result.stdout : result.stdout.trim();
}

export function verifySourceBinding(source, repoRoot) {
  invariant(source?.repository === 'https://github.com/adewale/keyboardia.git',
    'source repository must be the canonical Keyboardia repository');
  const criticalBindings = new Map([
    ['skill', 'app/public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md'],
    ['manifest', 'app/public/.well-known/agent-skills/index.json'],
    ['transport', 'app/scripts/autonomous-discovery-transport.mjs'],
    ['validator', 'app/scripts/autonomous-discovery-validator.mjs'],
    ['runner', 'app/scripts/run-autonomous-discovery.mjs'],
    ['answer_adapter', 'evals/adapters/claude-discovery.mjs'],
    ['system_under_test_entry', 'app/src/worker/index.ts'],
    ['system_under_test_config', 'app/wrangler.jsonc'],
    ['dependency_manifest', 'app/package.json'],
    ['dependency_lock', 'app/package-lock.json'],
    ['receipt_runtime', 'evals/receipt.mjs'],
    ['receipt_schema', 'evals/receipt.schema.json'],
    ['receipt_schema_validator', 'evals/validate-receipt-schema.mjs'],
    ['autonomous_receipt_schema', 'evals/autonomous-receipt.schema.json'],
    ['autonomous_receipt_schema_validator', 'evals/validate-autonomous-receipt-schema.mjs'],
  ]);
  const requiredRoles = [...criticalBindings.keys()];
  const proofErrors = verifySourceProvenance(source, { requiredRoles });
  invariant(proofErrors.length === 0, proofErrors.join('; '));
  for (const [role, path] of criticalBindings) {
    const matches = (source.files ?? []).filter((file) => file.role === role && file.path === path);
    invariant(matches.length === 1, `${role} must bind ${path} exactly once`);
    invariant((source.files ?? []).filter((file) => file.role === role).length === 1,
      `${role} must not bind any other path`);
  }
  const roots = (source.files ?? [])
    .filter((file) => [
      'transport', 'validator', 'runner', 'answer_adapter', 'system_under_test_entry',
    ].includes(file.role))
    .map((file) => file.path);
  const closureErrors = verifySourceModuleClosure(source, roots);
  invariant(closureErrors.length === 0, closureErrors.join('; '));
  if (git(repoRoot, ['cat-file', '-e', `${source.git_commit}^{commit}`], { optional: true }) !== null) {
    const tree = git(repoRoot, ['show', '-s', '--format=%T', source.git_commit]);
    invariant(tree === source.git_tree, 'source git tree does not match source commit');
    for (const file of source.files) {
      const bytes = git(repoRoot, ['show', `${source.git_commit}:${file.path}`], { bytes: true });
      invariant(createHash('sha256').update(bytes).digest('hex') === file.sha256,
        `${file.path} does not match its source commit`);
    }
  }
  return true;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const receiptPath = process.argv[2];
  if (!receiptPath) {
    process.stderr.write('Usage: node autonomous-discovery-validator.mjs <receipt.json> [--verify-current]\n');
    process.exit(2);
  }
  try {
    const receipt = parseJson(readFileSync(receiptPath, 'utf8'), 'receipt');
    validateAutonomousReceipt(receipt);
    if (process.argv.includes('--verify-current')) {
      const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
      verifySourceBinding(receipt.source, repoRoot);
    }
    process.stdout.write('Autonomous discovery receipt: PASS\n');
  } catch (error) {
    process.stderr.write(`Autonomous discovery receipt: FAIL: ${error.message}\n`);
    process.exit(1);
  }
}
