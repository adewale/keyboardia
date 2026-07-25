import type { SessionState } from './state';
import { MAX_SWING, MAX_TEMPO, MIN_SWING, MIN_TEMPO } from './constants';

/** Canonical state construction shared by production and the local mock API. */
export function createInitialSessionState(initial?: Partial<SessionState>): SessionState {
  return {
    ...initial,
    tracks: initial?.tracks ?? [],
    tempo: Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, initial?.tempo ?? 120)),
    swing: Math.max(MIN_SWING, Math.min(MAX_SWING, initial?.swing ?? 0)),
    version: 1,
  };
}
