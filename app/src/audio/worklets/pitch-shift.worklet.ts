/**
 * Pitch-Shifting AudioWorklet Processor (Granular PSOLA)
 *
 * Shifts pitch without changing duration using overlap-add granular synthesis.
 * Used for sampled instruments when pitch shift exceeds ±6 semitones,
 * where native playbackRate artifacts become noticeable.
 *
 * Algorithm: Granular pitch shifting with Hann-windowed overlap-add.
 * - Input audio is segmented into overlapping grains
 * - Grains are resampled at the pitch ratio (linear interpolation)
 * - Grains are windowed and overlap-added for smooth output
 */

// ─── Processor ───────────────────────────────────────────────────────────

class PitchShiftWorkletProcessor extends AudioWorkletProcessor {
  // Grain parameters
  private grainSize: number;
  private hopSize: number;

  // Circular input buffer (2x grain size for safe reading)
  private inputBuffer: Float32Array;
  private inputWritePos = 0;

  // Output accumulation buffer
  private outputBuffer: Float32Array;
  private outputReadPos = 0;

  // Grain window (Hann)
  private window: Float32Array;

  // Phase accumulator for resampled read position
  private grainPhase = 0;
  private samplesUntilNextGrain = 0;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      {
        name: 'pitchRatio',
        defaultValue: 1.0,
        minValue: 0.25,  // -24 semitones
        maxValue: 4.0,   // +24 semitones
        automationRate: 'k-rate',
      },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.grainSize = options.processorOptions?.grainSize ?? 1024;
    this.hopSize = Math.floor(this.grainSize / 2); // 50% overlap

    const bufferSize = this.grainSize * 4;
    this.inputBuffer = new Float32Array(bufferSize);
    this.outputBuffer = new Float32Array(bufferSize);
    this.window = this.createHannWindow(this.grainSize);

    this.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'setGrainSize') {
        this.grainSize = e.data.size;
        this.hopSize = Math.floor(this.grainSize / 2);
        this.window = this.createHannWindow(this.grainSize);
      }
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const pitchRatio = parameters.pitchRatio[0];
    const bufLen = this.inputBuffer.length;

    // Write input to circular buffer
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWritePos % bufLen] = input[i];
      this.inputWritePos++;
    }

    // Process grains
    for (let i = 0; i < output.length; i++) {
      // Check if it's time to spawn a new grain
      if (this.samplesUntilNextGrain <= 0) {
        this.processGrain(pitchRatio);
        this.samplesUntilNextGrain = this.hopSize;
      }
      this.samplesUntilNextGrain--;

      // Read from output buffer
      output[i] = this.outputBuffer[this.outputReadPos % bufLen];
      // Clear after reading (for accumulation of next grains)
      this.outputBuffer[this.outputReadPos % bufLen] = 0;
      this.outputReadPos++;
    }

    return true;
  }

  /**
   * Process one grain: read from input, resample, window, and accumulate to output.
   */
  private processGrain(pitchRatio: number): void {
    const bufLen = this.inputBuffer.length;
    const grainStart = this.inputWritePos - this.grainSize;

    for (let i = 0; i < this.grainSize; i++) {
      // Read position in input (resampled by pitch ratio)
      const readPos = grainStart + i * pitchRatio;
      const readIdx = Math.floor(readPos);
      const frac = readPos - readIdx;

      // Linear interpolation from circular input buffer
      const idx0 = ((readIdx % bufLen) + bufLen) % bufLen;
      const idx1 = ((readIdx + 1) % bufLen + bufLen) % bufLen;
      const sample = this.inputBuffer[idx0] * (1 - frac) + this.inputBuffer[idx1] * frac;

      // Apply Hann window and accumulate to output
      const windowed = sample * this.window[i];
      const outIdx = ((this.outputReadPos + i) % bufLen + bufLen) % bufLen;
      this.outputBuffer[outIdx] += windowed;
    }
  }

  private createHannWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }
}

registerProcessor('pitch-shift-worklet', PitchShiftWorkletProcessor);
