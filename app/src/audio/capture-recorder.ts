import captureWorkletUrl from './worklets/capture.worklet.ts?worker&url';
import { loadWorkletModule } from './worklet-support';

export const MASTER_CAPTURE_TAP_NAMES = ['preCompressor', 'postMakeup', 'userOutput'] as const;
export type MasterCaptureTapName = typeof MASTER_CAPTURE_TAP_NAMES[number];

export interface MasterCaptureTapNodes {
  preCompressor: AudioNode;
  postMakeup: AudioNode;
  userOutput: AudioNode;
}

export interface CapturedTap {
  channels: Float32Array[];
}

export interface MasterCapture {
  sampleRate: number;
  startFrame: number;
  frameCount: number;
  maxRenderFrameDrift: number;
  taps: Record<MasterCaptureTapName, CapturedTap>;
}

interface CaptureChunkMessage {
  type: 'chunk';
  absoluteFrame: number;
  renderFrame: number;
  captureOffset: number;
  frameCount: number;
  taps: Array<ArrayBuffer[]>;
}

interface CaptureDoneMessage {
  type: 'done';
  reason: 'complete' | 'stopped';
  startFrame: number;
  frameCount: number;
  capturedFrames: number;
}

type CaptureMessage = CaptureChunkMessage | CaptureDoneMessage | {
  type: 'armed';
  startFrame: number;
  frameCount: number;
};

export class MasterCaptureRecorder {
  private node: AudioWorkletNode | null = null;
  private context: AudioContext | null = null;
  private connectedNodes: AudioNode[] = [];
  private keepAlive: GainNode | null = null;

  async initialize(context: AudioContext): Promise<void> {
    if (this.node && this.context === context) return;
    if (this.node) this.dispose();
    const loaded = await loadWorkletModule(context, captureWorkletUrl, 'capture-worklet');
    if (!loaded) throw new Error('Master capture requires AudioWorklet support');
    this.context = context;
    this.node = new AudioWorkletNode(context, 'capture-worklet', {
      numberOfInputs: MASTER_CAPTURE_TAP_NAMES.length,
      // A silent pulled output prevents Chromium from suspending a zero-output
      // worklet during silent gaps, which otherwise leaves holes in the
      // absolute-frame capture timeline.
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
    });
    this.keepAlive = context.createGain();
    this.keepAlive.gain.value = 0;
    this.node.connect(this.keepAlive);
    this.keepAlive.connect(context.destination);
  }

  async capture(
    nodes: MasterCaptureTapNodes,
    seconds: number,
    leadSeconds = 0.05,
  ): Promise<MasterCapture> {
    if (!this.context) {
      const context = nodes.preCompressor.context as AudioContext;
      await this.initialize(context);
    }
    if (!this.context || !this.node) throw new Error('Capture recorder is not initialized');
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Capture duration must be positive');

    this.disconnectTaps();
    this.connectedNodes = MASTER_CAPTURE_TAP_NAMES.map(name => nodes[name]);
    this.connectedNodes.forEach((source, index) => source.connect(this.node!, 0, index));

    const frameCount = Math.max(1, Math.round(seconds * this.context.sampleRate));
    const requestedStart = Math.ceil((this.context.currentTime + leadSeconds) * this.context.sampleRate);
    const startFrame = Math.ceil(requestedStart / 128) * 128;
    const chunks: CaptureChunkMessage[] = [];

    return new Promise<MasterCapture>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.node?.port.postMessage({ type: 'stop' });
        this.disconnectTaps();
        reject(new Error(`Master capture timed out after ${seconds + leadSeconds + 5}s`));
      }, (seconds + leadSeconds + 5) * 1_000);

      this.node!.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
        if (event.data.type === 'chunk') {
          chunks.push(event.data);
          return;
        }
        if (event.data.type !== 'done') return;
        window.clearTimeout(timeout);
        this.disconnectTaps();
        if (event.data.reason !== 'complete' || event.data.capturedFrames !== frameCount) {
          reject(new Error(
            `Incomplete master capture: ${event.data.capturedFrames}/${frameCount} frames (${event.data.reason})`,
          ));
          return;
        }
        try {
          resolve(assembleCapture(this.context!.sampleRate, startFrame, frameCount, chunks));
        } catch (error) {
          reject(error);
        }
      };
      this.node!.port.postMessage({ type: 'arm', startFrame, frameCount });
    });
  }

  stop(): void {
    this.node?.port.postMessage({ type: 'stop' });
  }

  dispose(): void {
    this.stop();
    this.disconnectTaps();
    this.node?.disconnect();
    this.keepAlive?.disconnect();
    this.keepAlive = null;
    this.node = null;
    this.context = null;
  }

  private disconnectTaps(): void {
    if (!this.node) return;
    this.connectedNodes.forEach((source, index) => {
      try {
        source.disconnect(this.node!, 0, index);
      } catch {
        // The graph may already have been torn down by engine shutdown.
      }
    });
    this.connectedNodes = [];
  }
}

function assembleCapture(
  sampleRate: number,
  startFrame: number,
  frameCount: number,
  chunks: readonly CaptureChunkMessage[],
): MasterCapture {
  const channelCounts = MASTER_CAPTURE_TAP_NAMES.map((_, tapIndex) =>
    Math.max(1, ...chunks.map(chunk => chunk.taps[tapIndex]?.length ?? 0))
  );
  const tapChannels = channelCounts.map(count =>
    Array.from({ length: count }, () => new Float32Array(frameCount))
  );
  const coverage = new Uint8Array(frameCount);
  let maxRenderFrameDrift = 0;

  for (const chunk of chunks) {
    maxRenderFrameDrift = Math.max(
      maxRenderFrameDrift,
      Math.abs(chunk.renderFrame - chunk.absoluteFrame),
    );
    if (chunk.absoluteFrame !== startFrame + chunk.captureOffset) {
      throw new Error('Capture chunk absolute-frame stamp does not match its offset');
    }
    if (chunk.captureOffset < 0 || chunk.captureOffset + chunk.frameCount > frameCount) {
      throw new Error('Capture chunk lies outside the armed frame range');
    }
    coverage.fill(1, chunk.captureOffset, chunk.captureOffset + chunk.frameCount);
    chunk.taps.forEach((tap, tapIndex) => {
      tap.forEach((buffer, channelIndex) => {
        tapChannels[tapIndex][channelIndex].set(new Float32Array(buffer), chunk.captureOffset);
      });
    });
  }
  const firstMissing = coverage.findIndex(value => value === 0);
  if (firstMissing >= 0) {
    throw new Error(
      `Capture has missing render frames at offset ${firstMissing}; `
      + `${chunks.length} chunks covered ${coverage.reduce((sum, value) => sum + value, 0)}/${frameCount}`,
    );
  }

  return {
    sampleRate,
    startFrame,
    frameCount,
    maxRenderFrameDrift,
    taps: Object.fromEntries(MASTER_CAPTURE_TAP_NAMES.map((name, index) => [
      name,
      { channels: tapChannels[index] },
    ])) as Record<MasterCaptureTapName, CapturedTap>,
  };
}
