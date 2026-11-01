/**
 * Centralized Retry Utilities
 *
 * Provides exponential backoff with jitter for all retry scenarios.
 * This prevents the "thundering herd" problem when services recover.
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 6: Reconnection Needs Jitter
 * @see https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor as decimal, e.g., 0.25 = ±25% (default: 0.25) */
  jitterFactor?: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.25,
};

/**
 * Calculate delay with exponential backoff and jitter.
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay) ± jitter
 *
 * Example with defaults (baseDelay=1000, jitter=25%):
 * - Attempt 0: 1000ms ± 250ms = 750-1250ms
 * - Attempt 1: 2000ms ± 500ms = 1500-2500ms
 * - Attempt 2: 4000ms ± 1000ms = 3000-5000ms
 * - Attempt 3: 8000ms ± 2000ms = 6000-10000ms
 * - Attempt 4: 16000ms ± 4000ms = 12000-20000ms
 * - Attempt 5+: 30000ms (capped) ± 7500ms = 22500-37500ms
 *
 * @param attempt - Zero-based attempt number (0 = first retry)
 * @param config - Optional configuration overrides
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = {}
): number {
  const { baseDelayMs, maxDelayMs, jitterFactor } = { ...DEFAULT_CONFIG, ...config };

  // Exponential backoff: baseDelay * 2^attempt, capped at maxDelay
  const exponentialDelay = Math.min(
    baseDelayMs * Math.pow(2, attempt),
    maxDelayMs
  );

  // Add jitter: random value in range [-jitterFactor, +jitterFactor]
  const jitterRange = exponentialDelay * jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(exponentialDelay + jitter);
}
