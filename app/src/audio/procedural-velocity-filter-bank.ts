import {
  proceduralVelocityLowpassHz,
  VELOCITY_FILTER_TIME_CONSTANT_SECONDS,
} from './velocity-timbre';

interface VelocityFilterEntry {
  filter: BiquadFilterNode;
  output: AudioNode;
}

/**
 * Reuses one soft-velocity filter per track. Canonical and hard hits retain the
 * exact bypass path; soft hits share a smoothly automated track-local filter
 * instead of allocating one BiquadFilterNode per note.
 */
export class ProceduralVelocityFilterBank {
  private readonly filters = new Map<string, VelocityFilterEntry>();
  private readonly context: BaseAudioContext;

  constructor(context: BaseAudioContext) {
    this.context = context;
  }

  connect(
    source: AudioNode,
    output: AudioNode,
    trackId: string,
    sampleId: string,
    midiVelocity: number,
    time: number,
  ): number | null {
    const cutoffHz = proceduralVelocityLowpassHz(sampleId, midiVelocity);
    if (cutoffHz === null) {
      source.connect(output);
      return null;
    }

    const scheduledTime = Math.max(this.context.currentTime, time);
    const cutoff = Math.min(cutoffHz, this.context.sampleRate * 0.5);
    let entry = this.filters.get(trackId);
    if (entry && entry.output !== output) {
      entry.filter.disconnect();
      this.filters.delete(trackId);
      entry = undefined;
    }

    if (!entry) {
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.2;
      filter.frequency.setValueAtTime(cutoff, scheduledTime);
      filter.connect(output);
      entry = { filter, output };
      this.filters.set(trackId, entry);
    } else {
      entry.filter.frequency.setTargetAtTime(
        cutoff,
        scheduledTime,
        VELOCITY_FILTER_TIME_CONSTANT_SECONDS,
      );
    }

    source.connect(entry.filter);
    return cutoff;
  }

  remove(trackId: string): void {
    const entry = this.filters.get(trackId);
    entry?.filter.disconnect();
    this.filters.delete(trackId);
  }

  clear(): void {
    for (const entry of this.filters.values()) entry.filter.disconnect();
    this.filters.clear();
  }

  get size(): number {
    return this.filters.size;
  }
}
