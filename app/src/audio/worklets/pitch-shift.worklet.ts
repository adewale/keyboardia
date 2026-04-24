/**
 * Pitch-Shifting AudioWorklet Processor (Granular PSOLA).
 *
 * Shifts pitch without changing duration using Hann-windowed overlap-add
 * granular synthesis. Used for sampled instruments when pitch shift
 * exceeds ±6 semitones, where native playbackRate artifacts are audible.
 *
 * Stereo: each input channel gets its own independent GrainPitchShifter.
 * The number of channels is locked in at `start()` using the options.
 *
 * Latency: one grain (grainSize samples). The engine compensates by
 * delaying the envGain ramp in playSample() by grainSize/sampleRate.
 *
 * ─────────────────────────────────────────────────────────────────────
 * KEEP IN SYNC with pitch-shift-engine.ts, which is the canonical,
 * unit-tested version of the algorithm. Worklet files cannot import app
 * modules because the AudioWorklet bundler treats each file standalone.
 * ─────────────────────────────────────────────────────────────────────
 */

class GrainPitchShifter {
  readonly grainSize: number;
  readonly hopSize: number;
  private inputBuffer: Float32Array;
  private inputWritePos = 0;
  private outputBuffer: Float32Array;
  private outputReadPos = 0;
  private window: Float32Array;
  private samplesUntilNextGrain = 0;

  constructor(grainSize: number) {
    this.grainSize = grainSize;
    this.hopSize = Math.floor(grainSize / 2);
    const size = grainSize * 4;
    this.inputBuffer = new Float32Array(size);
    this.outputBuffer = new Float32Array(size);
    this.window = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
    }
  }

  write(input: Float32Array): void {
    const len = this.inputBuffer.length;
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWritePos % len] = input[i];
      this.inputWritePos++;
    }
  }

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
}

class PitchShiftWorkletProcessor extends AudioWorkletProcessor {
  private grainSize: number;
  private shifters: GrainPitchShifter[] = [];

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
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'setGrainSize') {
        this.grainSize = e.data.size;
        // Re-create shifters on the next process() call so buffers reset.
        this.shifters = [];
      }
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;

    // Allocate one shifter per input channel the first time we see it.
    // The processor is created with dynamic channel count, so we can't
    // know the number of channels until process() runs.
    const channelCount = Math.min(input.length, output.length);
    while (this.shifters.length < channelCount) {
      this.shifters.push(new GrainPitchShifter(this.grainSize));
    }

    const pitchRatio = parameters.pitchRatio[0];

    for (let ch = 0; ch < channelCount; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;
      const shifter = this.shifters[ch];
      shifter.write(inCh);
      shifter.read(outCh, pitchRatio);
    }

    return true;
  }
}

registerProcessor('pitch-shift-worklet', PitchShiftWorkletProcessor);
