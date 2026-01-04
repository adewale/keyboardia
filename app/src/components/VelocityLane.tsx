/**
 * Phase 31G: Velocity Lane Component
 *
 * Visual velocity editing - vertical bars below each step showing velocity.
 * Allows drag-to-edit for quick dynamics adjustment.
 *
 * Features:
 * - Vertical bars proportional to velocity (0-100%)
 * - Drag bar tops to adjust
 * - Draw mode: drag across to "draw" velocity curve
 * - Only shows bars for active steps
 */

import React, { useCallback, useRef, useState } from 'react';
import type { Track, ParameterLock } from '../types';
import './VelocityLane.css';

interface VelocityLaneProps {
  track: Track;
  onSetParameterLock: (step: number, lock: ParameterLock | null) => void;
}

// Max height of velocity bars in pixels
const BAR_HEIGHT = 40;

/**
 * Get velocity level class for coloring
 * - extreme-low: < 20% (purple warning)
 * - normal: 20-80% (neutral gray)
 * - extreme-high: > 80% (red warning)
 */
function getVelocityLevel(velocity: number): 'extreme-low' | 'normal' | 'extreme-high' {
  if (velocity < 20) return 'extreme-low';
  if (velocity > 80) return 'extreme-high';
  return 'normal';
}

export const VelocityLane = React.memo(function VelocityLane({
  track,
  onSetParameterLock,
}: VelocityLaneProps) {
  const [_isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // HIGH-4: Track pointerId for proper release
  const pointerIdRef = useRef<number | null>(null);
  // MEDIUM-4: Use ref for dragging state to avoid stale closure
  const isDraggingRef = useRef(false);

  // Get velocity for a step (from p-lock or default 100)
  const getVelocity = useCallback((step: number): number => {
    const lock = track.parameterLocks[step];
    if (lock?.volume !== undefined) {
      return Math.round(lock.volume * 100);
    }
    return 100; // Default full velocity
  }, [track.parameterLocks]);

  // Set velocity for a step
  const setVelocity = useCallback((step: number, velocity: number) => {
    const clampedVelocity = Math.max(0, Math.min(100, velocity));
    const lock = track.parameterLocks[step];

    // HIGH-5: Check for tie property as well as pitch before clearing lock
    if (clampedVelocity === 100 && !lock?.pitch && !lock?.tie) {
      // If velocity is 100% and no pitch lock or tie, clear the lock entirely
      onSetParameterLock(step, null);
    } else {
      // Preserve pitch and tie if they exist, update volume
      onSetParameterLock(step, {
        ...lock,
        volume: clampedVelocity / 100,
      });
    }
  }, [track.parameterLocks, onSetParameterLock]);

  // Calculate velocity from mouse position
  const getVelocityFromEvent = useCallback((e: React.MouseEvent | React.PointerEvent, stepElement: HTMLElement): number => {
    const rect = stepElement.getBoundingClientRect();
    const y = e.clientY - rect.top;
    // Invert: top = 100%, bottom = 0%
    const velocity = Math.round((1 - y / BAR_HEIGHT) * 100);
    return Math.max(0, Math.min(100, velocity));
  }, []);

  // Get step element from event
  const getStepFromEvent = useCallback((e: React.MouseEvent | React.PointerEvent): { step: number; element: HTMLElement } | null => {
    const target = e.target as HTMLElement;
    const barElement = target.closest('[data-step]') as HTMLElement;
    if (!barElement) return null;
    // LOW-4: Add bounds check - dataset.step might be undefined
    const stepStr = barElement.dataset.step;
    if (stepStr === undefined) return null;
    const step = parseInt(stepStr, 10);
    if (isNaN(step)) return null;
    return { step, element: barElement };
  }, []);

  // Handle mouse/pointer down - start drag
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const stepInfo = getStepFromEvent(e);
    if (!stepInfo) return;

    setIsDragging(true);
    isDraggingRef.current = true;

    // MEDIUM-5: Add null check for setPointerCapture with try-catch
    if (e.target instanceof HTMLElement) {
      try {
        e.target.setPointerCapture(e.pointerId);
        pointerIdRef.current = e.pointerId;
      } catch {
        // Ignore if pointer capture fails (e.g., synthetic events, touch devices)
      }
    }

    const velocity = getVelocityFromEvent(e, stepInfo.element);
    setVelocity(stepInfo.step, velocity);
  }, [getStepFromEvent, getVelocityFromEvent, setVelocity]);

  // Handle mouse/pointer move - continue drag
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // MEDIUM-4: Use ref for dragging state to avoid stale closure
    if (!isDraggingRef.current) return;

    const stepInfo = getStepFromEvent(e);
    if (!stepInfo) return;

    const velocity = getVelocityFromEvent(e, stepInfo.element);
    setVelocity(stepInfo.step, velocity);
  }, [getStepFromEvent, getVelocityFromEvent, setVelocity]);

  // Handle mouse/pointer up - end drag
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setIsDragging(false);
    isDraggingRef.current = false;

    // HIGH-4: Release pointer capture properly
    if (pointerIdRef.current !== null && e.target instanceof HTMLElement) {
      try {
        e.target.releasePointerCapture(pointerIdRef.current);
      } catch {
        // Ignore if pointer was already released
      }
      pointerIdRef.current = null;
    }
  }, []);

  // Handle pointer leave - also end drag
  const handlePointerLeave = useCallback(() => {
    if (!isDraggingRef.current) return;

    setIsDragging(false);
    isDraggingRef.current = false;
    pointerIdRef.current = null;
    // Note: releasePointerCapture not needed on leave - browser handles it
  }, []);

  // Render velocity bars only for active steps
  const steps = track.steps.slice(0, track.stepCount);

  return (
    <div
      ref={containerRef}
      className="velocity-lane"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {/* Placeholder for alignment with track-left */}
      <div className="velocity-lane-spacer" />

      {/* Velocity bars container */}
      <div className="velocity-bars">
        {steps.map((isActive, step) => {
          const velocity = getVelocity(step);
          const height = isActive ? (velocity / 100) * BAR_HEIGHT : 0;
          const level = getVelocityLevel(velocity);

          return (
            <div
              key={step}
              className={`velocity-step ${isActive ? 'active' : 'inactive'}`}
              data-step={step}
            >
              {isActive && (
                <div
                  className={`velocity-bar ${level}`}
                  style={{ height: `${height}px` }}
                  title={`Step ${step + 1}: ${velocity}%`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
