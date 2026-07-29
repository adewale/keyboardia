import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  sanitizeForReceipt,
  validateAutonomousReceipt,
  validateAutonomousTrace,
  validateOriginOnlyPrompt,
  validateRawAnswerCapabilities,
  verifySourceBinding,
} from '../scripts/autonomous-discovery-validator.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling is exercised from Vitest
import { canonicalSourceBundleHash } from '../../evals/receipt.mjs';

const ORIGIN = 'http://127.0.0.1:43189';
const SESSION = '7d9349b1-7635-46f2-a112-09db02f747aa';
const IDEMPOTENCY = '3f1b8a1e-1f5a-4c1d-9a2b-7e0d5c9a4b21';
const SKILL = '## Connect\nConnect a standards-compliant client to `/mcp` on the same origin.';
const DIGEST = `sha256:${createHash('sha256').update(SKILL).digest('hex')}`;

function event(
  sequence: number,
  phase: string,
  request: Record<string, unknown>,
  value: Record<string, unknown>,
) {
  return {
    sequence,
    request_id: `transport-${sequence}`,
    phase,
    request,
    response: { success: true, value },
  };
}

function toolCall(
  sequence: number,
  name: string,
  args: Record<string, unknown>,
  structuredContent: Record<string, unknown>,
) {
  return event(sequence, 'mcp_tool_call', {
    connection_id: 'connection-1',
    name,
    arguments: args,
  }, {
    connection_id: 'connection-1',
    name,
    result: { isError: false, structuredContent, content: [] },
  });
}

function validTrace() {
  const initial = {
    session_id: SESSION,
    immutable: false,
    tempo: 120,
    tracks: [],
  };
  const final = {
    ...initial,
    tracks: [{
      track_id: 'agent-kick-a7f3c29d',
      name: 'Kick',
      sample_id: 'kick',
      step_count: 16,
      active_steps: [0, 4, 8, 12],
    }],
  };
  return [
    event(1, 'fetch', { url: `${ORIGIN}/.well-known/agent-skills/index.json` }, {
      handle: 'fetch-1',
      url: `${ORIGIN}/.well-known/agent-skills/index.json`,
      status: 200,
      body: JSON.stringify({
        skills: [{
          name: 'collaborate-in-keyboardia',
          url: '/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md',
          digest: DIGEST,
        }],
      }),
    }),
    event(2, 'fetch', {
      url: `${ORIGIN}/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md`,
    }, {
      handle: 'fetch-2',
      url: `${ORIGIN}/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md`,
      status: 200,
      body: SKILL,
    }),
    event(3, 'digest_verify', { handle: 'fetch-2', expected_digest: DIGEST }, {
      handle: 'fetch-2',
      expected_digest: DIGEST,
      actual_digest: DIGEST,
      matches: true,
    }),
    event(4, 'mcp_initialize', {
      endpoint_url: `${ORIGIN}/mcp`,
      verified_handle: 'fetch-2',
    }, {
      connection_id: 'connection-1',
      endpoint_url: `${ORIGIN}/mcp`,
      server_version: { name: 'keyboardia', version: '1' },
      http: [{ url: `${ORIGIN}/mcp`, status: 200, success: true }],
    }),
    event(5, 'mcp_tools_list', { connection_id: 'connection-1' }, {
      connection_id: 'connection-1',
      tools: ['create_session', 'get_session', 'edit_session'].map((name) => ({ name })),
    }),
    toolCall(6, 'create_session', { idempotency_key: IDEMPOTENCY }, initial),
    toolCall(7, 'get_session', { session_id: SESSION }, initial),
    toolCall(8, 'edit_session', {
      session_id: SESSION,
      edit: { operation: 'add_track', track_id: 'agent-kick-a7f3c29d', sample_id: 'kick' },
    }, { ...initial, tracks: [{
      track_id: 'agent-kick-a7f3c29d',
      name: 'Kick',
      sample_id: 'kick',
      step_count: 16,
      active_steps: [],
    }] }),
    toolCall(9, 'get_session', { session_id: SESSION }, {
      ...initial, tracks: [{
        track_id: 'agent-kick-a7f3c29d',
        name: 'Kick',
        sample_id: 'kick',
        step_count: 16,
        active_steps: [],
      }],
    }),
    toolCall(10, 'edit_session', {
      session_id: SESSION,
      edit: {
        operation: 'set_steps',
        track_id: 'agent-kick-a7f3c29d',
        changes: [0, 4, 8, 12].map((step) => ({ step, value: true })),
      },
    }, final),
    toolCall(11, 'get_session', { session_id: SESSION }, final),
  ];
}

function cliTraceFor(trace: ReturnType<typeof validTrace>) {
  const names: Record<string, string> = {
    fetch: 'mcp__discovery_transport__fetch_url',
    digest_verify: 'mcp__discovery_transport__verify_sha256',
    mcp_initialize: 'mcp__discovery_transport__connect_mcp',
    mcp_tools_list: 'mcp__discovery_transport__list_mcp_tools',
    mcp_tool_call: 'mcp__discovery_transport__call_mcp_tool',
  };
  return trace.map((entry) => ({
    id: `tool-${entry.request_id}`,
    name: names[entry.phase],
    arguments: structuredClone(entry.request),
  }));
}

function autonomousReceipt(
  prompt = `The only location you know is:\n${ORIGIN}\n\nUse the Agent Skills discovery standard.`,
) {
  const trace = validTrace();
  const cliTrace = cliTraceFor(trace);
  const adapterArgv = ['--model', 'claude-sonnet-5', '--tools', 'ToolSearch'];
  const answer = 'Done without sharing the capability.';
  const { sanitized, redacted_uuids } = sanitizeForReceipt({
    trace,
    answer,
    cli_trace: cliTrace,
    adapter_argv: adapterArgv,
  }, { onlyUuids: new Set([SESSION, IDEMPOTENCY]) });
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const sourceFile = (role: string, path: string, content: string) => ({
    role,
    path,
    sha256: sha256(content),
    git_blob: '1'.repeat(40),
    encoding: 'utf-8',
    content,
  });
  return {
    $schema: '../autonomous-receipt.schema.json',
    version: 1,
    kind: 'origin-only-autonomous-skill-discovery',
    target_mcp_preconfigured: false,
    created_at: '2026-07-28T12:00:00.000Z',
    origin: ORIGIN,
    prompt,
    prompt_sha256: sha256(prompt),
    agent: { adapter: 'claude-discovery', model: 'claude-sonnet-5', usage: null },
    source: {
      repository: 'https://github.com/adewale/keyboardia.git',
      git_commit: '2'.repeat(40),
      git_tree: '3'.repeat(40),
      commit_content: 'tree 3333333333333333333333333333333333333333\n',
      tree_objects: [{ object: '3'.repeat(40), content_base64: 'dHJlZQ==' }],
      bundle_sha256: '4'.repeat(64),
      files: [
        sourceFile('manifest', 'app/public/.well-known/agent-skills/index.json',
          trace[0].response.value.body as string),
        sourceFile('skill',
          'app/public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md', SKILL),
      ],
    },
    validation: validateAutonomousTrace(sanitized.trace, { origin: ORIGIN }),
    trace_sha256: sha256(JSON.stringify(sanitized.trace)),
    answer_sha256: sha256(sanitized.answer),
    cli_trace_sha256: sha256(JSON.stringify(sanitized.cli_trace)),
    adapter_argv_sha256: sha256(JSON.stringify(sanitized.adapter_argv)),
    raw_answer_capability_scan: { registered_capabilities: 2, passed: true },
    redacted_uuids,
    trace: sanitized.trace,
    answer: sanitized.answer,
    cli_trace: sanitized.cli_trace,
    adapter_argv: sanitized.adapter_argv,
  };
}

describe('autonomous discovery trace oracle', () => {
  it('accepts one correlated origin-to-discovery-to-read-edit-read journey', () => {
    expect(validateAutonomousTrace(validTrace(), { origin: ORIGIN })).toMatchObject({
      passed: true,
      endpoint: `${ORIGIN}/mcp`,
      target_call_count: 6,
    });
  });

  it('accepts the concise same-origin endpoint wording used by the published skill', () => {
    const trace = validTrace();
    const skill = '## Discover\nConnect to same-origin `/mcp`; inspect its live tools.';
    const digest = `sha256:${createHash('sha256').update(skill).digest('hex')}`;
    const catalog = JSON.parse(trace[0].response.value.body as string);
    catalog.skills[0].digest = digest;
    trace[0].response.value.body = JSON.stringify(catalog);
    trace[1].response.value.body = skill;
    trace[2].request.expected_digest = digest;
    trace[2].response.value.expected_digest = digest;
    trace[2].response.value.actual_digest = digest;

    expect(validateAutonomousTrace(trace, { origin: ORIGIN })).toMatchObject({
      passed: true,
      endpoint: `${ORIGIN}/mcp`,
    });
  });

  it('rejects MCP initialization before exact digest verification', () => {
    const trace = validTrace();
    trace.splice(2, 1);
    expect(() => validateAutonomousTrace(trace, { origin: ORIGIN }))
      .toThrow(/did not verify/);
  });

  it('rejects a target result that did not succeed', () => {
    const trace = validTrace();
    trace[9].response.success = false;
    trace[9].response.error = 'target returned isError';
    expect(() => validateAutonomousTrace(trace, { origin: ORIGIN }))
      .toThrow(/target call edit_session failed/);
  });

  it('rejects guessed discovery probes before the standard well-known catalog', () => {
    const trace = validTrace().map((entry) => ({
      ...entry,
      sequence: entry.sequence + 1,
      request_id: `transport-${entry.sequence + 1}`,
    }));
    trace.unshift({
      sequence: 1,
      request_id: 'transport-1',
      phase: 'fetch',
      request: { url: `${ORIGIN}/.well-known/agents.json` },
      response: { success: false, error: 'fetch failed: HTTP 404' },
    });

    expect(() => validateAutonomousTrace(trace, { origin: ORIGIN }))
      .toThrow(/first network action/);
  });

  it('rejects an edit without a final verification read', () => {
    const trace = validTrace().slice(0, -1);
    expect(() => validateAutonomousTrace(trace, { origin: ORIGIN }))
      .toThrow(/verification get_session/);
  });

  it('rejects consecutive edits without an intermediate verification read', () => {
    const trace = validTrace();
    trace.splice(8, 1);
    expect(() => validateAutonomousTrace(trace, { origin: ORIGIN }))
      .toThrow(/verification get_session/);
  });

  it('rejects an incorrect final musical state', () => {
    const trace = validTrace();
    const result = trace.at(-1)!.response.value.result as {
      structuredContent: { tracks: Array<{ active_steps: number[] }> };
    };
    result.structuredContent.tracks[0].active_steps = [0, 4, 8];
    expect(() => validateAutonomousTrace(trace, { origin: ORIGIN }))
      .toThrow(/requested assignments|exactly 0,4,8,12/);
  });

  it('rejects a post-edit read that does not prove the mutation post-state', () => {
    const trace = validTrace();
    const postAdd = trace[8].response.value.result as {
      structuredContent: { tracks: Array<{ sample_id: string }> };
    };
    postAdd.structuredContent.tracks[0].sample_id = 'snare';
    expect(() => validateAutonomousTrace(trace, { origin: ORIGIN }))
      .toThrow(/wrong instrument/);
  });

  it('redacts capabilities consistently before a receipt is written', () => {
    const encoded = encodeURIComponent(SESSION).replaceAll('-', '%2D');
    const doubleEncoded = encodeURIComponent(encoded);
    const { sanitized, redacted_uuids } = sanitizeForReceipt({
      literal: SESSION,
      encoded,
      doubleEncoded,
      [`session-${SESSION}`]: { id: SESSION },
      trace: validTrace(),
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain(SESSION);
    expect(serialized).not.toContain(encoded);
    expect(serialized).not.toContain(doubleEncoded);
    expect(redacted_uuids).toBe(2);
    expect(() => validateAutonomousTrace(sanitized.trace, { origin: ORIGIN })).not.toThrow();
  });

  it('allows only the starting origin in the initial agent prompt', () => {
    const prompt = `The only site location you know is:\n${ORIGIN}\n\nDiscover its standards-based agent instructions and verify exact bytes before acting.`;
    expect(validateOriginOnlyPrompt(prompt, { origin: ORIGIN })).toBe(true);
    expect(() => validateOriginOnlyPrompt(`${prompt}\nUse ${ORIGIN}/mcp`, { origin: ORIGIN }))
      .toThrow(/only the starting origin|target path/);
    expect(() => validateOriginOnlyPrompt(`${prompt}\nCall get_session`, { origin: ORIGIN }))
      .toThrow(/target path/);
  });

  it('rejects a receipt whose exact prompt or trace hash drifted', () => {
    const receipt = autonomousReceipt();
    expect(validateAutonomousReceipt(receipt)).toMatchObject({ passed: true });
    expect(() => validateAutonomousReceipt({ ...receipt, prompt_sha256: '0'.repeat(64) }))
      .toThrow(/prompt SHA-256/);
    expect(() => validateAutonomousReceipt({ ...receipt, trace_sha256: '0'.repeat(64) }))
      .toThrow(/trace SHA-256/);
    expect(() => validateAutonomousReceipt({ ...receipt, answer_sha256: '0'.repeat(64) }))
      .toThrow(/answer SHA-256/);
    expect(() => validateAutonomousReceipt({ ...receipt, cli_trace_sha256: '0'.repeat(64) }))
      .toThrow(/CLI trace SHA-256/);
    expect(() => validateAutonomousReceipt({ ...receipt, adapter_argv_sha256: '0'.repeat(64) }))
      .toThrow(/adapter argv SHA-256/);
    const reorderedCliTrace = [...receipt.cli_trace].reverse();
    expect(() => validateAutonomousReceipt({
      ...receipt,
      cli_trace: reorderedCliTrace,
      cli_trace_sha256: createHash('sha256')
        .update(JSON.stringify(reorderedCliTrace)).digest('hex'),
    })).toThrow(/does not correlate/);
    const mismatchedCliTrace = structuredClone(receipt.cli_trace);
    const connect = mismatchedCliTrace.find((event) =>
      event.name === 'mcp__discovery_transport__connect_mcp')!;
    connect.arguments.endpoint_url = 'https://attacker.invalid/mcp';
    expect(() => validateAutonomousReceipt({
      ...receipt,
      cli_trace: mismatchedCliTrace,
      cli_trace_sha256: createHash('sha256')
        .update(JSON.stringify(mismatchedCliTrace)).digest('hex'),
    })).toThrow(/does not correlate/);
  });

  it('binds the exact origin-only prompt into the receipt', () => {
    const prompt = `The only site location you know is:\n${ORIGIN}\n\nDiscover its standards-based agent instructions and verify exact bytes before acting.`;
    const receipt = autonomousReceipt(prompt);
    expect(validateAutonomousReceipt(receipt)).toMatchObject({ passed: true });
    receipt.prompt_sha256 = '0'.repeat(64);
    expect(() => validateAutonomousReceipt(receipt)).toThrow(/prompt SHA-256/);
  });

  it('rejects a raw autonomous answer that discloses a capability in encoded form', () => {
    expect(validateRawAnswerCapabilities('Done without a session link.', new Set([SESSION])))
      .toEqual({ registered_capabilities: 1, passed: true });
    expect(() => validateRawAnswerCapabilities(`Editable: /s/${SESSION}`, new Set([SESSION])))
      .toThrow(/disclosed/);
    expect(() => validateRawAnswerCapabilities(
      `Editable: /s/${SESSION.replaceAll('-', '%2D')}`,
      new Set([SESSION]),
    )).toThrow(/disclosed/);
    expect(() => validateRawAnswerCapabilities(
      `Editable token: ${Buffer.from(SESSION).toString('base64url')}`,
      new Set([SESSION]),
    )).toThrow(/disclosed/);
    const compact = SESSION.replaceAll('-', '');
    expect(() => validateRawAnswerCapabilities(
      `Editable compact token: ${compact}`,
      new Set([SESSION]),
    )).toThrow(/disclosed/);
    expect(() => validateRawAnswerCapabilities(
      `Editable compact token: ${Buffer.from(compact).toString('base64url')}`,
      new Set([SESSION]),
    )).toThrow(/disclosed/);
    const percentEncoded = SESSION.replaceAll('-', '%2D');
    const unicodeEncoded = SESSION.replaceAll('-', '\\u002d');
    const nestedEncodings = [
      Buffer.from(Buffer.from(SESSION).toString('base64')).toString('base64'),
      Buffer.from(percentEncoded).toString('base64url'),
      Buffer.from(unicodeEncoded).toString('base64'),
    ];
    for (const nested of nestedEncodings) {
      expect(() => validateRawAnswerCapabilities(
        `Editable nested token: ${nested}`,
        new Set([SESSION]),
      )).toThrow(/disclosed/);
      const receipt = autonomousReceipt();
      receipt.answer = nested;
      receipt.answer_sha256 = createHash('sha256').update(nested).digest('hex');
      expect(() => validateAutonomousReceipt(receipt)).toThrow(/UUID capability/);
    }
    expect(() => validateRawAnswerCapabilities('safe', new Set())).toThrow(/empty registry/);
  });

  it('binds schema, model, source bytes, validation, and redaction metadata', () => {
    const receipt = autonomousReceipt();
    expect(validateAutonomousReceipt(receipt)).toMatchObject({ passed: true });
    expect(() => validateAutonomousReceipt({ ...receipt, unexpected: true }))
      .toThrow(/additional properties/);
    const openTrace = structuredClone(receipt);
    openTrace.trace[0].provider_attested = true;
    openTrace.trace_sha256 = createHash('sha256').update(JSON.stringify(openTrace.trace)).digest('hex');
    expect(() => validateAutonomousReceipt(openTrace)).toThrow(/additional properties/);
    const openCliTrace = structuredClone(receipt);
    openCliTrace.cli_trace[0].provider_attested = true;
    openCliTrace.cli_trace_sha256 = createHash('sha256')
      .update(JSON.stringify(openCliTrace.cli_trace)).digest('hex');
    expect(() => validateAutonomousReceipt(openCliTrace)).toThrow(/additional properties/);
    expect(() => validateAutonomousReceipt({
      ...receipt,
      agent: { ...receipt.agent, model: 'claude-opus-5' },
    })).toThrow(/model does not match/);
    expect(() => validateAutonomousReceipt({
      ...receipt,
      validation: { ...receipt.validation, event_count: 999 },
    })).toThrow(/stored autonomous validation/);
    const source = structuredClone(receipt.source);
    source.files.find((file) => file.role === 'skill')!.content += '\nchanged';
    expect(() => validateAutonomousReceipt({ ...receipt, source }))
      .toThrow(/served skill bytes/);
  });

  it('binds critical autonomous roles to their canonical paths', () => {
    const repoRoot = resolve(process.cwd(), '..');
    const receipt = JSON.parse(readFileSync(resolve(
      repoRoot,
      'evals/receipts/2026-07-29-haiku-autonomous-1.json',
    ), 'utf8'));
    expect(verifySourceBinding(receipt.source, repoRoot)).toBe(true);
    expect(() => verifySourceBinding({
      ...receipt.source,
      repository: 'https://attacker.invalid/keyboardia.git',
    }, repoRoot)).toThrow(/canonical Keyboardia repository/);

    for (const [role, canonicalPath, decoyPath] of [
      ['answer_adapter', 'evals/adapters/claude-discovery.mjs', 'evals/adapters/usage.mjs'],
      ['system_under_test_entry', 'app/src/worker/index.ts', 'app/src/worker/types.ts'],
    ]) {
      const source = structuredClone(receipt.source);
      source.files.find((file: { path: string }) => file.path === canonicalPath).role = 'dependency';
      source.files.find((file: { path: string }) => file.path === decoyPath).role = role;
      source.bundle_sha256 = canonicalSourceBundleHash(source.files);
      expect(() => verifySourceBinding(source, repoRoot)).toThrow(new RegExp(`${role} must bind`));
    }
  });
});
