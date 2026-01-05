import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { GridState, GridAction, Track, ScaleState } from '../types';
import { MAX_TRACKS, MAX_STEPS, STEPS_PER_PAGE, DEFAULT_TEMPO, DEFAULT_SWING } from '../types';
import { detectMirrorDirection } from '../utils/patternOps';
// Import DEFAULT_EFFECTS_STATE from canonical source (toneEffects.ts)
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
// Re-export for backwards compatibility
export { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
// Phase 3 refactoring: Delegate SYNCED actions to applyMutation
import { delegateToApplyMutation, maybeInvalidateSelection } from '../shared/state-adapters';

// Default scale state - C minor pentatonic, unlocked (Phase 29E)
export const DEFAULT_SCALE_STATE: ScaleState = {
  root: 'C',
  scaleId: 'minor-pentatonic',
  locked: false,
};

// Initial state factory - starts empty, session will load or reset
function createInitialState(): GridState {
  return {
    tracks: [],
    tempo: DEFAULT_TEMPO,
    swing: DEFAULT_SWING,
    effects: DEFAULT_EFFECTS_STATE,
    scale: DEFAULT_SCALE_STATE,
    isPlaying: false,
    currentStep: -1,
  };
}

// Reducer - exported for testing
// Phase 3: SYNCED actions delegate to applyMutation via delegateToApplyMutation()
// This ensures client and server apply mutations identically.
// See shared/state-adapters.ts for the delegation pattern.
export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    // =========================================================================
    // SYNCED ACTIONS - Delegate to applyMutation for single source of truth
    // =========================================================================

    case 'TOGGLE_STEP':
      return delegateToApplyMutation(state, {
        type: 'toggle_step',
        trackId: action.trackId,
        step: action.step,
      });

    case 'SET_TEMPO':
      return delegateToApplyMutation(state, { type: 'set_tempo', tempo: action.tempo });

    case 'SET_SWING':
      return delegateToApplyMutation(state, { type: 'set_swing', swing: action.swing });

    case 'SET_EFFECTS':
      return delegateToApplyMutation(state, { type: 'set_effects', effects: action.effects });

    case 'SET_SCALE':
      return delegateToApplyMutation(state, { type: 'set_scale', scale: action.scale });

    // =========================================================================
    // LOCAL_ONLY ACTIONS - Each player controls their own playback/mix
    // These do NOT delegate to applyMutation (not synced to other players)
    // =========================================================================

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.isPlaying };

    case 'SET_CURRENT_STEP':
      return { ...state, currentStep: action.step };

    // =========================================================================
    // SYNCED ACTIONS (continued) - Track settings
    // =========================================================================

    case 'SET_TRACK_VOLUME':
      return delegateToApplyMutation(state, {
        type: 'set_track_volume',
        trackId: action.trackId,
        volume: action.volume,
      });

    case 'SET_TRACK_TRANSPOSE':
      return delegateToApplyMutation(state, {
        type: 'set_track_transpose',
        trackId: action.trackId,
        transpose: action.transpose,
      });

    case 'SET_TRACK_STEP_COUNT':
      return delegateToApplyMutation(state, {
        type: 'set_track_step_count',
        trackId: action.trackId,
        stepCount: action.stepCount,
      });

    case 'SET_FM_PARAMS':
      return delegateToApplyMutation(state, {
        type: 'set_fm_params',
        trackId: action.trackId,
        fmParams: action.fmParams,
      });

    // =========================================================================
    // LOCAL_ONLY ACTIONS - Mix controls (My Ears, My Control philosophy)
    // Each player controls their own mute/solo preferences
    // =========================================================================

    case 'TOGGLE_MUTE': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, muted: !track.muted };
      });
      return { ...state, tracks };
    }

    case 'TOGGLE_SOLO': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, soloed: !track.soloed };
      });
      return { ...state, tracks };
    }

    case 'EXCLUSIVE_SOLO': {
      // Un-solo all others, solo only this track
      const tracks = state.tracks.map((track) => ({
        ...track,
        soloed: track.id === action.trackId,
      }));
      return { ...state, tracks };
    }

    case 'CLEAR_ALL_SOLOS': {
      const tracks = state.tracks.map((track) => ({
        ...track,
        soloed: false,
      }));
      return { ...state, tracks };
    }

    case 'CLEAR_TRACK': {
      const result = delegateToApplyMutation(state, { type: 'clear_track', trackId: action.trackId });
      // Clear selection if it was on the cleared track (steps are now meaningless)
      const selection = maybeInvalidateSelection(state.selection, action.trackId);
      return { ...result, selection };
    }

    case 'SET_TRACK_SAMPLE':
      return delegateToApplyMutation(state, {
        type: 'set_track_sample',
        trackId: action.trackId,
        sampleId: action.sampleId,
        name: action.name ?? action.sampleId,
      });

    case 'SET_PARAMETER_LOCK':
      return delegateToApplyMutation(state, {
        type: 'set_parameter_lock',
        trackId: action.trackId,
        step: action.step,
        lock: action.lock,
      });

    case 'ADD_TRACK': {
      // ADD_TRACK is special: track is created client-side, then synced
      // Cannot fully delegate because track ID is generated here
      if (state.tracks.length >= MAX_TRACKS) return state;
      // If a full track is provided (from multiplayer), use it directly
      // Otherwise create a new track from sampleId and name
      const newTrack: Track = action.track ?? {
        id: `track-${Date.now()}`,
        name: action.name,
        sampleId: action.sampleId,
        steps: Array(MAX_STEPS).fill(false),
        parameterLocks: Array(MAX_STEPS).fill(null),
        volume: 1,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: STEPS_PER_PAGE,
      };
      // Prevent duplicate tracks (defensive check for multiplayer sync issues)
      if (state.tracks.some(t => t.id === newTrack.id)) {
        return state;
      }
      // Delegate to applyMutation with the created track
      return delegateToApplyMutation(state, { type: 'add_track', track: newTrack });
    }

    case 'DELETE_TRACK': {
      const result = delegateToApplyMutation(state, { type: 'delete_track', trackId: action.trackId });
      // Clear selection if it was on the deleted track
      const selection = maybeInvalidateSelection(state.selection, action.trackId);
      return { ...result, selection };
    }

    case 'COPY_SEQUENCE':
      return delegateToApplyMutation(state, {
        type: 'copy_sequence',
        fromTrackId: action.fromTrackId,
        toTrackId: action.toTrackId,
      });

    case 'MOVE_SEQUENCE':
      return delegateToApplyMutation(state, {
        type: 'move_sequence',
        fromTrackId: action.fromTrackId,
        toTrackId: action.toTrackId,
      });

    // =========================================================================
    // INTERNAL ACTIONS - Server-driven or internal implementation
    // These handle special cases like server snapshots and echo prevention
    // =========================================================================

    case 'LOAD_STATE': {
      // Server snapshot - not a user action, not delegated
      // BUG-10 FIX: Preserve local-only state (muted, soloed) for existing tracks
      // Per "My Ears, My Control" philosophy, each player controls their own mix.
      // When loading server state, we must NOT overwrite local mute/solo preferences.
      const localTrackMap = new Map(state.tracks.map(t => [t.id, t]));

      // Ensure all tracks have stepCount, soloed, and proper array sizes (for backwards compatibility)
      const tracksWithDefaults = action.tracks.map(serverTrack => {
        // Extend steps array to MAX_STEPS if needed
        const steps = serverTrack.steps.length < MAX_STEPS
          ? [...serverTrack.steps, ...Array(MAX_STEPS - serverTrack.steps.length).fill(false)]
          : serverTrack.steps;
        const parameterLocks = serverTrack.parameterLocks.length < MAX_STEPS
          ? [...serverTrack.parameterLocks, ...Array(MAX_STEPS - serverTrack.parameterLocks.length).fill(null)]
          : serverTrack.parameterLocks;

        // BUG-10 FIX: Check if this track exists locally
        const localTrack = localTrackMap.get(serverTrack.id);

        return {
          ...serverTrack,
          steps,
          parameterLocks,
          stepCount: serverTrack.stepCount ?? STEPS_PER_PAGE,
          // BUG-10 FIX: Preserve local muted/soloed for existing tracks
          // For new tracks, use server value (or default to false)
          muted: localTrack ? localTrack.muted : (serverTrack.muted ?? false),
          soloed: localTrack ? localTrack.soloed : (serverTrack.soloed ?? false),
        };
      });
      // Load effects if provided, otherwise keep current or use default
      const effects = action.effects ?? state.effects ?? DEFAULT_EFFECTS_STATE;
      // Load scale if provided, otherwise keep current or use default
      const scale = action.scale ?? state.scale ?? DEFAULT_SCALE_STATE;
      return {
        ...state,
        tracks: tracksWithDefaults,
        tempo: action.tempo,
        swing: action.swing,
        effects,
        scale,
        // Phase 31F/31G: Clear local-only state on session load (selection is per-user, loop region is synced but reset on load)
        selection: null,
        loopRegion: null,
      };
    }

    case 'RESET_STATE': {
      // Reset to empty state: no tracks, default tempo/swing/effects/scale, stopped
      return {
        tracks: [],
        tempo: DEFAULT_TEMPO,
        swing: DEFAULT_SWING,
        effects: DEFAULT_EFFECTS_STATE,
        scale: DEFAULT_SCALE_STATE,
        isPlaying: false,
        currentStep: -1,
      };
    }

    // Phase 9: Remote-specific actions for multiplayer
    case 'REMOTE_STEP_SET': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const steps = [...track.steps];
        steps[action.step] = action.value;
        return { ...track, steps };
      });
      return { ...state, tracks };
    }

    case 'REMOTE_MUTE_SET': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, muted: action.muted };
      });
      return { ...state, tracks };
    }

    case 'REMOTE_SOLO_SET': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, soloed: action.soloed };
      });
      return { ...state, tracks };
    }

    // Phase 26: Set track steps directly (used for remote copy_sequence sync)
    case 'SET_TRACK_STEPS': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return {
          ...track,
          steps: [...action.steps],
          parameterLocks: [...action.parameterLocks],
          stepCount: action.stepCount,
        };
      });
      return { ...state, tracks };
    }

    // =========================================================================
    // SYNCED ACTIONS (continued) - Pattern operations
    // These delegate to applyMutation but also handle selection invalidation
    // =========================================================================

    case 'ROTATE_PATTERN': {
      const result = delegateToApplyMutation(state, {
        type: 'rotate_pattern',
        trackId: action.trackId,
        direction: action.direction,
      });
      // Clear selection on pattern change (indices now point to different content)
      return { ...result, selection: maybeInvalidateSelection(state.selection, action.trackId) };
    }

    case 'INVERT_PATTERN': {
      const result = delegateToApplyMutation(state, {
        type: 'invert_pattern',
        trackId: action.trackId,
      });
      return { ...result, selection: maybeInvalidateSelection(state.selection, action.trackId) };
    }

    case 'REVERSE_PATTERN': {
      const result = delegateToApplyMutation(state, {
        type: 'reverse_pattern',
        trackId: action.trackId,
      });
      return { ...result, selection: maybeInvalidateSelection(state.selection, action.trackId) };
    }

    case 'MIRROR_PATTERN': {
      // Compute direction client-side if not provided (smart detection)
      const track = state.tracks.find(t => t.id === action.trackId);
      const direction = action.direction ??
        (track ? detectMirrorDirection(track.steps, track.stepCount ?? STEPS_PER_PAGE) : 'left-to-right');
      const result = delegateToApplyMutation(state, {
        type: 'mirror_pattern',
        trackId: action.trackId,
        direction,
      });
      return { ...result, selection: maybeInvalidateSelection(state.selection, action.trackId) };
    }

    case 'EUCLIDEAN_FILL': {
      const result = delegateToApplyMutation(state, {
        type: 'euclidean_fill',
        trackId: action.trackId,
        hits: action.hits,
      });
      return { ...result, selection: maybeInvalidateSelection(state.selection, action.trackId) };
    }

    // Editing convenience actions
    case 'SET_TRACK_NAME': {
      // Client-side XSS sanitization (remove HTML tags)
      // This is more aggressive than server-side which only trims/limits length
      const sanitizedName = action.name
        .trim()
        .slice(0, 32)
        .replace(/<[^>]*>/g, '');
      if (!sanitizedName) return state; // Don't allow empty names
      return delegateToApplyMutation(state, {
        type: 'set_track_name',
        trackId: action.trackId,
        name: sanitizedName, // Pass sanitized name
      });
    }

    case 'SET_TRACK_SWING':
      return delegateToApplyMutation(state, {
        type: 'set_track_swing',
        trackId: action.trackId,
        swing: action.swing,
      });

    // =========================================================================
    // LOCAL_ONLY ACTIONS - Batch mix control
    // =========================================================================

    case 'UNMUTE_ALL': {
      const tracks = state.tracks.map((track) => ({
        ...track,
        muted: false,
      }));
      return { ...state, tracks };
    }

    // =========================================================================
    // SYNCED ACTIONS (continued) - Workflow features
    // =========================================================================

    case 'REORDER_TRACKS':
      return delegateToApplyMutation(state, {
        type: 'reorder_tracks',
        fromIndex: action.fromIndex,
        toIndex: action.toIndex,
      });

    // =========================================================================
    // LOCAL_ONLY ACTIONS - Multi-select (selection state is per-user)
    // =========================================================================

    case 'SELECT_STEP': {
      const { trackId, step, mode } = action;
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) return state;

      const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
      if (step < 0 || step >= trackStepCount) return state;

      const currentSelection = state.selection;

      if (mode === 'toggle') {
        // Ctrl+Click: Toggle selection and set anchor
        if (!currentSelection || currentSelection.trackId !== trackId) {
          // Start new selection on this track
          return {
            ...state,
            selection: {
              trackId,
              steps: new Set([step]),
              anchor: step,
            },
          };
        }
        // Toggle step in existing selection
        const newSteps = new Set(currentSelection.steps);
        if (newSteps.has(step)) {
          newSteps.delete(step);
        } else {
          newSteps.add(step);
        }
        return {
          ...state,
          selection: {
            ...currentSelection,
            steps: newSteps,
            anchor: step, // Update anchor to clicked step
          },
        };
      }

      if (mode === 'extend') {
        // Shift+Click: Extend selection from anchor to clicked step
        if (!currentSelection || currentSelection.trackId !== trackId || currentSelection.anchor === null) {
          // No anchor - start new selection
          return {
            ...state,
            selection: {
              trackId,
              steps: new Set([step]),
              anchor: step,
            },
          };
        }
        // Extend from anchor to step (inclusive range)
        const anchor = currentSelection.anchor;
        const start = Math.min(anchor, step);
        const end = Math.max(anchor, step);
        const newSteps = new Set<number>();
        for (let i = start; i <= end; i++) {
          if (i < trackStepCount) {
            newSteps.add(i);
          }
        }
        return {
          ...state,
          selection: {
            ...currentSelection,
            steps: newSteps,
            // Keep anchor unchanged for further extending
          },
        };
      }

      // Exhaustive check - all modes handled above
      return state;
    }

    case 'CLEAR_SELECTION': {
      return { ...state, selection: null };
    }

    // =========================================================================
    // SYNCED ACTIONS - Batch operations (selection-based)
    // These are SYNCED but need to extract selection info before delegating
    // =========================================================================

    case 'DELETE_SELECTED_STEPS': {
      if (!state.selection || state.selection.steps.size === 0) return state;
      const { trackId, steps: selectedSteps } = state.selection;
      // Delegate to applyMutation with extracted step indices
      const result = delegateToApplyMutation(state, {
        type: 'batch_clear_steps',
        trackId,
        steps: Array.from(selectedSteps),
      });
      // Clear selection after delete
      return { ...result, selection: null };
    }

    case 'APPLY_TO_SELECTION': {
      if (!state.selection || state.selection.steps.size === 0) return state;
      const { trackId, steps: selectedSteps } = state.selection;
      const track = state.tracks.find(t => t.id === trackId);
      if (!track) return state;

      // Build locks array with only active steps (p-locks only apply to active steps)
      const locks: Array<{ step: number; lock: typeof action.lock }> = [];
      let skippedCount = 0;
      for (const stepIndex of selectedSteps) {
        if (track.steps[stepIndex]) {
          const existingLock = track.parameterLocks[stepIndex];
          locks.push({ step: stepIndex, lock: { ...existingLock, ...action.lock } });
        } else {
          skippedCount++;
        }
      }
      if (skippedCount > 0) {
        console.warn(
          `[APPLY_TO_SELECTION] Skipped ${skippedCount} inactive step(s). ` +
          `P-locks only apply to active steps. Selected: ${selectedSteps.size}, Applied: ${selectedSteps.size - skippedCount}`
        );
      }
      // Delegate to applyMutation with built locks array
      return delegateToApplyMutation(state, {
        type: 'batch_set_parameter_locks',
        trackId,
        locks,
      });
    }

    // =========================================================================
    // SYNCED ACTIONS (continued) - Loop region
    // =========================================================================

    case 'SET_LOOP_REGION':
      return delegateToApplyMutation(state, {
        type: 'set_loop_region',
        region: action.region,
      });

    default:
      return state;
  }
}

// Context
interface GridContextValue {
  state: GridState;
  dispatch: React.Dispatch<GridAction>;
}

const GridContext = createContext<GridContextValue | null>(null);

// Provider
interface GridProviderProps {
  children: ReactNode;
}

export function GridProvider({ children }: GridProviderProps) {
  const [state, dispatch] = useReducer(gridReducer, null, createInitialState);

  return (
    <GridContext.Provider value={{ state, dispatch }}>
      {children}
    </GridContext.Provider>
  );
}

// Hook
export function useGrid() {
  const context = useContext(GridContext);
  if (!context) {
    throw new Error('useGrid must be used within a GridProvider');
  }
  return context;
}
