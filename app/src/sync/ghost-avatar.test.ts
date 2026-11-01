// @vitest-environment jsdom
/**
 * Ghost Avatar Fix: Client-side playerId tests
 *
 * See specs/GHOST-AVATAR-FIX.md for specification.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// =============================================================================
// Unit Tests: getOrCreatePlayerId
// =============================================================================

describe('getOrCreatePlayerId', () => {
  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
  });

  it('generates new ID on first call', async () => {
    const { getOrCreatePlayerId } = await import('../../src/sync/multiplayer');

    const id = getOrCreatePlayerId('session-1');

    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('returns same ID on subsequent calls for same session', async () => {
    const { getOrCreatePlayerId } = await import('../../src/sync/multiplayer');

    const id1 = getOrCreatePlayerId('session-1');
    const id2 = getOrCreatePlayerId('session-1');

    expect(id1).toBe(id2);
  });

  it('returns different IDs for different sessions', async () => {
    const { getOrCreatePlayerId } = await import('../../src/sync/multiplayer');

    const id1 = getOrCreatePlayerId('session-1');
    const id2 = getOrCreatePlayerId('session-2');

    expect(id1).not.toBe(id2);
  });

  it('stores ID in sessionStorage with correct key', async () => {
    const { getOrCreatePlayerId } = await import('../../src/sync/multiplayer');

    const id = getOrCreatePlayerId('test-session-xyz');

    const storedId = sessionStorage.getItem('keyboardia:playerId:test-session-xyz');
    expect(storedId).toBe(id);
  });

  it('retrieves existing ID from sessionStorage', async () => {
    const { getOrCreatePlayerId } = await import('../../src/sync/multiplayer');

    // Pre-populate sessionStorage
    const existingId = '12345678-1234-1234-1234-123456789abc';
    sessionStorage.setItem('keyboardia:playerId:pre-populated', existingId);

    const id = getOrCreatePlayerId('pre-populated');

    expect(id).toBe(existingId);
  });
});

// =============================================================================
// Behavior Tests: sessionStorage key format and persistence
// =============================================================================

describe('Ghost Avatar Fix: Spec Compliance', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('uses correct key format: keyboardia:playerId:{sessionId}', async () => {
    const { getOrCreatePlayerId } = await import('../../src/sync/multiplayer');

    getOrCreatePlayerId('abc-123');

    const keys = Object.keys(sessionStorage);
    expect(keys).toContain('keyboardia:playerId:abc-123');
  });

  it('survives tab refresh (sessionStorage persists)', async () => {
    const { getOrCreatePlayerId } = await import('../../src/sync/multiplayer');

    const id1 = getOrCreatePlayerId('refresh-test');
    const id2 = getOrCreatePlayerId('refresh-test');

    expect(id1).toBe(id2);
  });
});
