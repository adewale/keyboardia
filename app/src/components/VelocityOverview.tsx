/**
 * Phase 31H: Velocity Overview Panel (Simplified)
 *
 * Single-row accent pattern visualization showing groove dynamics at a glance.
 *
 * Design Philosophy:
 * - Shows WHERE accents and ghost notes are, not exact velocity values
 * - Answers "what's the groove pattern?" not "what's each track's velocity?"
 * - Accent = any track >80%, Ghost = all tracks <40%, Normal = everything else
 *
 * @see specs/PHASE-31-UI-ENHANCEMENTS.md
 */
import { memo, useMemo } from 'react';
import type { Track } from '../types';
import { STEPS_PER_PAGE } from '../types';
import './VelocityOverview.css';

interface VelocityOverviewProps {
  tracks: Track[];
  currentStep?: number;
  isPlaying?: boolean;
}

/**
 * Accent type for each step
 */
type AccentType = 'accent' | 'ghost' | 'normal' | 'empty';

/**
 * Step accent data for simplified visualization
 */
interface StepAccentData {
  stepIndex: number;
  accentType: AccentType;
  trackCount: number; // Number of active tracks on this step
  maxVelocity: number;
  minVelocity: number;
}

/**
 * Determine accent type from velocities
 * - Accent: any track >80%
 * - Ghost: all tracks <40%
 * - Normal: everything else
 * - Empty: no active tracks
 */
function getAccentType(velocities: number[]): AccentType {
  if (velocities.length === 0) return 'empty';

  const max = Math.max(...velocities);

  if (max > 0.8) return 'accent';   // Any track is loud = accent
  if (max < 0.4) return 'ghost';    // All tracks are quiet = ghost note
  return 'normal';
}

/**
 * Simplified Velocity Overview
 *
 * Shows accent pattern as a single row:
 * ★ = Accent (any track >80%)
 * ○ = Ghost note (all tracks <40%)
 * · = Normal (neither)
 */
export const VelocityOverview = memo(function VelocityOverview({
  tracks,
  currentStep = -1,
  isPlaying = false,
}: VelocityOverviewProps) {
  // Only consider non-muted tracks
  const activeTracks = useMemo(() => {
    return tracks.filter(t => !t.muted);
  }, [tracks]);

  // Find the longest step count for grid width
  const maxStepCount = useMemo(() => {
    if (activeTracks.length === 0) return STEPS_PER_PAGE;
    return Math.max(...activeTracks.map(t => t.stepCount ?? STEPS_PER_PAGE));
  }, [activeTracks]);

  // Build per-step accent data
  const stepData = useMemo((): StepAccentData[] => {
    const data: StepAccentData[] = [];

    for (let step = 0; step < maxStepCount; step++) {
      const velocities: number[] = [];

      // Collect velocities from all active tracks on this step
      for (const track of activeTracks) {
        const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
        const stepInTrack = step % trackStepCount;

        if (track.steps[stepInTrack]) {
          const velocity = track.parameterLocks[stepInTrack]?.volume ?? 1;
          velocities.push(velocity);
        }
      }

      const accentType = getAccentType(velocities);
      const maxVelocity = velocities.length > 0 ? Math.max(...velocities) : 0;
      const minVelocity = velocities.length > 0 ? Math.min(...velocities) : 0;

      data.push({
        stepIndex: step,
        accentType,
        trackCount: velocities.length,
        maxVelocity,
        minVelocity,
      });
    }

    return data;
  }, [activeTracks, maxStepCount]);

  // Count accent types for header summary
  const accentCounts = useMemo(() => {
    return {
      accents: stepData.filter(d => d.accentType === 'accent').length,
      ghosts: stepData.filter(d => d.accentType === 'ghost').length,
      normal: stepData.filter(d => d.accentType === 'normal').length,
      empty: stepData.filter(d => d.accentType === 'empty').length,
    };
  }, [stepData]);

  // Don't render if no tracks
  if (tracks.length === 0) {
    return null;
  }

  // Build summary text
  const summaryParts: string[] = [];
  if (accentCounts.accents > 0) {
    summaryParts.push(`★ ${accentCounts.accents} accent${accentCounts.accents !== 1 ? 's' : ''}`);
  }
  if (accentCounts.ghosts > 0) {
    summaryParts.push(`○ ${accentCounts.ghosts} ghost${accentCounts.ghosts !== 1 ? 's' : ''}`);
  }

  return (
    <div className="velocity-overview">
      {/* Header */}
      <div className="velocity-overview-header">
        <h2 className="velocity-overview-title">Velocity</h2>
        <span className="velocity-overview-info">
          {summaryParts.length > 0 ? summaryParts.join(' • ') : 'No dynamics variation'}
        </span>
      </div>

      {/* Single-row accent strip */}
      <div className="velocity-overview-strip">
        {stepData.map((data, i) => {
          const isPageEnd = (i + 1) % STEPS_PER_PAGE === 0 && i < maxStepCount - 1;
          const isBeatStart = i % 4 === 0;

          // Get symbol for accent type
          const symbol = data.accentType === 'accent' ? '★'
            : data.accentType === 'ghost' ? '○'
            : data.accentType === 'normal' ? '·'
            : '';

          // Build tooltip
          const tooltip = data.accentType === 'empty'
            ? `Step ${i + 1}: no notes`
            : `Step ${i + 1}: ${data.trackCount} track${data.trackCount !== 1 ? 's' : ''}, ${Math.round(data.maxVelocity * 100)}% max`;

          return (
            <div
              key={i}
              className={`accent-cell ${data.accentType} ${isBeatStart ? 'beat-start' : ''} ${isPageEnd ? 'page-end' : ''} ${isPlaying && currentStep === i ? 'playing' : ''}`}
              title={tooltip}
            >
              <span className="accent-symbol">{symbol}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
