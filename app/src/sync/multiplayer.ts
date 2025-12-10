/**
 * Phase 9-10: Multiplayer WebSocket connection manager
 *
 * Handles real-time synchronization between clients via Durable Objects.
 * Features:
 * - WebSocket connection management with auto-reconnect
 * - State sync on connect
 * - Broadcast changes to all players
 * - Clock synchronization for audio sync
 */

import type { GridAction, Track, ParameterLock } from '../types';

// ============================================================================
// Types (mirrored from worker/types.ts for frontend use)
// ============================================================================

export interface PlayerInfo {
  id: string;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number;
}

// Client → Server messages
type ClientMessage =
  | { type: 'toggle_step'; trackId: string; step: number }
  | { type: 'set_tempo'; tempo: number }
  | { type: 'set_swing'; swing: number }
  | { type: 'mute_track'; trackId: string; muted: boolean }
  | { type: 'solo_track'; trackId: string; soloed: boolean }
  | { type: 'set_parameter_lock'; trackId: string; step: number; lock: ParameterLock | null }
  | { type: 'add_track'; track: Track }
  | { type: 'delete_track'; trackId: string }
  | { type: 'clear_track'; trackId: string }
  | { type: 'set_track_sample'; trackId: string; sampleId: string; name: string }
  | { type: 'set_track_volume'; trackId: string; volume: number }
  | { type: 'set_track_transpose'; trackId: string; transpose: number }
  | { type: 'set_track_step_count'; trackId: string; stepCount: number }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'state_hash'; hash: string }
  | { type: 'clock_sync_request'; clientTime: number };

// Server → Client messages
type ServerMessage =
  | { type: 'snapshot'; state: SessionState; players: PlayerInfo[]; playerId: string }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean; playerId: string }
  | { type: 'tempo_changed'; tempo: number; playerId: string }
  | { type: 'swing_changed'; swing: number; playerId: string }
  | { type: 'track_muted'; trackId: string; muted: boolean; playerId: string }
  | { type: 'track_soloed'; trackId: string; soloed: boolean; playerId: string }
  | { type: 'parameter_lock_set'; trackId: string; step: number; lock: ParameterLock | null; playerId: string }
  | { type: 'track_added'; track: Track; playerId: string }
  | { type: 'track_deleted'; trackId: string; playerId: string }
  | { type: 'track_cleared'; trackId: string; playerId: string }
  | { type: 'track_sample_set'; trackId: string; sampleId: string; name: string; playerId: string }
  | { type: 'track_volume_set'; trackId: string; volume: number; playerId: string }
  | { type: 'track_transpose_set'; trackId: string; transpose: number; playerId: string }
  | { type: 'track_step_count_set'; trackId: string; stepCount: number; playerId: string }
  | { type: 'playback_started'; playerId: string; startTime: number; tempo: number }
  | { type: 'playback_stopped'; playerId: string }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | { type: 'state_mismatch'; serverHash: string }
  | { type: 'clock_sync_response'; clientTime: number; serverTime: number }
  | { type: 'error'; message: string };

interface SessionState {
  tracks: Track[];
  tempo: number;
  swing: number;
  version: number;
}

// ============================================================================
// Connection Status
// ============================================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface MultiplayerState {
  status: ConnectionStatus;
  playerId: string | null;
  players: PlayerInfo[];
  error: string | null;
}

// ============================================================================
// Clock Sync
// ============================================================================

const CLOCK_SYNC_SAMPLES = 5;
const CLOCK_SYNC_INTERVAL_MS = 5000;

class ClockSync {
  private offset: number = 0;
  private rtt: number = 0;
  private samples: { offset: number; rtt: number }[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private onSync: ((offset: number, rtt: number) => void) | null = null;

  start(requestSync: () => void, onSync: (offset: number, rtt: number) => void): void {
    this.onSync = onSync;
    // Initial sync
    requestSync();
    // Periodic sync
    this.syncInterval = setInterval(requestSync, CLOCK_SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.samples = [];
    this.offset = 0;
    this.rtt = 0;
  }

  handleSyncResponse(clientTime: number, serverTime: number): void {
    const now = Date.now();
    const rtt = now - clientTime;
    const offset = serverTime - now + rtt / 2;

    this.samples.push({ offset, rtt });
    if (this.samples.length > CLOCK_SYNC_SAMPLES) {
      this.samples.shift();
    }

    // Calculate average offset (excluding outliers)
    const sortedOffsets = [...this.samples].sort((a, b) => a.offset - b.offset);
    const median = sortedOffsets[Math.floor(sortedOffsets.length / 2)].offset;
    this.offset = median;
    this.rtt = this.samples.reduce((sum, s) => sum + s.rtt, 0) / this.samples.length;

    if (this.onSync) {
      this.onSync(this.offset, this.rtt);
    }
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
}

// ============================================================================
// Multiplayer Connection
// ============================================================================

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;

type DispatchFn = (action: GridAction) => void;
type StateChangedCallback = (state: MultiplayerState) => void;
type PlaybackCallback = (startTime: number, tempo: number) => void;

class MultiplayerConnection {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private dispatch: DispatchFn | null = null;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private stateCallback: StateChangedCallback | null = null;
  private playbackStartCallback: PlaybackCallback | null = null;
  private playbackStopCallback: (() => void) | null = null;

  private state: MultiplayerState = {
    status: 'disconnected',
    playerId: null,
    players: [],
    error: null,
  };

  public readonly clockSync = new ClockSync();

  /**
   * Connect to multiplayer session
   */
  connect(
    sessionId: string,
    dispatch: DispatchFn,
    onStateChanged?: StateChangedCallback,
    onPlaybackStart?: PlaybackCallback,
    onPlaybackStop?: () => void
  ): void {
    this.sessionId = sessionId;
    this.dispatch = dispatch;
    this.stateCallback = onStateChanged ?? null;
    this.playbackStartCallback = onPlaybackStart ?? null;
    this.playbackStopCallback = onPlaybackStop ?? null;

    this.updateState({ status: 'connecting', error: null });
    this.createWebSocket();
  }

  /**
   * Disconnect from multiplayer session
   */
  disconnect(): void {
    this.cleanup();
    this.updateState({
      status: 'disconnected',
      playerId: null,
      players: [],
    });
  }

  /**
   * Send a message to the server
   */
  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Get current connection state
   */
  getState(): MultiplayerState {
    return { ...this.state };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  /**
   * Get server time (adjusted for clock sync)
   */
  getServerTime(): number {
    return this.clockSync.getServerTime();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createWebSocket(): void {
    if (!this.sessionId) return;

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/sessions/${this.sessionId}/ws`;

    console.log('[WS] Connecting to', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
    } catch (e) {
      console.error('[WS] Failed to create WebSocket:', e);
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    console.log('[WS] Connected');
    this.reconnectAttempts = 0;

    // Start clock sync
    this.clockSync.start(
      () => this.send({ type: 'clock_sync_request', clientTime: Date.now() }),
      (offset, rtt) => console.log(`[WS] Clock sync: offset=${offset}ms, rtt=${rtt}ms`)
    );
  }

  private handleClose(event: CloseEvent): void {
    console.log('[WS] Disconnected:', event.code, event.reason);
    this.clockSync.stop();

    if (event.code !== 1000) {
      // Abnormal close - try to reconnect
      this.scheduleReconnect();
    } else {
      this.updateState({ status: 'disconnected' });
    }
  }

  private handleError(event: Event): void {
    console.error('[WS] Error:', event);
    this.updateState({ error: 'Connection error' });
  }

  private handleMessage(event: MessageEvent): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error('[WS] Invalid message:', e);
      return;
    }

    console.log('[WS] Received:', msg.type);

    switch (msg.type) {
      case 'snapshot':
        this.handleSnapshot(msg);
        break;
      case 'step_toggled':
        this.handleStepToggled(msg);
        break;
      case 'tempo_changed':
        this.handleTempoChanged(msg);
        break;
      case 'swing_changed':
        this.handleSwingChanged(msg);
        break;
      case 'track_muted':
        this.handleTrackMuted(msg);
        break;
      case 'track_soloed':
        this.handleTrackSoloed(msg);
        break;
      case 'parameter_lock_set':
        this.handleParameterLockSet(msg);
        break;
      case 'track_added':
        this.handleTrackAdded(msg);
        break;
      case 'track_deleted':
        this.handleTrackDeleted(msg);
        break;
      case 'track_cleared':
        this.handleTrackCleared(msg);
        break;
      case 'track_sample_set':
        this.handleTrackSampleSet(msg);
        break;
      case 'track_volume_set':
        this.handleTrackVolumeSet(msg);
        break;
      case 'track_transpose_set':
        this.handleTrackTransposeSet(msg);
        break;
      case 'track_step_count_set':
        this.handleTrackStepCountSet(msg);
        break;
      case 'playback_started':
        this.handlePlaybackStarted(msg);
        break;
      case 'playback_stopped':
        this.handlePlaybackStopped(msg);
        break;
      case 'player_joined':
        this.handlePlayerJoined(msg);
        break;
      case 'player_left':
        this.handlePlayerLeft(msg);
        break;
      case 'clock_sync_response':
        this.clockSync.handleSyncResponse(msg.clientTime, msg.serverTime);
        break;
      case 'state_mismatch':
        console.warn('[WS] State mismatch detected, server hash:', msg.serverHash);
        break;
      case 'error':
        console.error('[WS] Server error:', msg.message);
        this.updateState({ error: msg.message });
        break;
    }
  }

  // ============================================================================
  // Message Handlers
  // ============================================================================

  private handleSnapshot(msg: { state: SessionState; players: PlayerInfo[]; playerId: string }): void {
    this.updateState({
      status: 'connected',
      playerId: msg.playerId,
      players: msg.players,
    });

    // Load state into grid
    if (this.dispatch) {
      this.dispatch({
        type: 'LOAD_STATE',
        tracks: msg.state.tracks,
        tempo: msg.state.tempo,
        swing: msg.state.swing,
        isRemote: true,
      });
    }
  }

  private handleStepToggled(msg: { trackId: string; step: number; value: boolean; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return; // Skip own messages

    if (this.dispatch) {
      // Use REMOTE_STEP_SET to set specific value without toggling
      this.dispatch({
        type: 'REMOTE_STEP_SET',
        trackId: msg.trackId,
        step: msg.step,
        value: msg.value,
        isRemote: true,
      });
    }
  }

  private handleTempoChanged(msg: { tempo: number; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({ type: 'SET_TEMPO', tempo: msg.tempo, isRemote: true });
    }
  }

  private handleSwingChanged(msg: { swing: number; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({ type: 'SET_SWING', swing: msg.swing, isRemote: true });
    }
  }

  private handleTrackMuted(msg: { trackId: string; muted: boolean; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'REMOTE_MUTE_SET',
        trackId: msg.trackId,
        muted: msg.muted,
        isRemote: true,
      });
    }
  }

  private handleTrackSoloed(msg: { trackId: string; soloed: boolean; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'REMOTE_SOLO_SET',
        trackId: msg.trackId,
        soloed: msg.soloed,
        isRemote: true,
      });
    }
  }

  private handleParameterLockSet(msg: { trackId: string; step: number; lock: ParameterLock | null; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'SET_PARAMETER_LOCK',
        trackId: msg.trackId,
        step: msg.step,
        lock: msg.lock,
        isRemote: true,
      });
    }
  }

  private handleTrackAdded(msg: { track: Track; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'ADD_TRACK',
        sampleId: msg.track.sampleId,
        name: msg.track.name,
        track: msg.track,
        isRemote: true,
      });
    }
  }

  private handleTrackDeleted(msg: { trackId: string; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'DELETE_TRACK',
        trackId: msg.trackId,
        isRemote: true,
      });
    }
  }

  private handleTrackCleared(msg: { trackId: string; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'CLEAR_TRACK',
        trackId: msg.trackId,
        isRemote: true,
      });
    }
  }

  private handleTrackSampleSet(msg: { trackId: string; sampleId: string; name: string; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'SET_TRACK_SAMPLE',
        trackId: msg.trackId,
        sampleId: msg.sampleId,
        name: msg.name,
        isRemote: true,
      });
    }
  }

  private handleTrackVolumeSet(msg: { trackId: string; volume: number; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'SET_TRACK_VOLUME',
        trackId: msg.trackId,
        volume: msg.volume,
        isRemote: true,
      });
    }
  }

  private handleTrackTransposeSet(msg: { trackId: string; transpose: number; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'SET_TRACK_TRANSPOSE',
        trackId: msg.trackId,
        transpose: msg.transpose,
        isRemote: true,
      });
    }
  }

  private handleTrackStepCountSet(msg: { trackId: string; stepCount: number; playerId: string }): void {
    if (msg.playerId === this.state.playerId) return;

    if (this.dispatch) {
      this.dispatch({
        type: 'SET_TRACK_STEP_COUNT',
        trackId: msg.trackId,
        stepCount: msg.stepCount,
        isRemote: true,
      });
    }
  }

  private handlePlaybackStarted(msg: { playerId: string; startTime: number; tempo: number }): void {
    console.log('[WS] Playback started by', msg.playerId, 'at', msg.startTime);

    if (this.playbackStartCallback) {
      this.playbackStartCallback(msg.startTime, msg.tempo);
    }
  }

  private handlePlaybackStopped(msg: { playerId: string }): void {
    console.log('[WS] Playback stopped by', msg.playerId);

    if (this.playbackStopCallback) {
      this.playbackStopCallback();
    }
  }

  private handlePlayerJoined(msg: { player: PlayerInfo }): void {
    const players = [...this.state.players, msg.player];
    this.updateState({ players });
    console.log('[WS] Player joined:', msg.player.id, 'Total:', players.length);
  }

  private handlePlayerLeft(msg: { playerId: string }): void {
    const players = this.state.players.filter(p => p.id !== msg.playerId);
    this.updateState({ players });
    console.log('[WS] Player left:', msg.playerId, 'Total:', players.length);
  }

  // ============================================================================
  // Reconnection
  // ============================================================================

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[WS] Max reconnect attempts reached');
      this.updateState({
        status: 'disconnected',
        error: 'Failed to reconnect after multiple attempts',
      });
      return;
    }

    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.updateState({ status: 'connecting' });

    this.reconnectTimeout = setTimeout(() => {
      this.createWebSocket();
    }, delay);
  }

  private cleanup(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }

    this.clockSync.stop();
    this.reconnectAttempts = 0;
  }

  private updateState(update: Partial<MultiplayerState>): void {
    this.state = { ...this.state, ...update };
    if (this.stateCallback) {
      this.stateCallback(this.state);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const multiplayer = new MultiplayerConnection();

/**
 * Convert a GridAction to a ClientMessage for sending over WebSocket
 * Returns null if the action shouldn't be sent (e.g., local-only actions)
 */
export function actionToMessage(action: GridAction): ClientMessage | null {
  // Skip remote actions (prevent echo)
  if ('isRemote' in action && action.isRemote) {
    return null;
  }

  switch (action.type) {
    case 'TOGGLE_STEP':
      return { type: 'toggle_step', trackId: action.trackId, step: action.step };
    case 'SET_TEMPO':
      return { type: 'set_tempo', tempo: action.tempo };
    case 'SET_SWING':
      return { type: 'set_swing', swing: action.swing };
    case 'TOGGLE_MUTE':
      // TOGGLE_MUTE doesn't have the final value, we need to handle this differently
      // The server will toggle, but we should send the intended state
      // For now, skip toggle actions and rely on REMOTE_MUTE_SET pattern
      return null;
    case 'TOGGLE_SOLO':
      return null; // Same as TOGGLE_MUTE
    case 'SET_PARAMETER_LOCK':
      return {
        type: 'set_parameter_lock',
        trackId: action.trackId,
        step: action.step,
        lock: action.lock,
      };
    case 'ADD_TRACK':
      // ADD_TRACK doesn't have a full track object, just sampleId and name
      // The track is created by the reducer, so we skip sending here
      // The track will be synced when handleTrackAdded receives the broadcast
      return null;
    case 'DELETE_TRACK':
      return { type: 'delete_track', trackId: action.trackId };
    case 'CLEAR_TRACK':
      return { type: 'clear_track', trackId: action.trackId };
    case 'SET_TRACK_SAMPLE':
      return {
        type: 'set_track_sample',
        trackId: action.trackId,
        sampleId: action.sampleId,
        name: action.name ?? action.sampleId, // Default to sampleId if name not provided
      };
    case 'SET_TRACK_VOLUME':
      return {
        type: 'set_track_volume',
        trackId: action.trackId,
        volume: action.volume,
      };
    case 'SET_TRACK_TRANSPOSE':
      return {
        type: 'set_track_transpose',
        trackId: action.trackId,
        transpose: action.transpose,
      };
    case 'SET_TRACK_STEP_COUNT':
      return {
        type: 'set_track_step_count',
        trackId: action.trackId,
        stepCount: action.stepCount,
      };
    case 'SET_PLAYING':
      return action.isPlaying ? { type: 'play' } : { type: 'stop' };
    default:
      return null;
  }
}

/**
 * Send mute state change (with explicit value, not toggle)
 */
export function sendMuteChange(trackId: string, muted: boolean): void {
  multiplayer.send({ type: 'mute_track', trackId, muted });
}

/**
 * Send solo state change (with explicit value, not toggle)
 */
export function sendSoloChange(trackId: string, soloed: boolean): void {
  multiplayer.send({ type: 'solo_track', trackId, soloed });
}

/**
 * Send add track with full track data
 * Called after the reducer creates the track
 */
export function sendAddTrack(track: Track): void {
  multiplayer.send({ type: 'add_track', track });
}
