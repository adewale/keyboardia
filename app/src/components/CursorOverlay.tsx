/**
 * Phase 11: Cursor Overlay Component
 *
 * Renders remote players' cursor positions over the step sequencer grid.
 * Cursors fade out after 3 seconds of inactivity using CSS transitions
 * (no setInterval needed — see docs/LESSONS-LEARNED.md Lesson 20).
 */

import { useDeferredValue, useMemo } from 'react';
import type { RemoteCursor } from '../sync/multiplayer';
import './CursorOverlay.css';

interface CursorOverlayProps {
  cursors: Map<string, RemoteCursor>;
  containerRef: React.RefObject<HTMLElement | null>;
}

const CURSOR_FADE_TIME_MS = 3000; // CSS transition-delay before fade starts
const CURSOR_STALE_TIME_MS = 10000; // Remove from DOM after 10 seconds

export function CursorOverlay({ cursors, containerRef }: CursorOverlayProps) {
  // Phase 34: Defer cursor updates to avoid blocking more important UI updates
  const deferredCursors = useDeferredValue(cursors);

  // Snapshot time once per render triggered by cursor changes.
  // eslint-disable-next-line react-hooks/purity -- Intentional: Date.now() is needed to evaluate cursor staleness; only called when cursors prop changes
  const now = useMemo(() => Date.now(), [deferredCursors]);

  if (!containerRef.current) return null;

  // Filter out stale cursors (older than CURSOR_STALE_TIME_MS)
  const activeCursors = Array.from(deferredCursors.values()).filter(
    cursor => now - cursor.lastUpdate < CURSOR_STALE_TIME_MS
  );

  return (
    <div className="cursor-overlay">
      {activeCursors.map(cursor => {
        // Cursor age determines CSS class — the actual fade is handled by CSS transition.
        // No setInterval needed: cursors re-render when the cursors map prop changes
        // (i.e., when new cursor positions arrive via WebSocket), which is the only
        // time we need to re-evaluate staleness. Stale cursors that receive no further
        // updates are removed by the CURSOR_STALE_TIME_MS filter on the next render.
        const age = now - cursor.lastUpdate;
        const isFading = age > CURSOR_FADE_TIME_MS;

        return (
          <div
            key={cursor.playerId}
            className={`remote-cursor${isFading ? ' remote-cursor--fading' : ''}`}
            style={{
              left: `${cursor.position.x}%`,
              top: `${cursor.position.y}%`,
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
