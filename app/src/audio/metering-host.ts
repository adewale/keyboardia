/**
 * MeteringHost — Main-thread host for the metering AudioWorklet.
 *
 * Receives RMS/peak levels from the worklet at ~60Hz and makes them
 * available to React components via subscription or direct lookup.
 */

import { loadWorkletModule } from './worklet-support';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────

export interface TrackMeterLevel {
  rms: number;
  peak: number;
  clipping: boolean;
}

interface MeterData {
  type: 'meters';
  levels: Array<{
    trackIndex: number;
    rms: number;
    peak: number;
    clipping: boolean;
  }>;
  timestamp: number;
}

type LevelsCallback = (levels: Map<string, TrackMeterLevel>) => void;

// ─── Host ────────────────────────────────────────────────────────────────

export class MeteringHost {
  private node: AudioWorkletNode | null = null;
  private levels = new Map<string, TrackMeterLevel>();
  private trackIdByIndex = new Map<number, string>();
  private indexByTrackId = new Map<string, number>();
  private listeners = new Set<LevelsCallback>();
  private nextTrackIndex = 0;
  private moduleLoaded = false;
  private audioContext: AudioContext | null = null;

  static readonly MAX_TRACKS = 16;

  /**
   * Initialize the metering worklet.
   * Returns false if the worklet couldn't be loaded.
   */
  async initialize(audioContext: AudioContext): Promise<boolean> {
    this.audioContext = audioContext;

    const moduleUrl = new URL('./worklets/metering.worklet.ts', import.meta.url);
    this.moduleLoaded = await loadWorkletModule(audioContext, moduleUrl, 'metering-worklet');

    if (!this.moduleLoaded) return false;

    this.node = new AudioWorkletNode(audioContext, 'metering-worklet', {
      numberOfInputs: MeteringHost.MAX_TRACKS,
      numberOfOutputs: 0,
      processorOptions: { trackCount: MeteringHost.MAX_TRACKS },
    });

    this.node.port.onmessage = (e: MessageEvent<MeterData>) => {
      if (e.data.type === 'meters') {
        this.handleMeters(e.data);
      }
    };

    logger.audio.log('MeteringHost initialized');
    return true;
  }

  /**
   * Connect a track bus output to a metering input.
   * Returns the input index used, or -1 if metering is not available.
   */
  connectTrack(trackId: string, busOutput: AudioNode): number {
    if (!this.node) return -1;

    // Reuse existing index if track was already connected
    let index = this.indexByTrackId.get(trackId);
    if (index === undefined) {
      index = this.nextTrackIndex++;
      if (index >= MeteringHost.MAX_TRACKS) {
        logger.audio.warn(`MeteringHost: max tracks (${MeteringHost.MAX_TRACKS}) reached`);
        return -1;
      }
      this.trackIdByIndex.set(index, trackId);
      this.indexByTrackId.set(trackId, index);
    }

    try {
      busOutput.connect(this.node, 0, index);
    } catch (err) {
      logger.audio.warn(`MeteringHost: failed to connect track ${trackId}:`, err);
      return -1;
    }

    return index;
  }

  /**
   * Disconnect a track from metering.
   */
  disconnectTrack(trackId: string): void {
    const index = this.indexByTrackId.get(trackId);
    if (index === undefined) return;
    this.trackIdByIndex.delete(index);
    this.indexByTrackId.delete(trackId);
    this.levels.delete(trackId);
  }

  /**
   * Get the current level for a track.
   */
  getLevel(trackId: string): TrackMeterLevel | undefined {
    return this.levels.get(trackId);
  }

  /**
   * Get all current levels.
   */
  getAllLevels(): Map<string, TrackMeterLevel> {
    return this.levels;
  }

  /**
   * Subscribe to level updates (called at ~60Hz).
   * Returns an unsubscribe function.
   */
  onLevels(callback: LevelsCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Check if metering is available.
   */
  isAvailable(): boolean {
    return this.moduleLoaded && this.node !== null;
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private handleMeters(data: MeterData): void {
    for (const level of data.levels) {
      const trackId = this.trackIdByIndex.get(level.trackIndex);
      if (trackId) {
        this.levels.set(trackId, {
          rms: level.rms,
          peak: level.peak,
          clipping: level.clipping,
        });
      }
    }

    for (const listener of this.listeners) {
      listener(this.levels);
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  dispose(): void {
    this.node?.disconnect();
    this.node = null;
    this.levels.clear();
    this.trackIdByIndex.clear();
    this.indexByTrackId.clear();
    this.listeners.clear();
    this.nextTrackIndex = 0;
    this.moduleLoaded = false;
    this.audioContext = null;
  }
}

export const meteringHost = new MeteringHost();
