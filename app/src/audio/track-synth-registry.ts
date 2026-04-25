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
  private readonly options: TrackSynthRegistryOptions<T>;

  constructor(options: TrackSynthRegistryOptions<T>) {
    this.options = options;
  }

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
   *
   * If `remove(trackId)` or `clear()` runs while the factory is still
   * resolving, the racing result is disposed instead of stored — see
   * bug_006. The pending entry is the cancellation token: when our
   * `pending.get(trackId)` no longer points at our own promise, we know
   * we've been cancelled.
   */
  async getOrCreate(trackId: string): Promise<T> {
    const existing = this.synths.get(trackId);
    if (existing !== undefined) return existing;

    const inFlight = this.pending.get(trackId);
    if (inFlight) return inFlight;

    const p: Promise<T> = this.options.factory(trackId).then(
      (synth) => {
        // Was a remove() or clear() ran while we were awaiting the factory?
        // If the pending slot has been cleared (or replaced by a newer
        // getOrCreate's promise), drop this orphan synth on the floor.
        if (this.pending.get(trackId) !== p) {
          this.options.dispose?.(synth);
          return synth;
        }
        this.pending.delete(trackId);
        this.synths.set(trackId, synth);
        return synth;
      },
      (err) => {
        if (this.pending.get(trackId) === p) {
          this.pending.delete(trackId);
        }
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
    // Cancel any in-flight factory for this track. Its .then handler will
    // see the missing pending entry and dispose the synth on resolution.
    this.pending.delete(trackId);
  }

  clear(): void {
    for (const synth of this.synths.values()) {
      this.options.dispose?.(synth);
    }
    this.synths.clear();
    // Cancel every in-flight factory; pending .then handlers dispose on resolve.
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
