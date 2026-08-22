import type { EnvelopeCapabilityV2 } from '../envelope-contract-v2';

export const PLANNED_ENVELOPE_NOTATION_FEATURES = [
  'model-ad',
  'model-ahd',
  'model-ar',
  'model-adsr',
  'play-trigger',
  'play-gate',
  'play-loop',
  'duration-ms',
  'duration-seconds',
  'duration-steps',
  'mixed-duration-units',
  'gate-boundaries',
  'inline-ties',
  'cyclic-ties',
  'sparse-locks',
  'lock-precedence-input',
  'ghosts-and-accents',
  'polyrhythm',
  'legacy-v23-import',
  'legacy-dense-locks',
  'canonical-v24-output',
  'preset-without-override',
  'unknown-annotation-round-trip',
  'inactive-authored-data',
  'capability-warnings',
  'zero-time-boundaries',
  'maximum-time-boundaries',
] as const;

export type PlannedEnvelopeNotationFeature = typeof PLANNED_ENVELOPE_NOTATION_FEATURES[number];

export interface EnvelopeNotationExampleSession {
  id: string;
  title: string;
  purpose: string;
  tempo: number;
  notation: string;
  features: readonly PlannedEnvelopeNotationFeature[];
  capabilities: Readonly<Record<string, EnvelopeCapabilityV2>>;
  expectedCapabilityDiagnosticCodes?: readonly string[];
}

const SYNTH_ADSR: EnvelopeCapabilityV2 = {
  models: ['adsr'], sustainSource: 'oscillator', releaseSource: 'gain-only',
  lockableStages: ['attack', 'decay', 'release'],
};
const TONE_DRUM: EnvelopeCapabilityV2 = {
  models: ['ad'], sustainSource: 'none', releaseSource: 'none',
  lockableStages: ['attack', 'decay'],
};
const NATURAL_TRIGGER: EnvelopeCapabilityV2 = {
  models: ['ad', 'ahd'],
  playbackModes: ['trigger'],
  sustainSource: 'finite-buffer',
  releaseSource: 'source-tail',
  lockableStages: ['attack', 'hold', 'decay'],
};
const FINITE_GATED_SAMPLE: EnvelopeCapabilityV2 = {
  models: ['ahd', 'ar'],
  playbackModes: ['trigger', 'gate'],
  sustainSource: 'finite-buffer',
  releaseSource: 'gain-only',
  lockableStages: ['attack', 'hold', 'decay', 'release'],
};
const LOOPED_SAMPLE: EnvelopeCapabilityV2 = {
  models: ['adsr'],
  playbackModes: ['loop'],
  sustainSource: 'sample-loop',
  releaseSource: 'source-tail',
  lockableStages: ['attack', 'decay', 'release'],
};

/**
 * Canonical examples double as executable acceptance data. They intentionally
 * include musical sessions, migration inputs, boundaries, and valid-but-
 * inactive authored state; production UI/session import wiring comes later.
 */
export const ENVELOPE_NOTATION_EXAMPLE_SESSIONS: readonly EnvelopeNotationExampleSession[] = [
  {
    id: 'synth-articulation-arc',
    title: 'Synth articulation arc',
    purpose: 'Contrasts short, gated, and long synth articulations without changing the source preset.',
    tempo: 112,
    notation: `# Short to long: the four coarse musical regions used by the editor.
A-Pluck: x-x--xx-x-x--x-- [synth:pad] [amp:adsr,5ms,150ms,0.2,80ms]
A-Chords: x-------x------- [synth:pad] [gate:100%] [amp:adsr,400ms,300ms,0.8,2.5s]
A-Swell: x--------------- [synth:pad] [amp:adsr,2s,500ms,1,4s]
A-Stab: x--x--x-x--x--x- [synth:stab] [gate:25%] [amp:adsr,0ms,200ms,0,150ms]`,
    features: [
      'model-adsr',
      'duration-ms',
      'duration-seconds',
      'mixed-duration-units',
      'gate-boundaries',
      'zero-time-boundaries',
    ],
    capabilities: {
      'A-Pluck': SYNTH_ADSR,
      'A-Chords': SYNTH_ADSR,
      'A-Swell': SYNTH_ADSR,
      'A-Stab': SYNTH_ADSR,
    },
  },
  {
    id: 'sample-playback-truth',
    title: 'Sample playback truth table',
    purpose: 'Exercises honest trigger, finite gate, and validated loop behavior beside a Tone drum.',
    tempo: 120,
    notation: `Tone-Kick: X---x---X---x--- [tone:membrane-kick] [amp:ad,0ms,350ms]
Brush: o-o-o-oo-o-o-oo- [sampled:brushes-snare] [play:trigger] [amp:ahd,60ms,0.5st,300ms] [lock:1,attack,120ms] [lock:3,attack,80ms] [lock:7,attack,100ms] [lock:8,attack,50ms]
Guitar: x~~~----x~------ [sampled:acoustic-guitar] [play:gate] [amp:ar,5ms,250ms] [gate:90%] [lock:1,attack,20ms] [lock:9,release,2st]
Hammond: x~~~~~~~x~~~~~~~ [sampled:hammond-organ] [play:loop] [amp:adsr,10ms,200ms,0.7,2st] [gate:100%] [lock:9,release,4st]
Vinyl: x--------------- [sampled:vinyl-crackle] [play:trigger] [amp:ad,10ms,3s]`,
    features: [
      'model-ad',
      'model-ahd',
      'model-ar',
      'model-adsr',
      'play-trigger',
      'play-gate',
      'play-loop',
      'duration-ms',
      'duration-steps',
      'mixed-duration-units',
      'inline-ties',
      'sparse-locks',
      'lock-precedence-input',
      'ghosts-and-accents',
    ],
    capabilities: {
      'Tone-Kick': TONE_DRUM,
      Brush: NATURAL_TRIGGER,
      Guitar: FINITE_GATED_SAMPLE,
      Hammond: LOOPED_SAMPLE,
      Vinyl: NATURAL_TRIGGER,
    },
  },
  {
    id: 'ties-locks-and-inactive-data',
    title: 'Ties, locks, and inactive authored data',
    purpose: 'Keeps valid but inactive values visible so clients can warn without deleting future intent.',
    tempo: 128,
    notation: `Wrap-Bass: ~-------x~~~~~~~ [synth:acid] [amp:adsr,1ms,120ms,0.3,50ms] [lock:9,release,800ms]
Tie-Lock: x~~~------------ [synth:acid] [amp:adsr,5ms,200ms,0.6,2st] [lock:2,release,4st]
Silent-Lock: x--------------- [synth:acid] [amp:adsr,5ms,200ms,0.6,2st] [lock:5,attack,20ms]
AD-Release: x---x---x---x--- [tone:membrane-kick] [amp:ad,2ms,400ms] [lock:1,release,1s]
Trigger-Gate: x---x---x---x--- [sampled:brushes-snare] [play:trigger] [amp:ahd,2ms,0.5st,400ms] [gate:50%]`,
    features: [
      'inline-ties',
      'cyclic-ties',
      'sparse-locks',
      'inactive-authored-data',
      'capability-warnings',
    ],
    capabilities: {
      'Wrap-Bass': SYNTH_ADSR,
      'Tie-Lock': SYNTH_ADSR,
      'Silent-Lock': SYNTH_ADSR,
      'AD-Release': TONE_DRUM,
      'Trigger-Gate': NATURAL_TRIGGER,
    },
    expectedCapabilityDiagnosticCodes: [
      'lock-on-tie-continuation',
      'lock-on-silent-step',
      'inactive-lock-stage',
      'inactive-gate',
    ],
  },
  {
    id: 'mixed-time-polyrhythm',
    title: 'Mixed-time polyrhythm',
    purpose: 'Combines tempo-relative and absolute stages with non-power-of-two track lengths.',
    tempo: 93,
    notation: `Five: x-x-x [stepCount:5] [bpm:93] [swing:57] [tone:membrane-kick] [amp:ad,2ms,1st]
Seven: x--x--x [stepCount:7] [transpose:-12] [sampled:acoustic-guitar] [play:gate] [amp:ar,0.25st,750ms] [gate:60%]
Twelve: x--x--x--x-- [stepCount:12] [pitches:0,7,3,10] [synth:acid] [amp:adsr,1ms,0.75st,0.4,1.5s]
ThirtyTwo: x---------------x--------------- [stepCount:32] [tone:fm-epiano] [fm:2.5,8] [amp:adsr,1.2s,4st,0.9,6s]`,
    features: [
      'model-ad',
      'model-ar',
      'model-adsr',
      'duration-ms',
      'duration-seconds',
      'duration-steps',
      'mixed-duration-units',
      'polyrhythm',
      'unknown-annotation-round-trip',
    ],
    capabilities: {
      Five: TONE_DRUM,
      Seven: FINITE_GATED_SAMPLE,
      Twelve: SYNTH_ADSR,
      ThirtyTwo: SYNTH_ADSR,
    },
  },
  {
    id: 'legacy-v23-migration',
    title: 'Legacy v2.3 migration',
    purpose: 'Normalizes both legacy time units and dense lock vectors into canonical v2.4 notation.',
    tempo: 100,
    notation: `Legacy-Seconds: x---x--- [synth:pad] [env:0.01,0.2,0.7,0.5] [envUnit:seconds] [gate:75] [attacks:0.02,-,-,-,0.03,-,-,-] [decays:-,-,-,-,0.4,-,-,-] [releases:0.7,-,-,-,0.9,-,-,-]
Legacy-Steps: x-x-x-x- [synth:acid] [env:0.25,1,0.4,2] [envUnit:steps] [gate:100] [attacks:0.5,-,0.25,-,0.5,-,0.25,-] [decays:-,-,2,-,-,-,1,-] [releases:-,-,-,-,4,-,-,-]`,
    features: [
      'legacy-v23-import',
      'legacy-dense-locks',
      'canonical-v24-output',
      'duration-seconds',
      'duration-steps',
      'sparse-locks',
    ],
    capabilities: {
      'Legacy-Seconds': SYNTH_ADSR,
      'Legacy-Steps': SYNTH_ADSR,
    },
  },
  {
    id: 'boundaries-and-capability-warnings',
    title: 'Boundaries and capability warnings',
    purpose: 'Pins inclusive stage limits and demonstrates unsupported model/playback reporting.',
    tempo: 60,
    notation: `Zero-AD: x--- [tone:membrane-kick] [amp:ad,0ms,0ms]
Max-AHD: x--- [sampled:brushes-snare] [play:trigger] [amp:ahd,48st,96st,8s]
Sustain-Zero: x--- [synth:pad] [gate:0%] [amp:adsr,4s,8s,0,8s]
Sustain-One: x--- [synth:pad] [gate:100%] [amp:adsr,48st,96st,1,96st]
Finite-Loop: x~~~ [sampled:acoustic-guitar] [play:loop] [amp:adsr,5ms,200ms,0.7,2st]
Synth-Play: x--- [synth:pad] [play:loop] [amp:adsr,5ms,200ms,0.7,2st] [futureAmpCurve:exponential]`,
    features: [
      'model-ad',
      'model-ahd',
      'model-adsr',
      'play-trigger',
      'play-loop',
      'duration-seconds',
      'duration-steps',
      'gate-boundaries',
      'inline-ties',
      'zero-time-boundaries',
      'maximum-time-boundaries',
      'unknown-annotation-round-trip',
      'inactive-authored-data',
      'capability-warnings',
    ],
    capabilities: {
      'Zero-AD': TONE_DRUM,
      'Max-AHD': NATURAL_TRIGGER,
      'Sustain-Zero': SYNTH_ADSR,
      'Sustain-One': SYNTH_ADSR,
      'Finite-Loop': FINITE_GATED_SAMPLE,
      'Synth-Play': SYNTH_ADSR,
    },
    expectedCapabilityDiagnosticCodes: [
      'unsupported-envelope-model',
      'unsupported-playback-mode',
      'playback-on-nonsample',
    ],
  },
  {
    id: 'complete-performance-showcase',
    title: 'Complete performance showcase',
    purpose: 'A representative musical session combining dynamics, pitch, FM, swing, ties, locks, and all playback families.',
    tempo: 118,
    notation: `Kick: X---x---X---x--- [bpm:118] [tone:membrane-kick] [amp:ad,0ms,300ms]
Brush: o-o-o-oo-o-o-oo- [swing:62] [sampled:brushes-snare] [play:trigger] [amp:ahd,20ms,0.25st,180ms]
Preset-Snare: ----x-------x--- [sampled:acoustic-snare] [play:trigger]
Acid: X-xx--x-x~xx--x- [transpose:-12] [pitches:0,0,3,7,0,10] [synth:acid] [amp:adsr,1ms,120ms,0.3,50ms] [lock:7,release,800ms] [lock:15,release,1.2s]
Guitar: x~~~----x~~~---- [sampled:acoustic-guitar] [play:gate] [amp:ar,10ms,400ms] [gate:85%]
Organ: x~~~~~~~x~~~~~~~ [sampled:hammond-organ] [play:loop] [amp:adsr,10ms,200ms,0.75,2st] [gate:100%]
Bell: x-----x--x-----x [tone:fm-bell] [fm:3,12] [stepCount:16] [amp:adsr,2ms,1.5s,0.15,2.5s]`,
    features: [
      'model-ad',
      'model-ahd',
      'model-ar',
      'model-adsr',
      'play-trigger',
      'play-gate',
      'play-loop',
      'mixed-duration-units',
      'inline-ties',
      'sparse-locks',
      'ghosts-and-accents',
      'preset-without-override',
      'unknown-annotation-round-trip',
    ],
    capabilities: {
      Kick: TONE_DRUM,
      Brush: NATURAL_TRIGGER,
      'Preset-Snare': NATURAL_TRIGGER,
      Acid: SYNTH_ADSR,
      Guitar: FINITE_GATED_SAMPLE,
      Organ: LOOPED_SAMPLE,
      Bell: SYNTH_ADSR,
    },
  },
] as const;
