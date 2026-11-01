import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { SAMPLED_INSTRUMENTS } from './sampled-instrument';
import { SCHEDULER_BASE_MIDI_NOTE, midiToNoteName } from './constants';

/**
 * A sampled-instrument manifest can silently suppress the scheduler's default
 * note when its playable range excludes C4. Validate the files the production
 * loader consumes; engine routing itself is exercised through audioTriggers and
 * scheduler tests rather than through a test-local copy of the prefix router.
 */
describe('sampled-instrument playable ranges', () => {
  const instrumentsDir = path.join(__dirname, '../../public/instruments');
  const manifests: Array<{ id: string; playableRange?: { min: number; max: number } }> = [];

  if (fs.existsSync(instrumentsDir)) {
    for (const dir of fs.readdirSync(instrumentsDir)) {
      const manifestPath = path.join(instrumentsDir, dir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        manifests.push({ id: manifest.id, playableRange: manifest.playableRange });
      }
    }
  }

  it(`includes ${midiToNoteName(SCHEDULER_BASE_MIDI_NOTE)} in every declared playable range`, () => {
    const failures = manifests
      .filter(manifest => manifest.playableRange)
      .filter(({ playableRange }) => (
        SCHEDULER_BASE_MIDI_NOTE < playableRange!.min ||
        SCHEDULER_BASE_MIDI_NOTE > playableRange!.max
      ))
      .map(({ id, playableRange }) => `${id}: [${playableRange!.min}, ${playableRange!.max}]`);

    expect(failures, 'instruments silent at the scheduler default note').toEqual([]);
  });

  it('loads one manifest for every active sampled instrument', () => {
    expect(new Set(manifests.map(manifest => manifest.id))).toEqual(new Set(SAMPLED_INSTRUMENTS));
  });
});
