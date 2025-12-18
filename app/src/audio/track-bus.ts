/**
 * TrackBus - Audio routing chain for a single track
 *
 * Phase 25: Unified Audio Bus Architecture
 *
 * This class provides consistent audio routing for all instrument types:
 * - Samples (kick, snare, etc.)
 * - Built-in synths (synth:bass, synth:lead)
 * - Tone.js synths (tone:fm-epiano, tone:membrane-kick)
 * - Advanced synths (advanced:*)
 * - Sampled instruments (sampled:piano)
 *
 * Audio Chain:
 *   Source → InputGain → VolumeGain → MuteGain → PanNode → OutputGain → Destination
 *
 * This solves the problem where synths were bypassing track-level volume controls.
 */

import { logger } from '../utils/logger';

export class TrackBus {
  private context: AudioContext;
  private inputGain: GainNode;
  private volumeGain: GainNode;
  private muteGain: GainNode;
  private panNode: StereoPannerNode;
  private outputGain: GainNode;
  private disposed = false;

  constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;

    // Create audio nodes
    this.inputGain = context.createGain();
    this.volumeGain = context.createGain();
    this.muteGain = context.createGain();
    this.panNode = context.createStereoPanner();
    this.outputGain = context.createGain();

    // Connect chain: input → volume → mute → pan → output → destination
    this.inputGain.connect(this.volumeGain);
    this.volumeGain.connect(this.muteGain);
    this.muteGain.connect(this.panNode);
    this.panNode.connect(this.outputGain);
    this.outputGain.connect(destination);

    // Set defaults
    this.inputGain.gain.value = 1;
    this.volumeGain.gain.value = 1;
    this.muteGain.gain.value = 1;
    this.panNode.pan.value = 0;
    this.outputGain.gain.value = 1;

    logger.audio.log('TrackBus created');
  }

  /**
   * Get the input node for connecting sources
   * All audio sources should connect to this node
   */
  getInput(): GainNode {
    return this.inputGain;
  }

  /**
   * Set track volume (0-1)
   * Applied via volumeGain node
   */
  setVolume(value: number): void {
    if (this.disposed) return;
    const clampedValue = Math.max(0, Math.min(1, value));
    this.volumeGain.gain.setValueAtTime(clampedValue, this.context.currentTime);
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.volumeGain.gain.value;
  }

  /**
   * Set track muted state
   * Uses muteGain (0 = muted, 1 = unmuted) for smooth transitions
   */
  setMuted(muted: boolean): void {
    if (this.disposed) return;
    // Use ramp for smooth mute/unmute to avoid clicks
    const targetValue = muted ? 0 : 1;
    this.muteGain.gain.setTargetAtTime(targetValue, this.context.currentTime, 0.01);
  }

  /**
   * Check if track is muted
   */
  isMuted(): boolean {
    return this.muteGain.gain.value < 0.5;
  }

  /**
   * Set track pan position (-1 = left, 0 = center, 1 = right)
   */
  setPan(value: number): void {
    if (this.disposed) return;
    const clampedValue = Math.max(-1, Math.min(1, value));
    this.panNode.pan.setValueAtTime(clampedValue, this.context.currentTime);
  }

  /**
   * Get current pan value
   */
  getPan(): number {
    return this.panNode.pan.value;
  }

  /**
   * Set output gain (for overall track level adjustment)
   */
  setOutputGain(value: number): void {
    if (this.disposed) return;
    const clampedValue = Math.max(0, Math.min(2, value)); // Allow boost up to 2x
    this.outputGain.gain.setValueAtTime(clampedValue, this.context.currentTime);
  }

  /**
   * Check if this bus has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Dispose all audio nodes
   * Call this when the track is deleted
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    try {
      this.inputGain.disconnect();
      this.volumeGain.disconnect();
      this.muteGain.disconnect();
      this.panNode.disconnect();
      this.outputGain.disconnect();
      logger.audio.log('TrackBus disposed');
    } catch (err) {
      // Ignore errors during disposal (nodes may already be disconnected)
      logger.audio.warn('Error during TrackBus disposal:', err);
    }
  }
}
