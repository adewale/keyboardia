import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmsDb, spectralCentroidHz } from '../test/audio-measures';
import { requireOfflineAudio } from '../test/session-render';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { sampleCache } from './lru-sample-cache';
import { VELOCITY_FILTER_BYPASS_VELOCITY } from './velocity-sample-filter';
import { velocityFilterAnchorHz } from './velocity-filter-calibration';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../../public/instruments');

/**
 * Acceptance for Phase 44 Change 2 on real shipped samples
 * (specs/PHASE-44-SOUND-CHANGES.md §3):
 * - at and above the bypass velocity the calibrated instrument renders
 *   byte-identical PCM to the same instrument with calibration disabled, so unlocked
 *   steps are provably untouched;
 * - below it, the soft strike is measurably darker, not merely quieter.
 * The range cases reproduce the notes that escaped the original single-note gate.
 */

const SAMPLE_RATE = 44_100;

function installDiskFetch(): () => void {
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

async function renderNote(
  instrumentId: string,
  midiNote: number,
  velocity: number,
  options: { disableCalibration?: boolean } = {},
): Promise<Float32Array> {
  const { OfflineAudioContext } = await requireOfflineAudio();
  const context = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
  const restoreFetch = installDiskFetch();
  // Clear the shared LRU so each render decodes from a known-cold state.
  sampleCache.clear();
  const instrument = new SampledInstrument(
    instrumentId,
    '/instruments',
    options.disableCalibration ? { velocityAnchorForNote: () => undefined } : {},
  );
  try {
    instrument.initialize(
      context as unknown as AudioContext,
      context.destination as unknown as AudioNode,
    );
    expect(await instrument.ensureLoaded()).toBe(true);
    await instrument.waitForBackgroundLoad();
    instrument.playNote('render-note', midiNote, 0, 0.4, 1, velocity);
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
      const anchored = await renderNote('slap-bass', 60, velocity);
      const plain = await renderNote('slap-bass', 60, velocity, { disableCalibration: true });
      expect(new Uint8Array(anchored.buffer)).toEqual(new Uint8Array(plain.buffer));
    }
  }, 120_000);

  it('darkens a soft strike materially instead of only attenuating it', async () => {
    for (const [instrumentId, midiNote] of [
      ['slap-bass', 72],
      ['kalimba', 53],
      ['kalimba', 87],
      ['string-section', 88],
    ] as const) {
      const softCentroid = postOnsetCentroid(await renderNote(instrumentId, midiNote, 40));
      const fullCentroid = postOnsetCentroid(await renderNote(instrumentId, midiNote, 127));
      const dropPct = ((fullCentroid - softCentroid) / fullCentroid) * 100;
      expect(dropPct, `${instrumentId}@${midiNote}`).toBeGreaterThanOrEqual(26);
      expect(dropPct, `${instrumentId}@${midiNote}`).toBeLessThanOrEqual(35);
    }
  }, 120_000);

  it('has no audible brightness cliff between velocities 89 and 90', async () => {
    const almostBypassed = postOnsetCentroid(await renderNote('string-section', 60, 89));
    const bypassed = postOnsetCentroid(await renderNote('string-section', 60, 90));
    expect(Math.abs(bypassed - almostBypassed) / bypassed * 100).toBeLessThan(2);
  }, 120_000);

  it('keeps velocity-layered instruments out of the filter path entirely', () => {
    for (const id of readdirSync(INSTRUMENTS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name)) {
      const manifest = JSON.parse(
        readFileSync(resolve(INSTRUMENTS_DIR, id, 'manifest.json'), 'utf8'),
      ) as InstrumentManifest;
      const zones = new Set(manifest.samples.map(sample => (
        `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`
      )));
      if (zones.size > 1) {
        const note = manifest.playableRange?.min ?? manifest.playbackNote ?? 60;
        expect(velocityFilterAnchorHz(id, note, 44_100), `${id}@44.1k`).toBeUndefined();
        expect(velocityFilterAnchorHz(id, note, 48_000), `${id}@48k`).toBeUndefined();
      }
    }
  });
});
