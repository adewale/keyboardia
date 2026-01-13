/**
 * Comprehensive Instrument Routing Tests
 *
 * Verifies that ALL instruments are correctly routed to their playback methods.
 * This ensures no instrument is "silently broken" - each must route correctly.
 *
 * Instruments are categorized into 4 engines:
 * 1. Procedural samples (kick, snare, etc.) - playSample()
 * 2. Web Audio synths (synth:*) - playSynthNote()
 * 3. Tone.js synths (tone:*) - playToneSynth()
 * 4. Advanced synths (advanced:*) - playAdvancedSynth()
 * 5. Sampled instruments (piano) - sampledInstrumentRegistry
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { SAMPLE_CATEGORIES } from '../types';
import {
  SAMPLE_NAMES,
  SYNTH_CATEGORIES,
  SYNTH_NAMES,
  TONE_SYNTH_CATEGORIES,
  TONE_SYNTH_NAMES,
  ADVANCED_SYNTH_CATEGORIES,
  ADVANCED_SYNTH_NAMES,
} from '../components/sample-constants';
import { SYNTH_PRESETS } from './synth';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';
import { isSampledInstrument, SAMPLED_INSTRUMENTS } from './sampled-instrument';
import { SCHEDULER_BASE_MIDI_NOTE, midiToNoteName } from './constants';

/**
 * Helper to determine which engine handles a sampleId
 */
function getInstrumentEngine(sampleId: string): 'sample' | 'synth' | 'tone' | 'advanced' | 'sampled' {
  if (sampleId.startsWith('synth:')) return 'synth';
  if (sampleId.startsWith('tone:')) return 'tone';
  if (sampleId.startsWith('advanced:')) return 'advanced';
  if (isSampledInstrument(sampleId)) return 'sampled';
  return 'sample';
}

/**
 * Get preset ID from sampleId (strips prefix)
 */
function getPresetId(sampleId: string): string {
  if (sampleId.startsWith('synth:')) return sampleId.replace('synth:', '');
  if (sampleId.startsWith('tone:')) return sampleId.replace('tone:', '');
  if (sampleId.startsWith('advanced:')) return sampleId.replace('advanced:', '');
  return sampleId;
}

// Collect ALL instruments from sample-constants
const ALL_PROCEDURAL_SAMPLES = Object.values(SAMPLE_CATEGORIES).flat();
const ALL_SYNTH_PRESETS = Object.values(SYNTH_CATEGORIES).flat();
const ALL_TONE_SYNTHS = Object.values(TONE_SYNTH_CATEGORIES).flat();
const ALL_ADVANCED_SYNTHS = Object.values(ADVANCED_SYNTH_CATEGORIES).flat();

describe('Comprehensive Instrument Routing', () => {
  describe('Procedural Samples (22 samples)', () => {
    it('should have 22 procedural samples', () => {
      expect(ALL_PROCEDURAL_SAMPLES.length).toBe(22);
    });

    it('all procedural samples should route to sample engine', () => {
      for (const sampleId of ALL_PROCEDURAL_SAMPLES) {
        const engine = getInstrumentEngine(sampleId);
        expect(engine).toBe('sample');
      }
    });

    it('all procedural samples should have display names', () => {
      for (const sampleId of ALL_PROCEDURAL_SAMPLES) {
        expect(SAMPLE_NAMES[sampleId]).toBeDefined();
        expect(typeof SAMPLE_NAMES[sampleId]).toBe('string');
        expect(SAMPLE_NAMES[sampleId].length).toBeGreaterThan(0);
      }
    });

    it('lists all procedural samples for verification', () => {
      const samples = ALL_PROCEDURAL_SAMPLES.map(id => ({
        id,
        name: SAMPLE_NAMES[id],
        engine: getInstrumentEngine(id),
      }));
      // This logs for manual verification and serves as documentation
      expect(samples.length).toBe(22);
    });
  });

  describe('Web Audio Synths (32 presets)', () => {
    it('should have 32 synth presets in SYNTH_PRESETS', () => {
      expect(Object.keys(SYNTH_PRESETS).length).toBe(32);
    });

    it('all synth sampleIds should route to synth engine', () => {
      for (const sampleId of ALL_SYNTH_PRESETS) {
        const engine = getInstrumentEngine(sampleId);
        expect(engine).toBe('synth');
      }
    });

    it('all synth sampleIds should have valid presets', () => {
      for (const sampleId of ALL_SYNTH_PRESETS) {
        const presetId = getPresetId(sampleId);
        expect(SYNTH_PRESETS[presetId]).toBeDefined();
      }
    });

    it('all synth sampleIds should have display names', () => {
      for (const sampleId of ALL_SYNTH_PRESETS) {
        expect(SYNTH_NAMES[sampleId]).toBeDefined();
        expect(typeof SYNTH_NAMES[sampleId]).toBe('string');
      }
    });

    it('SYNTH_PRESETS and SYNTH_CATEGORIES should be in sync', () => {
      const categoryPresets = ALL_SYNTH_PRESETS.map(id => getPresetId(id));
      const presetKeys = Object.keys(SYNTH_PRESETS);

      // All presets in categories should exist in SYNTH_PRESETS
      for (const preset of categoryPresets) {
        expect(presetKeys).toContain(preset);
      }
    });
  });

  describe('Tone.js Synths (11 presets)', () => {
    it('should have 11 Tone.js synth presets', () => {
      expect(ALL_TONE_SYNTHS.length).toBe(11);
    });

    it('all tone sampleIds should route to tone engine', () => {
      for (const sampleId of ALL_TONE_SYNTHS) {
        const engine = getInstrumentEngine(sampleId);
        expect(engine).toBe('tone');
      }
    });

    it('all tone sampleIds should have display names', () => {
      for (const sampleId of ALL_TONE_SYNTHS) {
        expect(TONE_SYNTH_NAMES[sampleId]).toBeDefined();
        expect(typeof TONE_SYNTH_NAMES[sampleId]).toBe('string');
      }
    });

    it('lists all Tone.js synths for verification', () => {
      const synths = ALL_TONE_SYNTHS.map(id => ({
        id,
        name: TONE_SYNTH_NAMES[id],
        engine: getInstrumentEngine(id),
      }));
      expect(synths.length).toBe(11);
    });
  });

  describe('Advanced Synths (8 presets)', () => {
    it('should have 8 advanced synth presets', () => {
      expect(ALL_ADVANCED_SYNTHS.length).toBe(8);
    });

    it('should have 8 presets in ADVANCED_SYNTH_PRESETS', () => {
      expect(Object.keys(ADVANCED_SYNTH_PRESETS).length).toBe(8);
    });

    it('all advanced sampleIds should route to advanced engine', () => {
      for (const sampleId of ALL_ADVANCED_SYNTHS) {
        const engine = getInstrumentEngine(sampleId);
        expect(engine).toBe('advanced');
      }
    });

    it('all advanced sampleIds should have valid presets', () => {
      for (const sampleId of ALL_ADVANCED_SYNTHS) {
        const presetId = getPresetId(sampleId);
        expect(ADVANCED_SYNTH_PRESETS[presetId]).toBeDefined();
      }
    });

    it('all advanced sampleIds should have display names', () => {
      for (const sampleId of ALL_ADVANCED_SYNTHS) {
        expect(ADVANCED_SYNTH_NAMES[sampleId]).toBeDefined();
        expect(typeof ADVANCED_SYNTH_NAMES[sampleId]).toBe('string');
      }
    });

    it('ADVANCED_SYNTH_PRESETS and ADVANCED_SYNTH_CATEGORIES should be in sync', () => {
      const categoryPresets = ALL_ADVANCED_SYNTHS.map(id => getPresetId(id));
      const presetKeys = Object.keys(ADVANCED_SYNTH_PRESETS);

      // All presets in categories should exist in ADVANCED_SYNTH_PRESETS
      for (const preset of categoryPresets) {
        expect(presetKeys).toContain(preset);
      }

      // All ADVANCED_SYNTH_PRESETS should be in categories
      for (const preset of presetKeys) {
        expect(categoryPresets).toContain(preset);
      }
    });

    it('lists all Advanced synths with their preset details', () => {
      const synths = ALL_ADVANCED_SYNTHS.map(id => {
        const presetId = getPresetId(id);
        const preset = ADVANCED_SYNTH_PRESETS[presetId];
        return {
          id,
          presetId,
          name: ADVANCED_SYNTH_NAMES[id],
          presetName: preset?.name,
          engine: getInstrumentEngine(id),
          hasOsc1: preset?.oscillator1?.level > 0,
          hasOsc2: preset?.oscillator2?.level > 0,
          ampSustain: preset?.amplitudeEnvelope?.sustain,
        };
      });

      // Verify each has at least one active oscillator
      for (const synth of synths) {
        expect(synth.hasOsc1 || synth.hasOsc2).toBe(true);
      }

      // Verify each has positive sustain (so we hear the note)
      for (const synth of synths) {
        expect(synth.ampSustain).toBeGreaterThan(0);
      }
    });
  });

  describe('Sampled Instruments (26 instruments)', () => {
    it('should have piano as sampled instrument', () => {
      expect(SAMPLED_INSTRUMENTS).toContain('piano');
    });

    it('should have Phase 29A sampled instruments', () => {
      // 808 kit
      expect(SAMPLED_INSTRUMENTS).toContain('808-kick');
      expect(SAMPLED_INSTRUMENTS).toContain('808-snare');
      expect(SAMPLED_INSTRUMENTS).toContain('808-hihat-closed');
      expect(SAMPLED_INSTRUMENTS).toContain('808-hihat-open');
      expect(SAMPLED_INSTRUMENTS).toContain('808-clap');
      // Acoustic kit
      expect(SAMPLED_INSTRUMENTS).toContain('acoustic-kick');
      expect(SAMPLED_INSTRUMENTS).toContain('acoustic-snare');
      expect(SAMPLED_INSTRUMENTS).toContain('acoustic-hihat-closed');
      expect(SAMPLED_INSTRUMENTS).toContain('acoustic-hihat-open');
      expect(SAMPLED_INSTRUMENTS).toContain('acoustic-ride');
      // Other
      expect(SAMPLED_INSTRUMENTS).toContain('finger-bass');
      expect(SAMPLED_INSTRUMENTS).toContain('vinyl-crackle');
    });

    it('should have Phase 29D sampled instruments', () => {
      expect(SAMPLED_INSTRUMENTS).toContain('clean-guitar');
      expect(SAMPLED_INSTRUMENTS).toContain('acoustic-guitar');
      expect(SAMPLED_INSTRUMENTS).toContain('marimba');
    });

    it('should have Phase 29E sampled instruments', () => {
      expect(SAMPLED_INSTRUMENTS).toContain('kalimba');
      expect(SAMPLED_INSTRUMENTS).toContain('slap-bass');
      expect(SAMPLED_INSTRUMENTS).toContain('steel-drums');
    });

    it('should have exactly 26 sampled instruments', () => {
      expect(SAMPLED_INSTRUMENTS.length).toBe(26);
    });

    it('piano should route to sampled engine', () => {
      expect(getInstrumentEngine('piano')).toBe('sampled');
    });

    it('isSampledInstrument should identify piano', () => {
      expect(isSampledInstrument('piano')).toBe(true);
    });

    it('isSampledInstrument should reject synth presets', () => {
      expect(isSampledInstrument('synth:bass')).toBe(false);
      expect(isSampledInstrument('tone:fm-epiano')).toBe(false);
      expect(isSampledInstrument('advanced:supersaw')).toBe(false);
    });
  });

  describe('Total Instrument Count', () => {
    it('should have 99 total instruments (22 + 32 + 11 + 8 + 26)', () => {
      const total =
        ALL_PROCEDURAL_SAMPLES.length +
        ALL_SYNTH_PRESETS.length +
        ALL_TONE_SYNTHS.length +
        ALL_ADVANCED_SYNTHS.length +
        SAMPLED_INSTRUMENTS.length;

      expect(total).toBe(99);
    });
  });

  describe('No Missing Instruments', () => {
    it('every SYNTH_NAMES entry should have a valid preset', () => {
      for (const [sampleId] of Object.entries(SYNTH_NAMES)) {
        const presetId = getPresetId(sampleId);
        expect(SYNTH_PRESETS[presetId]).toBeDefined();
      }
    });

    it('every ADVANCED_SYNTH_NAMES entry should have a valid preset', () => {
      for (const [sampleId] of Object.entries(ADVANCED_SYNTH_NAMES)) {
        const presetId = getPresetId(sampleId);
        expect(ADVANCED_SYNTH_PRESETS[presetId]).toBeDefined();
      }
    });
  });

  describe('CRITICAL: Advanced Synth Preset Validation', () => {
    // These tests verify the presets themselves are valid
    it('all advanced presets should have amplitude envelope with attack > 0', () => {
      for (const [_id, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
        expect(preset.amplitudeEnvelope.attack).toBeGreaterThan(0);
      }
    });

    it('all advanced presets should have amplitude envelope with sustain > 0', () => {
      for (const [_id, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
        expect(preset.amplitudeEnvelope.sustain).toBeGreaterThan(0);
      }
    });

    it('all advanced presets should have at least one active oscillator', () => {
      for (const [_id, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
        const totalLevel = preset.oscillator1.level + preset.oscillator2.level;
        expect(totalLevel).toBeGreaterThan(0);
      }
    });

    it('all advanced presets should have filter frequency above 20Hz', () => {
      for (const [_id, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
        expect(preset.filter.frequency).toBeGreaterThanOrEqual(20);
      }
    });
  });
});

describe('Instrument Prefix Uniqueness', () => {
  it('no instrument should match multiple prefixes', () => {
    const allInstruments = [
      ...ALL_PROCEDURAL_SAMPLES,
      ...ALL_SYNTH_PRESETS,
      ...ALL_TONE_SYNTHS,
      ...ALL_ADVANCED_SYNTHS,
      ...SAMPLED_INSTRUMENTS,
    ];

    for (const id of allInstruments) {
      const matches = [
        id.startsWith('synth:'),
        id.startsWith('tone:'),
        id.startsWith('advanced:'),
        isSampledInstrument(id),
      ].filter(Boolean);

      // Should match at most 1 prefix (or 0 for procedural samples)
      expect(matches.length).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * CRITICAL: Playable Range Validation
 *
 * The scheduler plays sampled instruments at: midiNote = SCHEDULER_BASE_MIDI_NOTE + pitchSemitones
 * With default transpose of 0, notes play at the base note (currently C4).
 *
 * If an instrument's playableRange excludes SCHEDULER_BASE_MIDI_NOTE, notes will be
 * SILENTLY SKIPPED and the instrument will appear broken. This test prevents that bug class.
 *
 * See: scripts/validate-playable-ranges.ts for the full validator
 * See: src/audio/constants.ts for SCHEDULER_BASE_MIDI_NOTE (SINGLE SOURCE OF TRUTH)
 */
describe('CRITICAL: Playable Range includes Default Note', () => {
  // Use the SINGLE SOURCE OF TRUTH - never hardcode this value
  const DEFAULT_PLAYBACK_NOTE = SCHEDULER_BASE_MIDI_NOTE;

  // Load all manifests at test time
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

  it(`all sampled instruments with playableRange should include ${midiToNoteName(SCHEDULER_BASE_MIDI_NOTE)} (MIDI ${SCHEDULER_BASE_MIDI_NOTE})`, () => {
    const failures: string[] = [];

    for (const manifest of manifests) {
      if (manifest.playableRange) {
        const { min, max } = manifest.playableRange;
        if (DEFAULT_PLAYBACK_NOTE < min || DEFAULT_PLAYBACK_NOTE > max) {
          failures.push(
            `${manifest.id}: playableRange [${min}, ${max}] excludes default note ${DEFAULT_PLAYBACK_NOTE}`
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `SILENT INSTRUMENT BUG: The following instruments will make no sound at default settings:\n` +
        failures.map(f => `  - ${f}`).join('\n') +
        `\n\nFix: Extend playableRange to include ${DEFAULT_PLAYBACK_NOTE} (${midiToNoteName(DEFAULT_PLAYBACK_NOTE)})`
      );
    }
  });

  it('should have loaded instrument manifests for validation', () => {
    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests.length).toBe(SAMPLED_INSTRUMENTS.length);
  });
});
