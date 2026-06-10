/**
 * Grain-based pitch shifter (PSOLA-style).
 *
 * Pure, stateful, single-channel. One instance per channel keeps stereo
 * processing independent. The worklet wrapper (pitch-shift.worklet.ts)
 * owns one of these per input channel and runs them under the realtime
 * audio thread.
 *
 * Algorithm: overlap-add with Hann-windowed grains at 50% hop. Read
 * position inside each grain advances by pitchRatio samples per output
 * sample, so a ratio of 2.0 takes the grain twice as fast (up one
 * octave) while preserving the same grain cadence (no duration change).
 */

export class GrainPitchShifter {
  readonly grainSize: number;
  readonly hopSize: number;

  /**
   * Pipeline latency in samples. The first grain must be fully written
   * before meaningful output is produced, so this is one grain.
   */
  readonly latencySamples: number;

  private inputBuffer: Float32Array;
  private inputWritePos = 0;

  private outputBuffer: Float32Array;
  private outputReadPos = 0;

  private window: Float32Array;

  private samplesUntilNextGrain = 0;

  constructor(grainSize: number, bufferSize?: number) {
    this.grainSize = grainSize;
    this.hopSize = Math.floor(grainSize / 2);
    this.latencySamples = grainSize;

    const size = bufferSize ?? grainSize * 4;
    this.inputBuffer = new Float32Array(size);
    this.outputBuffer = new Float32Array(size);
    this.window = GrainPitchShifter.makeHannWindow(grainSize);
  }

  /** Feed input samples. May be called many times before a matching read. */
  write(input: Float32Array): void {
    const len = this.inputBuffer.length;
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWritePos % len] = input[i];
      this.inputWritePos++;
    }
  }

  /** Produce output samples at the given pitchRatio (0.25..4.0 typically). */
  read(output: Float32Array, pitchRatio: number): void {
    const len = this.outputBuffer.length;
    for (let i = 0; i < output.length; i++) {
      if (this.samplesUntilNextGrain <= 0) {
        this.processGrain(pitchRatio);
        this.samplesUntilNextGrain = this.hopSize;
      }
      this.samplesUntilNextGrain--;

      const idx = this.outputReadPos % len;
      output[i] = this.outputBuffer[idx];
      // Clear after reading so overlap-add accumulation stays clean.
      this.outputBuffer[idx] = 0;
      this.outputReadPos++;
    }
  }

  private processGrain(pitchRatio: number): void {
    const len = this.inputBuffer.length;
    const grainStart = this.inputWritePos - this.grainSize;
    for (let i = 0; i < this.grainSize; i++) {
      const readPos = grainStart + i * pitchRatio;
      const readIdx = Math.floor(readPos);
      const frac = readPos - readIdx;
      const idx0 = ((readIdx % len) + len) % len;
      const idx1 = (((readIdx + 1) % len) + len) % len;
      const sample = this.inputBuffer[idx0] * (1 - frac) + this.inputBuffer[idx1] * frac;
      const windowed = sample * this.window[i];
      const outIdx = ((this.outputReadPos + i) % len + len) % len;
      this.outputBuffer[outIdx] += windowed;
    }
  }

  private static makeHannWindow(size: number): Float32Array {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
  }
}
