/**
 * Server Handler Factory
 *
 * Provides factory functions to create Durable Object message handlers with
 * common patterns, reducing boilerplate in live-session.ts.
 *
 * Pattern: Most track mutation handlers follow:
 * 1. Return early if no state
 * 2. Find track by ID
 * 3. Return early if track not found
 * 4. Validate/clamp values
 * 5. Mutate track
 * 6. Persist to DO storage (Phase 27: hybrid persistence)
 * 7. Broadcast change
 */

import type { SessionState, SessionTrack, PlayerInfo, ServerMessage } from './types';

/**
 * Context interface for server handler factories.
 * Matches the shape of LiveSessionDurableObject's required methods/state.
 */
export interface LiveSessionContext {
  state: SessionState | null;
  broadcast: (message: ServerMessage, exclude?: WebSocket, clientSeq?: number) => void;
  /** Phase 27: Persist state to DO storage immediately (hybrid persistence) */
  persistToDoStorage: () => Promise<void>;
}

/**
 * Configuration for track mutation handlers.
 */
export interface TrackMutationConfig<TMsg, TBroadcast extends ServerMessage> {
  /** Extract track ID from message */
  getTrackId: (msg: TMsg) => string;
  /** Optional: Validate and transform the message (return null to reject) */
  validate?: (msg: TMsg) => TMsg | null;
  /** Apply mutation to track */
  mutate: (track: SessionTrack, msg: TMsg) => void;
  /** Create broadcast message */
  toBroadcast: (msg: TMsg, playerId: string) => TBroadcast;
}

/**
 * Creates a handler for track-based mutations that:
 * 1. Returns early if no state
 * 2. Finds track by ID, returns early if not found
 * 3. Validates/transforms the message
 * 4. Applies mutation to track
 * 5. Persists to DO storage (Phase 27: hybrid persistence)
 * 6. Broadcasts change to all clients
 *
 * @example
 * private handleSetTrackVolume = createTrackMutationHandler({
 *   getTrackId: (msg) => msg.trackId,
 *   validate: (msg) => ({ ...msg, volume: clamp(msg.volume, 0, 1) }),
 *   mutate: (track, msg) => { track.volume = msg.volume; },
 *   toBroadcast: (msg, playerId) => ({
 *     type: 'track_volume_set' as const,
 *     trackId: msg.trackId,
 *     volume: msg.volume,
 *     playerId,
 *   }),
 * });
 */
export function createTrackMutationHandler<
  TMsg extends { trackId: string; seq?: number },
  TBroadcast extends ServerMessage
>(config: TrackMutationConfig<TMsg, TBroadcast>) {
  return async function (
    this: LiveSessionContext,
    _ws: WebSocket,
    player: PlayerInfo,
    msg: TMsg
  ): Promise<void> {
    // Return early if no state loaded
    if (!this.state) return;

    // Find track
    const trackId = config.getTrackId(msg);
    const track = this.state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    // Validate/transform message (null means validation failed)
    const validated = config.validate ? config.validate(msg) : msg;
    if (validated === null) return;

    // Apply mutation
    config.mutate(track, validated);

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Broadcast to all clients (Phase 26: pass clientSeq for delivery confirmation)
    this.broadcast(config.toBroadcast(validated, player.id), undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  };
}

/**
 * Configuration for global state mutation handlers (tempo, swing, effects).
 */
export interface GlobalMutationConfig<TMsg, TBroadcast extends ServerMessage> {
  /** Optional: Validate and transform the message */
  validate?: (msg: TMsg) => TMsg;
  /** Apply mutation to state */
  mutate: (state: SessionState, msg: TMsg) => void;
  /** Create broadcast message */
  toBroadcast: (msg: TMsg, playerId: string) => TBroadcast;
}

/**
 * Creates a handler for global state mutations (not track-specific):
 * 1. Returns early if no state
 * 2. Validates/transforms the message
 * 3. Applies mutation to state
 * 4. Persists to DO storage (Phase 27: hybrid persistence)
 * 5. Broadcasts change to all clients
 *
 * @example
 * private handleSetTempo = createGlobalMutationHandler({
 *   validate: (msg) => ({ ...msg, tempo: clamp(msg.tempo, 60, 180) }),
 *   mutate: (state, msg) => { state.tempo = msg.tempo; },
 *   toBroadcast: (msg, playerId) => ({
 *     type: 'tempo_changed' as const,
 *     tempo: msg.tempo,
 *     playerId,
 *   }),
 * });
 */
export function createGlobalMutationHandler<
  TMsg extends { seq?: number },
  TBroadcast extends ServerMessage
>(config: GlobalMutationConfig<TMsg, TBroadcast>) {
  return async function (
    this: LiveSessionContext,
    _ws: WebSocket,
    player: PlayerInfo,
    msg: TMsg
  ): Promise<void> {
    // Return early if no state loaded
    if (!this.state) return;

    // Validate/transform message
    const validated = config.validate ? config.validate(msg) : msg;

    // Apply mutation
    config.mutate(this.state, validated);

    // Phase 27: Persist to DO storage immediately (hybrid persistence)
    await this.persistToDoStorage();

    // Broadcast to all clients (Phase 26: pass clientSeq for delivery confirmation)
    this.broadcast(config.toBroadcast(validated, player.id), undefined, msg.seq);

    // Phase 27: KV is written on disconnect, not per-mutation (hybrid persistence)
  };
}

/**
 * Helper to create a simple track field setter.
 * Use when the mutation is just setting a single field.
 *
 * @example
 * const handleSetTrackVolume = createTrackFieldSetter(
 *   'volume',
 *   'track_volume_set',
 *   (msg) => clamp(msg.volume, 0, 1)
 * );
 */
export function createTrackFieldSetter<
  TField extends keyof SessionTrack,
  TMsg extends { trackId: string } & Record<TField, SessionTrack[TField]>
>(
  field: TField,
  broadcastType: string,
  validate?: (value: SessionTrack[TField]) => SessionTrack[TField]
) {
  return createTrackMutationHandler<TMsg, ServerMessage>({
    getTrackId: (msg) => msg.trackId,
    validate: validate
      ? (msg) => ({ ...msg, [field]: validate(msg[field]) })
      : undefined,
    mutate: (track, msg) => {
      (track as Record<TField, SessionTrack[TField]>)[field] = msg[field];
    },
    toBroadcast: (msg, playerId) => ({
      type: broadcastType,
      trackId: msg.trackId,
      [field]: msg[field],
      playerId,
    } as unknown as ServerMessage),
  });
}
