import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeDecodedSampleWithMono, type DecodedAudioLike } from '../scripts/sample-quality-core';
import { requireOfflineAudio } from '../src/test/session-render';

interface Mapping {
  note: number;
  file: string;
  velocityMin?: number;
  velocityMax?: number;
  gainDb?: number;
}

interface Manifest {
  id: string;
  name: string;
  gainDb?: number;
  samples: Mapping[];
}

const TARGET_STEP_DB = 2.5;

function readManifest(instrumentId: string): Manifest {
  return JSON.parse(readFileSync(
    path.resolve(`public/instruments/${instrumentId}/manifest.json`),
    'utf8',
  )) as Manifest;
}

function canonicalLoudLayer(manifest: Manifest, note: number): Mapping {
  const mappings = manifest.samples.filter(candidate => candidate.note === note);
  if (mappings.length === 0) throw new Error(`${manifest.id}: no mapping for MIDI ${note}`);
  return mappings.reduce((selected, candidate) =>
    (candidate.velocityMin ?? 0) > (selected.velocityMin ?? 0) ? candidate : selected
  );
}

describe('note-level remediation margin', () => {
  it('keeps the repaired finger-bass and steel-drum boundaries below 2.5 dB', async () => {
    const { OfflineAudioContext } = await requireOfflineAudio();
    const context = new OfflineAudioContext(1, 1, 44_100);
    const deliveredActiveRms = async (instrumentId: string, note: number): Promise<number> => {
      const manifest = readManifest(instrumentId);
      const mapping = canonicalLoudLayer(manifest, note);
      const bytes = readFileSync(path.resolve(`public/instruments/${instrumentId}/${mapping.file}`));
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = await context.decodeAudioData(arrayBuffer) as unknown as DecodedAudioLike;
      const { metrics } = analyzeDecodedSampleWithMono({
        instrumentId,
        instrumentName: manifest.name,
        file: mapping.file,
        note,
        velocityMin: mapping.velocityMin,
        velocityMax: mapping.velocityMax,
        pitched: true,
        playbackGainDb: (manifest.gainDb ?? 0) + (mapping.gainDb ?? 0),
      }, decoded);
      return metrics.activeRmsDb + metrics.playbackGainDb;
    };

    for (const [instrumentId, lower, upper] of [
      ['finger-bass', 33, 36],
      ['finger-bass', 39, 42],
      ['steel-drums', 62, 63],
    ] as const) {
      const delta = Math.abs(
        await deliveredActiveRms(instrumentId, upper)
        - await deliveredActiveRms(instrumentId, lower),
      );
      expect(delta, `${instrumentId} MIDI ${lower}->${upper}`).toBeLessThanOrEqual(TARGET_STEP_DB);
    }
  }, 30_000);
});
