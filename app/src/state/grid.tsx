import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { GridState, GridAction, Track } from '../types';
import { MAX_TRACKS, MAX_STEPS, STEPS_PER_PAGE, MIN_TEMPO, MAX_TEMPO, DEFAULT_TEMPO, MIN_SWING, MAX_SWING, DEFAULT_SWING } from '../types';

// Initial state factory - starts empty, session will load or reset
function createInitialState(): GridState {
  return {
    tracks: [],
    tempo: DEFAULT_TEMPO,
    swing: DEFAULT_SWING,
    isPlaying: false,
    currentStep: -1,
  };
}

// Reducer
function gridReducer(state: GridState, action: GridAction): GridState {
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
        return { ...track, stepCount: Math.max(1, Math.min(MAX_STEPS, action.stepCount)) };
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
        return {
          ...track,
          steps: Array(MAX_STEPS).fill(false),
          parameterLocks: Array(MAX_STEPS).fill(null),
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
      const newTrack: Track = {
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
      const tracks = state.tracks.map((track) => {
        if (track.id === action.fromTrackId) {
          return {
            ...track,
            steps: Array(MAX_STEPS).fill(false),
            parameterLocks: Array(MAX_STEPS).fill(null),
            stepCount: STEPS_PER_PAGE, // Reset to default after move
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
      // Ensure all tracks have stepCount, soloed, and proper array sizes (for backwards compatibility)
      const tracksWithDefaults = action.tracks.map(t => {
        // Extend steps array to MAX_STEPS if needed
        const steps = t.steps.length < MAX_STEPS
          ? [...t.steps, ...Array(MAX_STEPS - t.steps.length).fill(false)]
          : t.steps;
        const parameterLocks = t.parameterLocks.length < MAX_STEPS
          ? [...t.parameterLocks, ...Array(MAX_STEPS - t.parameterLocks.length).fill(null)]
          : t.parameterLocks;

        return {
          ...t,
          steps,
          parameterLocks,
          stepCount: t.stepCount ?? STEPS_PER_PAGE,
          soloed: t.soloed ?? false, // Default to false for old sessions
        };
      });
      return {
        ...state,
        tracks: tracksWithDefaults,
        tempo: action.tempo,
        swing: action.swing,
      };
    }

    case 'RESET_STATE': {
      // Reset to empty state: no tracks, default tempo/swing, stopped
      return {
        tracks: [],
        tempo: DEFAULT_TEMPO,
        swing: DEFAULT_SWING,
        isPlaying: false,
        currentStep: -1,
      };
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
