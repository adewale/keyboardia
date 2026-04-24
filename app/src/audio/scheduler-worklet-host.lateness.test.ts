/**
 * Integration test: confirms the end-to-end lateness pipeline works.
 *
 * When the worklet posts a 'note' event whose `event.time` has already
 * passed by the moment the host receives it, the host must
 *   (a) record the absolute lateness as a jitter sample, and
 *   (b) increment the late-note counter.
 *
 * Without these, the metrics panel shows misleadingly low jitter while
 * notes are in fact being clamped by `Math.max(time, currentTime)` in
 * the audio engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The host unconditionally imports the real audioEngine at module load.
// Stub it so the test environment doesn't need a live audio graph.
vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
    playSample: vi.fn(),
    playSynthNote: vi.fn(),
    playSampledInstrument: vi.fn(),
    playToneSynth: vi.fn(),
    playAdvancedSynth: vi.fn(),
    isSampledInstrumentReady: () => true,
    isToneSynthReady: () => true,
    setTrackVolume: vi.fn(),
  },
}));

import { SchedulerWorkletHost } from './scheduler-worklet-host';
import { audioMetrics } from './metrics/audio-metrics';
import type { GridState } from '../types';

function makeState(): GridState {
  return {
    tempo: 120,
    swing: 0,
    tracks: [],
    loopRegion: null,
  } as unknown as GridState;
}

function dispatchTo(host: SchedulerWorkletHost, event: unknown) {
  (host as unknown as { handleEvent: (e: unknown) => void }).handleEvent(event);
}

describe('SchedulerWorkletHost lateness metrics', () => {
  let host: SchedulerWorkletHost;
  let mockCtx: { currentTime: number };

  beforeEach(() => {
    audioMetrics.reset();
    audioMetrics.setSampleRate(1); // record every sample

    host = new SchedulerWorkletHost();
    mockCtx = { currentTime: 10.0 };
    (host as unknown as { node: unknown }).node = {
      port: { postMessage: vi.fn(), onmessage: null },
    };
    (host as unknown as { audioContext: unknown }).audioContext = mockCtx;
    host.start(makeState);
  });

  function sampleNoteEvent(eventTime: number) {
    return {
      type: 'note',
      trackId: 't1',
      noteId: 'n1',
      sampleId: 'sample:kick',
      pitchSemitones: 0,
      time: eventTime,
      duration: 0.1,
      volume: 1,
      volumeMultiplier: 1,
    };
  }

  it('records zero late notes when events arrive with lead time', () => {
    mockCtx.currentTime = 10.0;
    dispatchTo(host, sampleNoteEvent(10.05));
    dispatchTo(host, sampleNoteEvent(10.1));

    const snap = audioMetrics.getSnapshot();
    expect(snap.scheduler.lateNoteCount).toBe(0);
    expect(snap.scheduler.samples).toBe(2);
    // Both samples were 50ms and 100ms early → |lateness| = 50 and 100ms.
    expect(snap.scheduler.max).toBeCloseTo(100, 0);
  });

  it('increments late-note counter when events arrive after their intended time', () => {
    mockCtx.currentTime = 10.2;
    dispatchTo(host, sampleNoteEvent(10.0)); // 200ms late
    dispatchTo(host, sampleNoteEvent(10.1)); // 100ms late

    const snap = audioMetrics.getSnapshot();
    expect(snap.scheduler.lateNoteCount).toBe(2);
    expect(snap.scheduler.max).toBeCloseTo(200, 0);
  });

  it('records absolute lateness regardless of direction', () => {
    mockCtx.currentTime = 10.05;
    dispatchTo(host, sampleNoteEvent(10.0));  // 50ms late
    dispatchTo(host, sampleNoteEvent(10.1));  // 50ms early

    const snap = audioMetrics.getSnapshot();
    expect(snap.scheduler.lateNoteCount).toBe(1); // only the late one
    expect(snap.scheduler.samples).toBe(2);
    // p50 of two 50ms samples
    expect(snap.scheduler.p50).toBeCloseTo(50, 0);
  });
});
