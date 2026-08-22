import type { ParameterLock } from './sync-types';
import type { SessionState, SessionTrack } from './state';

const ENVELOPE_LOCK_FIELDS = [
  'attack',
  'decay',
  'release',
  'attackDuration',
  'holdDuration',
  'decayDuration',
  'releaseDuration',
] as const satisfies readonly (keyof ParameterLock)[];

function mergeParameterLockV2(
  previous: ParameterLock | null | undefined,
  replacement: ParameterLock | null | undefined,
): ParameterLock | null {
  const carried: ParameterLock = {};
  if (previous) {
    for (const field of ENVELOPE_LOCK_FIELDS) {
      if (previous[field] !== undefined && (!replacement || replacement[field] === undefined)) {
        carried[field] = previous[field];
      }
    }
  }
  const merged = { ...(replacement ?? {}), ...carried };
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Merge a full-state write from a client that may predate the v2 envelope fields.
 *
 * An old client cannot intentionally edit fields it cannot represent, so omitted
 * v2 data is retained per track and per step. Explicit values from a v2-aware
 * replacement still win. Track deletion remains authoritative.
 */
export function mergeRollingEnvelopeStateV2(
  previous: SessionState,
  replacement: SessionState,
): SessionState {
  const previousById = new Map(previous.tracks.map(track => [track.id, track]));
  return {
    ...replacement,
    tracks: replacement.tracks.map((track): SessionTrack => {
      const previousTrack = previousById.get(track.id);
      if (!previousTrack) return track;

      const next: SessionTrack = { ...track };
      if (track.envelopeV2 === undefined && previousTrack.envelopeV2 !== undefined) {
        next.envelopeV2 = previousTrack.envelopeV2;
      }
      if (track.envelope === undefined && previousTrack.envelope !== undefined) {
        next.envelope = previousTrack.envelope;
      }
      if (track.envelopeTimeUnit === undefined && previousTrack.envelopeTimeUnit !== undefined) {
        next.envelopeTimeUnit = previousTrack.envelopeTimeUnit;
      }
      if (track.gate === undefined && previousTrack.gate !== undefined) {
        next.gate = previousTrack.gate;
      }
      if (track.samplePlaybackMode === undefined && previousTrack.samplePlaybackMode !== undefined) {
        next.samplePlaybackMode = previousTrack.samplePlaybackMode;
      }

      const lockCount = Math.max(track.parameterLocks.length, previousTrack.parameterLocks.length);
      next.parameterLocks = Array.from({ length: lockCount }, (_, step) =>
        mergeParameterLockV2(previousTrack.parameterLocks[step], track.parameterLocks[step]));
      return next;
    }),
  };
}

/**
 * Match the canonical JSON shape produced by a pre-v2 client.
 *
 * Optional fields cannot merely be set to null: older hash implementations did
 * not emit the keys at all, and JSON object shape is part of the hash. Parameter
 * lock objects are intentionally untouched because old clients retain unknown
 * lock properties while loading snapshots.
 */
export function projectCanonicalStateForEnvelopeV2Capability<
  T extends { tracks: readonly object[] },
>(
  canonicalState: T,
  capability: boolean | 'pre-envelope' | 'v1' | 'v2',
): T | object {
  const tier = typeof capability === 'boolean'
    ? (capability ? 'v2' : 'pre-envelope')
    : capability;
  if (tier === 'v2') return canonicalState;
  return {
    ...canonicalState,
    tracks: canonicalState.tracks.map(track => {
      const legacyTrack = { ...track } as Record<string, unknown>;
      delete legacyTrack.envelopeV2;
      delete legacyTrack.samplePlaybackMode;
      if (tier === 'pre-envelope') {
        delete legacyTrack.envelope;
        delete legacyTrack.envelopeTimeUnit;
        delete legacyTrack.gate;
        delete legacyTrack.fmParams;
        const locks = legacyTrack.parameterLocks;
        if (Array.isArray(locks)) {
          legacyTrack.parameterLocks = locks.map(lock => {
            if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return lock;
            const projected = { ...lock } as Record<string, unknown>;
            for (const field of ENVELOPE_LOCK_FIELDS) delete projected[field];
            return Object.keys(projected).length > 0 ? projected : null;
          });
        }
      }
      return legacyTrack;
    }),
  };
}
