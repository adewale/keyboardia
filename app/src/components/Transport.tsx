import { useState, useCallback } from 'react';
import { audioEngine } from '../audio/engine';
import './Transport.css';

interface TransportProps {
  isPlaying: boolean;
  tempo: number;
  swing: number;
  onPlayPause: () => void;
  onTempoChange: (tempo: number) => void;
  onSwingChange: (swing: number) => void;
}

export function Transport({ isPlaying, tempo, swing, onPlayPause, onTempoChange, onSwingChange }: TransportProps) {
  // Effects state (Phase 19)
  const [reverbEnabled, setReverbEnabled] = useState(false);
  const [delayEnabled, setDelayEnabled] = useState(false);

  const toggleReverb = useCallback(async () => {
    if (!audioEngine.isInitialized()) {
      await audioEngine.initialize();
    }
    if (reverbEnabled) {
      audioEngine.disableReverb();
      setReverbEnabled(false);
    } else {
      audioEngine.enableReverb('room');
      setReverbEnabled(true);
    }
  }, [reverbEnabled]);

  const toggleDelay = useCallback(async () => {
    if (!audioEngine.isInitialized()) {
      await audioEngine.initialize();
    }
    if (delayEnabled) {
      audioEngine.disableDelay();
      setDelayEnabled(false);
    } else {
      audioEngine.enableDelay('dotted');
      setDelayEnabled(true);
    }
  }, [delayEnabled]);

  return (
    <div className="transport">
      <button
        className={`play-button ${isPlaying ? 'playing' : ''}`}
        onClick={onPlayPause}
        data-testid="play-button"
        aria-label={isPlaying ? 'Stop' : 'Play'}
      >
        {isPlaying ? '■' : '▶'}
      </button>

      <div className="tempo-control">
        <label htmlFor="tempo">BPM</label>
        <input
          id="tempo"
          type="range"
          min="60"
          max="180"
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value))}
        />
        <span className="tempo-value">{tempo}</span>
      </div>

      <div className="swing-control">
        <label htmlFor="swing">Swing</label>
        <input
          id="swing"
          type="range"
          min="0"
          max="100"
          value={swing}
          onChange={(e) => onSwingChange(Number(e.target.value))}
        />
        <span className="swing-value">{swing}%</span>
      </div>

      {/* Effects toggles (Phase 19) */}
      <div className="effects-control">
        <button
          className={`effect-btn ${reverbEnabled ? 'active' : ''}`}
          onClick={toggleReverb}
          title="Toggle reverb effect"
        >
          Reverb
        </button>
        <button
          className={`effect-btn ${delayEnabled ? 'active' : ''}`}
          onClick={toggleDelay}
          title="Toggle delay effect"
        >
          Delay
        </button>
      </div>
    </div>
  );
}
