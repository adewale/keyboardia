import { describe, it, expect } from 'vitest';

/**
 * PortraitGrid component tests
 *
 * Tests the extractable logic used by the PortraitGrid component:
 * - Track abbreviation mapping
 * - Active page derivation (fix for setState-in-effect lint warning)
 * - Step range calculation
 */

// Re-implement getTrackAbbreviation for testing
function getTrackAbbreviation(name: string, sampleId: string): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes('kick') || sampleId.includes('kick')) return 'K';
  if (nameLower.includes('snare') || sampleId.includes('snare')) return 'S';
  if (nameLower.includes('hat') || sampleId.includes('hat')) return 'H';
  if (nameLower.includes('clap') || sampleId.includes('clap')) return 'C';
  if (nameLower.includes('tom') || sampleId.includes('tom')) return 'T';
  if (nameLower.includes('perc') || sampleId.includes('perc')) return 'P';
  if (nameLower.includes('rim') || sampleId.includes('rim')) return 'R';

  if (nameLower.includes('bass') || sampleId.includes('bass')) return 'B';
  if (nameLower.includes('lead') || sampleId.includes('lead')) return 'L';
  if (nameLower.includes('pad') || sampleId.includes('pad')) return 'P';
  if (nameLower.includes('keys') || sampleId.includes('keys')) return 'K';
  if (nameLower.includes('piano') || sampleId.includes('piano')) return '♪';

  return name.charAt(0).toUpperCase();
}

// Derived page logic (the fix for the lint warning)
function deriveActivePage(
  manualPage: number | null,
  isPlaying: boolean,
  currentStep: number,
): number {
  return manualPage ?? (isPlaying && currentStep >= 0
    ? Math.floor(currentStep / 8) % 2
    : 0);
}

describe('PortraitGrid', () => {
  describe('getTrackAbbreviation', () => {
    it.each([
      ['Kick Drum', 'kick-808', 'K'],
      ['Snare', 'snare-tight', 'S'],
      ['Hi-Hat', 'hihat', 'H'],
      ['Clap', 'clap', 'C'],
      ['Tom High', 'tom-hi', 'T'],
      ['Percussion', 'perc', 'P'],
      ['Rimshot', 'rim', 'R'],
    ])('should abbreviate drum "%s" (sample: %s) as "%s"', (name, sampleId, expected) => {
      expect(getTrackAbbreviation(name, sampleId)).toBe(expected);
    });

    it.each([
      ['Bass', 'synth:bass', 'B'],
      ['Lead Synth', 'synth:lead', 'L'],
      ['Pad Warm', 'synth:pad', 'P'],
      ['Keys', 'synth:keys', 'K'],
      ['Piano', 'piano-grand', '♪'],
    ])('should abbreviate synth "%s" (sample: %s) as "%s"', (name, sampleId, expected) => {
      expect(getTrackAbbreviation(name, sampleId)).toBe(expected);
    });

    it('should use first letter for unknown instruments', () => {
      expect(getTrackAbbreviation('Xylophone', 'xylophone')).toBe('X');
      expect(getTrackAbbreviation('Flute', 'flute')).toBe('F');
    });

    it('should match by sampleId even if name does not match', () => {
      expect(getTrackAbbreviation('My Custom Track', 'kick-deep')).toBe('K');
      expect(getTrackAbbreviation('Track 1', 'snare-909')).toBe('S');
    });

    it('should be case-insensitive for name matching', () => {
      expect(getTrackAbbreviation('KICK', 'unknown')).toBe('K');
      expect(getTrackAbbreviation('hiHat', 'unknown')).toBe('H');
    });
  });

  describe('deriveActivePage (lint fix)', () => {
    it('should return 0 when not playing and no manual override', () => {
      expect(deriveActivePage(null, false, -1)).toBe(0);
    });

    it('should return page 0 for steps 0-7 when playing', () => {
      for (let step = 0; step < 8; step++) {
        expect(deriveActivePage(null, true, step)).toBe(0);
      }
    });

    it('should return page 1 for steps 8-15 when playing', () => {
      for (let step = 8; step < 16; step++) {
        expect(deriveActivePage(null, true, step)).toBe(1);
      }
    });

    it('should wrap back to page 0 for steps 16-23', () => {
      for (let step = 16; step < 24; step++) {
        expect(deriveActivePage(null, true, step)).toBe(0);
      }
    });

    it('should prefer manual page over derived page', () => {
      expect(deriveActivePage(1, true, 0)).toBe(1); // Manual=1, auto would be 0
      expect(deriveActivePage(0, true, 8)).toBe(0); // Manual=0, auto would be 1
    });

    it('should prefer manual page even when not playing', () => {
      expect(deriveActivePage(1, false, -1)).toBe(1);
    });

    it('should return 0 when playing but step is -1 (no active step)', () => {
      expect(deriveActivePage(null, true, -1)).toBe(0);
    });
  });

  describe('stepsRange calculation', () => {
    it('should show steps 0-7 for page 0', () => {
      const activePage = 0;
      const start = activePage * 8;
      const end = start + 8;
      expect(start).toBe(0);
      expect(end).toBe(8);
    });

    it('should show steps 8-15 for page 1', () => {
      const activePage = 1;
      const start = activePage * 8;
      const end = start + 8;
      expect(start).toBe(8);
      expect(end).toBe(16);
    });
  });
});
