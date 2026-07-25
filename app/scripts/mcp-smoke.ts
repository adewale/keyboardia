#!/usr/bin/env npx tsx
/**
 * Golden journey smoke test for the deployed stateless MCP endpoint.
 *
 * specs/STATELESS-MCP.md names a "deployment smoke" tier — run the golden
 * journey once against staging and then production — but the automated journey
 * (test/integration/mcp-journeys.test.ts) runs against a simulated Worker under
 * vitest-pool-workers and cannot be pointed at a deployed URL. This script is
 * that missing tier: the same journey, the official MCP client, real HTTP.
 *
 * Usage:
 *   npm run smoke:mcp -- https://staging.keyboardia.dev
 *   npm run smoke:mcp -- https://keyboardia.dev --session <uuid>
 *   npm run smoke:mcp -- http://localhost:8787          # against wrangler dev
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 *
 * SIDE EFFECTS: with no --session, this creates a real session on the target
 * and there is no session DELETE in the API, so the session persists. Sessions
 * are unlisted, but for production prefer a dedicated smoke session and pass
 * --session so repeat runs reuse it. Track IDs are stable and every edit is
 * written to be a real state change on a session a previous run already
 * touched, so a reused session neither accumulates tracks nor degrades into
 * asserting what the last run left. The script never publishes anything, so it
 * cannot create immutable litter.
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const PROTOCOL_VERSION = '2026-07-28';
const REQUEST_TIMEOUT_MS = 20_000;

interface CompactTrack {
  track_id: string;
  name: string;
  sample_id: string;
  step_count: number;
  active_steps: number[];
}

interface CompactSession {
  session_id: string;
  immutable: boolean;
  tempo: number;
  tracks: CompactTrack[];
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

interface Exchange {
  request: Request;
  response: Response;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { baseUrl: string; sessionId: string | null } {
  const args = argv.slice(2);
  let baseUrl: string | null = null;
  let sessionId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--session') {
      sessionId = args[++i] ?? null;
      if (!sessionId) fail('--session needs a session UUID.');
    } else if (arg.startsWith('--')) {
      fail(`Unknown option ${arg}.`);
    } else if (baseUrl === null) {
      baseUrl = arg;
    } else {
      fail(`Unexpected argument ${arg}.`);
    }
  }

  if (!baseUrl) {
    fail('Usage: npm run smoke:mcp -- <base-url> [--session <uuid>]');
  }

  try {
    // Normalize away any trailing path so `new URL('/mcp', base)` is exact.
    const parsed = new URL(baseUrl!);
    baseUrl = parsed.origin;
  } catch {
    fail(`${baseUrl} is not a valid URL.`);
  }

  if (sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    fail(`--session ${sessionId} is not a UUID.`);
  }

  return { baseUrl: baseUrl!, sessionId };
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Check runner
// ---------------------------------------------------------------------------

const failures: string[] = [];
let aborted = false;

/**
 * A fatal check gates everything after it: if the endpoint is not deployed
 * there is nothing to learn from the musical journey. A non-fatal check records
 * its failure and lets the run continue, so one report covers every defect
 * rather than one per round trip.
 */
async function check(
  name: string,
  fn: () => Promise<void>,
  { fatal = false }: { fatal?: boolean } = {}
): Promise<boolean> {
  if (aborted) {
    console.log(`  ⏭  ${name} (skipped)`);
    return false;
  }
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`  ❌ ${name}\n       ${reason.replace(/\n/g, '\n       ')}`);
    failures.push(`${name}: ${reason}`);
    if (fatal) {
      aborted = true;
      console.log('\n  Remaining checks depend on this one and were skipped.');
    }
    return false;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${message}\n  expected: ${b}\n  actual:   ${a}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'keyboardia-smoke', version: '1.0.0' },
    },
  });
}

async function createSession(baseUrl: string, name: string): Promise<{ id: string; url: string }> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert(
    response.status === 201,
    `POST /api/sessions returned ${response.status}, expected 201.`
  );
  return await response.json() as { id: string; url: string };
}

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------

async function connect(baseUrl: string, name: string): Promise<{ client: Client; exchanges: Exchange[] }> {
  const exchanges: Exchange[] = [];
  const transport = new StreamableHTTPClientTransport(
    new URL('/mcp', baseUrl),
    {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const response = await fetch(request.clone(), {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        exchanges.push({ request, response: response.clone() });
        return response;
      },
    }
  );

  // The pin is load-bearing. versionNegotiation.mode defaults to `legacy`, and
  // the endpoint accepts the 2025-era fallback, so an unpinned client connects
  // happily having never exercised the stateless path this smoke exists to
  // prove. See docs/LESSONS-LEARNED.md Lesson 45.
  const client = new Client(
    { name, version: '1.0.0' },
    { versionNegotiation: { mode: { pin: PROTOCOL_VERSION } } }
  );
  await client.connect(transport);
  return { client, exchanges };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return await client.callTool({ name, arguments: args }) as ToolResult;
}

function expectSession(result: ToolResult, context: string): CompactSession {
  if (result.isError) {
    const text = result.content?.[0]?.text ?? '(no content)';
    throw new Error(`${context} returned a tool error: ${text}`);
  }
  assert(result.structuredContent, `${context} returned no structuredContent.`);
  return result.structuredContent as unknown as CompactSession;
}

function expectToolError(result: ToolResult, context: string): { error?: string; code?: string } {
  assert(result.isError === true, `${context} should have returned a tool error.`);
  const text = result.content?.[0]?.text;
  assert(text, `${context} returned an error with no content.`);
  try {
    return JSON.parse(text!) as { error?: string; code?: string };
  } catch {
    // Schema rejections are plain text rather than a Keyboardia error envelope.
    return { error: text! };
  }
}

function findTrack(session: CompactSession, trackId: string): CompactTrack {
  const track = session.tracks.find((candidate) => candidate.track_id === trackId);
  assert(track, `Track ${trackId} is missing from the session.`);
  return track!;
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { baseUrl, sessionId: providedSessionId } = parseArgs(process.argv);

  // Track IDs are stable rather than per-run. MAX_TRACKS is 16, so per-run IDs
  // would let a reused --session accumulate two tracks per run and start
  // failing with TRACK_LIMIT_REACHED on the ninth. Stable IDs make a reused
  // session runnable forever, at the cost of add_track being a no-op after the
  // first run — which the checks below compensate for by making every edit a
  // real state change rather than a re-assertion of what a prior run left.
  const runId = Date.now().toString(36);
  const kickTrackId = 'smoke-kick';
  const bystanderTrackId = 'smoke-bystander';

  console.log(`\nKeyboardia MCP golden journey`);
  console.log(`Target:   ${baseUrl}/mcp`);
  console.log(`Protocol: ${PROTOCOL_VERSION}`);
  console.log(`Run ID:   ${runId}\n`);

  console.log('Reachability');

  await check('The target responds to /api/health', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert(response.ok, `GET /api/health returned ${response.status}.`);
  }, { fatal: true });

  // Deliberately a raw POST rather than the SDK client: a 404 here means the
  // route is absent from the deployed Worker, and that diagnosis should not
  // arrive disguised as a protocol-negotiation error.
  let rawInitialize: Response | null = null;
  await check('POST /mcp is served by the deployed Worker', async () => {
    rawInitialize = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Origin': 'https://mcp-smoke.invalid',
      },
      body: initializeBody(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert(
      rawInitialize.status !== 404,
      'POST /mcp returned 404. The deployed Worker does not have the /mcp route — '
      + 'the code is merged but not deployed. Deploy, then re-run.'
    );
    assert(
      rawInitialize.ok,
      `POST /mcp returned ${rawInitialize.status}, expected a protocol response.`
    );
  }, { fatal: true });

  // Lesson 44: a green preflight says nothing. These headers must be present on
  // a *successful exchange*, and the expose list is what lets a page read the
  // negotiated revision at all.
  await check('CORS headers are present on a real exchange, not just OPTIONS', async () => {
    const response = rawInitialize!;
    const allowOrigin = response.headers.get('access-control-allow-origin');
    assert(
      allowOrigin,
      'A successful POST /mcp carried no Access-Control-Allow-Origin, so no browser '
      + 'MCP client can read the response.'
    );
    const expose = response.headers.get('access-control-expose-headers') ?? '';
    assert(
      expose.toLowerCase().includes('mcp-protocol-version'),
      `Access-Control-Expose-Headers is "${expose}"; cross-origin JavaScript cannot `
      + 'read MCP-Protocol-Version without it.'
    );
  });

  console.log('\nProtocol');

  let client: Client | null = null;
  let exchanges: Exchange[] = [];

  await check(`The official client negotiates MCP ${PROTOCOL_VERSION}`, async () => {
    const connected = await connect(baseUrl, 'keyboardia-smoke');
    client = connected.client;
    exchanges = connected.exchanges;
    assert(
      exchanges.some(({ request }) =>
        request.headers.get('MCP-Protocol-Version') === PROTOCOL_VERSION
      ),
      `No request carried MCP-Protocol-Version: ${PROTOCOL_VERSION}.`
    );
  }, { fatal: true });

  await check('No exchange issues or requires Mcp-Session-Id', async () => {
    const stateful = exchanges.filter(({ response }) => response.headers.get('Mcp-Session-Id'));
    assert(
      stateful.length === 0,
      `${stateful.length} response(s) carried Mcp-Session-Id; the endpoint is not stateless.`
    );
  });

  await check('tools/list advertises exactly the v1 rhythm slice', async () => {
    const listed = await client!.listTools();
    assertEqual(
      listed.tools.map((tool) => tool.name),
      ['get_session', 'edit_session'],
      'tools/list does not match the documented v1 surface.'
    );
    assert(
      client!.getServerCapabilities()?.resources === undefined,
      'The server advertises resources; v1 has none.'
    );
    assert(
      client!.getServerCapabilities()?.prompts === undefined,
      'The server advertises prompts; v1 has none.'
    );
    const editSchema = JSON.stringify(
      listed.tools.find((tool) => tool.name === 'edit_session')?.inputSchema
    );
    assert(
      editSchema.includes('"kick"'),
      'The edit_session schema does not carry the instrument enum, so an agent has '
      + 'no source of valid sample IDs.'
    );
  });

  console.log('\nSession');

  let sessionId = providedSessionId;
  let createdUrl: string | null = null;

  await check(
    providedSessionId ? `Reusing session ${providedSessionId}` : 'Creating a session to work in',
    async () => {
      if (providedSessionId) return;
      const created = await createSession(baseUrl, `MCP smoke ${runId}`);
      sessionId = created.id;
      createdUrl = `${baseUrl}${created.url}`;
    },
    { fatal: true }
  );

  let baseline: CompactSession | null = null;
  await check('get_session reads the session', async () => {
    baseline = expectSession(
      await callTool(client!, 'get_session', { session_id: sessionId }),
      'get_session'
    );
    assert(
      baseline.session_id === sessionId,
      `get_session returned session ${baseline.session_id}, expected ${sessionId}.`
    );
    assert(
      baseline.immutable === false,
      'The target session is published and cannot be edited. Pass an editable --session.'
    );
  }, { fatal: true });

  console.log('\nEdits');

  // The bystander stands in for a collaborator's unrelated work. The central
  // safety rule of the whole design is that an agent may assign named values
  // and may not replace a session or a track, so a smoke run that never checks
  // preservation is not smoking the thing that matters.
  let bystander: CompactTrack | null = null;
  await check('A bystander track is added and given steps', async () => {
    expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: { operation: 'add_track', track_id: bystanderTrackId, sample_id: 'hihat' },
      }),
      'edit_session/add_track (bystander)'
    );
    const session = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: {
          operation: 'set_steps',
          track_id: bystanderTrackId,
          changes: [2, 6, 10, 14].map((step) => ({ step, value: true })),
        },
      }),
      'edit_session/set_steps (bystander)'
    );
    bystander = findTrack(session, bystanderTrackId);
    assertEqual(
      bystander.active_steps,
      [2, 6, 10, 14],
      'The bystander track did not take the steps it was given.'
    );
  }, { fatal: true });

  await check('add_track puts a kick in the session, and an identical retry is a no-op', async () => {
    const first = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: { operation: 'add_track', track_id: kickTrackId, sample_id: 'kick' },
      }),
      'edit_session/add_track'
    );
    const track = findTrack(first, kickTrackId);
    assert(
      track.sample_id === 'kick',
      `The new track has sample_id ${track.sample_id}, expected kick.`
    );

    const retried = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: { operation: 'add_track', track_id: kickTrackId, sample_id: 'kick' },
      }),
      'edit_session/add_track (retry)'
    );
    assertEqual(
      retried.tracks.filter(({ track_id }) => track_id === kickTrackId).length,
      1,
      'Retrying add_track duplicated the track; the operation is not idempotent.'
    );
  });

  // Each phase is a real state change, not a re-assertion of what a previous
  // run left behind. On a reused session an assign-what-is-already-there check
  // would pass even if set_steps had silently stopped mutating.
  await check('set_steps builds four on the floor', async () => {
    const session = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: {
          operation: 'set_steps',
          track_id: kickTrackId,
          changes: [0, 4, 8, 12].map((step) => ({ step, value: true })),
        },
      }),
      'edit_session/set_steps'
    );
    assertEqual(
      findTrack(session, kickTrackId).active_steps,
      [0, 4, 8, 12],
      'The kick did not take exactly the steps it was given.'
    );
  });

  await check('set_steps clears a named step and leaves the rest alone', async () => {
    const cleared = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: {
          operation: 'set_steps',
          track_id: kickTrackId,
          changes: [{ step: 4, value: false }],
        },
      }),
      'edit_session/set_steps (clear)'
    );
    assertEqual(
      findTrack(cleared, kickTrackId).active_steps,
      [0, 8, 12],
      'Clearing step 4 did not leave exactly the other three steps.'
    );

    const restored = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: {
          operation: 'set_steps',
          track_id: kickTrackId,
          changes: [{ step: 4, value: true }],
        },
      }),
      'edit_session/set_steps (restore)'
    );
    assertEqual(
      findTrack(restored, kickTrackId).active_steps,
      [0, 4, 8, 12],
      'Restoring step 4 did not rebuild the pattern.'
    );
  });

  await check('Repeating set_steps is a no-op', async () => {
    const retried = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: {
          operation: 'set_steps',
          track_id: kickTrackId,
          changes: [0, 4, 8, 12].map((step) => ({ step, value: true })),
        },
      }),
      'edit_session/set_steps (retry)'
    );
    assertEqual(
      findTrack(retried, kickTrackId).active_steps,
      [0, 4, 8, 12],
      'Repeating set_steps changed the track; assignment is not idempotent.'
    );
  });

  // Chosen to differ from whatever the session currently holds, so a reused
  // session still proves tempo actually moved.
  const targetTempo = baseline!.tempo === 124 ? 128 : 124;
  await check(`set_tempo moves tempo to ${targetTempo}`, async () => {
    const session = expectSession(
      await callTool(client!, 'edit_session', {
        session_id: sessionId,
        edit: { operation: 'set_tempo', tempo: targetTempo },
      }),
      'edit_session/set_tempo'
    );
    assert(
      session.tempo === targetTempo,
      `Tempo is ${session.tempo}, expected ${targetTempo}.`
    );
  });

  await check("The bystander's work survived every edit", async () => {
    const session = expectSession(
      await callTool(client!, 'get_session', { session_id: sessionId }),
      'get_session'
    );
    assertEqual(
      findTrack(session, bystanderTrackId),
      bystander,
      'A collaborator track changed while the agent worked on a different track.'
    );
  });

  console.log('\nPersistence and sad paths');

  // A second client proves durable state rather than anything held per request.
  await check('A fresh client reads the persisted combined state', async () => {
    await client!.close();
    const resumed = await connect(baseUrl, 'keyboardia-smoke-resumed');
    client = resumed.client;
    const session = expectSession(
      await callTool(client, 'get_session', { session_id: sessionId }),
      'get_session (fresh client)'
    );
    assert(
      session.tempo === targetTempo,
      `Tempo did not persist; it reads ${session.tempo}, expected ${targetTempo}.`
    );
    assertEqual(
      findTrack(session, kickTrackId).active_steps,
      [0, 4, 8, 12],
      'The kick pattern did not persist.'
    );
    assertEqual(
      findTrack(session, bystanderTrackId),
      bystander,
      'The bystander track did not persist.'
    );
  });

  await check('A returning browser reads the same work through the session API', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert(response.ok, `GET /api/sessions/${sessionId} returned ${response.status}.`);
    const persisted = await response.json() as {
      state: { tempo: number; tracks: Array<{ id: string }> };
    };
    assert(
      persisted.state.tempo === targetTempo,
      `The session API reports tempo ${persisted.state.tempo}, expected ${targetTempo}. `
      + 'The agent edit did not reach what a returning browser reads.'
    );
    assert(
      persisted.state.tracks.some(({ id }) => id === kickTrackId),
      'The session API does not show the agent-created track.'
    );
  });

  await check('A missing session returns SESSION_NOT_FOUND', async () => {
    const result = await callTool(client!, 'get_session', {
      session_id: '00000000-0000-4000-8000-000000000000',
    });
    const error = expectToolError(result, 'get_session on a missing session');
    assert(
      error.code === 'SESSION_NOT_FOUND',
      `Expected SESSION_NOT_FOUND, got ${error.code ?? '(no code)'}.`
    );
  });

  await check('A malformed session handle is rejected at the schema boundary', async () => {
    const result = await callTool(client!, 'get_session', { session_id: 'not-a-session-id' });
    const error = expectToolError(result, 'get_session on a malformed handle');
    assert(
      /validation|invalid/i.test(error.error ?? ''),
      `Expected a schema rejection, got ${JSON.stringify(error)}.`
    );
  });

  await check('An unsupported edit is rejected without mutating', async () => {
    const result = await callTool(client!, 'edit_session', {
      session_id: sessionId,
      edit: { operation: 'delete_track', track_id: kickTrackId },
    });
    expectToolError(result, 'edit_session with an unsupported operation');

    const session = expectSession(
      await callTool(client!, 'get_session', { session_id: sessionId }),
      'get_session after a rejected edit'
    );
    assert(
      session.tracks.some(({ track_id }) => track_id === kickTrackId),
      'A rejected edit removed the track anyway.'
    );
  });

  if (client) {
    await (client as Client).close().catch(() => { /* closing a dead client is not a failure */ });
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------

  console.log('');
  if (createdUrl) {
    console.log(`Created session: ${createdUrl}`);
    console.log('There is no session DELETE in the API, so this one stays. Pass');
    console.log('--session <uuid> to reuse a dedicated smoke session on repeat runs.');
    console.log('');
  }

  if (failures.length > 0) {
    console.error(`❌ ${failures.length} check(s) failed against ${baseUrl}:\n`);
    for (const failure of failures) console.error(`   • ${failure}`);
    console.error('');
    process.exit(1);
  }

  console.log(`✅ Golden journey passed against ${baseUrl}.\n`);
}

main().catch((error) => {
  console.error('\nThe smoke run itself failed:\n');
  console.error(error);
  process.exit(2);
});
