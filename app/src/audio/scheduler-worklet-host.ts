/**
 * SchedulerWorkletHost — Main-thread host for the scheduler AudioWorklet.
 *
 * Receives note/step/beat events from the worklet and dispatches them
 * to the audio engine and UI callbacks. Implements the same IScheduler
 * interface as the main-thread Scheduler for seamless swapping.
 */

import type { GridState } from '../types';
import type { IScheduler, WorkletSchedulerState, WorkletTrack, WorkletPLock } from './scheduler-types';
import { MAX_STEPS, DEFAULT_STEP_COUNT } from '../shared/constants';
import { audioEngine } from './engine';
import { setMediaSessionPlaybackState } from './media-session';
import { parseInstrumentId, type InstrumentType } from './instrument-types';
import { loadWorkletModule } from './worklet-support';
import { audioMetrics } from './metrics/audio-metrics';
import { computeJoinOffset } from './scheduler-multiplayer-sync';
import { resolveNoteDynamics } from './note-dynamics';
import { logger } from '../utils/logger';
import schedulerWorkletUrl from './worklets/scheduler.worklet.ts?worker&url';
import {
  audioContextClock,
  audioTime,
  seconds,
  serverTimeMs,
  type AudioClock,
} from './audio-time';
import { dispatchResolvedNote } from './note-dispatcher';
import type { ResolvedNoteEvent } from './resolved-note-event';
import { PresentationClock } from './presentation-clock';

// ─── Event types from the worklet ────────────────────────────────────────

interface NoteEvent {
  type: 'note';
  trackId: string;
  noteId: string;
  sampleId: string;
  pitchSemitones: number;
  time: number;
  duration: number;
  midiVelocity?: number;
  noteGain?: number;
  hasExplicitLock?: boolean;
  loopIteration?: number;
  /** Legacy event compatibility for a host/worklet rolling update. */
  volumeMultiplier?: number;
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

type WorkletEvent = NoteEvent | StepEvent | BeatEvent;

// ─── Host ────────────────────────────────────────────────────────────────

export class SchedulerWorkletHost implements IScheduler {
  private node: AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;
  private audioClock: AudioClock | null = null;
  private isRunning = false;
  private currentStep = 0;
  private moduleLoaded = false;
  private readonly presentationClock = new PresentationClock({
    now: () => this.audioClock?.now() ?? audioTime(0),
  });

  // Callbacks
  private onStepChange: ((step: number) => void) | null = null;
  private onBeat: ((beat: number) => void) | null = null;

  // Multiplayer config — stored for future forwarding to worklet
  private multiplayerConfig: { enabled: boolean; getServerTime: (() => number) | null } = { enabled: false, getServerTime: null };

  /**
   * Initialize the worklet. Must be called before start().
   * Returns false if the worklet couldn't be loaded (fallback needed).
   */
  async initialize(audioContext: AudioContext): Promise<boolean> {
    this.audioContext = audioContext;
    this.audioClock = audioContextClock(audioContext);

    this.moduleLoaded = await loadWorkletModule(audioContext, schedulerWorkletUrl, 'scheduler-worklet');

    if (!this.moduleLoaded) return false;

    this.node = new AudioWorkletNode(audioContext, 'scheduler-worklet', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    // Connect to destination (worklet needs to be in the audio graph to process)
    // Output is silent — the worklet only uses process() for timing
    this.node.connect(audioContext.destination);

    this.node.port.onmessage = (e: MessageEvent<WorkletEvent>) => {
      this.handleEvent(e.data);
    };

    audioMetrics.setImplementation('worklet');
    logger.audio.log('SchedulerWorkletHost initialized');
    return true;
  }

  // ─── IScheduler implementation ─────────────────────────────────────────

  setOnStepChange(callback: (step: number) => void): void {
    this.onStepChange = callback;
  }

  setOnBeat(callback: (beat: number) => void): void {
    this.onBeat = callback;
  }

  /** bug_005: expose registered callbacks so any future swap can re-apply them. */
  getOnBeat(): ((beat: number) => void) | null {
    return this.onBeat;
  }
  getOnStepChange(): ((step: number) => void) | null {
    return this.onStepChange;
  }

  setMultiplayerMode(enabled: boolean, getServerTime?: () => number): void {
    this.multiplayerConfig = { enabled, getServerTime: getServerTime ?? null };
  }

  start(getState: () => GridState, serverStartTime?: number): void {
    if (this.isRunning || !this.node || !this.audioContext) return;
    if (!audioEngine.isInitialized()) {
      logger.audio.warn('AudioEngine not initialized');
      return;
    }

    this.isRunning = true;
    setMediaSessionPlaybackState('playing');

    const state = getState();
    const workletState = this.serializeState(state);
    const startTime = this.audioContext.currentTime;

    // Compute join-in-progress offsets on the host so the worklet just
    // follows instructions. Matches the main-thread scheduler's behaviour
    // (see scheduler.ts:152-177) and uses the same shared helper.
    let initialStep = state.loopRegion?.start ?? 0;
    let initialNextStepTime = startTime;
    if (this.multiplayerConfig.enabled && serverStartTime && this.multiplayerConfig.getServerTime) {
      const offset = computeJoinOffset({
        audioStartTime: audioTime(startTime),
        serverStartTime: serverTimeMs(serverStartTime),
        currentServerTime: serverTimeMs(this.multiplayerConfig.getServerTime()),
        tempo: state.tempo,
        maxSteps: MAX_STEPS,
        loopStart: state.loopRegion?.start ?? 0,
      });
      initialStep = offset.currentStep;
      initialNextStepTime = offset.nextStepTime;
      logger.multiplayer.log(`Worklet joining at step ${initialStep}`);
    }

    this.node.port.postMessage({
      type: 'start',
      state: workletState,
      startTime,
      initialStep,
      initialNextStepTime,
      multiplayer: this.multiplayerConfig.enabled,
    });

    logger.audio.log('SchedulerWorkletHost started');
  }

  stop(): void {
    this.isRunning = false;
    setMediaSessionPlaybackState('paused');
    this.node?.port.postMessage({ type: 'stop' });

    this.presentationClock.clear();

    logger.audio.log('SchedulerWorkletHost stopped');
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  isPlaying(): boolean {
    return this.isRunning;
  }

  // ─── State updates ─────────────────────────────────────────────────────

  /**
   * Send updated state to the worklet.
   * Call this when tracks, tempo, swing, or loop region changes.
   */
  updateState(gridState: GridState): void {
    if (!this.isRunning || !this.node) return;
    this.node.port.postMessage({
      type: 'updateState',
      state: this.serializeState(gridState),
    });
  }

  // ─── Event handling ────────────────────────────────────────────────────

  private handleEvent(event: WorkletEvent): void {
    if (!this.isRunning) return;

    switch (event.type) {
      case 'note':
        this.handleNoteEvent(event);
        break;
      case 'step':
        this.scheduleUiCallback('step', event.time, () => {
          this.currentStep = event.step;
          this.onStepChange?.(event.step);
        });
        break;
      case 'beat':
        this.scheduleUiCallback('beat', event.time, () => {
          this.onBeat?.(event.beat);
        });
        break;
    }
  }

  /**
   * Defer a UI-side callback (playhead, metronome) until the audio time
   * the worklet emitted. Without this, UI runs ~SCHEDULE_AHEAD_SEC ahead
   * of audio (review finding #1). Presentation is lossy and frame-driven;
   * audio scheduling never depends on it.
   */
  private scheduleUiCallback(channel: string, eventTime: number, fn: () => void): void {
    this.presentationClock.schedule(channel, audioTime(eventTime), () => {
      if (this.isRunning) fn();
    });
  }

  private handleNoteEvent(event: NoteEvent): void {
    const { type: instrumentType, presetId } = parseInstrumentId(event.sampleId);
    this.playInstrumentNote(instrumentType, presetId, event);
  }

  private playInstrumentNote(
    instrumentType: InstrumentType,
    presetId: string,
    event: NoteEvent,
  ): void {
    const fallback = resolveNoteDynamics(event.volumeMultiplier);
    const midiVelocity = event.midiVelocity ?? fallback.midiVelocity;
    const noteGain = event.noteGain ?? fallback.noteGain;
    const resolved: ResolvedNoteEvent = {
      type: 'note',
      trackId: event.trackId,
      noteId: event.noteId,
      sampleId: event.sampleId,
      instrumentType,
      presetId,
      pitchSemitones: event.pitchSemitones,
      when: audioTime(event.time),
      duration: seconds(event.duration),
      midiVelocity,
      noteGain,
      hasExplicitLock: event.hasExplicitLock ?? false,
      loopIteration: event.loopIteration ?? 0,
    };
    dispatchResolvedNote(
      resolved,
      this.audioClock?.now() ?? audioTime(event.time),
      audioMetrics,
    );
  }

  // ─── Serialization ─────────────────────────────────────────────────────

  private serializeState(state: GridState): WorkletSchedulerState {
    return {
      tempo: state.tempo,
      swing: state.swing,
      loopRegion: state.loopRegion ?? null,
      maxSteps: MAX_STEPS,
      defaultStepCount: DEFAULT_STEP_COUNT,
      tracks: state.tracks.map((t): WorkletTrack => ({
        id: t.id,
        sampleId: t.sampleId,
        steps: [...t.steps],
        stepCount: t.stepCount ?? DEFAULT_STEP_COUNT,
        muted: t.muted,
        soloed: t.soloed,
        transpose: t.transpose ?? 0,
        swing: t.swing ?? 0,
        parameterLocks: t.parameterLocks.map((pl): WorkletPLock | null => {
          if (!pl) return null;
          return {
            pitch: pl.pitch,
            volume: pl.volume,
            tie: pl.tie,
          };
        }),
      })),
    };
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  dispose(): void {
    this.stop();
    this.node?.disconnect();
    this.node = null;
    this.audioContext = null;
    this.moduleLoaded = false;
  }
}
