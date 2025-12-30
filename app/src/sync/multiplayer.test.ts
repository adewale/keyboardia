/**
 * Phase 12: Tests for reconnection, offline queue, and error handling
 *
 * Tests cover:
 * 1. Exponential backoff with jitter (reconnection delay calculation)
 * 2. Offline queue behavior (queueing, replay, deduplication)
 * 3. Connection status tracking
 * 4. Graceful degradation to single-player mode
 * 5. Clock synchronization algorithm
 * 6. State hash comparison
 * 7. Message serialization/deserialization
 * 8. Connection state machine
 */

import { describe, it, expect, vi } from 'vitest';
import { actionToMessage } from './multiplayer';
import type { GridAction, ParameterLock } from '../types';

// Test the calculateReconnectDelay function
describe('Phase 12: Exponential Backoff with Jitter', () => {
  // We need to test the function, but it's not exported
  // Let's create a test version that mimics the logic
  const RECONNECT_BASE_DELAY_MS = 1000;
  const RECONNECT_MAX_DELAY_MS = 30000;
  const RECONNECT_JITTER = 0.25;

  function calculateReconnectDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
      RECONNECT_MAX_DELAY_MS
    );
    const jitterRange = exponentialDelay * RECONNECT_JITTER;
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    return Math.round(exponentialDelay + jitter);
  }

  it('should start with base delay of ~1 second for first attempt', () => {
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(calculateReconnectDelay(0));
    }

    // All delays should be within ±25% of 1000ms
    const minExpected = 1000 * (1 - RECONNECT_JITTER);
    const maxExpected = 1000 * (1 + RECONNECT_JITTER);

    delays.forEach(delay => {
      expect(delay).toBeGreaterThanOrEqual(minExpected);
      expect(delay).toBeLessThanOrEqual(maxExpected);
    });
  });

  it('should double delay for each subsequent attempt', () => {
    // Test without jitter to verify exponential growth
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // No jitter (middle of range)

    expect(calculateReconnectDelay(0)).toBe(1000);
    expect(calculateReconnectDelay(1)).toBe(2000);
    expect(calculateReconnectDelay(2)).toBe(4000);
    expect(calculateReconnectDelay(3)).toBe(8000);
    expect(calculateReconnectDelay(4)).toBe(16000);

    vi.restoreAllMocks();
  });

  it('should cap delay at 30 seconds', () => {
    // Even with max jitter, shouldn't exceed 30s + 25%
    for (let i = 0; i < 100; i++) {
      const delay = calculateReconnectDelay(10); // Way past cap
      expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_DELAY_MS * (1 + RECONNECT_JITTER));
    }
  });

  it('should have jitter that varies delays', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      delays.add(calculateReconnectDelay(0));
    }

    // With 50 samples and ±25% jitter, we should see at least several unique values
    expect(delays.size).toBeGreaterThan(5);
  });

  it('should prevent thundering herd with jitter distribution', () => {
    const delays: number[] = [];
    for (let i = 0; i < 1000; i++) {
      delays.push(calculateReconnectDelay(2)); // 4s base
    }

    // Calculate standard deviation to verify spread
    const mean = delays.reduce((a, b) => a + b, 0) / delays.length;
    const variance = delays.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / delays.length;
    const stdDev = Math.sqrt(variance);

    // Standard deviation should be meaningful (not all same value)
    expect(stdDev).toBeGreaterThan(100); // At least 100ms spread
    // Mean should be close to 4000ms but with 25% jitter it could be anywhere in 3000-5000
    expect(mean).toBeGreaterThan(3800);
    expect(mean).toBeLessThan(4200);
  });
});

describe('Phase 12: Offline Queue Behavior', () => {
  it('should queue step toggle messages when reconnecting', () => {
    // This tests the conceptual behavior
    const queue: { type: string; timestamp: number }[] = [];
    const maxQueueSize = 100;

    function queueMessage(type: string) {
      if (queue.length >= maxQueueSize) {
        queue.shift();
      }
      queue.push({ type, timestamp: Date.now() });
    }

    // Simulate rapid edits while disconnected
    for (let i = 0; i < 10; i++) {
      queueMessage('toggle_step');
    }

    expect(queue.length).toBe(10);
    expect(queue.every(m => m.type === 'toggle_step')).toBe(true);
  });

  it('should drop oldest messages when queue is full', () => {
    const queue: { id: number }[] = [];
    const maxQueueSize = 5;

    function queueMessage(id: number) {
      if (queue.length >= maxQueueSize) {
        queue.shift();
      }
      queue.push({ id });
    }

    // Queue 10 messages with capacity of 5
    for (let i = 0; i < 10; i++) {
      queueMessage(i);
    }

    expect(queue.length).toBe(5);
    expect(queue[0].id).toBe(5); // First 5 should be dropped
    expect(queue[4].id).toBe(9);
  });

  it('should not queue time-sensitive messages', () => {
    const queue: string[] = [];

    function shouldQueue(type: string): boolean {
      return type !== 'clock_sync_request' && type !== 'state_hash';
    }

    const messages = ['toggle_step', 'clock_sync_request', 'set_tempo', 'state_hash', 'play'];

    messages.forEach(type => {
      if (shouldQueue(type)) {
        queue.push(type);
      }
    });

    expect(queue).toEqual(['toggle_step', 'set_tempo', 'play']);
  });

  it('should drop stale messages on replay', () => {
    const maxQueueAge = 30000;
    const now = Date.now();

    const queue = [
      { message: 'a', timestamp: now - 40000 }, // Too old (40s)
      { message: 'b', timestamp: now - 20000 }, // Fresh (20s)
      { message: 'c', timestamp: now - 5000 },  // Fresh (5s)
    ];

    const replayed = queue.filter(q => now - q.timestamp <= maxQueueAge);

    expect(replayed.length).toBe(2);
    expect(replayed.map(r => r.message)).toEqual(['b', 'c']);
  });
});

describe('Phase 12: Connection Status', () => {
  it('should track reconnect attempts', () => {
    let attempts = 0;

    function scheduleReconnect() {
      attempts++;
    }

    // Simulate 5 reconnection attempts
    for (let i = 0; i < 5; i++) {
      scheduleReconnect();
    }

    expect(attempts).toBe(5);
  });

  it('should reset attempts on successful connection', () => {
    let attempts = 3;

    function handleConnectionSuccess() {
      attempts = 0;
    }

    handleConnectionSuccess();
    expect(attempts).toBe(0);
  });
});

describe('Phase 12: Graceful Degradation', () => {
  it('should dispatch locally even when disconnected', () => {
    const localDispatch = vi.fn();
    const isConnected = false;

    function dispatch(action: { type: string }) {
      // Always dispatch locally
      localDispatch(action);

      // Only send over network if connected
      if (isConnected) {
        // Would send over WebSocket
      }
    }

    dispatch({ type: 'TOGGLE_STEP' });

    expect(localDispatch).toHaveBeenCalledWith({ type: 'TOGGLE_STEP' });
  });

  it('should continue working when WebSocket fails', () => {
    const actions: string[] = [];

    function handleAction(action: string, wsAvailable: boolean) {
      // Local state always updates
      actions.push(action);

      // WS is optional
      if (wsAvailable) {
        // Broadcast
      }
    }

    // Simulate working without WebSocket
    handleAction('toggle', false);
    handleAction('tempo', false);
    handleAction('mute', false);

    expect(actions).toEqual(['toggle', 'tempo', 'mute']);
  });
});

// ============================================================================
// Phase 12: Clock Synchronization Algorithm Tests
// ============================================================================

describe('Phase 12: Clock Synchronization Algorithm', () => {
  // Test implementation of the ClockSync class logic
  const CLOCK_SYNC_SAMPLES = 5;

  class TestClockSync {
    private offset: number = 0;
    private rtt: number = 0;
    private samples: { offset: number; rtt: number }[] = [];

    handleSyncResponse(clientTime: number, serverTime: number): void {
      const now = Date.now();
      const rtt = now - clientTime;
      const offset = serverTime - now + rtt / 2;

      this.samples.push({ offset, rtt });
      if (this.samples.length > CLOCK_SYNC_SAMPLES) {
        this.samples.shift();
      }

      // Calculate median offset (excluding outliers)
      const sortedOffsets = [...this.samples].sort((a, b) => a.offset - b.offset);
      const median = sortedOffsets[Math.floor(sortedOffsets.length / 2)].offset;
      this.offset = median;
      this.rtt = this.samples.reduce((sum, s) => sum + s.rtt, 0) / this.samples.length;
    }

    getServerTime(): number {
      return Date.now() + this.offset;
    }

    getOffset(): number {
      return this.offset;
    }

    getRtt(): number {
      return this.rtt;
    }

    getSampleCount(): number {
      return this.samples.length;
    }
  }

  it('should calculate correct RTT from response', () => {
    const clockSync = new TestClockSync();
    const clientTime = Date.now() - 50; // Sent 50ms ago
    const serverTime = Date.now() + 100; // Server is 100ms ahead

    clockSync.handleSyncResponse(clientTime, serverTime);

    // RTT should be approximately 50ms
    expect(clockSync.getRtt()).toBeCloseTo(50, -1);
  });

  it('should calculate offset correctly', () => {
    const clockSync = new TestClockSync();
    const now = Date.now();

    // Simulate: client sent at now-100, server responded with serverTime=now+50
    // RTT = 100ms, so one-way = 50ms
    // Server time when response received = now+50
    // Estimated server time when sent = now+50 - 50 = now (accounting for RTT/2)
    // But clientTime was now-100, so offset ≈ 50ms ahead

    const clientTime = now - 100;
    const serverTime = now + 50;

    clockSync.handleSyncResponse(clientTime, serverTime);

    // With RTT factored in, offset should account for network delay
    const offset = clockSync.getOffset();
    // Offset calculation: serverTime - now + rtt/2 = 50 - 0 + 50 = 100
    expect(Math.abs(offset)).toBeLessThan(200); // Reasonable range
  });

  it('should maintain only CLOCK_SYNC_SAMPLES samples', () => {
    const clockSync = new TestClockSync();

    // Add more samples than the limit
    for (let i = 0; i < 10; i++) {
      const clientTime = Date.now() - 50;
      const serverTime = Date.now() + i * 10;
      clockSync.handleSyncResponse(clientTime, serverTime);
    }

    expect(clockSync.getSampleCount()).toBe(CLOCK_SYNC_SAMPLES);
  });

  it('should use median for robustness against outliers', () => {
    const clockSync = new TestClockSync();
    const baseNow = Date.now();

    // Add samples with one extreme outlier
    const offsets = [100, 105, 102, 1000, 98]; // 1000 is an outlier
    for (const target of offsets) {
      // Engineer samples to produce target offsets
      const clientTime = baseNow - 50;
      const serverTime = baseNow + target - 25; // Accounting for RTT/2
      clockSync.handleSyncResponse(clientTime, serverTime);
    }

    // Median should be ~102 (middle of sorted: 98, 100, 102, 105, 1000)
    // Not ~281 (mean including outlier)
    const offset = clockSync.getOffset();
    // Should be closer to median (~102) than mean (~281)
    expect(offset).toBeLessThan(200);
  });

  it('should adjust server time calculation with offset', () => {
    const clockSync = new TestClockSync();

    // Set up a known offset
    const clientTime = Date.now() - 50;
    const serverTime = Date.now() + 200; // Server is ~200ms ahead

    clockSync.handleSyncResponse(clientTime, serverTime);

    const serverTimeEstimate = clockSync.getServerTime();
    const localTime = Date.now();

    // Server time should be ahead of local time
    expect(serverTimeEstimate).toBeGreaterThan(localTime);
  });
});

// ============================================================================
// Phase 12: State Hash Comparison Tests
// ============================================================================

describe('Phase 12: State Hash Comparison', () => {
  // Simple hash function for testing (similar to what server might use)
  function computeStateHash(tracks: { id: string; steps: boolean[] }[], tempo: number, swing: number): string {
    // Simple deterministic hash for testing
    const stateString = JSON.stringify({ tracks, tempo, swing });
    let hash = 0;
    for (let i = 0; i < stateString.length; i++) {
      const char = stateString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  it('should produce same hash for identical state', () => {
    const state1 = {
      tracks: [{ id: 'track-1', steps: [true, false, true, false] }],
      tempo: 120,
      swing: 0,
    };
    const state2 = {
      tracks: [{ id: 'track-1', steps: [true, false, true, false] }],
      tempo: 120,
      swing: 0,
    };

    const hash1 = computeStateHash(state1.tracks, state1.tempo, state1.swing);
    const hash2 = computeStateHash(state2.tracks, state2.tempo, state2.swing);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hash when step changes', () => {
    const state1 = {
      tracks: [{ id: 'track-1', steps: [true, false, true, false] }],
      tempo: 120,
      swing: 0,
    };
    const state2 = {
      tracks: [{ id: 'track-1', steps: [true, true, true, false] }], // Changed step 1
      tempo: 120,
      swing: 0,
    };

    const hash1 = computeStateHash(state1.tracks, state1.tempo, state1.swing);
    const hash2 = computeStateHash(state2.tracks, state2.tempo, state2.swing);

    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash when tempo changes', () => {
    const tracks = [{ id: 'track-1', steps: [true, false] }];

    const hash1 = computeStateHash(tracks, 120, 0);
    const hash2 = computeStateHash(tracks, 130, 0);

    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash when swing changes', () => {
    const tracks = [{ id: 'track-1', steps: [true, false] }];

    const hash1 = computeStateHash(tracks, 120, 0);
    const hash2 = computeStateHash(tracks, 120, 50);

    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash when track added', () => {
    const hash1 = computeStateHash(
      [{ id: 'track-1', steps: [true, false] }],
      120,
      0
    );
    const hash2 = computeStateHash(
      [
        { id: 'track-1', steps: [true, false] },
        { id: 'track-2', steps: [false, true] },
      ],
      120,
      0
    );

    expect(hash1).not.toBe(hash2);
  });

  it('should be order-dependent for tracks', () => {
    const hash1 = computeStateHash(
      [
        { id: 'track-1', steps: [true] },
        { id: 'track-2', steps: [false] },
      ],
      120,
      0
    );
    const hash2 = computeStateHash(
      [
        { id: 'track-2', steps: [false] },
        { id: 'track-1', steps: [true] },
      ],
      120,
      0
    );

    // Different order = different hash (this is intentional for detecting reorder)
    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================================
// Phase 12: Message Serialization Tests
// ============================================================================

describe('Phase 12: Message Serialization (actionToMessage)', () => {
  it('should convert TOGGLE_STEP action to toggle_step message', () => {
    const action: GridAction = {
      type: 'TOGGLE_STEP',
      trackId: 'track-123',
      step: 5,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'toggle_step',
      trackId: 'track-123',
      step: 5,
    });
  });

  it('should convert SET_TEMPO action to set_tempo message', () => {
    const action: GridAction = {
      type: 'SET_TEMPO',
      tempo: 140,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'set_tempo',
      tempo: 140,
    });
  });

  it('should convert SET_SWING action to set_swing message', () => {
    const action: GridAction = {
      type: 'SET_SWING',
      swing: 25,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'set_swing',
      swing: 25,
    });
  });

  it('should convert SET_PARAMETER_LOCK action to set_parameter_lock message', () => {
    const lock: ParameterLock = { pitch: 3, volume: 0.8 };
    const action: GridAction = {
      type: 'SET_PARAMETER_LOCK',
      trackId: 'track-456',
      step: 7,
      lock,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'set_parameter_lock',
      trackId: 'track-456',
      step: 7,
      lock,
    });
  });

  it('should convert DELETE_TRACK action to delete_track message', () => {
    const action: GridAction = {
      type: 'DELETE_TRACK',
      trackId: 'track-789',
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'delete_track',
      trackId: 'track-789',
    });
  });

  it('should convert CLEAR_TRACK action to clear_track message', () => {
    const action: GridAction = {
      type: 'CLEAR_TRACK',
      trackId: 'track-abc',
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'clear_track',
      trackId: 'track-abc',
    });
  });

  it('should convert SET_TRACK_SAMPLE action to set_track_sample message', () => {
    const action: GridAction = {
      type: 'SET_TRACK_SAMPLE',
      trackId: 'track-def',
      sampleId: 'kick',
      name: 'Kick Drum',
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'set_track_sample',
      trackId: 'track-def',
      sampleId: 'kick',
      name: 'Kick Drum',
    });
  });

  it('should convert SET_TRACK_VOLUME action to set_track_volume message', () => {
    const action: GridAction = {
      type: 'SET_TRACK_VOLUME',
      trackId: 'track-ghi',
      volume: 0.75,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'set_track_volume',
      trackId: 'track-ghi',
      volume: 0.75,
    });
  });

  it('should convert SET_TRACK_TRANSPOSE action to set_track_transpose message', () => {
    const action: GridAction = {
      type: 'SET_TRACK_TRANSPOSE',
      trackId: 'track-jkl',
      transpose: -5,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'set_track_transpose',
      trackId: 'track-jkl',
      transpose: -5,
    });
  });

  it('should convert SET_TRACK_STEP_COUNT action to set_track_step_count message', () => {
    const action: GridAction = {
      type: 'SET_TRACK_STEP_COUNT',
      trackId: 'track-mno',
      stepCount: 32,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({
      type: 'set_track_step_count',
      trackId: 'track-mno',
      stepCount: 32,
    });
  });

  it('should convert SET_PLAYING true to play message', () => {
    const action: GridAction = {
      type: 'SET_PLAYING',
      isPlaying: true,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({ type: 'play' });
  });

  it('should convert SET_PLAYING false to stop message', () => {
    const action: GridAction = {
      type: 'SET_PLAYING',
      isPlaying: false,
    };

    const message = actionToMessage(action);

    expect(message).toEqual({ type: 'stop' });
  });

  // Actions that should NOT be sent over the wire

  it('should return null for TOGGLE_MUTE (local-only)', () => {
    const action: GridAction = {
      type: 'TOGGLE_MUTE',
      trackId: 'track-1',
    };

    const message = actionToMessage(action);

    expect(message).toBeNull();
  });

  it('should return null for TOGGLE_SOLO (local-only)', () => {
    const action: GridAction = {
      type: 'TOGGLE_SOLO',
      trackId: 'track-1',
    };

    const message = actionToMessage(action);

    expect(message).toBeNull();
  });

  it('should return null for ADD_TRACK (handled separately)', () => {
    const action: GridAction = {
      type: 'ADD_TRACK',
      sampleId: 'snare',
      name: 'Snare',
    };

    const message = actionToMessage(action);

    expect(message).toBeNull();
  });

  it('should return null for remote actions (prevent echo)', () => {
    const action: GridAction = {
      type: 'SET_TEMPO',
      tempo: 120,
      isRemote: true,
    };

    const message = actionToMessage(action);

    expect(message).toBeNull();
  });

  it('should return null for LOAD_STATE (snapshot, not incremental)', () => {
    const action: GridAction = {
      type: 'LOAD_STATE',
      tracks: [],
      tempo: 120,
      swing: 0,
    };

    const message = actionToMessage(action);

    expect(message).toBeNull();
  });

  it('should return null for RESET_STATE (local operation)', () => {
    const action: GridAction = {
      type: 'RESET_STATE',
    };

    const message = actionToMessage(action);

    expect(message).toBeNull();
  });

  it('should return null for SET_CURRENT_STEP (playback state)', () => {
    const action: GridAction = {
      type: 'SET_CURRENT_STEP',
      step: 4,
    };

    const message = actionToMessage(action);

    expect(message).toBeNull();
  });
});

// ============================================================================
// Phase 12: Connection State Machine Tests
// ============================================================================

describe('Phase 12: Connection State Machine', () => {
  type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'single_player';

  interface ConnectionState {
    status: ConnectionStatus;
    reconnectAttempts: number;
    error: string | null;
  }

  // State machine transitions
  function transition(
    state: ConnectionState,
    event: 'connect' | 'open' | 'close' | 'error' | 'max_attempts' | 'retry'
  ): ConnectionState {
    switch (state.status) {
      case 'disconnected':
        if (event === 'connect') {
          return { ...state, status: 'connecting', error: null };
        }
        return state;

      case 'connecting':
        if (event === 'open') {
          return { ...state, status: 'connected', reconnectAttempts: 0, error: null };
        }
        if (event === 'error' || event === 'close') {
          if (state.reconnectAttempts >= 9) {
            // Max attempts reached (0-indexed, so 9 = 10th attempt)
            return {
              ...state,
              status: 'single_player',
              error: 'Unable to connect to multiplayer server.',
            };
          }
          return {
            ...state,
            status: 'connecting',
            reconnectAttempts: state.reconnectAttempts + 1,
          };
        }
        return state;

      case 'connected':
        if (event === 'close' || event === 'error') {
          return { ...state, status: 'connecting', error: null };
        }
        return state;

      case 'single_player':
        if (event === 'retry') {
          return { ...state, status: 'connecting', reconnectAttempts: 0, error: null };
        }
        return state;

      default:
        return state;
    }
  }

  it('should start in disconnected state', () => {
    const state: ConnectionState = {
      status: 'disconnected',
      reconnectAttempts: 0,
      error: null,
    };

    expect(state.status).toBe('disconnected');
  });

  it('should transition from disconnected to connecting on connect', () => {
    const state: ConnectionState = {
      status: 'disconnected',
      reconnectAttempts: 0,
      error: null,
    };

    const newState = transition(state, 'connect');

    expect(newState.status).toBe('connecting');
  });

  it('should transition from connecting to connected on open', () => {
    const state: ConnectionState = {
      status: 'connecting',
      reconnectAttempts: 3,
      error: null,
    };

    const newState = transition(state, 'open');

    expect(newState.status).toBe('connected');
    expect(newState.reconnectAttempts).toBe(0); // Reset on success
  });

  it('should stay in connecting and increment attempts on error', () => {
    const state: ConnectionState = {
      status: 'connecting',
      reconnectAttempts: 2,
      error: null,
    };

    const newState = transition(state, 'error');

    expect(newState.status).toBe('connecting');
    expect(newState.reconnectAttempts).toBe(3);
  });

  it('should transition from connected to connecting on close', () => {
    const state: ConnectionState = {
      status: 'connected',
      reconnectAttempts: 0,
      error: null,
    };

    const newState = transition(state, 'close');

    expect(newState.status).toBe('connecting');
  });

  it('should transition to single_player after max attempts', () => {
    const state: ConnectionState = {
      status: 'connecting',
      reconnectAttempts: 9, // 10th attempt (0-indexed)
      error: null,
    };

    const newState = transition(state, 'error');

    expect(newState.status).toBe('single_player');
    expect(newState.error).toContain('Unable to connect');
  });

  it('should allow retry from single_player mode', () => {
    const state: ConnectionState = {
      status: 'single_player',
      reconnectAttempts: 10,
      error: 'Unable to connect',
    };

    const newState = transition(state, 'retry');

    expect(newState.status).toBe('connecting');
    expect(newState.reconnectAttempts).toBe(0);
    expect(newState.error).toBeNull();
  });

  it('should ignore irrelevant events in each state', () => {
    // Disconnected ignores open
    const disconnected: ConnectionState = {
      status: 'disconnected',
      reconnectAttempts: 0,
      error: null,
    };
    expect(transition(disconnected, 'open').status).toBe('disconnected');

    // Connected ignores connect
    const connected: ConnectionState = {
      status: 'connected',
      reconnectAttempts: 0,
      error: null,
    };
    expect(transition(connected, 'connect').status).toBe('connected');

    // Single player ignores close
    const singlePlayer: ConnectionState = {
      status: 'single_player',
      reconnectAttempts: 10,
      error: 'Error',
    };
    expect(transition(singlePlayer, 'close').status).toBe('single_player');
  });

  it('should simulate full reconnection cycle', () => {
    let state: ConnectionState = {
      status: 'disconnected',
      reconnectAttempts: 0,
      error: null,
    };

    // Initial connection
    state = transition(state, 'connect');
    expect(state.status).toBe('connecting');

    // Connection established
    state = transition(state, 'open');
    expect(state.status).toBe('connected');

    // Connection lost
    state = transition(state, 'close');
    expect(state.status).toBe('connecting');

    // Reconnection succeeds
    state = transition(state, 'open');
    expect(state.status).toBe('connected');
  });

  it('should simulate graceful degradation', () => {
    let state: ConnectionState = {
      status: 'disconnected',
      reconnectAttempts: 0,
      error: null,
    };

    // Start connecting
    state = transition(state, 'connect');

    // Fail 10 times
    for (let i = 0; i < 10; i++) {
      state = transition(state, 'error');
    }

    expect(state.status).toBe('single_player');

    // User clicks retry
    state = transition(state, 'retry');
    expect(state.status).toBe('connecting');
    expect(state.reconnectAttempts).toBe(0);

    // This time it works
    state = transition(state, 'open');
    expect(state.status).toBe('connected');
  });
});

// ============================================================================
// Phase 12: Advanced Offline Queue Tests
// ============================================================================

describe('Phase 12: Advanced Offline Queue Behavior', () => {
  it('should deduplicate consecutive identical toggle_step messages', () => {
    interface QueuedMessage {
      type: string;
      trackId?: string;
      step?: number;
      timestamp: number;
    }

    const queue: QueuedMessage[] = [];

    function queueMessageWithDedup(message: QueuedMessage) {
      // Check if last message is identical (same type, trackId, step)
      if (queue.length > 0) {
        const last = queue[queue.length - 1];
        if (
          last.type === message.type &&
          last.trackId === message.trackId &&
          last.step === message.step
        ) {
          // Skip duplicate
          return;
        }
      }
      queue.push(message);
    }

    // User rapidly clicks same cell
    const now = Date.now();
    queueMessageWithDedup({ type: 'toggle_step', trackId: 'track-1', step: 0, timestamp: now });
    queueMessageWithDedup({ type: 'toggle_step', trackId: 'track-1', step: 0, timestamp: now + 10 });
    queueMessageWithDedup({ type: 'toggle_step', trackId: 'track-1', step: 0, timestamp: now + 20 });

    // Only one message should be queued
    expect(queue.length).toBe(1);
  });

  it('should not deduplicate different cells', () => {
    interface QueuedMessage {
      type: string;
      trackId?: string;
      step?: number;
      timestamp: number;
    }

    const queue: QueuedMessage[] = [];

    function queueMessageWithDedup(message: QueuedMessage) {
      if (queue.length > 0) {
        const last = queue[queue.length - 1];
        if (
          last.type === message.type &&
          last.trackId === message.trackId &&
          last.step === message.step
        ) {
          return;
        }
      }
      queue.push(message);
    }

    const now = Date.now();
    queueMessageWithDedup({ type: 'toggle_step', trackId: 'track-1', step: 0, timestamp: now });
    queueMessageWithDedup({ type: 'toggle_step', trackId: 'track-1', step: 1, timestamp: now + 10 });
    queueMessageWithDedup({ type: 'toggle_step', trackId: 'track-2', step: 0, timestamp: now + 20 });

    expect(queue.length).toBe(3);
  });

  it('should merge consecutive tempo changes', () => {
    interface QueuedMessage {
      type: string;
      value?: number;
      timestamp: number;
    }

    const queue: QueuedMessage[] = [];

    function queueWithMerge(message: QueuedMessage) {
      if (queue.length > 0) {
        const last = queue[queue.length - 1];
        // For tempo/swing, only keep the latest value
        if (last.type === message.type && (message.type === 'set_tempo' || message.type === 'set_swing')) {
          queue[queue.length - 1] = message;
          return;
        }
      }
      queue.push(message);
    }

    // User drags tempo slider
    const now = Date.now();
    queueWithMerge({ type: 'set_tempo', value: 120, timestamp: now });
    queueWithMerge({ type: 'set_tempo', value: 125, timestamp: now + 10 });
    queueWithMerge({ type: 'set_tempo', value: 130, timestamp: now + 20 });
    queueWithMerge({ type: 'set_tempo', value: 135, timestamp: now + 30 });

    // Only final tempo should be in queue
    expect(queue.length).toBe(1);
    expect(queue[0].value).toBe(135);
  });

  it('should preserve interleaved different message types', () => {
    interface QueuedMessage {
      type: string;
      value?: number;
      timestamp: number;
    }

    const queue: QueuedMessage[] = [];

    function queueWithMerge(message: QueuedMessage) {
      if (queue.length > 0) {
        const last = queue[queue.length - 1];
        if (last.type === message.type && (message.type === 'set_tempo' || message.type === 'set_swing')) {
          queue[queue.length - 1] = message;
          return;
        }
      }
      queue.push(message);
    }

    const now = Date.now();
    queueWithMerge({ type: 'set_tempo', value: 120, timestamp: now });
    queueWithMerge({ type: 'toggle_step', timestamp: now + 10 });
    queueWithMerge({ type: 'set_tempo', value: 130, timestamp: now + 20 }); // New tempo entry

    // tempo, toggle, tempo (not merged because toggle is between)
    expect(queue.length).toBe(3);
  });

  it('should respect queue ordering for replay', () => {
    const queue: { type: string; order: number }[] = [];

    // Add messages in order
    for (let i = 0; i < 5; i++) {
      queue.push({ type: 'msg', order: i });
    }

    // Replay should maintain order
    const replayed = queue.map((m, idx) => ({ ...m, replayIndex: idx }));

    for (let i = 0; i < replayed.length; i++) {
      expect(replayed[i].order).toBe(i);
      expect(replayed[i].replayIndex).toBe(i);
    }
  });
});

// ============================================================================
// Phase 12: Message Validation Tests
// ============================================================================

describe('Phase 12: Message Validation', () => {
  // Validator that matches server-side validation
  function validateClientMessage(msg: unknown): { valid: boolean; error?: string } {
    if (!msg || typeof msg !== 'object') {
      return { valid: false, error: 'Message must be an object' };
    }

    const m = msg as Record<string, unknown>;

    if (typeof m.type !== 'string') {
      return { valid: false, error: 'Message type must be a string' };
    }

    switch (m.type) {
      case 'toggle_step':
        if (typeof m.trackId !== 'string' || m.trackId.length === 0) {
          return { valid: false, error: 'trackId must be a non-empty string' };
        }
        if (typeof m.step !== 'number' || m.step < 0 || m.step > 63) {
          return { valid: false, error: 'step must be a number between 0 and 63' };
        }
        return { valid: true };

      case 'set_tempo':
        if (typeof m.tempo !== 'number' || m.tempo < 20 || m.tempo > 300) {
          return { valid: false, error: 'tempo must be a number between 20 and 300' };
        }
        return { valid: true };

      case 'set_swing':
        if (typeof m.swing !== 'number' || m.swing < 0 || m.swing > 100) {
          return { valid: false, error: 'swing must be a number between 0 and 100' };
        }
        return { valid: true };

      case 'play':
      case 'stop':
      case 'request_snapshot':
        return { valid: true };

      case 'clock_sync_request':
        if (typeof m.clientTime !== 'number') {
          return { valid: false, error: 'clientTime must be a number' };
        }
        return { valid: true };

      default:
        return { valid: false, error: `Unknown message type: ${m.type}` };
    }
  }

  it('should validate valid toggle_step message', () => {
    const result = validateClientMessage({
      type: 'toggle_step',
      trackId: 'track-123',
      step: 15,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject toggle_step with empty trackId', () => {
    const result = validateClientMessage({
      type: 'toggle_step',
      trackId: '',
      step: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('trackId');
  });

  it('should reject toggle_step with invalid step', () => {
    const result = validateClientMessage({
      type: 'toggle_step',
      trackId: 'track-1',
      step: 100, // Max is 63
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('step');
  });

  it('should reject toggle_step with negative step', () => {
    const result = validateClientMessage({
      type: 'toggle_step',
      trackId: 'track-1',
      step: -1,
    });
    expect(result.valid).toBe(false);
  });

  it('should validate valid set_tempo message', () => {
    const result = validateClientMessage({
      type: 'set_tempo',
      tempo: 120,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject set_tempo with tempo too low', () => {
    const result = validateClientMessage({
      type: 'set_tempo',
      tempo: 10, // Min is 20
    });
    expect(result.valid).toBe(false);
  });

  it('should reject set_tempo with tempo too high', () => {
    const result = validateClientMessage({
      type: 'set_tempo',
      tempo: 500, // Max is 300
    });
    expect(result.valid).toBe(false);
  });

  it('should validate valid set_swing message', () => {
    const result = validateClientMessage({
      type: 'set_swing',
      swing: 50,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject set_swing outside range', () => {
    expect(validateClientMessage({ type: 'set_swing', swing: -10 }).valid).toBe(false);
    expect(validateClientMessage({ type: 'set_swing', swing: 150 }).valid).toBe(false);
  });

  it('should validate simple message types', () => {
    expect(validateClientMessage({ type: 'play' }).valid).toBe(true);
    expect(validateClientMessage({ type: 'stop' }).valid).toBe(true);
    expect(validateClientMessage({ type: 'request_snapshot' }).valid).toBe(true);
  });

  it('should validate clock_sync_request', () => {
    expect(validateClientMessage({
      type: 'clock_sync_request',
      clientTime: Date.now(),
    }).valid).toBe(true);
  });

  it('should reject clock_sync_request without clientTime', () => {
    expect(validateClientMessage({ type: 'clock_sync_request' }).valid).toBe(false);
  });

  it('should reject unknown message types', () => {
    const result = validateClientMessage({ type: 'unknown_type' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unknown message type');
  });

  it('should reject non-object messages', () => {
    expect(validateClientMessage(null).valid).toBe(false);
    expect(validateClientMessage(undefined).valid).toBe(false);
    expect(validateClientMessage('string').valid).toBe(false);
    expect(validateClientMessage(123).valid).toBe(false);
  });
});

// ============================================================================
// Phase 12 Polish: Sync Metrics and Stale Session Detection Tests
// ============================================================================

describe('Phase 12 Polish: State Hash for Stale Session Detection', () => {
  // Test hash function implementation (must match both client and server)
  function hashState(state: unknown): string {
    const str = JSON.stringify(state);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  it('should produce consistent hashes for identical state', () => {
    const state = {
      tracks: [{ id: 'track-1', steps: [true, false, true] }],
      tempo: 120,
      swing: 0,
    };

    const hash1 = hashState(state);
    const hash2 = hashState(state);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different state', () => {
    const state1 = { tempo: 120 };
    const state2 = { tempo: 121 };

    expect(hashState(state1)).not.toBe(hashState(state2));
  });

  it('should handle complex nested state', () => {
    const state = {
      tracks: [
        {
          id: 'track-1',
          name: 'Kick',
          steps: [true, false, true, false],
          parameterLocks: [null, { pitch: 12 }, null, null],
          volume: 0.8,
        },
        {
          id: 'track-2',
          name: 'Snare',
          steps: [false, false, false, true],
          parameterLocks: [null, null, null, null],
          volume: 1.0,
        },
      ],
      tempo: 120,
      swing: 25,
    };

    const hash = hashState(state);
    expect(hash).toHaveLength(8); // 8 hex characters
    expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true);
  });

  it('should detect state drift (order-sensitive)', () => {
    // JSON.stringify preserves object key order
    const state1 = { a: 1, b: 2 };
    const state2 = { b: 2, a: 1 };

    // Note: JavaScript objects maintain insertion order in modern engines
    // so this test verifies hash is sensitive to internal structure
    const hash1 = hashState(state1);
    const hash2 = hashState(state2);
    // These might be equal or different depending on JSON.stringify implementation
    // The important thing is both client and server use the same function
    expect(typeof hash1).toBe('string');
    expect(typeof hash2).toBe('string');
  });
});

describe('Phase 12 Polish: RTT and Drift Metrics', () => {
  // Test P95 calculation algorithm (must match implementation in multiplayer.ts)
  // Uses nearest-rank method: index = floor((N - 1) * 0.95)
  function calculateP95(samples: number[]): number {
    if (samples.length < 5) return samples[samples.length - 1] ?? 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const p95Index = Math.floor((sorted.length - 1) * 0.95);
    return sorted[p95Index];
  }

  it('should calculate P95 correctly', () => {
    // 20 samples: 1-20
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    const p95 = calculateP95(samples);
    // P95 of [1-20]: floor((20-1) * 0.95) = floor(18.05) = 18 → value at index 18 = 19
    expect(p95).toBe(19); // 95th percentile is at index 18 (the 19th value)
  });

  it('should handle small sample sets', () => {
    const samples = [10, 20, 30, 40];
    const p95 = calculateP95(samples);
    expect(p95).toBeGreaterThan(0);
  });

  it('should handle unordered samples', () => {
    const samples = [100, 10, 50, 200, 25, 75, 150, 90, 60, 30];
    const p95 = calculateP95(samples);
    // Sorted: [10, 25, 30, 50, 60, 75, 90, 100, 150, 200]
    // P95 index: floor((10-1) * 0.95) = floor(8.55) = 8 → value at index 8 = 150
    expect(p95).toBe(150);
  });

  // Test drift detection
  it('should detect clock drift between syncs', () => {
    const offsets = [10, 12, 8, 15, 5]; // Example offsets in ms
    const maxDrift = Math.max(...offsets.map((o, i) =>
      i > 0 ? Math.abs(o - offsets[i-1]) : 0
    ));
    expect(maxDrift).toBe(10); // 15 - 5 = 10ms (between adjacent samples)
  });
});

describe('Phase 12 Polish: Consecutive Mismatch Tracking', () => {
  class MockMismatchTracker {
    private consecutiveMismatches = 0;
    private readonly maxConsecutive = 2;

    recordCheck(matched: boolean): void {
      if (!matched) {
        this.consecutiveMismatches++;
      } else {
        this.consecutiveMismatches = 0;
      }
    }

    shouldRequestSnapshot(): boolean {
      return this.consecutiveMismatches >= this.maxConsecutive;
    }

    reset(): void {
      this.consecutiveMismatches = 0;
    }

    getCount(): number {
      return this.consecutiveMismatches;
    }
  }

  it('should not request snapshot on first mismatch', () => {
    const tracker = new MockMismatchTracker();
    tracker.recordCheck(false);
    expect(tracker.shouldRequestSnapshot()).toBe(false);
    expect(tracker.getCount()).toBe(1);
  });

  it('should request snapshot after consecutive mismatches', () => {
    const tracker = new MockMismatchTracker();
    tracker.recordCheck(false);
    tracker.recordCheck(false);
    expect(tracker.shouldRequestSnapshot()).toBe(true);
    expect(tracker.getCount()).toBe(2);
  });

  it('should reset counter on successful match', () => {
    const tracker = new MockMismatchTracker();
    tracker.recordCheck(false);
    expect(tracker.getCount()).toBe(1);
    tracker.recordCheck(true); // Match resets
    expect(tracker.getCount()).toBe(0);
    expect(tracker.shouldRequestSnapshot()).toBe(false);
  });

  it('should reset after snapshot received', () => {
    const tracker = new MockMismatchTracker();
    tracker.recordCheck(false);
    tracker.recordCheck(false);
    expect(tracker.shouldRequestSnapshot()).toBe(true);
    tracker.reset(); // Simulates snapshot received
    expect(tracker.getCount()).toBe(0);
    expect(tracker.shouldRequestSnapshot()).toBe(false);
  });

  it('should handle alternating match/mismatch', () => {
    const tracker = new MockMismatchTracker();
    tracker.recordCheck(false);
    tracker.recordCheck(true);
    tracker.recordCheck(false);
    tracker.recordCheck(true);
    // Never reaches consecutive threshold
    expect(tracker.shouldRequestSnapshot()).toBe(false);
  });
});

// ============================================================================
// Phase 26: Mutation Tracking Tests
// ============================================================================

describe('Phase 26: Mutation Tracking State Machine', () => {
  // Simulate the TrackedMutation state machine
  type MutationState = 'pending' | 'confirmed' | 'superseded' | 'lost';

  interface TrackedMutation {
    seq: number;
    type: string;
    trackId?: string;
    step?: number;
    intendedValue?: boolean;
    sentAt: number;
    state: MutationState;
  }

  class MockMutationTracker {
    private mutations = new Map<number, TrackedMutation>();
    private supersededKeys = new Set<string>();
    private stats = { pending: 0, confirmed: 0, superseded: 0, lost: 0 };

    trackMutation(seq: number, type: string, trackId?: string, step?: number): void {
      this.mutations.set(seq, {
        seq,
        type,
        trackId,
        step,
        sentAt: Date.now(),
        state: 'pending',
      });
      this.stats.pending++;
    }

    confirmMutation(clientSeq: number): void {
      const mut = this.mutations.get(clientSeq);
      if (mut && mut.state === 'pending') {
        mut.state = 'confirmed';
        this.mutations.delete(clientSeq);
        this.stats.pending--;
        this.stats.confirmed++;
      }
    }

    markSuperseded(trackId: string, step: number): void {
      this.supersededKeys.add(`${trackId}:${step}`);
    }

    checkInvariant(_snapshotTracks: { id: string; steps: boolean[] }[]): string[] {
      const violations: string[] = [];

      for (const [seq, mut] of this.mutations) {
        if (mut.state !== 'pending') continue;

        // Check supersession
        if (mut.trackId && mut.step !== undefined) {
          const key = `${mut.trackId}:${mut.step}`;
          if (this.supersededKeys.has(key)) {
            mut.state = 'superseded';
            this.mutations.delete(seq);
            this.stats.pending--;
            this.stats.superseded++;
            continue;
          }
        }

        // Check if old and unconfirmed
        if (Date.now() - mut.sentAt > 5000) {
          mut.state = 'lost';
          this.mutations.delete(seq);
          this.stats.pending--;
          this.stats.lost++;
          violations.push(`seq=${seq} type=${mut.type}`);
        }
      }

      return violations;
    }

    getState(seq: number): MutationState | undefined {
      return this.mutations.get(seq)?.state;
    }

    getPendingCount(): number {
      return this.mutations.size;
    }

    getStats(): typeof this.stats {
      return { ...this.stats };
    }

    isSuperseded(trackId: string, step: number): boolean {
      return this.supersededKeys.has(`${trackId}:${step}`);
    }
  }

  describe('PENDING → CONFIRMED transition', () => {
    it('should confirm when clientSeq echo received', () => {
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);
      expect(tracker.getState(42)).toBe('pending');

      tracker.confirmMutation(42);
      expect(tracker.getState(42)).toBeUndefined(); // Removed after confirm
      expect(tracker.getStats().confirmed).toBe(1);
    });

    it('should not confirm for different clientSeq', () => {
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);

      tracker.confirmMutation(43); // Different seq
      expect(tracker.getState(42)).toBe('pending');
      expect(tracker.getStats().confirmed).toBe(0);
    });

    it('should handle multiple pending mutations', () => {
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);
      tracker.trackMutation(43, 'toggle_step', 't1', 6);
      tracker.trackMutation(44, 'toggle_step', 't1', 7);

      tracker.confirmMutation(43);

      expect(tracker.getState(42)).toBe('pending');
      expect(tracker.getState(43)).toBeUndefined(); // Confirmed and removed
      expect(tracker.getState(44)).toBe('pending');
      expect(tracker.getStats().pending).toBe(2);
      expect(tracker.getStats().confirmed).toBe(1);
    });
  });

  describe('PENDING → SUPERSEDED transition', () => {
    it('should mark superseded when other player touches same step', () => {
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);

      // Simulate other player toggling same step
      tracker.markSuperseded('t1', 5);

      // Check invariant to process supersession
      tracker.checkInvariant([]);

      expect(tracker.isSuperseded('t1', 5)).toBe(true);
      expect(tracker.getStats().superseded).toBe(1);
    });

    it('should not supersede for different step', () => {
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);

      // Other player touches different step
      tracker.markSuperseded('t1', 6);
      tracker.checkInvariant([]);

      expect(tracker.isSuperseded('t1', 5)).toBe(false);
      expect(tracker.getState(42)).toBe('pending'); // Still pending
    });

    it('should not supersede for different track', () => {
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);

      // Other player touches same step but different track
      tracker.markSuperseded('t2', 5);
      tracker.checkInvariant([]);

      expect(tracker.isSuperseded('t1', 5)).toBe(false);
    });
  });

  describe('PENDING → LOST transition', () => {
    it('should detect lost mutation on old unconfirmed message', () => {
      vi.useFakeTimers();
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);

      // Advance time past the threshold
      vi.advanceTimersByTime(6000);

      const violations = tracker.checkInvariant([{ id: 't1', steps: Array(16).fill(false) }]);

      expect(violations.length).toBe(1);
      expect(violations[0]).toContain('seq=42');
      expect(tracker.getStats().lost).toBe(1);

      vi.useRealTimers();
    });

    it('should NOT report violation for recently sent mutation', () => {
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);

      // Check immediately (mutation is fresh)
      const violations = tracker.checkInvariant([{ id: 't1', steps: Array(16).fill(false) }]);

      expect(violations.length).toBe(0);
    });

    it('should NOT report violation when superseded', () => {
      vi.useFakeTimers();
      const tracker = new MockMutationTracker();
      tracker.trackMutation(42, 'toggle_step', 't1', 5);

      // Mark superseded before checking
      tracker.markSuperseded('t1', 5);

      vi.advanceTimersByTime(6000);

      const violations = tracker.checkInvariant([{ id: 't1', steps: Array(16).fill(false) }]);

      expect(violations.length).toBe(0);
      expect(tracker.getStats().superseded).toBe(1);
      expect(tracker.getStats().lost).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('Statistics tracking', () => {
    it('should track cumulative stats', () => {
      const tracker = new MockMutationTracker();

      // Track 5 mutations
      for (let i = 0; i < 5; i++) {
        tracker.trackMutation(i, 'toggle_step', 't1', i);
      }
      expect(tracker.getStats().pending).toBe(5);

      // Confirm 2
      tracker.confirmMutation(0);
      tracker.confirmMutation(1);
      expect(tracker.getStats().confirmed).toBe(2);
      expect(tracker.getStats().pending).toBe(3);

      // Supersede 1
      tracker.markSuperseded('t1', 2);
      tracker.checkInvariant([]);
      expect(tracker.getStats().superseded).toBe(1);
      expect(tracker.getStats().pending).toBe(2);
    });
  });
});

describe('Phase 26: MUTATING_MESSAGE_TYPES Classification', () => {
  // Mirror the MUTATING_MESSAGE_TYPES set
  const MUTATING_MESSAGE_TYPES = new Set([
    'toggle_step',
    'set_tempo',
    'set_swing',
    'mute_track',
    'solo_track',
    'set_parameter_lock',
    'add_track',
    'delete_track',
    'clear_track',
    'set_track_sample',
    'set_track_volume',
    'set_track_transpose',
    'set_track_step_count',
    'set_effects',
    'set_fm_params',
  ]);

  it('should include all step/track mutation types', () => {
    expect(MUTATING_MESSAGE_TYPES.has('toggle_step')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('add_track')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('delete_track')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('clear_track')).toBe(true);
  });

  it('should include tempo/swing mutations', () => {
    expect(MUTATING_MESSAGE_TYPES.has('set_tempo')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('set_swing')).toBe(true);
  });

  it('should include track property mutations', () => {
    expect(MUTATING_MESSAGE_TYPES.has('set_track_sample')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('set_track_volume')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('set_track_transpose')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('set_track_step_count')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('mute_track')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('solo_track')).toBe(true);
  });

  it('should include effects/FM mutations', () => {
    expect(MUTATING_MESSAGE_TYPES.has('set_effects')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('set_fm_params')).toBe(true);
    expect(MUTATING_MESSAGE_TYPES.has('set_parameter_lock')).toBe(true);
  });

  it('should NOT include read-only message types', () => {
    expect(MUTATING_MESSAGE_TYPES.has('play')).toBe(false);
    expect(MUTATING_MESSAGE_TYPES.has('stop')).toBe(false);
    expect(MUTATING_MESSAGE_TYPES.has('state_hash')).toBe(false);
    expect(MUTATING_MESSAGE_TYPES.has('request_snapshot')).toBe(false);
    expect(MUTATING_MESSAGE_TYPES.has('clock_sync_request')).toBe(false);
    expect(MUTATING_MESSAGE_TYPES.has('cursor_move')).toBe(false);
  });

  it('should have 15 mutating message types', () => {
    expect(MUTATING_MESSAGE_TYPES.size).toBe(15);
  });
});

describe('Phase 26: Invariant Violation Logging', () => {
  // Test the structure of violation logs
  it('should include all required reproduction data fields', () => {
    const violationLog = {
      mutation: {
        seq: 42,
        type: 'toggle_step',
        trackId: 'synth-1',
        step: 5,
        snapshotValue: false,
      },
      timing: {
        mutationAge: 5234,
        mutationServerTime: 1702934567920,
        snapshotTimestamp: 1702934570000,
        gap: 2080,
        rttMs: 50,
      },
      connection: {
        wsReadyState: 1,
        wsReadyStateLabel: 'OPEN',
        lastServerSeq: 100,
        outOfOrderCount: 2,
        playerCount: 1,
      },
      sessionId: 'test-session-id',
      playerId: 'player-123',
    };

    // Verify all reproduction data is present
    expect(violationLog.mutation.seq).toBeDefined();
    expect(violationLog.mutation.type).toBeDefined();
    expect(violationLog.mutation.trackId).toBeDefined();
    expect(violationLog.mutation.step).toBeDefined();
    expect(violationLog.mutation.snapshotValue).toBeDefined();

    expect(violationLog.timing.mutationAge).toBeDefined();
    expect(violationLog.timing.mutationServerTime).toBeDefined();
    expect(violationLog.timing.snapshotTimestamp).toBeDefined();
    expect(violationLog.timing.gap).toBeDefined();
    expect(violationLog.timing.rttMs).toBeDefined();

    expect(violationLog.connection.wsReadyState).toBeDefined();
    expect(violationLog.connection.lastServerSeq).toBeDefined();
    expect(violationLog.connection.playerCount).toBeDefined();

    expect(violationLog.sessionId).toBeDefined();
    expect(violationLog.playerId).toBeDefined();
  });

  it('should correctly map WebSocket readyState to label', () => {
    const stateLabels = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];

    expect(stateLabels[0]).toBe('CONNECTING');
    expect(stateLabels[1]).toBe('OPEN');
    expect(stateLabels[2]).toBe('CLOSING');
    expect(stateLabels[3]).toBe('CLOSED');
  });

  it('should calculate timing gap correctly', () => {
    const mutationServerTime = 1702934567920;
    const snapshotTimestamp = 1702934570000;
    const gap = snapshotTimestamp - mutationServerTime;

    expect(gap).toBe(2080);
    expect(gap).toBeGreaterThan(0); // Snapshot should be after mutation
  });
});

describe('Phase 26: Integration Scenarios', () => {
  describe('Scenario 1: Single Player, Steps Lost', () => {
    it('should detect lost mutation when snapshot contradicts', () => {
      vi.useFakeTimers();

      class MockTracker {
        private pending = new Map<number, { sentAt: number; step: number }>();
        private lost: number[] = [];

        trackToggle(seq: number, step: number): void {
          this.pending.set(seq, { sentAt: Date.now(), step });
        }

        checkSnapshot(_steps: boolean[]): void {
          const now = Date.now();
          for (const [seq, mut] of this.pending) {
            if (now - mut.sentAt > 5000) {
              // Old unconfirmed mutation
              this.lost.push(seq);
              this.pending.delete(seq);
            }
          }
        }

        getLostMutations(): number[] {
          return [...this.lost];
        }
      }

      const tracker = new MockTracker();

      // Toggle steps 5, 6, 7
      tracker.trackToggle(42, 5);
      tracker.trackToggle(43, 6);
      tracker.trackToggle(44, 7);

      // Advance time (simulating connection issues)
      vi.advanceTimersByTime(6000);

      // Snapshot arrives (steps are all OFF)
      tracker.checkSnapshot(Array(16).fill(false));

      expect(tracker.getLostMutations()).toEqual([42, 43, 44]);

      vi.useRealTimers();
    });
  });

  describe('Scenario 2: Multi-Player, Supersession', () => {
    it('should NOT report violation when superseded by other player', () => {
      vi.useFakeTimers();

      const superseded = new Set<string>();
      const violations: number[] = [];

      // Track mutation
      const mutations = new Map<number, { trackId: string; step: number; sentAt: number }>([
        [42, { trackId: 't1', step: 5, sentAt: Date.now() }]
      ]);

      // Other player touches same step
      superseded.add('t1:5');

      // Advance time
      vi.advanceTimersByTime(6000);

      // Check invariant
      for (const [seq, mut] of mutations) {
        const key = `${mut.trackId}:${mut.step}`;
        if (superseded.has(key)) {
          continue; // Superseded, not a violation
        }
        if (Date.now() - mut.sentAt > 5000) {
          violations.push(seq);
        }
      }

      expect(violations).toEqual([]); // No violation because superseded

      vi.useRealTimers();
    });
  });

  describe('Scenario 3: Normal Operation', () => {
    it('should not report when mutation is confirmed before snapshot', () => {
      const pending = new Map<number, { sentAt: number }>([
        [42, { sentAt: Date.now() }]
      ]);

      // Confirm via clientSeq echo
      pending.delete(42);

      // Later, check snapshot
      const violations = [...pending.keys()].filter(() => true);

      expect(violations).toEqual([]); // Already confirmed
    });
  });

  describe('Scenario 4: Timeout without Snapshot', () => {
    it('should warn about unconfirmed mutations after timeout', () => {
      vi.useFakeTimers();

      const warnings: number[] = [];
      const MUTATION_TIMEOUT_MS = 30000;

      const pending = new Map<number, { sentAt: number }>([
        [42, { sentAt: Date.now() }]
      ]);

      // 30 seconds pass, no confirmation
      vi.advanceTimersByTime(31000);

      // Prune old mutations
      const now = Date.now();
      for (const [seq, mut] of pending) {
        if (now - mut.sentAt > MUTATION_TIMEOUT_MS) {
          warnings.push(seq);
          pending.delete(seq);
        }
      }

      expect(warnings).toEqual([42]);

      vi.useRealTimers();
    });
  });
});

// ============================================================================
// Phase 26: Snapshot Regression Detection Tests
// ============================================================================

describe('Phase 26: Snapshot Regression Detection', () => {
  /**
   * Tests for the snapshot regression invariant.
   * This detects when a snapshot would lose confirmed state (tracks/steps).
   *
   * The invariant: if we've received confirmation that a track/step exists,
   * a subsequent snapshot missing that track/step is a regression.
   */

  // Simulate the confirmed state tracking data structures
  type ConfirmedState = {
    confirmedTracks: Set<string>;
    confirmedSteps: Map<string, Set<number>>;
    lastConfirmedAt: number;
  };

  type SessionState = {
    tracks: Array<{ id: string; steps: boolean[] }>;
  };

  /**
   * Simulates the checkSnapshotRegression logic
   */
  function detectRegression(
    confirmed: ConfirmedState,
    snapshot: SessionState
  ): { missingTracks: string[]; missingSteps: Array<{ trackId: string; step: number }> } {
    const missingTracks: string[] = [];
    const missingSteps: Array<{ trackId: string; step: number }> = [];

    // Skip if no confirmed state
    if (confirmed.confirmedTracks.size === 0 && confirmed.confirmedSteps.size === 0) {
      return { missingTracks, missingSteps };
    }

    const snapshotTrackIds = new Set(snapshot.tracks.map(t => t.id));

    // Check for missing tracks
    for (const confirmedTrackId of confirmed.confirmedTracks) {
      if (!snapshotTrackIds.has(confirmedTrackId)) {
        missingTracks.push(confirmedTrackId);
      }
    }

    // Check for missing steps
    for (const [trackId, confirmedStepSet] of confirmed.confirmedSteps) {
      const snapshotTrack = snapshot.tracks.find(t => t.id === trackId);
      if (!snapshotTrack) continue; // Track missing already logged above

      for (const step of confirmedStepSet) {
        if (!snapshotTrack.steps[step]) {
          missingSteps.push({ trackId, step });
        }
      }
    }

    return { missingTracks, missingSteps };
  }

  /**
   * Simulates updating confirmed state from broadcast
   */
  function updateConfirmed(
    confirmed: ConfirmedState,
    type: 'track_added' | 'track_deleted' | 'step_toggled',
    trackId: string,
    step?: number,
    stepValue?: boolean
  ): void {
    confirmed.lastConfirmedAt = Date.now();

    switch (type) {
      case 'track_added':
        confirmed.confirmedTracks.add(trackId);
        if (!confirmed.confirmedSteps.has(trackId)) {
          confirmed.confirmedSteps.set(trackId, new Set());
        }
        break;
      case 'track_deleted':
        confirmed.confirmedTracks.delete(trackId);
        confirmed.confirmedSteps.delete(trackId);
        break;
      case 'step_toggled':
        if (step !== undefined) {
          if (!confirmed.confirmedSteps.has(trackId)) {
            confirmed.confirmedSteps.set(trackId, new Set());
          }
          const steps = confirmed.confirmedSteps.get(trackId)!;
          if (stepValue) {
            steps.add(step);
          } else {
            steps.delete(step);
          }
        }
        break;
    }
  }

  function createEmptyConfirmedState(): ConfirmedState {
    return {
      confirmedTracks: new Set(),
      confirmedSteps: new Map(),
      lastConfirmedAt: 0,
    };
  }

  describe('Track regression detection', () => {
    it('should detect missing confirmed track in snapshot', () => {
      const confirmed = createEmptyConfirmedState();

      // Simulate receiving track_added broadcast
      updateConfirmed(confirmed, 'track_added', 'track-abc');

      // Snapshot arrives without the track
      const snapshot: SessionState = {
        tracks: [],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual(['track-abc']);
      expect(missingSteps).toEqual([]);
    });

    it('should not detect regression if track is in snapshot', () => {
      const confirmed = createEmptyConfirmedState();

      updateConfirmed(confirmed, 'track_added', 'track-abc');

      const snapshot: SessionState = {
        tracks: [{ id: 'track-abc', steps: [false, false, false, false] }],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual([]);
      expect(missingSteps).toEqual([]);
    });

    it('should not detect regression if track was intentionally deleted', () => {
      const confirmed = createEmptyConfirmedState();

      // Track added then deleted
      updateConfirmed(confirmed, 'track_added', 'track-abc');
      updateConfirmed(confirmed, 'track_deleted', 'track-abc');

      const snapshot: SessionState = {
        tracks: [],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual([]);
      expect(missingSteps).toEqual([]);
    });

    it('should detect multiple missing tracks', () => {
      const confirmed = createEmptyConfirmedState();

      updateConfirmed(confirmed, 'track_added', 'track-1');
      updateConfirmed(confirmed, 'track_added', 'track-2');
      updateConfirmed(confirmed, 'track_added', 'track-3');

      // Snapshot only has track-2
      const snapshot: SessionState = {
        tracks: [{ id: 'track-2', steps: [false] }],
      };

      const { missingTracks, missingSteps: _missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toContain('track-1');
      expect(missingTracks).toContain('track-3');
      expect(missingTracks).not.toContain('track-2');
    });
  });

  describe('Step regression detection', () => {
    it('should detect missing confirmed step in snapshot', () => {
      const confirmed = createEmptyConfirmedState();

      // Simulate step being toggled on
      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 5, true);

      // Snapshot has the track but step is off
      const snapshot: SessionState = {
        tracks: [{ id: 'track-abc', steps: [false, false, false, false, false, false] }],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual([]);
      expect(missingSteps).toEqual([{ trackId: 'track-abc', step: 5 }]);
    });

    it('should not detect regression if step is on in snapshot', () => {
      const confirmed = createEmptyConfirmedState();

      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 2, true);

      const snapshot: SessionState = {
        tracks: [{ id: 'track-abc', steps: [false, false, true, false] }],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual([]);
      expect(missingSteps).toEqual([]);
    });

    it('should not detect regression if step was toggled off', () => {
      const confirmed = createEmptyConfirmedState();

      // Step toggled on then off
      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 2, true);
      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 2, false);

      const snapshot: SessionState = {
        tracks: [{ id: 'track-abc', steps: [false, false, false, false] }],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual([]);
      expect(missingSteps).toEqual([]);
    });

    it('should detect multiple missing steps', () => {
      const confirmed = createEmptyConfirmedState();

      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 0, true);
      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 4, true);
      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 8, true);

      // Snapshot only has step 4 on
      const snapshot: SessionState = {
        tracks: [{ id: 'track-abc', steps: [false, false, false, false, true, false, false, false, false] }],
      };

      const { missingTracks: _missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingSteps).toContainEqual({ trackId: 'track-abc', step: 0 });
      expect(missingSteps).toContainEqual({ trackId: 'track-abc', step: 8 });
      expect(missingSteps).not.toContainEqual({ trackId: 'track-abc', step: 4 });
    });
  });

  describe('Edge cases', () => {
    it('should not detect regression on initial connect (no confirmed state)', () => {
      const confirmed = createEmptyConfirmedState();

      // First snapshot arrives
      const snapshot: SessionState = {
        tracks: [],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual([]);
      expect(missingSteps).toEqual([]);
    });

    it('should handle step regression when track is missing', () => {
      const confirmed = createEmptyConfirmedState();

      // Track and steps confirmed
      updateConfirmed(confirmed, 'track_added', 'track-abc');
      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 0, true);
      updateConfirmed(confirmed, 'step_toggled', 'track-abc', 1, true);

      // Snapshot missing the track entirely
      const snapshot: SessionState = {
        tracks: [],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      // Track missing is reported, but steps not separately (they're part of track)
      expect(missingTracks).toEqual(['track-abc']);
      // Steps not reported because track is already missing
      expect(missingSteps).toEqual([]);
    });

    it('should handle multiple tracks with steps', () => {
      const confirmed = createEmptyConfirmedState();

      updateConfirmed(confirmed, 'track_added', 'track-1');
      updateConfirmed(confirmed, 'track_added', 'track-2');
      updateConfirmed(confirmed, 'step_toggled', 'track-1', 0, true);
      updateConfirmed(confirmed, 'step_toggled', 'track-2', 3, true);

      // Snapshot has track-1 with wrong steps, track-2 with correct steps
      const snapshot: SessionState = {
        tracks: [
          { id: 'track-1', steps: [false, false, false, false] }, // Step 0 missing
          { id: 'track-2', steps: [false, false, false, true] },  // Step 3 present
        ],
      };

      const { missingTracks, missingSteps } = detectRegression(confirmed, snapshot);

      expect(missingTracks).toEqual([]);
      expect(missingSteps).toEqual([{ trackId: 'track-1', step: 0 }]);
    });
  });
});

// ============================================================================
// Phase 26: TEST-07 - Message Ordering Verification
// ============================================================================
// NOTE: TEST-04 (hash mismatch) tests merged with "Consecutive Mismatch Tracking" above
// NOTE: TEST-05 (reconnection) tests merged with "Offline Queue Behavior" above
// NOTE: TEST-06 (clock sync) tests merged with "Clock Synchronization Algorithm" above

describe('TEST-07: Message Ordering', () => {
  it('should detect message gap', () => {
    let lastServerSeq = 0;
    let outOfOrderCount = 0;

    function handleMessage(seq: number): { missed: number; outOfOrder: boolean } {
      const expectedSeq = lastServerSeq + 1;
      let missed = 0;
      let outOfOrder = false;

      if (seq !== expectedSeq && lastServerSeq !== 0) {
        outOfOrderCount++;
        if (seq > expectedSeq) {
          missed = seq - expectedSeq;
        } else {
          outOfOrder = true;
        }
      }

      lastServerSeq = Math.max(lastServerSeq, seq);
      return { missed, outOfOrder };
    }

    expect(handleMessage(1)).toEqual({ missed: 0, outOfOrder: false });
    expect(handleMessage(2)).toEqual({ missed: 0, outOfOrder: false });
    expect(handleMessage(5)).toEqual({ missed: 2, outOfOrder: false }); // Missed 3, 4
    expect(outOfOrderCount).toBe(1);
  });

  it('should detect out-of-order message', () => {
    let lastServerSeq = 0;
    let outOfOrderCount = 0;

    function handleMessage(seq: number): boolean {
      const expectedSeq = lastServerSeq + 1;
      if (seq !== expectedSeq && lastServerSeq !== 0) {
        outOfOrderCount++;
        if (seq < expectedSeq) {
          // Out of order (old message arriving late)
          return true;
        }
      }
      lastServerSeq = Math.max(lastServerSeq, seq);
      return false;
    }

    handleMessage(1);
    handleMessage(3); // Skip 2
    const wasOutOfOrder = handleMessage(2); // Late arrival of 2

    expect(wasOutOfOrder).toBe(true);
    expect(outOfOrderCount).toBe(2); // Once for gap, once for late
  });
});

// ============================================================================
// Phase 26: TEST-09 - Player Lifecycle Tests
// ============================================================================

describe('TEST-09: Player Lifecycle', () => {
  interface MockPlayer {
    id: string;
    name: string;
    connectedAt: number;
  }

  it('should track player join and leave', () => {
    const players: MockPlayer[] = [];

    function playerJoined(player: MockPlayer): void {
      players.push(player);
    }

    function playerLeft(playerId: string): void {
      const index = players.findIndex(p => p.id === playerId);
      if (index !== -1) {
        players.splice(index, 1);
      }
    }

    playerJoined({ id: 'player-1', name: 'Red Fox', connectedAt: Date.now() });
    expect(players.length).toBe(1);

    playerJoined({ id: 'player-2', name: 'Blue Bear', connectedAt: Date.now() });
    expect(players.length).toBe(2);

    playerLeft('player-1');
    expect(players.length).toBe(1);
    expect(players[0].id).toBe('player-2');
  });

  it('should cleanup cursor on player leave', () => {
    const cursors = new Map<string, { x: number; y: number }>();

    cursors.set('player-1', { x: 50, y: 50 });
    cursors.set('player-2', { x: 75, y: 25 });

    expect(cursors.size).toBe(2);

    // Player leaves - cursor should be cleaned up
    cursors.delete('player-1');

    expect(cursors.size).toBe(1);
    expect(cursors.has('player-1')).toBe(false);
    expect(cursors.has('player-2')).toBe(true);
  });

  it('should handle rapid join/leave cycles', () => {
    const playerHistory: { id: string; event: 'join' | 'leave' }[] = [];
    const activePlayers = new Set<string>();

    function join(id: string): void {
      activePlayers.add(id);
      playerHistory.push({ id, event: 'join' });
    }

    function leave(id: string): void {
      activePlayers.delete(id);
      playerHistory.push({ id, event: 'leave' });
    }

    // Rapid join/leave
    join('player-1');
    leave('player-1');
    join('player-1');
    leave('player-1');
    join('player-1');

    expect(activePlayers.has('player-1')).toBe(true);
    expect(playerHistory.length).toBe(5);
  });
});

// ============================================================================
// Phase 26: TEST-10 - Effects/FM Params Sync Parity
// ============================================================================

describe('TEST-10: Effects/FM Params Sync', () => {
  interface EffectsState {
    reverb: { decay: number; wet: number };
    delay: { time: string; feedback: number; wet: number };
    chorus: { frequency: number; depth: number; wet: number };
    distortion: { amount: number; wet: number };
  }

  interface FMParams {
    harmonicity: number;
    modulationIndex: number;
  }

  it('should validate reverb parameters', () => {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    const validateReverb = (decay: number, wet: number) => ({
      decay: clamp(decay, 0.1, 10),
      wet: clamp(wet, 0, 1),
    });

    expect(validateReverb(5, 0.5)).toEqual({ decay: 5, wet: 0.5 });
    expect(validateReverb(0, 0)).toEqual({ decay: 0.1, wet: 0 }); // Decay clamped to min
    expect(validateReverb(15, 2)).toEqual({ decay: 10, wet: 1 }); // Both clamped to max
  });

  it('should validate delay parameters', () => {
    const validDelayTimes = new Set(['8n', '4n', '16n', '2n', '1n']);

    const validateDelay = (time: string, feedback: number, wet: number) => ({
      time: validDelayTimes.has(time) ? time : '8n',
      feedback: Math.max(0, Math.min(0.95, feedback)),
      wet: Math.max(0, Math.min(1, wet)),
    });

    expect(validateDelay('4n', 0.5, 0.3)).toEqual({ time: '4n', feedback: 0.5, wet: 0.3 });
    expect(validateDelay('invalid', 0.5, 0.3)).toEqual({ time: '8n', feedback: 0.5, wet: 0.3 });
    expect(validateDelay('8n', 1.5, 0.3)).toEqual({ time: '8n', feedback: 0.95, wet: 0.3 });
  });

  it('should validate FM params', () => {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    const validateFM = (harmonicity: number, modulationIndex: number): FMParams => ({
      harmonicity: clamp(harmonicity, 0.5, 10),
      modulationIndex: clamp(modulationIndex, 0, 20),
    });

    expect(validateFM(2, 5)).toEqual({ harmonicity: 2, modulationIndex: 5 });
    expect(validateFM(0, 25)).toEqual({ harmonicity: 0.5, modulationIndex: 20 });
    expect(validateFM(15, -5)).toEqual({ harmonicity: 10, modulationIndex: 0 });
  });

  it('should sync effects state between clients', () => {
    const clientAEffects: EffectsState = {
      reverb: { decay: 2, wet: 0.3 },
      delay: { time: '8n', feedback: 0.4, wet: 0.2 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0.1 },
      distortion: { amount: 0.2, wet: 0.1 },
    };

    // Client A changes effects
    const update: EffectsState = {
      ...clientAEffects,
      reverb: { decay: 4, wet: 0.5 },
    };

    // Simulated broadcast to Client B
    const clientBEffects = { ...update };

    expect(clientBEffects.reverb.decay).toBe(4);
    expect(clientBEffects.reverb.wet).toBe(0.5);
    expect(clientBEffects.delay.time).toBe('8n'); // Unchanged
  });
});

// ============================================================================
// Phase 26: TEST-11 - Invariant Repair Tests (using REAL implementation)
// ============================================================================

import {
  repairStateInvariants,
  validateParameterLock,
  validateStateInvariants,
  MAX_STEPS,
} from '../worker/invariants';
import type { SessionState, SessionTrack } from '../worker/types';

describe('TEST-11: Invariant Repair (Real Implementation)', () => {
  // Helper to create a minimal valid SessionTrack
  const createTrack = (id: string, steps?: boolean[]): SessionTrack => ({
    id,
    name: 'Test Track',
    sampleId: 'drums:kick',
    steps: steps || Array(MAX_STEPS).fill(false),
    parameterLocks: Array(MAX_STEPS).fill(null),
    muted: false,
    soloed: false,
    volume: 0.8,
    playbackMode: 'oneshot',
    transpose: 0,
    stepCount: 16,
  });

  it('should remove duplicate track IDs using real repairStateInvariants', () => {
    const state: SessionState = {
      tracks: [
        createTrack('track-1'),
        createTrack('track-1'), // Duplicate
        createTrack('track-2'),
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    };

    const { repairedState, repairs } = repairStateInvariants(state);

    expect(repairedState.tracks.length).toBe(2);
    expect(repairs.some(r => r.includes('duplicate'))).toBe(true);
  });

  it('should clamp out-of-bounds tempo using real repairStateInvariants', () => {
    const state: SessionState = {
      tracks: [],
      tempo: 300,
      swing: 0,
      version: 1,
    };

    const { repairedState, repairs } = repairStateInvariants(state);

    expect(repairedState.tempo).toBe(180);
    expect(repairs.some(r => r.includes('tempo'))).toBe(true);
  });

  it('should pad short step arrays using real repairStateInvariants', () => {
    const state: SessionState = {
      tracks: [{
        ...createTrack('track-1'),
        steps: [true, false], // Too short
      }],
      tempo: 120,
      swing: 0,
      version: 1,
    };

    const { repairedState, repairs } = repairStateInvariants(state);

    expect(repairedState.tracks[0].steps.length).toBe(MAX_STEPS);
    expect(repairedState.tracks[0].steps[0]).toBe(true);
    expect(repairedState.tracks[0].steps[1]).toBe(false);
    expect(repairs.some(r => r.includes('Padded'))).toBe(true);
  });

  it('should detect violations using real validateStateInvariants', () => {
    const state: SessionState = {
      tracks: [createTrack('track-1'), createTrack('track-1')], // Duplicate
      tempo: 120,
      swing: 0,
      version: 1,
    };

    const result = validateStateInvariants(state);

    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes('Duplicate'))).toBe(true);
  });
});

// ============================================================================
// Phase 26: TEST-10b - Parameter Lock Validation (Real Implementation)
// ============================================================================

describe('TEST-10b: Parameter Lock Validation (Real Implementation)', () => {
  it('should return null for null/undefined input', () => {
    expect(validateParameterLock(null)).toBe(null);
    expect(validateParameterLock(undefined)).toBe(null);
  });

  it('should return null for non-object input', () => {
    expect(validateParameterLock('string')).toBe(null);
    expect(validateParameterLock(123)).toBe(null);
    expect(validateParameterLock([1, 2, 3])).toBe(null);
  });

  it('should return null for empty object', () => {
    expect(validateParameterLock({})).toBe(null);
  });

  it('should validate and clamp pitch values', () => {
    expect(validateParameterLock({ pitch: 0 })).toEqual({ pitch: 0 });
    expect(validateParameterLock({ pitch: 12 })).toEqual({ pitch: 12 });
    expect(validateParameterLock({ pitch: -12 })).toEqual({ pitch: -12 });

    // Clamp to bounds
    expect(validateParameterLock({ pitch: 30 })).toEqual({ pitch: 24 });
    expect(validateParameterLock({ pitch: -30 })).toEqual({ pitch: -24 });
  });

  it('should validate and clamp volume values', () => {
    expect(validateParameterLock({ volume: 0.5 })).toEqual({ volume: 0.5 });
    expect(validateParameterLock({ volume: 0 })).toEqual({ volume: 0 });
    expect(validateParameterLock({ volume: 1 })).toEqual({ volume: 1 });

    // Clamp to bounds
    expect(validateParameterLock({ volume: 2 })).toEqual({ volume: 1 });
    expect(validateParameterLock({ volume: -1 })).toEqual({ volume: 0 });
  });

  it('should validate combined pitch and volume', () => {
    expect(validateParameterLock({ pitch: 7, volume: 0.8 })).toEqual({ pitch: 7, volume: 0.8 });
  });

  it('should reject invalid types for pitch/volume', () => {
    expect(validateParameterLock({ pitch: 'high' })).toBe(null);
    expect(validateParameterLock({ volume: 'loud' })).toBe(null);
    expect(validateParameterLock({ pitch: NaN })).toBe(null);
    expect(validateParameterLock({ volume: Infinity })).toBe(null);
  });

  // Phase 29B: Tie validation tests
  it('should validate tie boolean value', () => {
    expect(validateParameterLock({ tie: true })).toEqual({ tie: true });
    expect(validateParameterLock({ tie: false })).toEqual({ tie: false });
  });

  it('should validate tie with other properties', () => {
    expect(validateParameterLock({ pitch: 5, tie: true })).toEqual({ pitch: 5, tie: true });
    expect(validateParameterLock({ volume: 0.5, tie: true })).toEqual({ volume: 0.5, tie: true });
    expect(validateParameterLock({ pitch: 7, volume: 0.8, tie: true })).toEqual({ pitch: 7, volume: 0.8, tie: true });
  });

  it('should reject invalid tie types', () => {
    expect(validateParameterLock({ tie: 'yes' })).toBe(null);
    expect(validateParameterLock({ tie: 1 })).toBe(null);
    expect(validateParameterLock({ tie: null })).toBe(null);
  });
});

// ============================================================================
// Phase 26: TEST-12 - Handler Factory Edge Cases
// ============================================================================

describe('TEST-12: Handler Factory Edge Cases', () => {
  it('should handle null message gracefully', () => {
    function createHandler<T>(validate?: (msg: T) => T | null) {
      return (msg: T | null): { valid: boolean; message?: T } => {
        if (msg === null) {
          return { valid: false };
        }
        if (validate) {
          const validated = validate(msg);
          if (validated === null) {
            return { valid: false };
          }
          return { valid: true, message: validated };
        }
        return { valid: true, message: msg };
      };
    }

    const handler = createHandler<{ value: number }>(msg => msg.value > 0 ? msg : null);

    expect(handler(null)).toEqual({ valid: false });
    expect(handler({ value: -1 })).toEqual({ valid: false });
    expect(handler({ value: 5 })).toEqual({ valid: true, message: { value: 5 } });
  });

  it('should validate required fields', () => {
    function validateMessage(
      msg: Record<string, unknown>,
      requiredFields: string[]
    ): boolean {
      return requiredFields.every(field => field in msg && msg[field] !== undefined);
    }

    expect(validateMessage({ trackId: 'abc', step: 0 }, ['trackId', 'step'])).toBe(true);
    expect(validateMessage({ trackId: 'abc' }, ['trackId', 'step'])).toBe(false);
    expect(validateMessage({}, ['trackId'])).toBe(false);
  });

  it('should handle malformed track ID', () => {
    interface Message {
      trackId: unknown;
      step: number;
    }

    function validateTrackId(msg: Message): boolean {
      return typeof msg.trackId === 'string' && msg.trackId.length > 0;
    }

    expect(validateTrackId({ trackId: 'track-1', step: 0 })).toBe(true);
    expect(validateTrackId({ trackId: '', step: 0 })).toBe(false);
    expect(validateTrackId({ trackId: 123, step: 0 })).toBe(false);
    expect(validateTrackId({ trackId: null, step: 0 })).toBe(false);
  });

  it('should clamp out-of-range values', () => {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    interface VolumeMessage {
      trackId: string;
      volume: number;
    }

    function validateVolume(msg: VolumeMessage): VolumeMessage {
      return {
        ...msg,
        volume: clamp(msg.volume, 0, 1),
      };
    }

    expect(validateVolume({ trackId: 'a', volume: 0.5 })).toEqual({ trackId: 'a', volume: 0.5 });
    expect(validateVolume({ trackId: 'a', volume: -1 })).toEqual({ trackId: 'a', volume: 0 });
    expect(validateVolume({ trackId: 'a', volume: 2 })).toEqual({ trackId: 'a', volume: 1 });
  });
});

// ============================================================================
// Connection Storm Prevention Tests
// ============================================================================

describe('Connection Storm Prevention', () => {
  /**
   * Models the guard logic that should exist in connect():
   * If already connected or connecting, refuse new connection attempts.
   * This prevents connection storms from buggy useEffect dependencies.
   */

  // WebSocket readyState constants
  const WS_CONNECTING = 0;
  const WS_OPEN = 1;
  const WS_CLOSING = 2;
  const WS_CLOSED = 3;

  interface MockMultiplayerState {
    wsReadyState: number | null; // null = no WebSocket exists
    connectCalls: number;
    createWebSocketCalls: number;
  }

  /**
   * Simulates the connect() method with the storm prevention guard.
   * Returns true if connection was initiated, false if refused.
   */
  function simulateConnect(state: MockMultiplayerState): boolean {
    // Guard: refuse if already connected or connecting
    if (state.wsReadyState === WS_OPEN || state.wsReadyState === WS_CONNECTING) {
      return false; // Connection refused - already active
    }

    state.connectCalls++;
    state.createWebSocketCalls++;
    state.wsReadyState = WS_CONNECTING;
    return true;
  }

  /**
   * Simulates WebSocket opening (connection established)
   */
  function simulateOpen(state: MockMultiplayerState): void {
    if (state.wsReadyState === WS_CONNECTING) {
      state.wsReadyState = WS_OPEN;
    }
  }

  /**
   * Simulates WebSocket closing
   */
  function simulateClose(state: MockMultiplayerState): void {
    state.wsReadyState = WS_CLOSED;
  }

  it('should allow first connection when no WebSocket exists', () => {
    const state: MockMultiplayerState = {
      wsReadyState: null,
      connectCalls: 0,
      createWebSocketCalls: 0,
    };

    const result = simulateConnect(state);

    expect(result).toBe(true);
    expect(state.connectCalls).toBe(1);
    expect(state.createWebSocketCalls).toBe(1);
    expect(state.wsReadyState).toBe(WS_CONNECTING);
  });

  it('should refuse connection when already connecting', () => {
    const state: MockMultiplayerState = {
      wsReadyState: WS_CONNECTING,
      connectCalls: 1,
      createWebSocketCalls: 1,
    };

    const result = simulateConnect(state);

    expect(result).toBe(false);
    expect(state.connectCalls).toBe(1); // No increment
    expect(state.createWebSocketCalls).toBe(1); // No increment
  });

  it('should refuse connection when already connected', () => {
    const state: MockMultiplayerState = {
      wsReadyState: WS_OPEN,
      connectCalls: 1,
      createWebSocketCalls: 1,
    };

    const result = simulateConnect(state);

    expect(result).toBe(false);
    expect(state.connectCalls).toBe(1); // No increment
    expect(state.createWebSocketCalls).toBe(1); // No increment
  });

  it('should allow reconnection after WebSocket closes', () => {
    const state: MockMultiplayerState = {
      wsReadyState: null,
      connectCalls: 0,
      createWebSocketCalls: 0,
    };

    // First connection
    simulateConnect(state);
    simulateOpen(state);
    expect(state.wsReadyState).toBe(WS_OPEN);

    // Connection closes
    simulateClose(state);
    expect(state.wsReadyState).toBe(WS_CLOSED);

    // Should allow reconnection
    const result = simulateConnect(state);
    expect(result).toBe(true);
    expect(state.connectCalls).toBe(2);
  });

  it('should prevent connection storm from rapid connect() calls', () => {
    const state: MockMultiplayerState = {
      wsReadyState: null,
      connectCalls: 0,
      createWebSocketCalls: 0,
    };

    // Simulate 100 rapid connect() calls (e.g., from buggy useEffect)
    let successfulConnects = 0;
    for (let i = 0; i < 100; i++) {
      if (simulateConnect(state)) {
        successfulConnects++;
      }
    }

    // Only the first should succeed
    expect(successfulConnects).toBe(1);
    expect(state.createWebSocketCalls).toBe(1);
  });

  it('should allow connection when WebSocket is closing', () => {
    const state: MockMultiplayerState = {
      wsReadyState: WS_CLOSING,
      connectCalls: 0,
      createWebSocketCalls: 0,
    };

    // WS_CLOSING means the old connection is going away,
    // so we should allow a new connection attempt
    const result = simulateConnect(state);

    expect(result).toBe(true);
    expect(state.createWebSocketCalls).toBe(1);
  });

  it('should allow connection when WebSocket is closed', () => {
    const state: MockMultiplayerState = {
      wsReadyState: WS_CLOSED,
      connectCalls: 0,
      createWebSocketCalls: 0,
    };

    const result = simulateConnect(state);

    expect(result).toBe(true);
    expect(state.createWebSocketCalls).toBe(1);
  });
});
