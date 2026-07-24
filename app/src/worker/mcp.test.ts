import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../shared/state-mutations';
import type { Session } from '../shared/state';
import { applyMcpRhythmEdit, type McpRhythmEdit } from './mcp-domain';
import {
  createKeyboardiaMcpHandler,
  type McpSessionStore,
} from './mcp';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

class MemorySessionStore implements McpSessionStore {
  session: Session = {
    id: SESSION_ID,
    name: 'MCP test',
    createdAt: 1,
    updatedAt: 1,
    lastAccessedAt: 1,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    immutable: false,
    state: createInitialState(),
  };

  async getSession(sessionId: string): Promise<Session> {
    if (sessionId !== this.session.id) throw new Error('Session not found');
    return structuredClone(this.session);
  }

  async editSession(sessionId: string, edit: McpRhythmEdit): Promise<Session> {
    if (sessionId !== this.session.id) throw new Error('Session not found');
    this.session = {
      ...this.session,
      state: applyMcpRhythmEdit(this.session.state, edit).state,
    };
    return structuredClone(this.session);
  }
}

describe('stateless MCP endpoint', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  async function connectClient(
    store: McpSessionStore,
    observed: Array<{ request: Request; response: Response }>
  ): Promise<Client> {
    const handler = createKeyboardiaMcpHandler(store);
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
    const client = await connectClient(new MemorySessionStore(), observed);
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'get_session',
      'edit_session',
    ]);
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();
    expect(JSON.stringify(listed.tools.find((tool) => tool.name === 'edit_session')?.inputSchema))
      .toContain('"kick"');
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

  it('keeps the documented v1 tool surface synchronized with tools/list', async () => {
    const client = await connectClient(new MemorySessionStore(), []);
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
    const store: McpSessionStore = {
      async getSession() {
        storeCalls += 1;
        throw new Error('invalid input reached the store');
      },
      async editSession() {
        storeCalls += 1;
        throw new Error('invalid input reached the store');
      },
    };
    const client = await connectClient(store, []);

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

  it('lets two agents mutate and read the same session without replacing it', async () => {
    const store = new MemorySessionStore();
    const agentA = await connectClient(store, []);
    const agentB = await connectClient(store, []);

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
});
