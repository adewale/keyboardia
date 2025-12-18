import { describe, it, expect, beforeAll } from 'vitest';
import { ALL_SAMPLES, SAMPLE_CATEGORIES } from '../types';
import { SAMPLE_NAMES, INSTRUMENT_CATEGORIES } from '../components/sample-constants';
import { createSynthesizedSamples } from './samples';

/**
 * Phase 23: Percussion Expansion Tests
 *
 * These tests verify the 6 new procedural percussion samples:
 * - shaker: High-frequency filtered noise burst
 * - conga: Pitched membrane with slap transient
 * - tambourine: Metallic jingles + noise
 * - clave: Two-tone wooden click
 * - cabasa: Ultra-short noise burst
 * - woodblock: Resonant filtered click
 *
 * See: specs/ROADMAP.md Phase 23
 * See: specs/research/INSTRUMENT-EXPANSION.md
 */

// The 6 new percussion samples from Phase 23
const PHASE_23_PERCUSSION = ['shaker', 'conga', 'tambourine', 'clave', 'cabasa', 'woodblock'] as const;

// Check if AudioContext is available (not in jsdom without polyfill)
const hasAudioContext = typeof AudioContext !== 'undefined';

describe('Phase 23: Percussion Expansion', () => {
  describe('Sample ID Registration', () => {
    it('should have all 6 percussion samples in SAMPLE_CATEGORIES.drums', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        expect(SAMPLE_CATEGORIES.drums).toContain(sample);
      }
    });

    it('should have all 6 percussion samples in ALL_SAMPLES', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        expect(ALL_SAMPLES).toContain(sample);
      }
    });

    it('should have display names for all 6 percussion samples', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        expect(SAMPLE_NAMES[sample]).toBeDefined();
        expect(SAMPLE_NAMES[sample].length).toBeGreaterThan(0);
      }
    });
  });

  describe('UI Registration', () => {
    // Get all drum instruments from the UI
    const drumInstruments = INSTRUMENT_CATEGORIES.drums.instruments.map(i => i.id);

    it('should have all 6 percussion samples in SamplePicker drums category', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        expect(drumInstruments).toContain(sample);
      }
    });

    it('should have correct type for all percussion samples', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        const instrument = INSTRUMENT_CATEGORIES.drums.instruments.find(i => i.id === sample);
        expect(instrument?.type).toBe('sample');
      }
    });
  });

  // Audio buffer tests require Web Audio API - skip if not available
  describe.skipIf(!hasAudioContext)('Audio Buffer Generation', () => {
    let samples: Map<string, { id: string; name: string; buffer: AudioBuffer | null; url: string }>;

    beforeAll(async () => {
      // Create AudioContext for testing (requires browser environment)
      const audioContext = new AudioContext();
      samples = await createSynthesizedSamples(audioContext);
      await audioContext.close();
    });

    it('should generate all 6 percussion sample buffers', () => {
      for (const sampleId of PHASE_23_PERCUSSION) {
        const sample = samples.get(sampleId);
        expect(sample).toBeDefined();
        expect(sample?.buffer).not.toBeNull();
        expect(sample?.buffer).toBeInstanceOf(AudioBuffer);
      }
    });

    it('should have non-empty audio data in all buffers', () => {
      for (const sampleId of PHASE_23_PERCUSSION) {
        const sample = samples.get(sampleId);
        const buffer = sample?.buffer;
        expect(buffer).toBeDefined();
        if (buffer) {
          const data = buffer.getChannelData(0);
          expect(data.length).toBeGreaterThan(0);
          // Check that buffer has non-zero samples (not silent)
          const maxAmplitude = Math.max(...Array.from(data).map(Math.abs));
          expect(maxAmplitude).toBeGreaterThan(0.01);
        }
      }
    });

    it('should have reasonable durations for percussion sounds', () => {
      // Percussion sounds should be short (< 1 second)
      const maxDuration = 1.0;

      for (const sampleId of PHASE_23_PERCUSSION) {
        const sample = samples.get(sampleId);
        const buffer = sample?.buffer;
        expect(buffer).toBeDefined();
        if (buffer) {
          expect(buffer.duration).toBeLessThan(maxDuration);
          expect(buffer.duration).toBeGreaterThan(0.05); // At least 50ms
        }
      }
    });

    it('should have amplitudes within safe range (no clipping)', () => {
      for (const sampleId of PHASE_23_PERCUSSION) {
        const sample = samples.get(sampleId);
        const buffer = sample?.buffer;
        expect(buffer).toBeDefined();
        if (buffer) {
          const data = buffer.getChannelData(0);
          for (let i = 0; i < data.length; i++) {
            expect(Math.abs(data[i])).toBeLessThanOrEqual(1.0);
          }
        }
      }
    });
  });

  // ADSR tests require Web Audio API - skip if not available
  describe.skipIf(!hasAudioContext)('ADSR Envelope Verification (120 BPM compatibility)', () => {
    let samples: Map<string, { id: string; name: string; buffer: AudioBuffer | null; url: string }>;

    beforeAll(async () => {
      const audioContext = new AudioContext();
      samples = await createSynthesizedSamples(audioContext);
      await audioContext.close();
    });

    /**
     * At 120 BPM, a 16th note lasts 125ms.
     * For samples to sound "punchy" and not feel delayed,
     * they should reach significant amplitude within ~10ms (attack < 0.01s).
     * We check that at least 10% of max amplitude is reached in first 10ms.
     */
    it('should have fast attack times (< 10ms to reach 10% amplitude)', () => {
      const attackThresholdMs = 10;

      for (const sampleId of PHASE_23_PERCUSSION) {
        const sample = samples.get(sampleId);
        const buffer = sample?.buffer;
        expect(buffer).toBeDefined();
        if (buffer) {
          const sampleRate = buffer.sampleRate;
          const attackSamples = Math.floor((attackThresholdMs / 1000) * sampleRate);
          const data = buffer.getChannelData(0);

          // Find max amplitude in the buffer
          const maxAmplitude = Math.max(...Array.from(data).map(Math.abs));

          // Check if we reach 10% of max amplitude within attack threshold
          let reachedThreshold = false;
          for (let i = 0; i < attackSamples && i < data.length; i++) {
            if (Math.abs(data[i]) >= maxAmplitude * 0.1) {
              reachedThreshold = true;
              break;
            }
          }

          expect(reachedThreshold).toBe(true);
        }
      }
    });
  });

  describe('Demo Session Compatibility', () => {
    it('should not use synth:piano (invalid ID) for any percussion', () => {
      // Percussion samples should use bare IDs, not prefixed
      for (const sample of PHASE_23_PERCUSSION) {
        expect(sample).not.toContain('synth:');
        expect(sample).not.toContain('sampled:');
      }
    });
  });
});
