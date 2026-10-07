/**
 * Piano roll dock: pure geometry and note-bar model.
 *
 * Turns a track's steps and parameter locks into the bars the dock draws.
 * A bar is a run of active steps where every step after the first carries
 * `tie: true`; its pitch and velocity come from the first step's lock.
 *
 * @see specs/PIANO-ROLL-DOCK.md (Visual Representation)
 * @see specs/mocks/piano-roll-dock.html (computeBars, rowClasses, velColor)
 */
import type { Track, ScaleState } from '../types';
import { STEPS_PER_PAGE } from '../types';
import {
  isInScale,
  isRoot,
  isFifth,
  NOTE_NAMES,
  type NoteName,
  type ScaleId,
} from '../music/music-theory';
import { isInRange } from '../audio/instrument-ranges';

/** Highest pitch row (C6). */
export const MIDI_MAX = 84;
/** Lowest pitch row (C2). */
export const MIDI_MIN = 36;
export const ROW_COUNT = MIDI_MAX - MIDI_MIN + 1;
/** Pitch row height in px. */
export const ROW_H = 18;
/** Step cell width in px; matches StepCell. */
export const STEP_W = 36;
/** Gap between step cells in px. */
export const STEP_GAP = 3;
/** Step pitch in px: one cell plus one gap. */
export const STEP_PITCH = STEP_W + STEP_GAP;
/** MIDI note a step plays with no transpose and no pitch lock (C4). */
export const BASE_MIDI = 60;
/** Volume a step plays at when its lock carries none. */
export const DEFAULT_VELOCITY = 0.8;

export interface NoteBar {
  /** First step of the bar. */
  start: number;
  /** Number of steps the bar spans (1 + following tied steps). */
  len: number;
  /** Sounding MIDI note: 60 + transpose + pitch lock. */
  midi: number;
  /** Velocity 0..1 from the first step's volume lock. */
  vel: number;
}

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;
export const isBlackKey = (midi: number): boolean => BLACK_PCS.has(pitchClass(midi));

/** "C4" for MIDI 60. */
export function noteName(midi: number): string {
  return `${NOTE_NAMES[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;
}

/** Row index from the top (0 = MIDI_MAX). */
export const rowOf = (midi: number): number => MIDI_MAX - midi;

/** The fields of a track that its note bars are computed from. */
export type BarSource = Pick<Track, 'steps' | 'parameterLocks' | 'transpose' | 'stepCount'>;

export function trackLength(track: Pick<Track, 'stepCount'>): number {
  return track.stepCount ?? STEPS_PER_PAGE;
}

/** The pitch lock value that makes a step on `track` sound `midi`. */
export function pitchLockFor(track: Track, midi: number): number {
  return midi - BASE_MIDI - (track.transpose ?? 0);
}

/**
 * Merge consecutive active steps into bars. A step continues the bar before
 * it only when it is active, the previous step is active, and its own lock
 * carries `tie: true`.
 */
export function computeBars(track: BarSource, length: number = trackLength(track)): NoteBar[] {
  const bars: NoteBar[] = [];
  let current: NoteBar | null = null;
  for (let i = 0; i < length; i++) {
    if (!track.steps[i]) {
      current = null;
      continue;
    }
    const lock = track.parameterLocks[i];
    if (current && lock?.tie) {
      current.len++;
      continue;
    }
    current = {
      start: i,
      len: 1,
      midi: BASE_MIDI + (track.transpose ?? 0) + (lock?.pitch ?? 0),
      vel: lock?.volume ?? DEFAULT_VELOCITY,
    };
    bars.push(current);
  }
  return bars;
}

/** A ghost bar: a bar of another track, repeated across the docked length. */
export interface GhostBar extends NoteBar {
  /** 0 for the ghost track's own pass, 1+ for its repeats. */
  pass: number;
}

/**
 * Bars of a ghost track repeated modulo its own length across `length`
 * steps of the docked track, clipped at the docked track's end.
 */
export function ghostBars(ghost: Track, length: number): GhostBar[] {
  const ghostLen = trackLength(ghost);
  if (ghostLen <= 0 || length <= 0) return [];
  const bars = computeBars(ghost, ghostLen);
  const out: GhostBar[] = [];
  for (let pass = 0; pass * ghostLen < length; pass++) {
    const offset = pass * ghostLen;
    for (const b of bars) {
      const start = b.start + offset;
      if (start >= length) break;
      out.push({ ...b, start, len: Math.min(b.len, length - start), pass });
    }
  }
  return out;
}

export function barAt(bars: readonly NoteBar[], step: number, midi: number): NoteBar | undefined {
  return bars.find(b => b.midi === midi && step >= b.start && step < b.start + b.len);
}

export function isPitchInScale(midi: number, scale: ScaleState | undefined): boolean {
  if (!scale?.locked) return true;
  return isInScale(midi - BASE_MIDI, scale.root as NoteName, scale.scaleId as ScaleId);
}

/** Nearest in-scale pitch, searching down then up one semitone at a time. */
export function snapToScale(midi: number, scale: ScaleState | undefined): number {
  if (isPitchInScale(midi, scale)) return midi;
  for (let d = 1; d < 12; d++) {
    if (midi - d >= MIDI_MIN && isPitchInScale(midi - d, scale)) return midi - d;
    if (midi + d <= MIDI_MAX && isPitchInScale(midi + d, scale)) return midi + d;
  }
  return midi;
}

/** Row classes shared by the grid rows and the keys. */
export function rowClasses(midi: number, sampleId: string, scale: ScaleState | undefined): string[] {
  const classes = [isBlackKey(midi) ? 'black' : 'white'];
  if (pitchClass(midi) === 0) classes.push('c');
  const root = (scale?.root ?? 'C') as NoteName;
  const pitch = midi - BASE_MIDI;
  if (isRoot(pitch, root)) classes.push('root');
  else if (isFifth(pitch, root)) classes.push('fifth');
  if (!isInRange(midi, sampleId)) classes.push('out');
  if (!isPitchInScale(midi, scale)) classes.push('scale-out');
  return classes;
}

// Velocity gradient endpoints: a dark base mixed toward the accent orange
// (#e85a30). Hardcoded because CSS variables cannot be interpolated per bar.
const VEL_LO = [96, 40, 26] as const;
const VEL_HI = [232, 90, 48] as const;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function velocityColor(vel: number): string {
  const v = clamp01(vel);
  const [r, g, b] = VEL_LO.map((lo, i) => Math.round(lo + (VEL_HI[i] - lo) * v));
  return `rgb(${r}, ${g}, ${b})`;
}

export function velocityGlow(vel: number): string {
  return `rgba(232, 90, 48, ${(0.15 + clamp01(vel) * 0.45).toFixed(2)})`;
}

/**
 * White key spans at real piano proportions, in rows measured from the
 * key's own row (lower edge, upper edge): C, E, F and B are short, D, G and
 * A long, so the black keys sit between them as on a real keyboard.
 */
export const WHITE_SPAN: Readonly<Record<number, readonly [number, number]>> = {
  0: [0, 1.5],
  2: [-0.5, 1.5],
  4: [-0.5, 1],
  5: [0, 1.5],
  7: [-0.5, 1.5],
  9: [-0.5, 1.5],
  11: [-0.5, 1],
};

/** Top and height in px of a key on the keyboard column. */
export function keyGeometry(midi: number): { top: number; height: number } {
  if (isBlackKey(midi)) return { top: rowOf(midi) * ROW_H, height: ROW_H };
  const span = WHITE_SPAN[pitchClass(midi)];
  const fromBottom = midi - MIDI_MIN;
  const top = Math.max(0, (ROW_COUNT - (fromBottom + span[1])) * ROW_H);
  const bottom = Math.min(ROW_COUNT * ROW_H, (ROW_COUNT - (fromBottom + span[0])) * ROW_H);
  return { top, height: bottom - top };
}
