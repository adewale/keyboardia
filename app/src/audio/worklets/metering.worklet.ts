/**
 * Track Metering AudioWorklet Processor
 *
 * Computes per-track RMS, peak, and clipping detection at audio rate.
 * Sends results to the main thread at ~60Hz for UI display.
 *
 * Each input corresponds to one track bus. Supports up to 16 tracks.
 */

// ─── Types ───────────────────────────────────────────────────────────────

interface MeterLevel {
  trackIndex: number;
  rms: number;
  peak: number;
  clipping: boolean;
}

interface MeterData {
  type: 'meters';
  levels: MeterLevel[];
  timestamp: number;
}

// ─── Processor ───────────────────────────────────────────────────────────

class MeteringWorkletProcessor extends AudioWorkletProcessor {
  private trackCount: number;
  private sendInterval: number;  // samples between sends
  private samplesSinceLastSend = 0;
  private sampleCounts: Uint32Array;  // per-track sample count

  // Accumulated values between sends
  private sumSquares: Float64Array;
  private peaks: Float64Array;
  private clipping: Uint8Array;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.trackCount = options.processorOptions?.trackCount ?? 16;
    // ~60Hz update rate: sampleRate / 60
    this.sendInterval = Math.floor(sampleRate / 60);

    this.sumSquares = new Float64Array(this.trackCount);
    this.peaks = new Float64Array(this.trackCount);
    this.clipping = new Uint8Array(this.trackCount);
    this.sampleCounts = new Uint32Array(this.trackCount);

    this.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'setTrackCount') {
        this.trackCount = e.data.count;
        this.resetAccumulators();
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const inputCount = Math.min(inputs.length, this.trackCount);

    for (let t = 0; t < inputCount; t++) {
      const input = inputs[t];
      if (!input || input.length === 0 || !input[0]) continue;

      const channel = input[0]; // mono analysis
      this.sampleCounts[t] += channel.length;  // per-track count
      for (let i = 0; i < channel.length; i++) {
        const sample = channel[i];
        const abs = Math.abs(sample);
        this.sumSquares[t] += sample * sample;
        if (abs > this.peaks[t]) this.peaks[t] = abs;
        if (abs > 1.0) this.clipping[t] = 1;
      }
    }

    // Use actual block size from input (typically 128 but not guaranteed by spec)
    this.samplesSinceLastSend += (inputs[0]?.[0]?.length) ?? 128;

    if (this.samplesSinceLastSend >= this.sendInterval) {
      this.sendMeters();
      this.samplesSinceLastSend = 0;
    }

    return true;
  }

  private sendMeters(): void {
    const levels: MeterLevel[] = [];

    for (let t = 0; t < this.trackCount; t++) {
      // Only send tracks that have had audio
      if (this.sumSquares[t] === 0 && this.peaks[t] === 0) continue;

      const rms = this.sampleCounts[t] > 0
        ? Math.sqrt(this.sumSquares[t] / this.sampleCounts[t])
        : 0;

      levels.push({
        trackIndex: t,
        rms,
        peak: this.peaks[t],
        clipping: this.clipping[t] === 1,
      });
    }

    if (levels.length > 0) {
      this.port.postMessage({
        type: 'meters',
        levels,
        timestamp: currentTime,
      } satisfies MeterData);
    }

    this.resetAccumulators();
  }

  private resetAccumulators(): void {
    this.sumSquares = new Float64Array(this.trackCount);
    this.peaks = new Float64Array(this.trackCount);
    this.clipping = new Uint8Array(this.trackCount);
    this.sampleCounts = new Uint32Array(this.trackCount);
  }
}

registerProcessor('metering-worklet', MeteringWorkletProcessor);
