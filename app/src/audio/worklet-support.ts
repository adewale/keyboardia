/**
 * AudioWorklet feature detection and module loading utilities.
 *
 * Provides safe detection and graceful fallback for browsers
 * that don't support AudioWorklet.
 */

import { logger } from '../utils/logger';

/**
 * Check if the given AudioContext supports AudioWorklet.
 */
export function supportsAudioWorklet(ctx: AudioContext): boolean {
  return typeof ctx.audioWorklet?.addModule === 'function';
}

/**
 * Feature flag: set VITE_WORKLET_SCHEDULER=true to enable worklet scheduler.
 * Defaults to false (main-thread scheduler) for safety.
 */
export function isWorkletSchedulerEnabled(): boolean {
  try {
    return import.meta.env.VITE_WORKLET_SCHEDULER === 'true';
  } catch {
    return false;
  }
}

/**
 * Load an AudioWorklet module with error handling.
 * Returns true if loaded successfully, false otherwise.
 */
export async function loadWorkletModule(
  ctx: AudioContext,
  moduleUrl: URL | string,
  moduleName: string
): Promise<boolean> {
  if (!supportsAudioWorklet(ctx)) {
    logger.audio.warn(`AudioWorklet not supported, skipping ${moduleName}`);
    return false;
  }

  try {
    await ctx.audioWorklet.addModule(moduleUrl);
    logger.audio.log(`Loaded worklet module: ${moduleName}`);
    return true;
  } catch (err) {
    logger.audio.error(`Failed to load worklet module ${moduleName}:`, err);
    return false;
  }
}
