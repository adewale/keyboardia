import { memo, useCallback, useRef, useState, useEffect } from 'react';
import type { LoopRegion } from '../types';
import { clamp } from '../shared/validation';
import './LoopRuler.css';

// Minimum drag distance in steps to create a loop (prevents accidental 1-step loops from clicks)
const MIN_LOOP_LENGTH = 2;

/**
 * The step pitch: a 36px cell plus the 3px gap between cells. The ruler sits
 * on the same pitch as the track rows and the dock, so step N's marker is at
 * the x of step N's cell. CSS reads the same value from --ruler-step-pitch.
 */
const STEP_PITCH_PX = 39;

/** The pitch the stylesheet is using (it widens with the cells on narrow screens). */
function readStepPitch(el: HTMLElement): number {
  const value = parseFloat(getComputedStyle(el).getPropertyValue('--ruler-step-pitch'));
  return Number.isFinite(value) && value > 0 ? value : STEP_PITCH_PX;
}

/** Position on the step pitch, as a CSS length. */
const atStep = (step: number) => `calc(${step} * var(--ruler-step-pitch))`;

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
 * then the strip on the 39px step pitch. Every mark, the region and the
 * playhead are in px on that pitch, so they line up with the cells below.
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
    const step = Math.floor(relativeX / readStepPitch(rulerRef.current));
    return clamp(step, 0, totalSteps - 1);
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
        style={{ '--ruler-steps': totalSteps } as React.CSSProperties}
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
              // Ends at the last cell's right edge, not the gap after it
              width: `calc(${displayRegion.end - displayRegion.start + 1} * var(--ruler-step-pitch) - var(--ruler-step-gap))`,
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
