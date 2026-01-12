import { memo, useCallback, useMemo } from 'react';
import type { Track, ParameterLock, ScaleState } from '../types';
import { STEPS_PER_PAGE, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { previewInstrument, signalMusicIntent } from '../audio/audioTriggers';
import { isInScale, isRoot, isFifth, NOTE_NAMES as CHROMATIC_NOTES, type NoteName, type ScaleId } from '../music/music-theory';
import { isInRange, isInOptimalRange, getPitchShiftQuality, needsPitchShiftWarning, type PitchShiftQuality } from '../audio/instrument-ranges';
import './ChromaticGrid.css';

interface ChromaticGridProps {
  track: Track;
  currentStep: number;
  anySoloed: boolean;
  onSetParameterLock: (step: number, lock: ParameterLock | null) => void;
  onToggleStep?: (step: number) => void; // Optional: allows adding notes directly in pitch view
  scale?: ScaleState; // Phase 29E: Scale state for Key Assistant
}

// Pitch rows from +24 to -24 (4 octaves centered on root)
// Shows key intervals: octaves, fifths, and roots
const ALL_PITCH_ROWS = [24, 19, 17, 12, 7, 5, 0, -5, -7, -12, -17, -19, -24];

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

  // Determine if track is audible (for playhead visibility)
  const isAudible = anySoloed ? track.soloed : !track.muted;
  const showPlayhead = !HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible;

  // Phase 29E: Filter pitch rows based on scale lock
  const pitchRows = useMemo(() => {
    if (!scale?.locked) {
      return ALL_PITCH_ROWS;
    }
    // When scale lock is on, only show in-scale notes
    return ALL_PITCH_ROWS.filter(pitch =>
      isInScale(pitch, scale.root as NoteName, scale.scaleId as ScaleId)
    );
  }, [scale]);

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

  // Determine if a pitch is root or fifth (for visual emphasis)
  const getPitchClass = useCallback((pitch: number) => {
    if (!scale) return pitch === 0 ? 'root' : '';
    const root = scale.root as NoteName;
    if (isRoot(pitch, root)) return 'root';
    if (isFifth(pitch, root)) return 'fifth';
    return '';
  }, [scale]);

  // Check if a pitch is within instrument range (for range warnings)
  const getRangeClass = useCallback((pitch: number) => {
    const baseMidi = 60; // C4
    const transpose = track.transpose ?? 0;
    const midiNote = baseMidi + transpose + pitch;

    if (!isInRange(midiNote, track.sampleId)) {
      return 'out-of-range';
    }
    if (!isInOptimalRange(midiNote, track.sampleId)) {
      return 'suboptimal-range';
    }
    return '';
  }, [track.sampleId, track.transpose]);

  // Check pitch-shift quality for sampled instruments
  const getPitchShiftClass = useCallback((pitch: number): string => {
    // Only show for sampled instruments that have sparse coverage
    if (!needsPitchShiftWarning(track.sampleId)) {
      return '';
    }

    const baseMidi = 60; // C4
    const transpose = track.transpose ?? 0;
    const midiNote = baseMidi + transpose + pitch;
    const quality = getPitchShiftQuality(midiNote, track.sampleId);

    // Only show warning classes for fair, poor, or bad quality
    if (quality === 'fair') return 'pitch-shift-fair';
    if (quality === 'poor') return 'pitch-shift-poor';
    if (quality === 'bad') return 'pitch-shift-bad';
    return '';
  }, [track.sampleId, track.transpose]);

  return (
    <div className={`chromatic-grid ${scale?.locked ? 'scale-locked' : ''}`}>
      <div className="chromatic-pitch-labels">
        {pitchRows.map(pitch => (
          <div key={pitch} className={`pitch-label ${getPitchClass(pitch)} ${getRangeClass(pitch)}`}>
            <span className="pitch-note">{getPitchNoteName(pitch)}</span>
            <span className="pitch-value">{pitch > 0 ? `+${pitch}` : pitch}</span>
          </div>
        ))}
      </div>
      <div className="chromatic-steps">
        {pitchRows.map(pitch => (
          <div key={pitch} className={`chromatic-row ${getPitchClass(pitch)} ${getRangeClass(pitch)} ${getPitchShiftClass(pitch)}`}>
            {Array.from({ length: trackStepCount }, (_, stepIndex) => {
              const stepPitch = stepPitches[stepIndex];
              const isActive = stepPitch !== null;
              const isNote = isActive && stepPitch === pitch;
              const isPlaying = showPlayhead && trackPlayingStep === stepIndex && isNote;
              const isPageEnd = (stepIndex + 1) % STEPS_PER_PAGE === 0 && stepIndex < trackStepCount - 1;
              const pitchShiftClass = isNote ? getPitchShiftClass(pitch) : '';

              return (
                <button
                  key={stepIndex}
                  className={[
                    'chromatic-cell',
                    isActive && 'step-active',
                    isNote && 'note',
                    isPlaying && 'playing',
                    isPageEnd && 'page-end',
                    pitchShiftClass,
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleCellClick(stepIndex, pitch)}
                  title={`Step ${stepIndex + 1}, ${getPitchNoteName(pitch)}${isNote ? ' (click to remove)' : ''}`}
                />
              );
            })}
          </div>
        ))}
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
