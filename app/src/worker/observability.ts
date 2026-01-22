/**
 * Observability 2.0: Wide Events Module
 *
 * Implements lifecycle-based wide events per the Observability 2.0 pattern.
 * See specs/OBSERVABILITY-2-0-IMPLEMENTATION.md for full specification.
 *
 * Two event types:
 * - http_request: One per HTTP request (errors embedded)
 * - ws_session: One per WebSocket connection (errors embedded)
 *
 * Events are emitted via console.log(JSON.stringify(...)) which sends them
 * to Cloudflare Workers Logs.
 */

import type { Env, VersionMetadata } from './types';

// =============================================================================
// Common Types
// =============================================================================

/**
 * Deployment information from CF_VERSION_METADATA binding
 */
export interface DeployInfo {
  versionId: string;
  versionTag?: string;
  deployedAt: string;
}

/**
 * Infrastructure information from request.cf
 */
export interface InfraInfo {
  colo: string;
  country: string;
}

/**
 * Service identity
 */
export interface ServiceInfo {
  name: string;
  environment: string;
}

/**
 * Error context (embedded in wide events when outcome === "error")
 */
export interface ErrorInfo {
  type: string;
  message: string;
  slug: string;
  expected: boolean;
  handler?: string;
  stack?: string;
}

/**
 * Warning for recovered errors and near-misses
 */
export interface Warning {
  type: string;
  message: string;
  occurredAt: string;
  recoveryAction: 'retry_succeeded' | 'fallback_used' | 'auto_repaired' | 'degraded_response';
  attemptNumber?: number;
  totalAttempts?: number;
  latency_ms?: number;
}

// =============================================================================
// Creator Identity (for isCreator detection)
// =============================================================================

/**
 * Creator identity for detecting if a WebSocket connection is the session creator.
 * Uses IP + User-Agent hash to identify users across page refreshes.
 *
 * Per spec: More reliable than playerId because:
 * 1. playerId is generated server-side on every WebSocket connection (ephemeral)
 * 2. Page refresh = new playerId, but IP + User-Agent remains stable
 * 3. Creator identity persists across page refreshes within same browser/network
 */
export interface CreatorIdentity {
  ip: string;           // CF-Connecting-IP header
  userAgentHash: string; // SHA-256 hash of User-Agent (first 16 chars)
}

/**
 * Hash User-Agent to avoid storing raw strings.
 * Uses SHA-256, returns first 16 hex chars (sufficient for identity).
 */
export async function hashUserAgent(userAgent: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userAgent);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * Create a creator identity from a request.
 */
export async function createCreatorIdentity(request: Request): Promise<CreatorIdentity> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || '';
  const userAgentHash = await hashUserAgent(userAgent);
  return { ip, userAgentHash };
}

/**
 * Compare two creator identities for equality.
 */
export function identitiesMatch(a: CreatorIdentity, b: CreatorIdentity): boolean {
  return a.ip === b.ip && a.userAgentHash === b.userAgentHash;
}

// =============================================================================
// Event Schemas
// =============================================================================

/**
 * HTTP Request wide event - emitted once per HTTP request
 */
export interface HttpRequestEvent {
  event: 'http_request';

  // Request identity
  requestId: string;
  method: string;
  path: string;
  deviceType: 'mobile' | 'desktop';

  // Timing
  timestamp: string;
  duration_ms: number;

  // Response
  status: number;
  responseSize?: number;

  // Context
  sessionId?: string;
  playerId?: string;
  isPublished?: boolean;
  sourceSessionId?: string;

  // Classification
  routePattern: string;
  action?: string;

  // Outcome (Boris Tane pattern)
  outcome: 'ok' | 'error';

  // Error context (only if outcome === "error")
  error?: ErrorInfo;

  // Performance
  kvReads?: number;
  kvWrites?: number;
  doRequests?: number;

  // Recovered errors
  warnings?: Warning[];

  // Deployment
  deploy: DeployInfo;

  // Infrastructure
  infra: InfraInfo;

  // Service identity
  service: ServiceInfo;
}

/**
 * WebSocket Session wide event - emitted once per WebSocket connection at disconnect
 */
export interface WsSessionEvent {
  event: 'ws_session';

  // Connection identity
  connectionId: string;
  sessionId: string;
  playerId: string;
  isCreator: boolean;
  isPublished: boolean;

  // Timing
  connectedAt: string;
  disconnectedAt: string;
  duration_ms: number;

  // Message stats
  messageCount: number;
  messagesByType: Record<string, number>;

  // Collaboration context
  peakConcurrentPlayers: number;
  playersSeenCount: number;

  // Playback
  playCount: number;
  totalPlayTime_ms: number;

  // Sync health
  syncRequestCount: number;
  syncErrorCount: number;

  // Additional behavioral metrics
  hashMismatchCount?: number;      // State sync mismatches detected
  snapshotsSentCount?: number;     // Manual snapshots sent (excluding initial)
  rejectedMutationCount?: number;  // Mutations rejected (published session)
  duplicateOpsHandled?: number;    // Duplicate track/delete operations

  // Outcome (Boris Tane pattern)
  outcome: 'ok' | 'error';
  disconnectReason: 'normal_close' | 'timeout' | 'replaced' | 'error';

  // Error context (only if outcome === "error")
  error?: ErrorInfo;

  // Recovered errors
  warnings?: Warning[];

  // Deployment
  deploy: DeployInfo;

  // Infrastructure
  infra: InfraInfo;

  // Service identity
  service: ServiceInfo;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract deployment info from environment
 */
export function getDeployInfo(env: Env): DeployInfo {
  const metadata: VersionMetadata | undefined = env.CF_VERSION_METADATA;
  return {
    versionId: metadata?.id ?? 'unknown',
    versionTag: metadata?.tag,
    deployedAt: metadata?.timestamp ?? new Date().toISOString(),
  };
}

/**
 * Extract infrastructure info from request.cf
 *
 * Note: request.cf is available in Cloudflare Workers and contains
 * geographic/network information about the request.
 */
export function getInfraInfo(request: Request): InfraInfo {
  // Type assertion needed because request.cf is not in the standard Request type
  const cf = (request as Request & { cf?: { colo?: string; country?: string } }).cf;
  return {
    colo: cf?.colo ?? 'unknown',
    country: cf?.country ?? 'unknown',
  };
}

/**
 * Extract service info from environment
 */
export function getServiceInfo(env: Env): ServiceInfo {
  return {
    name: env.SERVICE_NAME ?? 'keyboardia',
    environment: env.ENVIRONMENT ?? 'production',
  };
}

/**
 * Determine device type from User-Agent
 */
export function getDeviceType(userAgent: string | null): 'mobile' | 'desktop' {
  if (!userAgent) return 'desktop';

  const mobilePatterns = [
    /android/i,
    /webos/i,
    /iphone/i,
    /ipad/i,
    /ipod/i,
    /blackberry/i,
    /windows phone/i,
    /mobile/i,
  ];

  return mobilePatterns.some(pattern => pattern.test(userAgent)) ? 'mobile' : 'desktop';
}

// =============================================================================
// Warning Collection
// =============================================================================

const MAX_WARNINGS = 10;

/**
 * Collects warnings during request/connection lifecycle
 * Limited to MAX_WARNINGS to prevent unbounded growth
 */
export class WarningCollector {
  private warnings: Warning[] = [];

  add(warning: Omit<Warning, 'occurredAt'>): void {
    if (this.warnings.length < MAX_WARNINGS) {
      this.warnings.push({
        ...warning,
        occurredAt: new Date().toISOString(),
      });
    }
  }

  get(): Warning[] {
    return this.warnings;
  }

  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }
}

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Error slug mappings for common error types
 */
const ERROR_SLUGS: Record<number, { slug: string; expected: boolean }> = {
  400: { slug: 'bad-request', expected: true },
  401: { slug: 'unauthorized', expected: true },
  403: { slug: 'forbidden', expected: true },
  404: { slug: 'not-found', expected: true },
  405: { slug: 'method-not-allowed', expected: true },
  409: { slug: 'conflict', expected: true },
  413: { slug: 'payload-too-large', expected: true },
  429: { slug: 'rate-limited', expected: true },
  500: { slug: 'internal-error', expected: false },
  502: { slug: 'bad-gateway', expected: false },
  503: { slug: 'service-unavailable', expected: false },
  504: { slug: 'gateway-timeout', expected: false },
};

/**
 * Classify an error for the ErrorInfo structure
 */
export function classifyError(
  status: number,
  error: Error | string | null,
  handler?: string,
): ErrorInfo {
  const errorInfo = ERROR_SLUGS[status] ?? { slug: 'unknown-error', expected: false };
  const errorObj = typeof error === 'string' ? new Error(error) : error;

  let stack: string | undefined;
  if (errorObj?.stack && !errorInfo.expected) {
    // Truncate stack to 500 chars for unexpected errors only
    stack = errorObj.stack.slice(0, 500);
  }

  return {
    type: errorObj?.name ?? 'Error',
    message: errorObj?.message ?? 'Unknown error',
    slug: errorInfo.slug,
    expected: errorInfo.expected,
    handler,
    stack,
  };
}

/**
 * Create a custom error classification with specific slug
 */
export function classifyCustomError(
  type: string,
  message: string,
  slug: string,
  expected: boolean,
  handler?: string,
): ErrorInfo {
  return {
    type,
    message,
    slug,
    expected,
    handler,
  };
}

// =============================================================================
// Event Emission
// =============================================================================

/**
 * Emit an HTTP request wide event to Workers Logs
 */
export function emitHttpRequestEvent(event: HttpRequestEvent): void {
  // Remove undefined fields to keep events clean
  const cleanEvent = JSON.parse(JSON.stringify(event));
  console.log(JSON.stringify(cleanEvent));
}

/**
 * Emit a WebSocket session wide event to Workers Logs
 */
export function emitWsSessionEvent(event: WsSessionEvent): void {
  // Remove undefined fields to keep events clean
  const cleanEvent = JSON.parse(JSON.stringify(event));
  console.log(JSON.stringify(cleanEvent));
}

// =============================================================================
// WebSocket Close Code Mapping
// =============================================================================

/**
 * Map WebSocket close code to disconnect reason
 */
export function mapCloseCode(code: number): 'normal_close' | 'timeout' | 'replaced' | 'error' {
  // 1000 = normal close
  if (code === 1000) return 'normal_close';

  // 1001 = going away (navigation, tab close)
  if (code === 1001) return 'normal_close';

  // 4000+ = custom application codes
  if (code >= 4000 && code < 4100) return 'replaced';

  // 1006 = abnormal close (no close frame received) - likely timeout
  if (code === 1006) return 'timeout';

  // 1011 = unexpected condition
  // 1012 = service restart
  // 1013 = try again later
  // 1014 = bad gateway
  // 1015 = TLS handshake failure
  return 'error';
}

// =============================================================================
// Performance Metrics Tracking
// =============================================================================

/**
 * Tracks KV and DO operations for a single request
 */
export interface RequestMetrics {
  kvReads: number;
  kvWrites: number;
  doRequests: number;
}

/**
 * Create a new request metrics tracker
 */
export function createRequestMetrics(): RequestMetrics {
  return {
    kvReads: 0,
    kvWrites: 0,
    doRequests: 0,
  };
}
