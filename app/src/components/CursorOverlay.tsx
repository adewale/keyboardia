/**
 * Phase 11: Cursor Overlay Component
 *
 * Renders remote players' cursor positions over the step sequencer grid.
 * Cursors fade out after 3 seconds of inactivity.
 */

import { useEffect, useState, useMemo, useDeferredValue } from 'react';
import type { RemoteCursor } from '../sync/multiplayer';
import './CursorOverlay.css';

interface CursorOverlayProps {
  cursors: Map<string, RemoteCursor>;
  containerRef: React.RefObject<HTMLElement | null>;
}

const CURSOR_FADE_TIME_MS = 3000; // Fade out after 3 seconds of no movement
const CURSOR_STALE_TIME_MS = 10000; // Remove from rendering after 10 seconds

export function CursorOverlay({ cursors, containerRef }: CursorOverlayProps) {
  const [tick, setTick] = useState(0);

  // Phase 34: Defer cursor updates to avoid blocking more important UI updates
  // This allows the sequencer to remain responsive even with many cursor updates
  const deferredCursors = useDeferredValue(cursors);

  // Force re-render periodically to update fade state
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Use tick to get current time (updates every 500ms via the interval above)
  // This avoids calling Date.now() directly during render which is impure
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [tick]);

  if (!containerRef.current) return null;

  // Filter out stale cursors (older than CURSOR_STALE_TIME_MS)
  // Phase 34: Use deferred cursors for rendering to improve responsiveness
  const activeCursors = Array.from(deferredCursors.values()).filter(
    cursor => now - cursor.lastUpdate < CURSOR_STALE_TIME_MS
  );

  return (
    <div className="cursor-overlay">
      {activeCursors.map(cursor => {
        const age = now - cursor.lastUpdate;
        const isFading = age > CURSOR_FADE_TIME_MS;
        const opacity = isFading ? 0 : 1;

        return (
          <div
            key={cursor.playerId}
            className="remote-cursor"
            style={{
              left: `${cursor.position.x}%`,
              top: `${cursor.position.y}%`,
              opacity,
              '--cursor-color': cursor.color,
            } as React.CSSProperties}
          >
            <svg
              className="cursor-pointer"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill={cursor.color}
            >
              <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z" />
            </svg>
            <span
              className="cursor-label"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
