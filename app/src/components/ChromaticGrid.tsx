import { memo, useCallback, useMemo } from 'react';
import type { Track, ParameterLock } from '../types';
import { STEPS_PER_PAGE, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { tryGetEngineForPreview, signalMusicIntent } from '../audio/audioTriggers';
import './ChromaticGrid.css';

interface ChromaticGridProps {
  track: Track;
  currentStep: number;
  anySoloed: boolean;
  onSetParameterLock: (step: number, lock: ParameterLock | null) => void;
  onToggleStep?: (step: number) => void; // Optional: allows adding notes directly in pitch view
}

// Pitch rows from +24 to -24 (4 octaves centered on root)
// Shows key intervals: octaves, fifths, and roots
const PITCH_ROWS = [24, 19, 17, 12, 7, 5, 0, -5, -7, -12, -17, -19, -24];

// Note names relative to C (showing musical intervals)
const NOTE_NAMES: Record<number, string> = {
  24: 'C+2',   // 2 octaves up
  19: 'G+1',   // Fifth + octave
  17: 'F+1',   // Fourth + octave
  12: 'C+1',   // 1 octave up
  7: 'G',      // Fifth
  5: 'F',      // Fourth
  0: 'C',      // Root
  [-5]: 'F-',  // Fourth down
  [-7]: 'G-',  // Fifth down
  [-12]: 'C-1', // 1 octave down
  [-17]: 'F-1', // Fourth - octave
  [-19]: 'G-1', // Fifth - octave
  [-24]: 'C-2', // 2 octaves down
};

export const ChromaticGrid = memo(function ChromaticGrid({
  track,
  currentStep,
  anySoloed,
  onSetParameterLock,
  onToggleStep,
}: ChromaticGridProps) {
  const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
  const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;

  // Determine if track is audible (for playhead visibility)
  const isAudible = anySoloed ? track.soloed : !track.muted;
  const showPlayhead = !HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible;

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

    // Preview sound helper - only if audio is already loaded
    const previewSound = async (pitchValue: number) => {
      const audioEngine = await tryGetEngineForPreview('preview_pitch');
      if (!audioEngine) return;

      const time = audioEngine.getCurrentTime();
      const totalPitch = (track.transpose ?? 0) + pitchValue;
      if (track.sampleId.startsWith('synth:')) {
        const preset = track.sampleId.replace('synth:', '');
        audioEngine.playSynthNote(`preview-${track.id}`, preset, totalPitch, time, 0.15);
      } else {
        audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, undefined, 'oneshot', totalPitch);
      }
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
    <div className="chromatic-grid">
      <div className="chromatic-pitch-labels">
        {PITCH_ROWS.map(pitch => (
          <div key={pitch} className={`pitch-label ${pitch === 0 ? 'root' : ''}`}>
            <span className="pitch-note">{NOTE_NAMES[pitch] ?? pitch}</span>
            <span className="pitch-value">{pitch > 0 ? `+${pitch}` : pitch}</span>
          </div>
        ))}
      </div>
      <div className="chromatic-steps">
        {PITCH_ROWS.map(pitch => (
          <div key={pitch} className={`chromatic-row ${pitch === 0 ? 'root' : ''}`}>
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
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleCellClick(stepIndex, pitch)}
                  title={`Step ${stepIndex + 1}, ${NOTE_NAMES[pitch] ?? pitch}${isNote ? ' (click to remove)' : ''}`}
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
  const points: { x: number; y: number; active: boolean }[] = [];
  const cellWidth = 27; // Approximate step cell width + gap
  const height = 20;
  const midY = height / 2;

  for (let i = 0; i < trackStepCount; i++) {
    if (track.steps[i]) {
      const pitch = track.parameterLocks[i]?.pitch ?? 0;
      // Map pitch (-24 to +24) to y (height to 0)
      const y = midY - (pitch / 24) * (height / 2 - 2);
      points.push({ x: i * cellWidth + cellWidth / 2, y, active: true });
    }
  }

  if (points.length < 2) {
    return null;
  }

  // Create SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
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
          className={`contour-dot ${showPlayhead && trackPlayingStep === i ? 'playing' : ''}`}
        />
      ))}
    </svg>
  );
});
