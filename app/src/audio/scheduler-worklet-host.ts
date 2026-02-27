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
import { parseInstrumentId, type InstrumentType } from './instrument-types';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';
import { loadWorkletModule } from './worklet-support';
import { audioMetrics } from './metrics/audio-metrics';
import { logger } from '../utils/logger';

// ─── Event types from the worklet ────────────────────────────────────────

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

type WorkletEvent = NoteEvent | StepEvent | BeatEvent | JitterEvent;

// ─── Host ────────────────────────────────────────────────────────────────

export class SchedulerWorkletHost implements IScheduler {
  private node: AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;
  private isRunning = false;
  private currentStep = 0;
  private moduleLoaded = false;

  // Callbacks
  private onStepChange: ((step: number) => void) | null = null;
  private onBeat: ((beat: number) => void) | null = null;

  // State tracking for incremental updates
  private getState: (() => GridState) | null = null;

  // Multiplayer
  private isMultiplayerMode = false;
  private getServerTime: (() => number) | null = null;

  /**
   * Initialize the worklet. Must be called before start().
   * Returns false if the worklet couldn't be loaded (fallback needed).
   */
  async initialize(audioContext: AudioContext): Promise<boolean> {
    this.audioContext = audioContext;

    const moduleUrl = new URL('./worklets/scheduler.worklet.ts', import.meta.url);
    this.moduleLoaded = await loadWorkletModule(audioContext, moduleUrl, 'scheduler-worklet');

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

  setMultiplayerMode(enabled: boolean, getServerTime?: () => number): void {
    this.isMultiplayerMode = enabled;
    this.getServerTime = getServerTime ?? null;
  }

  start(getState: () => GridState, _serverStartTime?: number): void {
    if (this.isRunning || !this.node || !this.audioContext) return;
    if (!audioEngine.isInitialized()) {
      logger.audio.warn('AudioEngine not initialized');
      return;
    }

    this.isRunning = true;
    this.getState = getState;

    const state = getState();
    const workletState = this.serializeState(state);
    const startTime = this.audioContext.currentTime;

    this.node.port.postMessage({
      type: 'start',
      state: workletState,
      startTime,
    });

    logger.audio.log('SchedulerWorkletHost started');
  }

  stop(): void {
    this.isRunning = false;
    this.getState = null;
    this.node?.port.postMessage({ type: 'stop' });
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
        this.currentStep = event.step;
        this.onStepChange?.(event.step);
        break;
      case 'beat':
        this.onBeat?.(event.beat);
        break;
      case 'jitter':
        audioMetrics.recordJitter(event.jitterMs);
        audioMetrics.recordDrift(event.stepCount, event.driftMs);
        break;
    }
  }

  private handleNoteEvent(event: NoteEvent): void {
    const { type: instrumentType, presetId } = parseInstrumentId(event.sampleId);

    // Apply volume p-lock at track level
    if (event.volumeMultiplier !== 1) {
      audioEngine.setTrackVolume(event.trackId, event.volume);
    }

    // Dispatch to the appropriate play method
    this.playInstrumentNote(
      instrumentType,
      presetId,
      event
    );

    // Schedule volume reset if p-lock was applied
    if (event.volumeMultiplier !== 1) {
      const state = this.getState?.();
      const track = state?.tracks.find(t => t.id === event.trackId);
      if (track) {
        const delayMs = event.duration * 1000 + 50;
        setTimeout(() => {
          audioEngine.setTrackVolume(event.trackId, track.volume);
        }, delayMs);
      }
    }
  }

  private playInstrumentNote(
    instrumentType: InstrumentType,
    presetId: string,
    event: NoteEvent
  ): void {
    switch (instrumentType) {
      case 'synth':
        audioEngine.playSynthNote(
          event.noteId, presetId, event.pitchSemitones,
          event.time, event.duration, event.volumeMultiplier, event.trackId
        );
        break;

      case 'sampled': {
        if (!audioEngine.isSampledInstrumentReady(presetId)) return;
        const midiNote = SCHEDULER_BASE_MIDI_NOTE + event.pitchSemitones;
        audioEngine.playSampledInstrument(presetId, event.noteId, midiNote, event.time, event.duration, event.volume);
        break;
      }

      case 'tone':
        if (!audioEngine.isToneSynthReady('tone')) return;
        audioEngine.playToneSynth(
          presetId as Parameters<typeof audioEngine.playToneSynth>[0],
          event.pitchSemitones, event.time, event.duration, event.volume
        );
        break;

      case 'advanced':
        if (!audioEngine.isToneSynthReady('advanced')) return;
        audioEngine.playAdvancedSynth(presetId, event.pitchSemitones, event.time, event.duration, event.volume);
        break;

      case 'sample':
      default:
        audioEngine.playSample(event.sampleId, event.trackId, event.time, event.duration, event.pitchSemitones, event.volumeMultiplier);
        break;
    }
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
        volume: t.volume ?? 1,
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
