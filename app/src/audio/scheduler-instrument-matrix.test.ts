import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VALID_SAMPLE_IDS } from '../components/sample-constants';
import { parseInstrumentId } from './instrument-types';
import { Scheduler } from './scheduler';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';
import { velocityFromMultiplier } from './velocity';
import type { GridState, Track } from '../types';

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

  it('covers the full 100-instrument catalog', () => {
    expect(ALL_VALID_SAMPLE_IDS.length).toBe(100);
  });

  it.each(ALL_VALID_SAMPLE_IDS)('%s active step routes to the expected play method', (sampleId) => {
    const track = flushOneStep(scheduler, sampleId);
    const { type, presetId } = parseInstrumentId(sampleId);
    const noteId = `${track.id}-step-0`;

    expect(setTrackVolume).toHaveBeenCalledWith(track.id, TRACK_VOLUME * VOLUME_LOCK);

    switch (type) {
      case 'sampled':
        expect(playSampledInstrument).toHaveBeenCalledTimes(1);
        expect(playSampledInstrument).toHaveBeenCalledWith(
          presetId,
          noteId,
          SCHEDULER_BASE_MIDI_NOTE + PITCH_LOCK,
          STEP_TIME,
          EXPECTED_NOTE_DURATION,
          VOLUME_LOCK,
          track.id,
          velocityFromMultiplier(VOLUME_LOCK),
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
          EXPECTED_NOTE_DURATION,
          VOLUME_LOCK,
          track.id,
        );
        break;
      case 'tone':
        expect(playToneSynth).toHaveBeenCalledTimes(1);
        expect(playToneSynth).toHaveBeenCalledWith(
          presetId,
          PITCH_LOCK,
          STEP_TIME,
          EXPECTED_NOTE_DURATION,
          VOLUME_LOCK,
          track.id,
        );
        break;
      case 'advanced':
        expect(playAdvancedSynth).toHaveBeenCalledTimes(1);
        expect(playAdvancedSynth).toHaveBeenCalledWith(
          presetId,
          PITCH_LOCK,
          STEP_TIME,
          EXPECTED_NOTE_DURATION,
          VOLUME_LOCK,
          track.id,
        );
        break;
      case 'sample':
      default:
        expect(playSample).toHaveBeenCalledTimes(1);
        expect(playSample).toHaveBeenCalledWith(
          sampleId,
          track.id,
          STEP_TIME,
          EXPECTED_NOTE_DURATION,
          PITCH_LOCK,
          VOLUME_LOCK,
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
});
