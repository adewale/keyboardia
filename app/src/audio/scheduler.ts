import type { GridState, Track } from '../types';
import { MAX_STEPS, DEFAULT_STEP_COUNT } from '../types';
import { audioEngine } from './engine';
import { logger } from '../utils/logger';
import { registerHmrDispose } from '../utils/hmr';
import { parseInstrumentId, type InstrumentType } from './instrument-types';
import {
  registerSchedulerInstance,
  resetSchedulerTracking,
  instrumentSchedulerStart,
  instrumentSchedulerStop,
  instrumentScheduleLoop,
  instrumentNoteSchedule,
  verifySchedulerInvariants,
  assertPlaybackStopped,
  logStateSnapshot,
} from './playback-state-debug';
import { SWING_DELAY_FACTOR } from './timing-calculations';

// =============================================================================
// Constants
// =============================================================================

const LOOKAHEAD_MS = 25; // How often to check (ms)
const SCHEDULE_AHEAD_SEC = 0.1; // How far ahead to schedule (seconds)
const STEPS_PER_BEAT = 4; // 16th notes

/**
 * Buffer time (ms) after note ends to reset volume p-lock.
 * This ensures the volume reset happens after the note finishes.
 */
const VOLUME_RESET_BUFFER_MS = 50;

// =============================================================================
// Types for Note Scheduling
// =============================================================================

/** Parameters needed to play a note */
interface NoteParams {
  trackId: string;
  noteId: string;
  sampleId: string;
  instrumentType: InstrumentType;
  presetId: string;
  pitchSemitones: number;
  time: number;
  duration: number;
  volume: number;
  volumeMultiplier: number;
}

/** Result of checking if a tied note should be skipped */
interface TieCheckResult {
  shouldSkip: boolean;
  activePitch?: number;
}

export class Scheduler {
  private timerId: number | null = null;
  private nextStepTime: number = 0;
  private currentStep: number = 0; // Global step counter (0-63 for 4 bars)
  private isRunning: boolean = false;
  private onStepChange: ((step: number) => void) | null = null;
  private onBeat: ((beat: number) => void) | null = null; // Phase 31A: Beat callback for metronome pulse
  private getState: (() => GridState) | null = null;
  private lastNotifiedStep: number = -1; // Track last UI update to prevent flickering
  private lastNotifiedBeat: number = -1; // Phase 31A: Track last beat to prevent duplicate callbacks

  // Phase 10: Multiplayer clock sync
  private isMultiplayerMode: boolean = false;
  private getServerTime: (() => number) | null = null;
  private audioStartTime: number = 0;

  // Phase 13B: Track pending timers for cleanup on stop
  private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  // Phase 13B: Track total steps scheduled to compute drift-free timing
  // Instead of accumulating nextStepTime += stepDuration (which drifts),
  // we compute: nextStepTime = audioStartTime + (totalStepsScheduled * stepDuration)
  private totalStepsScheduled: number = 0;

  // Phase 22: Track previous tempo to detect BPM changes during playback
  private lastTempo: number = 0;

  // Phase 29B: Track which tracks had active notes in the previous step (for tie handling)
  // Key: trackId, Value: { globalStep, pitch } of the last triggered note
  private activeNotes: Map<string, { globalStep: number; pitch: number }> = new Map();

  constructor() {
    this.scheduleLoop = this.scheduleLoop.bind(this);
    // Debug: Track singleton instances
    registerSchedulerInstance(this);
  }

  setOnStepChange(callback: (step: number) => void): void {
    this.onStepChange = callback;
  }

  /**
   * Phase 31A: Set callback for beat events (every 4 steps = quarter note)
   * Used for metronome pulse visual feedback
   */
  setOnBeat(callback: (beat: number) => void): void {
    this.onBeat = callback;
  }

  /**
   * Phase 10: Enable multiplayer mode with server clock sync
   */
  setMultiplayerMode(enabled: boolean, getServerTime?: () => number): void {
    this.isMultiplayerMode = enabled;
    this.getServerTime = getServerTime ?? null;
  }

  /**
   * Start playback
   * @param getState - Function to get current grid state
   * @param serverStartTime - For multiplayer: server timestamp when playback started
   */
  start(getState: () => GridState, serverStartTime?: number): void {
    // Debug: Track state before start
    instrumentSchedulerStart(this, () => this.isRunning, this.timerId);
    logStateSnapshot(this, this.pendingTimers.size, this.timerId);

    if (this.isRunning) return;
    if (!audioEngine.isInitialized()) {
      logger.audio.warn('AudioEngine not initialized');
      return;
    }

    this.isRunning = true;
    this.lastNotifiedStep = -1;
    this.totalStepsScheduled = 0; // Phase 13B: Reset step counter for drift-free timing
    this.activeNotes.clear(); // Phase 29B: Reset active notes for tie tracking
    this.getState = getState;

    // Phase 31G: Start from loop start if loop region is set
    const initialState = getState();
    if (initialState.loopRegion) {
      this.currentStep = initialState.loopRegion.start;
    } else {
      this.currentStep = 0;
    }

    // Get current audio context time
    this.audioStartTime = audioEngine.getCurrentTime();

    if (this.isMultiplayerMode && serverStartTime && this.getServerTime) {
      // In multiplayer mode, calculate how far into the loop we should be
      const currentServerTime = this.getServerTime();
      const elapsedMs = currentServerTime - serverStartTime;

      if (elapsedMs > 0) {
        // We're joining in progress - calculate current position
        const state = getState();
        const stepDuration = this.getStepDuration(state.tempo);
        const stepDurationMs = stepDuration * 1000;
        const elapsedSteps = Math.floor(elapsedMs / stepDurationMs);
        this.currentStep = elapsedSteps % MAX_STEPS;

        // Adjust next step time to sync with other players
        const remainder = (elapsedMs % stepDurationMs) / 1000;
        this.nextStepTime = this.audioStartTime + (stepDuration - remainder);

        logger.multiplayer.log(`Joining at step ${this.currentStep}, elapsed=${elapsedMs}ms`);
      } else {
        // We're starting fresh
        this.nextStepTime = this.audioStartTime;
      }
    } else {
      // Single player mode - start from beginning
      this.nextStepTime = this.audioStartTime;
    }

    // Debug: log initial state
    const state = getState();
    logger.audio.log('Scheduler starting with tracks:', state.tracks.map(t => ({ name: t.name, sampleId: t.sampleId, stepsActive: t.steps.filter(Boolean).length })));

    // Phase 22: Initialize lastTempo to prevent false BPM change detection on first loop
    this.lastTempo = state.tempo;

    this.scheduleLoop();
  }

  stop(): void {
    // Debug: Capture state BEFORE stop
    const isRunningBefore = this.isRunning;
    const timerIdBefore = this.timerId;
    const pendingTimersCountBefore = this.pendingTimers.size;
    instrumentSchedulerStop(this, isRunningBefore, timerIdBefore, pendingTimersCountBefore);

    this.isRunning = false;
    this.getState = null;
    this.lastTempo = 0; // Phase 22: Reset tempo tracking for clean restart
    this.lastNotifiedBeat = -1; // Phase 31A: Reset beat tracking
    this.activeNotes.clear(); // Phase 29B: Clear tied note tracking
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    // Phase 13B: Clear all pending timers (step change notifications, volume resets)
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();

    // Debug: Verify invariants and assert clean stop
    verifySchedulerInvariants(this.isRunning, this.timerId, this.pendingTimers.size, this.getState);
    assertPlaybackStopped(this.isRunning, this.timerId, this.pendingTimers.size);
    logStateSnapshot(this, this.pendingTimers.size, this.timerId);
  }

  private scheduleLoop(): void {
    // Debug: Verify isRunning check is working
    instrumentScheduleLoop(
      this.isRunning,
      this.currentStep,
      this.nextStepTime,
      audioEngine.getCurrentTime()
    );

    if (!this.isRunning || !this.getState) return;

    const state = this.getState();
    this.scheduler(state);
    this.timerId = window.setTimeout(this.scheduleLoop, LOOKAHEAD_MS);
  }

  private scheduler(state: GridState): void {
    const currentTime = audioEngine.getCurrentTime();
    const stepDuration = this.getStepDuration(state.tempo);

    // Phase 22: Detect BPM changes during playback and recalculate timing reference
    // Without this fix, changing BPM causes nextStepTime to jump (since it's calculated as
    // audioStartTime + totalStepsScheduled * stepDuration), which makes the scheduler
    // try to "catch up" by scheduling many notes rapidly.
    if (this.lastTempo !== 0 && this.lastTempo !== state.tempo) {
      // BPM changed! Recalculate audioStartTime to maintain current position
      // Formula: audioStartTime = currentTime - (totalStepsScheduled * NEW_stepDuration)
      // This ensures nextStepTime ≈ currentTime after the change
      const oldStepDuration = this.getStepDuration(this.lastTempo);
      const elapsedAtOldTempo = this.totalStepsScheduled * oldStepDuration;

      // Calculate where we should be at the new tempo to maintain musical position
      // Keep the same number of steps scheduled, just adjust the reference point
      this.audioStartTime = currentTime - (this.totalStepsScheduled * stepDuration);
      this.nextStepTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);

      logger.audio.log(`BPM changed: ${this.lastTempo} → ${state.tempo}, recalculated timing (steps=${this.totalStepsScheduled}, oldElapsed=${elapsedAtOldTempo.toFixed(3)}s)`);
    }
    this.lastTempo = state.tempo;

    // Schedule all steps that fall within the lookahead window
    while (this.nextStepTime < currentTime + SCHEDULE_AHEAD_SEC) {
      // Phase 29F: Swing is now applied per-track in scheduleStep() based on local step position
      // This enables proper polyrhythm support where each track's swing follows its own loop cycle
      this.scheduleStep(state, this.currentStep, this.nextStepTime, stepDuration);

      // Notify UI of step change (for playhead) - only if step actually changed
      // Note: We use nextStepTime here (not swung) because playhead shows grid position
      if (this.onStepChange && this.currentStep !== this.lastNotifiedStep) {
        const delay = Math.max(0, (this.nextStepTime - currentTime) * 1000);
        const step = this.currentStep;
        this.lastNotifiedStep = step;
        // Phase 13B: Track timer for cleanup
        const timer = setTimeout(() => {
          this.pendingTimers.delete(timer);
          // Only notify if scheduler is still running (prevents stale updates)
          if (this.isRunning) {
            this.onStepChange?.(step);
          }
        }, delay);
        this.pendingTimers.add(timer);
      }

      // Phase 31A: Notify UI of beat changes (every 4 steps = quarter note)
      // Used for metronome pulse visual feedback on play button
      const currentBeat = Math.floor(this.currentStep / STEPS_PER_BEAT);
      if (this.onBeat && currentBeat !== this.lastNotifiedBeat) {
        const delay = Math.max(0, (this.nextStepTime - currentTime) * 1000);
        const beat = currentBeat;
        this.lastNotifiedBeat = beat;
        // Track timer for cleanup
        const beatTimer = setTimeout(() => {
          this.pendingTimers.delete(beatTimer);
          if (this.isRunning) {
            this.onBeat?.(beat);
          }
        }, delay);
        this.pendingTimers.add(beatTimer);
      }

      // Phase 31G: Advance to next step - respect loop region if set
      // If loopRegion is defined, playhead stays within [start, end]
      const loopRegion = state.loopRegion;
      if (loopRegion) {
        // Within loop region: advance and wrap at loop end
        if (this.currentStep >= loopRegion.end) {
          this.currentStep = loopRegion.start;
        } else {
          this.currentStep++;
        }
      } else {
        // No loop: standard wrap at MAX_STEPS
        this.currentStep = (this.currentStep + 1) % MAX_STEPS;
      }
      this.totalStepsScheduled++;

      // Phase 13B: Use multiplicative timing to prevent drift
      // Instead of: this.nextStepTime += stepDuration (accumulates floating-point errors)
      // We compute: nextStepTime = startTime + (stepCount * stepDuration)
      this.nextStepTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
    }
  }

  // ===========================================================================
  // Helper Methods for scheduleStep (H-03 refactoring)
  // ===========================================================================

  /**
   * Determine if a track should play based on solo/mute state.
   * Solo wins over mute: if any track is soloed, only soloed tracks play.
   */
  private shouldTrackPlay(track: Track, anySoloed: boolean): boolean {
    return anySoloed ? track.soloed : !track.muted;
  }

  /**
   * Calculate swing-adjusted time for a step.
   * Combines global and track swing using the blending formula.
   */
  private calculateSwingTime(
    trackStep: number,
    time: number,
    duration: number,
    globalSwing: number,
    trackSwing: number
  ): number {
    // Swing blending: combined = global + track - (global * track)
    const swingAmount = globalSwing + trackSwing - (globalSwing * trackSwing);
    const isSwungStep = trackStep % 2 === 1;
    const swingDelay = isSwungStep ? duration * swingAmount * SWING_DELAY_FACTOR : 0;
    return time + swingDelay;
  }

  /**
   * Check if a tied note should skip triggering (TB-303 style).
   * Returns whether to skip and the pitch to continue if skipping.
   */
  private checkTiedNote(
    track: Track,
    globalStep: number,
    hasTie: boolean
  ): TieCheckResult {
    if (!hasTie) {
      return { shouldSkip: false };
    }

    const activeNote = this.activeNotes.get(track.id);
    const previousGlobalStep = (globalStep - 1 + MAX_STEPS) % MAX_STEPS;

    if (activeNote && activeNote.globalStep === previousGlobalStep) {
      // Note is tied from previous step - update tracking and skip triggering
      this.activeNotes.set(track.id, { globalStep, pitch: activeNote.pitch });
      return { shouldSkip: true, activePitch: activeNote.pitch };
    }

    return { shouldSkip: false };
  }

  /**
   * Play a note on the appropriate instrument.
   * Replaces the large switch statement with a cleaner dispatch.
   */
  private playInstrumentNote(params: NoteParams): void {
    const { instrumentType, presetId, pitchSemitones, time, duration, volume, volumeMultiplier, noteId, trackId } = params;

    switch (instrumentType) {
      case 'synth':
        logger.audio.log(`Playing synth ${presetId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volumeMultiplier}, dur=${duration.toFixed(3)}`);
        audioEngine.playSynthNote(noteId, presetId, pitchSemitones, time, duration, volumeMultiplier, trackId);
        break;

      case 'sampled': {
        if (!audioEngine.isSampledInstrumentReady(presetId)) {
          logger.audio.warn(`Sampled instrument ${presetId} not ready, skipping`);
          return;
        }
        const midiNote = 60 + pitchSemitones;
        logger.audio.log(`Playing sampled ${presetId} at time ${time.toFixed(3)}, midiNote=${midiNote}, vol=${volume.toFixed(2)}, dur=${duration.toFixed(3)}`);
        audioEngine.playSampledInstrument(presetId, noteId, midiNote, time, duration, volume);
        break;
      }

      case 'tone':
        if (!audioEngine.isToneSynthReady('tone')) {
          logger.audio.warn(`Tone.js not ready, skipping ${params.sampleId}`);
          return;
        }
        logger.audio.log(`Playing Tone.js ${presetId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volume.toFixed(2)}, dur=${duration.toFixed(3)}`);
        audioEngine.playToneSynth(presetId as Parameters<typeof audioEngine.playToneSynth>[0], pitchSemitones, time, duration, volume);
        break;

      case 'advanced':
        if (!audioEngine.isToneSynthReady('advanced')) {
          logger.audio.warn(`Advanced synth not ready, skipping ${params.sampleId}`);
          return;
        }
        logger.audio.log(`Playing Advanced ${presetId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volume.toFixed(2)}, dur=${duration.toFixed(3)}`);
        audioEngine.playAdvancedSynth(presetId, pitchSemitones, time, duration, volume);
        break;

      case 'sample':
      default:
        logger.audio.log(`Playing ${params.sampleId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volumeMultiplier}, dur=${duration.toFixed(3)}`);
        audioEngine.playSample(params.sampleId, trackId, time, duration, pitchSemitones, volumeMultiplier);
        break;
    }
  }

  /**
   * Schedule volume reset after a note with volume p-lock.
   * Uses setTimeout with tracking for cleanup on stop.
   *
   * NOTE: Ideally this would use Web Audio API's parameter scheduling,
   * but that requires direct access to audio nodes which are encapsulated
   * in the audio engine. This approach works reliably for the use case.
   */
  private scheduleVolumeReset(
    trackId: string,
    originalVolume: number,
    duration: number
  ): void {
    const delayMs = duration * 1000 + VOLUME_RESET_BUFFER_MS;
    const volumeTimer = setTimeout(() => {
      this.pendingTimers.delete(volumeTimer);
      audioEngine.setTrackVolume(trackId, originalVolume);
    }, delayMs);
    this.pendingTimers.add(volumeTimer);
  }

  // ===========================================================================
  // Main Step Scheduling
  // ===========================================================================

  /**
   * Schedule all notes for a single step across all tracks.
   * Refactored from 170 lines to use helper methods.
   */
  private scheduleStep(
    _state: GridState,
    globalStep: number,
    time: number,
    duration: number
  ): void {
    const state = this.getState?.();
    if (!state) return;

    const anySoloed = state.tracks.some(t => t.soloed);
    const globalSwing = state.swing / 100;

    // DEBUG: Log solo state on first step of each bar
    if (globalStep === 0 && anySoloed) {
      const soloedTracks = state.tracks.filter(t => t.soloed).map(t => t.sampleId);
      logger.audio.log(`[SOLO DEBUG] anySoloed=${anySoloed}, soloedTracks:`, soloedTracks);
    }

    for (const track of state.tracks) {
      // Check if track should play (solo/mute logic)
      if (!this.shouldTrackPlay(track, anySoloed)) {
        if (anySoloed && globalStep === 0) {
          logger.audio.log(`[SOLO DEBUG] Track "${track.sampleId}" NOT playing (soloed=${track.soloed}, muted=${track.muted})`);
        }
        continue;
      }

      // Calculate track-local step position
      const trackStepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
      const trackStep = globalStep % trackStepCount;

      // Skip if step is not active
      if (trackStep >= trackStepCount || !track.steps[trackStep]) {
        continue;
      }

      // Calculate swing-adjusted time
      const trackSwing = (track.swing ?? 0) / 100;
      const swungTime = this.calculateSwingTime(trackStep, time, duration, globalSwing, trackSwing);

      // Get parameter lock for this step
      const pLock = track.parameterLocks[trackStep];
      const trackTranspose = track.transpose ?? 0;
      const pitchSemitones = trackTranspose + (pLock?.pitch ?? 0);

      // Check for tied notes (TB-303 style)
      const tieCheck = this.checkTiedNote(track, globalStep, pLock?.tie === true);
      if (tieCheck.shouldSkip) {
        logger.audio.log(`Tied note on ${track.sampleId} at step ${trackStep}, continuing from previous (pitch=${tieCheck.activePitch})`);
        continue;
      }

      // Calculate tied note duration
      const tiedDuration = this.calculateTiedDuration(track, trackStep, trackStepCount, duration);

      // Track this note as active for tie detection in next step
      this.activeNotes.set(track.id, { globalStep, pitch: pitchSemitones });

      // Debug: Track note scheduling
      instrumentNoteSchedule(track.sampleId, trackStep, swungTime, this.isRunning);

      // Volume handling
      const volumeMultiplier = pLock?.volume ?? 1;
      if (pLock?.volume !== undefined) {
        audioEngine.setTrackVolume(track.id, track.volume * volumeMultiplier);
      }

      // Parse instrument and build note params
      const { type: instrumentType, presetId } = parseInstrumentId(track.sampleId);
      const noteParams: NoteParams = {
        trackId: track.id,
        noteId: `${track.id}-step-${globalStep}`,
        sampleId: track.sampleId,
        instrumentType,
        presetId,
        pitchSemitones,
        time: swungTime,
        duration: tiedDuration,
        volume: (track.volume ?? 1) * volumeMultiplier,
        volumeMultiplier,
      };

      // Play the note
      this.playInstrumentNote(noteParams);

      // Schedule volume reset if needed
      if (pLock?.volume !== undefined) {
        this.scheduleVolumeReset(track.id, track.volume, tiedDuration);
      }
    }
  }

  private getStepDuration(tempo: number): number {
    const beatsPerSecond = tempo / 60;
    return 1 / (beatsPerSecond * STEPS_PER_BEAT);
  }

  /**
   * Calculate duration including tied notes.
   * Scans forward from startStep to count consecutive tied steps.
   *
   * ABSTRACTION FIX (AU-004d): Uses step count iteration instead of index comparison.
   */
  private calculateTiedDuration(
    track: { steps: boolean[]; parameterLocks: ({ tie?: boolean } | null)[] },
    startStep: number,
    trackStepCount: number,
    stepDuration: number
  ): number {
    let tieCount = 1; // Start with 1 for the current step
    let stepsChecked = 0;

    // Scan forward for tied steps
    // Use stepsChecked counter instead of index comparison to handle wrap-around
    while (stepsChecked < trackStepCount - 1) {
      const nextStep = (startStep + 1 + stepsChecked) % trackStepCount;
      const nextPLock = track.parameterLocks[nextStep];

      if (track.steps[nextStep] && nextPLock?.tie === true) {
        tieCount++;
        stepsChecked++;
      } else {
        break;
      }
    }

    // Return extended duration (with 90% gate time for natural release)
    return stepDuration * tieCount * 0.9;
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  isPlaying(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
export const scheduler = new Scheduler();

// HMR cleanup - stops playback and resets tracking during development
registerHmrDispose('Scheduler', () => {
  if (scheduler.isPlaying()) {
    scheduler.stop();
  }
  resetSchedulerTracking();
});
