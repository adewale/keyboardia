/**
 * Phase 31H: Full Piano Roll View
 *
 * Industry-standard chromatic view with:
 * - Mini piano keyboard on left edge
 * - Absolute MIDI note names (C4, D4, E4...)
 * - Full chromatic range (typically 3-4 octaves)
 * - Click-to-place notes at pitch/step intersections
 * - Scale lock support (filter to in-scale notes)
 * - Instrument range highlighting
 *
 * @see specs/research/PITCH-VISUALIZATION-RESEARCH.md (Option 5)
 */
import { memo, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Track, ParameterLock, ScaleState } from '../types';
import { STEPS_PER_PAGE, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { previewInstrument, signalMusicIntent } from '../audio/audioTriggers';
import {
  isInScale,
  isRoot,
  isFifth,
  NOTE_NAMES,
  type NoteName,
  type ScaleId,
} from '../music/music-theory';
import {
  getInstrumentRange,
  isInRange,
  isInOptimalRange,
} from '../audio/instrument-ranges';
import './PianoRoll.css';

interface PianoRollProps {
  track: Track;
  currentStep: number;
  anySoloed: boolean;
  onSetParameterLock: (step: number, lock: ParameterLock | null) => void;
  onToggleStep?: (step: number) => void;
  scale?: ScaleState;
}

/**
 * Check if a MIDI note is a black key (sharp/flat)
 */
function isBlackKey(midiNote: number): boolean {
  const noteInOctave = midiNote % 12;
  // Black keys: C#, D#, F#, G#, A# (indices 1, 3, 6, 8, 10)
  return [1, 3, 6, 8, 10].includes(noteInOctave);
}

/**
 * Convert MIDI note to display name with octave
 */
function midiToNoteName(midiNote: number): string {
  const noteInOctave = ((midiNote % 12) + 12) % 12;
  const noteName = NOTE_NAMES[noteInOctave];
  const octave = Math.floor(midiNote / 12) - 1; // MIDI 60 = C4
  return `${noteName}${octave}`;
}

/**
 * Full Piano Roll View Component
 */
export const PianoRoll = memo(function PianoRoll({
  track,
  currentStep,
  anySoloed,
  onSetParameterLock,
  onToggleStep,
  scale,
}: PianoRollProps) {
  const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
  const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCenter = useRef(false);

  // Determine if track is audible (for playhead visibility)
  const isAudible = anySoloed ? track.soloed : !track.muted;
  const showPlayhead = !HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible;

  // Get instrument range for this track
  const instrumentRange = useMemo(() => {
    return getInstrumentRange(track.sampleId);
  }, [track.sampleId]);

  // Calculate MIDI range to display (centered on instrument's optimal range)
  // Show 3 octaves (36 notes) for a good balance
  const midiRange = useMemo(() => {
    const optimalCenter = Math.round(
      ((instrumentRange.optimalMin ?? instrumentRange.minMidi) +
       (instrumentRange.optimalMax ?? instrumentRange.maxMidi)) / 2
    );
    // 3 octaves = 36 semitones, show 18 above and below center
    const min = Math.max(21, optimalCenter - 18); // Don't go below A0 (21)
    const max = Math.min(108, optimalCenter + 17); // Don't go above C8 (108)
    return { min, max };
  }, [instrumentRange]);

  // Generate array of MIDI notes (high to low for display)
  const midiNotes = useMemo(() => {
    const notes: number[] = [];
    for (let midi = midiRange.max; midi >= midiRange.min; midi--) {
      notes.push(midi);
    }
    return notes;
  }, [midiRange]);

  // Filter to scale notes if scale lock is active
  const visibleNotes = useMemo(() => {
    if (!scale?.locked) {
      return midiNotes;
    }
    return midiNotes.filter(midi => {
      const pitch = midi - 60; // Convert to pitch offset
      return isInScale(pitch, scale.root as NoteName, scale.scaleId as ScaleId);
    });
  }, [midiNotes, scale]);

  // Get pitch value for each active step (MIDI note)
  const stepMidiNotes = useMemo(() => {
    const notes: (number | null)[] = [];
    const baseMidi = 60; // C4
    const transpose = track.transpose ?? 0;

    for (let i = 0; i < trackStepCount; i++) {
      if (track.steps[i]) {
        const pitchLock = track.parameterLocks[i]?.pitch ?? 0;
        notes.push(baseMidi + transpose + pitchLock);
      } else {
        notes.push(null);
      }
    }
    return notes;
  }, [track.steps, track.parameterLocks, track.transpose, trackStepCount]);

  // Auto-scroll to center on first render
  useEffect(() => {
    if (scrollContainerRef.current && !hasScrolledToCenter.current) {
      const container = scrollContainerRef.current;
      const scrollTarget = (container.scrollHeight - container.clientHeight) / 2;
      container.scrollTop = scrollTarget;
      hasScrolledToCenter.current = true;
    }
  }, [visibleNotes]);

  const handleCellClick = useCallback(async (stepIndex: number, midiNote: number) => {
    const baseMidi = 60;
    const transpose = track.transpose ?? 0;
    const pitch = midiNote - baseMidi - transpose;

    const isActive = track.steps[stepIndex];
    const currentPitch = track.parameterLocks[stepIndex]?.pitch ?? 0;
    const currentMidi = baseMidi + transpose + currentPitch;

    // Signal music intent (same as chromatic grid)
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
      // Step not active - activate it and set pitch
      if (onToggleStep) {
        onToggleStep(stepIndex);
        if (pitch !== 0) {
          onSetParameterLock(stepIndex, { pitch });
        }
        previewSound(pitch);
      }
      return;
    }

    if (currentMidi === midiNote) {
      // Clicking same note - toggle the step off
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

  // Determine key/note visual class
  const getNoteClass = useCallback((midiNote: number) => {
    const pitch = midiNote - 60;
    const classes: string[] = [];

    if (isBlackKey(midiNote)) {
      classes.push('black-key');
    } else {
      classes.push('white-key');
    }

    // Check if it's a C (octave marker)
    if (midiNote % 12 === 0) {
      classes.push('octave-c');
    }

    // Scale degree highlighting
    if (scale) {
      const root = scale.root as NoteName;
      if (isRoot(pitch, root)) {
        classes.push('root');
      } else if (isFifth(pitch, root)) {
        classes.push('fifth');
      }
    }

    // Range indicators
    if (!isInRange(midiNote, track.sampleId)) {
      classes.push('out-of-range');
    } else if (!isInOptimalRange(midiNote, track.sampleId)) {
      classes.push('suboptimal-range');
    }

    return classes.join(' ');
  }, [scale, track.sampleId]);

  return (
    <div className={`piano-roll ${scale?.locked ? 'scale-locked' : ''}`}>
      {/* Mini piano keyboard on left */}
      <div className="piano-keyboard">
        {visibleNotes.map(midiNote => (
          <div
            key={midiNote}
            className={`piano-key ${getNoteClass(midiNote)}`}
            title={midiToNoteName(midiNote)}
          >
            <span className="key-label">{midiToNoteName(midiNote)}</span>
          </div>
        ))}
      </div>

      {/* Grid of step cells */}
      <div className="piano-grid-scroll" ref={scrollContainerRef}>
        <div className="piano-grid">
          {visibleNotes.map(midiNote => {
            const noteClass = getNoteClass(midiNote);

            return (
              <div key={midiNote} className={`piano-row ${noteClass}`}>
                {Array.from({ length: trackStepCount }, (_, stepIndex) => {
                  const stepMidi = stepMidiNotes[stepIndex];
                  const isActive = stepMidi !== null;
                  const isNote = isActive && stepMidi === midiNote;
                  const isPlaying = showPlayhead && trackPlayingStep === stepIndex && isNote;
                  const isBeatStart = stepIndex % 4 === 0;
                  const isPageEnd = (stepIndex + 1) % STEPS_PER_PAGE === 0 && stepIndex < trackStepCount - 1;

                  return (
                    <button
                      key={stepIndex}
                      className={[
                        'piano-cell',
                        isActive && 'step-active',
                        isNote && 'note',
                        isPlaying && 'playing',
                        isBeatStart && 'beat-start',
                        isPageEnd && 'page-end',
                      ].filter(Boolean).join(' ')}
                      onClick={() => handleCellClick(stepIndex, midiNote)}
                      title={`Step ${stepIndex + 1}, ${midiToNoteName(midiNote)}${isNote ? ' (click to remove)' : ''}`}
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
