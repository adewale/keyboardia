import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmsDb, spectralCentroidHz } from '../test/audio-measures';
import { requireOfflineAudio } from '../test/session-render';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { sampleCache } from './lru-sample-cache';
import { VELOCITY_FILTER_BYPASS_VELOCITY } from './velocity-sample-filter';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../../public/instruments');

/**
 * Acceptance for Phase 44 Change 2 on real shipped samples
 * (specs/PHASE-44-SOUND-CHANGES.md §3):
 * - at and above the bypass velocity the anchored manifest renders
 *   byte-identical PCM to the same manifest without the anchor, so unlocked
 *   steps are provably untouched;
 * - below it, the soft strike is measurably darker, not merely quieter.
 * slap-bass keeps the fixture small: four mappings, sub-second files.
 */

const INSTRUMENT_ID = 'slap-bass';
const SAMPLE_RATE = 44_100;

function installDiskFetch(stripAnchor: boolean): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const urlPath = decodeURIComponent(String(input).split('?')[0]);
    const marker = '/instruments/';
    const markerAt = urlPath.indexOf(marker);
    if (markerAt === -1) return new Response('not found', { status: 404 });
    const relativePath = urlPath.slice(markerAt + marker.length);
    if (relativePath.endsWith('manifest.json')) {
      const manifest = JSON.parse(
        readFileSync(resolve(INSTRUMENTS_DIR, relativePath), 'utf8'),
      ) as InstrumentManifest;
      if (stripAnchor) delete manifest.velocityFilterAnchorHz;
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    try {
      const bytes = readFileSync(resolve(INSTRUMENTS_DIR, relativePath));
      return new Response(bytes, { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function renderNote(velocity: number, options: { stripAnchor: boolean }): Promise<Float32Array> {
  const { OfflineAudioContext } = await requireOfflineAudio();
  const context = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
  const restoreFetch = installDiskFetch(options.stripAnchor);
  // The LRU cache is keyed by file, not by manifest variant; a buffer cached
  // under the anchored run is byte-identical either way, but clear anyway so
  // each render decodes from a known-cold state.
  sampleCache.clear();
  const instrument = new SampledInstrument(INSTRUMENT_ID, '/instruments');
  try {
    instrument.initialize(
      context as unknown as AudioContext,
      context.destination as unknown as AudioNode,
    );
    expect(await instrument.ensureLoaded()).toBe(true);
    const deadline = Date.now() + 30_000;
    while (instrument.getSampleNotes().length < 4 && Date.now() < deadline) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
    }
    expect(instrument.getSampleNotes().length).toBe(4);
    instrument.playNote('render-note', 60, 0, 0.4, 1, velocity);
    const rendered = await context.startRendering();
    const channel = new Float32Array(rendered.length);
    rendered.copyFromChannel(channel, 0);
    return channel;
  } finally {
    instrument.dispose();
    restoreFetch();
  }
}

function postOnsetCentroid(samples: Float32Array): number {
  const start = Math.floor(SAMPLE_RATE * 0.02);
  const end = Math.min(samples.length, start + Math.floor(SAMPLE_RATE * 0.25));
  const window = samples.subarray(start, end);
  expect(rmsDb(window)).toBeGreaterThan(-70);
  return spectralCentroidHz(window, SAMPLE_RATE);
}

describe('velocity filter on shipped samples', () => {
  it('renders byte-identical PCM at and above the bypass velocity with and without the anchor', async () => {
    for (const velocity of [VELOCITY_FILTER_BYPASS_VELOCITY, 127]) {
      const anchored = await renderNote(velocity, { stripAnchor: false });
      const plain = await renderNote(velocity, { stripAnchor: true });
      expect(new Uint8Array(anchored.buffer)).toEqual(new Uint8Array(plain.buffer));
    }
  }, 120_000);

  it('darkens a soft strike materially instead of only attenuating it', async () => {
    const soft = await renderNote(40, { stripAnchor: false });
    const full = await renderNote(127, { stripAnchor: false });
    const softCentroid = postOnsetCentroid(soft);
    const fullCentroid = postOnsetCentroid(full);
    const dropPct = ((fullCentroid - softCentroid) / fullCentroid) * 100;
    console.info('[velocity filter render]', JSON.stringify({
      instrument: INSTRUMENT_ID, softCentroid, fullCentroid, dropPct,
    }));
    // The manifest anchor is solved to a 30% mean drop across the library's
    // files; a single-note render sits near that with per-file variance.
    expect(dropPct).toBeGreaterThanOrEqual(15);
    expect(dropPct).toBeLessThanOrEqual(50);
  }, 120_000);

  it('keeps velocity-layered instruments out of the filter path entirely', () => {
    for (const id of ['piano', 'vibraphone', 'alto-sax', 'marimba', 'brushes-snare']) {
      const manifest = JSON.parse(
        readFileSync(resolve(INSTRUMENTS_DIR, id, 'manifest.json'), 'utf8'),
      ) as InstrumentManifest;
      expect(manifest.velocityFilterAnchorHz, id).toBeUndefined();
    }
  });
});
