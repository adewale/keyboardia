/**
 * Effects Bypass Sync Integration Tests
 *
 * These tests verify that effects bypass state syncs correctly between
 * multiple players. Per the architecture principle:
 * "Local-only audio features are a category of bug"
 *
 * When one player bypasses effects, all players should hear dry audio.
 * This maintains "everyone hears the same music".
 *
 * Run against local dev:
 *   TEST_BASE_URL=http://localhost:8787 npx vitest run test/staging/effects-bypass-sync.test.ts
 *
 * Run against staging:
 *   TEST_BASE_URL=https://keyboardia-staging.adewale-883.workers.dev npx vitest run test/staging/effects-bypass-sync.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type {
  SessionState,
  PlayerInfo,
  EffectsState,
  ServerMessage,
} from '../types';
import { createTestTrack, createDefaultEffects, createSessionState } from '../types';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8787';
const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');
const API_BASE_URL = `${BASE_URL}/api`;

// Test timeouts
const CONNECT_TIMEOUT = 10000;
const MESSAGE_TIMEOUT = 5000;
const BROADCAST_DELAY = 100;

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

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Tests
// =============================================================================

describe('Effects Bypass Sync', () => {
  const players: PlayerHarness[] = [];

  afterEach(() => {
    for (const player of players) {
      player.disconnect();
    }
    players.length = 0;
  });

  describe('Session with tracks and steps loads correctly', () => {
    it('should load session with tracks, steps, and default effects', async () => {
      // Create session with a track that has some steps enabled
      const track = createTestTrack('test-track-1');
      const effects = createDefaultEffects();

      const sessionId = await createSession({
        tracks: [track],
        effects,
      });

      // Connect player
      const player = new PlayerHarness('Player1', sessionId);
      players.push(player);
      await player.connect();

      // Verify session loaded correctly
      expect(player.sessionState).toBeDefined();
      expect(player.sessionState!.tracks).toHaveLength(1);
      expect(player.sessionState!.tracks[0].id).toBe('test-track-1');
      expect(player.sessionState!.tracks[0].steps[0]).toBe(true); // Beat 1
      expect(player.sessionState!.tracks[0].steps[4]).toBe(true); // Beat 2

      // Effects should be loaded (with bypass=false default)
      expect(player.sessionState!.effects).toBeDefined();
      expect(player.sessionState!.effects!.bypass).toBe(false);
    });
  });

  describe('FX parameter changes sync between players', () => {
    it('should sync reverb wet changes to all players', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: createDefaultEffects(),
      });

      // Connect two players
      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();
      await delay(BROADCAST_DELAY);

      // Clear messages from connection
      player1.clearMessages();
      player2.clearMessages();

      // Player 1 changes reverb wet
      const newEffects: EffectsState = {
        ...createDefaultEffects(),
        reverb: { decay: 2.0, wet: 0.5 },
      };
      player1.send({ type: 'set_effects', effects: newEffects });

      // Player 2 should receive effects_changed broadcast
      const broadcast = await player2.waitForMessage('effects_changed');

      expect(broadcast.effects.reverb.wet).toBe(0.5);
      expect(broadcast.effects.bypass).toBe(false);

      // Both players should have same effects state
      await delay(BROADCAST_DELAY);
      expect(player1.sessionState!.effects!.reverb.wet).toBe(0.5);
      expect(player2.sessionState!.effects!.reverb.wet).toBe(0.5);
    });

    it('should sync all FX parameter changes together', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: createDefaultEffects(),
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();
      await delay(BROADCAST_DELAY);
      player2.clearMessages();

      // Player 1 changes multiple effects
      const newEffects: EffectsState = {
        bypass: false,
        reverb: { decay: 5.0, wet: 0.7 },
        delay: { time: '4n', feedback: 0.5, wet: 0.4 },
        chorus: { frequency: 2.0, depth: 0.8, wet: 0.3 },
        distortion: { amount: 0.6, wet: 0.2 },
      };
      player1.send({ type: 'set_effects', effects: newEffects });

      const broadcast = await player2.waitForMessage('effects_changed');

      // Verify all effects synced
      expect(broadcast.effects.reverb.decay).toBe(5.0);
      expect(broadcast.effects.reverb.wet).toBe(0.7);
      expect(broadcast.effects.delay.time).toBe('4n');
      expect(broadcast.effects.delay.feedback).toBe(0.5);
      expect(broadcast.effects.delay.wet).toBe(0.4);
      expect(broadcast.effects.chorus.frequency).toBe(2.0);
      expect(broadcast.effects.chorus.depth).toBe(0.8);
      expect(broadcast.effects.chorus.wet).toBe(0.3);
      expect(broadcast.effects.distortion.amount).toBe(0.6);
      expect(broadcast.effects.distortion.wet).toBe(0.2);
      expect(broadcast.effects.bypass).toBe(false);
    });
  });

  describe('FX bypass toggle syncs between players', () => {
    it('should sync bypass=true (disable effects) to all players', async () => {
      // Start with effects enabled and wet values set
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: {
          bypass: false,
          reverb: { decay: 2.0, wet: 0.5 },
          delay: { time: '8n', feedback: 0.3, wet: 0.3 },
          chorus: { frequency: 1.5, depth: 0.5, wet: 0.2 },
          distortion: { amount: 0.4, wet: 0.1 },
        },
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();
      await delay(BROADCAST_DELAY);

      // Verify both players start with bypass=false
      expect(player1.sessionState!.effects!.bypass).toBe(false);
      expect(player2.sessionState!.effects!.bypass).toBe(false);

      player2.clearMessages();

      // Player 1 bypasses effects (disables them)
      const bypassedEffects: EffectsState = {
        ...player1.sessionState!.effects!,
        bypass: true,
      };
      player1.send({ type: 'set_effects', effects: bypassedEffects });

      // Player 2 should receive effects_changed with bypass=true
      const broadcast = await player2.waitForMessage('effects_changed');

      expect(broadcast.effects.bypass).toBe(true);
      // Wet values should be preserved (bypass doesn't reset them)
      expect(broadcast.effects.reverb.wet).toBe(0.5);

      // Both players should have bypass=true
      await delay(BROADCAST_DELAY);
      expect(player1.sessionState!.effects!.bypass).toBe(true);
      expect(player2.sessionState!.effects!.bypass).toBe(true);
    });

    it('should sync bypass=false (enable effects) to all players', async () => {
      // Start with effects bypassed
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: {
          bypass: true,  // Start bypassed
          reverb: { decay: 2.0, wet: 0.5 },
          delay: { time: '8n', feedback: 0.3, wet: 0.3 },
          chorus: { frequency: 1.5, depth: 0.5, wet: 0.2 },
          distortion: { amount: 0.4, wet: 0.1 },
        },
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();
      await delay(BROADCAST_DELAY);

      // Verify both players start with bypass=true
      expect(player1.sessionState!.effects!.bypass).toBe(true);
      expect(player2.sessionState!.effects!.bypass).toBe(true);

      player2.clearMessages();

      // Player 1 enables effects (un-bypasses)
      const enabledEffects: EffectsState = {
        ...player1.sessionState!.effects!,
        bypass: false,
      };
      player1.send({ type: 'set_effects', effects: enabledEffects });

      // Player 2 should receive effects_changed with bypass=false
      const broadcast = await player2.waitForMessage('effects_changed');

      expect(broadcast.effects.bypass).toBe(false);

      // Both players should have bypass=false
      await delay(BROADCAST_DELAY);
      expect(player1.sessionState!.effects!.bypass).toBe(false);
      expect(player2.sessionState!.effects!.bypass).toBe(false);
    });

    it('should handle rapid bypass toggles correctly', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: createDefaultEffects(),
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();
      await delay(BROADCAST_DELAY);

      // Rapidly toggle bypass
      const baseEffects = player1.sessionState!.effects!;

      player1.send({ type: 'set_effects', effects: { ...baseEffects, bypass: true } });
      await delay(50);
      player1.send({ type: 'set_effects', effects: { ...baseEffects, bypass: false } });
      await delay(50);
      player1.send({ type: 'set_effects', effects: { ...baseEffects, bypass: true } });

      // Wait for broadcasts to settle
      await delay(BROADCAST_DELAY * 3);

      // Final state should be bypass=true (last write wins)
      expect(player1.sessionState!.effects!.bypass).toBe(true);
      expect(player2.sessionState!.effects!.bypass).toBe(true);
    });
  });

  describe('FX state persists across reconnection', () => {
    it('should preserve bypass state when player reconnects', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: createDefaultEffects(),
      });

      // Player 1 connects and bypasses effects
      const player1 = new PlayerHarness('Player1', sessionId);
      players.push(player1);
      await player1.connect();

      const bypassedEffects: EffectsState = {
        ...player1.sessionState!.effects!,
        bypass: true,
        reverb: { decay: 3.0, wet: 0.6 },
      };
      player1.send({ type: 'set_effects', effects: bypassedEffects });
      await delay(BROADCAST_DELAY);

      // Player 1 disconnects
      player1.disconnect();
      await delay(BROADCAST_DELAY);

      // Player 2 connects fresh
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player2);
      await player2.connect();

      // Player 2 should receive the persisted effects state with bypass=true
      expect(player2.sessionState!.effects).toBeDefined();
      expect(player2.sessionState!.effects!.bypass).toBe(true);
      expect(player2.sessionState!.effects!.reverb.wet).toBe(0.6);
      expect(player2.sessionState!.effects!.reverb.decay).toBe(3.0);
    });
  });

  describe('Combined step and FX sync', () => {
    it('should sync both step toggles and FX changes correctly', async () => {
      const sessionId = await createSession({
        tracks: [createTestTrack('track-1')],
        effects: createDefaultEffects(),
      });

      const player1 = new PlayerHarness('Player1', sessionId);
      const player2 = new PlayerHarness('Player2', sessionId);
      players.push(player1, player2);

      await player1.connect();
      await player2.connect();
      await delay(BROADCAST_DELAY);

      player2.clearMessages();

      // Player 1 toggles a step
      const trackId = player1.sessionState!.tracks[0].id;
      player1.send({ type: 'toggle_step', trackId, step: 2 });

      // And changes effects
      const newEffects: EffectsState = {
        ...player1.sessionState!.effects!,
        bypass: true,
        reverb: { decay: 4.0, wet: 0.8 },
      };
      player1.send({ type: 'set_effects', effects: newEffects });

      // Player 2 should receive both broadcasts
      await player2.waitForMessage('step_toggled');
      await player2.waitForMessage('effects_changed');

      await delay(BROADCAST_DELAY);

      // Verify both changes synced
      expect(player2.sessionState!.tracks[0].steps[2]).toBe(true);
      expect(player2.sessionState!.effects!.bypass).toBe(true);
      expect(player2.sessionState!.effects!.reverb.wet).toBe(0.8);
    });
  });
});
