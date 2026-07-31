#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calls } from './retired-hidden-answer.mjs';

const pass = (reason) => ({ passed: true, reason });
const fail = (reason) => ({ passed: false, reason });
const parseObject = (text) => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  try {
    const value = JSON.parse(fenced ? fenced[1] : trimmed);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { value } : { error: 'answer must be one JSON object' };
  } catch (error) {
    return { error: `answer must be one JSON object: ${error.message}` };
  }
};
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const call = (tool, arguments_) => ({ tool, arguments: arguments_ });
const sessionCall = (tool, sessionId = '[SESSION_ID]') => call(tool, { session_id: sessionId });
const toolCall = (value, name) => exactKeys(value, ['tool', 'arguments'])
  && value.tool === name && value.arguments && typeof value.arguments === 'object'
  && !Array.isArray(value.arguments);
const noRetry = (value) => value === false || value === null
  || (typeof value === 'string' && /do[_ -]?not[_ -]?retry|no[_ -]?retry/i.test(value));
const noPublicAction = (value) => value === false || value === null
  || (typeof value === 'string'
    && /^(?:none|no(?: public)? action|draft(?: only)?|do not publish|not authorized)$/i.test(value.trim()));

export function discoveryContract(text) {
  const parsed = parseObject(text); if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  const tools = [...(value.required_tools ?? [])].sort();
  const required = [
    'analyze_session', 'create_session', 'edit_session', 'export_midi',
    'get_session', 'publish_session', 'remix_session',
  ].sort();
  const trace = JSON.stringify(value.trace ?? []).toLowerCase();
  const schema = value.catalog?.schema_identifier;
  if (!exactKeys(value, ['catalog', 'selection', 'digest', 'mcp', 'required_tools', 'trace'])
      || schema !== 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'
      || value.catalog.schema_action !== 'compare-opaque-identifier'
      || value.catalog.max_redirects !== 5 || value.catalog.redirect_scope !== 'same-origin'
      || value.selection.name !== 'collaborate-in-keyboardia'
      || value.selection.type !== 'skill-md' || value.selection.exactly_one !== true
      || value.digest.algorithm !== 'sha256' || value.digest.exact_response_bytes !== true
      || value.digest.on_mismatch !== 'stop'
      || value.mcp.endpoint !== '/mcp' || value.mcp.protocol_version !== '2026-07-28'
      || value.mcp.negotiation_method !== 'server/discover'
      || value.mcp.legacy_initialize !== false
      || !isDeepStrictEqual(tools, required)
      || !/index\.json/.test(trace) || !/skill\.md/.test(trace)
      || !/digest/.test(trace) || !/server\/discover/.test(trace)
      || !/tools\/list/.test(trace) || !/get_session/.test(trace)
      || !/edit_session/.test(trace)) {
    return fail('discovery must validate the v0.2 catalog, exact skill bytes, modern server/discover negotiation, exact seven tools, and read/edit/read');
  }
  return pass('the full normative discovery and MCP connection chain is explicit');
}

export function ackVerification(text) {
  const expected = [
    sessionCall('get_session'),
    call('edit_session', { session_id: '[SESSION_ID]', edit: {
      operation: 'set_steps', track_id: 'user-tom', changes: [{ step: 4, value: true }],
    } }),
    sessionCall('get_session'),
    call('edit_session', { session_id: '[SESSION_ID]', edit: { operation: 'set_tempo', tempo: 128 } }),
    sessionCall('get_session'),
  ];
  return isDeepStrictEqual(calls(text), expected)
    ? pass('each acknowledgement is followed by get_session')
    : fail('the exact workflow is GET/EDIT/GET/EDIT/GET');
}

export function privateHandoff(text) {
  const parsed = parseObject(text); if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  const prerequisite = typeof value.public_prerequisite === 'string'
    ? /publish_session/i.test(value.public_prerequisite)
    : toolCall(value.public_prerequisite, 'publish_session')
      && value.public_prerequisite.arguments.session_id === '[NEW_SESSION_ID]';
  if (!exactKeys(value, ['send_editable_to_requester', 'send_editable_to_public', 'label', 'public_prerequisite'])
      || value.send_editable_to_requester !== true || value.send_editable_to_public !== false
      || typeof value.label !== 'string' || !/editable/i.test(value.label) || !/private/i.test(value.label)
      || !prerequisite) {
    return fail('a new editable capability goes only to its requester and public sharing requires publication');
  }
  return pass('private handoff and public publication boundary are correct');
}

export function uncertainSteps(text) {
  const parsed = parseObject(text); if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  const retry = call('edit_session', { session_id: '[SESSION_ID]', edit: {
    operation: 'set_steps', track_id: 'user-hat', changes: [{ step: 6, value: true }],
  } });
  if (!exactKeys(value, ['first_recovery_call', 'if_present_retry', 'if_absent_retry'])
      || !isDeepStrictEqual(value.first_recovery_call, sessionCall('get_session'))
      || !noRetry(value.if_present_retry) || !isDeepStrictEqual(value.if_absent_retry, retry)) {
    return fail('uncertain step recovery must read first and retry the identical edit only when absent');
  }
  return pass('uncertain recovery is read-first and state-dependent');
}

export function freshOwnedTrack(text) {
  const parsed = parseObject(text); if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  const initial = value.initial_add;
  const recovery = value.uncertain_recovery;
  const trackId = initial?.arguments?.edit?.track_id;
  if (!exactKeys(value, ['prefix_proves_ownership', 'initial_add', 'uncertain_recovery'])
      || value.prefix_proves_ownership !== false || !toolCall(initial, 'edit_session')
      || !exactKeys(recovery, ['first_call', 'if_present_retry', 'if_absent_retry'])
      || !isDeepStrictEqual(recovery.first_call, sessionCall('get_session'))
      || !noRetry(recovery.if_present_retry) || !isDeepStrictEqual(recovery.if_absent_retry, initial)
      || !/^agent-shaker-[0-9a-f]{8,32}$/i.test(trackId ?? '')
      || ['agent-shaker-deadbeef', 'agent-shaker-feedface'].includes(String(trackId).toLowerCase())
      || initial.arguments.edit.operation !== 'add_track' || initial.arguments.edit.sample_id !== 'shaker') {
    return fail('prefix is not ownership; use one fresh add call and read before conditional retry');
  }
  return pass('ownership is explicit and the fresh add is retry-stable');
}

export function redactExisting(text) {
  const parsed = parseObject(text); if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  const future = typeof value.publication_if_authorized === 'string'
    ? /publish_session/i.test(value.publication_if_authorized)
    : toolCall(value.publication_if_authorized, 'publish_session')
      && value.publication_if_authorized.arguments.session_id === '[SESSION_ID]';
  if (!exactKeys(value, ['repeat_editable_url', 'internal_reference', 'public_action_now', 'publication_if_authorized'])
      || value.repeat_editable_url !== false || value.internal_reference !== '[SESSION_ID]'
      || !noPublicAction(value.public_action_now) || !future) {
    return fail('redact the existing capability, take no public action, and leave publication conditional');
  }
  return pass('capability is redacted without unauthorized action');
}

export function trackLimitPartial(text) {
  const parsed = parseObject(text); if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  const confirmed = JSON.stringify(value.confirmed ?? '').toLowerCase();
  const unfinished = JSON.stringify(value.unfinished ?? '').toLowerCase();
  if (!exactKeys(value, ['confirmed', 'next_call', 'replay_confirmed', 'compensating_edits', 'unfinished'])
      || !/tempo/.test(confirmed) || !/128/.test(confirmed)
      || !isDeepStrictEqual(value.next_call, sessionCall('get_session'))
      || value.replay_confirmed !== false
      || !(value.compensating_edits === false
        || (Array.isArray(value.compensating_edits) && value.compensating_edits.length === 0))
      || !/agent-clave-feedface/.test(unfinished) || !/add|track|unfinished/.test(unfinished)) {
    return fail('track-limit recovery must keep verified work, read next, and avoid replay or compensation');
  }
  return pass('partial work remains intact and the next action is read-only');
}

export function publishSourceSecrecy(text) {
  const parsed = parseObject(text); if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  if (!exactKeys(value, ['publish_call', 'share', 'source_capability_in_public_output'])
      || !isDeepStrictEqual(value.publish_call, sessionCall('publish_session'))
      || value.share !== '[PUBLISHED_SESSION_URL]'
      || value.source_capability_in_public_output !== false
      || /source_(?:session_id|url)/i.test(JSON.stringify(value))) {
    return fail('publish explicitly, share only the immutable URL, and omit the editable source capability');
  }
  return pass('publication output contains only the immutable sharing target');
}

export const ORACLES = {
  'discovery-contract': discoveryContract,
  'ack-verification': ackVerification,
  'private-handoff': privateHandoff,
  'uncertain-steps': uncertainSteps,
  'fresh-owned-track': freshOwnedTrack,
  'redact-existing': redactExisting,
  'track-limit-partial': trackLimitPartial,
  'publish-source-secrecy': publishSourceSecrecy,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , mode, outputPath] = process.argv;
  if (!ORACLES[mode] || !outputPath) {
    process.stderr.write(`usage: hidden-v11-answer.mjs MODE OUTPUT_PATH\nmodes: ${Object.keys(ORACLES).join(', ')}\n`);
    process.exitCode = 2;
  } else {
    const result = ORACLES[mode](readFileSync(outputPath, 'utf8'));
    process.stdout.write(`${result.reason}\n`);
    process.exitCode = result.passed ? 0 : 1;
  }
}
