/**
 * Tests for Canonical State Hashing
 *
 * These tests verify that client and server produce identical hashes
 * by using canonical JSON serialization that handles:
 * 1. Optional fields (stepCount) - must have explicit defaults
 * 2. Array lengths (steps, parameterLocks) - must be normalized before hashing
 * 3. Local-only fields (muted, soloed) - EXCLUDED per "My Ears, My Control" philosophy
 *
 * ROOT CAUSE OF HASH MISMATCH (historical):
 * - Server: steps/parameterLocks have original length (e.g., 16)
 * - Client: arrays are padded to 128 by LOAD_STATE reducer
 *
 * SOLUTION: Both client and server use the same canonicalizeForHash function
 * before computing the hash, excluding local-only state (muted, soloed).
 */

import { describe, it, expect } from 'vitest';
import { canonicalizeForHash, hashState } from './canonicalHash';

// =============================================================================
// UNIT TESTS: canonicalizeForHash function
// =============================================================================

describe('canonicalizeForHash: Local-Only Field Exclusion', () => {
  it('should EXCLUDE muted from canonical output (local-only per "My Ears, My Control")', () => {
    const track = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false, false, false],
      parameterLocks: [null, null, null, null],
      volume: 1,
      muted: true, // This should be EXCLUDED
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    const state = { tracks: [track], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);
    expect('muted' in canonical.tracks[0]).toBe(false);
  });

  it('should EXCLUDE soloed from canonical output (local-only per "My Ears, My Control")', () => {
    const track = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true],
      parameterLocks: [null],
      volume: 1,
      muted: false,
      soloed: true, // This should be EXCLUDED
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    const state = { tracks: [track], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);
    expect('soloed' in canonical.tracks[0]).toBe(false);
  });
});

describe('canonicalizeForHash: Optional Field Normalization', () => {
  it('should add stepCount: 16 when stepCount is undefined', () => {
    const serverTrack = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false],
      parameterLocks: [null, null],
      volume: 1,
      muted: false,
      soloed: false,
      playbackMode: 'oneshot',
      transpose: 0,
      // stepCount is MISSING (undefined)
    };

    const state = { tracks: [serverTrack], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);
    expect(canonical.tracks[0].stepCount).toBe(16);
  });

  it('should preserve stepCount when set to non-default value', () => {
    const track = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: Array(32).fill(false),
      parameterLocks: Array(32).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 32, // explicitly set
    };

    const state = { tracks: [track], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);
    expect(canonical.tracks[0].stepCount).toBe(32);
  });
});

describe('canonicalizeForHash: Array Length Normalization', () => {
  it('should truncate steps array to stepCount for hashing', () => {
    // Client has 128-element array, but stepCount is 16
    const clientTrack = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: [...Array(16).fill(false).map((_, i) => i % 4 === 0), ...Array(112).fill(false)], // 128 total
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    const state = { tracks: [clientTrack], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);

    expect(canonical.tracks[0].steps.length).toBe(16);
    expect(canonical.tracks[0].parameterLocks.length).toBe(16);
  });

  it('should pad steps array to stepCount if shorter', () => {
    // Server stored with fewer elements than stepCount
    const serverTrack = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false, false, false], // Only 4 elements
      parameterLocks: [null, null, null, null],
      volume: 1,
      muted: false,
      soloed: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    const state = { tracks: [serverTrack], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);

    expect(canonical.tracks[0].steps.length).toBe(16);
    expect(canonical.tracks[0].parameterLocks.length).toBe(16);
    // Original values preserved at the start
    expect(canonical.tracks[0].steps[0]).toBe(true);
    // Padding filled with defaults
    expect(canonical.tracks[0].steps[4]).toBe(false);
    expect(canonical.tracks[0].parameterLocks[4]).toBe(null);
  });

  it('should handle stepCount of 32', () => {
    const track = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: Array(128).fill(false),
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 32,
    };

    const state = { tracks: [track], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);

    expect(canonical.tracks[0].steps.length).toBe(32);
    expect(canonical.tracks[0].parameterLocks.length).toBe(32);
  });

  it('should handle stepCount of 64', () => {
    const track = {
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: Array(128).fill(false),
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 64,
    };

    const state = { tracks: [track], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);

    expect(canonical.tracks[0].steps.length).toBe(64);
    expect(canonical.tracks[0].parameterLocks.length).toBe(64);
  });
});

// =============================================================================
// INTEGRATION TESTS: Client-Server Hash Matching
// =============================================================================

describe('Client-Server Hash Matching', () => {
  it('should produce identical hash for server state (soloed undefined) vs client state (soloed false)', () => {
    // Simulate SERVER state: soloed is undefined
    const serverState = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false],
        parameterLocks: [null, null, null, null, null, null, null, null],
        volume: 1,
        muted: false,
        // soloed: undefined (NOT SET)
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    // Simulate CLIENT state: soloed is explicitly false
    const clientState = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false],
        parameterLocks: [null, null, null, null, null, null, null, null],
        volume: 1,
        muted: false,
        soloed: false, // EXPLICITLY SET
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    // Without canonicalization, hashes would differ
    const serverHash = hashState(canonicalizeForHash(serverState));
    const clientHash = hashState(canonicalizeForHash(clientState));

    expect(serverHash).toBe(clientHash);
  });

  it('should produce identical hash for 16-element vs 128-element arrays', () => {
    // Simulate SERVER state: 16-element arrays (as stored in KV)
    const serverState = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        soloed: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    // Simulate CLIENT state: 128-element arrays (after LOAD_STATE normalization)
    const clientSteps = [...serverState.tracks[0].steps, ...Array(112).fill(false)]; // Pad to 128
    const clientState = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: clientSteps,
        parameterLocks: Array(128).fill(null),
        volume: 1,
        muted: false,
        soloed: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    const serverHash = hashState(canonicalizeForHash(serverState));
    const clientHash = hashState(canonicalizeForHash(clientState));

    expect(serverHash).toBe(clientHash);
  });

  it('should produce identical hash for combined mismatches (soloed + array length)', () => {
    // Simulate SERVER state: both issues present
    const serverState = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false], // Only 4 elements
        parameterLocks: [null, null, null, null],
        volume: 1,
        muted: false,
        // soloed: undefined
        // stepCount: undefined
        playbackMode: 'oneshot',
        transpose: 0,
      }],
      tempo: 120,
      swing: 0,
    };

    // Simulate CLIENT state: fully normalized
    const clientState = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [...[true, false, false, false], ...Array(124).fill(false)], // Padded to 128
        parameterLocks: Array(128).fill(null),
        volume: 1,
        muted: false,
        soloed: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    const serverHash = hashState(canonicalizeForHash(serverState));
    const clientHash = hashState(canonicalizeForHash(clientState));

    expect(serverHash).toBe(clientHash);
  });

  it('should produce different hash when actual data differs', () => {
    const state1 = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false],
        parameterLocks: [null, null, null, null],
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    const state2 = {
      tracks: [{
        id: 'track-kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, true, false, false], // Different step pattern
        parameterLocks: [null, null, null, null],
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    const hash1 = hashState(canonicalizeForHash(state1));
    const hash2 = hashState(canonicalizeForHash(state2));

    expect(hash1).not.toBe(hash2);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('canonicalizeForHash: Edge Cases', () => {
  it('should handle empty tracks array', () => {
    const state = { tracks: [], tempo: 120, swing: 0 };
    const canonical = canonicalizeForHash(state);
    expect(canonical.tracks).toEqual([]);
  });

  it('should handle multiple tracks with different stepCounts', () => {
    const state = {
      tracks: [
        {
          id: 'track-1',
          name: 'Kick',
          sampleId: 'kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        },
        {
          id: 'track-2',
          name: 'Snare',
          sampleId: 'snare',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 32,
        },
      ],
      tempo: 120,
      swing: 0,
    };

    const canonical = canonicalizeForHash(state);
    expect(canonical.tracks[0].steps.length).toBe(16);
    expect(canonical.tracks[1].steps.length).toBe(32);
  });

  it('should preserve tempo and swing unchanged', () => {
    const state = {
      tracks: [],
      tempo: 145,
      swing: 67,
    };

    const canonical = canonicalizeForHash(state);
    expect(canonical.tempo).toBe(145);
    expect(canonical.swing).toBe(67);
  });

  it('should exclude version field from canonical output', () => {
    const state = {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 5,
    };

    const canonical = canonicalizeForHash(state);
    expect(canonical).not.toHaveProperty('version');
  });

  it('should exclude effects field from canonical output', () => {
    const state = {
      tracks: [],
      tempo: 120,
      swing: 0,
      effects: { reverb: { wet: 0.5 } },
    };

    const canonical = canonicalizeForHash(state);
    expect(canonical).not.toHaveProperty('effects');
  });
});

// =============================================================================
// HASH FUNCTION TESTS
// =============================================================================

describe('hashState function', () => {
  it('should return an 8-character hex string', () => {
    const state = { tracks: [], tempo: 120, swing: 0 };
    const hash = hashState(state);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should be deterministic', () => {
    const state = { tracks: [], tempo: 120, swing: 0 };
    const hash1 = hashState(state);
    const hash2 = hashState(state);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different states', () => {
    const state1 = { tracks: [], tempo: 120, swing: 0 };
    const state2 = { tracks: [], tempo: 121, swing: 0 };
    expect(hashState(state1)).not.toBe(hashState(state2));
  });
});
