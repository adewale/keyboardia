// @vitest-environment jsdom
/**
 * LoopRuler geometry: marks, region and playhead sit on the 39px step pitch
 * (not percentages of the longest track), and pointer x maps to steps on that
 * same pitch. jsdom has no layout, so the strip's left edge is stubbed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { LoopRuler } from './LoopRuler';

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
  ruler.getBoundingClientRect = () => ({ left: 100, top: 0, right: 100 + 32 * 39 - 3, bottom: 24, width: 32 * 39 - 3, height: 24, x: 100, y: 0, toJSON: () => ({}) });
  return { ...view, ruler, onSetLoopRegion };
}

const xOf = (step: number) => 100 + step * 39 + 10;

describe('LoopRuler', () => {
  it('renders a spacer row and px marks on the step pitch with bar.beat labels', () => {
    const { container, ruler } = setup();
    const row = container.querySelector('.ruler-row')!;
    expect(row.firstElementChild!.classList.contains('ruler-spacer')).toBe(true);
    expect(ruler.style.getPropertyValue('--ruler-steps')).toBe('32');

    const marks = Array.from(container.querySelectorAll<HTMLElement>('.ruler-marker'));
    expect(marks.map(m => m.querySelector('.marker-label')!.textContent))
      .toEqual(['1', '1.2', '1.3', '1.4', '2', '2.2', '2.3', '2.4']);
    expect(marks.map(m => m.classList.contains('page'))).toEqual([true, false, false, false, true, false, false, false]);
    expect(marks[4].style.left).toBe('calc(16 * var(--ruler-step-pitch))');
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
    expect(region.style.left).toBe('calc(16 * var(--ruler-step-pitch))');
    expect(region.style.width).toBe('calc(4 * var(--ruler-step-pitch) - var(--ruler-step-gap))');
  });

  it('drags a region in steps of 39px, with a 2-step minimum', () => {
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
    expect(marker.style.left).toBe('calc(20 * var(--ruler-step-pitch))');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(ruler.querySelector('.shift-click-marker')).toBeNull();

    fireEvent.pointerDown(ruler, { clientX: xOf(20), shiftKey: true });
    fireEvent.pointerDown(ruler, { clientX: xOf(8), shiftKey: true });
    expect(onSetLoopRegion).toHaveBeenCalledWith({ start: 8, end: 20 });

    fireEvent.doubleClick(ruler);
    expect(onSetLoopRegion).toHaveBeenLastCalledWith(null);
  });

  it('puts the playhead on the step pitch while playing', () => {
    const { ruler, rerender, onSetLoopRegion } = setup();
    expect(ruler.querySelector('.ruler-playhead')).toBeNull();
    rerender(<LoopRuler totalSteps={32} loopRegion={null} onSetLoopRegion={onSetLoopRegion} currentStep={37} isPlaying />);
    expect(ruler.querySelector<HTMLElement>('.ruler-playhead')!.style.left).toBe('calc(5 * var(--ruler-step-pitch))');
  });
});
