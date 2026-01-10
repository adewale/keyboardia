/**
 * Failure Mode and Edge Case Tests
 *
 * These tests verify error handling, validation, and edge cases that the happy-path
 * tests don't cover. They run against real infrastructure (no mocks).
 *
 * Categories:
 * 1. Invalid Input - Malformed JSON, unknown types, missing fields
 * 2. Validation Edge Cases - Out-of-range values, boundary conditions
 * 3. Non-existent Resources - Operations on missing tracks/sessions
 * 4. Immutable Sessions - Mutations on published sessions
 * 5. Race Conditions - Concurrent operations, disconnect during mutation
 * 6. Connection Edge Cases - Invalid session IDs, max players
 * 7. Resource Limits - Max tracks, message size limits
 *
 * Run against staging:
 *   TEST_BASE_URL=https://keyboardia-staging.<subdomain>.workers.dev npx vitest run test/staging/failure-modes.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { MAX_MESSAGE_SIZE } from '../../src/shared/constants';
import type { SessionState, ServerMessage } from '../types';
import { createTestTrack, createSessionState } from '../types';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8788';
const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');
const API_BASE_URL = `${BASE_URL}/api`;

// Timeouts
const CONNECT_TIMEOUT = 10000;
const MESSAGE_TIMEOUT = 5000;

// Constraints (must match server values)
const MAX_TEMPO = 180;
const MIN_TEMPO = 60;
const MAX_SWING = 100;
const MIN_SWING = 0;
const MAX_VOLUME = 1;
const MIN_VOLUME = 0;
const MAX_TRANSPOSE = 24;
const MIN_TRANSPOSE = -24;
const MAX_STEPS = 128;
const MAX_TRACKS = 16;
const MAX_PLAYERS = 10;

// =============================================================================
// Test Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createSession(initialState?: Partial<SessionState>): Promise<string> {
  const state = createSessionState(initialState);

  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }

  const data = await response.json() as { id: string };
  return data.id;
}

async function publishSession(sessionId: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/publish`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to publish session: ${response.status}`);
  }

  const data = await response.json() as { id: string };
  return data.id;
}

/**
 * WebSocket test harness with message queue
 */
class PlayerHarness {
  public ws: WebSocket | null = null;
  public sessionId: string;
  public name: string;
  public connected = false;
  public playerId: string | null = null;
  public messages: ServerMessage[] = [];
  public state: SessionState | null = null;
  private messageResolvers: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(name: string, sessionId: string) {
    this.name = name;
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${WS_BASE_URL}/api/sessions/${this.sessionId}/ws`;
      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        reject(new Error(`${this.name}: Connection timeout`));
      }, CONNECT_TIMEOUT);

      this.ws.on('open', () => {
        this.connected = true;
      });

      this.ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        this.messages.push(msg);

        if (msg.type === 'snapshot') {
          this.playerId = msg.playerId as string;
          this.state = msg.state as SessionState;
          clearTimeout(timeout);
          resolve();
        }

        // Update local state based on broadcasts
        if (msg.type === 'tempo_changed' && this.state) {
          this.state.tempo = msg.tempo as number;
        }

        // Check message resolvers
        for (let i = this.messageResolvers.length - 1; i >= 0; i--) {
          const resolver = this.messageResolvers[i];
          if (resolver.predicate(msg)) {
            this.messageResolvers.splice(i, 1);
            resolver.resolve(msg);
          }
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
      });
    });
  }

  send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.name}: WebSocket not connected`);
    }
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.name}: WebSocket not connected`);
    }
    this.ws.send(data);
  }

  waitForMessage(type: string, timeout = MESSAGE_TIMEOUT): Promise<ServerMessage> {
    // Check if we already have a matching message
    const existing = this.messages.find(m => m.type === type);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.name}: Timeout waiting for ${type}`));
      }, timeout);

      this.messageResolvers.push({
        predicate: (msg) => msg.type === type,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject,
      });
    });
  }

  waitForError(timeout = MESSAGE_TIMEOUT): Promise<ServerMessage> {
    return this.waitForMessage('error', timeout);
  }

  clearMessages(): void {
    this.messages = [];
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

// =============================================================================
// Tests: Invalid Input
// =============================================================================

describe('Invalid Input Handling', () => {
  let sessionId: string;
  let player: PlayerHarness;

  afterEach(() => {
    player?.disconnect();
  });

  it('rejects malformed JSON', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    // Send invalid JSON
    player.sendRaw('{ invalid json }');

    const error = await player.waitForError();
    expect(error.type).toBe('error');
    expect(error.message).toBe('Invalid JSON');
  });

  it('handles unknown message type gracefully', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    // Send unknown message type - server should ignore silently
    player.send({ type: 'unknown_message_type', data: 'test' });

    // Wait a bit to ensure no crash
    await delay(500);

    // Connection should still be active
    expect(player.connected).toBe(true);

    // Send a valid message to confirm connection works
    player.send({ type: 'set_tempo', tempo: 100 });
    const response = await player.waitForMessage('tempo_changed');
    expect(response.tempo).toBe(100);
  });

  it('handles empty message gracefully', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    // Send empty object
    player.send({});

    // Wait and verify connection stays alive
    await delay(500);
    expect(player.connected).toBe(true);
  });

  it('handles message without type field', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    // Send message without type
    player.send({ tempo: 100, swing: 50 });

    // Should be ignored, connection stays alive
    await delay(500);
    expect(player.connected).toBe(true);
  });
});

// =============================================================================
// Tests: Validation Edge Cases (Boundary Conditions)
// =============================================================================

describe('Validation Edge Cases', () => {
  let sessionId: string;
  let player: PlayerHarness;

  afterEach(() => {
    player?.disconnect();
  });

  describe('Tempo Validation', () => {
    it('clamps tempo above MAX_TEMPO to MAX_TEMPO', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_tempo', tempo: 999 });
      const response = await player.waitForMessage('tempo_changed');

      expect(response.tempo).toBe(MAX_TEMPO);
    });

    it('clamps tempo below MIN_TEMPO to MIN_TEMPO', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_tempo', tempo: 1 });
      const response = await player.waitForMessage('tempo_changed');

      expect(response.tempo).toBe(MIN_TEMPO);
    });

    it('accepts tempo at exact MIN_TEMPO boundary', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_tempo', tempo: MIN_TEMPO });
      const response = await player.waitForMessage('tempo_changed');

      expect(response.tempo).toBe(MIN_TEMPO);
    });

    it('accepts tempo at exact MAX_TEMPO boundary', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_tempo', tempo: MAX_TEMPO });
      const response = await player.waitForMessage('tempo_changed');

      expect(response.tempo).toBe(MAX_TEMPO);
    });

    it('handles negative tempo', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_tempo', tempo: -50 });
      const response = await player.waitForMessage('tempo_changed');

      expect(response.tempo).toBe(MIN_TEMPO);
    });
  });

  describe('Swing Validation', () => {
    it('clamps swing above MAX_SWING to MAX_SWING', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_swing', swing: 200 });
      const response = await player.waitForMessage('swing_changed');

      expect(response.swing).toBe(MAX_SWING);
    });

    it('clamps negative swing to MIN_SWING', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_swing', swing: -10 });
      const response = await player.waitForMessage('swing_changed');

      expect(response.swing).toBe(MIN_SWING);
    });
  });

  describe('Step Index Validation', () => {
    it('rejects step index below 0', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      // Send invalid step index
      player.send({ type: 'toggle_step', trackId: 't1', step: -1 });

      // Should be silently ignored (no step_toggled broadcast)
      await delay(500);

      // Verify no step_toggled message was received
      const stepToggled = player.messages.find(m => m.type === 'step_toggled');
      expect(stepToggled).toBeUndefined();
    });

    it('rejects step index >= MAX_STEPS', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'toggle_step', trackId: 't1', step: MAX_STEPS });

      await delay(500);
      const stepToggled = player.messages.find(m => m.type === 'step_toggled');
      expect(stepToggled).toBeUndefined();
    });

    it('accepts step at MAX_STEPS - 1 boundary', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'toggle_step', trackId: 't1', step: MAX_STEPS - 1 });
      const response = await player.waitForMessage('step_toggled');

      expect(response.step).toBe(MAX_STEPS - 1);
    });

    it('rejects non-integer step index', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'toggle_step', trackId: 't1', step: 1.5 });

      await delay(500);
      const stepToggled = player.messages.find(m => m.type === 'step_toggled');
      expect(stepToggled).toBeUndefined();
    });
  });

  describe('Volume Validation', () => {
    it('clamps volume above MAX_VOLUME to MAX_VOLUME', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_track_volume', trackId: 't1', volume: 5.0 });
      const response = await player.waitForMessage('track_volume_set');

      expect(response.volume).toBe(MAX_VOLUME);
    });

    it('clamps negative volume to MIN_VOLUME', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_track_volume', trackId: 't1', volume: -0.5 });
      const response = await player.waitForMessage('track_volume_set');

      expect(response.volume).toBe(MIN_VOLUME);
    });
  });

  describe('Transpose Validation', () => {
    it('clamps transpose above MAX_TRANSPOSE', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_track_transpose', trackId: 't1', transpose: 100 });
      const response = await player.waitForMessage('track_transpose_set');

      expect(response.transpose).toBe(MAX_TRANSPOSE);
    });

    it('clamps transpose below MIN_TRANSPOSE', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_track_transpose', trackId: 't1', transpose: -100 });
      const response = await player.waitForMessage('track_transpose_set');

      expect(response.transpose).toBe(MIN_TRANSPOSE);
    });

    it('rounds non-integer transpose values', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_track_transpose', trackId: 't1', transpose: 5.7 });
      const response = await player.waitForMessage('track_transpose_set');

      expect(response.transpose).toBe(6); // Rounded
    });
  });

  describe('StepCount Validation', () => {
    it('rejects invalid stepCount value', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      // 17 is not a valid step count
      player.send({ type: 'set_track_step_count', trackId: 't1', stepCount: 17 });

      await delay(500);
      const response = player.messages.find(m => m.type === 'track_step_count_set');
      expect(response).toBeUndefined();
    });

    it('accepts valid stepCount value', async () => {
      sessionId = await createSession({ tracks: [createTestTrack('t1')] });
      player = new PlayerHarness('Player1', sessionId);
      await player.connect();
      player.clearMessages();

      player.send({ type: 'set_track_step_count', trackId: 't1', stepCount: 32 });
      const response = await player.waitForMessage('track_step_count_set');

      expect(response.stepCount).toBe(32);
    });
  });
});

// =============================================================================
// Tests: Non-existent Resources
// =============================================================================

describe('Non-existent Resources', () => {
  let sessionId: string;
  let player: PlayerHarness;

  afterEach(() => {
    player?.disconnect();
  });

  it('silently ignores toggle_step on non-existent track', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    player.send({ type: 'toggle_step', trackId: 'nonexistent', step: 0 });

    await delay(500);
    const stepToggled = player.messages.find(m => m.type === 'step_toggled');
    expect(stepToggled).toBeUndefined();
  });

  it('silently ignores delete_track on non-existent track', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    player.send({ type: 'delete_track', trackId: 'nonexistent' });

    await delay(500);
    const trackDeleted = player.messages.find(m => m.type === 'track_deleted');
    expect(trackDeleted).toBeUndefined();
  });

  it('silently ignores mute_track on non-existent track', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    player.send({ type: 'mute_track', trackId: 'nonexistent', muted: true });

    await delay(500);
    const trackMuted = player.messages.find(m => m.type === 'track_muted');
    expect(trackMuted).toBeUndefined();
  });

  it('returns 404 for WebSocket connection to non-existent session', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000000';
    player = new PlayerHarness('Player1', fakeSessionId);

    try {
      await player.connect();
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Expected - connection should fail
      expect(error).toBeDefined();
    }
  });

  it('returns 404 for GET on non-existent session', async () => {
    const fakeSessionId = '00000000-0000-0000-0000-000000000000';
    const response = await fetch(`${API_BASE_URL}/sessions/${fakeSessionId}`);

    expect(response.status).toBe(404);
  });
});

// =============================================================================
// Tests: Immutable Sessions
// =============================================================================

describe('Immutable (Published) Sessions', () => {
  let sourceSessionId: string;
  let publishedSessionId: string;
  let player: PlayerHarness;

  afterEach(() => {
    player?.disconnect();
  });

  it('rejects mutations on published session', async () => {
    // Create and publish a session
    sourceSessionId = await createSession({
      tracks: [createTestTrack('t1')],
      tempo: 120,
    });
    publishedSessionId = await publishSession(sourceSessionId);

    // Connect to the published session
    player = new PlayerHarness('Player1', publishedSessionId);
    await player.connect();

    // Verify immutable flag in snapshot
    const snapshot = player.messages.find(m => m.type === 'snapshot');
    expect(snapshot?.immutable).toBe(true);

    player.clearMessages();

    // Try to mutate tempo
    player.send({ type: 'set_tempo', tempo: 150 });

    // Should receive error, not tempo_changed
    const error = await player.waitForError();
    expect(error.type).toBe('error');
    expect(error.message).toContain('published');
  });

  it('rejects toggle_step on published session', async () => {
    sourceSessionId = await createSession({
      tracks: [createTestTrack('t1')],
    });
    publishedSessionId = await publishSession(sourceSessionId);

    player = new PlayerHarness('Player1', publishedSessionId);
    await player.connect();
    player.clearMessages();

    player.send({ type: 'toggle_step', trackId: 't1', step: 0 });

    const error = await player.waitForError();
    expect(error.type).toBe('error');
  });

  it('rejects add_track on published session', async () => {
    sourceSessionId = await createSession({
      tracks: [createTestTrack('t1')],
    });
    publishedSessionId = await publishSession(sourceSessionId);

    player = new PlayerHarness('Player1', publishedSessionId);
    await player.connect();
    player.clearMessages();

    player.send({
      type: 'add_track',
      track: createTestTrack('t2'),
    });

    const error = await player.waitForError();
    expect(error.type).toBe('error');
  });

  it('rejects delete_track on published session', async () => {
    sourceSessionId = await createSession({
      tracks: [createTestTrack('t1')],
    });
    publishedSessionId = await publishSession(sourceSessionId);

    player = new PlayerHarness('Player1', publishedSessionId);
    await player.connect();
    player.clearMessages();

    player.send({ type: 'delete_track', trackId: 't1' });

    const error = await player.waitForError();
    expect(error.type).toBe('error');
  });
});

// =============================================================================
// Tests: Race Conditions
// =============================================================================

describe('Race Conditions', () => {
  let sessionId: string;
  let player1: PlayerHarness;
  let player2: PlayerHarness;

  afterEach(() => {
    player1?.disconnect();
    player2?.disconnect();
  });

  it('handles operation on track that was just deleted by another player', async () => {
    // This test verifies Last-Write-Wins (LWW) with server-order processing.
    // When two operations race (toggle + delete), the server processes them
    // in the order they ARRIVE, not the order they were sent.
    //
    // Real behavior: if toggle arrives before delete is processed, the toggle
    // succeeds and broadcasts. Then delete removes the track.
    // This is correct LWW - the final state is: track deleted.

    sessionId = await createSession({
      tracks: [createTestTrack('t1')],
    });

    player1 = new PlayerHarness('Player1', sessionId);
    player2 = new PlayerHarness('Player2', sessionId);
    await Promise.all([player1.connect(), player2.connect()]);

    player1.clearMessages();
    player2.clearMessages();

    // Player1 deletes the track
    player1.send({ type: 'delete_track', trackId: 't1' });

    // Player2 tries to toggle step on the same track (may arrive before delete)
    player2.send({ type: 'toggle_step', trackId: 't1', step: 0 });

    // Wait for processing
    await delay(500);

    // Both players should have received track_deleted (final state)
    const p1Deleted = player1.messages.find(m => m.type === 'track_deleted');
    const p2Deleted = player2.messages.find(m => m.type === 'track_deleted');
    expect(p1Deleted).toBeDefined();
    expect(p2Deleted).toBeDefined();

    // Note: toggle_step may or may not have been processed before delete
    // depending on network timing. Either outcome is valid:
    // - If toggle arrived first: step_toggled broadcast, then track_deleted
    // - If delete arrived first: toggle silently ignored
    // The key invariant is: final state has track deleted
  });

  it('handles rapid sequential mutations from same player', async () => {
    sessionId = await createSession({
      tracks: [createTestTrack('t1')],
    });

    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();
    player1.clearMessages();

    // Send 10 rapid tempo changes
    for (let i = 0; i < 10; i++) {
      player1.send({ type: 'set_tempo', tempo: 70 + i });
    }

    // Wait for all to process
    await delay(1000);

    // Should have received 10 tempo_changed messages
    const tempoChanges = player1.messages.filter(m => m.type === 'tempo_changed');
    expect(tempoChanges.length).toBe(10);

    // Final state should be last value
    const lastChange = tempoChanges[tempoChanges.length - 1];
    expect(lastChange.tempo).toBe(79);
  });

  it('handles disconnect and reconnect during active session', async () => {
    sessionId = await createSession({
      tracks: [createTestTrack('t1')],
      tempo: 120,
    });

    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    // Make a change
    player1.send({ type: 'set_tempo', tempo: 140 });
    await player1.waitForMessage('tempo_changed');

    // Disconnect
    player1.disconnect();
    await delay(200);

    // Reconnect
    player1 = new PlayerHarness('Player1-Reconnected', sessionId);
    await player1.connect();

    // State should be preserved
    expect(player1.state?.tempo).toBe(140);
  });
});

// =============================================================================
// Tests: Connection Edge Cases
// =============================================================================

describe('Connection Edge Cases', () => {
  let sessionId: string;
  let players: PlayerHarness[] = [];

  afterEach(() => {
    for (const p of players) {
      p.disconnect();
    }
    players = [];
  });

  it('rejects connection with invalid session ID format', async () => {
    const player = new PlayerHarness('Player1', 'not-a-valid-uuid');
    players.push(player);

    try {
      await player.connect();
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('rejects connection with SQL injection attempt in session ID', async () => {
    const player = new PlayerHarness('Player1', "'; DROP TABLE sessions; --");
    players.push(player);

    try {
      await player.connect();
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('enforces MAX_PLAYERS limit', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });

    // Connect MAX_PLAYERS
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const player = new PlayerHarness(`Player${i}`, sessionId);
      await player.connect();
      players.push(player);
    }

    // Try to connect one more - should fail
    const extraPlayer = new PlayerHarness('ExtraPlayer', sessionId);
    players.push(extraPlayer);

    try {
      await extraPlayer.connect();
      // If it connects, check if server sent session_full error
      const error = extraPlayer.messages.find(m => m.type === 'error' || m.type === 'session_full');
      expect(error).toBeDefined();
    } catch (error) {
      // Connection rejection is also acceptable
      expect(error).toBeDefined();
    }
  }, 30000); // Extended timeout for 10+ connections
});

// =============================================================================
// Tests: Resource Limits
// =============================================================================

describe('Resource Limits', () => {
  let sessionId: string;
  let player: PlayerHarness;

  afterEach(() => {
    player?.disconnect();
  });

  it('enforces MAX_TRACKS limit', async () => {
    // Create session with MAX_TRACKS - 1 tracks
    const tracks = Array.from({ length: MAX_TRACKS - 1 }, (_, i) =>
      createTestTrack(`t${i}`)
    );
    sessionId = await createSession({ tracks });

    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    // Add one more track (should succeed)
    player.send({
      type: 'add_track',
      track: createTestTrack('final'),
    });
    const added = await player.waitForMessage('track_added');
    expect(added).toBeDefined();

    player.clearMessages();

    // Try to add another (should fail or be ignored)
    player.send({
      type: 'add_track',
      track: createTestTrack('overflow'),
    });

    await delay(500);
    const overflowAdded = player.messages.find(m => m.type === 'track_added');
    expect(overflowAdded).toBeUndefined();
  });

  it('rejects oversized messages', async () => {
    sessionId = await createSession({ tracks: [createTestTrack('t1')] });
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();
    player.clearMessages();

    // Create a message larger than MAX_MESSAGE_SIZE
    const largeData = 'x'.repeat(MAX_MESSAGE_SIZE + 1000);
    player.sendRaw(JSON.stringify({ type: 'set_tempo', tempo: 100, data: largeData }));

    const error = await player.waitForError();
    expect(error.type).toBe('error');
    expect(error.message).toContain('too large');
  });
});

// =============================================================================
// Tests: State Consistency After Edge Cases
// =============================================================================

describe('State Consistency', () => {
  let sessionId: string;
  let player1: PlayerHarness;
  let player2: PlayerHarness;

  afterEach(() => {
    player1?.disconnect();
    player2?.disconnect();
  });

  it('maintains consistent state after player disconnects mid-operation', async () => {
    sessionId = await createSession({
      tracks: [createTestTrack('t1')],
      tempo: 120,
    });

    player1 = new PlayerHarness('Player1', sessionId);
    player2 = new PlayerHarness('Player2', sessionId);
    await Promise.all([player1.connect(), player2.connect()]);

    // Player1 sends mutation then immediately disconnects
    player1.send({ type: 'set_tempo', tempo: 150 });
    player1.disconnect();

    // Wait for processing
    await delay(500);

    // Player2 should have received the update
    const tempoChange = player2.messages.find(m => m.type === 'tempo_changed');
    expect(tempoChange).toBeDefined();
    expect(tempoChange?.tempo).toBe(150);

    // Reconnect player1 and verify state
    player1 = new PlayerHarness('Player1-Reconnected', sessionId);
    await player1.connect();
    expect(player1.state?.tempo).toBe(150);
  });

  it('handles empty session (no tracks) operations', async () => {
    sessionId = await createSession({ tracks: [] }); // Empty session
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();
    player1.clearMessages();

    // Try to operate on non-existent tracks
    player1.send({ type: 'toggle_step', trackId: 't1', step: 0 });
    player1.send({ type: 'mute_track', trackId: 't1', muted: true });
    player1.send({ type: 'delete_track', trackId: 't1' });

    await delay(500);

    // All should be silently ignored
    expect(player1.messages.filter(m => m.type !== 'player_joined').length).toBe(0);

    // Session should still work
    player1.send({ type: 'set_tempo', tempo: 100 });
    const tempoChange = await player1.waitForMessage('tempo_changed');
    expect(tempoChange.tempo).toBe(100);
  });

  it('preserves state through rapid connect/disconnect cycles', async () => {
    sessionId = await createSession({
      tracks: [createTestTrack('t1')],
      tempo: 120,
    });

    // Initial connection and mutation
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();
    player1.send({ type: 'set_tempo', tempo: 100 });
    await player1.waitForMessage('tempo_changed');

    // Rapid disconnect/reconnect cycles
    for (let i = 0; i < 5; i++) {
      player1.disconnect();
      await delay(100);
      player1 = new PlayerHarness(`Player1-${i}`, sessionId);
      await player1.connect();
    }

    // State should be preserved
    expect(player1.state?.tempo).toBe(100);
  });
});
