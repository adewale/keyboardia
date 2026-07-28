import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  sanitizeForReceipt,
  validateAutonomousReceipt,
  validateAutonomousTrace,
  validateOriginOnlyPrompt,
  validateRawAnswerCapabilities,
} from '../scripts/autonomous-discovery-validator.mjs';

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
    }, { ...initial, tracks: [{ track_id: 'agent-kick-a7f3c29d', sample_id: 'kick', active_steps: [] }] }),
    toolCall(9, 'get_session', { session_id: SESSION }, {
      ...initial,
      tracks: [{ track_id: 'agent-kick-a7f3c29d', sample_id: 'kick', active_steps: [] }],
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
  return trace.map((entry) => ({ name: names[entry.phase] }));
}

describe('autonomous discovery trace oracle', () => {
  it('accepts one correlated origin-to-discovery-to-read-edit-read journey', () => {
    expect(validateAutonomousTrace(validTrace(), { origin: ORIGIN })).toMatchObject({
      passed: true,
      endpoint: `${ORIGIN}/mcp`,
      target_call_count: 6,
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

  it('retains harmless failed discovery probes before the successful chain', () => {
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

    expect(validateAutonomousTrace(trace, { origin: ORIGIN })).toMatchObject({ passed: true });
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
      .toThrow(/exactly 0,4,8,12/);
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
    const prompt = `The only location you know is:\n${ORIGIN}\n\nUse the Agent Skills discovery standard.`;
    const trace = validTrace();
    const cliTrace = cliTraceFor(trace);
    const adapterArgv = ['--tools', 'ToolSearch'];
    const receipt = {
      target_mcp_preconfigured: false,
      origin: ORIGIN,
      prompt,
      prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
      answer: 'Done without sharing the capability.',
      answer_sha256: createHash('sha256').update('Done without sharing the capability.').digest('hex'),
      cli_trace: cliTrace,
      cli_trace_sha256: createHash('sha256').update(JSON.stringify(cliTrace)).digest('hex'),
      trace,
      trace_sha256: createHash('sha256').update(JSON.stringify(trace)).digest('hex'),
      adapter_argv: adapterArgv,
      adapter_argv_sha256: createHash('sha256').update(JSON.stringify(adapterArgv)).digest('hex'),
      raw_answer_capability_scan: { registered_capabilities: 2, passed: true },
    };
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
  });

  it('binds the exact origin-only prompt into the receipt', () => {
    const prompt = `The only site location you know is:\n${ORIGIN}\n\nDiscover its standards-based agent instructions and verify exact bytes before acting.`;
    const trace = validTrace();
    const cliTrace = cliTraceFor(trace);
    const adapterArgv = ['--strict-mcp-config', 'generic-discovery-transport'];
    const receipt = {
      target_mcp_preconfigured: false,
      origin: ORIGIN,
      prompt,
      prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
      adapter_argv: adapterArgv,
      adapter_argv_sha256: createHash('sha256').update(JSON.stringify(adapterArgv)).digest('hex'),
      answer: 'Done without sharing the capability.',
      answer_sha256: createHash('sha256').update('Done without sharing the capability.').digest('hex'),
      cli_trace: cliTrace,
      cli_trace_sha256: createHash('sha256').update(JSON.stringify(cliTrace)).digest('hex'),
      trace,
      trace_sha256: createHash('sha256').update(JSON.stringify(trace)).digest('hex'),
      raw_answer_capability_scan: { registered_capabilities: 2, passed: true },
    };
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
    expect(() => validateRawAnswerCapabilities('safe', new Set())).toThrow(/empty registry/);
  });
});
