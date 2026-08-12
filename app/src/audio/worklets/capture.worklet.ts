/** Clock-synchronized, bounded PCM capture for the three master-bus taps. */

interface ArmMessage {
  type: 'arm';
  startFrame: number;
  frameCount: number;
}

interface StopMessage {
  type: 'stop';
}

declare const currentFrame: number;

class CaptureWorkletProcessor extends AudioWorkletProcessor {
  private startFrame = 0;
  private frameCount = 0;
  private capturedFrames = 0;
  private armed = false;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    this.port.onmessage = (event: MessageEvent<ArmMessage | StopMessage>) => {
      if (event.data.type === 'arm') {
        this.startFrame = Math.max(currentFrame, Math.floor(event.data.startFrame));
        this.frameCount = Math.max(0, Math.floor(event.data.frameCount));
        this.capturedFrames = 0;
        this.armed = this.frameCount > 0;
        this.port.postMessage({
          type: 'armed',
          startFrame: this.startFrame,
          frameCount: this.frameCount,
        });
      } else {
        this.finish('stopped');
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.armed) return true;
    const quantumFrames = inputs.find(input => input[0]?.length)?.[0].length ?? 128;
    const quantumStart = currentFrame;
    const quantumEnd = quantumStart + quantumFrames;
    if (quantumEnd <= this.startFrame) return true;

    // Render callbacks are sequential PCM even when Chromium repeats or skips
    // the diagnostic `currentFrame` value under main-thread pressure. Advance
    // the armed capture by frames actually received so the transferable chunks
    // stay contiguous; keep renderFrame as a drift diagnostic.
    const sourceOffset = this.capturedFrames === 0
      ? Math.max(0, this.startFrame - quantumStart)
      : 0;
    const length = Math.min(
      quantumFrames - sourceOffset,
      this.frameCount - this.capturedFrames,
    );
    if (length <= 0) return true;
    const captureOffset = this.capturedFrames;
    const captureStart = this.startFrame + captureOffset;
    const taps = inputs.map(input => {
      const inputChannels = input.length > 0 ? input : [new Float32Array(quantumFrames)];
      const channels = inputChannels.map(channel => channel.slice(sourceOffset, sourceOffset + length));
      return channels.map(channel => channel.buffer);
    });
    const transfer = taps.flat();
    this.port.postMessage({
      type: 'chunk',
      absoluteFrame: captureStart,
      renderFrame: quantumStart + sourceOffset,
      captureOffset,
      frameCount: length,
      taps,
    }, transfer);
    this.capturedFrames += length;

    if (this.capturedFrames >= this.frameCount) this.finish('complete');
    return true;
  }

  private finish(reason: 'complete' | 'stopped'): void {
    if (!this.armed && reason === 'stopped') return;
    this.armed = false;
    this.port.postMessage({
      type: 'done',
      reason,
      startFrame: this.startFrame,
      frameCount: this.frameCount,
      capturedFrames: this.capturedFrames,
    });
  }
}

registerProcessor('capture-worklet', CaptureWorkletProcessor);
