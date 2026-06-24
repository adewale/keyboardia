import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSessionWithRetry, API_BASE } from './test-utils';
import { waitForAppReady } from './global-setup';

/**
 * INSTRUMENT-RANGE AUDIT — LAYER (c): LIVE SAME-SESSION SIMULATION
 * ===============================================================
 *
 * The literal version of the original question: "what happens when instruments
 * are played with a range of notes in the same session?" This builds ONE real
 * session containing a track per sampled instrument, places steps at a spread
 * of pitch offsets across each track, opens the real app, presses PLAY, and
 * observes the running audio engine:
 *
 *   - captures the engine's own `[RANGE] Skipping note ...` console logs, which
 *     are emitted exactly when a scheduled note is dropped for being outside an
 *     instrument's playableRange (the confirmed silence cause), and
 *   - taps the live masterGain via an AnalyserNode to confirm the session as a
 *     whole is producing audio.
 *
 * Output: test-results/instrument-range/live-session.json (+ console summary).
 * Audit artifact, not a gate — asserts only that the session played.
 *
 * REQUIRES a real browser + the dev/mock API. Run with:
 *   npx playwright test e2e/instrument-range-session.spec.ts --project=chromium
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

/** A track that plays PROBE_OFFSETS, one per step, via per-step pitch locks. */
function buildTrack(id: string, index: number) {
  const steps = Array(TOTAL_STEPS).fill(false) as boolean[];
  const parameterLocks = Array(TOTAL_STEPS).fill(null) as Array<{ pitch: number } | null>;
  PROBE_OFFSETS.forEach((offset, i) => {
    steps[i] = true;
    parameterLocks[i] = { pitch: offset };
  });
  return {
    id: `track-${index}`,
    name: id,
    sampleId: id,
    steps,
    parameterLocks,
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: STEP_COUNT,
  };
}

test('plays every instrument across a range of notes in one live session', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const ids = sampledInstrumentIds();
  expect(ids.length).toBeGreaterThan(0);

  const { id: sessionId } = await createSessionWithRetry(request, {
    tracks: ids.map((id, i) => buildTrack(id, i)),
    tempo: 160, // brisk, so a full 16-step loop finishes quickly
    swing: 0,
    version: 1,
  });

  // Capture the engine's range-skip logs from the moment the app loads.
  const rangeSkips: Array<{ instrument: string; note: number; min: number; max: number }> = [];
  const rangeRe = /\[RANGE\] Skipping note (-?\d+) for (\S+) \(outside range \[(-?\d+), ?(-?\d+)\]\)/;
  page.on('console', msg => {
    const m = rangeRe.exec(msg.text());
    if (m) {
      rangeSkips.push({
        note: Number(m[1]),
        instrument: m[2],
        min: Number(m[3]),
        max: Number(m[4]),
      });
    }
  });

  await page.goto(`${API_BASE}/s/${sessionId}`);
  await waitForAppReady(page);

  // Press play (this user gesture also unlocks the AudioContext).
  const playButton = page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first();
  await playButton.click();

  // Attach an analyser to the live master output to confirm overall audio.
  await page.evaluate(() => {
    const engine = (window as unknown as { __audioEngine__?: {
      audioContext: AudioContext;
      masterGain: AudioNode;
    } }).__audioEngine__;
    if (!engine) return;
    const analyser = engine.audioContext.createAnalyser();
    engine.masterGain.connect(analyser);
    (window as unknown as { __rangeProbeAnalyser__?: AnalyserNode }).__rangeProbeAnalyser__ =
      analyser;
  });

  // Let several loops run, sampling the master peak as we go.
  let masterPeak = 0;
  for (let t = 0; t < 50; t++) {
    masterPeak = Math.max(
      masterPeak,
      await page.evaluate(() => {
        const analyser = (window as unknown as { __rangeProbeAnalyser__?: AnalyserNode })
          .__rangeProbeAnalyser__;
        if (!analyser) return 0;
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        return peak;
      })
    );
    await page.waitForTimeout(100);
  }

  // ---- Aggregate per instrument ----
  const byInstrument = new Map<string, Set<number>>();
  for (const s of rangeSkips) {
    if (!byInstrument.has(s.instrument)) byInstrument.set(s.instrument, new Set());
    byInstrument.get(s.instrument)!.add(s.note);
  }

  const lines: string[] = ['', '=== INSTRUMENT RANGE — LAYER (c) LIVE SESSION ===', ''];
  lines.push(`Session ${sessionId}, ${ids.length} tracks, probe offsets ${PROBE_OFFSETS.join(',')}`);
  lines.push(`Master output peak during playback: ${masterPeak.toFixed(4)}`);
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
        generatedFrom: 'Real app playing a multi-instrument session; engine [RANGE] logs + master analyser',
        sessionId,
        tempo: 160,
        probeOffsets: PROBE_OFFSETS,
        masterPeak,
        rangeSkips,
        byInstrument: ids.map(id => ({
          id,
          skippedNotes: [...(byInstrument.get(id) ?? [])].sort((a, b) => a - b),
        })),
      },
      null,
      2
    ) + '\n'
  );

  // Audit, not gate: the session must have played (produced audio).
  expect(masterPeak).toBeGreaterThan(0);
});
