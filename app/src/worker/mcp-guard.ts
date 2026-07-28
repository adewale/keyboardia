/**
 * Pre-parse guards for the stateless MCP endpoint.
 *
 * These run in index.ts *before* `./mcp` is dynamically imported, so a
 * malformed request is rejected without evaluating the MCP SDK, zod, and the
 * schema validator — and without constructing an MCP server, fetching a
 * Durable Object, or reading KV.
 *
 * This module must never import `./mcp`, directly or transitively. Doing so
 * would pull the SDK into the main bundle and undo the dynamic import.
 */

import { MAX_MESSAGE_SIZE } from '../shared/constants';
import { isBodySizeValid } from './validation';

/** The only method the stateless endpoint serves. */
export const MCP_ALLOWED_METHODS = 'POST';

/**
 * Browser origins allowed to call the public MCP endpoint directly. CLI and
 * hosted agent clients normally omit Origin and are unaffected by this list.
 * Local ports are deliberately allowed so Vite/Playwright and wrangler ports
 * can differ without opening a non-default production origin.
 */
const MCP_ALLOWED_ORIGIN_HOSTNAMES = new Set([
  'keyboardia.dev',
  'www.keyboardia.dev',
  'staging.keyboardia.dev',
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

function parsedAllowedOrigin(request: Request): URL | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isSameWorkersPreview = hostname.endsWith('.workers.dev')
    && parsed.origin === new URL(request.url).origin;

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || (!MCP_ALLOWED_ORIGIN_HOSTNAMES.has(hostname) && !isSameWorkersPreview)
  ) {
    return null;
  }

  const isLocal = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]';
  if (!isLocal && parsed.protocol !== 'https:') return null;
  if (!isLocal && parsed.port !== '') return null;

  return parsed;
}

/**
 * MCP Streamable HTTP requires a present Origin to be validated. Missing
 * Origin is valid because non-browser clients do not send one; a malformed,
 * opaque (`null`), or unapproved browser origin is rejected before parsing.
 */
export function validateMcpOrigin(request: Request): Response | undefined {
  const origin = request.headers.get('origin');
  if (!origin) return undefined;
  if (parsedAllowedOrigin(request)) return undefined;

  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: `Invalid Origin: ${origin}`,
    },
    id: null,
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** CORS metadata for a validated browser origin. */
export function mcpCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, MCP-Method, MCP-Name',
    'Access-Control-Expose-Headers': 'MCP-Protocol-Version',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  const origin = request.headers.get('origin');
  if (origin && parsedAllowedOrigin(request)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

/**
 * The stateless transport has no SSE stream to attach to and no MCP session to
 * terminate, so GET and DELETE are as unserviceable as PUT. The SDK answers
 * them with 405 too; rejecting here just does it before the SDK is loaded.
 */
function methodNotAllowed(): Response {
  return mcpGuardResponse(
    405,
    'METHOD_NOT_ALLOWED',
    'The Keyboardia MCP endpoint only accepts POST.',
    { Allow: MCP_ALLOWED_METHODS }
  );
}

function mcpGuardResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

/**
 * `application/json; charset=utf-8` is the same media type as
 * `application/json`; `application/jsonl` is not. Compare only the type/subtype
 * so parameters are tolerated and near-misses are still rejected.
 */
export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

/**
 * Retain at most the public limit and cancel as soon as the next stream chunk
 * would exceed it. This keeps an untrusted chunked request from forcing the
 * Worker to accumulate an arbitrarily large body before it can reject it.
 */
async function readBoundedBody(request: Request): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_MESSAGE_SIZE) {
        await reader.cancel('MCP request body exceeded the byte limit').catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

/**
 * Returns a rejection Response when the request cannot be served, or a rebuilt
 * Request whose body has been measured and is safe to hand to the MCP SDK.
 * CORS headers are applied by the caller, which decorates every /mcp response
 * the same way.
 */
export async function guardMcpRequest(request: Request): Promise<Response | Request> {
  const originRejection = validateMcpOrigin(request);
  if (originRejection) return originRejection;

  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  if (!isBodySizeValid(request.headers.get('content-length'))) {
    return mcpGuardResponse(
      413,
      'PAYLOAD_TOO_LARGE',
      `Request body exceeds the ${MAX_MESSAGE_SIZE}-byte limit.`
    );
  }

  if (!isJsonContentType(request.headers.get('content-type'))) {
    return mcpGuardResponse(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json.'
    );
  }

  // Content-Length is only an early rejection hint. It can be absent or false,
  // so the bytes themselves are the authority. Rebuilding the request gives
  // the one-shot body back to the SDK without a second read from the network.
  const body = await readBoundedBody(request);
  if (!body) {
    return mcpGuardResponse(
      413,
      'PAYLOAD_TOO_LARGE',
      `Request body exceeds the ${MAX_MESSAGE_SIZE}-byte limit.`
    );
  }

  return new Request(request, { body });
}
