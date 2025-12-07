import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { GridState, GridAction, Track } from '../types';
import { DEFAULT_SAMPLES, MAX_TRACKS, MAX_STEPS, STEPS_PER_PAGE, MIN_TEMPO, MAX_TEMPO, DEFAULT_TEMPO, MIN_SWING, MAX_SWING, DEFAULT_SWING } from '../types';

// Default beat patterns for each track
const DEFAULT_BEAT_PATTERNS: Record<string, boolean[]> = {
  kick:  [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
  snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
  hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
  clap:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
};

// Helper to create default tracks
function createDefaultTracks(): Track[] {
  return DEFAULT_SAMPLES.map((sampleId, index) => {
    // Extend 16-step patterns to MAX_STEPS with empty steps
    const pattern = DEFAULT_BEAT_PATTERNS[sampleId] || Array(STEPS_PER_PAGE).fill(false);
    const steps = [...pattern, ...Array(MAX_STEPS - pattern.length).fill(false)];

    return {
      id: `track-${index}`,
      name: sampleId.charAt(0).toUpperCase() + sampleId.slice(1),
      sampleId,
      steps,
      parameterLocks: Array(MAX_STEPS).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot' as const,
      transpose: 0,
      stepCount: STEPS_PER_PAGE, // Default 16 steps
    };
  });
}

// Initial state factory
function createInitialState(): GridState {
  const tracks = createDefaultTracks();

  return {
    tracks,
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
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: STEPS_PER_PAGE,
      };
      return { ...state, tracks: [...state.tracks, newTrack] };
    }

    case 'DELETE_TRACK': {
      // Don't allow deleting preset tracks (first 4)
      const trackIndex = state.tracks.findIndex(t => t.id === action.trackId);
      if (trackIndex < DEFAULT_SAMPLES.length) return state;
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
      // Ensure all tracks have stepCount and proper array sizes (for backwards compatibility)
      const tracksWithStepCount = action.tracks.map(t => {
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
        };
      });
      return {
        ...state,
        tracks: tracksWithStepCount,
        tempo: action.tempo,
        swing: action.swing,
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
