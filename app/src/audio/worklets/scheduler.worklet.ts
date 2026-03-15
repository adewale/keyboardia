/**
 * Scheduler AudioWorklet Processor
 *
 * Moves the timing loop off the main thread. The worklet owns the clock
 * and sends note/step/beat events to the main thread via MessagePort.
 *
 * This replaces the setTimeout-based loop in scheduler.ts with an
 * AudioWorkletProcessor.process() call that fires every ~2.67ms at 48kHz.
 */

// ─── Types (must be self-contained — worklets can't import app modules) ───
// KEEP IN SYNC with scheduler-types.ts (WorkletTrack, WorkletPLock, WorkletSchedulerState)

interface WorkletTrack {
  id: string;
  sampleId: string;
  steps: boolean[];
  stepCount: number;
  muted: boolean;
  soloed: boolean;
  transpose: number;
  swing: number;
  volume: number;
  parameterLocks: (PLock | null)[];
}

interface PLock {
  pitch?: number;
  volume?: number;
  tie?: boolean;
}

interface SchedulerState {
  tempo: number;
  swing: number;
  tracks: WorkletTrack[];
  loopRegion: { start: number; end: number } | null;
  maxSteps: number;
  defaultStepCount: number;
}

interface NoteEvent {
  type: 'note';
  trackId: string;
  noteId: string;
  sampleId: string;
  pitchSemitones: number;
  time: number;
  duration: number;
  volume: number;
  volumeMultiplier: number;
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

interface JitterEvent {
  type: 'jitter';
  jitterMs: number;
  driftMs: number;
  stepCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

const SCHEDULE_AHEAD_SEC = 0.1;
const STEPS_PER_BEAT = 4;
const SWING_DELAY_FACTOR = 0.5;
const GATE_TIME_RATIO = 0.9;

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

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
  }

  private handleMessage(msg: { type: string; [key: string]: unknown }): void {
    switch (msg.type) {
      case 'start':
        this.start(msg.state as SchedulerState, msg.startTime as number);
        break;
      case 'stop':
        this.stop();
        break;
      case 'updateState':
        this.state = msg.state as SchedulerState;
        break;
    }
  }

  private start(state: SchedulerState, startTime: number): void {
    this.state = state;
    this.isRunning = true;
    this.audioStartTime = startTime;
    this.nextStepTime = startTime;
    this.totalStepsScheduled = 0;
    this.lastTempo = state.tempo;
    this.lastNotifiedStep = -1;
    this.lastNotifiedBeat = -1;
    this.activeNotes.clear();
    this.currentStep = state.loopRegion?.start ?? 0;
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
    const stepDuration = this.getStepDuration(state.tempo);

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

      // Send jitter metrics (sampled — every 8th step to limit MessagePort traffic)
      if (this.totalStepsScheduled % 8 === 0) {
        // Scheduling precision: how close is our computed step time to the
        // multiplicative reference? Inside the worklet this should be near-zero;
        // the real jitter measurement happens on the main thread when the
        // note event is received (MessagePort transit time).
        const intendedTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
        const schedulingErrorMs = Math.abs(this.nextStepTime - intendedTime) * 1000;
        this.port.postMessage({
          type: 'jitter',
          jitterMs: schedulingErrorMs,
          driftMs: (this.nextStepTime - intendedTime) * 1000,
          stepCount: this.totalStepsScheduled,
        } satisfies JitterEvent);
      }

      // Advance step (loop-region aware)
      const loopRegion = state.loopRegion;
      if (loopRegion) {
        this.currentStep = this.currentStep >= loopRegion.end
          ? loopRegion.start
          : this.currentStep + 1;
      } else {
        this.currentStep = (this.currentStep + 1) % state.maxSteps;
      }

      this.totalStepsScheduled++;
      this.nextStepTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
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
      const tiedDuration = this.calculateTiedDuration(track, trackStep, trackStepCount, duration);

      // Track active note
      this.activeNotes.set(track.id, { globalStep, pitch: pitchSemitones });

      // Volume
      const volumeMultiplier = pLock?.volume ?? 1;
      const volume = (track.volume ?? 1) * volumeMultiplier;

      // Emit note event to main thread
      this.port.postMessage({
        type: 'note',
        trackId: track.id,
        noteId: `${track.id}-step-${globalStep}`,
        sampleId: track.sampleId,
        pitchSemitones,
        time: swungTime,
        duration: tiedDuration,
        volume,
        volumeMultiplier,
      } satisfies NoteEvent);
    }
  }

  // ─── Helpers (pure math, ported from timing-calculations.ts) ─────────

  private getStepDuration(tempo: number): number {
    return 1 / ((tempo / 60) * STEPS_PER_BEAT);
  }

  private calculateSwingTime(
    trackStep: number,
    time: number,
    duration: number,
    globalSwing: number,
    trackSwing: number
  ): number {
    const swingAmount = globalSwing + trackSwing - (globalSwing * trackSwing);
    const isSwungStep = trackStep % 2 === 1;
    const swingDelay = isSwungStep ? duration * swingAmount * SWING_DELAY_FACTOR : 0;
    return time + swingDelay;
  }

  private calculateTiedDuration(
    track: { steps: boolean[]; parameterLocks: (PLock | null)[] },
    startStep: number,
    trackStepCount: number,
    stepDuration: number
  ): number {
    let tieCount = 1;
    let stepsChecked = 0;

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

    return stepDuration * tieCount * GATE_TIME_RATIO;
  }
}

registerProcessor('scheduler-worklet', SchedulerWorkletProcessor);
