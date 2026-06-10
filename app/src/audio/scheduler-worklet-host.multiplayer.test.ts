// @vitest-environment jsdom
/**
 * Integration test: SchedulerWorkletHost must forward multiplayer timing
 * (serverStartTime and current server time) to the worklet so that a
 * client joining an already-playing session aligns to the shared clock.
 *
 * We sidestep AudioWorkletNode (not available in jsdom) by injecting a
 * mock node whose `port.postMessage` we can inspect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The host imports audioEngine at module load. Stub out the surface it
// touches during start() so the test can run without a real audio graph.
vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
  },
}));

import { SchedulerWorkletHost } from './scheduler-worklet-host';
import type { GridState } from '../types';

function makeBlankState(): GridState {
  return {
    tempo: 120,
    swing: 0,
    tracks: [],
    loopRegion: null,
    // The rest of GridState fields aren't read by host.start/serializeState
    // for our purposes; cast through unknown to satisfy the structural type.
  } as unknown as GridState;
}

describe('SchedulerWorkletHost — multiplayer start', () => {
  let host: SchedulerWorkletHost;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = new SchedulerWorkletHost();
    postMessage = vi.fn();

    // Inject mocks for internals that normally require a real audio graph.
    const mockNode = { port: { postMessage, onmessage: null } };
    const mockCtx = { currentTime: 100.0 };
    (host as unknown as { node: unknown }).node = mockNode;
    (host as unknown as { audioContext: unknown }).audioContext = mockCtx;
  });

  it('passes initialStep=0 and initialNextStepTime=startTime when not in multiplayer', () => {
    host.start(makeBlankState);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = postMessage.mock.calls[0][0];
    expect(msg.type).toBe('start');
    expect(msg.initialStep).toBe(0);
    expect(msg.initialNextStepTime).toBe(100.0);
    expect(msg.multiplayer).toBe(false);
  });

  it('forwards computed join offset (exact-boundary) when multiplayer + serverStartTime are provided', () => {
    // serverStartTime=1000, currentServerTime=1250 → elapsed 250ms.
    // At 120 BPM, stepDuration=125ms → exactly 2 steps. Boundary case:
    // step 2 plays at audioStartTime (now), no further offset.
    host.setMultiplayerMode(true, () => 1250);
    host.start(makeBlankState, 1000);

    const msg = postMessage.mock.calls[0][0];
    expect(msg.multiplayer).toBe(true);
    expect(msg.initialStep).toBe(2);
    expect(msg.initialNextStepTime).toBe(100.0);
  });

  it('forwards mid-step join — schedules the next step at the upcoming boundary', () => {
    // serverStartTime=1000, currentServerTime=1075 → elapsed 75ms (mid step 0).
    // Next step is 1, at audioStartTime + (125 - 75) = 100.05.
    host.setMultiplayerMode(true, () => 1075);
    host.start(makeBlankState, 1000);

    const msg = postMessage.mock.calls[0][0];
    expect(msg.initialStep).toBe(1);
    expect(msg.initialNextStepTime).toBeCloseTo(100.05, 5);
  });

  it('falls back to fresh-start offsets when client is "ahead" of server', () => {
    host.setMultiplayerMode(true, () => 900); // before serverStartTime
    host.start(makeBlankState, 1000);

    const msg = postMessage.mock.calls[0][0];
    expect(msg.multiplayer).toBe(true);
    expect(msg.initialStep).toBe(0);
    expect(msg.initialNextStepTime).toBe(100.0);
  });
});