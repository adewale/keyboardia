import { memo, useCallback, useRef, useState, useEffect } from 'react';
import type { LoopRegion } from '../types';
import './LoopRuler.css';

// Minimum drag distance in steps to create a loop (prevents accidental 1-step loops from clicks)
const MIN_LOOP_LENGTH = 2;

interface LoopRulerProps {
  totalSteps: number; // Longest track's step count
  loopRegion: LoopRegion | null;
  onSetLoopRegion: (region: LoopRegion | null) => void;
  currentStep: number; // Current playhead position
  isPlaying: boolean;
}

/**
 * Phase 31G: Loop Selection Ruler
 *
 * Timeline ruler above the grid that allows users to define a loop region.
 * - Drag to select range
 * - Double-click to clear
 * - Shift+click two points to define start/end
 */
export const LoopRuler = memo(function LoopRuler({
  totalSteps,
  loopRegion,
  onSetLoopRegion,
  currentStep,
  isPlaying,
}: LoopRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [shiftClickStart, setShiftClickStart] = useState<number | null>(null);

  // Convert client X position to step index
  const clientXToStep = useCallback((clientX: number): number => {
    if (!rulerRef.current) return 0;
    const rect = rulerRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const stepWidth = rect.width / totalSteps;
    const step = Math.floor(relativeX / stepWidth);
    return Math.max(0, Math.min(totalSteps - 1, step));
  }, [totalSteps]);

  // Handle pointer down - start drag or Shift+click
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const step = clientXToStep(e.clientX);

    // Shift+click: Set start or end point
    if (e.shiftKey) {
      if (shiftClickStart === null) {
        // First Shift+click: Set start point
        setShiftClickStart(step);
      } else {
        // Second Shift+click: Set end point and create region
        const start = Math.min(shiftClickStart, step);
        const end = Math.max(shiftClickStart, step);
        onSetLoopRegion({ start, end });
        setShiftClickStart(null);
      }
      return;
    }

    // Clear shift-click state on regular click
    setShiftClickStart(null);

    // Regular click: Start drag
    setDragStart(step);
    setDragEnd(step);

    // Capture pointer for reliable drag
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore if capture fails
    }
  }, [clientXToStep, shiftClickStart, onSetLoopRegion]);

  // Handle pointer move - update drag end
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStart === null) return;
    const step = clientXToStep(e.clientX);
    setDragEnd(step);
  }, [dragStart, clientXToStep]);

  // Handle pointer up - finalize loop region
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // Release pointer capture
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if release fails
    }

    if (dragStart !== null && dragEnd !== null) {
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      const length = end - start + 1;
      // Only create loop if user actually dragged (prevents accidental 1-step loops from clicks)
      if (length >= MIN_LOOP_LENGTH) {
        onSetLoopRegion({ start, end });
      }
    }

    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd, onSetLoopRegion]);

  // Handle double-click - clear loop
  const handleDoubleClick = useCallback(() => {
    onSetLoopRegion(null);
    setShiftClickStart(null);
  }, [onSetLoopRegion]);

  // Handle Escape key to clear pending shift-click state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shiftClickStart !== null) {
        setShiftClickStart(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shiftClickStart]);

  // Calculate display region (either from drag preview or actual loop)
  const displayRegion = dragStart !== null && dragEnd !== null
    ? { start: Math.min(dragStart, dragEnd), end: Math.max(dragStart, dragEnd) }
    : loopRegion;

  // Calculate region position as percentages
  const regionStart = displayRegion ? (displayRegion.start / totalSteps) * 100 : 0;
  const regionWidth = displayRegion
    ? ((displayRegion.end - displayRegion.start + 1) / totalSteps) * 100
    : 0;

  // Calculate playhead position as percentage
  const playheadPosition = isPlaying && currentStep >= 0
    ? ((currentStep % totalSteps) / totalSteps) * 100
    : -1;

  // Generate step markers (every 4 steps for beat boundaries, every 16 for pages)
  const markers: React.ReactNode[] = [];
  for (let i = 0; i < totalSteps; i++) {
    if (i % 16 === 0) {
      // Page marker
      markers.push(
        <div
          key={i}
          className="ruler-marker page"
          style={{ left: `${(i / totalSteps) * 100}%` }}
          title={`Page ${Math.floor(i / 16) + 1}`}
        >
          <span className="marker-label">{Math.floor(i / 16) + 1}</span>
        </div>
      );
    } else if (i % 4 === 0) {
      // Beat marker
      markers.push(
        <div
          key={i}
          className="ruler-marker beat"
          style={{ left: `${(i / totalSteps) * 100}%` }}
        />
      );
    }
  }

  return (
    <div
      className={`loop-ruler ${displayRegion ? 'has-loop' : ''} ${dragStart !== null ? 'dragging' : ''}`}
      ref={rulerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      title={loopRegion
        ? `Loop: steps ${loopRegion.start + 1}-${loopRegion.end + 1} (double-click to clear)`
        : 'Drag to set loop region'
      }
      role="slider"
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuenow={loopRegion ? loopRegion.end - loopRegion.start + 1 : totalSteps}
      aria-label="Loop region"
    >
      {/* Step markers */}
      <div className="ruler-markers">
        {markers}
      </div>

      {/* Loop region highlight */}
      {displayRegion && (
        <div
          className={`loop-region ${dragStart !== null ? 'preview' : ''}`}
          style={{
            left: `${regionStart}%`,
            width: `${regionWidth}%`,
          }}
        >
          {/* Start bracket */}
          <div className="loop-bracket start" />
          {/* End bracket */}
          <div className="loop-bracket end" />
        </div>
      )}

      {/* Shift+click pending marker */}
      {shiftClickStart !== null && (
        <div
          className="shift-click-marker"
          style={{ left: `${(shiftClickStart / totalSteps) * 100}%` }}
          title="Shift+click another point to complete loop"
        />
      )}

      {/* Playhead position indicator */}
      {playheadPosition >= 0 && (
        <div
          className="ruler-playhead"
          style={{ left: `${playheadPosition}%` }}
        />
      )}
    </div>
  );
});
