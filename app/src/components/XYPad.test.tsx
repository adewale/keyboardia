// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { XYPad } from './XYPad';

/**
 * Unit Tests for XYPad React Component
 *
 * Tests cover:
 * - Rendering with correct dimensions
 * - Props handling (x, y, labels, disabled, showLabels)
 * - Pointer and keyboard transactions
 * - Accessibility attributes
 *
 * Note: The XYPadController (audio logic) is tested separately in
 * src/audio/xyPad.test.ts
 */

describe('XYPad Component', () => {
  let mockOnChange: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;

  beforeEach(() => {
    mockOnChange = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('renders the XY pad container', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} />
      );
      const pad = container.querySelector('.xy-pad');
      expect(pad).toBeTruthy();
    });

    it('renders with specified size', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} size={120} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      expect(pad.style.width).toBe('120px');
      expect(pad.style.height).toBe('120px');
    });

    it('enforces minimum size of 64px', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} size={40} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      expect(pad.style.width).toBe('64px');
      expect(pad.style.height).toBe('64px');
    });

    it('renders the puck at correct position', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} />
      );
      const puck = container.querySelector('.xy-pad-puck') as HTMLElement;
      expect(puck).toBeTruthy();
      expect(puck.style.left).toBe('50%');
      expect(puck.style.top).toBe('50%');
    });

    it('renders puck at origin when x=0, y=0', () => {
      const { container } = render(
        <XYPad x={0} y={0} onChange={mockOnChange} />
      );
      const puck = container.querySelector('.xy-pad-puck') as HTMLElement;
      expect(puck.style.left).toBe('0%');
      expect(puck.style.top).toBe('100%'); // Y is inverted (0 at bottom)
    });

    it('renders puck at max when x=1, y=1', () => {
      const { container } = render(
        <XYPad x={1} y={1} onChange={mockOnChange} />
      );
      const puck = container.querySelector('.xy-pad-puck') as HTMLElement;
      expect(puck.style.left).toBe('100%');
      expect(puck.style.top).toBe('0%'); // Y is inverted (1 at top)
    });

    it('renders grid lines for visual reference', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} />
      );
      const grid = container.querySelector('.xy-pad-grid');
      expect(grid).toBeTruthy();
    });

    it('renders crosshair at current position', () => {
      const { container } = render(
        <XYPad x={0.25} y={0.75} onChange={mockOnChange} />
      );
      const crosshair = container.querySelector('.xy-pad-crosshair') as HTMLElement;
      expect(crosshair).toBeTruthy();
      expect(crosshair.style.left).toBe('25%');
      expect(crosshair.style.top).toBe('25%'); // Y inverted: (1 - 0.75) * 100 = 25%
    });
  });

  describe('labels', () => {
    it('shows labels by default', () => {
      render(
        <XYPad
          x={0.5}
          y={0.5}
          onChange={mockOnChange}
          xLabel="Decay"
          yLabel="Wet"
        />
      );
      expect(screen.getByText('Decay')).toBeTruthy();
      expect(screen.getByText('Wet')).toBeTruthy();
    });

    it('hides labels when showLabels is false', () => {
      render(
        <XYPad
          x={0.5}
          y={0.5}
          onChange={mockOnChange}
          xLabel="Decay"
          yLabel="Wet"
          showLabels={false}
        />
      );
      expect(screen.queryByText('Decay')).toBeNull();
      expect(screen.queryByText('Wet')).toBeNull();
    });

    it('uses default labels X and Y when not specified', () => {
      render(<XYPad x={0.5} y={0.5} onChange={mockOnChange} />);
      expect(screen.getByText('X')).toBeTruthy();
      expect(screen.getByText('Y')).toBeTruthy();
    });

    it('displays current values as percentages', () => {
      render(<XYPad x={0.75} y={0.25} onChange={mockOnChange} />);
      expect(screen.getByText('75/25')).toBeTruthy();
    });
  });

  describe('disabled state', () => {
    it('applies disabled class when disabled', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} disabled={true} />
      );
      const pad = container.querySelector('.xy-pad.disabled');
      expect(pad).toBeTruthy();
    });

    it('sets tabIndex to -1 when disabled', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} disabled={true} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      expect(pad.getAttribute('tabindex')).toBe('-1');
    });

    it('does not call onChange when disabled', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} disabled={true} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;

      fireEvent.pointerDown(pad, { pointerId: 1, clientX: 50, clientY: 50 });

      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });

  describe('pointer interactions', () => {
    it('previews on pointer-down', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} size={100} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;

      // Mock getBoundingClientRect
      vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      fireEvent.pointerDown(pad, { pointerId: 1, clientX: 75, clientY: 25 });

      expect(mockOnChange).toHaveBeenCalledWith(0.75, 0.75); // Y inverted
    });

    it('adds dragging class while dragging', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} size={100} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;

      vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 100, height: 100,
        right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      fireEvent.pointerDown(pad, { pointerId: 1, clientX: 50, clientY: 50 });

      expect(pad.classList.contains('dragging')).toBe(true);
    });

    it('commits exactly once after any number of pointer previews', () => {
      const onChangeEnd = vi.fn();
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} onChangeEnd={onChangeEnd} size={100} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 100, height: 100,
        right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      fireEvent.pointerDown(pad, { pointerId: 7, clientX: 10, clientY: 90 });
      fireEvent.pointerMove(pad, { pointerId: 7, clientX: 40, clientY: 60 });
      fireEvent.pointerMove(pad, { pointerId: 7, clientX: 80, clientY: 20 });
      expect(onChangeEnd).not.toHaveBeenCalled();
      fireEvent.pointerUp(pad, { pointerId: 7, clientX: 80, clientY: 20 });

      expect(onChangeEnd).toHaveBeenCalledOnce();
      expect(onChangeEnd).toHaveBeenCalledWith(0.8, 0.8);
    });

    it('commits the last visible draft once when the pointer is cancelled', () => {
      const onChangeEnd = vi.fn();
      const onChangeCancel = vi.fn();
      const { container } = render(
        <XYPad
          x={0.25}
          y={0.75}
          onChange={mockOnChange}
          onChangeEnd={onChangeEnd}
          onChangeCancel={onChangeCancel}
          size={100}
        />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 100, height: 100,
        right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      fireEvent.pointerDown(pad, { pointerId: 9, clientX: 90, clientY: 90 });
      fireEvent.pointerMove(pad, { pointerId: 9, clientX: 80, clientY: 20 });
      fireEvent.pointerCancel(pad, { pointerId: 9 });
      fireEvent.lostPointerCapture(pad, { pointerId: 9 });
      fireEvent.pointerUp(pad, { pointerId: 9, clientX: 10, clientY: 90 });

      expect(onChangeEnd).toHaveBeenCalledOnce();
      expect(onChangeEnd).toHaveBeenCalledWith(0.8, 0.8);
      expect(onChangeCancel).not.toHaveBeenCalled();
      expect(mockOnChange.mock.calls.at(-1)).toEqual([0.8, 0.8]);
    });

    it('commits lost capture once and ignores later terminal pointer events', () => {
      const onChangeEnd = vi.fn();
      const { container } = render(
        <XYPad
          x={0.25}
          y={0.75}
          onChange={mockOnChange}
          onChangeEnd={onChangeEnd}
          size={100}
        />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 100, height: 100,
        right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      fireEvent.pointerDown(pad, { pointerId: 10, clientX: 20, clientY: 80 });
      fireEvent.pointerMove(pad, { pointerId: 10, clientX: 70, clientY: 30 });
      fireEvent.lostPointerCapture(pad, { pointerId: 10 });
      fireEvent.pointerUp(pad, { pointerId: 10, clientX: 90, clientY: 10 });
      fireEvent.pointerCancel(pad, { pointerId: 10 });

      expect(onChangeEnd).toHaveBeenCalledOnce();
      expect(onChangeEnd).toHaveBeenCalledWith(0.7, 0.7);
    });

    it('rolls an active pointer transaction back only on Escape', () => {
      const onChangeEnd = vi.fn();
      const onChangeCancel = vi.fn();
      const { container } = render(
        <XYPad
          x={0.25}
          y={0.75}
          onChange={mockOnChange}
          onChangeEnd={onChangeEnd}
          onChangeCancel={onChangeCancel}
          size={100}
        />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 100, height: 100,
        right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      fireEvent.pointerDown(pad, { pointerId: 11, clientX: 80, clientY: 20 });
      fireEvent.keyDown(pad, { key: 'Escape' });
      fireEvent.lostPointerCapture(pad, { pointerId: 11 });
      fireEvent.pointerUp(pad, { pointerId: 11, clientX: 80, clientY: 20 });

      expect(onChangeEnd).not.toHaveBeenCalled();
      expect(onChangeCancel).toHaveBeenCalledOnce();
      expect(onChangeCancel).toHaveBeenCalledWith(0.25, 0.75);
      expect(mockOnChange.mock.calls.at(-1)).toEqual([0.25, 0.75]);
    });
  });

  describe('keyboard interactions', () => {
    it('maps arrows to axes and commits once on key-up', () => {
      const onChangeStart = vi.fn();
      const onChangeEnd = vi.fn();
      render(
        <XYPad
          x={0.5}
          y={0.5}
          onChange={mockOnChange}
          onChangeStart={onChangeStart}
          onChangeEnd={onChangeEnd}
        />
      );
      const pad = screen.getByRole('slider');

      fireEvent.keyDown(pad, { key: 'ArrowRight' });
      fireEvent.keyDown(pad, { key: 'ArrowRight', repeat: true });
      expect(onChangeStart).toHaveBeenCalledOnce();
      expect(mockOnChange.mock.calls.at(-1)?.[0]).toBeCloseTo(0.52);
      expect(onChangeEnd).not.toHaveBeenCalled();
      fireEvent.keyUp(pad, { key: 'ArrowRight' });

      expect(onChangeEnd).toHaveBeenCalledOnce();
      expect(onChangeEnd.mock.calls[0][0]).toBeCloseTo(0.52);
      expect(onChangeEnd.mock.calls[0][1]).toBe(0.5);
    });

    it('uses a coarse Shift step and Escape rollback', () => {
      const onChangeEnd = vi.fn();
      const onChangeCancel = vi.fn();
      render(
        <XYPad
          x={0.4}
          y={0.6}
          onChange={mockOnChange}
          onChangeEnd={onChangeEnd}
          onChangeCancel={onChangeCancel}
        />
      );
      const pad = screen.getByRole('slider');

      fireEvent.keyDown(pad, { key: 'ArrowUp', shiftKey: true });
      expect(mockOnChange.mock.calls.at(-1)?.[1]).toBeCloseTo(0.7);
      fireEvent.keyDown(pad, { key: 'Escape' });

      expect(onChangeEnd).not.toHaveBeenCalled();
      expect(onChangeCancel).toHaveBeenCalledWith(0.4, 0.6);
      expect(mockOnChange.mock.calls.at(-1)).toEqual([0.4, 0.6]);
    });
  });

  describe('accessibility', () => {
    it('has role="slider"', () => {
      render(<XYPad x={0.5} y={0.5} onChange={mockOnChange} />);
      const slider = screen.getByRole('slider');
      expect(slider).toBeTruthy();
    });

    it('has aria-label describing both axes', () => {
      render(
        <XYPad
          x={0.5}
          y={0.5}
          onChange={mockOnChange}
          xLabel="Decay"
          yLabel="Wet"
        />
      );
      const slider = screen.getByRole('slider');
      expect(slider.getAttribute('aria-label')).toBe('Decay and Wet control');
    });

    it('has aria-valuetext with current percentages', () => {
      render(
        <XYPad
          x={0.3}
          y={0.7}
          onChange={mockOnChange}
          xLabel="Decay"
          yLabel="Wet"
        />
      );
      const slider = screen.getByRole('slider');
      expect(slider.getAttribute('aria-valuetext')).toBe('Decay: 30%, Wet: 70%');
      expect(slider.getAttribute('aria-roledescription')).toBe('two-dimensional slider');
    });

    it('is focusable when not disabled', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      expect(pad.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('color theming', () => {
    it('applies custom accent color', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} color="#ff0000" />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      expect(pad.style.getPropertyValue('--accent-color')).toBe('#ff0000');
    });

    it('uses default cyan color when not specified', () => {
      const { container } = render(
        <XYPad x={0.5} y={0.5} onChange={mockOnChange} />
      );
      const pad = container.querySelector('.xy-pad') as HTMLElement;
      expect(pad.style.getPropertyValue('--accent-color')).toBe('#00bcd4');
    });
  });
});
