import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hitLevelVariationDb,
  logSpectralDistance,
  midSideRatioDb,
  peakDbfs,
  rmsDb,
  spectralCentroidHz,
} from '../test/audio-measures';
import { renderProceduralPattern, requireOfflineAudio } from '../test/session-render';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { resolveHumanizedNoteDynamics } from './note-dynamics';
import { SynthEngine, SYNTH_PRESETS } from './synth';
import { recommendedTrackPan } from '../shared/track-pan';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const PIANO_DIR = resolve(THIS_DIR, '../../public/instruments/piano');
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../../public/instruments');

interface SampledSpatialStem {
  instrumentId: string;
  midi: number;
  pan: number;
  steps: readonly number[];
  velocity?: number;
}

const SAMPLED_SPATIAL_STEMS: readonly SampledSpatialStem[] = [
  // 60 is the scheduler's zero-transpose note. Drum manifests translate it
  // to their playbackNote; pitched instruments render their middle-C anchor.
  { instrumentId: 'acoustic-kick', midi: 60, pan: 0, steps: [0, 4, 8, 12] },
  { instrumentId: 'acoustic-snare', midi: 60, pan: -0.08, steps: [4, 12] },
  { instrumentId: 'acoustic-hihat-closed', midi: 60, pan: 0.08, steps: [0, 2, 4, 6, 8, 10, 12, 14] },
  { instrumentId: 'acoustic-ride', midi: 60, pan: -0.12, steps: [2, 6, 10, 14] },
  { instrumentId: 'finger-bass', midi: 60, pan: 0, steps: [0, 6, 8, 14] },
] as const;

function installInstrumentDiskFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const urlPath = decodeURIComponent(String(input).split('?')[0]);
    const marker = '/instruments/';
    const markerAt = urlPath.indexOf(marker);
    if (markerAt === -1) return new Response('not found', { status: 404 });
    const relativePath = urlPath.slice(markerAt + marker.length);
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

// Stem loading is CPU-bound decode (finger-bass alone carries 112 files) and
// must survive contended low-core CI runners. Keep enclosing test budgets at
// least twice this value so the helpers' exact assertions fire before the
// test's own timeout turns the failure into an opaque "timed out".
const SAMPLE_LOAD_DEADLINE_MS = 30_000;

async function waitForSampledStem(
  instrument: SampledInstrument,
  stem: SampledSpatialStem,
): Promise<void> {
  const manifest = JSON.parse(
    readFileSync(resolve(INSTRUMENTS_DIR, stem.instrumentId, 'manifest.json'), 'utf8'),
  ) as InstrumentManifest;
  const renderedMidi = manifest.playbackNote ?? stem.midi;
  const expectedNotes = new Set(manifest.samples.map(sample => sample.note)).size;
  const expectedLayersAtMidi = manifest.samples.filter(sample => sample.note === renderedMidi).length;
  const deadline = Date.now() + SAMPLE_LOAD_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (
      instrument.getSampleNotes().length >= expectedNotes
      && instrument.getVelocityLayerCount(renderedMidi) >= expectedLayersAtMidi
    ) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  expect(instrument.getSampleNotes().length).toBe(expectedNotes);
  expect(instrument.getVelocityLayerCount(renderedMidi)).toBe(expectedLayersAtMidi);
}

async function renderSampledSpatialPattern(
  stems: readonly SampledSpatialStem[],
  options: { applyPan: boolean },
): Promise<Float32Array[]> {
  const { OfflineAudioContext } = await requireOfflineAudio();
  const sampleRate = 44_100;
  const context = new OfflineAudioContext(2, Math.round(sampleRate * 2.5), sampleRate);
  const restoreFetch = installInstrumentDiskFetch();
  const instruments: SampledInstrument[] = [];
  try {
    for (const [stemIndex, stem] of stems.entries()) {
      const output = options.applyPan ? context.createStereoPanner() : context.createGain();
      if (options.applyPan) (output as StereoPannerNode).pan.value = stem.pan;
      output.connect(context.destination);
      const instrument = new SampledInstrument(stem.instrumentId, '/instruments');
      instruments.push(instrument);
      instrument.initialize(
        context as unknown as AudioContext,
        output as unknown as AudioNode,
      );
      expect(await instrument.ensureLoaded()).toBe(true);
      await waitForSampledStem(instrument, stem);
      for (const step of stem.steps) {
        instrument.playNote(
          `sampled-spatial-${stemIndex}-${step}`,
          stem.midi,
          step * 0.125,
          0.11,
          0.72,
          stem.velocity ?? 90,
        );
      }
    }
    const rendered = await context.startRendering();
    return Array.from({ length: rendered.numberOfChannels }, (_, channelIndex) => {
      const channel = new Float32Array(rendered.length);
      rendered.copyFromChannel(channel, channelIndex);
      return channel;
    });
  } finally {
    instruments.forEach(instrument => instrument.dispose());
    restoreFetch();
  }
}

async function renderPianoVelocitySweep(velocityCrossfade: number): Promise<Float32Array[]> {
  const { OfflineAudioContext } = await requireOfflineAudio();
  const sampleRate = 44_100;
  const velocities = Array.from({ length: 19 }, (_, index) => 92 + index);
  const manifest = JSON.parse(
    readFileSync(resolve(PIANO_DIR, 'manifest.json'), 'utf8'),
  ) as InstrumentManifest;
  const focusedManifest = {
    ...manifest,
    velocityCrossfade,
    samples: manifest.samples.filter(sample => sample.note === 60),
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = String(input).split('?')[0];
    if (path.endsWith('manifest.json')) {
      return new Response(JSON.stringify(focusedManifest), { status: 200 });
    }
    const bytes = readFileSync(resolve(PIANO_DIR, path.split('/').at(-1)!));
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
  try {
    const context = new OfflineAudioContext(1, sampleRate * (velocities.length + 1), sampleRate);
    const instrument = new SampledInstrument('piano', '/instruments');
    instrument.initialize(
      context as unknown as AudioContext,
      context.destination as unknown as AudioNode,
    );
    await instrument.ensureLoaded();
    await viWaitForVelocityLayers(instrument, focusedManifest.samples.length);
    velocities.forEach((velocity, index) => {
      instrument.playNote(`piano-${velocity}`, 60, index, 0.35, 1, velocity);
    });
    const rendered = await context.startRendering();
    const channel = new Float32Array(rendered.length);
    rendered.copyFromChannel(channel, 0);
    return velocities.map((_, index) => channel.slice(
      index * sampleRate + Math.round(0.01 * sampleRate),
      index * sampleRate + Math.round(0.25 * sampleRate),
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function viWaitForVelocityLayers(instrument: SampledInstrument, expected: number): Promise<void> {
  const deadline = Date.now() + SAMPLE_LOAD_DEADLINE_MS;
  while (instrument.getVelocityLayerCount(60) < expected && Date.now() < deadline) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  expect(instrument.getVelocityLayerCount(60)).toBe(expected);
}

async function renderNativeLead(midiVelocity: number): Promise<Float32Array> {
  const { OfflineAudioContext } = await requireOfflineAudio();
  const sampleRate = 44_100;
  const context = new OfflineAudioContext(1, sampleRate, sampleRate);
  const output = context.createGain();
  output.connect(context.destination);
  const engine = new SynthEngine();
  engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
  engine.playNote(
    `lead-${midiVelocity}`,
    261.625565,
    SYNTH_PRESETS.lead,
    0.05,
    0.4,
    1,
    undefined,
    midiVelocity,
  );
  const rendered = await context.startRendering();
  const channel = new Float32Array(rendered.length);
  rendered.copyFromChannel(channel, 0);
  return channel.slice(Math.round(sampleRate * 0.08), Math.round(sampleRate * 0.4));
}

describe('required offline audio measurement lane', () => {
  it('loads the native offline renderer instead of silently skipping', async () => {
    const webAudio = await requireOfflineAudio();
    expect(webAudio.OfflineAudioContext).toBeTypeOf('function');
  });

  it('renders byte-identical PCM for the same procedural seed', async () => {
    const options = {
      hits: [
        { sampleId: 'kick', step: 0 },
        { sampleId: 'hihat', step: 0 },
        { sampleId: 'snare', step: 2 },
        { sampleId: 'hihat', step: 2 },
      ],
      seconds: 1,
      seed: 0x43_0001,
    } as const;
    const first = await renderProceduralPattern(options);
    const second = await renderProceduralPattern(options);

    expect(first.channels).toHaveLength(2);
    expect(new Uint8Array(first.channels[0].buffer))
      .toEqual(new Uint8Array(second.channels[0].buffer));
    expect(peakDbfs(first.channels[0])).toBeGreaterThan(-12);
    expect(rmsDb(first.channels[0])).toBeGreaterThan(-35);
  }, 60_000);

  it('changes noise-bearing PCM when the seed changes', async () => {
    const first = await renderProceduralPattern({
      hits: [{ sampleId: 'hihat', step: 0 }],
      seconds: 0.2,
      seed: 1,
    });
    const second = await renderProceduralPattern({
      hits: [{ sampleId: 'hihat', step: 0 }],
      seconds: 0.2,
      seed: 2,
    });
    expect(new Uint8Array(first.channels[0].buffer))
      .not.toEqual(new Uint8Array(second.channels[0].buffer));
  }, 60_000);

  it('reduces the real piano mf-to-ff layer cliff with the manifest crossfade', async () => {
    const hardSwitch = await renderPianoVelocitySweep(0);
    const crossfaded = await renderPianoVelocitySweep(8);
    const adjacentDistances = (windows: Float32Array[]) => windows
      .slice(0, -1)
      .map((window, index) => logSpectralDistance(window, windows[index + 1]));
    const hardDistances = adjacentDistances(hardSwitch);
    const crossfadedDistances = adjacentDistances(crossfaded);
    const hardMaximum = Math.max(...hardDistances);
    const crossfadedMaximum = Math.max(...crossfadedDistances);
    const ratio = crossfadedMaximum / hardMaximum;
    console.info('[piano layer crossfade]', JSON.stringify({
      hardMaximum,
      crossfadedMaximum,
      ratio,
    }));
    expect(ratio).toBeLessThanOrEqual(0.75);
  }, 120_000);

  it('renders non-zero unlocked hit variation while explicit locks remain exact', async () => {
    const gains = (locked: boolean) => Array.from({ length: 16 }, (_, step) =>
      resolveHumanizedNoteDynamics(
        locked ? 1 : undefined,
        'hihat',
        'machine-gun-hat',
        step,
        0,
      ).noteGain
    );
    const render = (locked: boolean) => renderProceduralPattern({
      hits: gains(locked).map((gain, step) => ({ sampleId: 'hihat', step, gain })),
      seconds: 2.1,
      seed: 0x43_3003,
      channels: 1,
    });
    const [unlocked, locked, lockedReplay] = await Promise.all([
      render(false),
      render(true),
      render(true),
    ]);
    const starts = Array.from({ length: 16 }, (_, step) =>
      Math.round(step * 0.125 * unlocked.sampleRate)
    );
    const windowFrames = Math.round(0.08 * unlocked.sampleRate);
    const unlockedVariation = hitLevelVariationDb(
      unlocked.channels[0],
      starts,
      windowFrames,
    );
    const lockedVariation = hitLevelVariationDb(
      locked.channels[0],
      starts,
      windowFrames,
    );
    const lockedReplayVariation = hitLevelVariationDb(
      lockedReplay.channels[0],
      starts,
      windowFrames,
    );
    const humanizationOffsetsDb = unlockedVariation.rmsDb.map(
      (value, index) => value - lockedVariation.rmsDb[index],
    );
    const humanizationSpreadDb = Math.max(...humanizationOffsetsDb)
      - Math.min(...humanizationOffsetsDb);
    const lockedReplayDeltaDb = Math.max(...lockedVariation.rmsDb.map(
      (value, index) => Math.abs(value - lockedReplayVariation.rmsDb[index]),
    ));
    console.info('[S3 hit variation]', JSON.stringify({
      unlockedRmsSpreadDb: unlockedVariation.rmsSpreadDb,
      unlockedPeakSpreadDb: unlockedVariation.peakSpreadDb,
      lockedRmsSpreadDb: lockedVariation.rmsSpreadDb,
      lockedPeakSpreadDb: lockedVariation.peakSpreadDb,
      humanizationSpreadDb,
      lockedReplayDeltaDb,
    }));
    expect(humanizationSpreadDb).toBeGreaterThan(0.1);
    expect(humanizationSpreadDb).toBeLessThanOrEqual(2.5);
    expect(lockedReplayDeltaDb).toBeLessThan(1e-8);
    expect(new Uint8Array(locked.channels[0].buffer))
      .toEqual(new Uint8Array(lockedReplay.channels[0].buffer));
  }, 60_000);

  it('keeps the MIDI-90 default render close to the pre-mapping full-velocity lead', async () => {
    const [defaultVelocity, previousFullVelocity] = await Promise.all([
      renderNativeLead(90),
      renderNativeLead(127),
    ]);
    const levelDeltaDb = rmsDb(defaultVelocity) - rmsDb(previousFullVelocity);
    const centroidRatio = spectralCentroidHz(defaultVelocity, 44_100)
      / spectralCentroidHz(previousFullVelocity, 44_100);
    console.info('[native lead default-velocity calibration]', JSON.stringify({
      levelDeltaDb,
      centroidRatio,
    }));
    expect(Math.abs(levelDeltaDb)).toBeLessThanOrEqual(1);
    expect(centroidRatio).toBeGreaterThanOrEqual(0.9);
    expect(centroidRatio).toBeLessThanOrEqual(1.1);
  }, 60_000);

  it('keeps the procedural native-panner canary within its measured S5 band', async () => {
    const centered = [
      ...[0, 4, 8, 12].map(step => ({ sampleId: 'kick', step, pan: 0 })),
      ...[4, 12].map(step => ({ sampleId: 'snare', step, pan: 0 })),
      ...[0, 2, 4, 6, 8, 10, 12, 14].map(step => ({ sampleId: 'hihat', step, pan: 0 })),
      ...[2, 6, 10, 14].map(step => ({ sampleId: 'openhat', step, pan: 0 })),
      ...[2, 5, 10, 13].map(step => ({ sampleId: 'conga', step, pan: 0 })),
      ...[1, 3, 5, 7, 9, 11, 13, 15].map(step => ({ sampleId: 'shaker', step, pan: 0 })),
      ...[0, 6, 8, 14].map(step => ({ sampleId: 'bass', step, pan: 0 })),
    ] as const;
    const pans = new Map([
      ['kick', 0],
      ['snare', -0.10],
      ['hihat', 0.20],
      ['openhat', 0.35],
      ['conga', -0.30],
      ['shaker', 0.12],
      ['bass', 0],
    ]);
    const wide = centered.map(hit => ({ ...hit, pan: pans.get(hit.sampleId) ?? 0 }));
    const common = {
      seconds: 2.5,
      seed: 0x43_5005,
      channels: 2,
      useNativePanner: true,
      stereoizeMonoSources: true,
    } as const;

    const [baseline, spatial] = await Promise.all([
      renderProceduralPattern({ ...common, hits: centered }),
      renderProceduralPattern({ ...common, hits: wide }),
    ]);
    const baselineMidSideDb = midSideRatioDb(baseline.channels[0], baseline.channels[1]);
    const spatialMidSideDb = midSideRatioDb(spatial.channels[0], spatial.channels[1]);
    const foldToMono = (channels: Float32Array[]) => Float32Array.from(
      { length: Math.min(channels[0].length, channels[1].length) },
      (_, frame) => (channels[0][frame] + channels[1][frame]) * 0.5,
    );
    const baselineMonoDb = rmsDb(foldToMono(baseline.channels));
    const spatialMonoDb = rmsDb(foldToMono(spatial.channels));
    const monoFoldDeltaDb = spatialMonoDb - baselineMonoDb;

    const centeredStemMetrics: Record<string, {
      prePanMidSideDb: number;
      centeredMidSideDb: number;
      leftRightDeltaDb: number;
    }> = {};
    for (const sampleId of ['kick', 'bass'] as const) {
      const hits = centered.filter(hit => hit.sampleId === sampleId);
      const [prePan, postCenter] = await Promise.all([
        renderProceduralPattern({
          ...common,
          hits,
          useNativePanner: false,
        }),
        renderProceduralPattern({ ...common, hits }),
      ]);
      const prePanMidSideDb = midSideRatioDb(prePan.channels[0], prePan.channels[1]);
      const centeredMidSideDb = midSideRatioDb(postCenter.channels[0], postCenter.channels[1]);
      const leftRightDeltaDb = rmsDb(postCenter.channels[0]) - rmsDb(postCenter.channels[1]);
      centeredStemMetrics[sampleId] = {
        prePanMidSideDb,
        centeredMidSideDb,
        leftRightDeltaDb,
      };
      expect(centeredMidSideDb).toBeLessThanOrEqual(prePanMidSideDb);
      expect(Math.abs(leftRightDeltaDb)).toBeLessThan(0.01);
    }

    const metrics = {
      baselineMidSideDb,
      spatialMidSideDb,
      baselineMonoDb,
      spatialMonoDb,
      monoFoldDeltaDb,
      centeredStemMetrics,
    };
    console.info('[S5 spatial metrics]', JSON.stringify(metrics, (_key, value) =>
      value === -Infinity ? '-Infinity' : value
    ));

    expect(spatialMidSideDb).toBeGreaterThan(baselineMidSideDb);
    expect(Number.isFinite(spatialMidSideDb)).toBe(true);
    // Recaptured after source-role calibration lowered the previously dominant
    // hats. The tighter side ratio is a direct consequence of the intended
    // balance change, while the relative and mono-fold checks still prove that
    // panning is active and safe. This is a characterized fixture band, not a
    // universal master-width rule.
    expect(spatialMidSideDb).toBeGreaterThanOrEqual(-20.75);
    expect(spatialMidSideDb).toBeLessThanOrEqual(-19.5);
    expect(Math.abs(monoFoldDeltaDb)).toBeLessThanOrEqual(1);
  }, 60_000);

  it('keeps shipped stereo samples centered by default while manual pan stays mono-safe', async () => {
    const centered = SAMPLED_SPATIAL_STEMS.map(stem => ({ ...stem, pan: 0 }));
    const safeDefaults = SAMPLED_SPATIAL_STEMS.map((stem, index) => ({
      ...stem,
      pan: recommendedTrackPan(`sampled:${stem.instrumentId}`, index),
    }));
    // The renderer installs a disk-backed fetch adapter, so keep these serial
    // rather than racing two writers to the process-global fetch function.
    const baseline = await renderSampledSpatialPattern(centered, { applyPan: true });
    const automatic = await renderSampledSpatialPattern(safeDefaults, { applyPan: true });
    const spatial = await renderSampledSpatialPattern(SAMPLED_SPATIAL_STEMS, { applyPan: true });
    const foldToMono = (channels: Float32Array[]) => Float32Array.from(
      { length: Math.min(channels[0].length, channels[1].length) },
      (_, frame) => (channels[0][frame] + channels[1][frame]) * 0.5,
    );
    const baselineMidSideDb = midSideRatioDb(baseline[0], baseline[1]);
    const automaticMidSideDb = midSideRatioDb(automatic[0], automatic[1]);
    const spatialMidSideDb = midSideRatioDb(spatial[0], spatial[1]);
    const monoFoldDeltaDb = rmsDb(foldToMono(spatial)) - rmsDb(foldToMono(baseline));

    const centeredStemMetrics: Record<string, {
      prePanMidSideDb: number;
      centeredMidSideDb: number;
      deltaDb: number;
    }> = {};
    for (const instrumentId of ['acoustic-kick', 'finger-bass'] as const) {
      const stem = SAMPLED_SPATIAL_STEMS.find(item => item.instrumentId === instrumentId)!;
      const prePan = await renderSampledSpatialPattern([stem], { applyPan: false });
      const postCenter = await renderSampledSpatialPattern(
        [{ ...stem, pan: 0 }],
        { applyPan: true },
      );
      const prePanMidSideDb = midSideRatioDb(prePan[0], prePan[1]);
      const centeredMidSideDb = midSideRatioDb(postCenter[0], postCenter[1]);
      const deltaDb = Number.isFinite(prePanMidSideDb) || Number.isFinite(centeredMidSideDb)
        ? centeredMidSideDb - prePanMidSideDb
        : 0;
      centeredStemMetrics[instrumentId] = {
        prePanMidSideDb,
        centeredMidSideDb,
        deltaDb,
      };
      expect(Math.abs(deltaDb)).toBeLessThanOrEqual(0.1);
    }

    console.info('[S5 shipped-sample spatial metrics]', JSON.stringify({
      baselineMidSideDb,
      automaticMidSideDb,
      spatialMidSideDb,
      monoFoldDeltaDb,
      centeredStemMetrics,
    }));
    expect(automaticMidSideDb).toBeCloseTo(baselineMidSideDb, 8);
    expect(Math.abs(spatialMidSideDb - baselineMidSideDb)).toBeGreaterThan(0.1);
    expect(Number.isFinite(spatialMidSideDb)).toBe(true);
    expect(Math.abs(monoFoldDeltaDb)).toBeLessThanOrEqual(1);
  }, 120_000);
});
