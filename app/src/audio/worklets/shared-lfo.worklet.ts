/**
 * Shared LFO AudioWorklet Processor
 *
 * Computes a single LFO waveform at sample rate and outputs it on all channels.
 * Replaces per-voice Tone.LFO instances in AdvancedSynthEngine.
 *
 * One worklet instance replaces up to 8 Tone.LFO oscillators.
 * Modulation is computed per-sample (a-rate) instead of per-block (k-rate).
 */

// ─── Types ───────────────────────────────────────────────────────────────

type LFOWaveform = 'sine' | 'triangle' | 'sawtooth' | 'square';
type LFODestination = 'filter' | 'pitch' | 'amplitude';

interface LFOConfig {
  frequency: number;
  waveform: LFOWaveform;
  amount: number;
  destination: LFODestination;
}

// ─── Processor ───────────────────────────────────────────────────────────

class SharedLFOWorkletProcessor extends AudioWorkletProcessor {
  private phase = 0;
  private config: LFOConfig = {
    frequency: 5,
    waveform: 'sine',
    amount: 0,
    destination: 'filter',
  };

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'frequency', defaultValue: 5, minValue: 0.1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.frequency !== undefined) this.config.frequency = data.frequency;
      if (data.waveform !== undefined) this.config.waveform = data.waveform;
      if (data.amount !== undefined) this.config.amount = data.amount;
      if (data.destination !== undefined) this.config.destination = data.destination;
    };
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const freq = parameters.frequency?.[0] ?? this.config.frequency;
    const amount = parameters.amount?.[0] ?? this.config.amount;

    // Early exit: no modulation needed
    if (amount === 0 || freq === 0) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
      return true;
    }

    const blockSize = output[0].length;
    const sr = sampleRate; // global in AudioWorklet scope

    for (let i = 0; i < blockSize; i++) {
      const value = this.computeWaveform(this.phase) * amount;

      // Scale output based on destination
      const scaled = this.scaleForDestination(value);

      // Write to all output channels (one per voice slot)
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = scaled;
      }

      // Advance phase (wrap at 1.0)
      this.phase += freq / sr;
      if (this.phase >= 1) this.phase -= 1;
    }

    return true;
  }

  private computeWaveform(phase: number): number {
    switch (this.config.waveform) {
      case 'sine':
        return Math.sin(phase * 2 * Math.PI);
      case 'triangle':
        return 4 * Math.abs(phase - 0.5) - 1;
      case 'sawtooth':
        return 2 * phase - 1;
      case 'square':
        return phase < 0.5 ? 1 : -1;
      default:
        return 0;
    }
  }

  /**
   * Scale the raw LFO value for the target destination.
   * - filter: Hz range (±2000 Hz)
   * - pitch: cents (±100)
   * - amplitude: gain multiplier (0.0 to 1.0)
   */
  private scaleForDestination(value: number): number {
    switch (this.config.destination) {
      case 'filter':
        return value * 2000;
      case 'pitch':
        return value * 100;
      case 'amplitude':
        // Map -1..1 to 0.5..1.0 for tremolo effect
        return 0.75 + value * 0.25;
      default:
        return value;
    }
  }
}

registerProcessor('shared-lfo-worklet', SharedLFOWorkletProcessor);
