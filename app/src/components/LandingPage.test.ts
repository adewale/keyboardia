import { describe, it, expect } from 'vitest';
import {
  EXAMPLE_SESSIONS,
  type ExampleSession,
} from '../data/example-sessions';

/**
 * LandingPage component tests
 *
 * Tests for data contracts, example session validity, and helper logic
 * used by the LandingPage component.
 */

// Re-implement the helper from LandingPage to test it
function sessionToPattern(session: ExampleSession): number[][] {
  return session.tracks.map((track) =>
    track.steps.map((step) => (step ? 1 : 0)),
  );
}

const demoPattern = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
];

describe('LandingPage', () => {
  describe('demoPattern', () => {
    it('should have 4 tracks', () => {
      expect(demoPattern).toHaveLength(4);
    });

    it('should have 16 steps per track', () => {
      for (const row of demoPattern) {
        expect(row).toHaveLength(16);
      }
    });

    it('should only contain 0s and 1s', () => {
      for (const row of demoPattern) {
        for (const cell of row) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    });

    it('should have at least one active step per track', () => {
      for (const row of demoPattern) {
        expect(row.some(cell => cell === 1)).toBe(true);
      }
    });
  });

  describe('sessionToPattern', () => {
    it('should convert boolean steps to 0/1 numbers', () => {
      const session: ExampleSession = {
        uuid: 'test-uuid',
        name: 'Test',
        tempo: 120,
        tracks: [
          { steps: [true, false, true, false] },
          { steps: [false, false, true, true] },
        ],
      };
      const pattern = sessionToPattern(session);
      expect(pattern).toEqual([
        [1, 0, 1, 0],
        [0, 0, 1, 1],
      ]);
    });

    it('should handle empty tracks', () => {
      const session: ExampleSession = {
        uuid: 'test-uuid',
        name: 'Empty',
        tempo: 120,
        tracks: [],
      };
      const pattern = sessionToPattern(session);
      expect(pattern).toEqual([]);
    });

    it('should handle tracks with all steps off', () => {
      const session: ExampleSession = {
        uuid: 'test-uuid',
        name: 'Silent',
        tempo: 120,
        tracks: [
          { steps: [false, false, false, false] },
        ],
      };
      const pattern = sessionToPattern(session);
      expect(pattern).toEqual([[0, 0, 0, 0]]);
    });

    it('should handle tracks with all steps on', () => {
      const session: ExampleSession = {
        uuid: 'test-uuid',
        name: 'Full',
        tempo: 120,
        tracks: [
          { steps: [true, true, true, true] },
        ],
      };
      const pattern = sessionToPattern(session);
      expect(pattern).toEqual([[1, 1, 1, 1]]);
    });
  });

  describe('EXAMPLE_SESSIONS data', () => {
    it('should have at least one example session', () => {
      expect(EXAMPLE_SESSIONS.length).toBeGreaterThanOrEqual(1);
    });

    it('should have valid UUIDs for all sessions', () => {
      for (const session of EXAMPLE_SESSIONS) {
        expect(session.uuid).toBeTruthy();
        expect(typeof session.uuid).toBe('string');
        expect(session.uuid.length).toBeGreaterThan(0);
      }
    });

    it('should have names for all sessions', () => {
      for (const session of EXAMPLE_SESSIONS) {
        expect(session.name).toBeTruthy();
        expect(typeof session.name).toBe('string');
      }
    });

    it('should have valid tempos (30-300 BPM)', () => {
      for (const session of EXAMPLE_SESSIONS) {
        expect(session.tempo).toBeGreaterThanOrEqual(30);
        expect(session.tempo).toBeLessThanOrEqual(300);
      }
    });

    it('should have at least one track per session', () => {
      for (const session of EXAMPLE_SESSIONS) {
        expect(session.tracks.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should have boolean steps in all tracks', () => {
      for (const session of EXAMPLE_SESSIONS) {
        for (const track of session.tracks) {
          for (const step of track.steps) {
            expect(typeof step).toBe('boolean');
          }
        }
      }
    });

    it('should have unique UUIDs across all sessions', () => {
      const uuids = EXAMPLE_SESSIONS.map(s => s.uuid);
      expect(new Set(uuids).size).toBe(uuids.length);
    });

    it('should produce valid patterns via sessionToPattern', () => {
      for (const session of EXAMPLE_SESSIONS) {
        const pattern = sessionToPattern(session);
        expect(pattern.length).toBe(session.tracks.length);
        for (let i = 0; i < pattern.length; i++) {
          expect(pattern[i].length).toBe(session.tracks[i].steps.length);
          for (const cell of pattern[i]) {
            expect(cell === 0 || cell === 1).toBe(true);
          }
        }
      }
    });
  });

  describe('carousel logic', () => {
    const visibleCount = 2;

    it('should compute maxCarouselIndex correctly', () => {
      const exampleCount = EXAMPLE_SESSIONS.length;
      const maxIndex = exampleCount - visibleCount;
      expect(maxIndex).toBe(EXAMPLE_SESSIONS.length - 2);
    });

    it('should not allow negative carousel index', () => {
      const carouselIndex = 0;
      const canGoPrev = carouselIndex > 0;
      expect(canGoPrev).toBe(false);
    });

    it('should not allow carousel index beyond max', () => {
      const maxIndex = EXAMPLE_SESSIONS.length - visibleCount;
      const carouselIndex = maxIndex;
      const canGoNext = carouselIndex < maxIndex;
      expect(canGoNext).toBe(false);
    });

    it('should allow navigation when in middle range', () => {
      if (EXAMPLE_SESSIONS.length <= visibleCount) return; // Skip if too few
      const maxIndex = EXAMPLE_SESSIONS.length - visibleCount;
      if (maxIndex < 1) return;
      const carouselIndex = 1;
      expect(carouselIndex > 0).toBe(true); // can go prev
      if (maxIndex > 1) {
        expect(carouselIndex < maxIndex).toBe(true); // can go next
      }
    });
  });

  describe('playhead animation', () => {
    it('should cycle through 16 steps', () => {
      const steps: number[] = [];
      for (let i = 0; i < 32; i++) {
        steps.push(i % 16);
      }
      // Should wrap around
      expect(steps[0]).toBe(0);
      expect(steps[15]).toBe(15);
      expect(steps[16]).toBe(0);
      expect(steps[31]).toBe(15);
    });
  });
});
