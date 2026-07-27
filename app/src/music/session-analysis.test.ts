import { describe, expect, it } from 'vitest';
import { MAX_STEPS } from '../shared/constants';
import type { SessionState, SessionTrack } from '../shared/state';
import { createDefaultTrack, createInitialState } from '../shared/state-mutations';
import { analyzeSession, inferKeys } from './session-analysis';

/**
 * Builds a track whose active steps carry the given pitch offsets.
 * `steps` maps a step index to its pitch offset from middle C.
 */
function track(
  id: string,
  sampleId: string,
  steps: Record<number, number | true>,
  overrides: Partial<SessionTrack> = {}
): SessionTrack {
  const base = createDefaultTrack(id, sampleId, id);
  const stepFlags = [...base.steps];
  const locks = [...base.parameterLocks];

  for (const [index, value] of Object.entries(steps)) {
    const step = Number(index);
    stepFlags[step] = true;
    if (typeof value === 'number') locks[step] = { pitch: value };
  }

  return { ...base, steps: stepFlags, parameterLocks: locks, ...overrides };
}

function session(tracks: SessionTrack[], overrides: Partial<SessionState> = {}): SessionState {
  return { ...createInitialState(), tracks, ...overrides };
}

const LEAD = 'synth:lead';

describe('inferKeys', () => {
  function weights(...pitchClasses: number[]): Map<number, number> {
    const map = new Map<number, number>();
    for (const cls of pitchClasses) map.set(cls, (map.get(cls) ?? 0) + 1);
    return map;
  }

  it('returns nothing when nothing sounded', () => {
    expect(inferKeys(new Map())).toEqual([]);
  });

  it('fits a C natural minor melody to C natural minor', () => {
    // C D Eb F G Ab Bb
    const best = inferKeys(weights(0, 2, 3, 5, 7, 8, 10))[0]!;

    expect(best.fit).toBe(1);
    expect(best.root).toBe('C');
    expect(best.scale_id).toBe('natural-minor');
  });

  /**
   * The chromatic scale contains every pitch class, so including it would cap
   * `fit` at 1 for every possible input and leave the metric unable to
   * discriminate. It is never offered as an inferred key.
   */
  it('never infers the chromatic scale', () => {
    const scattered = inferKeys(weights(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11));

    expect(scattered.every((candidate) => candidate.scale_id !== 'chromatic')).toBe(true);
    // With every note played, no real scale fits perfectly.
    expect(scattered[0]!.fit).toBeLessThan(1);
  });

  it('prefers the scale that describes the notes over one that merely contains them', () => {
    // C minor pentatonic is a subset of C natural minor; both fit perfectly.
    const ranked = inferKeys(weights(0, 3, 5, 7, 10));

    expect(ranked[0]!.scale_id).toBe('minor-pentatonic');
    expect(ranked[0]!.coverage).toBe(1);
  });

  /**
   * Weighting is what stops one passing note from moving the key. Unweighted,
   * a C major scale plus a single F# is 7 of 8 pitch classes — 0.875. Weighted
   * by how often each is played, the outlier costs only its own share.
   */
  it('weights a pitch class by how often it is played', () => {
    const heavy = weights(
      ...[0, 2, 4, 5, 7, 9, 11].flatMap((cls) => [cls, cls, cls]),
      6
    );
    const best = inferKeys(heavy)[0]!;

    expect(best.root).toBe('C');
    expect(best.scale_id).toBe('major');
    expect(best.fit).toBeCloseTo(21 / 22);
    expect(best.fit).toBeGreaterThan(0.875);
  });

  it('ranks deterministically across repeated calls', () => {
    const input = weights(0, 3, 5, 7, 10);
    const first = inferKeys(input).slice(0, 5);
    const second = inferKeys(input).slice(0, 5);

    expect(first).toEqual(second);
  });
});

describe('analyzeSession', () => {
  it('reports an empty session without inventing music', () => {
    const analysis = analyzeSession(session([]));

    expect(analysis.rhythm).toEqual([]);
    expect(analysis.inferred_keys).toEqual([]);
    expect(analysis.chords).toEqual([]);
    expect(analysis.caveats).toContain('This session has no tracks yet.');
  });

  it('describes rhythm per track', () => {
    const analysis = analyzeSession(session([
      track('kick', 'kick', { 0: true, 4: true, 8: true, 12: true }),
    ]));
    const kick = analysis.rhythm[0]!;

    expect(kick.role).toBe('drum');
    expect(kick.onsets).toEqual([0, 4, 8, 12]);
    expect(kick.density).toBeCloseTo(4 / 16);
    expect(kick.starts_on_downbeat).toBe(true);
    expect(kick.on_beat_ratio).toBe(1);
  });

  it('distinguishes offbeat placement from downbeat placement', () => {
    const analysis = analyzeSession(session([
      track('hats', 'hihat', { 2: true, 6: true, 10: true, 14: true }),
    ]));
    const hats = analysis.rhythm[0]!;

    expect(hats.starts_on_downbeat).toBe(false);
    expect(hats.on_beat_ratio).toBe(0);
  });

  it('detects polyrhythm from differing loop lengths', () => {
    const analysis = analyzeSession(session([
      track('a', 'kick', { 0: true }, { stepCount: 16 }),
      track('b', 'conga', { 0: true }, { stepCount: 12 }),
    ]));

    expect(analysis.polyrhythm).toBe(true);
    expect(analysis.loop_lengths).toEqual([12, 16]);
    expect(analysis.pattern_steps).toBe(48);
  });

  it('derives every rhythm metadata field from all tracks, even an empty one', () => {
    const analysis = analyzeSession(session([
      track('empty', 'kick', {}, { stepCount: 12, muted: true }),
    ]));

    expect(analysis.pattern_steps).toBe(12);
    expect(analysis.loop_lengths).toEqual([12]);
    expect(analysis.polyrhythm).toBe(false);
  });

  it('classifies sampled and Tone.js percussion as drums', () => {
    const analysis = analyzeSession(session([
      track('808', 'sampled:808-kick', { 0: true }),
      track('metal', 'tone:metal-hihat', { 2: true }),
    ]));

    expect(analysis.rhythm.map(({ role }) => role)).toEqual(['drum', 'drum']);
    expect(analysis.pitch).toEqual([]);
    expect(analysis.inferred_keys).toEqual([]);
  });

  it('reports a single loop length as not polyrhythmic', () => {
    const analysis = analyzeSession(session([
      track('a', 'kick', { 0: true }),
      track('b', 'snare', { 4: true }),
    ]));

    expect(analysis.polyrhythm).toBe(false);
    expect(analysis.pattern_steps).toBe(16);
  });

  it('reads sounding pitch from transpose and per-step locks together', () => {
    const analysis = analyzeSession(session([
      track('lead', LEAD, { 0: 0, 4: 3, 8: 7 }, { transpose: 12 }),
    ]));
    const lead = analysis.pitch[0]!;

    expect(lead.pitches).toEqual([12, 15, 19]);
    expect(lead.note_names).toEqual(['C5', 'D#5', 'G5']);
    expect(lead.pitch_classes).toEqual([0, 3, 7]);
    expect(lead.range_semitones).toBe(7);
  });

  it('infers the key from the notes actually played', () => {
    const analysis = analyzeSession(session([
      track('lead', LEAD, { 0: 0, 2: 3, 4: 5, 6: 7, 8: 10 }),
    ]));

    expect(analysis.inferred_keys[0]).toMatchObject({
      root: 'C',
      scale_id: 'minor-pentatonic',
      fit: 1,
    });
    expect(analysis.pitch_class_names).toEqual(['C', 'D#', 'F', 'G', 'A#']);
  });

  it('weights local onsets by how often their loops repeat in the full pattern', () => {
    const analysis = analyzeSession(session(
      [
        track('short-c', LEAD, { 0: 0 }, { stepCount: 4 }),
        track('long-f-sharp', LEAD, { 0: 6 }, { stepCount: 16 }),
      ],
      { scale: { root: 'C', scaleId: 'major', locked: false } }
    ));

    expect(analysis.pattern_steps).toBe(16);
    expect(analysis.declared_key?.fit).toBeCloseTo(4 / 5);
  });

  it('does not count zero-gain tracks or zero-gain steps as sounding notes', () => {
    const silentStepLocks = Array(MAX_STEPS).fill(null);
    silentStepLocks[0] = { pitch: 6, volume: 0 };
    const analysis = analyzeSession(session([
      track('audible', LEAD, { 0: 0 }),
      track('silent-track', LEAD, { 0: 6 }, { volume: 0 }),
      track('silent-step', LEAD, { 0: true }, { parameterLocks: silentStepLocks }),
    ]));

    expect(analysis.pitch_classes).toEqual([0]);
    expect(analysis.chords).toEqual([]);
  });

  it('says nothing about key when only drums are present', () => {
    const analysis = analyzeSession(session([
      track('kick', 'kick', { 0: true, 8: true }),
      track('snare', 'snare', { 4: true, 12: true }),
    ]));

    expect(analysis.inferred_keys).toEqual([]);
    expect(analysis.pitch).toEqual([]);
    expect(analysis.caveats).toContain(
      'No audible pitched tracks, so there is no key or harmony to report.'
    );
  });

  it('warns when too few pitch classes are used to mean anything', () => {
    const analysis = analyzeSession(session([
      track('lead', LEAD, { 0: 0, 8: 7 }),
    ]));

    expect(analysis.caveats.some((note) => note.includes('too many scales fit'))).toBe(true);
  });

  /**
   * A muted track makes no sound, so counting its notes would describe music
   * nobody can hear — while still being worth listing as present.
   */
  it('excludes muted tracks from key inference but still describes them', () => {
    const analysis = analyzeSession(session([
      track('lead', LEAD, { 0: 0, 2: 3, 4: 5, 6: 7, 8: 10 }),
      track('rogue', LEAD, { 0: 1, 2: 6, 4: 11 }, { muted: true }),
    ]));

    expect(analysis.inferred_keys[0]!.fit).toBe(1);
    expect(analysis.rhythm.map((t) => t.track_id)).toEqual(['lead', 'rogue']);
    expect(analysis.rhythm[1]!.muted).toBe(true);
    expect(analysis.pitch_class_names).toEqual(['C', 'D#', 'F', 'G', 'A#']);
  });

  it('follows the scheduler rule that solo wins over mute', () => {
    const analysis = analyzeSession(session([
      track('quiet', LEAD, { 0: 1, 2: 6 }),
      track('solo', LEAD, { 0: 0, 4: 7 }, { soloed: true }),
    ]));

    expect(analysis.pitch_classes).toEqual([0, 7]);
  });

  it('detects a chord where tracks sound together', () => {
    const analysis = analyzeSession(session([
      track('root', LEAD, { 0: 0 }),
      track('third', LEAD, { 0: 4 }),
      track('fifth', LEAD, { 0: 7 }),
    ]));

    expect(analysis.chords).toHaveLength(1);
    expect(analysis.chords[0]).toMatchObject({
      step: 0,
      pitches: [0, 4, 7],
      chord: 'C',
    });
  });

  it('reports coincident pitches that match no known chord as null', () => {
    const analysis = analyzeSession(session([
      track('a', LEAD, { 0: 0 }),
      track('b', LEAD, { 0: 1 }),
    ]));

    expect(analysis.chords[0]!.chord).toBeNull();
    expect(analysis.chords[0]!.note_names).toEqual(['C4', 'C#4']);
  });

  /**
   * Two tracks of different lengths only truly coincide where the combined
   * pattern says they do, not where their local step indices happen to match.
   */
  it('finds chords across the full pattern, not per-track indices', () => {
    const analysis = analyzeSession(session([
      track('a', LEAD, { 0: 0 }, { stepCount: 4 }),
      track('b', LEAD, { 0: 7 }, { stepCount: 6 }),
    ]));

    expect(analysis.pattern_steps).toBe(12);
    // Both restart together at 0 and again at 12; inside one pattern that is
    // step 0 only.
    expect(analysis.chords.map((c) => c.step)).toEqual([0]);
  });

  it('scores the key the session declares against what is played', () => {
    const analysis = analyzeSession(session(
      [track('lead', LEAD, { 0: 0, 2: 3, 4: 5, 6: 7, 8: 10 })],
      { scale: { root: 'C', scaleId: 'natural-minor', locked: true } }
    ));

    expect(analysis.declared_key).toMatchObject({
      root: 'C',
      scale_id: 'natural-minor',
      name: 'C Natural Minor',
      locked: true,
      fit: 1,
    });
  });

  it('reports a declared key the music does not match', () => {
    const analysis = analyzeSession(session(
      [track('lead', LEAD, { 0: 1, 2: 6 })],
      { scale: { root: 'C', scaleId: 'major', locked: false } }
    ));

    expect(analysis.declared_key!.fit).toBe(0);
  });

  it('ignores a declared key naming a scale it does not know', () => {
    const analysis = analyzeSession(session(
      [track('lead', LEAD, { 0: 0 })],
      { scale: { root: 'C', scaleId: 'not-a-scale', locked: false } }
    ));

    expect(analysis.declared_key).toBeNull();
  });

  it('carries tempo and swing through unchanged', () => {
    const analysis = analyzeSession(session(
      [track('kick', 'kick', { 0: true })],
      { tempo: 124, swing: 30 }
    ));

    expect(analysis.tempo).toBe(124);
    expect(analysis.swing).toBe(30);
  });

  it('notes that tied steps are counted as onsets', () => {
    const base = track('lead', LEAD, { 0: 0, 4: 3 });
    const locks = [...base.parameterLocks];
    locks[4] = { pitch: 3, tie: true };

    const analysis = analyzeSession(session([{ ...base, parameterLocks: locks }]));

    expect(analysis.caveats.some((note) => note.includes('Tied steps'))).toBe(true);
  });

  it('does not mutate the session it describes', () => {
    const state = session([
      track('lead', LEAD, { 0: 0, 4: 7 }),
      track('kick', 'kick', { 0: true }),
    ]);
    const before = structuredClone(state);

    analyzeSession(state);

    expect(state).toEqual(before);
  });

  it('ignores steps beyond a track\'s own loop length', () => {
    const long = track('lead', LEAD, { 0: 0, 20: 6 }, { stepCount: 16 });
    const analysis = analyzeSession(session([long]));

    // Step 20 is outside the 16-step loop, so its pitch never sounds.
    expect(analysis.pitch[0]!.pitches).toEqual([0]);
    expect(analysis.rhythm[0]!.onsets).toEqual([0]);
  });

  it('handles a track using the full step array without going out of range', () => {
    const full = createDefaultTrack('dense', 'kick', 'dense');
    const analysis = analyzeSession(session([
      { ...full, steps: Array(MAX_STEPS).fill(true), stepCount: MAX_STEPS },
    ]));

    expect(analysis.rhythm[0]!.onsets).toHaveLength(MAX_STEPS);
    expect(analysis.rhythm[0]!.density).toBe(1);
  });
});
