/**
 * Effects system for Keyboardia.
 * Provides reverb, delay, and chorus effects using Web Audio API.
 *
 * Architecture:
 * - Global effects bus for master processing
 * - Per-track send levels (future)
 * - Convolution reverb for realistic space
 * - Algorithmic fallback for fast load
 */

export interface ReverbParams {
  type: 'room' | 'hall' | 'plate' | 'spring';
  mix: number; // 0 to 1 (dry/wet)
  decay: number; // 0.1 to 10 seconds
  preDelay: number; // 0 to 100ms
}

export interface DelayParams {
  time: number; // Delay time in ms (1-2000)
  feedback: number; // 0 to 0.95
  mix: number; // 0 to 1
  pingPong: boolean; // Stereo ping-pong
}

export interface ChorusParams {
  rate: number; // LFO rate 0.1-10 Hz
  depth: number; // Modulation depth 0-1
  mix: number; // 0 to 1
}

export interface CompressorParams {
  threshold: number; // -60 to 0 dB
  ratio: number; // 1 to 20
  attack: number; // 0.001 to 1 second
  release: number; // 0.01 to 1 second
  knee: number; // 0 to 40 dB
}

/**
 * Reverb effect using ConvolverNode with algorithmically generated impulse responses.
 */
export class Reverb {
  private audioContext: AudioContext;
  private convolver: ConvolverNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private preDelayNode: DelayNode;
  private inputNode: GainNode;
  private outputNode: GainNode;
  private params: ReverbParams;

  constructor(audioContext: AudioContext, params: Partial<ReverbParams> = {}) {
    this.audioContext = audioContext;
    this.params = {
      type: params.type ?? 'room',
      mix: params.mix ?? 0.3,
      decay: params.decay ?? 1.5,
      preDelay: params.preDelay ?? 10,
    };

    // Create nodes
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();
    this.convolver = audioContext.createConvolver();
    this.dryGain = audioContext.createGain();
    this.wetGain = audioContext.createGain();
    this.preDelayNode = audioContext.createDelay(0.1);

    // Connect: input -> dry -> output
    //          input -> preDelay -> convolver -> wet -> output
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    this.inputNode.connect(this.preDelayNode);
    this.preDelayNode.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.wetGain.connect(this.outputNode);

    // Generate initial impulse response
    this.generateImpulseResponse();
    this.updateMix();
    this.updatePreDelay();
  }

  get input(): GainNode {
    return this.inputNode;
  }

  get output(): GainNode {
    return this.outputNode;
  }

  setParams(params: Partial<ReverbParams>): void {
    let regenerateIR = false;

    if (params.type !== undefined && params.type !== this.params.type) {
      this.params.type = params.type;
      regenerateIR = true;
    }

    if (params.decay !== undefined && params.decay !== this.params.decay) {
      this.params.decay = params.decay;
      regenerateIR = true;
    }

    if (params.mix !== undefined) {
      this.params.mix = params.mix;
      this.updateMix();
    }

    if (params.preDelay !== undefined) {
      this.params.preDelay = params.preDelay;
      this.updatePreDelay();
    }

    if (regenerateIR) {
      this.generateImpulseResponse();
    }
  }

  private updateMix(): void {
    const mix = Math.max(0, Math.min(1, this.params.mix));
    // Equal power crossfade
    this.dryGain.gain.value = Math.cos(mix * Math.PI * 0.5);
    this.wetGain.gain.value = Math.sin(mix * Math.PI * 0.5);
  }

  private updatePreDelay(): void {
    this.preDelayNode.delayTime.value = this.params.preDelay / 1000;
  }

  /**
   * Generate algorithmic impulse response.
   * Different reverb types have different characteristics.
   */
  private generateImpulseResponse(): void {
    const sampleRate = this.audioContext.sampleRate;
    const decay = Math.max(0.1, Math.min(10, this.params.decay));
    const length = Math.ceil(sampleRate * decay);

    // Create stereo buffer
    const buffer = this.audioContext.createBuffer(2, length, sampleRate);
    const leftChannel = buffer.getChannelData(0);
    const rightChannel = buffer.getChannelData(1);

    // Get type-specific parameters
    const typeParams = this.getTypeParams(this.params.type);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const normalizedT = i / length;

      // Base exponential decay
      let envelope = Math.exp(-t * typeParams.decayRate);

      // Early reflections (stronger at start)
      if (t < typeParams.earlyReflectionTime) {
        const earlyT = t / typeParams.earlyReflectionTime;
        envelope *= 1 + typeParams.earlyReflectionAmount * (1 - earlyT);
      }

      // Diffusion (random noise shaped by envelope)
      const noiseL = (Math.random() * 2 - 1) * envelope;
      const noiseR = (Math.random() * 2 - 1) * envelope;

      // Add some low-frequency content for warmth
      const lowFreq = Math.sin(2 * Math.PI * 100 * t) * 0.1 * envelope;

      // High-frequency absorption (simulates air/material absorption)
      const hfDamping = Math.exp(-normalizedT * typeParams.hfDampingRate);

      leftChannel[i] = noiseL * hfDamping + lowFreq * typeParams.warmth;
      rightChannel[i] = noiseR * hfDamping + lowFreq * typeParams.warmth;
    }

    // Normalize to prevent clipping
    this.normalizeBuffer(buffer);

    this.convolver.buffer = buffer;
  }

  private getTypeParams(type: ReverbParams['type']): {
    decayRate: number;
    earlyReflectionTime: number;
    earlyReflectionAmount: number;
    hfDampingRate: number;
    warmth: number;
  } {
    switch (type) {
      case 'room':
        return {
          decayRate: 3,
          earlyReflectionTime: 0.03,
          earlyReflectionAmount: 0.5,
          hfDampingRate: 2,
          warmth: 0.3,
        };
      case 'hall':
        return {
          decayRate: 1.5,
          earlyReflectionTime: 0.08,
          earlyReflectionAmount: 0.3,
          hfDampingRate: 1,
          warmth: 0.5,
        };
      case 'plate':
        return {
          decayRate: 2.5,
          earlyReflectionTime: 0.01,
          earlyReflectionAmount: 0.8,
          hfDampingRate: 0.5,
          warmth: 0.1,
        };
      case 'spring':
        return {
          decayRate: 4,
          earlyReflectionTime: 0.02,
          earlyReflectionAmount: 1.0,
          hfDampingRate: 3,
          warmth: 0.2,
        };
      default:
        return {
          decayRate: 3,
          earlyReflectionTime: 0.03,
          earlyReflectionAmount: 0.5,
          hfDampingRate: 2,
          warmth: 0.3,
        };
    }
  }

  private normalizeBuffer(buffer: AudioBuffer): void {
    let maxVal = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        maxVal = Math.max(maxVal, Math.abs(data[i]));
      }
    }

    if (maxVal > 0) {
      const scale = 0.8 / maxVal;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          data[i] *= scale;
        }
      }
    }
  }

  disconnect(): void {
    this.inputNode.disconnect();
    this.outputNode.disconnect();
    this.convolver.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.preDelayNode.disconnect();
  }
}

/**
 * Delay effect with optional ping-pong stereo.
 */
export class Delay {
  private audioContext: AudioContext;
  private delayNodeL: DelayNode;
  private delayNodeR: DelayNode;
  private feedbackGainL: GainNode;
  private feedbackGainR: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private inputNode: GainNode;
  private outputNode: GainNode;
  private params: DelayParams;

  constructor(audioContext: AudioContext, params: Partial<DelayParams> = {}) {
    this.audioContext = audioContext;
    this.params = {
      time: params.time ?? 375, // Default: dotted 8th at 120bpm
      feedback: params.feedback ?? 0.4,
      mix: params.mix ?? 0.3,
      pingPong: params.pingPong ?? false,
    };

    // Create nodes
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();
    this.delayNodeL = audioContext.createDelay(2);
    this.delayNodeR = audioContext.createDelay(2);
    this.feedbackGainL = audioContext.createGain();
    this.feedbackGainR = audioContext.createGain();
    this.dryGain = audioContext.createGain();
    this.wetGain = audioContext.createGain();

    this.connectNodes();
    this.updateParams();
  }

  get input(): GainNode {
    return this.inputNode;
  }

  get output(): GainNode {
    return this.outputNode;
  }

  private connectNodes(): void {
    // Dry path
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    // Wet path (mono or ping-pong)
    this.inputNode.connect(this.delayNodeL);
    this.delayNodeL.connect(this.feedbackGainL);
    this.feedbackGainL.connect(this.wetGain);

    if (this.params.pingPong) {
      this.feedbackGainL.connect(this.delayNodeR);
      this.delayNodeR.connect(this.feedbackGainR);
      this.feedbackGainR.connect(this.delayNodeL);
      this.feedbackGainR.connect(this.wetGain);
    } else {
      this.feedbackGainL.connect(this.delayNodeL);
    }

    this.wetGain.connect(this.outputNode);
  }

  setParams(params: Partial<DelayParams>): void {
    if (params.time !== undefined) this.params.time = params.time;
    if (params.feedback !== undefined) this.params.feedback = params.feedback;
    if (params.mix !== undefined) this.params.mix = params.mix;
    if (params.pingPong !== undefined) this.params.pingPong = params.pingPong;
    this.updateParams();
  }

  private updateParams(): void {
    const time = Math.max(1, Math.min(2000, this.params.time)) / 1000;
    const feedback = Math.max(0, Math.min(0.95, this.params.feedback));
    const mix = Math.max(0, Math.min(1, this.params.mix));

    this.delayNodeL.delayTime.value = time;
    this.delayNodeR.delayTime.value = time;
    this.feedbackGainL.gain.value = feedback;
    this.feedbackGainR.gain.value = feedback;

    // Equal power crossfade
    this.dryGain.gain.value = Math.cos(mix * Math.PI * 0.5);
    this.wetGain.gain.value = Math.sin(mix * Math.PI * 0.5);
  }

  disconnect(): void {
    this.inputNode.disconnect();
    this.outputNode.disconnect();
    this.delayNodeL.disconnect();
    this.delayNodeR.disconnect();
    this.feedbackGainL.disconnect();
    this.feedbackGainR.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
  }
}

/**
 * Chorus effect using modulated delay lines.
 */
export class Chorus {
  private audioContext: AudioContext;
  private delayNodes: DelayNode[];
  private lfoOscillators: OscillatorNode[];
  private lfoGains: GainNode[];
  private dryGain: GainNode;
  private wetGain: GainNode;
  private inputNode: GainNode;
  private outputNode: GainNode;
  private params: ChorusParams;

  constructor(audioContext: AudioContext, params: Partial<ChorusParams> = {}) {
    this.audioContext = audioContext;
    this.params = {
      rate: params.rate ?? 1.5,
      depth: params.depth ?? 0.5,
      mix: params.mix ?? 0.3,
    };

    // Create nodes
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();
    this.dryGain = audioContext.createGain();
    this.wetGain = audioContext.createGain();

    // Create 2 modulated delay lines for stereo width
    this.delayNodes = [];
    this.lfoOscillators = [];
    this.lfoGains = [];

    for (let i = 0; i < 2; i++) {
      const delay = audioContext.createDelay(0.1);
      delay.delayTime.value = 0.02 + i * 0.005; // Offset delays

      const lfo = audioContext.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = this.params.rate * (1 + i * 0.1); // Slight rate offset

      const lfoGain = audioContext.createGain();
      lfoGain.gain.value = 0.002 * this.params.depth;

      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      lfo.start();

      this.delayNodes.push(delay);
      this.lfoOscillators.push(lfo);
      this.lfoGains.push(lfoGain);
    }

    this.connectNodes();
    this.updateMix();
  }

  get input(): GainNode {
    return this.inputNode;
  }

  get output(): GainNode {
    return this.outputNode;
  }

  private connectNodes(): void {
    // Dry path
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    // Wet path (through modulated delays)
    for (const delay of this.delayNodes) {
      this.inputNode.connect(delay);
      delay.connect(this.wetGain);
    }

    this.wetGain.connect(this.outputNode);
  }

  setParams(params: Partial<ChorusParams>): void {
    if (params.rate !== undefined) {
      this.params.rate = params.rate;
      this.lfoOscillators.forEach((lfo, i) => {
        lfo.frequency.value = this.params.rate * (1 + i * 0.1);
      });
    }

    if (params.depth !== undefined) {
      this.params.depth = params.depth;
      this.lfoGains.forEach((gain) => {
        gain.gain.value = 0.002 * this.params.depth;
      });
    }

    if (params.mix !== undefined) {
      this.params.mix = params.mix;
      this.updateMix();
    }
  }

  private updateMix(): void {
    const mix = Math.max(0, Math.min(1, this.params.mix));
    this.dryGain.gain.value = Math.cos(mix * Math.PI * 0.5);
    this.wetGain.gain.value = Math.sin(mix * Math.PI * 0.5);
  }

  disconnect(): void {
    this.inputNode.disconnect();
    this.outputNode.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.delayNodes.forEach((d) => d.disconnect());
    this.lfoOscillators.forEach((o) => o.stop());
    this.lfoGains.forEach((g) => g.disconnect());
  }
}

/**
 * Master effects chain with configurable routing.
 */
export class EffectsChain {
  private audioContext: AudioContext;
  private inputNode: GainNode;
  private outputNode: GainNode;
  private reverb: Reverb | null = null;
  private delay: Delay | null = null;
  private chorus: Chorus | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();

    // Direct connection (no effects by default)
    this.inputNode.connect(this.outputNode);
  }

  get input(): GainNode {
    return this.inputNode;
  }

  get output(): GainNode {
    return this.outputNode;
  }

  enableReverb(params?: Partial<ReverbParams>): Reverb {
    if (!this.reverb) {
      this.reverb = new Reverb(this.audioContext, params);
      this.rebuildChain();
    } else if (params) {
      this.reverb.setParams(params);
    }
    return this.reverb;
  }

  disableReverb(): void {
    if (this.reverb) {
      this.reverb.disconnect();
      this.reverb = null;
      this.rebuildChain();
    }
  }

  enableDelay(params?: Partial<DelayParams>): Delay {
    if (!this.delay) {
      this.delay = new Delay(this.audioContext, params);
      this.rebuildChain();
    } else if (params) {
      this.delay.setParams(params);
    }
    return this.delay;
  }

  disableDelay(): void {
    if (this.delay) {
      this.delay.disconnect();
      this.delay = null;
      this.rebuildChain();
    }
  }

  enableChorus(params?: Partial<ChorusParams>): Chorus {
    if (!this.chorus) {
      this.chorus = new Chorus(this.audioContext, params);
      this.rebuildChain();
    } else if (params) {
      this.chorus.setParams(params);
    }
    return this.chorus;
  }

  disableChorus(): void {
    if (this.chorus) {
      this.chorus.disconnect();
      this.chorus = null;
      this.rebuildChain();
    }
  }

  enableCompressor(params?: Partial<CompressorParams>): DynamicsCompressorNode {
    if (!this.compressor) {
      this.compressor = this.audioContext.createDynamicsCompressor();
      if (params) {
        this.setCompressorParams(params);
      }
      this.rebuildChain();
    } else if (params) {
      this.setCompressorParams(params);
    }
    return this.compressor;
  }

  disableCompressor(): void {
    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
      this.rebuildChain();
    }
  }

  private setCompressorParams(params: Partial<CompressorParams>): void {
    if (!this.compressor) return;
    if (params.threshold !== undefined) this.compressor.threshold.value = params.threshold;
    if (params.ratio !== undefined) this.compressor.ratio.value = params.ratio;
    if (params.attack !== undefined) this.compressor.attack.value = params.attack;
    if (params.release !== undefined) this.compressor.release.value = params.release;
    if (params.knee !== undefined) this.compressor.knee.value = params.knee;
  }

  /**
   * Rebuild the effects chain with current effects.
   * Order: Input -> Compressor -> Chorus -> Delay -> Reverb -> Output
   */
  private rebuildChain(): void {
    // Disconnect everything
    this.inputNode.disconnect();

    // Build chain: input -> [effects] -> output
    let currentNode: AudioNode = this.inputNode;

    if (this.compressor) {
      currentNode.connect(this.compressor);
      currentNode = this.compressor;
    }

    if (this.chorus) {
      currentNode.connect(this.chorus.input);
      currentNode = this.chorus.output;
    }

    if (this.delay) {
      currentNode.connect(this.delay.input);
      currentNode = this.delay.output;
    }

    if (this.reverb) {
      currentNode.connect(this.reverb.input);
      currentNode = this.reverb.output;
    }

    currentNode.connect(this.outputNode);
  }

  disconnect(): void {
    this.reverb?.disconnect();
    this.delay?.disconnect();
    this.chorus?.disconnect();
    this.compressor?.disconnect();
    this.inputNode.disconnect();
    this.outputNode.disconnect();
  }
}

// Default effect presets
export const EFFECT_PRESETS = {
  // Reverb presets
  reverb: {
    subtle: { type: 'room' as const, mix: 0.15, decay: 0.8, preDelay: 10 },
    room: { type: 'room' as const, mix: 0.25, decay: 1.2, preDelay: 15 },
    hall: { type: 'hall' as const, mix: 0.35, decay: 2.5, preDelay: 30 },
    plate: { type: 'plate' as const, mix: 0.3, decay: 1.8, preDelay: 5 },
    ambient: { type: 'hall' as const, mix: 0.5, decay: 4.0, preDelay: 50 },
  },
  // Delay presets
  delay: {
    slap: { time: 100, feedback: 0.2, mix: 0.2, pingPong: false },
    eighth: { time: 250, feedback: 0.35, mix: 0.25, pingPong: false },
    dotted: { time: 375, feedback: 0.4, mix: 0.3, pingPong: false },
    pingPong: { time: 333, feedback: 0.5, mix: 0.3, pingPong: true },
    dub: { time: 500, feedback: 0.6, mix: 0.4, pingPong: true },
  },
  // Chorus presets
  chorus: {
    subtle: { rate: 0.8, depth: 0.3, mix: 0.2 },
    classic: { rate: 1.5, depth: 0.5, mix: 0.3 },
    thick: { rate: 2.0, depth: 0.7, mix: 0.4 },
    leslie: { rate: 5.0, depth: 0.6, mix: 0.35 },
  },
} as const;
