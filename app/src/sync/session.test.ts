// @vitest-environment jsdom
/**
 * Tests for the session -> grid state adapter.
 *
 * This adapter is the only thing standing between a persisted session and the
 * reducer on the HTTP load path, which is what runs in single player and on
 * every load before the WebSocket connects. It silently dropped `effects`,
 * `scale`, and `loopRegion` for as long as it existed, because nothing
 * asserted the whole shape — only that tracks/tempo/swing survived.
 */
import { describe, it, expect } from 'vitest';
import { sessionToGridState } from './session';
import type { Session } from '../shared/state';

const EFFECTS = {
  bypass: false,
  reverb: { decay: 4, wet: 0.5 },
  delay: { time: '8n', feedback: 0.3, wet: 0.2 },
  chorus: { frequency: 2, depth: 0.4, wet: 0.1 },
  distortion: { amount: 0.25, wet: 0.3 },
};

const SCALE = { root: 'C', scaleId: 'minor', locked: true };

function session(state: Partial<Session['state']>): Session {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Adapter Fixture',
    createdAt: 0,
    updatedAt: 0,
    lastAccessedAt: 0,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    immutable: false,
    state: {
      tracks: [],
      tempo: 128,
      swing: 15,
      version: 1,
      ...state,
    },
  } as Session;
}

describe('sessionToGridState', () => {
  it('carries the core pattern', () => {
    const grid = sessionToGridState(session({}));

    expect(grid.tempo).toBe(128);
    expect(grid.swing).toBe(15);
    expect(grid.tracks).toEqual([]);
  });

  it('carries every persisted collaborative field', () => {
    const grid = sessionToGridState(session({
      effects: EFFECTS,
      scale: SCALE,
      loopRegion: { start: 4, end: 12 },
    }));

    expect(grid.effects).toEqual(EFFECTS);
    expect(grid.scale).toEqual(SCALE);
    expect(grid.loopRegion).toEqual({ start: 4, end: 12 });
  });

  it('reports no loop region rather than undefined when the session has none', () => {
    const grid = sessionToGridState(session({}));

    expect(grid.loopRegion).toBeNull();
  });

  it('leaves optional fields undefined for sessions saved before they existed', () => {
    const grid = sessionToGridState(session({}));

    expect(grid.effects).toBeUndefined();
    expect(grid.scale).toBeUndefined();
  });

  it('returns nothing for malformed session data', () => {
    expect(sessionToGridState({ id: 'x' } as unknown as Session)).toEqual({});
  });
});
