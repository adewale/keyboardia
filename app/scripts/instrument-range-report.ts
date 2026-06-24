/**
 * Consolidated instrument-range audit report generator.
 *
 * Reads whichever of the three audit layers have been run and merges them into
 * a single human-readable markdown report:
 *
 *   (a) static-matrix.json   — vitest: real playNote() on a fake context
 *                              (src/audio/instrument-range-simulation.test.ts)
 *   (b) offline-render.json  — vitest: headless OfflineAudioContext render + RMS
 *                              (src/audio/instrument-range-render.test.ts)
 *   (c) live-session.json    — Playwright: real app playing one session
 *                              (e2e/instrument-range-session.spec.ts)
 *
 * Layers degrade gracefully: missing layers are reported as "not run". This is
 * an audit artifact, never a CI gate.
 *
 * Run:  npx tsx scripts/instrument-range-report.ts
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = resolve(THIS_DIR, '../test-results/instrument-range');

function readJson<T>(name: string): T | null {
  const p = resolve(REPORT_DIR, name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

interface StaticLayer {
  instruments: Array<{
    id: string;
    declaredRange: { min: number; max: number } | null;
    silentOffsets: number[];
  }>;
}
interface RenderLayer {
  silencePeakThreshold: number;
  instruments: Array<{
    id: string;
    error: string | null;
    silentNullOffsets: number[];
    silentRenderedOffsets: number[];
  }>;
}
interface SessionLayer {
  sessionId: string;
  masterPeak: number;
  byInstrument: Array<{ id: string; skippedNotes: number[] }>;
}

function fmtOffsets(offsets: number[]): string {
  if (!offsets.length) return '—';
  return offsets
    .slice()
    .sort((a, b) => a - b)
    .map(o => (o >= 0 ? `+${o}` : `${o}`))
    .join(', ');
}

const a = readJson<StaticLayer>('static-matrix.json');
const b = readJson<RenderLayer>('offline-render.json');
const c = readJson<SessionLayer>('live-session.json');

const ids = new Set<string>();
a?.instruments.forEach(i => ids.add(i.id));
b?.instruments.forEach(i => ids.add(i.id));
c?.byInstrument.forEach(i => ids.add(i.id));
const sortedIds = [...ids].sort();

const out: string[] = [];
out.push('# Instrument Range Audit');
out.push('');
out.push(
  'Which (instrument, grid pitch) combinations produce no sound. Pitch offsets are semitones relative to C4 (the default note); the grid spans −24…+24.'
);
out.push('');
out.push('## Layers run');
out.push('');
out.push(`- **(a) static matrix** — ${a ? '✅ run' : '⬜ not run'} — real \`playNote()\` returns null (range/sample rule).`);
out.push(`- **(b) offline render** — ${b ? '✅ run' : '⬜ not run'} — real audio rendered + RMS measured (catches inaudible-but-not-null).`);
out.push(`- **(c) live session** — ${c ? '✅ run' : '⬜ not run'} — real app played one multi-instrument session.`);
out.push('');
if (!b) out.push('> Layer (b) not run: `vitest run src/audio/instrument-range-render.test.ts`');
if (!c) out.push('> Layer (c) not run: `npx playwright test e2e/instrument-range-session.spec.ts --project=chromium`');
if (!b || !c) out.push('');

if (c) {
  out.push(`Layer (c) session \`${c.sessionId}\` master-output peak during playback: **${c.masterPeak.toFixed(4)}** ${c.masterPeak > 0 ? '(audible)' : '(SILENT — investigate)'}.`);
  out.push('');
}

out.push('## Per-instrument silence');
out.push('');
out.push('| Instrument | Declared range | (a) silent offsets | (b) inaudible (rendered) | (c) live skips |');
out.push('|---|---|---|---|---|');
for (const id of sortedIds) {
  const ai = a?.instruments.find(i => i.id === id);
  const bi = b?.instruments.find(i => i.id === id);
  const ci = c?.byInstrument.find(i => i.id === id);
  const range = ai?.declaredRange ? `[${ai.declaredRange.min}, ${ai.declaredRange.max}]` : '—';
  const aCell = ai ? fmtOffsets(ai.silentOffsets) : 'n/a';
  const bCell = bi
    ? bi.error
      ? `error`
      : bi.silentRenderedOffsets.length
        ? `⚠ ${fmtOffsets(bi.silentRenderedOffsets)}`
        : '—'
    : 'n/a';
  const cCell = ci ? (ci.skippedNotes.length ? `${ci.skippedNotes.length} notes` : '—') : 'n/a';
  out.push(`| \`${id}\` | ${range} | ${aCell} | ${bCell} | ${cCell} |`);
}
out.push('');
out.push('Legend: "(a) silent offsets" = grid rows that produce nothing. "(b) inaudible (rendered)" = playNote returned a source but the rendered audio was below the silence threshold (a bug class layer a cannot see). "(c) live skips" = `[RANGE]` drops observed while the real session played.');
out.push('');

const md = out.join('\n') + '\n';
const dest = resolve(REPORT_DIR, 'INSTRUMENT-RANGE-AUDIT.md');
writeFileSync(dest, md);
 
console.log(md);
 
console.log(`Report written to ${dest}`);
