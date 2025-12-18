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
  EffectsState,
  FMParams,
} from './types';
import { isStateMutatingMessage } from './types';
import { getSession, updateSession } from './sessions';
import { hashState, canonicalizeForHash } from './logging';
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
  VALID_DELAY_TIMES,
} from './invariants';
import {
  createTrackMutationHandler,
  createGlobalMutationHandler,
} from './handler-factory';

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
const KV_SAVE_DEBOUNCE_MS = 5000;

// Schema version for migrations
const SCHEMA_VERSION = 1;

export class LiveSessionDurableObject extends DurableObject<Env> {
  private players: Map<WebSocket, PlayerInfo> = new Map();
  private state: SessionState | null = null;
  private sessionId: string | null = null;
  // Phase 22: Track playback state per-player (not session-wide)
  // Multiple players can be playing simultaneously with independent audio
  private playingPlayers: Set<string> = new Set();
  private pendingKVSave: boolean = false;

  // Phase 21: Published sessions are immutable - reject all edits
  private immutable: boolean = false;

  // Phase 13B: Server sequence number for message ordering
  // Now persisted to DO storage to survive hibernation/eviction
  private serverSeq: number = 0;

  // State loading with blockConcurrencyWhile to prevent race conditions
  // See: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
  private stateLoaded: boolean = false;
  private stateLoadPromise: Promise<void> | null = null;

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

    // Initialize serverSeq from storage using blockConcurrencyWhile
    // This prevents race conditions where multiple requests arrive before serverSeq is loaded
    this.ctx.blockConcurrencyWhile(async () => {
      const storedSeq = await this.ctx.storage.get<number>('serverSeq');
      if (storedSeq !== undefined) {
        this.serverSeq = storedSeq;
      }

      // Schema migration support - future-proofing
      const storedVersion = await this.ctx.storage.get<number>('schemaVersion');
      if (storedVersion !== undefined && storedVersion < SCHEMA_VERSION) {
        await this.migrateSchema(storedVersion);
      }
      await this.ctx.storage.put('schemaVersion', SCHEMA_VERSION);
    });
  }

  /**
   * Migrate schema from older version to current
   * Add migration logic here as schema evolves
   */
  private async migrateSchema(fromVersion: number): Promise<void> {
    console.log(`[DO] Migrating schema from v${fromVersion} to v${SCHEMA_VERSION}`);
    // Future migrations go here:
    // if (fromVersion < 2) { /* migrate v1 -> v2 */ }
    // if (fromVersion < 3) { /* migrate v2 -> v3 */ }
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
   * Ensure state is loaded, using blockConcurrencyWhile to prevent race conditions.
   * This ensures that concurrent requests don't cause duplicate state loads or
   * see partially-loaded state.
   */
  private async ensureStateLoaded(sessionId: string): Promise<void> {
    if (this.stateLoaded) return;

    // If a load is already in progress, wait for it
    if (this.stateLoadPromise) {
      await this.stateLoadPromise;
      return;
    }

    // Start the load with blockConcurrencyWhile to ensure atomicity
    this.stateLoadPromise = this.ctx.blockConcurrencyWhile(async () => {
      // Double-check in case another request loaded while we were waiting
      if (this.stateLoaded) return;

      this.sessionId = sessionId;
      const session = await getSession(this.env, sessionId);
      if (session) {
        this.state = session.state;
        // Phase 21: Load immutable flag to enforce read-only on published sessions
        this.immutable = session.immutable ?? false;
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
        this.immutable = false;
      }
      this.stateLoaded = true;
    });

    await this.stateLoadPromise;
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
    const sessionId = pathParts[sessionIdIndex] || null;

    if (!sessionId) {
      return new Response('Session ID required', { status: 400 });
    }

    // Load state using blockConcurrencyWhile to prevent race conditions
    await this.ensureStateLoaded(sessionId);

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
        // Debug assertion: log initial snapshot
        console.log(`[ASSERT] snapshot SENT (initial connect): to=${playerId}, tracks=${this.state?.tracks.length}, time=${Date.now()}`);

        // Send initial snapshot to the new player
        // Phase 21.5: Include timestamp for staleness checking
        // Phase 22: Include playingPlayerIds for presence indicators
        const snapshot: ServerMessage = {
          type: 'snapshot',
          state: this.state!,
          players: Array.from(this.players.values()),
          playerId,
          immutable: this.immutable,  // Phase 21: Include immutable flag for frontend
          snapshotTimestamp: Date.now(),  // Phase 21.5: For client staleness check
          playingPlayerIds: Array.from(this.playingPlayers),  // Phase 22: Who's playing
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
    } catch {
      console.error('[WS] Invalid JSON message');
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    console.log(`[WS] message session=${this.sessionId} player=${player.id} type=${msg.type}`);

    // Phase 21 CENTRALIZED CHECK: Reject all mutations on published (immutable) sessions
    // This single check protects ALL mutation handlers - no per-handler checks needed
    // Adding a new mutation type? Add it to MUTATING_MESSAGE_TYPES in types.ts
    if (isStateMutatingMessage(msg.type) && this.immutable) {
      console.log(`[WS] Rejected ${msg.type} on published session=${this.sessionId} player=${player.id}`);
      ws.send(JSON.stringify({
        type: 'error',
        code: 'SESSION_PUBLISHED',
        message: 'This session is published and cannot be edited. Remix it to create an editable copy.',
      }));
      return;
    }

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
      case 'set_effects':
        this.handleSetEffects(ws, player, msg);
        break;
      case 'set_fm_params':
        this.handleSetFMParams(ws, player, msg);
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
  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    const player = this.players.get(ws);
    if (!player) return;

    this.players.delete(ws);

    console.log(`[WS] disconnect session=${this.sessionId} player=${player.id} reason=${reason} code=${code}`);

    // Phase 22: Clean up playback state if player was playing
    if (this.playingPlayers.has(player.id)) {
      this.playingPlayers.delete(player.id);
      // Broadcast stop on their behalf so other clients update their UI
      this.broadcast({
        type: 'playback_stopped',
        playerId: player.id,
      });
    }

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

      // Phase 22: Clean up playback state if player was playing
      if (this.playingPlayers.has(player.id)) {
        this.playingPlayers.delete(player.id);
        // Broadcast stop on their behalf so other clients update their UI
        this.broadcast({
          type: 'playback_stopped',
          playerId: player.id,
        });
      }

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
  // Note: All mutation handlers are protected by the centralized immutability check
  // in webSocketMessage(). No per-handler checks needed.

  private handleToggleStep(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'toggle_step'; trackId: string; step: number }
  ): void {
    // Debug assertion: log toggle_step received
    console.log(`[ASSERT] toggle_step RECEIVED: track=${msg.trackId}, step=${msg.step}, from=${player.id}, time=${Date.now()}`);

    if (!this.state) {
      console.warn(`[ASSERT] toggle_step FAILED: no state loaded`);
      return;
    }

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) {
      console.warn(`[ASSERT] toggle_step FAILED: track not found (trackId=${msg.trackId})`);
      return;
    }

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
    const oldValue = track.steps[msg.step];
    const newValue = !oldValue;
    track.steps[msg.step] = newValue;

    // Debug assertion: log the toggle
    console.log(`[ASSERT] toggle_step APPLIED: track=${msg.trackId}, step=${msg.step}, ${oldValue} -> ${newValue}`);

    // Broadcast to all (including sender for confirmation)
    this.broadcast({
      type: 'step_toggled',
      trackId: msg.trackId,
      step: msg.step,
      value: newValue,
      playerId: player.id,
    });

    // Debug assertion: log broadcast
    console.log(`[ASSERT] step_toggled BROADCAST: track=${msg.trackId}, step=${msg.step}, value=${newValue}, to=${this.players.size} clients`);

    this.scheduleKVSave();
  }

  // Migrated to use createGlobalMutationHandler factory
  private handleSetTempo = createGlobalMutationHandler<
    { tempo: number },
    ServerMessage
  >({
    validate: (msg) => ({ ...msg, tempo: clamp(msg.tempo, MIN_TEMPO, MAX_TEMPO) }),
    mutate: (state, msg) => { state.tempo = msg.tempo; },
    toBroadcast: (msg, playerId) => ({
      type: 'tempo_changed',
      tempo: msg.tempo,
      playerId,
    }),
  });

  private handleSetSwing = createGlobalMutationHandler<
    { swing: number },
    ServerMessage
  >({
    validate: (msg) => ({ ...msg, swing: clamp(msg.swing, MIN_SWING, MAX_SWING) }),
    mutate: (state, msg) => { state.swing = msg.swing; },
    toBroadcast: (msg, playerId) => ({
      type: 'swing_changed',
      swing: msg.swing,
      playerId,
    }),
  });

  // Migrated to use createTrackMutationHandler factory
  private handleMuteTrack = createTrackMutationHandler<
    { trackId: string; muted: boolean },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    mutate: (track, msg) => { track.muted = msg.muted; },
    toBroadcast: (msg, playerId) => ({
      type: 'track_muted',
      trackId: msg.trackId,
      muted: msg.muted,
      playerId,
    }),
  });

  private handleSoloTrack = createTrackMutationHandler<
    { trackId: string; soloed: boolean },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    mutate: (track, msg) => { track.soloed = msg.soloed; },
    toBroadcast: (msg, playerId) => ({
      type: 'track_soloed',
      trackId: msg.trackId,
      soloed: msg.soloed,
      playerId,
    }),
  });

  private handleSetParameterLock = createTrackMutationHandler<
    { trackId: string; step: number; lock: ParameterLock | null },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    mutate: (track, msg) => { track.parameterLocks[msg.step] = msg.lock; },
    toBroadcast: (msg, playerId) => ({
      type: 'parameter_lock_set',
      trackId: msg.trackId,
      step: msg.step,
      lock: msg.lock,
      playerId,
    }),
  });

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

  private handleSetTrackSample = createTrackMutationHandler<
    { trackId: string; sampleId: string; name: string },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    mutate: (track, msg) => {
      track.sampleId = msg.sampleId;
      track.name = msg.name;
    },
    toBroadcast: (msg, playerId) => ({
      type: 'track_sample_set',
      trackId: msg.trackId,
      sampleId: msg.sampleId,
      name: msg.name,
      playerId,
    }),
  });

  private handleSetTrackVolume = createTrackMutationHandler<
    { trackId: string; volume: number },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    validate: (msg) => ({ ...msg, volume: clamp(msg.volume, MIN_VOLUME, MAX_VOLUME) }),
    mutate: (track, msg) => { track.volume = msg.volume; },
    toBroadcast: (msg, playerId) => ({
      type: 'track_volume_set',
      trackId: msg.trackId,
      volume: msg.volume,
      playerId,
    }),
  });

  private handleSetTrackTranspose = createTrackMutationHandler<
    { trackId: string; transpose: number },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    validate: (msg) => ({
      ...msg,
      transpose: Math.round(clamp(msg.transpose, MIN_TRANSPOSE, MAX_TRANSPOSE)),
    }),
    mutate: (track, msg) => { track.transpose = msg.transpose; },
    toBroadcast: (msg, playerId) => ({
      type: 'track_transpose_set',
      trackId: msg.trackId,
      transpose: msg.transpose,
      playerId,
    }),
  });

  private handleSetTrackStepCount(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_track_step_count'; trackId: string; stepCount: number }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Validate step count - must be valid step count option (includes triplet and extended options)
    const validStepCounts = [4, 8, 12, 16, 24, 32, 64, 96, 128];
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

  /**
   * Phase 25: Handle effects state change
   * Syncs audio effects (reverb, delay, chorus, distortion) across all clients
   */
  private handleSetEffects(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_effects'; effects: EffectsState }
  ): void {
    if (!this.state) return;

    // Validate effects object has required fields
    if (!msg.effects ||
        typeof msg.effects.reverb?.wet !== 'number' ||
        typeof msg.effects.delay?.wet !== 'number' ||
        typeof msg.effects.chorus?.wet !== 'number' ||
        typeof msg.effects.distortion?.wet !== 'number') {
      console.warn(`[WS] Invalid effects state from ${player.id}`);
      return;
    }

    // Clamp all values to valid ranges (using imported clamp from invariants)

    // Validate delay time or use default (VALID_DELAY_TIMES imported from invariants)
    const delayTime = VALID_DELAY_TIMES.has(msg.effects.delay.time)
      ? msg.effects.delay.time
      : '8n';

    const validatedEffects: EffectsState = {
      reverb: {
        decay: clamp(msg.effects.reverb.decay, 0.1, 10),
        wet: clamp(msg.effects.reverb.wet, 0, 1),
      },
      delay: {
        time: delayTime,
        feedback: clamp(msg.effects.delay.feedback, 0, 0.95),
        wet: clamp(msg.effects.delay.wet, 0, 1),
      },
      chorus: {
        frequency: clamp(msg.effects.chorus.frequency, 0.1, 10),
        depth: clamp(msg.effects.chorus.depth, 0, 1),
        wet: clamp(msg.effects.chorus.wet, 0, 1),
      },
      distortion: {
        amount: clamp(msg.effects.distortion.amount, 0, 1),
        wet: clamp(msg.effects.distortion.wet, 0, 1),
      },
    };

    this.state.effects = validatedEffects;

    this.broadcast({
      type: 'effects_changed',
      effects: validatedEffects,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  /**
   * Phase 24: Handle FM synth parameter changes
   * Updates harmonicity and modulationIndex for FM synthesizers
   */
  private handleSetFMParams(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_fm_params'; trackId: string; fmParams: FMParams }
  ): void {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Validate FM params
    if (!msg.fmParams ||
        typeof msg.fmParams.harmonicity !== 'number' ||
        typeof msg.fmParams.modulationIndex !== 'number') {
      console.warn(`[WS] Invalid FM params from ${player.id}`);
      return;
    }

    // Clamp values to valid ranges
    const validatedFMParams: FMParams = {
      harmonicity: clamp(msg.fmParams.harmonicity, 0.5, 10),
      modulationIndex: clamp(msg.fmParams.modulationIndex, 0, 20),
    };

    track.fmParams = validatedFMParams;

    this.broadcast({
      type: 'fm_params_changed',
      trackId: msg.trackId,
      fmParams: validatedFMParams,
      playerId: player.id,
    });

    this.scheduleKVSave();
  }

  private handlePlay(ws: WebSocket, player: PlayerInfo): void {
    // Phase 22: Track per-player playback state
    this.playingPlayers.add(player.id);

    this.broadcast({
      type: 'playback_started',
      playerId: player.id,
      startTime: Date.now(),
      tempo: this.state?.tempo ?? 120,
    });
  }

  private handleStop(ws: WebSocket, player: PlayerInfo): void {
    // Phase 22: Track per-player playback state
    this.playingPlayers.delete(player.id);

    this.broadcast({
      type: 'playback_stopped',
      playerId: player.id,
    });
  }

  private handleStateHash(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'state_hash'; hash: string }
  ): void {
    if (!this.state) return;

    // Hash only comparable fields (exclude version, which client doesn't track)
    // Use canonicalizeForHash to normalize state before hashing for consistent
    // comparison between client and server (handles optional fields and array lengths)
    const comparableState = {
      tracks: this.state.tracks,
      tempo: this.state.tempo,
      swing: this.state.swing,
    };
    const canonicalState = canonicalizeForHash(comparableState);
    const serverHash = hashState(canonicalState);

    if (msg.hash !== serverHash) {
      // Send mismatch notification to the client
      console.log(`[WS] State hash mismatch: client=${msg.hash} server=${serverHash} player=${player.id}`);
      const response: ServerMessage = {
        type: 'state_mismatch',
        serverHash,
      };
      ws.send(JSON.stringify(response));
    } else {
      // Send match confirmation so client can reset consecutive mismatch counter
      console.log(`[WS] State hash match: ${serverHash} player=${player.id}`);
      const response: ServerMessage = {
        type: 'state_hash_match',
      };
      ws.send(JSON.stringify(response));
    }
  }

  /**
   * Handle request_snapshot - client requests full state (e.g., after mismatch)
   */
  private handleRequestSnapshot(ws: WebSocket, player: PlayerInfo): void {
    if (!this.state) return;

    // Debug assertion: log recovery snapshot
    console.log(`[ASSERT] snapshot SENT (recovery): to=${player.id}, tracks=${this.state.tracks.length}, time=${Date.now()}`);
    console.log(`[WS] snapshot requested by player=${player.id} (recovery)`);

    const players = Array.from(this.players.values());
    // Phase 21.5: Include timestamp for staleness checking
    // Phase 22: Include playingPlayerIds for presence indicators
    const response: ServerMessage = {
      type: 'snapshot',
      state: this.state,
      players,
      playerId: player.id,
      immutable: this.immutable,  // Phase 21: Include immutable flag
      snapshotTimestamp: Date.now(),  // Phase 21.5: For client staleness check
      playingPlayerIds: Array.from(this.playingPlayers),  // Phase 22: Who's playing
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
    const newSeq = ++this.serverSeq;
    const messageWithSeq: ServerMessage = {
      ...message,
      seq: newSeq,
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

    // Persist serverSeq periodically (every 100 messages) to survive hibernation/eviction
    // This is a trade-off between durability and performance
    if (newSeq % 100 === 0) {
      this.ctx.storage.put('serverSeq', newSeq).catch(e => {
        console.error('[DO] Error persisting serverSeq:', e);
      });
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
   * Save current state to KV and persist serverSeq to DO storage
   */
  private async saveToKV(): Promise<void> {
    if (!this.state || !this.sessionId) return;

    try {
      // Save session state to KV
      await updateSession(this.env, this.sessionId, this.state);
      // Persist serverSeq to DO storage to survive hibernation/eviction
      await this.ctx.storage.put('serverSeq', this.serverSeq);
      console.log(`[KV] Saved session ${this.sessionId}, serverSeq=${this.serverSeq}`);
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

    // Use ensureStateLoaded to safely load state with blockConcurrencyWhile
    if (!this.stateLoaded && sessionId) {
      await this.ensureStateLoaded(sessionId);
    }

    // Check invariants for the debug response
    const invariants = this.state
      ? validateStateInvariants(this.state)
      : { valid: true, violations: [], warnings: [] };

    const debug = {
      sessionId: this.sessionId,
      connectedPlayers: this.players.size,
      players: Array.from(this.players.values()),
      // Phase 22: Per-player playback tracking
      playingPlayerIds: Array.from(this.playingPlayers),
      playingCount: this.playingPlayers.size,
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
