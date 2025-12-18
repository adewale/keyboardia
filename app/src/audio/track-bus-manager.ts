/**
 * TrackBusManager - Manages audio buses for all tracks
 *
 * Phase 25: Unified Audio Bus Architecture
 *
 * This manager ensures all audio sources route through consistent per-track buses,
 * solving the problem where synths bypassed track-level volume controls.
 *
 * Architecture:
 *   ALL SOURCES → TrackBus[trackId] → MasterBus → Effects → Destination
 *
 * Features:
 * - Lazy bus creation (only create when track first plays)
 * - Automatic cleanup when tracks are deleted
 * - Consistent volume/mute/pan control for all instrument types
 */

import { TrackBus } from './track-bus';
import { logger } from '../utils/logger';

export class TrackBusManager {
  private context: AudioContext;
  private masterGain: GainNode;
  private buses: Map<string, TrackBus> = new Map();
  private disposed = false;

  constructor(context: AudioContext, masterGain: GainNode) {
    this.context = context;
    this.masterGain = masterGain;
    logger.audio.log('TrackBusManager initialized');
  }

  /**
   * Get or create a bus for the given track ID
   * Creates lazily on first access
   */
  getOrCreateBus(trackId: string): TrackBus {
    if (this.disposed) {
      throw new Error('TrackBusManager has been disposed');
    }

    let bus = this.buses.get(trackId);
    if (!bus || bus.isDisposed()) {
      bus = new TrackBus(this.context, this.masterGain);
      this.buses.set(trackId, bus);
      logger.audio.log(`Created TrackBus for track: ${trackId}`);
    }
    return bus;
  }

  /**
   * Get the input node for a track (for connecting audio sources)
   * This is the primary method used by play methods in the engine
   */
  getBusInput(trackId: string): GainNode {
    return this.getOrCreateBus(trackId).getInput();
  }

  /**
   * Check if a bus exists for the given track
   */
  hasBus(trackId: string): boolean {
    const bus = this.buses.get(trackId);
    return bus !== undefined && !bus.isDisposed();
  }

  /**
   * Set volume for a track (0-1)
   */
  setTrackVolume(trackId: string, volume: number): void {
    const bus = this.buses.get(trackId);
    if (bus && !bus.isDisposed()) {
      bus.setVolume(volume);
    }
  }

  /**
   * Get volume for a track
   */
  getTrackVolume(trackId: string): number {
    const bus = this.buses.get(trackId);
    return bus && !bus.isDisposed() ? bus.getVolume() : 1;
  }

  /**
   * Set muted state for a track
   */
  setTrackMuted(trackId: string, muted: boolean): void {
    const bus = this.buses.get(trackId);
    if (bus && !bus.isDisposed()) {
      bus.setMuted(muted);
    }
  }

  /**
   * Check if a track is muted
   */
  isTrackMuted(trackId: string): boolean {
    const bus = this.buses.get(trackId);
    return bus && !bus.isDisposed() ? bus.isMuted() : false;
  }

  /**
   * Set pan for a track (-1 to 1)
   */
  setTrackPan(trackId: string, pan: number): void {
    const bus = this.buses.get(trackId);
    if (bus && !bus.isDisposed()) {
      bus.setPan(pan);
    }
  }

  /**
   * Get pan for a track
   */
  getTrackPan(trackId: string): number {
    const bus = this.buses.get(trackId);
    return bus && !bus.isDisposed() ? bus.getPan() : 0;
  }

  /**
   * Remove and dispose a bus for a track
   * Call this when a track is deleted
   */
  removeBus(trackId: string): void {
    const bus = this.buses.get(trackId);
    if (bus) {
      bus.dispose();
      this.buses.delete(trackId);
      logger.audio.log(`Removed TrackBus for track: ${trackId}`);
    }
  }

  /**
   * Get all active bus track IDs
   */
  getActiveTrackIds(): string[] {
    return Array.from(this.buses.keys()).filter(id => {
      const bus = this.buses.get(id);
      return bus && !bus.isDisposed();
    });
  }

  /**
   * Get the number of active buses
   */
  getBusCount(): number {
    return this.getActiveTrackIds().length;
  }

  /**
   * Dispose all buses and clean up
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const [trackId, bus] of this.buses.entries()) {
      bus.dispose();
      logger.audio.log(`Disposed TrackBus for track: ${trackId}`);
    }
    this.buses.clear();
    logger.audio.log('TrackBusManager disposed');
  }

  /**
   * Check if manager has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}
