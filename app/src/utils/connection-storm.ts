/**
 * Connection Storm Detection Utility
 *
 * Detects rapid WebSocket connection attempts that may indicate
 * a bug (e.g., React re-render loop) causing reconnection storms.
 *
 * Extracted from multiplayer.ts for reusability and testability.
 */

export interface ConnectionStormConfig {
  /** Time window in milliseconds to track connections (default: 10000) */
  windowMs: number;
  /** Number of connections within window to trigger storm warning (default: 5) */
  threshold: number;
}

const DEFAULT_CONFIG: ConnectionStormConfig = {
  windowMs: 10000,
  threshold: 5,
};

/**
 * Tracks WebSocket connection attempts and detects connection storms.
 *
 * A "connection storm" occurs when many connections happen in rapid succession,
 * typically indicating a bug like a React useEffect dependency issue causing
 * repeated connect/disconnect cycles.
 *
 * Usage:
 * ```typescript
 * const detector = new ConnectionStormDetector();
 *
 * function connect() {
 *   detector.recordConnection();
 *   if (detector.isStorm() && !detector.hasWarned()) {
 *     console.warn('Connection storm detected!');
 *     detector.markWarned();
 *   }
 *   // ... actual connection logic
 * }
 * ```
 */
export class ConnectionStormDetector {
  private config: ConnectionStormConfig;
  private timestamps: number[] = [];
  private warned = false;

  constructor(config?: Partial<ConnectionStormConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a new connection attempt.
   * Call this each time a WebSocket connection is initiated.
   */
  recordConnection(): void {
    const now = Date.now();
    this.timestamps.push(now);
    this.cleanup(now);
  }

  /**
   * Check if current connection rate indicates a storm.
   * Also clears the warned flag if storm has cleared.
   */
  isStorm(): boolean {
    this.cleanup(Date.now());
    const isCurrentlyStorm = this.timestamps.length >= this.config.threshold;

    // Clear warning flag when storm clears
    if (!isCurrentlyStorm) {
      this.warned = false;
    }

    return isCurrentlyStorm;
  }

  /**
   * Get the number of connections in the current window.
   */
  getConnectionCount(): number {
    this.cleanup(Date.now());
    return this.timestamps.length;
  }

  /**
   * Check if a storm warning has already been shown.
   * Use this to avoid spamming warnings.
   */
  hasWarned(): boolean {
    return this.warned;
  }

  /**
   * Mark that a storm warning has been shown.
   */
  markWarned(): void {
    this.warned = true;
  }

  /**
   * Reset all state (timestamps and warning flag).
   * Call this on intentional disconnect.
   */
  reset(): void {
    this.timestamps = [];
    this.warned = false;
  }

  /**
   * Remove timestamps outside the tracking window.
   */
  private cleanup(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.timestamps = this.timestamps.filter(t => t > cutoff);
  }
}

/**
 * Get connection storm configuration from window global (if available).
 * Allows runtime configuration for debugging in browser.
 *
 * Set window.__KEYBOARDIA_CONFIG__ = { connectionStorm: { windowMs: 5000, threshold: 3 } }
 * to customize detection sensitivity.
 */
export function getConnectionStormConfigFromWindow(): Partial<ConnectionStormConfig> {
  if (typeof window !== 'undefined') {
    const windowWithConfig = window as unknown as {
      __KEYBOARDIA_CONFIG__?: {
        connectionStorm?: Partial<ConnectionStormConfig>;
      };
    };
    if (windowWithConfig.__KEYBOARDIA_CONFIG__?.connectionStorm) {
      return windowWithConfig.__KEYBOARDIA_CONFIG__.connectionStorm;
    }
  }
  return {};
}

/**
 * Create a ConnectionStormDetector with config from window global.
 * Convenience factory for browser usage.
 */
export function createConnectionStormDetector(): ConnectionStormDetector {
  return new ConnectionStormDetector(getConnectionStormConfigFromWindow());
}
