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
import { measureAndReportLateness } from './scheduler-worklet-lateness';
import { computeJoinOffset } from './scheduler-multiplayer-sync';
import { logger } from '../utils/logger';
import schedulerWorkletUrl from './worklets/scheduler.worklet.ts?worker&url';

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

type WorkletEvent = NoteEvent | StepEvent | BeatEvent;

// ─── Host ────────────────────────────────────────────────────────────────

export class SchedulerWorkletHost implements IScheduler {
  private node: AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;
  private isRunning = false;
  private currentStep = 0;
  private moduleLoaded = false;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  // Callbacks
  private onStepChange: ((step: number) => void) | null = null;
  private onBeat: ((beat: number) => void) | null = null;

  // State tracking for incremental updates
  private getState: (() => GridState) | null = null;

  // Multiplayer config — stored for future forwarding to worklet
  private multiplayerConfig: { enabled: boolean; getServerTime: (() => number) | null } = { enabled: false, getServerTime: null };

  /**
   * Initialize the worklet. Must be called before start().
   * Returns false if the worklet couldn't be loaded (fallback needed).
   */
  async initialize(audioContext: AudioContext): Promise<boolean> {
    this.audioContext = audioContext;

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
    this.getState = getState;

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
        audioStartTime: startTime,
        serverStartTime,
        currentServerTime: this.multiplayerConfig.getServerTime(),
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
    this.getState = null;
    this.node?.port.postMessage({ type: 'stop' });

    // Clear all pending volume reset timers (same as scheduler.ts:202-206)
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();

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
        this.scheduleUiCallback(event.time, () => {
          this.currentStep = event.step;
          this.onStepChange?.(event.step);
        });
        break;
      case 'beat':
        this.scheduleUiCallback(event.time, () => {
          this.onBeat?.(event.beat);
        });
        break;
    }
  }

  /**
   * Defer a UI-side callback (playhead, metronome) until the audio time
   * the worklet emitted. Without this, UI runs ~SCHEDULE_AHEAD_SEC ahead
   * of audio (review finding #1). Cancelled by stop() via pendingTimers.
   */
  private scheduleUiCallback(eventTime: number, fn: () => void): void {
    const now = this.audioContext?.currentTime ?? 0;
    const delayMs = Math.max(0, (eventTime - now) * 1000);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      if (this.isRunning) fn();
    }, delayMs);
    this.pendingTimers.add(timer);
  }

  private handleNoteEvent(event: NoteEvent): void {
    // Measure real main-thread receive lateness. This is the number that
    // determines whether Math.max(time, currentTime) will clamp in the audio
    // engine — the worklet's internal scheduling precision is ~0 by
    // construction and not worth recording.
    if (this.audioContext) {
      measureAndReportLateness(event.time, this.audioContext.currentTime, audioMetrics);
    }

    const { type: instrumentType, presetId } = parseInstrumentId(event.sampleId);

    // Apply volume p-lock at track level (same guard as scheduler.ts:514)
    // Use volumeMultiplier to detect presence of a volume p-lock,
    // matching the original scheduler's `pLock?.volume !== undefined` check
    const hasVolumePLock = event.volumeMultiplier !== 1;
    if (hasVolumePLock) {
      audioEngine.setTrackVolume(event.trackId, event.volume);
    }

    // Dispatch to the appropriate play method
    this.playInstrumentNote(
      instrumentType,
      presetId,
      event
    );

    // Schedule volume reset if p-lock was applied (tracked for cleanup on stop).
    // Capture the track's base volume now so the callback doesn't depend on
    // getState() which is nulled on stop().
    if (hasVolumePLock) {
      const state = this.getState?.();
      const track = state?.tracks.find(t => t.id === event.trackId);
      if (track) {
        const baseVolume = track.volume;
        const trackId = event.trackId;
        const delayMs = event.duration * 1000 + 50;
        const timer = setTimeout(() => {
          this.pendingTimers.delete(timer);
          if (this.isRunning) {
            audioEngine.setTrackVolume(trackId, baseVolume);
          }
        }, delayMs);
        this.pendingTimers.add(timer);
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

      // All bus-routed branches pass volumeMultiplier (p-lock only); the
      // bus's volumeGain handles per-track volume. See bug_010 — passing
      // `event.volume = track.volume × multiplier` would be double-applied.
      case 'sampled': {
        if (!audioEngine.isSampledInstrumentReady(presetId)) return;
        const midiNote = SCHEDULER_BASE_MIDI_NOTE + event.pitchSemitones;
        audioEngine.playSampledInstrument(presetId, event.noteId, midiNote, event.time, event.duration, event.volumeMultiplier, event.trackId);
        break;
      }

      case 'tone':
        if (!audioEngine.isToneSynthReady('tone')) return;
        audioEngine.playToneSynth(
          presetId as Parameters<typeof audioEngine.playToneSynth>[0],
          event.pitchSemitones, event.time, event.duration, event.volumeMultiplier, event.trackId
        );
        break;

      case 'advanced':
        if (!audioEngine.isToneSynthReady('advanced')) return;
        audioEngine.playAdvancedSynth(presetId, event.pitchSemitones, event.time, event.duration, event.volumeMultiplier, event.trackId);
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
