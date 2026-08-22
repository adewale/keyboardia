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
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};

type CapturingProcessorConstructor = new (options: {
  processorOptions: { inputCount: number; channelCount: number; onsetThreshold: number };
}) => CapturingProcessor;

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
  runInNewContext(workletSource, {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (_name: string, candidate: CapturingProcessorConstructor) => {
      Processor = candidate;
    },
  });
  if (Processor === null) throw new Error('Live energy worklet did not register its processor');
  return Processor;
}

const Processor = loadCapturingProcessor();

function createProcessor(channelCount = 1): CapturingProcessor {
  return new Processor({
    processorOptions: { inputCount: 1, channelCount, onsetThreshold: 1e-7 },
  });
}

function arm(processor: CapturingProcessor, frameCount: number): void {
  processor.port.onmessage?.({ data: { type: 'arm', frameCount } });
}

describe('live energy worklet lifecycle', () => {
  it('stays alive before asynchronous arm, then retires on the exact done quantum', () => {
    const processor = createProcessor();
    expect(processor.process([], [[new Float32Array(1)]])).toBe(true);

    arm(processor, 1);
    expect(processor.port.messages).toContainEqual({ type: 'armed', frameCount: 1 });
    expect(processor.process(
      [[Float32Array.from([0.5])]],
      [[new Float32Array(1)]],
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({
      type: 'done',
      capturedFrames: 1,
    });
    expect(processor.process([], [[new Float32Array(1)]])).toBe(false);
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
    )).toBe(false);
    expect(processor.port.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(processor.process([], [[new Float32Array(1)]])).toBe(false);
  });
});
