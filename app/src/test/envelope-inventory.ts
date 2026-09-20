import { ENVELOPE_CAPABILITY_REGISTRY } from '../shared/envelope-capabilities';

export type EnvelopeEngineFamily = 'native' | 'advanced' | 'tone' | 'sampled' | 'procedural';

export interface EnvelopeRendererInventoryRow {
  instrumentId: string;
  family: EnvelopeEngineFamily;
  scheduled: boolean;
  preview: boolean;
  mainThread: boolean;
  worklet: boolean;
}

function familyForInstrument(instrumentId: string): EnvelopeEngineFamily {
  if (instrumentId.startsWith('synth:')) return 'native';
  if (instrumentId.startsWith('advanced:')) return 'advanced';
  if (instrumentId.startsWith('tone:')) return 'tone';
  if (instrumentId.startsWith('sampled:')) return 'sampled';
  return 'procedural';
}

/** Generated from the catalogue-backed capability registry; omissions fail tests. */
export const ENVELOPE_RENDERER_INVENTORY: readonly EnvelopeRendererInventoryRow[] =
  Object.freeze(Object.keys(ENVELOPE_CAPABILITY_REGISTRY).sort().map(instrumentId => ({
    instrumentId,
    family: familyForInstrument(instrumentId),
    scheduled: true,
    preview: true,
    mainThread: true,
    worklet: true,
  })));

export const ENVELOPE_SCHEDULER_PATHS = Object.freeze([
  { id: 'main-thread', module: 'src/audio/scheduler.ts', timingAuthority: 'audio-context' },
  { id: 'audio-worklet', module: 'src/audio/worklets/scheduler.worklet.ts', timingAuthority: 'audio-context' },
  { id: 'direct-preview', module: 'src/audio/engine.ts', timingAuthority: 'audio-context' },
] as const);

export const ENVELOPE_VERTICAL_TRIO = Object.freeze([
  { instrumentId: 'synth:pad', purpose: 'sustaining oscillator ADSR' },
  { instrumentId: 'sampled:piano', purpose: 'finite natural AHD/AR' },
  { instrumentId: 'sampled:hammond-organ', purpose: 'validated-loop sample ADSR' },
] as const);
