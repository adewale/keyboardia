import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { ChokeGroupRegistry } from './choke-groups';
import { sampleCache } from './lru-sample-cache';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';
import {
  FakeAudioContext,
  FakeGainNode,
  makeSampleFetchStub,
} from './__fakes__/FakeWebAudio';

/**
 * AUTOMATED INSTRUMENT-RANGE SIMULATION
 * =====================================
 *
 * Simulates what happens when every sampled instrument in the catalogue is
 * "played" across the full range of pitches a user can place on the grid,
 * then reports which (instrument, pitch) combinations produce SILENCE.
 *
 * Why this exists: a step placed at certain vertical positions can be silent
 * while the same step one row up/down sounds fine. The cause lives inside
 * SampledInstrument.playNote(), which returns `null` (no Web Audio source =
 * silence) when a note is outside the instrument's playableRange or has no
 * usable sample. See sampled-instrument.ts:394-414.
 *
 * This drives the REAL playNote() — not a re-implementation of the rule — so
 * the matrix can never drift from production behaviour. It uses the same
 * FakeAudioContext + fetch-stub harness as sampled-instrument.playback.test.ts,
 * and the real manifests under public/instruments, so it runs in milliseconds
 * with no audio hardware.
 *
 * Output: a per-instrument summary to the console plus a full CSV matrix at
 * test-results/instrument-range-matrix.csv (one row per pitch, one column per
 * instrument; SOUND / silent).
 */

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../../public/instruments');
// app/test-results is gitignored, so the regenerated matrix never dirties the tree.
const REPORT_DIR = resolve(THIS_DIR, '../../test-results');

// The grid lets users set pitch offsets from -24 to +24 semitones relative to
// C4. The scheduler turns offset O into MIDI note (SCHEDULER_BASE_MIDI_NOTE + O).
const MIN_PITCH = -24;
const MAX_PITCH = 24;
// A representative "normal" velocity — mid-loud. Velocity-layer gaps are a
// separate axis; this simulation fixes velocity and sweeps pitch.
const SIM_VELOCITY = 100;

interface InstrumentResult {
  id: string;
  name: string;
  declaredRange?: { min: number; max: number };
  /** pitch offset -> did playNote produce a sound source? */
  sounded: Map<number, boolean>;
}

/** Load every manifest.json under public/instruments that defines samples. */
function loadManifests(): InstrumentManifest[] {
  const entries = readdirSync(INSTRUMENTS_DIR, { withFileTypes: true });
  const manifests: InstrumentManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try {
      raw = readFileSync(resolve(INSTRUMENTS_DIR, entry.name, 'manifest.json'), 'utf-8');
    } catch {
      continue; // directory without a manifest (e.g. shared assets)
    }
    const manifest = JSON.parse(raw) as InstrumentManifest;
    if (Array.isArray(manifest.samples) && manifest.samples.length > 0) {
      manifests.push({ ...manifest, id: manifest.id ?? entry.name });
    }
  }
  return manifests.sort((a, b) => a.id.localeCompare(b.id));
}

/** Boot a real SampledInstrument backed by the fake audio graph + fetch stub. */
async function bootInstrument(manifest: InstrumentManifest) {
  vi.stubGlobal('fetch', makeSampleFetchStub(manifest));

  const ctx = new FakeAudioContext();
  const destination = new FakeGainNode();
  const instrument = new SampledInstrument(manifest.id, '/instruments', {
    chokeRegistry: new ChokeGroupRegistry(),
  });
  instrument.initialize(ctx.asAudioContext(), destination as unknown as AudioNode);

  const loaded = await instrument.ensureLoaded();
  expect(loaded).toBe(true);

  // Progressive loading streams velocity layers in the background; wait for
  // them all so a "silent" result reflects range, not an unfinished load.
  const distinctNotes = [...new Set(manifest.samples.map(s => s.note))];
  await vi.waitFor(() => {
    const loadedLayers = distinctNotes.reduce(
      (sum, note) => sum + instrument.getVelocityLayerCount(note),
      0
    );
    expect(loadedLayers).toBe(manifest.samples.length);
  });

  return instrument;
}

/** Sweep the grid pitch range and record sound vs silence for each offset. */
function sweep(instrument: SampledInstrument): Map<number, boolean> {
  const sounded = new Map<number, boolean>();
  for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
    const midiNote = SCHEDULER_BASE_MIDI_NOTE + pitch;
    const source = instrument.playNote(
      `sim-${pitch}`,
      midiNote,
      0,
      0.25,
      1,
      SIM_VELOCITY
    );
    sounded.set(pitch, source !== null);
  }
  return sounded;
}

/** Collapse a sound/silence map into compact contiguous "silent" ranges. */
function silentRanges(sounded: Map<number, boolean>): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start: number | null = null;
  for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
    const silent = sounded.get(pitch) === false;
    if (silent && start === null) start = pitch;
    if (!silent && start !== null) {
      ranges.push([start, pitch - 1]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, MAX_PITCH]);
  return ranges;
}

function fmtRange([lo, hi]: [number, number]): string {
  return lo === hi ? `${lo >= 0 ? '+' : ''}${lo}` : `${lo >= 0 ? '+' : ''}${lo}..${hi >= 0 ? '+' : ''}${hi}`;
}

describe('instrument range simulation', () => {
  beforeEach(() => sampleCache.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('plays every instrument across the grid pitch range and reports silence', async () => {
    const manifests = loadManifests();
    expect(manifests.length).toBeGreaterThan(0);

    const results: InstrumentResult[] = [];
    for (const manifest of manifests) {
      sampleCache.clear();
      const instrument = await bootInstrument(manifest);
      results.push({
        id: manifest.id,
        name: manifest.name,
        declaredRange: manifest.playableRange,
        sounded: sweep(instrument),
      });
      vi.unstubAllGlobals();
    }

    // ---- Console summary (the human-readable simulation output) ----
    const lines: string[] = [];
    lines.push('');
    lines.push('=== INSTRUMENT RANGE SIMULATION ===');
    lines.push(`Pitch offsets ${MIN_PITCH}..+${MAX_PITCH} around C4 (MIDI ${SCHEDULER_BASE_MIDI_NOTE}), velocity ${SIM_VELOCITY}`);
    lines.push('');
    for (const r of results) {
      const silent = silentRanges(r.sounded);
      const audible = [...r.sounded.values()].filter(Boolean).length;
      const range = r.declaredRange
        ? `range[${r.declaredRange.min},${r.declaredRange.max}]`
        : 'no declared range';
      const silentDesc = silent.length
        ? `SILENT at offsets ${silent.map(fmtRange).join(', ')}`
        : 'audible across entire grid';
      lines.push(
        `${r.id.padEnd(22)} ${audible}/${r.sounded.size} audible  ${range.padEnd(22)} ${silentDesc}`
      );
    }
     
    console.log(lines.join('\n'));

    // ---- Full CSV matrix artifact ----
    const header = ['pitch_offset', 'midi', ...results.map(r => r.id)].join(',');
    const rows: string[] = [header];
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const cells = results.map(r => (r.sounded.get(pitch) ? 'SOUND' : 'silent'));
      rows.push([pitch, SCHEDULER_BASE_MIDI_NOTE + pitch, ...cells].join(','));
    }
    mkdirSync(REPORT_DIR, { recursive: true });
    const csvPath = resolve(REPORT_DIR, 'instrument-range-matrix.csv');
    writeFileSync(csvPath, rows.join('\n') + '\n', 'utf-8');
     
    console.log(`\nFull matrix written to ${csvPath}\n`);

    // ---- Invariant: nothing should be silent at the DEFAULT pitch (offset 0) ----
    // An instrument silent at offset 0 plays nothing when a user just drops a
    // note — it "appears broken." That is never acceptable, unlike the
    // expected silence at the extreme top/bottom of a limited range.
    const brokenAtDefault = results.filter(r => r.sounded.get(0) === false);
    expect(brokenAtDefault.map(r => r.id)).toEqual([]);
  });
});
