import { useCallback, useRef, useEffect } from 'react';
import { clamp } from '../shared/validation';
import './TransportBar.css';

/**
 * BUG FIX: Pointer capture for tempo/swing drag operations
 * See docs/bug-patterns/POINTER-CAPTURE-AND-STALE-CLOSURES.md
 */

interface TransportBarProps {
  isPlaying: boolean;
  tempo: number;
  swing: number;
  onPlayPause: () => void;
  onTempoChange: (tempo: number) => void;
  onSwingChange: (swing: number) => void;
}

/**
 * TransportBar - Mobile-optimized playback controls
 *
 * LESSON FOR DESKTOP: Drag-to-adjust values (like Teenage Engineering knobs)
 * are more intuitive than +/- buttons. Less precise but faster.
 * Consider backporting this interaction pattern.
 */
export function TransportBar({
  isPlaying,
  tempo,
  swing,
  onPlayPause,
  onTempoChange,
  onSwingChange,
}: TransportBarProps) {
  const tempoRef = useRef<HTMLDivElement>(null);
  const swingRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ value: number; y: number; type: 'tempo' | 'swing' } | null>(null);
  // BUG FIX: Track active pointer for capture
  const activePointerRef = useRef<{ element: HTMLElement; pointerId: number } | null>(null);

  // Drag handler for tempo/swing values
  // BUG FIX: Add pointer capture for reliable drag tracking
  const handleDragStart = useCallback((
    e: React.TouchEvent | React.MouseEvent,
    currentValue: number,
    type: 'tempo' | 'swing'
  ) => {
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { value: currentValue, y, type };

    // Capture pointer for mouse events
    if (!('touches' in e)) {
      try {
        const element = e.currentTarget as HTMLElement;
        const pointerId = (e.nativeEvent as PointerEvent).pointerId || 1;
        element.setPointerCapture(pointerId);
        activePointerRef.current = { element, pointerId };
      } catch {
        // Ignore if capture fails
      }
    }
  }, []);

  const handleDragMove = useCallback((
    e: React.TouchEvent | React.MouseEvent,
    type: 'tempo' | 'swing',
    min: number,
    max: number,
    onChange: (value: number) => void
  ) => {
    if (!dragStartRef.current) return;

    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const delta = dragStartRef.current.y - y; // Drag up = increase
    const sensitivity = type === 'tempo' ? 0.5 : 0.3;
    const newValue = Math.round(
      clamp(dragStartRef.current.value + delta * sensitivity, min, max)
    );
    onChange(newValue);
  }, []);

  // BUG FIX: Release pointer capture on drag end
  const handleDragEnd = useCallback(() => {
    if (activePointerRef.current) {
      try {
        activePointerRef.current.element.releasePointerCapture(activePointerRef.current.pointerId);
      } catch {
        // Ignore if release fails
      }
      activePointerRef.current = null;
    }
    dragStartRef.current = null;
  }, []);

  // BUG FIX: Global mouseup listener to catch drag end outside element
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragStartRef.current) {
        handleDragEnd();
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleDragEnd]);

  return (
    <div className="transport-bar">
      {/* Play/Pause button */}
      <button
        className={`transport-play ${isPlaying ? 'playing' : ''}`}
        onClick={onPlayPause}
        aria-label={isPlaying ? 'Stop' : 'Play'}
      >
        {isPlaying ? '■' : '▶'}
      </button>

      {/* Tempo - drag to adjust */}
      <div
        className="transport-value"
        ref={tempoRef}
        onTouchStart={(e) => handleDragStart(e, tempo, 'tempo')}
        onTouchMove={(e) => handleDragMove(e, 'tempo', 60, 180, onTempoChange)}
        onTouchEnd={handleDragEnd}
        onMouseDown={(e) => handleDragStart(e, tempo, 'tempo')}
        onMouseMove={(e) => e.buttons === 1 && handleDragMove(e, 'tempo', 60, 180, onTempoChange)}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        title="Drag up/down to adjust tempo"
      >
        <span className="transport-label">BPM</span>
        <span className="transport-number">{tempo}</span>
      </div>

      {/* Swing - drag to adjust */}
      <div
        className="transport-value"
        ref={swingRef}
        onTouchStart={(e) => handleDragStart(e, swing, 'swing')}
        onTouchMove={(e) => handleDragMove(e, 'swing', 0, 100, onSwingChange)}
        onTouchEnd={handleDragEnd}
        onMouseDown={(e) => handleDragStart(e, swing, 'swing')}
        onMouseMove={(e) => e.buttons === 1 && handleDragMove(e, 'swing', 0, 100, onSwingChange)}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        title="Drag up/down to adjust swing"
      >
        <span className="transport-label">Swing</span>
        <span className="transport-number">{swing}%</span>
      </div>
    </div>
  );
}
