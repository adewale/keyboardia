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
