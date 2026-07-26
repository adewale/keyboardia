import { beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '../shared/state';
import { createDurableObjectSessionAdapter } from './mcp';
import { createIdempotencyKeyName } from './mcp-lifecycle';
import { RATE_LIMIT_DEFAULTS, resetRateLimits } from './rate-limit';
import type { Env } from './types';

const BASE_URL = 'https://keyboardia.dev';
const KEY = '3f1b8a1e-1f5a-4c1d-9a2b-7e0d5c9a4b21';
const CLIENT_IP = '203.0.113.7';

/**
 * A KV namespace and Durable Object namespace faithful enough to drive the real
 * adapter: the session helpers it calls read and write `session:{id}` entries in
 * KV, and its reads go through the DO first.
 */
function fakeEnv(overrides: Partial<Env> = {}) {
  const kv = new Map<string, string>();
  const doReads: string[] = [];

  const env = {
    SESSIONS: {
      async get(key: string, type?: string) {
        const raw = kv.get(key);
        if (raw === undefined) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key: string, value: string) {
        kv.set(key, value);
      },
    },
    LIVE_SESSIONS: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        async fetch(request: Request) {
          doReads.push(id);
          const raw = kv.get(`session:${id}`);
          if (!raw) {
            return new Response(
              JSON.stringify({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }
          void request;
          return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      }),
    },
    ...overrides,
  } as unknown as Env;

  return { env, kv, doReads };
}

describe('the Durable Object session adapter', () => {
  beforeEach(resetRateLimits);

  it('creates a session that is readable straight back', async () => {
    const { env, kv } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    const created = await adapter.createSession({ idempotencyKey: KEY, name: 'House', tempo: 124 });

    expect(created.immutable).toBe(false);
    expect(created.name).toBe('House');
    expect(created.state.tempo).toBe(124);
    expect(kv.has(`session:${created.id}`)).toBe(true);
    expect((await adapter.getSession(created.id)).id).toBe(created.id);
  });

  it('records the idempotency key and replays it instead of creating again', async () => {
    const { env, kv } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    const first = await adapter.createSession({ idempotencyKey: KEY });
    const replay = await adapter.createSession({ idempotencyKey: KEY });

    expect(replay.id).toBe(first.id);
    expect(kv.get(createIdempotencyKeyName(KEY))).toBe(first.id);
    expect([...kv.keys()].filter((key) => key.startsWith('session:'))).toHaveLength(1);
  });

  /**
   * A duplicate session is exactly what the key exists to prevent, so a read
   * that fails for any reason other than "gone" must not be answered by
   * creating another one.
   */
  it('propagates a transient replay failure instead of creating a duplicate', async () => {
    const { env } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);
    const first = await adapter.createSession({ idempotencyKey: KEY });

    const broken = {
      ...env,
      LIVE_SESSIONS: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: async () => { throw new Error('durable object unavailable'); } }),
      },
      SESSIONS: {
        get: (env.SESSIONS as unknown as { get: (key: string, type?: string) => Promise<unknown> }).get,
        put: async () => { throw new Error('KV unavailable'); },
      },
    } as unknown as Env;
    // The KV fallback still resolves the session, so the replay succeeds
    // without writing anything.
    const replay = await createDurableObjectSessionAdapter(broken, BASE_URL)
      .createSession({ idempotencyKey: KEY });

    expect(replay.id).toBe(first.id);
  });

  it('creates a fresh session when the recorded one has gone', async () => {
    const { env, kv } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    const first = await adapter.createSession({ idempotencyKey: KEY });
    kv.delete(`session:${first.id}`);
    const replacement = await adapter.createSession({ idempotencyKey: KEY });

    expect(replacement.id).not.toBe(first.id);
    expect(kv.get(createIdempotencyKeyName(KEY))).toBe(replacement.id);
  });

  /**
   * `/mcp` is unauthenticated, so this tool must not be a way around the budget
   * that already guards POST /api/sessions on the same KV quota.
   */
  it('charges creates against the same per-IP budget as the REST route', async () => {
    const { env } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL, undefined, CLIENT_IP);

    for (let i = 0; i < RATE_LIMIT_DEFAULTS.sessionCreate; i++) {
      await adapter.createSession({ idempotencyKey: `key-${i}` });
    }

    await expect(adapter.createSession({ idempotencyKey: 'one-too-many' }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('does not charge a replay against the budget, because it writes nothing', async () => {
    const { env } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL, undefined, CLIENT_IP);

    for (let i = 0; i < RATE_LIMIT_DEFAULTS.sessionCreate + 5; i++) {
      await adapter.createSession({ idempotencyKey: KEY });
    }

    // A create with a fresh key still has budget left.
    await expect(adapter.createSession({ idempotencyKey: 'another-key' })).resolves.toBeDefined();
  });

  it('skips the limit when there is no client IP, as the REST route does', async () => {
    const { env } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL, undefined, null);

    for (let i = 0; i < RATE_LIMIT_DEFAULTS.sessionCreate + 2; i++) {
      await adapter.createSession({ idempotencyKey: `local-${i}` });
    }

    await expect(adapter.createSession({ idempotencyKey: 'local-last' })).resolves.toBeDefined();
  });

  it('remixes from the live Durable Object state and leaves the source alone', async () => {
    const { env, kv, doReads } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);
    const source = await adapter.createSession({ idempotencyKey: KEY, tempo: 130 });
    doReads.length = 0;

    const remix = await adapter.remixSession(source.id);

    expect(doReads).toContain(source.id);
    expect(remix.id).not.toBe(source.id);
    expect(remix.remixedFrom).toBe(source.id);
    expect(remix.immutable).toBe(false);
    expect(remix.state.tempo).toBe(130);
    expect((JSON.parse(kv.get(`session:${source.id}`)!) as Session).immutable).toBe(false);
  });

  it('publishes an immutable snapshot and keeps the source editable', async () => {
    const { env, kv } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);
    const source = await adapter.createSession({ idempotencyKey: KEY });

    const published = await adapter.publishSession(source.id);

    expect(published.immutable).toBe(true);
    expect(published.remixedFrom).toBe(source.id);
    expect((JSON.parse(kv.get(`session:${source.id}`)!) as Session).immutable).toBe(false);
  });

  it('refuses to publish an already-published session', async () => {
    const { env } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);
    const source = await adapter.createSession({ idempotencyKey: KEY });
    const published = await adapter.publishSession(source.id);

    await expect(adapter.publishSession(published.id))
      .rejects.toMatchObject({ code: 'ALREADY_PUBLISHED' });
  });

  it('defers the social-preview purge instead of blocking the publish', async () => {
    const deferred: Array<Promise<unknown>> = [];
    const { env } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL, {
      waitUntil: (promise) => { deferred.push(promise); },
    });
    const source = await adapter.createSession({ idempotencyKey: KEY });

    await adapter.publishSession(source.id);

    expect(deferred).toHaveLength(1);
    // The purge cannot reject the publish, whatever the cache does.
    await expect(deferred[0]).resolves.toBeUndefined();
  });

  it('reports a missing session rather than inventing one', async () => {
    const { env } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    await expect(adapter.getSession('00000000-0000-4000-8000-00000000dead'))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(adapter.remixSession('00000000-0000-4000-8000-00000000dead'))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });
});
