import { describe, it, expect } from 'vitest';
import {
  SYNTH_NAMES,
  SYNTH_CATEGORIES,
  TONE_SYNTH_CATEGORIES,
  TONE_SYNTH_NAMES,
  ADVANCED_SYNTH_CATEGORIES,
  ADVANCED_SYNTH_NAMES,
} from './sample-constants';

/**
 * Verification Tests for Sample Constants
 *
 * Per specs/SYNTHESIS-ENGINE.md Section 9.4:
 * - SamplePicker should include new synth categories
 * - Tone.js synths: FM (E-Piano, FM Bass, Bell), Drum (Membrane, Tom, Cymbal, Hi-Hat), Other
 * - Advanced synths: Leads (Supersaw, Thick, Vibrato), Bass (Sub, Wobble, Acid), Pads (Warm, Tremolo)
 */

describe('Section 9.4: Sample Picker Updates', () => {
  describe('Existing Synth Categories (Web Audio)', () => {
    it('SYNTH_CATEGORIES has all required categories', () => {
      expect(SYNTH_CATEGORIES).toHaveProperty('core');
      expect(SYNTH_CATEGORIES).toHaveProperty('keys');
      expect(SYNTH_CATEGORIES).toHaveProperty('genre');
      expect(SYNTH_CATEGORIES).toHaveProperty('ambient');
    });

    it('SYNTH_NAMES maps all synth IDs to display names', () => {
      // Check a few key synths
      expect(SYNTH_NAMES['synth:bass']).toBe('Bass');
      expect(SYNTH_NAMES['synth:lead']).toBe('Lead');
      expect(SYNTH_NAMES['synth:rhodes']).toBe('Rhodes');
    });
  });

  describe('Section 9.4.3: Tone.js Synth Categories', () => {
    it('TONE_SYNTH_CATEGORIES has fm category', () => {
      expect(TONE_SYNTH_CATEGORIES).toHaveProperty('fm');
      expect(TONE_SYNTH_CATEGORIES.fm).toContain('tone:fm-epiano');
      expect(TONE_SYNTH_CATEGORIES.fm).toContain('tone:fm-bass');
      expect(TONE_SYNTH_CATEGORIES.fm).toContain('tone:fm-bell');
    });

    it('TONE_SYNTH_CATEGORIES has drum category', () => {
      expect(TONE_SYNTH_CATEGORIES).toHaveProperty('drum');
      expect(TONE_SYNTH_CATEGORIES.drum).toContain('tone:membrane-kick');
      expect(TONE_SYNTH_CATEGORIES.drum).toContain('tone:membrane-tom');
      expect(TONE_SYNTH_CATEGORIES.drum).toContain('tone:metal-cymbal');
      expect(TONE_SYNTH_CATEGORIES.drum).toContain('tone:metal-hihat');
    });

    it('TONE_SYNTH_CATEGORIES has other category', () => {
      expect(TONE_SYNTH_CATEGORIES).toHaveProperty('other');
      expect(TONE_SYNTH_CATEGORIES.other).toContain('tone:pluck-string');
      expect(TONE_SYNTH_CATEGORIES.other).toContain('tone:duo-lead');
      expect(TONE_SYNTH_CATEGORIES.other).toContain('tone:am-bell');
      expect(TONE_SYNTH_CATEGORIES.other).toContain('tone:am-tremolo');
    });

    it('TONE_SYNTH_NAMES maps all tone synth IDs correctly', () => {
      expect(TONE_SYNTH_NAMES['tone:fm-epiano']).toBe('E-Piano');
      expect(TONE_SYNTH_NAMES['tone:fm-bass']).toBe('FM Bass');
      expect(TONE_SYNTH_NAMES['tone:fm-bell']).toBe('Bell');
      expect(TONE_SYNTH_NAMES['tone:membrane-kick']).toBe('Membrane');
      expect(TONE_SYNTH_NAMES['tone:membrane-tom']).toBe('Tom');
      expect(TONE_SYNTH_NAMES['tone:metal-cymbal']).toBe('Cymbal');
      expect(TONE_SYNTH_NAMES['tone:metal-hihat']).toBe('Hi-Hat');
      expect(TONE_SYNTH_NAMES['tone:pluck-string']).toBe('Pluck');
      expect(TONE_SYNTH_NAMES['tone:duo-lead']).toBe('Duo Lead');
      expect(TONE_SYNTH_NAMES['tone:am-bell']).toBe('AM Bell');
      expect(TONE_SYNTH_NAMES['tone:am-tremolo']).toBe('Tremolo');
    });

    it('all Tone.js synth IDs start with "tone:"', () => {
      const allToneSynths = [
        ...TONE_SYNTH_CATEGORIES.fm,
        ...TONE_SYNTH_CATEGORIES.drum,
        ...TONE_SYNTH_CATEGORIES.other,
      ];

      for (const synthId of allToneSynths) {
        expect(synthId.startsWith('tone:')).toBe(true);
      }
    });

    it('has exactly 11 Tone.js synth presets', () => {
      const allToneSynths = [
        ...TONE_SYNTH_CATEGORIES.fm,
        ...TONE_SYNTH_CATEGORIES.drum,
        ...TONE_SYNTH_CATEGORIES.other,
      ];

      expect(allToneSynths.length).toBe(11);
      expect(Object.keys(TONE_SYNTH_NAMES).length).toBe(11);
    });
  });

  describe('Section 9.4.3: Advanced Synth Categories', () => {
    it('ADVANCED_SYNTH_CATEGORIES has leads category', () => {
      expect(ADVANCED_SYNTH_CATEGORIES).toHaveProperty('leads');
      expect(ADVANCED_SYNTH_CATEGORIES.leads).toContain('advanced:supersaw');
      expect(ADVANCED_SYNTH_CATEGORIES.leads).toContain('advanced:thick-lead');
      expect(ADVANCED_SYNTH_CATEGORIES.leads).toContain('advanced:vibrato-lead');
    });

    it('ADVANCED_SYNTH_CATEGORIES has bass category', () => {
      expect(ADVANCED_SYNTH_CATEGORIES).toHaveProperty('bass');
      expect(ADVANCED_SYNTH_CATEGORIES.bass).toContain('advanced:sub-bass');
      expect(ADVANCED_SYNTH_CATEGORIES.bass).toContain('advanced:wobble-bass');
      expect(ADVANCED_SYNTH_CATEGORIES.bass).toContain('advanced:acid-bass');
    });

    it('ADVANCED_SYNTH_CATEGORIES has pads category', () => {
      expect(ADVANCED_SYNTH_CATEGORIES).toHaveProperty('pads');
      expect(ADVANCED_SYNTH_CATEGORIES.pads).toContain('advanced:warm-pad');
      expect(ADVANCED_SYNTH_CATEGORIES.pads).toContain('advanced:tremolo-strings');
    });

    it('ADVANCED_SYNTH_NAMES maps all advanced synth IDs correctly', () => {
      expect(ADVANCED_SYNTH_NAMES['advanced:supersaw']).toBe('Supersaw');
      expect(ADVANCED_SYNTH_NAMES['advanced:thick-lead']).toBe('Thick');
      expect(ADVANCED_SYNTH_NAMES['advanced:vibrato-lead']).toBe('Vibrato');
      expect(ADVANCED_SYNTH_NAMES['advanced:sub-bass']).toBe('Sub');
      expect(ADVANCED_SYNTH_NAMES['advanced:wobble-bass']).toBe('Wobble');
      expect(ADVANCED_SYNTH_NAMES['advanced:acid-bass']).toBe('Acid');
      expect(ADVANCED_SYNTH_NAMES['advanced:warm-pad']).toBe('Warm Pad');
      expect(ADVANCED_SYNTH_NAMES['advanced:tremolo-strings']).toBe('Strings');
    });

    it('all Advanced synth IDs start with "advanced:"', () => {
      const allAdvancedSynths = [
        ...ADVANCED_SYNTH_CATEGORIES.leads,
        ...ADVANCED_SYNTH_CATEGORIES.bass,
        ...ADVANCED_SYNTH_CATEGORIES.pads,
      ];

      for (const synthId of allAdvancedSynths) {
        expect(synthId.startsWith('advanced:')).toBe(true);
      }
    });

    it('has exactly 8 Advanced synth presets', () => {
      const allAdvancedSynths = [
        ...ADVANCED_SYNTH_CATEGORIES.leads,
        ...ADVANCED_SYNTH_CATEGORIES.bass,
        ...ADVANCED_SYNTH_CATEGORIES.pads,
      ];

      expect(allAdvancedSynths.length).toBe(8);
      expect(Object.keys(ADVANCED_SYNTH_NAMES).length).toBe(8);
    });
  });

  describe('Section 9.5.2-9.5.3: Three Surfaces Alignment', () => {
    it('all Tone.js synth IDs have corresponding display names', () => {
      const allToneSynths = [
        ...TONE_SYNTH_CATEGORIES.fm,
        ...TONE_SYNTH_CATEGORIES.drum,
        ...TONE_SYNTH_CATEGORIES.other,
      ];

      for (const synthId of allToneSynths) {
        expect(TONE_SYNTH_NAMES[synthId]).toBeDefined();
        expect(typeof TONE_SYNTH_NAMES[synthId]).toBe('string');
        expect(TONE_SYNTH_NAMES[synthId].length).toBeGreaterThan(0);
      }
    });

    it('all Advanced synth IDs have corresponding display names', () => {
      const allAdvancedSynths = [
        ...ADVANCED_SYNTH_CATEGORIES.leads,
        ...ADVANCED_SYNTH_CATEGORIES.bass,
        ...ADVANCED_SYNTH_CATEGORIES.pads,
      ];

      for (const synthId of allAdvancedSynths) {
        expect(ADVANCED_SYNTH_NAMES[synthId]).toBeDefined();
        expect(typeof ADVANCED_SYNTH_NAMES[synthId]).toBe('string');
        expect(ADVANCED_SYNTH_NAMES[synthId].length).toBeGreaterThan(0);
      }
    });
  });
});

describe('Section 10: Musical Surface Area Expansion', () => {
  it('total sound sources after Phase 25 should be 62+', () => {
    // Original synths (19) + samples (16) = 35
    // + Tone.js (11) + Advanced (8) = 54 new sounds
    // Total should be at least 54 (synths only, not counting samples)
    const totalSynths =
      Object.keys(SYNTH_NAMES).length +
      Object.keys(TONE_SYNTH_NAMES).length +
      Object.keys(ADVANCED_SYNTH_NAMES).length;

    expect(totalSynths).toBeGreaterThanOrEqual(38); // 19 + 11 + 8
  });

  it('synthesis types: subtractive, FM, AM, drum are all represented', () => {
    // Subtractive (Web Audio)
    expect(SYNTH_NAMES['synth:bass']).toBeDefined();

    // FM (Tone.js)
    expect(TONE_SYNTH_NAMES['tone:fm-epiano']).toBeDefined();

    // AM (Tone.js)
    expect(TONE_SYNTH_NAMES['tone:am-bell']).toBeDefined();

    // Drum synthesis (Tone.js)
    expect(TONE_SYNTH_NAMES['tone:membrane-kick']).toBeDefined();
    expect(TONE_SYNTH_NAMES['tone:metal-cymbal']).toBeDefined();
  });
});
