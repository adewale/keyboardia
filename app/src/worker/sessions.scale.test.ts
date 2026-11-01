import { describe, expect, it } from 'vitest';
import type { Env, Session } from './types';
import { createSession, getSession, remixSessionFromState } from './sessions';

function memoryEnv(): { env: Env; values: Map<string, string> } {
  const values = new Map<string, string>();
  const kv = {
    async get(key: string): Promise<unknown> {
      const value = values.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    async put(key: string, value: string): Promise<void> {
      values.set(key, value);
    },
  };
  return { env: { SESSIONS: kv } as unknown as Env, values };
}

describe('session scale persistence and migration', () => {
  it('persists the locked C-minor-pentatonic default on fresh creation', async () => {
    const { env, values } = memoryEnv();
    const id = '00000000-0000-4000-8000-000000000001';
    const result = await createSession(env, { id });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.state.scale).toEqual({
      root: 'C', scaleId: 'minor-pentatonic', locked: true,
    });
    const persisted = JSON.parse(values.get(`session:${id}`)!) as Session;
    expect(persisted.state.scale).toEqual(result.data.state.scale);
  });

  it('hydrates a pre-scale KV session as explicitly unlocked', async () => {
    const { env, values } = memoryEnv();
    const id = '00000000-0000-4000-8000-000000000002';
    values.set(`session:${id}`, JSON.stringify({
      id,
      name: null,
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      remixedFrom: null,
      remixedFromName: null,
      remixCount: 0,
      immutable: false,
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }));

    const loaded = await getSession(env, id, false);
    expect(loaded?.state.scale).toEqual({
      root: 'C', scaleId: 'minor-pentatonic', locked: false,
    });
  });

  it('remixes a pre-scale source as explicitly unlocked', async () => {
    const { env } = memoryEnv();
    const source: Session = {
      id: '00000000-0000-4000-8000-000000000003',
      name: null,
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      remixedFrom: null,
      remixedFromName: null,
      remixCount: 0,
      immutable: false,
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    };

    const result = await remixSessionFromState(env, source.id, source);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.state.scale).toEqual({
      root: 'C', scaleId: 'minor-pentatonic', locked: false,
    });
  });
});
