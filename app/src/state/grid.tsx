import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { GridState, GridAction, Track, EffectsState, ScaleState } from '../types';
import { MAX_TRACKS, MAX_STEPS, STEPS_PER_PAGE, MIN_TEMPO, MAX_TEMPO, DEFAULT_TEMPO, MIN_SWING, MAX_SWING, DEFAULT_SWING } from '../types';

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
        return { ...track, volume: action.volume };
      });
      return { ...state, tracks };
    }

    case 'SET_TRACK_TRANSPOSE': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, transpose: Math.max(-12, Math.min(12, action.transpose)) };
      });
      return { ...state, tracks };
    }

    case 'SET_TRACK_STEP_COUNT': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        const newStepCount = Math.max(1, Math.min(MAX_STEPS, action.stepCount));
        const oldStepCount = track.stepCount ?? STEPS_PER_PAGE;

        // Resize steps and parameterLocks arrays to match new step count
        let newSteps = track.steps;
        let newLocks = track.parameterLocks;

        if (newStepCount > oldStepCount) {
          // Expand arrays with empty values
          newSteps = [...track.steps, ...new Array(newStepCount - oldStepCount).fill(false)];
          newLocks = [...track.parameterLocks, ...new Array(newStepCount - oldStepCount).fill(null)];
        } else if (newStepCount < oldStepCount) {
          // Truncate arrays
          newSteps = track.steps.slice(0, newStepCount);
          newLocks = track.parameterLocks.slice(0, newStepCount);
        }

        return { ...track, stepCount: newStepCount, steps: newSteps, parameterLocks: newLocks };
      });
      return { ...state, tracks };
    }

    case 'SET_TRACK_PLAYBACK_MODE': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        return { ...track, playbackMode: action.playbackMode };
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
        // Use track's actual stepCount instead of MAX_STEPS for array consistency
        const stepCount = track.stepCount ?? STEPS_PER_PAGE;
        return {
          ...track,
          steps: Array(stepCount).fill(false),
          parameterLocks: Array(stepCount).fill(null),
        };
      });
      return { ...state, tracks };
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
        playbackMode: 'oneshot',
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
      return { ...state, tracks };
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
      const fromStepCount = fromTrack.stepCount ?? STEPS_PER_PAGE;
      const tracks = state.tracks.map((track) => {
        if (track.id === action.fromTrackId) {
          // Clear source track with empty arrays sized to its stepCount
          return {
            ...track,
            steps: Array(fromStepCount).fill(false),
            parameterLocks: Array(fromStepCount).fill(null),
            // Keep stepCount - only the pattern moves, not the track length setting
          };
        }
        if (track.id === action.toTrackId) {
          return {
            ...track,
            steps: [...fromTrack.steps],
            parameterLocks: [...fromTrack.parameterLocks],
            stepCount: fromStepCount, // Move step count with pattern
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
