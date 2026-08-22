import { describe, expect, it } from 'vitest';
import type { WorkletTrack } from './scheduler-types';
import {
  makeVoiceIdV2,
  resolveNoteEventV2,
  type ResolveNoteEventInputV2,
  type SchedulerParameterLockV2,
  type SchedulerTrackV2,
} from './resolved-note-event-v2';

function track(overrides: Partial<SchedulerTrackV2> = {}): SchedulerTrackV2 {
  const steps = new Array(16).fill(false) as boolean[];
  const parameterLocks = new Array(16).fill(null) as (SchedulerParameterLockV2 | null)[];
  steps[0] = true;
  return {
    id: 'track-a',
    sampleId: 'synth:lead',
    steps,
    parameterLocks,
    stepCount: 16,
    muted: false,
    soloed: false,
    transpose: 0,
    swing: 0,
    ...overrides,
  };
}

function input(
  schedulerTrack: SchedulerTrackV2,
  overrides: Partial<ResolveNoteEventInputV2> = {},
): ResolveNoteEventInputV2 {
  return {
    track: schedulerTrack,
    globalStep: 0,
    scheduleOrdinal: 0,
    playbackEpoch: 1,
    stepTimeSeconds: 10,
    stepDurationSeconds: 0.125,
    globalSwing: 0,
    anySoloed: false,
    loopRegion: null,
    maxSteps: 128,
    defaultStepCount: 16,
    ...overrides,
  };
}

describe('ResolvedNoteEvent v2 production resolver', () => {
  it('resolves final-step gate, onset locks, tempo snapshot, and audible anchor once', () => {
    const steps = new Array(16).fill(false) as boolean[];
    const locks = new Array(16).fill(null) as ({
      tie?: boolean;
      attack?: number;
      hold?: number;
      decay?: number;
      release?: number;
      pitch?: number;
      volume?: number;
    } | null)[];
    steps[0] = steps[1] = steps[2] = true;
    locks[0] = { attack: 0, hold: 1, decay: 2, release: 4, pitch: 3, volume: 0.5 };
    locks[1] = { tie: true, release: 99 };
    locks[2] = { tie: true, attack: 99 };
    const resolution = resolveNoteEventV2(input(track({
      steps,
      parameterLocks: locks,
      gate: 50,
      envelopeTimeUnit: 'steps',
    }), { audibleOutputLatencySeconds: 0.021 }));

    expect(resolution.kind).toBe('note');
    if (resolution.kind !== 'note') return;
    expect(resolution.event.tiedSteps).toBe(3);
    expect(resolution.event.noteOffSeconds).toBeCloseTo(10.3125, 8);
    expect(resolution.event.durationSeconds).toBeCloseTo(0.3125, 8);
    expect(resolution.event.audibleAnchorSeconds).toBeCloseTo(10.021, 8);
    expect(resolution.event.envelopeLock).toEqual({
      attack: 0,
      hold: 1,
      decay: 2,
      release: 4,
    });
    expect(resolution.event.resolvedDurationLocks).toEqual({
      attackSeconds: 0,
      holdSeconds: 0.125,
      decaySeconds: 0.25,
      releaseSeconds: 0.5,
    });
    expect(resolution.event.pitchSemitones).toBe(3);
    expect(resolution.event.volumeMultiplier).toBe(0.5);
    expect(resolution.event.authoredEnvelope).toBe(true);
  });

  it('treats a custom-loop wrap tie as one voice and ignores continuation locks', () => {
    const steps = new Array(8).fill(false) as boolean[];
    const locks = new Array(8).fill(null) as ({ tie?: boolean; release?: number } | null)[];
    steps[5] = true;
    steps[4] = true;
    locks[4] = { tie: true, release: 7 };
    const schedulerTrack = track({ steps, parameterLocks: locks, stepCount: 8, gate: 100 });
    const onset = resolveNoteEventV2(input(schedulerTrack, {
      globalStep: 5,
      loopRegion: { start: 4, end: 5 },
    }));

    expect(onset.kind).toBe('note');
    if (onset.kind !== 'note') return;
    expect(onset.event.tiedSteps).toBe(2);
    expect(onset.event.durationSeconds).toBeCloseTo(0.25, 8);

    const continuation = resolveNoteEventV2(input(schedulerTrack, {
      globalStep: 4,
      scheduleOrdinal: 1,
      loopRegion: { start: 4, end: 5 },
      activeNote: onset.activeNote,
    }));
    expect(continuation).toEqual({
      kind: 'tie-continuation',
      activeNote: { ...onset.activeNote, scheduleOrdinal: 1, continuationsRemaining: 0 },
    });
  });

  it.each([
    ['global track cycle', null, [0, 1, 2, 3]],
    ['custom loop cycle', { start: 4, end: 5 }, [4, 5]],
  ] as const)('expires an all-tied cursor at the %s boundary', (_label, loopRegion, globalSteps) => {
    const steps = new Array(8).fill(false) as boolean[];
    const locks = new Array(8).fill(null) as ({ tie?: boolean } | null)[];
    for (const step of globalSteps) {
      steps[step] = true;
      locks[step] = { tie: true };
    }
    const schedulerTrack = track({
      steps,
      parameterLocks: locks,
      stepCount: loopRegion ? 8 : globalSteps.length,
      gate: 100,
    });
    let active: ResolveNoteEventInputV2['activeNote'];
    let firstVoiceId = '';
    for (let ordinal = 0; ordinal <= globalSteps.length; ordinal++) {
      const globalStep = globalSteps[ordinal % globalSteps.length]!;
      const resolution = resolveNoteEventV2(input(schedulerTrack, {
        globalStep,
        scheduleOrdinal: ordinal,
        activeNote: active,
        loopRegion,
      }));
      expect(resolution.kind).toBe(ordinal === 0 || ordinal === globalSteps.length
        ? 'note'
        : 'tie-continuation');
      if (resolution.kind === 'silent') return;
      active = resolution.activeNote;
      if (ordinal === 0 && resolution.kind === 'note') firstVoiceId = resolution.event.voiceId;
      if (ordinal === globalSteps.length && resolution.kind === 'note') {
        expect(resolution.event.voiceId).not.toBe(firstVoiceId);
      }
    }
  });

  it('makes trigger playback independent of gate and note-off', () => {
    const triggerAtZero = resolveNoteEventV2(input(track({ sampleId: 'sampled:piano', samplePlaybackMode: 'trigger', gate: 0 })));
    const triggerAtHundred = resolveNoteEventV2(input(track({ sampleId: 'sampled:piano', samplePlaybackMode: 'trigger', gate: 100 })));
    expect(triggerAtZero.kind).toBe('note');
    expect(triggerAtHundred.kind).toBe('note');
    if (triggerAtZero.kind !== 'note' || triggerAtHundred.kind !== 'note') return;
    expect(triggerAtZero.event.noteOffSeconds).toBeNull();
    expect(triggerAtHundred.event.noteOffSeconds).toBeNull();
    expect(triggerAtZero.event.durationSeconds).toBe(triggerAtHundred.event.durationSeconds);
  });

  it('treats Tone AD/AHD as finite and gate-independent', () => {
    const resolution = resolveNoteEventV2(input(track({
      sampleId: 'tone:membrane-kick',
      gate: 0,
      envelopeV2: {
        model: 'ahd',
        attack: { value: 0.01, unit: 'seconds' },
        hold: { value: 1, unit: 'seconds' },
        decay: { value: 2, unit: 'seconds' },
      },
    })));
    expect(resolution.kind).toBe('note');
    if (resolution.kind !== 'note') return;
    expect(resolution.event.noteOffSeconds).toBeNull();
    expect(resolution.event.durationSeconds).toBe(0.125);
    expect(resolution.event.authoredEnvelope).toBe(true);
  });

  it('uses explicit early note-off for gated playback without moving before onset', () => {
    const early = resolveNoteEventV2(input(track({ gate: 100 }), { explicitNoteOffSeconds: 10.02 }));
    const past = resolveNoteEventV2(input(track({ gate: 100 }), { explicitNoteOffSeconds: 9 }));
    expect(early.kind).toBe('note');
    expect(past.kind).toBe('note');
    if (early.kind !== 'note' || past.kind !== 'note') return;
    expect(early.event.noteOffSeconds).toBe(10.02);
    expect(past.event.noteOffSeconds).toBe(10);
  });

  it('reports the simple-sample pitch-worklet audible anchor without shifting source onset', () => {
    const parameterLocks = new Array(16).fill(null) as (SchedulerParameterLockV2 | null)[];
    parameterLocks[0] = { pitch: 7 };
    const resolution = resolveNoteEventV2(input(track({
      sampleId: '808-kick',
      parameterLocks,
      largePitchShiftLatencySeconds: 1024 / 48_000,
    })));
    expect(resolution.kind).toBe('note');
    if (resolution.kind !== 'note') return;
    expect(resolution.event.onsetSeconds).toBe(10);
    expect(resolution.event.audibleAnchorSeconds).toBeCloseTo(10 + 1024 / 48_000, 10);
  });

  it('generates deterministic IDs that do not repeat across onsets or playback epochs', () => {
    const ids = new Set([
      makeVoiceIdV2('track-a', 1, 0),
      makeVoiceIdV2('track-a', 1, 1),
      makeVoiceIdV2('track-a', 2, 0),
      makeVoiceIdV2('track-b', 1, 0),
    ]);
    expect(ids.size).toBe(4);
    expect(makeVoiceIdV2('track-a', 1, 0)).toBe('track-a:voice:1:0');
  });

  it('keeps main-track and serialized worklet payload resolution identical', () => {
    const steps = new Array(16).fill(false) as boolean[];
    const locks = new Array(16).fill(null) as WorkletTrack['parameterLocks'];
    steps[1] = steps[2] = true;
    locks[1] = { pitch: -5, volume: 0, attack: 0, decay: 2, release: 3 };
    locks[2] = { tie: true, release: 8 };
    const mainTrack = track({
      id: 'parity',
      steps,
      parameterLocks: locks,
      transpose: 12,
      swing: 35,
      gate: 75,
      envelopeTimeUnit: 'steps',
      samplePlaybackMode: 'loop',
    });
    const workletTrack = JSON.parse(JSON.stringify(mainTrack)) as WorkletTrack;
    const common = {
      globalStep: 1,
      scheduleOrdinal: 37,
      playbackEpoch: 4,
      stepTimeSeconds: 2,
      stepDurationSeconds: 0.1,
      globalSwing: 0.2,
      anySoloed: false,
      loopRegion: null,
      maxSteps: 128,
      defaultStepCount: 16,
    } as const;

    const main = resolveNoteEventV2({ track: mainTrack, ...common });
    const worklet = resolveNoteEventV2({ track: workletTrack, ...common });
    expect(worklet).toEqual(main);
    expect(JSON.parse(JSON.stringify(worklet))).toEqual(worklet);
  });

  it('resolves canonical sample mode and mixed-unit typed locks at onset, preserving zeroes', () => {
    const parameterLocks = new Array(16).fill(null) as (SchedulerParameterLockV2 | null)[];
    parameterLocks[0] = {
      attackDuration: { value: 0, unit: 'seconds' },
      decayDuration: { value: 2, unit: 'steps' },
      releaseDuration: { value: 0, unit: 'steps' },
    };
    const resolution = resolveNoteEventV2(input(track({
      sampleId: 'sampled:hammond-organ',
      samplePlaybackMode: 'loop',
      envelopeV2: {
        model: 'adsr',
        attack: { value: 2, unit: 'steps' },
        decay: { value: 0.3, unit: 'seconds' },
        sustain: 0.4,
        release: { value: 4, unit: 'steps' },
      },
      parameterLocks,
    }), { tempoBpm: 150, stepDurationSeconds: 0.1 }));

    expect(resolution.kind).toBe('note');
    if (resolution.kind !== 'note') return;
    expect(resolution.event.playbackMode).toBe('loop');
    expect(resolution.event.resolvedDurationLocks).toEqual({
      attackSeconds: 0,
      decaySeconds: 0.2,
      releaseSeconds: 0,
    });
    expect(resolution.event.resolvedEnvelope).toEqual({
      model: 'adsr',
      attackSeconds: 0,
      decaySeconds: 0.2,
      sustain: 0.4,
      releaseSeconds: 0,
    });
  });
});
