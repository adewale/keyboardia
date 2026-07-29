import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  Client,
  PROTOCOL_VERSION_META_KEY,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialSessionState } from '../shared/session-defaults';
import type { Session } from '../shared/state';
import { McpSessionEditError, applyMcpSessionEdit, type McpSessionEdit } from './mcp-edits';
import {
  createKeyboardiaMcpHandler,
  type McpCreateSessionOptions,
  type McpSessionAdapter,
} from './mcp';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const PROTOCOL_VERSION = '2026-07-28';

function modernRequest(
  method: string,
  options: {
    protocolVersion?: string;
    methodHeader?: string | null;
  } = {}
): Request {
  const protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocolVersion,
  });
  if (options.methodHeader !== null) {
    headers.set('Mcp-Method', options.methodHeader ?? method);
  }
  return new Request('https://keyboardia.test/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'raw-modern-request',
      method,
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: protocolVersion,
          [CLIENT_INFO_META_KEY]: { name: 'keyboardia-test', version: '1.0.0' },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });
}

function memorySession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: 'MCP test',
    createdAt: 1,
    updatedAt: 1,
    lastAccessedAt: 1,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    immutable: false,
    state: createInitialSessionState(),
    ...overrides,
  };
}

class MemorySessionAdapter implements McpSessionAdapter {
  readonly stored = new Map<string, Session>([[SESSION_ID, memorySession(SESSION_ID)]]);
  /** Records every create the idempotency layer let through. */
  readonly createdKeys = new Map<string, string>();
  private nextId = 1;

  /** The session the rhythm-slice tests operate on. */
  get session(): Session {
    return this.stored.get(SESSION_ID)!;
  }

  /** Offset past SESSION_ID so a minted session never shadows the fixture. */
  private mintId(): string {
    return `00000000-0000-4000-8000-${String(1000 + this.nextId++).padStart(12, '0')}`;
  }

  private read(sessionId: string): Session {
    const session = this.stored.get(sessionId);
    if (!session) throw new Error('Session not found');
    return session;
  }

  async getSession(sessionId: string): Promise<Session> {
    return structuredClone(this.read(sessionId));
  }

  async editSession(sessionId: string, edit: McpSessionEdit): Promise<Session> {
    const session = this.read(sessionId);
    const updated = { ...session, state: applyMcpSessionEdit(session.state, edit).state };
    this.stored.set(sessionId, updated);
    return structuredClone(updated);
  }

  async createSession({ name, tempo, idempotencyKey }: McpCreateSessionOptions): Promise<Session> {
    const replayed = this.createdKeys.get(idempotencyKey);
    if (replayed) return structuredClone(this.read(replayed));

    const id = this.mintId();
    const session = memorySession(id, {
      name: name ?? null,
      state: createInitialSessionState(tempo === undefined ? {} : { tempo }),
    });
    this.stored.set(id, session);
    this.createdKeys.set(idempotencyKey, id);
    return structuredClone(session);
  }

  async remixSession(sessionId: string): Promise<Session> {
    const source = this.read(sessionId);
    const id = this.mintId();
    const remix = memorySession(id, {
      name: null,
      remixedFrom: sessionId,
      immutable: false,
      state: structuredClone(source.state),
    });
    this.stored.set(sessionId, { ...source, remixCount: source.remixCount + 1 });
    this.stored.set(id, remix);
    return structuredClone(remix);
  }

  async publishSession(sessionId: string): Promise<Session> {
    const source = this.read(sessionId);
    if (source.immutable) {
      // Mirrors the described error the Durable Object adapter raises.
      throw new McpSessionEditError(
        'This session is already published. Remix it first to get an editable copy.',
        'ALREADY_PUBLISHED',
        409
      );
    }
    const id = this.mintId();
    const published = memorySession(id, {
      name: source.name,
      remixedFrom: sessionId,
      immutable: true,
      state: structuredClone(source.state),
    });
    this.stored.set(id, published);
    return structuredClone(published);
  }
}

/**
 * An adapter whose every method fails the same way, for the tests that assert
 * nothing reaches storage or that internals never escape.
 */
function failingAdapter(fail: () => never): McpSessionAdapter {
  return {
    getSession: async () => fail(),
    editSession: async () => fail(),
    createSession: async () => fail(),
    remixSession: async () => fail(),
    publishSession: async () => fail(),
  };
}

describe('stateless MCP endpoint', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  async function connectClient(
    sessions: McpSessionAdapter,
    observed: Array<{ request: Request; response: Response }>
  ): Promise<Client> {
    const handler = createKeyboardiaMcpHandler(sessions);
    const transport = new StreamableHTTPClientTransport(
      new URL('https://keyboardia.test/mcp'),
      {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const response = await handler.fetch(request);
          observed.push({ request, response: response.clone() });
          return response;
        },
      }
    );
    const client = new Client(
      { name: 'keyboardia-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  it('negotiates the 2026-07-28 protocol and exposes only the rhythm slice', async () => {
    const observed: Array<{ request: Request; response: Response }> = [];
    const client = await connectClient(new MemorySessionAdapter(), observed);
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'get_session',
      'edit_session',
      'create_session',
      'remix_session',
      'publish_session',
      'export_midi',
      'analyze_session',
    ]);
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();
    expect(JSON.stringify(listed.tools.find((tool) => tool.name === 'edit_session')?.inputSchema))
      .toContain('"kick"');
    expect(JSON.stringify(listed.tools.find((tool) => tool.name === 'edit_session')?.inputSchema))
      .toContain('Zero-based step index');
    expect(listed.tools.find((tool) => tool.name === 'edit_session')?.annotations)
      .toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(listed.tools.find((tool) => tool.name === 'publish_session')?.annotations)
      .toMatchObject({ readOnlyHint: false, idempotentHint: false, openWorldHint: true });
    expect(client.getInstructions()).toContain('Read an existing session with get_session');
    expect(client.getInstructions()).toContain('Only publish when the user explicitly asks');
    expect(listed.ttlMs).toBeTypeOf('number');
    expect(listed.cacheScope).toBeDefined();
    expect(observed.some(({ request }) =>
      request.headers.get('MCP-Protocol-Version') === '2026-07-28'
    )).toBe(true);
    expect(observed.every(({ request }) =>
      request.headers.get('Authorization') === null
    )).toBe(true);
    expect(observed.every(({ response }) =>
      response.headers.get('Mcp-Session-Id') === null
    )).toBe(true);
  });

  it('requires Mcp-Method on modern requests', async () => {
    const handler = createKeyboardiaMcpHandler(new MemorySessionAdapter());
    const response = await handler.fetch(modernRequest('server/discover', {
      methodHeader: null,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32020 },
      id: 'raw-modern-request',
    });
  });

  it('rejects modern header/body disagreements', async () => {
    const handler = createKeyboardiaMcpHandler(new MemorySessionAdapter());
    const response = await handler.fetch(modernRequest('server/discover', {
      methodHeader: 'tools/list',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32020 },
      id: 'raw-modern-request',
    });
  });

  it('rejects an unsupported modern protocol revision', async () => {
    const handler = createKeyboardiaMcpHandler(new MemorySessionAdapter());
    const response = await handler.fetch(modernRequest('server/discover', {
      protocolVersion: '2099-01-01',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      error: {
        code: -32022,
        data: { supported: [PROTOCOL_VERSION], requested: '2099-01-01' },
      },
      id: 'raw-modern-request',
    });
  });

  it('returns JSON-RPC Method not found for an unknown modern method', async () => {
    const handler = createKeyboardiaMcpHandler(new MemorySessionAdapter());
    const response = await handler.fetch(modernRequest('keyboardia/unknown'));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32601 },
      id: 'raw-modern-request',
    });
  });

  it('keeps the documented v1 tool surface synchronized with tools/list', async () => {
    const client = await connectClient(new MemorySessionAdapter(), []);
    const listed = await client.listTools();
    const specification = readFileSync(
      new URL('../../../specs/STATELESS-MCP.md', import.meta.url),
      'utf8'
    );
    const toolSurface = specification
      .split('## 4. Tool surface')[1]
      ?.split('## 5. Collaboration semantics')[0];

    expect(toolSurface).toBeTypeOf('string');
    const documentedTools = Array.from(
      toolSurface!.matchAll(/^### `([^`]+)`$/gm),
      ([, name]) => name
    );
    const documentedEdits = Array.from(
      toolSurface!.matchAll(/^#### `([^`]+)`$/gm),
      ([, name]) => name
    );
    const editToolSchema = listed.tools.find(({ name }) => name === 'edit_session')
      ?.inputSchema;
    const implementedEdits = new Set<string>();
    const collectOperationLiterals = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collectOperationLiterals);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const properties = record.properties as Record<string, unknown> | undefined;
      const operation = properties?.operation as Record<string, unknown> | undefined;
      if (typeof operation?.const === 'string') {
        implementedEdits.add(operation.const);
      }
      Object.values(record).forEach(collectOperationLiterals);
    };
    collectOperationLiterals(editToolSchema);

    expect(documentedTools).toEqual(listed.tools.map(({ name }) => name));
    expect(documentedEdits).toEqual(Array.from(implementedEdits));
  });

  it('rejects a malformed session handle at the MCP boundary', async () => {
    let storeCalls = 0;
    const sessions = failingAdapter(() => {
      storeCalls += 1;
      throw new Error('invalid input reached the session adapter');
    });
    const client = await connectClient(sessions, []);

    const result = await client.callTool({
      name: 'get_session',
      arguments: { session_id: 'not-a-session-id' },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: 'text',
      text: 'Input validation error: Invalid arguments for tool get_session: session_id: Invalid UUID',
    }]);
    expect(storeCalls).toBe(0);
  });

  it('reports an unexpected failure without handing its internals to the agent', async () => {
    const secret = 'ECONNREFUSED sqlite:///var/keyboardia/internal.db line 412';
    const sessions = failingAdapter(() => {
      throw new Error(secret);
    });
    const client = await connectClient(sessions, []);

    const result = await client.callTool({
      name: 'get_session',
      arguments: { session_id: SESSION_ID },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: 'text',
      text: JSON.stringify({
        error: 'Keyboardia could not complete this request.',
        code: 'INTERNAL_ERROR',
      }),
    }]);
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });

  it('rejects a track ID that could collide with a browser supersession key', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    const result = await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: { operation: 'add_track', track_id: 'kick-1:3', sample_id: 'kick' },
      },
    });

    expect(result.isError).toBe(true);
    expect(sessions.session.state.tracks).toHaveLength(0);
  });

  it('rejects an instrument outside the catalog before the session adapter runs', async () => {
    let storeCalls = 0;
    const sessions: McpSessionAdapter = {
      async getSession() {
        storeCalls += 1;
        throw new Error('invalid input reached the session adapter');
      },
      async editSession() {
        storeCalls += 1;
        throw new Error('invalid input reached the session adapter');
      },
    };
    const client = await connectClient(sessions, []);

    const result = await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: {
          operation: 'set_track_instrument',
          track_id: 'kick-1',
          sample_id: 'not-an-instrument',
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(storeCalls).toBe(0);
  });

  it('changes a track instrument without touching its pattern or name', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: {
          operation: 'add_track',
          track_id: 'lead-1',
          sample_id: 'kick',
          name: 'Ada Lead',
        },
      },
    });
    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: {
          operation: 'set_steps',
          track_id: 'lead-1',
          changes: [{ step: 2, value: true }, { step: 10, value: true }],
        },
      },
    });

    const result = await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: {
          operation: 'set_track_instrument',
          track_id: 'lead-1',
          sample_id: 'tone:fm-bell',
        },
      },
    });

    expect(result.structuredContent).toEqual({
      session_id: SESSION_ID,
      immutable: false,
      tempo: 120,
      tracks: [{
        track_id: 'lead-1',
        name: 'Ada Lead',
        sample_id: 'tone:fm-bell',
        step_count: 16,
        active_steps: [2, 10],
      }],
    });
  });

  it('lets two agents mutate and read the same session without replacing it', async () => {
    const sessions = new MemorySessionAdapter();
    const agentA = await connectClient(sessions, []);
    const agentB = await connectClient(sessions, []);

    await agentA.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: {
          operation: 'add_track',
          track_id: 'kick-agent-a',
          sample_id: 'kick',
        },
      },
    });

    await agentB.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
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

    await agentA.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: { operation: 'set_tempo', tempo: 124 },
      },
    });

    const result = await agentB.callTool({
      name: 'get_session',
      arguments: { session_id: SESSION_ID },
    });

    expect(result.structuredContent).toEqual({
      session_id: SESSION_ID,
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
  });

  // ==========================================================================
  // Session lifecycle tools
  // ==========================================================================

  const IDEMPOTENCY_KEY = '3f1b8a1e-1f5a-4c1d-9a2b-7e0d5c9a4b21';

  function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
    return result.structuredContent as Record<string, unknown>;
  }

  it('creates an editable session and returns a clickable URL', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    const created = structured(await client.callTool({
      name: 'create_session',
      arguments: { idempotency_key: IDEMPOTENCY_KEY, name: 'House sketch', tempo: 124 },
    }));

    expect(created.immutable).toBe(false);
    expect(created.name).toBe('House sketch');
    expect(created.tempo).toBe(124);
    expect(created.tracks).toEqual([]);
    expect(created.url).toBe(`https://keyboardia.dev/s/${created.session_id}`);

    // The URL opens the session that was actually created.
    const read = structured(await client.callTool({
      name: 'get_session',
      arguments: { session_id: created.session_id },
    }));
    expect(read.session_id).toBe(created.session_id);
  });

  it('returns the same session when a create is retried with one key', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);
    const args = { idempotency_key: IDEMPOTENCY_KEY, name: 'House sketch' };

    const first = structured(await client.callTool({ name: 'create_session', arguments: args }));
    const retry = structured(await client.callTool({ name: 'create_session', arguments: args }));

    expect(retry.session_id).toBe(first.session_id);
    expect(sessions.createdKeys.size).toBe(1);
    // The starting session plus exactly one creation.
    expect(sessions.stored.size).toBe(2);
  });

  it('creates separate sessions for separate keys', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    const first = structured(await client.callTool({
      name: 'create_session',
      arguments: { idempotency_key: IDEMPOTENCY_KEY },
    }));
    const second = structured(await client.callTool({
      name: 'create_session',
      arguments: { idempotency_key: '9c2f0a77-0b3d-4a51-9f10-2c8f7b6d4e33' },
    }));

    expect(second.session_id).not.toBe(first.session_id);
  });

  it('rejects a guessable idempotency key before it reaches storage', async () => {
    let createCalls = 0;
    const sessions = new MemorySessionAdapter();
    const counted: McpSessionAdapter = {
      ...sessions,
      getSession: (id) => sessions.getSession(id),
      editSession: (id, edit) => sessions.editSession(id, edit),
      remixSession: (id) => sessions.remixSession(id),
      publishSession: (id) => sessions.publishSession(id),
      createSession: (options: McpCreateSessionOptions) => {
        createCalls += 1;
        return sessions.createSession(options);
      },
    };
    const client = await connectClient(counted, []);

    const result = await client.callTool({
      name: 'create_session',
      arguments: { idempotency_key: 'house-beat' },
    });

    expect(result.isError).toBe(true);
    expect(createCalls).toBe(0);
  });

  it('remixes published work into an editable session without touching the source', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: { operation: 'add_track', track_id: 'kick', sample_id: 'kick' },
      },
    });
    const published = structured(await client.callTool({
      name: 'publish_session',
      arguments: { session_id: SESSION_ID },
    }));

    const remix = structured(await client.callTool({
      name: 'remix_session',
      arguments: { session_id: published.session_id },
    }));

    expect(remix.immutable).toBe(false);
    expect(remix.remixed_from).toBe(published.session_id);
    expect(remix.source_url).toBe(`https://keyboardia.dev/s/${published.session_id}`);
    // The music came across, and the published source is unchanged.
    expect(remix.tracks).toEqual(published.tracks);
    expect(sessions.stored.get(published.session_id as string)?.immutable).toBe(true);

    // Editing the remix does not reach back into the published source.
    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: remix.session_id,
        edit: { operation: 'set_tempo', tempo: 140 },
      },
    });
    expect(sessions.stored.get(published.session_id as string)?.state.tempo).toBe(120);
  });

  it('publishes a snapshot while the source stays editable', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    const published = structured(await client.callTool({
      name: 'publish_session',
      arguments: { session_id: SESSION_ID },
    }));

    expect(published.immutable).toBe(true);
    expect(published.session_id).not.toBe(SESSION_ID);
    expect(published.source_session_id).toBe(SESSION_ID);
    expect(published.source_url).toBe(`https://keyboardia.dev/s/${SESSION_ID}`);
    expect(sessions.stored.get(SESSION_ID)?.immutable).toBe(false);
  });

  it('refuses to publish an already-published session', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    const published = structured(await client.callTool({
      name: 'publish_session',
      arguments: { session_id: SESSION_ID },
    }));
    const again = await client.callTool({
      name: 'publish_session',
      arguments: { session_id: published.session_id },
    });

    expect(again.isError).toBe(true);
    expect(again.content).toEqual([{
      type: 'text',
      text: JSON.stringify({
        error: 'This session is already published. Remix it first to get an editable copy.',
        code: 'ALREADY_PUBLISHED',
      }),
    }]);
  });

  it('exports MIDI without modifying the session', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: { operation: 'add_track', track_id: 'kick', sample_id: 'kick' },
      },
    });
    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: {
          operation: 'set_steps',
          track_id: 'kick',
          changes: [{ step: 0, value: true }, { step: 8, value: true }],
        },
      },
    });
    const before = structuredClone(sessions.stored.get(SESSION_ID));

    const exported = structured(await client.callTool({
      name: 'export_midi',
      arguments: { session_id: SESSION_ID },
    }));

    expect(exported.mime_type).toBe('audio/midi');
    expect(exported.encoding).toBe('base64');
    expect(exported.exported_track_ids).toEqual(['kick']);
    expect(Buffer.from(exported.data as string, 'base64').subarray(0, 4).toString('ascii'))
      .toBe('MThd');
    expect(sessions.stored.get(SESSION_ID)).toEqual(before);
  });

  it('reports what a MIDI file cannot carry rather than approximating it', async () => {
    const sessions = new MemorySessionAdapter();
    const source = sessions.stored.get(SESSION_ID)!;
    sessions.stored.set(SESSION_ID, {
      ...source,
      state: {
        ...source.state,
        loopRegion: { start: 0, end: 8 },
        tracks: [{
          id: 'saw',
          name: 'Supersaw',
          sampleId: 'advanced:supersaw',
          steps: Array.from({ length: 16 }, (_, step) => step === 0),
          parameterLocks: Array.from({ length: 16 }, () => null),
          volume: 0.5,
          muted: false,
          soloed: false,
          transpose: 0,
          stepCount: 16,
        }],
      },
    });
    const client = await connectClient(sessions, []);

    const exported = structured(await client.callTool({
      name: 'export_midi',
      arguments: { session_id: SESSION_ID },
    }));

    const reported = (exported.unsupported as Array<{ feature: string }>).map((entry) => entry.feature);
    expect(reported).toContain('track_volume');
    expect(reported).toContain('instrument_program');
    expect(reported).toContain('loop_region');
  });

  it('explains the music without changing it', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: { operation: 'add_track', track_id: 'kick', sample_id: 'kick' },
      },
    });
    await client.callTool({
      name: 'edit_session',
      arguments: {
        session_id: SESSION_ID,
        edit: {
          operation: 'set_steps',
          track_id: 'kick',
          changes: [0, 4, 8, 12].map((step) => ({ step, value: true })),
        },
      },
    });
    const before = structuredClone(sessions.stored.get(SESSION_ID));

    const analysis = structured(await client.callTool({
      name: 'analyze_session',
      arguments: { session_id: SESSION_ID },
    }));

    expect(analysis.tempo).toBe(120);
    expect(analysis.pattern_steps).toBe(16);
    expect(analysis.polyrhythm).toBe(false);
    expect(analysis.rhythm).toMatchObject([{
      track_id: 'kick',
      role: 'drum',
      onsets: [0, 4, 8, 12],
      starts_on_downbeat: true,
      on_beat_ratio: 1,
    }]);
    // Drums only, so there is no key to report and the result says so.
    expect(analysis.inferred_keys).toEqual([]);
    expect(analysis.caveats).toContain(
      'No audible pitched tracks, so there is no key or harmony to report.'
    );
    expect(sessions.stored.get(SESSION_ID)).toEqual(before);
  });

  it('advertises analysis as read-only so an agent knows it is safe', async () => {
    const client = await connectClient(new MemorySessionAdapter(), []);
    const listed = await client.listTools();

    expect(listed.tools.find((tool) => tool.name === 'analyze_session')?.annotations)
      .toMatchObject({ readOnlyHint: true, idempotentHint: true });
  });

  it('refuses to export a session with nothing audible', async () => {
    const sessions = new MemorySessionAdapter();
    const client = await connectClient(sessions, []);

    const result = await client.callTool({
      name: 'export_midi',
      arguments: { session_id: SESSION_ID },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: 'text',
      text: JSON.stringify({
        error: 'This session has no audible notes to export.',
        code: 'NOTHING_TO_EXPORT',
      }),
    }]);
  });
});
