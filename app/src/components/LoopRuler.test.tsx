// @vitest-environment jsdom
/**
 * LoopRuler geometry: marks, region and playhead sit on the rows' step
 * geometry (39px pitch plus an 8px gap after every 16 steps), not on
 * percentages of the longest track, and pointer x maps back to steps on that
 * same geometry. jsdom has no layout, so the strip's left edge is stubbed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { LoopRuler } from './LoopRuler';
import { DESKTOP_STEP_GEOMETRY, stepToX } from './step-geometry';

afterEach(cleanup);

function setup(props: Partial<React.ComponentProps<typeof LoopRuler>> = {}) {
  const onSetLoopRegion = vi.fn();
  const view = render(
    <LoopRuler
      totalSteps={32}
      loopRegion={null}
      onSetLoopRegion={onSetLoopRegion}
      currentStep={-1}
      isPlaying={false}
      {...props}
    />,
  );
  const ruler = view.container.querySelector<HTMLElement>('.loop-ruler')!;
  // The strip starts at x=100.
  const width = 32 * 39 - 3 + 8;
  ruler.getBoundingClientRect = () => ({ left: 100, top: 0, right: 100 + width, bottom: 24, width, height: 24, x: 100, y: 0, toJSON: () => ({}) });
  return { ...view, ruler, onSetLoopRegion };
}

const xOf = (step: number) => 100 + stepToX(step, DESKTOP_STEP_GEOMETRY) + 10;

describe('LoopRuler', () => {
  it('renders a spacer row and px marks on the step geometry with bar.beat labels', () => {
    const { container, ruler } = setup();
    const row = container.querySelector('.ruler-row')!;
    expect(row.firstElementChild!.classList.contains('ruler-spacer')).toBe(true);
    // 32 cells: 31 pitches, one 36px cell and one 8px page gap.
    expect(ruler.style.width).toBe(`${31 * 39 + 36 + 8}px`);

    const marks = Array.from(container.querySelectorAll<HTMLElement>('.ruler-marker'));
    expect(marks.map(m => m.querySelector('.marker-label')!.textContent))
      .toEqual(['1', '1.2', '1.3', '1.4', '2', '2.2', '2.3', '2.4']);
    expect(marks.map(m => m.classList.contains('page'))).toEqual([true, false, false, false, true, false, false, false]);
    expect(marks[3].style.left).toBe(`${12 * 39}px`);
    // Page 2 starts after the page gap, where step 17's cell starts.
    expect(marks[4].style.left).toBe(`${16 * 39 + 8}px`);
    expect(marks[5].style.left).toBe(`${20 * 39 + 8}px`);
    expect(marks[4].getAttribute('title')).toBe('Page 2');
  });

  it('keeps the slider semantics and titles', () => {
    const { ruler, rerender, onSetLoopRegion } = setup();
    expect(ruler.getAttribute('role')).toBe('slider');
    expect(ruler.getAttribute('aria-label')).toBe('Loop region');
    expect(ruler.getAttribute('aria-valuemax')).toBe('32');
    expect(ruler.getAttribute('aria-valuenow')).toBe('32');
    expect(ruler.getAttribute('title')).toBe('Drag to set loop region');

    rerender(<LoopRuler totalSteps={32} loopRegion={{ start: 16, end: 19 }} onSetLoopRegion={onSetLoopRegion} currentStep={-1} isPlaying={false} />);
    expect(ruler.getAttribute('aria-valuenow')).toBe('4');
    expect(ruler.getAttribute('title')).toBe('Loop: steps 17-20 (double-click to clear)');
    expect(ruler.classList.contains('has-loop')).toBe(true);
    const region = ruler.querySelector<HTMLElement>('.loop-region')!;
    expect(region.style.left).toBe(`${16 * 39 + 8}px`);
    expect(region.style.width).toBe(`${4 * 39 - 3}px`);

    // A region across the page boundary spans the page gap.
    rerender(<LoopRuler totalSteps={32} loopRegion={{ start: 14, end: 17 }} onSetLoopRegion={onSetLoopRegion} currentStep={-1} isPlaying={false} />);
    const across = ruler.querySelector<HTMLElement>('.loop-region')!;
    expect(across.style.left).toBe(`${14 * 39}px`);
    expect(across.style.width).toBe(`${4 * 39 - 3 + 8}px`);
  });

  it('drags a region on the step geometry, with a 2-step minimum', () => {
    const { ruler, onSetLoopRegion } = setup();
    fireEvent.pointerDown(ruler, { clientX: xOf(16), pointerId: 1 });
    expect(ruler.classList.contains('dragging')).toBe(true);
    fireEvent.pointerMove(ruler, { clientX: xOf(19), pointerId: 1 });
    expect(ruler.querySelector('.loop-region.preview')).not.toBeNull();
    fireEvent.pointerUp(ruler, { clientX: xOf(19), pointerId: 1 });
    expect(onSetLoopRegion).toHaveBeenCalledWith({ start: 16, end: 19 });
    expect(ruler.classList.contains('dragging')).toBe(false);

    onSetLoopRegion.mockClear();
    fireEvent.pointerDown(ruler, { clientX: xOf(5), pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: xOf(5), pointerId: 1 });
    expect(onSetLoopRegion).not.toHaveBeenCalled();
  });

  it('drops a cancelled drag without committing it or touching the committed region', () => {
    const { ruler, onSetLoopRegion } = setup({ loopRegion: { start: 4, end: 7 } });
    const region = () => ruler.querySelector<HTMLElement>('.loop-region')!;
    const committedLeft = region().style.left;
    fireEvent.pointerDown(ruler, { clientX: xOf(16), pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: xOf(19), pointerId: 1 });
    expect(region().classList.contains('preview')).toBe(true);

    // Another pointer's cancel leaves this drag alone.
    fireEvent.pointerCancel(ruler, { clientX: xOf(19), pointerId: 2 });
    expect(ruler.classList.contains('dragging')).toBe(true);

    fireEvent.pointerCancel(ruler, { clientX: xOf(19), pointerId: 1 });
    expect(ruler.classList.contains('dragging')).toBe(false);
    expect(region().classList.contains('preview')).toBe(false);
    expect(region().style.left).toBe(committedLeft);
    fireEvent.pointerUp(ruler, { clientX: xOf(19), pointerId: 1 });
    expect(onSetLoopRegion).not.toHaveBeenCalled();
  });

  it('drops the drag when the strip loses pointer capture', () => {
    const { ruler, onSetLoopRegion } = setup();
    fireEvent.pointerDown(ruler, { clientX: xOf(16), pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: xOf(19), pointerId: 1 });
    fireEvent.lostPointerCapture(ruler, { pointerId: 1 });
    expect(ruler.classList.contains('dragging')).toBe(false);
    expect(ruler.querySelector('.loop-region')).toBeNull();
    fireEvent.pointerUp(ruler, { clientX: xOf(19), pointerId: 1 });
    expect(onSetLoopRegion).not.toHaveBeenCalled();
  });

  it('gives the page gap to the last step of the page before it', () => {
    const { ruler, onSetLoopRegion } = setup();
    // 2px into the page gap after step 16's cell: still step index 15.
    const inGap = 100 + 15 * 39 + 36 + 3 + 2;
    fireEvent.pointerDown(ruler, { clientX: xOf(12), pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: inGap, pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: inGap, pointerId: 1 });
    expect(onSetLoopRegion).toHaveBeenCalledWith({ start: 12, end: 15 });

    // Step 17's cell starts after the gap.
    fireEvent.pointerDown(ruler, { clientX: 100 + 16 * 39 + 8, pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: xOf(18), pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: xOf(18), pointerId: 1 });
    expect(onSetLoopRegion).toHaveBeenLastCalledWith({ start: 16, end: 18 });
  });

  it('clamps pointer x to the strip', () => {
    const { ruler, onSetLoopRegion } = setup();
    fireEvent.pointerDown(ruler, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: 5000, pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: 5000, pointerId: 1 });
    expect(onSetLoopRegion).toHaveBeenCalledWith({ start: 0, end: 31 });
  });

  it('sets a region from two Shift+clicks, Escape drops a pending point, double-click clears', () => {
    const { ruler, onSetLoopRegion } = setup();
    fireEvent.pointerDown(ruler, { clientX: xOf(20), shiftKey: true });
    const marker = ruler.querySelector<HTMLElement>('.shift-click-marker')!;
    expect(marker.style.left).toBe(`${20 * 39 + 8}px`);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(ruler.querySelector('.shift-click-marker')).toBeNull();

    fireEvent.pointerDown(ruler, { clientX: xOf(20), shiftKey: true });
    fireEvent.pointerDown(ruler, { clientX: xOf(8), shiftKey: true });
    expect(onSetLoopRegion).toHaveBeenCalledWith({ start: 8, end: 20 });

    fireEvent.doubleClick(ruler);
    expect(onSetLoopRegion).toHaveBeenLastCalledWith(null);
  });

  it('puts the playhead on the step geometry while playing', () => {
    const { ruler, rerender, onSetLoopRegion } = setup();
    expect(ruler.querySelector('.ruler-playhead')).toBeNull();
    rerender(<LoopRuler totalSteps={32} loopRegion={null} onSetLoopRegion={onSetLoopRegion} currentStep={37} isPlaying />);
    expect(ruler.querySelector<HTMLElement>('.ruler-playhead')!.style.left).toBe(`${5 * 39}px`);
    rerender(<LoopRuler totalSteps={32} loopRegion={null} onSetLoopRegion={onSetLoopRegion} currentStep={17} isPlaying />);
    expect(ruler.querySelector<HTMLElement>('.ruler-playhead')!.style.left).toBe(`${17 * 39 + 8}px`);
  });
});

describe('LoopRuler under 768px', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the 44px cells: a 47px pitch with the same 8px page gap', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container, ruler, onSetLoopRegion } = setup();
    expect(ruler.style.width).toBe(`${31 * 47 + 44 + 8}px`);
    const pageTwo = container.querySelector<HTMLElement>('.ruler-marker.page[data-step="16"]')!;
    expect(pageTwo.style.left).toBe(`${16 * 47 + 8}px`);

    fireEvent.pointerDown(ruler, { clientX: 100 + 16 * 47 + 8 + 5, pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: 100 + 18 * 47 + 8 + 5, pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: 100 + 18 * 47 + 8 + 5, pointerId: 1 });
    expect(onSetLoopRegion).toHaveBeenCalledWith({ start: 16, end: 18 });
  });
});
