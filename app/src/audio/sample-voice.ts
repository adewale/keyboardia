import type { EnvelopeModel, SamplePlaybackMode } from '../shared/envelope-contract-v2';
import type { ChokeableGainParam, ChokeableVoice } from './choke-groups';
import { RELEASE_TAIL_GUARD_SEC } from './note-schedule';

export const ENVELOPE_EPSILON = 0.0001;

export interface SampleVoiceEnvelope {
  model: EnvelopeModel;
  attackSeconds: number;
  holdSeconds?: number;
  decaySeconds?: number;
  sustain?: number;
  releaseSeconds?: number;
}

export type SampleVoiceState = 'scheduled' | 'released' | 'stopped' | 'complete';

export interface SampleVoiceComponent {
  source: AudioBufferSourceNode;
  gain: GainNode;
  peak: number;
  /** Natural source completion on the AudioContext clock, when known. */
  naturalEndSeconds?: number;
  /** Optional deferred source start, used so release nodes are owned first. */
  start?: () => void;
}

export interface SampleVoiceHandle {
  readonly id: string;
  readonly mode: SamplePlaybackMode;
  readonly startedAtSeconds: number;
  readonly state: SampleVoiceState;
  readonly completionSeconds: number | null;
  readonly completion: Promise<void>;
  readonly sourceCount: number;
  readonly gainCount: number;
  /** Scheduler-owned note-off. Trigger voices deliberately ignore it. */
  gate(when: number): boolean;
  /** Explicit note-off/release. Trigger voices deliberately ignore it. */
  release(when: number): boolean;
  /** Hard stop, used for disposal, choking, and deterministic voice stealing. */
  stop(when: number): void;
}

interface OwnedComponent extends SampleVoiceComponent {
  ended: boolean;
  primary: boolean;
}

export interface ManagedSampleVoiceOptions {
  id: string;
  mode: SamplePlaybackMode;
  startedAtSeconds: number;
  envelope: SampleVoiceEnvelope;
  onRelease?: (when: number, heldSeconds: number) => readonly SampleVoiceComponent[];
  onComplete?: () => void;
}

function nonNegative(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function holdParam(param: AudioParam, value: number, when: number): void {
  const withHold = param as AudioParam & { cancelAndHoldAtTime?: (time: number) => AudioParam };
  if (typeof withHold.cancelAndHoldAtTime === 'function') {
    withHold.cancelAndHoldAtTime(when);
  } else {
    param.cancelScheduledValues(when);
  }
  param.setValueAtTime(Math.max(ENVELOPE_EPSILON, value), when);
}

/**
 * One sample voice owns every velocity-blend, loop, and release-trigger node.
 * Cleanup is driven exclusively by AudioBufferSourceNode `ended` events and
 * AudioContext timestamps; there is no wall-clock timer fallback.
 */
export class ManagedSampleVoice implements SampleVoiceHandle, ChokeableVoice {
  readonly id: string;
  readonly mode: SamplePlaybackMode;
  readonly startedAtSeconds: number;
  readonly completion: Promise<void>;
  readonly gain: ChokeableGainParam;

  private readonly envelope: SampleVoiceEnvelope;
  private readonly components: OwnedComponent[] = [];
  private readonly onRelease?: ManagedSampleVoiceOptions['onRelease'];
  private readonly onComplete?: ManagedSampleVoiceOptions['onComplete'];
  private resolveCompletion!: () => void;
  private currentState: SampleVoiceState = 'scheduled';
  private plannedCompletionSeconds: number | null = null;
  private releaseAtSeconds: number | null = null;

  constructor(options: ManagedSampleVoiceOptions) {
    this.id = options.id;
    this.mode = options.mode;
    this.startedAtSeconds = options.startedAtSeconds;
    this.envelope = options.envelope;
    this.onRelease = options.onRelease;
    this.onComplete = options.onComplete;
    this.completion = new Promise<void>(resolve => {
      this.resolveCompletion = resolve;
    });
    this.gain = {
      cancelScheduledValues: (when: number) => {
        this.components.forEach(component => component.gain.gain.cancelScheduledValues(when));
      },
      setTargetAtTime: (value: number, when: number, timeConstant: number) => {
        this.components.forEach(component => {
          component.gain.gain.setTargetAtTime(value, when, timeConstant);
        });
      },
    };
  }

  get state(): SampleVoiceState {
    return this.currentState;
  }

  get completionSeconds(): number | null {
    return this.plannedCompletionSeconds;
  }

  get sourceCount(): number {
    return this.components.length;
  }

  get gainCount(): number {
    return this.components.length;
  }

  /** Compatibility seam for the legacy playNote return value. */
  get primarySource(): AudioBufferSourceNode | null {
    return this.components.find(component => component.primary)?.source ?? null;
  }

  addPrimaryComponent(component: SampleVoiceComponent): void {
    const owned = this.own(component, true);
    const stopAt = this.schedulePrimaryEnvelope(owned);
    owned.start?.();
    if (stopAt !== null) this.safeStop(owned.source, stopAt);
  }

  private addReleaseComponent(component: SampleVoiceComponent): void {
    const owned = this.own(component, false);
    owned.gain.gain.setValueAtTime(owned.peak, this.releaseAtSeconds ?? this.startedAtSeconds);
    component.start?.();
  }

  private own(component: SampleVoiceComponent, primary: boolean): OwnedComponent {
    const owned: OwnedComponent = { ...component, primary, ended: false };
    this.components.push(owned);
    if (component.naturalEndSeconds !== undefined && Number.isFinite(component.naturalEndSeconds)) {
      this.extendCompletion(component.naturalEndSeconds);
    }
    component.source.onended = () => {
      if (owned.ended) return;
      owned.ended = true;
      component.source.disconnect();
      component.gain.disconnect();
      this.finishIfEnded();
    };
    return owned;
  }

  private schedulePrimaryEnvelope(component: SampleVoiceComponent): number | null {
    const param = component.gain.gain;
    const attack = nonNegative(this.envelope.attackSeconds);
    const attackEnd = this.startedAtSeconds + attack;
    param.setValueAtTime(ENVELOPE_EPSILON, this.startedAtSeconds);
    // A zero-time ramp is an immediate transition and preserves authored zero.
    param.linearRampToValueAtTime(component.peak, attackEnd);

    if (this.envelope.model === 'ad' || this.envelope.model === 'ahd') {
      const decay = this.envelope.decaySeconds;
      if (decay === undefined || !Number.isFinite(decay)) return null;
      const hold = this.envelope.model === 'ahd' ? nonNegative(this.envelope.holdSeconds) : 0;
      const decayStart = attackEnd + hold;
      if (hold > 0) param.setValueAtTime(component.peak, decayStart);
      const decayEnd = decayStart + nonNegative(decay);
      param.linearRampToValueAtTime(ENVELOPE_EPSILON, decayEnd);
      const stopAt = decayEnd + RELEASE_TAIL_GUARD_SEC;
      param.linearRampToValueAtTime(0, stopAt);
      component.naturalEndSeconds = stopAt;
      this.recomputeCompletion();
      return stopAt;
    }

    if (this.envelope.model === 'adsr') {
      const decay = nonNegative(this.envelope.decaySeconds);
      const sustain = Math.min(1, Math.max(0, this.envelope.sustain ?? 1));
      param.linearRampToValueAtTime(
        Math.max(ENVELOPE_EPSILON, component.peak * sustain),
        attackEnd + decay,
      );
    }
    return null;
  }

  gate(when: number): boolean {
    return this.release(when);
  }

  release(when: number): boolean {
    if (this.mode === 'trigger' || this.currentState !== 'scheduled') return false;
    const releaseAt = Math.max(this.startedAtSeconds, Number.isFinite(when) ? when : this.startedAtSeconds);
    this.releaseAtSeconds = releaseAt;
    this.currentState = 'released';

    const releaseComponents = this.onRelease?.(
      releaseAt,
      Math.max(0, releaseAt - this.startedAtSeconds),
    ) ?? [];
    releaseComponents.forEach(component => this.addReleaseComponent(component));

    const releaseSeconds = nonNegative(this.envelope.releaseSeconds);
    const releaseEnd = releaseAt + releaseSeconds;
    const stopAt = releaseEnd + RELEASE_TAIL_GUARD_SEC;
    for (const component of this.components) {
      if (!component.primary || component.ended) continue;
      const amplitude = this.amplitudeAt(component.peak, releaseAt);
      const attackEnd = this.startedAtSeconds + nonNegative(this.envelope.attackSeconds);
      if (releaseAt < attackEnd) {
        component.gain.gain.cancelScheduledValues(releaseAt);
        component.gain.gain.linearRampToValueAtTime(amplitude, releaseAt);
      } else {
        holdParam(component.gain.gain, amplitude, releaseAt);
      }
      if (releaseSeconds > 0) {
        component.gain.gain.exponentialRampToValueAtTime(ENVELOPE_EPSILON, releaseEnd);
      } else {
        component.gain.gain.setValueAtTime(ENVELOPE_EPSILON, releaseAt);
      }
      component.gain.gain.linearRampToValueAtTime(0, stopAt);
      this.safeStop(component.source, stopAt);
      component.naturalEndSeconds = stopAt;
    }
    this.recomputeCompletion();
    return true;
  }

  stop(when: number): void {
    if (this.currentState === 'complete') return;
    const stopAt = Math.max(this.startedAtSeconds, Number.isFinite(when) ? when : this.startedAtSeconds);
    this.currentState = 'stopped';
    for (const component of this.components) {
      if (!component.ended) {
        this.safeStop(component.source, stopAt);
        component.naturalEndSeconds = stopAt;
      }
    }
    this.recomputeCompletion();
  }

  private amplitudeAt(peak: number, when: number): number {
    const attack = nonNegative(this.envelope.attackSeconds);
    const attackEnd = this.startedAtSeconds + attack;
    if (when <= this.startedAtSeconds) return ENVELOPE_EPSILON;
    if (attack > 0 && when < attackEnd) {
      const progress = (when - this.startedAtSeconds) / attack;
      return ENVELOPE_EPSILON + (peak - ENVELOPE_EPSILON) * progress;
    }
    if (this.envelope.model !== 'adsr') return peak;
    const decay = nonNegative(this.envelope.decaySeconds);
    const decayEnd = attackEnd + decay;
    const sustain = Math.max(ENVELOPE_EPSILON, peak * Math.min(1, Math.max(0, this.envelope.sustain ?? 1)));
    if (decay > 0 && when < decayEnd) {
      const progress = (when - attackEnd) / decay;
      return peak + (sustain - peak) * Math.max(0, progress);
    }
    return sustain;
  }

  private safeStop(source: AudioBufferSourceNode, when: number): void {
    try {
      source.stop(when);
    } catch {
      // A naturally ended blend component is already stopped.
    }
  }

  private extendCompletion(when: number): void {
    if (!Number.isFinite(when)) return;
    this.plannedCompletionSeconds = Math.max(this.plannedCompletionSeconds ?? 0, when);
  }

  private recomputeCompletion(): void {
    const planned = this.components
      .filter(component => !component.ended)
      .map(component => component.naturalEndSeconds)
      .filter((when): when is number => when !== undefined && Number.isFinite(when));
    this.plannedCompletionSeconds = planned.length > 0 ? Math.max(...planned) : null;
  }

  private finishIfEnded(): void {
    if (this.components.length === 0 || this.components.some(component => !component.ended)) return;
    this.currentState = 'complete';
    this.resolveCompletion();
    this.onComplete?.();
  }
}
