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
  CursorPosition,
} from './types';
import { getSession, updateSession } from './sessions';
import { hashStateAsync } from './logging';
import {
  validateStateInvariants,
  logInvariantStatus,
  repairStateInvariants,
  clamp,
  isValidNumber,
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_TRANSPOSE,
  MAX_TRANSPOSE,
  MAX_STEPS,
  MAX_MESSAGE_SIZE,
} from './invariants';

const MAX_PLAYERS = 10;

// Phase 11: Identity generation (duplicated from utils/identity.ts for worker)
const IDENTITY_COLORS = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB', '#1E88E5',
  '#039BE5', '#00ACC1', '#00897B', '#43A047', '#7CB342', '#C0CA33',
  '#FDD835', '#FFB300', '#FB8C00', '#F4511E', '#6D4C41', '#757575',
];
const IDENTITY_COLOR_NAMES = [
  'Red', 'Pink', 'Purple', 'Violet', 'Indigo', 'Blue', 'Sky', 'Cyan',
  'Teal', 'Green', 'Lime', 'Olive', 'Yellow', 'Amber', 'Orange', 'Coral',
  'Brown', 'Grey',
];
const IDENTITY_ANIMALS = [
  'Ant', 'Badger', 'Bat', 'Bear', 'Beaver', 'Bee', 'Bird', 'Bison',
  'Butterfly', 'Camel', 'Cat', 'Cheetah', 'Chicken', 'Crab', 'Crow',
  'Deer', 'Dog', 'Dolphin', 'Dove', 'Dragon', 'Duck', 'Eagle', 'Elephant',
  'Falcon', 'Fish', 'Flamingo', 'Fox', 'Frog', 'Giraffe', 'Goat',
  'Gorilla', 'Hamster', 'Hawk', 'Hedgehog', 'Hippo', 'Horse', 'Jaguar',
  'Kangaroo', 'Koala', 'Lemur', 'Leopard', 'Lion', 'Llama', 'Lobster',
  'Monkey', 'Moose', 'Mouse', 'Octopus', 'Otter', 'Owl', 'Panda',
  'Panther', 'Parrot', 'Peacock', 'Penguin', 'Pig', 'Puma', 'Rabbit',
  'Raccoon', 'Raven', 'Rhino', 'Seal', 'Shark', 'Sheep', 'Snake',
  'Spider', 'Squid', 'Swan', 'Tiger', 'Turtle', 'Whale', 'Wolf', 'Zebra',
];

function generateIdentity(playerId: string) {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    const char = playerId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const absHash = Math.abs(hash);
  const colorIndex = absHash % IDENTITY_COLORS.length;
  const animalIndex = (absHash >> 8) % IDENTITY_ANIMALS.length;
  return {
    color: IDENTITY_COLORS[colorIndex],
    colorIndex,
    animal: IDENTITY_ANIMALS[animalIndex],
    name: `${IDENTITY_COLOR_NAMES[colorIndex]} ${IDENTITY_ANIMALS[animalIndex]}`,
  };
}
const KV_SAVE_DEBOUNCE_MS = 2000;

export class LiveSessionDurableObject extends DurableObject<Env> {
  private players: Map<WebSocket, PlayerInfo> = new Map();
  private state: SessionState | null = null;
  private sessionId: string | null = null;
  private isPlaying: boolean = false;
  private playbackStartTime: number = 0;
  private pendingKVSave: boolean = false;

  // Phase 13B: Server sequence number for message ordering
  private serverSeq: number = 0;

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
      return this.handleDebugRequest(url);
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
        // Validate and repair state loaded from KV
        this.validateAndRepairState('loadFromKV');
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

    // Create player info with identity
    const playerId = crypto.randomUUID();
    const identity = generateIdentity(playerId);
    const playerInfo: PlayerInfo = {
      id: playerId,
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: 0,
      color: identity.color,
      colorIndex: identity.colorIndex,
      animal: identity.animal,
      name: identity.name,
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

    // Message size validation
    const messageSize = typeof message === 'string' ? message.length : message.byteLength;
    if (messageSize > MAX_MESSAGE_SIZE) {
      console.error(`[WS] Message too large: ${messageSize} bytes (max ${MAX_MESSAGE_SIZE})`);
      ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
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
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
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
      case 'request_snapshot':
        this.handleRequestSnapshot(ws, player);
        break;
      case 'clock_sync_request':
        this.handleClockSyncRequest(ws, player, msg);
        break;
      case 'cursor_move':
        this.handleCursorMove(ws, player, msg);
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

    if (player) {
      this.players.delete(ws);

      // Broadcast player left to others (same as webSocketClose)
      this.broadcast({
        type: 'player_left',
        playerId: player.id,
      });

      // Save state to KV when last player leaves
      if (this.players.size === 0 && this.state && this.sessionId) {
        await this.saveToKV();
      }
    } else {
      this.players.delete(ws);
    }
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

    // Validate step index
    if (!isValidNumber(msg.step, 0, MAX_STEPS - 1) || !Number.isInteger(msg.step)) {
      console.warn(`[WS] Invalid step index ${msg.step} from ${player.id}`);
      return;
    }

    // Ensure steps array is long enough
    while (track.steps.length <= msg.step) {
      track.steps.push(false);
    }

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

    // Validate and clamp tempo to valid range
    if (!isValidNumber(msg.tempo, MIN_TEMPO, MAX_TEMPO)) {
      console.warn(`[WS] Invalid tempo ${msg.tempo} from ${player.id}, clamping`);
    }
    const validTempo = clamp(msg.tempo, MIN_TEMPO, MAX_TEMPO);
    this.state.tempo = validTempo;

    this.broadcast({
      type: 'tempo_changed',
      tempo: validTempo,
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

    // Validate and clamp swing to valid range
    if (!isValidNumber(msg.swing, MIN_SWING, MAX_SWING)) {
      console.warn(`[WS] Invalid swing ${msg.swing} from ${player.id}, clamping`);
    }
    const validSwing = clamp(msg.swing, MIN_SWING, MAX_SWING);
    this.state.swing = validSwing;

    this.broadcast({
      type: 'swing_changed',
      swing: validSwing,
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

    // Check for duplicate track ID to prevent corruption
    if (this.state.tracks.some(t => t.id === msg.track.id)) {
      console.log(`[WS] Ignoring duplicate track: ${msg.track.id}`);
      return;
    }

    this.state.tracks.push(msg.track);

    // Validate state after mutation
    this.validateAndRepairState('handleAddTrack');

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

    // Validate state after mutation
    this.validateAndRepairState('handleDeleteTrack');

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

    // Validate state after mutation
    this.validateAndRepairState('handleClearTrack');

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

    // Validate and clamp volume
    if (!isValidNumber(msg.volume, MIN_VOLUME, MAX_VOLUME)) {
      console.warn(`[WS] Invalid volume ${msg.volume} from ${player.id}, clamping`);
    }
    const validVolume = clamp(msg.volume, MIN_VOLUME, MAX_VOLUME);
    track.volume = validVolume;

    this.broadcast({
      type: 'track_volume_set',
      trackId: msg.trackId,
      volume: validVolume,
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

    // Validate and clamp transpose
    if (!isValidNumber(msg.transpose, MIN_TRANSPOSE, MAX_TRANSPOSE)) {
      console.warn(`[WS] Invalid transpose ${msg.transpose} from ${player.id}, clamping`);
    }
    const validTranspose = Math.round(clamp(msg.transpose, MIN_TRANSPOSE, MAX_TRANSPOSE));
    track.transpose = validTranspose;

    this.broadcast({
      type: 'track_transpose_set',
      trackId: msg.trackId,
      transpose: validTranspose,
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

    // Validate step count - must be valid step count option
    const validStepCounts = [4, 8, 16, 32, 64];
    if (!validStepCounts.includes(msg.stepCount)) {
      console.warn(`[WS] Invalid stepCount ${msg.stepCount} from ${player.id}`);
      return;
    }
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

  /**
   * Handle request_snapshot - client requests full state (e.g., after mismatch)
   */
  private handleRequestSnapshot(ws: WebSocket, player: PlayerInfo): void {
    if (!this.state) return;

    console.log(`[WS] snapshot requested by player=${player.id} (recovery)`);

    const players = Array.from(this.players.values());
    const response: ServerMessage = {
      type: 'snapshot',
      state: this.state,
      players,
      playerId: player.id,
    };
    ws.send(JSON.stringify(response));
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

  /**
   * Phase 11: Handle cursor movement from a player
   * Broadcasts to all other players (not the sender)
   */
  private handleCursorMove(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'cursor_move'; position: CursorPosition }
  ): void {
    // Don't log cursor moves (too noisy)
    // Broadcast to all other players
    this.broadcast({
      type: 'cursor_moved',
      playerId: player.id,
      position: msg.position,
      color: player.color,
      name: player.name,
    }, ws); // Exclude sender
  }

  // ==================== Utilities ====================

  /**
   * Broadcast a message to all connected players
   * Phase 13B: Add sequence numbers for message ordering
   * @param message - The message to broadcast
   * @param exclude - Optional WebSocket to exclude (usually the sender)
   * @param clientSeq - Optional client sequence number for request-response correlation
   */
  private broadcast(message: ServerMessage, exclude?: WebSocket, clientSeq?: number): void {
    // Phase 13B: Add server sequence number to broadcast messages
    const messageWithSeq: ServerMessage = {
      ...message,
      seq: ++this.serverSeq,
      ...(clientSeq !== undefined && { clientSeq }),
    };
    const data = JSON.stringify(messageWithSeq);
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
   * Schedule a debounced save to KV using Durable Object Alarms
   * Alarms survive hibernation, unlike setTimeout
   */
  private scheduleKVSave(): void {
    this.pendingKVSave = true;
    // Set alarm for KV_SAVE_DEBOUNCE_MS in the future
    // This will override any existing alarm, providing debounce behavior
    this.ctx.storage.setAlarm(Date.now() + KV_SAVE_DEBOUNCE_MS).catch(e => {
      console.error('[KV] Error scheduling alarm:', e);
    });
  }

  /**
   * Alarm handler - called when the scheduled alarm fires
   * This survives hibernation and is guaranteed at-least-once execution
   */
  async alarm(): Promise<void> {
    if (this.pendingKVSave) {
      await this.saveToKV();
      this.pendingKVSave = false;
    }
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
   * Validate state invariants after mutation
   * Logs violations and optionally auto-repairs
   */
  private validateAndRepairState(context: string): void {
    if (!this.state || !this.sessionId) return;

    const result = validateStateInvariants(this.state);

    if (!result.valid) {
      // Log the violation for monitoring
      logInvariantStatus(this.state, this.sessionId, context);

      // Auto-repair if possible
      const { repairedState, repairs } = repairStateInvariants(this.state);
      if (repairs.length > 0) {
        console.warn(`[INVARIANT] Auto-repaired state for session=${this.sessionId}`, { repairs });
        this.state = repairedState;
      }
    }
  }

  /**
   * Handle debug HTTP request
   */
  private async handleDebugRequest(url: URL): Promise<Response> {
    // Extract session ID from URL and load state if not already loaded
    const pathParts = url.pathname.split('/');
    const sessionIdIndex = pathParts.indexOf('sessions') + 1;
    const sessionId = pathParts[sessionIdIndex] || this.sessionId;

    // If we don't have state loaded yet, try to load it
    if (!this.state && sessionId) {
      this.sessionId = sessionId;
      const session = await getSession(this.env, sessionId);
      if (session) {
        this.state = session.state;
      }
    }

    // Check invariants for the debug response
    const invariants = this.state
      ? validateStateInvariants(this.state)
      : { valid: true, violations: [], warnings: [] };

    const debug = {
      sessionId: this.sessionId,
      connectedPlayers: this.players.size,
      players: Array.from(this.players.values()),
      isPlaying: this.isPlaying,
      playbackStartTime: this.playbackStartTime,
      trackCount: this.state?.tracks.length ?? 0,
      tempo: this.state?.tempo ?? 0,
      swing: this.state?.swing ?? 0,
      pendingKVSave: this.pendingKVSave,
      invariants: {
        valid: invariants.valid,
        violations: invariants.violations,
        warnings: invariants.warnings,
      },
    };

    return new Response(JSON.stringify(debug, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
