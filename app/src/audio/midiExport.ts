/**
 * MIDI Export for Keyboardia
 *
 * Exports sessions as Standard MIDI Files (SMF Type 1) for DAW integration.
 *
 * @see /specs/MIDI-EXPORT.md for full specification
 *
 * Key design decisions:
 * - Track selection MUST match scheduler.ts logic (solo wins over mute)
 * - Velocity is percentage (0-100) for midi-writer-js, not MIDI value (0-127)
 * - Program numbers are 0-indexed in MIDI, but spec uses 1-indexed GM numbers
 * - Note pitch clamped to 0-127 to prevent wrap-around
 * - Swing applies only to off-beat steps (1, 3, 5, 7...)
 */

import MidiWriter from 'midi-writer-js';
import type { Track as KeyboardiaTrack, GridState } from '../types';
import { DEFAULT_STEP_COUNT } from '../types';
import type { ParameterLock } from '../shared/sync-types';
import { parseInstrumentId } from './instrument-types';

// ============================================================================
// Constants
// ============================================================================

/** Ticks per quarter note (midi-writer-js default PPQN) */
export const TICKS_PER_QUARTER = 128;

/** Steps per beat (16th note resolution) */
export const STEPS_PER_BEAT = 4;

/** Ticks per step (128 / 4 = 32) */
export const TICKS_PER_STEP = TICKS_PER_QUARTER / STEPS_PER_BEAT;

/** Note duration in ticks (one step minus 1 tick to prevent overlap) */
export const NOTE_DURATION_TICKS = TICKS_PER_STEP - 1;

/** Default velocity as percentage (100% = MIDI 127) */
export const DEFAULT_VELOCITY = 100;

/** Base MIDI note for synth tracks (Middle C / C4) */
export const BASE_NOTE = 60;

/** General MIDI drum channel */
export const DRUM_CHANNEL = 10;

// ============================================================================
// Mappings
// ============================================================================

/**
 * Drum sample to GM drum note mapping.
 * Standard GM drum notes are in the 35-81 range.
 */
export const DRUM_NOTE_MAP: Record<string, number> = {
  kick: 36,      // C2 - Bass Drum 1
  snare: 38,     // D2 - Acoustic Snare
  hihat: 42,     // F#2 - Closed Hi-Hat
  openhat: 46,   // A#2 - Open Hi-Hat
  clap: 39,      // D#2 - Hand Clap
  tom: 45,       // A2 - Low Tom
  rim: 37,       // C#2 - Side Stick
  cowbell: 56,   // G#3 - Cowbell
  // Additional percussion
  shaker: 70,    // Maracas
  conga: 63,     // Open High Conga
  tambourine: 54, // Tambourine
  clave: 75,     // Claves
  cabasa: 69,    // Cabasa
  woodblock: 76, // Hi Wood Block
};

/**
 * Synth preset to GM program number mapping (1-indexed per GM spec).
 * midi-writer-js requires 0-indexed, so subtract 1 when using.
 */
export const SYNTH_PROGRAM_MAP: Record<string, number> = {
  bass: 33,        // Electric Bass Finger
  subbass: 39,     // Synth Bass 2
  lead: 81,        // Lead 1 Square
  pad: 89,         // Pad 1 New Age
  chord: 89,       // Pad 1 New Age
  pluck: 46,       // Orchestral Harp
  acid: 87,        // Lead 7 Fifths
  rhodes: 5,       // Electric Piano 1
  organ: 17,       // Drawbar Organ
  strings: 49,     // String Ensemble 1
  brass: 62,       // Brass Section
  piano: 1,        // Acoustic Grand Piano
  funkbass: 37,    // Slap Bass 1
  'fm-epiano': 5,  // Electric Piano 1
  'am-synth': 81,  // Lead 1 Square
  membrane: 47,    // Timpani
  metal: 14,       // Tubular Bells
  'pluck-synth': 46, // Orchestral Harp
};

/** Default GM program when preset not found */
export const DEFAULT_PROGRAM = 1; // Acoustic Grand Piano

// ============================================================================
// Types
// ============================================================================

export interface MidiExportOptions {
  sessionName?: string | null;
}

export interface MidiExportResult {
  blob: Blob;
  filename: string;
  /** Raw MIDI data for testing */
  _midiData: Uint8Array;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determines if a track is a drum track based on its sampleId.
 *
 * Drum tracks:
 * - Standard drum samples (kick, snare, hihat, etc.)
 * - Custom mic recordings (mic:* prefix) - MIDI-specific handling
 *
 * Synth tracks:
 * - synth:* prefix
 * - tone:* prefix
 * - sampled:* prefix
 * - Any other sample not in DRUM_NOTE_MAP
 */
export function isDrumTrack(track: KeyboardiaTrack): boolean {
  const sampleId = track.sampleId.toLowerCase();

  // MIDI-specific: Custom mic recordings are treated as drums (play on channel 10)
  // This is handled separately since mic: is not a general instrument namespace
  if (sampleId.startsWith('mic:')) {
    return true;
  }

  const { type, presetId } = parseInstrumentId(sampleId);

  // Melodic instruments (synth, sampled, tone, advanced) are NOT drums
  if (type === 'synth' || type === 'sampled' || type === 'tone' || type === 'advanced') {
    return false;
  }

  // Plain samples: check if it's a known drum sample
  return presetId in DRUM_NOTE_MAP;
}

/**
 * Gets the GM drum note for a drum track.
 * Returns 60 (Middle C) as fallback for unknown drums (e.g., mic recordings).
 */
export function getDrumNote(track: KeyboardiaTrack): number {
  const sampleId = track.sampleId.toLowerCase();

  // MIDI-specific: Custom mic recordings use Middle C as placeholder
  if (sampleId.startsWith('mic:')) {
    return BASE_NOTE;
  }

  const { presetId } = parseInstrumentId(sampleId);
  return DRUM_NOTE_MAP[presetId] ?? BASE_NOTE;
}

/**
 * Gets the GM program number for a synth track (1-indexed per GM spec).
 * Returns 1 (Acoustic Grand Piano) as fallback.
 */
export function getSynthProgram(track: KeyboardiaTrack): number {
  const sampleId = track.sampleId.toLowerCase();
  // parseInstrumentId strips the prefix and gives us the preset name
  const { presetId } = parseInstrumentId(sampleId);

  return SYNTH_PROGRAM_MAP[presetId] ?? DEFAULT_PROGRAM;
}

/**
 * Calculates the final MIDI note for a synth track, including transpose and p-lock.
 * Result is clamped to 0-127 to prevent wrap-around.
 */
export function getSynthNotePitch(
  track: KeyboardiaTrack,
  pLock: ParameterLock | null
): number {
  const transpose = track.transpose ?? 0;
  const pitchOffset = pLock?.pitch ?? 0;
  const rawPitch = BASE_NOTE + transpose + pitchOffset;

  // Clamp to valid MIDI range (0-127)
  return Math.max(0, Math.min(127, rawPitch));
}

/**
 * Gets velocity as a percentage (0-100) for midi-writer-js.
 * Note: midi-writer-js internally scales percentage to MIDI velocity (0-127).
 */
export function getVelocity(pLock: ParameterLock | null): number {
  if (pLock?.volume !== undefined) {
    // Convert 0-1 to 0-100 percentage, minimum 1
    return Math.max(1, Math.round(pLock.volume * 100));
  }
  return DEFAULT_VELOCITY;
}

/**
 * Converts step index to MIDI ticks, applying swing to off-beat steps.
 *
 * @param step - Global step index (0-based)
 * @param swing - Swing amount (0-100)
 */
export function stepToTicks(step: number, swing: number): number {
  const baseTicks = step * TICKS_PER_STEP;

  // Apply swing only to off-beat steps (1, 3, 5, 7...)
  if (step % 2 === 1 && swing > 0) {
    // Swing offset: 0-50% of a step (0-16 ticks at 100% swing)
    const swingOffset = (swing / 100) * TICKS_PER_STEP * 0.5;
    return Math.round(baseTicks + swingOffset);
  }

  return baseTicks;
}

/**
 * Calculates GCD (Greatest Common Divisor) using Euclidean algorithm.
 */
function gcd(a: number, b: number): number {
  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }
  return a;
}

/**
 * Calculates LCM (Least Common Multiple) of two numbers.
 */
function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

/**
 * Calculates the pattern length in steps for MIDI export.
 * This is the LCM of all active (exportable) track step counts.
 *
 * Only includes tracks that will be exported (respects mute/solo logic).
 */
export function calculatePatternLength(tracks: KeyboardiaTrack[]): number {
  // Filter to exportable tracks with active steps
  const anySoloed = tracks.some((t) => t.soloed);
  const activeTracks = tracks.filter((track) => {
    const shouldExport = anySoloed ? track.soloed : !track.muted;
    return shouldExport && track.steps.some((s) => s);
  });

  if (activeTracks.length === 0) {
    return 16; // Default to 1 bar
  }

  // Calculate LCM of all step counts
  return activeTracks.reduce((acc, track) => {
    const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
    return lcm(acc, stepCount);
  }, activeTracks[0].stepCount ?? DEFAULT_STEP_COUNT);
}

/**
 * Sanitizes a filename for download.
 * Removes invalid characters and limits length.
 */
export function sanitizeFilename(name: string | null | undefined): string {
  if (!name || name.trim() === '') {
    return 'keyboardia';
  }

  return (
    name
      // Replace invalid filename characters with dash
      .replace(/[<>:"/\\|?*]/g, '-')
      // Replace spaces with dashes
      .replace(/\s+/g, '-')
      // Remove multiple consecutive dashes
      .replace(/-+/g, '-')
      // Remove leading/trailing dashes
      .replace(/^-+|-+$/g, '')
      // Limit length
      .slice(0, 100) || 'keyboardia'
  );
}

// ============================================================================
// Core Export Function
// ============================================================================

/**
 * Exports a Keyboardia session to MIDI format.
 *
 * @param state - Grid state containing tracks, tempo, and swing
 * @param options - Export options (session name for filename)
 * @returns Blob, filename, and raw MIDI data
 */
export function exportToMidi(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  options: MidiExportOptions = {}
): MidiExportResult {
  // Array of midi-writer-js Track instances
  const tracks: InstanceType<typeof MidiWriter.Track>[] = [];

  // Track 0: Tempo track with time signature and tempo meta events
  const tempoTrack = new MidiWriter.Track();
  tempoTrack.setTempo(state.tempo);
  tempoTrack.setTimeSignature(4, 4, 24, 8);
  tempoTrack.addTrackName('Tempo');
  tracks.push(tempoTrack);

  // Calculate pattern length (LCM for polyrhythms)
  const patternLength = calculatePatternLength(state.tracks);

  // Track selection: MUST match scheduler.ts logic
  // @spec: track-selection - Same as audio scheduler
  const anySoloed = state.tracks.some((t) => t.soloed);

  // Channel assignment: synths use 1-9, 11-16 (skip 10 for drums)
  let synthChannelCounter = 1;
  const getNextSynthChannel = (): number => {
    const channel = synthChannelCounter;
    synthChannelCounter++;
    if (synthChannelCounter === DRUM_CHANNEL) {
      synthChannelCounter++; // Skip drum channel
    }
    if (synthChannelCounter > 16) {
      synthChannelCounter = 1; // Wrap around (shouldn't happen with 16 tracks max)
    }
    return channel;
  };

  // Export each track
  for (const keyboardiaTrack of state.tracks) {
    // Track selection: solo wins over mute
    const shouldExport = anySoloed
      ? keyboardiaTrack.soloed
      : !keyboardiaTrack.muted;
    if (!shouldExport) continue;

    // Skip empty tracks
    if (!keyboardiaTrack.steps.some((s) => s)) continue;

    const midiTrack = new MidiWriter.Track();
    midiTrack.addTrackName(keyboardiaTrack.name);

    const isDrum = isDrumTrack(keyboardiaTrack);
    const channel = isDrum ? DRUM_CHANNEL : getNextSynthChannel();

    // Add program change for synth tracks (0-indexed for MIDI)
    if (!isDrum) {
      const program = getSynthProgram(keyboardiaTrack);
      midiTrack.addEvent(
        new MidiWriter.ProgramChangeEvent({
          instrument: program - 1, // Convert 1-indexed GM to 0-indexed MIDI
          channel,
        })
      );
    }

    // Calculate how many times this track loops
    const trackStepCount = keyboardiaTrack.stepCount ?? DEFAULT_STEP_COUNT;
    const loopCount = patternLength / trackStepCount;

    // Add notes for each loop iteration
    for (let loop = 0; loop < loopCount; loop++) {
      for (let step = 0; step < trackStepCount; step++) {
        if (!keyboardiaTrack.steps[step]) continue;

        const pLock = keyboardiaTrack.parameterLocks[step];
        const absoluteStep = loop * trackStepCount + step;
        const startTick = stepToTicks(absoluteStep, state.swing);
        const velocity = getVelocity(pLock);
        const pitch = isDrum
          ? getDrumNote(keyboardiaTrack)
          : getSynthNotePitch(keyboardiaTrack, pLock);

        midiTrack.addEvent(
          new MidiWriter.NoteEvent({
            pitch: [pitch],
            velocity,
            startTick,
            duration: `T${NOTE_DURATION_TICKS}`,
            channel,
          })
        );
      }
    }

    tracks.push(midiTrack);
  }

  // Build MIDI file
  const writer = new MidiWriter.Writer(tracks);
  const midiData = writer.buildFile();

  // Convert to Uint8Array for TypeScript compatibility
  const uint8Array = new Uint8Array(midiData);

  // Create blob
  const blob = new Blob([uint8Array], { type: 'audio/midi' });

  // Generate filename
  const filename = `${sanitizeFilename(options.sessionName)}.mid`;

  return {
    blob,
    filename,
    _midiData: uint8Array,
  };
}

// ============================================================================
// Download Function
// ============================================================================

/**
 * Check if the File System Access API is available.
 * This API allows users to choose save location (Chrome/Edge only).
 */
function hasFileSystemAccess(): boolean {
  return 'showSaveFilePicker' in window;
}

/**
 * Downloads a Keyboardia session as a MIDI file.
 *
 * Uses the File System Access API when available (Chrome/Edge) to let users
 * choose the save location and filename. Falls back to auto-download for
 * browsers that don't support it (Firefox/Safari).
 *
 * @param state - Grid state containing tracks, tempo, and swing
 * @param sessionName - Optional session name for default filename
 */
export async function downloadMidi(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  sessionName?: string | null
): Promise<void> {
  const { blob, filename } = exportToMidi(state, { sessionName });

  // Try File System Access API for save dialog (Chrome/Edge)
  if (hasFileSystemAccess() && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'MIDI File',
            accept: {
              'audio/midi': ['.mid', '.midi'],
            },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled the save dialog - this is expected behavior
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      // For other errors, fall back to auto-download
      console.warn('File System Access API failed, falling back to download:', err);
    }
  }

  // Fallback: Auto-download for Firefox/Safari or if save dialog failed
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  // Append to DOM for Safari compatibility
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Release object URL to prevent memory leak
  URL.revokeObjectURL(url);
}
