/**
 * Hybrid Persistence Verification Tests
 *
 * Phase 27: These tests verify the hybrid persistence architecture:
 * - DO storage is written immediately on every mutation (source of truth)
 * - KV is written only when the last client disconnects
 * - Reconnecting clients receive fresh state from DO storage
 *
 * The key invariant: NO DATA LOSS on reconnection, regardless of KV state.
 *
 * Run against staging:
 *   TEST_BASE_URL=https://keyboardia-staging.adewale-883.workers.dev npx vitest run test/staging/kv-staleness.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type {
  SessionTrack,
  SessionState,
  ServerMessage,
  DebugInfo,
} from '../types';
import { createTestTrack, createSessionState } from '../types';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5173';
const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');
const API_BASE_URL = `${BASE_URL}/api`;

// =============================================================================
// Helpers
// =============================================================================

async function createSession(): Promise<string> {
  const state = createSessionState();

  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) throw new Error(`Failed to create session: ${response.status}`);
  const data = await response.json() as { id: string };
  return data.id;
}

async function getSessionFromKV(sessionId: string): Promise<SessionState> {
  // This reads from KV storage (the API GET endpoint)
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`);
  if (!response.ok) throw new Error(`Failed to get session: ${response.status}`);
  const data = await response.json() as { state: SessionState };
  return data.state;
}

// Available for debugging but not used in current tests
async function _getDebugInfo(sessionId: string): Promise<DebugInfo> {
  // This reads directly from DO memory via the live-debug endpoint
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/live-debug`);
  if (!response.ok) throw new Error(`Failed to get debug info: ${response.status}`);
  return await response.json() as DebugInfo;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Test Player - WebSocket client wrapper
// =============================================================================

class TestPlayer {
  private ws: WebSocket | null = null;
  private messageQueue: ServerMessage[] = [];
  private messageWaiters: ((msg: ServerMessage) => void)[] = [];
  public sessionState: SessionState | null = null;
  public playerId: string | null = null;
  public snapshotTimestamp: number | null = null;
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${WS_BASE_URL}/api/sessions/${this.sessionId}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        // Wait for snapshot
      });

      this.ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        if (msg.type === 'snapshot') {
          this.sessionState = msg.state;
          this.playerId = msg.playerId;
          this.snapshotTimestamp = msg.snapshotTimestamp ?? null;
          resolve();
        } else {
          // Track state updates
          if (msg.type === 'step_toggled' && this.sessionState) {
            const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
            if (track) {
              track.steps[msg.step] = msg.value;
            }
          } else if (msg.type === 'track_added' && this.sessionState) {
            this.sessionState.tracks.push(msg.track);
          }
        }

        // Notify waiters
        const waiter = this.messageWaiters.shift();
        if (waiter) {
          waiter(msg);
        } else {
          this.messageQueue.push(msg);
        }
      });

      this.ws.on('error', reject);

      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async waitForMessage(): Promise<ServerMessage> {
    const queued = this.messageQueue.shift();
    if (queued) return queued;

    return new Promise(resolve => {
      this.messageWaiters.push(resolve);
    });
  }

  async addTrack(track: SessionTrack): Promise<void> {
    this.send({ type: 'add_track', track });
    await this.waitForMessage(); // Wait for track_added
  }

  async toggleStep(trackId: string, step: number): Promise<void> {
    this.send({ type: 'toggle_step', trackId, step });
    await this.waitForMessage(); // Wait for step_toggled
  }
}

// Track active players for cleanup
const activePlayers: TestPlayer[] = [];

afterEach(() => {
  for (const player of activePlayers) {
    player.disconnect();
  }
  activePlayers.length = 0;
});

// =============================================================================
// Tests - Hybrid Persistence Verification
// =============================================================================

describe('Hybrid Persistence - Phase 27', () => {

  it('DO storage preserves state across reconnection (no data loss)', async () => {
    // This is the PRIMARY test - verifies no data loss on reconnection
    const sessionId = await createSession();

    // Player 1 connects and makes changes
    const player1 = new TestPlayer(sessionId);
    activePlayers.push(player1);
    await player1.connect();

    const trackId = `reconnect-test-${Date.now()}`;
    await player1.addTrack(createTestTrack(trackId));

    // Toggle 8 steps
    for (let step = 0; step < 8; step++) {
      await player1.toggleStep(trackId, step);
    }

    // Brief delay to ensure all broadcasts are processed
    await delay(100);

    const expectedActiveCount = player1.sessionState!.tracks[0]?.steps.filter(s => s).length ?? 0;
    console.log(`[Player1] Made ${expectedActiveCount} active steps`);

    // Disconnect - this triggers DO to flush to KV (last client)
    player1.disconnect();

    // Brief delay for disconnect to propagate
    await delay(500);

    // Player 2 connects - should see same state from DO storage
    const player2 = new TestPlayer(sessionId);
    activePlayers.push(player2);
    await player2.connect();

    const reconnectActiveCount = player2.sessionState!.tracks[0]?.steps.filter(s => s).length ?? 0;
    const reconnectTrackCount = player2.sessionState!.tracks.length;

    console.log(`[Player2] Received ${reconnectActiveCount} active steps in ${reconnectTrackCount} tracks`);

    // THE KEY INVARIANT: No data loss
    expect(reconnectTrackCount).toBe(1);
    expect(reconnectActiveCount).toBe(expectedActiveCount);
  });

  it('KV is intentionally stale during active sessions (hybrid design)', async () => {
    // This test VERIFIES that KV is not updated during active sessions
    // (This is expected behavior, not a bug)
    const sessionId = await createSession();
    const player = new TestPlayer(sessionId);
    activePlayers.push(player);
    await player.connect();

    // Make changes
    const trackId = `stale-kv-test-${Date.now()}`;
    await player.addTrack(createTestTrack(trackId));

    for (let step = 0; step < 4; step++) {
      await player.toggleStep(trackId, step);
    }

    // Give broadcasts time to process
    await delay(300);

    // Verify player session has the changes (reflects DO state)
    expect(player.sessionState!.tracks.length).toBe(1);
    const activeSteps = player.sessionState!.tracks[0]?.steps.filter(s => s).length ?? 0;
    console.log(`[Player State] tracks: 1, active steps: ${activeSteps}`);

    // Check KV state - it SHOULD be stale (this is expected!)
    const kvState = await getSessionFromKV(sessionId);
    console.log(`[KV State] tracks: ${kvState.tracks.length} (expected: 0 - intentionally stale)`);

    // KV should NOT have the changes yet (hybrid design)
    // This is NOT a bug - it's the expected behavior
    expect(kvState.tracks.length).toBe(0);
  });

  it('KV is updated when last client disconnects', async () => {
    const sessionId = await createSession();
    const player = new TestPlayer(sessionId);
    activePlayers.push(player);
    await player.connect();

    // Make changes
    const trackId = `disconnect-flush-${Date.now()}`;
    await player.addTrack(createTestTrack(trackId));
    await player.toggleStep(trackId, 0);
    await player.toggleStep(trackId, 4);

    // Verify KV is stale before disconnect
    const kvBeforeDisconnect = await getSessionFromKV(sessionId);
    expect(kvBeforeDisconnect.tracks.length).toBe(0);
    console.log(`[Before Disconnect] KV tracks: ${kvBeforeDisconnect.tracks.length}`);

    // Disconnect - this triggers KV flush
    player.disconnect();

    // Wait for disconnect to propagate and KV write to complete
    await delay(1000);

    // KV should now be updated
    const kvAfterDisconnect = await getSessionFromKV(sessionId);
    console.log(`[After Disconnect] KV tracks: ${kvAfterDisconnect.tracks.length}`);

    expect(kvAfterDisconnect.tracks.length).toBe(1);
    const kvActiveSteps = kvAfterDisconnect.tracks[0]?.steps.filter(s => s).length ?? 0;
    expect(kvActiveSteps).toBe(2); // Steps 0 and 4
  });

  it('KV stays stale while any client is connected', async () => {
    const sessionId = await createSession();

    // Player 1 connects and makes changes
    const player1 = new TestPlayer(sessionId);
    activePlayers.push(player1);
    await player1.connect();

    const trackId = `multi-client-${Date.now()}`;
    await player1.addTrack(createTestTrack(trackId));

    // Player 2 connects
    const player2 = new TestPlayer(sessionId);
    activePlayers.push(player2);
    await player2.connect();

    // Player 2 should see the track (via snapshot)
    expect(player2.sessionState!.tracks.length).toBe(1);
    console.log(`[Player2] Sees ${player2.sessionState!.tracks.length} tracks`);

    // Disconnect player 1 - but player 2 is still connected
    player1.disconnect();
    await delay(500);

    // KV should STILL be stale (player 2 is connected)
    const kvState = await getSessionFromKV(sessionId);
    console.log(`[After Player1 Disconnect] KV tracks: ${kvState.tracks.length} (should be stale)`);
    expect(kvState.tracks.length).toBe(0); // Still stale

    // Now disconnect player 2 (last client)
    player2.disconnect();
    await delay(1000);

    // NOW KV should be updated
    const kvFinal = await getSessionFromKV(sessionId);
    console.log(`[After All Disconnect] KV tracks: ${kvFinal.tracks.length}`);
    expect(kvFinal.tracks.length).toBe(1);
  });

  it('rapid mutations are all persisted to DO storage', async () => {
    // Verify that rapid mutations don't get lost
    const sessionId = await createSession();
    const player = new TestPlayer(sessionId);
    activePlayers.push(player);
    await player.connect();

    // Add 5 tracks rapidly
    const trackIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const trackId = `rapid-${Date.now()}-${i}`;
      trackIds.push(trackId);
      await player.addTrack(createTestTrack(trackId));
    }

    // Toggle steps on each track
    for (const trackId of trackIds) {
      await player.toggleStep(trackId, 0);
      await player.toggleStep(trackId, 4);
      await player.toggleStep(trackId, 8);
    }

    // Brief delay to ensure all broadcasts processed
    await delay(100);

    // Verify player state has all changes (reflects DO state via broadcasts)
    console.log(`[Player State] ${player.sessionState!.tracks.length} tracks`);
    expect(player.sessionState!.tracks.length).toBe(5);

    // Count active steps
    const totalActiveSteps = player.sessionState!.tracks.reduce(
      (sum, t) => sum + t.steps.filter(s => s).length, 0
    );
    console.log(`[Active Steps] ${totalActiveSteps}`);
    expect(totalActiveSteps).toBe(15); // 5 tracks × 3 steps each

    // Disconnect and verify reconnection preserves all
    player.disconnect();
    await delay(500);

    const player2 = new TestPlayer(sessionId);
    activePlayers.push(player2);
    await player2.connect();

    expect(player2.sessionState!.tracks.length).toBe(5);
    const reconnectSteps = player2.sessionState!.tracks.reduce(
      (sum, t) => sum + t.steps.filter(s => s).length, 0
    );
    expect(reconnectSteps).toBe(15);
    console.log(`[Reconnect] ${reconnectSteps} active steps preserved`);
  });

});
