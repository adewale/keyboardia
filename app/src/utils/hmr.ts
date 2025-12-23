/**
 * HMR (Hot Module Replacement) Utilities
 *
 * This module provides helpers for safely handling HMR in modules with
 * stateful singletons that acquire external resources (event listeners,
 * timers, audio nodes, etc.).
 *
 * Without proper HMR handling, these resources leak during development:
 * - Event listeners accumulate on each hot reload
 * - Timers keep running from old module instances
 * - Audio nodes from old contexts remain connected
 *
 * @see BUG_PATTERNS['singleton-missing-hmr-cleanup'] in bug-patterns.ts
 */

import { logger } from './logger';

/**
 * Register a dispose callback for HMR cleanup.
 *
 * This function should be called at module level (not inside a class) for
 * any module that exports a singleton with external resources.
 *
 * @param moduleName - Name for logging (e.g., 'AudioEngine', 'Scheduler')
 * @param dispose - Cleanup function to call on HMR dispose
 *
 * @example
 * ```typescript
 * // At the end of engine.ts
 * export const audioEngine = new AudioEngine();
 * registerHmrDispose('AudioEngine', () => audioEngine.dispose());
 * ```
 *
 * @example
 * ```typescript
 * // For modules with custom cleanup
 * export const scheduler = new Scheduler();
 * registerHmrDispose('Scheduler', () => {
 *   scheduler.stop();
 *   resetSchedulerTracking();
 * });
 * ```
 */
export function registerHmrDispose(moduleName: string, dispose: () => void): void {
  if (import.meta.hot) {
    logger.audio.log(`[HMR] ${moduleName}: registering dispose handler`);

    import.meta.hot.dispose(() => {
      logger.audio.log(`[HMR] ${moduleName}: dispose called - cleaning up`);
      try {
        dispose();
      } catch (error) {
        logger.audio.error(`[HMR] ${moduleName}: dispose failed:`, error);
      }
    });

    // Make this module an HMR boundary so dispose is called properly.
    // Without this, parent module accepts cause re-evaluation without dispose.
    import.meta.hot.accept(() => {
      logger.audio.log(`[HMR] ${moduleName}: module accepted update`);
    });
  }
}

/**
 * Check if we're in a development environment with HMR enabled.
 * Useful for conditional logging or behavior.
 */
export function isHmrEnabled(): boolean {
  return !!import.meta.hot;
}
