/**
 * Phase 31H: Multi-Track Pitch Overview Panel
 *
 * Full-width pitch visualization showing all tracks' melodic content at a glance.
 * Displays pitch range and active notes per step.
 * Expands to fill available panel width using flexbox.
 *
 * @see specs/research/key-assistant.md
 * @see specs/research/PITCH-VISUALIZATION-RESEARCH.md (Option 6 + 7)
 */
import { memo, useMemo } from 'react';
import type { Track, ScaleState } from '../types';
import { STEPS_PER_PAGE } from '../types';
import {
  pitchToNoteName,
  isInScale,
  type NoteName,
  type ScaleId,
} from '../music/music-theory';
import { TONE_SYNTH_CATEGORIES } from './sample-constants';
import { isStepPlaying } from '../utils/playhead';
import './PitchOverview.css';


interface PitchOverviewProps {
  tracks: Track[];
  scale?: ScaleState;
  currentStep?: number;
  isPlaying?: boolean;
}

/**
 * Check if an instrument is melodic (can play different pitches)
 * Shared logic from TrackRow - should ideally be extracted to a utility
 */
function isMelodicInstrument(sampleId: string): boolean {
  if (sampleId.startsWith('synth:')) return true;
  if (sampleId.startsWith('advanced:')) return true;
  if (sampleId.startsWith('sampled:')) return true;
  if (sampleId.startsWith('tone:')) {
    // TONE_SYNTH_CATEGORIES.drum contains full IDs like 'tone:membrane-kick'
    return !TONE_SYNTH_CATEGORIES.drum.some((d: string) => sampleId === d);
  }
  return false;
}

/**
 * Step pitch data for overview visualization
 */
interface StepPitchData {
  stepIndex: number;
  pitches: number[]; // All pitches sounding on this step
  trackIds: string[]; // Which tracks are active
  hasOutOfScale: boolean; // Any out-of-scale notes
}

/**
 * Multi-Track Pitch Overview
 *
 * Shows a condensed view of all melodic tracks:
 * - Vertical bars showing pitch range per step
 * - Out-of-scale indicators
 */
export const PitchOverview = memo(function PitchOverview({
  tracks,
  scale,
  currentStep = -1,
  isPlaying = false,
}: PitchOverviewProps) {
  // Only consider melodic tracks (synths, sampled instruments)
  const melodicTracks = useMemo(() => {
    return tracks.filter(t => isMelodicInstrument(t.sampleId));
  }, [tracks]);

  // Find the longest step count for grid width
  const maxStepCount = useMemo(() => {
    if (melodicTracks.length === 0) return STEPS_PER_PAGE;
    return Math.max(...melodicTracks.map(t => t.stepCount ?? STEPS_PER_PAGE));
  }, [melodicTracks]);

  // Check if any melodic track is soloed (for solo-aware filtering)
  const anySoloed = useMemo(() => {
    return melodicTracks.some(t => t.soloed);
  }, [melodicTracks]);

  // Count visible tracks (for header info)
  const visibleTrackCount = useMemo(() => {
    return melodicTracks.filter(track =>
      anySoloed ? track.soloed : !track.muted
    ).length;
  }, [melodicTracks, anySoloed]);

  // Build per-step pitch data
  const stepData = useMemo((): StepPitchData[] => {
    const data: StepPitchData[] = [];

    for (let step = 0; step < maxStepCount; step++) {
      const pitches: number[] = [];
      const trackIds: string[] = [];

      // Collect pitches from all melodic tracks on this step
      for (const track of melodicTracks) {
        const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
        const stepInTrack = step % trackStepCount;

        const shouldShow = anySoloed ? track.soloed : !track.muted;
        if (track.steps[stepInTrack] && shouldShow) {
          const pitch = track.parameterLocks[stepInTrack]?.pitch ?? 0;
          const totalPitch = (track.transpose ?? 0) + pitch;
          pitches.push(totalPitch);
          trackIds.push(track.id);
        }
      }

      // Check for out-of-scale notes
      let hasOutOfScale = false;
      if (scale && pitches.length > 0) {
        hasOutOfScale = pitches.some(p => !isInScale(p, scale.root as NoteName, scale.scaleId as ScaleId));
      }

      data.push({
        stepIndex: step,
        pitches,
        trackIds,
        hasOutOfScale,
      });
    }

    return data;
  }, [melodicTracks, maxStepCount, scale, anySoloed]);

  // Calculate pitch range for visualization
  const pitchRange = useMemo(() => {
    const allPitches = stepData.flatMap(d => d.pitches);
    if (allPitches.length === 0) return { min: -12, max: 12 };
    const min = Math.min(...allPitches);
    const max = Math.max(...allPitches);
    // Pad range a bit for visual breathing room
    return { min: Math.min(min - 2, -12), max: Math.max(max + 2, 12) };
  }, [stepData]);

  // Don't render if no melodic tracks
  if (melodicTracks.length === 0) {
    return null;
  }

  const rangeSpan = pitchRange.max - pitchRange.min || 24;

  return (
    <div className="pitch-overview">
      {/* Header - matches Mixer panel style */}
      <div className="pitch-overview-header">
        <h2 className="pitch-overview-title">Pitch Overview</h2>
        <span className="pitch-overview-info">
          {anySoloed
            ? `${visibleTrackCount} of ${melodicTracks.length} track${melodicTracks.length !== 1 ? 's' : ''} (solo)`
            : `${melodicTracks.length} track${melodicTracks.length !== 1 ? 's' : ''}`
          } • {maxStepCount} steps • {pitchToNoteName(pitchRange.min)} – {pitchToNoteName(pitchRange.max)}
        </span>
      </div>

      {/* Main visualization area */}
      <div className="pitch-overview-content">
        {/* Pitch range labels (vertical) */}
        <div className="pitch-overview-y-axis">
          <span className="range-label high">{pitchToNoteName(pitchRange.max)}</span>
          <span className="range-label low">{pitchToNoteName(pitchRange.min)}</span>
        </div>

        {/* Grid container */}
        <div className="pitch-overview-grid">
          {/* Pitch bars - vertical representation of pitch range per step */}
          <div className="pitch-overview-bars">
            {stepData.map((data, i) => {
              const isPageEnd = (i + 1) % STEPS_PER_PAGE === 0 && i < maxStepCount - 1;
              const isBeatStart = i % 4 === 0;

              return (
                <div
                  key={i}
                  className={`pitch-bar-cell ${isBeatStart ? 'beat-start' : ''} ${isPageEnd ? 'page-end' : ''} ${isStepPlaying(i, currentStep, maxStepCount, isPlaying) ? 'playing' : ''} ${data.hasOutOfScale ? 'out-of-scale' : ''}`}
                  title={data.pitches.length > 0
                    ? `Step ${i + 1}: ${data.pitches.map(p => pitchToNoteName(p)).join(', ')}`
                    : `Step ${i + 1}: no notes`
                  }
                >
                  {data.pitches.map((pitch, j) => {
                    // Position dot vertically based on pitch
                    const normalizedY = (pitchRange.max - pitch) / rangeSpan;
                    const top = Math.max(2, Math.min(98, normalizedY * 100));

                    return (
                      <div
                        key={j}
                        className={`pitch-dot ${data.hasOutOfScale && !isInScale(pitch, scale?.root as NoteName, scale?.scaleId as ScaleId) ? 'out-of-scale' : ''}`}
                        style={{ top: `${top}%` }}
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
