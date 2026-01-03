/**
 * Phase 31H: Multi-Track Velocity Overview Panel
 *
 * Full-width velocity visualization showing all tracks' dynamics at a glance.
 * Features:
 * - Per-track velocity dots (like PitchOverview)
 * - Color coding (accent for normal, purple/red for extremes)
 * - Quality indicators (extreme low/high, conflicts)
 *
 * @see specs/research/key-assistant.md
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
 * Per-track velocity data
 */
interface TrackVelocity {
  trackId: string;
  trackName: string;
  velocity: number; // 0-1
  step: number;
  category: 'drum' | 'melodic';
}

/**
 * Velocity level for color coding
 */
type VelocityLevel = 'pp' | 'p' | 'mf' | 'f' | 'ff';

/**
 * Step velocity data for overview visualization
 */
interface StepVelocityData {
  stepIndex: number;
  trackVelocities: TrackVelocity[]; // Per-track velocity data
  // Aggregate stats
  avgVelocity: number;
  minVelocity: number;
  maxVelocity: number;
  spread: number; // max - min
  // Quality indicators
  hasExtremeLow: boolean;  // any < 0.2
  hasExtremeHigh: boolean; // any > 0.95
  hasConflict: boolean;    // spread > 0.5
}

/**
 * Get velocity level for color coding
 */
function getVelocityLevel(velocity: number): VelocityLevel {
  if (velocity < 0.2) return 'pp';  // Very soft (purple)
  if (velocity < 0.4) return 'p';   // Soft (blue)
  if (velocity < 0.6) return 'mf';  // Medium (green)
  if (velocity < 0.8) return 'f';   // Loud (yellow)
  return 'ff';                       // Very loud (red)
}

/**
 * Determine instrument category from sampleId
 */
function getInstrumentCategory(sampleId: string): 'drum' | 'melodic' {
  const drumPatterns = ['kick', 'snare', 'hat', 'clap', 'tom', 'cymbal', 'perc', '808', 'drum'];
  const lowerSampleId = sampleId.toLowerCase();
  return drumPatterns.some(p => lowerSampleId.includes(p)) ? 'drum' : 'melodic';
}

/**
 * Multi-Track Velocity Overview
 *
 * Shows a condensed view of all tracks' dynamics:
 * - Per-track velocity dots positioned by velocity level
 * - Color-coded (accent for normal, purple/red for extremes)
 * - Quality indicators for extreme values and conflicts
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

  // Build per-step velocity data with per-track information
  const stepData = useMemo((): StepVelocityData[] => {
    const data: StepVelocityData[] = [];

    for (let step = 0; step < maxStepCount; step++) {
      const trackVelocities: TrackVelocity[] = [];

      // Collect velocities from all active tracks on this step
      for (const track of activeTracks) {
        const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
        const stepInTrack = step % trackStepCount;

        if (track.steps[stepInTrack]) {
          const velocity = track.parameterLocks[stepInTrack]?.volume ?? 1;
          trackVelocities.push({
            trackId: track.id,
            trackName: track.name || track.sampleId.split(':').pop() || 'Track',
            velocity,
            step: stepInTrack,
            category: getInstrumentCategory(track.sampleId),
          });
        }
      }

      // Calculate aggregate stats
      const velocities = trackVelocities.map(tv => tv.velocity);
      const avgVelocity = velocities.length > 0
        ? velocities.reduce((a, b) => a + b, 0) / velocities.length
        : 0;
      const minVelocity = velocities.length > 0 ? Math.min(...velocities) : 0;
      const maxVelocity = velocities.length > 0 ? Math.max(...velocities) : 0;
      const spread = maxVelocity - minVelocity;

      // Quality indicators
      const hasExtremeLow = velocities.some(v => v < 0.2);
      const hasExtremeHigh = velocities.some(v => v > 0.95);
      const hasConflict = spread > 0.5;

      data.push({
        stepIndex: step,
        trackVelocities,
        avgVelocity,
        minVelocity,
        maxVelocity,
        spread,
        hasExtremeLow,
        hasExtremeHigh,
        hasConflict,
      });
    }

    return data;
  }, [activeTracks, maxStepCount]);

  // Calculate global stats for header
  const globalStats = useMemo(() => {
    const activeSteps = stepData.filter(d => d.trackVelocities.length > 0);
    const allVelocities = activeSteps.flatMap(d => d.trackVelocities.map(tv => tv.velocity));

    if (allVelocities.length === 0) {
      return { min: 0, max: 0, activeCount: 0, hasVariation: false };
    }

    const min = Math.min(...allVelocities);
    const max = Math.max(...allVelocities);
    const hasVariation = min !== max;

    return {
      min,
      max,
      activeCount: activeSteps.length,
      hasVariation,
    };
  }, [stepData]);

  // Count quality issues
  const qualityIssues = useMemo(() => {
    return {
      extremeLow: stepData.filter(d => d.hasExtremeLow).length,
      extremeHigh: stepData.filter(d => d.hasExtremeHigh).length,
      conflicts: stepData.filter(d => d.hasConflict).length,
    };
  }, [stepData]);

  // Don't render if no tracks
  if (tracks.length === 0) {
    return null;
  }

  return (
    <div className="velocity-overview">
      {/* Header - matches Pitch Overview style */}
      <div className="velocity-overview-header">
        <h2 className="velocity-overview-title">Velocity Overview</h2>
        <span className="velocity-overview-info">
          {tracks.length} track{tracks.length !== 1 ? 's' : ''} •{' '}
          {globalStats.activeCount}/{maxStepCount} active
          {globalStats.hasVariation && (
            <> • {Math.round(globalStats.min * 100)}–{Math.round(globalStats.max * 100)}%</>
          )}
          {qualityIssues.extremeLow > 0 && (
            <span className="quality-warning" title={`${qualityIssues.extremeLow} steps with very soft notes (may be inaudible)`}>
              {' '}⚠ {qualityIssues.extremeLow} soft
            </span>
          )}
        </span>
      </div>

      {/* Main visualization area */}
      <div className="velocity-overview-content">
        {/* Y-axis labels with percentages */}
        <div className="velocity-overview-y-axis">
          <span className="range-label high">100%</span>
          <span className="range-label mid">50%</span>
          <span className="range-label low">0%</span>
        </div>

        {/* Grid container */}
        <div className="velocity-overview-grid">
          {/* Velocity dots - per-track representation */}
          <div className="velocity-overview-dots">
            {stepData.map((data, i) => {
              const isPageEnd = (i + 1) % STEPS_PER_PAGE === 0 && i < maxStepCount - 1;
              const isBeatStart = i % 4 === 0;
              const hasNotes = data.trackVelocities.length > 0;

              return (
                <div
                  key={i}
                  className={`velocity-dot-cell ${isBeatStart ? 'beat-start' : ''} ${isPageEnd ? 'page-end' : ''} ${isPlaying && currentStep === i ? 'playing' : ''} ${data.hasConflict ? 'has-conflict' : ''}`}
                  title={hasNotes
                    ? `Step ${i + 1}: ${data.trackVelocities.length} track${data.trackVelocities.length !== 1 ? 's' : ''}, avg ${Math.round(data.avgVelocity * 100)}%`
                    : `Step ${i + 1}: no notes`
                  }
                >
                  {hasNotes && data.trackVelocities.map((tv, j) => {
                    const top = (1 - tv.velocity) * 100;
                    const level = getVelocityLevel(tv.velocity);
                    const isExtremeLow = tv.velocity < 0.2;
                    const isExtremeHigh = tv.velocity > 0.95;

                    return (
                      <div
                        key={j}
                        className={`velocity-dot level-${level} ${isExtremeLow ? 'extreme-low' : ''} ${isExtremeHigh ? 'extreme-high' : ''} ${tv.category}`}
                        style={{ top: `${Math.max(5, Math.min(95, top))}%` }}
                        title={`${tv.trackName}: ${Math.round(tv.velocity * 100)}%`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
