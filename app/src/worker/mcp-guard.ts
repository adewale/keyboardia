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
 * Returns a rejection Response when the request cannot be served, or null when
 * it should continue to the MCP handler. CORS headers are applied by the
 * caller, which decorates every /mcp response the same way.
 */
export function guardMcpRequest(request: Request): Response | null {
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

  return null;
}
