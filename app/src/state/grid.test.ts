import { describe, it, expect } from 'vitest';
import type { Track } from '../types';
import { MAX_STEPS, STEPS_PER_PAGE, MAX_TRACKS } from '../types';

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
    playbackMode: 'oneshot',
    transpose: 0,
    stepCount: STEPS_PER_PAGE,
    ...overrides,
  };
}

/**
 * Simulates the reducer's SET_TRACK_STEP_COUNT action
 */
function setTrackStepCount(track: Track, stepCount: number): Track {
  return {
    ...track,
    stepCount: Math.max(1, Math.min(MAX_STEPS, stepCount)),
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
    playbackMode: track.playbackMode ?? 'oneshot',
    transpose: track.transpose ?? 0,
    stepCount: track.stepCount ?? STEPS_PER_PAGE,
  };
}

describe('Track Step Count Configuration', () => {
  describe('MAX_STEPS constant', () => {
    it('should be 64 as per spec', () => {
      expect(MAX_STEPS).toBe(64);
    });

    it('STEPS_PER_PAGE should be 16 (one bar)', () => {
      expect(STEPS_PER_PAGE).toBe(16);
    });
  });

  describe('Track array sizes', () => {
    it('steps array should always have MAX_STEPS (64) slots', () => {
      const track = createTestTrack();
      expect(track.steps.length).toBe(64);
    });

    it('parameterLocks array should always have MAX_STEPS (64) slots', () => {
      const track = createTestTrack();
      expect(track.parameterLocks.length).toBe(64);
    });

    it('can toggle step at index 63 (last possible step)', () => {
      const track = createTestTrack();
      const toggled = toggleStep(track, 63);
      expect(toggled.steps[63]).toBe(true);
    });

    it('can set parameter lock at index 63', () => {
      const track = createTestTrack();
      const locked = setParameterLock(track, 63, { pitch: 5, volume: 0.5 });
      expect(locked.parameterLocks[63]).toEqual({ pitch: 5, volume: 0.5 });
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

    it('should clamp stepCount to maximum of MAX_STEPS (64)', () => {
      const track = setTrackStepCount(createTestTrack(), 100);
      expect(track.stepCount).toBe(64);

      const track2 = setTrackStepCount(createTestTrack(), 128);
      expect(track2.stepCount).toBe(64);
    });

    it('should allow non-standard step counts (e.g., 12 for triplets)', () => {
      const track = setTrackStepCount(createTestTrack(), 12);
      expect(track.stepCount).toBe(12);
    });

    it('should allow step counts 1-64 for polyrhythms', () => {
      for (let i = 1; i <= 64; i++) {
        const track = setTrackStepCount(createTestTrack(), i);
        expect(track.stepCount).toBe(i);
      }
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
        playbackMode: 'oneshot' as const,
        transpose: 0,
        // stepCount missing (old format)
      };

      const normalized = normalizeTrackFromLoad(oldTrack);

      expect(normalized.steps.length).toBe(64);
      expect(normalized.parameterLocks.length).toBe(64);
      expect(normalized.stepCount).toBe(16); // Default

      // Original steps preserved
      expect(normalized.steps[0]).toBe(true);
      expect(normalized.steps[4]).toBe(true);
      expect(normalized.steps[8]).toBe(true);
      expect(normalized.steps[12]).toBe(true);

      // Extended steps are false
      expect(normalized.steps[16]).toBe(false);
      expect(normalized.steps[63]).toBe(false);
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
        playbackMode: 'oneshot' as const,
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
      playbackMode: 'oneshot',
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
        playbackMode: 'oneshot' as const,
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
        playbackMode: 'oneshot' as const,
        transpose: 0,
        stepCount: 16,
      };

      const normalized = normalizeTrackFromLoad(newTrack);
      expect(normalized.soloed).toBe(true);
    });
  });
});
