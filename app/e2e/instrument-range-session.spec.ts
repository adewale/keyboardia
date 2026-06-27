import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSessionWithRetry, API_BASE } from './test-utils';
import { waitForAppReady } from './global-setup';
import { MAX_TRACKS } from '../src/types';

/**
 * INSTRUMENT-RANGE AUDIT — LAYER (c): LIVE SESSION SIMULATION
 * ===========================================================
 *
 * This builds real app sessions that contain sampled-instrument tracks, places
 * steps at a spread of pitch offsets, opens the app, presses PLAY, and observes
 * the running audio engine:
 *
 *   - captures the engine's own `[RANGE] Skipping note ...` console logs, which
 *     are emitted exactly when a scheduled note is dropped for being outside an
 *     instrument's playableRange, and
 *   - taps the live masterGain via an AnalyserNode to confirm each session as a
 *     whole is producing audio.
 *
 * Output: test-results/instrument-range/live-session.json (+ console summary).
 *
 * Run with Vite's mock API so it is hermetic:
 *   USE_MOCK_API=1 npx playwright test e2e/instrument-range-session.spec.ts --project=chromium
 */

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../public/instruments');
const REPORT_DIR = resolve(THIS_DIR, '../test-results/instrument-range');

// Probe a spread across the grid: deep low, low, octave, fifth, root, up...
const PROBE_OFFSETS = [-24, -18, -12, -7, 0, 7, 12, 18, 24];
const STEP_COUNT = 16;
const TOTAL_STEPS = 64;

function sampledInstrumentIds(): string[] {
  const ids: string[] = [];
  for (const entry of readdirSync(INSTRUMENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(
        readFileSync(resolve(INSTRUMENTS_DIR, entry.name, 'manifest.json'), 'utf-8')
      );
      if (Array.isArray(manifest.samples) && manifest.samples.length > 0) {
        ids.push(manifest.id ?? entry.name);
      }
    } catch {
      /* skip */
    }
  }
  return ids.sort();
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** A track that plays PROBE_OFFSETS, one per step, via per-step pitch locks. */
function buildTrack(id: string, index: number) {
  const steps = Array(TOTAL_STEPS).fill(false) as boolean[];
  const parameterLocks = Array(TOTAL_STEPS).fill(null) as Array<{ pitch: number } | null>;
  PROBE_OFFSETS.forEach((offset, i) => {
    steps[i] = true;
    parameterLocks[i] = { pitch: offset };
  });
  return {
    id: `track-${index}-${id}`,
    name: id,
    // Production tracks use the sampled: namespace. Raw manifest IDs route as
    // plain samples and make the audit falsely silent (`Sample not found`).
    sampleId: `sampled:${id}`,
    steps,
    parameterLocks,
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: STEP_COUNT,
  };
}

async function attachMasterAnalyser(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const engine = (window as unknown as {
      __audioEngine__?: { getAudioContext?: () => AudioContext | null; masterGain?: AudioNode | null };
    }).__audioEngine__;
    return Boolean(engine?.getAudioContext?.() && engine.masterGain);
  }, { timeout: 20_000 });

  await page.evaluate(() => {
    const engine = (window as unknown as {
      __audioEngine__?: { getAudioContext?: () => AudioContext | null; masterGain?: AudioNode | null };
      __rangeProbeAnalyser__?: AnalyserNode;
    }).__audioEngine__;
    const audioContext = engine?.getAudioContext?.();
    const masterGain = engine?.masterGain;
    if (!audioContext || !masterGain) {
      throw new Error('Audio engine is initialized but no AudioContext/masterGain is available');
    }
    const analyser = audioContext.createAnalyser();
    masterGain.connect(analyser);
    (window as unknown as { __rangeProbeAnalyser__?: AnalyserNode }).__rangeProbeAnalyser__ = analyser;
  });
}

async function sampleMasterPeak(page: Page): Promise<number> {
  let masterPeak = 0;
  for (let t = 0; t < 50; t++) {
    masterPeak = Math.max(
      masterPeak,
      await page.evaluate(() => {
        const analyser = (window as unknown as { __rangeProbeAnalyser__?: AnalyserNode })
          .__rangeProbeAnalyser__;
        if (!analyser) throw new Error('Range probe analyser was not attached');
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        return peak;
      })
    );
    await page.waitForTimeout(100);
  }
  return masterPeak;
}

test('plays every sampled instrument across a range of notes in live sessions', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const ids = sampledInstrumentIds();
  expect(ids.length).toBeGreaterThan(0);

  // The real backend validates MAX_TRACKS, so split the catalogue into valid
  // user-representative sessions instead of creating one impossible 27-track
  // fixture that only the mock API would accept.
  const batches = chunk(ids, MAX_TRACKS);

  const rangeSkips: Array<{ instrument: string; note: number; min: number; max: number }> = [];
  const consoleDiagnostics: string[] = [];
  const pageErrors: string[] = [];
  const rangeRe = /\[RANGE\] Skipping note (-?\d+) for (\S+) \(outside range \[(-?\d+), ?(-?\d+)\]\)/;

  page.on('console', msg => {
    const text = msg.text();
    const m = rangeRe.exec(text);
    if (m) {
      rangeSkips.push({
        note: Number(m[1]),
        instrument: m[2],
        min: Number(m[3]),
        max: Number(m[4]),
      });
    }
    if (
      text.includes('Sample not found') ||
      text.includes('AudioEngine') ||
      text.includes('[RANGE]') ||
      msg.type() === 'error'
    ) {
      consoleDiagnostics.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  const sessionResults: Array<{ sessionId: string; instruments: string[]; masterPeak: number }> = [];

  for (const [batchIndex, batchIds] of batches.entries()) {
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: batchIds.map((id, i) => buildTrack(id, batchIndex * MAX_TRACKS + i)),
      tempo: 160, // brisk, so a full 16-step loop finishes quickly
      swing: 0,
      version: 1,
    });

    await page.goto(`${API_BASE}/s/${sessionId}`);
    await waitForAppReady(page);
    await expect(page.locator('.track-row')).toHaveCount(batchIds.length, { timeout: 20_000 });

    // Press play (this user gesture also unlocks the AudioContext).
    const playButton = page
      .locator('[data-testid="play-button"]')
      .or(page.getByRole('button', { name: /play/i }))
      .first();
    await playButton.click();

    await attachMasterAnalyser(page);
    const masterPeak = await sampleMasterPeak(page);
    sessionResults.push({ sessionId, instruments: batchIds, masterPeak });

    // Stop before navigating to the next batch/session.
    await playButton.click().catch(() => {});
  }

  // ---- Aggregate per instrument ----
  const byInstrument = new Map<string, Set<number>>();
  for (const s of rangeSkips) {
    if (!byInstrument.has(s.instrument)) byInstrument.set(s.instrument, new Set());
    byInstrument.get(s.instrument)!.add(s.note);
  }

  const lines: string[] = ['', '=== INSTRUMENT RANGE — LAYER (c) LIVE SESSIONS ===', ''];
  lines.push(`${sessionResults.length} sessions, ${ids.length} tracks, probe offsets ${PROBE_OFFSETS.join(',')}`);
  for (const s of sessionResults) {
    lines.push(`Session ${s.sessionId} (${s.instruments.length} tracks) master peak: ${s.masterPeak.toFixed(4)}`);
  }
  lines.push('');
  for (const id of ids) {
    const skipped = byInstrument.get(id);
    lines.push(
      skipped && skipped.size
        ? `${id.padEnd(22)} skipped notes ${[...skipped].sort((a, b) => a - b).join(',')}`
        : `${id.padEnd(22)} no range skips observed`
    );
  }

  console.log(lines.join('\n'));

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'live-session.json'),
    JSON.stringify(
      {
        layer: 'c-live-session',
        generatedFrom: 'Real app playing sampled-instrument sessions; engine [RANGE] logs + master analyser',
        sessionId: sessionResults.map(s => s.sessionId).join(','),
        sessions: sessionResults,
        tempo: 160,
        probeOffsets: PROBE_OFFSETS,
        masterPeak: Math.max(...sessionResults.map(s => s.masterPeak)),
        minMasterPeak: Math.min(...sessionResults.map(s => s.masterPeak)),
        rangeSkips,
        byInstrument: ids.map(id => ({
          id,
          skippedNotes: [...(byInstrument.get(id) ?? [])].sort((a, b) => a - b),
        })),
        diagnostics: {
          pageErrors,
          console: consoleDiagnostics.slice(-100),
        },
      },
      null,
      2
    ) + '\n'
  );

  const silentSessions = sessionResults.filter(s => s.masterPeak <= 0);
  expect(pageErrors, 'Browser page errors during live range audit').toEqual([]);
  expect(
    consoleDiagnostics.filter(line => line.includes('Sample not found')),
    'No track should route a sampled instrument as a missing plain sample',
  ).toEqual([]);
  expect(
    silentSessions,
    'Each live session chunk should produce master output',
  ).toEqual([]);
});
