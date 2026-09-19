import type { EnvelopeDuration, EnvelopeStageName } from './envelope-contract-v2';
import type { ParameterLock } from './sync-types';

const TYPED_FIELD_BY_STAGE = {
  attack: 'attackDuration',
  hold: 'holdDuration',
  decay: 'decayDuration',
  release: 'releaseDuration',
} as const;

const LEGACY_FIELD_BY_STAGE = {
  attack: 'attack',
  decay: 'decay',
  release: 'release',
} as const;

/** Apply an authoritative v2 edit without leaving a legacy fallback behind. */
export function applyEnvelopeLockDurationV2(
  current: ParameterLock | null | undefined,
  stage: EnvelopeStageName,
  duration: EnvelopeDuration | null,
): ParameterLock | null {
  const lock = { ...(current ?? {}) };
  const typedField = TYPED_FIELD_BY_STAGE[stage];
  if (duration === null) delete lock[typedField];
  else lock[typedField] = duration;

  // Clearing only attackDuration/decayDuration/releaseDuration would allow the
  // corresponding legacy numeric field to become effective again. A v2 set or
  // clear canonically supersedes that older representation. Hold has no legacy field.
  if (stage !== 'hold') delete lock[LEGACY_FIELD_BY_STAGE[stage]];
  return Object.keys(lock).length > 0 ? lock : null;
}
