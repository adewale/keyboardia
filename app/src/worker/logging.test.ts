/**
 * Unit tests for state hashing utilities
 *
 * Note: WebSocket logging tests have been removed as that functionality
 * has been replaced by Observability 2.0 wide events (see observability.ts).
 */

import { describe, it, expect } from 'vitest';
import { hashState } from './logging';

describe('State Hashing', () => {
  describe('hashState', () => {
    it('should return an 8-character hex string', () => {
      const hash = hashState({ foo: 'bar' });
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should be deterministic', () => {
      const state = { tracks: [{ steps: [true, false, true] }], tempo: 120 };
      const hash1 = hashState(state);
      const hash2 = hashState(state);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different states', () => {
      const hash1 = hashState({ tempo: 120 });
      const hash2 = hashState({ tempo: 140 });

      expect(hash1).not.toBe(hash2);
    });

    it('should detect changes in nested arrays', () => {
      const state1 = { tracks: [{ steps: [true, false, false] }] };
      const state2 = { tracks: [{ steps: [true, false, true] }] };

      const hash1 = hashState(state1);
      const hash2 = hashState(state2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty state', () => {
      const hash = hashState({});
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should handle complex nested structures', () => {
      const complexState = {
        tracks: [
          {
            id: 'track-1',
            steps: Array(64).fill(false).map((_, i) => i % 4 === 0),
            parameterLocks: Array(64).fill(null),
          },
          {
            id: 'track-2',
            steps: Array(64).fill(false),
            parameterLocks: [{ pitch: 5 }, null, { volume: 0.8 }],
          },
        ],
        tempo: 95,
        swing: 25,
      };

      const hash = hashState(complexState);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should be consistent across multiple calls on same complex state', () => {
      const complexState = {
        tracks: Array(16).fill(null).map((_, i) => ({
          id: `track-${i}`,
          steps: Array(64).fill(false).map((_, j) => (i + j) % 3 === 0),
          parameterLocks: Array(64).fill(null),
          volume: 0.8 + i * 0.01,
          muted: i === 5,
        })),
        tempo: 128,
        swing: 50,
      };

      // Hash multiple times to ensure consistency
      const hashes = Array(10).fill(null).map(() => hashState(complexState));
      expect(new Set(hashes).size).toBe(1);
    });
  });
});
