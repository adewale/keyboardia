import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_STEPS } from '../types';
import type { GridState, Track, ParameterLock } from '../types';

/**
 * REGRESSION: advanced:sub-bass ("Sub Bass") silence — headless
 * =============================================================
 *
 * Recreates the staging session
 *   https://staging.keyboardia.dev/s/2735d78d-c5cb-429d-b02f-12e1afdfe78f
 * and drives the REAL Scheduler over it with a spy AudioEngine, so it runs in
 * the normal unit suite with no browser and no Web Audio. (The advanced synth's
 * actual audio runs on Tone.js, which can't render headlessly — but the cause
 * of the silence lives in the scheduler/engine GATE, which is fully testable
 * here.)
 *
 * The session mixes three engine families:
 *   - sampled:*      → audioEngine.playSampledInstrument   (native context)
 *   - bare `bass`    → audioEngine.playSample              (native context)
 *   - advanced:*     → audioEngine.playAdvancedSynth       (Tone.js)
 * Only the advanced family is gated behind `isToneSynthReady('advanced')`
 * (i.e. AudioEngine.toneInitialized). That single gate is why the Sub Bass
 * track can go silent while every sampled/sample track still sounds.
 *
 * These tests pin:
 *   1. routing       — advanced:sub-bass resolves to a real advanced preset;
 *   2. happy path     — with Tone ready, EVERY track dispatches (none dropped);
 *   3. the bug         — when Tone.js is not initialized, ONLY the advanced
 *                        track goes silent (the reported symptom);
 *   4. solo behaviour  — as actually saved (Bass soloed), only the soloed
 *                        track plays.
 */

// Spy engine, hoisted so the vi.mock factory can close over it.
const engine = vi.hoisted(() => ({
  getCurrentTime: vi.fn(() => 0),
  isInitialized: vi.fn(() => true),
  isSampledInstrumentReady: vi.fn(() => true),
  isToneSynthReady: vi.fn(() => true),
  playSynthNote: vi.fn(),
  playSampledInstrument: vi.fn(),
  playToneSynth: vi.fn(),
  playAdvancedSynth: vi.fn(),
  playSample: vi.fn(),
  setTrackVolume: vi.fn(),
}));
vi.mock('./engine', () => ({ audioEngine: engine }));

import { Scheduler } from './scheduler';
import { parseInstrumentId } from './instrument-types';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';

// ── Recreate the exact staging session ──────────────────────────────────────
interface TrackSpec {
  name: string;
  sampleId: string;
  stepCount: number;
  active: number[];
  plocks?: Record<number, ParameterLock>;
  volume?: number;
  soloed?: boolean;
}

const SESSION: TrackSpec[] = [
  { name: 'Brush Snare', sampleId: 'sampled:brushes-snare', stepCount: 11, active: [0, 3, 5, 7, 9] },
  { name: 'Ac. Kick', sampleId: 'sampled:acoustic-kick', stepCount: 6, active: [1, 4] },
  { name: 'Vinyl', sampleId: 'sampled:vinyl-crackle', stepCount: 8, active: [1, 3] },
  { name: 'Ac. Kick', sampleId: 'sampled:acoustic-kick', stepCount: 8, active: [1, 3] },
  { name: 'Bass', sampleId: 'bass', stepCount: 16, active: [9, 11] },
  {
    name: 'Slap', sampleId: 'sampled:slap-bass', stepCount: 16,
    active: [1, 2, 3, 4, 5, 6, 11], plocks: { 1: { pitch: -5 }, 4: { pitch: 5 }, 5: { pitch: -7 } },
  },
  {
    name: 'Bass', sampleId: 'bass', stepCount: 24, volume: 0.7, soloed: true,
    active: [13, 14, 15, 16, 17, 18, 23], plocks: { 13: { pitch: -5 }, 16: { pitch: 5 }, 17: { pitch: -7 } },
  },
  {
    name: 'Slap', sampleId: 'sampled:slap-bass', stepCount: 24,
    active: [13, 14, 15, 16, 17, 18, 23], plocks: { 13: { pitch: -5 }, 16: { pitch: 5 }, 17: { pitch: -7 } },
  },
  {
    name: 'Sub Bass', sampleId: 'advanced:sub-bass', stepCount: 24,
    active: [13, 14, 15, 16, 17, 18, 23], plocks: { 13: { pitch: -5 }, 16: { pitch: 5 }, 17: { pitch: -7 } },
  },
];

function buildTrack(spec: TrackSpec, index: number): Track {
  const steps = Array(MAX_STEPS).fill(false) as boolean[];
  const parameterLocks = Array(MAX_STEPS).fill(null) as (ParameterLock | null)[];
  for (const s of spec.active) steps[s] = true;
  for (const [s, lock] of Object.entries(spec.plocks ?? {})) parameterLocks[Number(s)] = lock;
  return {
    id: `track-${index}`,
    name: spec.name,
    sampleId: spec.sampleId,
    steps,
    parameterLocks,
    volume: spec.volume ?? 1,
    muted: false,
    soloed: spec.soloed ?? false,
    transpose: 0,
    stepCount: spec.stepCount,
  };
}

function buildSession(opts: { ignoreSolo: boolean }): GridState {
  return {
    tracks: SESSION.map((s, i) => {
      const t = buildTrack(s, i);
      if (opts.ignoreSolo) t.soloed = false;
      return t;
    }),
    tempo: 120,
    swing: 0,
    isPlaying: true,
    currentStep: 0,
  };
}

/** Drive the real scheduler across enough global steps to fire every track. */
function runSession(state: GridState): void {
  const scheduler = new Scheduler() as unknown as {
    getState: () => GridState;
    scheduleStep: (s: GridState, g: number, t: number, d: number) => void;
  };
  scheduler.getState = () => state;
  // LCM of the step counts (11,6,8,16,24) is 528; 528 global steps guarantees
  // every active step of every track is reached at least once.
  for (let g = 0; g < 528; g++) scheduler.scheduleStep(state, g, 0, 0.125);
}

/** Track ids that received any dispatch, across all engine play* methods. */
function dispatchedTrackIds(): Set<string> {
  const ids = new Set<string>();
  for (const c of engine.playAdvancedSynth.mock.calls) ids.add(c[5] as string);
  for (const c of engine.playToneSynth.mock.calls) ids.add(c[5] as string);
  for (const c of engine.playSynthNote.mock.calls) ids.add(c[6] as string);
  for (const c of engine.playSampledInstrument.mock.calls) ids.add(c[6] as string);
  for (const c of engine.playSample.mock.calls) ids.add(c[1] as string);
  return ids;
}

describe('advanced:sub-bass silence — headless regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.getCurrentTime.mockReturnValue(0);
    engine.isInitialized.mockReturnValue(true);
    engine.isSampledInstrumentReady.mockReturnValue(true);
    engine.isToneSynthReady.mockReturnValue(true);
  });

  it('routes advanced:sub-bass to a real advanced preset', () => {
    const info = parseInstrumentId('advanced:sub-bass');
    expect(info.type).toBe('advanced');
    expect(info.presetId).toBe('sub-bass');
    // Guards the "unknown preset → currentPreset stays null → every note
    // fails checkInvariants → silence" class.
    expect(ADVANCED_SYNTH_PRESETS['sub-bass']).toBeDefined();
  });

  it('ignoring solo + Tone ready: all 9 tracks dispatch, Sub Bass included', () => {
    runSession(buildSession({ ignoreSolo: true }));

    // Sub Bass reaches the advanced engine with its real preset name.
    expect(engine.playAdvancedSynth).toHaveBeenCalled();
    expect(engine.playAdvancedSynth.mock.calls.every(c => c[0] === 'sub-bass')).toBe(true);

    // Sampled + sample families also dispatch.
    expect(engine.playSampledInstrument).toHaveBeenCalled();
    expect(engine.playSample).toHaveBeenCalled();

    // No track is silently dropped by routing/step logic.
    expect(dispatchedTrackIds().size).toBe(9);
  });

  it('reproduces the silence: Tone.js not initialized → ONLY Sub Bass goes silent', () => {
    // toneInitialized === false is exactly what isToneSynthReady reports.
    engine.isToneSynthReady.mockReturnValue(false);
    runSession(buildSession({ ignoreSolo: true }));

    // The reported symptom: the advanced track produces no sound at all…
    expect(engine.playAdvancedSynth).not.toHaveBeenCalled();
    // …while every native-context track still plays.
    expect(engine.playSampledInstrument).toHaveBeenCalled();
    expect(engine.playSample).toHaveBeenCalled();
    expect(dispatchedTrackIds().has('track-8')).toBe(false); // Sub Bass
  });

  it('as actually saved (Bass soloed): only the soloed track dispatches', () => {
    runSession(buildSession({ ignoreSolo: false }));

    // Solo gates everything except the soloed `bass` track (→ playSample).
    expect(engine.playSample).toHaveBeenCalled();
    expect(engine.playAdvancedSynth).not.toHaveBeenCalled();
    expect(engine.playSampledInstrument).not.toHaveBeenCalled();
    expect([...dispatchedTrackIds()]).toEqual(['track-6']); // the soloed Bass
  });
});
