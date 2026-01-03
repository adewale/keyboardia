import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { GridState, GridAction, Track, EffectsState, ScaleState } from '../types';
import { MAX_TRACKS, MAX_STEPS, STEPS_PER_PAGE, MIN_TEMPO, MAX_TEMPO, DEFAULT_TEMPO, MIN_SWING, MAX_SWING, DEFAULT_SWING } from '../types';
import { rotateLeft, rotateRight, invertPattern, reversePattern, mirrorPattern, detectMirrorDirection, applyEuclidean } from '../utils/patternOps';
import { MIN_VOLUME, MAX_VOLUME, MIN_TRANSPOSE, MAX_TRANSPOSE, clamp } from '../worker/invariants';

// Default effects state - all effects dry (wet = 0) - exported for testing
export const DEFAULT_EFFECTS_STATE: EffectsState = {
  bypass: false,  // Effects enabled by default (respects wet values)
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

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
export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case 'TOGGLE_STEP': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const steps = [...track.steps];
        steps[action.step] = !steps[action.step];
        return { ...track, steps };
      });
      return { ...state, tracks };
    }

    case 'SET_TEMPO':
      return { ...state, tempo: Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, action.tempo)) };

    case 'SET_SWING':
      return { ...state, swing: Math.max(MIN_SWING, Math.min(MAX_SWING, action.swing)) };

    case 'SET_EFFECTS':
      return { ...state, effects: action.effects };

    case 'SET_SCALE':
      return { ...state, scale: action.scale };

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.isPlaying };

    case 'SET_CURRENT_STEP':
      return { ...state, currentStep: action.step };

    case 'SET_TRACK_VOLUME': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, volume: clamp(action.volume, MIN_VOLUME, MAX_VOLUME) };
      });
      return { ...state, tracks };
    }

    case 'SET_TRACK_TRANSPOSE': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, transpose: clamp(action.transpose, MIN_TRANSPOSE, MAX_TRANSPOSE) };
      });
      return { ...state, tracks };
    }

    case 'SET_TRACK_STEP_COUNT': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const newStepCount = Math.max(1, Math.min(MAX_STEPS, action.stepCount));
        // Arrays stay at MAX_STEPS (128) length - stepCount indicates active steps only
        // Invariant: track.steps.length === MAX_STEPS (see worker/invariants.ts)
        // This preserves user data when reducing stepCount (non-destructive editing)
        return { ...track, stepCount: newStepCount };
      });
      return { ...state, tracks };
    }

    case 'SET_FM_PARAMS': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        // Clamp values to valid ranges
        const fmParams = {
          harmonicity: Math.max(0.5, Math.min(10, action.fmParams.harmonicity)),
          modulationIndex: Math.max(0, Math.min(20, action.fmParams.modulationIndex)),
        };
        return { ...track, fmParams };
      });
      return { ...state, tracks };
    }

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
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        // Arrays stay at MAX_STEPS (128) length per invariants
        return {
          ...track,
          steps: Array(MAX_STEPS).fill(false),
          parameterLocks: Array(MAX_STEPS).fill(null),
        };
      });
      // Phase 31F: Clear selection if it was on the cleared track (steps are now meaningless)
      const selection = state.selection?.trackId === action.trackId ? null : state.selection;
      return { ...state, tracks, selection };
    }

    case 'SET_TRACK_SAMPLE': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, sampleId: action.sampleId };
      });
      return { ...state, tracks };
    }

    case 'SET_PARAMETER_LOCK': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const parameterLocks = [...track.parameterLocks];
        parameterLocks[action.step] = action.lock;
        return { ...track, parameterLocks };
      });
      return { ...state, tracks };
    }

    case 'ADD_TRACK': {
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
      return { ...state, tracks: [...state.tracks, newTrack] };
    }

    case 'DELETE_TRACK': {
      const tracks = state.tracks.filter((track) => track.id !== action.trackId);
      // Phase 31F: Clear selection if it was on the deleted track
      const selection = state.selection?.trackId === action.trackId ? null : state.selection;
      return { ...state, tracks, selection };
    }

    case 'COPY_SEQUENCE': {
      const fromTrack = state.tracks.find(t => t.id === action.fromTrackId);
      if (!fromTrack) return state;
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.toTrackId) return track;
        return {
          ...track,
          steps: [...fromTrack.steps],
          parameterLocks: [...fromTrack.parameterLocks],
          stepCount: fromTrack.stepCount, // Copy step count for consistent loop length
        };
      });
      return { ...state, tracks };
    }

    case 'MOVE_SEQUENCE': {
      const fromTrack = state.tracks.find(t => t.id === action.fromTrackId);
      if (!fromTrack) return state;
      const tracks = state.tracks.map((track) => {
        if (track.id === action.fromTrackId) {
          // Clear source track with MAX_STEPS length arrays per invariants
          return {
            ...track,
            steps: Array(MAX_STEPS).fill(false),
            parameterLocks: Array(MAX_STEPS).fill(null),
            // Keep stepCount - only the pattern moves, not the track length setting
          };
        }
        if (track.id === action.toTrackId) {
          return {
            ...track,
            steps: [...fromTrack.steps],
            parameterLocks: [...fromTrack.parameterLocks],
            stepCount: fromTrack.stepCount, // Move step count with pattern
          };
        }
        return track;
      });
      return { ...state, tracks };
    }

    case 'LOAD_STATE': {
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

    // Phase 31B: Pattern manipulation actions
    case 'ROTATE_PATTERN': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const stepCount = track.stepCount ?? STEPS_PER_PAGE;
        const rotate = action.direction === 'left' ? rotateLeft : rotateRight;
        return {
          ...track,
          steps: rotate(track.steps, stepCount),
          parameterLocks: rotate(track.parameterLocks, stepCount),
        };
      });
      // Phase 31F: Clear selection on pattern change (indices now point to different content)
      const selection = state.selection?.trackId === action.trackId ? null : state.selection;
      return { ...state, tracks, selection };
    }

    case 'INVERT_PATTERN': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const stepCount = track.stepCount ?? STEPS_PER_PAGE;
        // When inverting, clear p-locks on steps that become inactive
        const newSteps = invertPattern(track.steps, stepCount);
        const newLocks = track.parameterLocks.map((lock, i) => {
          // If step was active and is now inactive, clear the lock
          if (i < stepCount && track.steps[i] && !newSteps[i]) {
            return null;
          }
          return lock;
        });
        return { ...track, steps: newSteps, parameterLocks: newLocks };
      });
      // Phase 31F: Clear selection on pattern change
      const selection = state.selection?.trackId === action.trackId ? null : state.selection;
      return { ...state, tracks, selection };
    }

    case 'REVERSE_PATTERN': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const stepCount = track.stepCount ?? STEPS_PER_PAGE;
        return {
          ...track,
          steps: reversePattern(track.steps, stepCount),
          parameterLocks: reversePattern(track.parameterLocks, stepCount),
        };
      });
      // Phase 31F: Clear selection on pattern change
      const selection = state.selection?.trackId === action.trackId ? null : state.selection;
      return { ...state, tracks, selection };
    }

    case 'MIRROR_PATTERN': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const stepCount = track.stepCount ?? STEPS_PER_PAGE;
        // Smart detection: determine direction from steps, apply to both arrays
        const direction = detectMirrorDirection(track.steps, stepCount);
        return {
          ...track,
          steps: mirrorPattern(track.steps, stepCount, direction),
          parameterLocks: mirrorPattern(track.parameterLocks, stepCount, direction),
        };
      });
      // Phase 31F: Clear selection on pattern change
      const selection = state.selection?.trackId === action.trackId ? null : state.selection;
      return { ...state, tracks, selection };
    }

    case 'EUCLIDEAN_FILL': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const stepCount = track.stepCount ?? STEPS_PER_PAGE;
        const { steps, locks } = applyEuclidean(
          track.steps,
          track.parameterLocks,
          stepCount,
          action.hits
        );
        return { ...track, steps, parameterLocks: locks };
      });
      // Phase 31F: Clear selection on pattern change
      const selection = state.selection?.trackId === action.trackId ? null : state.selection;
      return { ...state, tracks, selection };
    }

    // Phase 31D: Editing convenience actions
    case 'SET_TRACK_NAME': {
      // Sanitize name: trim, limit length, remove HTML (XSS prevention)
      const sanitizedName = action.name
        .trim()
        .slice(0, 32)
        .replace(/<[^>]*>/g, '');
      if (!sanitizedName) return state; // Don't allow empty names
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, name: sanitizedName };
      });
      return { ...state, tracks };
    }

    case 'SET_TRACK_SWING': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, swing: Math.max(MIN_SWING, Math.min(MAX_SWING, action.swing)) };
      });
      return { ...state, tracks };
    }

    case 'UNMUTE_ALL': {
      const tracks = state.tracks.map((track) => ({
        ...track,
        muted: false,
      }));
      return { ...state, tracks };
    }

    // Phase 31G: Reorder tracks (drag and drop)
    case 'REORDER_TRACKS': {
      const { fromIndex, toIndex } = action;
      // Validate indices
      if (fromIndex < 0 || fromIndex >= state.tracks.length ||
          toIndex < 0 || toIndex >= state.tracks.length ||
          fromIndex === toIndex) {
        return state;
      }
      // Create new tracks array with reordered track
      const newTracks = [...state.tracks];
      const [movedTrack] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, movedTrack);
      return { ...state, tracks: newTracks };
    }

    // Phase 31F: Multi-select step actions
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

    case 'DELETE_SELECTED_STEPS': {
      if (!state.selection || state.selection.steps.size === 0) return state;

      const { trackId, steps: selectedSteps } = state.selection;
      const tracks = state.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const newSteps = [...track.steps];
        const newLocks = [...track.parameterLocks];
        for (const stepIndex of selectedSteps) {
          newSteps[stepIndex] = false;
          newLocks[stepIndex] = null;
        }
        return { ...track, steps: newSteps, parameterLocks: newLocks };
      });
      return { ...state, tracks, selection: null };
    }

    case 'APPLY_TO_SELECTION': {
      if (!state.selection || state.selection.steps.size === 0) return state;

      const { trackId, steps: selectedSteps } = state.selection;
      const tracks = state.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const newLocks = [...track.parameterLocks];
        let skippedCount = 0;
        for (const stepIndex of selectedSteps) {
          // Only apply to active steps
          if (track.steps[stepIndex]) {
            const existingLock = newLocks[stepIndex];
            newLocks[stepIndex] = { ...existingLock, ...action.lock };
          } else {
            skippedCount++;
          }
        }
        // Warn if some selected steps were inactive (p-locks only affect active steps)
        if (skippedCount > 0) {
          console.warn(
            `[APPLY_TO_SELECTION] Skipped ${skippedCount} inactive step(s). ` +
            `P-locks only apply to active steps. Selected: ${selectedSteps.size}, Applied: ${selectedSteps.size - skippedCount}`
          );
        }
        return { ...track, parameterLocks: newLocks };
      });
      return { ...state, tracks };
    }

    // Phase 31G: Loop region actions
    case 'SET_LOOP_REGION': {
      const region = action.region;
      if (region === null) {
        return { ...state, loopRegion: null };
      }
      // Validate and normalize loop region
      const longestTrack = Math.max(...state.tracks.map(t => t.stepCount ?? STEPS_PER_PAGE), STEPS_PER_PAGE);
      let { start, end } = region;
      // Swap if start > end
      if (start > end) {
        [start, end] = [end, start];
      }
      // Clamp to valid range
      start = Math.max(0, Math.min(start, longestTrack - 1));
      end = Math.max(0, Math.min(end, longestTrack - 1));
      return { ...state, loopRegion: { start, end } };
    }

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
