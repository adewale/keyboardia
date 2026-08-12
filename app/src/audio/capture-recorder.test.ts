// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadWorkletModule } = vi.hoisted(() => ({ loadWorkletModule: vi.fn(async () => true) }));
vi.mock('./worklet-support', () => ({ loadWorkletModule }));
vi.mock('./worklets/capture.worklet.ts?worker&url', () => ({ default: '/capture-worklet.js' }));

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn((message: { type: string; startFrame?: number; frameCount?: number }) => {
    if (message.type !== 'arm') return;
    queueMicrotask(() => {
      const taps = Array.from({ length: 3 }, (_, tap) => [
        Float32Array.from({ length: message.frameCount! }, () => tap + 1).buffer,
      ]);
      this.onmessage?.({ data: {
        type: 'chunk',
        absoluteFrame: message.startFrame,
        renderFrame: message.startFrame,
        captureOffset: 0,
        frameCount: message.frameCount,
        taps,
      } } as MessageEvent);
      this.onmessage?.({ data: {
        type: 'done',
        reason: 'complete',
        startFrame: message.startFrame,
        frameCount: message.frameCount,
        capturedFrames: message.frameCount,
      } } as MessageEvent);
    });
  });
}

class FakeWorkletNode {
  port = new FakePort();
  connect = vi.fn();
  disconnect = vi.fn();
}

function node(context: AudioContext): AudioNode {
  return {
    context,
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioNode;
}

describe('MasterCaptureRecorder', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  });

  it('arms all taps on one frame range and returns equal synchronized lengths', async () => {
    const { MasterCaptureRecorder } = await import('./capture-recorder');
    const context = {
      sampleRate: 48_000,
      currentTime: 1,
      audioWorklet: { addModule: vi.fn() },
      destination: {},
      createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
    } as unknown as AudioContext;
    const recorder = new MasterCaptureRecorder();
    await recorder.initialize(context);
    const capture = await recorder.capture({
      preCompressor: node(context),
      postMakeup: node(context),
      userOutput: node(context),
    }, 0.01, 0);

    expect(capture.startFrame % 128).toBe(0);
    expect(capture.frameCount).toBe(480);
    expect(capture.maxRenderFrameDrift).toBe(0);
    expect(capture.taps.preCompressor.channels[0]).toHaveLength(480);
    expect(capture.taps.postMakeup.channels[0]).toHaveLength(480);
    expect(capture.taps.userOutput.channels[0]).toHaveLength(480);
    expect(capture.taps.preCompressor.channels[0][0]).toBe(1);
    expect(capture.taps.postMakeup.channels[0][0]).toBe(2);
    expect(capture.taps.userOutput.channels[0][0]).toBe(3);
  });
});
