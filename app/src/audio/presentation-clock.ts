import type { AudioClock, AudioTime } from './audio-time';

export interface PresentationFrameSource {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

interface PresentationEntry {
  at: AudioTime;
  callback: () => void;
}

const MAX_PENDING_PER_CHANNEL = 8;

function browserFrameSource(): PresentationFrameSource {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return {
      request: callback => globalThis.requestAnimationFrame(() => callback()),
      cancel: handle => globalThis.cancelAnimationFrame(handle),
    };
  }
  return {
    request: callback => globalThis.setTimeout(callback, 16) as unknown as number,
    cancel: handle => globalThis.clearTimeout(handle),
  };
}

/**
 * Lossy visual scheduler derived from the audio clock.
 *
 * Audio events never depend on this class. Each visual channel is bounded and
 * overdue callbacks coalesce to its newest state, so a throttled tab cannot
 * accumulate an unbounded timer backlog or replay stale playhead frames.
 */
export class PresentationClock {
  private readonly pending = new Map<string, PresentationEntry[]>();
  private frameHandle: number | null = null;
  private readonly audioClock: AudioClock;
  private readonly frames: PresentationFrameSource;

  constructor(
    audioClock: AudioClock,
    frames: PresentationFrameSource = browserFrameSource(),
  ) {
    this.audioClock = audioClock;
    this.frames = frames;
  }

  get pendingCount(): number {
    let count = 0;
    for (const entries of this.pending.values()) count += entries.length;
    return count;
  }

  schedule(channel: string, at: AudioTime, callback: () => void): void {
    const entries = this.pending.get(channel) ?? [];
    entries.push({ at, callback });
    entries.sort((left, right) => left.at - right.at);
    if (entries.length > MAX_PENDING_PER_CHANNEL) {
      entries.splice(0, entries.length - MAX_PENDING_PER_CHANNEL);
    }
    this.pending.set(channel, entries);
    this.requestFrame();
  }

  clear(): void {
    this.pending.clear();
    if (this.frameHandle !== null) {
      this.frames.cancel(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private requestFrame(): void {
    if (this.frameHandle !== null) return;
    this.frameHandle = this.frames.request(() => this.onFrame());
  }

  private onFrame(): void {
    this.frameHandle = null;
    const now = this.audioClock.now();

    for (const [channel, entries] of this.pending) {
      let newestDue = -1;
      for (let index = 0; index < entries.length; index++) {
        if (entries[index].at <= now) newestDue = index;
        else break;
      }
      if (newestDue >= 0) {
        const [{ callback }] = entries.splice(newestDue, 1);
        entries.splice(0, newestDue);
        callback();
      }
      if (entries.length === 0) this.pending.delete(channel);
    }

    if (this.pendingCount > 0) this.requestFrame();
  }
}
