// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridState } from '../types';
import type { Session } from '../shared/state';

const sessionA = '11111111-1111-4111-8111-111111111111';
const sessionB = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  currentSessionId: '11111111-1111-4111-8111-111111111111' as string | null,
  loadSession: vi.fn(),
  saveSession: vi.fn(),
  saveSessionNow: vi.fn(),
  flushPendingSessionSave: vi.fn(),
  createSession: vi.fn(),
  remixSession: vi.fn(),
  sendCopy: vi.fn(),
  publishSession: vi.fn(),
}));

vi.mock('../sync/session', () => ({
  getSessionIdFromUrl: () => sessionA,
  loadSession: mocks.loadSession,
  createSession: mocks.createSession,
  saveSession: mocks.saveSession,
  saveSessionNow: mocks.saveSessionNow,
  flushPendingSessionSave: mocks.flushPendingSessionSave,
  remixSession: mocks.remixSession,
  sendCopy: mocks.sendCopy,
  publishSession: mocks.publishSession,
  updateUrlWithSession: vi.fn(),
  getCurrentSessionId: () => mocks.currentSessionId,
  sessionToGridState: (session: Session) => session.state,
  updateSessionNameViaApi: vi.fn(),
}));

vi.mock('../sync/multiplayer', () => ({
  sendSessionName: vi.fn(),
  multiplayer: {
    isConnected: () => false,
    subscribe: () => () => undefined,
  },
}));

vi.mock('../debug/DebugContext', () => ({
  useDebug: () => ({
    isDebugMode: false,
    logState: vi.fn(),
    logError: vi.fn(),
    setSessionInfo: vi.fn(),
  }),
}));

import { useSession } from './useSession';

function gridState(tempo: number): GridState {
  return {
    tracks: [], tempo, swing: 0,
    effects: {
      bypass: false,
      reverb: { decay: 2, wet: 0 },
      delay: { time: '8n', feedback: 0.3, wet: 0 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
      distortion: { amount: 0.4, wet: 0 },
    },
    scale: { root: 'C', scaleId: 'minor-pentatonic', locked: false },
    isPlaying: false, currentStep: -1,
  };
}

function loadedSession(state: GridState): Session {
  return {
    id: sessionA,
    name: null,
    createdAt: 1,
    updatedAt: 1,
    lastAccessedAt: 1,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    immutable: false,
    state: { ...state, version: 1 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('useSession transition persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentSessionId = sessionA;
    mocks.loadSession.mockResolvedValue(loadedSession(gridState(100)));
    window.history.replaceState({}, '', `/s/${sessionA}`);
  });

  it('saves every edit made during the transition and retains the captured source session', async () => {
    const flush = deferred<boolean>();
    const firstSave = deferred<boolean>();
    const secondSave = deferred<boolean>();
    mocks.flushPendingSessionSave.mockReturnValueOnce(flush.promise);
    mocks.saveSessionNow
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    const loadState = vi.fn();
    const resetState = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) => useSession(state, loadState, resetState),
      { initialProps: { state: gridState(100) } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ state: gridState(200) });
    let sharePromise!: Promise<string>;
    act(() => { sharePromise = result.current.share(); });
    await waitFor(() => expect(mocks.flushPendingSessionSave).toHaveBeenCalledOnce());

    // A newer edit and even a mutable global destination change occur while
    // the old pending write is still in flight.
    rerender({ state: gridState(300) });
    mocks.currentSessionId = sessionB;
    act(() => flush.resolve(true));
    await waitFor(() => expect(mocks.saveSessionNow).toHaveBeenCalledTimes(1));
    expect(mocks.saveSessionNow).toHaveBeenNthCalledWith(1, sessionA, expect.objectContaining({ tempo: 300 }));

    // An edit during the immediate save requires another save before the URL
    // may be handed to a recipient.
    rerender({ state: gridState(400) });
    act(() => firstSave.resolve(true));
    await waitFor(() => expect(mocks.saveSessionNow).toHaveBeenCalledTimes(2));
    expect(mocks.saveSessionNow).toHaveBeenNthCalledWith(2, sessionA, expect.objectContaining({ tempo: 400 }));

    act(() => secondSave.resolve(true));
    await expect(sharePromise).resolves.toBe(`${window.location.origin}/s/${sessionA}`);
  });

  it('ignores playback-only state revisions while preparing a transition', async () => {
    const save = deferred<boolean>();
    mocks.flushPendingSessionSave.mockResolvedValue(true);
    mocks.saveSessionNow.mockReturnValueOnce(save.promise);

    const { result, rerender } = renderHook(
      ({ state }) => useSession(state, vi.fn(), vi.fn()),
      { initialProps: { state: gridState(100) } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let sharePromise!: Promise<string>;
    act(() => { sharePromise = result.current.share(); });
    await waitFor(() => expect(mocks.saveSessionNow).toHaveBeenCalledOnce());

    rerender({ state: { ...gridState(100), isPlaying: true, currentStep: 7 } });
    act(() => save.resolve(true));

    await expect(sharePromise).resolves.toBe(`${window.location.origin}/s/${sessionA}`);
    expect(mocks.saveSessionNow).toHaveBeenCalledOnce();
  });

  it('treats an explicit null loop as a persisted clear rather than an omitted field', async () => {
    const firstSave = deferred<boolean>();
    mocks.flushPendingSessionSave.mockResolvedValue(true);
    mocks.saveSessionNow
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(true);

    const { result, rerender } = renderHook(
      ({ state }) => useSession(state, vi.fn(), vi.fn()),
      { initialProps: { state: gridState(100) } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let sharePromise!: Promise<string>;
    act(() => { sharePromise = result.current.share(); });
    await waitFor(() => expect(mocks.saveSessionNow).toHaveBeenCalledOnce());

    rerender({ state: { ...gridState(100), loopRegion: null } });
    act(() => firstSave.resolve(true));

    await expect(sharePromise).resolves.toBe(`${window.location.origin}/s/${sessionA}`);
    expect(mocks.saveSessionNow).toHaveBeenCalledTimes(2);
    expect(mocks.saveSessionNow).toHaveBeenLastCalledWith(
      sessionA,
      expect.objectContaining({ loopRegion: null }),
    );
  });

  it('bounds transition saves when persisted edits never settle', async () => {
    const saves = [deferred<boolean>(), deferred<boolean>(), deferred<boolean>()];
    mocks.flushPendingSessionSave.mockResolvedValue(true);
    mocks.saveSessionNow
      .mockReturnValueOnce(saves[0].promise)
      .mockReturnValueOnce(saves[1].promise)
      .mockReturnValueOnce(saves[2].promise);

    const { result, rerender } = renderHook(
      ({ state }) => useSession(state, vi.fn(), vi.fn()),
      { initialProps: { state: gridState(100) } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let sharePromise!: Promise<string>;
    act(() => { sharePromise = result.current.share(); });
    for (let index = 0; index < saves.length; index += 1) {
      await waitFor(() => expect(mocks.saveSessionNow).toHaveBeenCalledTimes(index + 1));
      rerender({ state: gridState(200 + index) });
      act(() => saves[index].resolve(true));
    }

    await expect(sharePromise).rejects.toThrow('session kept changing');
    expect(mocks.saveSessionNow).toHaveBeenCalledTimes(3);
  });
});
