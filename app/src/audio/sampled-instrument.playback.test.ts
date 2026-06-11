import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { ChokeGroupRegistry } from './choke-groups';
import { sampleCache } from './lru-sample-cache';
import {
  FakeAudioContext,
  FakeGainNode,
  makeSampleFetchStub,
} from './__fakes__/FakeWebAudio';
import { ATTACK_FADE_SEC, RELEASE_TAIL_GUARD_SEC } from './note-schedule';

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
    expect(release.time).toBeCloseTo(6.3, 10);
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
    expect(zero.value).toBe(0);
    expect(zero.time).toBe(5.0);
    const attack = gain.eventsOfType('linearRampToValueAtTime')[0];
    expect(attack.value).toBeCloseTo(0.9, 10);
    expect(attack.time).toBeCloseTo(5.0 + ATTACK_FADE_SEC, 10);
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

  it('defaults to full velocity when none is given (un-locked step = full hit)', async () => {
    const { ctx, instrument } = await loadInstrument({ manifest: THREE_LAYERS });
    instrument.playNote('n1', 60, 0, 0.25, 1);
    expect(ctx.lastSource.buffer?.label).toBe('C4-ff.mp3');
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
