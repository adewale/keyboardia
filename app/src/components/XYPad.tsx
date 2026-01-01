import React, { useCallback, useRef, useState, useEffect } from 'react';
import './XYPad.css';

/**
 * BUG FIX: Pointer capture and stale closure fixes
 * See docs/bug-patterns/POINTER-CAPTURE-AND-STALE-CLOSURES.md
 */

interface XYPadProps {
  /** Current X value (0-1) */
  x: number;
  /** Current Y value (0-1) - 0 is bottom, 1 is top */
  y: number;
  /** Called when X or Y value changes */
  onChange: (x: number, y: number) => void;
  /** X axis label */
  xLabel?: string;
  /** Y axis label */
  yLabel?: string;
  /** Size in pixels (square) - minimum 64px for touch targets */
  size?: number;
  /** Disable interaction */
  disabled?: boolean;
  /** Color theme (accent color) */
  color?: string;
  /** Show external labels (default: true) */
  showLabels?: boolean;
}

// Minimum size for comfortable touch interaction (Apple HIG: 44pt minimum)
const MIN_SIZE = 64;

/**
 * XY Pad - Two-dimensional parameter control
 *
 * Classic synthesizer/DJ control that maps X and Y position to two parameters.
 * Used in effects panels, synth controls, etc.
 *
 * Design principles:
 * - Labels are OUTSIDE the interactive area (following Ableton/Kaoss Pad pattern)
 * - Size is based on touch target usability, not text
 * - Minimum 64px for comfortable finger interaction
 *
 * Usage:
 * - Drag the puck to control two parameters simultaneously
 * - X axis typically maps to wet/dry, frequency, pan, etc.
 * - Y axis typically maps to decay, feedback, resonance, etc.
 */
export function XYPad({
  x,
  y,
  onChange,
  xLabel = 'X',
  yLabel = 'Y',
  size = 80,
  disabled = false,
  color = '#00bcd4',
  showLabels = true,
}: XYPadProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // BUG FIX: Use refs to avoid stale closures in global event listeners
  const isDraggingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Enforce minimum size for touch targets
  const actualSize = Math.max(size, MIN_SIZE);

  // Calculate position from mouse/touch event
  const calculatePosition = useCallback((clientX: number, clientY: number) => {
    if (!padRef.current) return { x: 0, y: 0 };

    const rect = padRef.current.getBoundingClientRect();
    const newX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Y is inverted (0 at bottom, 1 at top)
    const newY = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));

    return { x: newX, y: newY };
  }, []);

  // Handle mouse/touch start
  const handleStart = useCallback((clientX: number, clientY: number) => {
    if (disabled) return;
    setIsDragging(true);
    const pos = calculatePosition(clientX, clientY);
    onChange(pos.x, pos.y);
  }, [disabled, calculatePosition, onChange]);

  // Handle mouse/touch move
  // BUG FIX: Use refs to avoid stale closures - removed isDragging and onChange from deps
  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingRef.current || disabled) return;
    const pos = calculatePosition(clientX, clientY);
    onChangeRef.current(pos.x, pos.y);
  }, [disabled, calculatePosition]);

  // Handle mouse/touch end
  const handleEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mouse event handlers
  // BUG FIX: Add pointer capture for reliable drag tracking across elements
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Capture pointer to receive events even when pointer leaves element
    try {
      (e.target as HTMLElement).setPointerCapture((e.nativeEvent as PointerEvent).pointerId || 1);
    } catch {
      // Ignore if capture fails (some browsers don't support pointerId on MouseEvent)
    }
    handleStart(e.clientX, e.clientY);
  }, [handleStart]);

  // BUG FIX: Release pointer capture on mouse up
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    try {
      (e.target as HTMLElement).releasePointerCapture((e.nativeEvent as PointerEvent).pointerId || 1);
    } catch {
      // Ignore if release fails
    }
    handleEnd();
  }, [handleEnd]);

  // Touch event handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
  }, [handleStart]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  }, [handleMove]);

  // Global event listeners for mouse dragging (outside component)
  // BUG FIX: Register once on mount, use refs for current state
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        handleMove(e.clientX, e.clientY);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        handleEnd();
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [handleMove, handleEnd]); // handleMove and handleEnd are stable now

  // Calculate puck position (CSS)
  const puckX = x * 100;
  const puckY = (1 - y) * 100; // Invert Y for CSS (top is 0)

  return (
    <div className="xy-pad-container">
      {/* Y-axis label - outside, to the left */}
      {showLabels && (
        <span className="xy-pad-label-y-external" style={{ color }}>
          {yLabel}
        </span>
      )}

      {/* The interactive pad */}
      <div
        className={`xy-pad ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        style={{
          width: actualSize,
          height: actualSize,
          '--accent-color': color,
        } as React.CSSProperties}
        ref={padRef}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleEnd}
        role="slider"
        aria-label={`${xLabel} and ${yLabel} control`}
        aria-valuetext={`${xLabel}: ${Math.round(x * 100)}%, ${yLabel}: ${Math.round(y * 100)}%`}
        tabIndex={disabled ? -1 : 0}
      >
        {/* Grid lines for visual reference */}
        <div className="xy-pad-grid">
          <div className="xy-pad-line horizontal" />
          <div className="xy-pad-line vertical" />
        </div>

        {/* Crosshair showing current position */}
        <div
          className="xy-pad-crosshair"
          style={{
            left: `${puckX}%`,
            top: `${puckY}%`,
          }}
        >
          <div className="xy-pad-crosshair-h" />
          <div className="xy-pad-crosshair-v" />
        </div>

        {/* The draggable puck */}
        <div
          className="xy-pad-puck"
          style={{
            left: `${puckX}%`,
            top: `${puckY}%`,
          }}
        />
      </div>

      {/* X-axis label and values - outside, below */}
      {showLabels && (
        <div className="xy-pad-bottom-labels">
          <span className="xy-pad-label-x-external" style={{ color }}>
            {xLabel}
          </span>
          <span className="xy-pad-values-external">
            {Math.round(x * 100)}/{Math.round(y * 100)}
          </span>
        </div>
      )}
    </div>
  );
}
