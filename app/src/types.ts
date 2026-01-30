// Re-export shared sync types (canonical definitions in shared/sync-types.ts)
export type { ParameterLock, FMParams, EffectsState, ScaleState } from './shared/sync-types';
export { VALID_STEP_COUNTS } from './shared/sync-types';
import type { ParameterLock, FMParams, EffectsState, ScaleState } from './shared/sync-types';
import { VALID_STEP_COUNTS } from './shared/sync-types';

// Re-export shared constants (canonical definitions in shared/constants.ts)
export {
  MAX_TRACKS,
  MAX_STEPS,
  STEPS_PER_PAGE,
  DEFAULT_STEP_COUNT,
  MIN_TEMPO,
  MAX_TEMPO,
  DEFAULT_TEMPO,
  MIN_SWING,
  MAX_SWING,
  DEFAULT_SWING,
} from './shared/constants';
// Import for local use
import { DEFAULT_STEP_COUNT } from './shared/constants';

// Phase 31F: Step selection state (per-track selection with anchor for Shift+extend)
export interface SelectionState {
  trackId: string;
  steps: Set<number>; // Selected step indices
  anchor: number | null; // Anchor point for Shift+extend (where selection started)
}

// Phase 36: Keyboard focus state for navigation
// Separate from SelectionState: focus = keyboard navigation, selection = batch operations
export interface FocusState {
  context: 'track' | 'step' | 'none';
  trackId?: string;      // Which track is focused (for M/S shortcuts, arrow up/down)
  stepIndex?: number;    // Which step is focused (for Enter to toggle, pitch editing)
}

// Phase 31G: Loop region for playing only selected steps
export interface LoopRegion {
  start: number; // Start step (inclusive)
  end: number;   // End step (inclusive)
}

// Grid state types
export interface GridState {
  tracks: Track[];
  tempo: number;
  swing: number; // 0-100, percentage of swing (0 = straight, 50 = triplet feel)
  effects?: EffectsState; // Phase 25: Audio effects state (optional for backwards compatibility)
  scale?: ScaleState; // Phase 29E: Scale state for Key Assistant (optional for backwards compatibility)
  isPlaying: boolean;
  currentStep: number; // Global step counter (0-127 for 8x multiplier)
  // Phase 31F: Multi-select state (local only, not synced)
  selection?: SelectionState | null;
  // Phase 31G: Loop region state (synced to multiplayer)
  loopRegion?: LoopRegion | null;
  // Phase 36: Keyboard focus state (local only, not synced)
  focus?: FocusState | null;
}

// Valid step count options for the dropdown
// Re-exported from shared/sync-types.ts (single source of truth)
// See specs/POLYRHYTHM-SUPPORT.md for full documentation
export const STEP_COUNT_OPTIONS = VALID_STEP_COUNTS;
export type StepCountOption = typeof STEP_COUNT_OPTIONS[number];

// Feature flags (set to false to rollback)
// When true, playhead is hidden on muted tracks and non-soloed tracks (when any track is soloed)
export const HIDE_PLAYHEAD_ON_SILENT_TRACKS = true;

export interface Track {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[]; // Up to 128 steps - true/false for on/off
  parameterLocks: (ParameterLock | null)[]; // Up to 128 slots, null = no lock
  volume: number;
  muted: boolean;
  soloed: boolean; // When any track is soloed, only soloed tracks play
  transpose: number; // Semitones offset for entire track (-24 to +24), default 0
  stepCount: number; // How many steps before loop (1-128), default 16
  fmParams?: FMParams; // Optional FM synth params (only for tone:fm-* presets)
  swing?: number; // Phase 31D: Per-track swing (0-100), default 0 = uses global swing only
}

// Re-export SessionTrack for wire format conversion
export type { SessionTrack } from './shared/state';
import type { SessionTrack } from './shared/state';

/**
 * Convert SessionTrack (wire format, optional fields) to Track (internal, required fields).
 * Applies default values for optional fields.
 */
export function sessionTrackToTrack(sessionTrack: SessionTrack): Track {
  return {
    ...sessionTrack,
    soloed: sessionTrack.soloed ?? false,
    stepCount: sessionTrack.stepCount ?? DEFAULT_STEP_COUNT,
  };
}

/**
 * Convert an array of SessionTracks to Tracks.
 */
export function sessionTracksToTracks(sessionTracks: SessionTrack[]): Track[] {
  return sessionTracks.map(sessionTrackToTrack);
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
  | ({ type: 'LOAD_STATE'; tracks: Track[]; tempo: number; swing: number; effects?: EffectsState; scale?: ScaleState } & BaseAction)
  | ({ type: 'SET_SCALE'; scale: ScaleState } & BaseAction)
  | ({ type: 'RESET_STATE' } & BaseAction)
  // Phase 9: Remote-specific actions (for explicit state setting, not toggling)
  | ({ type: 'REMOTE_STEP_SET'; trackId: string; step: number; value: boolean } & BaseAction)
  | ({ type: 'REMOTE_MUTE_SET'; trackId: string; muted: boolean } & BaseAction)
  | ({ type: 'REMOTE_SOLO_SET'; trackId: string; soloed: boolean } & BaseAction)
  // Phase 26: Set track steps directly (used for copy_sequence sync)
  | ({ type: 'SET_TRACK_STEPS'; trackId: string; steps: boolean[]; parameterLocks: (ParameterLock | null)[]; stepCount: number } & BaseAction)
  // Session metadata sync (session title visible to all players)
  | ({ type: 'SET_SESSION_NAME'; name: string } & BaseAction)
  // Phase 31B: Pattern manipulation actions
  | ({ type: 'ROTATE_PATTERN'; trackId: string; direction: 'left' | 'right' } & BaseAction)
  | ({ type: 'INVERT_PATTERN'; trackId: string } & BaseAction)
  | ({ type: 'REVERSE_PATTERN'; trackId: string } & BaseAction)
  | ({ type: 'MIRROR_PATTERN'; trackId: string; direction?: 'left-to-right' | 'right-to-left' } & BaseAction)
  | ({ type: 'EUCLIDEAN_FILL'; trackId: string; hits: number } & BaseAction)
  // Phase 31D: Editing convenience actions
  | ({ type: 'SET_TRACK_NAME'; trackId: string; name: string } & BaseAction)
  | ({ type: 'SET_TRACK_SWING'; trackId: string; swing: number } & BaseAction)
  | ({ type: 'UNMUTE_ALL' } & BaseAction)
  // Phase 31G: Workflow features
  | ({ type: 'REORDER_TRACKS'; fromIndex: number; toIndex: number } & BaseAction)
  // Remote track reorder using trackId for commutativity
  | ({ type: 'REORDER_TRACK_BY_ID'; trackId: string; toIndex: number } & BaseAction)
  // Phase 31F: Multi-select actions (toggle and extend sync, batch operations sync results)
  | ({ type: 'SELECT_STEP'; trackId: string; step: number; mode: 'toggle' | 'extend' } & BaseAction)
  | ({ type: 'CLEAR_SELECTION' } & BaseAction)
  | ({ type: 'DELETE_SELECTED_STEPS' } & BaseAction)
  | ({ type: 'APPLY_TO_SELECTION'; lock: ParameterLock } & BaseAction)
  // Phase 31G: Loop region actions (synced to multiplayer)
  | ({ type: 'SET_LOOP_REGION'; region: LoopRegion | null } & BaseAction)
  // Phase 36: Keyboard focus actions (local only, not synced)
  | ({ type: 'FOCUS_TRACK'; trackId: string } & BaseAction)
  | ({ type: 'FOCUS_STEP'; trackId: string; stepIndex: number } & BaseAction)
  | ({ type: 'BLUR_FOCUS' } & BaseAction)

/**
 * Extract all action type strings from GridAction union.
 * Used for compile-time exhaustiveness checking in sync-classification.ts.
 *
 * When you add a new action to GridAction, TypeScript will automatically
 * include it in GridActionType, and if it's not classified in sync-classification.ts,
 * the compile-time check will fail.
 */
export type GridActionType = GridAction['type'];

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
