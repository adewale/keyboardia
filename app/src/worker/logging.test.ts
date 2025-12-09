/**
 * Phase 7: Unit tests for WebSocket logging and state hashing
 */

import { describe, it, expect } from 'vitest';
import {
  createWsConnectLog,
  createWsMessageLog,
  createWsDisconnectLog,
  hashState,
  generatePlayerId,
  type WebSocketLog,
} from './logging';

describe('WebSocket Logging (Phase 7)', () => {
  describe('generatePlayerId', () => {
    it('should generate an 8-character ID', () => {
      const id = generatePlayerId();
      expect(id).toHaveLength(8);
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generatePlayerId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('createWsConnectLog', () => {
    it('should create a connect log with correct type', () => {
      const log = createWsConnectLog('session-123', 'player-456');

      expect(log.type).toBe('ws_connect');
      expect(log.sessionId).toBe('session-123');
      expect(log.playerId).toBe('player-456');
      expect(log.timestamp).toBeDefined();
    });

    it('should not include disconnect-specific fields', () => {
      const log = createWsConnectLog('session-123', 'player-456');

      expect(log.reason).toBeUndefined();
      expect(log.duration).toBeUndefined();
    });
  });

  describe('createWsMessageLog', () => {
    it('should create a message log with correct type', () => {
      const log = createWsMessageLog('session-123', 'player-456', 'toggle_step');

      expect(log.type).toBe('ws_message');
      expect(log.sessionId).toBe('session-123');
      expect(log.playerId).toBe('player-456');
      expect(log.messageType).toBe('toggle_step');
      expect(log.timestamp).toBeDefined();
    });

    it('should include optional payload', () => {
      const payload = { trackId: 0, step: 4 };
      const log = createWsMessageLog('session-123', 'player-456', 'toggle_step', payload);

      expect(log.payload).toEqual(payload);
    });

    it('should work without payload', () => {
      const log = createWsMessageLog('session-123', 'player-456', 'ping');

      expect(log.payload).toBeUndefined();
    });
  });

  describe('createWsDisconnectLog', () => {
    it('should create a disconnect log with correct type', () => {
      const log = createWsDisconnectLog('session-123', 'player-456', 'closed', 342);

      expect(log.type).toBe('ws_disconnect');
      expect(log.sessionId).toBe('session-123');
      expect(log.playerId).toBe('player-456');
      expect(log.reason).toBe('closed');
      expect(log.duration).toBe(342);
      expect(log.timestamp).toBeDefined();
    });

    it('should handle different disconnect reasons', () => {
      const reasons = ['closed', 'timeout', 'error', 'kicked'];

      for (const reason of reasons) {
        const log = createWsDisconnectLog('session', 'player', reason, 100);
        expect(log.reason).toBe(reason);
      }
    });
  });
});

describe('State Hashing (Phase 7)', () => {
  describe('hashState', () => {
    it('should return an 8-character hex string', () => {
      const hash = hashState({ foo: 'bar' });
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should be deterministic', () => {
      const state = { tracks: [{ steps: [true, false, true] }], tempo: 120 };
      const hash1 = hashState(state);
      const hash2 = hashState(state);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different states', () => {
      const hash1 = hashState({ tempo: 120 });
      const hash2 = hashState({ tempo: 140 });

      expect(hash1).not.toBe(hash2);
    });

    it('should detect changes in nested arrays', () => {
      const state1 = { tracks: [{ steps: [true, false, false] }] };
      const state2 = { tracks: [{ steps: [true, false, true] }] };

      const hash1 = hashState(state1);
      const hash2 = hashState(state2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty state', () => {
      const hash = hashState({});
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should handle complex nested structures', () => {
      const complexState = {
        tracks: [
          {
            id: 'track-1',
            steps: Array(64).fill(false).map((_, i) => i % 4 === 0),
            parameterLocks: Array(64).fill(null),
          },
          {
            id: 'track-2',
            steps: Array(64).fill(false),
            parameterLocks: [{ pitch: 5 }, null, { volume: 0.8 }],
          },
        ],
        tempo: 95,
        swing: 25,
      };

      const hash = hashState(complexState);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should be consistent across multiple calls on same complex state', () => {
      const complexState = {
        tracks: Array(16).fill(null).map((_, i) => ({
          id: `track-${i}`,
          steps: Array(64).fill(false).map((_, j) => (i + j) % 3 === 0),
          parameterLocks: Array(64).fill(null),
          volume: 0.8 + i * 0.01,
          muted: i === 5,
        })),
        tempo: 128,
        swing: 50,
      };

      // Hash multiple times to ensure consistency
      const hashes = Array(10).fill(null).map(() => hashState(complexState));
      expect(new Set(hashes).size).toBe(1);
    });
  });
});

describe('WebSocketLog type (Phase 7)', () => {
  it('should have correct type discriminator', () => {
    const connectLog: WebSocketLog = {
      type: 'ws_connect',
      timestamp: new Date().toISOString(),
      sessionId: 'session',
      playerId: 'player',
    };

    const messageLog: WebSocketLog = {
      type: 'ws_message',
      timestamp: new Date().toISOString(),
      sessionId: 'session',
      playerId: 'player',
      messageType: 'toggle_step',
    };

    const disconnectLog: WebSocketLog = {
      type: 'ws_disconnect',
      timestamp: new Date().toISOString(),
      sessionId: 'session',
      playerId: 'player',
      reason: 'closed',
      duration: 100,
    };

    expect(connectLog.type).toBe('ws_connect');
    expect(messageLog.type).toBe('ws_message');
    expect(disconnectLog.type).toBe('ws_disconnect');
  });
});
