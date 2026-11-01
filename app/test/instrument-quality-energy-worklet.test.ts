import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

type WorkletMessage = { type: string; [key: string]: unknown };

class FakeMessagePort {
  onmessage: ((event: { data: WorkletMessage }) => void) | null = null;
  readonly messages: WorkletMessage[] = [];

  postMessage(message: WorkletMessage): void {
    this.messages.push(message);
  }
}

class FakeAudioWorkletProcessor {
  readonly port = new FakeMessagePort();
}

type CapturingProcessor = FakeAudioWorkletProcessor & {
  process: (
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters?: { productionDispatchMarker: Float32Array },
  ) => boolean;
};

type CapturingProcessorConstructor = new (options: {
  processorOptions: { inputCount: number; channelCount: number; onsetThreshold: number };
}) => CapturingProcessor;

let simulatedCurrentFrame = 0;

function loadCapturingProcessor(): CapturingProcessorConstructor {
  const specPath = fileURLToPath(
    new URL('../e2e/all-instruments-master-output.spec.ts', import.meta.url),
  );
  const specSource = readFileSync(specPath, 'utf8');
  const startMarker = 'const ENERGY_WORKLET_SOURCE = String.raw`';
  const endMarker = '`;\n\ntype InstrumentType';
  const start = specSource.indexOf(startMarker);
  const end = specSource.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('Could not locate live energy worklet source');
  const workletSource = specSource.slice(start + startMarker.length, end);

  let Processor: CapturingProcessorConstructor | null = null;
  const workletGlobals = {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (_name: string, candidate: CapturingProcessorConstructor) => {
      Processor = candidate;
    },
  } as Record<string, unknown>;
  Object.defineProperty(workletGlobals, 'currentFrame', {
    get: () => simulatedCurrentFrame,
  });
  runInNewContext(workletSource, workletGlobals);
  if (Processor === null) throw new Error('Live energy worklet did not register its processor');
  return Processor;
}

const Processor = loadCapturingProcessor();

function createProcessor(channelCount = 1): CapturingProcessor {
  simulatedCurrentFrame = 0;
  return new Processor({
    processorOptions: { inputCount: 1, channelCount, onsetThreshold: 1e-7 },
  });
}

function arm(processor: CapturingProcessor, frameCount: number): void {
  processor.port.onmessage?.({ data: { type: 'arm', frameCount } });
}

function marker(...values: number[]): { productionDispatchMarker: Float32Array } {
  return { productionDispatchMarker: Float32Array.from(values) };
}

describe('live energy worklet lifecycle', () => {
  it('stays alive before asynchronous arm, then retires on the exact done quantum', () => {
    const processor = createProcessor();
    expect(processor.process([], [[new Float32Array(1)]])).toBe(true);

    arm(processor, 1);
    expect(processor.port.messages).toContainEqual({ type: 'armed', frameCount: 1 });
    simulatedCurrentFrame = 2_048;
    expect(processor.process(
      [[Float32Array.from([0.5])]],
      [[new Float32Array(1)]],
      marker(1),
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({
      type: 'done',
      capturedFrames: 1,
      outputOnsetFrame: 2_048,
      dispatchAudioFrame: 2_048,
    });
    expect(processor.process([], [[new Float32Array(1)]])).toBe(false);
  });

  it('reports the absolute audio-thread frame of the first output onset', () => {
    const processor = createProcessor();
    arm(processor, 1);
    expect(processor.process([], [[new Float32Array(128)]], marker(0))).toBe(true);
    simulatedCurrentFrame = 128;
    expect(processor.process(
      [[Float32Array.from([0, 0.5])]],
      [[new Float32Array(2)]],
      marker(0, 1),
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({
      type: 'done',
      outputOnsetFrame: 129,
      dispatchAudioFrame: 129,
    });
  });

  it('retains an onset that precedes the first production-dispatch marker', () => {
    const processor = createProcessor();
    arm(processor, 2);
    expect(processor.process(
      [[Float32Array.from([0.5])]],
      [[new Float32Array(1)]],
      marker(0),
    )).toBe(true);
    simulatedCurrentFrame = 1;
    expect(processor.process(
      [[Float32Array.from([0.25])]],
      [[new Float32Array(1)]],
      marker(1),
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({
      type: 'done',
      outputOnsetFrame: 0,
      dispatchAudioFrame: 1,
    });
  });

  it('fails closed when capture completes without a production-dispatch marker', () => {
    const processor = createProcessor();
    arm(processor, 1);
    expect(processor.process(
      [[Float32Array.from([0.5])]],
      [[new Float32Array(1)]],
      marker(0),
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({
      type: 'error',
      message: 'continuous energy capture observed no production dispatch marker',
    });
  });

  it('retires after an invalid arm instead of remaining a permanent live node', () => {
    const processor = createProcessor();
    arm(processor, 0);
    expect(processor.port.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(processor.process([], [[new Float32Array(1)]])).toBe(false);
  });

  it('returns false on the render quantum that reports a missing output', () => {
    const processor = createProcessor();
    arm(processor, 1);
    expect(processor.process([], [])).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(processor.process([], [[new Float32Array(1)]])).toBe(false);
  });

  it('returns false on the render quantum that reports a channel-count mismatch', () => {
    const processor = createProcessor(2);
    arm(processor, 1);
    expect(processor.process(
      [[Float32Array.from([0.5])]],
      [[new Float32Array(1)]],
      marker(1),
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(processor.process([], [[new Float32Array(1)]])).toBe(false);
  });

  it('returns false on the render quantum that reports an incomplete channel', () => {
    const processor = createProcessor();
    arm(processor, 2);
    expect(processor.process(
      [[Float32Array.from([0.5])]],
      [[new Float32Array(2)]],
      marker(1),
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(processor.process([], [[new Float32Array(1)]])).toBe(false);
  });
});
