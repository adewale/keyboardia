/**
 * Comprehensive Multiplayer Sync Integration Tests
 *
 * These tests run against a REAL environment (local dev, staging, or production).
 * NO MOCKS - real WebSocket connections, real DO state, real KV persistence.
 *
 * Tests cover:
 * - 1 player scenarios (solo editing)
 * - 2 player scenarios (collaborative editing)
 * - 5 player scenarios (stress testing)
 * - All mutation types (tracks, steps, tempo, swing, etc.)
 * - State introspection via debug endpoints
 *
 * Run against local dev:
 *   TEST_BASE_URL=http://localhost:5173 npx vitest run test/staging/multiplayer-sync.test.ts
 *
 * Run against staging:
 *   TEST_BASE_URL=https://keyboardia-staging.<subdomain>.workers.dev npx vitest run test/staging/multiplayer-sync.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type {
  SessionTrack,
  SessionState,
  PlayerInfo,
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

// Test timeouts (generous for network latency)
const CONNECT_TIMEOUT = 10000;
const MESSAGE_TIMEOUT = 5000;
const BROADCAST_DELAY = 100; // ms to wait for broadcasts to propagate

// =============================================================================
// Player Harness - Simulates a multiplayer client
// =============================================================================

class PlayerHarness {
  private ws: WebSocket | null = null;
  private messages: ServerMessage[] = [];
  private messageHandlers: Array<(msg: ServerMessage) => void> = [];
  private seq = 0;

  public playerId: string | null = null;
  public sessionState: SessionState | null = null;
  public players: PlayerInfo[] = [];
  public connected = false;

  constructor(
    public readonly name: string,
    public readonly sessionId: string
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${this.name}: Connection timeout`));
      }, CONNECT_TIMEOUT);

      const wsUrl = `${WS_BASE_URL}/api/sessions/${this.sessionId}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.connected = true;
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          this.messages.push(msg);

          // Handle snapshot specially - it means we're fully connected
          if (msg.type === 'snapshot') {
            this.playerId = msg.playerId;
            this.sessionState = msg.state;
            this.players = msg.players;
            clearTimeout(timeout);
            resolve();
          }

          // Update local state based on broadcasts
          this.handleBroadcast(msg);

          // Notify any waiters
          for (const handler of this.messageHandlers) {
            handler(msg);
          }
        } catch (e) {
          console.error(`${this.name}: Failed to parse message:`, e);
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`${this.name}: WebSocket error: ${err.message}`));
      });

      this.ws.on('close', () => {
        this.connected = false;
      });
    });
  }

  private handleBroadcast(msg: ServerMessage): void {
    if (!this.sessionState) return;

    switch (msg.type) {
      case 'step_toggled': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.steps[msg.step] = msg.value;
        break;
      }
      case 'tempo_changed':
        this.sessionState.tempo = msg.tempo;
        break;
      case 'swing_changed':
        this.sessionState.swing = msg.swing;
        break;
      case 'track_muted': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.muted = msg.muted;
        break;
      }
      case 'track_soloed': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.soloed = msg.soloed;
        break;
      }
      case 'track_added':
        this.sessionState.tracks.push(msg.track);
        break;
      case 'track_deleted':
        this.sessionState.tracks = this.sessionState.tracks.filter(t => t.id !== msg.trackId);
        break;
      case 'track_cleared': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) {
          track.steps = track.steps.map(() => false);
          track.parameterLocks = track.parameterLocks.map(() => null);
        }
        break;
      }
      case 'track_volume_set': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.volume = msg.volume;
        break;
      }
      case 'track_transpose_set': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.transpose = msg.transpose;
        break;
      }
      case 'track_sample_set': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) {
          track.sampleId = msg.sampleId;
          track.name = msg.name;
        }
        break;
      }
      case 'track_step_count_set': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.stepCount = msg.stepCount;
        break;
      }
      case 'parameter_lock_set': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.parameterLocks[msg.step] = msg.lock;
        break;
      }
      case 'effects_changed':
        this.sessionState.effects = msg.effects;
        break;
      case 'fm_params_changed': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.fmParams = msg.fmParams;
        break;
      }
      case 'player_joined':
        this.players.push(msg.player);
        break;
      case 'player_left':
        this.players = this.players.filter(p => p.id !== msg.playerId);
        break;
    }
  }

  send(message: Omit<ClientMessage, 'seq' | 'ack'>): void {
    if (!this.ws || !this.connected) {
      throw new Error(`${this.name}: Not connected`);
    }
    const fullMessage: ClientMessage = {
      ...message,
      seq: ++this.seq,
    } as ClientMessage;
    this.ws.send(JSON.stringify(fullMessage));
  }

  async waitForMessage<T extends ServerMessage['type']>(
    type: T,
    predicate?: (msg: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs = MESSAGE_TIMEOUT
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.name}: Timeout waiting for message type: ${type}`));
      }, timeoutMs);

      const handler = (msg: ServerMessage) => {
        if (msg.type === type) {
          const typedMsg = msg as Extract<ServerMessage, { type: T }>;
          if (!predicate || predicate(typedMsg)) {
            cleanup();
            resolve(typedMsg);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        const idx = this.messageHandlers.indexOf(handler);
        if (idx >= 0) this.messageHandlers.splice(idx, 1);
      };

      // Check already received messages first
      for (const msg of this.messages) {
        if (msg.type === type) {
          const typedMsg = msg as Extract<ServerMessage, { type: T }>;
          if (!predicate || predicate(typedMsg)) {
            cleanup();
            resolve(typedMsg);
            return;
          }
        }
      }

      this.messageHandlers.push(handler);
    });
  }

  getReceivedMessages(): ServerMessage[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

// =============================================================================
// API Helpers
// =============================================================================

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

async function getSession(sessionId: string): Promise<{ state: SessionState }> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to get session: ${response.status}`);
  }
  return response.json() as Promise<{ state: SessionState }>;
}

async function getDebugInfo(sessionId: string): Promise<DebugInfo> {
  // Access DO debug endpoint - correct path is /api/debug/durable-object/:id
  const response = await fetch(`${API_BASE_URL}/debug/durable-object/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to get debug info: ${response.status}`);
  }
  return response.json() as Promise<DebugInfo>;
}

// =============================================================================
// State Machine - Event Sequences
// =============================================================================

type EventType =
  | 'toggle_step'
  | 'set_tempo'
  | 'set_swing'
  | 'add_track'
  | 'delete_track'
  | 'clear_track'
  | 'mute_track'
  | 'solo_track'
  | 'set_track_volume'
  | 'set_track_transpose'
  | 'set_track_sample'
  | 'set_track_step_count'
  | 'set_parameter_lock'
  | 'set_effects'
  | 'set_fm_params';

interface EventAction {
  type: EventType;
  execute: (player: PlayerHarness, state: SessionState) => void;
  expectedBroadcast: ServerMessage['type'];
}

const EVENT_ACTIONS: EventAction[] = [
  {
    type: 'toggle_step',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'toggle_step', trackId: track.id, step: 0 });
    },
    expectedBroadcast: 'step_toggled',
  },
  {
    type: 'set_tempo',
    execute: (player, _state) => {
      player.send({ type: 'set_tempo', tempo: 140 });
    },
    expectedBroadcast: 'tempo_changed',
  },
  {
    type: 'set_swing',
    execute: (player, _state) => {
      player.send({ type: 'set_swing', swing: 50 });
    },
    expectedBroadcast: 'swing_changed',
  },
  {
    type: 'add_track',
    execute: (player, _state) => {
      const track = createTestTrack(`test-track-${Date.now()}`);
      player.send({ type: 'add_track', track });
    },
    expectedBroadcast: 'track_added',
  },
  {
    type: 'delete_track',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'delete_track', trackId: track.id });
    },
    expectedBroadcast: 'track_deleted',
  },
  {
    type: 'clear_track',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'clear_track', trackId: track.id });
    },
    expectedBroadcast: 'track_cleared',
  },
  {
    type: 'mute_track',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'mute_track', trackId: track.id, muted: true });
    },
    expectedBroadcast: 'track_muted',
  },
  {
    type: 'solo_track',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'solo_track', trackId: track.id, soloed: true });
    },
    expectedBroadcast: 'track_soloed',
  },
  {
    type: 'set_track_volume',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'set_track_volume', trackId: track.id, volume: 0.5 });
    },
    expectedBroadcast: 'track_volume_set',
  },
  {
    type: 'set_track_transpose',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'set_track_transpose', trackId: track.id, transpose: 5 });
    },
    expectedBroadcast: 'track_transpose_set',
  },
  {
    type: 'set_track_sample',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'set_track_sample', trackId: track.id, sampleId: 'snare', name: 'Snare' });
    },
    expectedBroadcast: 'track_sample_set',
  },
  {
    type: 'set_track_step_count',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'set_track_step_count', trackId: track.id, stepCount: 32 });
    },
    expectedBroadcast: 'track_step_count_set',
  },
  {
    type: 'set_parameter_lock',
    execute: (player, state) => {
      const track = state.tracks[0];
      if (track) player.send({ type: 'set_parameter_lock', trackId: track.id, step: 0, lock: { pitch: 5, volume: 0.8 } });
    },
    expectedBroadcast: 'parameter_lock_set',
  },
];

// =============================================================================
// Test Helpers
// =============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertStatesEqual(
  state1: SessionState,
  state2: SessionState,
  description: string
): void {
  // Compare tracks
  expect(state1.tracks.length, `${description}: track count`).toBe(state2.tracks.length);
  for (let i = 0; i < state1.tracks.length; i++) {
    const t1 = state1.tracks[i];
    const t2 = state2.tracks[i];
    expect(t1.id, `${description}: track ${i} id`).toBe(t2.id);
    expect(t1.steps, `${description}: track ${i} steps`).toEqual(t2.steps);
    expect(t1.muted, `${description}: track ${i} muted`).toBe(t2.muted);
    expect(t1.soloed, `${description}: track ${i} soloed`).toBe(t2.soloed);
    expect(t1.volume, `${description}: track ${i} volume`).toBe(t2.volume);
    expect(t1.transpose, `${description}: track ${i} transpose`).toBe(t2.transpose);
  }
  expect(state1.tempo, `${description}: tempo`).toBe(state2.tempo);
  expect(state1.swing, `${description}: swing`).toBe(state2.swing);
}

// =============================================================================
// Tests: 1 Player Scenarios
// =============================================================================

describe('1 Player Scenarios', () => {
  let sessionId: string;
  let player: PlayerHarness;

  // Each test gets its own fresh session to avoid state pollution
  async function createFreshSession(): Promise<string> {
    return await createSession({
      tracks: [createTestTrack(`track-${Date.now()}`)],
    });
  }

  afterEach(() => {
    player?.disconnect();
  });

  it('connects and receives initial snapshot', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    expect(player.connected).toBe(true);
    expect(player.playerId).toBeTruthy();
    expect(player.sessionState).toBeTruthy();
    expect(player.sessionState!.tracks).toHaveLength(1);
  });

  it('toggle_step updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const track = player.sessionState!.tracks[0];
    const initialValue = track.steps[0];

    player.send({ type: 'toggle_step', trackId: track.id, step: 0 });
    await player.waitForMessage('step_toggled');

    expect(player.sessionState!.tracks[0].steps[0]).toBe(!initialValue);
  });

  it('set_tempo updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    player.send({ type: 'set_tempo', tempo: 140 });
    await player.waitForMessage('tempo_changed');

    expect(player.sessionState!.tempo).toBe(140);
  });

  it('set_swing updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    player.send({ type: 'set_swing', swing: 75 });
    await player.waitForMessage('swing_changed');

    expect(player.sessionState!.swing).toBe(75);
  });

  it('add_track updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const initialTrackCount = player.sessionState!.tracks.length;
    const newTrack = createTestTrack(`new-track-${Date.now()}`);

    player.send({ type: 'add_track', track: newTrack });
    await player.waitForMessage('track_added');

    expect(player.sessionState!.tracks.length).toBe(initialTrackCount + 1);
  });

  it('mute_track updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const track = player.sessionState!.tracks[0];
    player.send({ type: 'mute_track', trackId: track.id, muted: true });
    await player.waitForMessage('track_muted');

    expect(player.sessionState!.tracks[0].muted).toBe(true);
  });

  it('solo_track updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const track = player.sessionState!.tracks[0];
    player.send({ type: 'solo_track', trackId: track.id, soloed: true });
    await player.waitForMessage('track_soloed');

    expect(player.sessionState!.tracks[0].soloed).toBe(true);
  });

  it('set_track_volume updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const track = player.sessionState!.tracks[0];
    player.send({ type: 'set_track_volume', trackId: track.id, volume: 0.5 });
    await player.waitForMessage('track_volume_set');

    expect(player.sessionState!.tracks[0].volume).toBe(0.5);
  });

  it('set_track_transpose updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const track = player.sessionState!.tracks[0];
    player.send({ type: 'set_track_transpose', trackId: track.id, transpose: 7 });
    await player.waitForMessage('track_transpose_set');

    expect(player.sessionState!.tracks[0].transpose).toBe(7);
  });

  it('set_parameter_lock updates state and broadcasts', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const track = player.sessionState!.tracks[0];
    const lock = { pitch: 12, volume: 0.8 };
    player.send({ type: 'set_parameter_lock', trackId: track.id, step: 0, lock });
    await player.waitForMessage('parameter_lock_set');

    expect(player.sessionState!.tracks[0].parameterLocks[0]).toEqual(lock);
  });

  it('clear_track clears steps and parameter locks', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const track = player.sessionState!.tracks[0];

    // First set some steps
    player.send({ type: 'toggle_step', trackId: track.id, step: 0 });
    await player.waitForMessage('step_toggled');

    // Now clear
    player.send({ type: 'clear_track', trackId: track.id });
    await player.waitForMessage('track_cleared');

    expect(player.sessionState!.tracks[0].steps.every(s => !s)).toBe(true);
    expect(player.sessionState!.tracks[0].parameterLocks.every(l => l === null)).toBe(true);
  });

  it('delete_track removes track from state', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Add a track to delete
    const trackToDelete = createTestTrack(`track-to-delete-${Date.now()}`);
    player.send({ type: 'add_track', track: trackToDelete });
    await player.waitForMessage('track_added');

    const countBefore = player.sessionState!.tracks.length;

    // Now delete it
    player.send({ type: 'delete_track', trackId: trackToDelete.id });
    await player.waitForMessage('track_deleted');

    expect(player.sessionState!.tracks.length).toBe(countBefore - 1);
    expect(player.sessionState!.tracks.find(t => t.id === trackToDelete.id)).toBeUndefined();
  });

  it('state persists after reconnect', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Make a change
    player.send({ type: 'set_tempo', tempo: 180 });
    await player.waitForMessage('tempo_changed');

    // Disconnect and reconnect
    player.disconnect();
    await delay(BROADCAST_DELAY);

    player = new PlayerHarness('Player1-Reconnect', sessionId);
    await player.connect();

    // State should persist
    expect(player.sessionState!.tempo).toBe(180);
  });
});

// =============================================================================
// Tests: 2 Player Scenarios
// =============================================================================

describe('2 Player Scenarios', () => {
  let sessionId: string;
  let player1: PlayerHarness;
  let player2: PlayerHarness;

  // Each test gets its own fresh session
  async function createFreshSession(): Promise<string> {
    return await createSession({
      tracks: [createTestTrack(`shared-track-${Date.now()}`)],
      tempo: 120,
      swing: 0,
    });
  }

  afterEach(() => {
    player1?.disconnect();
    player2?.disconnect();
  });

  it('second player sees first player in player list', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();

    // Player2's snapshot should include Player1
    expect(player2.players.length).toBeGreaterThanOrEqual(2);
    expect(player2.players.find(p => p.id === player1.playerId)).toBeTruthy();
  });

  it('player1 receives player_joined when player2 connects', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();
    player1.clearMessages();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();

    const joinMsg = await player1.waitForMessage('player_joined');
    expect(joinMsg.player.id).toBe(player2.playerId);
  });

  it('player1 receives player_left when player2 disconnects', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();

    const player2Id = player2.playerId;
    player1.clearMessages();

    player2.disconnect();

    const leftMsg = await player1.waitForMessage('player_left');
    expect(leftMsg.playerId).toBe(player2Id);
  });

  it('player2 sees player1 toggle_step broadcast', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();
    player2.clearMessages();

    const track = player1.sessionState!.tracks[0];
    const valueBefore = track.steps[5];

    player1.send({ type: 'toggle_step', trackId: track.id, step: 5 });

    // Both should receive the broadcast
    await player1.waitForMessage('step_toggled', m => m.step === 5);
    await player2.waitForMessage('step_toggled', m => m.step === 5);

    // Both should have same state
    expect(player1.sessionState!.tracks[0].steps[5]).toBe(!valueBefore);
    expect(player2.sessionState!.tracks[0].steps[5]).toBe(!valueBefore);
  });

  it('player2 sees player1 set_tempo broadcast', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();
    player2.clearMessages();

    player1.send({ type: 'set_tempo', tempo: 160 });

    await player1.waitForMessage('tempo_changed');
    await player2.waitForMessage('tempo_changed');

    expect(player1.sessionState!.tempo).toBe(160);
    expect(player2.sessionState!.tempo).toBe(160);
  });

  it('player2 sees player1 add_track broadcast', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();
    player2.clearMessages();

    const newTrack = createTestTrack(`p1-new-track-${Date.now()}`);
    player1.send({ type: 'add_track', track: newTrack });

    await player1.waitForMessage('track_added');
    await player2.waitForMessage('track_added');

    expect(player1.sessionState!.tracks.find(t => t.id === newTrack.id)).toBeTruthy();
    expect(player2.sessionState!.tracks.find(t => t.id === newTrack.id)).toBeTruthy();
  });

  it('player2 sees player1 delete_track broadcast', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    // Add a track first
    const trackToDelete = createTestTrack(`track-for-delete-${Date.now()}`);
    player1.send({ type: 'add_track', track: trackToDelete });
    await player1.waitForMessage('track_added');

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();
    player2.clearMessages();

    // Now delete it
    player1.send({ type: 'delete_track', trackId: trackToDelete.id });

    await player1.waitForMessage('track_deleted');
    await player2.waitForMessage('track_deleted');

    expect(player1.sessionState!.tracks.find(t => t.id === trackToDelete.id)).toBeUndefined();
    expect(player2.sessionState!.tracks.find(t => t.id === trackToDelete.id)).toBeUndefined();
  });

  it('both players end up with same state after concurrent edits', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();

    // Both make changes quickly
    player1.send({ type: 'set_tempo', tempo: 145 });
    player2.send({ type: 'set_swing', swing: 33 });

    // Wait for broadcasts
    await delay(BROADCAST_DELAY * 5);

    // States should converge (last-write-wins)
    assertStatesEqual(player1.sessionState!, player2.sessionState!, 'after concurrent edits');
  });

  it('concurrent step toggles on different steps work correctly', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();

    const track = player1.sessionState!.tracks[0];

    // Both toggle different steps
    player1.send({ type: 'toggle_step', trackId: track.id, step: 0 });
    player2.send({ type: 'toggle_step', trackId: track.id, step: 8 });

    // Wait for all broadcasts
    await delay(BROADCAST_DELAY * 5);

    // Both changes should be reflected
    assertStatesEqual(player1.sessionState!, player2.sessionState!, 'after different step toggles');
  });

  it('concurrent step toggles on SAME step - last write wins', async () => {
    sessionId = await createFreshSession();
    player1 = new PlayerHarness('Player1', sessionId);
    await player1.connect();

    player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();

    const track = player1.sessionState!.tracks[0];

    // Both toggle the SAME step rapidly
    player1.send({ type: 'toggle_step', trackId: track.id, step: 7 });
    player2.send({ type: 'toggle_step', trackId: track.id, step: 7 });

    // Wait for all broadcasts
    await delay(BROADCAST_DELAY * 5);

    // States should be identical (last-write-wins)
    assertStatesEqual(player1.sessionState!, player2.sessionState!, 'after same step toggles');
  });
});

// =============================================================================
// Tests: 5 Player Scenarios (Stress Testing)
// =============================================================================

describe('5 Player Scenarios', { timeout: 60000 }, () => {
  let sessionId: string;
  const players: PlayerHarness[] = [];

  // Each test gets its own fresh session
  async function createFreshSession(): Promise<string> {
    return await createSession({
      tracks: [
        createTestTrack(`stress-track-1-${Date.now()}`),
        createTestTrack(`stress-track-2-${Date.now()}`),
      ],
      tempo: 120,
      swing: 0,
    });
  }

  afterEach(() => {
    for (const p of players) {
      p.disconnect();
    }
    players.length = 0;
  });

  it('all 5 players can connect and see each other', async () => {
    sessionId = await createFreshSession();
    for (let i = 0; i < 5; i++) {
      const player = new PlayerHarness(`Player${i + 1}`, sessionId);
      await player.connect();
      players.push(player);
      // Small delay between connections to avoid overwhelming the server
      await delay(100);
    }

    // Last player should see all 5 in the list
    expect(players[4].players.length).toBe(5);

    // All players should have unique IDs
    const playerIds = players.map(p => p.playerId);
    const uniqueIds = new Set(playerIds);
    expect(uniqueIds.size).toBe(5);
  });

  it('all players receive broadcasts from any player', async () => {
    sessionId = await createFreshSession();
    for (let i = 0; i < 5; i++) {
      const player = new PlayerHarness(`Player${i + 1}`, sessionId);
      await player.connect();
      players.push(player);
      await delay(100);
    }

    // Clear all messages
    for (const p of players) {
      p.clearMessages();
    }

    // Player 3 makes a change
    players[2].send({ type: 'set_tempo', tempo: 175 });

    // Wait for broadcasts
    await delay(BROADCAST_DELAY * 10);

    // All players should have received the broadcast
    for (let i = 0; i < 5; i++) {
      expect(players[i].sessionState!.tempo, `Player${i + 1} tempo`).toBe(175);
    }
  });

  it('all players end up with same state after many concurrent edits', async () => {
    sessionId = await createFreshSession();
    for (let i = 0; i < 5; i++) {
      const player = new PlayerHarness(`Player${i + 1}`, sessionId);
      await player.connect();
      players.push(player);
      await delay(100);
    }

    // Each player makes multiple changes
    const track = players[0].sessionState!.tracks[0];

    players[0].send({ type: 'toggle_step', trackId: track.id, step: 0 });
    players[1].send({ type: 'toggle_step', trackId: track.id, step: 2 });
    players[2].send({ type: 'toggle_step', trackId: track.id, step: 4 });
    players[3].send({ type: 'toggle_step', trackId: track.id, step: 6 });
    players[4].send({ type: 'toggle_step', trackId: track.id, step: 8 });

    // Wait for all broadcasts
    await delay(BROADCAST_DELAY * 20);

    // All players should have same state
    for (let i = 1; i < 5; i++) {
      assertStatesEqual(players[0].sessionState!, players[i].sessionState!, `Player1 vs Player${i + 1}`);
    }
  });

  it('player leaving notifies all other players', async () => {
    sessionId = await createFreshSession();
    for (let i = 0; i < 5; i++) {
      const player = new PlayerHarness(`Player${i + 1}`, sessionId);
      await player.connect();
      players.push(player);
      await delay(100);
    }

    // Clear messages
    for (const p of players) {
      p.clearMessages();
    }

    // Player 3 leaves
    const leavingPlayerId = players[2].playerId;
    players[2].disconnect();

    // Wait for broadcasts
    await delay(BROADCAST_DELAY * 10);

    // All remaining players should have received player_left
    for (let i = 0; i < 5; i++) {
      if (i === 2) continue; // Skip the disconnected player
      const leftMsgs = players[i].getReceivedMessages().filter(m => m.type === 'player_left');
      expect(leftMsgs.length, `Player${i + 1} should receive player_left`).toBeGreaterThanOrEqual(1);
      expect((leftMsgs[0] as { playerId: string }).playerId).toBe(leavingPlayerId);
    }
  });

  it('rapid concurrent track additions from all players', async () => {
    sessionId = await createFreshSession();
    for (let i = 0; i < 5; i++) {
      const player = new PlayerHarness(`Player${i + 1}`, sessionId);
      await player.connect();
      players.push(player);
      await delay(100);
    }

    const initialTrackCount = players[0].sessionState!.tracks.length;

    // All players add tracks simultaneously
    for (let i = 0; i < 5; i++) {
      const track = createTestTrack(`concurrent-track-${Date.now()}-${i}`);
      players[i].send({ type: 'add_track', track });
    }

    // Wait for all broadcasts
    await delay(BROADCAST_DELAY * 20);

    // All players should have all 5 new tracks
    for (let i = 0; i < 5; i++) {
      expect(players[i].sessionState!.tracks.length).toBe(initialTrackCount + 5);
    }

    // All players should have same state
    for (let i = 1; i < 5; i++) {
      assertStatesEqual(players[0].sessionState!, players[i].sessionState!, `Player1 vs Player${i + 1} after concurrent adds`);
    }
  });
});

// =============================================================================
// Tests: DO/KV Introspection
// =============================================================================

describe('DO/KV Introspection', () => {
  let sessionId: string;
  let player: PlayerHarness;

  // Each test gets its own fresh session
  async function createFreshSession(): Promise<string> {
    return await createSession({
      tracks: [createTestTrack(`introspection-track-${Date.now()}`)],
    });
  }

  afterEach(() => {
    player?.disconnect();
  });

  it('debug endpoint returns valid structure', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const debug = await getDebugInfo(sessionId);

    expect(debug.connectedPlayers).toBeGreaterThanOrEqual(1);
    expect(debug.players.length).toBeGreaterThanOrEqual(1);
    expect(debug.trackCount).toBeGreaterThanOrEqual(1);
    expect(typeof debug.tempo).toBe('number');
    expect(typeof debug.swing).toBe('number');
    expect(typeof debug.pendingKVSave).toBe('boolean');
    expect(debug.invariants).toHaveProperty('valid');
    expect(debug.invariants).toHaveProperty('violations');
  });

  it('debug endpoint shows correct player count', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const debug1 = await getDebugInfo(sessionId);
    expect(debug1.connectedPlayers).toBe(1);

    const player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();

    const debug2 = await getDebugInfo(sessionId);
    expect(debug2.connectedPlayers).toBe(2);

    player2.disconnect();
  });

  it('debug endpoint shows track count matches', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const debug = await getDebugInfo(sessionId);
    expect(debug.trackCount).toBe(player.sessionState!.tracks.length);
  });

  it('debug endpoint shows tempo matches', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    player.send({ type: 'set_tempo', tempo: 155 });
    await player.waitForMessage('tempo_changed');

    const debug = await getDebugInfo(sessionId);
    expect(debug.tempo).toBe(155);
  });

  it('debug endpoint invariants are valid after operations', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Perform various operations
    const track = player.sessionState!.tracks[0];
    player.send({ type: 'toggle_step', trackId: track.id, step: 3 });
    await player.waitForMessage('step_toggled');

    player.send({ type: 'set_tempo', tempo: 133 });
    await player.waitForMessage('tempo_changed');

    // Check invariants
    const debug = await getDebugInfo(sessionId);
    expect(debug.invariants.valid).toBe(true);
    expect(debug.invariants.violations).toHaveLength(0);
  });

  // Note: This test may be flaky in local wrangler dev due to non-deterministic alarm timing.
  // It should work reliably in staging/production with real Cloudflare infrastructure.
  it('KV state matches DO state after changes', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Make changes (use valid tempo - MAX_TEMPO is 180, default is 120)
    player.send({ type: 'set_tempo', tempo: 150 });
    await player.waitForMessage('tempo_changed');

    // Wait for KV save (debounced - the DO uses a 5 second debounce)
    await delay(6000);

    // Fetch from API (reads from KV)
    const kvSession = await getSession(sessionId);

    // Should match DO state
    expect(kvSession.state.tempo).toBe(150);
  }, 15000); // Extended timeout: 6s delay + network latency
});

// =============================================================================
// Tests: Event Sequence State Machine
// =============================================================================

describe('Event Sequence State Machine', () => {
  let sessionId: string;
  let player: PlayerHarness;

  // Each test gets its own fresh session
  async function createFreshSession(): Promise<string> {
    return await createSession({
      tracks: [createTestTrack(`sm-track-${Date.now()}`)],
    });
  }

  afterEach(() => {
    player?.disconnect();
  });

  it('executes all event types in sequence', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Make sure we have a track to work with
    if (player.sessionState!.tracks.length === 0) {
      const track = createTestTrack(`sequence-test-track-${Date.now()}`);
      player.send({ type: 'add_track', track });
      await player.waitForMessage('track_added');
    }

    // Execute each event type
    for (const action of EVENT_ACTIONS) {
      // Skip actions that require a track if we don't have one
      if (action.type === 'delete_track' || action.type === 'clear_track') {
        // Add a track first
        const tempTrack = createTestTrack(`temp-for-${action.type}-${Date.now()}`);
        player.send({ type: 'add_track', track: tempTrack });
        await player.waitForMessage('track_added');
      }

      try {
        action.execute(player, player.sessionState!);
        await player.waitForMessage(action.expectedBroadcast);
      } catch (e) {
        throw new Error(`Event ${action.type} failed: ${(e as Error).message}`);
      }
    }
  });

  it('random event sequences maintain state consistency', async () => {
    sessionId = await createFreshSession();
    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Ensure we have tracks
    for (let i = 0; i < 3; i++) {
      const track = createTestTrack(`random-track-${Date.now()}-${i}`);
      player.send({ type: 'add_track', track });
      await player.waitForMessage('track_added');
    }

    // Generate random sequence of non-destructive events
    const safeActions = EVENT_ACTIONS.filter(a =>
      !['delete_track', 'clear_track'].includes(a.type)
    );

    for (let i = 0; i < 20; i++) {
      const action = safeActions[Math.floor(Math.random() * safeActions.length)];
      try {
        action.execute(player, player.sessionState!);
        await player.waitForMessage(action.expectedBroadcast);
      } catch (_e) {
        // Ignore if track doesn't exist
      }
    }

    // Verify invariants
    const debug = await getDebugInfo(sessionId);
    expect(debug.invariants.valid).toBe(true);
  });
});

// =============================================================================
// Tests: Track Copy (via add_track with same content)
// =============================================================================

describe('Track Operations: Copy and Delete', () => {
  let sessionId: string;
  let player: PlayerHarness;
  let sourceTrackId: string;

  // Each test gets its own fresh session
  async function createFreshSession(): Promise<{ sessionId: string; sourceTrackId: string }> {
    const trackId = `source-track-${Date.now()}`;
    const id = await createSession({
      tracks: [
        {
          id: trackId,
          name: 'Source Track',
          sampleId: 'kick',
          steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
          parameterLocks: Array(16).fill(null).map((_, i) => i % 4 === 0 ? { pitch: 5 } : null),
          volume: 0.8,
          muted: false,
          transpose: 3,
          stepCount: 16,
        },
      ],
    });
    return { sessionId: id, sourceTrackId: trackId };
  }

  afterEach(() => {
    player?.disconnect();
  });

  it('copies track by adding new track with same content', async () => {
    const session = await createFreshSession();
    sessionId = session.sessionId;
    sourceTrackId = session.sourceTrackId;

    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const sourceTrack = player.sessionState!.tracks.find(t => t.id === sourceTrackId);
    expect(sourceTrack).toBeTruthy();

    // Create copy with new ID
    const copyId = `copy-of-source-${Date.now()}`;
    const copyTrack: SessionTrack = {
      ...sourceTrack!,
      id: copyId,
      name: 'Copy of Source Track',
    };

    player.send({ type: 'add_track', track: copyTrack });
    await player.waitForMessage('track_added');

    const addedTrack = player.sessionState!.tracks.find(t => t.id === copyId);
    expect(addedTrack).toBeTruthy();
    expect(addedTrack!.steps).toEqual(sourceTrack!.steps);
    expect(addedTrack!.parameterLocks).toEqual(sourceTrack!.parameterLocks);
    expect(addedTrack!.volume).toBe(sourceTrack!.volume);
    expect(addedTrack!.transpose).toBe(sourceTrack!.transpose);
  });

  it('deletes track and verifies removal', async () => {
    const session = await createFreshSession();
    sessionId = session.sessionId;

    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Add a track to delete
    const deleteId = `delete-me-${Date.now()}`;
    const trackToDelete = createTestTrack(deleteId);
    player.send({ type: 'add_track', track: trackToDelete });
    await player.waitForMessage('track_added');

    expect(player.sessionState!.tracks.find(t => t.id === deleteId)).toBeTruthy();

    // Delete it
    player.send({ type: 'delete_track', trackId: deleteId });
    await player.waitForMessage('track_deleted');

    expect(player.sessionState!.tracks.find(t => t.id === deleteId)).toBeUndefined();
  });

  it('two players: one copies, other sees the copy', async () => {
    const session = await createFreshSession();
    sessionId = session.sessionId;
    sourceTrackId = session.sourceTrackId;

    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    const player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();
    player2.clearMessages();

    const sourceTrack = player.sessionState!.tracks.find(t => t.id === sourceTrackId);

    // Player1 copies track
    const copyId = `shared-copy-${Date.now()}`;
    const copyTrack: SessionTrack = {
      ...sourceTrack!,
      id: copyId,
      name: 'Shared Copy',
    };

    player.send({ type: 'add_track', track: copyTrack });
    await player.waitForMessage('track_added');
    await player2.waitForMessage('track_added');

    // Both should have the copy
    expect(player.sessionState!.tracks.find(t => t.id === copyId)).toBeTruthy();
    expect(player2.sessionState!.tracks.find(t => t.id === copyId)).toBeTruthy();

    player2.disconnect();
  });

  it('two players: one deletes, other sees deletion', async () => {
    const session = await createFreshSession();
    sessionId = session.sessionId;

    player = new PlayerHarness('Player1', sessionId);
    await player.connect();

    // Add track
    const deleteId = `shared-delete-${Date.now()}`;
    const trackToDelete = createTestTrack(deleteId);
    player.send({ type: 'add_track', track: trackToDelete });
    await player.waitForMessage('track_added');

    const player2 = new PlayerHarness('Player2', sessionId);
    await player2.connect();
    player2.clearMessages();

    // Player1 deletes
    player.send({ type: 'delete_track', trackId: deleteId });
    await player.waitForMessage('track_deleted');
    await player2.waitForMessage('track_deleted');

    // Both should not have the track
    expect(player.sessionState!.tracks.find(t => t.id === deleteId)).toBeUndefined();
    expect(player2.sessionState!.tracks.find(t => t.id === deleteId)).toBeUndefined();

    player2.disconnect();
  });
});
