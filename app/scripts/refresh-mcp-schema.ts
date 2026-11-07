import { writeFile } from 'node:fs/promises';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/client';
import type { Session } from '../src/shared/state';
import {
  createKeyboardiaMcpHandler,
  type McpCreateSessionOptions,
  type McpSessionAdapter,
} from '../src/worker/mcp';
import type { McpSessionEdit } from '../src/worker/mcp-edits';

const protocolVersion = '2026-07-28';
const unavailable = async (): Promise<Session> => {
  throw new Error('Schema discovery must not access session storage.');
};
const adapter: McpSessionAdapter = {
  getSession: unavailable,
  editSession: (_sessionId: string, _edit: McpSessionEdit) => unavailable(),
  createSession: (_options: McpCreateSessionOptions) => unavailable(),
  remixSession: unavailable,
  publishSession: unavailable,
};

const handler = createKeyboardiaMcpHandler(adapter);
const response = await handler.fetch(new Request('https://keyboardia.dev/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocolVersion,
    'Mcp-Method': 'tools/list',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'schema-refresh',
    method: 'tools/list',
    params: {
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: protocolVersion,
        [CLIENT_INFO_META_KEY]: { name: 'keyboardia-schema-refresh', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  }),
}));
const payload = await response.json() as { result?: { tools?: unknown[] }; error?: unknown };
if (!response.ok || !payload.result?.tools) {
  throw new Error(`Schema discovery failed: ${response.status} ${JSON.stringify(payload.error)}`);
}

const fixture = {
  $comment: 'Exact tools/list tool definitions captured from Keyboardia\'s MCP implementation. app/src/worker/mcp.test.ts fails on any drift.',
  protocol_date: protocolVersion,
  server_url: 'https://keyboardia.dev/mcp',
  tools: payload.result.tools,
};
await writeFile(
  new URL('../../evals/fixtures/keyboardia-mcp-schema.json', import.meta.url),
  `${JSON.stringify(fixture, null, 2)}\n`,
);
