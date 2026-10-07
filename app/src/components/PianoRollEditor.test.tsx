// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STEPS } from '../shared/constants';
import type { ParameterLock, Track } from '../types';
import { previewInstrument } from '../audio/audioTriggers';
import { MIDI_MAX, ROW_H } from './piano-roll-bars';
import { DESKTOP_STEP_GEOMETRY, stepToX } from './step-geometry';
import { PianoRollEditor, type PianoRollEditorProps } from './PianoRollEditor';

vi.mock('../audio/audioTriggers', () => ({
  previewInstrument: vi.fn(),
  signalMusicIntent: vi.fn(),
}));

function makeTrack(
  id: string,
  notes: Array<[number, ParameterLock | null]>,
  overrides: Partial<Track> = {},
): Track {
  const steps = Array(MAX_STEPS).fill(false);
  const parameterLocks: (ParameterLock | null)[] = Array(MAX_STEPS).fill(null);
  for (const [step, lock] of notes) {
    steps[step] = true;
    parameterLocks[step] = lock;
  }
  return {
    id,
    name: id,
    sampleId: 'synth:lead',
    steps,
    parameterLocks,
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

// jsdom lays nothing out, so the hit layer's rect sits at the origin and
// client coordinates are grid coordinates.
const xOf = (step: number) => stepToX(step, DESKTOP_STEP_GEOMETRY);
const at = (step: number, midi: number, dx = 10) => ({
  clientX: xOf(step) + dx,
  clientY: (MIDI_MAX - midi) * ROW_H + 9,
  button: 0,
  pointerId: 1,
  pointerType: 'mouse',
});

function setup(props: Partial<PianoRollEditorProps> = {}) {
  const onToggleStep = vi.fn();
  const onSetParameterLock = vi.fn();
  const onSelectStep = vi.fn();
  const utils = render(
    <PianoRollEditor
      track={makeTrack('lead', [])}
      currentStep={-1}
      anySoloed={false}
      onToggleStep={onToggleStep}
      onSetParameterLock={onSetParameterLock}
      onSelectStep={onSelectStep}
      {...props}
    />,
  );
  const hit = utils.container.querySelector('.hit') as HTMLElement;
  return { ...utils, hit, onToggleStep, onSetParameterLock, onSelectStep };
}

function click(hit: HTMLElement, step: number, midi: number, extra: Record<string, unknown> = {}) {
  fireEvent.pointerDown(hit, { ...at(step, midi), ...extra });
  fireEvent.pointerUp(hit, { ...at(step, midi), ...extra });
}

beforeEach(() => vi.mocked(previewInstrument).mockClear());
afterEach(cleanup);

describe('PianoRollEditor rendering', () => {
  it('renders one .note per bar with step-pitch geometry', () => {
    const track = makeTrack('lead', [
      [0, { pitch: 7 }],
      [1, { pitch: 7, tie: true }],
      [2, { pitch: 7, tie: true }],
      [5, { pitch: -5, volume: 0.4 }],
    ]);
    const { container } = setup({ track });
    const notes = Array.from(container.querySelectorAll<HTMLElement>('.notes .note'));
    expect(notes).toHaveLength(2);

    expect(notes[0].style.left).toBe('0px');
    expect(notes[0].style.width).toBe(`${3 * 39 - 3}px`);
    expect(notes[0].style.top).toBe(`${(MIDI_MAX - 67) * 18 + 2}px`);
    expect(notes[0].textContent).toBe('G4');

    expect(notes[1].style.left).toBe(`${5 * 39}px`);
    expect(notes[1].style.width).toBe('36px');
    expect(notes[1].textContent).toBe('');
  });

  it('puts page 2 after the 8px page gap and stretches a bar across it', () => {
    const track = makeTrack('lead', [
      [14, null],
      [15, { tie: true }],
      [16, { tie: true }],
      [17, { tie: true }],
      [20, null],
      [12, null],
      [13, { tie: true }],
    ], { stepCount: 32 });
    const { container } = setup({ track });
    const note = (start: number) => container.querySelector<HTMLElement>(`.note[data-start="${start}"]`)!;
    expect(note(20).style.left).toBe(`${20 * 39 + 8}px`);
    // 14..17 crosses the boundary: it spans the page gap.
    expect(note(14).style.left).toBe(`${14 * 39}px`);
    expect(note(14).style.width).toBe(`${4 * 39 - 3 + 8}px`);
    // 12..13 stays inside page 1.
    expect(note(12).style.width).toBe(`${2 * 39 - 3}px`);
  });

  it('draws one line per step boundary in three weights and a band over each page gap', () => {
    const { container } = setup({ track: makeTrack('lead', [], { stepCount: 48 }) });
    const lines = Array.from(container.querySelectorAll<HTMLElement>('.lines .vline'));
    expect(lines).toHaveLength(48);
    const weight = (el: HTMLElement) => ['bar', 'beat', 'step'].find(w => el.classList.contains(w));
    expect(lines.slice(0, 5).map(weight)).toEqual(['bar', 'step', 'step', 'step', 'beat']);
    expect(lines.filter(l => l.classList.contains('bar')).map(l => l.dataset.step)).toEqual(['0', '16', '32']);
    expect(lines.filter(l => l.classList.contains('beat'))).toHaveLength(9);
    expect(lines[16].style.left).toBe(`${16 * 39 + 8}px`);
    expect(lines[33].style.left).toBe(`${33 * 39 + 16}px`);

    const gaps = Array.from(container.querySelectorAll<HTMLElement>('.lines .page-gap'));
    expect(gaps.map(g => g.dataset.step)).toEqual(['16', '32']);
    expect(gaps[0].style.left).toBe(`${16 * 39}px`);
    expect(gaps[0].style.width).toBe('8px');
    expect(gaps[1].style.left).toBe(`${32 * 39 + 8}px`);
  });

  it('maps a pointer in the page gap to the last step of the page before', () => {
    const { hit, onToggleStep } = setup({ track: makeTrack('lead', [], { stepCount: 32 }) });
    fireEvent.pointerDown(hit, { ...at(0, 60), clientX: 15 * 39 + 36 + 5 });
    fireEvent.pointerUp(hit, { ...at(0, 60), clientX: 15 * 39 + 36 + 5 });
    expect(onToggleStep).toHaveBeenLastCalledWith(15);
    click(hit, 16, 60, { clientX: 16 * 39 + 8 });
    expect(onToggleStep).toHaveBeenLastCalledWith(16);
  });

  it('sizes the grid to the track length and renders C2..C6 rows', () => {
    const { container } = setup({ track: makeTrack('lead', [], { stepCount: 32 }) });
    const grid = container.querySelector<HTMLElement>('.grid')!;
    // First cell's left edge to the last cell's right edge, with one page gap.
    expect(grid.style.width).toBe(`${32 * 39 - 3 + 8}px`);
    expect(container.querySelectorAll('.grid .row')).toHaveLength(49);
    expect(container.querySelectorAll('.keycol .key')).toHaveLength(49);
  });

  it('renders ghosts for visible ghost tracks only, repeated modulo their length', () => {
    const bass = makeTrack('bass', [[0, { pitch: -12 }]], { stepCount: 8 });
    const pad = makeTrack('pad', [[2, null]]);
    const { container } = setup({
      ghostTracks: [
        { track: bass, color: '#9b59b6', visible: true },
        { track: pad, color: '#3498db', visible: false },
      ],
    });
    const ghosts = Array.from(container.querySelectorAll<HTMLElement>('.ghosts .gnote'));
    expect(ghosts).toHaveLength(2); // steps 0 and 8 of a 16-step docked track
    expect(ghosts.every(g => g.dataset.ghostTrack === 'bass')).toBe(true);
    expect(ghosts[0].style.height).toBe('12px');
    expect(ghosts[1].style.left).toBe(`${8 * 39}px`);
    expect(ghosts[1].style.width).toBe('36px');
    expect(ghosts[1].classList.contains('repeat')).toBe(true);
  });

  it('marks the sounding bar and draws the playhead only while playing', () => {
    const track = makeTrack('lead', [[0, null], [1, { tie: true }], [4, null]]);
    const stopped = setup({ track });
    expect(stopped.container.querySelector('.playhead')).toBeNull();
    stopped.unmount();

    const { container } = setup({ track, currentStep: 17 }); // wraps to step 1
    expect(container.querySelector<HTMLElement>('.playhead')!.style.left).toBe('39px');
    expect(container.querySelector<HTMLElement>('.wash')!.style.left).toBe('39px');
    const notes = container.querySelectorAll('.note');
    expect(notes[0].classList.contains('playing')).toBe(true);
    expect(notes[1].classList.contains('playing')).toBe(false);
  });

  it('hides the playhead on a muted track', () => {
    const track = makeTrack('lead', [[0, null]], { muted: true });
    const { container } = setup({ track, currentStep: 0 });
    expect(container.querySelector('.playhead')).toBeNull();
    expect(container.querySelector('.note.playing')).toBeNull();
  });

  it('highlights the selected step column and shades outside the loop', () => {
    const { container } = setup({ selectedStep: 3, loopRegion: { start: 4, end: 7 } });
    expect(container.querySelector<HTMLElement>('.sel-col')!.style.left).toBe(`${3 * 39}px`);
    const shades = container.querySelectorAll<HTMLElement>('.loop-shade');
    expect(shades).toHaveLength(2);
    expect(shades[0].style.width).toBe(`${4 * 39}px`);
    expect(shades[1].style.left).toBe(`${8 * 39 - 3}px`);
  });

  it('places columns, shading and the playhead on page 2 after the page gap', () => {
    const track = makeTrack('lead', [[18, null]], { stepCount: 32 });
    const { container, hit } = setup({ track, selectedStep: 17, loopRegion: { start: 16, end: 19 }, currentStep: 18 });
    expect(container.querySelector<HTMLElement>('.sel-col')!.style.left).toBe(`${17 * 39 + 8}px`);
    const shades = container.querySelectorAll<HTMLElement>('.loop-shade');
    expect(shades[0].style.width).toBe(`${16 * 39 + 8}px`);
    expect(shades[1].style.left).toBe(`${20 * 39 + 8 - 3}px`);
    expect(container.querySelector<HTMLElement>('.playhead')!.style.left).toBe(`${18 * 39 + 8}px`);
    expect(container.querySelector<HTMLElement>('.wash')!.style.left).toBe(`${18 * 39 + 8}px`);

    fireEvent.pointerMove(hit, at(21, 64));
    expect(container.querySelector<HTMLElement>('.hl-col')!.style.left).toBe(`${21 * 39 + 8}px`);
    expect(container.querySelector<HTMLElement>('.grid .ghost')!.style.left).toBe(`${21 * 39 + 8}px`);
    expect(container.querySelector('.tip')!.textContent).toBe('E4 · step 22');
  });

  it('applies the tall detent as a class', () => {
    const { container } = setup({ detent: 'tall' });
    expect(container.querySelector('.piano-roll-editor')!.classList.contains('piano-roll-editor--tall')).toBe(true);
  });
});

describe('PianoRollEditor editing', () => {
  it('places a note on an empty cell with the right pitch and auditions it', () => {
    const { hit, onToggleStep, onSetParameterLock } = setup({
      track: makeTrack('lead', [], { transpose: 2 }),
    });
    click(hit, 6, 67); // G4 with transpose +2 -> pitch lock 5
    expect(onToggleStep).toHaveBeenCalledWith(6);
    expect(onSetParameterLock).toHaveBeenCalledWith(6, { pitch: 5 });
    expect(previewInstrument).toHaveBeenCalledWith('preview_pitch', expect.objectContaining({ pitch: 7 }));
  });

  it('paints a run across steps at the pressed pitch', () => {
    const { hit, onToggleStep, onSetParameterLock } = setup();
    fireEvent.pointerDown(hit, at(2, 64));
    fireEvent.pointerMove(hit, at(4, 64));
    fireEvent.pointerUp(hit, at(4, 64));
    expect(onToggleStep.mock.calls.map(c => c[0])).toEqual([2, 3, 4]);
    expect(onSetParameterLock).toHaveBeenCalledWith(3, { pitch: 4 });
  });

  it('removes a bar when it is clicked without moving', () => {
    const track = makeTrack('lead', [[3, null], [4, { tie: true }]]);
    const { hit, onToggleStep, onSetParameterLock } = setup({ track });
    click(hit, 3, 60);
    expect(onToggleStep.mock.calls.map(c => c[0])).toEqual([3, 4]);
    expect(onSetParameterLock).toHaveBeenCalledWith(4, null);
  });

  it('re-pitches every step of a bar on a vertical drag', () => {
    const track = makeTrack('lead', [[0, { volume: 0.5 }], [1, { tie: true }]]);
    const { hit, onToggleStep, onSetParameterLock } = setup({ track });
    fireEvent.pointerDown(hit, at(0, 60));
    fireEvent.pointerMove(hit, at(0, 62));
    fireEvent.pointerUp(hit, at(0, 62));
    expect(onSetParameterLock).toHaveBeenCalledWith(0, { volume: 0.5, pitch: 2 });
    expect(onSetParameterLock).toHaveBeenCalledWith(1, { tie: true, pitch: 2 });
    expect(onToggleStep).not.toHaveBeenCalled();
    expect(previewInstrument).toHaveBeenCalledWith('preview_pitch', expect.objectContaining({ pitch: 2 }));
  });

  it('lengthens a bar from its right edge, tying the added steps', () => {
    const track = makeTrack('lead', [[0, { pitch: 3, volume: 0.6 }]]);
    const { hit, onToggleStep, onSetParameterLock } = setup({ track });
    fireEvent.pointerDown(hit, at(0, 63, 33)); // inside the 9px resize zone
    fireEvent.pointerMove(hit, at(2, 63));
    fireEvent.pointerUp(hit, at(2, 63));
    expect(onToggleStep.mock.calls.map(c => c[0])).toEqual([1, 2]);
    expect(onSetParameterLock).toHaveBeenCalledWith(1, { tie: true, pitch: 3, volume: 0.6 });
    expect(onSetParameterLock).toHaveBeenCalledWith(2, { tie: true, pitch: 3, volume: 0.6 });
  });

  it('shortens a bar from its right edge, turning the removed steps off', () => {
    const track = makeTrack('lead', [[0, null], [1, { tie: true }], [2, { tie: true }]]);
    const { hit, onToggleStep, onSetParameterLock } = setup({ track });
    fireEvent.pointerDown(hit, at(2, 60, 33));
    fireEvent.pointerMove(hit, at(0, 60));
    fireEvent.pointerUp(hit, at(0, 60));
    expect(onToggleStep.mock.calls.map(c => c[0])).toEqual([1, 2]);
    expect(onSetParameterLock).toHaveBeenCalledWith(1, null);
    expect(onSetParameterLock).toHaveBeenCalledWith(2, null);
  });

  it('Shift+click on a cell or a bar selects the step without editing', () => {
    const track = makeTrack('lead', [[4, null], [5, { tie: true }]]);
    const { hit, onToggleStep, onSetParameterLock, onSelectStep } = setup({ track });
    click(hit, 9, 65, { shiftKey: true });
    expect(onSelectStep).toHaveBeenLastCalledWith(9);
    click(hit, 5, 60, { shiftKey: true });
    expect(onSelectStep).toHaveBeenLastCalledWith(4); // the bar's first step
    expect(onToggleStep).not.toHaveBeenCalled();
    expect(onSetParameterLock).not.toHaveBeenCalled();
  });

  it('long-press on a bar with touch selects its step instead of removing it', () => {
    vi.useFakeTimers();
    try {
      const track = makeTrack('lead', [[2, null]]);
      const { hit, onToggleStep, onSelectStep } = setup({ track });
      fireEvent.pointerDown(hit, { ...at(2, 60), pointerType: 'touch' });
      act(() => { vi.advanceTimersByTime(400); });
      fireEvent.pointerUp(hit, { ...at(2, 60), pointerType: 'touch' });
      expect(onSelectStep).toHaveBeenCalledWith(2);
      expect(onToggleStep).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('read-only suppresses edits, the hover ghost and edit cursors', () => {
    const track = makeTrack('lead', [[0, null]]);
    const { hit, container, onToggleStep, onSetParameterLock, onSelectStep } = setup({ track, readOnly: true });
    fireEvent.pointerMove(hit, at(5, 64));
    expect(container.querySelector('.grid .ghost')).toBeNull();
    expect(hit.style.cursor).toBe('default');
    click(hit, 5, 64);
    click(hit, 0, 60);
    click(hit, 5, 64, { shiftKey: true });
    expect(onToggleStep).not.toHaveBeenCalled();
    expect(onSetParameterLock).not.toHaveBeenCalled();
    expect(onSelectStep).not.toHaveBeenCalled();
  });

  it('keys still audition when read-only', () => {
    const { container } = setup({ readOnly: true });
    fireEvent.pointerDown(container.querySelector('.key[data-midi="64"]')!);
    expect(previewInstrument).toHaveBeenCalledWith('preview_pitch', expect.objectContaining({ pitch: 4, duration: 0.18 }));
  });

  it('snaps a placement to the scale under scale lock', () => {
    const { hit, onSetParameterLock, container } = setup({
      scale: { root: 'C', scaleId: 'major', locked: true },
    });
    expect(container.querySelector('.row.scale-out')).not.toBeNull();
    click(hit, 1, 61); // C#4 is out of C major -> C4
    expect(onSetParameterLock).not.toHaveBeenCalled(); // C4 is pitch 0 on an empty step
    click(hit, 2, 66); // F#4 -> F4
    expect(onSetParameterLock).toHaveBeenCalledWith(2, { pitch: 5 });
  });
});

describe('PianoRollEditor scale lock', () => {
  // Moved from the retired ChromaticGrid: scale lock constrains new notes but
  // never hides or traps a note already off the scale.
  it('keeps an old out-of-scale note visible and removable while new notes snap into the scale', () => {
    const track = makeTrack('lead', [[0, { pitch: 1 }]]); // C#4, off C minor pentatonic
    const { hit, container, onToggleStep, onSetParameterLock } = setup({
      track,
      scale: { root: 'C', scaleId: 'minor-pentatonic', locked: true },
    });

    // The note is drawn on its own row, which is marked out of scale.
    expect(container.querySelector('.note[data-start="0"]')!.getAttribute('data-midi')).toBe('61');
    expect(container.querySelector('.key[data-midi="61"]')!.classList.contains('scale-out')).toBe(true);

    // A new note on that row lands on the nearest in-scale pitch (C4).
    click(hit, 1, 61);
    expect(onToggleStep).toHaveBeenCalledWith(1);
    expect(onSetParameterLock).not.toHaveBeenCalledWith(1, { pitch: 1 });

    // Tapping the old note removes it.
    onToggleStep.mockClear();
    click(hit, 0, 61);
    expect(onToggleStep).toHaveBeenCalledWith(0);
  });

  it('marks the root and fifth rows and keys for the session key', () => {
    const { container } = setup({ scale: { root: 'D', scaleId: 'major', locked: false } });
    const key = (midi: number) => container.querySelector(`.key[data-midi="${midi}"]`)!;
    expect(key(62).classList.contains('root')).toBe(true); // D4
    expect(key(69).classList.contains('fifth')).toBe(true); // A4
    expect(key(60).classList.contains('root')).toBe(false);
    // Unlocked: no row is out of scale.
    expect(container.querySelector('.row.scale-out')).toBeNull();
  });
});

describe('PianoRollEditor hover', () => {
  it('shows the crosshair, the hover ghost, the key highlight and a tooltip', () => {
    const { hit, container } = setup();
    fireEvent.pointerMove(hit, at(6, 67));
    expect(container.querySelector('.grid')!.classList.contains('hovering')).toBe(true);
    expect(container.querySelector('.grid .ghost')).not.toBeNull();
    expect(container.querySelector('.key[data-midi="67"]')!.classList.contains('hover')).toBe(true);
    expect(container.querySelector('.tip')!.textContent).toBe('G4 · step 7');
    expect(hit.style.cursor).toBe('crosshair');
  });

  it('describes a bar and offers the resize cursor at its right edge', () => {
    const track = makeTrack('lead', [[0, { volume: 0.8 }], [1, { tie: true }], [2, { tie: true }]]);
    const { hit, container } = setup({ track });
    fireEvent.pointerMove(hit, at(1, 60));
    expect(container.querySelector('.tip')!.textContent).toBe('C4 · 3 steps · vel 102');
    expect(hit.style.cursor).toBe('grab');
    fireEvent.pointerMove(hit, at(2, 60, 33));
    expect(hit.style.cursor).toBe('ew-resize');
  });

  it('flags pitches below the instrument and hides the ghost on scale-out rows', () => {
    const { hit, container } = setup({
      track: makeTrack('lead', [], { sampleId: 'synth:lead' }),
      scale: { root: 'C', scaleId: 'major', locked: true },
    });
    fireEvent.pointerMove(hit, at(0, 37));
    expect(container.querySelector('.grid .ghost')).toBeNull();
    expect(container.querySelector('.tip')!.textContent).toBe('C#2 · step 1 · below the instrument');
    // synth:lead plays from C3: rows below it are hatched as out of range.
    expect(container.querySelector('.key[data-midi="47"]')!.classList.contains('out')).toBe(true);
    expect(container.querySelector('.key[data-midi="48"]')!.classList.contains('out')).toBe(false);
  });
});
