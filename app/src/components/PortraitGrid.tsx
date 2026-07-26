/**
 * Portrait Grid Component
 *
 * Compact read-only grid for portrait consumption mode:
 * - Shows all tracks simultaneously with abbreviated labels (K, S, H...)
 * - Eight-step pages derived from the longest active pattern
 * - Tap anywhere to play/stop
 * - Playhead glow effect at 60fps
 * - Cell pulse animation on trigger
 *
 * This component is designed for watching and listening,
 * not editing. All touch handlers are disabled.
 */

import { memo, useState, useMemo } from 'react';
import type { Track } from '../types';
import { DEFAULT_STEP_COUNT } from '../types';
import './PortraitGrid.css';

interface PortraitGridProps {
  tracks: Track[];
  currentStep: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  anySoloed: boolean;
}

/**
 * Get abbreviated track label for portrait mode
 * Returns first letter or common abbreviations
 */
function getTrackAbbreviation(name: string, sampleId: string): string {
  const nameLower = name.toLowerCase();

  // Common drum abbreviations
  if (nameLower.includes('kick') || sampleId.includes('kick')) return 'K';
  if (nameLower.includes('snare') || sampleId.includes('snare')) return 'S';
  if (nameLower.includes('hat') || sampleId.includes('hat')) return 'H';
  if (nameLower.includes('clap') || sampleId.includes('clap')) return 'C';
  if (nameLower.includes('tom') || sampleId.includes('tom')) return 'T';
  if (nameLower.includes('perc') || sampleId.includes('perc')) return 'P';
  if (nameLower.includes('rim') || sampleId.includes('rim')) return 'R';

  // Synth types
  if (nameLower.includes('bass') || sampleId.includes('bass')) return 'B';
  if (nameLower.includes('lead') || sampleId.includes('lead')) return 'L';
  if (nameLower.includes('pad') || sampleId.includes('pad')) return 'P';
  if (nameLower.includes('keys') || sampleId.includes('keys')) return 'K';
  if (nameLower.includes('piano') || sampleId.includes('piano')) return '♪';

  // Default: first letter of name
  return name.charAt(0).toUpperCase();
}

export const PortraitGrid = memo(function PortraitGrid({
  tracks,
  currentStep,
  isPlaying,
  onPlayPause,
  anySoloed,
}: PortraitGridProps) {
  const [activePage, setActivePage] = useState(0);

  // Keep the original two-page experience for empty/legacy sessions, then
  // derive every additional page from the longest polymetric track.
  const maxStepCount = useMemo(
    () => Math.max(DEFAULT_STEP_COUNT, ...tracks.map(track => track.stepCount ?? DEFAULT_STEP_COUNT)),
    [tracks],
  );
  const pageCount = Math.ceil(maxStepCount / 8);
  const displayStep = isPlaying && currentStep >= 0
    ? currentStep % maxStepCount
    : -1;
  // Playback derives its visible page from the normalized pattern-local step.
  // Manual page selection remains stateful only while stopped.
  const visiblePage = displayStep >= 0
    ? Math.floor(displayStep / 8)
    : Math.min(activePage, pageCount - 1);

  // Keep eight layout columns, but represent nonexistent partial-page steps as
  // null so neither visible labels nor data attributes claim that they exist.
  const visibleSteps = useMemo(() => {
    const start = visiblePage * 8;
    return Array.from({ length: 8 }, (_, index) => {
      const step = start + index;
      return step < maxStepCount ? step : null;
    });
  }, [maxStepCount, visiblePage]);

  return (
    <div className={`portrait-grid ${isPlaying ? 'playing' : ''}`}>
      {/* The full-grid gesture is a real, exposed control. A pointer-focusable
        button must never be hidden from accessibility APIs; its visible focus
        ring outlines the same surface that responds to touch. */}
      <button
        type="button"
        className="portrait-grid-tap-layer"
        onClick={onPlayPause}
        aria-label={isPlaying ? 'Stop' : 'Play'}
      />

      {/* Step numbers header */}
      <div className="portrait-grid-header">
        <div className="portrait-grid-label-spacer" />
        {visibleSteps.map((stepIndex, column) => (
          <div
            key={column}
            className={`portrait-step-number ${displayStep === stepIndex ? 'active' : ''} ${stepIndex === null ? 'empty' : ''}`}
            aria-hidden={stepIndex === null ? 'true' : undefined}
          >
            {stepIndex === null ? '' : stepIndex + 1}
          </div>
        ))}
      </div>

      {/* Track rows */}
      <div className="portrait-grid-body">
        {tracks.map((track) => {
          // Determine if track is audible
          const isAudible = anySoloed ? track.soloed : !track.muted;
          const trackStepCount = track.stepCount ?? DEFAULT_STEP_COUNT;

          return (
            <div
              key={track.id}
              className={`portrait-track-row ${track.muted ? 'muted' : ''} ${track.soloed ? 'soloed' : ''}`}
            >
              {/* Track label */}
              <div className="portrait-track-label" title={track.name}>
                {getTrackAbbreviation(track.name, track.sampleId)}
              </div>

              {/* Step cells */}
              {visibleSteps.map((stepIndex, column) => {
                if (stepIndex === null) {
                  return <div key={column} className="portrait-step-cell empty" aria-hidden="true" />;
                }

                // While following the longest polymetric track, shorter rows
                // are already looping audibly. Render the local step that the
                // global column triggers instead of blanking the row once the
                // visible page exceeds that track's length.
                const trackStepIndex = isPlaying ? stepIndex % trackStepCount : stepIndex;
                const isActive = trackStepIndex < trackStepCount && track.steps[trackStepIndex];
                const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;
                const isTrackPlaying = isAudible && trackPlayingStep === trackStepIndex;
                const isBeatStart = trackStepIndex % 4 === 0;

                return (
                  <div
                    key={column}
                    className={`portrait-step-cell ${isActive ? 'active' : ''} ${isTrackPlaying ? 'playing' : ''} ${isBeatStart ? 'beat-start' : ''}`}
                    data-step={stepIndex}
                    data-track-step={trackStepIndex}
                  >
                    {isTrackPlaying && <div className="portrait-playing-indicator" />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Page indicator dots */}
      <div className="portrait-page-indicator">
        {Array.from({ length: pageCount }, (_, page) => {
          const start = page * 8 + 1;
          const end = Math.min(start + 7, maxStepCount);
          return (
            <button
              key={page}
              type="button"
              className={`portrait-page-dot ${visiblePage === page ? 'active' : ''}`}
              onClick={() => setActivePage(page)}
              disabled={isPlaying}
              aria-label={`View steps ${start}-${end}`}
              aria-pressed={visiblePage === page}
            />
          );
        })}
      </div>

      {/* Playhead glow effect - CSS-driven for 60fps */}
      {displayStep >= 0 && Math.floor(displayStep / 8) === visiblePage && (
        <div
          className="portrait-playhead-glow"
          style={{
            '--playhead-column': (displayStep - visiblePage * 8 + 1).toString()
          } as React.CSSProperties}
        />
      )}
    </div>
  );
});
