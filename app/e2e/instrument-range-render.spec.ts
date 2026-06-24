import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * INSTRUMENT-RANGE AUDIT — LAYER (b): OFFLINE-RENDER RMS
 * =====================================================
 *
 * Higher fidelity than the layer (a) static matrix. Instead of checking
 * whether playNote() returns a source, this RENDERS real audio through an
 * OfflineAudioContext using the REAL SampledInstrument and the REAL decoded
 * .mp3 samples, then measures peak/RMS per note. That catches a class of
 * silence the static matrix cannot: a note where playNote() returns a source
 * but the rendered output is actually inaudible (empty buffer, pitchRatio that
 * collapses, gain that resolves to ~0, etc.).
 *
 * It drives production code unchanged — it dynamically imports the app's
 * SampledInstrument module from the vite dev server and feeds it an
 * OfflineAudioContext as its AudioContext.
 *
 * Output: test-results/instrument-range/offline-render.json (+ console table).
 * This is an AUDIT artifact, not a pass/fail gate — it asserts only that it
 * produced a result for every instrument.
 *
 * REQUIRES a real browser (Chromium). Run with:
 *   npx playwright test e2e/instrument-range-render.spec.ts --project=chromium
 */

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../public/instruments');
const REPORT_DIR = resolve(THIS_DIR, '../test-results/instrument-range');

const BASE_MIDI = 60; // C4 — SCHEDULER_BASE_MIDI_NOTE
const MIN_PITCH = -24;
const MAX_PITCH = 24;
const VELOCITY = 100;
// Below this rendered peak amplitude a note is treated as inaudible.
const SILENCE_PEAK = 1e-3;

/** Sampled-instrument ids (directories under public/instruments with samples). */
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
      /* no manifest — skip */
    }
  }
  return ids.sort();
}

interface NoteResult {
  pitch: number;
  midi: number;
  sourceCreated: boolean;
  peak: number;
  rms: number;
}

test('renders every sampled instrument across the grid range and measures audio', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const ids = sampledInstrumentIds();
  expect(ids.length).toBeGreaterThan(0);

  // Load the app origin so the vite dev server can serve ES modules + samples.
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const report: Array<{ id: string; notes: NoteResult[]; error?: string }> = [];

  for (const id of ids) {
    const result = await page.evaluate(
      async ({ id, BASE_MIDI, MIN_PITCH, MAX_PITCH, VELOCITY }) => {
        // Vite (in the browser) resolves this dev-server path at runtime; the
        // variable specifier keeps tsc from trying to resolve it at build time.
        const modPath = '/src/audio/sampled-instrument.ts';
        const mod = await import(/* @vite-ignore */ modPath);
        const SampledInstrument = (mod as { SampledInstrument: new (
          id: string,
          baseUrl?: string
        ) => {
          initialize(ctx: BaseAudioContext, dest: AudioNode): void;
          ensureLoaded(): Promise<boolean>;
          getSampleNotes(): number[];
          playNote(
            noteId: string,
            midiNote: number,
            time: number,
            duration?: number,
            volume?: number,
            velocity?: number
          ): AudioBufferSourceNode | null;
        } }).SampledInstrument;

        // How many distinct sample notes should eventually load?
        const manifest = await (await fetch(`/instruments/${id}/manifest.json`)).json();
        const distinctNotes = new Set<number>(
          (manifest.samples as Array<{ note: number }>).map(s => s.note)
        ).size;

        const sr = 44100;
        const gap = 0.6; // seconds between successive note onsets
        const noteDur = 0.4; // measured window per note
        const count = MAX_PITCH - MIN_PITCH + 1;
        const lengthSamples = Math.ceil(sr * gap * count) + sr;

        const offline = new OfflineAudioContext(2, lengthSamples, sr);
        const inst = new SampledInstrument(id, '/instruments');
        inst.initialize(offline, offline.destination);
        await inst.ensureLoaded();

        // Progressive loading streams samples in the background; wait for them
        // so silence reflects range, not an unfinished load.
        const deadline = Date.now() + 15_000;
        while (inst.getSampleNotes().length < distinctNotes && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 50));
        }

        const sourceCreated: boolean[] = [];
        for (let i = 0; i < count; i++) {
          const pitch = MIN_PITCH + i;
          const src = inst.playNote(`r${pitch}`, BASE_MIDI + pitch, i * gap, noteDur, 1, VELOCITY);
          sourceCreated.push(src !== null);
        }

        const buf = await offline.startRendering();
        const ch0 = buf.getChannelData(0);
        const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;

        const notes = [] as Array<{
          pitch: number;
          midi: number;
          sourceCreated: boolean;
          peak: number;
          rms: number;
        }>;
        for (let i = 0; i < count; i++) {
          const pitch = MIN_PITCH + i;
          const start = Math.floor(i * gap * sr);
          const end = Math.min(buf.length, Math.floor((i * gap + noteDur) * sr));
          let peak = 0;
          let sumSq = 0;
          let n = 0;
          for (let s = start; s < end; s++) {
            const v = Math.max(Math.abs(ch0[s]), Math.abs(ch1[s]));
            if (v > peak) peak = v;
            sumSq += v * v;
            n++;
          }
          notes.push({
            pitch,
            midi: BASE_MIDI + pitch,
            sourceCreated: sourceCreated[i],
            peak,
            rms: n ? Math.sqrt(sumSq / n) : 0,
          });
        }
        return { notes };
      },
      { id, BASE_MIDI, MIN_PITCH, MAX_PITCH, VELOCITY }
    ).catch((err: unknown) => ({ notes: [] as NoteResult[], error: String(err) }));

    report.push({ id, ...result });
  }

  // ---- Console summary ----
  const lines: string[] = ['', '=== INSTRUMENT RANGE — LAYER (b) OFFLINE RENDER ===', ''];
  for (const r of report) {
    if (r.error) {
      lines.push(`${r.id.padEnd(22)} ERROR: ${r.error}`);
      continue;
    }
    const audible = r.notes.filter(n => n.peak >= SILENCE_PEAK).length;
    const silentRendered = r.notes.filter(n => n.sourceCreated && n.peak < SILENCE_PEAK);
    const silentNull = r.notes.filter(n => !n.sourceCreated);
    const extra = silentRendered.length
      ? `  ⚠ ${silentRendered.length} source-but-inaudible at offsets ${silentRendered.map(n => n.pitch).join(',')}`
      : '';
    lines.push(
      `${r.id.padEnd(22)} ${audible}/${r.notes.length} audible  (${silentNull.length} range-skipped)${extra}`
    );
  }
   
  console.log(lines.join('\n'));

  // ---- JSON artifact ----
  mkdirSync(REPORT_DIR, { recursive: true });
  const json = {
    layer: 'b-offline-render',
    generatedFrom: 'OfflineAudioContext render of real SampledInstrument with real .mp3 samples',
    basePitchMidi: BASE_MIDI,
    pitchRange: [MIN_PITCH, MAX_PITCH],
    velocity: VELOCITY,
    silencePeakThreshold: SILENCE_PEAK,
    instruments: report.map(r => ({
      id: r.id,
      error: r.error ?? null,
      silentNullOffsets: r.notes.filter(n => !n.sourceCreated).map(n => n.pitch),
      silentRenderedOffsets: r.notes
        .filter(n => n.sourceCreated && n.peak < SILENCE_PEAK)
        .map(n => n.pitch),
      notes: r.notes,
    })),
  };
  writeFileSync(resolve(REPORT_DIR, 'offline-render.json'), JSON.stringify(json, null, 2) + '\n');

  expect(report.length).toBe(ids.length);
});
