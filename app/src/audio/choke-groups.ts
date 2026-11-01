/**
 * Choke groups for sampled instruments (P5 in SAMPLE-AUDIT-2026-06).
 *
 * A closed hi-hat hit must silence a ringing open hi-hat — on a real
 * kit they are the same physical cymbals. Open and closed hats are
 * *different* SampledInstrument instances here, so choking lives in a
 * registry shared across instruments rather than inside any one of them.
 *
 * Invariants (property-tested in choke-groups.test.ts):
 *  - after any sequence of cuts, at most one voice is active per group
 *  - a voice is cut at most once, and never after it was removed
 *  - groups are fully independent
 */

/** Time constant for the choke fade (setTargetAtTime); ~63% decay per constant. */
export const CHOKE_FADE_TIME_CONSTANT = 0.01;

/** When to hard-stop a choked source after the fade begins (≈ 6 time constants). */
export const CHOKE_STOP_DELAY = 0.06;

/**
 * The slice of AudioParam a choke needs. Structural (return types are
 * `unknown`) so both the real AudioParam and test fakes satisfy it.
 */
export interface ChokeableGainParam {
  cancelScheduledValues(time: number): unknown;
  setTargetAtTime(value: number, time: number, timeConstant: number): unknown;
}

export interface ChokeableVoice {
  /** The gain param controlling the voice's level. */
  gain: ChokeableGainParam;
  /** Stop the underlying source at the given audio-context time. */
  stop(when: number): void;
}

export class ChokeGroupRegistry {
  private groups = new Map<string, Set<ChokeableVoice>>();

  /**
   * Cut every voice currently in `group` at time `when`, then register
   * `voice` as the group's (sole) active voice.
   */
  cutAndRegister(group: string, voice: ChokeableVoice, when: number): void {
    const active = this.groups.get(group);
    if (active) {
      for (const old of active) {
        // Kill any pending release automation, fade fast, then stop.
        old.gain.cancelScheduledValues(when);
        old.gain.setTargetAtTime(0, when, CHOKE_FADE_TIME_CONSTANT);
        old.stop(when + CHOKE_STOP_DELAY);
      }
      active.clear();
      active.add(voice);
    } else {
      this.groups.set(group, new Set([voice]));
    }
  }

  /** Deregister a voice (e.g. its source ended naturally). Safe for unknowns. */
  remove(group: string, voice: ChokeableVoice): void {
    this.groups.get(group)?.delete(voice);
  }

  /** Number of voices currently registered in a group. */
  activeCount(group: string): number {
    return this.groups.get(group)?.size ?? 0;
  }
}

/**
 * Shared registry for all sampled instruments. Instruments receive it by
 * injection (testable) but default to this singleton so cross-instrument
 * groups (open hat ↔ closed hat) work without wiring.
 */
export const sampledInstrumentChokeRegistry = new ChokeGroupRegistry();
