/**
 * Phase 8-10: LiveSession Durable Object
 *
 * Handles real-time multiplayer collaboration for a single session.
 * Uses the Hibernation API for cost-efficient WebSocket handling.
 *
 * Features:
 * - Up to 10 concurrent players per session
 * - State synchronization on join
 * - Broadcast changes to all players
 * - Clock synchronization for audio sync
 * - Automatic ping/pong for connection health
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  SessionState,
  SessionTrack,
  PlayerInfo,
  ClientMessage,
  ServerMessage,
  ParameterLock,
} from './types';
import { getSession, updateSession } from './sessions';
import { hashStateAsync } from './logging';

const MAX_PLAYERS = 10;
const KV_SAVE_DEBOUNCE_MS = 2000;

export class LiveSessionDurableObject extends DurableObject<Env> {
  private players: Map<WebSocket, PlayerInfo> = new Map();
  private state: SessionState | null = null;
  private sessionId: string | null = null;
  private isPlaying: boolean = false;
  private playbackStartTime: number = 0;
  private kvSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Restore WebSocket connections from hibernation
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as PlayerInfo | null;
      if (attachment) {
        this.players.set(ws, attachment);
      }
    }

    // Auto-respond to ping with pong for connection health
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  /**
   * Handle incoming HTTP requests (including WebSocket upgrades)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade request
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request, url);
    }

    // HTTP endpoints for debugging
    if (url.pathname.endsWith('/debug')) {
      return this.handleDebugRequest();
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle WebSocket upgrade request
   */
  private async handleWebSocketUpgrade(request: Request, url: URL): Promise<Response> {
    // Check player limit
    if (this.players.size >= MAX_PLAYERS) {
      return new Response('Session full (max 10 players)', { status: 503 });
    }

    // Extract session ID from URL path
    const pathParts = url.pathname.split('/');
    const sessionIdIndex = pathParts.indexOf('sessions') + 1;
    this.sessionId = pathParts[sessionIdIndex] || null;

    // Load state from KV if not already loaded
    if (!this.state && this.sessionId) {
      const session = await getSession(this.env, this.sessionId);
      if (session) {
        this.state = session.state;
      } else {
        // Create default state if session doesn't exist
        this.state = {
          tracks: [],
          tempo: 120,
          swing: 0,
          version: 1,
        };
      }
    }

    // Create WebSocket pair
    const [client, server] = Object.values(new WebSocketPair());

    // Create player info
    const playerId = crypto.randomUUID();
    const playerInfo: PlayerInfo = {
      id: playerId,
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: 0,
    };

    // Accept the WebSocket with hibernation support
    this.ctx.acceptWebSocket(server);

    // Store player info as attachment for hibernation
    server.serializeAttachment(playerInfo);
    this.players.set(server, playerInfo);

    console.log(`[WS] connect session=${this.sessionId} player=${playerId} total=${this.players.size}`);

    // Return the WebSocket response first, then send initial data
    // Note: We need to queue the initial messages to be sent after the handshake completes
    // Using queueMicrotask to ensure we return the response first
    queueMicrotask(() => {
      try {
        // Send initial snapshot to the new player
        const snapshot: ServerMessage = {
          type: 'snapshot',
          state: this.state!,
          players: Array.from(this.players.values()),
          playerId,
        };
        server.send(JSON.stringify(snapshot));

        // Broadcast player joined to others
        this.broadcast({
          type: 'player_joined',
          player: playerInfo,
        }, server);
      } catch (e) {
        console.error('[WS] Error sending initial messages:', e);
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle WebSocket message (hibernation-compatible)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const player = this.players.get(ws);
    if (!player) {
      console.error('[WS] Message from unknown WebSocket');
      return;
    }

    // Update player activity
    player.lastMessageAt = Date.now();
    player.messageCount++;
    ws.serializeAttachment(player);

    // Parse message
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch (e) {
      console.error('[WS] Invalid JSON message');
      return;
    }

    console.log(`[WS] message session=${this.sessionId} player=${player.id} type=${msg.type}`);

    // Handle message based on type
    switch (msg.type) {
      case 'toggle_step':
        this.handleToggleStep(ws, player, msg);
        break;
      case 'set_tempo':
        this.handleSetTempo(ws, player, msg);
        break;
      case 'set_swing':
        this.handleSetSwing(ws, player, msg);
        break;
      case 'mute_track':
        this.handleMuteTrack(ws, player, msg);
        break;
      case 'solo_track':
        this.handleSoloTrack(ws, player, msg);
        break;
      case 'set_parameter_lock':
        this.handleSetParameterLock(ws, player, msg);
        break;
      case 'add_track':
        this.handleAddTrack(ws, player, msg);
        break;
      case 'delete_track':
        this.handleDeleteTrack(ws, player, msg);
        break;
      case 'clear_track':
        this.handleClearTrack(ws, player, msg);
        break;
      case 'set_track_sample':
        this.handleSetTrackSample(ws, player, msg);
        break;
      case 'set_track_volume':
        this.handleSetTrackVolume(ws, player, msg);
        break;
      case 'set_track_transpose':
        this.handleSetTrackTranspose(ws, player, msg);
        break;
      case 'set_track_step_count':
        this.handleSetTrackStepCount(ws, player, msg);
        break;
      case 'play':
        this.handlePlay(ws, player);
        break;
      case 'stop':
        this.handleStop(ws, player);
        break;
      case 'state_hash':
        this.handleStateHash(ws, player, msg);
        break;
      case 'clock_sync_request':
        this.handleClockSyncRequest(ws, player, msg);
        break;
      default:
        console.log(`[WS] Unknown message type: ${(msg as { type: string }).type}`);
    }
  }

  /**
   * Handle WebSocket close (hibernation-compatible)
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const player = this.players.get(ws);
    if (!player) return;

    this.players.delete(ws);

    console.log(`[WS] disconnect session=${this.sessionId} player=${player.id} reason=${reason} code=${code}`);

    // Broadcast player left to others
    this.broadcast({
      type: 'player_left',
      playerId: player.id,
    });

    // Save state to KV when last player leaves
    if (this.players.size === 0 && this.state && this.sessionId) {
      await this.saveToKV();
    }
  }

  /**
   * Handle WebSocket error (hibernation-compatible)
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const player = this.players.get(ws);
    console.error(`[WS] error session=${this.sessionId} player=${player?.id}`, error);
    this.players.delete(ws);
  }

  // ==================== Message Handlers ====================

  private handleToggleStep(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'toggle_step'; trackId: string; step: number }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Toggle the step
    const newValue = !track.steps[msg.step];
    track.steps[msg.step] = newValue;

    // Broadcast to all (including sender for confirmation)
    this.broadcast({
      type: 'step_toggled',
      trackId: msg.trackId,
      step: msg.step,
      value: newValue,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSetTempo(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_tempo'; tempo: number }
  ): void {
    if (!this.state) return;

    this.state.tempo = msg.tempo;

    this.broadcast({
      type: 'tempo_changed',
      tempo: msg.tempo,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSetSwing(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_swing'; swing: number }
  ): void {
    if (!this.state) return;

    this.state.swing = msg.swing;

    this.broadcast({
      type: 'swing_changed',
      swing: msg.swing,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleMuteTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'mute_track'; trackId: string; muted: boolean }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    track.muted = msg.muted;

    this.broadcast({
      type: 'track_muted',
      trackId: msg.trackId,
      muted: msg.muted,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSoloTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'solo_track'; trackId: string; soloed: boolean }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    track.soloed = msg.soloed;

    this.broadcast({
      type: 'track_soloed',
      trackId: msg.trackId,
      soloed: msg.soloed,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSetParameterLock(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_parameter_lock'; trackId: string; step: number; lock: ParameterLock | null }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    track.parameterLocks[msg.step] = msg.lock;

    this.broadcast({
      type: 'parameter_lock_set',
      trackId: msg.trackId,
      step: msg.step,
      lock: msg.lock,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleAddTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'add_track'; track: SessionTrack }
  ): void {
    if (!this.state) return;
    if (this.state.tracks.length >= 16) return; // Max tracks

    this.state.tracks.push(msg.track);

    this.broadcast({
      type: 'track_added',
      track: msg.track,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleDeleteTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'delete_track'; trackId: string }
  ): void {
    if (!this.state) return;

    const index = this.state.tracks.findIndex(t => t.id === msg.trackId);
    if (index === -1) return;

    this.state.tracks.splice(index, 1);

    this.broadcast({
      type: 'track_deleted',
      trackId: msg.trackId,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleClearTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'clear_track'; trackId: string }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Clear all steps and parameter locks
    track.steps = track.steps.map(() => false);
    track.parameterLocks = track.parameterLocks.map(() => null);

    this.broadcast({
      type: 'track_cleared',
      trackId: msg.trackId,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSetTrackSample(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_track_sample'; trackId: string; sampleId: string; name: string }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    track.sampleId = msg.sampleId;
    track.name = msg.name;

    this.broadcast({
      type: 'track_sample_set',
      trackId: msg.trackId,
      sampleId: msg.sampleId,
      name: msg.name,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSetTrackVolume(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_track_volume'; trackId: string; volume: number }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    track.volume = msg.volume;

    this.broadcast({
      type: 'track_volume_set',
      trackId: msg.trackId,
      volume: msg.volume,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSetTrackTranspose(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_track_transpose'; trackId: string; transpose: number }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    track.transpose = msg.transpose;

    this.broadcast({
      type: 'track_transpose_set',
      trackId: msg.trackId,
      transpose: msg.transpose,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handleSetTrackStepCount(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_track_step_count'; trackId: string; stepCount: number }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    track.stepCount = msg.stepCount;

    this.broadcast({
      type: 'track_step_count_set',
      trackId: msg.trackId,
      stepCount: msg.stepCount,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handlePlay(ws: WebSocket, player: PlayerInfo): void {
    this.isPlaying = true;
    this.playbackStartTime = Date.now();

    this.broadcast({
      type: 'playback_started',
      playerId: player.id,
      startTime: this.playbackStartTime,
      tempo: this.state?.tempo ?? 120,
    });
  }

  private handleStop(ws: WebSocket, player: PlayerInfo): void {
    this.isPlaying = false;

    this.broadcast({
      type: 'playback_stopped',
      playerId: player.id,
    });
  }

  private async handleStateHash(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'state_hash'; hash: string }
  ): Promise<void> {
    if (!this.state) return;

    const serverHash = await hashStateAsync(this.state);

    if (msg.hash !== serverHash) {
      // Send mismatch notification to the client
      const response: ServerMessage = {
        type: 'state_mismatch',
        serverHash,
      };
      ws.send(JSON.stringify(response));
    }
  }

  private handleClockSyncRequest(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'clock_sync_request'; clientTime: number }
  ): void {
    const response: ServerMessage = {
      type: 'clock_sync_response',
      clientTime: msg.clientTime,
      serverTime: Date.now(),
    };
    ws.send(JSON.stringify(response));
  }

  // ==================== Utilities ====================

  /**
   * Broadcast a message to all connected players
   */
  private broadcast(message: ServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const [ws] of this.players) {
      if (ws === exclude) continue;
      try {
        ws.send(data);
      } catch (e) {
        console.error('[WS] Error sending message:', e);
      }
    }
  }

  /**
   * Schedule a debounced save to KV
   */
  private scheduleKVSave(): void {
    if (this.kvSaveTimeout) {
      clearTimeout(this.kvSaveTimeout);
    }
    this.kvSaveTimeout = setTimeout(() => {
      this.saveToKV();
    }, KV_SAVE_DEBOUNCE_MS);
  }

  /**
   * Save current state to KV
   */
  private async saveToKV(): Promise<void> {
    if (!this.state || !this.sessionId) return;

    try {
      await updateSession(this.env, this.sessionId, this.state);
      console.log(`[KV] Saved session ${this.sessionId}`);
    } catch (e) {
      console.error(`[KV] Error saving session ${this.sessionId}:`, e);
    }
  }

  /**
   * Handle debug HTTP request
   */
  private handleDebugRequest(): Response {
    const debug = {
      sessionId: this.sessionId,
      connectedPlayers: this.players.size,
      players: Array.from(this.players.values()),
      isPlaying: this.isPlaying,
      playbackStartTime: this.playbackStartTime,
      trackCount: this.state?.tracks.length ?? 0,
      tempo: this.state?.tempo ?? 0,
      swing: this.state?.swing ?? 0,
    };

    return new Response(JSON.stringify(debug, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
