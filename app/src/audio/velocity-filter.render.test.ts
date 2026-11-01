import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loudnessKMax,
  rmsDb,
  spectralCentroidHz,
  truePeakDbfs,
} from '../test/audio-measures';
import { requireOfflineAudio } from '../test/session-render';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { sampleCache } from './lru-sample-cache';
import { VELOCITY_FILTER_BYPASS_VELOCITY } from './velocity-sample-filter';
import { velocityFilterAnchorHz } from './velocity-filter-calibration';
import { nearestSampleNote } from './sample-selection';

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

function priorityDeliveryPaths(instrumentId: string): Set<string> {
  const manifest = JSON.parse(
    readFileSync(resolve(INSTRUMENTS_DIR, instrumentId, 'manifest.json'), 'utf8'),
  ) as InstrumentManifest;
  if (manifest.sprite) return new Set([`${instrumentId}/${manifest.sprite}`]);
  const availableNotes = [...new Set(manifest.samples.map(mapping => mapping.note))];
  const defaultPriority = nearestSampleNote(availableNotes, 60);
  const priorityNotes = new Set(
    manifest.priorityNotes?.length ? manifest.priorityNotes : [defaultPriority],
  );
  return new Set(manifest.samples
    .filter(mapping => priorityNotes.has(mapping.note))
    .flatMap(mapping => mapping.file ? [`${instrumentId}/${mapping.file}`] : []));
}

function installDiskFetch(options: {
  holdNonPriority?: boolean;
  priorityPaths?: Set<string>;
} = {}): { restore: () => void; releaseHeldAsFailures: () => void } {
  const originalFetch = globalThis.fetch;
  const held: Array<(response: Response) => void> = [];
  let released = false;
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
    if (
      options.holdNonPriority
      && !options.priorityPaths?.has(relativePath)
    ) {
      if (released) return new Response('background load held by test', { status: 503 });
      return new Promise<Response>(resolveResponse => held.push(resolveResponse));
    }
    try {
      const bytes = readFileSync(resolve(INSTRUMENTS_DIR, relativePath));
      return new Response(bytes, { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    releaseHeldAsFailures: () => {
      released = true;
      for (const release of held.splice(0)) {
        release(new Response('background load held by test', { status: 503 }));
      }
    },
  };
}

async function renderNote(
  instrumentId: string,
  midiNote: number,
  velocity: number,
  options: {
    disableCalibration?: boolean;
    priorityOnly?: boolean;
    sampleRate?: number;
  } = {},
): Promise<Float32Array> {
  const { OfflineAudioContext } = await requireOfflineAudio();
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const context = new OfflineAudioContext(1, sampleRate, sampleRate);
  const fetchControl = installDiskFetch(options.priorityOnly ? {
    holdNonPriority: true,
    priorityPaths: priorityDeliveryPaths(instrumentId),
  } : {});
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
    if (!options.priorityOnly) await instrument.waitForBackgroundLoad();
    instrument.playNote('render-note', midiNote, 0, 0.4, 1, velocity);
    const rendered = await context.startRendering();
    const channel = new Float32Array(rendered.length);
    rendered.copyFromChannel(channel, 0);
    return channel;
  } finally {
    fetchControl.releaseHeldAsFailures();
    await instrument.waitForBackgroundLoad();
    instrument.dispose();
    fetchControl.restore();
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
      const soft = await renderNote(instrumentId, midiNote, 40);
      const full = await renderNote(instrumentId, midiNote, 127);
      const softCentroid = postOnsetCentroid(soft);
      const fullCentroid = postOnsetCentroid(full);
      const dropPct = ((fullCentroid - softCentroid) / fullCentroid) * 100;
      expect(dropPct, `${instrumentId}@${midiNote}`).toBeGreaterThanOrEqual(26);
      expect(dropPct, `${instrumentId}@${midiNote}`).toBeLessThanOrEqual(35);
      // A non-boosting transfer magnitude can still move the waveform peak by
      // changing phase, so preserve a measured 0.1 dB waveform budget instead
      // of inferring peak behavior from the frequency-response invariant.
      expect(truePeakDbfs(soft) - truePeakDbfs(full), `${instrumentId}@${midiNote} true peak`)
        .toBeLessThanOrEqual(0.1);
      expect(loudnessKMax(soft, SAMPLE_RATE) - loudnessKMax(full, SAMPLE_RATE), `${instrumentId}@${midiNote} loudness`)
        .toBeLessThanOrEqual(0.1);
    }
  }, 120_000);

  it('has no audible brightness cliff between velocities 89 and 90', async () => {
    const almostBypassed = postOnsetCentroid(await renderNote('string-section', 60, 89));
    const bypassed = postOnsetCentroid(await renderNote('string-section', 60, 90));
    expect(Math.abs(bypassed - almostBypassed) / bypassed * 100).toBeLessThan(2);
  }, 120_000);

  it('safely bypasses calibration when priority-ready playback uses a different root', async () => {
    for (const [instrumentId, midiNote] of [
      ['string-section', 88],
      ['clean-guitar', 43],
    ] as const) {
      const priorityReady = await renderNote(
        instrumentId,
        midiNote,
        40,
        { priorityOnly: true },
      );
      const explicitBypass = await renderNote(
        instrumentId,
        midiNote,
        40,
        { priorityOnly: true, disableCalibration: true },
      );
      expect(
        new Uint8Array(priorityReady.buffer),
        `${instrumentId}@${midiNote} priority-ready`,
      ).toEqual(new Uint8Array(explicitBypass.buffer));
    }
  }, 120_000);

  it('uses byte-identical gain-only playback at unsupported hardware sample rates', async () => {
    const calibrated = await renderNote('string-section', 60, 40, { sampleRate: 96_000 });
    const explicitBypass = await renderNote('string-section', 60, 40, {
      sampleRate: 96_000,
      disableCalibration: true,
    });
    expect(new Uint8Array(calibrated.buffer)).toEqual(new Uint8Array(explicitBypass.buffer));
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
