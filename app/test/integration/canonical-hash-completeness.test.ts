/**
 * Canonical Hash Completeness Tests
 *
 * Verifies that the canonicalHash module correctly includes/excludes track properties.
 * This prevents sync gaps where a developer adds a new synced track property but
 * forgets to include it in the hash computation.
 *
 * INVARIANTS TESTED:
 * 1. Synced track properties MUST affect the hash (changing them changes the hash)
 * 2. Local-only properties MUST NOT affect the hash (muted, soloed)
 * 3. Global session properties MUST affect the hash (tempo, swing)
 *
 * If a new track property is added that should sync:
 * 1. Add it to the SYNCED_TRACK_PROPERTIES list
 * 2. If the test fails, it means canonicalHash.ts needs to include the property
 */

import { describe, it, expect } from 'vitest';
import { canonicalizeForHash, hashState, type StateForHash } from '../../src/sync/canonicalHash';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a base track for testing.
 * All properties have stable default values.
 */
function createBaseTrack(): StateForHash['tracks'][0] {
  return {
    id: 'test-track-1',
    name: 'Test Track',
    sampleId: 'kick',
    steps: [true, false, false, false, true, false, false, false],
    parameterLocks: [null, null, null, null, { volume: 0.5 }, null, null, null],
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 8,
    swing: 0,
  };
}

/**
 * Create a base state for testing.
 */
function createBaseState(): StateForHash {
  return {
    tracks: [createBaseTrack()],
    tempo: 120,
    swing: 0,
  };
}

/**
 * Compute hash for a state.
 */
function computeHash(state: StateForHash): string {
  return hashState(canonicalizeForHash(state));
}

// =============================================================================
// Test: Synced Track Properties Affect Hash
// =============================================================================

describe('Canonical Hash Completeness', () => {
  describe('Synced track properties MUST affect hash', () => {
    /**
     * These properties are part of the shared session state.
     * Changing any of them MUST produce a different hash.
     */

    it('changing track.id changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].id = 'different-id';

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.name changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].name = 'Different Name';

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.sampleId changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].sampleId = 'snare';

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.steps changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].steps = [false, true, false, false, false, true, false, false];

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.parameterLocks changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].parameterLocks = [{ volume: 0.3 }, null, null, null, null, null, null, null];

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.volume changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].volume = 0.5;

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.transpose changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].transpose = 5;

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.stepCount changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      // Need to also adjust arrays to match new stepCount
      state2.tracks[0].stepCount = 16;
      state2.tracks[0].steps = [...state2.tracks[0].steps, ...Array(8).fill(false)];
      state2.tracks[0].parameterLocks = [...state2.tracks[0].parameterLocks, ...Array(8).fill(null)];

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing track.swing changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].swing = 50;

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });
  });

  describe('Local-only track properties MUST NOT affect hash', () => {
    /**
     * These properties are local to each user ("My Ears, My Control").
     * Changing them should NOT produce a different hash.
     */

    it('changing track.muted does NOT change the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].muted = true;

      expect(computeHash(state1)).toBe(computeHash(state2));
    });

    it('changing track.soloed does NOT change the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tracks[0].soloed = true;

      expect(computeHash(state1)).toBe(computeHash(state2));
    });
  });

  describe('Global session properties MUST affect hash', () => {
    it('changing tempo changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.tempo = 140;

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });

    it('changing global swing changes the hash', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();
      state2.swing = 50;

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });
  });

  describe('Hash stability', () => {
    it('identical states produce identical hashes', () => {
      const state1 = createBaseState();
      const state2 = createBaseState();

      expect(computeHash(state1)).toBe(computeHash(state2));
    });

    it('hash is deterministic (same input always produces same output)', () => {
      const state = createBaseState();

      const hash1 = computeHash(state);
      const hash2 = computeHash(state);
      const hash3 = computeHash(state);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('order of tracks matters for hash', () => {
      const track1 = createBaseTrack();
      const track2 = { ...createBaseTrack(), id: 'test-track-2', name: 'Track 2' };

      const state1: StateForHash = {
        tracks: [track1, track2],
        tempo: 120,
        swing: 0,
      };

      const state2: StateForHash = {
        tracks: [track2, track1], // Reversed order
        tempo: 120,
        swing: 0,
      };

      expect(computeHash(state1)).not.toBe(computeHash(state2));
    });
  });

  describe('Normalization behavior', () => {
    it('undefined stepCount normalizes to 16', () => {
      const state1 = createBaseState();
      state1.tracks[0].stepCount = 16;
      state1.tracks[0].steps = Array(16).fill(false);
      state1.tracks[0].parameterLocks = Array(16).fill(null);

      const state2 = createBaseState();
      state2.tracks[0].stepCount = undefined;
      state2.tracks[0].steps = Array(16).fill(false);
      state2.tracks[0].parameterLocks = Array(16).fill(null);

      expect(computeHash(state1)).toBe(computeHash(state2));
    });

    it('undefined track.swing normalizes to 0', () => {
      const state1 = createBaseState();
      state1.tracks[0].swing = 0;

      const state2 = createBaseState();
      state2.tracks[0].swing = undefined;

      expect(computeHash(state1)).toBe(computeHash(state2));
    });

    it('arrays longer than stepCount are truncated', () => {
      const state1 = createBaseState();
      state1.tracks[0].stepCount = 4;
      state1.tracks[0].steps = [true, false, false, false];
      state1.tracks[0].parameterLocks = [null, null, null, null];

      const state2 = createBaseState();
      state2.tracks[0].stepCount = 4;
      state2.tracks[0].steps = [true, false, false, false, true, true, true, true]; // Extra elements
      state2.tracks[0].parameterLocks = [null, null, null, null, { volume: 1 }, { volume: 1 }]; // Extra elements

      // Extra elements beyond stepCount should be ignored
      expect(computeHash(state1)).toBe(computeHash(state2));
    });

    it('arrays shorter than stepCount are padded', () => {
      const state1 = createBaseState();
      state1.tracks[0].stepCount = 8;
      state1.tracks[0].steps = [true, false, false, false, false, false, false, false];
      state1.tracks[0].parameterLocks = [null, null, null, null, null, null, null, null];

      const state2 = createBaseState();
      state2.tracks[0].stepCount = 8;
      state2.tracks[0].steps = [true]; // Will be padded with false
      state2.tracks[0].parameterLocks = []; // Will be padded with null

      expect(computeHash(state1)).toBe(computeHash(state2));
    });
  });
});
