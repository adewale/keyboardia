// @vitest-environment jsdom
/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md, phases 2, 6, 7 and 8): StepSequencer
 * owns which track is docked and which pane shows. These tests drive the real EditorDock through stubbed rows
 * and rolls, so they pin the state machine and the prop wiring, not layout
 * (jsdom has none; e2e/piano-roll-dock.spec.ts measures the real thing).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Track } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  isPublished: false,
  orientation: 'desktop' as 'desktop' | 'landscape' | 'portrait',
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
    loopRegion: null as { start: number; end: number } | null,
  },
}));

vi.mock('../state/grid', () => ({
  useGrid: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));
vi.mock('../context/MultiplayerContext', () => ({
  useMultiplayerContext: () => (mocks.isPublished ? { isPublished: true, cursors: new Map() } : null),
}));
vi.mock('../hooks/useDisplayMode', () => ({ useOrientationMode: () => mocks.orientation }));
vi.mock('../hooks/useKeyboard', () => ({ useKeyboard: () => undefined }));
vi.mock('../audio/useSchedulerStateSync', () => ({ useSchedulerStateSync: () => undefined }));
vi.mock('../audio/useTrackPrewarm', () => ({ useTrackPrewarm: () => undefined }));
vi.mock('../audio/useTrackInstrumentReconcile', () => ({ useTrackInstrumentReconcile: () => undefined }));
vi.mock('../audio/scheduler', () => ({ scheduler: {
  start: vi.fn(), stop: vi.fn(), setOnStepChange: vi.fn(), setOnBeat: vi.fn(),
} }));
vi.mock('../audio/audioTriggers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../audio/audioTriggers')>(),
  signalMusicIntent: vi.fn(),
  requireAudioEngine: vi.fn(),
  previewInstrument: vi.fn(async () => undefined),
  tryGetEngineForPreview: vi.fn(() => null),
}));
vi.mock('../audio/prepare-instrument', () => ({ prepareInstrument: vi.fn() }));
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
vi.mock('./OrientationHint', () => ({ OrientationHint: () => null }));
vi.mock('./PortraitHeader', () => ({ PortraitHeader: () => null }));
vi.mock('./PortraitGrid', () => ({ PortraitGrid: () => null }));

interface StubRowProps {
  track: Track;
  isDocked?: boolean;
  onToggleDock?: () => void;
  onOpenDock?: () => void;
  onDelete: () => void;
  dockSelectedStep?: number | null;
  onSelectDockStep?: (step: number) => void;
  isInstrumentPickerOpen?: boolean;
  onToggleInstrumentPicker?: (opener: HTMLElement) => void;
  isTrackPaneDocked?: boolean;
  onToggleTrackPane?: () => void;
}

// A row reduced to the dock contract: the wrapper class, the pitch toggle
// (melodic rows only), the name, the badge, step 0's cell and its Shift+click,
// and delete.
vi.mock('./TrackRow', () => ({
  TrackRow: ({
    track, isDocked, onToggleDock, onOpenDock, onDelete, dockSelectedStep, onSelectDockStep,
    isInstrumentPickerOpen, onToggleInstrumentPicker, isTrackPaneDocked, onToggleTrackPane,
  }: StubRowProps) => (
    <div
      className={`track-row-wrapper${isDocked ? ' docked' : ''}`}
      data-testid={`row-${track.id}`}
      data-track-id={track.id}
      data-selected-step={dockSelectedStep ?? ''}
    >
      {!track.sampleId.startsWith('kick') && (
        <button
          className={`expand-toggle${isDocked ? ' expanded' : ''}`}
          data-dock-toggle={track.id}
          onClick={onToggleDock}
        >
          pitch {track.name}
        </button>
      )}
      <span className="track-name" tabIndex={0} onClick={onOpenDock}>name {track.name}</span>
      <button aria-expanded={isTrackPaneDocked} onClick={onToggleTrackPane}>landscape name {track.name}</button>
      <button
        aria-expanded={isInstrumentPickerOpen}
        onClick={(event) => onToggleInstrumentPicker?.(event.currentTarget)}
      >
        badge {track.name}
      </button>
      <button data-step-index={0}>cell {track.name} 0</button>
      <button onClick={() => onSelectDockStep?.(0)}>shift-click {track.name} 0</button>
      <button onClick={onDelete}>delete {track.name}</button>
    </div>
  ),
}));

interface StubRollProps {
  track: Track;
  currentStep: number;
  anySoloed: boolean;
  scale?: { root: string };
  ghostTracks?: Array<{ track: Track; color: string; visible: boolean }>;
  detent?: 'compact' | 'tall';
  loopRegion?: { start: number; end: number } | null;
  readOnly?: boolean;
  selectedStep?: number | null;
  onSelectStep?: (step: number) => void;
  onToggleStep?: (step: number) => void;
  onSetParameterLock: (step: number, lock: { pitch: number } | null) => void;
}

function stubRoll(kind: string) {
  return ({
    track, currentStep, anySoloed, scale, ghostTracks, detent, loopRegion, readOnly, selectedStep,
    onSelectStep, onToggleStep, onSetParameterLock,
  }: StubRollProps) => (
    <div
      data-testid={kind}
      data-track={track.id}
      data-current-step={currentStep}
      data-any-soloed={String(anySoloed)}
      data-scale-root={scale?.root}
      data-ghosts={ghostTracks?.map(g => `${g.track.id}:${g.visible ? 'on' : 'off'}`).join(' ')}
      data-ghost-colors={ghostTracks?.map(g => g.color).join(' ')}
      data-detent={detent}
      data-loop={loopRegion ? `${loopRegion.start}-${loopRegion.end}` : undefined}
      data-read-only={readOnly === undefined ? undefined : String(readOnly)}
      data-selects={String(onSelectStep !== undefined)}
      data-selected-step={selectedStep ?? ''}
    >
      <button onClick={() => onSelectStep?.(6)}>shift-click bar 6</button>
      <button onClick={() => onToggleStep?.(3)}>toggle step 3</button>
      <button onClick={() => onSetParameterLock(3, { pitch: 7 })}>lock step 3</button>
    </div>
  );
}

vi.mock('./ChromaticGrid', () => ({ ChromaticGrid: stubRoll('chromatic-grid'), PitchContour: () => null }));
vi.mock('./PianoRollEditor', () => ({ PianoRollEditor: stubRoll('piano-roll') }));

import { StepSequencer } from './StepSequencer';
import { getInstrumentName } from './sample-constants';

function makeTrack(id: string, name: string, sampleId: string): Track {
  const steps = Array(128).fill(false);
  steps[0] = true;
  return {
    id, name, sampleId,
    steps, parameterLocks: Array(128).fill(null),
    volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
  };
}

const lead = makeTrack('lead', 'Lead', 'synth:lead');
const bass = makeTrack('bass', 'Bass', 'synth:bass');
const kick = makeTrack('kick', 'Kick', 'kick');
const pad = makeTrack('pad', 'Pad', 'synth:pad');
const keys = makeTrack('keys', 'Keys', 'synth:rhodes');

const dockEl = () => screen.getByTestId('editor-dock');
const isOpen = () => dockEl().classList.contains('open');
const dockedRows = () => Array.from(document.querySelectorAll('.track-row-wrapper.docked'))
  .map(row => row.getAttribute('data-testid'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.isPublished = false;
  mocks.orientation = 'desktop';
  mocks.state.tracks = [lead, kick, bass];
  mocks.state.loopRegion = null;
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
    expect(screen.queryByTestId('piano-roll')).toBeNull();
    expect(screen.queryByTestId('chromatic-grid')).toBeNull();
    expect(dockedRows()).toEqual([]);
    // The dock is the last child of .tracks-inner: rows stay contiguous.
    const inner = document.querySelector('.tracks-inner')!;
    expect(inner.lastElementChild).toBe(dockEl());
  });

  it('opens from the pitch toggle and shows that track in the piano roll', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    expect(isOpen()).toBe(true);
    expect(dockEl().getAttribute('aria-hidden')).toBe('false');
    expect(dockEl().hasAttribute('inert')).toBe(false);
    // Piano Roll is the dock's default view.
    expect(screen.getByTestId('piano-roll').getAttribute('data-track')).toBe('lead');
    expect(screen.queryByTestId('chromatic-grid')).toBeNull();
    expect(within(dockEl()).getByRole('button', { name: 'Piano Roll' }).getAttribute('aria-pressed')).toBe('true');
    expect(dockedRows()).toEqual(['row-lead']);
    expect(within(dockEl()).getByText('Lead', { selector: 'b' })).toBeTruthy();
  });

  it('offers a tab per track, drums included', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    const tabs = within(screen.getByRole('group', { name: 'Docked track' })).getAllByRole('button');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Lead', 'Kick', 'Bass']);
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
    expect(tabs.map(tab => tab.getAttribute('data-category'))).toEqual(['leads', 'drums', 'bass']);
  });

  it('switches track from another row, from a dock tab and from a name', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    fireEvent.click(screen.getByText('pitch Bass'));
    expect(isOpen()).toBe(true);
    expect(dockedRows()).toEqual(['row-bass']);
    expect(screen.getByTestId('piano-roll').getAttribute('data-track')).toBe('bass');

    // Scoped to the track tabs: the roll's ghost chips also name tracks.
    fireEvent.click(within(screen.getByRole('group', { name: 'Docked track' })).getByRole('button', { name: 'Lead' }));
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

    expect(screen.getByTestId('piano-roll')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByTestId('piano-roll')).toBeNull();
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
    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Grid' }));

    expect(screen.queryByTestId('piano-roll')).toBeNull();
    expect(screen.getByTestId('chromatic-grid').getAttribute('data-track')).toBe('lead');

    fireEvent.click(screen.getByText('pitch Bass'));
    expect(screen.getByTestId('chromatic-grid').getAttribute('data-track')).toBe('bass');

    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Piano Roll' }));
    expect(screen.queryByTestId('chromatic-grid')).toBeNull();
    expect(screen.getByTestId('piano-roll').getAttribute('data-track')).toBe('bass');
  });

  it('wires the roll exactly as the row did: toggle step and parameter lock for the docked track', () => {
    mocks.state.isPlaying = true;
    mocks.state.currentStep = 5;
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Bass'));

    const roll = screen.getByTestId('piano-roll');
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
    expect(screen.queryByTestId('piano-roll')).toBeNull();
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
    expect(screen.queryByTestId('piano-roll')).toBeNull();

    // A track arriving later never opens the dock.
    mocks.state.tracks = [bass, kick, makeTrack('pad', 'Pad', 'synth:pad')];
    view.rerender(<StepSequencer />);
    expect(isOpen()).toBe(false);
  });

  it('opens read-only in a published session', () => {
    mocks.isPublished = true;
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Grid' }));

    expect(isOpen()).toBe(true);
    expect(dockEl().classList.contains('read-only')).toBe(true);
    const roll = screen.getByTestId('chromatic-grid');
    fireEvent.click(within(roll).getByText('toggle step 3'));
    fireEvent.click(within(roll).getByText('lock step 3'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'TOGGLE_STEP' }));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PARAMETER_LOCK' }));
  });

  it('renders the new roll for the Piano Roll view with the detent, loop region and step selection', () => {
    mocks.state.loopRegion = { start: 2, end: 5 };
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    const roll = screen.getByTestId('piano-roll');
    expect(roll.getAttribute('data-detent')).toBe('compact');
    expect(roll.getAttribute('data-loop')).toBe('2-5');
    expect(roll.getAttribute('data-read-only')).toBe('false');
    // Shift+click on a bar selects its step; nothing is selected on Notes.
    expect(roll.getAttribute('data-selects')).toBe('true');
    expect(roll.getAttribute('data-selected-step')).toBe('');
    expect(within(dockEl()).getByRole('button', { name: 'Tall' })).toBeTruthy();

    // Grid view has no detent or ghost controls.
    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Grid' }));
    expect(within(dockEl()).queryByRole('button', { name: 'Tall' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Ghost notes' })).toBeNull();
  });

  it('toggles the detent from the dock header and keeps it across close and switch', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Piano Roll' }));

    const tall = within(dockEl()).getByRole('button', { name: 'Tall' });
    expect(tall.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tall);
    expect(screen.getByTestId('piano-roll').getAttribute('data-detent')).toBe('tall');
    const compact = within(dockEl()).getByRole('button', { name: 'Compact' });
    expect(compact.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByText('pitch Bass'));
    expect(screen.getByTestId('piano-roll').getAttribute('data-detent')).toBe('tall');
    fireEvent.click(compact);
    expect(screen.getByTestId('piano-roll').getAttribute('data-detent')).toBe('compact');
  });

  it('ghosts every other melodic track, the two nearest on by default, each a toggle', () => {
    mocks.state.tracks = [lead, kick, bass, pad, keys];
    const view = render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Piano Roll' }));

    const roll = () => screen.getByTestId('piano-roll');
    expect(roll().getAttribute('data-ghosts')).toBe('bass:on pad:on keys:off');
    expect(roll().getAttribute('data-ghost-colors')).toBe(
      'var(--color-bass, #9b59b6) var(--color-pads, #2ecc71) var(--color-keys, #3498db)',
    );

    const chips = within(screen.getByRole('group', { name: 'Ghost notes' })).getAllByRole('button');
    expect(chips.map(chip => chip.textContent)).toEqual(['Bass', 'Pad', 'Keys']);
    expect(chips.map(chip => chip.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false']);

    fireEvent.click(chips[2]);
    fireEvent.click(chips[0]);
    expect(roll().getAttribute('data-ghosts')).toBe('bass:off pad:on keys:on');

    // Docking another track keeps the choices; Lead has no choice, so it
    // follows the nearest-two rule from Pad.
    fireEvent.click(screen.getByText('pitch Pad'));
    expect(roll().getAttribute('data-ghosts')).toBe('lead:off bass:off keys:on');

    // A melodic track added later follows the rule too.
    const organ = makeTrack('organ', 'Organ', 'synth:rhodes');
    mocks.state.tracks = [lead, kick, bass, pad, organ, keys];
    view.rerender(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    expect(isOpen()).toBe(true);
    expect(roll().getAttribute('data-ghosts')).toBe('bass:off pad:on organ:off keys:on');
  });

  it('passes read-only to the new roll in a published session', () => {
    mocks.isPublished = true;
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(within(dockEl()).getByRole('button', { name: 'Piano Roll' }));
    expect(screen.getByTestId('piano-roll').getAttribute('data-read-only')).toBe('true');
  });
});

const paneChip = (name: string) => within(screen.getByRole('group', { name: 'Dock pane' }))
  .getByRole('button', { name });
const pane = () => dockEl().getAttribute('data-pane');
const tools = () => dockEl().querySelector<HTMLElement>('.dock-tools')!;

describe('StepSequencer editor dock panes', () => {
  it('opens on Notes, with the roll controls in the toolbar and the roll under every pane', () => {
    mocks.state.tracks = [lead, kick, bass];
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));

    expect(pane()).toBe('notes');
    expect(paneChip('Notes').getAttribute('aria-pressed')).toBe('true');
    expect(within(tools()).getByRole('button', { name: 'Piano Roll' })).toBeTruthy();
    expect(within(tools()).getByRole('group', { name: 'Ghost notes' })).toBeTruthy();

    fireEvent.click(paneChip('Track'));
    expect(pane()).toBe('track');
    expect(screen.getByTestId('piano-roll').getAttribute('data-track')).toBe('lead');
    fireEvent.click(paneChip('Step'));
    expect(pane()).toBe('step');
    expect(screen.getByTestId('piano-roll')).toBeTruthy();
    expect(within(tools()).getByText(/Shift\+click an active cell in the Lead row/)).toBeTruthy();
  });

  it('Shift+click on a cell opens the Step pane for it and rings the cell and the roll column', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('shift-click Bass 0'));

    expect(isOpen()).toBe(true);
    expect(pane()).toBe('step');
    expect(dockedRows()).toEqual(['row-bass']);
    expect(screen.getByTestId('row-bass').getAttribute('data-selected-step')).toBe('0');
    expect(screen.getByTestId('row-lead').getAttribute('data-selected-step')).toBe('');
    expect(screen.getByTestId('piano-roll').getAttribute('data-selected-step')).toBe('0');
    expect(within(dockEl()).getByText('step 1')).toBeTruthy();
    expect(within(tools()).getByText('Step 1')).toBeTruthy();

    // Another pane keeps the step but drops the ring.
    fireEvent.click(paneChip('Track'));
    expect(screen.getByTestId('row-bass').getAttribute('data-selected-step')).toBe('');
    expect(screen.getByTestId('piano-roll').getAttribute('data-selected-step')).toBe('');
  });

  it('Shift+click on a bar in the roll selects that step', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(screen.getByText('shift-click bar 6'));

    expect(pane()).toBe('step');
    expect(screen.getByTestId('piano-roll').getAttribute('data-selected-step')).toBe('6');
    // Step 7 is inactive, so the pane says how to pick an active one.
    expect(within(tools()).getByText(/Shift\+click an active cell/)).toBeTruthy();
  });

  it('edits the selected step with the lock editor, addressed by track and step', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('shift-click Bass 0'));

    fireEvent.change(within(tools()).getByRole('slider', { name: 'Pitch' }), { target: { value: '-2' } });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_PARAMETER_LOCK', trackId: 'bass', step: 0, lock: { pitch: -2 },
    });
    fireEvent.change(within(tools()).getByRole('slider', { name: 'Volume' }), { target: { value: '50' } });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_PARAMETER_LOCK', trackId: 'bass', step: 0, lock: { volume: 0.5 },
    });
  });

  it('leaves the Step pane on the same step again, Escape, or the Notes chip', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('shift-click Lead 0'));
    expect(pane()).toBe('step');
    fireEvent.click(screen.getByText('shift-click Lead 0'));
    expect(isOpen()).toBe(true);
    expect(pane()).toBe('notes');

    fireEvent.click(screen.getByText('shift-click Lead 0'));
    fireEvent.keyDown(within(tools()).getByRole('slider', { name: 'Pitch' }), { key: 'Escape' });
    expect(isOpen()).toBe(true);
    expect(pane()).toBe('notes');
    // A second Escape, from Notes, closes the dock.
    fireEvent.keyDown(paneChip('Notes'), { key: 'Escape' });
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByText('shift-click Lead 0'));
    fireEvent.click(paneChip('Notes'));
    expect(pane()).toBe('notes');
  });

  it('Clear lock clears, leaves the pane and hands focus back to the step', () => {
    const locked = { ...bass, parameterLocks: bass.parameterLocks.map((lock, i) => (i === 0 ? { pitch: 3 } : lock)) };
    mocks.state.tracks = [lead, kick, locked];
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('shift-click Bass 0'));
    fireEvent.click(within(tools()).getByRole('button', { name: 'Clear lock' }));

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'SET_PARAMETER_LOCK', trackId: 'bass', step: 0, lock: null });
    expect(pane()).toBe('notes');
    act(() => { vi.advanceTimersByTime(50); });
    expect(document.activeElement).toBe(screen.getByText('cell Bass 0'));
  });

  it('docks a drum track from Shift+click: Step pane, no Notes, no roll', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('shift-click Kick 0'));

    expect(isOpen()).toBe(true);
    expect(dockedRows()).toEqual(['row-kick']);
    expect(pane()).toBe('step');
    expect(within(tools()).getByRole('slider', { name: 'Pitch' })).toBeTruthy();
    expect(paneChip('Notes').hasAttribute('disabled')).toBe(true);
    expect(within(dockEl()).getByText('No pitch for drum tracks')).toBeTruthy();
    expect(screen.queryByTestId('piano-roll')).toBeNull();
    expect(within(dockEl()).queryByRole('button', { name: 'Tall' })).toBeNull();

    // Escape from a drum's Step pane closes the dock: there is no Notes.
    const pitch = within(tools()).getByRole('slider', { name: 'Pitch' });
    pitch.focus();
    fireEvent.keyDown(pitch, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    act(() => { vi.advanceTimersByTime(50); });
    // A drum row has no pitch toggle, so focus goes to its name.
    expect(document.activeElement).toBe(screen.getByText('name Kick'));
  });

  it('shows Track for a drum track docked from its name', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('name Kick'));

    expect(pane()).toBe('track');
    expect(paneChip('Track').getAttribute('aria-pressed')).toBe('true');
    // A drum has no transpose; it has steps, instrument, pattern tools and actions.
    expect(within(tools()).queryByText('Transpose')).toBeNull();
    expect(within(tools()).getByText('Steps')).toBeTruthy();
    expect(within(tools()).getByRole('button', { name: 'Rotate pattern right' })).toBeTruthy();

    // Docking a melodic track from a tab returns to its Notes.
    fireEvent.click(within(screen.getByRole('group', { name: 'Docked track' })).getByRole('button', { name: 'Lead' }));
    expect(pane()).toBe('notes');
  });

  it('wires the Track pane to the docked track: transpose, steps, pattern tools, actions', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Bass'));
    fireEvent.click(paneChip('Track'));

    expect(within(tools()).getByText('Transpose')).toBeTruthy();
    expect(within(tools()).getByTitle('Transpose: 0 semitones')).toBeTruthy();
    fireEvent.click(within(tools()).getByRole('button', { name: 'Rotate pattern right' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'ROTATE_PATTERN', trackId: 'bass', direction: 'right' });
    fireEvent.click(within(tools()).getByRole('button', { name: 'Invert pattern' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'INVERT_PATTERN', trackId: 'bass' });
    fireEvent.change(within(tools()).getByRole('slider', { name: 'Euclidean hits' }), { target: { value: '4' } });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'EUCLIDEAN_FILL', trackId: 'bass', hits: 4 });

    fireEvent.click(within(tools()).getByRole('button', { name: 'Clear' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'CLEAR_TRACK', trackId: 'bass' });
    fireEvent.click(within(tools()).getByRole('button', { name: 'Delete' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'DELETE_TRACK', trackId: 'bass' });
    expect(isOpen()).toBe(false);
  });

  it('shows FM parameters for an FM track only', () => {
    const fm = makeTrack('fm', 'Bell', 'tone:fm-bell');
    mocks.state.tracks = [lead, fm];
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(paneChip('Track'));
    expect(within(tools()).queryByText('Harmonicity')).toBeNull();

    fireEvent.click(screen.getByText('pitch Bell'));
    fireEvent.change(within(tools()).getByRole('slider', { name: /Harmonicity/ }), { target: { value: '4' } });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_FM_PARAMS', trackId: 'fm', fmParams: { harmonicity: 4, modulationIndex: 14 },
    });
  });

  it('opens the instrument picker in the Track pane from the row badge and commits a choice', () => {
    render(<StepSequencer />);
    const badge = screen.getByText('badge Kick');
    fireEvent.click(badge);

    expect(isOpen()).toBe(true);
    expect(pane()).toBe('track');
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    const picker = dockEl().querySelector('#dock-instrument-picker')!;
    expect(within(picker as HTMLElement).getByTestId('set-instrument-kick').getAttribute('aria-current')).toBe('true');
    const instrumentButton = within(tools()).getByTestId('dock-change-instrument-kick');
    expect(instrumentButton.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(within(picker as HTMLElement).getByTestId('set-instrument-sampled:808-kick'));
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_TRACK_INSTRUMENT', trackId: 'kick', sampleId: 'sampled:808-kick',
    }));
    expect(dockEl().querySelector('#dock-instrument-picker')).toBeNull();
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    act(() => { vi.advanceTimersByTime(50); });
    expect(document.activeElement).toBe(badge);

    // The badge again opens it; the badge once more closes it, keeping the dock.
    fireEvent.click(badge);
    expect(dockEl().querySelector('#dock-instrument-picker')).not.toBeNull();
    fireEvent.click(badge);
    expect(dockEl().querySelector('#dock-instrument-picker')).toBeNull();
    expect(isOpen()).toBe(true);
  });

  it('renders every pane read-only in a published session', () => {
    mocks.isPublished = true;
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    fireEvent.click(screen.getByText('shift-click bar 6'));
    fireEvent.click(paneChip('Step'));
    fireEvent.click(screen.getByText('shift-click Lead 0'));
    expect(within(tools()).getByRole('slider', { name: 'Pitch' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(paneChip('Track'));
    const controls = within(tools()).getAllByRole('button')
      .concat(within(tools()).getAllByRole('slider'));
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) expect(control.hasAttribute('disabled')).toBe(true);
    // No instrument picker: the instrument is a readout.
    expect(within(tools()).queryByTestId('dock-change-instrument-lead')).toBeNull();
    expect(within(tools()).getByText(getInstrumentName('synth:lead'))).toBeTruthy();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe('StepSequencer editor dock in landscape', () => {
  beforeEach(() => {
    mocks.orientation = 'landscape';
  });

  it('a track name opens the Track pane, another name switches, the same name closes', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('landscape name Lead'));
    expect(isOpen()).toBe(true);
    expect(dockEl().getAttribute('data-pane')).toBe('track');
    expect(dockedRows()).toEqual(['row-lead']);
    expect(screen.getByText('landscape name Lead').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByText('landscape name Kick'));
    expect(dockEl().getAttribute('data-pane')).toBe('track');
    expect(dockedRows()).toEqual(['row-kick']);
    expect(screen.getByText('landscape name Lead').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByText('landscape name Kick'));
    expect(isOpen()).toBe(false);
  });

  it('the name moves an open Notes dock to the Track pane rather than closing it', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    expect(dockEl().getAttribute('data-pane')).toBe('notes');
    expect(screen.getByText('landscape name Lead').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByText('landscape name Lead'));
    expect(isOpen()).toBe(true);
    expect(dockEl().getAttribute('data-pane')).toBe('track');
  });

  it('has one height: no detent toggle', () => {
    render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    expect(screen.getByTestId('piano-roll')).toBeTruthy();
    expect(within(dockEl()).queryByRole('button', { name: /Tall|Compact/ })).toBeNull();
  });

  it('keeps the dock and its picker across a rotation from desktop', () => {
    mocks.orientation = 'desktop';
    const { rerender } = render(<StepSequencer />);
    fireEvent.click(screen.getByText('badge Lead'));
    expect(dockEl().querySelector('#dock-instrument-picker')).not.toBeNull();

    mocks.orientation = 'landscape';
    rerender(<StepSequencer />);
    expect(isOpen()).toBe(true);
    expect(dockEl().querySelector('#dock-instrument-picker')).not.toBeNull();
  });

  it('closes in portrait, which renders no rows and no dock, and stays closed on return', () => {
    const { rerender } = render(<StepSequencer />);
    fireEvent.click(screen.getByText('pitch Lead'));
    expect(isOpen()).toBe(true);

    mocks.orientation = 'portrait';
    rerender(<StepSequencer />);
    expect(screen.queryByTestId('editor-dock')).toBeNull();

    mocks.orientation = 'landscape';
    rerender(<StepSequencer />);
    expect(isOpen()).toBe(false);
  });
});
