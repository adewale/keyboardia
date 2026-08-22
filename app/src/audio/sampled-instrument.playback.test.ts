import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { ChokeGroupRegistry } from './choke-groups';
import { sampleCache } from './lru-sample-cache';
import {
  FakeAudioContext,
  FakeGainNode,
  makeSampleFetchStub,
} from './__fakes__/FakeWebAudio';
import {
  ATTACK_FADE_SEC,
  RELEASE_FLOOR_GAIN,
  RELEASE_TAIL_GUARD_SEC,
} from './note-schedule';

/**
 * Behavioural tests for SampledInstrument.playNote — the function that
 * turns a scheduled note event into Web Audio calls. Covers the fixes
 * from SAMPLE-AUDIT-2026-06:
 *
 *   P1  scheduled start time honoured (was: source.start() immediately)
 *   P1b sprite offsets honoured again
 *   P2  velocity selects velocity layers (was: never reachable)
 *   P4  sustain loops
 *   P5  choke groups
 *   P6  declick attack, downshift tie-break, manifest gainDb
 */

let instrumentCounter = 0;

interface LoadOptions {
  manifest: Partial<InstrumentManifest> & { samples: InstrumentManifest['samples'] };
  chokeRegistry?: ChokeGroupRegistry;
}

async function loadInstrument({ manifest, chokeRegistry }: LoadOptions) {
  const id = manifest.id ?? `test-instrument-${++instrumentCounter}`;
  const fullManifest: InstrumentManifest = {
    name: 'Test Instrument',
    type: 'sampled',
    releaseTime: 0.5,
    ...manifest,
    id,
  };
  vi.stubGlobal('fetch', makeSampleFetchStub(fullManifest));

  const ctx = new FakeAudioContext();
  const destination = new FakeGainNode();
  const instrument = new SampledInstrument(id, '/instruments', { chokeRegistry });
  instrument.initialize(ctx.asAudioContext(), destination as unknown as AudioNode);

  const loaded = await instrument.ensureLoaded();
  expect(loaded).toBe(true);
  // Progressive loading: wait for the background batch (including all
  // velocity layers, which share a note) to finish.
  const distinctNotes = [...new Set(fullManifest.samples.map(s => s.note))];
  await vi.waitFor(() => {
    const loadedLayers = distinctNotes.reduce(
      (sum, note) => sum + instrument.getVelocityLayerCount(note),
      0
    );
    expect(loadedLayers).toBe(fullManifest.samples.length);
  });

  return { ctx, destination, instrument };
}

beforeEach(() => {
  sampleCache.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SINGLE_SAMPLE = { samples: [{ note: 60, file: 'C4.mp3' }] };

describe('playNote scheduling (P1)', () => {
  it('does not try to resume an OfflineAudioContext before rendering', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: SINGLE_SAMPLE });
    ctx.state = 'suspended';
    Object.assign(ctx, { startRendering: vi.fn() });

    instrument.playNote('offline', 60, 0, 0.25, 1);

    expect(ctx.resumeCalls).toBe(0);
  });

  it('starts the source at the scheduled time, not immediately', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: SINGLE_SAMPLE });
    ctx.currentTime = 1.0;

    instrument.playNote('n1', 60, 5.0, 0.25, 1);

    expect(ctx.lastSource.startCalls).toEqual([
      expect.objectContaining({ when: 5.0 }),
    ]);
  });

  it('clamps late notes to currentTime instead of throwing', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: SINGLE_SAMPLE });
    ctx.currentTime = 2.0;

    instrument.playNote('n1', 60, 1.5, 0.25, 1);

    expect(ctx.lastSource.startCalls[0].when).toBe(2.0);
  });

  it('anchors the release envelope to the scheduled start, not the wall clock', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: { ...SINGLE_SAMPLE, releaseTime: 0.8 },
    });
    ctx.currentTime = 0;

    instrument.playNote('n1', 60, 5.0, 0.5, 0.7);

    const gain = ctx.lastGain.gain;
    // Sustain level is held until the note ends at startTime + duration...
    const hold = gain.eventsOfType('setValueAtTime').at(-1)!;
    expect(hold.time).toBe(5.5);
    // ...then released over releaseTime.
    const release = gain.eventsOfType('exponentialRampToValueAtTime')[0];
    expect(release.value).toBe(RELEASE_FLOOR_GAIN);
    expect(release.time).toBeCloseTo(6.3, 10);
    const silence = gain.eventsOfType('linearRampToValueAtTime').at(-1)!;
    expect(silence.value).toBe(0);
    expect(silence.time).toBeCloseTo(6.3 + RELEASE_TAIL_GUARD_SEC, 10);
    // Source stops after the release tail.
    expect(ctx.lastSource.stopCalls[0]).toBeCloseTo(
      6.3 + RELEASE_TAIL_GUARD_SEC,
      10
    );
  });

  it('applies a declick attack ramp from silence at the start time', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: SINGLE_SAMPLE });
    ctx.currentTime = 0;

    instrument.playNote('n1', 60, 5.0, 0.25, 0.9);

    const gain = ctx.lastGain.gain;
    const zero = gain.eventsOfType('setValueAtTime')[0];
    expect(zero.value).toBe(0.0001);
    expect(zero.time).toBe(5.0);
    const attack = gain.eventsOfType('linearRampToValueAtTime')[0];
    expect(attack.value).toBeCloseTo(0.9, 10);
    expect(attack.time).toBeCloseTo(5.003, 10);
  });

  it('uses authored sample attack/release while ignoring decay and sustain', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: { ...SINGLE_SAMPLE, releaseTime: .8 },
    });
    ctx.currentTime = 0;

    instrument.playNote(
      'n1', 60, 5, .25, .9, 127, undefined, 'default',
      { attack: .12, decay: 4, sustain: 0, release: .3 },
    );

    const gain = ctx.lastGain.gain;
    expect(gain.eventsOfType('linearRampToValueAtTime')[0]?.time).toBeCloseTo(5.12, 10);
    expect(gain.eventsOfType('exponentialRampToValueAtTime')[0]?.time).toBeCloseTo(5.55, 10);
  });

  it('releases from the held attack level when the gate closes before attack completes', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: SINGLE_SAMPLE });

    instrument.playNote(
      'n1', 60, 5, .1, .8, 127, undefined, 'default',
      { attack: .5, decay: 0, sustain: 1, release: .2 },
    );

    const ramps = ctx.lastGain.gain.eventsOfType('linearRampToValueAtTime');
    expect(ramps).toHaveLength(1);
    expect(ramps[0]).toMatchObject({ time: 5.1 });
    expect(ramps[0]!.value).toBeCloseTo(.0001 + (.8 - .0001) * .2, 10);
    expect(ctx.lastGain.gain.eventsOfType('setValueAtTime'))
      .not.toContainEqual(expect.objectContaining({ value: .8, time: 5.1 }));
  });

  it('honours a zero release without inserting a hidden 10ms tail', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: SINGLE_SAMPLE });

    instrument.playNote(
      'n1', 60, 5, .25, .8, 127, undefined, 'default',
      { attack: 0, decay: 0, sustain: 1, release: 0 },
    );

    expect(ctx.lastGain.gain.eventsOfType('exponentialRampToValueAtTime')).toHaveLength(0);
    expect(ctx.lastGain.gain.eventsOfType('setValueAtTime'))
      .toContainEqual(expect.objectContaining({ value: .0001, time: 5.25 }));
    expect(ctx.lastSource.stopCalls[0]).toBeCloseTo(5.25 + RELEASE_TAIL_GUARD_SEC, 10);
  });

  it('plays sprite samples from their offset for their duration', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        sprite: 'all.mp3',
        samples: [
          { note: 60, offset: 1.5, duration: 2.0 },
          { note: 72, offset: 4.0, duration: 1.0 },
        ],
      },
    });
    ctx.currentTime = 0;

    instrument.playNote('n1', 60, 3.0, 0.25, 1);

    expect(ctx.lastSource.startCalls[0]).toEqual({
      when: 3.0,
      offset: 1.5,
      duration: 2.0,
    });
  });
});

describe('velocity layers (P2)', () => {
  const THREE_LAYERS = {
    samples: [
      { note: 60, file: 'C4-pp.mp3', velocityMin: 0, velocityMax: 50 },
      { note: 60, file: 'C4-mf.mp3', velocityMin: 51, velocityMax: 100 },
      { note: 60, file: 'C4-ff.mp3', velocityMin: 101, velocityMax: 127 },
    ],
  };

  it('selects the pp layer for low velocity', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: THREE_LAYERS });
    instrument.playNote('n1', 60, 0, 0.25, 1, 30);
    expect(ctx.lastSource.buffer?.label).toBe('C4-pp.mp3');
  });

  it('selects the ff layer for maximum velocity', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: THREE_LAYERS });
    instrument.playNote('n1', 60, 0, 0.25, 1, 127);
    expect(ctx.lastSource.buffer?.label).toBe('C4-ff.mp3');
  });

  it('retains the full-velocity fallback when no layer input is given', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: THREE_LAYERS });
    instrument.playNote('n1', 60, 0, 0.25, 1);
    expect(ctx.lastSource.buffer?.label).toBe('C4-ff.mp3');
  });
});

describe('sample-specific playback metadata (pipeline stages 5-6)', () => {
  it('applies sample gain once in addition to the instrument trim', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        ...SINGLE_SAMPLE,
        gainDb: -6,
        samples: [{ note: 60, file: 'C4.mp3', gainDb: -6 }],
      },
    });

    instrument.playNote('n1', 60, 0, 0.25, 1);

    const attack = ctx.lastGain.gain.eventsOfType('linearRampToValueAtTime')[0];
    expect(attack.value).toBeCloseTo(Math.pow(10, -12 / 20), 5);
  });

  it('applies tuning cents and bounded playback offsets non-destructively', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        samples: [{
          note: 60,
          file: 'C4.mp3',
          tuneCents: -50,
          startOffset: 0.1,
          endOffset: 1.0,
        }],
      },
    });

    instrument.playNote('n1', 60, 2, 0.25, 1);

    expect(ctx.lastSource.playbackRate.value).toBeCloseTo(2 ** (-50 / 1200), 10);
    expect(ctx.lastSource.startCalls[0]).toEqual({ when: 2, offset: 0.1, duration: 0.9 });
  });

  it('uses a manifest-wide codec-delay trim unless a sample overrides it', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        startOffset: 0.048,
        samples: [{ note: 60, file: 'C4.m4a' }],
      },
    });

    instrument.playNote('n1', 60, 2, 0.25, 1);

    expect(ctx.lastSource.startCalls[0]).toEqual({ when: 2, offset: 0.048 });
  });

  it('adapts short decoder priming for percussion without clipping the attack', async () => {
    const id = '808-kick';
    const fullManifest: InstrumentManifest = {
      id,
      name: '808 Kick',
      type: 'sampled',
      releaseTime: 0.5,
      playbackNote: 36,
      samples: [{ note: 36, file: 'kick.mp3' }],
    };
    vi.stubGlobal('fetch', makeSampleFetchStub(fullManifest));
    const ctx = new FakeAudioContext();
    ctx.decodeAudioData = async () => {
      const buffer = ctx.createBuffer(1, 48_000, 48_000);
      buffer.getChannelData(0)[624] = 0.9; // 13 ms decoder priming
      return buffer;
    };
    const instrument = new SampledInstrument(id);
    instrument.initialize(ctx.asAudioContext(), new FakeGainNode() as unknown as AudioNode);
    expect(await instrument.ensureLoaded()).toBe(true);

    instrument.playNote('kick', 60, 2, 0.25, 1);

    expect(ctx.lastSource.startCalls[0].offset).toBeCloseTo(0.008, 8);
  });
});

describe('velocity crossfades and deterministic round robins (pipeline stage 7)', () => {
  it('crossfades adjacent velocity layers with gains that sum to note volume', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        velocityCrossfade: 8,
        samples: [
          { note: 60, file: 'soft.mp3', velocityMin: 0, velocityMax: 63 },
          { note: 60, file: 'loud.mp3', velocityMin: 64, velocityMax: 127 },
        ],
      },
    });
    const sourceStart = ctx.createdSources.length;
    const gainStart = ctx.createdGains.length;

    instrument.playNote('n1', 60, 0, 0.25, 1, 64);

    const sources = ctx.createdSources.slice(sourceStart);
    const gains = ctx.createdGains.slice(gainStart);
    expect(sources.map(source => source.buffer?.label)).toEqual(['soft.mp3', 'loud.mp3']);
    const attackValues = gains.map(gain => gain.gain.eventsOfType('linearRampToValueAtTime')[0].value);
    expect(attackValues[0] + attackValues[1]).toBeCloseTo(1, 10);
    expect(attackValues.every(value => value > 0 && value < 1)).toBe(true);
  });

  it('cycles round robins before repeating', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        samples: [
          { note: 60, file: 'rr2.mp3', roundRobinGroup: 'hit', roundRobinIndex: 2 },
          { note: 60, file: 'rr0.mp3', roundRobinGroup: 'hit', roundRobinIndex: 0 },
          { note: 60, file: 'rr1.mp3', roundRobinGroup: 'hit', roundRobinIndex: 1 },
        ],
      },
    });
    const start = ctx.createdSources.length;
    for (let i = 0; i < 4; i++) instrument.playNote(`n${i}`, 60, i, 0.25, 1);
    expect(ctx.createdSources.slice(start).map(source => source.buffer?.label))
      .toEqual(['rr0.mp3', 'rr1.mp3', 'rr2.mp3', 'rr0.mp3']);
  });
});

describe('nearest-sample tie-break (P6)', () => {
  it('prefers shifting DOWN from the higher sample when equidistant', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        samples: [
          { note: 55, file: 'G3.mp3' },
          { note: 65, file: 'F4.mp3' },
        ],
      },
    });

    instrument.playNote('n1', 60, 0, 0.25, 1);

    expect(ctx.lastSource.buffer?.label).toBe('F4.mp3');
    expect(ctx.lastSource.playbackRate.value).toBeCloseTo(
      Math.pow(2, -5 / 12),
      10
    );
  });
});

describe('sustain loops (P4)', () => {
  const LOOPED = {
    samples: [{ note: 60, file: 'C4.mp3', loop: true, loopStart: 0.8, loopEnd: 3.2 }],
  };

  it('enables looping for notes with a duration', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: LOOPED });
    instrument.playNote('n1', 60, 0, 2.0, 1);
    expect(ctx.lastSource.loop).toBe(true);
    expect(ctx.lastSource.loopStart).toBe(0.8);
    expect(ctx.lastSource.loopEnd).toBe(3.2);
  });

  it('does NOT loop sustained notes with no duration (nothing would ever stop them)', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: LOOPED });
    instrument.playNote('n1', 60, 0, undefined, 1);
    expect(ctx.lastSource.loop).toBe(false);
  });

  it('ignores invalid loop regions instead of producing garbage playback', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        samples: [{ note: 60, file: 'C4.mp3', loop: true, loopStart: 3, loopEnd: 1 }],
      },
    });
    instrument.playNote('n1', 60, 0, 2.0, 1);
    expect(ctx.lastSource.loop).toBe(false);
  });
});

describe('manifest gainDb (P6)', () => {
  it('scales the note gain by the manifest trim', async () => {
    const { ctx, instrument } = await loadInstrument({
      manifest: { ...SINGLE_SAMPLE, gainDb: -6 },
    });

    instrument.playNote('n1', 60, 0, 0.25, 1);

    const attack = ctx.lastGain.gain.eventsOfType('linearRampToValueAtTime')[0];
    expect(attack.value).toBeCloseTo(Math.pow(10, -6 / 20), 5);
  });
});

describe('choke groups (P5)', () => {
  it('a closed-hat hit chokes a ringing open hat across instruments', async () => {
    const registry = new ChokeGroupRegistry();
    const open = await loadInstrument({
      manifest: {
        id: 'test-open-hat',
        chokeGroup: 'hihat',
        samples: [{ note: 46, file: 'open.mp3' }],
      },
      chokeRegistry: registry,
    });
    const closed = await loadInstrument({
      manifest: {
        id: 'test-closed-hat',
        chokeGroup: 'hihat',
        samples: [{ note: 42, file: 'closed.mp3' }],
      },
      chokeRegistry: registry,
    });

    open.instrument.playNote('n1', 46, 1.0, 4.0, 1);
    const openSource = open.ctx.lastSource;
    const openGain = open.ctx.lastGain;

    closed.instrument.playNote('n2', 42, 2.0, 0.25, 1);

    // The open hat fades out at the closed hat's start time and stops.
    const fade = openGain.gain.eventsOfType('setTargetAtTime')[0];
    expect(fade).toBeDefined();
    expect(fade.value).toBe(0);
    expect(fade.time).toBe(2.0);
    expect(openSource.stopCalls.length).toBeGreaterThan(0);
  });

  it('a naturally-ended note is never choked retroactively', async () => {
    const registry = new ChokeGroupRegistry();
    const { ctx, instrument } = await loadInstrument({
      manifest: {
        id: 'test-hat-ended',
        chokeGroup: 'hihat',
        samples: [{ note: 42, file: 'closed.mp3' }],
      },
      chokeRegistry: registry,
    });

    instrument.playNote('n1', 42, 1.0, 0.25, 1);
    const first = ctx.lastSource;
    first.fireEnded();

    instrument.playNote('n2', 42, 2.0, 0.25, 1);
    expect(first.stopCalls.filter(t => t >= 2.0)).toHaveLength(0);
  });

  it('instruments without a chokeGroup never enter the registry', async () => {
    const registry = new ChokeGroupRegistry();
    const { instrument } = await loadInstrument({
      manifest: { id: 'test-no-choke', samples: [{ note: 60, file: 'C4.mp3' }] },
      chokeRegistry: registry,
    });
    instrument.playNote('n1', 60, 1.0, 0.25, 1);
    expect(registry.activeCount('hihat')).toBe(0);
  });
});
