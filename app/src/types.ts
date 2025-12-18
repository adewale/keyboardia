// Re-export shared sync types (canonical definitions in shared/sync-types.ts)
export type { PlaybackMode, ParameterLock, FMParams, EffectsState } from './shared/sync-types';
import type { PlaybackMode, ParameterLock, FMParams, EffectsState } from './shared/sync-types';

// Grid state types
export interface GridState {
  tracks: Track[];
  tempo: number;
  swing: number; // 0-100, percentage of swing (0 = straight, 50 = triplet feel)
  effects?: EffectsState; // Phase 25: Audio effects state (optional for backwards compatibility)
  isPlaying: boolean;
  currentStep: number; // Global step counter (0-127 for 8x multiplier)
}

// Maximum steps per track (supports multi-page patterns)
// 128 steps = 8 bars at 16th note resolution = full verse/chorus section
export const MAX_STEPS = 128;
export const STEPS_PER_PAGE = 16;

// Valid step count options for the dropdown
// 4 = loops 4× per bar (pulse), 8 = loops 2× per bar, 16 = 1 bar, etc.
// 12 = triplet feel (jazz/gospel), 24 = triplet feel with more resolution (trap hi-hats)
// 96 = 6 bars (triplet-friendly), 128 = 8 bars (full verse/chorus)
export const STEP_COUNT_OPTIONS = [4, 8, 12, 16, 24, 32, 64, 96, 128] as const;
export type StepCountOption = typeof STEP_COUNT_OPTIONS[number];

// Tempo constraints (BPM)
export const MIN_TEMPO = 60;
export const MAX_TEMPO = 180;
export const DEFAULT_TEMPO = 120;

// Feature flags (set to false to rollback)
// When true, playhead is hidden on muted tracks and non-soloed tracks (when any track is soloed)
export const HIDE_PLAYHEAD_ON_SILENT_TRACKS = true;

// Swing constraints (percentage)
export const MIN_SWING = 0;
export const MAX_SWING = 100;
export const DEFAULT_SWING = 0;

export interface Track {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[]; // Up to 128 steps - true/false for on/off
  parameterLocks: (ParameterLock | null)[]; // Up to 128 slots, null = no lock
  volume: number;
  muted: boolean;
  soloed: boolean; // When any track is soloed, only soloed tracks play
  playbackMode: PlaybackMode; // Default: 'oneshot'
  transpose: number; // Semitones offset for entire track (-12 to +12), default 0
  stepCount: number; // How many steps before loop (1-128), default 16
  fmParams?: FMParams; // Optional FM synth params (only for tone:fm-* presets)
}

// Audio types
export interface Sample {
  id: string;
  name: string;
  buffer: AudioBuffer | null;
  url: string;
}

// Base action type with optional isRemote flag for multiplayer
interface BaseAction {
  isRemote?: boolean; // True if action came from another player (skip sending to server)
}

// Actions for reducer
export type GridAction =
  | ({ type: 'TOGGLE_STEP'; trackId: string; step: number } & BaseAction)
  | ({ type: 'SET_TEMPO'; tempo: number } & BaseAction)
  | ({ type: 'SET_SWING'; swing: number } & BaseAction)
  | ({ type: 'SET_PLAYING'; isPlaying: boolean } & BaseAction)
  | ({ type: 'SET_CURRENT_STEP'; step: number } & BaseAction)
  | ({ type: 'SET_TRACK_VOLUME'; trackId: string; volume: number } & BaseAction)
  | ({ type: 'SET_TRACK_TRANSPOSE'; trackId: string; transpose: number } & BaseAction)
  | ({ type: 'SET_TRACK_STEP_COUNT'; trackId: string; stepCount: number } & BaseAction)
  | ({ type: 'SET_TRACK_PLAYBACK_MODE'; trackId: string; playbackMode: PlaybackMode } & BaseAction)
  | ({ type: 'SET_FM_PARAMS'; trackId: string; fmParams: FMParams } & BaseAction)
  | ({ type: 'SET_EFFECTS'; effects: EffectsState } & BaseAction)
  | ({ type: 'TOGGLE_MUTE'; trackId: string } & BaseAction)
  | ({ type: 'TOGGLE_SOLO'; trackId: string } & BaseAction)
  | ({ type: 'EXCLUSIVE_SOLO'; trackId: string } & BaseAction)
  | ({ type: 'CLEAR_ALL_SOLOS' } & BaseAction)
  | ({ type: 'CLEAR_TRACK'; trackId: string } & BaseAction)
  | ({ type: 'SET_TRACK_SAMPLE'; trackId: string; sampleId: string; name?: string } & BaseAction)
  | ({ type: 'SET_PARAMETER_LOCK'; trackId: string; step: number; lock: ParameterLock | null } & BaseAction)
  | ({ type: 'ADD_TRACK'; sampleId: string; name: string; track?: Track } & BaseAction)
  | ({ type: 'DELETE_TRACK'; trackId: string } & BaseAction)
  | ({ type: 'COPY_SEQUENCE'; fromTrackId: string; toTrackId: string } & BaseAction)
  | ({ type: 'MOVE_SEQUENCE'; fromTrackId: string; toTrackId: string } & BaseAction)
  | ({ type: 'LOAD_STATE'; tracks: Track[]; tempo: number; swing: number; effects?: EffectsState } & BaseAction)
  | ({ type: 'RESET_STATE' } & BaseAction)
  // Phase 9: Remote-specific actions (for explicit state setting, not toggling)
  | ({ type: 'REMOTE_STEP_SET'; trackId: string; step: number; value: boolean } & BaseAction)
  | ({ type: 'REMOTE_MUTE_SET'; trackId: string; muted: boolean } & BaseAction)
  | ({ type: 'REMOTE_SOLO_SET'; trackId: string; soloed: boolean } & BaseAction)

export const MAX_TRACKS = 16;

// All built-in samples organized by category
export const SAMPLE_CATEGORIES = {
  drums: ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat',
          'shaker', 'conga', 'tambourine', 'clave', 'cabasa', 'woodblock'],
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
