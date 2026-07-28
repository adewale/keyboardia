#!/usr/bin/env node
/**
 * Capability-neutral HTTP/MCP transport for the autonomous skill journey.
 *
 * This server knows one allowed origin. It knows no Keyboardia paths, skill
 * names, target MCP tools, schemas, or session capabilities. The agent must
 * discover all of those from bytes fetched through these tools. Every target
 * exchange is recorded before being returned to the agent.
 */
import { appendFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';

const allowedOrigin = new URL(requiredEnv('AUTONOMOUS_DISCOVERY_ORIGIN')).origin;
const tracePath = requiredEnv('AUTONOMOUS_DISCOVERY_TRACE');
const MAX_BODY_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TARGET_CALLS = 8;
const blockedTargetName = /(?:^|_)(?:publish|remix|export)(?:_|$)/i;

const fetched = new Map();
const verified = new Set();
const connections = new Map();
let nextHandle = 1;
let nextConnection = 1;
let nextSequence = 1;
let targetCalls = 0;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameOriginUrl(raw) {
  const url = new URL(raw);
  if (url.origin !== allowedOrigin) {
    throw new Error(`cross-origin request denied: ${url.origin}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`unsupported URL protocol: ${url.protocol}`);
  }
  url.hash = '';
  return url;
}

function record(phase, request, response) {
  const event = {
    sequence: nextSequence,
    request_id: `transport-${nextSequence}`,
    phase,
    request,
    response,
  };
  nextSequence += 1;
  appendFileSync(tracePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return event;
}

function ok(structuredContent) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function failure(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { error: message },
  };
}

async function audited(name, phase, request, operation) {
  try {
    const value = await operation();
    record(phase, request, { success: true, value });
    return ok(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(phase, request, { success: false, error: message });
    return failure(message);
  }
}

const server = new McpServer(
  { name: 'autonomous-discovery-transport', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.registerTool(
  'fetch_url',
  {
    title: 'Fetch exact same-origin bytes',
    description: 'Fetch an HTTP resource from the supplied site origin without following redirects. Returns exact UTF-8 response bytes and an opaque handle.',
    inputSchema: z.object({ url: z.url() }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url: rawUrl }) => audited('fetch_url', 'fetch', { url: rawUrl }, async () => {
    const url = sameOriginUrl(rawUrl);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json, text/markdown, text/plain;q=0.9' },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`redirect denied: HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) {
      throw new Error(`response exceeds ${MAX_BODY_BYTES} bytes`);
    }
    const handle = `fetch-${nextHandle++}`;
    const body = bytes.toString('utf8');
    fetched.set(handle, { url: url.href, bytes, body });
    return {
      handle,
      url: url.href,
      status: response.status,
      content_type: response.headers.get('content-type'),
      sha256: sha256(bytes),
      body,
    };
  }),
);

server.registerTool(
  'verify_sha256',
  {
    title: 'Verify fetched bytes',
    description: 'Compare the SHA-256 digest of exact bytes from fetch_url with an expected sha256:<hex> digest.',
    inputSchema: z.object({
      handle: z.string().min(1),
      expected_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/i),
    }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ handle, expected_digest }) => audited(
    'verify_sha256',
    'digest_verify',
    { handle, expected_digest },
    async () => {
      const resource = fetched.get(handle);
      if (!resource) throw new Error(`unknown fetch handle: ${handle}`);
      const actualDigest = `sha256:${sha256(resource.bytes)}`;
      if (actualDigest.toLowerCase() !== expected_digest.toLowerCase()) {
        throw new Error(`digest mismatch: expected ${expected_digest}, got ${actualDigest}`);
      }
      verified.add(handle);
      return { handle, expected_digest, actual_digest: actualDigest, matches: true };
    },
  ),
);

server.registerTool(
  'connect_mcp',
  {
    title: 'Connect to a discovered MCP endpoint',
    description: 'Initialize an MCP client at a same-origin endpoint derived from digest-verified fetched bytes.',
    inputSchema: z.object({
      endpoint_url: z.url(),
      verified_handle: z.string().min(1),
    }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ endpoint_url, verified_handle }) => audited(
    'connect_mcp',
    'mcp_initialize',
    { endpoint_url, verified_handle },
    async () => {
      if (!verified.has(verified_handle)) {
        throw new Error('MCP connection requires successfully verified bytes');
      }
      const resource = fetched.get(verified_handle);
      if (!resource) throw new Error(`unknown fetch handle: ${verified_handle}`);
      const endpoint = sameOriginUrl(endpoint_url);
      const documented = resource.body.includes(`\`${endpoint.pathname}\``) ||
        resource.body.includes(`\`${endpoint.href}\``);
      if (!documented) throw new Error('endpoint was not derived from the verified document');

      const httpTrace = [];
      const transport = new StreamableHTTPClientTransport(endpoint, {
        fetch: async (input, init) => {
          const requestUrl = sameOriginUrl(new Request(input, init).url);
          const response = await fetch(requestUrl, {
            ...init,
            redirect: 'manual',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          httpTrace.push({ url: requestUrl.href, status: response.status, success: response.ok });
          return response;
        },
      });
      const client = new Client(
        { name: 'autonomous-discovery-eval', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      );
      await client.connect(transport);
      const connectionId = `connection-${nextConnection++}`;
      connections.set(connectionId, { client, endpoint: endpoint.href, tools: null });
      return {
        connection_id: connectionId,
        endpoint_url: endpoint.href,
        server_version: client.getServerVersion(),
        http: httpTrace,
      };
    },
  ),
);

server.registerTool(
  'list_mcp_tools',
  {
    title: 'List tools on a dynamic MCP connection',
    description: 'Return the live tools/list result from a connection created by connect_mcp.',
    inputSchema: z.object({ connection_id: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ connection_id }) => audited(
    'list_mcp_tools',
    'mcp_tools_list',
    { connection_id },
    async () => {
      const connection = connections.get(connection_id);
      if (!connection) throw new Error(`unknown connection: ${connection_id}`);
      const listed = await connection.client.listTools();
      connection.tools = new Set(listed.tools.map((tool) => tool.name));
      return { connection_id, tools: listed.tools };
    },
  ),
);

server.registerTool(
  'call_mcp_tool',
  {
    title: 'Call a discovered MCP tool',
    description: 'Call a tool returned by list_mcp_tools. Publication, remixing, and export operations are denied in this disposable edit-only evaluation.',
    inputSchema: z.object({
      connection_id: z.string().min(1),
      name: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
    }).strict(),
  },
  async ({ connection_id, name, arguments: toolArguments }) => audited(
    'call_mcp_tool',
    'mcp_tool_call',
    { connection_id, name, arguments: toolArguments },
    async () => {
      const connection = connections.get(connection_id);
      if (!connection) throw new Error(`unknown connection: ${connection_id}`);
      if (!connection.tools) throw new Error('list_mcp_tools must succeed before tool calls');
      if (!connection.tools.has(name)) throw new Error(`tool was not returned by tools/list: ${name}`);
      if (blockedTargetName.test(name)) throw new Error(`tool denied by disposable-eval policy: ${name}`);
      targetCalls += 1;
      if (targetCalls > MAX_TARGET_CALLS) throw new Error(`target call limit ${MAX_TARGET_CALLS} exceeded`);
      const result = await connection.client.callTool({ name, arguments: toolArguments });
      if (result.isError === true) {
        throw new Error(`target tool returned isError: ${JSON.stringify(result).slice(0, 500)}`);
      }
      return { connection_id, name, result };
    },
  ),
);

server.registerTool(
  'random_uuid',
  {
    title: 'Generate a random UUID',
    description: 'Generate a fresh UUID for an idempotency token or other non-secret request identifier.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => audited('random_uuid', 'random_uuid', {}, async () => ({ uuid: randomUUID() })),
);

const stdio = new StdioServerTransport();
await server.connect(stdio);

async function closeConnections() {
  await Promise.allSettled([...connections.values()].map(({ client }) => client.close()));
}

process.once('SIGTERM', () => void closeConnections().finally(() => process.exit(0)));
process.once('SIGINT', () => void closeConnections().finally(() => process.exit(0)));
