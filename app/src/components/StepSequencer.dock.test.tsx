// @vitest-environment jsdom
/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md, phase 2): StepSequencer owns which
 * track is docked. These tests drive the real EditorDock through stubbed rows
 * and rolls, so they pin the state machine and the prop wiring, not layout
 * (jsdom has none; e2e/piano-roll-dock.spec.ts measures the real thing).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Track } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  isPublished: false,
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

vi.mock('../state/grid', () => ({
  useGrid: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));
vi.mock('../context/MultiplayerContext', () => ({
  useMultiplayerContext: () => (mocks.isPublished ? { isPublished: true, cursors: new Map() } : null),
}));
vi.mock('../hooks/useDisplayMode', () => ({ useOrientationMode: () => 'desktop' }));
vi.mock('../hooks/useKeyboard', () => ({ useKeyboard: () => undefined }));
vi.mock('../audio/useSchedulerStateSync', () => ({ useSchedulerStateSync: () => undefined }));
vi.mock('../audio/useTrackPrewarm', () => ({ useTrackPrewarm: () => undefined }));
vi.mock('../audio/useTrackInstrumentReconcile', () => ({ useTrackInstrumentReconcile: () => undefined }));
vi.mock('../audio/scheduler', () => ({ scheduler: {
  start: vi.fn(), stop: vi.fn(), setOnStepChange: vi.fn(), setOnBeat: vi.fn(),
} }));
vi.mock('../audio/audioTriggers', () => ({
  signalMusicIntent: vi.fn(),
  requireAudioEngine: vi.fn(),
}));
vi.mock('../audio/media-session', () => ({ installMediaSessionActionHandlers: () => () => {} }));
vi.mock('../audio/engine', () => ({
  audioEngine: { removeTrackGain: vi.fn(), setFMParams: vi.fn(), setTrackVolume: vi.fn() },
}));
vi.mock('./Transport', () => ({ Transport: () => null }));
vi.mock('./TransportBar', () => ({ TransportBar: () => null }));
vi.mock('./MixerPanel', () => ({ MixerPanel: () => null }));
vi.mock('./PitchOverview', () => ({ PitchOverview: () => null }));
vi.mock('./LoopRuler', () => ({ LoopRuler: () => null }));
vi.mock('./KeyboardShortcutsPanel', () => ({ KeyboardShortcutsPanel: () => null }));
vi.mock('./CursorOverlay', () => ({ CursorOverlay: () => null }));
vi.mock('./TrackSkeleton', () => ({ TrackSkeleton: () => null }));

interface StubRowProps {
  track: Track;
  isDocked?: boolean;
  onToggleDock?: () => void;
  onOpenDock?: () => void;
  onDelete: () => void;
}

// A row reduced to the dock contract: the wrapper class, the pitch toggle,
// the name, and delete.
vi.mock('./TrackRow', () => ({
  TrackRow: ({ track, isDocked, onToggleDock, onOpenDock, onDelete }: StubRowProps) => (
    <div className={`track-row-wrapper${isDocked ? ' docked' : ''}`} data-testid={`row-${track.id}`}>
      <button
        className={`expand-toggle${isDocked ? ' expanded' : ''}`}
        data-dock-toggle={track.id}
        onClick={onToggleDock}
      >
        pitch {track.name}
      </button>
      <span onClick={onOpenDock}>name {track.name}</span>
      <button onClick={onDelete}>delete {track.name}</button>
    </div>
  ),
}));

interface StubRollProps {
  track: Track;
  currentStep: number;
  anySoloed: boolean;
  scale?: { root: string };
  onToggleStep?: (step: number) => void;
  onSetParameterLock: (step: number, lock: { pitch: number } | null) => void;
}

function stubRoll(kind: string) {
  return ({ track, currentStep, anySoloed, scale, onToggleStep, onSetParameterLock }: StubRollProps) => (
    <div
      data-testid={kind}
      data-track={track.id}
      data-current-step={currentStep}
      data-any-soloed={String(anySoloed)}
      data-scale-root={scale?.root}
    >
      <button onClick={() => onToggleStep?.(3)}>toggle step 3</button>
      <button onClick={() => onSetParameterLock(3, { pitch: 7 })}>lock step 3</button>
    </div>
  );
}

vi.mock('./ChromaticGrid', () => ({ ChromaticGrid: stubRoll('chromatic-grid'), PitchContour: () => null }));
vi.mock('./PianoRoll', () => ({ PianoRoll: stubRoll('piano-roll') }));

import { StepSequencer } from './StepSequencer';

function makeTrack(id: string, name: string, sampleId: string): Track {
  return {
    id, name, sampleId,
    steps: Array(128).fill(false), parameterLocks: Array(128).fill(null),
    volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
  };
}

const lead = makeTrack('lead', 'Lead', 'synth:lead');
const bass = makeTrack('bass', 'Bass', 'synth:bass');
const kick = makeTrack('kick', 'Kick', 'kick');

const dockEl = () => screen.getByTestId('editor-dock');
const isOpen = () => dockEl().classList.contains('open');
const dockedRows = () => Array.from(document.querySelectorAll('.track-row-wrapper.docked'))
  .map(row => row.getAttribute('data-testid'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.isPublished = false;
  mocks.state.tracks = [lead, kick, bass];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StepSequencer editor dock', () => {
  it('starts closed, inert and empty, after the rows', () => {
    render(<StepSequencer />);

    expect(isOpen()).toBe(false);
    expect(dockEl().getAttribute('aria-hidden')).toBe('true');
    expect(dockEl().hasAttribute('inert')).toBe(true);
    expect(screen.queryByTestId('chromatic-grid')).toBeNull();
    expect(dockedRows()).toEqual([]);
    // The dock is the last child of .tracks-inner: rows stay contiguous.
    const inner = document.querySelector('.tracks-inner')!;
    expect(inner.lastElementChild).toBe(dockEl());
  });

  it('opens from the pitch toggle and shows that track in the chromatic grid', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    expect(isOpen()).toBe(true);
    expect(dockEl().getAttribute('aria-hidden')).toBe('false');
    expect(dockEl().hasAttribute('inert')).toBe(false);
    expect(screen.getByTestId('chromatic-grid').getAttribute('data-track')).toBe('lead');
    expect(dockedRows()).toEqual(['row-lead']);
    expect(within(dockEl()).getByText('Lead', { selector: 'b' })).toBeTruthy();
  });

  it('offers a tab per melodic track only', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    const tabs = within(screen.getByRole('group', { name: 'Docked track' })).getAllByRole('button');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Lead', 'Bass']);
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('switches track from another row, from a dock tab and from a name', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    fireEvent.click(screen.getByText('pitch Bass'));
    expect(isOpen()).toBe(true);
    expect(dockedRows()).toEqual(['row-bass']);
    expect(screen.getByTestId('chromatic-grid').getAttribute('data-track')).toBe('bass');

    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Lead' }));
    expect(dockedRows()).toEqual(['row-lead']);

    fireEvent.click(screen.getByText('name Bass'));
    expect(dockedRows()).toEqual(['row-bass']);
    // The name only opens; clicking it again keeps the dock open.
    fireEvent.click(screen.getByText('name Bass'));
    expect(isOpen()).toBe(true);
  });

  it('closes from the docked row toggle, the close button and Escape inside the dock', () => {
    render(<StepSequencer />);

    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(screen.getByText('pitch Lead'));
    expect(isOpen()).toBe(false);
    expect(dockedRows()).toEqual([]);

    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(screen.getByRole('button', { name: 'Close pitch editor' }));
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByText('pitch Lead'));
    const windowEscape = vi.fn();
    window.addEventListener('keydown', windowEscape);
    fireEvent.keyDown(within(dockEl()).getByRole('button', { name: 'Grid' }), { key: 'Escape' });
    window.removeEventListener('keydown', windowEscape);
    expect(isOpen()).toBe(false);
    // Handled inside the dock, so the global Escape (copy mode, selection) does not also run.
    expect(windowEscape).not.toHaveBeenCalled();
  });

  it('keeps the content while collapsing, then unmounts it', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(screen.getByText('pitch Lead'));

    expect(screen.getByTestId('chromatic-grid')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByTestId('chromatic-grid')).toBeNull();
  });

  it('hands focus back to the docked row toggle on close', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(screen.getByRole('button', { name: 'Close pitch editor' }));
    act(() => { vi.advanceTimersByTime(50); });

    expect(document.activeElement).toBe(screen.getByText('pitch Lead'));
  });

  it('switches between Grid and Piano Roll and keeps the choice across tracks', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Piano Roll' }));

    expect(screen.queryByTestId('chromatic-grid')).toBeNull();
    expect(screen.getByTestId('piano-roll').getAttribute('data-track')).toBe('lead');

    fireEvent.click(screen.getByText('pitch Bass'));
    expect(screen.getByTestId('piano-roll').getAttribute('data-track')).toBe('bass');
  });

  it('wires the roll exactly as the row did: toggle step and parameter lock for the docked track', () => {
    mocks.state.isPlaying = true;
    mocks.state.currentStep = 5;
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Bass'));

    const roll = screen.getByTestId('chromatic-grid');
    expect(roll.getAttribute('data-current-step')).toBe('5');
    expect(roll.getAttribute('data-any-soloed')).toBe('false');
    expect(roll.getAttribute('data-scale-root')).toBe('C');

    fireEvent.click(within(roll).getByText('toggle step 3'));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_STEP', trackId: 'bass', step: 3 });
    fireEvent.click(within(roll).getByText('lock step 3'));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_PARAMETER_LOCK', trackId: 'bass', step: 3, lock: { pitch: 7 },
    });
    mocks.state.isPlaying = false;
    mocks.state.currentStep = -1;
  });

  it('closes when the docked track is deleted here', () => {
    const view = render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Bass'));
    fireEvent.click(screen.getByText('delete Lead'));
    expect(isOpen()).toBe(true);

    fireEvent.click(screen.getByText('delete Bass'));
    expect(isOpen()).toBe(false);
    // The reducer is mocked; mirror the delete it would have applied.
    mocks.state.tracks = [lead, kick];
    view.rerender(<StepSequencer />);
    expect(isOpen()).toBe(false);
    expect(screen.queryByTestId('chromatic-grid')).toBeNull();
  });

  it('closes when a collaborator deletes the docked track, and survives a reorder', () => {
    const view = render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    mocks.state.tracks = [bass, kick, lead];
    view.rerender(<StepSequencer />);
    expect(isOpen()).toBe(true);
    expect(dockedRows()).toEqual(['row-lead']);

    mocks.state.tracks = [bass, kick];
    view.rerender(<StepSequencer />);
    expect(isOpen()).toBe(false);
    expect(dockedRows()).toEqual([]);
    expect(screen.queryByTestId('chromatic-grid')).toBeNull();

    // A track arriving later never opens the dock.
    mocks.state.tracks = [bass, kick, makeTrack('pad', 'Pad', 'synth:pad')];
    view.rerender(<StepSequencer />);
    expect(isOpen()).toBe(false);
  });

  it('opens read-only in a published session', () => {
    mocks.isPublished = true;
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    expect(isOpen()).toBe(true);
    expect(dockEl().classList.contains('read-only')).toBe(true);
    const roll = screen.getByTestId('chromatic-grid');
    fireEvent.click(within(roll).getByText('toggle step 3'));
    fireEvent.click(within(roll).getByText('lock step 3'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'TOGGLE_STEP' }));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PARAMETER_LOCK' }));
  });
});
