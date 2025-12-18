import type { GridState } from '../types';
import { MAX_STEPS } from '../types';
import { audioEngine } from './engine';
import { logger } from '../utils/logger';
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

const LOOKAHEAD_MS = 25; // How often to check (ms)
const SCHEDULE_AHEAD_SEC = 0.1; // How far ahead to schedule (seconds)
const STEPS_PER_BEAT = 4; // 16th notes

export class Scheduler {
  private timerId: number | null = null;
  private nextStepTime: number = 0;
  private currentStep: number = 0; // Global step counter (0-63 for 4 bars)
  private isRunning: boolean = false;
  private onStepChange: ((step: number) => void) | null = null;
  private getState: (() => GridState) | null = null;
  private lastNotifiedStep: number = -1; // Track last UI update to prevent flickering

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

  constructor() {
    this.scheduleLoop = this.scheduleLoop.bind(this);
    // Debug: Track singleton instances
    registerSchedulerInstance(this);
  }

  setOnStepChange(callback: (step: number) => void): void {
    this.onStepChange = callback;
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
    this.currentStep = 0;
    this.lastNotifiedStep = -1;
    this.totalStepsScheduled = 0; // Phase 13B: Reset step counter for drift-free timing
    this.getState = getState;

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
      // Apply swing: delay odd-numbered steps (off-beats)
      const swingAmount = state.swing / 100;
      const isSwungStep = this.currentStep % 2 === 1;
      const swingDelay = isSwungStep ? stepDuration * swingAmount * 0.5 : 0;
      const swungTime = this.nextStepTime + swingDelay;

      this.scheduleStep(state, this.currentStep, swungTime, stepDuration);

      // Notify UI of step change (for playhead) - only if step actually changed
      if (this.onStepChange && this.currentStep !== this.lastNotifiedStep) {
        const delay = Math.max(0, (swungTime - currentTime) * 1000);
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

      // Advance to next step - loop at MAX_STEPS (64) so all track lengths work
      this.currentStep = (this.currentStep + 1) % MAX_STEPS;
      this.totalStepsScheduled++;

      // Phase 13B: Use multiplicative timing to prevent drift
      // Instead of: this.nextStepTime += stepDuration (accumulates floating-point errors)
      // We compute: nextStepTime = startTime + (stepCount * stepDuration)
      this.nextStepTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
    }
  }

  private scheduleStep(
    _state: GridState,
    globalStep: number, // Global step counter (0-15)
    time: number,
    duration: number
  ): void {
    const state = this.getState?.();
    if (!state) return;

    // Check if any track is soloed
    const anySoloed = state.tracks.some(t => t.soloed);
    const soloedTracks = state.tracks.filter(t => t.soloed).map(t => t.sampleId);

    // DEBUG: Log solo state on first step of each bar
    if (globalStep === 0 && anySoloed) {
      logger.audio.log(`[SOLO DEBUG] anySoloed=${anySoloed}, soloedTracks:`, soloedTracks);
    }

    for (const track of state.tracks) {
      // Determine if track should play:
      // - If any track is soloed, only play soloed tracks (solo wins over mute)
      // - Otherwise, play non-muted tracks
      const shouldPlay = anySoloed ? track.soloed : !track.muted;

      // DEBUG: Log why track is not playing (if soloed but not this track)
      if (anySoloed && !shouldPlay && globalStep === 0) {
        logger.audio.log(`[SOLO DEBUG] Track "${track.sampleId}" NOT playing (soloed=${track.soloed}, muted=${track.muted})`);
      }

      if (!shouldPlay) continue;

      // Each track loops after its stepCount
      const trackStepCount = track.stepCount ?? 16;
      const trackStep = globalStep % trackStepCount;

      // Only play if this step is within the track's step count AND is active
      if (trackStep < trackStepCount && track.steps[trackStep]) {
        // Debug: Track note scheduling with isRunning check
        instrumentNoteSchedule(track.sampleId, trackStep, time, this.isRunning);

        // Get parameter lock for this step (if any)
        const pLock = track.parameterLocks[trackStep];
        // Combine track transpose with per-step p-lock pitch
        const trackTranspose = track.transpose ?? 0;
        const pitchSemitones = trackTranspose + (pLock?.pitch ?? 0);
        const volumeMultiplier = pLock?.volume ?? 1;

        // Apply volume p-lock via track gain (temporarily)
        if (pLock?.volume !== undefined) {
          audioEngine.setTrackVolume(track.id, track.volume * volumeMultiplier);
        }

        // Check if this is a real-time synth track
        if (track.sampleId.startsWith('synth:')) {
          const preset = track.sampleId.replace('synth:', '');
          const noteId = `${track.id}-step-${globalStep}`;

          // Phase 22: Check if this is a sampled instrument (like piano)
          if (audioEngine.isSampledInstrument(preset)) {
            // Sampled instrument playback
            if (!audioEngine.isSampledInstrumentReady(preset)) {
              logger.audio.warn(`Sampled instrument ${preset} not ready, skipping at step ${trackStep}`);
            } else {
              // Convert semitone offset to MIDI note (C4 = 60 is our reference)
              const midiNote = 60 + pitchSemitones;
              // Phase 25: Combine track volume with P-lock volume
              const effectiveVolume = (track.volume ?? 1) * volumeMultiplier;
              logger.audio.log(`Playing sampled ${preset} at step ${trackStep}, time ${time.toFixed(3)}, midiNote=${midiNote}, vol=${effectiveVolume.toFixed(2)}`);
              audioEngine.playSampledInstrument(preset, noteId, midiNote, time, duration * 0.9, effectiveVolume);
            }
          } else {
            // Basic Web Audio synth - pass volume P-lock
            // Phase 25: Pass track.id for per-track audio routing via TrackBusManager
            logger.audio.log(`Playing synth ${preset} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volumeMultiplier}`);
            audioEngine.playSynthNote(noteId, preset, pitchSemitones, time, duration * 0.9, volumeMultiplier, track.id);
          }
        } else if (track.sampleId.startsWith('tone:')) {
          // Tone.js synth (FM, AM, Membrane, Metal, etc.)
          // Phase 22 pattern: Check readiness before playing to prevent race conditions
          if (!audioEngine.isToneSynthReady('tone')) {
            logger.audio.warn(`Tone.js not ready, skipping ${track.sampleId} at step ${trackStep}`);
          } else {
            const preset = track.sampleId.replace('tone:', '');
            // Phase 25: Combine track volume with P-lock volume
            // Tone.js synths bypass TrackBusManager, so volume is applied at note level
            const effectiveVolume = (track.volume ?? 1) * volumeMultiplier;
            logger.audio.log(`Playing Tone.js ${preset} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${effectiveVolume.toFixed(2)}`);
            // Phase 22: Pass absolute time - audioEngine handles Tone.js conversion internally
            audioEngine.playToneSynth(preset as Parameters<typeof audioEngine.playToneSynth>[0], pitchSemitones, time, duration * 0.9, effectiveVolume);
          }
        } else if (track.sampleId.startsWith('advanced:')) {
          // Advanced dual-oscillator synth
          // Phase 22 pattern: Check readiness before playing to prevent race conditions
          if (!audioEngine.isToneSynthReady('advanced')) {
            logger.audio.warn(`Advanced synth not ready, skipping ${track.sampleId} at step ${trackStep}`);
          } else {
            const preset = track.sampleId.replace('advanced:', '');
            // Phase 25: Combine track volume with P-lock volume
            // Advanced synths bypass TrackBusManager, so volume is applied at note level
            const effectiveVolume = (track.volume ?? 1) * volumeMultiplier;
            logger.audio.log(`Playing Advanced ${preset} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${effectiveVolume.toFixed(2)}`);
            // Phase 22: Pass absolute time - audioEngine handles Tone.js conversion internally
            audioEngine.playAdvancedSynth(preset, pitchSemitones, time, duration * 0.9, effectiveVolume);
          }
        } else if (track.sampleId.startsWith('sampled:')) {
          // Sampled instrument (e.g., piano with real audio samples)
          const instrumentId = track.sampleId.replace('sampled:', '');
          const noteId = `${track.id}-step-${globalStep}`;

          if (!audioEngine.isSampledInstrumentReady(instrumentId)) {
            logger.audio.warn(`Sampled instrument ${instrumentId} not ready, skipping at step ${trackStep}`);
          } else {
            // Convert semitone offset to MIDI note (C4 = 60 is our reference)
            const midiNote = 60 + pitchSemitones;
            // Phase 25: Combine track volume with P-lock volume
            // Sampled instruments bypass TrackBusManager, so volume is applied at note level
            const effectiveVolume = (track.volume ?? 1) * volumeMultiplier;
            logger.audio.log(`Playing sampled ${instrumentId} at step ${trackStep}, time ${time.toFixed(3)}, midiNote=${midiNote}, vol=${effectiveVolume.toFixed(2)}`);
            audioEngine.playSampledInstrument(instrumentId, noteId, midiNote, time, duration * 0.9, effectiveVolume);
          }
        } else {
          // Sample-based playback - pass volume P-lock (Phase 25 fix)
          logger.audio.log(`Playing ${track.sampleId} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volumeMultiplier}`);
          audioEngine.playSample(track.sampleId, track.id, time, duration * 0.9, track.playbackMode, pitchSemitones, volumeMultiplier);
        }

        // Reset volume after a short delay (hacky but works for now)
        // Phase 13B: Track timer for cleanup
        if (pLock?.volume !== undefined) {
          const trackId = track.id;
          const originalVolume = track.volume;
          const volumeTimer = setTimeout(() => {
            this.pendingTimers.delete(volumeTimer);
            audioEngine.setTrackVolume(trackId, originalVolume);
          }, duration * 1000 + 50);
          this.pendingTimers.add(volumeTimer);
        }
      }
    }
  }

  private getStepDuration(tempo: number): number {
    // Duration of one 16th note in seconds
    const beatsPerSecond = tempo / 60;
    return 1 / (beatsPerSecond * STEPS_PER_BEAT);
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

// HMR support: Reset scheduler tracking when this module is hot-replaced
// This prevents false positives in the "multiple scheduler instances" assertion
if (import.meta.hot) {
  logger.audio.log('[HMR] Scheduler module: registering dispose handler');

  import.meta.hot.dispose(() => {
    logger.audio.log('[HMR] Scheduler dispose called - cleaning up');
    // Stop playback before HMR replacement
    if (scheduler.isPlaying()) {
      scheduler.stop();
    }
    // Reset tracking for clean slate
    resetSchedulerTracking();
  });

  // Make scheduler.ts an HMR boundary so dispose is called properly
  // Without this, parent module accepts cause re-evaluation without dispose
  import.meta.hot.accept(() => {
    logger.audio.log('[HMR] Scheduler module accepted update');
  });
}
