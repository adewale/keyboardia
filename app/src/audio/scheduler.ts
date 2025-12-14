import type { GridState } from '../types';
import { MAX_STEPS } from '../types';
import { audioEngine } from './engine';
import { logger } from '../utils/logger';

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

  constructor() {
    this.scheduleLoop = this.scheduleLoop.bind(this);
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

    this.scheduleLoop();
  }

  stop(): void {
    this.isRunning = false;
    this.getState = null;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    // Phase 13B: Clear all pending timers (step change notifications, volume resets)
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  private scheduleLoop(): void {
    if (!this.isRunning || !this.getState) return;

    const state = this.getState();
    this.scheduler(state);
    this.timerId = window.setTimeout(this.scheduleLoop, LOOKAHEAD_MS);
  }

  private scheduler(state: GridState): void {
    const currentTime = audioEngine.getCurrentTime();
    const stepDuration = this.getStepDuration(state.tempo);

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

    for (const track of state.tracks) {
      // Determine if track should play:
      // - If any track is soloed, only play soloed tracks (solo wins over mute)
      // - Otherwise, play non-muted tracks
      const shouldPlay = anySoloed ? track.soloed : !track.muted;
      if (!shouldPlay) continue;

      // Each track loops after its stepCount
      const trackStepCount = track.stepCount ?? 16;
      const trackStep = globalStep % trackStepCount;

      // Only play if this step is within the track's step count AND is active
      if (trackStep < trackStepCount && track.steps[trackStep]) {
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
        if (track.sampleId.startsWith('advsynth:')) {
          // Advanced synth with dual oscillators, LFO, filter envelope
          const preset = track.sampleId.replace('advsynth:', '');
          const noteId = `${track.id}-step-${globalStep}`;
          logger.audio.log(`Playing advanced synth ${preset} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}`);
          audioEngine.playAdvancedSynthNote(noteId, preset, pitchSemitones, time, duration * 0.9);
        } else if (track.sampleId.startsWith('synth:')) {
          // Basic synth (backward compatible)
          const preset = track.sampleId.replace('synth:', '');
          const noteId = `${track.id}-step-${globalStep}`;
          logger.audio.log(`Playing synth ${preset} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}`);
          audioEngine.playSynthNote(noteId, preset, pitchSemitones, time, duration * 0.9);
        } else {
          // Sample-based playback
          logger.audio.log(`Playing ${track.sampleId} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volumeMultiplier}`);
          audioEngine.playSample(track.sampleId, track.id, time, duration * 0.9, track.playbackMode, pitchSemitones);
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
