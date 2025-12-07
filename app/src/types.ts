// Grid state types
export interface GridState {
  tracks: Track[];
  tempo: number;
  swing: number; // 0-100, percentage of swing (0 = straight, 50 = triplet feel)
  isPlaying: boolean;
  currentStep: number; // Global step counter (0-127 for 8x multiplier)
}

/**
 * Playback mode for samples - based on industry standards from
 * Teenage Engineering, Elektron, Ableton, Roland, and Akai.
 *
 * - 'oneshot': Sample plays to completion regardless of step duration.
 *              This is the DEFAULT and industry standard behavior.
 *              Best for: drums, recordings, one-shot samples.
 *
 * - 'gate': Sample is cut at step boundary (gated playback).
 *           Sample only plays while "held" (for the step duration).
 *           Best for: sustained synth pads, drones (future use case).
 */
export type PlaybackMode = 'oneshot' | 'gate';

/**
 * Parameter Lock - per-step parameter overrides (Elektron-style).
 * Each step can have different pitch, volume, etc.
 * Only non-undefined values override the track default.
 */
export interface ParameterLock {
  pitch?: number;  // Semitones offset from original (-12 to +12)
  volume?: number; // 0-1, multiplier on track volume
}

// Maximum steps per track (supports multi-page patterns)
export const MAX_STEPS = 64;
export const STEPS_PER_PAGE = 16;

// Tempo constraints (BPM)
export const MIN_TEMPO = 60;
export const MAX_TEMPO = 180;
export const DEFAULT_TEMPO = 120;

// Swing constraints (percentage)
export const MIN_SWING = 0;
export const MAX_SWING = 100;
export const DEFAULT_SWING = 0;

export interface Track {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[]; // Up to 64 steps - true/false for on/off
  parameterLocks: (ParameterLock | null)[]; // Up to 64 slots, null = no lock
  volume: number;
  muted: boolean;
  playbackMode: PlaybackMode; // Default: 'oneshot'
  transpose: number; // Semitones offset for entire track (-12 to +12), default 0
  stepCount: number; // How many steps before loop (1-64), default 16
}

// Audio types
export interface Sample {
  id: string;
  name: string;
  buffer: AudioBuffer | null;
  url: string;
}

// Actions for reducer
export type GridAction =
  | { type: 'TOGGLE_STEP'; trackId: string; step: number }
  | { type: 'SET_TEMPO'; tempo: number }
  | { type: 'SET_SWING'; swing: number }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SET_CURRENT_STEP'; step: number }
  | { type: 'SET_TRACK_VOLUME'; trackId: string; volume: number }
  | { type: 'SET_TRACK_TRANSPOSE'; trackId: string; transpose: number }
  | { type: 'SET_TRACK_STEP_COUNT'; trackId: string; stepCount: number }
  | { type: 'TOGGLE_MUTE'; trackId: string }
  | { type: 'CLEAR_TRACK'; trackId: string }
  | { type: 'SET_TRACK_SAMPLE'; trackId: string; sampleId: string }
  | { type: 'SET_PARAMETER_LOCK'; trackId: string; step: number; lock: ParameterLock | null }
  | { type: 'ADD_TRACK'; sampleId: string; name: string }
  | { type: 'DELETE_TRACK'; trackId: string }
  | { type: 'COPY_SEQUENCE'; fromTrackId: string; toTrackId: string }
  | { type: 'MOVE_SEQUENCE'; fromTrackId: string; toTrackId: string }
  | { type: 'LOAD_STATE'; tracks: Track[]; tempo: number; swing: number };

export const MAX_TRACKS = 16;

// All built-in samples organized by category
export const SAMPLE_CATEGORIES = {
  drums: ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat'],
  bass: ['bass', 'subbass'],
  synth: ['lead', 'pluck', 'chord', 'pad'],
  fx: ['zap', 'noise'],
} as const;

// Flat list of all sample IDs
export const ALL_SAMPLES = [
  ...SAMPLE_CATEGORIES.drums,
  ...SAMPLE_CATEGORIES.bass,
  ...SAMPLE_CATEGORIES.synth,
  ...SAMPLE_CATEGORIES.fx,
] as const;

// Default tracks to show on load (classic 4-on-the-floor kit)
export const DEFAULT_SAMPLES = ['kick', 'snare', 'hihat', 'clap'] as const;
export type DefaultSampleId = typeof DEFAULT_SAMPLES[number];
export type SampleId = typeof ALL_SAMPLES[number];
