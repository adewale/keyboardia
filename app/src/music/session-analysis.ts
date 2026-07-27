/**
 * Read-only musical analysis of a Keyboardia session.
 *
 * This is the shared analysis operation the browser and the MCP endpoint both
 * call. It answers "what is happening in this session, musically?" and never
 * mutates anything.
 *
 * Everything here is built on `music-theory.ts` — the same scale table, chord
 * detector, and note naming the Key Assistant and Chromatic Grid use — and on
 * the track selection and pitch arithmetic in `midiExport.ts`. Nothing
 * reimplements musical inference, so an agent's description of a session and
 * what a person sees in the browser cannot drift apart.
 *
 * Determinism matters as much as correctness: the results feed evals, so
 * ordering is fixed, ties are broken explicitly, and no result depends on
 * object iteration order.
 *
 * @see specs/STATELESS-MCP.md - "Musical and pitch analysis"
 */

import {
  BASE_NOTE,
  isDrumTrack,
} from '../audio/midiExport';
import { DEFAULT_STEP_COUNT } from '../shared/constants';
import { boundedPatternLength } from '../shared/pattern-expansion';
import type { SessionState, SessionTrack } from '../shared/state';
import { sessionTrackToTrack } from '../types';
import {
  NOTE_NAMES,
  SCALES,
  detectChord,
  formatChord,
  getScaleDisplayName,
  getScaleNotes,
  getRootIndex,
  isInScale,
  pitchToNoteName,
  type NoteName,
  type ScaleId,
} from './music-theory';

/** Steps per quarter note, matching the 16th-note grid the sequencer runs on. */
const STEPS_PER_BEAT = 4;

/** How many inferred keys to report. Enough to show a close call, few enough to read. */
const KEY_CANDIDATE_LIMIT = 3;

/**
 * Two candidates whose fit differs by less than this are treated as tied. Fits
 * are exact ratios of small integers, so this only absorbs float representation
 * error, not genuinely different fits.
 */
const FIT_EPSILON = 1e-9;

export type TrackRole = 'drum' | 'pitched';

export interface TrackRhythmAnalysis {
  track_id: string;
  name: string;
  sample_id: string;
  role: TrackRole;
  step_count: number;
  /** Active step indices inside the track's own loop, ascending. */
  onsets: number[];
  /** Active steps divided by loop length, 0-1. */
  density: number;
  /** Whether the track sounds on step 0. */
  starts_on_downbeat: boolean;
  /** Fraction of onsets landing on a quarter-note position, 0-1. */
  on_beat_ratio: number;
  muted: boolean;
  soloed: boolean;
}

export interface TrackPitchAnalysis {
  track_id: string;
  name: string;
  transpose: number;
  /** Distinct sounding pitches as semitone offsets from middle C, ascending. */
  pitches: number[];
  /** The same pitches as names with octaves, e.g. "C4". */
  note_names: string[];
  /** Distinct pitch classes used, 0-11. */
  pitch_classes: number[];
  /** Highest minus lowest sounding pitch, in semitones. */
  range_semitones: number;
}

export interface KeyCandidate {
  root: NoteName;
  scale_id: ScaleId;
  name: string;
  /** Share of sounded notes that fall inside this scale, 0-1. */
  fit: number;
  /** Share of the scale's own notes the session actually uses, 0-1. */
  coverage: number;
}

export interface ChordMoment {
  /** Step index within the session's full pattern. */
  step: number;
  pitches: number[];
  note_names: string[];
  /** Formatted chord symbol, or null when the pitches match no known chord. */
  chord: string | null;
}

export interface DeclaredKey {
  root: NoteName;
  scale_id: ScaleId;
  name: string;
  locked: boolean;
  /** Share of sounded notes that fall inside the key the session declares. */
  fit: number;
}

export interface SessionAnalysis {
  tempo: number;
  swing: number;
  /** Steps before every track realigns — the LCM of their loop lengths. */
  pattern_steps: number;
  /** True when tracks have differing loop lengths, so the pattern is polyrhythmic. */
  polyrhythm: boolean;
  /** Distinct track loop lengths present, ascending. */
  loop_lengths: number[];
  rhythm: TrackRhythmAnalysis[];
  pitch: TrackPitchAnalysis[];
  /** Pitch classes sounded anywhere in the session, 0-11, ascending. */
  pitch_classes: number[];
  pitch_class_names: NoteName[];
  /** What the session declares in the Key Assistant, or null if unset. */
  declared_key: DeclaredKey | null;
  /** Best-fitting keys for the notes actually sounded, best first. */
  inferred_keys: KeyCandidate[];
  /** True when the top candidates fit equally well, so the key is a guess. */
  key_ambiguous: boolean;
  /** Simultaneous pitches, at each step where two or more tracks sound together. */
  chords: ChordMoment[];
  /** Where the analysis is silent or uncertain, in plain language. */
  caveats: string[];
}

/**
 * The sounding pitch of a step, as a semitone offset from middle C.
 *
 * Deliberately the same arithmetic as `getSynthNotePitch()` in midiExport,
 * minus its MIDI base, so analysis and export agree on what note a step plays.
 */
function stepPitch(track: SessionTrack, step: number): number {
  const lock = track.parameterLocks[step];
  return (track.transpose ?? 0) + (lock?.pitch ?? 0);
}

function pitchClass(pitch: number): number {
  return ((pitch % 12) + 12) % 12;
}

function stepCountOf(track: SessionTrack): number {
  return track.stepCount ?? DEFAULT_STEP_COUNT;
}

function onsetsOf(track: SessionTrack): number[] {
  const count = stepCountOf(track);
  return track.steps.slice(0, count).flatMap((active, step) => active ? [step] : []);
}

/** An active grid cell with zero effective gain does not sound. */
function audibleOnsetsOf(track: SessionTrack): number[] {
  if (track.volume <= 0) return [];
  return onsetsOf(track).filter((step) => (track.parameterLocks[step]?.volume ?? 1) > 0);
}

/**
 * Mirrors the audio scheduler and MIDI export: solo wins over mute. A muted
 * track is still described, but it contributes no notes to key inference,
 * because it contributes no sound.
 */
function audibleTracks(tracks: SessionTrack[]): SessionTrack[] {
  const anySoloed = tracks.some((track) => track.soloed);
  return tracks.filter((track) => (anySoloed ? Boolean(track.soloed) : !track.muted));
}

function isPitched(track: SessionTrack): boolean {
  return !isDrumTrack(sessionTrackToTrack(track));
}

function analyzeRhythm(track: SessionTrack): TrackRhythmAnalysis {
  const stepCount = stepCountOf(track);
  const onsets = onsetsOf(track);
  const onBeat = onsets.filter((step) => step % STEPS_PER_BEAT === 0).length;

  return {
    track_id: track.id,
    name: track.name,
    sample_id: track.sampleId,
    role: isPitched(track) ? 'pitched' : 'drum',
    step_count: stepCount,
    onsets,
    density: stepCount === 0 ? 0 : onsets.length / stepCount,
    starts_on_downbeat: onsets.includes(0),
    on_beat_ratio: onsets.length === 0 ? 0 : onBeat / onsets.length,
    muted: Boolean(track.muted),
    soloed: Boolean(track.soloed),
  };
}

function analyzePitch(track: SessionTrack): TrackPitchAnalysis | null {
  const onsets = audibleOnsetsOf(track);
  if (onsets.length === 0) return null;

  const pitches = [...new Set(onsets.map((step) => stepPitch(track, step)))]
    .sort((a, b) => a - b);

  return {
    track_id: track.id,
    name: track.name,
    transpose: track.transpose ?? 0,
    pitches,
    note_names: pitches.map(pitchToNoteName),
    pitch_classes: [...new Set(pitches.map(pitchClass))].sort((a, b) => a - b),
    range_semitones: pitches[pitches.length - 1]! - pitches[0]!,
  };
}

/**
 * The chromatic scale is excluded from inference.
 *
 * It contains all twelve pitch classes, so it fits every possible input
 * perfectly and would cap `fit` at 1 for every session — making the metric
 * unable to discriminate at the top of the ranking, which is the only place it
 * matters. It is also not an answer to "what key is this in": in the Key
 * Assistant it means "no constraint". It remains valid as a *declared* key,
 * where the session is stating a preference rather than being described.
 */
const INFERRABLE_SCALE_IDS = (Object.keys(SCALES) as ScaleId[])
  .filter((scaleId) => scaleId !== 'chromatic');

/**
 * Scores every root-and-scale pair against the notes actually sounded.
 *
 * `fit` weights each pitch class by how often it is played, so a passing note
 * cannot outvote the note a pattern sits on. `coverage` breaks ties between
 * scales that contain the same notes: a five-note melody fits both the pentatonic
 * that describes it and the seven-note scale that merely contains it, and the
 * tighter one is the better description.
 */
export function inferKeys(pitchClassWeights: Map<number, number>): KeyCandidate[] {
  const total = [...pitchClassWeights.values()].reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return [];

  const candidates: KeyCandidate[] = [];

  // NOTE_NAMES and SCALES are iterated in their declared order, so equal-scoring
  // candidates always come back in the same order.
  for (const root of NOTE_NAMES) {
    for (const scaleId of INFERRABLE_SCALE_IDS) {
      let inside = 0;
      for (const [pitch, weight] of pitchClassWeights) {
        if (isInScale(pitch, root, scaleId)) inside += weight;
      }

      const scaleNotes = getScaleNotes(getRootIndex(root), scaleId);
      const used = scaleNotes.filter((note) => pitchClassWeights.has(note)).length;

      candidates.push({
        root,
        scale_id: scaleId,
        name: getScaleDisplayName(root, scaleId),
        fit: inside / total,
        coverage: used / scaleNotes.length,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (Math.abs(b.fit - a.fit) > FIT_EPSILON) return b.fit - a.fit;
    // Among scales that contain the same notes, prefer the one that wastes the
    // fewest: C major and C chromatic both "fit" a C major melody perfectly,
    // but only one of them describes it.
    if (Math.abs(b.coverage - a.coverage) > FIT_EPSILON) return b.coverage - a.coverage;
    return 0;
  });
}

/**
 * Chords at the steps where pitched tracks sound together.
 *
 * Steps are counted across the full pattern, so a 12-step track and a 16-step
 * track are compared where they actually coincide rather than where their
 * indices happen to match.
 */
function findChords(tracks: SessionTrack[], patternSteps: number): ChordMoment[] {
  const moments: ChordMoment[] = [];

  for (let step = 0; step < patternSteps; step++) {
    const sounding: number[] = [];
    for (const track of tracks) {
      const count = stepCountOf(track);
      const local = step % count;
      if (
        track.volume > 0 &&
        track.steps[local] &&
        (track.parameterLocks[local]?.volume ?? 1) > 0
      ) {
        sounding.push(stepPitch(track, local));
      }
    }

    if (sounding.length < 2) continue;
    const pitches = [...new Set(sounding)].sort((a, b) => a - b);
    if (pitches.length < 2) continue;

    const chord = detectChord(pitches);
    moments.push({
      step,
      pitches,
      note_names: pitches.map(pitchToNoteName),
      chord: chord ? formatChord(chord) : null,
    });
  }

  return moments;
}

function describeDeclaredKey(
  state: SessionState,
  pitchClassWeights: Map<number, number>
): DeclaredKey | null {
  const scale = state.scale;
  if (!scale) return null;

  const root = scale.root as NoteName;
  const scaleId = scale.scaleId as ScaleId;
  if (!NOTE_NAMES.includes(root) || !(scaleId in SCALES)) return null;

  const total = [...pitchClassWeights.values()].reduce((sum, weight) => sum + weight, 0);
  let inside = 0;
  for (const [pitch, weight] of pitchClassWeights) {
    if (isInScale(pitch, root, scaleId)) inside += weight;
  }

  return {
    root,
    scale_id: scaleId,
    name: getScaleDisplayName(root, scaleId),
    locked: Boolean(scale.locked),
    fit: total === 0 ? 0 : inside / total,
  };
}

/**
 * Describes a session's rhythm, pitch content, and key without changing it.
 */
export function analyzeSession(state: SessionState): SessionAnalysis {
  const audible = audibleTracks(state.tracks);
  const pitchedAudible = audible.filter(isPitched);
  const caveats: string[] = [];

  // Rhythm metadata has one definition: every track participates, including
  // empty and muted tracks. Muting changes what sounds, not the loop geometry.
  const patternSteps = boundedPatternLength(state.tracks.map(stepCountOf));
  const loopLengths = [...new Set(state.tracks.map(stepCountOf))].sort((a, b) => a - b);

  // Weight across the full realignment pattern, not just each track's local
  // loop. A note in a 4-step loop sounds four times while a 16-step loop plays
  // once, so it must carry four times the inference weight.
  const pitchClassWeights = new Map<number, number>();
  for (const track of pitchedAudible) {
    const repetitions = patternSteps / stepCountOf(track);
    for (const step of audibleOnsetsOf(track)) {
      const cls = pitchClass(stepPitch(track, step));
      pitchClassWeights.set(cls, (pitchClassWeights.get(cls) ?? 0) + repetitions);
    }
  }

  const inferred = inferKeys(pitchClassWeights).slice(0, KEY_CANDIDATE_LIMIT);
  const ambiguous = inferred.length > 1
    && Math.abs(inferred[0]!.fit - inferred[1]!.fit) <= FIT_EPSILON
    && Math.abs(inferred[0]!.coverage - inferred[1]!.coverage) <= FIT_EPSILON;

  if (pitchedAudible.length === 0) {
    caveats.push(
      state.tracks.length === 0
        ? 'This session has no tracks yet.'
        : 'No audible pitched tracks, so there is no key or harmony to report.'
    );
  } else if (pitchClassWeights.size === 0) {
    caveats.push('The pitched tracks have no active steps, so nothing sounds.');
  } else if (pitchClassWeights.size < 3) {
    caveats.push(
      `Only ${pitchClassWeights.size} distinct pitch ${pitchClassWeights.size === 1 ? 'class is' : 'classes are'} used, `
      + 'which too many scales fit for the inferred key to mean much.'
    );
  }

  if (ambiguous) {
    caveats.push('Several keys fit equally well; the ranking between them is arbitrary.');
  }

  if (state.tracks.some((track) => track.muted || track.soloed)) {
    caveats.push('Key and harmony describe the audible tracks only; muted and un-soloed tracks are described but not counted.');
  }

  if (state.tracks.some((track) => track.parameterLocks.some((lock) => lock?.tie))) {
    caveats.push('Tied steps are counted as onsets; note lengths are not analysed.');
  }

  return {
    tempo: state.tempo,
    swing: state.swing,
    pattern_steps: patternSteps,
    polyrhythm: loopLengths.length > 1,
    loop_lengths: loopLengths,
    rhythm: state.tracks.map(analyzeRhythm),
    pitch: pitchedAudible
      .map(analyzePitch)
      .filter((entry): entry is TrackPitchAnalysis => entry !== null),
    pitch_classes: [...pitchClassWeights.keys()].sort((a, b) => a - b),
    pitch_class_names: [...pitchClassWeights.keys()].sort((a, b) => a - b)
      .map((cls) => NOTE_NAMES[cls]!),
    declared_key: describeDeclaredKey(state, pitchClassWeights),
    inferred_keys: inferred,
    key_ambiguous: ambiguous,
    chords: findChords(pitchedAudible, patternSteps),
    caveats,
  };
}

/** Re-exported so callers can name the base note the pitches are relative to. */
export { BASE_NOTE };
