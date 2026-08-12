/**
 * Scheduler AudioWorklet Processor
 *
 * Moves the timing loop off the main thread. The worklet owns the clock
 * and sends note/step/beat events to the main thread via MessagePort.
 *
 * This replaces the setTimeout-based loop in scheduler.ts with an
 * AudioWorkletProcessor.process() call that fires every ~2.67ms at 48kHz.
 */

import type { WorkletSchedulerState as SchedulerState } from '../scheduler-types';
import { SCHEDULE_AHEAD_SEC } from '../scheduler-types';
import {
  advanceStep,
  calculateStepTime,
  calculateSwingDelay,
  calculateTiedDuration,
  getStepDuration,
  STEPS_PER_BEAT,
} from '../timing-calculations';
import { resolveHumanizedNoteDynamics } from '../note-dynamics';

interface NoteEvent {
  type: 'note';
  trackId: string;
  noteId: string;
  sampleId: string;
  pitchSemitones: number;
  time: number;
  duration: number;
  midiVelocity: number;
  noteGain: number;
  hasExplicitLock: boolean;
  loopIteration: number;
}

interface StepEvent {
  type: 'step';
  step: number;
  time: number;
}

interface BeatEvent {
  type: 'beat';
  beat: number;
  time: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

// How far ahead the worklet schedules notes. Because note dispatch happens
// on the main thread (the worklet posts events, the host calls
// audioEngine.play*), this window is the tolerance for main-thread stalls:
// as long as the host processes an event within SCHEDULE_AHEAD_SEC of
// receipt, the audio graph will start the note at the intended sample.
// Longer stalls cause Math.max(time, currentTime) in engine.ts to clamp
// the start forward, producing an audible late-play.
//
// 150ms is a guesstimate — the right value is the 99th-percentile main-
// thread stall under typical use, which we don't have a calibrated number
// for yet. The empirically-tuned approach: monitor
// `audioMetrics.snapshot.scheduler.lateNoteCount` in production. If it
// spikes during normal use, the lookahead is too short. If it stays at
// zero across a wide variety of sessions, the lookahead can shrink.
// See Lesson 33 for the documentation-by-measurement rule.
// ─── Processor ───────────────────────────────────────────────────────────

class SchedulerWorkletProcessor extends AudioWorkletProcessor {
  private state: SchedulerState | null = null;
  private isRunning = false;
  private nextStepTime = 0;
  private currentStep = 0;
  private totalStepsScheduled = 0;
  private audioStartTime = 0;
  private lastTempo = 0;
  private activeNotes = new Map<string, { globalStep: number; pitch: number }>();
  private lastNotifiedStep = -1;
  private lastNotifiedBeat = -1;
  private loopIteration = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
  }

  private handleMessage(msg: { type: string; [key: string]: unknown }): void {
    switch (msg.type) {
      case 'start':
        if (!msg.state || typeof msg.state !== 'object') return;
        if (typeof msg.startTime !== 'number') return;
        this.start(
          msg.state as SchedulerState,
          msg.startTime,
          typeof msg.initialStep === 'number' ? msg.initialStep : undefined,
          typeof msg.initialNextStepTime === 'number' ? msg.initialNextStepTime : undefined,
        );
        break;
      case 'stop':
        this.stop();
        break;
      case 'updateState':
        if (!msg.state || typeof msg.state !== 'object') return;
        this.state = msg.state as SchedulerState;
        break;
    }
  }

  private start(
    state: SchedulerState,
    startTime: number,
    initialStep?: number,
    initialNextStepTime?: number,
  ): void {
    this.state = state;
    this.isRunning = true;
    // #2: anchor audioStartTime to initialNextStepTime so the per-iteration
    // formula `audioStartTime + N*stepDuration` naturally preserves the
    // multiplayer join offset for every subsequent step. Previously
    // `audioStartTime = startTime` discarded the offset after step 0.
    this.audioStartTime = initialNextStepTime ?? startTime;
    this.nextStepTime = initialNextStepTime ?? startTime;
    this.totalStepsScheduled = 0;
    this.lastTempo = state.tempo;
    this.lastNotifiedStep = -1;
    this.lastNotifiedBeat = -1;
    this.loopIteration = 0;
    this.activeNotes.clear();
    this.currentStep = initialStep ?? state.loopRegion?.start ?? 0;
  }

  private stop(): void {
    this.isRunning = false;
    this.state = null;
    this.activeNotes.clear();
  }

  /**
   * Called every 128 samples (~2.67ms at 48kHz).
   * This is the core advantage over setTimeout — guaranteed audio-rate timing.
   */
  process(): boolean {
    if (!this.isRunning || !this.state) return true;
    this.schedule(currentTime);
    return true;
  }

  // ─── Scheduling Logic (ported from scheduler.ts) ─────────────────────

  private schedule(now: number): void {
    const state = this.state!;
    const stepDuration = getStepDuration(state.tempo);

    // BPM change detection (same algorithm as scheduler.ts:238-251)
    if (this.lastTempo !== 0 && this.lastTempo !== state.tempo) {
      this.audioStartTime = now - (this.totalStepsScheduled * stepDuration);
      this.nextStepTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
    }
    this.lastTempo = state.tempo;

    // Schedule all steps within the lookahead window
    while (this.nextStepTime < now + SCHEDULE_AHEAD_SEC) {
      this.scheduleStep(state, this.currentStep, this.nextStepTime, stepDuration);

      // Send step event
      if (this.currentStep !== this.lastNotifiedStep) {
        this.lastNotifiedStep = this.currentStep;
        this.port.postMessage({
          type: 'step',
          step: this.currentStep,
          time: this.nextStepTime,
        } satisfies StepEvent);
      }

      // Send beat event (every 4 steps)
      const currentBeat = Math.floor(this.currentStep / STEPS_PER_BEAT);
      if (currentBeat !== this.lastNotifiedBeat) {
        this.lastNotifiedBeat = currentBeat;
        this.port.postMessage({
          type: 'beat',
          beat: currentBeat,
          time: this.nextStepTime,
        } satisfies BeatEvent);
      }

      // No worklet-internal jitter emission: nextStepTime and intendedTime
      // are computed from the same formula, so the delta is ~0 by construction.
      // Real jitter is measured on the main thread by the host (see
      // measureAndReportLateness in scheduler-worklet-lateness.ts) when the
      // note event is received, which captures MessagePort transit latency.

      // Advance step (loop-region aware)
      const previousStep = this.currentStep;
      this.currentStep = advanceStep(this.currentStep, state.loopRegion, state.maxSteps);
      if (this.currentStep <= previousStep) this.loopIteration++;

      this.totalStepsScheduled++;
      this.nextStepTime = calculateStepTime(
        this.audioStartTime,
        this.totalStepsScheduled,
        state.tempo,
      );
    }
  }

  private scheduleStep(
    state: SchedulerState,
    globalStep: number,
    time: number,
    duration: number
  ): void {
    const anySoloed = state.tracks.some(t => t.soloed);
    const globalSwing = state.swing / 100;

    for (const track of state.tracks) {
      // Solo/mute filtering
      if (anySoloed ? !track.soloed : track.muted) continue;

      // Track-local step
      const trackStepCount = track.stepCount ?? state.defaultStepCount;
      const trackStep = globalStep % trackStepCount;
      if (trackStep >= trackStepCount || !track.steps[trackStep]) continue;

      // Swing
      const trackSwing = (track.swing ?? 0) / 100;
      const swungTime = this.calculateSwingTime(trackStep, time, duration, globalSwing, trackSwing);

      // Parameter locks
      const pLock = track.parameterLocks[trackStep];
      const pitchSemitones = (track.transpose ?? 0) + (pLock?.pitch ?? 0);

      // Tied note check
      if (pLock?.tie === true) {
        const activeNote = this.activeNotes.get(track.id);
        const prevGlobalStep = (globalStep - 1 + state.maxSteps) % state.maxSteps;
        if (activeNote && activeNote.globalStep === prevGlobalStep) {
          this.activeNotes.set(track.id, { globalStep, pitch: activeNote.pitch });
          continue; // skip — tied from previous step
        }
      }

      // Tied duration
      const tiedDuration = calculateTiedDuration(track, trackStep, trackStepCount, duration);

      // Track active note
      this.activeNotes.set(track.id, { globalStep, pitch: pitchSemitones });

      const dynamics = resolveHumanizedNoteDynamics(
        pLock?.volume,
        track.sampleId,
        track.id,
        globalStep,
        this.loopIteration,
      );

      // Emit note event to main thread
      this.port.postMessage({
        type: 'note',
        trackId: track.id,
        noteId: `${track.id}-step-${globalStep}`,
        sampleId: track.sampleId,
        pitchSemitones,
        time: swungTime,
        duration: tiedDuration,
        ...dynamics,
        loopIteration: this.loopIteration,
      } satisfies NoteEvent);
    }
  }

  private calculateSwingTime(
    trackStep: number,
    time: number,
    duration: number,
    globalSwing: number,
    trackSwing: number
  ): number {
    return time + calculateSwingDelay(trackStep, globalSwing, trackSwing, duration);
  }
}

registerProcessor('scheduler-worklet', SchedulerWorkletProcessor);
