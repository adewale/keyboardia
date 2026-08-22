// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Track } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setOnStepChange: vi.fn(),
  setOnBeat: vi.fn(),
  preload: vi.fn<() => Promise<void>>(),
  dispatch: vi.fn(),
  requireAudioEngine: vi.fn(),
  ensureAudioReady: vi.fn(),
  isToneInitialized: vi.fn(),
  initializeTone: vi.fn(),
  syncGridAudioState: vi.fn(),
  state: {
    tracks: [] as Track[], tempo: 120, swing: 0,
    effects: {
      bypass: false,
      reverb: { decay: 2, wet: 0 },
      delay: { time: '8n', feedback: 0.3, wet: 0 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
      distortion: { amount: 0.4, wet: 0 },
    },
    scale: { root: 'C', scaleId: 'minor-pentatonic', locked: false },
    isPlaying: false, currentStep: -1,
  },
}));
const { start, stop, setOnStepChange, preload, dispatch } = mocks;

vi.mock('../state/grid', () => ({
  useGrid: () => ({
    state: mocks.state,
    dispatch: mocks.dispatch,
  }),
}));
vi.mock('../context/MultiplayerContext', () => ({ useMultiplayerContext: () => null }));
vi.mock('../hooks/useDisplayMode', () => ({ useOrientationMode: () => 'desktop' }));
vi.mock('../hooks/useKeyboard', () => ({ useKeyboard: () => undefined }));
vi.mock('../audio/useSchedulerStateSync', () => ({ useSchedulerStateSync: () => undefined }));
vi.mock('../audio/useTrackPrewarm', () => ({ useTrackPrewarm: () => undefined }));
vi.mock('../audio/scheduler', () => ({ scheduler: {
  start: mocks.start,
  stop: mocks.stop,
  setOnStepChange: mocks.setOnStepChange,
  setOnBeat: mocks.setOnBeat,
} }));
vi.mock('../audio/audioTriggers', () => ({
  signalMusicIntent: vi.fn(),
  requireAudioEngine: mocks.requireAudioEngine,
}));
vi.mock('../audio/engine', () => ({
  audioEngine: {
    removeTrackGain: vi.fn(),
    setFMParams: vi.fn(),
    setTrackVolume: vi.fn(),
    syncGridAudioState: mocks.syncGridAudioState,
  },
}));
vi.mock('./Transport', () => ({ Transport: ({
  onPlayPause,
  tracks = [],
  onEnvelopeV2Change,
}: {
  onPlayPause: () => void;
  tracks?: Track[];
  onEnvelopeV2Change?: (trackId: string, envelope: Track['envelopeV2']) => void;
}) => <>
  <button onClick={onPlayPause}>Start test playback</button>
  {tracks[0] && <button onClick={() => onEnvelopeV2Change?.(tracks[0].id, {
    model: 'ar',
    attack: { value: 0.4, unit: 'seconds' },
    release: { value: 0.8, unit: 'seconds' },
  })}>Commit XY envelope</button>}
</> }));
vi.mock('./TransportBar', () => ({ TransportBar: () => null }));
vi.mock('./MixerPanel', () => ({ MixerPanel: () => null }));
vi.mock('./PitchOverview', () => ({ PitchOverview: () => null }));
vi.mock('./LoopRuler', () => ({ LoopRuler: () => null }));
vi.mock('./KeyboardShortcutsPanel/KeyboardShortcutsPanel', () => ({ KeyboardShortcutsPanel: () => null }));
vi.mock('./CursorOverlay', () => ({ CursorOverlay: () => null }));
vi.mock('./TrackRow', () => ({ TrackRow: ({
  track,
  onFocusTrack,
  onPreviewEnvelopeV2,
  onSetEnvelopeV2,
  onConvertEnvelopeUnitsV2,
}: {
  track: Track;
  onFocusTrack?: () => void;
  onPreviewEnvelopeV2?: (envelope: NonNullable<Track['envelopeV2']>) => void;
  onSetEnvelopeV2?: (envelope: NonNullable<Track['envelopeV2']>) => void;
  onConvertEnvelopeUnitsV2?: (unit: 'seconds' | 'steps') => void;
}) => <>
  <button onClick={onFocusTrack}>Focus test track</button>
  <button onClick={() => onPreviewEnvelopeV2?.({
    model: 'ar',
    attack: { value: 0.2, unit: 'seconds' },
    release: { value: 0.3, unit: 'seconds' },
  })}>Preview test envelope</button>
  <button onClick={() => onSetEnvelopeV2?.({
    model: 'ar',
    attack: { value: 0.25, unit: 'seconds' },
    release: { value: 0.5, unit: 'seconds' },
  })}>Commit slider envelope</button>
  <button onClick={() => onConvertEnvelopeUnitsV2?.('steps')}>Convert test envelope</button>
  <span>{track.name}</span>
</> }));
vi.mock('./TrackSkeleton', () => ({ TrackSkeleton: () => null }));

import { StepSequencer } from './StepSequencer';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.tracks = [];
  mocks.state.isPlaying = false;
  mocks.ensureAudioReady.mockResolvedValue(true);
  mocks.isToneInitialized.mockReturnValue(true);
  mocks.initializeTone.mockResolvedValue(undefined);
  preload.mockResolvedValue(undefined);
  mocks.requireAudioEngine.mockResolvedValue({
    ensureAudioReady: mocks.ensureAudioReady,
    isToneInitialized: mocks.isToneInitialized,
    initializeTone: mocks.initializeTone,
    preloadInstrumentsForTracks: preload,
  });
});

afterEach(() => {
  cleanup();
});

describe('StepSequencer playback lifecycle', () => {
  it('does not start playback when preload resolves after unmount', async () => {
    let release!: () => void;
    preload.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const view = render(<StepSequencer />);

    fireEvent.click(screen.getByRole('button', { name: 'Start test playback' }));
    await waitFor(() => expect(preload).toHaveBeenCalledOnce());
    view.unmount();
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(setOnStepChange).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_PLAYING', isPlaying: true });
  });

  it('does not continue when Tone initialization resolves after unmount', async () => {
    let release!: () => void;
    mocks.state.tracks = [{
      id: 'tone-track', name: 'Tone Bass', sampleId: 'tone:fm-bass',
      steps: Array(128).fill(false), parameterLocks: Array(128).fill(null),
      volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
    }];
    mocks.isToneInitialized.mockReturnValue(false);
    mocks.initializeTone.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const view = render(<StepSequencer />);

    fireEvent.click(screen.getByRole('button', { name: 'Start test playback' }));
    await waitFor(() => expect(mocks.initializeTone).toHaveBeenCalledOnce());
    view.unmount();
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(preload).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_PLAYING', isPlaying: true });
  });

  it('starts only the live StrictMode remount when an obsolete startup resolves later', async () => {
    let releaseObsolete!: (engine: unknown) => void;
    mocks.requireAudioEngine.mockImplementationOnce(() => new Promise(resolve => { releaseObsolete = resolve; }));
    const first = render(<StrictMode><StepSequencer /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Start test playback' }));
    await waitFor(() => expect(mocks.requireAudioEngine).toHaveBeenCalledOnce());
    first.unmount();

    const liveEngine = {
      ensureAudioReady: mocks.ensureAudioReady,
      isToneInitialized: mocks.isToneInitialized,
      initializeTone: mocks.initializeTone,
      preloadInstrumentsForTracks: preload,
    };
    mocks.requireAudioEngine.mockResolvedValueOnce(liveEngine);
    render(<StrictMode><StepSequencer /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Start test playback' }));
    await waitFor(() => expect(start).toHaveBeenCalledOnce());

    releaseObsolete(liveEngine);
    await Promise.resolve();
    await Promise.resolve();

    expect(start).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'SET_PLAYING' && action.isPlaying)).toHaveLength(1);
  });

  it('selects a real track interaction, previews audio locally, and records one undo per envelope commit', () => {
    const baseline = {
      model: 'ar' as const,
      attack: { value: 0.01, unit: 'seconds' as const },
      release: { value: 0.1, unit: 'seconds' as const },
    };
    mocks.state.tracks = [{
      id: 'envelope-track', name: 'Envelope track', sampleId: 'tone:fm-bass',
      steps: Array(128).fill(false), parameterLocks: Array(128).fill(null),
      volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
      envelopeV2: baseline,
    }];
    render(<StepSequencer />);

    fireEvent.click(screen.getByRole('button', { name: 'Focus test track' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'FOCUS_TRACK', trackId: 'envelope-track' });

    fireEvent.click(screen.getByRole('button', { name: 'Preview test envelope' }));
    expect(mocks.syncGridAudioState).toHaveBeenCalledWith(expect.objectContaining({
      tracks: [expect.objectContaining({
        id: 'envelope-track',
        envelopeV2: expect.objectContaining({ attack: { value: 0.2, unit: 'seconds' } }),
      })],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Commit slider envelope' }));
    const sliderCommit = dispatch.mock.calls.at(-1)?.[0];
    expect(sliderCommit).toMatchObject({
      type: 'SET_TRACK_ENVELOPE_V2',
      trackId: 'envelope-track',
      envelope: { attack: { value: 0.25, unit: 'seconds' } },
    });
    mocks.state.tracks[0] = { ...mocks.state.tracks[0], envelopeV2: sliderCommit.envelope };
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(dispatch.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'SET_TRACK_ENVELOPE_V2',
      envelope: baseline,
    });

    mocks.state.tracks[0] = { ...mocks.state.tracks[0], envelopeV2: baseline };
    fireEvent.click(screen.getByRole('button', { name: 'Commit XY envelope' }));
    const xyCommit = dispatch.mock.calls.at(-1)?.[0];
    mocks.state.tracks[0] = { ...mocks.state.tracks[0], envelopeV2: xyCommit.envelope };
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(dispatch.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'SET_TRACK_ENVELOPE_V2',
      envelope: baseline,
    });

    mocks.state.tracks[0] = { ...mocks.state.tracks[0], envelopeV2: baseline };
    fireEvent.click(screen.getByRole('button', { name: 'Convert test envelope' }));
    expect(dispatch.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'CONVERT_TRACK_ENVELOPE_UNITS_V2',
      targetUnit: 'steps',
    });
    mocks.state.tracks[0] = {
      ...mocks.state.tracks[0],
      envelopeV2: {
        model: 'ar',
        attack: { value: 0.08, unit: 'steps' },
        release: { value: 0.8, unit: 'steps' },
      },
    };
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(dispatch.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'SET_TRACK_ENVELOPE_V2',
      envelope: baseline,
    });
  });
});
