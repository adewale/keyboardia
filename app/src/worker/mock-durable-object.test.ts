/**
 * Phase 7: Tests for Mock Durable Object
 *
 * These tests verify the mock DO behaves correctly and can be used
 * for multi-client integration testing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MockLiveSession,
  createMockSession,
  createMockClients,
  type MockWebSocket,
} from './mock-durable-object';
import type { SessionState } from './types';

describe('MockLiveSession (Phase 7)', () => {
  let session: MockLiveSession;

  beforeEach(() => {
    session = createMockSession('test-session');
  });

  describe('connection management', () => {
    it('should allow a client to connect', () => {
      const ws = session.connect('player-1');

      expect(ws.id).toBe('player-1');
      expect(ws.readyState).toBe(1); // OPEN
      expect(session.getConnectionCount()).toBe(1);
    });

    it('should allow multiple clients to connect', () => {
      session.connect('player-1');
      session.connect('player-2');
      session.connect('player-3');

      expect(session.getConnectionCount()).toBe(3);
      expect(session.getConnectedPlayers()).toEqual(['player-1', 'player-2', 'player-3']);
    });

    it('should reject the 11th connection', () => {
      for (let i = 0; i < 10; i++) {
        session.connect(`player-${i}`);
      }

      expect(() => session.connect('player-10')).toThrow('Maximum connections reached (10)');
    });

    it('should handle player disconnect', () => {
      const ws = session.connect('player-1');

      ws.close();

      expect(session.getConnectionCount()).toBe(0);
      expect(ws.readyState).toBe(3); // CLOSED
    });

    it('should call onclose when disconnecting', () => {
      const ws = session.connect('player-1');
      const onclose = vi.fn();
      ws.onclose = onclose;

      ws.close(1000, 'User closed');

      expect(onclose).toHaveBeenCalledWith({ code: 1000, reason: 'User closed' });
    });
  });

  describe('message handling', () => {
    it('should broadcast step toggle to all clients', async () => {
      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');

      // Initialize with a track
      session['state'].tracks = [
        {
          id: 'track-1',
          name: 'Kick',
          sampleId: 'kick',
          steps: Array(16).fill(false),
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        },
      ];

      // Wait for initial state_sync and player_joined messages
      await new Promise((r) => setTimeout(r, 10));

      const onmessage2 = vi.fn();
      ws2.onmessage = onmessage2;

      // Player 1 toggles a step
      ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 0, step: 4 }));

      // Wait for step_toggled message
      await vi.waitFor(() => {
        const calls = onmessage2.mock.calls;
        const hasStepToggled = calls.some((call) => {
          const msg = JSON.parse(call[0].data);
          return msg.type === 'step_toggled';
        });
        expect(hasStepToggled).toBe(true);
      });

      // Find the step_toggled message
      const call = onmessage2.mock.calls.find((c) => {
        return JSON.parse(c[0].data).type === 'step_toggled';
      });
      const message = JSON.parse(call![0].data);
      expect(message.playerId).toBe('player-1');
      expect(message.trackId).toBe(0);
      expect(message.step).toBe(4);
      expect(message.value).toBe(true);
    });

    it('should handle tempo change', async () => {
      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');

      // Wait for initial state_sync and player_joined messages
      await new Promise((r) => setTimeout(r, 10));

      const onmessage2 = vi.fn();
      ws2.onmessage = onmessage2;

      ws1.send(JSON.stringify({ type: 'set_tempo', tempo: 140 }));

      // Wait for tempo_changed message
      await vi.waitFor(() => {
        const calls = onmessage2.mock.calls;
        const hasTempoChanged = calls.some((call) => {
          const msg = JSON.parse(call[0].data);
          return msg.type === 'tempo_changed';
        });
        expect(hasTempoChanged).toBe(true);
      });

      // Find the tempo_changed message
      const call = onmessage2.mock.calls.find((c) => {
        return JSON.parse(c[0].data).type === 'tempo_changed';
      });
      const message = JSON.parse(call![0].data);
      expect(message.tempo).toBe(140);
      expect(session.getState().tempo).toBe(140);
    });

    it('should handle swing change', async () => {
      const ws1 = session.connect('player-1');

      ws1.send(JSON.stringify({ type: 'set_swing', swing: 50 }));

      await vi.waitFor(() => {
        expect(session.getState().swing).toBe(50);
      });
    });
  });

  describe('state sync', () => {
    it('should send initial state to new client', async () => {
      session['state'] = {
        tracks: [
          {
            id: 'track-1',
            name: 'Kick',
            sampleId: 'kick',
            steps: [true, false, false, false],
            parameterLocks: [null, null, null, null],
            volume: 1,
            muted: false,
            playbackMode: 'oneshot',
            transpose: 0,
            stepCount: 4,
          },
        ],
        tempo: 95,
        swing: 25,
        version: 1,
      };

      const ws = session.connect('player-1');
      const onmessage = vi.fn();
      ws.onmessage = onmessage;

      await vi.waitFor(() => {
        expect(onmessage).toHaveBeenCalled();
      });

      const message = JSON.parse(onmessage.mock.calls[0][0].data);
      expect(message.type).toBe('state_sync');
      expect(message.state.tempo).toBe(95);
      expect(message.state.swing).toBe(25);
      expect(message.playerCount).toBe(1);
    });
  });

  describe('player notifications', () => {
    it('should notify when player joins', async () => {
      const ws1 = session.connect('player-1');
      const onmessage1 = vi.fn();
      ws1.onmessage = onmessage1;

      // Wait for initial state sync
      await vi.waitFor(() => {
        expect(onmessage1).toHaveBeenCalled();
      });
      onmessage1.mockClear();

      // Connect second player
      session.connect('player-2');

      await vi.waitFor(() => {
        expect(onmessage1).toHaveBeenCalled();
      });

      const message = JSON.parse(onmessage1.mock.calls[0][0].data);
      expect(message.type).toBe('player_joined');
      expect(message.playerId).toBe('player-2');
      expect(message.playerCount).toBe(2);
    });

    it('should notify when player leaves', async () => {
      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');

      const onmessage1 = vi.fn();
      ws1.onmessage = onmessage1;

      // Disconnect player 2
      ws2.close();

      await vi.waitFor(() => {
        // Find the player_left message
        const calls = onmessage1.mock.calls;
        const hasPlayerLeft = calls.some((call) => {
          const msg = JSON.parse(call[0].data);
          return msg.type === 'player_left';
        });
        expect(hasPlayerLeft).toBe(true);
      });
    });
  });

  describe('latency simulation', () => {
    it('should apply simulated latency to messages', async () => {
      session.simulateLatency(100);

      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');

      const onmessage2 = vi.fn();
      ws2.onmessage = onmessage2;

      // Initialize with a track
      session['state'].tracks = [
        {
          id: 'track-1',
          name: 'Kick',
          sampleId: 'kick',
          steps: Array(16).fill(false),
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        },
      ];

      const start = Date.now();
      ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 0, step: 0 }));

      await vi.waitFor(() => {
        expect(onmessage2).toHaveBeenCalled();
      });

      const elapsed = Date.now() - start;
      // Should take at least 100ms due to latency
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow small timing variance
    });
  });

  describe('simulated disconnect', () => {
    it('should simulate connection loss', () => {
      const ws = session.connect('player-1');
      const onclose = vi.fn();
      ws.onclose = onclose;

      session.simulateDisconnect('player-1');

      expect(onclose).toHaveBeenCalledWith({ code: 1006, reason: 'Connection lost' });
      expect(session.getConnectionCount()).toBe(0);
    });
  });

  describe('debug info', () => {
    it('should return accurate debug info', () => {
      session.connect('player-1');
      session.connect('player-2');
      session.simulateLatency(50);

      const debug = session.getDebugInfo();

      expect(debug.sessionId).toBe('test-session');
      expect(debug.connectedPlayers).toBe(2);
      expect(debug.isPlaying).toBe(false);
      expect(debug.simulatedLatency).toBe(50);
    });
  });

  describe('message history', () => {
    it('should track all messages', async () => {
      const ws = session.connect('player-1');

      // Initialize with a track
      session['state'].tracks = [
        {
          id: 'track-1',
          name: 'Kick',
          sampleId: 'kick',
          steps: Array(16).fill(false),
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        },
      ];

      ws.send(JSON.stringify({ type: 'toggle_step', trackId: 0, step: 0 }));
      ws.send(JSON.stringify({ type: 'set_tempo', tempo: 130 }));

      await vi.waitFor(() => {
        const history = session.getMessageHistory();
        expect(history.length).toBeGreaterThanOrEqual(3); // connect + 2 messages
      });

      const history = session.getMessageHistory();
      expect(history[0].type).toBe('connect');
      expect(history.some((m) => m.type === 'toggle_step')).toBe(true);
      expect(history.some((m) => m.type === 'set_tempo')).toBe(true);
    });

    it('should allow clearing history', async () => {
      session.connect('player-1');

      await vi.waitFor(() => {
        expect(session.getMessageHistory().length).toBeGreaterThan(0);
      });

      session.clearMessageHistory();

      expect(session.getMessageHistory()).toEqual([]);
    });
  });
});

describe('createMockClients helper (Phase 7)', () => {
  it('should create multiple clients connected to same session', () => {
    const session = createMockSession('test');
    const clients = createMockClients(session, 5);

    expect(clients).toHaveLength(5);
    expect(session.getConnectionCount()).toBe(5);
  });

  it('should generate sequential player IDs', () => {
    const session = createMockSession('test');
    const clients = createMockClients(session, 3);

    expect(clients[0].id).toBe('player-0');
    expect(clients[1].id).toBe('player-1');
    expect(clients[2].id).toBe('player-2');
  });
});
