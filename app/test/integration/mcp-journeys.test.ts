/**
 * MCP v1 onboarding walking skeleton.
 *
 * Unlike the fast handler tests, these tests cross the real Worker router,
 * session API, LiveSession Durable Object, durable storage, and WebSocket
 * broadcast path. The official MCP client remains the protocol oracle.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

interface TestEnv {
  LIVE_SESSIONS: DurableObjectNamespace;
  SESSIONS: KVNamespace;
}

interface ServerMessage {
  type: string;
  playerId?: string;
  trackId?: string;
  step?: number;
  value?: boolean;
  tempo?: number;
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

const clients: Client[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.close(1000, 'test complete');
  }
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function createSession(tempo = 120): Promise<{ id: string; url: string }> {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'MCP journey',
      state: { tracks: [], tempo, swing: 0, version: 1 },
    }),
  });

  expect(response.status).toBe(201);
  const created = await response.json() as { id: string; url: string };
  expect(created.url).toBe(`/s/${created.id}`);
  return created;
}

async function connectAgent(name: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost/mcp'),
    {
      fetch: async (input, init) => SELF.fetch(input, init),
    }
  );
  const client = new Client(
    { name, version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  await client.connect(transport);
  clients.push(client);
  return client;
}

function listen(socket: WebSocket) {
  const buffered: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  socket.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string'
      ? event.data
      : new TextDecoder().decode(event.data as ArrayBuffer);
    const message = JSON.parse(raw) as ServerMessage;
    const waiterIndex = waiters.findIndex(({ predicate }) => predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      buffered.push(message);
    }
  });

  return {
    waitFor(
      predicate: (message: ServerMessage) => boolean,
      label: string,
      timeoutMs = 4_000
    ): Promise<ServerMessage> {
      const bufferedIndex = buffered.findIndex(predicate);
      if (bufferedIndex >= 0) {
        return Promise.resolve(buffered.splice(bufferedIndex, 1)[0]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(
            `Timed out waiting for ${label}. Saw: ${buffered.map(({ type }) => type).join(', ')}`
          ));
        }, timeoutMs);
        waiters.push({ predicate, resolve, timer });
      });
    },
  };
}

async function connectBrowser(sessionId: string) {
  const namespace = (env as unknown as TestEnv).LIVE_SESSIONS;
  const stub = namespace.get(namespace.idFromName(sessionId));
  const response = await stub.fetch(
    `http://do/api/sessions/${sessionId}?playerId=browser-user`,
    { headers: { Upgrade: 'websocket' } }
  );

  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const socket = response.webSocket!;
  socket.accept();
  sockets.push(socket);
  const inbox = listen(socket);
  await inbox.waitFor(({ type }) => type === 'snapshot', 'initial browser snapshot');
  return inbox;
}

function readToolError(result: ToolResult): { error: string; code: string } {
  expect(result.isError).toBe(true);
  const text = result.content.find(({ type }) => type === 'text')?.text;
  expect(text).toBeTypeOf('string');
  return JSON.parse(text!) as { error: string; code: string };
}

describe('MCP v1 onboarding journeys', () => {
  it('joins a created session, collaborates live, persists, and resumes with a fresh agent', async () => {
    const { id } = await createSession();
    const browser = await connectBrowser(id);
    const agentA = await connectAgent('agent-a');
    const agentB = await connectAgent('agent-b');

    await agentA.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: {
          operation: 'add_track',
          track_id: 'kick-agent-a',
          sample_id: 'kick',
        },
      },
    });
    expect(await browser.waitFor(
      ({ type, playerId }) => type === 'track_added' && playerId === 'mcp',
      'agent track broadcast'
    )).toMatchObject({
      type: 'track_added',
      playerId: 'mcp',
    });

    await agentB.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: {
          operation: 'set_steps',
          track_id: 'kick-agent-a',
          changes: [
            { step: 0, value: true },
            { step: 4, value: true },
            { step: 8, value: true },
            { step: 12, value: true },
          ],
        },
      },
    });
    expect(await browser.waitFor(
      ({ type, trackId, step, value }) =>
        type === 'step_toggled'
        && trackId === 'kick-agent-a'
        && step === 12
        && value === true,
      'agent step broadcast'
    )).toMatchObject({
      type: 'step_toggled',
      playerId: 'mcp',
      trackId: 'kick-agent-a',
      step: 12,
      value: true,
    });

    await agentA.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: { operation: 'set_tempo', tempo: 124 },
      },
    });
    expect(await browser.waitFor(
      ({ type, tempo }) => type === 'tempo_changed' && tempo === 124,
      'agent tempo broadcast'
    )).toMatchObject({
      type: 'tempo_changed',
      playerId: 'mcp',
      tempo: 124,
    });

    await agentA.close();
    await agentB.close();
    clients.splice(0);

    const resumedAgent = await connectAgent('agent-resumed');
    const result = await resumedAgent.callTool({
      name: 'get_session',
      arguments: { session_id: id },
    }) as ToolResult;

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      session_id: id,
      immutable: false,
      tempo: 124,
      tracks: [{
        track_id: 'kick-agent-a',
        name: 'Kick',
        sample_id: 'kick',
        step_count: 16,
        active_steps: [0, 4, 8, 12],
      }],
    });

    // The session API is what a returning browser reads, so it must show the
    // agents' work too. Asserting on the API rather than on the rendered SPA
    // keeps this test independent of whether `npm run build` has produced the
    // static assets.
    const browserRead = await SELF.fetch(`http://localhost/api/sessions/${id}`);
    expect(browserRead.status).toBe(200);
    const persisted = await browserRead.json() as {
      state: { tempo: number; tracks: Array<{ id: string; steps: boolean[] }> };
    };
    expect(persisted.state.tempo).toBe(124);
    expect(persisted.state.tracks).toHaveLength(1);
    expect(persisted.state.tracks[0]?.id).toBe('kick-agent-a');
    expect(
      persisted.state.tracks[0]?.steps.flatMap((active, step) => active ? [step] : [])
    ).toEqual([0, 4, 8, 12]);
  });

  it('changes a track instrument through the same granular broadcast a browser uses', async () => {
    // Change instrument (issue #63). The browser half of this parity lives in
    // collaboration-contract.test.ts; this is the agent half, through the real
    // Worker, Durable Object, and WebSocket broadcast path.
    const { id } = await createSession();
    const browser = await connectBrowser(id);
    const agent = await connectAgent('agent-instrument');

    await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: {
          operation: 'add_track',
          track_id: 'lead-agent',
          sample_id: 'kick',
          name: 'Ada Lead',
        },
      },
    });
    await browser.waitFor(
      ({ type }) => type === 'track_added',
      'agent track broadcast'
    );

    await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: {
          operation: 'set_steps',
          track_id: 'lead-agent',
          changes: [{ step: 3, value: true }, { step: 11, value: true }],
        },
      },
    });
    await browser.waitFor(
      ({ type, step }) => type === 'step_toggled' && step === 11,
      'agent step broadcast'
    );

    const result = await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: {
          operation: 'set_track_instrument',
          track_id: 'lead-agent',
          sample_id: 'sampled:808-kick',
        },
      },
    }) as ToolResult;

    // A connected browser converges from the existing granular event, not from
    // a replacement snapshot.
    expect(await browser.waitFor(
      ({ type, trackId }) => type === 'track_instrument_set' && trackId === 'lead-agent',
      'agent instrument broadcast'
    )).toMatchObject({
      type: 'track_instrument_set',
      playerId: 'mcp',
      trackId: 'lead-agent',
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      session_id: id,
      immutable: false,
      tempo: 120,
      tracks: [{
        track_id: 'lead-agent',
        // The agent swapped a sound; it did not rename a collaborator's track.
        name: 'Ada Lead',
        sample_id: 'sampled:808-kick',
        step_count: 16,
        active_steps: [3, 11],
      }],
    });

    const persisted = await (await SELF.fetch(`http://localhost/api/sessions/${id}`)).json() as {
      state: { tracks: Array<{ id: string; name: string; sampleId: string; steps: boolean[] }> };
    };
    expect(persisted.state.tracks[0]).toMatchObject({
      id: 'lead-agent',
      name: 'Ada Lead',
      sampleId: 'sampled:808-kick',
    });
    expect(
      persisted.state.tracks[0]?.steps.flatMap((active, step) => active ? [step] : [])
    ).toEqual([3, 11]);
  });

  it('reads a published session, rejects its edit, and reports a missing session', async () => {
    const { id: sourceId } = await createSession(96);
    const publishResponse = await SELF.fetch(
      `http://localhost/api/sessions/${sourceId}/publish`,
      { method: 'POST' }
    );
    expect(publishResponse.status).toBe(201);
    const { id: publishedId } = await publishResponse.json() as { id: string };
    const agent = await connectAgent('agent-errors');

    const read = await agent.callTool({
      name: 'get_session',
      arguments: { session_id: publishedId },
    }) as ToolResult;
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toMatchObject({
      session_id: publishedId,
      immutable: true,
      tempo: 96,
    });

    const rejected = await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: publishedId,
        edit: { operation: 'set_tempo', tempo: 128 },
      },
    }) as ToolResult;
    expect(readToolError(rejected)).toEqual({
      error: 'This session is published and cannot be edited. Remix it in Keyboardia to create an editable copy.',
      code: 'SESSION_PUBLISHED',
    });

    const unchanged = await agent.callTool({
      name: 'get_session',
      arguments: { session_id: publishedId },
    }) as ToolResult;
    expect(unchanged.structuredContent).toMatchObject({
      immutable: true,
      tempo: 96,
    });

    const missing = await agent.callTool({
      name: 'get_session',
      arguments: { session_id: '00000000-0000-4000-8000-000000000000' },
    }) as ToolResult;
    expect(readToolError(missing)).toEqual({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('leaves KV consistent when only an agent has touched the session', async () => {
    const { id } = await createSession();
    const agent = await connectAgent('agent-alone');

    await agent.callTool({
      name: 'edit_session',
      arguments: { session_id: id, edit: { operation: 'set_tempo', tempo: 140 } },
    });

    // Hybrid persistence normally flushes KV when the last WebSocket closes,
    // and no browser ever connects here. Without an explicit flush KV would
    // keep serving the pre-agent tempo to every fallback read.
    const stored = await (env as unknown as TestEnv).SESSIONS.get(
      `session:${id}`,
      'json'
    ) as { state: { tempo: number }; updatedAt: number } | null;

    expect(stored).not.toBeNull();
    expect(stored!.state.tempo).toBe(140);
    expect(stored!.updatedAt).toBeGreaterThan(0);
  });

  it('answers browser MCP clients with usable CORS headers', async () => {
    const seen: Array<{ status: number; allowOrigin: string | null; expose: string | null }> = [];
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost/mcp'),
      {
        fetch: async (input, init) => {
          const response = await SELF.fetch(input as RequestInfo, init);
          seen.push({
            status: response.status,
            allowOrigin: response.headers.get('Access-Control-Allow-Origin'),
            expose: response.headers.get('Access-Control-Expose-Headers'),
          });
          return response;
        },
      }
    );
    const client = new Client(
      { name: 'browser-agent', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    await client.connect(transport);
    clients.push(client);
    await client.listTools();

    // Preflight is answered by the Worker's global OPTIONS branch; these are the
    // real exchanges, which bypass the /api/ response decoration entirely.
    expect(seen.length).toBeGreaterThan(0);
    for (const exchange of seen) {
      expect(exchange.status).toBeLessThan(400);
      expect(exchange.allowOrigin).toBe('*');
      expect(exchange.expose).toContain('MCP-Protocol-Version');
    }

    const preflight = await SELF.fetch('http://localhost/mcp', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://agent.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,mcp-protocol-version',
      },
    });
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(preflight.headers.get('Access-Control-Allow-Headers'))
      .toContain('MCP-Protocol-Version');
  });
});

describe('MCP endpoint guards', () => {
  it('rejects a non-POST request with 405 before the SDK runs', async () => {
    const response = await SELF.fetch('http://localhost/mcp', { method: 'GET' });

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('rejects a wrong content type with 415', async () => {
    const response = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('rejects an oversized declared body with 413', async () => {
    const response = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(1024 * 1024),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});

describe('MCP session lifecycle journeys', () => {
  const IDEMPOTENCY_KEY = '3f1b8a1e-1f5a-4c1d-9a2b-7e0d5c9a4b21';

  function structured(result: ToolResult): Record<string, unknown> {
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    return result.structuredContent!;
  }

  /**
   * Acceptance for "agent starts something new": the returned URL has to open
   * the session that was created, and another participant has to be able to
   * join it.
   */
  it('creates a session an agent can edit and a browser can join', async () => {
    const agent = await connectAgent('agent-creator');

    const created = structured(await agent.callTool({
      name: 'create_session',
      arguments: { idempotency_key: IDEMPOTENCY_KEY, name: 'Agent house', tempo: 124 },
    }) as ToolResult);
    const sessionId = created.session_id as string;

    expect(created.url).toBe(`http://localhost/s/${sessionId}`);
    expect(created.immutable).toBe(false);
    expect(created.tempo).toBe(124);

    // The canonical URL resolves to a real, readable session.
    const fetched = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
    expect(fetched.status).toBe(200);
    expect((await fetched.json() as { id: string }).id).toBe(sessionId);

    // A browser joins the same session and sees the agent's edit live.
    const browser = await connectBrowser(sessionId);
    await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: sessionId,
        edit: { operation: 'add_track', track_id: 'kick-1', sample_id: 'kick' },
      },
    });
    const added = await browser.waitFor(
      ({ type }) => type === 'track_added',
      'browser sees the agent track'
    );
    expect(added.trackId ?? (added as unknown as { track?: { id: string } }).track?.id)
      .toBe('kick-1');
  });

  it('resolves a retried create to the same session instead of a duplicate', async () => {
    const agent = await connectAgent('agent-retry');
    const args = { idempotency_key: '9c2f0a77-0b3d-4a51-9f10-2c8f7b6d4e33', name: 'Retry' };

    const first = structured(await agent.callTool({ name: 'create_session', arguments: args }) as ToolResult);
    const retry = structured(await agent.callTool({ name: 'create_session', arguments: args }) as ToolResult);

    expect(retry.session_id).toBe(first.session_id);
    expect(retry.url).toBe(first.url);
  });

  /**
   * Acceptance for "agent continues from published work": the published source
   * keeps its state and its immutability, and the remix is editable.
   */
  it('remixes a published session without disturbing the original', async () => {
    const { id } = await createSession();
    const agent = await connectAgent('agent-remixer');

    await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: { operation: 'add_track', track_id: 'kick-1', sample_id: 'kick' },
      },
    });
    const published = structured(await agent.callTool({
      name: 'publish_session',
      arguments: { session_id: id },
    }) as ToolResult);
    const publishedId = published.session_id as string;

    const remix = structured(await agent.callTool({
      name: 'remix_session',
      arguments: { session_id: publishedId },
    }) as ToolResult);

    expect(remix.immutable).toBe(false);
    expect(remix.remixed_from).toBe(publishedId);
    expect(remix.tracks).toEqual(published.tracks);

    // Editing the remix must not reach the published source.
    await agent.callTool({
      name: 'remix_session',
      arguments: { session_id: publishedId },
    });
    const editRemix = await agent.callTool({
      name: 'edit_session',
      arguments: { session_id: remix.session_id, edit: { operation: 'set_tempo', tempo: 150 } },
    }) as ToolResult;
    expect(editRemix.isError).toBeFalsy();

    const sourceAfter = structured(await agent.callTool({
      name: 'get_session',
      arguments: { session_id: publishedId },
    }) as ToolResult);
    expect(sourceAfter.immutable).toBe(true);
    expect(sourceAfter.tempo).toBe(published.tempo);
  });

  /**
   * Acceptance for "agent freezes a shareable result": the snapshot is
   * immutable, the source stays editable, and publishing is explicit.
   */
  it('publishes a snapshot and leaves the source editable', async () => {
    const { id } = await createSession();
    const agent = await connectAgent('agent-publisher');

    const published = structured(await agent.callTool({
      name: 'publish_session',
      arguments: { session_id: id },
    }) as ToolResult);

    expect(published.immutable).toBe(true);
    expect(published.source_session_id).toBe(id);
    expect(published.source_url).toBe(`http://localhost/s/${id}`);

    // The published copy refuses edits; the source still accepts them.
    const blocked = await agent.callTool({
      name: 'edit_session',
      arguments: { session_id: published.session_id, edit: { operation: 'set_tempo', tempo: 130 } },
    }) as ToolResult;
    expect(blocked.isError).toBe(true);

    const stillEditable = await agent.callTool({
      name: 'edit_session',
      arguments: { session_id: id, edit: { operation: 'set_tempo', tempo: 130 } },
    }) as ToolResult;
    expect(stillEditable.isError).toBeFalsy();
  });

  it('refuses to publish an already-published session', async () => {
    const { id } = await createSession();
    const agent = await connectAgent('agent-double-publisher');
    const published = structured(await agent.callTool({
      name: 'publish_session',
      arguments: { session_id: id },
    }) as ToolResult);

    const again = await agent.callTool({
      name: 'publish_session',
      arguments: { session_id: published.session_id },
    }) as ToolResult;

    expect(readToolError(again).code).toBe('ALREADY_PUBLISHED');
  });

  /**
   * Acceptance for "agent takes the result elsewhere": a real Standard MIDI
   * File, unchanged music, and an honest account of what did not survive.
   */
  it('exports a MIDI file without changing the session', async () => {
    const { id } = await createSession();
    const agent = await connectAgent('agent-exporter');

    await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: { operation: 'add_track', track_id: 'kick-1', sample_id: 'kick' },
      },
    });
    await agent.callTool({
      name: 'edit_session',
      arguments: {
        session_id: id,
        edit: {
          operation: 'set_steps',
          track_id: 'kick-1',
          changes: [{ step: 0, value: true }, { step: 8, value: true }],
        },
      },
    });
    const before = structured(await agent.callTool({
      name: 'get_session',
      arguments: { session_id: id },
    }) as ToolResult);

    const exported = structured(await agent.callTool({
      name: 'export_midi',
      arguments: { session_id: id },
    }) as ToolResult);

    expect(exported.mime_type).toBe('audio/midi');
    expect(exported.filename).toBe('MCP-journey.mid');
    expect(exported.exported_track_ids).toEqual(['kick-1']);
    const bytes = Uint8Array.from(atob(exported.data as string), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('MThd');
    expect(bytes.byteLength).toBe(exported.byte_length);

    const after = structured(await agent.callTool({
      name: 'get_session',
      arguments: { session_id: id },
    }) as ToolResult);
    expect(after).toEqual(before);
  });

  /**
   * Acceptance for "agent explains the music": read-only, grounded in the
   * current session, structured, and agreeing with the browser's musical model.
   *
   * The pitched content is seeded through the session API rather than through
   * edit_session, because the v1 edit surface cannot set pitch — which is the
   * realistic shape of this journey anyway: a person writes the melody in the
   * browser and asks an agent what it is.
   */
  it('explains the music of a session it did not write', async () => {
    const steps = Array.from({ length: 16 }, (_, i) => [0, 2, 4, 6, 8].includes(i));
    // C minor pentatonic: C, Eb, F, G, Bb.
    const pitches = [0, 3, 5, 7, 10];
    const parameterLocks = Array.from({ length: 16 }, (_, i) => {
      const index = [0, 2, 4, 6, 8].indexOf(i);
      return index === -1 ? null : { pitch: pitches[index] };
    });

    const response = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Analysis journey',
        state: {
          tempo: 96,
          swing: 0,
          version: 1,
          tracks: [{
            id: 'lead',
            name: 'Lead',
            sampleId: 'synth:lead',
            steps,
            parameterLocks,
            volume: 1,
            muted: false,
            soloed: false,
            transpose: 0,
            stepCount: 16,
          }],
          scale: { root: 'C', scaleId: 'minor-pentatonic', locked: false },
        },
      }),
    });
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };

    const agent = await connectAgent('agent-analyst');
    const analysis = structured(await agent.callTool({
      name: 'analyze_session',
      arguments: { session_id: id },
    }) as ToolResult);

    expect(analysis.tempo).toBe(96);
    expect(analysis.pitch_class_names).toEqual(['C', 'D#', 'F', 'G', 'A#']);
    expect((analysis.inferred_keys as unknown[])[0]).toMatchObject({
      root: 'C',
      scale_id: 'minor-pentatonic',
      fit: 1,
      coverage: 1,
    });
    // The agent's answer agrees with what the browser's Key Assistant is set to.
    expect(analysis.declared_key).toMatchObject({
      root: 'C',
      scale_id: 'minor-pentatonic',
      name: 'C Minor Pentatonic',
      fit: 1,
    });
    expect(analysis.rhythm).toMatchObject([{ role: 'pitched', onsets: [0, 2, 4, 6, 8] }]);

    // Read-only: the session is untouched afterwards.
    const after = structured(await agent.callTool({
      name: 'get_session',
      arguments: { session_id: id },
    }) as ToolResult);
    expect(after.tracks).toMatchObject([{ track_id: 'lead', active_steps: [0, 2, 4, 6, 8] }]);
  });

  it('reports a session with nothing audible rather than exporting an empty file', async () => {
    const { id } = await createSession();
    const agent = await connectAgent('agent-empty-exporter');

    const result = await agent.callTool({
      name: 'export_midi',
      arguments: { session_id: id },
    }) as ToolResult;

    expect(readToolError(result).code).toBe('NOTHING_TO_EXPORT');
  });
});
