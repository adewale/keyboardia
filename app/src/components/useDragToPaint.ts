import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';

type PaintMode = 'on' | 'off' | null;

interface DragToPaintOptions {
  steps: readonly boolean[];
  stepCount: number;
  enabled: boolean;
  onToggleStep: (step: number) => void;
}

/** Production drag-to-paint state and event handlers used by TrackRow. */
export function useDragToPaint({
  steps,
  stepCount,
  enabled,
  onToggleStep,
}: DragToPaintOptions) {
  const paintModeRef = useRef<PaintMode>(null);
  const lastPaintedStepRef = useRef<number | null>(null);

  const endPaint = useCallback(() => {
    paintModeRef.current = null;
    lastPaintedStepRef.current = null;
  }, []);

  useEffect(() => {
    document.addEventListener('pointerup', endPaint);
    document.addEventListener('pointercancel', endPaint);
    return () => {
      document.removeEventListener('pointerup', endPaint);
      document.removeEventListener('pointercancel', endPaint);
    };
  }, [endPaint]);

  const paintStep = useCallback((stepIndex: number) => {
    const mode = paintModeRef.current;
    if (!enabled || mode === null || stepIndex === lastPaintedStepRef.current) return;
    const shouldBeActive = mode === 'on';
    if (steps[stepIndex] !== shouldBeActive) onToggleStep(stepIndex);
    lastPaintedStepRef.current = stepIndex;
  }, [enabled, onToggleStep, steps]);

  const handlePaintStart = useCallback((stepIndex: number) => {
    if (stepIndex < 0 || stepIndex >= stepCount) return;
    const shouldBeActive = !steps[stepIndex];
    onToggleStep(stepIndex);
    lastPaintedStepRef.current = stepIndex;
    paintModeRef.current = enabled ? (shouldBeActive ? 'on' : 'off') : null;
  }, [enabled, onToggleStep, stepCount, steps]);

  const handleStepsPointerMove = useCallback((event: ReactPointerEvent) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>('.step-cell');
    if (!cell) return;
    const stepIndex = Number.parseInt(cell.dataset.stepIndex ?? '', 10);
    if (Number.isInteger(stepIndex)) paintStep(stepIndex);
  }, [paintStep]);

  const stepPaintStartHandlers = useMemo(
    () => Array.from({ length: stepCount }, (_, index) => () => handlePaintStart(index)),
    [handlePaintStart, stepCount],
  );
  const stepPaintEnterHandlers = useMemo(
    () => Array.from({ length: stepCount }, (_, index) => () => paintStep(index)),
    [paintStep, stepCount],
  );

  return { handleStepsPointerMove, stepPaintStartHandlers, stepPaintEnterHandlers };
}
