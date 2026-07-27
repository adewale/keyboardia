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
  it('lets a well-formed POST through', async () => {
    const guarded = await guardMcpRequest(mcpRequest({ body: '{"jsonrpc":"2.0"}' }));

    expect(guarded).toBeInstanceOf(Request);
    expect(await (guarded as Request).text()).toBe('{"jsonrpc":"2.0"}');
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('rejects %s with 405 and Allow', async (method) => {
    const response = await guardMcpRequest(mcpRequest({ method })) as Response;

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('rejects an oversized declared body before parsing it', async () => {
    const response = await guardMcpRequest(mcpRequest({
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024) },
    })) as Response;

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects a non-JSON content type', async () => {
    const response = await guardMcpRequest(mcpRequest({
      headers: { 'Content-Type': 'text/plain' },
    })) as Response;

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('rejects a POST with no content type at all', async () => {
    const request = new Request('https://keyboardia.dev/mcp', { method: 'POST', body: '{}' });
    request.headers.delete('Content-Type');

    expect((await guardMcpRequest(request) as Response).status).toBe(415);
  });

  it('rejects oversized bytes when Content-Length is absent', async () => {
    const request = mcpRequest({ body: 'x'.repeat(64 * 1024 + 1) });
    request.headers.delete('Content-Length');

    const response = await guardMcpRequest(request) as Response;
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('cancels a chunked body as soon as its measured bytes exceed the limit', async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls <= 2) controller.enqueue(new Uint8Array(32 * 1024 + 1));
        else controller.enqueue(new Uint8Array(32 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = mcpRequest({ body, duplex: 'half' } as RequestInit);
    request.headers.delete('Content-Length');

    const response = await guardMcpRequest(request) as Response;

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });

  it('reports failures as JSON an agent can read, never HTML', async () => {
    const response = await guardMcpRequest(mcpRequest({ method: 'GET' })) as Response;

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
          const guarded = await guardMcpRequest(request.clone());
          if (guarded instanceof Response) {
            guardRejections.push({ method: request.method, status: guarded.status });
            return guarded;
          }
          return handler.fetch(guarded);
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
