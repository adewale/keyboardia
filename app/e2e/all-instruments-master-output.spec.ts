import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSessionWithRetry, API_BASE } from './test-utils';
import { waitForAppReady } from './global-setup';
import { INSTRUMENT_CATEGORIES } from '../src/components/sample-constants';
import { getInstrumentRange } from '../src/audio/instrument-ranges';
import { SCHEDULER_BASE_MIDI_NOTE } from '../src/audio/constants';
import { MAX_TRACKS } from '../src/types';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = resolve(THIS_DIR, '../test-results/audio-output');

const SILENCE_PEAK = 1e-4;
const SILENCE_RMS = 1e-5;
const STEP_COUNT = 4;
const SESSION_TEMPO = 120;
const MEASURE_ITERATIONS = 50;
const MEASURE_INTERVAL_MS = 50;

type InstrumentType = 'sample' | 'sampled' | 'synth' | 'tone' | 'advanced';

type InstrumentSpec = {
  sampleId: string;
  name: string;
  type: InstrumentType;
  presetId: string;
  pitch: number;
};

type SessionTrack = {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: Array<{ pitch: number; volume: number } | null>;
  volume: number;
  muted: boolean;
  soloed: boolean;
  transpose: number;
  stepCount: number;
};

type TrackProbeResult = InstrumentSpec & {
  trackId: string;
  sessionId: string;
  peak: number;
  rms: number;
};

function representativePitch(sampleId: string): number {
  const range = getInstrumentRange(sampleId);
  const midi = Math.min(range.maxMidi, Math.max(range.minMidi, SCHEDULER_BASE_MIDI_NOTE));
  return midi - SCHEDULER_BASE_MIDI_NOTE;
}

function presetIdFor(sampleId: string, type: InstrumentType): string {
  switch (type) {
    case 'sampled':
      return sampleId.slice('sampled:'.length);
    case 'synth':
      return sampleId.slice('synth:'.length);
    case 'tone':
      return sampleId.slice('tone:'.length);
    case 'advanced':
      return sampleId.slice('advanced:'.length);
    case 'sample':
    default:
      return sampleId;
  }
}

function allInstrumentSpecs(): InstrumentSpec[] {
  return Object.values(INSTRUMENT_CATEGORIES)
    .flatMap(category => category.instruments)
    .map(instrument => ({
      sampleId: instrument.id,
      name: instrument.name,
      type: instrument.type as InstrumentType,
      presetId: presetIdFor(instrument.id, instrument.type as InstrumentType),
      pitch: representativePitch(instrument.id),
    }))
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function trackIdFor(sampleId: string, index: number): string {
  return `audio-smoke-${index}-${sampleId.replace(/[^a-z0-9]+/gi, '-')}`;
}

function buildSequencerTrack(spec: InstrumentSpec, index: number): SessionTrack {
  const steps = Array(STEP_COUNT).fill(false) as boolean[];
  const parameterLocks = Array(STEP_COUNT).fill(null) as Array<{ pitch: number; volume: number } | null>;
  steps[0] = true;
  parameterLocks[0] = { pitch: spec.pitch, volume: 1 };
  return {
    id: trackIdFor(spec.sampleId, index),
    name: spec.name,
    sampleId: spec.sampleId,
    steps,
    parameterLocks,
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: STEP_COUNT,
  };
}

async function prepareAudioForTracks(page: Page, tracks: SessionTrack[]): Promise<void> {
  // The app initializes/unlocks audio only through a user playback gesture.
  // First start/stop preloads sampled instruments and prewarms Tone/advanced
  // tracks; the measured restart below then begins from step 0 with probes attached.
  await clickPlayButton(page);
  await page.waitForFunction((tracksToCheck) => {
    type Engine = {
      getAudioContext?: () => AudioContext | null;
      isToneInitialized?: () => boolean;
      isSampledInstrumentReady?: (instrumentId: string) => boolean;
    };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    if (!engine?.getAudioContext?.()) return false;
    const needsTone = tracksToCheck.some(t => t.sampleId.startsWith('tone:') || t.sampleId.startsWith('advanced:'));
    if (needsTone && !engine.isToneInitialized?.()) return false;
    return tracksToCheck
      .filter(t => t.sampleId.startsWith('sampled:'))
      .map(t => t.sampleId.slice('sampled:'.length))
      .every(id => engine.isSampledInstrumentReady?.(id));
  }, tracks, { timeout: 60_000 });
  await clickPlayButton(page).catch(() => {});
  await page.waitForTimeout(100);
}

async function attachOutputAnalysers(page: Page, trackIds: string[]): Promise<void> {
  await page.evaluate((ids) => {
    type TrackBus = { getOutputNode: () => AudioNode };
    type TrackBusManager = { getOrCreateBus: (trackId: string) => TrackBus };
    type Engine = {
      getAudioContext?: () => AudioContext | null;
      masterGain?: AudioNode | null;
      trackBusManager?: TrackBusManager;
    };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    const audioContext = engine?.getAudioContext?.();
    const masterGain = engine?.masterGain;
    const trackBusManager = engine?.trackBusManager;
    if (!audioContext || !masterGain || !trackBusManager) {
      throw new Error('Audio engine/masterGain/trackBusManager unavailable');
    }

    const trackAnalysers: Record<string, AnalyserNode> = {};
    for (const id of ids) {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      trackBusManager.getOrCreateBus(id).getOutputNode().connect(analyser);
      trackAnalysers[id] = analyser;
    }

    const masterAnalyser = audioContext.createAnalyser();
    masterAnalyser.fftSize = 2048;
    masterGain.connect(masterAnalyser);

    (window as unknown as {
      __allInstrumentSequencerProbe__?: {
        trackAnalysers: Record<string, AnalyserNode>;
        masterAnalyser: AnalyserNode;
      };
    }).__allInstrumentSequencerProbe__ = { trackAnalysers, masterAnalyser };
  }, trackIds);
}

async function sampleOutputEnergy(page: Page): Promise<{
  master: { peak: number; rms: number };
  tracks: Record<string, { peak: number; rms: number }>;
}> {
  const totals: Record<string, { peak: number; rms: number }> = {};
  let masterPeak = 0;
  let masterRms = 0;

  for (let i = 0; i < MEASURE_ITERATIONS; i++) {
    const frame = await page.evaluate(() => {
      const probe = (window as unknown as {
        __allInstrumentSequencerProbe__?: {
          trackAnalysers: Record<string, AnalyserNode>;
          masterAnalyser: AnalyserNode;
        };
      }).__allInstrumentSequencerProbe__;
      if (!probe) throw new Error('All-instrument sequencer probe was not attached');

      const readEnergy = (analyser: AnalyserNode): { peak: number; rms: number } => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        let sumSq = 0;
        for (const v of data) {
          peak = Math.max(peak, Math.abs(v));
          sumSq += v * v;
        }
        return { peak, rms: Math.sqrt(sumSq / data.length) };
      };

      const tracks: Record<string, { peak: number; rms: number }> = {};
      for (const [trackId, analyser] of Object.entries(probe.trackAnalysers)) {
        tracks[trackId] = readEnergy(analyser);
      }
      return { master: readEnergy(probe.masterAnalyser), tracks };
    });

    masterPeak = Math.max(masterPeak, frame.master.peak);
    masterRms = Math.max(masterRms, frame.master.rms);
    for (const [trackId, energy] of Object.entries(frame.tracks)) {
      totals[trackId] ??= { peak: 0, rms: 0 };
      totals[trackId].peak = Math.max(totals[trackId].peak, energy.peak);
      totals[trackId].rms = Math.max(totals[trackId].rms, energy.rms);
    }
    await page.waitForTimeout(MEASURE_INTERVAL_MS);
  }

  return { master: { peak: masterPeak, rms: masterRms }, tracks: totals };
}

async function clickPlayButton(page: Page): Promise<void> {
  const playButton = page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first();
  await playButton.click();
}

test('every catalog instrument sequencer step produces live master output', async ({ page, request }) => {
  test.setTimeout(240_000);
  const specs = allInstrumentSpecs();
  expect(specs).toHaveLength(100);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    const text = msg.text();
    if (
      msg.type() === 'error' ||
      text.includes('Sample not found') ||
      (text.includes('not ready') && text.includes('skipping'))
    ) {
      consoleErrors.push(`[${msg.type()}] ${text}`);
    }
  });

  const results: TrackProbeResult[] = [];
  const sessionResults: Array<{
    sessionId: string;
    instruments: string[];
    masterPeak: number;
    masterRms: number;
  }> = [];

  for (const [batchIndex, batchSpecs] of chunk(specs, MAX_TRACKS).entries()) {
    const tracks = batchSpecs.map((spec, i) => buildSequencerTrack(spec, batchIndex * MAX_TRACKS + i));
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks,
      tempo: SESSION_TEMPO,
      swing: 0,
      version: 1,
    });

    await page.goto(`${API_BASE}/s/${sessionId}`);
    await waitForAppReady(page);
    await expect(page.locator('.track-row')).toHaveCount(tracks.length, { timeout: 20_000 });

    await prepareAudioForTracks(page, tracks);
    await attachOutputAnalysers(page, tracks.map(t => t.id));
    await clickPlayButton(page);
    const energy = await sampleOutputEnergy(page);
    await clickPlayButton(page).catch(() => {});

    sessionResults.push({
      sessionId,
      instruments: batchSpecs.map(s => s.sampleId),
      masterPeak: energy.master.peak,
      masterRms: energy.master.rms,
    });

    for (const [i, spec] of batchSpecs.entries()) {
      const trackId = tracks[i].id;
      const trackEnergy = energy.tracks[trackId] ?? { peak: 0, rms: 0 };
      results.push({ ...spec, trackId, sessionId, peak: trackEnergy.peak, rms: trackEnergy.rms });
    }
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'all-instruments-master-output.json'),
    JSON.stringify(
      {
        generatedFrom: 'Chromium live sequencer sessions for every INSTRUMENT_CATEGORIES entry; per-track bus analysers + masterGain analyser',
        silencePeakThreshold: SILENCE_PEAK,
        silenceRmsThreshold: SILENCE_RMS,
        tempo: SESSION_TEMPO,
        stepCount: STEP_COUNT,
        sessions: sessionResults,
        instruments: results,
        diagnostics: { pageErrors, consoleErrors },
      },
      null,
      2,
    ) + '\n',
  );

  const silentTracks = results.filter(r => r.peak <= SILENCE_PEAK && r.rms <= SILENCE_RMS);
  const silentSessions = sessionResults.filter(r => r.masterPeak <= SILENCE_PEAK && r.masterRms <= SILENCE_RMS);
  expect(pageErrors, 'Browser page errors during all-instrument sequencer output smoke').toEqual([]);
  expect(consoleErrors, 'Console errors/skipped notes during all-instrument sequencer output smoke').toEqual([]);
  expect(
    silentSessions.map(r => ({ sessionId: r.sessionId, instruments: r.instruments, peak: r.masterPeak, rms: r.masterRms })),
    'Every sequencer session chunk should produce master output energy',
  ).toEqual([]);
  expect(
    silentTracks.map(r => ({ sampleId: r.sampleId, type: r.type, pitch: r.pitch, peak: r.peak, rms: r.rms })),
    'Every catalog instrument should produce per-track output from a scheduled sequencer step',
  ).toEqual([]);
});
