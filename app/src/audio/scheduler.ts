import type { GridState } from '../types';
import { MAX_STEPS } from '../types';
import { audioEngine } from './engine';

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

  constructor() {
    this.scheduleLoop = this.scheduleLoop.bind(this);
  }

  setOnStepChange(callback: (step: number) => void): void {
    this.onStepChange = callback;
  }

  start(getState: () => GridState): void {
    if (this.isRunning) return;
    if (!audioEngine.isInitialized()) {
      console.warn('AudioEngine not initialized');
      return;
    }

    this.isRunning = true;
    this.currentStep = 0;
    this.lastNotifiedStep = -1;
    this.nextStepTime = audioEngine.getCurrentTime();
    this.getState = getState;

    // Debug: log initial state
    const state = getState();
    console.log('Scheduler starting with tracks:', state.tracks.map(t => ({ name: t.name, sampleId: t.sampleId, stepsActive: t.steps.filter(Boolean).length })));

    this.scheduleLoop();
  }

  stop(): void {
    this.isRunning = false;
    this.getState = null;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
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
        setTimeout(() => {
          // Only notify if scheduler is still running (prevents stale updates)
          if (this.isRunning) {
            this.onStepChange?.(step);
          }
        }, delay);
      }

      // Advance to next step - loop at MAX_STEPS (64) so all track lengths work
      this.currentStep = (this.currentStep + 1) % MAX_STEPS;
      this.nextStepTime += stepDuration;
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

    for (const track of state.tracks) {
      if (track.muted) continue;

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
        if (track.sampleId.startsWith('synth:')) {
          const preset = track.sampleId.replace('synth:', '');
          const noteId = `${track.id}-step-${globalStep}`;
          console.log(`Playing synth ${preset} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}`);
          audioEngine.playSynthNote(noteId, preset, pitchSemitones, time, duration * 0.9);
        } else {
          // Sample-based playback
          console.log(`Playing ${track.sampleId} at step ${trackStep}, time ${time.toFixed(3)}, pitch=${pitchSemitones}, vol=${volumeMultiplier}`);
          audioEngine.playSample(track.sampleId, track.id, time, duration * 0.9, track.playbackMode, pitchSemitones);
        }

        // Reset volume after a short delay (hacky but works for now)
        if (pLock?.volume !== undefined) {
          setTimeout(() => {
            audioEngine.setTrackVolume(track.id, track.volume);
          }, duration * 1000 + 50);
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
