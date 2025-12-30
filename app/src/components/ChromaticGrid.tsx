import { memo, useCallback, useMemo } from 'react';
import type { Track, ParameterLock, ScaleState } from '../types';
import { STEPS_PER_PAGE, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { tryGetEngineForPreview, signalMusicIntent } from '../audio/audioTriggers';
import { isInScale, isRoot, isFifth, type NoteName, type ScaleId } from '../music/music-theory';
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

    // Preview sound helper - triggers initialization if needed
    const previewSound = async (pitchValue: number) => {
      const audioEngine = await tryGetEngineForPreview('preview_pitch');
      if (!audioEngine) return;

      const totalPitch = (track.transpose ?? 0) + pitchValue;
      const sampleId = track.sampleId;

      if (sampleId.startsWith('synth:')) {
        const preset = sampleId.replace('synth:', '');
        audioEngine.playSynthNote(`preview-${track.id}`, preset, totalPitch, audioEngine.getCurrentTime(), 0.15);
      } else if (sampleId.startsWith('tone:')) {
        // Ensure Tone.js is initialized for tone: instruments
        if (!audioEngine.isToneInitialized()) {
          await audioEngine.initializeTone();
        }
        if (audioEngine.isToneSynthReady('tone')) {
          const preset = sampleId.replace('tone:', '') as Parameters<typeof audioEngine.playToneSynth>[0];
          audioEngine.playToneSynth(preset, totalPitch, audioEngine.getCurrentTime(), 0.15);
        }
      } else if (sampleId.startsWith('advanced:')) {
        // Ensure Tone.js is initialized for advanced: instruments (Fat Saw, Thick, etc.)
        if (!audioEngine.isToneInitialized()) {
          await audioEngine.initializeTone();
        }
        if (audioEngine.isToneSynthReady('advanced')) {
          const preset = sampleId.replace('advanced:', '');
          audioEngine.playAdvancedSynth(preset, totalPitch, audioEngine.getCurrentTime(), 0.15);
        }
      } else if (sampleId.startsWith('sampled:')) {
        const instrument = sampleId.replace('sampled:', '');
        // Trigger loading if not ready
        if (!audioEngine.isSampledInstrumentReady(instrument)) {
          await audioEngine.loadSampledInstrument(instrument);
        }
        if (audioEngine.isSampledInstrumentReady(instrument)) {
          const noteId = `preview-${track.id}-${Date.now()}`;
          const midiNote = 60 + totalPitch;
          audioEngine.playSampledInstrument(instrument, noteId, midiNote, audioEngine.getCurrentTime(), 0.15);
        }
      } else {
        // Regular sample
        audioEngine.playSample(sampleId, `preview-${track.id}`, audioEngine.getCurrentTime(), undefined, 'oneshot', totalPitch);
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

  // Determine if a pitch is root or fifth (for visual emphasis)
  const getPitchClass = useCallback((pitch: number) => {
    if (!scale) return pitch === 0 ? 'root' : '';
    const root = scale.root as NoteName;
    if (isRoot(pitch, root)) return 'root';
    if (isFifth(pitch, root)) return 'fifth';
    return '';
  }, [scale]);

  return (
    <div className={`chromatic-grid ${scale?.locked ? 'scale-locked' : ''}`}>
      <div className="chromatic-pitch-labels">
        {pitchRows.map(pitch => (
          <div key={pitch} className={`pitch-label ${getPitchClass(pitch)}`}>
            <span className="pitch-note">{NOTE_NAMES[pitch] ?? pitch}</span>
            <span className="pitch-value">{pitch > 0 ? `+${pitch}` : pitch}</span>
          </div>
        ))}
      </div>
      <div className="chromatic-steps">
        {pitchRows.map(pitch => (
          <div key={pitch} className={`chromatic-row ${getPitchClass(pitch)}`}>
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
