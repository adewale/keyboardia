import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VALID_SAMPLE_IDS } from '../components/sample-constants';
import { parseInstrumentId } from './instrument-types';
import { Scheduler } from './scheduler';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';
import { resolveNoteDynamics } from './note-dynamics';
import type { GridState, Track } from '../types';
import { getEnvelopeCapability } from '../shared/envelope-capabilities';
import { getPresetTrackEnvelopeV2 } from '../shared/envelope';
import { resolveEnvelopeV2 } from '../shared/envelope-contract-v2';

const playSampledInstrument = vi.fn<(...args: unknown[]) => void>();
const playToneSynth = vi.fn<(...args: unknown[]) => void>();
const playAdvancedSynth = vi.fn<(...args: unknown[]) => void>();
const playSynthNote = vi.fn<(...args: unknown[]) => void>();
const playSample = vi.fn<(...args: unknown[]) => void>();
const setTrackVolume = vi.fn<(...args: unknown[]) => void>();

vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
    isToneSynthReady: () => true,
    isSampledInstrumentReady: () => true,
    getCurrentTime: () => 0,
    setTrackVolume: (...a: unknown[]) => setTrackVolume(...a),
    playSampledInstrument: (...a: unknown[]) => playSampledInstrument(...a),
    playToneSynth: (...a: unknown[]) => playToneSynth(...a),
    playAdvancedSynth: (...a: unknown[]) => playAdvancedSynth(...a),
    playSynthNote: (...a: unknown[]) => playSynthNote(...a),
    playSample: (...a: unknown[]) => playSample(...a),
  },
}));

const ALL_VALID_SAMPLE_IDS = [...VALID_SAMPLE_IDS].sort();
const PITCH_LOCK = 5;
const VOLUME_LOCK = 0.73;
const TRACK_VOLUME = 0.8;
const STEP_TIME = 1.25;
const STEP_DURATION = 0.125;
const EXPECTED_NOTE_DURATION = STEP_DURATION * 0.9;

function resetSpies(): void {
  playSampledInstrument.mockClear();
  playToneSynth.mockClear();
  playAdvancedSynth.mockClear();
  playSynthNote.mockClear();
  playSample.mockClear();
  setTrackVolume.mockClear();
}

function buildTrack(sampleId: string): Track {
  const steps = Array(16).fill(false) as boolean[];
  steps[0] = true;
  const parameterLocks = Array(16).fill(null) as Track['parameterLocks'];
  parameterLocks[0] = { pitch: PITCH_LOCK, volume: VOLUME_LOCK };
  return {
    id: `track-${sampleId.replace(/[^a-z0-9]+/gi, '-')}`,
    name: sampleId,
    sampleId,
    steps,
    parameterLocks,
    volume: TRACK_VOLUME,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    swing: 0,
  };
}

function flushOneStep(scheduler: Scheduler, sampleId: string): Track {
  const track = buildTrack(sampleId);
  const state: GridState = {
    tracks: [track],
    tempo: 120,
    swing: 0,
    isPlaying: true,
    currentStep: 0,
  };
  (scheduler as unknown as { getState: () => GridState }).getState = () => state;
  (scheduler as unknown as {
    scheduleStep: (state: GridState, step: number, time: number, dur: number) => void;
  }).scheduleStep(state, 0, STEP_TIME, STEP_DURATION);
  return track;
}

describe('scheduler instrument matrix — every valid step dispatches to an audio path', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
    resetSpies();
  });

  afterEach(() => {
    scheduler.stop();
    vi.restoreAllMocks();
  });

  it('covers the full 99-instrument active catalog after the Rhodes quarantine', () => {
    expect(ALL_VALID_SAMPLE_IDS.length).toBe(99);
  });

  it.each(ALL_VALID_SAMPLE_IDS)('%s active step routes to the expected play method', (sampleId) => {
    const track = flushOneStep(scheduler, sampleId);
    const { type, presetId } = parseInstrumentId(sampleId);
    const noteId = `${track.id}:voice:0:0`;
    const dynamics = resolveNoteDynamics(VOLUME_LOCK);
    const playbackMode = getEnvelopeCapability(sampleId).defaultPlaybackMode ?? 'gate';
    const resolvedEnvelope = resolveEnvelopeV2(getPresetTrackEnvelopeV2(sampleId), 120);
    const expectedDuration = playbackMode === 'trigger'
      || resolvedEnvelope.model === 'ad'
      || resolvedEnvelope.model === 'ahd'
      ? STEP_DURATION
      : EXPECTED_NOTE_DURATION;

    // The track bus remains at its base fader; only the voice receives the
    // per-note multiplier, so 73% does not become 73% squared.
    expect(setTrackVolume).not.toHaveBeenCalled();

    switch (type) {
      case 'sampled':
        expect(playSampledInstrument).toHaveBeenCalledTimes(1);
        expect(playSampledInstrument).toHaveBeenCalledWith(
          presetId,
          noteId,
          SCHEDULER_BASE_MIDI_NOTE + PITCH_LOCK,
          STEP_TIME,
          expectedDuration,
          dynamics.noteGain,
          track.id,
          dynamics.midiVelocity,
          undefined,
          playbackMode,
          resolvedEnvelope,
        );
        expect(playSample).not.toHaveBeenCalled();
        break;
      case 'synth':
        expect(playSynthNote).toHaveBeenCalledTimes(1);
        expect(playSynthNote).toHaveBeenCalledWith(
          noteId,
          presetId,
          PITCH_LOCK,
          STEP_TIME,
          expectedDuration,
          dynamics.noteGain,
          track.id,
          dynamics.midiVelocity,
          undefined,
          resolvedEnvelope,
        );
        break;
      case 'tone':
        expect(playToneSynth).toHaveBeenCalledTimes(1);
        expect(playToneSynth).toHaveBeenCalledWith(
          presetId,
          PITCH_LOCK,
          STEP_TIME,
          expectedDuration,
          dynamics.noteGain,
          track.id,
          dynamics.midiVelocity,
          undefined,
          resolvedEnvelope,
        );
        break;
      case 'advanced':
        expect(playAdvancedSynth).toHaveBeenCalledTimes(1);
        expect(playAdvancedSynth).toHaveBeenCalledWith(
          presetId,
          PITCH_LOCK,
          STEP_TIME,
          expectedDuration,
          dynamics.noteGain,
          track.id,
          dynamics.midiVelocity,
          undefined,
          resolvedEnvelope,
        );
        break;
      case 'sample':
      default:
        expect(playSample).toHaveBeenCalledTimes(1);
        expect(playSample).toHaveBeenCalledWith(
          sampleId,
          track.id,
          STEP_TIME,
          expectedDuration,
          PITCH_LOCK,
          dynamics.noteGain,
          dynamics.midiVelocity,
          undefined,
          undefined,
          resolvedEnvelope,
          playbackMode,
        );
        break;
    }

    const totalPlaybackCalls =
      playSampledInstrument.mock.calls.length +
      playToneSynth.mock.calls.length +
      playAdvancedSynth.mock.calls.length +
      playSynthNote.mock.calls.length +
      playSample.mock.calls.length;
    expect(totalPlaybackCalls).toBe(1);
  });

  it('applies gate and forwards A/D/R locks as one note-level envelope override', () => {
    const track = buildTrack('synth:lead');
    track.gate = 50;
    track.parameterLocks[0] = {
      pitch: PITCH_LOCK,
      volume: VOLUME_LOCK,
      attack: 0,
      decay: .25,
      release: 2,
    };
    const state: GridState = { tracks: [track], tempo: 120, swing: 0, isPlaying: true, currentStep: 0 };
    (scheduler as unknown as { getState: () => GridState }).getState = () => state;
    (scheduler as unknown as { scheduleStep: (state: GridState, step: number, time: number, duration: number) => void })
      .scheduleStep(state, 0, STEP_TIME, STEP_DURATION);

    expect(playSynthNote).toHaveBeenCalledWith(
      `${track.id}:voice:0:0`,
      'lead',
      PITCH_LOCK,
      STEP_TIME,
      STEP_DURATION * .5,
      VOLUME_LOCK,
      track.id,
      { attack: 0, decay: .25, release: 2 },
      {
        model: 'adsr',
        attackSeconds: 0,
        decaySeconds: .25,
        sustain: .8,
        releaseSeconds: 2,
      },
      true,
    );
  });
});
