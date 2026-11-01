import type { SessionState } from './state';
import { MAX_SWING, MAX_TEMPO, MIN_SWING, MIN_TEMPO } from './constants';
import { normalizeSessionEffects } from './effects-defaults';
import { normalizeSessionScale } from './scale-defaults';

/** Canonical state construction shared by production and the local mock API. */
export function createInitialSessionState(initial?: Partial<SessionState>): SessionState {
  const defined = Object.fromEntries(
    Object.entries(initial ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<SessionState>;
  return {
    ...defined,
    tracks: initial?.tracks ?? [],
    tempo: Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, initial?.tempo ?? 120)),
    swing: Math.max(MIN_SWING, Math.min(MAX_SWING, initial?.swing ?? 0)),
    effects: normalizeSessionEffects(initial?.effects, 'new-session'),
    scale: normalizeSessionScale(initial?.scale, 'new-session'),
    version: 1,
  };
}
