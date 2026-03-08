/**
 * Common interface for both main-thread and worklet scheduler implementations.
 *
 * The AudioEngine and playback controls interact with this interface,
 * unaware of which implementation is active underneath.
 *
 * NOTE: WorkletTrack, WorkletPLock, and WorkletSchedulerState are duplicated
 * in worklets/scheduler.worklet.ts because worklets can't import external
 * modules. Keep both files in sync.
 */

import type { GridState } from '../types';

export interface IScheduler {
  /**
   * Set callback for step change events (drives playhead UI).
   */
  setOnStepChange(callback: (step: number) => void): void;

  /**
   * Set callback for beat events (every 4 steps = quarter note).
   * Used for metronome pulse visual feedback.
   */
  setOnBeat(callback: (beat: number) => void): void;

  /**
   * Enable multiplayer mode with server clock sync.
   */
  setMultiplayerMode(enabled: boolean, getServerTime?: () => number): void;

  /**
   * Start playback.
   * @param getState - Function to get current grid state
   * @param serverStartTime - For multiplayer: server timestamp when playback started
   */
  start(getState: () => GridState, serverStartTime?: number): void;

  /**
   * Stop playback and clean up.
   */
  stop(): void;

  /**
   * Get the current step index.
   */
  getCurrentStep(): number;

  /**
   * Check if the scheduler is currently running.
   */
  isPlaying(): boolean;
}

/**
 * Serializable state sent to the scheduler worklet.
 * Mirrors GridState but only includes fields the worklet needs,
 * and ensures everything is serializable (no functions, no AudioNodes).
 */
export interface WorkletSchedulerState {
  tempo: number;
  swing: number;
  tracks: WorkletTrack[];
  loopRegion: { start: number; end: number } | null;
  maxSteps: number;
  defaultStepCount: number;
}

export interface WorkletTrack {
  id: string;
  sampleId: string;
  steps: boolean[];
  stepCount: number;
  muted: boolean;
  soloed: boolean;
  transpose: number;
  swing: number;
  volume: number;
  parameterLocks: (WorkletPLock | null)[];
}

export interface WorkletPLock {
  pitch?: number;
  volume?: number;
  tie?: boolean;
}
