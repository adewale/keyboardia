/**
 * Phase 7: Mock Durable Object for local development and testing
 *
 * This mock simulates a LiveSession Durable Object without requiring
 * Cloudflare infrastructure. It enables:
 *
 * 1. Local development with WebSocket simulation
 * 2. Multi-client integration testing
 * 3. Network failure simulation
 * 4. Latency testing
 */

import type { SessionState } from './types';

export interface MockWebSocket {
  id: string;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: Error) => void) | null;
}

export interface MockMessage {
  type: string;
  playerId: string;
  payload?: unknown;
  timestamp: number;
}

/**
 * Mock KV store for testing persistence behavior
 */
export interface MockKVStore {
  data: Map<string, SessionState>;
  saveCount: number;
  lastSaveTime: number;
  saveCalls: { sessionId: string; state: SessionState; timestamp: number }[];
}

export function createMockKV(): MockKVStore {
  return {
    data: new Map(),
    saveCount: 0,
    lastSaveTime: 0,
    saveCalls: [],
  };
}

const KV_SAVE_DEBOUNCE_MS = 5000;

/**
 * Mock LiveSession Durable Object
 *
 * Simulates the server-side WebSocket handling that will be implemented
 * in Phase 8 (Cloudflare Backend Setup) and Phase 9 (Multiplayer State Sync).
 */
export class MockLiveSession {
  private clients: Map<string, MockWebSocket> = new Map();
  private state: SessionState;
  private messageHistory: MockMessage[] = [];
  private simulatedLatency: number = 0;
  private isPlaying: boolean = false;
  private currentStep: number = 0;
  private sessionId: string;

  // KV sync simulation
  private kv: MockKVStore | null = null;
  private kvSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingKVSave: boolean = false;

  constructor(sessionId: string, initialState?: SessionState, kv?: MockKVStore) {
    this.sessionId = sessionId;
    this.kv = kv ?? null;
    this.state = initialState ?? {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
    };
  }

  /**
   * Get current session state
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Get number of connected clients
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected player IDs
   */
  getConnectedPlayers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Connect a new client
   */
  connect(playerId: string): MockWebSocket {
    if (this.clients.size >= 10) {
      throw new Error('Maximum connections reached (10)');
    }

    const ws: MockWebSocket = {
      id: playerId,
      readyState: 1, // OPEN
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data: string) => {
        // Simulate latency
        setTimeout(() => {
          this.handleMessage(playerId, data);
        }, this.simulatedLatency);
      },
      close: (code = 1000, reason = 'Normal closure') => {
        this.disconnect(playerId, code, reason);
      },
    };

    this.clients.set(playerId, ws);

    // Log connection
    this.messageHistory.push({
      type: 'connect',
      playerId,
      timestamp: Date.now(),
    });

    // Send current state to new client
    setTimeout(() => {
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            type: 'state_sync',
            state: this.state,
            playerCount: this.clients.size,
          }),
        });
      }
    }, this.simulatedLatency);

    // Notify other clients
    this.broadcast(
      { type: 'player_joined', playerId, playerCount: this.clients.size },
      playerId
    );

    return ws;
  }

  /**
   * Disconnect a client
   */
  disconnect(playerId: string, code: number = 1000, reason: string = 'Normal closure'): void {
    const ws = this.clients.get(playerId);
    if (ws) {
      ws.readyState = 3; // CLOSED
      if (ws.onclose) {
        ws.onclose({ code, reason });
      }
      this.clients.delete(playerId);

      // Log disconnection
      this.messageHistory.push({
        type: 'disconnect',
        playerId,
        payload: { code, reason },
        timestamp: Date.now(),
      });

      // Notify other clients
      this.broadcast(
        { type: 'player_left', playerId, playerCount: this.clients.size },
        playerId
      );

      // Save to KV when last player disconnects
      if (this.clients.size === 0) {
        this.saveToKV();
      }
    }
  }

  /**
   * Handle incoming message from a client
   */
  private handleMessage(playerId: string, data: string): void {
    try {
      const message = JSON.parse(data);

      // Log message
      this.messageHistory.push({
        type: message.type,
        playerId,
        payload: message,
        timestamp: Date.now(),
      });

      switch (message.type) {
        case 'toggle_step':
          this.handleToggleStep(playerId, message);
          break;
        case 'set_tempo':
          this.handleSetTempo(playerId, message);
          break;
        case 'set_swing':
          this.handleSetSwing(playerId, message);
          break;
        case 'mute_track':
          this.handleMuteTrack(playerId, message);
          break;
        case 'play':
          this.handlePlay(playerId);
          break;
        case 'stop':
          this.handleStop(playerId);
          break;
        case 'state_hash':
          this.handleStateHash(playerId, message);
          break;
        case 'add_track':
          this.handleAddTrack(playerId, message);
          break;
        case 'delete_track':
          this.handleDeleteTrack(playerId, message);
          break;
        default:
          console.log(`[MockDO] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[MockDO] Error handling message from ${playerId}:`, error);
    }
  }

  /**
   * Handle toggle_step message
   */
  private handleToggleStep(playerId: string, message: { trackId: number; step: number }): void {
    const track = this.state.tracks[message.trackId];
    if (track) {
      track.steps[message.step] = !track.steps[message.step];
      this.broadcast({
        type: 'step_toggled',
        playerId,
        trackId: message.trackId,
        step: message.step,
        value: track.steps[message.step],
      });
      this.scheduleKVSave();
    }
  }

  /**
   * Handle set_tempo message
   */
  private handleSetTempo(playerId: string, message: { tempo: number }): void {
    this.state.tempo = message.tempo;
    this.broadcast({
      type: 'tempo_changed',
      playerId,
      tempo: message.tempo,
    });
    this.scheduleKVSave();
  }

  /**
   * Handle set_swing message
   */
  private handleSetSwing(playerId: string, message: { swing: number }): void {
    this.state.swing = message.swing;
    this.broadcast({
      type: 'swing_changed',
      playerId,
      swing: message.swing,
    });
    this.scheduleKVSave();
  }

  /**
   * Handle mute_track message
   */
  private handleMuteTrack(playerId: string, message: { trackId: number; muted: boolean }): void {
    const track = this.state.tracks[message.trackId];
    if (track) {
      track.muted = message.muted;
      this.broadcast({
        type: 'track_muted',
        playerId,
        trackId: message.trackId,
        muted: message.muted,
      });
      this.scheduleKVSave();
    }
  }

  /**
   * Handle play message
   */
  private handlePlay(playerId: string): void {
    this.isPlaying = true;
    this.broadcast({
      type: 'playback_started',
      playerId,
      startStep: this.currentStep,
      serverTime: Date.now(),
    });
  }

  /**
   * Handle stop message
   */
  private handleStop(playerId: string): void {
    this.isPlaying = false;
    this.broadcast({
      type: 'playback_stopped',
      playerId,
    });
  }

  /**
   * Handle state_hash message (for consistency verification)
   */
  private handleStateHash(playerId: string, message: { hash: string }): void {
    // In production, compare with server hash and report mismatches
    console.log(`[MockDO] State hash from ${playerId}: ${message.hash}`);
  }

  /**
   * Handle add_track message
   * Includes duplicate prevention (Phase 11 bug fix)
   */
  private handleAddTrack(playerId: string, message: { track: SessionState['tracks'][0] }): void {
    // Max tracks limit (16)
    if (this.state.tracks.length >= 16) {
      console.log(`[MockDO] Max tracks reached, rejecting add_track from ${playerId}`);
      return;
    }

    // Check for duplicate track ID to prevent corruption
    if (this.state.tracks.some(t => t.id === message.track.id)) {
      console.log(`[MockDO] Ignoring duplicate track: ${message.track.id}`);
      return;
    }

    this.state.tracks.push(message.track);
    this.broadcast({
      type: 'track_added',
      playerId,
      track: message.track,
    });
    this.scheduleKVSave();
  }

  /**
   * Handle delete_track message
   */
  private handleDeleteTrack(playerId: string, message: { trackId: string }): void {
    const index = this.state.tracks.findIndex(t => t.id === message.trackId);
    if (index === -1) {
      console.log(`[MockDO] Track not found for delete: ${message.trackId}`);
      return;
    }

    this.state.tracks.splice(index, 1);
    this.broadcast({
      type: 'track_deleted',
      playerId,
      trackId: message.trackId,
    });
    this.scheduleKVSave();
  }

  /**
   * Broadcast a message to all clients (or all except sender)
   */
  broadcast(message: unknown, excludePlayerId?: string): void {
    const data = JSON.stringify(message);

    for (const [playerId, ws] of this.clients.entries()) {
      if (playerId === excludePlayerId) continue;
      if (ws.readyState !== 1) continue;

      setTimeout(() => {
        if (ws.onmessage) {
          ws.onmessage({ data });
        }
      }, this.simulatedLatency);
    }
  }

  /**
   * Simulate network latency
   */
  simulateLatency(ms: number): void {
    this.simulatedLatency = ms;
  }

  /**
   * Simulate disconnect for a specific player (for testing)
   */
  simulateDisconnect(playerId: string): void {
    this.disconnect(playerId, 1006, 'Connection lost');
  }

  /**
   * Get message history for debugging
   */
  getMessageHistory(): MockMessage[] {
    return [...this.messageHistory];
  }

  /**
   * Clear message history
   */
  clearMessageHistory(): void {
    this.messageHistory = [];
  }

  /**
   * Schedule a debounced save to KV
   */
  scheduleKVSave(): void {
    if (!this.kv) return;

    if (this.kvSaveTimeout) {
      clearTimeout(this.kvSaveTimeout);
    }
    this.pendingKVSave = true;
    this.kvSaveTimeout = setTimeout(() => {
      this.saveToKV();
    }, KV_SAVE_DEBOUNCE_MS);
  }

  /**
   * Save current state to KV (or simulate it)
   */
  saveToKV(): void {
    if (!this.kv) return;

    this.pendingKVSave = false;
    if (this.kvSaveTimeout) {
      clearTimeout(this.kvSaveTimeout);
      this.kvSaveTimeout = null;
    }

    // Deep clone state to avoid reference issues
    const stateCopy = JSON.parse(JSON.stringify(this.state)) as SessionState;
    this.kv.data.set(this.sessionId, stateCopy);
    this.kv.saveCount++;
    this.kv.lastSaveTime = Date.now();
    this.kv.saveCalls.push({
      sessionId: this.sessionId,
      state: stateCopy,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if there's a pending KV save
   */
  hasPendingKVSave(): boolean {
    return this.pendingKVSave;
  }

  /**
   * Get the attached KV store (for testing)
   */
  getKV(): MockKVStore | null {
    return this.kv;
  }

  /**
   * Attach a KV store (for testing)
   */
  setKV(kv: MockKVStore): void {
    this.kv = kv;
  }

  /**
   * Simulate DO hibernation (clears pending timeouts)
   */
  simulateHibernation(): void {
    if (this.kvSaveTimeout) {
      clearTimeout(this.kvSaveTimeout);
      this.kvSaveTimeout = null;
    }
    // Note: pendingKVSave remains true but the timeout is gone
    // This simulates the real DO hibernation behavior
  }

  /**
   * Get debug info
   */
  getDebugInfo(): {
    sessionId: string;
    connectedPlayers: number;
    isPlaying: boolean;
    currentStep: number;
    simulatedLatency: number;
    messageCount: number;
  } {
    return {
      sessionId: this.sessionId,
      connectedPlayers: this.clients.size,
      isPlaying: this.isPlaying,
      currentStep: this.currentStep,
      simulatedLatency: this.simulatedLatency,
      messageCount: this.messageHistory.length,
    };
  }
}

/**
 * Create a new mock session for testing
 */
export function createMockSession(
  sessionId: string = 'test-session',
  initialState?: SessionState,
  kv?: MockKVStore
): MockLiveSession {
  return new MockLiveSession(sessionId, initialState, kv);
}

/**
 * Create multiple mock clients connected to the same session
 */
export function createMockClients(
  session: MockLiveSession,
  count: number
): MockWebSocket[] {
  const clients: MockWebSocket[] = [];
  for (let i = 0; i < count; i++) {
    clients.push(session.connect(`player-${i}`));
  }
  return clients;
}
