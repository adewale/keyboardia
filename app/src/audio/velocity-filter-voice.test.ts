import { describe, it, expect, vi, afterEach } from 'vitest';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { sampleCache } from './lru-sample-cache';
import {
  FakeAudioContext,
  FakeGainNode,
  makeSampleFetchStub,
} from './__fakes__/FakeWebAudio';
import { VELOCITY_FILTER_BYPASS_VELOCITY } from './velocity-sample-filter';

/**
 * Structural contract for the Phase 44 per-voice velocity lowpass: the graph
 * gains a filter node only when the manifest declares an anchor AND the note
 * is below the bypass velocity, and the bypassed graph is node-for-node the
 * same as a manifest without the field.
 */

let instrumentCounter = 0;

async function loadInstrument(
  manifest: Partial<InstrumentManifest>,
  velocityAnchor: number | ((instrumentId: string, midiNote: number) => number | undefined) | undefined = undefined,
) {
  const id = `velocity-filter-test-${++instrumentCounter}`;
  const fullManifest: InstrumentManifest = {
    name: 'Velocity Filter Test',
    type: 'sampled',
    releaseTime: 0.5,
    samples: [{ note: 60, file: 'C4.mp3' }],
    ...manifest,
    id,
  };
  vi.stubGlobal('fetch', makeSampleFetchStub(fullManifest));
  const ctx = new FakeAudioContext();
  const destination = new FakeGainNode();
  const instrument = new SampledInstrument(id, '/instruments', {
    velocityAnchorForNote: typeof velocityAnchor === 'function'
      ? velocityAnchor
      : () => velocityAnchor,
  });
  instrument.initialize(ctx.asAudioContext(), destination as unknown as AudioNode);
  expect(await instrument.ensureLoaded()).toBe(true);
  await vi.waitFor(() => {
    expect(instrument.getVelocityLayerCount(60)).toBeGreaterThan(0);
  });
  return { ctx, destination, instrument };
}

afterEach(() => {
  vi.unstubAllGlobals();
  sampleCache.clear();
});

describe('per-voice velocity lowpass', () => {
  it('creates one lowpass routed gain → filter → destination below the bypass velocity', async () => {
    const { ctx, destination, instrument } = await loadInstrument({}, 4000);
    instrument.playNote('n1', 60, 0, 0.25, 1, 40);
    expect(ctx.createdBiquadFilters).toHaveLength(1);
    const filter = ctx.createdBiquadFilters[0];
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBeGreaterThan(0);
    expect(filter.frequency.value).toBeLessThan(4000);
    expect(filter.connectedTo).toContain(destination);
    expect(ctx.lastGain.connectedTo).toContain(filter);
  });

  it('creates no filter node at or above the bypass velocity, matching an anchorless manifest', async () => {
    const anchored = await loadInstrument({}, 4000);
    anchored.instrument.playNote('n1', 60, 0, 0.25, 1, VELOCITY_FILTER_BYPASS_VELOCITY);
    anchored.instrument.playNote('n2', 60, 0, 0.25, 1, 127);
    expect(anchored.ctx.createdBiquadFilters).toHaveLength(0);
    expect(anchored.ctx.lastGain.connectedTo).toContain(anchored.destination);

    const plain = await loadInstrument({});
    plain.instrument.playNote('n1', 60, 0, 0.25, 1, 40);
    expect(plain.ctx.createdBiquadFilters).toHaveLength(0);
  });

  it('disconnects the filter when the voice ends', async () => {
    const { ctx, instrument } = await loadInstrument({}, 4000);
    instrument.playNote('n1', 60, 0, 0.25, 1, 40);
    const filter = ctx.createdBiquadFilters[0];
    expect(filter.disconnected).toBe(false);
    ctx.createdSources.forEach(source => source.fireEnded());
    expect(filter.disconnected).toBe(true);
  });

  it('uses the exact requested-note calibration rather than one instrument-wide anchor', async () => {
    const resolver = vi.fn((_instrumentId: string, midiNote: number) => midiNote === 48 ? 2000 : 8000);
    const { ctx, instrument } = await loadInstrument({}, resolver);
    instrument.playNote('low', 48, 0, 0.25, 1, 40);
    instrument.playNote('high', 72, 0, 0.25, 1, 40);
    expect(ctx.createdBiquadFilters[1].frequency.value / ctx.createdBiquadFilters[0].frequency.value)
      .toBeCloseTo(4, 6);
    expect(resolver.mock.calls.map(([, note]) => note)).toEqual([48, 72]);
  });

  it('shares one filter across every layer-blend component of the voice', async () => {
    const { ctx } = await (async () => {
      const loaded = await loadInstrument({
        velocityCrossfade: 16,
        samples: [
          { note: 60, file: 'C4-soft.mp3', velocityMin: 0, velocityMax: 63 },
          { note: 60, file: 'C4-loud.mp3', velocityMin: 64, velocityMax: 127 },
        ],
      }, 4000);
      loaded.instrument.playNote('n1', 60, 0, 0.25, 1, 60);
      return loaded;
    })();
    expect(ctx.createdSources.length).toBeGreaterThan(1);
    expect(ctx.createdBiquadFilters).toHaveLength(1);
    const filter = ctx.createdBiquadFilters[0];
    for (const gain of ctx.createdGains) {
      expect(gain.connectedTo).toContain(filter);
    }
  });
});
