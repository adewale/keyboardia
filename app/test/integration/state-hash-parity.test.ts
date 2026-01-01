/**
 * Integration tests for State Hash Parity
 *
 * These tests verify that client and server produce identical hashes
 * for the same state, preventing the state hash mismatch bug.
 *
 * Bug context: Client had Track with optional fields (soloed?: boolean),
 * server had SessionTrack with required fields (soloed: boolean).
 * JSON.stringify produced different output, causing hash mismatches.
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 14
 * @see docs/BUG-PATTERNS.md - Serialization Boundary Mismatch
 */

import { SELF } from 'cloudflare:test';
import { it, expect, describe } from 'vitest';
import { canonicalizeForHash, hashState } from '../../src/sync/canonicalHash';

// Import server-side canonicalization for comparison
// Note: This import works because we're in the Cloudflare test environment
import { canonicalizeForHash as serverCanonicalizeForHash, hashState as serverHashState } from '../../src/worker/logging';

interface SessionResponse {
  id: string;
  tracks: Array<{
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    parameterLocks: (unknown | null)[];
    volume: number;
    muted: boolean;
    soloed?: boolean;
    transpose: number;
    stepCount?: number;
  }>;
  tempo: number;
  swing: number;
}

describe('State Hash Parity: Client/Server Match', () => {
  /**
   * Test that client and server hash functions produce identical output
   * for the same normalized state.
   */
  it('client and server produce identical hash for same state', () => {
    const state = {
      tracks: [
        {
          id: 'track-1',
          name: 'Kick',
          sampleId: 'kick',
          steps: [true, false, false, false, true, false, false, false],
          parameterLocks: Array(8).fill(null),
          volume: 0.8,
          muted: false,
          soloed: false,
          transpose: 0,
          stepCount: 8,
        },
      ],
      tempo: 120,
      swing: 0,
    };

    const clientCanonical = canonicalizeForHash(state);
    const serverCanonical = serverCanonicalizeForHash(state);

    // Canonical forms should be identical
    expect(JSON.stringify(clientCanonical)).toBe(JSON.stringify(serverCanonical));

    // Hashes should be identical
    const clientHash = hashState(clientCanonical);
    const serverHash = serverHashState(serverCanonical);
    expect(clientHash).toBe(serverHash);
  });

  /**
   * Test that optional fields with undefined values are normalized consistently.
   * This was the root cause of the hash mismatch bug.
   */
  it('handles undefined optional fields consistently', () => {
    // Client state with undefined optional fields
    const clientState = {
      tracks: [
        {
          id: 'track-1',
          name: 'Test',
          sampleId: 'kick',
          steps: [true, false],
          parameterLocks: [null, null],
          volume: 1,
          muted: false,
          // soloed: undefined (missing)
          transpose: 0,
          // stepCount: undefined (missing)
        },
      ],
      tempo: 120,
      swing: 0,
    };

    // Server state with explicit defaults
    const serverState = {
      tracks: [
        {
          id: 'track-1',
          name: 'Test',
          sampleId: 'kick',
          steps: [true, false],
          parameterLocks: [null, null],
          volume: 1,
          muted: false,
          soloed: false, // explicit false
          transpose: 0,
          stepCount: 16, // explicit default
        },
      ],
      tempo: 120,
      swing: 0,
    };

    // After canonicalization, both should produce identical output
    const clientCanonical = canonicalizeForHash(clientState as Parameters<typeof canonicalizeForHash>[0]);
    const serverCanonical = serverCanonicalizeForHash(serverState);

    expect(JSON.stringify(clientCanonical)).toBe(JSON.stringify(serverCanonical));
    expect(hashState(clientCanonical)).toBe(serverHashState(serverCanonical));
  });

  /**
   * Test that array length normalization works correctly.
   */
  it('normalizes array lengths to stepCount', () => {
    // State with mismatched array lengths
    const state = {
      tracks: [
        {
          id: 'track-1',
          name: 'Test',
          sampleId: 'kick',
          steps: [true, false, true], // 3 elements
          parameterLocks: [null], // 1 element
          volume: 1,
          muted: false,
          soloed: false,
          transpose: 0,
          stepCount: 4, // normalize to 4
        },
      ],
      tempo: 120,
      swing: 0,
    };

    const clientCanonical = canonicalizeForHash(state);
    const serverCanonical = serverCanonicalizeForHash(state);

    // Both should normalize to 4 elements
    expect(clientCanonical.tracks[0].steps).toHaveLength(4);
    expect(clientCanonical.tracks[0].parameterLocks).toHaveLength(4);
    expect(serverCanonical.tracks[0].steps).toHaveLength(4);
    expect(serverCanonical.tracks[0].parameterLocks).toHaveLength(4);

    // And produce identical hashes
    expect(hashState(clientCanonical)).toBe(serverHashState(serverCanonical));
  });
});

describe('State Hash Parity: Round-Trip via API', () => {
  /**
   * Test that state survives a round-trip through the API without hash changes.
   * This is the integration test that would have caught the original bug.
   */
  it('hash remains consistent after API round-trip', async () => {
    // Create a session with specific state
    const originalState = {
      tracks: [
        {
          id: 'hash-test-track',
          name: 'Hash Test',
          sampleId: 'kick',
          steps: [true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
          parameterLocks: Array(16).fill(null),
          volume: 0.75,
          muted: false,
          soloed: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 128,
      swing: 10,
      version: 1,
    };

    // Create session via API - API expects state wrapped in 'state' field
    const createResponse = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: originalState }),
    });

    expect(createResponse.status).toBe(201);
    const createData = await createResponse.json() as { id: string };
    const sessionId = createData.id;

    // Compute client-side hash of original state
    const clientHash = hashState(canonicalizeForHash(originalState));

    // Fetch session back from API
    const getResponse = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
    expect(getResponse.status).toBe(200);
    const serverResponse = await getResponse.json() as { state: SessionResponse };

    // Compute hash of state returned by server
    const serverHash = hashState(canonicalizeForHash({
      tracks: serverResponse.state.tracks,
      tempo: serverResponse.state.tempo,
      swing: serverResponse.state.swing,
    }));

    // Hashes should match
    expect(serverHash).toBe(clientHash);
  });

  /**
   * Test that modifying state and re-fetching maintains hash consistency.
   */
  it('hash remains consistent after state modification via API', async () => {
    // Create initial session - API expects state wrapped in 'state' field
    const createResponse = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          tracks: [
            {
              id: 'mod-test-track',
              name: 'Mod Test',
              sampleId: 'snare',
              steps: Array(16).fill(false),
              parameterLocks: Array(16).fill(null),
              volume: 1,
              muted: false,
              soloed: false,
              transpose: 0,
              stepCount: 16,
            },
          ],
          tempo: 120,
          swing: 0,
          version: 1,
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const { id: sessionId } = await createResponse.json() as { id: string };

    // Modify the session (toggle a step) - use PUT for state updates
    const newSteps = Array(16).fill(false);
    newSteps[0] = true;
    newSteps[4] = true;

    const updateResponse = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          tracks: [
            {
              id: 'mod-test-track',
              name: 'Mod Test',
              sampleId: 'snare',
              steps: newSteps,
              parameterLocks: Array(16).fill(null),
              volume: 1,
              muted: false,
              soloed: false,
              transpose: 0,
              stepCount: 16,
            },
          ],
          tempo: 120,
          swing: 0,
          version: 1,
        },
      }),
    });

    expect(updateResponse.status).toBe(200);

    // Fetch updated state
    const getResponse = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
    const serverResponse = await getResponse.json() as { state: SessionResponse };

    // Compute expected hash (client side)
    const expectedState = {
      tracks: [
        {
          id: 'mod-test-track',
          name: 'Mod Test',
          sampleId: 'snare',
          steps: newSteps,
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          soloed: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
    };

    const clientHash = hashState(canonicalizeForHash(expectedState));
    const serverHash = hashState(canonicalizeForHash({
      tracks: serverResponse.state.tracks,
      tempo: serverResponse.state.tempo,
      swing: serverResponse.state.swing,
    }));

    expect(serverHash).toBe(clientHash);
  });
});
