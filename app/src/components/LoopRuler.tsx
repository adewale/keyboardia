import { memo, useCallback, useRef, useState, useEffect, useSyncExternalStore } from 'react';
import type { LoopRegion } from '../types';
import { clamp } from '../shared/validation';
import {
  DESKTOP_STEP_GEOMETRY,
  MOBILE_STEP_GEOMETRY,
  gridWidth,
  spanWidth,
  stepToX,
  xToStep,
  type StepGeometry,
} from './step-geometry';
import './LoopRuler.css';

// Minimum drag distance in steps to create a loop (prevents accidental 1-step loops from clicks)
const MIN_LOOP_LENGTH = 2;

/** The cells widen to 44px under this width (StepCell.css); the ruler follows. */
const NARROW_QUERY = '(max-width: 768px)';

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
}

function isNarrow(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(NARROW_QUERY).matches;
}

/** The rows' step geometry at the current viewport width. */
function useStepGeometry(): StepGeometry {
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  return narrow ? MOBILE_STEP_GEOMETRY : DESKTOP_STEP_GEOMETRY;
}

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
 * Timeline ruler that allows users to define a loop region.
 * - Drag to select range
 * - Double-click to clear
 * - Shift+click two points to define start/end
 *
 * It renders as the first row of .tracks-inner, inside the one horizontal
 * scroller it shares with the rows and the dock (specs/PIANO-ROLL-DOCK.md):
 * a sticky-left spacer as wide as the rows' control column, the rows' 8px gap,
 * then the strip. Every mark, the region and the playhead are placed with
 * stepToX (step-geometry.ts): the 39px step pitch plus the 8px page gap after
 * every 16 steps, so they line up with the cells below.
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
  const geometry = useStepGeometry();
  const atStep = (step: number) => stepToX(step, geometry);

  // Convert client X position to step index
  const clientXToStep = useCallback((clientX: number): number => {
    if (!rulerRef.current) return 0;
    const rect = rulerRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    return clamp(xToStep(relativeX, geometry), 0, totalSteps - 1);
  }, [totalSteps, geometry]);

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

  // Playhead step, or -1 when stopped
  const playheadStep = isPlaying && currentStep >= 0 ? currentStep % totalSteps : -1;

  // Step markers: a beat marker every 4 steps labelled bar.beat ("1.2"), and a
  // page marker every 16 labelled with the page number.
  const markers: React.ReactNode[] = [];
  for (let i = 0; i < totalSteps; i += 4) {
    const page = Math.floor(i / 16) + 1;
    if (i % 16 === 0) {
      markers.push(
        <div
          key={i}
          className="ruler-marker page"
          data-step={i}
          style={{ left: atStep(i) }}
          title={`Page ${page}`}
        >
          <span className="marker-label">{page}</span>
        </div>
      );
    } else {
      markers.push(
        <div
          key={i}
          className="ruler-marker beat"
          data-step={i}
          style={{ left: atStep(i) }}
        >
          <span className="marker-label">{`${page}.${(i % 16) / 4 + 1}`}</span>
        </div>
      );
    }
  }

  return (
    <div className="ruler-row">
      {/* Sticky-left spacer, as wide as the rows' control column */}
      <div className="ruler-spacer" aria-hidden="true">Loop</div>
      <div
        className={`loop-ruler ${displayRegion ? 'has-loop' : ''} ${dragStart !== null ? 'dragging' : ''}`}
        style={{ width: gridWidth(totalSteps, geometry) }}
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
              left: atStep(displayRegion.start),
              // Ends at the last cell's right edge, spanning any page gap inside
              width: spanWidth(displayRegion.start, displayRegion.end - displayRegion.start + 1, geometry),
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
            style={{ left: atStep(shiftClickStart) }}
            title="Shift+click another point to complete loop"
          />
        )}

        {/* Playhead position indicator */}
        {playheadStep >= 0 && (
          <div
            className="ruler-playhead"
            style={{ left: atStep(playheadStep) }}
          />
        )}
      </div>
    </div>
  );
});
