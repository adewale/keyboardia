import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { ChokeGroupRegistry } from './choke-groups';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';

/**
 * INSTRUMENT-RANGE AUDIT — LAYER (b): HEADLESS OFFLINE-RENDER RMS
 * ==============================================================
 *
 * Higher fidelity than the layer (a) static matrix. Instead of only checking
 * whether playNote() returns a source, this RENDERS real audio through an
 * OfflineAudioContext using the REAL SampledInstrument and the REAL decoded
 * .mp3 samples, then measures peak/RMS per note. That catches a class of
 * silence the static matrix cannot see: a note where playNote() returns a
 * source but the rendered output is actually inaudible (empty buffer, a
 * pitchRatio that collapses, a gain that resolves to ~0, etc.).
 *
 * It runs headless (no browser) via node-web-audio-api, reusing the exact same
 * production seam as layer (a) — a global fetch stub feeding the real loader —
 * but with real sample bytes and a real decode/render instead of fakes. If the
 * native node-web-audio-api binary is unavailable on this platform the whole
 * suite skips rather than failing.
 *
 * Output: test-results/instrument-range/offline-render.json (gitignored),
 * consumed by scripts/instrument-range-report.ts. Audit artifact, not a gate.
 */

// node-web-audio-api ships a native binary; skip cleanly where it can't load.
const webAudio = await import('node-web-audio-api').catch(() => null);

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../../public/instruments');
const REPORT_DIR = resolve(THIS_DIR, '../../test-results/instrument-range');

const MIN_PITCH = -24;
const MAX_PITCH = 24;
const SIM_VELOCITY = 100;
// Below this rendered peak amplitude a note is treated as inaudible.
const SILENCE_PEAK = 1e-3;
const SAMPLE_RATE = 44100;
const NOTE_GAP_S = 0.6; // spacing between successive note onsets in the render
const NOTE_WINDOW_S = 0.4; // measured window per note

/** Serve the real manifest.json + real .mp3 bytes from disk to the loader. */
function installDiskFetch(): void {
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const rel = String(url).split('?')[0].replace(/^\/instruments\//, '');
    const buf = readFileSync(resolve(INSTRUMENTS_DIR, rel));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buf.toString('utf-8')),
      arrayBuffer: async () => ab,
      text: async () => buf.toString('utf-8'),
    };
  };
}

function loadManifests(): InstrumentManifest[] {
  const out: InstrumentManifest[] = [];
  for (const entry of readdirSync(INSTRUMENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const m = JSON.parse(
        readFileSync(resolve(INSTRUMENTS_DIR, entry.name, 'manifest.json'), 'utf-8')
      ) as InstrumentManifest;
      if (Array.isArray(m.samples) && m.samples.length > 0) {
        out.push({ ...m, id: m.id ?? entry.name });
      }
    } catch {
      /* directory without a manifest — skip */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

describe.skipIf(!webAudio)('instrument range — headless offline render (layer b)', () => {
  it('renders every sampled instrument across the grid range and measures audio', async () => {
    const { OfflineAudioContext } = webAudio!;
    installDiskFetch();
    const manifests = loadManifests();
    const count = MAX_PITCH - MIN_PITCH + 1;
    const summary: Array<{
      id: string;
      error: string | null;
      silentNullOffsets: number[];
      silentRenderedOffsets: number[];
      notes: Array<{ pitch: number; midi: number; sourceCreated: boolean; peak: number; rms: number }>;
    }> = [];

    for (const manifest of manifests) {
      const offline = new OfflineAudioContext(
        2,
        Math.ceil(SAMPLE_RATE * NOTE_GAP_S * count) + SAMPLE_RATE,
        SAMPLE_RATE
      );
      const inst = new SampledInstrument(manifest.id, '/instruments', {
        chokeRegistry: new ChokeGroupRegistry(),
      });
      inst.initialize(
        offline as unknown as AudioContext,
        offline.destination as unknown as AudioNode
      );
      await inst.ensureLoaded();

      // Progressive loading streams velocity layers in the background; wait for
      // them so "silent" reflects range, not an unfinished load.
      const distinctNotes = new Set(manifest.samples.map(s => s.note)).size;
      const deadline = Date.now() + 20_000;
      while (inst.getSampleNotes().length < distinctNotes && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 20));
      }

      const sourceCreated: boolean[] = [];
      for (let i = 0; i < count; i++) {
        const pitch = MIN_PITCH + i;
        const src = inst.playNote(
          `r${pitch}`,
          SCHEDULER_BASE_MIDI_NOTE + pitch,
          i * NOTE_GAP_S,
          NOTE_WINDOW_S,
          1,
          SIM_VELOCITY
        );
        sourceCreated.push(src !== null);
      }

      const buf = await offline.startRendering();
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;

      const notes = [];
      for (let i = 0; i < count; i++) {
        const start = Math.floor(i * NOTE_GAP_S * SAMPLE_RATE);
        const end = Math.min(buf.length, Math.floor((i * NOTE_GAP_S + NOTE_WINDOW_S) * SAMPLE_RATE));
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
          pitch: MIN_PITCH + i,
          midi: SCHEDULER_BASE_MIDI_NOTE + MIN_PITCH + i,
          sourceCreated: sourceCreated[i],
          peak: Number(peak.toFixed(6)),
          rms: n ? Number(Math.sqrt(sumSq / n).toFixed(6)) : 0,
        });
      }

      const silentRendered = notes.filter(x => x.sourceCreated && x.peak < SILENCE_PEAK);
      const audible = notes.filter(x => x.peak >= SILENCE_PEAK).length;

      expect(
        silentRendered,
        `${manifest.id} created AudioBufferSourceNode(s) that rendered below silence threshold`,
      ).toEqual([]);
      expect(
        notes.some(x => x.pitch === 0 && x.sourceCreated && x.peak >= SILENCE_PEAK),
        `${manifest.id} default dropped-step pitch should render audible audio`,
      ).toBe(true);

      console.log(
        `${manifest.id.padEnd(22)} ${audible}/${count} audible  (${notes.filter(x => !x.sourceCreated).length} range-skipped)` +
          (silentRendered.length
            ? `  ⚠ ${silentRendered.length} source-but-inaudible @ ${silentRendered.map(x => x.pitch).join(',')}`
            : '')
      );

      summary.push({
        id: manifest.id,
        error: null,
        silentNullOffsets: notes.filter(x => !x.sourceCreated).map(x => x.pitch),
        silentRenderedOffsets: silentRendered.map(x => x.pitch),
        notes,
      });
    }

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      resolve(REPORT_DIR, 'offline-render.json'),
      JSON.stringify(
        {
          layer: 'b-offline-render',
          generatedFrom:
            'Headless OfflineAudioContext (node-web-audio-api) render of real SampledInstrument with real .mp3 samples',
          basePitchMidi: SCHEDULER_BASE_MIDI_NOTE,
          pitchRange: [MIN_PITCH, MAX_PITCH],
          velocity: SIM_VELOCITY,
          silencePeakThreshold: SILENCE_PEAK,
          instruments: summary,
        },
        null,
        2
      ) + '\n'
    );

    // Sanity only — audit, not a behavioural gate.
    expect(summary.length).toBe(manifests.length);
  }, 180_000);
});
