import { memo } from 'react';
import { useTrackMeter } from '../audio/useTrackMeter';
import './TrackMeter.css';

interface TrackMeterProps {
  trackId: string;
}

/**
 * Vertical VU meter bar for a single track.
 * Displays RMS level with peak hold and clipping indicator.
 */
export const TrackMeter = memo(function TrackMeter({ trackId }: TrackMeterProps) {
  const level = useTrackMeter(trackId);

  if (!level) {
    return <div className="track-meter track-meter--inactive" />;
  }

  // Convert RMS (0-1) to a percentage for the bar height
  // Apply a slight curve for better visual response
  const rmsPercent = Math.min(100, Math.round(Math.sqrt(level.rms) * 100));
  const peakPercent = Math.min(100, Math.round(Math.sqrt(level.peak) * 100));

  return (
    <div
      className={`track-meter ${level.clipping ? 'track-meter--clipping' : ''}`}
      title={`RMS: ${Math.round(level.rms * 100)}% Peak: ${Math.round(level.peak * 100)}%`}
    >
      <div className="track-meter__bar" style={{ height: `${rmsPercent}%` }} />
      <div className="track-meter__peak" style={{ bottom: `${peakPercent}%` }} />
    </div>
  );
});
