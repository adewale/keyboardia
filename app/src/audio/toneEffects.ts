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

// Effect parameter constraints (from spec)
const REVERB_MIN_DECAY = 0.1;
const REVERB_MAX_DECAY = 10;
const DELAY_MAX_FEEDBACK = 0.95; // Prevent runaway feedback
const CHORUS_MIN_FREQUENCY = 0.1;
const CHORUS_MAX_FREQUENCY = 10;

/**
 * Effects state for session persistence and multiplayer sync
 * Matches the format in specs/SYNTHESIS-ENGINE.md Appendix B
 */
export interface EffectsState {
  reverb: {
    decay: number;  // 0.1 to 10 seconds
    wet: number;    // 0 to 1
  };
  delay: {
    time: string;      // Musical notation: "8n", "4n", "16n", etc.
    feedback: number;  // 0 to 0.95
    wet: number;       // 0 to 1
  };
  chorus: {
    frequency: number;  // 0.1 to 10 Hz
    depth: number;      // 0 to 1
    wet: number;        // 0 to 1
  };
  distortion: {
    amount: number;     // 0 to 1 (waveshaping intensity)
    wet: number;        // 0 to 1
  };
}

/**
 * Default effects state - all effects dry (wet = 0)
 * Users must explicitly enable effects
 */
export const DEFAULT_EFFECTS_STATE: EffectsState = {
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

/**
 * Clamp a value to a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * ToneEffectsChain - Manages Tone.js effects for the hybrid audio engine
 *
 * Signal flow:
 * Input → Distortion → Chorus → Delay → Reverb → Output
 *
 * This order is intentional:
 * - Distortion adds grit to the original signal first
 * - Chorus adds stereo width
 * - Delay creates rhythmic echoes
 * - Reverb adds space (applied last for natural sound)
 */

/**
 * Create a deep copy of effects state to prevent mutation of defaults
 */
function cloneEffectsState(state: EffectsState): EffectsState {
  return {
    reverb: { ...state.reverb },
    delay: { ...state.delay },
    chorus: { ...state.chorus },
    distortion: { ...state.distortion },
  };
}

export class ToneEffectsChain {
  private reverb: Tone.Freeverb | null = null;
  private delay: Tone.FeedbackDelay | null = null;
  private chorus: Tone.Chorus | null = null;
  private distortion: Tone.Distortion | null = null;
  private input: Tone.Gain | null = null;

  private state: EffectsState = cloneEffectsState(DEFAULT_EFFECTS_STATE);
  private savedState: EffectsState | null = null; // For bypass/restore
  private ready = false;
  private enabled = true;

  /**
   * Initialize the effects chain
   * Must be called after Tone.start() has been invoked
   */
  async initialize(): Promise<void> {
    if (this.ready) {
      logger.audio.log('ToneEffectsChain already initialized');
      return;
    }

    logger.audio.log('Initializing ToneEffectsChain...');

    // Create input gain node
    this.input = new Tone.Gain(1);

    // Create effects with default settings
    // Using Freeverb instead of Reverb for instant ready (no async IR generation)
    this.reverb = new Tone.Freeverb({
      roomSize: 0.7,
      dampening: 3000,
    });
    this.reverb.wet.value = this.state.reverb.wet;

    this.delay = new Tone.FeedbackDelay({
      delayTime: this.state.delay.time,
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

    // Connect chain: input → distortion → chorus → delay → reverb → destination
    this.input.connect(this.distortion);
    this.distortion.connect(this.chorus);
    this.chorus.connect(this.delay);
    this.delay.connect(this.reverb);
    this.reverb.toDestination();

    this.ready = true;
    logger.audio.log('ToneEffectsChain initialized');
  }

  /**
   * Get the input node for connecting audio sources
   */
  getInput(): Tone.Gain | null {
    return this.input;
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
    if (this.reverb && this.enabled) {
      this.reverb.wet.value = this.state.reverb.wet;
    }
  }

  setReverbDecay(decay: number): void {
    this.state.reverb.decay = clamp(decay, REVERB_MIN_DECAY, REVERB_MAX_DECAY);
    if (this.reverb) {
      // Freeverb uses roomSize (0-1) instead of decay
      // Map decay (0.1-10s) to roomSize (0.1-0.99)
      this.reverb.roomSize.value = clamp(this.state.reverb.decay / 10, 0.1, 0.99);
    }
  }

  // --- Delay Controls ---

  setDelayWet(wet: number): void {
    this.state.delay.wet = clamp(wet, 0, 1);
    if (this.delay && this.enabled) {
      this.delay.wet.value = this.state.delay.wet;
    }
  }

  setDelayTime(time: string): void {
    this.state.delay.time = time;
    if (this.delay) {
      this.delay.delayTime.value = time as Tone.Unit.Time;
    }
  }

  setDelayFeedback(feedback: number): void {
    this.state.delay.feedback = clamp(feedback, 0, DELAY_MAX_FEEDBACK);
    if (this.delay) {
      this.delay.feedback.value = this.state.delay.feedback;
    }
  }

  // --- Chorus Controls ---

  setChorusWet(wet: number): void {
    this.state.chorus.wet = clamp(wet, 0, 1);
    if (this.chorus && this.enabled) {
      this.chorus.wet.value = this.state.chorus.wet;
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
      this.distortion.wet.value = this.state.distortion.wet;
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
    }

    logger.audio.log('Applied effects state:', newState);
  }

  // --- Enable/Disable ---

  /**
   * Enable or disable all effects (bypass mode)
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;

    if (!enabled) {
      // Save current state and set all wet to 0
      this.savedState = cloneEffectsState(this.state);
      if (this.reverb) this.reverb.wet.value = 0;
      if (this.delay) this.delay.wet.value = 0;
      if (this.chorus) this.chorus.wet.value = 0;
      if (this.distortion) this.distortion.wet.value = 0;
    } else {
      // Restore saved state
      if (this.savedState) {
        if (this.reverb) this.reverb.wet.value = this.savedState.reverb.wet;
        if (this.delay) this.delay.wet.value = this.savedState.delay.wet;
        if (this.chorus) this.chorus.wet.value = this.savedState.chorus.wet;
        if (this.distortion) this.distortion.wet.value = this.savedState.distortion.wet;
        this.savedState = null;
      }
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
    this.distortion?.dispose();
    this.chorus?.dispose();
    this.delay?.dispose();
    this.reverb?.dispose();

    this.input = null;
    this.distortion = null;
    this.chorus = null;
    this.delay = null;
    this.reverb = null;

    this.ready = false;
    this.enabled = true;
    this.savedState = null;

    logger.audio.log('ToneEffectsChain disposed');
  }
}

// Singleton instance for the application
let effectsChainInstance: ToneEffectsChain | null = null;

/**
 * Get the singleton effects chain instance
 */
export function getEffectsChain(): ToneEffectsChain {
  if (!effectsChainInstance) {
    effectsChainInstance = new ToneEffectsChain();
  }
  return effectsChainInstance;
}

/**
 * Initialize Tone.js and the effects chain
 * Call this after a user gesture (e.g., play button click)
 */
export async function initializeToneEffects(): Promise<ToneEffectsChain> {
  // Start Tone.js audio context (requires user gesture)
  await Tone.start();
  logger.audio.log('Tone.js started, context state:', Tone.getContext().state);

  const chain = getEffectsChain();
  await chain.initialize();

  return chain;
}
