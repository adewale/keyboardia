/**
 * Create the same generated-instrument listening probe against any Keyboardia
 * HTTP backend.
 *
 * Usage:
 *   npx tsx scripts/create-generated-quality-listening-session.ts https://keyboardia.dev
 *   npx tsx scripts/create-generated-quality-listening-session.ts http://localhost:8787
 *   npx tsx scripts/create-generated-quality-listening-session.ts https://staging.keyboardia.dev --suite
 */

import { createHash } from 'node:crypto';

const STEP_CAPACITY = 128;
const LOOP_STEPS = 64;

interface Lock {
  pitch?: number;
  volume?: number;
  tie?: boolean;
}

interface Note {
  step: number;
  pitch?: number;
  volume?: number;
  tie?: boolean;
}

interface TrackOptions {
  id: string;
  name: string;
  sampleId: string;
  volume: number;
  pan?: number;
  notes: readonly Note[];
}

function makeTrack(options: TrackOptions) {
  const steps = Array<boolean>(STEP_CAPACITY).fill(false);
  const parameterLocks = Array<Lock | null>(STEP_CAPACITY).fill(null);
  for (const note of options.notes) {
    steps[note.step] = true;
    const { step: _step, ...lock } = note;
    parameterLocks[note.step] = Object.keys(lock).length > 0 ? lock : null;
  }
  return {
    id: options.id,
    name: options.name,
    sampleId: options.sampleId,
    steps,
    parameterLocks,
    volume: options.volume,
    pan: options.pan ?? 0,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: LOOP_STEPS,
    swing: 0,
  };
}

function repeatedNotes(
  start: number,
  end: number,
  interval: number,
  factory: (step: number, index: number) => Omit<Note, 'step'>,
): Note[] {
  const notes: Note[] = [];
  for (let step = start, index = 0; step < end; step += interval, index += 1) {
    notes.push({ step, ...factory(step, index) });
  }
  return notes;
}

function tiedPhrase(start: number, pitches: readonly number[]): Note[] {
  return pitches.flatMap((pitch, index) => {
    const step = start + index * 4;
    return [
      { step, pitch, volume: 1 },
      { step: step + 1, tie: true },
      { step: step + 2, tie: true },
    ];
  });
}

const sessionState = {
  name: 'Generated Voice A/B — Four Listening Probes',
  state: {
    tempo: 72,
    swing: 0,
    version: 1,
    loopRegion: null,
    effects: {
      bypass: true,
      reverb: { decay: 1.5, wet: 0 },
      delay: { time: '8n', feedback: 0, wet: 0 },
      chorus: { frequency: 1.5, depth: 0, wet: 0 },
      distortion: { amount: 0, wet: 0 },
    },
    scale: { root: 'C', scaleId: 'chromatic', locked: false },
    tracks: [
      // Steps 1-16: identical alternating soft/hard hits expose velocity-to-timbre.
      makeTrack({
        id: 'probe-1-hat-velocity',
        name: '1 Dynamics — Hat soft/hard',
        sampleId: 'hihat',
        volume: 0.58,
        notes: repeatedNotes(0, 16, 1, (_step, index) => ({
          volume: index % 2 === 0 ? 0.3 : 1,
        })),
      }),
      makeTrack({
        id: 'probe-1-pluck-velocity',
        name: '1 Dynamics — Pluck soft/hard',
        sampleId: 'pluck',
        volume: 0.64,
        notes: repeatedNotes(0, 16, 2, (_step, index) => ({
          pitch: [0, 4, 7, 12][index % 4],
          volume: index % 2 === 0 ? 0.3 : 1,
        })),
      }),
      makeTrack({
        id: 'probe-1-fm-velocity',
        name: '1 Dynamics — FM Piano soft/hard',
        sampleId: 'tone:fm-epiano',
        volume: 0.62,
        notes: repeatedNotes(0, 16, 4, (_step, index) => ({
          pitch: [0, 7, 12, 7][index],
          volume: index % 2 === 0 ? 0.3 : 1,
        })),
      }),

      // Steps 17-32: matched, simultaneous sustained saws expose pitch centring.
      makeTrack({
        id: 'probe-2-supersaw',
        name: '2 Tuning — Supersaw',
        sampleId: 'synth:supersaw',
        volume: 0.38,
        pan: -0.12,
        notes: tiedPhrase(16, [0, 7, 12, 7]),
      }),
      makeTrack({
        id: 'probe-2-hypersaw',
        name: '2 Tuning — Hypersaw',
        sampleId: 'synth:hypersaw',
        volume: 0.38,
        pan: 0.12,
        notes: tiedPhrase(16, [0, 7, 12, 7]),
      }),

      // Steps 33-48: isolated short native notes leave silence around releases.
      makeTrack({
        id: 'probe-3-bell-release',
        name: '3 Endings — Bell',
        sampleId: 'synth:bell',
        volume: 0.57,
        notes: [{ step: 32, pitch: 0 }, { step: 40, pitch: 12 }],
      }),
      makeTrack({
        id: 'probe-3-vibes-release',
        name: '3 Endings — Vibes',
        sampleId: 'synth:vibes',
        volume: 0.57,
        notes: [{ step: 34, pitch: 4 }, { step: 42, pitch: 7 }],
      }),
      makeTrack({
        id: 'probe-3-pluck-release',
        name: '3 Endings — Synth Pluck',
        sampleId: 'synth:pluck',
        volume: 0.57,
        notes: [{ step: 36, pitch: 7 }, { step: 44, pitch: 0 }],
      }),

      // Steps 49-64: sparse one-at-a-time sources expose source calibration.
      makeTrack({
        id: 'probe-4-growl-level',
        name: '4 Balance — Growl',
        sampleId: 'synth:growl',
        volume: 0.62,
        notes: [{ step: 48, pitch: -12 }, { step: 56, pitch: -12 }],
      }),
      makeTrack({
        id: 'probe-4-hoover-level',
        name: '4 Balance — Hoover',
        sampleId: 'synth:hoover',
        volume: 0.62,
        notes: [{ step: 50, pitch: 0 }, { step: 58, pitch: 0 }],
      }),
      makeTrack({
        id: 'probe-4-metal-hat-level',
        name: '4 Balance — Metal Hat',
        sampleId: 'tone:metal-hihat',
        volume: 0.62,
        notes: [{ step: 52 }, { step: 60 }],
      }),
      makeTrack({
        id: 'probe-4-am-bell-level',
        name: '4 Balance — AM Bell',
        sampleId: 'tone:am-bell',
        volume: 0.62,
        notes: [{ step: 54, pitch: 7 }, { step: 62, pitch: 7 }],
      }),
    ],
  },
};

const baseUrl = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const createSuite = process.argv.includes('--suite');

type ProbeTrack = (typeof sessionState.state.tracks)[number];
type ProbeSession = typeof sessionState;

function sectionSession(
  name: string,
  startStep: number,
  endStep: number,
): ProbeSession {
  const sectionLength = endStep - startStep;
  const tracks = sessionState.state.tracks
    .filter(track => track.steps.slice(startStep, endStep).some(Boolean))
    .map((track): ProbeTrack => ({
      ...track,
      id: `${track.id}-focused`,
      steps: [
        ...track.steps.slice(startStep, endStep),
        ...Array<boolean>(STEP_CAPACITY - sectionLength).fill(false),
      ],
      parameterLocks: [
        ...track.parameterLocks.slice(startStep, endStep),
        ...Array<Lock | null>(STEP_CAPACITY - sectionLength).fill(null),
      ],
      stepCount: sectionLength,
    }));

  return {
    name,
    state: {
      ...sessionState.state,
      tracks,
    },
  };
}

async function createAndVerify(payload: ProbeSession, label: string) {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`${label} creation failed (${response.status}): ${await response.text()}`);
  }

  const created = await response.json() as { id: string; url?: string };
  const verification = await fetch(`${baseUrl}/api/sessions/${created.id}`);
  if (!verification.ok) {
    throw new Error(`${label} verification failed (${verification.status}): ${await verification.text()}`);
  }
  const storedPayload = await verification.json() as { state?: unknown };
  const expectedDigest = createHash('sha256').update(JSON.stringify(payload.state)).digest('hex');
  const actualDigest = createHash('sha256').update(JSON.stringify(storedPayload.state)).digest('hex');
  if (actualDigest !== expectedDigest) {
    throw new Error(`${label} stored state differs (expected ${expectedDigest}, got ${actualDigest})`);
  }

  return {
    label,
    id: created.id,
    url: `${baseUrl}/s/${created.id}`,
    stateSha256: actualDigest,
    trackCount: payload.state.tracks.length,
    loopSteps: payload.state.tracks[0]?.stepCount ?? LOOP_STEPS,
  };
}

const probes: readonly { label: string; payload: ProbeSession }[] = createSuite
  ? [
      { label: 'overview', payload: sessionState },
      {
        label: 'dynamics',
        payload: sectionSession('Generated Voice Showcase — Dynamic Timbre', 0, 16),
      },
      {
        label: 'tuning',
        payload: sectionSession('Generated Voice Showcase — Centred Ensembles', 16, 32),
      },
      {
        label: 'endings',
        payload: sectionSession('Generated Voice Showcase — Clean Note Endings', 32, 48),
      },
      {
        label: 'balance',
        payload: sectionSession('Generated Voice Showcase — Source Balance', 48, 64),
      },
    ]
  : [{ label: 'overview', payload: sessionState }];

const results = [];
for (const probe of probes) {
  results.push(await createAndVerify(probe.payload, probe.label));
}

console.log(JSON.stringify(createSuite ? results : results[0], null, 2));
