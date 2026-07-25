import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridState } from '../types';
import type { Session } from '../shared/state';
import {
  flushPendingSessionSave,
  saveSession,
  saveSessionNow,
  sessionToGridState,
  setCurrentSessionId,
} from './session';

const sessionA = '11111111-1111-4111-8111-111111111111';
const sessionB = '22222222-2222-4222-8222-222222222222';

function state(tempo: number): GridState {
  return {
    tracks: [],
    tempo,
    swing: 7,
    effects: {
      bypass: false,
      reverb: { decay: 2.4, wet: 0.2 },
      delay: { time: '8n', feedback: 0.3, wet: 0.1 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0.25 },
      distortion: { amount: 0.4, wet: 0.05 },
    },
    scale: { root: 'D', scaleId: 'natural-minor', locked: true },
    isPlaying: false,
    currentStep: -1,
  };
}

describe('session persistence destinations and complete state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  });

  afterEach(async () => {
    await flushPendingSessionSave();
    setCurrentSessionId(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('captures the destination when a debounced save is scheduled', async () => {
    setCurrentSessionId(sessionA);
    saveSession(state(101));

    setCurrentSessionId(sessionB);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/sessions/${sessionA}`);
  });

  it('flushes the captured pending save before a session transition', async () => {
    setCurrentSessionId(sessionA);
    saveSession(state(102));
    setCurrentSessionId(sessionB);

    await flushPendingSessionSave();

    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/sessions/${sessionA}`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('serializes saves so an older request cannot overwrite newer state', async () => {
    const responses: Array<(response: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(resolve => responses.push(resolve)));
    setCurrentSessionId(sessionA);

    saveSession(state(101));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledOnce();

    const newerSave = saveSessionNow(state(102));
    expect(fetch).toHaveBeenCalledOnce();

    responses[0](new Response('{}', { status: 200 }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    responses[1](new Response('{}', { status: 200 }));
    await expect(newerSave).resolves.toBe(true);

    const savedTempos = vi.mocked(fetch).mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)).state.tempo,
    );
    expect(savedTempos).toEqual([101, 102]);
  });

  it('persists effects and scale in the REST session state', async () => {
    setCurrentSessionId(sessionA);
    const completeState = state(103);
    saveSession(completeState);

    await flushPendingSessionSave();

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.state).toMatchObject({
      tempo: 103,
      swing: 7,
      effects: completeState.effects,
      scale: completeState.scale,
      version: 1,
    });
  });

  it('replays effects and scale from a loaded session', () => {
    const completeState = state(104);
    const session: Session = {
      id: sessionA,
      name: 'Complete',
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      remixedFrom: null,
      remixedFromName: null,
      remixCount: 0,
      immutable: false,
      state: {
        tracks: [],
        tempo: completeState.tempo,
        swing: completeState.swing,
        effects: completeState.effects,
        scale: completeState.scale,
        version: 1,
      },
    };

    expect(sessionToGridState(session)).toMatchObject({
      effects: completeState.effects,
      scale: completeState.scale,
    });
  });
});
