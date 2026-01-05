import { describe, it, expect } from 'vitest';
import type { Track } from '../types';
import { MAX_STEPS, STEPS_PER_PAGE, MAX_TRACKS, STEP_COUNT_OPTIONS } from '../types';

/**
 * Test helper: creates a minimal track for testing
 */
function createTestTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'test-track',
    name: 'Test',
    sampleId: 'kick',
    steps: Array(MAX_STEPS).fill(false),
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: STEPS_PER_PAGE,
    ...overrides,
  };
}

/**
 * Simulates the reducer's SET_TRACK_STEP_COUNT action
 * Arrays stay at MAX_STEPS (128) - stepCount is just a "view window"
 */
function setTrackStepCount(track: Track, newStepCount: number): Track {
  const clampedStepCount = Math.max(1, Math.min(MAX_STEPS, newStepCount));
  // Arrays stay at MAX_STEPS - only stepCount changes
  // This preserves user data when reducing stepCount (non-destructive editing)
  return {
    ...track,
    stepCount: clampedStepCount,
  };
}

/**
 * Simulates the reducer's TOGGLE_STEP action
 */
function toggleStep(track: Track, step: number): Track {
  const steps = [...track.steps];
  steps[step] = !steps[step];
  return { ...track, steps };
}

/**
 * Simulates the reducer's SET_PARAMETER_LOCK action
 */
function setParameterLock(track: Track, step: number, lock: { pitch?: number; volume?: number } | null): Track {
  const parameterLocks = [...track.parameterLocks];
  parameterLocks[step] = lock;
  return { ...track, parameterLocks };
}

/**
 * Simulates LOAD_STATE backwards compatibility handling
 */
function normalizeTrackFromLoad(track: Partial<Track>): Track {
  const steps = (track.steps?.length ?? 0) < MAX_STEPS
    ? [...(track.steps ?? []), ...Array(MAX_STEPS - (track.steps?.length ?? 0)).fill(false)]
    : track.steps!;
  const parameterLocks = (track.parameterLocks?.length ?? 0) < MAX_STEPS
    ? [...(track.parameterLocks ?? []), ...Array(MAX_STEPS - (track.parameterLocks?.length ?? 0)).fill(null)]
    : track.parameterLocks!;

  return {
    id: track.id ?? 'unknown',
    name: track.name ?? 'Unknown',
    sampleId: track.sampleId ?? 'kick',
    steps,
    parameterLocks,
    volume: track.volume ?? 1,
    muted: track.muted ?? false,
    soloed: track.soloed ?? false,
    transpose: track.transpose ?? 0,
    stepCount: track.stepCount ?? STEPS_PER_PAGE,
  };
}

/**
 * Simulates the reducer's COPY_SEQUENCE action
 */
function copySequence(fromTrack: Track, toTrack: Track): Track {
  return {
    ...toTrack,
    steps: [...fromTrack.steps],
    parameterLocks: [...fromTrack.parameterLocks],
    stepCount: fromTrack.stepCount, // Should copy step count
  };
}

describe('Track Step Count Configuration', () => {
  describe('MAX_STEPS constant', () => {
    it('should be 128 for 8-bar support', () => {
      expect(MAX_STEPS).toBe(128);
    });

    it('STEPS_PER_PAGE should be 16 (one bar)', () => {
      expect(STEPS_PER_PAGE).toBe(16);
    });
  });

  describe('Track array sizes', () => {
    it('steps array should always have MAX_STEPS (128) slots', () => {
      const track = createTestTrack();
      expect(track.steps.length).toBe(128);
    });

    it('parameterLocks array should always have MAX_STEPS (128) slots', () => {
      const track = createTestTrack();
      expect(track.parameterLocks.length).toBe(128);
    });

    it('can toggle step at index 127 (last possible step)', () => {
      const track = createTestTrack();
      const toggled = toggleStep(track, 127);
      expect(toggled.steps[127]).toBe(true);
    });

    it('can set parameter lock at index 127', () => {
      const track = createTestTrack();
      const locked = setParameterLock(track, 127, { pitch: 5, volume: 0.5 });
      expect(locked.parameterLocks[127]).toEqual({ pitch: 5, volume: 0.5 });
    });
  });

  describe('SET_TRACK_STEP_COUNT behavior', () => {
    it('should allow stepCount of 16 (1 bar)', () => {
      const track = setTrackStepCount(createTestTrack(), 16);
      expect(track.stepCount).toBe(16);
    });

    it('should allow stepCount of 32 (2 bars)', () => {
      const track = setTrackStepCount(createTestTrack(), 32);
      expect(track.stepCount).toBe(32);
    });

    it('should allow stepCount of 64 (4 bars)', () => {
      const track = setTrackStepCount(createTestTrack(), 64);
      expect(track.stepCount).toBe(64);
    });

    it('should allow stepCount of 4 (pulse patterns - loops 4× per bar)', () => {
      const track = setTrackStepCount(createTestTrack(), 4);
      expect(track.stepCount).toBe(4);
    });

    it('should allow stepCount of 8 (half-bar patterns - loops 2× per bar)', () => {
      const track = setTrackStepCount(createTestTrack(), 8);
      expect(track.stepCount).toBe(8);
    });

    it('should clamp stepCount to minimum of 1', () => {
      const track = setTrackStepCount(createTestTrack(), 0);
      expect(track.stepCount).toBe(1);

      const track2 = setTrackStepCount(createTestTrack(), -5);
      expect(track2.stepCount).toBe(1);
    });

    it('should clamp stepCount to maximum of MAX_STEPS (128)', () => {
      const track = setTrackStepCount(createTestTrack(), 200);
      expect(track.stepCount).toBe(128);

      const track2 = setTrackStepCount(createTestTrack(), 128);
      expect(track2.stepCount).toBe(128);
    });

    it('should allow non-standard step counts (e.g., 12 for triplets)', () => {
      const track = setTrackStepCount(createTestTrack(), 12);
      expect(track.stepCount).toBe(12);
    });

    it('should allow step counts 1-128 for polyrhythms', () => {
      for (let i = 1; i <= 128; i++) {
        const track = setTrackStepCount(createTestTrack(), i);
        expect(track.stepCount).toBe(i);
      }
    });
  });

  // ============================================================================
  // FIXED-LENGTH ARRAY INVARIANT TESTS
  // Arrays MUST stay at MAX_STEPS (128) - stepCount is just a "view window"
  // ============================================================================
  describe('SET_TRACK_STEP_COUNT fixed-length arrays', () => {
    it('should NOT resize arrays when stepCount changes - arrays stay at MAX_STEPS', () => {
      const track = createTestTrack({ stepCount: 16 });
      expect(track.steps.length).toBe(MAX_STEPS); // 128

      const updated = setTrackStepCount(track, 32);

      expect(updated.stepCount).toBe(32);
      expect(updated.steps.length).toBe(MAX_STEPS); // Still 128!
      expect(updated.parameterLocks.length).toBe(MAX_STEPS); // Still 128!
    });

    it('should preserve all step data when reducing stepCount (non-destructive)', () => {
      const track = createTestTrack({ stepCount: 128 });
      // Set some steps beyond position 64
      track.steps[0] = true;
      track.steps[64] = true;
      track.steps[100] = true;
      track.steps[127] = true;

      // Reduce stepCount to 64 - this should hide but NOT delete steps 64-127
      const reduced = setTrackStepCount(track, 64);

      expect(reduced.stepCount).toBe(64);
      expect(reduced.steps.length).toBe(MAX_STEPS); // Arrays unchanged
      // All original step data preserved!
      expect(reduced.steps[0]).toBe(true);
      expect(reduced.steps[64]).toBe(true); // Still there (just hidden)
      expect(reduced.steps[100]).toBe(true); // Still there (just hidden)
      expect(reduced.steps[127]).toBe(true); // Still there (just hidden)
    });

    it('should reveal hidden steps when increasing stepCount (non-destructive)', () => {
      const track = createTestTrack({ stepCount: 128 });
      // Set pattern in the second half
      track.steps[64] = true;
      track.steps[80] = true;
      track.steps[100] = true;

      // Reduce to 64, then expand back to 128
      const reduced = setTrackStepCount(track, 64);
      const expanded = setTrackStepCount(reduced, 128);

      // Pattern should be revealed again!
      expect(expanded.stepCount).toBe(128);
      expect(expanded.steps[64]).toBe(true);
      expect(expanded.steps[80]).toBe(true);
      expect(expanded.steps[100]).toBe(true);
    });

    it('should NOT change array references when stepCount changes', () => {
      const track = createTestTrack({ stepCount: 16 });
      const updated = setTrackStepCount(track, 32);

      // Same array references (no resize = same object)
      expect(updated.steps).toBe(track.steps);
      expect(updated.parameterLocks).toBe(track.parameterLocks);
    });

    it('steps.length should ALWAYS equal MAX_STEPS (128)', () => {
      // This is the invariant - arrays are ALWAYS 128 elements
      const testCases = [1, 5, 8, 16, 32, 64, 128];

      for (const stepCount of testCases) {
        const track = createTestTrack({ stepCount: 128 });
        const result = setTrackStepCount(track, stepCount);

        expect(result.steps.length).toBe(MAX_STEPS);
        expect(result.parameterLocks.length).toBe(MAX_STEPS);
      }
    });

    it('should clamp stepCount to valid range (1-128)', () => {
      const track = createTestTrack();

      expect(setTrackStepCount(track, 0).stepCount).toBe(1);
      expect(setTrackStepCount(track, -10).stepCount).toBe(1);
      expect(setTrackStepCount(track, 200).stepCount).toBe(128);
      expect(setTrackStepCount(track, 64).stepCount).toBe(64);
    });

    it('should preserve parameterLocks when stepCount changes', () => {
      const track = createTestTrack({ stepCount: 128 });
      track.parameterLocks[4] = { pitch: 5, volume: 0.8 };
      track.parameterLocks[100] = { pitch: -3, volume: 0.5 };

      // Reduce then expand
      const reduced = setTrackStepCount(track, 16);
      const expanded = setTrackStepCount(reduced, 128);

      // Both locks preserved
      expect(expanded.parameterLocks[4]).toEqual({ pitch: 5, volume: 0.8 });
      expect(expanded.parameterLocks[100]).toEqual({ pitch: -3, volume: 0.5 });
    });
  });

  describe('Backwards compatibility (LOAD_STATE)', () => {
    it('should extend 16-step arrays to 64 when loading old sessions', () => {
      const oldTrack = {
        id: 'old-track',
        name: 'Old',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false,
                true, false, false, false, true, false, false, false], // 16 steps
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        // stepCount missing (old format)
      };

      const normalized = normalizeTrackFromLoad(oldTrack);

      expect(normalized.steps.length).toBe(128);
      expect(normalized.parameterLocks.length).toBe(128);
      expect(normalized.stepCount).toBe(16); // Default

      // Original steps preserved
      expect(normalized.steps[0]).toBe(true);
      expect(normalized.steps[4]).toBe(true);
      expect(normalized.steps[8]).toBe(true);
      expect(normalized.steps[12]).toBe(true);

      // Extended steps are false
      expect(normalized.steps[16]).toBe(false);
      expect(normalized.steps[127]).toBe(false);
    });

    it('should preserve stepCount when loading sessions with stepCount', () => {
      const newTrack = {
        id: 'new-track',
        name: 'New',
        sampleId: 'kick',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 32,
      };

      const normalized = normalizeTrackFromLoad(newTrack);
      expect(normalized.stepCount).toBe(32);
    });
  });
});

describe('64-Step Track Verification', () => {
  describe('Full 64-step pattern', () => {
    it('can create a track with steps active at positions 0-63', () => {
      const steps = Array(MAX_STEPS).fill(false);
      // Activate every 8th step across all 64 positions
      [0, 8, 16, 24, 32, 40, 48, 56].forEach(i => { steps[i] = true; });

      const track = createTestTrack({ steps, stepCount: 64 });

      expect(track.steps[0]).toBe(true);
      expect(track.steps[8]).toBe(true);
      expect(track.steps[56]).toBe(true);
      expect(track.steps[63]).toBe(false);
      expect(track.stepCount).toBe(64);
    });

    it('can have parameter locks at all 64 positions', () => {
      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { pitch: 0, volume: 1 };
      parameterLocks[32] = { pitch: 5, volume: 0.8 };
      parameterLocks[63] = { pitch: -12, volume: 0.5 };

      const track = createTestTrack({ parameterLocks, stepCount: 64 });

      expect(track.parameterLocks[0]).toEqual({ pitch: 0, volume: 1 });
      expect(track.parameterLocks[32]).toEqual({ pitch: 5, volume: 0.8 });
      expect(track.parameterLocks[63]).toEqual({ pitch: -12, volume: 0.5 });
    });

    it('64-step track should trigger at step 63 during playback', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[63] = true; // Only the very last step

      const track = createTestTrack({ steps, stepCount: 64 });

      // Simulate scheduler logic
      const globalStep = 63;
      const trackStep = globalStep % track.stepCount;
      const shouldTrigger = track.steps[trackStep] && !track.muted;

      expect(trackStep).toBe(63);
      expect(shouldTrigger).toBe(true);
    });
  });

  describe('Step count presets match spec', () => {
    it('16 steps = 1 bar of 16th notes', () => {
      const track = createTestTrack({ stepCount: 16 });
      // At 120 BPM, 16 steps = 2 seconds (one bar)
      const stepsPerBeat = 4;
      const beatsPerBar = 4;
      expect(track.stepCount).toBe(stepsPerBeat * beatsPerBar);
    });

    it('32 steps = 2 bars of 16th notes', () => {
      const track = createTestTrack({ stepCount: 32 });
      expect(track.stepCount).toBe(32);
    });

    it('64 steps = 4 bars of 16th notes', () => {
      const track = createTestTrack({ stepCount: 64 });
      expect(track.stepCount).toBe(64);
    });

    it('128 steps = 8 bars of 16th notes = MAX_STEPS', () => {
      const track = createTestTrack({ stepCount: 128 });
      expect(track.stepCount).toBe(128);
      expect(track.stepCount).toBe(MAX_STEPS);
    });
  });
});

describe('Polyrhythm with 64-step tracks', () => {
  /**
   * Simulates scheduler behavior for counting triggers
   */
  function countTriggers(track: Track, totalSteps: number): number[] {
    const triggers: number[] = [];
    for (let globalStep = 0; globalStep < totalSteps; globalStep++) {
      const trackStep = globalStep % track.stepCount;
      if (track.steps[trackStep] && !track.muted) {
        triggers.push(globalStep);
      }
    }
    return triggers;
  }

  it('64-step track loops once over 64 global steps', () => {
    const steps = Array(MAX_STEPS).fill(false);
    steps[0] = true;
    steps[32] = true;
    steps[63] = true;

    const track = createTestTrack({ steps, stepCount: 64 });
    const triggers = countTriggers(track, 64);

    // Should trigger exactly 3 times (once per active step)
    expect(triggers).toEqual([0, 32, 63]);
  });

  it('16-step track loops 4 times while 64-step track loops once', () => {
    const track16Steps = Array(MAX_STEPS).fill(false);
    track16Steps[0] = true;

    const track64Steps = Array(MAX_STEPS).fill(false);
    track64Steps[0] = true;

    const track16 = createTestTrack({ steps: track16Steps, stepCount: 16 });
    const track64 = createTestTrack({ steps: track64Steps, stepCount: 64 });

    const triggers16 = countTriggers(track16, 64);
    const triggers64 = countTriggers(track64, 64);

    // 16-step track triggers 4 times (at 0, 16, 32, 48)
    expect(triggers16).toEqual([0, 16, 32, 48]);

    // 64-step track triggers once (at 0)
    expect(triggers64).toEqual([0]);
  });

  it('32-step track loops twice while 64-step track loops once', () => {
    const track32Steps = Array(MAX_STEPS).fill(false);
    track32Steps[0] = true;
    track32Steps[16] = true;

    const track64Steps = Array(MAX_STEPS).fill(false);
    track64Steps[0] = true;
    track64Steps[48] = true;

    const track32 = createTestTrack({ steps: track32Steps, stepCount: 32 });
    const track64 = createTestTrack({ steps: track64Steps, stepCount: 64 });

    const triggers32 = countTriggers(track32, 64);
    const triggers64 = countTriggers(track64, 64);

    // 32-step track triggers 4 times (0, 16 in first loop; 32, 48 in second loop)
    expect(triggers32).toEqual([0, 16, 32, 48]);

    // 64-step track triggers twice (0, 48)
    expect(triggers64).toEqual([0, 48]);
  });
});

describe('MAX_TRACKS constraint', () => {
  it('MAX_TRACKS should be 16', () => {
    expect(MAX_TRACKS).toBe(16);
  });
});

describe('ADD_TRACK action - duplicate prevention', () => {
  /**
   * Simulates the reducer's ADD_TRACK action with duplicate prevention
   */
  function addTrack(
    tracks: Track[],
    sampleId: string,
    name: string,
    existingTrack?: Track
  ): Track[] {
    if (tracks.length >= MAX_TRACKS) return tracks;

    const newTrack: Track = existingTrack ?? {
      id: `track-${Date.now()}`,
      name,
      sampleId,
      steps: Array(MAX_STEPS).fill(false),
      parameterLocks: Array(MAX_STEPS).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: STEPS_PER_PAGE,
    };

    // Prevent duplicate tracks (defensive check for multiplayer sync issues)
    if (tracks.some(t => t.id === newTrack.id)) {
      return tracks;
    }

    return [...tracks, newTrack];
  }

  it('should add a new track when ID is unique', () => {
    const tracks: Track[] = [];
    const result = addTrack(tracks, 'kick', 'Kick');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Kick');
  });

  it('should reject adding a track with duplicate ID', () => {
    const existingTrack = createTestTrack({ id: 'track-123', name: 'Existing' });
    const tracks = [existingTrack];

    const duplicateTrack = createTestTrack({ id: 'track-123', name: 'Duplicate' });
    const result = addTrack(tracks, duplicateTrack.sampleId, duplicateTrack.name, duplicateTrack);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Existing'); // Original preserved
  });

  it('should handle multiplayer scenario: same track added twice quickly', () => {
    const tracks: Track[] = [];

    // First add succeeds
    const track1 = createTestTrack({ id: 'track-abc', name: 'First' });
    const result1 = addTrack(tracks, track1.sampleId, track1.name, track1);
    expect(result1.length).toBe(1);

    // Second add with same ID is rejected
    const track2 = createTestTrack({ id: 'track-abc', name: 'Second' });
    const result2 = addTrack(result1, track2.sampleId, track2.name, track2);
    expect(result2.length).toBe(1);
    expect(result2[0].name).toBe('First'); // First one preserved
  });

  it('should allow multiple tracks with different IDs', () => {
    let tracks: Track[] = [];

    const track1 = createTestTrack({ id: 'track-1', name: 'Track 1' });
    tracks = addTrack(tracks, track1.sampleId, track1.name, track1);

    const track2 = createTestTrack({ id: 'track-2', name: 'Track 2' });
    tracks = addTrack(tracks, track2.sampleId, track2.name, track2);

    const track3 = createTestTrack({ id: 'track-3', name: 'Track 3' });
    tracks = addTrack(tracks, track3.sampleId, track3.name, track3);

    expect(tracks.length).toBe(3);
  });

  it('should enforce MAX_TRACKS limit', () => {
    let tracks: Track[] = [];

    // Add MAX_TRACKS tracks
    for (let i = 0; i < MAX_TRACKS; i++) {
      const track = createTestTrack({ id: `track-${i}`, name: `Track ${i}` });
      tracks = addTrack(tracks, track.sampleId, track.name, track);
    }
    expect(tracks.length).toBe(MAX_TRACKS);

    // Attempt to add one more
    const extraTrack = createTestTrack({ id: 'track-extra', name: 'Extra' });
    const result = addTrack(tracks, extraTrack.sampleId, extraTrack.name, extraTrack);
    expect(result.length).toBe(MAX_TRACKS); // Should not exceed
  });
});

describe('Session state integrity checks', () => {
  /**
   * Validates that a session state has no duplicate track IDs
   */
  function validateNoDuplicateTrackIds(tracks: Track[]): { valid: boolean; duplicates: string[] } {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const track of tracks) {
      if (seen.has(track.id)) {
        duplicates.push(track.id);
      } else {
        seen.add(track.id);
      }
    }

    return { valid: duplicates.length === 0, duplicates };
  }

  /**
   * Validates track count is within bounds
   */
  function validateTrackCount(tracks: Track[]): boolean {
    return tracks.length >= 0 && tracks.length <= MAX_TRACKS;
  }

  /**
   * Full session state validation
   */
  function validateSessionState(state: { tracks: Track[]; tempo: number; swing: number }): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check for duplicate track IDs
    const duplicateCheck = validateNoDuplicateTrackIds(state.tracks);
    if (!duplicateCheck.valid) {
      errors.push(`Duplicate track IDs found: ${duplicateCheck.duplicates.join(', ')}`);
    }

    // Check track count
    if (!validateTrackCount(state.tracks)) {
      errors.push(`Track count out of bounds: ${state.tracks.length} (max: ${MAX_TRACKS})`);
    }

    // Check tempo bounds
    if (state.tempo < 30 || state.tempo > 300) {
      errors.push(`Tempo out of bounds: ${state.tempo}`);
    }

    // Check swing bounds
    if (state.swing < 0 || state.swing > 100) {
      errors.push(`Swing out of bounds: ${state.swing}`);
    }

    return { valid: errors.length === 0, errors };
  }

  it('should detect duplicate track IDs', () => {
    const tracks = [
      createTestTrack({ id: 'track-1', name: 'Track 1' }),
      createTestTrack({ id: 'track-2', name: 'Track 2' }),
      createTestTrack({ id: 'track-1', name: 'Track 1 Duplicate' }), // Duplicate!
    ];

    const result = validateNoDuplicateTrackIds(tracks);
    expect(result.valid).toBe(false);
    expect(result.duplicates).toContain('track-1');
  });

  it('should pass validation for unique track IDs', () => {
    const tracks = [
      createTestTrack({ id: 'track-1', name: 'Track 1' }),
      createTestTrack({ id: 'track-2', name: 'Track 2' }),
      createTestTrack({ id: 'track-3', name: 'Track 3' }),
    ];

    const result = validateNoDuplicateTrackIds(tracks);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toEqual([]);
  });

  it('should detect the bug scenario: 15 tracks with same ID', () => {
    // This is the actual bug that was found in production
    const tracks = [
      createTestTrack({ id: 'track-bass', name: 'Bass' }),
      ...Array(15).fill(null).map(() =>
        createTestTrack({ id: 'track-rhodes', name: 'Rhodes' })
      ),
    ];

    const result = validateNoDuplicateTrackIds(tracks);
    expect(result.valid).toBe(false);
    expect(result.duplicates.length).toBe(14); // 14 duplicates (first one is not a duplicate)
  });

  it('should validate full session state', () => {
    const validState = {
      tracks: [
        createTestTrack({ id: 'track-1' }),
        createTestTrack({ id: 'track-2' }),
      ],
      tempo: 120,
      swing: 50,
    };

    const result = validateSessionState(validState);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should catch multiple validation errors', () => {
    const invalidState = {
      tracks: [
        createTestTrack({ id: 'track-1' }),
        createTestTrack({ id: 'track-1' }), // Duplicate
        createTestTrack({ id: 'track-1' }), // Duplicate
      ],
      tempo: 500, // Invalid
      swing: -10, // Invalid
    };

    const result = validateSessionState(invalidState);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
    expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
    expect(result.errors.some(e => e.includes('Tempo'))).toBe(true);
    expect(result.errors.some(e => e.includes('Swing'))).toBe(true);
  });
});

describe('Copy/Paste and Move sequence behavior', () => {
  /**
   * Simulates the reducer's MOVE_SEQUENCE action for the target track
   */
  function moveSequenceTarget(fromTrack: Track, toTrack: Track): Track {
    return {
      ...toTrack,
      steps: [...fromTrack.steps],
      parameterLocks: [...fromTrack.parameterLocks],
      stepCount: fromTrack.stepCount, // Should move step count
    };
  }

  /**
   * Simulates the reducer's MOVE_SEQUENCE action for the source track (cleared)
   */
  function moveSequenceSource(track: Track): Track {
    return {
      ...track,
      steps: Array(MAX_STEPS).fill(false),
      parameterLocks: Array(MAX_STEPS).fill(null),
      stepCount: STEPS_PER_PAGE, // Reset to default
    };
  }

  it('COPY_SEQUENCE should copy stepCount from source to target', () => {
    const sourceTrack = createTestTrack({
      id: 'source',
      stepCount: 32,
      steps: Array(MAX_STEPS).fill(false).map((_, i) => i % 8 === 0), // Every 8th step
    });
    const targetTrack = createTestTrack({
      id: 'target',
      stepCount: 16, // Different step count
    });

    const result = copySequence(sourceTrack, targetTrack);

    expect(result.stepCount).toBe(32); // Should inherit source's step count
    expect(result.steps).toEqual(sourceTrack.steps); // Steps copied
    expect(result.id).toBe('target'); // Keep target's identity
  });

  it('COPY_SEQUENCE should preserve 64-step patterns', () => {
    const sourceTrack = createTestTrack({
      id: 'source',
      stepCount: 64,
      steps: Array(MAX_STEPS).fill(false).map((_, i) => i === 63), // Only last step active
    });
    const targetTrack = createTestTrack({
      id: 'target',
      stepCount: 16,
    });

    const result = copySequence(sourceTrack, targetTrack);

    expect(result.stepCount).toBe(64);
    expect(result.steps[63]).toBe(true);
    expect(result.steps[0]).toBe(false);
  });

  it('MOVE_SEQUENCE should move stepCount to target and reset source', () => {
    const sourceTrack = createTestTrack({
      id: 'source',
      stepCount: 48,
      steps: Array(MAX_STEPS).fill(false).map((_, i) => i < 48 && i % 4 === 0),
    });
    const targetTrack = createTestTrack({
      id: 'target',
      stepCount: 16,
    });

    const movedTarget = moveSequenceTarget(sourceTrack, targetTrack);
    const clearedSource = moveSequenceSource(sourceTrack);

    // Target gets the pattern and step count
    expect(movedTarget.stepCount).toBe(48);
    expect(movedTarget.steps).toEqual(sourceTrack.steps);

    // Source is cleared and reset to default
    expect(clearedSource.stepCount).toBe(STEPS_PER_PAGE); // 16
    expect(clearedSource.steps.every(s => s === false)).toBe(true);
  });

  it('copying a 16-step track to a 64-step track should change target to 16 steps', () => {
    const sourceTrack = createTestTrack({ stepCount: 16 });
    const targetTrack = createTestTrack({ stepCount: 64 });

    const result = copySequence(sourceTrack, targetTrack);

    expect(result.stepCount).toBe(16); // Takes source's step count
  });
});

describe('RESET_STATE action (New button behavior)', () => {
  /**
   * Simulates the reducer's RESET_STATE action
   * This is what happens when user clicks "New" button
   */
  function resetState(): { tracks: Track[]; tempo: number; swing: number; isPlaying: boolean; currentStep: number } {
    return {
      tracks: [],
      tempo: 120,
      swing: 0,
      isPlaying: false,
      currentStep: -1,
    };
  }

  it('should return empty tracks array', () => {
    const state = resetState();
    expect(state.tracks).toEqual([]);
    expect(state.tracks.length).toBe(0);
  });

  it('should reset tempo to default (120 BPM)', () => {
    const state = resetState();
    expect(state.tempo).toBe(120);
  });

  it('should reset swing to default (0%)', () => {
    const state = resetState();
    expect(state.swing).toBe(0);
  });

  it('should stop playback', () => {
    const state = resetState();
    expect(state.isPlaying).toBe(false);
  });

  it('should reset currentStep to -1', () => {
    const state = resetState();
    expect(state.currentStep).toBe(-1);
  });

  it('should NOT include default 4 tracks (kick, snare, hihat, clap)', () => {
    // This test explicitly verifies the New button creates an empty session
    // NOT a session with default tracks
    const state = resetState();
    expect(state.tracks.length).toBe(0);
    expect(state.tracks.find(t => t.sampleId === 'kick')).toBeUndefined();
    expect(state.tracks.find(t => t.sampleId === 'snare')).toBeUndefined();
    expect(state.tracks.find(t => t.sampleId === 'hihat')).toBeUndefined();
    expect(state.tracks.find(t => t.sampleId === 'clap')).toBeUndefined();
  });

});

describe('Solo behavior', () => {
  /**
   * Simulates the reducer's TOGGLE_SOLO action
   */
  function toggleSolo(tracks: Track[], trackId: string): Track[] {
    return tracks.map(track =>
      track.id === trackId ? { ...track, soloed: !track.soloed } : track
    );
  }

  /**
   * Simulates the reducer's EXCLUSIVE_SOLO action
   */
  function exclusiveSolo(tracks: Track[], trackId: string): Track[] {
    return tracks.map(track => ({
      ...track,
      soloed: track.id === trackId,
    }));
  }

  /**
   * Simulates the reducer's CLEAR_ALL_SOLOS action
   */
  function clearAllSolos(tracks: Track[]): Track[] {
    return tracks.map(track => ({ ...track, soloed: false }));
  }

  /**
   * Simulates scheduler logic for determining if a track should play
   */
  function shouldTrackPlay(track: Track, allTracks: Track[]): boolean {
    const anySoloed = allTracks.some(t => t.soloed);
    return anySoloed ? track.soloed : !track.muted;
  }

  describe('TOGGLE_SOLO action', () => {
    it('should toggle solo state from false to true', () => {
      const tracks = [createTestTrack({ id: 'track-1', soloed: false })];
      const result = toggleSolo(tracks, 'track-1');
      expect(result[0].soloed).toBe(true);
    });

    it('should toggle solo state from true to false', () => {
      const tracks = [createTestTrack({ id: 'track-1', soloed: true })];
      const result = toggleSolo(tracks, 'track-1');
      expect(result[0].soloed).toBe(false);
    });

    it('should only affect the specified track', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', soloed: false }),
        createTestTrack({ id: 'track-2', soloed: false }),
      ];
      const result = toggleSolo(tracks, 'track-1');
      expect(result[0].soloed).toBe(true);
      expect(result[1].soloed).toBe(false);
    });
  });

  describe('EXCLUSIVE_SOLO action', () => {
    it('should solo only the specified track and unsolo all others', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', soloed: true }),
        createTestTrack({ id: 'track-2', soloed: true }),
        createTestTrack({ id: 'track-3', soloed: false }),
      ];
      const result = exclusiveSolo(tracks, 'track-3');
      expect(result[0].soloed).toBe(false);
      expect(result[1].soloed).toBe(false);
      expect(result[2].soloed).toBe(true);
    });
  });

  describe('CLEAR_ALL_SOLOS action', () => {
    it('should unsolo all tracks', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', soloed: true }),
        createTestTrack({ id: 'track-2', soloed: true }),
        createTestTrack({ id: 'track-3', soloed: false }),
      ];
      const result = clearAllSolos(tracks);
      expect(result.every(t => t.soloed === false)).toBe(true);
    });
  });

  describe('Playback logic with solo', () => {
    it('non-muted track plays when nothing is soloed', () => {
      const track = createTestTrack({ muted: false, soloed: false });
      const allTracks = [track];
      expect(shouldTrackPlay(track, allTracks)).toBe(true);
    });

    it('muted track does not play when nothing is soloed', () => {
      const track = createTestTrack({ muted: true, soloed: false });
      const allTracks = [track];
      expect(shouldTrackPlay(track, allTracks)).toBe(false);
    });

    it('soloed track plays when it is soloed', () => {
      const track = createTestTrack({ muted: false, soloed: true });
      const allTracks = [track];
      expect(shouldTrackPlay(track, allTracks)).toBe(true);
    });

    it('non-soloed track does not play when another track is soloed', () => {
      const track1 = createTestTrack({ id: 'track-1', muted: false, soloed: false });
      const track2 = createTestTrack({ id: 'track-2', muted: false, soloed: true });
      const allTracks = [track1, track2];
      expect(shouldTrackPlay(track1, allTracks)).toBe(false);
      expect(shouldTrackPlay(track2, allTracks)).toBe(true);
    });

    it('solo wins over mute (muted+soloed track plays)', () => {
      const track = createTestTrack({ muted: true, soloed: true });
      const allTracks = [track];
      expect(shouldTrackPlay(track, allTracks)).toBe(true);
    });

    it('multiple soloed tracks all play', () => {
      const track1 = createTestTrack({ id: 'track-1', soloed: true });
      const track2 = createTestTrack({ id: 'track-2', soloed: true });
      const track3 = createTestTrack({ id: 'track-3', soloed: false });
      const allTracks = [track1, track2, track3];
      expect(shouldTrackPlay(track1, allTracks)).toBe(true);
      expect(shouldTrackPlay(track2, allTracks)).toBe(true);
      expect(shouldTrackPlay(track3, allTracks)).toBe(false);
    });

    it('mute state is preserved after un-soloing (scenario test)', () => {
      // Initial: track1 muted, track2 muted, track3 not muted
      let tracks = [
        createTestTrack({ id: 'track-1', muted: true, soloed: false }),
        createTestTrack({ id: 'track-2', muted: true, soloed: false }),
        createTestTrack({ id: 'track-3', muted: false, soloed: false }),
      ];

      // Step 1: Before any solo, only track3 plays
      expect(shouldTrackPlay(tracks[0], tracks)).toBe(false);
      expect(shouldTrackPlay(tracks[1], tracks)).toBe(false);
      expect(shouldTrackPlay(tracks[2], tracks)).toBe(true);

      // Step 2: Solo track2
      tracks = toggleSolo(tracks, 'track-2');
      expect(shouldTrackPlay(tracks[0], tracks)).toBe(false);
      expect(shouldTrackPlay(tracks[1], tracks)).toBe(true); // Only track2 plays
      expect(shouldTrackPlay(tracks[2], tracks)).toBe(false);

      // Step 3: Un-solo track2 - back to original behavior
      tracks = toggleSolo(tracks, 'track-2');
      expect(tracks[0].muted).toBe(true); // Mute state preserved
      expect(tracks[1].muted).toBe(true); // Mute state preserved
      expect(tracks[2].muted).toBe(false);
      expect(shouldTrackPlay(tracks[0], tracks)).toBe(false);
      expect(shouldTrackPlay(tracks[1], tracks)).toBe(false);
      expect(shouldTrackPlay(tracks[2], tracks)).toBe(true); // Back to original
    });
  });

  describe('Backwards compatibility (LOAD_STATE)', () => {
    it('should default soloed to false for old sessions without soloed field', () => {
      const oldTrack = {
        id: 'old-track',
        name: 'Old',
        sampleId: 'kick',
        steps: Array(16).fill(false),
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        // soloed missing (old format)
        transpose: 0,
      };

      const normalized = normalizeTrackFromLoad(oldTrack);
      expect(normalized.soloed).toBe(false);
    });

    it('should preserve soloed state when loading sessions with soloed field', () => {
      const newTrack = {
        id: 'new-track',
        name: 'New',
        sampleId: 'kick',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        soloed: true,
        transpose: 0,
        stepCount: 16,
      };

      const normalized = normalizeTrackFromLoad(newTrack);
      expect(normalized.soloed).toBe(true);
    });
  });
});

// ============================================================================
// 128-STEP EXTENSION TESTS (Phase 23)
// ============================================================================
// These tests verify the extension from 64 to 128 steps.
// They expose implicit assumptions and ensure backwards compatibility.

describe('128-Step Extension', () => {
  describe('MAX_STEPS constant', () => {
    it('MAX_STEPS should be 128 for 8-bar support', () => {
      // 128 steps = 8 bars of 16th notes
      // This enables full verse/chorus sections
      expect(MAX_STEPS).toBe(128);
    });

    it('arrays should always have MAX_STEPS (128) slots', () => {
      const track = createTestTrack();
      expect(track.steps.length).toBe(128);
      expect(track.parameterLocks.length).toBe(128);
    });
  });

  describe('step count options', () => {
    it('STEP_COUNT_OPTIONS should include 96 and 128', () => {
      // Check the actual imported constant
      expect(STEP_COUNT_OPTIONS).toContain(96);
      expect(STEP_COUNT_OPTIONS).toContain(128);
    });

    it('should allow stepCount of 96 (6 bars)', () => {
      const track = setTrackStepCount(createTestTrack(), 96);
      expect(track.stepCount).toBe(96);
    });

    it('should allow stepCount of 128 (8 bars)', () => {
      const track = setTrackStepCount(createTestTrack(), 128);
      expect(track.stepCount).toBe(128);
    });

    it('should clamp stepCount to maximum of MAX_STEPS (128)', () => {
      const track = setTrackStepCount(createTestTrack(), 200);
      expect(track.stepCount).toBe(128);
    });
  });

  describe('128-step track behavior', () => {
    /**
     * Simulates scheduler behavior for counting triggers
     */
    function countTriggers(track: Track, totalSteps: number): number[] {
      const triggers: number[] = [];
      for (let globalStep = 0; globalStep < totalSteps; globalStep++) {
        const trackStep = globalStep % track.stepCount;
        if (track.steps[trackStep] && !track.muted) {
          triggers.push(globalStep);
        }
      }
      return triggers;
    }

    it('128-step track loops once over 128 global steps', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[64] = true;
      steps[127] = true;

      const track = createTestTrack({ steps, stepCount: 128 });
      const triggers = countTriggers(track, 128);

      // Should trigger exactly 3 times
      expect(triggers).toEqual([0, 64, 127]);
    });

    it('64-step track loops twice while 128-step track loops once', () => {
      const track64Steps = Array(MAX_STEPS).fill(false);
      track64Steps[0] = true;

      const track128Steps = Array(MAX_STEPS).fill(false);
      track128Steps[0] = true;

      const track64 = createTestTrack({ steps: track64Steps, stepCount: 64 });
      const track128 = createTestTrack({ steps: track128Steps, stepCount: 128 });

      const triggers64 = countTriggers(track64, 128);
      const triggers128 = countTriggers(track128, 128);

      // 64-step track loops twice (triggers at 0, 64)
      expect(triggers64).toEqual([0, 64]);

      // 128-step track loops once (triggers at 0)
      expect(triggers128).toEqual([0]);
    });

    it('can have parameter locks at all 128 positions', () => {
      const parameterLocks = Array(MAX_STEPS).fill(null);
      // Set locks at first, middle, and last positions
      parameterLocks[0] = { pitch: 12, volume: null };
      parameterLocks[63] = { pitch: -12, volume: null };
      parameterLocks[64] = { pitch: 6, volume: null };
      parameterLocks[127] = { pitch: -6, volume: null };

      const track = createTestTrack({ parameterLocks, stepCount: 128 });

      expect(track.parameterLocks[0]).toEqual({ pitch: 12, volume: null });
      expect(track.parameterLocks[63]).toEqual({ pitch: -12, volume: null });
      expect(track.parameterLocks[64]).toEqual({ pitch: 6, volume: null });
      expect(track.parameterLocks[127]).toEqual({ pitch: -6, volume: null });
    });

    it('step 127 should trigger correctly during playback simulation', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[127] = true; // Only last step active

      const track = createTestTrack({ steps, stepCount: 128 });

      // Simulate scheduler reaching step 127
      const globalStep = 127;
      const trackStep = globalStep % track.stepCount;
      expect(trackStep).toBe(127);
      expect(track.steps[trackStep]).toBe(true);
    });
  });

  describe('musical timing verification', () => {
    it('128 steps = 8 bars of 16th notes', () => {
      // At 4 beats per bar, 4 sixteenth notes per beat
      const stepsPerBeat = 4;
      const beatsPerBar = 4;
      const bars = 8;
      expect(128).toBe(stepsPerBeat * beatsPerBar * bars);
    });

    it('96 steps = 6 bars of 16th notes', () => {
      const stepsPerBeat = 4;
      const beatsPerBar = 4;
      const bars = 6;
      expect(96).toBe(stepsPerBeat * beatsPerBar * bars);
    });
  });

  describe('polyrhythms with extended step counts', () => {
    function countTriggers(track: Track, totalSteps: number): number[] {
      const triggers: number[] = [];
      for (let globalStep = 0; globalStep < totalSteps; globalStep++) {
        const trackStep = globalStep % track.stepCount;
        if (track.steps[trackStep] && !track.muted) {
          triggers.push(globalStep);
        }
      }
      return triggers;
    }

    it('7-step pattern against 128 steps creates complex polyrhythm', () => {
      // 7 is prime, so 7 vs 128 never aligns (LCM = 896)
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true; // Only first step of 7-step pattern

      const track = createTestTrack({ steps, stepCount: 7 });
      const triggers = countTriggers(track, 128);

      // 128 / 7 = 18 full cycles + 2 partial steps
      // Step 0 triggers at: 0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 98, 105, 112, 119, 126
      // (but step 126 is trackStep 0 because 126 % 7 = 0)
      expect(triggers.length).toBe(19); // 18 full + start
      expect(triggers[0]).toBe(0);
      expect(triggers[triggers.length - 1]).toBe(126); // 126 % 7 = 0
    });

    it('96-step track interacts correctly with 128-step global counter', () => {
      const steps96 = Array(MAX_STEPS).fill(false);
      steps96[0] = true;
      steps96[48] = true;

      const track96 = createTestTrack({ steps: steps96, stepCount: 96 });
      const triggers = countTriggers(track96, 128);

      // At global step 96, track loops back to step 0
      // 0 → triggers at global 0, 96
      // 48 → triggers at global 48
      // After step 96: 96 % 96 = 0, 97 % 96 = 1, etc.
      expect(triggers).toContain(0);
      expect(triggers).toContain(48);
      expect(triggers).toContain(96); // 96 % 96 = 0
    });
  });

  describe('backwards compatibility', () => {
    it('should extend 64-element arrays to 128 when loading old sessions', () => {
      // Simulate an old session with 64-element arrays
      const oldTrack = {
        id: 'old-track',
        name: 'Old',
        sampleId: 'kick',
        steps: Array(64).fill(false).map((_, i) => i % 4 === 0),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 64,
      };

      const normalized = normalizeTrackFromLoad(oldTrack);

      // Should be extended to 128
      expect(normalized.steps.length).toBe(128);
      expect(normalized.parameterLocks.length).toBe(128);

      // Original data should be preserved
      expect(normalized.steps[0]).toBe(true);
      expect(normalized.steps[4]).toBe(true);
      expect(normalized.stepCount).toBe(64); // Preserved
    });

    it('should fill extended positions with false/null', () => {
      const oldTrack = {
        id: 'old-track',
        name: 'Old',
        sampleId: 'kick',
        steps: Array(64).fill(true), // All active
        parameterLocks: Array(64).fill({ pitch: 1, volume: null }),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 64,
      };

      const normalized = normalizeTrackFromLoad(oldTrack);

      // Extended positions should be inactive
      expect(normalized.steps[64]).toBe(false);
      expect(normalized.steps[127]).toBe(false);
      expect(normalized.parameterLocks[64]).toBeNull();
      expect(normalized.parameterLocks[127]).toBeNull();
    });

    it('should handle very old 16-element arrays from legacy sessions', () => {
      const legacyTrack = {
        id: 'legacy',
        name: 'Legacy',
        sampleId: 'snare',
        steps: Array(16).fill(false).map((_, i) => i === 0),
        parameterLocks: Array(16).fill(null),
        volume: 0.8,
        muted: false,
        transpose: 0,
        // stepCount might be missing in very old sessions
      };

      const normalized = normalizeTrackFromLoad(legacyTrack);

      expect(normalized.steps.length).toBe(128);
      expect(normalized.parameterLocks.length).toBe(128);
      expect(normalized.stepCount).toBe(16); // Default for legacy
      expect(normalized.steps[0]).toBe(true);
      expect(normalized.steps[16]).toBe(false); // Extended
    });
  });

  describe('COPY_SEQUENCE with 128-step tracks', () => {
    it('should copy 128-step pattern correctly', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[127] = true;

      const sourceTrack = createTestTrack({
        stepCount: 128,
        steps,
      });

      const targetTrack = createTestTrack({ stepCount: 16 });

      const result = copySequence(sourceTrack, targetTrack);

      expect(result.stepCount).toBe(128);
      expect(result.steps[0]).toBe(true);
      expect(result.steps[127]).toBe(true);
    });
  });
});

// ============================================================================
// FM PARAMS TESTS (Phase 24)
// ============================================================================
// Tests for FM synthesis parameter handling in track state

describe('FM Params (Phase 24)', () => {
  /**
   * Simulates the reducer's SET_FM_PARAMS action
   */
  function setFMParams(
    track: Track,
    fmParams: { harmonicity: number; modulationIndex: number }
  ): Track {
    return {
      ...track,
      fmParams,
    };
  }

  describe('SET_FM_PARAMS action', () => {
    it('should set FM params on a track', () => {
      const track = createTestTrack({
        sampleId: 'tone:fm-epiano',
      });

      const result = setFMParams(track, { harmonicity: 5, modulationIndex: 12 });

      expect(result.fmParams).toEqual({ harmonicity: 5, modulationIndex: 12 });
    });

    it('should update existing FM params', () => {
      const track = createTestTrack({
        sampleId: 'tone:fm-bass',
        fmParams: { harmonicity: 2, modulationIndex: 8 },
      });

      const result = setFMParams(track, { harmonicity: 3, modulationIndex: 15 });

      expect(result.fmParams).toEqual({ harmonicity: 3, modulationIndex: 15 });
    });

    it('should preserve other track properties', () => {
      const track = createTestTrack({
        id: 'fm-track',
        name: 'FM Synth',
        sampleId: 'tone:fm-epiano',
        volume: 0.8,
        muted: true,
      });

      const result = setFMParams(track, { harmonicity: 4, modulationIndex: 10 });

      expect(result.id).toBe('fm-track');
      expect(result.name).toBe('FM Synth');
      expect(result.sampleId).toBe('tone:fm-epiano');
      expect(result.volume).toBe(0.8);
      expect(result.muted).toBe(true);
    });
  });

  describe('FM params type validation', () => {
    it('harmonicity should be a positive number', () => {
      const fmParams = { harmonicity: 3.01, modulationIndex: 10 };
      expect(typeof fmParams.harmonicity).toBe('number');
      expect(fmParams.harmonicity).toBeGreaterThan(0);
    });

    it('modulationIndex should be a non-negative number', () => {
      const fmParams = { harmonicity: 2, modulationIndex: 8 };
      expect(typeof fmParams.modulationIndex).toBe('number');
      expect(fmParams.modulationIndex).toBeGreaterThanOrEqual(0);
    });
  });

  describe('FM presets default values', () => {
    // These are the actual defaults from toneSynths.ts
    const FM_PRESET_DEFAULTS: Record<string, { harmonicity: number; modulationIndex: number }> = {
      'tone:fm-epiano': { harmonicity: 3.01, modulationIndex: 10 },
      'tone:fm-bass': { harmonicity: 2, modulationIndex: 8 },
      'tone:fm-bell': { harmonicity: 5.01, modulationIndex: 14 },
    };

    it('fm-epiano should have harmonicity ~3 and modIndex ~10', () => {
      expect(FM_PRESET_DEFAULTS['tone:fm-epiano'].harmonicity).toBeCloseTo(3, 0);
      expect(FM_PRESET_DEFAULTS['tone:fm-epiano'].modulationIndex).toBe(10);
    });

    it('fm-bass should have harmonicity 2 and modIndex 8', () => {
      expect(FM_PRESET_DEFAULTS['tone:fm-bass'].harmonicity).toBe(2);
      expect(FM_PRESET_DEFAULTS['tone:fm-bass'].modulationIndex).toBe(8);
    });

    it('fm-bell should have harmonicity ~5 and modIndex 14', () => {
      expect(FM_PRESET_DEFAULTS['tone:fm-bell'].harmonicity).toBeCloseTo(5, 0);
      expect(FM_PRESET_DEFAULTS['tone:fm-bell'].modulationIndex).toBe(14);
    });
  });
});

// ============================================================================
// TRACK VOLUME TESTS (Phase 25)
// ============================================================================
// Tests for per-track volume control

describe('Track Volume (Phase 25)', () => {
  /**
   * Simulates the reducer's SET_TRACK_VOLUME action
   */
  function setTrackVolumeAction(track: Track, volume: number): Track {
    return {
      ...track,
      volume: Math.max(0, Math.min(1, volume)),
    };
  }

  describe('SET_TRACK_VOLUME action', () => {
    it('should set volume on a track', () => {
      const track = createTestTrack({ volume: 1 });
      const result = setTrackVolumeAction(track, 0.5);
      expect(result.volume).toBe(0.5);
    });

    it('should clamp volume to 0-1 range', () => {
      const track = createTestTrack({ volume: 1 });

      expect(setTrackVolumeAction(track, -0.5).volume).toBe(0);
      expect(setTrackVolumeAction(track, 1.5).volume).toBe(1);
    });

    it('should preserve other track properties', () => {
      const track = createTestTrack({
        id: 'test',
        name: 'Test',
        muted: true,
        soloed: true,
      });

      const result = setTrackVolumeAction(track, 0.7);

      expect(result.id).toBe('test');
      expect(result.name).toBe('Test');
      expect(result.muted).toBe(true);
      expect(result.soloed).toBe(true);
      expect(result.volume).toBe(0.7);
    });
  });

  describe('volume defaults', () => {
    it('new tracks should default to volume 1', () => {
      const track = createTestTrack();
      expect(track.volume).toBe(1);
    });
  });
});

/**
 * Phase 31F: Multi-Select Steps
 * Phase 31G: Loop Selection
 *
 * Tests for selection state management and loop region functionality.
 */
import { gridReducer } from './grid';
import type { GridState, GridAction } from '../types';

function createTestGridState(overrides: Partial<GridState> = {}): GridState {
  return {
    tracks: [createTestTrack({ id: 'track-1', steps: Array(MAX_STEPS).fill(false) })],
    tempo: 120,
    swing: 0,
    isPlaying: false,
    currentStep: 0,
    selection: null,
    loopRegion: null,
    ...overrides,
  };
}

describe('Phase 31F: Multi-Select Steps', () => {
  describe('SELECT_STEP action', () => {
    describe('toggle mode (Ctrl+Click)', () => {
      it('creates new selection with single step when no selection exists', () => {
        const state = createTestGridState();
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 5, mode: 'toggle' };

        const result = gridReducer(state, action);

        expect(result.selection).not.toBeNull();
        expect(result.selection?.trackId).toBe('track-1');
        expect(result.selection?.steps.size).toBe(1);
        expect(result.selection?.steps.has(5)).toBe(true);
        expect(result.selection?.anchor).toBe(5);
      });

      it('adds step to existing selection on same track', () => {
        const state = createTestGridState({
          selection: { trackId: 'track-1', steps: new Set([5]), anchor: 5 },
        });
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 8, mode: 'toggle' };

        const result = gridReducer(state, action);

        expect(result.selection?.steps.size).toBe(2);
        expect(result.selection?.steps.has(5)).toBe(true);
        expect(result.selection?.steps.has(8)).toBe(true);
        expect(result.selection?.anchor).toBe(8); // Anchor updates to new step
      });

      it('removes step from selection when already selected', () => {
        const state = createTestGridState({
          selection: { trackId: 'track-1', steps: new Set([5, 8]), anchor: 8 },
        });
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 5, mode: 'toggle' };

        const result = gridReducer(state, action);

        expect(result.selection?.steps.size).toBe(1);
        expect(result.selection?.steps.has(5)).toBe(false);
        expect(result.selection?.steps.has(8)).toBe(true);
      });

      it('starts new selection when clicking different track', () => {
        const state = createTestGridState({
          tracks: [
            createTestTrack({ id: 'track-1' }),
            createTestTrack({ id: 'track-2' }),
          ],
          selection: { trackId: 'track-1', steps: new Set([5, 8]), anchor: 8 },
        });
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-2', step: 3, mode: 'toggle' };

        const result = gridReducer(state, action);

        expect(result.selection?.trackId).toBe('track-2');
        expect(result.selection?.steps.size).toBe(1);
        expect(result.selection?.steps.has(3)).toBe(true);
      });

      it('ignores invalid step indices', () => {
        const state = createTestGridState({
          tracks: [createTestTrack({ id: 'track-1', stepCount: 16 })],
        });
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 20, mode: 'toggle' };

        const result = gridReducer(state, action);

        expect(result.selection).toBeNull();
      });

      it('ignores non-existent track', () => {
        const state = createTestGridState();
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'non-existent', step: 5, mode: 'toggle' };

        const result = gridReducer(state, action);

        expect(result.selection).toBeNull();
      });
    });

    describe('extend mode (Shift+Click)', () => {
      it('creates range selection from anchor to clicked step', () => {
        const state = createTestGridState({
          selection: { trackId: 'track-1', steps: new Set([2]), anchor: 2 },
        });
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 6, mode: 'extend' };

        const result = gridReducer(state, action);

        expect(result.selection?.steps.size).toBe(5); // Steps 2, 3, 4, 5, 6
        expect(result.selection?.steps.has(2)).toBe(true);
        expect(result.selection?.steps.has(3)).toBe(true);
        expect(result.selection?.steps.has(4)).toBe(true);
        expect(result.selection?.steps.has(5)).toBe(true);
        expect(result.selection?.steps.has(6)).toBe(true);
        expect(result.selection?.anchor).toBe(2); // Anchor preserved
      });

      it('works when extending backwards from anchor', () => {
        const state = createTestGridState({
          selection: { trackId: 'track-1', steps: new Set([8]), anchor: 8 },
        });
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 5, mode: 'extend' };

        const result = gridReducer(state, action);

        expect(result.selection?.steps.size).toBe(4); // Steps 5, 6, 7, 8
        expect(result.selection?.steps.has(5)).toBe(true);
        expect(result.selection?.steps.has(6)).toBe(true);
        expect(result.selection?.steps.has(7)).toBe(true);
        expect(result.selection?.steps.has(8)).toBe(true);
      });

      it('creates new selection when no anchor exists', () => {
        const state = createTestGridState();
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 5, mode: 'extend' };

        const result = gridReducer(state, action);

        expect(result.selection?.steps.size).toBe(1);
        expect(result.selection?.steps.has(5)).toBe(true);
        expect(result.selection?.anchor).toBe(5);
      });

      it('clamps to track stepCount', () => {
        const state = createTestGridState({
          tracks: [createTestTrack({ id: 'track-1', stepCount: 8 })],
          selection: { trackId: 'track-1', steps: new Set([2]), anchor: 2 },
        });
        const action: GridAction = { type: 'SELECT_STEP', trackId: 'track-1', step: 6, mode: 'extend' };

        const result = gridReducer(state, action);

        // Should only include steps 2-6 (within stepCount of 8)
        expect(result.selection?.steps.size).toBe(5);
        expect(result.selection?.steps.has(7)).toBe(false);
      });
    });
  });

  describe('CLEAR_SELECTION action', () => {
    it('clears existing selection', () => {
      const state = createTestGridState({
        selection: { trackId: 'track-1', steps: new Set([1, 2, 3]), anchor: 1 },
      });
      const action: GridAction = { type: 'CLEAR_SELECTION' };

      const result = gridReducer(state, action);

      expect(result.selection).toBeNull();
    });

    it('works when no selection exists', () => {
      const state = createTestGridState();
      const action: GridAction = { type: 'CLEAR_SELECTION' };

      const result = gridReducer(state, action);

      expect(result.selection).toBeNull();
    });
  });

  describe('DELETE_SELECTED_STEPS action', () => {
    it('clears all selected steps and their p-locks', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true;
      steps[5] = true;
      steps[8] = true;
      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[2] = { pitch: 3 };
      parameterLocks[5] = { volume: 0.5 };

      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps, parameterLocks })],
        selection: { trackId: 'track-1', steps: new Set([2, 5]), anchor: 2 },
      });
      const action: GridAction = { type: 'DELETE_SELECTED_STEPS' };

      const result = gridReducer(state, action);

      expect(result.tracks[0].steps[2]).toBe(false);
      expect(result.tracks[0].steps[5]).toBe(false);
      expect(result.tracks[0].steps[8]).toBe(true); // Not selected, unchanged
      expect(result.tracks[0].parameterLocks[2]).toBeNull();
      expect(result.tracks[0].parameterLocks[5]).toBeNull();
      expect(result.selection).toBeNull(); // Selection cleared
    });

    it('does nothing when no selection exists', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true;
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps })],
        selection: null,
      });
      const action: GridAction = { type: 'DELETE_SELECTED_STEPS' };

      const result = gridReducer(state, action);

      expect(result.tracks[0].steps[2]).toBe(true); // Unchanged
    });

    it('does nothing when selection is empty', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true;
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps })],
        selection: { trackId: 'track-1', steps: new Set(), anchor: null },
      });
      const action: GridAction = { type: 'DELETE_SELECTED_STEPS' };

      const result = gridReducer(state, action);

      expect(result.tracks[0].steps[2]).toBe(true); // Unchanged
    });
  });

  describe('APPLY_TO_SELECTION action', () => {
    it('applies p-lock to all active selected steps', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true;
      steps[5] = true;
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps })],
        selection: { trackId: 'track-1', steps: new Set([2, 5]), anchor: 2 },
      });
      const action: GridAction = { type: 'APPLY_TO_SELECTION', lock: { pitch: 7 } };

      const result = gridReducer(state, action);

      expect(result.tracks[0].parameterLocks[2]).toEqual({ pitch: 7 });
      expect(result.tracks[0].parameterLocks[5]).toEqual({ pitch: 7 });
    });

    it('merges with existing p-locks', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true;
      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[2] = { pitch: 3 };
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps, parameterLocks })],
        selection: { trackId: 'track-1', steps: new Set([2]), anchor: 2 },
      });
      const action: GridAction = { type: 'APPLY_TO_SELECTION', lock: { volume: 0.5 } };

      const result = gridReducer(state, action);

      expect(result.tracks[0].parameterLocks[2]).toEqual({ pitch: 3, volume: 0.5 });
    });

    it('skips inactive steps (does not create new p-locks for them)', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true; // Active
      // steps[5] stays false (inactive)
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps })],
        selection: { trackId: 'track-1', steps: new Set([2, 5]), anchor: 2 },
      });
      const action: GridAction = { type: 'APPLY_TO_SELECTION', lock: { pitch: 7 } };

      const result = gridReducer(state, action);

      expect(result.tracks[0].parameterLocks[2]).toEqual({ pitch: 7 }); // Active step gets p-lock
      expect(result.tracks[0].parameterLocks[5]).toBeNull(); // Inactive step skipped
    });

    it('does nothing when no selection exists', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true;
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps })],
        selection: null,
      });
      const action: GridAction = { type: 'APPLY_TO_SELECTION', lock: { pitch: 7 } };

      const result = gridReducer(state, action);

      expect(result.tracks[0].parameterLocks[2]).toBeNull(); // Unchanged
    });

    it('preserves selection after applying p-locks', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[2] = true;
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', steps })],
        selection: { trackId: 'track-1', steps: new Set([2]), anchor: 2 },
      });
      const action: GridAction = { type: 'APPLY_TO_SELECTION', lock: { pitch: 7 } };

      const result = gridReducer(state, action);

      expect(result.selection).not.toBeNull();
      expect(result.selection?.steps.has(2)).toBe(true);
    });
  });
});

describe('Phase 31G: Loop Selection', () => {
  describe('SET_LOOP_REGION action', () => {
    it('sets loop region with start and end', () => {
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', stepCount: 16 })],
      });
      const action: GridAction = { type: 'SET_LOOP_REGION', region: { start: 4, end: 12 } };

      const result = gridReducer(state, action);

      expect(result.loopRegion).toEqual({ start: 4, end: 12 });
    });

    it('clears loop region when set to null', () => {
      const state = createTestGridState({
        loopRegion: { start: 4, end: 12 },
      });
      const action: GridAction = { type: 'SET_LOOP_REGION', region: null };

      const result = gridReducer(state, action);

      expect(result.loopRegion).toBeNull();
    });

    it('swaps start and end if start > end', () => {
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', stepCount: 16 })],
      });
      const action: GridAction = { type: 'SET_LOOP_REGION', region: { start: 12, end: 4 } };

      const result = gridReducer(state, action);

      expect(result.loopRegion).toEqual({ start: 4, end: 12 });
    });

    it('clamps region to longest track stepCount', () => {
      const state = createTestGridState({
        tracks: [
          createTestTrack({ id: 'track-1', stepCount: 8 }),
          createTestTrack({ id: 'track-2', stepCount: 16 }),
        ],
      });
      const action: GridAction = { type: 'SET_LOOP_REGION', region: { start: 0, end: 20 } };

      const result = gridReducer(state, action);

      // Should clamp to longest track (16 steps, so max index is 15)
      expect(result.loopRegion?.end).toBe(15);
    });

    it('clamps negative values to 0', () => {
      const state = createTestGridState({
        tracks: [createTestTrack({ id: 'track-1', stepCount: 16 })],
      });
      const action: GridAction = { type: 'SET_LOOP_REGION', region: { start: -5, end: 10 } };

      const result = gridReducer(state, action);

      expect(result.loopRegion?.start).toBe(0);
    });
  });
});

// ============================================================================
// TRACK REORDER TESTS (Coverage for skipped E2E tests)
// ============================================================================
// These unit tests cover the track reorder functionality that was previously
// only tested in E2E tests (track-reorder*.spec.ts). The E2E tests are skipped
// in CI because they require real backend infrastructure.

describe('Track Reorder Algorithm', () => {
  /**
   * Helper to create a state with multiple tracks for reorder testing
   */
  function createMultiTrackState(trackCount: number): GridState {
    const tracks: Track[] = [];
    for (let i = 0; i < trackCount; i++) {
      tracks.push(createTestTrack({
        id: `track-${i}`,
        name: `Track ${i}`,
        sampleId: `sample-${i}`,
      }));
    }
    return createTestGridState({ tracks });
  }

  /**
   * Helper to get track IDs in order
   */
  function getTrackIds(state: GridState): string[] {
    return state.tracks.map(t => t.id);
  }

  describe('basic reorder operations', () => {
    it('should move track forward (fromIndex < toIndex)', () => {
      const state = createMultiTrackState(5);
      // Move track 0 to position 3
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 3 });

      // Original: [0, 1, 2, 3, 4]
      // After moving 0 to position 3: [1, 2, 3, 0, 4]
      expect(getTrackIds(result)).toEqual([
        'track-1', 'track-2', 'track-3', 'track-0', 'track-4',
      ]);
    });

    it('should move track backward (fromIndex > toIndex)', () => {
      const state = createMultiTrackState(5);
      // Move track 3 to position 1
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 3, toIndex: 1 });

      // Original: [0, 1, 2, 3, 4]
      // After moving 3 to position 1: [0, 3, 1, 2, 4]
      expect(getTrackIds(result)).toEqual([
        'track-0', 'track-3', 'track-1', 'track-2', 'track-4',
      ]);
    });

    it('should swap adjacent tracks (forward)', () => {
      const state = createMultiTrackState(5);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 1, toIndex: 2 });

      // Original: [0, 1, 2, 3, 4]
      // After swapping 1 with 2: [0, 2, 1, 3, 4]
      expect(getTrackIds(result)).toEqual([
        'track-0', 'track-2', 'track-1', 'track-3', 'track-4',
      ]);
    });

    it('should swap adjacent tracks (backward)', () => {
      const state = createMultiTrackState(5);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 2, toIndex: 1 });

      // Original: [0, 1, 2, 3, 4]
      // After swapping 2 to position 1: [0, 2, 1, 3, 4]
      expect(getTrackIds(result)).toEqual([
        'track-0', 'track-2', 'track-1', 'track-3', 'track-4',
      ]);
    });

    it('should move first track to last position', () => {
      const state = createMultiTrackState(4);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 3 });

      expect(getTrackIds(result)).toEqual([
        'track-1', 'track-2', 'track-3', 'track-0',
      ]);
    });

    it('should move last track to first position', () => {
      const state = createMultiTrackState(4);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 3, toIndex: 0 });

      expect(getTrackIds(result)).toEqual([
        'track-3', 'track-0', 'track-1', 'track-2',
      ]);
    });
  });

  describe('invariants', () => {
    it('should preserve track count after any reorder', () => {
      const state = createMultiTrackState(5);
      const initialCount = state.tracks.length;

      // Test various reorder operations
      const operations = [
        { fromIndex: 0, toIndex: 4 },
        { fromIndex: 4, toIndex: 0 },
        { fromIndex: 2, toIndex: 2 },
        { fromIndex: 1, toIndex: 3 },
      ];

      for (const op of operations) {
        const result = gridReducer(state, { type: 'REORDER_TRACKS', ...op });
        expect(result.tracks.length).toBe(initialCount);
      }
    });

    it('should preserve all track IDs (no tracks lost or duplicated)', () => {
      const state = createMultiTrackState(6);
      const originalIds = new Set(getTrackIds(state));

      // Perform multiple reorders
      let result = state;
      result = gridReducer(result, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 5 });
      result = gridReducer(result, { type: 'REORDER_TRACKS', fromIndex: 3, toIndex: 1 });
      result = gridReducer(result, { type: 'REORDER_TRACKS', fromIndex: 2, toIndex: 4 });

      const finalIds = new Set(getTrackIds(result));
      expect(finalIds).toEqual(originalIds);
    });

    it('should preserve track properties during reorder', () => {
      const state = createMultiTrackState(3);
      // Modify a track's properties
      const modifiedState = {
        ...state,
        tracks: state.tracks.map((track, i) => {
          if (i === 1) {
            return {
              ...track,
              volume: 0.5,
              muted: true,
              transpose: 7,
              stepCount: 32,
            };
          }
          return track;
        }),
      };

      const result = gridReducer(modifiedState, { type: 'REORDER_TRACKS', fromIndex: 1, toIndex: 0 });

      // Find the moved track (now at index 0)
      const movedTrack = result.tracks[0];
      expect(movedTrack.id).toBe('track-1');
      expect(movedTrack.volume).toBe(0.5);
      expect(movedTrack.muted).toBe(true);
      expect(movedTrack.transpose).toBe(7);
      expect(movedTrack.stepCount).toBe(32);
    });
  });

  describe('no-op cases', () => {
    it('should not change order when fromIndex equals toIndex', () => {
      const state = createMultiTrackState(3);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 1, toIndex: 1 });

      // Order should remain unchanged
      expect(getTrackIds(result)).toEqual(getTrackIds(state));
    });

    it('should not change order for negative fromIndex', () => {
      const state = createMultiTrackState(3);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: -1, toIndex: 2 });

      expect(getTrackIds(result)).toEqual(getTrackIds(state));
    });

    it('should not change order for negative toIndex', () => {
      const state = createMultiTrackState(3);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: -1 });

      expect(getTrackIds(result)).toEqual(getTrackIds(state));
    });

    it('should not change order for out-of-bounds fromIndex', () => {
      const state = createMultiTrackState(3);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 5, toIndex: 0 });

      expect(getTrackIds(result)).toEqual(getTrackIds(state));
    });

    it('should not change order for out-of-bounds toIndex', () => {
      const state = createMultiTrackState(3);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 10 });

      expect(getTrackIds(result)).toEqual(getTrackIds(state));
    });

    it('should not change state when tracks array is empty', () => {
      const state = createTestGridState({ tracks: [] });
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 1 });

      expect(result.tracks).toEqual([]);
    });
  });

  describe('boundary conditions', () => {
    it('should handle single track gracefully', () => {
      const state = createMultiTrackState(1);
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 0 });

      expect(result.tracks.length).toBe(1);
      expect(result.tracks[0].id).toBe('track-0');
    });

    it('should handle two tracks correctly', () => {
      const state = createMultiTrackState(2);

      // Swap the two tracks
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 1 });

      expect(getTrackIds(result)).toEqual(['track-1', 'track-0']);
    });

    it('should handle maximum tracks (16)', () => {
      const state = createMultiTrackState(MAX_TRACKS);
      expect(state.tracks.length).toBe(16);

      // Move first to last
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 15 });

      expect(result.tracks.length).toBe(16);
      expect(result.tracks[15].id).toBe('track-0');
      expect(result.tracks[0].id).toBe('track-1');
    });
  });

  describe('precise position validation (covers track-reorder-precision.spec.ts)', () => {
    it('should place dragged track at EXACT target position (matrix test)', () => {
      // Test all combinations of fromIndex and toIndex for 5 tracks
      const trackCount = 5;

      for (let from = 0; from < trackCount; from++) {
        for (let to = 0; to < trackCount; to++) {
          if (from === to) continue; // Skip no-op

          const state = createMultiTrackState(trackCount);
          const originalIds = getTrackIds(state);
          const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: from, toIndex: to });

          // The moved track should be at the target position
          expect(result.tracks[to].id).toBe(originalIds[from]);

          // All tracks should still be present
          expect(new Set(getTrackIds(result))).toEqual(new Set(originalIds));
        }
      }
    });

    it('should maintain relative order of non-moved tracks', () => {
      const state = createMultiTrackState(5);
      // Move track-2 from index 2 to index 4
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 2, toIndex: 4 });

      // Original: [0, 1, 2, 3, 4]
      // After: [0, 1, 3, 4, 2]
      // Non-moved tracks [0, 1, 3, 4] should maintain their relative order
      const nonMovedTracks = result.tracks.filter(t => t.id !== 'track-2');
      expect(nonMovedTracks.map(t => t.id)).toEqual(['track-0', 'track-1', 'track-3', 'track-4']);
    });
  });

  describe('chained operations (covers track-reorder-comprehensive.spec.ts)', () => {
    it('should handle multiple consecutive reorders correctly', () => {
      let state = createMultiTrackState(4);

      // Perform a series of reorders
      state = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 3 }); // [1,2,3,0]
      expect(getTrackIds(state)).toEqual(['track-1', 'track-2', 'track-3', 'track-0']);

      state = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 2, toIndex: 0 }); // [3,1,2,0]
      expect(getTrackIds(state)).toEqual(['track-3', 'track-1', 'track-2', 'track-0']);

      state = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 3, toIndex: 1 }); // [3,0,1,2]
      expect(getTrackIds(state)).toEqual(['track-3', 'track-0', 'track-1', 'track-2']);
    });

    it('should allow reverting to original order through reverse operations', () => {
      const state = createMultiTrackState(4);
      const originalOrder = getTrackIds(state);

      // Move track 0 to position 3
      let result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 3 });
      expect(getTrackIds(result)).not.toEqual(originalOrder);

      // Move it back: track-0 is now at index 3, move it to index 0
      result = gridReducer(result, { type: 'REORDER_TRACKS', fromIndex: 3, toIndex: 0 });
      expect(getTrackIds(result)).toEqual(originalOrder);
    });

    it('should handle rotation pattern (shift all tracks)', () => {
      let state = createMultiTrackState(5);

      // Rotate all tracks by moving last to first 5 times should restore original
      for (let i = 0; i < 5; i++) {
        state = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 4, toIndex: 0 });
      }

      expect(getTrackIds(state)).toEqual([
        'track-0', 'track-1', 'track-2', 'track-3', 'track-4',
      ]);
    });
  });

  describe('stress testing (covers rapid operations from E2E)', () => {
    it('should handle 50 rapid consecutive reorders without data loss', () => {
      const trackCount = 8;
      let state = createMultiTrackState(trackCount);
      const originalIds = new Set(getTrackIds(state));

      // Perform 50 random-like reorders
      for (let i = 0; i < 50; i++) {
        const from = i % trackCount;
        const to = (i * 3 + 1) % trackCount;
        if (from !== to) {
          state = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: from, toIndex: to });
        }
      }

      // All tracks should still be present
      expect(state.tracks.length).toBe(trackCount);
      expect(new Set(getTrackIds(state))).toEqual(originalIds);
    });
  });
});
