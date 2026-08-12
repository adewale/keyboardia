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
import { meteringHost } from './metering-host';
import { logger } from '../utils/logger';
import { clampPan, clampVolume } from '../shared/validation';

export class TrackBusManager {
  private context: AudioContext;
  private masterGain: GainNode;
  private buses: Map<string, TrackBus> = new Map();
  /** Base faders are state, not transient node properties. Keep them even
   * before a lazy bus exists so loaded sessions sound correct on first play. */
  private desiredVolumes: Map<string, number> = new Map();
  /** Pan is authored state too; retain it across the second lazy-bus race. */
  private desiredPans: Map<string, number> = new Map();
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
      const desiredVolume = this.desiredVolumes.get(trackId);
      if (desiredVolume !== undefined) bus.setVolume(desiredVolume);
      const desiredPan = this.desiredPans.get(trackId);
      if (desiredPan !== undefined) bus.setPan(desiredPan);
      this.buses.set(trackId, bus);
      // Connect to metering worklet for VU meters
      if (meteringHost.isAvailable()) {
        meteringHost.connectTrack(trackId, bus.getOutputNode());
      }
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
    const clamped = clampVolume(volume);
    this.desiredVolumes.set(trackId, clamped);
    const bus = this.buses.get(trackId);
    if (bus && !bus.isDisposed()) {
      bus.setVolume(clamped);
    }
  }

  /**
   * Get volume for a track
   */
  getTrackVolume(trackId: string): number {
    const bus = this.buses.get(trackId);
    if (bus && !bus.isDisposed()) return bus.getVolume();
    return this.desiredVolumes.get(trackId) ?? 1;
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
    const clamped = clampPan(pan);
    this.desiredPans.set(trackId, clamped);
    const bus = this.buses.get(trackId);
    if (bus && !bus.isDisposed()) {
      bus.setPan(clamped);
    }
  }

  /**
   * Get pan for a track
   */
  getTrackPan(trackId: string): number {
    return this.desiredPans.get(trackId) ?? 0;
  }

  /**
   * Remove and dispose a bus for a track
   * Call this when a track is deleted
   */
  removeBus(trackId: string): void {
    const bus = this.buses.get(trackId);
    if (bus) {
      meteringHost.disconnectTrack(trackId, bus.getOutputNode());
      bus.dispose();
      this.buses.delete(trackId);
      logger.audio.log(`Removed TrackBus for track: ${trackId}`);
    }
    this.desiredVolumes.delete(trackId);
    this.desiredPans.delete(trackId);
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

  /** Authored controls can exist before a lazy audio bus; expose both for QA. */
  getKnownTrackIds(): string[] {
    return [...new Set([
      ...this.buses.keys(),
      ...this.desiredVolumes.keys(),
      ...this.desiredPans.keys(),
    ])];
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
    this.desiredVolumes.clear();
    this.desiredPans.clear();
    logger.audio.log('TrackBusManager disposed');
  }

  /**
   * Check if manager has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}
