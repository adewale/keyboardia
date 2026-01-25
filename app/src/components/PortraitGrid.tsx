/**
 * Portrait Grid Component
 *
 * Compact read-only grid for portrait consumption mode:
 * - Shows all tracks simultaneously with abbreviated labels (K, S, H...)
 * - Two grid sections (steps 1-8, 9-16) with automatic pagination
 * - Tap anywhere to play/pause
 * - Playhead glow effect at 60fps
 * - Cell pulse animation on trigger
 *
 * This component is designed for watching and listening,
 * not editing. All touch handlers are disabled.
 */

import { memo, useCallback, useState, useMemo, useEffect } from 'react';
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
  // Track which page (0 = steps 1-8, 1 = steps 9-16) is visible
  const [activePage, setActivePage] = useState(0);

  // Auto-scroll to follow playhead
  // Use functional update to avoid lint warning about setState in effect
  useEffect(() => {
    if (isPlaying && currentStep >= 0) {
      // Steps 0-7 on page 0, steps 8-15 on page 1
      const targetPage = Math.floor(currentStep / 8) % 2;
      setActivePage(prev => prev !== targetPage ? targetPage : prev);
    }
  }, [currentStep, isPlaying]);

  // Calculate which steps to show (8 steps per page)
  const stepsRange = useMemo(() => {
    const start = activePage * 8;
    return { start, end: start + 8 };
  }, [activePage]);

  // Handle tap to play/pause
  const handleGridTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Don't trigger on button clicks
    if ((e.target as HTMLElement).closest('button')) return;
    onPlayPause();
  }, [onPlayPause]);

  // Step numbers for header
  const stepNumbers = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => stepsRange.start + i + 1);
  }, [stepsRange.start]);

  return (
    <div
      className={`portrait-grid ${isPlaying ? 'playing' : ''}`}
      onClick={handleGridTap}
      role="button"
      tabIndex={0}
      aria-label={isPlaying ? 'Tap to pause' : 'Tap to play'}
    >
      {/* Step numbers header */}
      <div className="portrait-grid-header">
        <div className="portrait-grid-label-spacer" />
        {stepNumbers.map(num => (
          <div
            key={num}
            className={`portrait-step-number ${currentStep === num - 1 ? 'active' : ''}`}
          >
            {num}
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
              {Array.from({ length: 8 }, (_, i) => {
                const stepIndex = stepsRange.start + i;
                const isActive = stepIndex < trackStepCount && track.steps[stepIndex];
                const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;
                const isPlaying = isAudible && trackPlayingStep === stepIndex;
                const isBeatStart = stepIndex % 4 === 0;

                return (
                  <div
                    key={stepIndex}
                    className={`portrait-step-cell ${isActive ? 'active' : ''} ${isPlaying ? 'playing' : ''} ${isBeatStart ? 'beat-start' : ''}`}
                    data-step={stepIndex}
                  >
                    {isPlaying && <div className="portrait-playing-indicator" />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Page indicator dots */}
      <div className="portrait-page-indicator">
        <button
          className={`portrait-page-dot ${activePage === 0 ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setActivePage(0); }}
          aria-label="View steps 1-8"
        />
        <button
          className={`portrait-page-dot ${activePage === 1 ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setActivePage(1); }}
          aria-label="View steps 9-16"
        />
      </div>

      {/* Playhead glow effect - CSS-driven for 60fps */}
      {isPlaying && currentStep >= stepsRange.start && currentStep < stepsRange.end && (
        <div
          className="portrait-playhead-glow"
          style={{
            '--playhead-column': (currentStep - stepsRange.start + 1).toString()
          } as React.CSSProperties}
        />
      )}
    </div>
  );
});
