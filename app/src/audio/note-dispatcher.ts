import { audioEngine } from './engine';
import { secondsToMilliseconds } from './audio-time';
import {
  createInstrumentRendererRegistry,
  type InstrumentRendererRegistry,
} from './instrument-renderer';
import {
  DEFAULT_LATENESS_POLICY,
  resolveDispatchTime,
  type DispatchTimeDecision,
  type LatenessPolicy,
} from './lateness-policy';
import type { ResolvedNoteEvent } from './resolved-note-event';
import type { AudioTime } from './audio-time';

let rendererRegistry: InstrumentRendererRegistry | undefined;

function getRendererRegistry(): InstrumentRendererRegistry {
  // engine.ts imports the scheduler, which imports this module. Binding the
  // singleton at module evaluation time therefore creates a production-only
  // temporal-dead-zone failure after Rollup flattens the cycle. Resolve it on
  // first dispatch, after every module in the cycle has initialized instead.
  rendererRegistry ??= createInstrumentRendererRegistry(audioEngine);
  return rendererRegistry;
}

export interface DispatchMetricsSink {
  recordJitter(ms: number): void;
  recordLateNote(): void;
}

export function dispatchResolvedNote(
  event: ResolvedNoteEvent,
  currentTime: AudioTime,
  metrics?: DispatchMetricsSink,
  policy: LatenessPolicy = DEFAULT_LATENESS_POLICY,
): DispatchTimeDecision {
  const decision = resolveDispatchTime(event.when, currentTime, policy);
  metrics?.recordJitter(Math.abs(secondsToMilliseconds(decision.lateness)));
  if (decision.lateness > 0) metrics?.recordLateNote();

  if (decision.kind === 'drop') return decision;
  getRendererRegistry().schedule(
    decision.kind === 'on-time' ? event : { ...event, when: decision.time },
  );
  return decision;
}
