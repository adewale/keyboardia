import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../shared/state-mutations';
import type { Session } from '../shared/state';
import { createKeyboardiaMcpHandler, type McpSessionAdapter } from './mcp';
import { guardMcpRequest, isJsonContentType } from './mcp-guard';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

function mcpRequest(init: RequestInit = {}): Request {
  return new Request('https://keyboardia.dev/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('isJsonContentType', () => {
  it('accepts application/json with parameters', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('  APPLICATION/JSON  ')).toBe(true);
  });

  it('rejects near-misses and absent types', () => {
    expect(isJsonContentType(null)).toBe(false);
    expect(isJsonContentType('')).toBe(false);
    expect(isJsonContentType('application/jsonl')).toBe(false);
    expect(isJsonContentType('text/json')).toBe(false);
    expect(isJsonContentType('application/x-www-form-urlencoded')).toBe(false);
  });
});

describe('guardMcpRequest', () => {
  it('lets a well-formed POST through', () => {
    expect(guardMcpRequest(mcpRequest())).toBeNull();
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('rejects %s with 405 and Allow', (method) => {
    const response = guardMcpRequest(mcpRequest({ method }))!;

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('rejects an oversized declared body before parsing it', async () => {
    const response = guardMcpRequest(mcpRequest({
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024) },
    }))!;

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects a non-JSON content type', async () => {
    const response = guardMcpRequest(mcpRequest({
      headers: { 'Content-Type': 'text/plain' },
    }))!;

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('rejects a POST with no content type at all', () => {
    const request = new Request('https://keyboardia.dev/mcp', { method: 'POST', body: '{}' });
    request.headers.delete('Content-Type');

    expect(guardMcpRequest(request)?.status).toBe(415);
  });

  it('reports failures as JSON an agent can read, never HTML', async () => {
    const response = guardMcpRequest(mcpRequest({ method: 'GET' }))!;

    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toEqual({
      error: 'The Keyboardia MCP endpoint only accepts POST.',
      code: 'METHOD_NOT_ALLOWED',
    });
  });
});

describe('the guard and a real MCP client', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  /**
   * The guard is worthless if it rejects the SDK's own traffic. This drives a
   * real client through it, so every request the transport makes — handshake
   * included — has to satisfy the guard before reaching the handler.
   */
  it('does not reject anything the official client sends', async () => {
    const session: Session = {
      id: SESSION_ID,
      name: 'guard test',
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      remixedFrom: null,
      remixedFromName: null,
      remixCount: 0,
      immutable: false,
      state: createInitialState(),
    };
    const sessions = {
      getSession: async () => structuredClone(session),
      editSession: async () => structuredClone(session),
      createSession: async () => structuredClone(session),
      remixSession: async () => structuredClone(session),
      publishSession: async () => structuredClone(session),
    } satisfies McpSessionAdapter;

    const handler = createKeyboardiaMcpHandler(sessions, 'https://keyboardia.dev');
    const guardRejections: Array<{ method: string; status: number }> = [];
    const transport = new StreamableHTTPClientTransport(
      new URL('https://keyboardia.dev/mcp'),
      {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const rejected = guardMcpRequest(request.clone());
          if (rejected) {
            guardRejections.push({ method: request.method, status: rejected.status });
            return rejected;
          }
          return handler.fetch(request);
        },
      }
    );
    const client = new Client(
      { name: 'keyboardia-guard-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    await client.connect(transport);
    clients.push(client);

    const listed = await client.listTools();
    const read = await client.callTool({
      name: 'get_session',
      arguments: { session_id: SESSION_ID },
    });

    expect(guardRejections).toEqual([]);
    expect(listed.tools.length).toBeGreaterThan(0);
    expect(read.isError).toBeFalsy();
  });
});
