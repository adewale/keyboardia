/**
 * Effects Immediate Sync Integration Tests
 *
 * Tests for two bugs discovered during manual testing:
 *
 * BUG 1: Effects don't sync until bypass is toggled
 *   - When a player changes reverb/delay/chorus/distortion, the change
 *     should immediately sync to other players
 *   - Currently, changes only sync after bypass is toggled
 *
 * BUG 2: Rapid bypass toggle breaks playback
 *   - Enable -> Disable -> Enable -> Disable -> Enable breaks audio
 *   - The savedState mechanism in ToneEffectsChain gets corrupted
 *
 * Run against local dev:
 *   TEST_BASE_URL=http://localhost:8787 npx vitest run test/staging/effects-immediate-sync.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8787';
const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');
const API_BASE_URL = `${BASE_URL}/api`;

const CONNECT_TIMEOUT = 10000;
const MESSAGE_TIMEOUT = 5000;
const BROADCAST_DELAY = 100;

// =============================================================================
// Types
// =============================================================================

interface EffectsState {
  bypass?: boolean;
  reverb: { decay: number; wet: number };
  delay: { time: string; feedback: number; wet: number };
  chorus: { frequency: number; depth: number; wet: number };
  distortion: { amount: number; wet: number };
}

interface SessionTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (null | { pitch?: number; volume?: number })[];
  volume: number;
  muted: boolean;
  soloed?: boolean;
  playbackMode: 'oneshot' | 'gate';
  transpose: number;
  stepCount?: number;
}

interface SessionState {
  tracks: SessionTrack[];
  tempo: number;
  swing: number;
  effects?: EffectsState;
  version: number;
}

interface PlayerInfo {
  id: string;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number;
  color: string;
  colorIndex: number;
  animal: string;
  name: string;
}

type ServerMessage =
  | { type: 'snapshot'; state: SessionState; players: PlayerInfo[]; playerId: string; seq?: number }
  | { type: 'effects_changed'; effects: EffectsState; playerId: string; seq?: number; clientSeq?: number }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean; playerId: string; seq?: number }
  | { type: 'track_added'; track: SessionTrack; playerId: string; seq?: number }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | { type: 'state_hash_match' }
  | { type: 'state_mismatch'; serverHash: string }
  | { type: 'error'; message: string };

// =============================================================================
// Player Harness
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

          if (msg.type === 'snapshot') {
            this.playerId = msg.playerId;
            this.sessionState = msg.state;
            this.players = msg.players;
            clearTimeout(timeout);
            resolve();
          }

          this.handleBroadcast(msg);

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
      case 'effects_changed':
        this.sessionState.effects = msg.effects;
        break;
      case 'step_toggled': {
        const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
        if (track) track.steps[msg.step] = msg.value;
        break;
      }
      case 'track_added':
        this.sessionState.tracks.push(msg.track);
        break;
      case 'player_joined':
        this.players.push(msg.player);
        break;
      case 'player_left':
        this.players = this.players.filter(p => p.id !== msg.playerId);
        break;
    }
  }

  send(message: Record<string, unknown>): void {
    if (!this.ws || !this.connected) {
      throw new Error(`${this.name}: Not connected`);
    }
    const fullMessage = {
      ...message,
      seq: ++this.seq,
    };
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

      // Check already received messages
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
// Test Helpers
// =============================================================================

async function createSession(initialState?: Partial<SessionState>): Promise<string> {
  const state: SessionState = {
    tracks: [],
    tempo: 120,
    swing: 0,
    version: 1,
    ...initialState,
  };

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

function createTestTrack(id: string): SessionTrack {
  return {
    id,
    name: `Track ${id}`,
    sampleId: 'kick',
    steps: Array(16).fill(false).map((_, i) => i % 4 === 0), // Steps on beats
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: false,
    playbackMode: 'oneshot',
    transpose: 0,
    stepCount: 16,
  };
}

function createDefaultEffects(): EffectsState {
  return {
    bypass: false,
    reverb: { decay: 2.0, wet: 0 },
    delay: { time: '8n', feedback: 0.3, wet: 0 },
    chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
    distortion: { amount: 0.4, wet: 0 },
  };
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Tests
// =============================================================================

describe('Effects Immediate Sync', () => {
  const players: PlayerHarness[] = [];

  afterEach(() => {
    for (const player of players) {
      player.disconnect();
    }
    players.length = 0;
  });

  describe('BUG 1: Effects should sync immediately (not just after bypass toggle)', () => {
    it('session loads, track added with steps, effects applied - syncs immediately', async () => {
      // Create empty session
      const sessionId = await createSession({
        effects: createDefaultEffects(),
      });

      // Connect two players
      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();

      // Player 2 should see player 1 joined
      expect(player2.players.length).toBeGreaterThanOrEqual(2);

      // Clear messages to start fresh
      player1.clearMessages();
      player2.clearMessages();

      // Player 1 adds a track
      const track = createTestTrack('immediate-sync-track');
      player1.send({
        type: 'add_track',
        track,
      });

      // Player 2 should receive track_added
      const trackAdded = await player2.waitForMessage('track_added');
      expect(trackAdded.track.id).toBe('immediate-sync-track');

      // Verify track has steps
      expect(trackAdded.track.steps[0]).toBe(true);
      expect(trackAdded.track.steps[4]).toBe(true);

      // Now apply effects - should sync IMMEDIATELY (without toggle)
      player1.clearMessages();
      player2.clearMessages();

      const newEffects: EffectsState = {
        bypass: false,
        reverb: { decay: 3.5, wet: 0.6 },
        delay: { time: '4n', feedback: 0.5, wet: 0.4 },
        chorus: { frequency: 2.0, depth: 0.7, wet: 0.3 },
        distortion: { amount: 0.5, wet: 0.2 },
      };

      player1.send({
        type: 'set_effects',
        effects: newEffects,
      });

      // Player 2 should receive effects_changed IMMEDIATELY
      const effectsChanged = await player2.waitForMessage('effects_changed');

      // Verify ALL effects synced (not just bypass)
      expect(effectsChanged.effects.reverb.wet).toBe(0.6);
      expect(effectsChanged.effects.reverb.decay).toBe(3.5);
      expect(effectsChanged.effects.delay.wet).toBe(0.4);
      expect(effectsChanged.effects.delay.time).toBe('4n');
      expect(effectsChanged.effects.chorus.wet).toBe(0.3);
      expect(effectsChanged.effects.distortion.wet).toBe(0.2);
      expect(effectsChanged.effects.bypass).toBe(false);

      // Both players should have same effects state
      expect(player2.sessionState!.effects).toEqual(newEffects);
    });

    it('reverb wet change syncs immediately without toggle', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: createDefaultEffects(),
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();

      player1.clearMessages();
      player2.clearMessages();

      // Change ONLY reverb wet - should sync immediately
      const modifiedEffects: EffectsState = {
        ...createDefaultEffects(),
        reverb: { decay: 2.0, wet: 0.75 }, // Only wet changed
      };

      player1.send({
        type: 'set_effects',
        effects: modifiedEffects,
      });

      const effectsChanged = await player2.waitForMessage('effects_changed');
      expect(effectsChanged.effects.reverb.wet).toBe(0.75);
    });

    it('multiple rapid effects changes all sync', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: createDefaultEffects(),
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();

      player2.clearMessages();

      // Send 5 rapid effects changes
      for (let i = 1; i <= 5; i++) {
        player1.send({
          type: 'set_effects',
          effects: {
            ...createDefaultEffects(),
            reverb: { decay: 2.0, wet: i * 0.1 },
          },
        });
        await delay(50); // Small delay between
      }

      // Wait for final state to settle
      await delay(BROADCAST_DELAY * 2);

      // Final state should be wet=0.5
      expect(player2.sessionState!.effects!.reverb.wet).toBe(0.5);
    });
  });

  describe('BUG 2: Rapid bypass toggle should not break state', () => {
    it('enable -> disable -> enable -> disable -> enable maintains valid state', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: {
          ...createDefaultEffects(),
          reverb: { decay: 2.0, wet: 0.5 }, // Some effects active
          delay: { time: '8n', feedback: 0.3, wet: 0.3 },
        },
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();

      const originalEffects = player1.sessionState!.effects!;
      player2.clearMessages();

      // Rapid bypass toggles: enable(false) -> disable(true) -> enable(false) -> disable(true) -> enable(false)
      const toggleSequence = [true, false, true, false, true];

      for (const bypass of toggleSequence) {
        player1.send({
          type: 'set_effects',
          effects: {
            ...originalEffects,
            bypass,
          },
        });
        await delay(50); // Small delay between
      }

      // Wait for all to process
      await delay(BROADCAST_DELAY * 2);

      // Final state should be bypass=true (last toggle)
      expect(player2.sessionState!.effects!.bypass).toBe(true);

      // CRITICAL: Wet values should be PRESERVED
      expect(player2.sessionState!.effects!.reverb.wet).toBe(0.5);
      expect(player2.sessionState!.effects!.delay.wet).toBe(0.3);
    });

    it('bypass state survives rapid toggle without corrupting effects values', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: {
          bypass: false,
          reverb: { decay: 4.0, wet: 0.8 },
          delay: { time: '4n', feedback: 0.6, wet: 0.7 },
          chorus: { frequency: 3.0, depth: 0.9, wet: 0.6 },
          distortion: { amount: 0.7, wet: 0.5 },
        },
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      players.push(player1);

      await player1.connect();

      const originalEffects = player1.sessionState!.effects!;

      // Rapid toggles
      for (let i = 0; i < 10; i++) {
        player1.send({
          type: 'set_effects',
          effects: {
            ...originalEffects,
            bypass: i % 2 === 0, // alternating
          },
        });
        await delay(20);
      }

      await delay(BROADCAST_DELAY * 3);

      // After all toggles, effects values should be intact
      const finalEffects = player1.sessionState!.effects!;
      expect(finalEffects.reverb.wet).toBe(0.8);
      expect(finalEffects.reverb.decay).toBe(4.0);
      expect(finalEffects.delay.wet).toBe(0.7);
      expect(finalEffects.delay.time).toBe('4n');
      expect(finalEffects.chorus.wet).toBe(0.6);
      expect(finalEffects.distortion.wet).toBe(0.5);
    });
  });

  describe('Combined: Add track, add steps, apply effects - full flow', () => {
    it('complete flow: connect, add track, toggle steps, apply effects, toggle bypass', async () => {
      const sessionId = await createSession({
        effects: createDefaultEffects(),
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();

      // Step 1: Add track
      player2.clearMessages();
      player1.send({
        type: 'add_track',
        track: createTestTrack('flow-track'),
      });
      await player2.waitForMessage('track_added');
      expect(player2.sessionState!.tracks.length).toBe(1);

      // Step 2: Toggle some steps
      player2.clearMessages();
      player1.send({
        type: 'toggle_step',
        trackId: 'flow-track',
        step: 2,
      });
      await player2.waitForMessage('step_toggled');
      expect(player2.sessionState!.tracks[0].steps[2]).toBe(true);

      // Step 3: Apply effects (should sync immediately)
      player2.clearMessages();
      player1.send({
        type: 'set_effects',
        effects: {
          bypass: false,
          reverb: { decay: 5.0, wet: 0.9 },
          delay: { time: '8n', feedback: 0.4, wet: 0.5 },
          chorus: { frequency: 2.5, depth: 0.8, wet: 0.4 },
          distortion: { amount: 0.6, wet: 0.3 },
        },
      });
      const fxChanged = await player2.waitForMessage('effects_changed');
      expect(fxChanged.effects.reverb.wet).toBe(0.9);

      // Step 4: Toggle bypass to true
      player2.clearMessages();
      player1.send({
        type: 'set_effects',
        effects: {
          ...player1.sessionState!.effects!,
          bypass: true,
        },
      });
      const bypassOn = await player2.waitForMessage('effects_changed');
      expect(bypassOn.effects.bypass).toBe(true);
      // Wet values should be preserved
      expect(bypassOn.effects.reverb.wet).toBe(0.9);

      // Step 5: Toggle bypass back to false
      player2.clearMessages();
      player1.send({
        type: 'set_effects',
        effects: {
          ...player1.sessionState!.effects!,
          bypass: false,
        },
      });
      const bypassOff = await player2.waitForMessage('effects_changed');
      expect(bypassOff.effects.bypass).toBe(false);
      expect(bypassOff.effects.reverb.wet).toBe(0.9);
    });
  });
});
