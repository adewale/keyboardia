/**
 * Playback State Debugging Module
 *
 * PURPOSE: Debug why "playing" logs continue after stop is pressed.
 *
 * This module provides instrumentation, assertions, and invariants
 * to diagnose playback state issues WITHOUT modifying implementation code.
 *
 * Enable in browser console: window.__AUDIO_DEBUG__ = true
 * View state: window.__getPlaybackState__()
 * View trace: window.__getPlaybackTrace__()
 *
 * Key diagnostic questions:
 * 1. Is the scheduler singleton being respected?
 * 2. Is isRunning properly set to false on stop?
 * 3. Are there pending timers that weren't cleared?
 * 4. Is there a race condition between stop and scheduleLoop?
 */

import { logger } from '../utils/logger';

// Debug configuration
declare global {
  interface Window {
    __AUDIO_DEBUG__: boolean;
    __getPlaybackState__: () => PlaybackStateSnapshot;
    __getPlaybackTrace__: () => TraceEntry[];
    __clearPlaybackTrace__: () => void;
    __assertPlaybackStopped__: () => void;
  }
}

/**
 * Snapshot of playback state for debugging.
 */
export interface PlaybackStateSnapshot {
  timestamp: number;
  schedulerIsRunning: boolean;
  schedulerCurrentStep: number;
  schedulerTimerId: number | null;
  pendingTimersCount: number;
  audioContextState: string;
  audioContextTime: number;
}

/**
 * Trace entry for tracking state transitions.
 */
export interface TraceEntry {
  timestamp: number;
  audioTime: number;
  event: string;
  details: Record<string, unknown>;
  stack?: string;
}

// Internal state
const trace: TraceEntry[] = [];
const MAX_TRACE_ENTRIES = 1000;

// Scheduler instance tracking (for singleton verification)
// Use a global symbol to persist across HMR reloads for accurate tracking
const SCHEDULER_TRACKING_KEY = '__keyboardia_scheduler_tracking__';

interface SchedulerTracking {
  instances: WeakSet<object>;
  count: number;
  lastResetTime: number;
}

function getSchedulerTracking(): SchedulerTracking {
  if (typeof window === 'undefined') {
    return { instances: new WeakSet(), count: 0, lastResetTime: Date.now() };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any)[SCHEDULER_TRACKING_KEY]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[SCHEDULER_TRACKING_KEY] = {
      instances: new WeakSet<object>(),
      count: 0,
      lastResetTime: Date.now(),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any)[SCHEDULER_TRACKING_KEY];
}

/**
 * Reset scheduler tracking - call this during HMR cleanup or test setup
 */
export function resetSchedulerTracking(): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[SCHEDULER_TRACKING_KEY] = {
    instances: new WeakSet<object>(),
    count: 0,
    lastResetTime: Date.now(),
  };
  logger.audio.log('[DEBUG] Scheduler tracking reset');
}

/**
 * Check if debug mode is enabled.
 */
function isDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.__AUDIO_DEBUG__ === true;
}

/**
 * Add a trace entry.
 */
function addTrace(
  event: string,
  details: Record<string, unknown>,
  captureStack = false
): void {
  if (!isDebugEnabled()) return;

  const entry: TraceEntry = {
    timestamp: Date.now(),
    audioTime: getAudioContextTime(),
    event,
    details,
  };

  if (captureStack) {
    entry.stack = new Error().stack;
  }

  trace.push(entry);

  // Keep trace bounded
  if (trace.length > MAX_TRACE_ENTRIES) {
    trace.shift();
  }

  // Log to console in debug mode
  logger.audio.log(`[DEBUG TRACE] ${event}`, details);
}

/**
 * Get current AudioContext time (if available).
 */
function getAudioContextTime(): number {
  try {
    // Access from audioEngine global if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (window as any).__audioEngine__;
    if (engine?.audioContext) {
      return engine.audioContext.currentTime;
    }
  } catch {
    // Ignore
  }
  return -1;
}

// ============================================================================
// INSTRUMENTATION WRAPPERS
// ============================================================================

/**
 * Wrap scheduler.start() to track state transition.
 */
export function instrumentSchedulerStart(
  scheduler: {
    isPlaying: () => boolean;
    getCurrentStep: () => number;
  },
  isRunningGetter: () => boolean,
  timerId: number | null
): void {
  addTrace('scheduler.start', {
    wasRunning: isRunningGetter(),
    currentStep: scheduler.getCurrentStep(),
    timerId,
  }, true);
}

/**
 * Wrap scheduler.stop() to track state transition.
 */
export function instrumentSchedulerStop(
  scheduler: {
    isPlaying: () => boolean;
    getCurrentStep: () => number;
  },
  isRunningBefore: boolean,
  timerIdBefore: number | null,
  pendingTimersCount: number
): void {
  addTrace('scheduler.stop', {
    isRunningBefore,
    timerIdBefore,
    pendingTimersCount,
    currentStep: scheduler.getCurrentStep(),
  }, true);
}

/**
 * Track each scheduleLoop iteration.
 */
export function instrumentScheduleLoop(
  isRunning: boolean,
  currentStep: number,
  nextStepTime: number,
  currentTime: number
): void {
  if (!isDebugEnabled()) return;

  addTrace('scheduleLoop', {
    isRunning,
    currentStep,
    nextStepTime,
    currentTime,
    lookahead: nextStepTime - currentTime,
  });
}

/**
 * Track note scheduling.
 */
export function instrumentNoteSchedule(
  preset: string,
  step: number,
  time: number,
  schedulerIsRunning: boolean
): void {
  if (!isDebugEnabled()) return;

  addTrace('note.schedule', {
    preset,
    step,
    time,
    schedulerIsRunning,
  });

  // ASSERTION: Notes should only be scheduled when scheduler is running
  if (!schedulerIsRunning) {
    logger.audio.error('[DEBUG ASSERTION FAILED] Note scheduled after scheduler stopped!', {
      preset,
      step,
      time,
    });
  }
}

// ============================================================================
// SINGLETON VERIFICATION
// ============================================================================

/**
 * Register a scheduler instance for singleton tracking.
 * Call this in Scheduler constructor.
 */
export function registerSchedulerInstance(scheduler: object): void {
  const tracking = getSchedulerTracking();

  if (tracking.instances.has(scheduler)) {
    logger.audio.warn('[DEBUG] Scheduler instance already registered!');
    return;
  }

  tracking.count++;
  tracking.instances.add(scheduler);

  addTrace('scheduler.construct', {
    instanceCount: tracking.count,
  }, true);

  // ASSERTION: Should only have 1 scheduler instance
  // Note: During HMR, this will trigger because new instances are created
  // while old ones haven't been garbage collected yet. This is expected.
  // Only warn in production-like scenarios (more than 2 instances).
  if (tracking.count > 2) {
    logger.audio.error('[DEBUG ASSERTION FAILED] Multiple scheduler instances detected!', {
      count: tracking.count,
    });
  } else if (tracking.count > 1) {
    logger.audio.warn('[DEBUG] Additional scheduler instance created (likely HMR)', {
      count: tracking.count,
    });
  }
}

// ============================================================================
// STATE SNAPSHOT
// ============================================================================

/**
 * Capture current playback state snapshot.
 * This is exposed globally for console debugging.
 */
export function capturePlaybackState(
  scheduler: {
    isPlaying: () => boolean;
    getCurrentStep: () => number;
  } | null,
  pendingTimersCount: number,
  timerId: number | null
): PlaybackStateSnapshot {
  let audioContextState = 'unknown';
  let audioContextTime = -1;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (window as any).__audioEngine__;
    if (engine?.audioContext) {
      audioContextState = engine.audioContext.state;
      audioContextTime = engine.audioContext.currentTime;
    }
  } catch {
    // Ignore
  }

  return {
    timestamp: Date.now(),
    schedulerIsRunning: scheduler?.isPlaying() ?? false,
    schedulerCurrentStep: scheduler?.getCurrentStep() ?? -1,
    schedulerTimerId: timerId,
    pendingTimersCount,
    audioContextState,
    audioContextTime,
  };
}

// ============================================================================
// INVARIANTS
// ============================================================================

/**
 * Verify scheduler invariants.
 * Call periodically or on state transitions.
 */
export function verifySchedulerInvariants(
  isRunning: boolean,
  timerId: number | null,
  pendingTimersCount: number,
  getState: (() => unknown) | null
): boolean {
  let valid = true;

  // INVARIANT 1: If not running, timerId should be null
  if (!isRunning && timerId !== null) {
    logger.audio.error('[DEBUG INVARIANT VIOLATION] isRunning=false but timerId is not null!', {
      isRunning,
      timerId,
    });
    valid = false;
  }

  // INVARIANT 2: If not running, pendingTimers should be 0
  // (Note: there may be a brief window during stop() where this isn't true)
  // So we log as warning, not error
  if (!isRunning && pendingTimersCount > 0) {
    logger.audio.warn('[DEBUG INVARIANT WARNING] isRunning=false but pendingTimers remain', {
      isRunning,
      pendingTimersCount,
    });
  }

  // INVARIANT 3: If running, getState should be set
  if (isRunning && getState === null) {
    logger.audio.error('[DEBUG INVARIANT VIOLATION] isRunning=true but getState is null!', {
      isRunning,
    });
    valid = false;
  }

  return valid;
}

/**
 * Assert that playback is fully stopped.
 * Call this after stop() to verify clean shutdown.
 */
export function assertPlaybackStopped(
  isRunning: boolean,
  timerId: number | null,
  pendingTimersCount: number
): void {
  if (!isDebugEnabled()) return;

  const violations: string[] = [];

  if (isRunning) {
    violations.push('isRunning is still true');
  }

  if (timerId !== null) {
    violations.push(`timerId is still set: ${timerId}`);
  }

  if (pendingTimersCount > 0) {
    violations.push(`${pendingTimersCount} pending timers remain`);
  }

  if (violations.length > 0) {
    logger.audio.error('[DEBUG ASSERTION FAILED] Playback not fully stopped!', {
      violations,
    });
    addTrace('assert.playbackStopped.FAILED', { violations }, true);
  } else {
    logger.audio.log('[DEBUG] Playback stop verified: all state clean');
    addTrace('assert.playbackStopped.OK', {});
  }
}

// ============================================================================
// GLOBAL DEBUG INTERFACE
// ============================================================================

/**
 * Initialize debug interface on window object.
 * Call this once at startup.
 */
export function initPlaybackDebug(): void {
  if (typeof window === 'undefined') return;

  // State accessor (needs to be connected to scheduler)
  window.__getPlaybackState__ = () => {
    // Return last known state from trace
    const lastState = trace.filter(t => t.event === 'state.snapshot').pop();
    return (lastState?.details as unknown as PlaybackStateSnapshot) ?? {
      timestamp: 0,
      schedulerIsRunning: false,
      schedulerCurrentStep: -1,
      schedulerTimerId: null,
      pendingTimersCount: 0,
      audioContextState: 'unknown',
      audioContextTime: -1,
    };
  };

  window.__getPlaybackTrace__ = () => [...trace];

  window.__clearPlaybackTrace__ = () => {
    trace.length = 0;
    logger.audio.log('[DEBUG] Trace cleared');
  };

  window.__assertPlaybackStopped__ = () => {
    logger.audio.log('[DEBUG] Manual stop assertion - check trace for scheduler state');
    addTrace('manual.assertStop', {}, true);
  };

  logger.audio.log('[DEBUG] Playback debug interface initialized. Enable with: window.__AUDIO_DEBUG__ = true');
}

/**
 * Log current state snapshot.
 * Call this from scheduler methods to record state.
 */
export function logStateSnapshot(
  scheduler: {
    isPlaying: () => boolean;
    getCurrentStep: () => number;
  },
  pendingTimersCount: number,
  timerId: number | null
): void {
  if (!isDebugEnabled()) return;

  const state = capturePlaybackState(scheduler, pendingTimersCount, timerId);
  addTrace('state.snapshot', state as unknown as Record<string, unknown>);
}
