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
      const raw = this.computeWaveform(this.phase); // -1 to 1

      // Scale output based on destination.
      // Amount is passed separately so each destination can apply it correctly
      // (e.g., amplitude tremolo depth vs filter sweep range).
      const scaled = this.scaleForDestination(raw, amount);

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
   * Scale the raw LFO waveform (-1..1) for the target destination.
   * Amount controls modulation depth independently per destination.
   *
   * - filter: ±(amount * 2000) Hz around the base cutoff
   * - pitch: ±(amount * 100) cents vibrato
   * - amplitude: tremolo — gain swings from (1 - amount) to 1.0
   *   e.g. amount=0.5 → gain range 0.5..1.0, amount=1.0 → gain range 0.0..1.0
   */
  private scaleForDestination(raw: number, amount: number): number {
    switch (this.config.destination) {
      case 'filter':
        return raw * amount * 2000;
      case 'pitch':
        return raw * amount * 100;
      case 'amplitude':
        // Map raw (-1..1) to gain: center at (1 - amount/2), swing by ±amount/2
        // At amount=1: raw=-1 → gain=0, raw=1 → gain=1
        // At amount=0.5: raw=-1 → gain=0.5, raw=1 → gain=1
        return 1.0 - (amount / 2) * (1 - raw);
      default:
        return raw * amount;
    }
  }
}

registerProcessor('shared-lfo-worklet', SharedLFOWorkletProcessor);
