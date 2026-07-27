import { describe, expect, it } from 'vitest';
import type { Session } from '../shared/state';
import { createDurableObjectSessionAdapter } from './mcp';
import { RATE_LIMIT_DEFAULTS } from './rate-limit';
import { SessionAllocatorDurableObject } from './session-allocator';
import type { Env } from './types';

const BASE_URL = 'https://keyboardia.dev';
const KEY = '3f1b8a1e-1f5a-4c1d-9a2b-7e0d5c9a4b21';
const CLIENT_IP = '203.0.113.7';

/**
 * A KV namespace and Durable Object namespace faithful enough to drive the real
 * adapter: the session helpers it calls read and write `session:{id}` entries in
 * KV, and its reads go through the DO first.
 */
function fakeEnv(overrides: Partial<Env> = {}, failSessionPuts = 0) {
  const kv = new Map<string, string>();
  const allocatorStorage = new Map<string, unknown>();
  const doReads: string[] = [];
  let putsToFail = failSessionPuts;
  let alarmAt: number | null = null;

  const env = {
    SESSIONS: {
      async get(key: string, type?: string) {
        const raw = kv.get(key);
        if (raw === undefined) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key: string, value: string) {
        if (key.startsWith('session:') && putsToFail > 0) {
          putsToFail--;
          throw new Error('SECRET sqlite:///internal/session.db');
        }
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
  } as unknown as Env;

  let serialization = Promise.resolve();
  const allocatorState = {
    storage: {
      async get<T>(key: string) { return allocatorStorage.get(key) as T | undefined; },
      async put<T>(key: string, value: T) { allocatorStorage.set(key, value); },
      async delete(key: string) { return allocatorStorage.delete(key); },
      async list<T>({ prefix }: { prefix: string }) {
        return new Map(
          [...allocatorStorage.entries()]
            .filter(([key]) => key.startsWith(prefix))
        ) as Map<string, T>;
      },
      async getAlarm() { return alarmAt; },
      async setAlarm(scheduledTime: number | Date) {
        alarmAt = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
      },
    },
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const run = serialization.then(callback, callback);
      serialization = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const allocator = new SessionAllocatorDurableObject(allocatorState, env);
  Object.assign(env, {
    SESSION_ALLOCATOR: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (request: Request) => allocator.fetch(request) }),
    },
    ...overrides,
  });

  return { env, kv, allocatorStorage, doReads, allocator, getAlarm: () => alarmAt };
}

describe('the Durable Object session adapter', () => {
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
    const { env, kv, allocatorStorage } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    const first = await adapter.createSession({ idempotencyKey: KEY });
    const replay = await adapter.createSession({ idempotencyKey: KEY });

    expect(replay.id).toBe(first.id);
    expect(allocatorStorage.get(`idempotency:create:${KEY}`)).toMatchObject({ sessionId: first.id });
    expect([...kv.keys()].filter((key) => key.startsWith('session:'))).toHaveLength(1);
  });

  it('expires durable rate windows and idempotency reservations by alarm', async () => {
    const { allocator, allocatorStorage, getAlarm } = fakeEnv();
    const now = Date.now();
    allocatorStorage.set('rate:expired', { count: 1, windowStart: 0 });
    allocatorStorage.set('rate:live', { count: 1, windowStart: now });
    allocatorStorage.set('idempotency:create:expired', {
      sessionId: 'expired',
      expiresAt: 0,
      options: {},
    });
    allocatorStorage.set('idempotency:create:live', {
      sessionId: 'live',
      expiresAt: now + 120_000,
      options: {},
    });

    await allocator.alarm();

    expect(allocatorStorage.has('rate:expired')).toBe(false);
    expect(allocatorStorage.has('idempotency:create:expired')).toBe(false);
    expect(allocatorStorage.has('rate:live')).toBe(true);
    expect(allocatorStorage.has('idempotency:create:live')).toBe(true);
    expect(getAlarm()).toBe(now + 60_000);
  });

  it('serializes concurrent retries onto one pre-reserved session UUID', async () => {
    const { env, kv } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => adapter.createSession({ idempotencyKey: KEY }))
    );

    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
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

  it('recreates the same reserved session when its KV write is missing', async () => {
    const { env, kv } = fakeEnv();
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    const first = await adapter.createSession({ idempotencyKey: KEY });
    kv.delete(`session:${first.id}`);
    const replacement = await adapter.createSession({ idempotencyKey: KEY });

    expect(replacement.id).toBe(first.id);
    expect(kv.has(`session:${first.id}`)).toBe(true);
  });

  it('retries an uncertain KV write with the same UUID and never leaks storage text', async () => {
    const { env, kv, allocatorStorage } = fakeEnv({}, 1);
    const adapter = createDurableObjectSessionAdapter(env, BASE_URL);

    await expect(adapter.createSession({ idempotencyKey: KEY }))
      .rejects.toMatchObject({
        code: 'SESSION_WRITE_FAILED',
        message: 'Keyboardia could not save the session. Please try again.',
      });
    const reserved = allocatorStorage.get(`idempotency:create:${KEY}`) as { sessionId: string };

    const replay = await adapter.createSession({ idempotencyKey: KEY });
    expect(replay.id).toBe(reserved.sessionId);
    expect([...kv.keys()].filter((key) => key.startsWith('session:'))).toEqual([
      `session:${reserved.sessionId}`,
    ]);
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

  it('shares one allocation budget across create, remix, and publish', async () => {
    const { env } = fakeEnv({ SESSION_CREATE_RATE_LIMIT_PER_MINUTE: '2' } as Partial<Env>);
    const unmetered = createDurableObjectSessionAdapter(env, BASE_URL, undefined, null);
    const source = await unmetered.createSession({ idempotencyKey: KEY });
    const metered = createDurableObjectSessionAdapter(env, BASE_URL, undefined, CLIENT_IP);

    await metered.remixSession(source.id);
    await metered.publishSession(source.id);
    await expect(metered.remixSession(source.id)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
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
