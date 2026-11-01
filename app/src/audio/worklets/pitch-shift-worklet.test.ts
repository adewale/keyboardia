import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PITCH_WORKLET_MAX_RATIO, PITCH_WORKLET_MIN_RATIO } from '../pitch-shift-range';

interface PortHarness {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

interface ProcessorHarness {
  port: PortHarness;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

interface ProcessorConstructor {
  new (options: AudioWorkletNodeOptions): ProcessorHarness;
  parameterDescriptors: AudioParamDescriptor[];
}

let Processor: ProcessorConstructor;

class FakeAudioWorkletProcessor {
  readonly port: PortHarness = { onmessage: null, postMessage: vi.fn() };
}

beforeAll(async () => {
  vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
  vi.stubGlobal('registerProcessor', (name: string, constructor: ProcessorConstructor) => {
    expect(name).toBe('pitch-shift-worklet');
    Processor = constructor;
  });
  await import('./pitch-shift.worklet');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('production pitch-shift worklet', () => {
  it('uses the shared clamping range in its AudioParam descriptor', () => {
    expect(Processor.parameterDescriptors).toEqual([expect.objectContaining({
      name: 'pitchRatio',
      defaultValue: 1,
      minValue: PITCH_WORKLET_MIN_RATIO,
      maxValue: PITCH_WORKLET_MAX_RATIO,
    })]);
  });

  it('processes both input channels through independent shifters', () => {
    const processor = new Processor({ processorOptions: { grainSize: 64 } });
    let leftEnergy = 0;
    let rightEnergy = 0;
    let channelDifference = 0;

    for (let block = 0; block < 12; block++) {
      const left = Float32Array.from(
        { length: 128 },
        (_, index) => Math.sin((2 * Math.PI * 440 * (block * 128 + index)) / 48_000),
      );
      const right = Float32Array.from(
        { length: 128 },
        (_, index) => Math.sin((2 * Math.PI * 880 * (block * 128 + index)) / 48_000),
      );
      const leftOutput = new Float32Array(128);
      const rightOutput = new Float32Array(128);

      expect(processor.process(
        [[left, right]],
        [[leftOutput, rightOutput]],
        { pitchRatio: Float32Array.of(1) },
      )).toBe(true);

      for (let index = 0; index < 128; index++) {
        leftEnergy += Math.abs(leftOutput[index]);
        rightEnergy += Math.abs(rightOutput[index]);
        channelDifference += Math.abs(leftOutput[index] - rightOutput[index]);
      }
    }

    expect(leftEnergy).toBeGreaterThan(1);
    expect(rightEnergy).toBeGreaterThan(1);
    expect(channelDifference).toBeGreaterThan(1);
  });
});
