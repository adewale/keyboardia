import { memo, useCallback } from 'react';
import type { Track } from '../types';
import { DEFAULT_STEP_COUNT } from '../types';
import { formatPanNotation, normalizedPanToPercent, parsePanNotation } from '../shared/track-pan';
import { getInstrumentCategory, getInstrumentName } from './sample-constants';
import { TrackMeter } from './TrackMeter';
import './MixerPanel.css';

interface MixerPanelProps {
  tracks: Track[];
  anySoloed: boolean;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onSetVolume: (trackId: string, volume: number) => void;
  onSetPan: (trackId: string, pan: number) => void;
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
  onSetPan,
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
            onSetPan={(pan) => onSetPan(track.id, pan)}
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
  onSetPan: (pan: number) => void;
  onSetSwing?: (swing: number) => void;
}

const MixerChannel = memo(function MixerChannel({
  track,
  anySoloed,
  onToggleMute,
  onToggleSolo,
  onSetVolume,
  onSetPan,
  onSetSwing,
}: MixerChannelProps) {
  const category = getInstrumentCategory(track.sampleId);
  const volume = track.volume ?? 1;
  const swing = track.swing ?? 0;
  const pan = track.pan ?? 0;
  const panPercent = normalizedPanToPercent(pan);
  const isMuted = track.muted;
  const isSoloed = track.soloed;
  const isAudible = anySoloed ? isSoloed : !isMuted;

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSetVolume(Number(e.target.value) / 100);
  }, [onSetVolume]);

  const handleSwingChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSetSwing?.(Number(e.target.value));
  }, [onSetSwing]);

  const handlePanChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = parsePanNotation(`pan:${e.target.value}`);
    if (normalized !== null) onSetPan(normalized);
  }, [onSetPan]);

  return (
    <div
      className={`mixer-channel ${!isAudible ? 'muted' : ''}`}
      data-category={category}
    >
      {/* Track name */}
      <div
        className="channel-name"
        title={`${track.name}\nID: ${track.sampleId}${track.name !== getInstrumentName(track.sampleId) ? `\nInstrument: ${getInstrumentName(track.sampleId)}` : ''}`}
      >
        {track.name}
      </div>

      {/* Category color indicator */}
      <div className="channel-category-bar" />

      {/* Step count */}
      <div className="channel-steps">
        ({track.stepCount ?? DEFAULT_STEP_COUNT})
      </div>

      {/* Mute/Solo buttons */}
      <div className="channel-buttons">
        <button
          className={`channel-btn mute ${isMuted ? 'active' : ''}`}
          onClick={onToggleMute}
          title="Mute track"
          aria-label="Mute"
          aria-pressed={isMuted}
        >
          M
        </button>
        <button
          className={`channel-btn solo ${isSoloed ? 'active' : ''}`}
          onClick={onToggleSolo}
          title="Solo track"
          aria-label="Solo"
          aria-pressed={isSoloed}
        >
          S
        </button>
      </div>

      {/* VU Meter */}
      <TrackMeter trackId={track.id} />

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

      {/* Pan is normalized in state/engine and converted to percent only here. */}
      <div className="channel-pan">
        <label className="pan-label" htmlFor={`mixer-pan-${track.id}`}>Pan</label>
        <input
          id={`mixer-pan-${track.id}`}
          type="range"
          className="pan-slider"
          min="-100"
          max="100"
          step="1"
          value={panPercent}
          onChange={handlePanChange}
          title={`Pan: ${panPercent}% (${formatPanNotation(pan)})`}
          aria-label={`${track.name} pan`}
          aria-valuetext={`${panPercent}%`}
        />
        <span className="pan-value">{panPercent}%</span>
      </div>

      {/* Per-track swing (if handler provided) */}
      {onSetSwing && (
        <div className="channel-swing">
          <label className="swing-label" htmlFor={`mixer-swing-${track.id}`}>Swing</label>
          <input
            id={`mixer-swing-${track.id}`}
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
