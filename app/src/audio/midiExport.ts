/**
 * MIDI Export - Phase 32
 *
 * Exports Keyboardia sessions as Standard MIDI Files (SMF Type 1)
 * for use in DAWs and other music software.
 *
 * @see /specs/MIDI-EXPORT.md for full specification
 */

import MidiWriter from 'midi-writer-js';
import type { Track as KeyboardiaTrack, GridState, ParameterLock } from '../types';

// Extract track type from the MidiWriter default export
type MidiTrack = InstanceType<typeof MidiWriter.Track>;

// ============================================================================
// Constants
// ============================================================================

/** MIDI ticks per quarter note (midi-writer-js default) */
const TICKS_PER_QUARTER = 128;

/** Steps per beat (16th note resolution) */
const STEPS_PER_BEAT = 4;

/** Ticks per step (128 / 4 = 32) */
const TICKS_PER_STEP = TICKS_PER_QUARTER / STEPS_PER_BEAT;

/** Note duration in ticks (one step minus 1 for note-off before next note-on) */
const NOTE_DURATION_TICKS = TICKS_PER_STEP - 1;

/** Default MIDI velocity when no volume p-lock */
const DEFAULT_VELOCITY = 100;

/** Base note for synth tracks (Middle C / C4) */
const BASE_NOTE = 60;

/** MIDI channel for drums (1-indexed, so 10 for GM drums) */
const DRUM_CHANNEL = 10;

// ============================================================================
// Drum Note Mapping (General MIDI)
// ============================================================================

const DRUM_NOTE_MAP: Record<string, number> = {
  kick: 36,      // C2 - Bass Drum 1
  snare: 38,     // D2 - Acoustic Snare
  hihat: 42,     // F#2 - Closed Hi-Hat
  openhat: 46,   // A#2 - Open Hi-Hat
  clap: 39,      // D#2 - Hand Clap
  tom: 45,       // A2 - Low Tom
  rim: 37,       // C#2 - Side Stick
  cowbell: 56,   // G#3 - Cowbell
};

// ============================================================================
// Synth Program Mapping (General MIDI)
// ============================================================================

const SYNTH_PROGRAM_MAP: Record<string, number> = {
  // Core synths
  bass: 33,       // Electric Bass (Finger)
  subbass: 39,    // Synth Bass 2
  lead: 81,       // Lead 1 (Square)
  pad: 89,        // Pad 1 (New Age)
  pluck: 46,      // Orchestral Harp
  chord: 89,      // Pad 1 (New Age)

  // Synth presets
  acid: 87,       // Lead 7 (Fifths)
  rhodes: 5,      // Electric Piano 1
  organ: 17,      // Drawbar Organ
  strings: 49,    // String Ensemble 1
  brass: 62,      // Brass Section
  piano: 1,       // Acoustic Grand Piano
  funkbass: 37,   // Slap Bass 1

  // Tone.js presets - map to closest GM equivalent
  'fm-epiano': 5,       // Electric Piano 1
  'am-synth': 81,       // Lead 1 (Square)
  'membrane': 47,       // Timpani (for membrane synth)
  'metal': 14,          // Tubular Bells
  'pluck-synth': 46,    // Orchestral Harp

  // Default for unknown
  default: 1,    // Acoustic Grand Piano
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determines if a track is a drum track based on its sampleId
 */
export function isDrumTrack(track: KeyboardiaTrack): boolean {
  const sampleId = track.sampleId.toLowerCase();

  // Check if it's a direct drum sample
  if (DRUM_NOTE_MAP[sampleId] !== undefined) {
    return true;
  }

  // Check for custom recordings (mic:*) - treat as drums on channel 10
  if (sampleId.startsWith('mic:') || sampleId.startsWith('recording:')) {
    return true;
  }

  return false;
}

/**
 * Gets the MIDI note number for a drum track
 */
export function getDrumNote(track: KeyboardiaTrack): number {
  const sampleId = track.sampleId.toLowerCase();

  // Direct drum sample
  if (DRUM_NOTE_MAP[sampleId] !== undefined) {
    return DRUM_NOTE_MAP[sampleId];
  }

  // Custom recording - use a placeholder note (60 = C4)
  // User can reassign in DAW
  return 60;
}

/**
 * Gets the General MIDI program number for a synth track
 */
export function getSynthProgram(track: KeyboardiaTrack): number {
  const sampleId = track.sampleId.toLowerCase();

  // Check for synth: prefix (e.g., "synth:rhodes")
  if (sampleId.startsWith('synth:')) {
    const preset = sampleId.slice(6);
    return SYNTH_PROGRAM_MAP[preset] ?? SYNTH_PROGRAM_MAP.default;
  }

  // Check for tone: prefix (e.g., "tone:fm-epiano")
  if (sampleId.startsWith('tone:')) {
    const preset = sampleId.slice(5);
    return SYNTH_PROGRAM_MAP[preset] ?? SYNTH_PROGRAM_MAP.default;
  }

  // Check for advanced: prefix
  if (sampleId.startsWith('advanced:')) {
    const preset = sampleId.slice(9);
    // Map advanced synths to closest GM equivalent
    if (preset.includes('bass')) return SYNTH_PROGRAM_MAP.bass;
    if (preset.includes('lead')) return SYNTH_PROGRAM_MAP.lead;
    if (preset.includes('pad')) return SYNTH_PROGRAM_MAP.pad;
    if (preset.includes('pluck')) return SYNTH_PROGRAM_MAP.pluck;
    return SYNTH_PROGRAM_MAP.default;
  }

  // Check for sampled: prefix (e.g., "sampled:piano")
  if (sampleId.startsWith('sampled:')) {
    const instrument = sampleId.slice(8);
    return SYNTH_PROGRAM_MAP[instrument] ?? SYNTH_PROGRAM_MAP.piano;
  }

  // Direct synth sample (bass, lead, etc.)
  return SYNTH_PROGRAM_MAP[sampleId] ?? SYNTH_PROGRAM_MAP.default;
}

/**
 * Gets the MIDI note pitch for a synth step
 * Clamps to valid MIDI range (0-127) to prevent wrap-around
 */
export function getSynthNotePitch(
  track: KeyboardiaTrack,
  pLock: ParameterLock | null
): number {
  // Base note + track transpose + p-lock pitch
  const pitchOffset = pLock?.pitch ?? 0;
  const rawNote = BASE_NOTE + track.transpose + pitchOffset;
  // Clamp to valid MIDI range to prevent wrap-around (note 144 → 16)
  return Math.max(0, Math.min(127, rawNote));
}

/**
 * Gets the velocity value for midi-writer-js (1-100 percentage scale)
 * Note: midi-writer-js treats velocity as percentage and scales to MIDI range
 */
export function getVelocity(pLock: ParameterLock | null): number {
  if (pLock?.volume !== undefined) {
    // Volume p-lock (0.0 - 1.0) → percentage (1 - 100)
    // midi-writer-js then scales this to MIDI velocity (1 - 127)
    return Math.max(1, Math.round(pLock.volume * 100));
  }
  return DEFAULT_VELOCITY;
}

/**
 * Converts step number to MIDI ticks, applying swing
 *
 * @param step - Step number (0-indexed)
 * @param swing - Swing amount (0-100)
 * @returns Tick position
 */
export function stepToTicks(step: number, swing: number): number {
  const baseTicks = step * TICKS_PER_STEP;

  // Apply swing to off-beat steps (1, 3, 5, 7...)
  if (step % 2 === 1 && swing > 0) {
    // Swing pushes off-beats forward
    // At 50% swing, off-beats are pushed by 50% of a step (triplet feel)
    const swingOffset = (swing / 100) * TICKS_PER_STEP * 0.5;
    return Math.round(baseTicks + swingOffset);
  }

  return baseTicks;
}

/**
 * Calculate LCM of two numbers (for polyrhythm length calculation)
 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

/**
 * Calculate the total pattern length in steps (LCM of all track lengths)
 * This ensures polyrhythmic patterns are properly captured
 *
 * Respects the same mute/solo logic as the audio scheduler:
 * - If any track is soloed, only consider soloed tracks
 * - Otherwise, consider all unmuted tracks
 */
export function calculatePatternLength(tracks: KeyboardiaTrack[]): number {
  if (tracks.length === 0) return 16; // Default to one bar

  // Apply same logic as audio scheduler: solo wins over mute
  const anySoloed = tracks.some(t => t.soloed);
  const activeTracks = tracks.filter(t => {
    const shouldInclude = anySoloed ? t.soloed : !t.muted;
    return shouldInclude && t.steps.some(s => s);
  });

  if (activeTracks.length === 0) return 16;

  return activeTracks.reduce(
    (currentLcm, track) => lcm(currentLcm, track.stepCount),
    activeTracks[0].stepCount
  );
}

/**
 * Sanitizes a filename by removing/replacing invalid characters
 */
export function sanitizeFilename(name: string | null): string {
  if (!name || name.trim() === '') {
    return 'keyboardia-session';
  }

  return name
    .trim()
    .slice(0, 100) // Limit length
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
    || 'keyboardia-session'; // Fallback if nothing left
}

// ============================================================================
// Main Export Function
// ============================================================================

export interface MidiExportOptions {
  /** Session name for filename (optional) */
  sessionName?: string | null;
}

export interface MidiExportResult {
  /** MIDI file as Blob */
  blob: Blob;
  /** Suggested filename */
  filename: string;
  /** Raw MIDI data (for testing) */
  _midiData: Uint8Array;
}

/**
 * Exports a Keyboardia session to a Standard MIDI File
 *
 * @param state - The grid state to export
 * @param options - Export options
 * @returns MIDI file blob and filename
 */
export function exportToMidi(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  options: MidiExportOptions = {}
): MidiExportResult {
  const tracks: MidiTrack[] = [];

  // ========================================
  // Track 0: Tempo Track (meta events only)
  // ========================================
  const tempoTrack = new MidiWriter.Track();
  tempoTrack.setTempo(state.tempo);
  tempoTrack.setTimeSignature(4, 4, 24, 8);
  tempoTrack.addTrackName('Tempo');
  tracks.push(tempoTrack);

  // ========================================
  // Calculate pattern length for polyrhythms
  // ========================================
  const patternLength = calculatePatternLength(state.tracks);

  // ========================================
  // Determine which tracks should be exported
  // Same logic as audio scheduler: solo wins over mute
  // ========================================
  const anySoloed = state.tracks.some(t => t.soloed);

  // ========================================
  // Instrument Tracks
  // ========================================
  let synthChannelCounter = 1; // Start at 1, skip 10 for drums

  for (const keyboardiaTrack of state.tracks) {
    // Apply same logic as audio scheduler:
    // - If any track is soloed, only export soloed tracks (solo wins over mute)
    // - Otherwise, export all unmuted tracks
    const shouldExport = anySoloed ? keyboardiaTrack.soloed : !keyboardiaTrack.muted;
    if (!shouldExport) continue;

    // Skip tracks with no active steps
    if (!keyboardiaTrack.steps.some(s => s)) continue;

    const midiTrack = new MidiWriter.Track();
    midiTrack.addTrackName(keyboardiaTrack.name);

    const isDrum = isDrumTrack(keyboardiaTrack);

    // Determine channel
    let channel: number;
    if (isDrum) {
      channel = DRUM_CHANNEL;
    } else {
      // Assign synth channel (1-9, 11-16), skipping channel 10
      channel = synthChannelCounter;
      synthChannelCounter++;
      if (synthChannelCounter === 10) synthChannelCounter++; // Skip drum channel
      if (synthChannelCounter > 16) synthChannelCounter = 1; // Wrap around
    }

    // Add program change for synth tracks
    if (!isDrum) {
      const program = getSynthProgram(keyboardiaTrack);
      // Convert from 1-indexed GM program numbers to 0-indexed MIDI
      midiTrack.addEvent(
        new MidiWriter.ProgramChangeEvent({ instrument: program - 1, channel })
      );
    }

    // ========================================
    // Generate notes for pattern length
    // ========================================
    // Polyrhythm: each track loops at its own stepCount
    // We need to expand to the full pattern length (LCM)
    const loopCount = patternLength / keyboardiaTrack.stepCount;

    for (let loop = 0; loop < loopCount; loop++) {
      const loopOffset = loop * keyboardiaTrack.stepCount;

      for (let step = 0; step < keyboardiaTrack.stepCount; step++) {
        if (!keyboardiaTrack.steps[step]) continue;

        const pLock = keyboardiaTrack.parameterLocks[step] || null;
        const absoluteStep = loopOffset + step;
        const startTick = stepToTicks(absoluteStep, state.swing);
        const velocity = getVelocity(pLock);

        // Get pitch (clamped to valid MIDI range 0-127)
        let pitch: number;
        if (isDrum) {
          pitch = getDrumNote(keyboardiaTrack);
          // Apply pitch offset for drums too (affects tom tuning, etc.)
          if (pLock?.pitch) {
            pitch = Math.max(0, Math.min(127, pitch + pLock.pitch));
          }
        } else {
          pitch = getSynthNotePitch(keyboardiaTrack, pLock);
        }

        // Add note event
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

  // ========================================
  // Build MIDI file
  // ========================================
  const writer = new MidiWriter.Writer(tracks);
  const midiData = writer.buildFile();
  // Create a new ArrayBuffer to ensure proper typing for Blob
  const buffer = new ArrayBuffer(midiData.length);
  new Uint8Array(buffer).set(midiData);
  const blob = new Blob([buffer], { type: 'audio/midi' });

  const filename = `${sanitizeFilename(options.sessionName ?? null)}.mid`;

  return { blob, filename, _midiData: midiData };
}

/**
 * Downloads a MIDI file to the user's device
 *
 * @param state - The grid state to export
 * @param sessionName - Session name for filename
 */
export function downloadMidi(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  sessionName: string | null = null
): void {
  const { blob, filename } = exportToMidi(state, { sessionName });

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  // Trigger download
  document.body.appendChild(a);
  a.click();

  // Cleanup
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
