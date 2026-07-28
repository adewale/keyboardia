import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkletSchedulerState } from '../scheduler-types';

interface PortHarness {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

interface ProcessorHarness {
  port: PortHarness;
  process(): boolean;
}

type ProcessorConstructor = new () => ProcessorHarness;

let Processor: ProcessorConstructor;

class FakeAudioWorkletProcessor {
  readonly port: PortHarness = {
    onmessage: null,
    postMessage: vi.fn(),
  };
}

function state(overrides: Partial<WorkletSchedulerState> = {}): WorkletSchedulerState {
  return {
    tempo: 120,
    swing: 0,
    tracks: [],
    loopRegion: null,
    maxSteps: 128,
    defaultStepCount: 16,
    ...overrides,
  };
}

function start(
  processor: ProcessorHarness,
  schedulerState: WorkletSchedulerState,
  initialStep?: number,
): void {
  processor.port.onmessage?.({
    data: {
      type: 'start',
      state: schedulerState,
      startTime: 0,
      initialStep,
    },
  } as MessageEvent);
}

beforeAll(async () => {
  vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
  vi.stubGlobal('currentTime', 0);
  vi.stubGlobal('registerProcessor', (name: string, constructor: ProcessorConstructor) => {
    expect(name).toBe('scheduler-worklet');
    Processor = constructor;
  });

  await import('./scheduler.worklet');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('production scheduler worklet', () => {
  it('runs the inclusive loop region used by GridState', () => {
    const processor = new Processor();
    start(processor, state({ loopRegion: { start: 4, end: 5 } }));

    expect(processor.process()).toBe(true);
    const steps = processor.port.postMessage.mock.calls
      .map(([event]) => event as { type: string; step?: number })
      .filter((event) => event.type === 'step')
      .map((event) => event.step);

    expect(steps).toEqual([4, 5]);
  });

  it('emits production swing and tied-note timing', () => {
    const processor = new Processor();
    const steps = new Array(128).fill(false) as boolean[];
    const parameterLocks = new Array(128).fill(null) as ({ tie?: boolean } | null)[];
    steps[1] = true;
    steps[2] = true;
    parameterLocks[2] = { tie: true };

    start(processor, state({
      swing: 50,
      tracks: [{
        id: 'track-1',
        sampleId: 'kick',
        steps,
        stepCount: 16,
        muted: false,
        soloed: false,
        transpose: 0,
        swing: 0,
        parameterLocks,
      }],
    }), 1);

    processor.process();
    const notes = processor.port.postMessage.mock.calls
      .map(([event]) => event as { type: string; time?: number; duration?: number })
      .filter((event) => event.type === 'note');

    expect(notes).toHaveLength(1);
    expect(notes[0]?.time).toBeCloseTo(0.03125, 8);
    expect(notes[0]?.duration).toBeCloseTo(0.225, 8);
  });
});
