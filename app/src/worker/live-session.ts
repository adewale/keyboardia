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
  ScaleState,
  FMParams,
} from './types';
import { isStateMutatingMessage, isStateMutatingBroadcast, assertNever, VALID_STEP_COUNTS_SET } from './types';
import { getSession, updateSession, updateSessionName } from './sessions';
import { hashState, canonicalizeForHash } from './logging';
// Observability 2.0: Wide events
import {
  emitWsSessionEvent,
  getDeployInfo,
  getInfraInfo,
  getServiceInfo,
  mapCloseCode,
  type WsSessionEvent,
  type InfraInfo,
  type Warning,
} from './observability';
import {
  validateStateInvariants,
  logInvariantStatus,
  repairStateInvariants,
  clamp,
  isValidNumberInRange,
  validateParameterLock,
  validateCursorPosition,
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
// Phase 32: Pattern operations (sync fix)
import {
  rotateLeft,
  rotateRight,
  invertPattern,
  reversePattern,
  mirrorPattern,
  applyEuclidean,
} from '../utils/patternOps';
import { MAX_TRACK_NAME_LENGTH } from '../shared/validation';

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
// Schema version for migrations
const SCHEMA_VERSION = 1;

// Observability 2.0: Player context for wide event tracking
// This is NOT serialized with the WebSocket attachment - it's kept in memory
// and used to emit the ws_session event at disconnect
interface PlayerObservability {
  connectionId: string;
  messagesByType: Record<string, number>;
  playCount: number;
  totalPlayTime_ms: number;
  lastPlayStartTime: number | null;
  syncRequestCount: number;
  syncErrorCount: number;
  peakConcurrentPlayers: number;
  playersSeenIds: Set<string>;
  warnings: Warning[];
  infra: InfraInfo;
}

// Phase 26 BUG-02: Threshold for detecting clients falling behind
// If client's ack is more than this many sequences behind serverSeq, push a snapshot
const ACK_GAP_THRESHOLD = 50;

export class LiveSessionDurableObject extends DurableObject<Env> {
  private players: Map<WebSocket, PlayerInfo> = new Map();
  // Observability 2.0: Track observability data for each player (not serialized)
  private playerObservability: Map<WebSocket, PlayerObservability> = new Map();
  private state: SessionState | null = null;
  private sessionId: string | null = null;
  // Phase 22: Track playback state per-player (not session-wide)
  // Multiple players can be playing simultaneously with independent audio
  private playingPlayers: Set<string> = new Set();
  // Phase 27: With hybrid persistence, this flag indicates unflushed state to KV.
  // DO storage is always up-to-date; KV is written on last client disconnect.
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

    // PUT /api/sessions/:id - Update session state through DO (Phase 31E)
    // This maintains architectural correctness by routing REST API updates
    // through the Durable Object instead of writing directly to KV.
    if (request.method === 'PUT') {
      return this.handleStateUpdate(request, url);
    }

    // PATCH /api/sessions/:id - Update session name through DO (Phase 31E)
    // Same architectural fix as PUT - route through DO instead of direct KV write
    if (request.method === 'PATCH') {
      return this.handleNameUpdate(request, url);
    }

    // GET /api/sessions/:id - Retrieve session state through DO (Phase 34)
    // This ensures API reads get the latest state from DO (source of truth),
    // falling back to KV only if DO has no state loaded.
    if (request.method === 'GET') {
      return this.handleStateRead(url);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Phase 34: Handle REST API session reads through the Durable Object
   *
   * This fixes the architectural violation where GET /api/sessions/:id
   * was reading directly from KV, bypassing the DO and returning stale state.
   *
   * The DO is the source of truth for active sessions. If the DO has state
   * loaded (from either DO storage or KV), return that state. This ensures
   * that any pending changes not yet persisted to KV are included.
   */
  private async handleStateRead(url: URL): Promise<Response> {
    // Extract session ID from URL path
    const pathParts = url.pathname.split('/');
    const sessionIdIndex = pathParts.indexOf('sessions') + 1;
    const sessionId = pathParts[sessionIdIndex] || null;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Session ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load state if not already loaded
    await this.ensureStateLoaded(sessionId);

    // If no state (session doesn't exist), return 404
    if (!this.state) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get full session from KV (includes metadata like name, createdAt, etc.)
    // but override state with DO's current state (which may have pending changes)
    const kvSession = await getSession(this.env, sessionId, false);
    if (!kvSession) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Merge: KV metadata + DO state (source of truth)
    const response = {
      ...kvSession,
      state: this.state,  // Override with DO state (includes pending changes)
      immutable: this.immutable,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Phase 31E: Handle REST API session updates through the Durable Object
   *
   * PATCH accepts both name and state updates:
   * - { name: "New Name" } - Update just the session name
   * - { state: {...} } - Update just the session state
   * - { name: "New Name", state: {...} } - Update both
   *
   * At least one of name or state must be provided.
   *
   * This fixes the architectural violation where PATCH /api/sessions/:id
   * was writing directly to KV, bypassing the DO and causing stale state.
   */
  private async handleNameUpdate(request: Request, url: URL): Promise<Response> {
    // Extract session ID from URL path
    const pathParts = url.pathname.split('/');
    const sessionIdIndex = pathParts.indexOf('sessions') + 1;
    const sessionId = pathParts[sessionIdIndex] || null;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Session ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load state if not already loaded
    await this.ensureStateLoaded(sessionId);

    // Phase 21: Reject updates to published (immutable) sessions
    if (this.immutable) {
      return new Response(JSON.stringify({
        error: 'Session is published',
        message: 'This session has been published and cannot be modified. Remix it to create an editable copy.',
        immutable: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json() as { name?: string | null; state?: SessionState };

      // Require at least one of name or state
      const hasName = 'name' in body;
      const hasState = 'state' in body && body.state !== undefined;

      if (!hasName && !hasState) {
        return new Response(JSON.stringify({ error: 'Missing name or state field' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let sanitizedName: string | null = null;

      // Handle state update if provided
      if (hasState && body.state) {
        // Update internal state
        this.state = body.state;

        // Validate and repair any invariant violations
        this.validateAndRepairState('restApiPatch');

        // Save to DO storage (survives hibernation)
        await this.ctx.storage.put('state', this.state);

        // Save to KV (external persistence)
        await this.saveToKV();
        this.pendingKVSave = false;

        // Broadcast snapshot to all connected clients
        if (this.players.size > 0) {
          console.log(`[REST] Broadcasting state update to ${this.players.size} clients`);
          this.broadcast({
            type: 'snapshot',
            state: this.state,
            players: Array.from(this.players.values()).map(p => ({
              id: p.id,
              name: p.name,
              color: p.color,
            })),
            immutable: this.immutable,
          });
        }

        console.log(`[REST] Session state updated via PATCH for session=${sessionId}`);
      }

      // Handle name update if provided
      if (hasName) {
        sanitizedName = body.name ? body.name.trim().slice(0, 100) || null : null;

        // Update in KV (the DO doesn't store name internally, just in KV)
        await updateSessionName(this.env, sessionId, sanitizedName);

        // Broadcast to all connected clients so they see the name change
        if (this.players.size > 0) {
          console.log(`[REST] Broadcasting name update to ${this.players.size} clients`);
          this.broadcast({
            type: 'session_name_changed',
            name: sanitizedName ?? '',
            playerId: 'rest-api', // Identify as REST API update
          });
        }

        console.log(`[REST] Session name updated via REST API for session=${sessionId}, name=${sanitizedName}`);
      }

      return new Response(JSON.stringify({
        id: sessionId,
        name: sanitizedName,
        updatedAt: Date.now(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error(`[REST] Error updating session:`, e);
      return new Response(JSON.stringify({
        error: 'Invalid request body',
        details: e instanceof Error ? e.message : String(e),
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Phase 31E: Handle REST API state updates through the Durable Object
   *
   * This fixes the architectural violation where PUT /api/sessions/:id
   * was writing directly to KV, bypassing the DO and causing stale state.
   *
   * The correct flow is:
   *   REST API -> Durable Object -> KV + Broadcast to clients
   */
  private async handleStateUpdate(request: Request, url: URL): Promise<Response> {
    // Extract session ID from URL path
    const pathParts = url.pathname.split('/');
    const sessionIdIndex = pathParts.indexOf('sessions') + 1;
    const sessionId = pathParts[sessionIdIndex] || null;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Session ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load state if not already loaded
    await this.ensureStateLoaded(sessionId);

    // Phase 21: Reject updates to published (immutable) sessions
    if (this.immutable) {
      return new Response(JSON.stringify({
        error: 'Session is published',
        message: 'This session has been published and cannot be modified. Remix it to create an editable copy.',
        immutable: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json() as { state: SessionState };

      if (!body.state) {
        return new Response(JSON.stringify({ error: 'Missing state in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Update internal state
      this.state = body.state;

      // Validate and repair any invariant violations
      this.validateAndRepairState('restApiUpdate');

      // Save to DO storage (survives hibernation)
      await this.ctx.storage.put('state', this.state);

      // Save to KV (external persistence)
      await this.saveToKV();
      this.pendingKVSave = false;

      // Broadcast snapshot to all connected clients so they see the update
      if (this.players.size > 0) {
        console.log(`[REST] Broadcasting state update to ${this.players.size} clients`);
        const snapshot: ServerMessage = {
          type: 'snapshot',
          state: this.state,
          players: Array.from(this.players.values()),
          playerId: 'rest-api', // Identify as REST API update
          immutable: this.immutable,
          snapshotTimestamp: Date.now(),
          serverSeq: this.serverSeq,
          playingPlayerIds: Array.from(this.playingPlayers),
        };
        this.broadcast(snapshot);
      }

      console.log(`[REST] State updated via REST API for session=${sessionId}, tracks=${this.state.tracks.length}`);

      return new Response(JSON.stringify({
        id: sessionId,
        updatedAt: Date.now(),
        trackCount: this.state.tracks.length,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error(`[REST] Error updating state:`, e);
      return new Response(JSON.stringify({
        error: 'Invalid request body',
        details: e instanceof Error ? e.message : String(e),
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Ensure state is loaded, using blockConcurrencyWhile to prevent race conditions.
   * This ensures that concurrent requests don't cause duplicate state loads or
   * see partially-loaded state.
   *
   * CRITICAL: Check DO storage FIRST before KV. DO storage has the latest state
   * including any changes that haven't been saved to KV yet. This prevents
   * snapshot regression bugs where clients see stale KV state.
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

      // FIRST: Check DO storage for latest state (survives hibernation, has pending changes)
      const storedState = await this.ctx.storage.get<SessionState>('state');
      if (storedState) {
        this.state = storedState;
        console.log(`[DO] Loaded state from DO storage: ${storedState.tracks.length} tracks`);
        // Still need to load immutable flag from KV (session metadata)
        const session = await getSession(this.env, sessionId);
        this.immutable = session?.immutable ?? false;
        // Validate and repair state loaded from DO storage
        this.validateAndRepairState('loadFromDOStorage');
      } else {
        // FALLBACK: Load from KV (long-term external persistence)
        const session = await getSession(this.env, sessionId);
        if (session) {
          this.state = session.state;
          // Phase 21: Load immutable flag to enforce read-only on published sessions
          this.immutable = session.immutable ?? false;
          // Validate and repair state loaded from KV
          this.validateAndRepairState('loadFromKV');
          console.log(`[DO] Loaded state from KV (migration path): ${session.state.tracks.length} tracks`);
        } else {
          // Create default state if session doesn't exist
          this.state = {
            tracks: [],
            tempo: 120,
            swing: 0,
            version: 1,
          };
          this.immutable = false;
          console.log(`[DO] Created default state for new session`);
        }
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

    // Observability 2.0: Create observability context for this connection
    // Capture all players seen at connect time
    const playersSeenIds = new Set<string>();
    for (const p of this.players.values()) {
      playersSeenIds.add(p.id);
    }
    playersSeenIds.add(playerId); // Include self

    const observability: PlayerObservability = {
      connectionId: crypto.randomUUID(),
      messagesByType: {},
      playCount: 0,
      totalPlayTime_ms: 0,
      lastPlayStartTime: null,
      syncRequestCount: 0,
      syncErrorCount: 0,
      peakConcurrentPlayers: this.players.size + 1, // +1 for this player
      playersSeenIds,
      warnings: [],
      infra: getInfraInfo(request),
    };

    // Accept the WebSocket with hibernation support
    this.ctx.acceptWebSocket(server);

    // Store player info as attachment for hibernation
    server.serializeAttachment(playerInfo);
    this.players.set(server, playerInfo);
    this.playerObservability.set(server, observability);

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
          serverSeq: this.serverSeq,  // Phase 26: For selective mutation clearing
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

    // Parse message
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      console.error('[WS] Invalid JSON message');
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    // Observability 2.0: Track message types
    const obs = this.playerObservability.get(ws);
    if (obs) {
      obs.messagesByType[msg.type] = (obs.messagesByType[msg.type] || 0) + 1;
      // Update peak concurrent players
      obs.peakConcurrentPlayers = Math.max(obs.peakConcurrentPlayers, this.players.size);
      // Track players seen (new players who joined during this connection)
      for (const p of this.players.values()) {
        obs.playersSeenIds.add(p.id);
      }
    }

    console.log(`[WS] message session=${this.sessionId} player=${player.id} type=${msg.type}`);

    // Phase 26 BUG-02: Detect clients falling behind via ack field
    // If client's last acknowledged seq is far behind serverSeq, push a snapshot
    if (typeof msg.ack === 'number' && msg.ack >= 0) {
      const ackGap = this.serverSeq - msg.ack;
      if (ackGap > ACK_GAP_THRESHOLD) {
        console.log(`[WS] Client falling behind: player=${player.id} ack=${msg.ack} serverSeq=${this.serverSeq} gap=${ackGap}`);
        this.sendSnapshotToClient(ws, player);
      }
    }
    ws.serializeAttachment(player);

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
      case 'copy_sequence':
        this.handleCopySequence(ws, player, msg);
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
      case 'set_track_swing':
        this.handleSetTrackSwing(ws, player, msg);
        break;
      case 'set_effects':
        this.handleSetEffects(ws, player, msg);
        break;
      case 'set_scale':
        this.handleSetScale(ws, player, msg);
        break;
      case 'set_fm_params':
        this.handleSetFMParams(ws, player, msg);
        break;
      case 'move_sequence':
        this.handleMoveSequence(ws, player, msg);
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
      case 'set_session_name':
        this.handleSetSessionName(ws, player, msg);
        break;
      // Phase 31F: Batch operations for multi-select
      case 'batch_clear_steps':
        this.handleBatchClearSteps(ws, player, msg);
        break;
      case 'batch_set_parameter_locks':
        this.handleBatchSetParameterLocks(ws, player, msg);
        break;
      // Phase 31G: Loop selection
      case 'set_loop_region':
        this.handleSetLoopRegion(ws, player, msg);
        break;
      // Phase 31G: Track reorder (drag and drop)
      case 'reorder_tracks':
        this.handleReorderTracks(ws, player, msg);
        break;
      // Phase 32: Pattern operations (sync fix)
      case 'rotate_pattern':
        this.handleRotatePattern(ws, player, msg);
        break;
      case 'invert_pattern':
        this.handleInvertPattern(ws, player, msg);
        break;
      case 'reverse_pattern':
        this.handleReversePattern(ws, player, msg);
        break;
      case 'mirror_pattern':
        this.handleMirrorPattern(ws, player, msg);
        break;
      case 'euclidean_fill':
        this.handleEuclideanFill(ws, player, msg);
        break;
      case 'set_track_name':
        this.handleSetTrackName(ws, player, msg);
        break;
      default:
        // Exhaustive check - if TypeScript complains here, a message type is missing
        assertNever(msg, `[WS] Unhandled message type: ${(msg as { type: string }).type}`);
    }
  }

  /**
   * Handle WebSocket close (hibernation-compatible)
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    const player = this.players.get(ws);
    if (!player) return;

    // Observability 2.0: Emit ws_session wide event before cleanup
    const obs = this.playerObservability.get(ws);
    if (obs) {
      // Finalize playback time if player was still playing
      if (obs.lastPlayStartTime !== null) {
        obs.totalPlayTime_ms += Date.now() - obs.lastPlayStartTime;
        obs.lastPlayStartTime = null;
      }

      const disconnectedAt = Date.now();
      const disconnectReason = mapCloseCode(code);

      const event: WsSessionEvent = {
        event: 'ws_session',
        connectionId: obs.connectionId,
        sessionId: this.sessionId!,
        playerId: player.id,
        isCreator: false, // TODO: Implement creator detection if needed
        isPublished: this.immutable,
        connectedAt: new Date(player.connectedAt).toISOString(),
        disconnectedAt: new Date(disconnectedAt).toISOString(),
        duration_ms: disconnectedAt - player.connectedAt,
        messageCount: player.messageCount,
        messagesByType: obs.messagesByType,
        peakConcurrentPlayers: obs.peakConcurrentPlayers,
        playersSeenCount: obs.playersSeenIds.size,
        playCount: obs.playCount,
        totalPlayTime_ms: obs.totalPlayTime_ms,
        syncRequestCount: obs.syncRequestCount,
        syncErrorCount: obs.syncErrorCount,
        outcome: disconnectReason === 'error' ? 'error' : 'ok',
        disconnectReason,
        warnings: obs.warnings.length > 0 ? obs.warnings : undefined,
        deploy: getDeployInfo(this.env),
        infra: obs.infra,
        service: getServiceInfo(this.env),
      };
      emitWsSessionEvent(event);

      // Clean up observability data
      this.playerObservability.delete(ws);
    }

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

    // Phase 26: Flush pending KV save immediately when last player disconnects
    // This prevents stale snapshots after DO hibernation/eviction
    if (this.players.size === 0) {
      await this.flushPendingKVSave();
    }
  }

  /**
   * Phase 27: Flush state to KV when last player disconnects.
   * With hybrid persistence, DO storage is the source of truth during active sessions.
   * KV is written on disconnect for API reads and legacy compatibility.
   */
  private async flushPendingKVSave(): Promise<void> {
    if (!this.state || !this.sessionId) return;

    const flushStart = Date.now();
    try {
      await this.saveToKV();
      this.pendingKVSave = false;
      console.log(`[KV] Flushed on last disconnect: session=${this.sessionId}, took=${Date.now() - flushStart}ms`);
    } catch (e) {
      console.error(`[KV] Flush failed: session=${this.sessionId}`, e);
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

      // Phase 26: Flush pending KV save immediately when last player disconnects
      if (this.players.size === 0) {
        await this.flushPendingKVSave();
      }
    } else {
      this.players.delete(ws);
    }
  }

  // ==================== Message Handlers ====================
  // Note: All mutation handlers are protected by the centralized immutability check
  // in webSocketMessage(). No per-handler checks needed.

  private async handleToggleStep(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'toggle_step'; trackId: string; step: number; seq?: number }
  ): Promise<void> {
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
    if (!isValidNumberInRange(msg.step, 0, MAX_STEPS - 1) || !Number.isInteger(msg.step)) {
      console.warn(`[WS] Invalid step index ${msg.step} from ${player.id}`);
      return;
    }

    // Arrays must be exactly MAX_STEPS (128) length per invariants
    // If array is shorter (legacy data), the step is out of bounds - skip toggle
    if (msg.step >= track.steps.length) {
      console.warn(`[WS] Step ${msg.step} out of bounds for track ${msg.trackId} (array length ${track.steps.length})`);
      return;
    }

    // Toggle the step
    const oldValue = track.steps[msg.step];
    const newValue = !oldValue;
    track.steps[msg.step] = newValue;

    // Debug assertion: log the toggle
    console.log(`[ASSERT] toggle_step APPLIED: track=${msg.trackId}, step=${msg.step}, ${oldValue} -> ${newValue}`);

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Broadcast to all (including sender for confirmation)
    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'step_toggled',
      trackId: msg.trackId,
      step: msg.step,
      value: newValue,
      playerId: player.id,
    }, undefined, msg.seq);

    // Debug assertion: log broadcast
    console.log(`[ASSERT] step_toggled BROADCAST: track=${msg.trackId}, step=${msg.step}, value=${newValue}, to=${this.players.size} clients`);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
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

  // Phase 26 BUG-10: Added parameter lock validation
  private handleSetParameterLock = createTrackMutationHandler<
    { trackId: string; step: number; lock: ParameterLock | null },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    validate: (msg) => {
      // Validate step index
      if (!isValidNumberInRange(msg.step, 0, MAX_STEPS - 1) || !Number.isInteger(msg.step)) {
        return null; // Invalid step
      }
      // Validate and sanitize the lock using validateParameterLock
      const validatedLock = validateParameterLock(msg.lock);
      return { ...msg, lock: validatedLock };
    },
    mutate: (track, msg) => { track.parameterLocks[msg.step] = msg.lock; },
    toBroadcast: (msg, playerId) => ({
      type: 'parameter_lock_set',
      trackId: msg.trackId,
      step: msg.step,
      lock: msg.lock,
      playerId,
    }),
  });

  private async handleAddTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'add_track'; track: SessionTrack; seq?: number }
  ): Promise<void> {
    if (!this.state) return;
    if (this.state.tracks.length >= 16) return; // Max tracks

    // Check for duplicate track ID to prevent corruption
    // BUG-09 FIX: Even for duplicates, broadcast to confirm client's pending mutation
    if (this.state.tracks.some(t => t.id === msg.track.id)) {
      console.log(`[WS] Duplicate track: ${msg.track.id} (already exists, still broadcasting for confirmation)`);
      // Broadcast anyway so client can confirm mutation
      this.broadcast({
        type: 'track_added',
        track: msg.track,
        playerId: player.id,
      }, undefined, msg.seq);
      return;
    }

    this.state.tracks.push(msg.track);

    // Validate state after mutation
    this.validateAndRepairState('handleAddTrack');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'track_added',
      track: msg.track,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  private async handleDeleteTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'delete_track'; trackId: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const index = this.state.tracks.findIndex(t => t.id === msg.trackId);
    // BUG-09 FIX: Even for already-deleted tracks, we must still broadcast
    // so the client can confirm its pending mutation via clientSeq.
    // Without this, the client's mutation stays pending forever and triggers
    // invariant violations when snapshot is received.
    if (index === -1) {
      console.log(`[WS] Duplicate delete_track: ${msg.trackId} (already deleted, still broadcasting for confirmation)`);
      // Broadcast anyway so client can confirm mutation
      this.broadcast({
        type: 'track_deleted',
        trackId: msg.trackId,
        playerId: player.id,
      }, undefined, msg.seq);
      return;
    }

    this.state.tracks.splice(index, 1);

    // Validate state after mutation
    this.validateAndRepairState('handleDeleteTrack');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'track_deleted',
      trackId: msg.trackId,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  private async handleClearTrack(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'clear_track'; trackId: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Clear all steps and parameter locks
    track.steps = track.steps.map(() => false);
    track.parameterLocks = track.parameterLocks.map(() => null);

    // Validate state after mutation
    this.validateAndRepairState('handleClearTrack');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'track_cleared',
      trackId: msg.trackId,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  /**
   * Phase 26: Handle copy sequence (copy steps from one track to another)
   */
  private async handleCopySequence(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'copy_sequence'; fromTrackId: string; toTrackId: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const fromTrack = this.state.tracks.find(t => t.id === msg.fromTrackId);
    const toTrack = this.state.tracks.find(t => t.id === msg.toTrackId);
    if (!fromTrack || !toTrack) return;

    // Copy steps, parameterLocks, and stepCount from source to target
    toTrack.steps = [...fromTrack.steps];
    toTrack.parameterLocks = [...fromTrack.parameterLocks];
    toTrack.stepCount = fromTrack.stepCount;

    // Validate state after mutation
    this.validateAndRepairState('handleCopySequence');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Broadcast the copied sequence to all clients
    this.broadcast({
      type: 'sequence_copied',
      fromTrackId: msg.fromTrackId,
      toTrackId: msg.toTrackId,
      steps: toTrack.steps,
      parameterLocks: toTrack.parameterLocks,
      stepCount: toTrack.stepCount,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  /**
   * Phase 26: Handle move_sequence message
   * Moves steps from one track to another (clears source track)
   */
  private async handleMoveSequence(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'move_sequence'; fromTrackId: string; toTrackId: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const fromTrack = this.state.tracks.find(t => t.id === msg.fromTrackId);
    const toTrack = this.state.tracks.find(t => t.id === msg.toTrackId);
    if (!fromTrack || !toTrack) return;

    // Copy steps, parameterLocks, and stepCount from source to target
    toTrack.steps = [...fromTrack.steps];
    toTrack.parameterLocks = [...fromTrack.parameterLocks];
    toTrack.stepCount = fromTrack.stepCount;

    // Clear source track (that's what makes it a "move" vs "copy")
    fromTrack.steps = fromTrack.steps.map(() => false);
    fromTrack.parameterLocks = fromTrack.parameterLocks.map(() => null);

    // Validate state after mutation
    this.validateAndRepairState('handleMoveSequence');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    this.broadcast({
      type: 'sequence_moved',
      fromTrackId: msg.fromTrackId,
      toTrackId: msg.toTrackId,
      steps: toTrack.steps,
      parameterLocks: toTrack.parameterLocks,
      stepCount: toTrack.stepCount,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  /**
   * Handle set_session_name message
   * Updates session name in KV and broadcasts to all clients.
   */
  private async handleSetSessionName(
    _ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_session_name'; name: string; seq?: number }
  ): Promise<void> {
    if (!this.sessionId) return;

    // Sanitize name: trim, limit length
    const sanitizedName = msg.name.trim().slice(0, 100) || null;

    // Update in KV (async - don't block WebSocket response)
    updateSessionName(this.env, this.sessionId, sanitizedName).catch(e => {
      console.error(`[WS] Failed to update session name in KV: session=${this.sessionId}`, e);
    });

    // Broadcast to all clients
    this.broadcast({
      type: 'session_name_changed',
      name: sanitizedName ?? '',
      playerId: player.id,
    }, undefined, msg.seq);
  }

  /**
   * Phase 31F: Handle batch_clear_steps message
   * Clears multiple steps at once (from DELETE_SELECTED_STEPS)
   */
  private async handleBatchClearSteps(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'batch_clear_steps'; trackId: string; steps: number[]; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Validate and apply each step change
    const clearedSteps: number[] = [];
    for (const step of msg.steps) {
      // Validate step index
      if (!isValidNumberInRange(step, 0, MAX_STEPS - 1) || !Number.isInteger(step)) {
        continue; // Skip invalid step indices
      }
      if (step < track.steps.length && track.steps[step]) {
        track.steps[step] = false;
        // Also clear any parameter lock on this step
        if (track.parameterLocks[step]) {
          track.parameterLocks[step] = null;
        }
        clearedSteps.push(step);
      }
    }

    if (clearedSteps.length === 0) return; // Nothing changed

    // Validate state after mutation
    this.validateAndRepairState('handleBatchClearSteps');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'steps_cleared',
      trackId: msg.trackId,
      steps: clearedSteps,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  /**
   * Phase 31F: Handle batch_set_parameter_locks message
   * Sets multiple parameter locks at once (from APPLY_TO_SELECTION)
   */
  private async handleBatchSetParameterLocks(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'batch_set_parameter_locks'; trackId: string; locks: { step: number; lock: ParameterLock }[]; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Validate and apply each p-lock change
    const appliedLocks: { step: number; lock: ParameterLock }[] = [];
    for (const { step, lock } of msg.locks) {
      // Validate step index
      if (!isValidNumberInRange(step, 0, MAX_STEPS - 1) || !Number.isInteger(step)) {
        continue; // Skip invalid step indices
      }
      // Only apply to active steps
      if (step < track.steps.length && track.steps[step]) {
        // Validate and sanitize the lock
        const validatedLock = validateParameterLock(lock);
        if (validatedLock) {
          const existingLock = track.parameterLocks[step];
          track.parameterLocks[step] = { ...existingLock, ...validatedLock };
          appliedLocks.push({ step, lock: track.parameterLocks[step]! });
        }
      }
    }

    if (appliedLocks.length === 0) return; // Nothing changed

    // Validate state after mutation
    this.validateAndRepairState('handleBatchSetParameterLocks');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'parameter_locks_batch_set',
      trackId: msg.trackId,
      locks: appliedLocks,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  /**
   * Phase 31G: Handle loop region changes
   * Sets or clears the loop playback region for all players
   */
  private async handleSetLoopRegion(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_loop_region'; region: { start: number; end: number } | null; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    // Validate and normalize region
    if (msg.region !== null) {
      const { start, end } = msg.region;
      // Validate numbers
      if (!isValidNumberInRange(start, 0, MAX_STEPS - 1) || !isValidNumberInRange(end, 0, MAX_STEPS - 1)) {
        return;
      }
      // Normalize: ensure start <= end
      const normalizedStart = Math.min(start, end);
      const normalizedEnd = Math.max(start, end);
      this.state.loopRegion = { start: normalizedStart, end: normalizedEnd };
    } else {
      this.state.loopRegion = null;
    }

    // Validate state after mutation
    this.validateAndRepairState('handleSetLoopRegion');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Broadcast to all players
    this.broadcast({
      type: 'loop_region_changed',
      region: this.state.loopRegion ?? null,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  /**
   * Phase 31G: Handle track reorder (drag and drop)
   * Moves a track from one position to another
   */
  private async handleReorderTracks(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'reorder_tracks'; fromIndex: number; toIndex: number; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const { fromIndex, toIndex } = msg;
    const trackCount = this.state.tracks.length;

    // CRITICAL-2: Early exit for empty tracks array
    if (trackCount === 0) {
      return;
    }

    // Validate indices
    if (!isValidNumberInRange(fromIndex, 0, trackCount - 1) ||
        !isValidNumberInRange(toIndex, 0, trackCount - 1) ||
        fromIndex === toIndex) {
      return;
    }

    // CRITICAL-1: Use track ID to identify the track being moved
    // This prevents race conditions when concurrent reorders arrive
    const trackToMove = this.state.tracks[fromIndex];
    if (!trackToMove) {
      return;
    }
    const trackId = trackToMove.id;

    // Perform the reorder
    const [movedTrack] = this.state.tracks.splice(fromIndex, 1);
    this.state.tracks.splice(toIndex, 0, movedTrack);

    // Verify the track we moved is the one we expected
    if (movedTrack.id !== trackId) {
      logger.error.warn('Track reorder race condition detected - track IDs do not match');
      // validateAndRepairState will fix any inconsistencies
    }

    // Validate state after mutation
    this.validateAndRepairState('handleReorderTracks');

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Broadcast to all players
    this.broadcast({
      type: 'tracks_reordered',
      fromIndex,
      toIndex,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  // ============================================================================
  // Phase 32: Pattern operation handlers (sync fix)
  // ============================================================================

  private async handleRotatePattern(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'rotate_pattern'; trackId: string; direction: 'left' | 'right'; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    const stepCount = track.stepCount ?? 16;
    const rotate = msg.direction === 'left' ? rotateLeft : rotateRight;

    track.steps = rotate(track.steps, stepCount);
    track.parameterLocks = rotate(track.parameterLocks, stepCount);

    this.validateAndRepairState('handleRotatePattern');
    await this.persistToDoStorage();

    this.broadcast({
      type: 'pattern_rotated',
      trackId: msg.trackId,
      direction: msg.direction,
      steps: track.steps,
      parameterLocks: track.parameterLocks,
      stepCount,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  private async handleInvertPattern(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'invert_pattern'; trackId: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    const stepCount = track.stepCount ?? 16;
    const newSteps = invertPattern(track.steps, stepCount);
    // Clear p-locks on steps that become inactive
    const newLocks = track.parameterLocks.map((lock, i) => {
      if (i < stepCount && track.steps[i] && !newSteps[i]) {
        return null;
      }
      return lock;
    });

    track.steps = newSteps;
    track.parameterLocks = newLocks;

    this.validateAndRepairState('handleInvertPattern');
    await this.persistToDoStorage();

    this.broadcast({
      type: 'pattern_inverted',
      trackId: msg.trackId,
      steps: track.steps,
      parameterLocks: track.parameterLocks,
      stepCount,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  private async handleReversePattern(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'reverse_pattern'; trackId: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    const stepCount = track.stepCount ?? 16;
    track.steps = reversePattern(track.steps, stepCount);
    track.parameterLocks = reversePattern(track.parameterLocks, stepCount);

    this.validateAndRepairState('handleReversePattern');
    await this.persistToDoStorage();

    this.broadcast({
      type: 'pattern_reversed',
      trackId: msg.trackId,
      steps: track.steps,
      parameterLocks: track.parameterLocks,
      stepCount,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  private async handleMirrorPattern(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'mirror_pattern'; trackId: string; direction: 'left-to-right' | 'right-to-left'; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    const stepCount = track.stepCount ?? 16;
    track.steps = mirrorPattern(track.steps, stepCount, msg.direction);
    track.parameterLocks = mirrorPattern(track.parameterLocks, stepCount, msg.direction);

    this.validateAndRepairState('handleMirrorPattern');
    await this.persistToDoStorage();

    this.broadcast({
      type: 'pattern_mirrored',
      trackId: msg.trackId,
      direction: msg.direction,
      steps: track.steps,
      parameterLocks: track.parameterLocks,
      stepCount,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  private async handleEuclideanFill(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'euclidean_fill'; trackId: string; hits: number; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    const stepCount = track.stepCount ?? 16;
    const { steps, locks } = applyEuclidean(
      track.steps,
      track.parameterLocks,
      stepCount,
      msg.hits
    );

    track.steps = steps;
    track.parameterLocks = locks;

    this.validateAndRepairState('handleEuclideanFill');
    await this.persistToDoStorage();

    this.broadcast({
      type: 'euclidean_filled',
      trackId: msg.trackId,
      hits: msg.hits,
      steps: track.steps,
      parameterLocks: track.parameterLocks,
      stepCount,
      playerId: player.id,
    }, undefined, msg.seq);
  }

  private async handleSetTrackName(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_track_name'; trackId: string; name: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Sanitize name: trim, limit length
    const sanitizedName = msg.name.trim().slice(0, MAX_TRACK_NAME_LENGTH);
    if (!sanitizedName) return; // Don't allow empty names

    track.name = sanitizedName;

    this.validateAndRepairState('handleSetTrackName');
    await this.persistToDoStorage();

    this.broadcast({
      type: 'track_name_set',
      trackId: msg.trackId,
      name: sanitizedName,
      playerId: player.id,
    }, undefined, msg.seq);
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

  // Phase 31D: Per-track swing handler
  private handleSetTrackSwing = createTrackMutationHandler<
    { trackId: string; swing: number },
    ServerMessage
  >({
    getTrackId: (msg) => msg.trackId,
    validate: (msg) => ({
      ...msg,
      swing: clamp(msg.swing, MIN_SWING, MAX_SWING),
    }),
    mutate: (track, msg) => { track.swing = msg.swing; },
    toBroadcast: (msg, playerId) => ({
      type: 'track_swing_set',
      trackId: msg.trackId,
      swing: msg.swing,
      playerId,
    }),
  });

  private async handleSetTrackStepCount(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_track_step_count'; trackId: string; stepCount: number; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    const track = this.state.tracks.find(t => t.id === msg.trackId);
    if (!track) return;

    // Validate step count (Phase 29F: added odd counts for polyrhythm support)
    // Uses VALID_STEP_COUNTS_SET from shared/sync-types.ts (single source of truth)
    if (!VALID_STEP_COUNTS_SET.has(msg.stepCount)) {
      console.warn(`[WS] Invalid stepCount ${msg.stepCount} from ${player.id}`);
      return;
    }

    track.stepCount = msg.stepCount;
    // Arrays stay at MAX_STEPS (128) length - stepCount indicates active steps only
    // Invariant: track.steps.length === MAX_STEPS (see worker/invariants.ts)
    // This preserves user data when reducing stepCount (non-destructive editing)

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'track_step_count_set',
      trackId: msg.trackId,
      stepCount: msg.stepCount,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  /**
   * Phase 25: Handle effects state change
   * Syncs audio effects (reverb, delay, chorus, distortion) across all clients
   */
  private async handleSetEffects(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_effects'; effects: EffectsState; seq?: number }
  ): Promise<void> {
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
      bypass: msg.effects.bypass === true,  // Default to false if not boolean true
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

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'effects_changed',
      effects: validatedEffects,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  /**
   * Phase 29E: Handle scale state changes (Key Assistant)
   * Updates root, scaleId, and locked state for the session
   */
  private async handleSetScale(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_scale'; scale: ScaleState; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    // Validate scale object has required fields
    if (!msg.scale ||
        typeof msg.scale.root !== 'string' ||
        typeof msg.scale.scaleId !== 'string' ||
        typeof msg.scale.locked !== 'boolean') {
      console.warn(`[WS] Invalid scale state from ${player.id}`);
      return;
    }

    // Validate root note (C, C#, D, D#, E, F, F#, G, G#, A, A#, B)
    const validRoots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    if (!validRoots.includes(msg.scale.root)) {
      console.warn(`[WS] Invalid scale root "${msg.scale.root}" from ${player.id}`);
      return;
    }

    const validatedScale: ScaleState = {
      root: msg.scale.root,
      scaleId: msg.scale.scaleId,
      locked: msg.scale.locked,
    };

    this.state.scale = validatedScale;

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'scale_changed',
      scale: validatedScale,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  /**
   * Phase 24: Handle FM synth parameter changes
   * Updates harmonicity and modulationIndex for FM synthesizers
   */
  private async handleSetFMParams(
    ws: WebSocket,
    player: PlayerInfo,
    msg: { type: 'set_fm_params'; trackId: string; fmParams: FMParams; seq?: number }
  ): Promise<void> {
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

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Phase 26: Pass clientSeq for mutation delivery confirmation
    this.broadcast({
      type: 'fm_params_changed',
      trackId: msg.trackId,
      fmParams: validatedFMParams,
      playerId: player.id,
    }, undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  }

  private handlePlay(ws: WebSocket, player: PlayerInfo): void {
    // Phase 22: Track per-player playback state
    this.playingPlayers.add(player.id);

    // Observability 2.0: Track play count and start time
    const obs = this.playerObservability.get(ws);
    if (obs) {
      obs.playCount++;
      obs.lastPlayStartTime = Date.now();
    }

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

    // Observability 2.0: Track total play time
    const obs = this.playerObservability.get(ws);
    if (obs && obs.lastPlayStartTime !== null) {
      obs.totalPlayTime_ms += Date.now() - obs.lastPlayStartTime;
      obs.lastPlayStartTime = null;
    }

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
    this.sendSnapshotToClient(ws, player, 'recovery');
  }

  /**
   * Phase 26 BUG-02: Send snapshot to a specific client
   * Unified helper for initial connect, recovery requests, and proactive catch-up
   */
  private sendSnapshotToClient(ws: WebSocket, player: PlayerInfo, reason: 'recovery' | 'proactive' = 'recovery'): void {
    if (!this.state) return;

    // Debug assertion: log snapshot
    console.log(`[ASSERT] snapshot SENT (${reason}): to=${player.id}, tracks=${this.state.tracks.length}, time=${Date.now()}`);
    console.log(`[WS] snapshot sent to player=${player.id} (${reason})`);

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
      serverSeq: this.serverSeq,  // Phase 26: For selective mutation clearing
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
    // Validate and sanitize cursor position to prevent malicious clients
    // from sending extreme values that could cause issues on other clients
    const validatedPosition = validateCursorPosition(msg.position);
    if (!validatedPosition) {
      // Invalid position - silently ignore (don't log, too noisy)
      return;
    }

    // Broadcast to all other players with sanitized position
    this.broadcast({
      type: 'cursor_moved',
      playerId: player.id,
      position: validatedPosition,
      color: player.color,
      name: player.name,
    }, ws); // Exclude sender
  }

  // ==================== Utilities ====================

  /**
   * Phase 27: Persist state to DO storage immediately (hybrid persistence).
   * This ensures durability before broadcasting to clients.
   * Called by all mutation handlers after applying the mutation.
   */
  public async persistToDoStorage(): Promise<void> {
    if (!this.state) return;

    // Use 'state' key for consistency with existing code
    await this.ctx.storage.put('state', this.state);
    // Mark that KV needs to be flushed when last client disconnects
    this.pendingKVSave = true;
  }

  /**
   * Broadcast a message to all connected players
   * Phase 13B: Add sequence numbers for message ordering
   * Phase 26: Only add sequence numbers to state-mutating broadcasts
   * @param message - The message to broadcast
   * @param exclude - Optional WebSocket to exclude (usually the sender)
   * @param clientSeq - Optional client sequence number for request-response correlation
   */
  private broadcast(message: ServerMessage, exclude?: WebSocket, clientSeq?: number): void {
    // Phase 26: Only add sequence numbers to state-mutating broadcasts
    // Non-mutating messages (cursor_moved, player_joined, etc.) don't need
    // sequence numbers because missing them doesn't cause state drift
    const isMutating = isStateMutatingBroadcast(message.type);

    let messageToSend: ServerMessage;
    if (isMutating) {
      // Phase 13B: Add server sequence number to state-mutating broadcasts
      const newSeq = ++this.serverSeq;
      messageToSend = {
        ...message,
        seq: newSeq,
        ...(clientSeq !== undefined && { clientSeq }),
      };

      // Persist serverSeq periodically (every 100 messages) to survive hibernation/eviction
      if (newSeq % 100 === 0) {
        this.ctx.storage.put('serverSeq', newSeq).catch(e => {
          console.error('[DO] Error persisting serverSeq:', e);
        });
      }
    } else {
      // Non-mutating broadcasts don't get sequence numbers
      messageToSend = message;
    }

    const data = JSON.stringify(messageToSend);
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
