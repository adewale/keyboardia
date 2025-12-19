/**
 * Phase 7: Tests for Mock Durable Object
 *
 * These tests verify the mock DO behaves correctly and can be used
 * for multi-client integration testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockLiveSession,
  createMockSession,
  createMockClients,
  createMockKV,
  type MockKVStore,
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
      // Phase 22: Per-player playback tracking
      expect(debug.playingPlayerIds).toEqual([]);
      expect(debug.playingCount).toBe(0);
      expect(debug.simulatedLatency).toBe(50);
    });
  });

  describe('playback presence tracking (Phase 22)', () => {
    it('should track player as playing when they send play message', async () => {
      const ws = session.connect('player-1');

      ws.send(JSON.stringify({ type: 'play' }));

      await vi.waitFor(() => {
        const debug = session.getDebugInfo();
        expect(debug.playingPlayerIds).toContain('player-1');
        expect(debug.playingCount).toBe(1);
      });
    });

    it('should remove player from playing when they send stop message', async () => {
      const ws = session.connect('player-1');

      // Start playing
      ws.send(JSON.stringify({ type: 'play' }));

      await vi.waitFor(() => {
        expect(session.getDebugInfo().playingCount).toBe(1);
      });

      // Stop playing
      ws.send(JSON.stringify({ type: 'stop' }));

      await vi.waitFor(() => {
        const debug = session.getDebugInfo();
        expect(debug.playingPlayerIds).not.toContain('player-1');
        expect(debug.playingCount).toBe(0);
      });
    });

    it('should track multiple players playing simultaneously', async () => {
      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');
      const ws3 = session.connect('player-3');

      // All three start playing
      ws1.send(JSON.stringify({ type: 'play' }));
      ws2.send(JSON.stringify({ type: 'play' }));
      ws3.send(JSON.stringify({ type: 'play' }));

      await vi.waitFor(() => {
        const debug = session.getDebugInfo();
        expect(debug.playingCount).toBe(3);
        expect(debug.playingPlayerIds).toContain('player-1');
        expect(debug.playingPlayerIds).toContain('player-2');
        expect(debug.playingPlayerIds).toContain('player-3');
      });

      // Player 2 stops
      ws2.send(JSON.stringify({ type: 'stop' }));

      await vi.waitFor(() => {
        const debug = session.getDebugInfo();
        expect(debug.playingCount).toBe(2);
        expect(debug.playingPlayerIds).toContain('player-1');
        expect(debug.playingPlayerIds).not.toContain('player-2');
        expect(debug.playingPlayerIds).toContain('player-3');
      });
    });

    it('should broadcast playback_started to other players', async () => {
      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');

      // Wait for initial state sync
      await new Promise((r) => setTimeout(r, 10));

      const onmessage2 = vi.fn();
      ws2.onmessage = onmessage2;

      // Player 1 starts playing
      ws1.send(JSON.stringify({ type: 'play' }));

      await vi.waitFor(() => {
        const calls = onmessage2.mock.calls;
        const hasPlaybackStarted = calls.some((call) => {
          const msg = JSON.parse(call[0].data);
          return msg.type === 'playback_started';
        });
        expect(hasPlaybackStarted).toBe(true);
      });

      const call = onmessage2.mock.calls.find((c) => {
        return JSON.parse(c[0].data).type === 'playback_started';
      });
      const message = JSON.parse(call![0].data);
      expect(message.playerId).toBe('player-1');
    });

    it('should broadcast playback_stopped to other players', async () => {
      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');

      // Player 1 starts then stops
      ws1.send(JSON.stringify({ type: 'play' }));

      // Wait for play to be processed
      await vi.waitFor(() => {
        expect(session.getDebugInfo().playingCount).toBe(1);
      });

      const onmessage2 = vi.fn();
      ws2.onmessage = onmessage2;

      ws1.send(JSON.stringify({ type: 'stop' }));

      await vi.waitFor(() => {
        const calls = onmessage2.mock.calls;
        const hasPlaybackStopped = calls.some((call) => {
          const msg = JSON.parse(call[0].data);
          return msg.type === 'playback_stopped';
        });
        expect(hasPlaybackStopped).toBe(true);
      });

      const call = onmessage2.mock.calls.find((c) => {
        return JSON.parse(c[0].data).type === 'playback_stopped';
      });
      const message = JSON.parse(call![0].data);
      expect(message.playerId).toBe('player-1');
    });

    it('should remove player from playing when they disconnect', async () => {
      const ws1 = session.connect('player-1');
      const ws2 = session.connect('player-2');

      // Both players start playing
      ws1.send(JSON.stringify({ type: 'play' }));
      ws2.send(JSON.stringify({ type: 'play' }));

      await vi.waitFor(() => {
        expect(session.getDebugInfo().playingCount).toBe(2);
      });

      // Player 1 disconnects (should be removed from playing)
      ws1.close();

      await vi.waitFor(() => {
        const debug = session.getDebugInfo();
        expect(debug.playingCount).toBe(1);
        expect(debug.playingPlayerIds).not.toContain('player-1');
        expect(debug.playingPlayerIds).toContain('player-2');
      });
    });

    it('should handle idempotent play messages', async () => {
      const ws = session.connect('player-1');

      // Send play multiple times
      ws.send(JSON.stringify({ type: 'play' }));
      ws.send(JSON.stringify({ type: 'play' }));
      ws.send(JSON.stringify({ type: 'play' }));

      await vi.waitFor(() => {
        expect(session.getDebugInfo().playingCount).toBe(1);
      });

      // Should still only be counted once
      expect(session.getDebugInfo().playingPlayerIds.length).toBe(1);
    });

    it('should handle stop without prior play gracefully', async () => {
      const ws = session.connect('player-1');

      // Send stop without playing first
      ws.send(JSON.stringify({ type: 'stop' }));

      // Wait for message to be processed
      await new Promise((r) => setTimeout(r, 10));

      // Should not cause issues
      expect(session.getDebugInfo().playingCount).toBe(0);
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

describe('Duplicate track prevention (Phase 11 bug fix)', () => {
  let session: MockLiveSession;

  beforeEach(() => {
    session = createMockSession('test-session');
  });

  it('should add a track with unique ID', async () => {
    const ws = session.connect('player-1');

    const newTrack = {
      id: 'track-unique-123',
      name: 'Rhodes',
      sampleId: 'synth:rhodes',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    ws.send(JSON.stringify({ type: 'add_track', track: newTrack }));

    await vi.waitFor(() => {
      expect(session.getState().tracks.length).toBe(1);
    });

    expect(session.getState().tracks[0].id).toBe('track-unique-123');
  });

  it('should reject duplicate track IDs', async () => {
    const ws = session.connect('player-1');

    const track1 = {
      id: 'track-duplicate-test',
      name: 'Rhodes 1',
      sampleId: 'synth:rhodes',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    // First add succeeds
    ws.send(JSON.stringify({ type: 'add_track', track: track1 }));

    await vi.waitFor(() => {
      expect(session.getState().tracks.length).toBe(1);
    });

    // Second add with same ID should be rejected
    const track2 = {
      ...track1,
      name: 'Rhodes 2 (duplicate)',
    };
    ws.send(JSON.stringify({ type: 'add_track', track: track2 }));

    // Wait a bit to ensure message is processed
    await new Promise((r) => setTimeout(r, 50));

    // Should still have only 1 track
    expect(session.getState().tracks.length).toBe(1);
    expect(session.getState().tracks[0].name).toBe('Rhodes 1');
  });

  it('should handle rapid duplicate adds from same client', async () => {
    const ws = session.connect('player-1');

    const track = {
      id: 'track-rapid-test',
      name: 'Rapid Track',
      sampleId: 'synth:bass',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    // Send 5 rapid add_track messages with same ID
    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ type: 'add_track', track: { ...track, name: `Track ${i}` } }));
    }

    await new Promise((r) => setTimeout(r, 100));

    // Should have only 1 track
    expect(session.getState().tracks.length).toBe(1);
    expect(session.getState().tracks[0].name).toBe('Track 0'); // First one wins
  });

  it('should handle duplicate adds from different clients', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');

    const track = {
      id: 'track-multiclient-test',
      name: 'Shared Track',
      sampleId: 'synth:lead',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    // Both clients try to add the same track
    ws1.send(JSON.stringify({ type: 'add_track', track: { ...track, name: 'From Player 1' } }));
    ws2.send(JSON.stringify({ type: 'add_track', track: { ...track, name: 'From Player 2' } }));

    await new Promise((r) => setTimeout(r, 100));

    // Should have only 1 track (whichever arrived first)
    expect(session.getState().tracks.length).toBe(1);
  });

  it('should allow tracks with different IDs', async () => {
    const ws = session.connect('player-1');

    const tracks = [
      { id: 'track-a', name: 'Track A' },
      { id: 'track-b', name: 'Track B' },
      { id: 'track-c', name: 'Track C' },
    ].map(({ id, name }) => ({
      id,
      name,
      sampleId: 'synth:bass',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    }));

    for (const track of tracks) {
      ws.send(JSON.stringify({ type: 'add_track', track }));
    }

    await vi.waitFor(() => {
      expect(session.getState().tracks.length).toBe(3);
    });

    const trackIds = session.getState().tracks.map((t) => t.id);
    expect(trackIds).toContain('track-a');
    expect(trackIds).toContain('track-b');
    expect(trackIds).toContain('track-c');
  });

  it('should enforce MAX_TRACKS (16) limit', async () => {
    const ws = session.connect('player-1');

    // Try to add 20 tracks (should only allow 16)
    for (let i = 0; i < 20; i++) {
      const track = {
        id: `track-limit-${i}`,
        name: `Track ${i}`,
        sampleId: 'synth:bass',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      };
      ws.send(JSON.stringify({ type: 'add_track', track }));
    }

    await new Promise((r) => setTimeout(r, 100));

    // Should have exactly 16 tracks (MAX_TRACKS)
    expect(session.getState().tracks.length).toBe(16);
  });

  it('reproduces the production bug: 15 duplicate Rhodes tracks', async () => {
    const ws = session.connect('player-1');

    // Add Bass track first
    const bassTrack = {
      id: 'track-bass',
      name: 'Bass',
      sampleId: 'synth:bass',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };
    ws.send(JSON.stringify({ type: 'add_track', track: bassTrack }));

    // Try to add 15 Rhodes tracks with the SAME ID (the bug scenario)
    const rhodesTrack = {
      id: 'track-rhodes-same-id',
      name: 'Rhodes',
      sampleId: 'synth:rhodes',
      steps: [true, false, true, false].concat(Array(60).fill(false)),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };

    for (let i = 0; i < 15; i++) {
      ws.send(JSON.stringify({ type: 'add_track', track: rhodesTrack }));
    }

    await new Promise((r) => setTimeout(r, 100));

    // With the fix, should only have 2 tracks (Bass + 1 Rhodes)
    expect(session.getState().tracks.length).toBe(2);

    // Verify no duplicate IDs
    const trackIds = session.getState().tracks.map((t) => t.id);
    const uniqueIds = new Set(trackIds);
    expect(uniqueIds.size).toBe(trackIds.length);
  });
});

describe('Session state integrity validation', () => {
  let session: MockLiveSession;

  beforeEach(() => {
    session = createMockSession('test-session');
  });

  /**
   * Validates that no duplicate track IDs exist in the session state
   */
  function validateNoDuplicateTrackIds(state: SessionState): boolean {
    const trackIds = state.tracks.map((t) => t.id);
    return new Set(trackIds).size === trackIds.length;
  }

  it('should maintain state integrity after multiple operations', async () => {
    const ws = session.connect('player-1');

    // Add some tracks
    for (let i = 0; i < 5; i++) {
      const track = {
        id: `track-${i}`,
        name: `Track ${i}`,
        sampleId: 'synth:bass',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      };
      ws.send(JSON.stringify({ type: 'add_track', track }));
    }

    await new Promise((r) => setTimeout(r, 50));

    // Try to add duplicates
    for (let i = 0; i < 5; i++) {
      const track = {
        id: `track-${i}`,
        name: `Duplicate Track ${i}`,
        sampleId: 'synth:lead',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      };
      ws.send(JSON.stringify({ type: 'add_track', track }));
    }

    await new Promise((r) => setTimeout(r, 50));

    // State should be valid (no duplicates)
    expect(validateNoDuplicateTrackIds(session.getState())).toBe(true);
    expect(session.getState().tracks.length).toBe(5);
  });
});

describe('KV/DO sync behavior (Phase 11)', () => {
  let session: MockLiveSession;
  let kv: MockKVStore;

  beforeEach(() => {
    vi.useFakeTimers();
    kv = createMockKV();
    session = createMockSession('sync-test-session', undefined, kv);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should schedule KV save after state change', async () => {
    const ws = session.connect('player-1');

    // Initialize with a track
    session['state'].tracks = [
      {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
    ];

    // Send a tempo change
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 140 }));

    // Advance timer to process the message (schedules KV save)
    vi.advanceTimersByTime(10);

    // Should have pending save
    expect(session.hasPendingKVSave()).toBe(true);

    // KV should not have been saved yet (debounce)
    expect(kv.saveCount).toBe(0);

    // Advance time past debounce (2 seconds)
    vi.advanceTimersByTime(5100);

    // Now KV should have been saved
    expect(kv.saveCount).toBe(1);
    expect(session.hasPendingKVSave()).toBe(false);
  });

  it('should debounce multiple rapid changes into one save', async () => {
    const ws = session.connect('player-1');

    // Initialize with a track
    session['state'].tracks = [
      {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
    ];

    // Send multiple rapid changes
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 140 }));
    vi.advanceTimersByTime(500);
    ws.send(JSON.stringify({ type: 'set_swing', swing: 25 }));
    vi.advanceTimersByTime(500);
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 150 }));
    vi.advanceTimersByTime(500);

    // Still no save yet (debounce resets with each change)
    expect(kv.saveCount).toBe(0);

    // Advance past debounce
    vi.advanceTimersByTime(5100);

    // Should have exactly one save
    expect(kv.saveCount).toBe(1);

    // Verify final state is saved
    const savedState = kv.data.get('sync-test-session');
    expect(savedState?.tempo).toBe(150);
    expect(savedState?.swing).toBe(25);
  });

  it('should save immediately when last player disconnects', async () => {
    const ws = session.connect('player-1');

    // Make a change
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 160 }));

    // Advance timer to process the message
    vi.advanceTimersByTime(10);

    // No save yet (only debounce scheduled)
    expect(kv.saveCount).toBe(0);

    // Disconnect (last player)
    ws.close();

    // Should save immediately
    expect(kv.saveCount).toBe(1);
    expect(kv.data.get('sync-test-session')?.tempo).toBe(160);
  });

  it('should not save on disconnect if not last player', async () => {
    const ws1 = session.connect('player-1');
    const _ws2 = session.connect('player-2'); // Second player keeps session alive

    // Make a change
    ws1.send(JSON.stringify({ type: 'set_tempo', tempo: 170 }));

    // Advance timer to process the message
    vi.advanceTimersByTime(10);

    // Disconnect player 1 (not last)
    ws1.close();

    // Should not have saved yet (player 2 still connected)
    expect(kv.saveCount).toBe(0);

    // Advance past debounce
    vi.advanceTimersByTime(5100);

    // Should have saved due to debounce
    expect(kv.saveCount).toBe(1);
  });

  it('should lose pending save if DO hibernates before debounce fires', async () => {
    const ws = session.connect('player-1');

    // Make a change
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 180 }));

    // Advance timer to process the message (schedules KV save)
    vi.advanceTimersByTime(10);

    // Pending save should be scheduled
    expect(session.hasPendingKVSave()).toBe(true);

    // Simulate DO hibernation (clears setTimeout)
    session.simulateHibernation();

    // Advance time past debounce
    vi.advanceTimersByTime(6000);

    // Save never happened - this is the bug we identified
    expect(kv.saveCount).toBe(0);

    // State is still marked as pending but timer is gone
    expect(session.hasPendingKVSave()).toBe(true);
  });

  it('should persist state correctly through KV on reconnection', async () => {
    // First session: add a track
    const ws1 = session.connect('player-1');

    const newTrack = {
      id: 'track-reconnect-test',
      name: 'Reconnect Track',
      sampleId: 'synth:bass',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };
    ws1.send(JSON.stringify({ type: 'add_track', track: newTrack }));

    // Advance timer to process the message (simulatedLatency is 0, but still uses setTimeout)
    vi.advanceTimersByTime(10);

    // Disconnect to trigger save
    ws1.close();

    expect(kv.saveCount).toBe(1);

    // Simulate new DO instance loading from KV
    const savedState = kv.data.get('sync-test-session');
    expect(savedState).toBeDefined();
    expect(savedState?.tracks.length).toBe(1);
    expect(savedState?.tracks[0].id).toBe('track-reconnect-test');
  });

  it('should track all save calls for debugging', async () => {
    const ws = session.connect('player-1');

    // Make changes and disconnect
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 100 }));
    vi.advanceTimersByTime(5100);

    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 110 }));
    vi.advanceTimersByTime(5100);

    // Disconnect triggers another save
    ws.close();

    // Should have 3 saves tracked
    expect(kv.saveCalls.length).toBe(3);
    expect(kv.saveCalls[0].state.tempo).toBe(100);
    expect(kv.saveCalls[1].state.tempo).toBe(110);
    expect(kv.saveCalls[2].state.tempo).toBe(110);
  });

  it('should save state with correct track data', async () => {
    const ws = session.connect('player-1');

    // Add multiple tracks
    for (let i = 0; i < 3; i++) {
      const track = {
        id: `track-${i}`,
        name: `Track ${i}`,
        sampleId: 'synth:bass',
        steps: Array(64).fill(false),
        parameterLocks: Array(64).fill(null),
        volume: 0.5 + i * 0.1,
        muted: i === 1,
        playbackMode: 'oneshot',
        transpose: i,
        stepCount: 16,
      };
      ws.send(JSON.stringify({ type: 'add_track', track }));
    }

    // Advance timer to process messages
    vi.advanceTimersByTime(10);

    // Disconnect to save
    ws.close();

    const savedState = kv.data.get('sync-test-session');
    expect(savedState?.tracks.length).toBe(3);
    expect(savedState?.tracks[1].muted).toBe(true);
    expect(savedState?.tracks[2].transpose).toBe(2);
  });

  it('should handle save to KV when no KV is attached', () => {
    // Session without KV
    const sessionNoKV = createMockSession('no-kv-session');
    const ws = sessionNoKV.connect('player-1');

    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 200 }));

    // Should not throw, just skip
    expect(sessionNoKV.hasPendingKVSave()).toBe(false);
    expect(sessionNoKV.getKV()).toBeNull();
  });
});

describe('DO hibernation and KV sync edge cases', () => {
  let kv: MockKVStore;

  beforeEach(() => {
    vi.useFakeTimers();
    kv = createMockKV();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should recover from hibernation when last player disconnects', async () => {
    const session = createMockSession('hibernation-test', undefined, kv);
    const ws = session.connect('player-1');

    // Make a change
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 190 }));

    // Advance timer to process the message
    vi.advanceTimersByTime(10);

    // Simulate hibernation
    session.simulateHibernation();

    // Normally the save would be lost, but disconnect saves immediately
    ws.close();

    // Save should happen on disconnect
    expect(kv.saveCount).toBe(1);
    expect(kv.data.get('hibernation-test')?.tempo).toBe(190);
  });

  it('should handle concurrent saves from multiple sessions', async () => {
    const session1 = createMockSession('multi-session-1', undefined, kv);
    const session2 = createMockSession('multi-session-2', undefined, kv);

    const ws1 = session1.connect('player-1');
    const ws2 = session2.connect('player-2');

    ws1.send(JSON.stringify({ type: 'set_tempo', tempo: 100 }));
    ws2.send(JSON.stringify({ type: 'set_tempo', tempo: 200 }));

    // Advance time past debounce
    vi.advanceTimersByTime(5100);

    // Both sessions should save
    expect(kv.saveCount).toBe(2);
    expect(kv.data.get('multi-session-1')?.tempo).toBe(100);
    expect(kv.data.get('multi-session-2')?.tempo).toBe(200);
  });

  it('should not lose track adds during hibernation recovery', async () => {
    const session = createMockSession('track-hibernation-test', undefined, kv);
    const ws = session.connect('player-1');

    // Add a track
    const track = {
      id: 'track-hibernation',
      name: 'Hibernation Track',
      sampleId: 'synth:bass',
      steps: Array(64).fill(false),
      parameterLocks: Array(64).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };
    ws.send(JSON.stringify({ type: 'add_track', track }));

    // Advance timer to process the message
    vi.advanceTimersByTime(10);

    // Verify track was added to DO state
    expect(session.getState().tracks.length).toBe(1);

    // Simulate hibernation
    session.simulateHibernation();

    // Force save by disconnecting
    ws.close();

    // Track should be persisted
    const savedState = kv.data.get('track-hibernation-test');
    expect(savedState?.tracks.length).toBe(1);
    expect(savedState?.tracks[0].id).toBe('track-hibernation');
  });
});

/**
 * Phase 26: Multi-player Sync Integration Tests
 *
 * These tests verify that multiple players can mutate a session simultaneously
 * and all changes are preserved without silent data loss.
 *
 * Reproduces the bug: steps added to tracks disappear silently
 */
describe('Multi-player sync - step preservation (Phase 26)', () => {
  let session: MockLiveSession;

  beforeEach(() => {
    session = createMockSession('sync-test');
    // Initialize with a track that has 16 steps
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
  });

  /**
   * Helper: Count active steps in a track
   */
  function countActiveSteps(trackId: string): number {
    const track = session.getState().tracks.find((t) => t.id === trackId);
    if (!track) return 0;
    return track.steps.filter(Boolean).length;
  }

  /**
   * Helper: Get step value at index
   */
  function getStep(trackId: string, step: number): boolean {
    const track = session.getState().tracks.find((t) => t.id === trackId);
    return track?.steps[step] ?? false;
  }

  it('should preserve steps when single player toggles multiple steps', async () => {
    const ws = session.connect('player-1');

    // Toggle steps 0, 4, 8, 12 (typical 4-on-the-floor pattern)
    for (const step of [0, 4, 8, 12]) {
      ws.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(4);
    });

    // Verify all steps are on
    expect(getStep('track-1', 0)).toBe(true);
    expect(getStep('track-1', 4)).toBe(true);
    expect(getStep('track-1', 8)).toBe(true);
    expect(getStep('track-1', 12)).toBe(true);
  });

  it('should preserve steps when two players toggle different steps simultaneously', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');

    // Player 1 toggles even steps (0, 2, 4, 6)
    for (const step of [0, 2, 4, 6]) {
      ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    // Player 2 toggles odd steps (1, 3, 5, 7)
    for (const step of [1, 3, 5, 7]) {
      ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    await vi.waitFor(() => {
      // All 8 steps should be on
      expect(countActiveSteps('track-1')).toBe(8);
    });

    // Verify all steps 0-7 are on
    for (let step = 0; step < 8; step++) {
      expect(getStep('track-1', step)).toBe(true);
    }
  });

  it('should handle interleaved step toggles from multiple players', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');
    const ws3 = session.connect('player-3');

    // Three players toggle steps in interleaved order
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 0 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 1 }));
    ws3.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 2 }));
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 3 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 4 }));
    ws3.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 5 }));

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(6);
    });

    // Verify steps 0-5 are all on
    for (let step = 0; step < 6; step++) {
      expect(getStep('track-1', step)).toBe(true);
    }
  });

  it('should handle rapid toggles on the same step (last write wins)', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');

    // Both players toggle step 0 rapidly
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 0 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 0 }));
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 0 }));

    await new Promise((r) => setTimeout(r, 50));

    // Step 0 should end up in some valid state (true or false, not undefined)
    const step0 = getStep('track-1', 0);
    expect(typeof step0).toBe('boolean');
  });

  it('should preserve all mutations in a complex multi-operation scenario', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');

    // Player 1: Add steps and change tempo
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 0 }));
    ws1.send(JSON.stringify({ type: 'set_tempo', tempo: 130 }));
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 4 }));

    // Player 2: Add different steps and change swing
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 8 }));
    ws2.send(JSON.stringify({ type: 'set_swing', swing: 25 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 12 }));

    // Player 1: More steps
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 2 }));
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 6 }));

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(6);
    });

    // Verify all state is correct
    expect(session.getState().tempo).toBe(130);
    expect(session.getState().swing).toBe(25);
    expect(getStep('track-1', 0)).toBe(true);
    expect(getStep('track-1', 2)).toBe(true);
    expect(getStep('track-1', 4)).toBe(true);
    expect(getStep('track-1', 6)).toBe(true);
    expect(getStep('track-1', 8)).toBe(true);
    expect(getStep('track-1', 12)).toBe(true);
  });

  it('should broadcast step toggles to all connected players', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');
    const ws3 = session.connect('player-3');

    // Wait for connection setup
    await new Promise((r) => setTimeout(r, 10));

    // Collect messages received by players 2 and 3
    const messagesTo2: { type: string }[] = [];
    const messagesTo3: { type: string }[] = [];

    ws2.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'step_toggled') {
        messagesTo2.push(msg);
      }
    };

    ws3.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'step_toggled') {
        messagesTo3.push(msg);
      }
    };

    // Player 1 toggles step 7
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 7 }));

    await vi.waitFor(() => {
      expect(messagesTo2.length).toBe(1);
      expect(messagesTo3.length).toBe(1);
    });

    // Both players should receive the step_toggled broadcast
    expect(messagesTo2[0].type).toBe('step_toggled');
    expect(messagesTo3[0].type).toBe('step_toggled');
  });

  it('should maintain step count after player disconnect and reconnect', async () => {
    const ws1 = session.connect('player-1');

    // Add some steps
    for (const step of [0, 4, 8, 12]) {
      ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(4);
    });

    // Disconnect
    ws1.close();

    // Verify steps are still there
    expect(countActiveSteps('track-1')).toBe(4);

    // Reconnect (new player)
    const ws2 = session.connect('player-2');

    // Add more steps
    for (const step of [2, 6, 10, 14]) {
      ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(8);
    });

    // All steps should be preserved
    for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
      expect(getStep('track-1', step)).toBe(true);
    }
  });

  it('should handle multiple tracks with simultaneous edits', async () => {
    // Add a second track
    session['state'].tracks.push({
      id: 'track-2',
      name: 'Snare',
      sampleId: 'snare',
      steps: Array(16).fill(false),
      parameterLocks: Array(16).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    });

    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');

    // Player 1 edits track-1
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 0 }));
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 4 }));

    // Player 2 edits track-2
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-2', step: 2 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-2', step: 6 }));

    // Both players edit both tracks
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-2', step: 10 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 8 }));

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(3);
      expect(countActiveSteps('track-2')).toBe(3);
    });

    // Verify track-1 has steps 0, 4, 8
    expect(getStep('track-1', 0)).toBe(true);
    expect(getStep('track-1', 4)).toBe(true);
    expect(getStep('track-1', 8)).toBe(true);

    // Verify track-2 has steps 2, 6, 10
    expect(getStep('track-2', 2)).toBe(true);
    expect(getStep('track-2', 6)).toBe(true);
    expect(getStep('track-2', 10)).toBe(true);
  });

  it('should handle add_track followed by step toggles from different players', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');

    // Player 1 adds a new track
    const newTrack = {
      id: 'track-new',
      name: 'New Track',
      sampleId: 'synth:bass',
      steps: Array(16).fill(false),
      parameterLocks: Array(16).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    };
    ws1.send(JSON.stringify({ type: 'add_track', track: newTrack }));

    await vi.waitFor(() => {
      expect(session.getState().tracks.length).toBe(2);
    });

    // Both players add steps to the new track
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-new', step: 0 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-new', step: 4 }));
    ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-new', step: 8 }));
    ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-new', step: 12 }));

    await vi.waitFor(() => {
      expect(countActiveSteps('track-new')).toBe(4);
    });

    // All steps should be preserved
    expect(getStep('track-new', 0)).toBe(true);
    expect(getStep('track-new', 4)).toBe(true);
    expect(getStep('track-new', 8)).toBe(true);
    expect(getStep('track-new', 12)).toBe(true);
  });

  it('should not lose steps during volume/mute changes', async () => {
    const ws1 = session.connect('player-1');
    const ws2 = session.connect('player-2');

    // Player 1 adds steps
    for (const step of [0, 2, 4, 6]) {
      ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    // Player 2 changes volume and mute while player 1 is adding steps
    ws2.send(JSON.stringify({ type: 'set_track_volume', trackId: 'track-1', volume: 0.5 }));
    ws2.send(JSON.stringify({ type: 'mute_track', trackId: 'track-1', muted: true }));

    // Player 1 adds more steps
    for (const step of [8, 10, 12, 14]) {
      ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    // Player 2 unmutes
    ws2.send(JSON.stringify({ type: 'mute_track', trackId: 'track-1', muted: false }));

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(8);
    });

    // All steps should be preserved
    for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
      expect(getStep('track-1', step)).toBe(true);
    }

    // Track state should reflect the changes
    const track = session.getState().tracks.find((t) => t.id === 'track-1');
    expect(track?.volume).toBe(0.5);
    expect(track?.muted).toBe(false);
  });

  it('should preserve steps when player joins mid-session', async () => {
    const ws1 = session.connect('player-1');

    // Player 1 adds steps
    for (const step of [0, 4, 8, 12]) {
      ws1.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(4);
    });

    // Player 2 joins mid-session
    const ws2 = session.connect('player-2');

    // Player 2 should see all existing steps (via snapshot)
    // and can add more steps
    for (const step of [1, 5, 9, 13]) {
      ws2.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step }));
    }

    await vi.waitFor(() => {
      expect(countActiveSteps('track-1')).toBe(8);
    });

    // All steps should exist
    for (const step of [0, 1, 4, 5, 8, 9, 12, 13]) {
      expect(getStep('track-1', step)).toBe(true);
    }
  });
});
