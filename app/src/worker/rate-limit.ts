/**
 * Phase 21.5: in-memory per-IP rate limiting.
 *
 * The map lives in the isolate, so limits reset when a Worker restarts and are
 * per-colo rather than global. That is accepted: this exists to keep one
 * visitor from burning the KV daily quota, not to defeat a distributed attack.
 *
 * @see specs/STATELESS-MCP.md - "Deferred hardening" for the durable
 *      replacement this mechanism is expected to grow into.
 */

import type { Env } from './types';

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window

/**
 * Per-minute, per-IP budgets. These are the *production* numbers.
 *
 * A load test that needs more raises the matching var in wrangler.jsonc; it
 * does not edit these. The session-create limit previously sat at 100 with a
 * "revert after testing" comment attached, which is how a temporary test value
 * became the shipped production limit for months.
 */
export const RATE_LIMIT_DEFAULTS = {
  // Each create is a KV write against a daily quota.
  sessionCreate: 10,
  // Each miss renders an image; edge caching means the origin sees far fewer
  // requests than a crawler makes.
  ogImage: 100,
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMIT_DEFAULTS;

const RATE_LIMIT_VARS: Record<RateLimitBucket, keyof Env> = {
  sessionCreate: 'SESSION_CREATE_RATE_LIMIT_PER_MINUTE',
  ogImage: 'OG_IMAGE_RATE_LIMIT_PER_MINUTE',
};

/**
 * An unset, empty, non-numeric, fractional, or non-positive override falls back
 * to the production default rather than silently disabling the limit.
 */
export function resolveRateLimit(env: Env, bucket: RateLimitBucket): number {
  const raw = env[RATE_LIMIT_VARS[bucket]];
  if (raw === undefined || raw === null || raw === '') {
    return RATE_LIMIT_DEFAULTS[bucket];
  }
  const configured = Number(raw);
  if (!Number.isInteger(configured) || configured < 1) {
    return RATE_LIMIT_DEFAULTS[bucket];
  }
  return configured;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/** Test seam: the map outlives a single request by design. */
export function resetRateLimits(): void {
  rateLimitMap.clear();
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/**
 * Buckets are keyed separately per limit. Sharing one counter across endpoints
 * means a burst of OG image requests can exhaust an IP's session-create budget,
 * which is an unrelated denial of service against the same visitor.
 */
export function checkRateLimit(bucket: RateLimitBucket, ip: string, max: number): RateLimitDecision {
  const now = Date.now();
  const key = `${bucket}:${ip}`;
  const entry = rateLimitMap.get(key);

  // Clean up old entries periodically (simple garbage collection)
  if (rateLimitMap.size > 10000) {
    for (const [mapKey, value] of rateLimitMap.entries()) {
      if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(mapKey);
      }
    }
  }

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Start new window
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= max) {
    const resetIn = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetIn };
  }

  entry.count++;
  const resetIn = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
  return { allowed: true, remaining: max - entry.count, resetIn };
}
