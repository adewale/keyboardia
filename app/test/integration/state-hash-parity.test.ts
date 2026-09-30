/**
 * Public-boundary regression for canonical hash parity.
 *
 * The unit policy proves which fields belong in the hash. This test owns the
 * separate claim that create and update API round trips preserve those fields
 * in the shape the browser and Worker actually hash.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeForHash,
  hashState,
  projectCanonicalStateForClientHashCapability,
} from '../../src/shared/canonical-hash';
import {
  TRACK_ENVELOPE_CAPABILITY,
  TRACK_ENVELOPE_V2_CAPABILITY,
} from '../../src/shared/message-types';
import type { SessionState, SessionTrack } from '../../src/shared/state';

interface Env {
  LIVE_SESSIONS: DurableObjectNamespace;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;

function track(overrides: Partial<SessionTrack> = {}): SessionTrack {
  return {
    id: 'hash-test-track',
    name: 'Hash Test',
    sampleId: 'kick',
    steps: [true, false, false, false, true, false, false, false],
    parameterLocks: [null, null, { pitch: 4 }, null, null, null, null, null],
    volume: 0.75,
    pan: -0.2,
    muted: false,
    soloed: false,
    transpose: 2,
    stepCount: 8,
    swing: 12,
    fmParams: { harmonicity: 2.5, modulationIndex: 4 },
    envelope: { attack: 0.08, decay: 0.2, sustain: 0.65, release: 0.35 },
    envelopeTimeUnit: 'steps',
    envelopeV2: {
      model: 'ar',
      attack: { value: 0.5, unit: 'steps' },
      release: { value: 0.4, unit: 'seconds' },
    },
    samplePlaybackMode: 'gate',
    gate: 70,
    ...overrides,
  };
}

const effects = {
  bypass: false,
  reverb: { decay: 2.4, wet: 0.2 },
  delay: { time: '8n', feedback: 0.3, wet: 0.1 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0.15 },
  distortion: { amount: 0.4, wet: 0.05 },
};

function stateHash(state: SessionState): string {
  return hashState(canonicalizeForHash(state));
}

function waitForMessage(socket: WebSocket, type: string): Promise<{ type: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 4_000);
    socket.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer);
      const message = JSON.parse(raw) as { type: string };
      if (message.type !== type) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
}

describe('state hash parity through the session API', () => {
  it('preserves the complete hashed state through create and update round trips', async () => {
    const createdState: SessionState = {
      tracks: [track()],
      tempo: 128,
      swing: 10,
      effects,
      scale: { root: 'D', scaleId: 'dorian', locked: true },
      loopRegion: { start: 1, end: 6 },
      version: 1,
    };
    const createResponse = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: createdState }),
    });

    expect(createResponse.status).toBe(201);
    const { id: sessionId } = await createResponse.json() as { id: string };

    const fetchState = async (): Promise<SessionState> => {
      const response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
      expect(response.status).toBe(200);
      return (await response.json() as { state: SessionState }).state;
    };

    expect(stateHash(await fetchState())).toBe(stateHash(createdState));

    const updatedState: SessionState = {
      ...createdState,
      tracks: [track({
        steps: [false, true, false, false, false, true, false, false],
        samplePlaybackMode: 'loop',
      })],
      tempo: 142,
      effects: {
        ...effects,
        reverb: { ...effects.reverb, wet: 0.45 },
      },
      scale: { root: 'F', scaleId: 'major', locked: true },
      loopRegion: null,
    };
    const updateResponse = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: updatedState }),
    });

    expect(updateResponse.status).toBe(200);
    expect(stateHash(await fetchState())).toBe(stateHash(updatedState));
  });

  it('accepts an old browser hash for a session with authored scale', async () => {
    const state: SessionState = {
      tracks: [track()],
      tempo: 128,
      swing: 10,
      effects,
      scale: { root: 'D', scaleId: 'dorian', locked: true },
      loopRegion: { start: 1, end: 6 },
      version: 1,
    };
    const createResponse = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    expect(createResponse.status).toBe(201);
    const { id } = await createResponse.json() as { id: string };

    const capabilities = [TRACK_ENVELOPE_CAPABILITY, TRACK_ENVELOPE_V2_CAPABILITY].join(',');
    const stub = LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(id));
    const response = await stub.fetch(
      `http://do/api/sessions/${id}?playerId=legacy-hash-client&capabilities=${capabilities}`,
      { headers: { Upgrade: 'websocket' } },
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    const snapshot = waitForMessage(socket!, 'snapshot');
    socket!.accept();
    await snapshot;

    // The old App callback passed only these three fields. Canonicalization
    // therefore supplied the legacy missing-scale value before hashing.
    const oldBrowserCanonical = canonicalizeForHash({
      tracks: state.tracks,
      tempo: state.tempo,
      swing: state.swing,
    });
    const oldBrowserHash = hashState(
      projectCanonicalStateForClientHashCapability(oldBrowserCanonical, false),
    );
    const match = waitForMessage(socket!, 'state_hash_match');
    socket!.send(JSON.stringify({ type: 'state_hash', hash: oldBrowserHash }));
    await expect(match).resolves.toEqual({ type: 'state_hash_match' });
    socket!.close(1000, 'test complete');
  });
});
