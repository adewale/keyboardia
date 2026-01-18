import { memo, useCallback, useMemo, useState } from 'react';
import type { Track, ParameterLock, ScaleState } from '../types';
import { STEPS_PER_PAGE, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { previewInstrument, signalMusicIntent } from '../audio/audioTriggers';
import { isInScale, isRoot, isFifth, isFourth, NOTE_NAMES as CHROMATIC_NOTES, type NoteName, type ScaleId } from '../music/music-theory';
import { isInRange, isInOptimalRange, getPitchShiftQuality, needsPitchShiftWarning } from '../audio/instrument-ranges';
import './ChromaticGrid.css';

interface ChromaticGridProps {
  track: Track;
  currentStep: number;
  anySoloed: boolean;
  onSetParameterLock: (step: number, lock: ParameterLock | null) => void;
  onToggleStep?: (step: number) => void; // Optional: allows adding notes directly in pitch view
  scale?: ScaleState; // Phase 29E: Scale state for Key Assistant
}

// View modes for chromatic grid display
type ViewMode = 'events' | 'all';

// Key intervals: octaves, fifths, fourths centered on root
const KEY_INTERVALS = [24, 19, 17, 12, 7, 5, 0, -5, -7, -12, -17, -19, -24];

// All 49 chromatic pitches from +24 to -24
const ALL_PITCHES = Array.from({ length: 49 }, (_, i) => 24 - i);

/**
 * Get the chromatic note name for a pitch offset
 * Dynamically calculates from the pitch value instead of hardcoding
 * @param pitch Semitone offset (can be negative)
 * @returns Note name with octave indicator (e.g., "C", "G+1", "D-1")
 */
function getPitchNoteName(pitch: number): string {
  const normalizedPitch = ((pitch % 12) + 12) % 12;
  const noteName = CHROMATIC_NOTES[normalizedPitch];
  const octave = Math.floor(pitch / 12);

  if (octave === 0) return noteName;
  if (octave > 0) return `${noteName}+${octave}`;
  return `${noteName}${octave}`; // Already negative
}

export const ChromaticGrid = memo(function ChromaticGrid({
  track,
  currentStep,
  anySoloed,
  onSetParameterLock,
  onToggleStep,
  scale,
}: ChromaticGridProps) {
  const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
  const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;

  // View mode state - 'events' is default per spec
  const [viewMode, setViewMode] = useState<ViewMode>('events');

  // Determine if track is audible (for playhead visibility)
  const isAudible = anySoloed ? track.soloed : !track.muted;
  const showPlayhead = !HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible;

  // Get pitches that have events (notes)
  const usedPitches = useMemo(() => {
    const pitches = new Set<number>();
    for (let i = 0; i < trackStepCount; i++) {
      if (track.steps[i]) {
        const pitch = track.parameterLocks[i]?.pitch;
        if (pitch !== undefined) {
          pitches.add(pitch);
        } else {
          pitches.add(0); // Steps without pitch locks are at pitch 0
        }
      }
    }
    return pitches;
  }, [track.steps, track.parameterLocks, trackStepCount]);

  // Calculate visible pitch rows based on view mode and scale lock
  // Implements the algorithm from CHROMATIC-GRID-REDESIGN.md
  const pitchRows = useMemo(() => {
    let rows: number[];

    switch (viewMode) {
      case 'events':
        // Key intervals + any pitches with notes (GUARDRAIL #1: never hide notes)
        rows = [...new Set([...KEY_INTERVALS, ...usedPitches])];
        rows.sort((a, b) => b - a);
        break;

      case 'all':
        rows = [...ALL_PITCHES];
        break;

      default:
        rows = [...KEY_INTERVALS];
    }

    // Apply scale lock filter
    if (scale?.locked) {
      const inScaleRows = rows.filter(p =>
        isInScale(p, scale.root as NoteName, scale.scaleId as ScaleId)
      );
      const usedOutOfScale = [...usedPitches].filter(p =>
        !isInScale(p, scale.root as NoteName, scale.scaleId as ScaleId)
      );

      // GUARDRAIL #1: Always show rows with events, even if out of scale
      rows = [...new Set([...inScaleRows, ...usedOutOfScale])];
      rows.sort((a, b) => b - a);

      // GUARDRAIL #2: If empty, show all in-scale pitches
      if (rows.length === 0) {
        rows = ALL_PITCHES.filter(p =>
          isInScale(p, scale.root as NoteName, scale.scaleId as ScaleId)
        );
      }
    }

    return rows;
  }, [viewMode, scale, usedPitches]);

  // Detect out-of-scale pitches for visual warning
  const outOfScalePitches = useMemo(() => {
    if (!scale?.locked) return new Set<number>();
    return new Set(
      [...usedPitches].filter(p =>
        !isInScale(p, scale.root as NoteName, scale.scaleId as ScaleId)
      )
    );
  }, [scale, usedPitches]);

  // Get pitch value for each active step
  const stepPitches = useMemo(() => {
    const pitches: (number | null)[] = [];
    for (let i = 0; i < trackStepCount; i++) {
      if (track.steps[i]) {
        pitches.push(track.parameterLocks[i]?.pitch ?? 0);
      } else {
        pitches.push(null);
      }
    }
    return pitches;
  }, [track.steps, track.parameterLocks, trackStepCount]);

  // Precompute pitch classes to avoid redundant calculations in render
  // Each pitch needs: pitchClass, rangeClass, pitchShiftClass, noteName
  const pitchData = useMemo(() => {
    const data = new Map<number, {
      pitchClass: string;
      rangeClass: string;
      pitchShiftClass: string;
      noteName: string;
    }>();

    for (const pitch of pitchRows) {
      // Pitch class (root, fifth, fourth, octave, chromatic, out-of-scale)
      const classes: string[] = [];
      const root = scale?.root as NoteName | undefined;

      if (root) {
        if (isRoot(pitch, root)) classes.push('root');
        else if (isFifth(pitch, root)) classes.push('fifth');
        else if (isFourth(pitch, root)) classes.push('fourth');
      } else {
        const normalizedPitch = ((pitch % 12) + 12) % 12;
        if (pitch === 0) classes.push('root');
        else if (normalizedPitch === 7) classes.push('fifth');
        else if (normalizedPitch === 5) classes.push('fourth');
      }

      if (Math.abs(pitch) === 12 || Math.abs(pitch) === 24) {
        classes.push('octave');
      }

      if (viewMode === 'all' && !KEY_INTERVALS.includes(pitch)) {
        classes.push('chromatic');
      }

      if (outOfScalePitches.has(pitch)) {
        classes.push('out-of-scale');
      }

      // Range class
      const baseMidi = 60;
      const transpose = track.transpose ?? 0;
      const midiNote = baseMidi + transpose + pitch;
      let rangeClass = '';
      if (!isInRange(midiNote, track.sampleId)) {
        rangeClass = 'out-of-range';
      } else if (!isInOptimalRange(midiNote, track.sampleId)) {
        rangeClass = 'suboptimal-range';
      }

      // Pitch shift class
      let pitchShiftClass = '';
      if (needsPitchShiftWarning(track.sampleId)) {
        const quality = getPitchShiftQuality(midiNote, track.sampleId);
        if (quality === 'fair') pitchShiftClass = 'pitch-shift-fair';
        else if (quality === 'poor') pitchShiftClass = 'pitch-shift-poor';
        else if (quality === 'bad') pitchShiftClass = 'pitch-shift-bad';
      }

      data.set(pitch, {
        pitchClass: classes.join(' '),
        rangeClass,
        pitchShiftClass,
        noteName: getPitchNoteName(pitch),
      });
    }

    return data;
  }, [pitchRows, scale, viewMode, outOfScalePitches, track.sampleId, track.transpose]);

  const handleCellClick = useCallback(async (stepIndex: number, pitch: number) => {
    const isActive = track.steps[stepIndex];
    const currentPitch = track.parameterLocks[stepIndex]?.pitch ?? 0;

    // Tier 2: Clicking on chromatic grid signals music intent
    signalMusicIntent('chromatic_click');

    // Preview sound helper - uses unified preview instrument function
    const previewSound = async (pitchValue: number) => {
      const totalPitch = (track.transpose ?? 0) + pitchValue;
      await previewInstrument('preview_pitch', {
        sampleId: track.sampleId,
        previewId: `preview-${track.id}`,
        pitch: totalPitch,
        duration: 0.15,
      });
    };

    if (!isActive) {
      // Step not active - activate it and set pitch in one action
      if (onToggleStep) {
        onToggleStep(stepIndex);
        // Set the pitch (will be applied after step is toggled on)
        if (pitch !== 0) {
          onSetParameterLock(stepIndex, { pitch });
        }
        previewSound(pitch);
      }
      return;
    }

    if (currentPitch === pitch) {
      // Clicking same pitch - toggle the step off (remove note)
      if (onToggleStep) {
        onToggleStep(stepIndex);
      }
    } else {
      // Set new pitch
      const currentLock = track.parameterLocks[stepIndex];
      onSetParameterLock(stepIndex, { ...currentLock, pitch: pitch === 0 ? undefined : pitch });
      previewSound(pitch);
    }
  }, [track, onSetParameterLock, onToggleStep]);

  return (
    <div className={`chromatic-grid ${scale?.locked ? 'scale-locked' : ''} view-mode-${viewMode}`}>
      {/* View Mode Segmented Control */}
      <div className="chromatic-grid-header">
        <div className="chromatic-view-mode-control">
          <button
            className={`chromatic-view-mode-control__button ${viewMode === 'events' ? 'chromatic-view-mode-control__button--active' : ''}`}
            onClick={() => setViewMode('events')}
            title="Show key intervals plus pitches with notes"
          >
            Events
          </button>
          <button
            className={`chromatic-view-mode-control__button ${viewMode === 'all' ? 'chromatic-view-mode-control__button--active' : ''}`}
            onClick={() => setViewMode('all')}
            title="Show all 49 chromatic pitches (-24 to +24)"
          >
            All
          </button>
        </div>
        {outOfScalePitches.size > 0 && (
          <span className="chromatic-out-of-scale-warning" title={`${outOfScalePitches.size} note${outOfScalePitches.size > 1 ? 's are' : ' is'} outside the selected scale`}>
            {outOfScalePitches.size} out of scale
          </span>
        )}
      </div>
      <div className="chromatic-grid-content">
        <div className="chromatic-pitch-labels">
          {pitchRows.map(pitch => {
            const data = pitchData.get(pitch)!;
            return (
              <div key={pitch} className={`pitch-label ${data.pitchClass} ${data.rangeClass}`}>
                <span className="pitch-note">{data.noteName}</span>
                <span className="pitch-value">{pitch > 0 ? `+${pitch}` : pitch}</span>
              </div>
            );
          })}
        </div>
        <div className="chromatic-steps">
          {pitchRows.map(pitch => {
            const data = pitchData.get(pitch)!;
            return (
              <div key={pitch} className={`chromatic-row ${data.pitchClass} ${data.rangeClass} ${data.pitchShiftClass}`}>
                {Array.from({ length: trackStepCount }, (_, stepIndex) => {
                  const stepPitch = stepPitches[stepIndex];
                  const isActive = stepPitch !== null;
                  const isNote = isActive && stepPitch === pitch;
                  const isPlaying = showPlayhead && trackPlayingStep === stepIndex && isNote;
                  const isPageEnd = (stepIndex + 1) % STEPS_PER_PAGE === 0 && stepIndex < trackStepCount - 1;

                  return (
                    <button
                      key={stepIndex}
                      className={[
                        'chromatic-cell',
                        isActive && 'step-active',
                        isNote && 'note',
                        isPlaying && 'playing',
                        isPageEnd && 'page-end',
                        isNote && data.pitchShiftClass,
                      ].filter(Boolean).join(' ')}
                      onClick={() => handleCellClick(stepIndex, pitch)}
                      title={`Step ${stepIndex + 1}, ${data.noteName}${isNote ? ' (click to remove)' : ''}`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/**
 * Pitch contour visualization for collapsed view
 * Shows a mini line graph of pitch values across steps
 */
interface PitchContourProps {
  track: Track;
  currentStep: number;
  anySoloed: boolean;
}

export const PitchContour = memo(function PitchContour({ track, currentStep, anySoloed }: PitchContourProps) {
  const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
  const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;

  // Determine if track is audible (for playhead visibility)
  const isAudible = anySoloed ? track.soloed : !track.muted;
  const showPlayhead = !HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible;

  // Check if any steps have pitch locks
  const hasPitchVariation = useMemo(() => {
    for (let i = 0; i < trackStepCount; i++) {
      if (track.steps[i] && track.parameterLocks[i]?.pitch) {
        return true;
      }
    }
    return false;
  }, [track.steps, track.parameterLocks, trackStepCount]);

  if (!hasPitchVariation) {
    return null;
  }

  // Build SVG path for pitch contour
  // Include both active steps AND tied steps (which sustain the previous pitch)
  const points: { x: number; y: number; stepIndex: number }[] = [];
  const cellWidth = 39; // Actual step cell width (36px) + gap (3px)
  const height = 20;
  const midY = height / 2;

  let lastPitch = 0; // Track pitch for tied notes (they sustain previous pitch)
  for (let i = 0; i < trackStepCount; i++) {
    const isActive = track.steps[i];
    const isTied = track.parameterLocks[i]?.tie === true;

    if (isActive || isTied) {
      // Active steps use their pitch (or 0 if none), tied steps carry forward lastPitch
      const pitch = isActive ? (track.parameterLocks[i]?.pitch ?? 0) : lastPitch;
      lastPitch = pitch; // Update for next tied note
      // Map pitch (-24 to +24) to y (height to 0)
      const y = midY - (pitch / 24) * (height / 2 - 2);
      points.push({ x: i * cellWidth + cellWidth / 2, y, stepIndex: i });
    }
  }

  if (points.length < 2) {
    return null;
  }

  // Create SVG path - break at TRUE silence gaps (non-consecutive step indices)
  const pathD = points
    .map((p, i) => {
      // Start new segment if this is the first point OR if there's a gap
      const isNewSegment = i === 0 || p.stepIndex !== points[i - 1].stepIndex + 1;
      return `${isNewSegment ? 'M' : 'L'} ${p.x} ${p.y}`;
    })
    .join(' ');

  const width = trackStepCount * cellWidth;

  return (
    <svg className="pitch-contour" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={pathD} className="contour-line" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={3}
          className={`contour-dot ${showPlayhead && trackPlayingStep === p.stepIndex ? 'playing' : ''}`}
        />
      ))}
    </svg>
  );
});
