import type { GridState } from '../types';
import { MAX_STEPS, DEFAULT_STEP_COUNT } from '../types';
import { audioEngine } from './engine';
import { logger } from '../utils/logger';
import { registerHmrDispose } from '../utils/hmr';
import { SCHEDULE_AHEAD_SEC, type IScheduler } from './scheduler-types';
import { features } from '../config/features';
import { supportsAudioWorklet } from './worklet-support';
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
import {
  advanceStep,
  calculateStepTime,
  getStepDuration,
  STEPS_PER_BEAT,
} from './timing-calculations';
import type { EnvelopeNoteLock } from './envelope-translate';
import { DEFAULT_TRACK_GATE } from '../shared/envelope';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';
import { resolveHumanizedNoteDynamics } from './note-dynamics';
import { computeJoinOffset } from './scheduler-multiplayer-sync';
import { shouldTrackPlay, shouldTrackTrigger } from './track-step';
import {
  resolveNoteEventV2,
  type ActiveNoteCursorV2,
  type ResolvedNoteEventV2,
  type SchedulerTrackV2,
} from './resolved-note-event-v2';
import { getEnvelopeCapability } from '../shared/envelope-capabilities';
import type { ResolvedEnvelopeV2, SamplePlaybackMode } from '../shared/envelope-contract-v2';

// =============================================================================
// Constants
// =============================================================================

const LOOKAHEAD_MS = 25; // How often to check (ms)

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
  midiVelocity: number;
  noteGain: number;
  hasExplicitLock: boolean;
  loopIteration: number;
  volumeMultiplier: number;
  playbackMode: SamplePlaybackMode;
  resolvedEnvelope: ResolvedEnvelopeV2;
  authoredEnvelope: boolean;
  envelopeLock?: EnvelopeNoteLock;
}

export class Scheduler implements IScheduler {
  private timerId: number | null = null;
  private nextStepTime: number = 0;
  private currentStep: number = 0; // Global step counter (0-63 for 4 bars)
  private isRunning: boolean = false;
  private onStepChange: ((step: number) => void) | null = null;
  private onBeat: ((beat: number) => void) | null = null; // Phase 31A: Beat callback for metronome pulse
  private getState: (() => GridState) | null = null;
  private lastNotifiedStep: number = -1; // Track last UI update to prevent flickering
  private lastNotifiedBeat: number = -1; // Phase 31A: Track last beat to prevent duplicate callbacks
  private loopIteration: number = 0;

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

  // The shared resolver uses the monotonic scheduling ordinal, rather than a
  // wrapped grid index, so ties survive page/custom-loop boundaries correctly.
  private activeNotes: Map<string, ActiveNoteCursorV2> = new Map();
  private playbackEpoch = 0;

  constructor() {
    this.scheduleLoop = this.scheduleLoop.bind(this);
    // Debug: Track singleton instances
    registerSchedulerInstance(this);
  }

  /** bug_005: expose registered callbacks so upgradeToWorkletScheduler can copy them. */
  getOnBeat(): ((beat: number) => void) | null {
    return this.onBeat;
  }
  getOnStepChange(): ((step: number) => void) | null {
    return this.onStepChange;
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
    this.playbackEpoch += 1;
    this.lastNotifiedStep = -1;
    this.totalStepsScheduled = 0; // Phase 13B: Reset step counter for drift-free timing
    this.loopIteration = 0;
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
      const state = getState();
      const { currentStep, nextStepTime } = computeJoinOffset({
        audioStartTime: this.audioStartTime,
        serverStartTime,
        currentServerTime: this.getServerTime(),
        tempo: state.tempo,
        maxSteps: MAX_STEPS,
        loopStart: state.loopRegion?.start ?? 0,
      });
      this.currentStep = currentStep;
      this.nextStepTime = nextStepTime;
      logger.multiplayer.log(`Joining at step ${this.currentStep}`);
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
    // Phase 13B: Clear all pending UI notification timers.
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
    const stepDuration = getStepDuration(state.tempo);

    // Phase 22: Detect BPM changes during playback and recalculate timing reference
    // Without this fix, changing BPM causes nextStepTime to jump (since it's calculated as
    // audioStartTime + totalStepsScheduled * stepDuration), which makes the scheduler
    // try to "catch up" by scheduling many notes rapidly.
    if (this.lastTempo !== 0 && this.lastTempo !== state.tempo) {
      // BPM changed! Recalculate audioStartTime to maintain current position
      // Formula: audioStartTime = currentTime - (totalStepsScheduled * NEW_stepDuration)
      // This ensures nextStepTime ≈ currentTime after the change
      const oldStepDuration = getStepDuration(this.lastTempo);
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
      const previousStep = this.currentStep;
      this.currentStep = advanceStep(this.currentStep, state.loopRegion ?? null, MAX_STEPS);
      if (this.currentStep <= previousStep) this.loopIteration++;
      this.totalStepsScheduled++;

      // Phase 13B: Use multiplicative timing to prevent drift
      // Instead of: this.nextStepTime += stepDuration (accumulates floating-point errors)
      // We compute: nextStepTime = startTime + (stepCount * stepDuration)
      this.nextStepTime = calculateStepTime(
        this.audioStartTime,
        this.totalStepsScheduled,
        state.tempo,
      );
    }
  }

  // ===========================================================================
  // Helper Methods for scheduleStep (H-03 refactoring)
  // ===========================================================================

  /**
   * Play a note on the appropriate instrument.
   * Replaces the large switch statement with a cleaner dispatch.
   */
  private playInstrumentNote(params: NoteParams): void {
    const {
      instrumentType, presetId, pitchSemitones, time, duration, midiVelocity,
      noteGain, noteId, trackId, envelopeLock, playbackMode, resolvedEnvelope,
      authoredEnvelope,
    } = params;

    // All play methods route through TrackBus, whose volumeGain already
    // multiplies by track.volume. Pass only canonical per-note gain here so
    // the bus doesn't double-apply the track volume
    // (bug_010 — for the affected branches the previous code passed
    // `volume = track.volume × noteGain` and the bus then multiplied by
    // track.volume again, giving track.volume² × noteGain).
    switch (instrumentType) {
      case 'synth':
        logger.audio.log(`Playing synth ${presetId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, gain=${noteGain}, velocity=${midiVelocity}, dur=${duration.toFixed(3)}`);
        if (authoredEnvelope) {
          audioEngine.playSynthNote(noteId, presetId, pitchSemitones, time, duration, noteGain, trackId, midiVelocity, envelopeLock, resolvedEnvelope, true);
        } else {
          audioEngine.playSynthNote(noteId, presetId, pitchSemitones, time, duration, noteGain, trackId, midiVelocity, envelopeLock, resolvedEnvelope);
        }
        break;

      case 'sampled': {
        if (!audioEngine.isSampledInstrumentReady(presetId)) {
          logger.audio.warn(`Sampled instrument ${presetId} not ready, skipping`);
          return;
        }
        const midiNote = SCHEDULER_BASE_MIDI_NOTE + pitchSemitones;
        logger.audio.log(`Playing sampled ${presetId} at time ${time.toFixed(3)}, midiNote=${midiNote}, gain=${noteGain.toFixed(3)}, vel=${midiVelocity}, dur=${duration.toFixed(3)}`);
        audioEngine.playSampledInstrument(
          presetId,
          noteId,
          midiNote,
          time,
          duration,
          noteGain,
          trackId,
          midiVelocity,
          envelopeLock,
          playbackMode,
          resolvedEnvelope,
        );
        break;
      }

      case 'tone':
        if (!audioEngine.isToneSynthReady('tone')) {
          logger.audio.warn(`Tone.js not ready, skipping ${params.sampleId}`);
          return;
        }
        logger.audio.log(`Playing Tone.js ${presetId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, gain=${noteGain.toFixed(3)}, velocity=${midiVelocity}, dur=${duration.toFixed(3)}`);
        audioEngine.playToneSynth(presetId as Parameters<typeof audioEngine.playToneSynth>[0], pitchSemitones, time, duration, noteGain, trackId, midiVelocity, envelopeLock, resolvedEnvelope);
        break;

      case 'advanced':
        if (!audioEngine.isToneSynthReady('advanced')) {
          logger.audio.warn(`Advanced synth not ready, skipping ${params.sampleId}`);
          return;
        }
        logger.audio.log(`Playing Advanced ${presetId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, gain=${noteGain.toFixed(3)}, velocity=${midiVelocity}, dur=${duration.toFixed(3)}`);
        audioEngine.playAdvancedSynth(presetId, pitchSemitones, time, duration, noteGain, trackId, midiVelocity, envelopeLock, resolvedEnvelope);
        break;

      case 'sample':
      default:
        logger.audio.log(`Playing ${params.sampleId} at time ${time.toFixed(3)}, pitch=${pitchSemitones}, gain=${noteGain}, velocity=${midiVelocity}, dur=${duration.toFixed(3)}`);
        audioEngine.playSample(
          params.sampleId,
          trackId,
          time,
          duration,
          pitchSemitones,
          noteGain,
          midiVelocity,
          params.hasExplicitLock ? undefined : `${noteId}-loop-${params.loopIteration}`,
          envelopeLock,
          resolvedEnvelope,
          playbackMode,
        );
        break;
    }
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
  ): ResolvedNoteEventV2[] {
    const state = this.getState?.();
    if (!state) return [];

    const anySoloed = state.tracks.some(t => t.soloed);
    const globalSwing = state.swing / 100;
    const resolvedEvents: ResolvedNoteEventV2[] = [];

    // DEBUG: Log solo state on first step of each bar
    if (globalStep === 0 && anySoloed) {
      const soloedTracks = state.tracks.filter(t => t.soloed).map(t => t.sampleId);
      logger.audio.log(`[SOLO DEBUG] anySoloed=${anySoloed}, soloedTracks:`, soloedTracks);
    }

    for (const track of state.tracks) {
      // Keep debug-only mute/solo reporting outside the pure event resolver.
      if (!shouldTrackTrigger(track, globalStep, anySoloed)) {
        if (anySoloed && globalStep === 0 && !shouldTrackPlay(track, anySoloed)) {
          logger.audio.log(`[SOLO DEBUG] Track "${track.sampleId}" NOT playing (soloed=${track.soloed}, muted=${track.muted})`);
        }
      }

      const latencyProbe = (audioEngine as typeof audioEngine & {
        getAudibleOutputLatencySeconds?: (sampleId: string, pitchSemitones: number) => number;
      }).getAudibleOutputLatencySeconds;
      const schedulerTrack: SchedulerTrackV2 = {
        ...track,
        largePitchShiftLatencySeconds: latencyProbe?.call(audioEngine, track.sampleId, 7) ?? 0,
      };
      const resolution = resolveNoteEventV2({
        track: schedulerTrack,
        globalStep,
        scheduleOrdinal: this.totalStepsScheduled,
        playbackEpoch: this.playbackEpoch,
        stepTimeSeconds: time,
        stepDurationSeconds: duration,
        globalSwing,
        anySoloed,
        activeNote: this.activeNotes.get(track.id),
        loopRegion: state.loopRegion ?? null,
        maxSteps: MAX_STEPS,
        defaultStepCount: DEFAULT_STEP_COUNT,
        defaultGatePercent: DEFAULT_TRACK_GATE,
        defaultPlaybackMode: getEnvelopeCapability(track.sampleId).defaultPlaybackMode ?? 'gate',
        tempoBpm: state.tempo,
      });

      if (resolution.kind === 'silent') continue;
      this.activeNotes.set(track.id, resolution.activeNote);
      if (resolution.kind === 'tie-continuation') {
        logger.audio.log(`Tied note on ${track.sampleId}, continuing voice ${resolution.activeNote.voiceId}`);
        continue;
      }

      const event = resolution.event;
      resolvedEvents.push(event);

      // Debug: Track note scheduling
      instrumentNoteSchedule(track.sampleId, event.trackStep, event.time, this.isRunning);

      const pLock = track.parameterLocks[event.trackStep];
      const dynamics = resolveHumanizedNoteDynamics(
        pLock?.volume,
        track.sampleId,
        track.id,
        globalStep,
        this.loopIteration,
      );

      // Parse instrument and build note params
      const { type: instrumentType, presetId } = parseInstrumentId(track.sampleId);
      const noteParams: NoteParams = {
        trackId: event.trackId,
        noteId: event.noteId,
        sampleId: event.sampleId,
        instrumentType,
        presetId,
        pitchSemitones: event.pitchSemitones,
        time: event.time,
        duration: event.duration,
        volumeMultiplier: event.volumeMultiplier,
        playbackMode: event.playbackMode,
        resolvedEnvelope: event.resolvedEnvelope,
        authoredEnvelope: event.authoredEnvelope,
        envelopeLock: event.envelopeLock,
        ...dynamics,
        loopIteration: this.loopIteration,
      };

      // Play the note
      this.playInstrumentNote(noteParams);
    }
    return resolvedEvents;
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  isPlaying(): boolean {
    return this.isRunning;
  }

  // No-op: the main-thread scheduler calls this.getState() every tick,
  // so updated grid state is picked up implicitly. Present only to satisfy
  // the IScheduler interface shared with the worklet host.
  updateState(_state: GridState): void {
    void _state;
  }
}

// Singleton instance — reassigned by upgradeToWorkletScheduler() when feature flag is on
export let scheduler: IScheduler = new Scheduler();

/**
 * Attempt to upgrade from main-thread scheduler to AudioWorklet scheduler.
 * Only upgrades if the workletScheduler feature flag is on and the browser supports it.
 * Returns true if the upgrade succeeded.
 */
export async function upgradeToWorkletScheduler(ctx: AudioContext): Promise<boolean> {
  if (!features.workletScheduler) return false;
  if (!supportsAudioWorklet(ctx)) return false;

  try {
    const { SchedulerWorkletHost } = await import('./scheduler-worklet-host');
    const host = new SchedulerWorkletHost();
    const ok = await host.initialize(ctx);
    if (!ok) return false;

    if (scheduler.isPlaying()) {
      scheduler.stop();
    }
    // Migrate any callbacks already registered on the old scheduler.
    // Without this, components like StepSequencer that registered an
    // onBeat handler in a useEffect with stable deps lose the
    // metronome pulse forever after the swap (bug_005).
    const oldBeat = (scheduler as unknown as { getOnBeat?: () => ((b: number) => void) | null }).getOnBeat?.();
    const oldStep = (scheduler as unknown as { getOnStepChange?: () => ((s: number) => void) | null }).getOnStepChange?.();
    scheduler = host;
    if (oldBeat) host.setOnBeat(oldBeat);
    if (oldStep) host.setOnStepChange(oldStep);
    logger.audio.log('Upgraded to worklet scheduler');
    return true;
  } catch (err) {
    logger.audio.warn('Worklet scheduler upgrade failed, keeping main-thread scheduler:', err);
    return false;
  }
}

// HMR cleanup - stops playback and resets tracking during development
registerHmrDispose('Scheduler', () => {
  if (scheduler.isPlaying()) {
    scheduler.stop();
  }
  resetSchedulerTracking();
});
