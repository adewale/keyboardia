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
 * Vite bundles this AudioWorklet's module graph, so the processor uses the
 * same GrainPitchShifter implementation that the unit tests exercise.
 */

import { PITCH_WORKLET_MAX_RATIO, PITCH_WORKLET_MIN_RATIO } from '../pitch-shift-range';
import { GrainPitchShifter } from './pitch-shift-engine';

class PitchShiftWorkletProcessor extends AudioWorkletProcessor {
  private grainSize: number;
  private shifters: GrainPitchShifter[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      {
        name: 'pitchRatio',
        defaultValue: 1.0,
        minValue: PITCH_WORKLET_MIN_RATIO,  // -24 semitones
        maxValue: PITCH_WORKLET_MAX_RATIO,  // +24 semitones
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

    const pitchRatio = parameters.pitchRatio?.[0] ?? 1;

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
