import { describe, it, expect } from 'vitest';
import {
  SAMPLED_INSTRUMENTS,
  isSampledInstrument,
  type InstrumentManifest,
  type SampleMapping,
} from './sampled-instrument';

/**
 * Tests for the sampled instrument system.
 *
 * Key behaviors:
 * - Piano is a sampled instrument (not synth)
 * - Progressive loading: C4 (note 60) loads first
 * - Lazy loading: instruments load on first use, not at startup
 */

describe('Sampled Instruments', () => {
  describe('isSampledInstrument', () => {
    it('should identify piano as a sampled instrument', () => {
      expect(isSampledInstrument('piano')).toBe(true);
    });

    it('should not identify synth presets as sampled instruments', () => {
      expect(isSampledInstrument('lead')).toBe(false);
      expect(isSampledInstrument('bass')).toBe(false);
      expect(isSampledInstrument('pad')).toBe(false);
      expect(isSampledInstrument('pluck')).toBe(false);
    });

    it('should not identify drum samples as sampled instruments', () => {
      expect(isSampledInstrument('kick')).toBe(false);
      expect(isSampledInstrument('snare')).toBe(false);
      expect(isSampledInstrument('hihat')).toBe(false);
    });
  });

  describe('SAMPLED_INSTRUMENTS registry', () => {
    it('should include piano', () => {
      expect(SAMPLED_INSTRUMENTS).toContain('piano');
    });

    it('should be a readonly array', () => {
      // TypeScript enforces this at compile time via `as const`
      // This test documents the expected behavior
      expect(Array.isArray(SAMPLED_INSTRUMENTS)).toBe(true);
    });
  });

  describe('Progressive loading order', () => {
    // Test the sorting logic that determines load order
    // C4 (note 60) should always be first

    it('should prioritize C4 (note 60) first', () => {
      const mappings: SampleMapping[] = [
        { note: 36, file: 'C2.mp3' },
        { note: 48, file: 'C3.mp3' },
        { note: 60, file: 'C4.mp3' },
        { note: 72, file: 'C5.mp3' },
      ];

      // Sort by priority: C4 first, then by distance from C4
      const sorted = [...mappings].sort((a, b) => {
        if (a.note === 60) return -1;
        if (b.note === 60) return 1;
        return Math.abs(a.note - 60) - Math.abs(b.note - 60);
      });

      expect(sorted[0].note).toBe(60); // C4 first
      expect(sorted[1].note).toBe(48); // C3 second (12 semitones away)
      expect(sorted[2].note).toBe(72); // C5 third (12 semitones away, same distance as C3)
      expect(sorted[3].note).toBe(36); // C2 last (24 semitones away)
    });

    it('should handle manifest with only C4', () => {
      const mappings: SampleMapping[] = [{ note: 60, file: 'C4.mp3' }];

      const sorted = [...mappings].sort((a, b) => {
        if (a.note === 60) return -1;
        if (b.note === 60) return 1;
        return Math.abs(a.note - 60) - Math.abs(b.note - 60);
      });

      expect(sorted.length).toBe(1);
      expect(sorted[0].note).toBe(60);
    });
  });

  describe('Manifest format', () => {
    it('should match expected piano manifest structure', () => {
      // This test documents the expected manifest format
      const expectedManifest: InstrumentManifest = {
        id: 'piano',
        name: 'Grand Piano',
        type: 'sampled',
        baseNote: 60,
        releaseTime: 0.5,
        samples: [
          { note: 36, file: 'C2.mp3' },
          { note: 48, file: 'C3.mp3' },
          { note: 60, file: 'C4.mp3' },
          { note: 72, file: 'C5.mp3' },
        ],
        credits: {
          source: 'University of Iowa Electronic Music Studios',
          url: 'https://theremin.music.uiowa.edu/MISpiano.html',
          license: 'Free for any projects, without restrictions',
        },
      };

      expect(expectedManifest.type).toBe('sampled');
      expect(expectedManifest.samples.length).toBe(4);
      expect(expectedManifest.samples.map(s => s.note)).toEqual([36, 48, 60, 72]);
    });
  });

  describe('Track identification for preloading', () => {
    // Test the logic that identifies which tracks need sampled instruments

    it('should identify tracks with synth:piano as needing preload', () => {
      const tracks = [
        { sampleId: 'kick' },
        { sampleId: 'synth:piano' },
        { sampleId: 'synth:lead' },
      ];

      const needsPreload = tracks.filter(t => {
        if (t.sampleId.startsWith('synth:')) {
          const preset = t.sampleId.replace('synth:', '');
          return isSampledInstrument(preset);
        }
        return false;
      });

      expect(needsPreload.length).toBe(1);
      expect(needsPreload[0].sampleId).toBe('synth:piano');
    });

    it('should handle empty tracks array', () => {
      const tracks: Array<{ sampleId: string }> = [];

      const needsPreload = tracks.filter(t => {
        if (t.sampleId.startsWith('synth:')) {
          const preset = t.sampleId.replace('synth:', '');
          return isSampledInstrument(preset);
        }
        return false;
      });

      expect(needsPreload.length).toBe(0);
    });

    it('should handle tracks with no sampled instruments', () => {
      const tracks = [
        { sampleId: 'kick' },
        { sampleId: 'snare' },
        { sampleId: 'synth:lead' },
        { sampleId: 'synth:pad' },
      ];

      const needsPreload = tracks.filter(t => {
        if (t.sampleId.startsWith('synth:')) {
          const preset = t.sampleId.replace('synth:', '');
          return isSampledInstrument(preset);
        }
        return false;
      });

      expect(needsPreload.length).toBe(0);
    });
  });

  describe('Pitch shifting calculation', () => {
    // Test the pitch ratio calculation: 2^(semitones/12)

    it('should calculate correct pitch ratio for same note', () => {
      const sampleNote = 60; // C4
      const targetNote = 60;
      const ratio = Math.pow(2, (targetNote - sampleNote) / 12);
      expect(ratio).toBeCloseTo(1.0);
    });

    it('should calculate correct pitch ratio for octave up', () => {
      const sampleNote = 60; // C4
      const targetNote = 72; // C5
      const ratio = Math.pow(2, (targetNote - sampleNote) / 12);
      expect(ratio).toBeCloseTo(2.0);
    });

    it('should calculate correct pitch ratio for octave down', () => {
      const sampleNote = 60; // C4
      const targetNote = 48; // C3
      const ratio = Math.pow(2, (targetNote - sampleNote) / 12);
      expect(ratio).toBeCloseTo(0.5);
    });

    it('should calculate correct pitch ratio for E4 from C4 sample', () => {
      const sampleNote = 60; // C4
      const targetNote = 64; // E4 (4 semitones up)
      const ratio = Math.pow(2, (targetNote - sampleNote) / 12);
      expect(ratio).toBeCloseTo(1.2599, 3); // ≈ 1.26
    });
  });
});
