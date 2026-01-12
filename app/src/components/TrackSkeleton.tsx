/**
 * TrackSkeleton - Loading placeholder for track rows
 * Phase 34: Prevents CLS (Cumulative Layout Shift) during session loading
 *
 * Matches TrackRow dimensions to reserve space before data loads.
 */

import './TrackSkeleton.css';

interface TrackSkeletonProps {
  /** Index for staggered animation */
  index: number;
}

export function TrackSkeleton({ index }: TrackSkeletonProps) {
  return (
    <div
      className="track-skeleton"
      style={{ '--skeleton-delay': `${index * 0.1}s` } as React.CSSProperties}
      aria-hidden="true"
    >
      {/* Left controls area */}
      <div className="skeleton-left">
        <div className="skeleton-drag" />
        <div className="skeleton-name" />
        <div className="skeleton-btn" />
        <div className="skeleton-btn" />
      </div>

      {/* Steps area */}
      <div className="skeleton-steps">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="skeleton-step" />
        ))}
      </div>
    </div>
  );
}
