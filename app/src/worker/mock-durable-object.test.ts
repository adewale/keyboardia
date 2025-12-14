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
