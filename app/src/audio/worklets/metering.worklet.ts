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
  // Per-track accumulated values between sends
  private sumSquares: Float64Array;
  private sampleCounts: Uint32Array;
  private peaks: Float64Array;
  private clipping: Uint8Array;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.trackCount = options.processorOptions?.trackCount ?? 16;
    // ~60Hz update rate: sampleRate / 60
    this.sendInterval = Math.floor(sampleRate / 60);

    this.sumSquares = new Float64Array(this.trackCount);
    this.sampleCounts = new Uint32Array(this.trackCount);
    this.peaks = new Float64Array(this.trackCount);
    this.clipping = new Uint8Array(this.trackCount);

    this.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'setTrackCount') {
        this.trackCount = e.data.count;
        this.resetAccumulators();
      } else if (e.data.type === 'resetSlot') {
        // Host frees a slot index for reuse — wipe its accumulators so the
        // next track to occupy this slot doesn't see one frame of stale
        // data on its first sendMeters tick (bug_008).
        const i = e.data.index as number;
        if (i >= 0 && i < this.trackCount) {
          this.sumSquares[i] = 0;
          this.sampleCounts[i] = 0;
          this.peaks[i] = 0;
          this.clipping[i] = 0;
        }
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const inputCount = Math.min(inputs.length, this.trackCount);

    for (let t = 0; t < inputCount; t++) {
      const input = inputs[t];
      if (!input || input.length === 0 || !input[0]) continue;

      const channel = input[0]; // mono analysis
      this.sampleCounts[t] += channel.length;
      for (let i = 0; i < channel.length; i++) {
        const sample = channel[i];
        const abs = Math.abs(sample);
        this.sumSquares[t] += sample * sample;
        if (abs > this.peaks[t]) this.peaks[t] = abs;
        if (abs > 1.0) this.clipping[t] = 1;
      }
    }

    // Use actual block size from input (typically 128 but not guaranteed by spec)
    const blockSize = (inputs[0]?.[0]?.length) ?? 128;
    this.samplesSinceLastSend += blockSize;

    if (this.samplesSinceLastSend >= this.sendInterval) {
      this.sendMeters();
      this.samplesSinceLastSend = 0;
    }

    return true;
  }

  private sendMeters(): void {
    // Emit every slot, including silent ones (bug_001). Skipping silent
    // slots used to leave the host with a stale non-zero entry forever,
    // freezing the meter bar when a track went quiet. The bandwidth cost
    // of always sending 16 small entries at ~60Hz is negligible (~50KB/s).
    const levels: MeterLevel[] = new Array(this.trackCount);
    for (let t = 0; t < this.trackCount; t++) {
      const count = this.sampleCounts[t];
      const rms = count > 0
        ? Math.sqrt(this.sumSquares[t] / count)
        : 0;
      levels[t] = {
        trackIndex: t,
        rms,
        peak: this.peaks[t],
        clipping: this.clipping[t] === 1,
      };
    }

    this.port.postMessage({
      type: 'meters',
      levels,
      timestamp: currentTime,
    } satisfies MeterData);

    this.resetAccumulators();
  }

  private resetAccumulators(): void {
    this.sumSquares = new Float64Array(this.trackCount);
    this.sampleCounts = new Uint32Array(this.trackCount);
    this.peaks = new Float64Array(this.trackCount);
    this.clipping = new Uint8Array(this.trackCount);
  }
}

registerProcessor('metering-worklet', MeteringWorkletProcessor);
