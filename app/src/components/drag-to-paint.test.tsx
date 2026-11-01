// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepCell } from './StepCell';
import { useDragToPaint } from './useDragToPaint';

vi.mock('../hooks/useLongPress', () => ({
  useLongPress: () => ({
    onPointerDown: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerLeave: vi.fn(),
    onPointerCancel: vi.fn(),
  }),
}));

afterEach(cleanup);

const stepProps = {
  active: false,
  playing: false,
  stepIndex: 0,
  parameterLock: null,
  swing: 0,
  selected: false,
  onClick: vi.fn(),
  onSelect: vi.fn(),
};

describe('StepCell production pointer handlers', () => {
  it('starts painting on a primary pointer down', () => {
    const onPaintStart = vi.fn();
    render(<StepCell {...stepProps} onPaintStart={onPaintStart} />);

    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 });

    expect(onPaintStart).toHaveBeenCalledOnce();
  });

  it('does not paint on a secondary pointer down', () => {
    const onPaintStart = vi.fn();
    render(<StepCell {...stepProps} onPaintStart={onPaintStart} />);

    fireEvent.pointerDown(screen.getByRole('button'), { button: 2 });

    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('routes Ctrl-click to selection instead of painting', () => {
    const onPaintStart = vi.fn();
    const onSelectToggle = vi.fn();
    render(<StepCell {...stepProps} onPaintStart={onPaintStart} onSelectToggle={onSelectToggle} />);

    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, ctrlKey: true });

    expect(onSelectToggle).toHaveBeenCalledOnce();
    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('routes Shift-click to range extension when a selection exists', () => {
    const onPaintStart = vi.fn();
    const onSelectExtend = vi.fn();
    render(<StepCell {...stepProps} hasSelection onPaintStart={onPaintStart}
      onSelectExtend={onSelectExtend} />);

    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, shiftKey: true });

    expect(onSelectExtend).toHaveBeenCalledOnce();
    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('does not paint a Shift-click when no selection exists', () => {
    const onPaintStart = vi.fn();
    render(<StepCell {...stepProps} hasSelection={false} onPaintStart={onPaintStart} />);

    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, shiftKey: true });

    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('forwards pointer entry to the paint continuation', () => {
    const onPaintEnter = vi.fn();
    render(<StepCell {...stepProps} onPaintEnter={onPaintEnter} />);

    fireEvent.pointerEnter(screen.getByRole('button'));

    expect(onPaintEnter).toHaveBeenCalledOnce();
  });
});

describe('useDragToPaint production state machine', () => {
  it('paints inactive steps and ignores duplicate entry', () => {
    const onToggleStep = vi.fn();
    const { result } = renderHook(() => useDragToPaint({
      steps: [false, false, false], stepCount: 3, enabled: true, onToggleStep,
    }));

    act(() => {
      result.current.stepPaintStartHandlers[0]();
      result.current.stepPaintEnterHandlers[1]();
      result.current.stepPaintEnterHandlers[1]();
      result.current.stepPaintEnterHandlers[2]();
    });

    expect(onToggleStep.mock.calls).toEqual([[0], [1], [2]]);
  });

  it('erases active steps when the initial step is active', () => {
    const onToggleStep = vi.fn();
    const { result } = renderHook(() => useDragToPaint({
      steps: [true, true, true], stepCount: 3, enabled: true, onToggleStep,
    }));

    act(() => {
      result.current.stepPaintStartHandlers[2]();
      result.current.stepPaintEnterHandlers[1]();
      result.current.stepPaintEnterHandlers[0]();
    });

    expect(onToggleStep.mock.calls).toEqual([[2], [1], [0]]);
  });

  it('ends painting on document pointerup and pointercancel', () => {
    const onToggleStep = vi.fn();
    const { result } = renderHook(() => useDragToPaint({
      steps: [false, false], stepCount: 2, enabled: true, onToggleStep,
    }));

    act(() => {
      result.current.stepPaintStartHandlers[0]();
      document.dispatchEvent(new Event('pointerup'));
      result.current.stepPaintEnterHandlers[1]();
      result.current.stepPaintStartHandlers[0]();
      document.dispatchEvent(new Event('pointercancel'));
      result.current.stepPaintEnterHandlers[1]();
    });

    expect(onToggleStep.mock.calls).toEqual([[0], [0]]);
  });

  it('keeps single-step toggling when advanced input is disabled', () => {
    const onToggleStep = vi.fn();
    const { result } = renderHook(() => useDragToPaint({
      steps: [false, false], stepCount: 2, enabled: false, onToggleStep,
    }));

    act(() => {
      result.current.stepPaintStartHandlers[0]();
      result.current.stepPaintEnterHandlers[1]();
    });

    expect(onToggleStep).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('uses the real container hit-test path for nested cell content', () => {
    const onToggleStep = vi.fn();
    const { result } = renderHook(() => useDragToPaint({
      steps: [false, false], stepCount: 2, enabled: true, onToggleStep,
    }));
    const cell = document.createElement('button');
    cell.className = 'step-cell';
    cell.dataset.stepIndex = '1';
    const child = document.createElement('span');
    cell.append(child);

    act(() => {
      result.current.stepPaintStartHandlers[0]();
      result.current.handleStepsPointerMove({ target: child } as unknown as ReactPointerEvent);
    });

    expect(onToggleStep.mock.calls).toEqual([[0], [1]]);
  });

  it('rebuilds the public handler arrays when the track length changes', () => {
    const onToggleStep = vi.fn();
    const { result, rerender } = renderHook(({ stepCount }) => useDragToPaint({
      steps: Array(stepCount).fill(false), stepCount, enabled: true, onToggleStep,
    }), { initialProps: { stepCount: 8 } });
    expect(result.current.stepPaintStartHandlers).toHaveLength(8);

    rerender({ stepCount: 16 });

    expect(result.current.stepPaintStartHandlers).toHaveLength(16);
    expect(result.current.stepPaintEnterHandlers).toHaveLength(16);
  });
});
