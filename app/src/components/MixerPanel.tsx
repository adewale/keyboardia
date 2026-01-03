import { memo, useCallback } from 'react';
import type { Track } from '../types';
import { getInstrumentCategory } from './sample-constants';
import './MixerPanel.css';

interface MixerPanelProps {
  tracks: Track[];
  anySoloed: boolean;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onSetVolume: (trackId: string, volume: number) => void;
  onSetSwing?: (trackId: string, swing: number) => void;
}

/**
 * Mixer Panel - Shows all track volumes side-by-side for focused mixing
 * See specs/PHASE-31-UI-ENHANCEMENTS.md section 31I
 */
export const MixerPanel = memo(function MixerPanel({
  tracks,
  anySoloed,
  onToggleMute,
  onToggleSolo,
  onSetVolume,
  onSetSwing,
}: MixerPanelProps) {
  return (
    <div className="mixer-panel">
      <div className="mixer-header">
        <h2 className="mixer-title">Mixer</h2>
      </div>

      <div className="mixer-tracks">
        {tracks.map((track) => (
          <MixerChannel
            key={track.id}
            track={track}
            anySoloed={anySoloed}
            onToggleMute={() => onToggleMute(track.id)}
            onToggleSolo={() => onToggleSolo(track.id)}
            onSetVolume={(volume) => onSetVolume(track.id, volume)}
            onSetSwing={onSetSwing ? (swing) => onSetSwing(track.id, swing) : undefined}
          />
        ))}
      </div>
    </div>
  );
});

interface MixerChannelProps {
  track: Track;
  anySoloed: boolean;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onSetVolume: (volume: number) => void;
  onSetSwing?: (swing: number) => void;
}

const MixerChannel = memo(function MixerChannel({
  track,
  anySoloed,
  onToggleMute,
  onToggleSolo,
  onSetVolume,
  onSetSwing,
}: MixerChannelProps) {
  const category = getInstrumentCategory(track.sampleId);
  const volume = track.volume ?? 1;
  const swing = track.swing ?? 0;
  const isMuted = track.muted;
  const isSoloed = track.soloed;
  const isAudible = anySoloed ? isSoloed : !isMuted;

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSetVolume(Number(e.target.value) / 100);
  }, [onSetVolume]);

  const handleSwingChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSetSwing?.(Number(e.target.value));
  }, [onSetSwing]);

  return (
    <div
      className={`mixer-channel ${!isAudible ? 'muted' : ''}`}
      data-category={category}
    >
      {/* Track name */}
      <div className="channel-name" title={track.name}>
        {track.name}
      </div>

      {/* Category color indicator */}
      <div className="channel-category-bar" />

      {/* Step count */}
      <div className="channel-steps">
        ({track.stepCount ?? 16})
      </div>

      {/* Mute/Solo buttons */}
      <div className="channel-buttons">
        <button
          className={`channel-btn mute ${isMuted ? 'active' : ''}`}
          onClick={onToggleMute}
          title="Mute track"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          M
        </button>
        <button
          className={`channel-btn solo ${isSoloed ? 'active' : ''}`}
          onClick={onToggleSolo}
          title="Solo track"
          aria-label={isSoloed ? 'Unsolo' : 'Solo'}
        >
          S
        </button>
      </div>

      {/* Volume fader (vertical) */}
      <div className="channel-fader-container">
        <div className="channel-fader-track">
          <div
            className="channel-fader-fill"
            style={{ height: `${volume * 100}%` }}
          />
        </div>
        <input
          type="range"
          className="channel-fader"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={handleVolumeChange}
          title={`Volume: ${Math.round(volume * 100)}%`}
          aria-label={`${track.name} volume`}
        />
      </div>

      {/* Volume percentage */}
      <div className="channel-volume-value">
        {Math.round(volume * 100)}%
      </div>

      {/* Per-track swing (if handler provided) */}
      {onSetSwing && (
        <div className="channel-swing">
          <label className="swing-label">Swing</label>
          <input
            type="range"
            className="swing-slider"
            min="0"
            max="100"
            value={swing}
            onChange={handleSwingChange}
            title={`Per-track swing: ${swing}%`}
          />
          <span className="swing-value">{swing}%</span>
        </div>
      )}
    </div>
  );
});
