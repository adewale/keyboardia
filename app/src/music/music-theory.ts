/**
 * Music Theory Module - Scale definitions and utilities
 *
 * Provides scale definitions for the Key Assistant feature (Phase 29E).
 * All intervals are semitones relative to root (C = 0).
 */

/**
 * Scale definition with intervals and metadata
 */
export interface ScaleDefinition {
  name: string;
  shortName: string;  // For compact display
  intervals: number[];  // Semitones from root (0-11)
  category: 'pentatonic' | 'diatonic' | 'modal' | 'other';
}

/**
 * Note names for all 12 chromatic pitches
 */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type NoteName = typeof NOTE_NAMES[number];

/**
 * Root notes available for scale selection
 */
export const ROOT_NOTES = NOTE_NAMES;

/**
 * Scale library - ordered by typical use frequency
 */
export const SCALES: Record<string, ScaleDefinition> = {
  // Pentatonic scales - safest, most universal
  'minor-pentatonic': {
    name: 'Minor Pentatonic',
    shortName: 'min pent',
    intervals: [0, 3, 5, 7, 10],
    category: 'pentatonic',
  },
  'major-pentatonic': {
    name: 'Major Pentatonic',
    shortName: 'maj pent',
    intervals: [0, 2, 4, 7, 9],
    category: 'pentatonic',
  },

  // Diatonic scales - standard Western music
  'natural-minor': {
    name: 'Natural Minor',
    shortName: 'minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    category: 'diatonic',
  },
  'major': {
    name: 'Major',
    shortName: 'major',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    category: 'diatonic',
  },
  'harmonic-minor': {
    name: 'Harmonic Minor',
    shortName: 'harm min',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    category: 'diatonic',
  },
  'melodic-minor': {
    name: 'Melodic Minor',
    shortName: 'mel min',
    intervals: [0, 2, 3, 5, 7, 9, 11],
    category: 'diatonic',
  },

  // Modal scales - jazz, world music
  'dorian': {
    name: 'Dorian',
    shortName: 'dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    category: 'modal',
  },
  'phrygian': {
    name: 'Phrygian',
    shortName: 'phryg',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    category: 'modal',
  },
  'lydian': {
    name: 'Lydian',
    shortName: 'lydian',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    category: 'modal',
  },
  'mixolydian': {
    name: 'Mixolydian',
    shortName: 'mixo',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    category: 'modal',
  },
  'locrian': {
    name: 'Locrian',
    shortName: 'locrian',
    intervals: [0, 1, 3, 5, 6, 8, 10],
    category: 'modal',
  },

  // Other useful scales
  'blues': {
    name: 'Blues',
    shortName: 'blues',
    intervals: [0, 3, 5, 6, 7, 10],
    category: 'other',
  },
  'whole-tone': {
    name: 'Whole Tone',
    shortName: 'whole',
    intervals: [0, 2, 4, 6, 8, 10],
    category: 'other',
  },
  'chromatic': {
    name: 'Chromatic',
    shortName: 'chrom',
    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    category: 'other',
  },
} as const;

export type ScaleId = keyof typeof SCALES;

/**
 * Default scale state - C minor pentatonic (safest for beginners)
 */
export const DEFAULT_SCALE_ROOT: NoteName = 'C';
export const DEFAULT_SCALE_ID: ScaleId = 'minor-pentatonic';
export const DEFAULT_SCALE_LOCK = false;

/**
 * Scale state for session
 */
export interface ScaleState {
  root: NoteName;       // Root note (C, C#, D, etc.)
  scaleId: ScaleId;     // Scale type identifier
  locked: boolean;      // Whether scale lock is active
}

/**
 * Default scale state
 */
export const DEFAULT_SCALE_STATE: ScaleState = {
  root: DEFAULT_SCALE_ROOT,
  scaleId: DEFAULT_SCALE_ID,
  locked: DEFAULT_SCALE_LOCK,
};

/**
 * Get the actual scale intervals transposed to a root note
 * @param root Root note (0-11, where C=0)
 * @param scaleId Scale identifier
 * @returns Array of MIDI note numbers (0-11) in the scale
 */
export function getScaleNotes(rootIndex: number, scaleId: ScaleId): number[] {
  const scale = SCALES[scaleId];
  if (!scale) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // Chromatic fallback

  return scale.intervals.map(interval => (rootIndex + interval) % 12);
}

/**
 * Get root note index from note name
 */
export function getRootIndex(root: NoteName): number {
  return NOTE_NAMES.indexOf(root);
}

/**
 * Check if a pitch (semitone offset from C) is in the scale
 * @param pitch Semitone offset (can be any integer, will be normalized to 0-11)
 * @param root Root note name
 * @param scaleId Scale identifier
 */
export function isInScale(pitch: number, root: NoteName, scaleId: ScaleId): boolean {
  const rootIndex = getRootIndex(root);
  const scaleNotes = getScaleNotes(rootIndex, scaleId);
  const normalizedPitch = ((pitch % 12) + 12) % 12;
  return scaleNotes.includes(normalizedPitch);
}

/**
 * Get the scale degree (1-7 or 1-12) for a pitch in a scale
 * Returns undefined if pitch is not in scale
 */
export function getScaleDegree(pitch: number, root: NoteName, scaleId: ScaleId): number | undefined {
  const rootIndex = getRootIndex(root);
  const scaleNotes = getScaleNotes(rootIndex, scaleId);
  const normalizedPitch = ((pitch % 12) + 12) % 12;
  const degree = scaleNotes.indexOf(normalizedPitch);
  return degree >= 0 ? degree + 1 : undefined;
}

/**
 * Check if a pitch is the root of the scale
 */
export function isRoot(pitch: number, root: NoteName): boolean {
  const rootIndex = getRootIndex(root);
  const normalizedPitch = ((pitch % 12) + 12) % 12;
  return normalizedPitch === rootIndex;
}

/**
 * Check if a pitch is the fifth of the scale
 */
export function isFifth(pitch: number, root: NoteName): boolean {
  const rootIndex = getRootIndex(root);
  const fifthIndex = (rootIndex + 7) % 12;
  const normalizedPitch = ((pitch % 12) + 12) % 12;
  return normalizedPitch === fifthIndex;
}

/**
 * Get display name for a scale with root
 * @example getScaleDisplayName('C', 'minor-pentatonic') => 'C Minor Pentatonic'
 */
export function getScaleDisplayName(root: NoteName, scaleId: ScaleId): string {
  const scale = SCALES[scaleId];
  if (!scale) return `${root} Unknown`;
  return `${root} ${scale.name}`;
}

/**
 * Get short display name for compact UI
 * @example getScaleShortName('C', 'minor-pentatonic') => 'C min pent'
 */
export function getScaleShortName(root: NoteName, scaleId: ScaleId): string {
  const scale = SCALES[scaleId];
  if (!scale) return `${root} ?`;
  return `${root} ${scale.shortName}`;
}

/**
 * Get all pitches (from ChromaticGrid range) that are in the scale
 * Used for Scale Lock to filter ChromaticGrid rows
 */
export function getInScalePitches(
  root: NoteName,
  scaleId: ScaleId,
  minPitch: number = -24,
  maxPitch: number = 24
): number[] {
  const pitches: number[] = [];
  for (let pitch = minPitch; pitch <= maxPitch; pitch++) {
    if (isInScale(pitch, root, scaleId)) {
      pitches.push(pitch);
    }
  }
  return pitches;
}

/**
 * Snap a pitch to the nearest scale note
 * Useful for quantizing out-of-scale notes
 */
export function snapToScale(pitch: number, root: NoteName, scaleId: ScaleId): number {
  if (isInScale(pitch, root, scaleId)) {
    return pitch;
  }

  const rootIndex = getRootIndex(root);
  const scaleNotes = getScaleNotes(rootIndex, scaleId);

  // Find nearest scale note
  const octave = Math.floor(pitch / 12);
  const normalizedPitch = ((pitch % 12) + 12) % 12;

  let minDistance = Infinity;
  let nearestNote = normalizedPitch;

  for (const note of scaleNotes) {
    const distance = Math.min(
      Math.abs(note - normalizedPitch),
      Math.abs(note - normalizedPitch + 12),
      Math.abs(note - normalizedPitch - 12)
    );
    if (distance < minDistance) {
      minDistance = distance;
      nearestNote = note;
    }
  }

  // Handle octave wrapping
  if (nearestNote < normalizedPitch && normalizedPitch - nearestNote > 6) {
    return octave * 12 + nearestNote + 12;
  } else if (nearestNote > normalizedPitch && nearestNote - normalizedPitch > 6) {
    return octave * 12 + nearestNote - 12;
  }

  return octave * 12 + nearestNote;
}
