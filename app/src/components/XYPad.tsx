import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clamp } from '../shared/validation';
import './XYPad.css';

interface XYPadProps {
  /** Current X value (0-1). */
  x: number;
  /** Current Y value (0-1), with zero at the bottom. */
  y: number;
  /** Local preview callback. May fire many times during one gesture. */
  onChange: (x: number, y: number) => void;
  /** Called once when a pointer or keyboard transaction begins. */
  onChangeStart?: (x: number, y: number) => void;
  /** Called once when a pointer or keyboard transaction commits, including interrupted capture. */
  onChangeEnd?: (x: number, y: number) => void;
  /** Called with the baseline when Escape rolls a transaction back. */
  onChangeCancel?: (x: number, y: number) => void;
  xLabel?: string;
  yLabel?: string;
  size?: number;
  disabled?: boolean;
  color?: string;
  showLabels?: boolean;
}

const MIN_SIZE = 64;
const KEY_STEP = 0.01;
const KEY_LARGE_STEP = 0.1;

/**
 * Two-dimensional performance control with one transaction per gesture.
 * Pointer motion and key repeats are previews; pointer-up/key-up commit once.
 * Pointer cancellation or lost capture commit the last visible draft. Escape
 * alone restores the gesture baseline without committing.
 */
export function XYPad({
  x,
  y,
  onChange,
  onChangeStart,
  onChangeEnd,
  onChangeCancel,
  xLabel = 'X',
  yLabel = 'Y',
  size = 80,
  disabled = false,
  color = '#00bcd4',
  showLabels = true,
}: XYPadProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const keyboardActiveRef = useRef(false);
  const baselineRef = useRef({ x, y });
  const positionRef = useRef({ x, y });
  const onChangeRef = useRef(onChange);
  const onChangeStartRef = useRef(onChangeStart);
  const onChangeEndRef = useRef(onChangeEnd);
  const onChangeCancelRef = useRef(onChangeCancel);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onChangeStartRef.current = onChangeStart; }, [onChangeStart]);
  useEffect(() => { onChangeEndRef.current = onChangeEnd; }, [onChangeEnd]);
  useEffect(() => { onChangeCancelRef.current = onChangeCancel; }, [onChangeCancel]);
  useEffect(() => {
    if (activePointerRef.current === null && !keyboardActiveRef.current) {
      positionRef.current = { x, y };
    }
  }, [x, y]);

  const actualSize = Math.max(size, MIN_SIZE);

  const calculatePosition = useCallback((clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return positionRef.current;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const preview = useCallback((next: { x: number; y: number }) => {
    const normalized = { x: clamp(next.x, 0, 1), y: clamp(next.y, 0, 1) };
    positionRef.current = normalized;
    onChangeRef.current(normalized.x, normalized.y);
  }, []);

  const begin = useCallback(() => {
    baselineRef.current = positionRef.current;
    onChangeStartRef.current?.(baselineRef.current.x, baselineRef.current.y);
  }, []);

  const commit = useCallback(() => {
    const position = positionRef.current;
    onChangeEndRef.current?.(position.x, position.y);
  }, []);

  const cancel = useCallback(() => {
    const baseline = baselineRef.current;
    positionRef.current = baseline;
    onChangeRef.current(baseline.x, baseline.y);
    onChangeCancelRef.current?.(baseline.x, baseline.y);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || activePointerRef.current !== null) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    begin();
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and older browsers can omit pointer capture; target events still work.
    }
    preview(calculatePosition(event.clientX, event.clientY));
  }, [begin, calculatePosition, disabled, preview]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    preview(calculatePosition(event.clientX, event.clientY));
  }, [calculatePosition, disabled, preview]);

  const finishPointer = useCallback((pointerId: number, releaseCapture: boolean) => {
    if (activePointerRef.current !== pointerId) return false;

    // Mark the transaction finished before releasing capture. Some browsers
    // synchronously emit lostpointercapture from releasePointerCapture; that
    // event must observe an inactive transaction and cannot commit twice.
    activePointerRef.current = null;
    setIsDragging(false);
    if (!releaseCapture) return true;
    try {
      padRef.current?.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may not have been available.
    }
    return true;
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    preview(calculatePosition(event.clientX, event.clientY));
    if (!finishPointer(event.pointerId, true)) return;
    commit();
  }, [calculatePosition, commit, finishPointer, preview]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!finishPointer(event.pointerId, true)) return;
    commit();
  }, [commit, finishPointer]);

  const handleLostPointerCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!finishPointer(event.pointerId, false)) return;
    commit();
  }, [commit, finishPointer]);

  const beginKeyboard = useCallback(() => {
    if (keyboardActiveRef.current) return;
    keyboardActiveRef.current = true;
    begin();
  }, [begin]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'Escape') {
      const pointerId = activePointerRef.current;
      if (pointerId !== null || keyboardActiveRef.current) {
        event.preventDefault();
        event.stopPropagation();
        keyboardActiveRef.current = false;
        if (pointerId !== null) finishPointer(pointerId, true);
        cancel();
      }
      return;
    }

    const step = event.shiftKey ? KEY_LARGE_STEP : KEY_STEP;
    const current = positionRef.current;
    let next: { x: number; y: number } | null = null;
    switch (event.key) {
      case 'ArrowLeft': next = { ...current, x: current.x - step }; break;
      case 'ArrowRight': next = { ...current, x: current.x + step }; break;
      case 'ArrowDown': next = { ...current, y: current.y - step }; break;
      case 'ArrowUp': next = { ...current, y: current.y + step }; break;
      case 'PageDown': next = { ...current, y: current.y - KEY_LARGE_STEP }; break;
      case 'PageUp': next = { ...current, y: current.y + KEY_LARGE_STEP }; break;
      case 'Home': next = { x: 0, y: 0 }; break;
      case 'End': next = { x: 1, y: 1 }; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    beginKeyboard();
    preview(next);
  }, [beginKeyboard, cancel, disabled, finishPointer, preview]);

  const handleKeyUp = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardActiveRef.current || ![
      'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End',
    ].includes(event.key)) return;
    event.preventDefault();
    keyboardActiveRef.current = false;
    commit();
  }, [commit]);

  const handleBlur = useCallback(() => {
    if (!keyboardActiveRef.current) return;
    keyboardActiveRef.current = false;
    commit();
  }, [commit]);

  const puckX = x * 100;
  const puckY = (1 - y) * 100;

  return (
    <div className="xy-pad-container">
      {showLabels && (
        <span className="xy-pad-label-y-external" style={{ color }}>{yLabel}</span>
      )}
      <div
        className={`xy-pad ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        style={{
          width: actualSize,
          height: actualSize,
          '--accent-color': color,
        } as React.CSSProperties}
        ref={padRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
        role="slider"
        aria-roledescription="two-dimensional slider"
        aria-label={`${xLabel} and ${yLabel} control`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(x * 100)}
        aria-valuetext={`${xLabel}: ${Math.round(x * 100)}%, ${yLabel}: ${Math.round(y * 100)}%`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
      >
        <div className="xy-pad-grid" aria-hidden="true">
          <div className="xy-pad-line horizontal" />
          <div className="xy-pad-line vertical" />
        </div>
        <div
          className="xy-pad-crosshair"
          aria-hidden="true"
          style={{ left: `${puckX}%`, top: `${puckY}%` }}
        >
          <div className="xy-pad-crosshair-h" />
          <div className="xy-pad-crosshair-v" />
        </div>
        <div
          className="xy-pad-puck"
          aria-hidden="true"
          style={{ left: `${puckX}%`, top: `${puckY}%` }}
        />
      </div>
      {showLabels && (
        <div className="xy-pad-bottom-labels">
          <span className="xy-pad-label-x-external" style={{ color }}>{xLabel}</span>
          <span className="xy-pad-values-external">{Math.round(x * 100)}/{Math.round(y * 100)}</span>
        </div>
      )}
    </div>
  );
}
