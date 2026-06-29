/**
 * Eviction & recovery integration tests for LiveSessionDurableObject.
 *
 * These exercise the `evictDurableObject` / `evictAllDurableObjects` helpers
 * added in @cloudflare/vitest-pool-workers v0.16.20. They tear down a running
 * Durable Object instance to reset its in-memory state while preserving durable
 * storage — letting us prove the recovery paths that live-session.ts builds
 * around (constructor rehydration of `serverSeq` from storage, and lazy
 * `ensureStateLoaded()` reading `state` back from DO storage after a cold start).
 *
 * Before these helpers existed, none of this was covered end-to-end: the DO
 * persists state "to survive hibernation/eviction" but nothing actually evicted
 * it in a test, so the rehydration code only ran in production/staging.
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/
 */

import {
  env,
  runInDurableObject,
  evictDurableObject,
  evictAllDurableObjects,
} from 'cloudflare:test';
import { it, expect } from 'vitest';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
  SAMPLES: R2Bucket;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;

// Minimal SessionState the DO accepts. validateAndRepairState() normalises the
// rest (e.g. padding step arrays) on load, so an empty track list is enough to
// assert tempo/swing rehydration without fighting the invariants.
function sessionState(tempo: number, swing: number) {
  return { tracks: [], tempo, swing, version: 1 };
}

async function debugInfo(stub: DurableObjectStub, sessionId: string) {
  const res = await stub.fetch(`http://placeholder/api/sessions/${sessionId}/debug`);
  expect(res.status).toBe(200);
  return (await res.json()) as { tempo: number; swing: number; connectedPlayers: number };
}

it('rehydrates session state from durable storage after eviction', async () => {
  const sessionId = 'evict-rehydrate-state';
  const id = LIVE_SESSIONS.idFromName(sessionId);
  const stub = LIVE_SESSIONS.get(id);

  // Persist a known state + serverSeq to durable storage, exactly as the live
  // session does on mutation, then diverge the IN-MEMORY copy so we can tell
  // rehydration (storage wins) apart from a stale read (memory wins).
  await runInDurableObject(stub, async (instance, state) => {
    await state.storage.put('state', sessionState(137, 42));
    await state.storage.put('serverSeq', 7);

    const obj = instance as unknown as Record<string, unknown>;
    obj['sessionId'] = sessionId;
    obj['state'] = sessionState(999, 999);
    obj['serverSeq'] = 999;
    obj['stateLoaded'] = true;
  });

  // Sanity check: the divergent in-memory state is what the live instance
  // currently serves (storage has not been re-read yet).
  expect((await debugInfo(stub, sessionId)).tempo).toBe(999);

  // Evict: tears down the instance, resetting in-memory state but keeping
  // durable storage intact.
  await evictDurableObject(stub);

  // A fresh instance must rehydrate `state` from durable storage via
  // ensureStateLoaded() rather than serve the discarded in-memory values.
  const afterEvict = await debugInfo(stub, sessionId);
  expect(afterEvict.tempo).toBe(137);
  expect(afterEvict.swing).toBe(42);

  // serverSeq is reloaded in the constructor's blockConcurrencyWhile() block,
  // not lazily — verify it came back from storage too.
  await runInDurableObject(stub, async (instance) => {
    const obj = instance as unknown as Record<string, unknown>;
    expect(obj['serverSeq']).toBe(7);
  });
});

it('honours the webSockets: "close" eviction option and still rehydrates state', async () => {
  const sessionId = 'evict-ws-close-option';
  const id = LIVE_SESSIONS.idFromName(sessionId);
  const stub = LIVE_SESSIONS.get(id);

  await runInDurableObject(stub, async (instance, state) => {
    await state.storage.put('state', sessionState(95, 12));
    const obj = instance as unknown as Record<string, unknown>;
    obj['sessionId'] = sessionId;
    obj['state'] = sessionState(999, 999);
    obj['stateLoaded'] = true;
  });

  // No live socket here, so "close" behaves like the default for state, but
  // this asserts the option shown in the announcement is accepted and the
  // recovery path is unaffected by it.
  await evictDurableObject(stub, { webSockets: 'close' });

  expect((await debugInfo(stub, sessionId)).tempo).toBe(95);
});

it('evictAllDurableObjects resets in-memory state across instances', async () => {
  const sessions = [
    { sessionId: 'evict-all-a', tempo: 88, swing: 5 },
    { sessionId: 'evict-all-b', tempo: 144, swing: 60 },
  ];

  // Set up two distinct DOs, each with durable state and a divergent in-memory
  // copy.
  for (const { sessionId, tempo, swing } of sessions) {
    const stub = LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(sessionId));
    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('state', sessionState(tempo, swing));
      const obj = instance as unknown as Record<string, unknown>;
      obj['sessionId'] = sessionId;
      obj['state'] = sessionState(999, 999);
      obj['stateLoaded'] = true;
    });
    const stillRunning = await debugInfo(stub, sessionId);
    expect(stillRunning.tempo).toBe(999);
  }

  // Graceful bulk eviction of every running DO.
  await evictAllDurableObjects();

  // Each one rehydrates its own persisted state from storage.
  for (const { sessionId, tempo, swing } of sessions) {
    const stub = LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(sessionId));
    const info = await debugInfo(stub, sessionId);
    expect(info.tempo).toBe(tempo);
    expect(info.swing).toBe(swing);
  }
});
