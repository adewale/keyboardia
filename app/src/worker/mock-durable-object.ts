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

import type { SessionState, ParameterLock, EffectsState, FMParams, PlaybackMode, CursorPosition } from './types';

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
  // Phase 22: Per-player playback tracking
  private playingPlayers: Set<string> = new Set();
  private currentStep: number = 0;
  private sessionId: string;

  // KV sync simulation (Phase 27: hybrid persistence - no debounce timeout)
  private kv: MockKVStore | null = null;
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

      // Phase 22: Clean up playback state if player was playing
      if (this.playingPlayers.has(playerId)) {
        this.playingPlayers.delete(playerId);
        // Broadcast stop on their behalf so other clients update their UI
        this.broadcast({
          type: 'playback_stopped',
          playerId,
        });
      }

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

      // Phase 26: Flush pending KV save immediately when last player disconnects
      if (this.clients.size === 0) {
        this.flushPendingKVSave();
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
        case 'set_track_volume':
          this.handleSetTrackVolume(playerId, message);
          break;
        case 'solo_track':
          this.handleSoloTrack(playerId, message);
          break;
        case 'set_parameter_lock':
          this.handleSetParameterLock(playerId, message);
          break;
        case 'clear_track':
          this.handleClearTrack(playerId, message);
          break;
        case 'copy_sequence':
          this.handleCopySequence(playerId, message);
          break;
        case 'move_sequence':
          this.handleMoveSequence(playerId, message);
          break;
        case 'set_track_sample':
          this.handleSetTrackSample(playerId, message);
          break;
        case 'set_track_transpose':
          this.handleSetTrackTranspose(playerId, message);
          break;
        case 'set_track_step_count':
          this.handleSetTrackStepCount(playerId, message);
          break;
        case 'set_track_playback_mode':
          this.handleSetTrackPlaybackMode(playerId, message);
          break;
        case 'set_effects':
          this.handleSetEffects(playerId, message);
          break;
        case 'set_fm_params':
          this.handleSetFMParams(playerId, message);
          break;
        case 'request_snapshot':
          this.handleRequestSnapshot(playerId);
          break;
        case 'clock_sync_request':
          this.handleClockSyncRequest(playerId, message);
          break;
        case 'cursor_move':
          this.handleCursorMove(playerId, message);
          break;
        case 'set_session_name':
          this.handleSetSessionName(playerId, message);
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
   * Supports both numeric trackId (index) and string trackId (track ID)
   */
  private handleToggleStep(playerId: string, message: { trackId: number | string; step: number }): void {
    // Find track by index (number) or by ID (string)
    const track = typeof message.trackId === 'number'
      ? this.state.tracks[message.trackId]
      : this.state.tracks.find(t => t.id === message.trackId);

    if (track) {
      track.steps[message.step] = !track.steps[message.step];
      this.broadcast({
        type: 'step_toggled',
        playerId,
        trackId: message.trackId,
        step: message.step,
        value: track.steps[message.step],
      });
      this.persistToDoStorage();
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
    this.persistToDoStorage();
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
    this.persistToDoStorage();
  }

  /**
   * Handle mute_track message
   */
  private handleMuteTrack(playerId: string, message: { trackId: number | string; muted: boolean }): void {
    // Find track by index (number) or by ID (string)
    const track = typeof message.trackId === 'number'
      ? this.state.tracks[message.trackId]
      : this.state.tracks.find(t => t.id === message.trackId);

    if (track) {
      track.muted = message.muted;
      this.broadcast({
        type: 'track_muted',
        playerId,
        trackId: message.trackId,
        muted: message.muted,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle set_track_volume message
   */
  private handleSetTrackVolume(playerId: string, message: { trackId: number | string; volume: number }): void {
    // Find track by index (number) or by ID (string)
    const track = typeof message.trackId === 'number'
      ? this.state.tracks[message.trackId]
      : this.state.tracks.find(t => t.id === message.trackId);

    if (track) {
      track.volume = message.volume;
      this.broadcast({
        type: 'track_volume_changed',
        playerId,
        trackId: message.trackId,
        volume: message.volume,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle play message
   * Phase 22: Per-player playback tracking
   */
  private handlePlay(playerId: string): void {
    this.playingPlayers.add(playerId);
    this.broadcast({
      type: 'playback_started',
      playerId,
      startStep: this.currentStep,
      serverTime: Date.now(),
    });
  }

  /**
   * Handle stop message
   * Phase 22: Per-player playback tracking
   */
  private handleStop(playerId: string): void {
    this.playingPlayers.delete(playerId);
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
   * BUG-09 FIX: Still broadcasts for duplicates so client can confirm mutation
   */
  private handleAddTrack(playerId: string, message: { track: SessionState['tracks'][0]; seq?: number }): void {
    // Max tracks limit (16)
    if (this.state.tracks.length >= 16) {
      console.log(`[MockDO] Max tracks reached, rejecting add_track from ${playerId}`);
      return;
    }

    // Check for duplicate track ID to prevent corruption
    // BUG-09 FIX: Even for duplicates, broadcast to confirm client's pending mutation
    if (this.state.tracks.some(t => t.id === message.track.id)) {
      console.log(`[MockDO] Duplicate track: ${message.track.id} (already exists, still broadcasting for confirmation)`);
      // Broadcast anyway so client can confirm mutation
      this.broadcast({
        type: 'track_added',
        playerId,
        track: message.track,
      }, undefined, message.seq);
      return;
    }

    this.state.tracks.push(message.track);
    this.broadcast({
      type: 'track_added',
      playerId,
      track: message.track,
    }, undefined, message.seq);
    this.persistToDoStorage();
  }

  /**
   * Handle delete_track message
   * BUG-09 FIX: Still broadcasts for already-deleted tracks so client can confirm mutation
   */
  private handleDeleteTrack(playerId: string, message: { trackId: string; seq?: number }): void {
    const index = this.state.tracks.findIndex(t => t.id === message.trackId);
    // BUG-09 FIX: Even for already-deleted tracks, we must still broadcast
    // so the client can confirm its pending mutation via clientSeq.
    // Without this, the client's mutation stays pending forever and triggers
    // invariant violations when snapshot is received.
    if (index === -1) {
      console.log(`[MockDO] Duplicate delete_track: ${message.trackId} (already deleted, still broadcasting for confirmation)`);
      // Broadcast anyway so client can confirm mutation
      this.broadcast({
        type: 'track_deleted',
        playerId,
        trackId: message.trackId,
      }, undefined, message.seq);
      return;
    }

    this.state.tracks.splice(index, 1);
    this.broadcast({
      type: 'track_deleted',
      playerId,
      trackId: message.trackId,
    }, undefined, message.seq);
    this.persistToDoStorage();
  }

  /**
   * Handle solo_track message
   */
  private handleSoloTrack(playerId: string, message: { trackId: number | string; soloed: boolean }): void {
    const track = typeof message.trackId === 'number'
      ? this.state.tracks[message.trackId]
      : this.state.tracks.find(t => t.id === message.trackId);

    if (track) {
      track.soloed = message.soloed;
      this.broadcast({
        type: 'track_soloed',
        playerId,
        trackId: typeof message.trackId === 'number' ? track.id : message.trackId,
        soloed: message.soloed,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle set_parameter_lock message
   */
  private handleSetParameterLock(playerId: string, message: { trackId: string; step: number; lock: ParameterLock | null }): void {
    const track = this.state.tracks.find(t => t.id === message.trackId);
    if (track) {
      track.parameterLocks[message.step] = message.lock;
      this.broadcast({
        type: 'parameter_lock_set',
        playerId,
        trackId: message.trackId,
        step: message.step,
        lock: message.lock,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle clear_track message
   */
  private handleClearTrack(playerId: string, message: { trackId: string }): void {
    const track = this.state.tracks.find(t => t.id === message.trackId);
    if (track) {
      const stepCount = track.stepCount ?? 16;
      track.steps = new Array(stepCount).fill(false);
      track.parameterLocks = new Array(stepCount).fill(null);
      this.broadcast({
        type: 'track_cleared',
        playerId,
        trackId: message.trackId,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle copy_sequence message
   */
  private handleCopySequence(playerId: string, message: { fromTrackId: string; toTrackId: string }): void {
    const fromTrack = this.state.tracks.find(t => t.id === message.fromTrackId);
    const toTrack = this.state.tracks.find(t => t.id === message.toTrackId);
    if (fromTrack && toTrack) {
      const stepCount = toTrack.stepCount ?? 16;
      toTrack.steps = [...fromTrack.steps.slice(0, stepCount)];
      toTrack.parameterLocks = [...fromTrack.parameterLocks.slice(0, stepCount)];
      this.broadcast({
        type: 'sequence_copied',
        playerId,
        fromTrackId: message.fromTrackId,
        toTrackId: message.toTrackId,
        steps: toTrack.steps,
        parameterLocks: toTrack.parameterLocks,
        stepCount,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle move_sequence message
   */
  private handleMoveSequence(playerId: string, message: { fromTrackId: string; toTrackId: string }): void {
    const fromTrack = this.state.tracks.find(t => t.id === message.fromTrackId);
    const toTrack = this.state.tracks.find(t => t.id === message.toTrackId);
    if (fromTrack && toTrack) {
      const stepCount = toTrack.stepCount ?? 16;
      toTrack.steps = [...fromTrack.steps.slice(0, stepCount)];
      toTrack.parameterLocks = [...fromTrack.parameterLocks.slice(0, stepCount)];
      // Clear the source track
      fromTrack.steps = new Array(fromTrack.stepCount ?? 16).fill(false);
      fromTrack.parameterLocks = new Array(fromTrack.stepCount ?? 16).fill(null);
      this.broadcast({
        type: 'sequence_moved',
        playerId,
        fromTrackId: message.fromTrackId,
        toTrackId: message.toTrackId,
        steps: toTrack.steps,
        parameterLocks: toTrack.parameterLocks,
        stepCount,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle set_track_sample message
   */
  private handleSetTrackSample(playerId: string, message: { trackId: string; sampleId: string; name: string }): void {
    const track = this.state.tracks.find(t => t.id === message.trackId);
    if (track) {
      track.sampleId = message.sampleId;
      track.name = message.name;
      this.broadcast({
        type: 'track_sample_set',
        playerId,
        trackId: message.trackId,
        sampleId: message.sampleId,
        name: message.name,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle set_track_transpose message
   */
  private handleSetTrackTranspose(playerId: string, message: { trackId: string; transpose: number }): void {
    const track = this.state.tracks.find(t => t.id === message.trackId);
    if (track) {
      track.transpose = message.transpose;
      this.broadcast({
        type: 'track_transpose_set',
        playerId,
        trackId: message.trackId,
        transpose: message.transpose,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle set_track_step_count message
   */
  private handleSetTrackStepCount(playerId: string, message: { trackId: string; stepCount: number }): void {
    const track = this.state.tracks.find(t => t.id === message.trackId);
    if (track) {
      const oldStepCount = track.stepCount ?? 16;
      track.stepCount = message.stepCount;
      // Resize arrays if needed
      if (message.stepCount > oldStepCount) {
        track.steps = [...track.steps, ...new Array(message.stepCount - oldStepCount).fill(false)];
        track.parameterLocks = [...track.parameterLocks, ...new Array(message.stepCount - oldStepCount).fill(null)];
      } else if (message.stepCount < oldStepCount) {
        track.steps = track.steps.slice(0, message.stepCount);
        track.parameterLocks = track.parameterLocks.slice(0, message.stepCount);
      }
      this.broadcast({
        type: 'track_step_count_set',
        playerId,
        trackId: message.trackId,
        stepCount: message.stepCount,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle set_track_playback_mode message
   */
  private handleSetTrackPlaybackMode(playerId: string, message: { trackId: string; playbackMode: PlaybackMode }): void {
    const track = this.state.tracks.find(t => t.id === message.trackId);
    if (track) {
      track.playbackMode = message.playbackMode;
      this.broadcast({
        type: 'track_playback_mode_set',
        playerId,
        trackId: message.trackId,
        playbackMode: message.playbackMode,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle set_effects message
   */
  private handleSetEffects(playerId: string, message: { effects: EffectsState }): void {
    this.state.effects = message.effects;
    this.broadcast({
      type: 'effects_changed',
      playerId,
      effects: message.effects,
    });
    this.persistToDoStorage();
  }

  /**
   * Handle set_fm_params message
   */
  private handleSetFMParams(playerId: string, message: { trackId: string; fmParams: FMParams }): void {
    const track = this.state.tracks.find(t => t.id === message.trackId);
    if (track) {
      track.fmParams = message.fmParams;
      this.broadcast({
        type: 'fm_params_changed',
        playerId,
        trackId: message.trackId,
        fmParams: message.fmParams,
      });
      this.persistToDoStorage();
    }
  }

  /**
   * Handle request_snapshot message
   */
  private handleRequestSnapshot(playerId: string): void {
    const ws = this.clients.get(playerId);
    if (ws && ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          type: 'snapshot',
          state: this.state,
          players: this.getConnectedPlayers().map(id => ({ id, name: `Player ${id}`, color: '#ffffff' })),
          playerId,
          playingPlayerIds: Array.from(this.playingPlayers),
        }),
      });
    }
  }

  /**
   * Handle clock_sync_request message
   */
  private handleClockSyncRequest(playerId: string, message: { clientTime: number }): void {
    const ws = this.clients.get(playerId);
    if (ws && ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          type: 'clock_sync_response',
          clientTime: message.clientTime,
          serverTime: Date.now(),
        }),
      });
    }
  }

  /**
   * Handle cursor_move message
   */
  private handleCursorMove(playerId: string, message: { position: CursorPosition }): void {
    this.broadcast({
      type: 'cursor_moved',
      playerId,
      position: message.position,
      color: '#ffffff', // Default color for mock
      name: `Player ${playerId}`,
    }, playerId); // Exclude sender
  }

  /**
   * Handle set_session_name message
   */
  private handleSetSessionName(playerId: string, message: { name: string }): void {
    const sanitizedName = message.name.trim().slice(0, 100) || null;
    // Note: In mock, we don't persist to KV - just broadcast
    this.broadcast({
      type: 'session_name_changed',
      playerId,
      name: sanitizedName ?? '',
    });
  }

  /**
   * Broadcast a message to all clients (or all except sender)
   * BUG-09 FIX: Now accepts clientSeq for mutation confirmation
   */
  broadcast(message: unknown, excludePlayerId?: string, clientSeq?: number): void {
    // Include clientSeq in message if provided (for mutation confirmation)
    const msgWithSeq = clientSeq !== undefined
      ? { ...(message as Record<string, unknown>), clientSeq }
      : message;
    const data = JSON.stringify(msgWithSeq);

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
   * Phase 27: Persist state to DO storage (simulated)
   * In mock, we just mark KV as needing flush on disconnect.
   * Real DO uses: await this.ctx.storage.put('state', this.state);
   */
  persistToDoStorage(): void {
    this.pendingKVSave = true;
  }

  /**
   * Save current state to KV (or simulate it)
   */
  saveToKV(): void {
    if (!this.kv) return;

    this.pendingKVSave = false;

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
   * Phase 26: Flush pending KV save immediately
   * Called when last player disconnects to prevent stale snapshots.
   */
  flushPendingKVSave(): void {
    if (!this.kv) return;

    if (!this.pendingKVSave) {
      // No pending save - nothing to flush
      return;
    }

    // Save immediately and clear pending state
    this.saveToKV();
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
   * Simulate DO hibernation
   * Phase 27: With hybrid persistence, DO storage is always up-to-date,
   * so hibernation just means the in-memory state is cleared.
   * pendingKVSave flag indicates KV needs sync on next reconnect.
   */
  simulateHibernation(): void {
    // Phase 27: No debounce timeout to clear.
    // pendingKVSave flag is preserved - KV will sync when player reconnects.
  }

  /**
   * Get debug info
   * Phase 22: Updated to use per-player playback tracking
   */
  getDebugInfo(): {
    sessionId: string;
    connectedPlayers: number;
    playingPlayerIds: string[];
    playingCount: number;
    currentStep: number;
    simulatedLatency: number;
    messageCount: number;
  } {
    return {
      sessionId: this.sessionId,
      connectedPlayers: this.clients.size,
      playingPlayerIds: Array.from(this.playingPlayers),
      playingCount: this.playingPlayers.size,
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
