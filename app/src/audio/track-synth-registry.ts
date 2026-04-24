/**
 * TrackSynthRegistry — owns one synth-engine instance per track.
 *
 * Motivation: the audio engine used to hold a single shared
 * ToneSynthManager and a single shared AdvancedSynthEngine and mutate
 * the output destination on every note. That hijacked still-sustaining
 * notes from other tracks into the newly-playing track's bus (bug #6).
 *
 * With this registry each active track gets its own engine instance,
 * statically connected to that track's bus. Instances are created
 * lazily (or eagerly via preload) and disposed when the track goes
 * away or changes instrument category.
 */

export interface TrackSynthRegistryOptions<T> {
  /** Build a fresh synth instance for a track. Usually async init. */
  factory: (trackId: string) => Promise<T>;
  /** Tear down a synth instance when a track is removed or cleared. */
  dispose?: (synth: T) => void;
}

export class TrackSynthRegistry<T> {
  private synths = new Map<string, T>();
  private pending = new Map<string, Promise<T>>();

  constructor(private readonly options: TrackSynthRegistryOptions<T>) {}

  get size(): number {
    return this.synths.size;
  }

  has(trackId: string): boolean {
    return this.synths.has(trackId);
  }

  /**
   * Non-blocking read. Returns the synth if it has already been
   * created (either by a completed getOrCreate or a prior preload),
   * otherwise null. Use on the hot path so the scheduler doesn't
   * await during note dispatch.
   */
  getIfReady(trackId: string): T | null {
    return this.synths.get(trackId) ?? null;
  }

  /** The list of track IDs that currently have synth instances. */
  activeTrackIds(): string[] {
    return Array.from(this.synths.keys());
  }

  /**
   * Return the synth for this track, creating it on first request.
   * Concurrent calls for the same track share one in-flight factory call.
   */
  async getOrCreate(trackId: string): Promise<T> {
    const existing = this.synths.get(trackId);
    if (existing !== undefined) return existing;

    const inFlight = this.pending.get(trackId);
    if (inFlight) return inFlight;

    const p = this.options.factory(trackId).then(
      (synth) => {
        this.pending.delete(trackId);
        this.synths.set(trackId, synth);
        return synth;
      },
      (err) => {
        this.pending.delete(trackId);
        throw err;
      },
    );
    this.pending.set(trackId, p);
    return p;
  }

  remove(trackId: string): void {
    const synth = this.synths.get(trackId);
    if (synth !== undefined) {
      this.options.dispose?.(synth);
      this.synths.delete(trackId);
    }
  }

  clear(): void {
    for (const synth of this.synths.values()) {
      this.options.dispose?.(synth);
    }
    this.synths.clear();
    this.pending.clear();
  }

  /**
   * Apply an operation to every currently-registered synth. Used by
   * global controls (XY pad, FM params) to fan out state changes.
   */
  forEach(op: (synth: T, trackId: string) => void): void {
    for (const [trackId, synth] of this.synths.entries()) {
      op(synth, trackId);
    }
  }
}
