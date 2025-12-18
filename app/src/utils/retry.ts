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
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.25,
  maxAttempts: 3,
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

/**
 * Sleep for the calculated backoff delay.
 *
 * @param attempt - Zero-based attempt number
 * @param config - Optional configuration overrides
 * @returns Promise that resolves after the delay
 */
export function backoffSleep(
  attempt: number,
  config: RetryConfig = {}
): Promise<void> {
  const delay = calculateBackoffDelay(attempt, config);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Generic retry wrapper with exponential backoff and jitter.
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => {
 *     const res = await fetch('/api/data');
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *     return res.json();
 *   },
 *   { maxAttempts: 5, baseDelayMs: 500 }
 * );
 * ```
 *
 * @param fn - Async function to retry. Throw to trigger retry.
 * @param config - Optional configuration overrides
 * @returns Result of successful function call
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const { maxAttempts } = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't sleep after the last attempt
      if (attempt < maxAttempts - 1) {
        await backoffSleep(attempt, config);
      }
    }
  }

  throw lastError ?? new Error('Retry failed');
}

/**
 * Check if an operation should be retried based on attempt count.
 *
 * @param attempt - Current attempt number (0-based)
 * @param maxAttempts - Maximum attempts allowed
 * @returns true if more retries are available
 */
export function shouldRetry(attempt: number, maxAttempts: number = DEFAULT_CONFIG.maxAttempts): boolean {
  return attempt < maxAttempts - 1;
}
