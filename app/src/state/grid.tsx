import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { GridState, GridAction, Track } from '../types';
import { DEFAULT_SAMPLES, MAX_TRACKS } from '../types';

// Default beat patterns for each track
const DEFAULT_PATTERNS: Record<string, boolean[]> = {
  kick:  [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
  snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
  hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
  clap:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
};

// Initial state factory
function createInitialState(): GridState {
  const tracks: Track[] = DEFAULT_SAMPLES.map((sampleId, index) => ({
    id: `track-${index}`,
    name: sampleId.charAt(0).toUpperCase() + sampleId.slice(1),
    sampleId,
    steps: DEFAULT_PATTERNS[sampleId] || Array(16).fill(false),
    parameterLocks: Array(16).fill(null), // No p-locks by default
    volume: 1,
    muted: false,
    playbackMode: 'oneshot', // Industry standard: drums play to completion
    transpose: 0, // No pitch shift by default
  }));

  return {
    tracks,
    tempo: 120,
    swing: 0, // 0% = straight timing
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
      return { ...state, tempo: Math.max(60, Math.min(180, action.tempo)) };

    case 'SET_SWING':
      return { ...state, swing: Math.max(0, Math.min(100, action.swing)) };

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
          steps: Array(16).fill(false),
          parameterLocks: Array(16).fill(null),
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
        steps: Array(16).fill(false),
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot', // Industry standard default
        transpose: 0,
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
            steps: Array(16).fill(false),
            parameterLocks: Array(16).fill(null),
          };
        }
        if (track.id === action.toTrackId) {
          return {
            ...track,
            steps: [...fromTrack.steps],
            parameterLocks: [...fromTrack.parameterLocks],
          };
        }
        return track;
      });
      return { ...state, tracks };
    }

    case 'LOAD_STATE': {
      return {
        ...state,
        tracks: action.tracks,
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
