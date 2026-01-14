import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  applyMutation,
  createInitialState,
  createDefaultTrack,
} from './state-mutations';
import type { SessionState } from './state';

/**
 * Get the playable range from the manifest file
 * This is what the audio engine uses, not the UI INSTRUMENT_RANGES
 */
function getManifestPlayableRange(instrumentId: string): { min: number; max: number } | null {
  const basePath = path.join(__dirname, '../../public/instruments');
  const manifestPath = path.join(basePath, instrumentId, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    return manifest.playableRange || null;
  } catch {
    return null;
  }
}

/**
 * Check if a MIDI note is in the instrument's playable range
 * Uses manifest's playableRange (what audio engine uses for silent skip)
 */
function isInPlayableRange(midiNote: number, instrumentId: string): boolean {
  const range = getManifestPlayableRange(instrumentId);
  if (!range) {
    // No range defined = all notes allowed
    return true;
  }
  return midiNote >= range.min && midiNote <= range.max;
}

/**
 * Copy/Paste Range Relationship Tests
 *
 * Tests the behavior when copying steps between tracks with different
 * playable ranges. This covers the "silent failure" bug where notes
 * copied to a track with a smaller range are silently skipped at playback.
 *
 * Range Relationships Tested:
 * 1. Same range (source === destination)
 * 2. Destination includes source (source ⊂ destination)
 * 3. Source includes destination (destination ⊂ source)
 * 4. Ranges overlap (source ∩ destination ≠ ∅, neither is subset)
 * 5. Ranges are disjoint (source ∩ destination = ∅)
 */

/**
 * Helper to create a state with two tracks
 */
function createTestState(
  sourceInstrument: string,
  destInstrument: string
): SessionState {
  const state = createInitialState();
  const sourceTrack = createDefaultTrack('source', sourceInstrument, 'Source');
  const destTrack = createDefaultTrack('dest', destInstrument, 'Destination');
  return {
    ...state,
    tracks: [sourceTrack, destTrack],
  };
}

/**
 * Helper to check how many steps would be audible after copy/paste
 * Uses manifest playableRange which is what the audio engine checks
 */
function countAudibleSteps(
  state: SessionState,
  trackId: string
): { audible: number; silent: number; pitches: number[] } {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) return { audible: 0, silent: 0, pitches: [] };

  const audiblePitches: number[] = [];
  let silent = 0;

  const baseMidi = 60; // C4
  const transpose = track.transpose ?? 0;

  // Extract instrument ID from sampleId (e.g., 'sampled:piano' -> 'piano')
  const instrumentId = track.sampleId.replace('sampled:', '');

  for (let i = 0; i < track.steps.length; i++) {
    if (!track.steps[i]) continue;

    const pitchLock = track.parameterLocks[i]?.pitch ?? 0;
    const midiNote = baseMidi + transpose + pitchLock;

    if (isInPlayableRange(midiNote, instrumentId)) {
      audiblePitches.push(pitchLock);
    } else {
      silent++;
    }
  }

  return { audible: audiblePitches.length, silent, pitches: audiblePitches };
}

/**
 * Helper to set up steps with specific pitch locks on source track
 */
function setupSourceSteps(
  state: SessionState,
  pitches: number[]
): SessionState {
  let result = state;

  // Enable steps and set pitch locks
  for (let i = 0; i < pitches.length; i++) {
    // Toggle step on
    result = applyMutation(result, {
      type: 'toggle_step',
      trackId: 'source',
      step: i,
    });

    // Set pitch lock
    result = applyMutation(result, {
      type: 'set_parameter_lock',
      trackId: 'source',
      step: i,
      lock: { pitch: pitches[i] },
    });
  }

  return result;
}

/**
 * Helper to copy from source to destination
 */
function copySourceToDest(state: SessionState): SessionState {
  return applyMutation(state, {
    type: 'copy_sequence',
    fromTrackId: 'source',
    toTrackId: 'dest',
  });
}

describe('Copy/Paste Playable Range Relationships', () => {
  describe('Same Instrument (Baseline)', () => {
    it('should preserve all notes when copying within same instrument', () => {
      const state = createTestState('sampled:piano', 'sampled:piano');
      const pitches = [-12, -6, 0, 6, 12];

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      expect(result.audible).toBe(5);
      expect(result.silent).toBe(0);
      expect(result.pitches).toEqual(pitches);
    });
  });

  describe('Destination Includes Source (superset)', () => {
    it('should preserve all notes when destination range is larger', () => {
      // Piano: 30-78, Finger Bass: 18-66
      // Notes at C4 (60) with small offsets should work in both
      const state = createTestState('sampled:finger-bass', 'sampled:piano');
      const pitches = [-6, -3, 0, 3, 6]; // All within finger-bass range

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // All should be audible since piano range includes these notes
      expect(result.audible).toBe(5);
      expect(result.silent).toBe(0);
    });
  });

  describe('Source Includes Destination (subset)', () => {
    it('should lose notes when destination range is smaller', () => {
      // Piano range: 30-78, allows pitches -30 to +18 from base 60
      // 808-kick range: 24-73, allows pitches -36 to +13 from base 60
      const state = createTestState('sampled:piano', 'sampled:808-kick');

      // Test pitches that push the boundaries
      // 808-kick max is 73, so pitch +14 or higher (60+14=74) will fail
      const pitches = [-24, -12, 0, 14, 24]; // -24, -12, 0 work; 14, 24 fail

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // 808-kick allows MIDI 24-73
      // -24 (36): OK, -12 (48): OK, 0 (60): OK, 14 (74): FAIL, 24 (84): FAIL
      expect(result.audible).toBe(3);
      expect(result.silent).toBe(2);
    });

    it('should document which notes become silent', () => {
      const state = createTestState('sampled:piano', 'sampled:808-kick');
      const pitches = [-24, -12, 0, 14, 24];

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // Record the behavior for documentation
      console.log('Copy piano → 808-kick:');
      console.log(`  808-kick playableRange: 24-73`);
      console.log(`  Audible: ${result.audible} notes (pitches: ${result.pitches.join(', ')})`);
      console.log(`  Silent: ${result.silent} notes`);

      expect(result.audible).toBe(3);
      expect(result.silent).toBe(2);
    });
  });

  describe('Overlapping Ranges', () => {
    it('should partially preserve notes when ranges overlap', () => {
      // Vibraphone: 42-90 (playableRange)
      // Finger Bass: 18-66 (playableRange)
      // Overlap: 42-66
      const state = createTestState('sampled:vibraphone', 'sampled:finger-bass');

      // Vibraphone range centered on 60 allows -18 to +30
      // But finger-bass only allows 18-66, so -42 to +6 from base 60
      // Overlap is roughly -18 to +6

      // Choose pitches that span across the overlap boundary
      const pitches = [-12, -6, 0, 6, 12, 18, 24]; // Mix of in/out

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // Finger-bass has range 18-66, base 60
      // Valid pitches: -42 to +6
      // From our list: -12, -6, 0, 6 should work; 12, 18, 24 should fail
      expect(result.audible).toBeGreaterThan(0);
      expect(result.silent).toBeGreaterThan(0);
    });
  });

  describe('Extreme Range Mismatch', () => {
    it('should lose notes at extreme pitches that exceed destination range', () => {
      // Steel drums: 54-89, allows pitches -6 to +29 from base 60
      // Finger-bass: 18-66, allows pitches -42 to +6 from base 60
      // Use steel-drums as source with HIGH pitches
      const state = createTestState('sampled:steel-drums', 'sampled:finger-bass');

      // High pitches that steel-drums supports but finger-bass doesn't
      // Finger-bass max is 66, so pitch +7 or higher (60+7=67) will fail
      const pitches = [0, 6, 12, 18, 24]; // 0, 6 work; 12, 18, 24 fail

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // Finger-bass allows MIDI 18-66
      // 0 (60): OK, 6 (66): OK, 12 (72): FAIL, 18 (78): FAIL, 24 (84): FAIL
      expect(result.audible).toBe(2);
      expect(result.silent).toBe(3);
    });

    it('should document the silent failure behavior', () => {
      const state = createTestState('sampled:steel-drums', 'sampled:finger-bass');
      const pitches = [0, 6, 12, 18, 24];

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // This is the "silent failure" case - steps appear active but produce no sound
      console.log('Copy steel-drums → finger-bass (high pitches):');
      console.log(`  Finger-bass playableRange: 18-66`);
      console.log(`  Audible: ${result.audible} notes (${result.pitches.join(', ')})`);
      console.log(`  Silent: ${result.silent} notes will be SILENT`);
      console.log(`  Steps appear active but produce no sound`);

      expect(result.audible).toBe(2);
      expect(result.silent).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty steps correctly', () => {
      const state = createTestState('sampled:piano', 'sampled:finger-bass');
      // No steps set up
      const afterCopy = copySourceToDest(state);

      const result = countAudibleSteps(afterCopy, 'dest');
      expect(result.audible).toBe(0);
      expect(result.silent).toBe(0);
    });

    it('should handle zero pitch offset (base note only)', () => {
      const state = createTestState('sampled:piano', 'sampled:finger-bass');
      const pitches = [0]; // Just the base note

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // Base note C4 (60) should be in range for finger-bass (18-66)
      expect(result.audible).toBe(1);
      expect(result.silent).toBe(0);
    });

    it('should handle maximum pitch offset', () => {
      const state = createTestState('sampled:piano', 'sampled:finger-bass');
      const pitches = [24]; // Maximum positive offset

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      const result = countAudibleSteps(afterCopy, 'dest');

      // 60 + 24 = 84, finger-bass max is 66
      expect(result.silent).toBe(1);
      expect(result.audible).toBe(0);
    });

    it('should handle transpose in combination with pitch lock', () => {
      let state = createTestState('sampled:piano', 'sampled:finger-bass');

      // Set transpose on source track
      state = applyMutation(state, {
        type: 'set_track_transpose',
        trackId: 'source',
        transpose: 12, // One octave up
      });

      const pitches = [0, 6, 12]; // These will be 72, 78, 84 with transpose

      const withSteps = setupSourceSteps(state, pitches);
      const afterCopy = copySourceToDest(withSteps);

      // Note: copy_sequence copies steps and parameterLocks but NOT transpose
      // So destination track has transpose=0
      // The copied notes will be at 60+0, 60+6, 60+12 = 60, 66, 72
      // Finger-bass range is 18-66, so 72 is out of range

      const result = countAudibleSteps(afterCopy, 'dest');
      expect(result.audible).toBe(2); // 60, 66 are in range
      expect(result.silent).toBe(1); // 72 is out of range
    });
  });

  describe('Range Verification', () => {
    it('should correctly calculate ranges for test instruments', () => {
      // Verify our test assumptions about manifest playable ranges
      const pianoRange = getManifestPlayableRange('piano');
      expect(pianoRange).not.toBeNull();
      expect(pianoRange!.min).toBe(30);
      expect(pianoRange!.max).toBe(78);

      const fingerBassRange = getManifestPlayableRange('finger-bass');
      expect(fingerBassRange).not.toBeNull();
      expect(fingerBassRange!.min).toBe(18);
      expect(fingerBassRange!.max).toBe(66);

      const kickRange = getManifestPlayableRange('808-kick');
      expect(kickRange).not.toBeNull();
      expect(kickRange!.min).toBe(24);
      expect(kickRange!.max).toBe(73);

      const steelDrumsRange = getManifestPlayableRange('steel-drums');
      expect(steelDrumsRange).not.toBeNull();
      expect(steelDrumsRange!.min).toBe(54);
      expect(steelDrumsRange!.max).toBe(89);

      const vibesRange = getManifestPlayableRange('vibraphone');
      expect(vibesRange).not.toBeNull();
      expect(vibesRange!.min).toBe(42);
      expect(vibesRange!.max).toBe(90);
    });
  });
});

describe('Copy/Paste Behavior Documentation', () => {
  it('documents the current copy/paste behavior', () => {
    /**
     * CURRENT BEHAVIOR (as of this test):
     *
     * 1. Copy/paste copies steps and parameterLocks VERBATIM
     * 2. No transformation or clamping is applied
     * 3. Out-of-range notes are SILENTLY skipped at playback
     * 4. UI shows visual warnings for out-of-range steps
     *
     * WHEN RANGES DON'T MATCH:
     * - User copies Track A (piano) to Track B (808-kick)
     * - Piano has wide range, 808-kick has narrow range
     * - High-pitched notes copied to 808-kick will be silent
     * - Steps appear active but produce no sound
     *
     * VISUAL FEEDBACK:
     * - TrackRow shows out-of-range warnings via rangeWarnings
     * - Steps have 'out-of-range' CSS class
     * - ParameterLockEditor shows warning when pitch is out of range
     *
     * NO AUTOMATIC CLAMPING because:
     * - Would change the musical content without user consent
     * - Better to show warnings and let user decide
     * - User might want to change the destination instrument
     */
    expect(true).toBe(true); // Documentation test
  });
});
