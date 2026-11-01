/**
 * Common interface for both main-thread and worklet scheduler implementations.
 *
 * The AudioEngine and playback controls interact with this interface,
 * unaware of which implementation is active underneath.
 *
 * Vite bundles the AudioWorklet module graph, so the worklet imports these
 * types and the shared timing kernel instead of maintaining parallel copies.
 */

import type { GridState } from '../types';
import type {
  EnvelopeDuration,
  EnvelopeDurationUnit,
  SamplePlaybackMode,
  TrackEnvelopeV2,
} from '../shared/envelope-contract-v2';

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
   * Push an updated grid state snapshot while playback is running.
   *
   * The main-thread scheduler reads state via a closure every tick and
   * implements this as a no-op. The worklet host needs explicit pushes
   * because the worklet holds a serialized copy — without this call the
   * worklet plays against stale tracks/tempo/swing/loopRegion.
   */
  updateState(state: GridState): void;

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
  gate?: number;
  envelopeTimeUnit?: EnvelopeDurationUnit;
  envelopeV2?: TrackEnvelopeV2;
  samplePlaybackMode?: SamplePlaybackMode;
  largePitchShiftLatencySeconds?: number;
  parameterLocks: (WorkletPLock | null)[];
}

export interface WorkletPLock {
  pitch?: number;
  volume?: number;
  tie?: boolean;
  attack?: number;
  hold?: number;
  decay?: number;
  release?: number;
  attackDuration?: EnvelopeDuration;
  holdDuration?: EnvelopeDuration;
  decayDuration?: EnvelopeDuration;
  releaseDuration?: EnvelopeDuration;
}

export const SCHEDULE_AHEAD_SEC = 0.15;
