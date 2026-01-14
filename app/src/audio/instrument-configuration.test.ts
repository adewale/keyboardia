import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SAMPLED_INSTRUMENTS } from './sampled-instrument';
import { INSTRUMENT_CATEGORIES, VALID_SAMPLE_IDS } from '../components/sample-constants';
import { getPitchShiftAmount, needsPitchShiftWarning } from './instrument-ranges';

/**
 * Comprehensive Instrument Configuration Tests
 *
 * These tests ensure that all sampled instruments are properly configured
 * across ALL necessary registries. This catches bugs where an instrument
 * has a manifest but isn't visible in the UI.
 *
 * ROOT CAUSE ANALYSIS (Hammond Organ bug):
 * - Instrument had manifest.json ✓
 * - Instrument was in SAMPLED_INSTRUMENTS ✓
 * - Instrument was NOT in INSTRUMENT_CATEGORIES ✗ (UI registry)
 * - Result: Instrument worked internally but was invisible to users
 *
 * REGISTRIES THAT MUST BE SYNCHRONIZED:
 * 1. Manifest file: public/instruments/{id}/manifest.json
 * 2. Audio engine: SAMPLED_INSTRUMENTS in sampled-instrument.ts
 * 3. UI picker: INSTRUMENT_CATEGORIES in sample-constants.ts
 */

const INSTRUMENTS_DIR = path.join(__dirname, '../../public/instruments');

/**
 * Get all instrument IDs that have manifests
 */
function getManifestInstrumentIds(): string[] {
  if (!fs.existsSync(INSTRUMENTS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(INSTRUMENTS_DIR)
    .filter((dir) => {
      const manifestPath = path.join(INSTRUMENTS_DIR, dir, 'manifest.json');
      return fs.existsSync(manifestPath);
    })
    .sort();
}

/**
 * Get all sampled instrument IDs from INSTRUMENT_CATEGORIES
 */
function getSampledInstrumentsFromUI(): string[] {
  const sampledIds: string[] = [];

  for (const category of Object.values(INSTRUMENT_CATEGORIES)) {
    for (const instrument of category.instruments) {
      if (instrument.id.startsWith('sampled:')) {
        // Extract the instrument ID without the 'sampled:' prefix
        sampledIds.push(instrument.id.replace('sampled:', ''));
      }
    }
  }

  return sampledIds.sort();
}

describe('Instrument Configuration Completeness', () => {
  describe('Manifest → Audio Engine Sync', () => {
    it('every manifest should be registered in SAMPLED_INSTRUMENTS', () => {
      const manifestIds = getManifestInstrumentIds();
      const audioEngineIds = new Set(SAMPLED_INSTRUMENTS);

      const missingFromAudioEngine = manifestIds.filter(
        (id) => !audioEngineIds.has(id as typeof SAMPLED_INSTRUMENTS[number])
      );

      if (missingFromAudioEngine.length > 0) {
        throw new Error(
          `Instruments with manifests but NOT in SAMPLED_INSTRUMENTS (audio won't work):\n` +
            missingFromAudioEngine
              .map((id) => `  - ${id}`)
              .join('\n') +
            `\n\nFix: Add these to SAMPLED_INSTRUMENTS in src/audio/sampled-instrument.ts`
        );
      }
    });

    it('every SAMPLED_INSTRUMENTS entry should have a manifest', () => {
      const manifestIds = new Set(getManifestInstrumentIds());

      const missingManifests = SAMPLED_INSTRUMENTS.filter(
        (id) => !manifestIds.has(id)
      );

      if (missingManifests.length > 0) {
        throw new Error(
          `Instruments in SAMPLED_INSTRUMENTS but NO manifest found:\n` +
            missingManifests
              .map((id) => `  - ${id} (expected: public/instruments/${id}/manifest.json)`)
              .join('\n')
        );
      }
    });
  });

  describe('Manifest → UI Sync', () => {
    it('every manifest should be in INSTRUMENT_CATEGORIES (UI visibility)', () => {
      const manifestIds = getManifestInstrumentIds();
      const uiIds = new Set(getSampledInstrumentsFromUI());

      const missingFromUI = manifestIds.filter((id) => !uiIds.has(id));

      if (missingFromUI.length > 0) {
        throw new Error(
          `CRITICAL: Instruments with manifests but NOT in UI (users can't see them!):\n` +
            missingFromUI
              .map((id) => `  - sampled:${id}`)
              .join('\n') +
            `\n\nFix: Add these to INSTRUMENT_CATEGORIES in src/components/sample-constants.ts\n` +
            `This is the bug that caused Hammond Organ to be invisible!`
        );
      }
    });

    it('every sampled instrument in UI should have a manifest', () => {
      const manifestIds = new Set(getManifestInstrumentIds());
      const uiIds = getSampledInstrumentsFromUI();

      const missingManifests = uiIds.filter((id) => !manifestIds.has(id));

      if (missingManifests.length > 0) {
        throw new Error(
          `Instruments in UI but NO manifest found (will fail to load):\n` +
            missingManifests
              .map((id) => `  - sampled:${id}`)
              .join('\n')
        );
      }
    });
  });

  describe('Audio Engine → UI Sync', () => {
    it('SAMPLED_INSTRUMENTS and INSTRUMENT_CATEGORIES should match', () => {
      const audioEngineIds = new Set(SAMPLED_INSTRUMENTS);
      const uiIds = new Set(getSampledInstrumentsFromUI());

      const inAudioNotUI = [...audioEngineIds].filter((id) => !uiIds.has(id));
      const inUINotAudio = [...uiIds].filter((id) => !audioEngineIds.has(id as typeof SAMPLED_INSTRUMENTS[number]));

      const errors: string[] = [];

      if (inAudioNotUI.length > 0) {
        errors.push(
          `In SAMPLED_INSTRUMENTS but NOT in UI:\n` +
            inAudioNotUI.map((id) => `  - ${id}`).join('\n')
        );
      }

      if (inUINotAudio.length > 0) {
        errors.push(
          `In UI but NOT in SAMPLED_INSTRUMENTS:\n` +
            inUINotAudio.map((id) => `  - ${id}`).join('\n')
        );
      }

      if (errors.length > 0) {
        throw new Error(
          `Registries out of sync:\n\n${errors.join('\n\n')}\n\n` +
            `These two lists should be identical.`
        );
      }
    });
  });

  describe('VALID_SAMPLE_IDS completeness', () => {
    it('all sampled instruments should be in VALID_SAMPLE_IDS', () => {
      const missingIds: string[] = [];

      for (const id of SAMPLED_INSTRUMENTS) {
        const fullId = `sampled:${id}`;
        if (!VALID_SAMPLE_IDS.has(fullId)) {
          missingIds.push(fullId);
        }
      }

      if (missingIds.length > 0) {
        throw new Error(
          `Sampled instruments NOT in VALID_SAMPLE_IDS (session validation will reject them):\n` +
            missingIds.map((id) => `  - ${id}`).join('\n')
        );
      }
    });
  });

  describe('Individual instrument completeness', () => {
    const manifestIds = getManifestInstrumentIds();

    for (const instrumentId of manifestIds) {
      it(`${instrumentId} should be fully configured`, () => {
        const fullId = `sampled:${instrumentId}`;

        // Check manifest exists
        const manifestPath = path.join(
          INSTRUMENTS_DIR,
          instrumentId,
          'manifest.json'
        );
        expect(
          fs.existsSync(manifestPath),
          `Manifest missing: ${manifestPath}`
        ).toBe(true);

        // Check in SAMPLED_INSTRUMENTS
        expect(
          (SAMPLED_INSTRUMENTS as readonly string[]).includes(instrumentId),
          `Not in SAMPLED_INSTRUMENTS: ${instrumentId}`
        ).toBe(true);

        // Check in INSTRUMENT_CATEGORIES (UI)
        expect(
          VALID_SAMPLE_IDS.has(fullId),
          `Not in INSTRUMENT_CATEGORIES/VALID_SAMPLE_IDS: ${fullId}`
        ).toBe(true);
      });
    }
  });
});

describe('Instrument Manifest Validation', () => {
  const manifestIds = getManifestInstrumentIds();

  for (const instrumentId of manifestIds) {
    describe(instrumentId, () => {
      const manifestPath = path.join(
        INSTRUMENTS_DIR,
        instrumentId,
        'manifest.json'
      );
      let manifest: {
        id: string;
        name: string;
        type: string;
        samples: Array<{ note: number; file: string }>;
        playableRange?: { min: number; max: number };
        credits?: { source: string; license: string };
      };

      beforeAll(() => {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        manifest = JSON.parse(content);
      });

      it('should have required fields', () => {
        expect(manifest.id).toBe(instrumentId);
        expect(manifest.name).toBeDefined();
        expect(manifest.type).toBe('sampled');
        expect(manifest.samples).toBeDefined();
        expect(Array.isArray(manifest.samples)).toBe(true);
        expect(manifest.samples.length).toBeGreaterThan(0);
      });

      it('should have all sample files present', () => {
        for (const sample of manifest.samples) {
          const samplePath = path.join(
            INSTRUMENTS_DIR,
            instrumentId,
            sample.file
          );
          expect(
            fs.existsSync(samplePath),
            `Missing sample: ${sample.file}`
          ).toBe(true);
        }
      });

      it('should have valid playableRange if defined', () => {
        if (manifest.playableRange) {
          expect(manifest.playableRange.min).toBeLessThanOrEqual(
            manifest.playableRange.max
          );
          // Ensure default playback note (60/C4) is in range
          expect(manifest.playableRange.min).toBeLessThanOrEqual(60);
          expect(manifest.playableRange.max).toBeGreaterThanOrEqual(60);
        }
      });

      it('should have credits for license compliance', () => {
        expect(manifest.credits).toBeDefined();
        expect(manifest.credits?.source).toBeDefined();
        expect(manifest.credits?.license).toBeDefined();
      });

      it('should have playableRange defined', () => {
        expect(
          manifest.playableRange,
          `Missing playableRange for ${instrumentId}. This is required to prevent silent note failures.`
        ).toBeDefined();
      });
    });
  }
});

describe('SAMPLED_INSTRUMENT_NOTES Sync', () => {
  /**
   * Get unique sample notes from a manifest
   */
  function getManifestSampleNotes(manifestPath: string): number[] {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    const notes = new Set<number>();
    for (const sample of manifest.samples) {
      notes.add(sample.note);
    }
    return Array.from(notes).sort((a, b) => a - b);
  }

  it('SAMPLED_INSTRUMENT_NOTES should match actual manifest sample notes', () => {
    const errors: string[] = [];

    for (const instrumentId of SAMPLED_INSTRUMENTS) {
      const manifestPath = path.join(INSTRUMENTS_DIR, instrumentId, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      const manifestNotes = getManifestSampleNotes(manifestPath);
      const sampleId = `sampled:${instrumentId}`;

      // Check if the instrument is registered for pitch-shift warnings
      if (!needsPitchShiftWarning(sampleId)) {
        errors.push(
          `${sampleId} is not in SAMPLED_INSTRUMENT_NOTES but has manifest with notes: [${manifestNotes.join(', ')}]`
        );
        continue;
      }

      // Verify the notes match by checking pitch-shift calculation
      // If the notes are different, pitch-shift amounts will be wrong
      for (const note of manifestNotes) {
        const shift = getPitchShiftAmount(note, sampleId);
        if (shift !== 0) {
          errors.push(
            `${sampleId}: Sample at note ${note} has pitch-shift ${shift} (should be 0 for exact sample match). ` +
            `SAMPLED_INSTRUMENT_NOTES may be out of sync with manifest.`
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `SAMPLED_INSTRUMENT_NOTES is out of sync with manifests:\n` +
        errors.map(e => `  - ${e}`).join('\n') +
        `\n\nFix: Run 'npm run generate:instrument-notes' and update src/audio/instrument-ranges.ts`
      );
    }
  });

  it('all sampled instruments should be in SAMPLED_INSTRUMENT_NOTES', () => {
    const missing: string[] = [];

    for (const instrumentId of SAMPLED_INSTRUMENTS) {
      const sampleId = `sampled:${instrumentId}`;
      if (!needsPitchShiftWarning(sampleId)) {
        missing.push(sampleId);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Instruments missing from SAMPLED_INSTRUMENT_NOTES:\n` +
        missing.map(id => `  - ${id}`).join('\n') +
        `\n\nFix: Run 'npm run generate:instrument-notes' and update src/audio/instrument-ranges.ts`
      );
    }
  });
});
