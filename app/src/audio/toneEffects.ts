/**
 * Tone.js Effects Chain Integration
 *
 * This module provides a hybrid integration of Tone.js effects with the existing
 * Keyboardia audio engine, following the spec in specs/SYNTHESIS-ENGINE.md
 *
 * Key features:
 * - Reverb (Tone.Freeverb for instant ready, or Tone.Reverb for quality)
 * - Delay (Tone.FeedbackDelay with tempo-synced time)
 * - Chorus (Tone.Chorus for stereo width)
 * - Distortion (Tone.Distortion for grit and edge)
 *
 * Best practices applied:
 * - Singleton pattern (create once, reuse)
 * - Async reverb handling (wait for ready)
 * - Proper disposal to prevent memory leaks
 * - State serialization for multiplayer sync
 */

import * as Tone from 'tone';
import { logger } from '../utils/logger';
import { DEFAULT_EFFECTS_STATE } from '../shared/effects-defaults';
export { DEFAULT_EFFECTS_STATE } from '../shared/effects-defaults';
// Re-export EffectsState from canonical source for type parity
export type { EffectsState } from '../shared/sync-types';
import type { EffectsState } from '../shared/sync-types';
// Import effect bounds and clamp from canonical source (shared/constants.ts)
import {
  clamp,
  REVERB_MIN_DECAY,
  REVERB_MAX_DECAY,
  DELAY_MAX_FEEDBACK,
  CHORUS_MIN_FREQUENCY,
  CHORUS_MAX_FREQUENCY,
  DEFAULT_TEMPO,
  MIN_TEMPO,
  MAX_TEMPO,
} from '../shared/constants';
import {
  MASTER_COMPRESSOR_SETTINGS,
  MASTER_LIMITER_THRESHOLD_DB,
  MASTER_MAKEUP_GAIN,
  MASTER_OUTPUT_TRIM,
  REVERB_PREDELAY_SECONDS,
  REVERB_SEND_HIGHPASS_HZ,
  slewAudioParam,
} from './constants';

/** Map the persisted decay range logarithmically onto Freeverb room size. */
export function decayToRoomSize(decaySeconds: number): number {
  const decay = clamp(decaySeconds, REVERB_MIN_DECAY, REVERB_MAX_DECAY);
  const position = Math.log10(decay / REVERB_MIN_DECAY)
    / Math.log10(REVERB_MAX_DECAY / REVERB_MIN_DECAY);
  return clamp(0.1 + position * 0.85, 0.1, 0.95);
}

/** Convert Tone-style note/measure notation to seconds at the sequencer BPM. */
export function musicalTimeToSeconds(notation: string, bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`Tempo must be positive, received ${bpm}`);
  }
  const match = /^(\d+)([ntm])$/.exec(notation);
  if (!match) throw new RangeError(`Unsupported musical time: ${notation}`);

  const amount = Number(match[1]);
  const unit = match[2];
  const quarterSeconds = 60 / bpm;
  if (unit === 'm') return amount * 4 * quarterSeconds;

  const noteSeconds = (4 / amount) * quarterSeconds;
  return unit === 't' ? noteSeconds * (2 / 3) : noteSeconds;
}

/**
 * ToneEffectsChain - Manages Tone.js effects for the hybrid audio engine
 *
 * Signal flow:
 * Input → Compressor → Makeup → Distortion → Chorus → Delay
 *                                      ↘ dry ───────────────┐
 *                                       HPF → wet Reverb ──┼→ Limiter → Output
 *
 * This order is intentional:
 * - Distortion adds grit to the original signal first
 * - Chorus adds stereo width
 * - Delay creates rhythmic echoes
 * - Reverb adds space (applied last for natural sound)
 * - Limiter conditions transients; a final -1 dB trim supplies measured
 *   sample-peak headroom on the 16-track product-capacity fixture
 */

/**
 * Create a deep copy of effects state to prevent mutation of defaults
 */
function cloneEffectsState(state: EffectsState): EffectsState {
  return {
    bypass: state.bypass ?? false,  // Include bypass in cloned state
    reverb: { ...state.reverb },
    delay: { ...state.delay },
    chorus: { ...state.chorus },
    distortion: { ...state.distortion },
  };
}

export class ToneEffectsChain {
  /** Active room processor: instant Freeverb until the convolution IR is ready. */
  private reverb: Tone.Freeverb | Tone.Reverb | null = null;
  private convolutionReverb: Tone.Reverb | null = null;
  private delay: Tone.FeedbackDelay | null = null;
  private chorus: Tone.Chorus | null = null;
  private distortion: Tone.Distortion | null = null;
  private limiter: Tone.Limiter | null = null; // Phase 22: Prevent clipping when effects enabled
  private outputTrim: Tone.Gain | null = null;
  private input: Tone.Gain | null = null;
  private compressor: Tone.Compressor | null = null;
  private makeupTrim: Tone.Gain | null = null;
  private reverbHighpass: Tone.Filter | null = null;
  private reverbWetGain: Tone.Gain | null = null;

  private state: EffectsState = cloneEffectsState(DEFAULT_EFFECTS_STATE);
  private tempo = DEFAULT_TEMPO;
  private ready = false;
  private enabled = true;

  /**
   * Initialize the effects chain
   * Must be called after Tone.start() has been invoked
   */
  async initialize(destination?: AudioNode): Promise<void> {
    if (this.ready) {
      logger.audio.log('ToneEffectsChain already initialized');
      return;
    }

    logger.audio.log('Initializing ToneEffectsChain...');

    // Create input gain node
    this.input = new Tone.Gain(1);
    this.compressor = new Tone.Compressor(MASTER_COMPRESSOR_SETTINGS);
    this.makeupTrim = new Tone.Gain(MASTER_MAKEUP_GAIN);

    // Create an instant fallback first. A higher-quality convolution room is
    // generated in the background and hot-swapped without blocking playback.
    this.reverb = new Tone.Freeverb({
      roomSize: decayToRoomSize(this.state.reverb.decay),
      dampening: 3000,
    });
    // Reverb is a true parallel send. Its own mix is fully wet and the
    // serializable wet control drives a dedicated send-return gain.
    this.reverb.wet.value = 1;
    this.reverbHighpass = new Tone.Filter(REVERB_SEND_HIGHPASS_HZ, 'highpass');
    this.reverbWetGain = new Tone.Gain(this.state.reverb.wet);

    this.delay = new Tone.FeedbackDelay({
      delayTime: musicalTimeToSeconds(this.state.delay.time, this.tempo),
      // Server-compatible notation extends to four measures. Allocate once so
      // slower tempos cannot exceed Tone's otherwise one-second default.
      maxDelay: musicalTimeToSeconds('4m', MIN_TEMPO),
      feedback: this.state.delay.feedback,
    });
    this.delay.wet.value = this.state.delay.wet;

    this.chorus = new Tone.Chorus({
      frequency: this.state.chorus.frequency,
      depth: this.state.chorus.depth,
    });
    this.chorus.wet.value = this.state.chorus.wet;
    this.chorus.start(); // Chorus LFO must be started

    this.distortion = new Tone.Distortion(this.state.distortion.amount);
    this.distortion.wet.value = this.state.distortion.wet;

    // Phase 22: Add limiter at end of chain to prevent clipping
    // When effects are enabled, we bypass the native compressor, so we need
    // a limiter here to prevent harsh digital clipping from reverb tails,
    // distortion peaks, or multiple voices summing above 0dB.
    // Tone.Limiter is compressor-based and can overshoot its threshold. The
    // final output trim below is calibrated by the heard-output capacity gate.
    this.limiter = new Tone.Limiter(MASTER_LIMITER_THRESHOLD_DB);
    this.outputTrim = new Tone.Gain(MASTER_OUTPUT_TRIM);

    // Serial dynamics and color stages.
    this.input.connect(this.compressor);
    this.compressor.connect(this.makeupTrim);
    this.makeupTrim.connect(this.distortion);
    this.distortion.connect(this.chorus);
    this.chorus.connect(this.delay);

    // Parallel high-passed reverb: preserve the dry path and keep bass energy
    // out of the room tail.
    this.delay.connect(this.limiter);
    this.delay.connect(this.reverbHighpass);
    this.reverbHighpass.connect(this.reverb);
    this.reverb.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.limiter);
    this.limiter.connect(this.outputTrim);
    if (destination) {
      this.outputTrim.connect(destination);
    } else {
      this.outputTrim.toDestination();
    }

    this.ready = true;
    void this.initializeConvolutionReverb();
    logger.audio.log('ToneEffectsChain initialized');
  }

  /**
   * Generate Tone.Reverb's convolution IR asynchronously, then replace the
   * algorithmic fallback. Connecting the ready node before disconnecting the
   * fallback avoids a silent render quantum during the swap.
   */
  private async initializeConvolutionReverb(): Promise<void> {
    const fallback = this.reverb;
    const highpass = this.reverbHighpass;
    const wetGain = this.reverbWetGain;
    if (!fallback || !highpass || !wetGain || !this.ready) return;

    const convolution = new Tone.Reverb({
      decay: this.state.reverb.decay,
      preDelay: REVERB_PREDELAY_SECONDS,
      wet: 1,
    });
    convolution.wet.value = 1;
    this.convolutionReverb = convolution;

    try {
      // A decay update starts a newer generation. Always wait for the latest
      // promise before exposing the convolver as the audible room.
      let generation = convolution.ready;
      await generation;
      while (generation !== convolution.ready) {
        generation = convolution.ready;
        await generation;
      }
    } catch (error) {
      if (this.convolutionReverb === convolution) this.convolutionReverb = null;
      convolution.dispose();
      logger.audio.warn('Convolution reverb generation failed; retaining Freeverb fallback', error);
      return;
    }

    if (
      !this.ready
      || this.convolutionReverb !== convolution
      || this.reverb !== fallback
      || !this.reverbHighpass
      || !this.reverbWetGain
    ) {
      if (this.convolutionReverb === convolution) this.convolutionReverb = null;
      convolution.dispose();
      return;
    }

    convolution.connect(wetGain);
    highpass.connect(convolution);
    highpass.disconnect(fallback);
    fallback.disconnect(wetGain);
    this.reverb = convolution;
    fallback.dispose();
    logger.audio.log('Convolution reverb ready; replaced Freeverb fallback');
  }

  /**
   * Get the input node for connecting audio sources
   */
  getInput(): Tone.Gain | null {
    return this.input;
  }

  /**
   * Raw Web Audio tap points used by the synchronized measurement recorder.
   * They are deliberately read-only: the recorder fans out from each node and
   * never changes the production routing.
   */
  getCaptureTaps(): {
    preCompressor: AudioNode;
    postMakeup: AudioNode;
    userOutput: AudioNode;
  } | null {
    if (!this.compressor || !this.makeupTrim) return null;
    return {
      // Tone.Compressor exposes the native DynamicsCompressorNode as both its
      // input and output; tapping it therefore captures post-compression PCM.
      // Fan out from the upstream input gain to obtain a genuine pre tap.
      preCompressor: this.input!.output as unknown as AudioNode,
      postMakeup: this.makeupTrim.output as unknown as AudioNode,
      userOutput: this.outputTrim!.output as unknown as AudioNode,
    };
  }

  /**
   * Check if effects chain is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Check if effects are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // --- Reverb Controls ---

  setReverbWet(wet: number): void {
    this.state.reverb.wet = clamp(wet, 0, 1);
    if (this.reverbWetGain && this.enabled) {
      slewAudioParam(this.reverbWetGain.gain, this.state.reverb.wet, Tone.now());
    }
  }

  setReverbDecay(decay: number): void {
    this.state.reverb.decay = clamp(decay, REVERB_MIN_DECAY, REVERB_MAX_DECAY);
    if (this.reverb && 'roomSize' in this.reverb) {
      // Freeverb uses roomSize (0-1) instead of decay
      // Map decay (0.1-10s) to roomSize (0.1-0.99)
      slewAudioParam(this.reverb.roomSize, decayToRoomSize(this.state.reverb.decay), Tone.now());
    }
    if (this.convolutionReverb) {
      this.convolutionReverb.decay = this.state.reverb.decay;
    }
  }

  // --- Delay Controls ---

  setDelayWet(wet: number): void {
    this.state.delay.wet = clamp(wet, 0, 1);
    if (this.delay && this.enabled) {
      slewAudioParam(this.delay.wet, this.state.delay.wet, Tone.now());
    }
  }

  setDelayTime(time: string): void {
    const seconds = musicalTimeToSeconds(time, this.tempo);
    this.state.delay.time = time;
    if (this.delay) {
      this.delay.delayTime.value = seconds;
    }
  }

  /** Keep notation-based delay timing locked to Keyboardia's scheduler. */
  setTempo(bpm: number): void {
    this.tempo = clamp(bpm, MIN_TEMPO, MAX_TEMPO);
    if (this.delay) {
      this.delay.delayTime.value = musicalTimeToSeconds(this.state.delay.time, this.tempo);
    }
  }

  setDelayFeedback(feedback: number): void {
    this.state.delay.feedback = clamp(feedback, 0, DELAY_MAX_FEEDBACK);
    if (this.delay) {
      slewAudioParam(this.delay.feedback, this.state.delay.feedback, Tone.now());
    }
  }

  // --- Chorus Controls ---

  setChorusWet(wet: number): void {
    this.state.chorus.wet = clamp(wet, 0, 1);
    if (this.chorus && this.enabled) {
      slewAudioParam(this.chorus.wet, this.state.chorus.wet, Tone.now());
    }
  }

  setChorusFrequency(frequency: number): void {
    this.state.chorus.frequency = clamp(frequency, CHORUS_MIN_FREQUENCY, CHORUS_MAX_FREQUENCY);
    if (this.chorus) {
      this.chorus.frequency.value = this.state.chorus.frequency;
    }
  }

  setChorusDepth(depth: number): void {
    this.state.chorus.depth = clamp(depth, 0, 1);
    if (this.chorus) {
      this.chorus.depth = this.state.chorus.depth;
    }
  }

  // --- Distortion Controls ---

  setDistortionWet(wet: number): void {
    this.state.distortion.wet = clamp(wet, 0, 1);
    if (this.distortion && this.enabled) {
      slewAudioParam(this.distortion.wet, this.state.distortion.wet, Tone.now());
    }
  }

  setDistortionAmount(amount: number): void {
    this.state.distortion.amount = clamp(amount, 0, 1);
    if (this.distortion) {
      this.distortion.distortion = this.state.distortion.amount;
    }
  }

  // --- State Management ---

  /**
   * Get current effects state for serialization
   */
  getState(): EffectsState {
    return cloneEffectsState(this.state);
  }

  /**
   * Apply state from multiplayer sync or session load
   */
  applyState(newState: EffectsState): void {
    this.state = cloneEffectsState(newState);

    if (this.ready) {
      // Apply all values to Tone.js nodes
      this.setReverbWet(newState.reverb.wet);
      this.setReverbDecay(newState.reverb.decay);
      this.setDelayWet(newState.delay.wet);
      this.setDelayTime(newState.delay.time);
      this.setDelayFeedback(newState.delay.feedback);
      this.setChorusWet(newState.chorus.wet);
      this.setChorusFrequency(newState.chorus.frequency);
      this.setChorusDepth(newState.chorus.depth);
      this.setDistortionWet(newState.distortion.wet);
      this.setDistortionAmount(newState.distortion.amount);
      // Apply bypass state (if bypassed, effects are disabled)
      this.setEnabled(!(newState.bypass ?? false));
    }

    logger.audio.log('Applied effects state:', newState);
  }

  // --- Enable/Disable ---

  /**
   * Enable or disable all effects (bypass mode)
   * Note: this.state is always the source of truth - effects setters update it even when bypassed
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;

    if (!enabled) {
      // Bypass: set all wet to 0 (state is preserved in this.state)
      if (this.reverbWetGain) this.reverbWetGain.gain.value = 0;
      if (this.delay) this.delay.wet.value = 0;
      if (this.chorus) this.chorus.wet.value = 0;
      if (this.distortion) this.distortion.wet.value = 0;
    } else {
      // Un-bypass: restore from current state (may have changed while bypassed)
      if (this.reverbWetGain) this.reverbWetGain.gain.value = this.state.reverb.wet;
      if (this.delay) this.delay.wet.value = this.state.delay.wet;
      if (this.chorus) this.chorus.wet.value = this.state.chorus.wet;
      if (this.distortion) this.distortion.wet.value = this.state.distortion.wet;
    }

    this.enabled = enabled;
    logger.audio.log('Effects enabled:', enabled);
  }

  // --- Cleanup ---

  /**
   * Dispose all Tone.js nodes to prevent memory leaks
   */
  dispose(): void {
    if (!this.ready) return;

    logger.audio.log('Disposing ToneEffectsChain...');

    this.input?.dispose();
    this.compressor?.dispose();
    this.makeupTrim?.dispose();
    this.distortion?.dispose();
    this.chorus?.dispose();
    this.delay?.dispose();
    this.reverb?.dispose();
    if (this.convolutionReverb && this.convolutionReverb !== this.reverb) {
      this.convolutionReverb.dispose();
    }
    this.reverbHighpass?.dispose();
    this.reverbWetGain?.dispose();
    this.limiter?.dispose();
    this.outputTrim?.dispose();

    this.input = null;
    this.compressor = null;
    this.makeupTrim = null;
    this.distortion = null;
    this.chorus = null;
    this.delay = null;
    this.reverb = null;
    this.convolutionReverb = null;
    this.reverbHighpass = null;
    this.reverbWetGain = null;
    this.limiter = null;
    this.outputTrim = null;

    this.ready = false;
    this.enabled = true;
    this.tempo = DEFAULT_TEMPO;
    // Reset state to defaults for clean re-initialization
    this.state = cloneEffectsState(DEFAULT_EFFECTS_STATE);

    logger.audio.log('ToneEffectsChain disposed');
  }
}

// NOTE: Singleton pattern removed in Phase 22.
// Singletons cache Tone.js nodes across HMR (Hot Module Reload), causing
// "cannot connect to an AudioNode belonging to a different audio context" errors.
// Always use `new ToneEffectsChain()` to ensure nodes are in the current AudioContext.
// See audio-context-safety.test.ts for comprehensive documentation.
