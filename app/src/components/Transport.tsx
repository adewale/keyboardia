import { useState, useCallback, useRef, useEffect } from 'react';
import './Transport.css';

interface TransportProps {
  isPlaying: boolean;
  tempo: number;
  swing: number;
  currentStep?: number;
  maxSteps?: number;
  onPlayPause: () => void;
  onTempoChange: (tempo: number) => void;
  onSwingChange: (swing: number) => void;
  onMuteAll?: () => void;
  onUnmuteAll?: () => void;
  onClearSolos?: () => void;
}

const DEFAULT_TEMPO = 120;
const DEFAULT_SWING = 0;

export function Transport({
  isPlaying,
  tempo,
  swing,
  currentStep = -1,
  maxSteps = 16,
  onPlayPause,
  onTempoChange,
  onSwingChange,
  onMuteAll,
  onUnmuteAll,
  onClearSolos
}: TransportProps) {
  // Tap tempo state
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Tempo change animation state
  const [tempoAnimating, setTempoAnimating] = useState(false);
  const prevTempoRef = useRef(tempo);

  // Trigger animation when tempo changes
  useEffect(() => {
    if (tempo !== prevTempoRef.current) {
      setTempoAnimating(true);
      const timer = setTimeout(() => setTempoAnimating(false), 200);
      prevTempoRef.current = tempo;
      return () => clearTimeout(timer);
    }
  }, [tempo]);

  // Tap tempo handler
  const handleTapTempo = useCallback(() => {
    const now = Date.now();

    // Clear old tap timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    // Reset if last tap was more than 2 seconds ago
    const recentTaps = tapTimes.filter(t => now - t < 2000);
    const newTaps = [...recentTaps, now].slice(-4); // Keep last 4 taps
    setTapTimes(newTaps);

    // Calculate BPM if we have at least 2 taps
    if (newTaps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < newTaps.length; i++) {
        intervals.push(newTaps[i] - newTaps[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avgInterval);
      // Clamp to valid range
      const clampedBpm = Math.max(60, Math.min(180, bpm));
      onTempoChange(clampedBpm);
    }

    // Clear taps after 2 seconds of inactivity
    tapTimeoutRef.current = setTimeout(() => setTapTimes([]), 2000);
  }, [tapTimes, onTempoChange]);

  // Double-click handlers to reset to defaults
  const handleTempoDoubleClick = useCallback(() => {
    onTempoChange(DEFAULT_TEMPO);
  }, [onTempoChange]);

  const handleSwingDoubleClick = useCallback(() => {
    onSwingChange(DEFAULT_SWING);
  }, [onSwingChange]);

  // Half time handler
  const handleHalfTime = useCallback(() => {
    const newTempo = Math.max(60, Math.round(tempo / 2));
    onTempoChange(newTempo);
  }, [tempo, onTempoChange]);

  // Double time handler
  const handleDoubleTime = useCallback(() => {
    const newTempo = Math.min(180, tempo * 2);
    onTempoChange(newTempo);
  }, [tempo, onTempoChange]);

  // Step position display (1-indexed)
  const stepDisplay = isPlaying && currentStep >= 0
    ? `${(currentStep % maxSteps) + 1}/${maxSteps}`
    : `—/${maxSteps}`;

  // Pattern length in bars (assuming 16 steps per bar)
  const patternBars = maxSteps / 16;
  const patternLengthDisplay = patternBars === 1 ? '1 bar' : `${patternBars} bars`;

  // Swing visual indicator - returns SVG transform for swing feel
  const swingRotation = (swing / 100) * 15; // Max 15 degree tilt

  // Calculate metronome pulse duration based on tempo
  const beatDuration = 60 / tempo; // seconds per beat

  return (
    <div className="transport">
      <button
        className={`play-button ${isPlaying ? 'playing' : ''}`}
        onClick={onPlayPause}
        data-testid="play-button"
        aria-label={isPlaying ? 'Stop' : 'Play'}
        style={isPlaying ? { '--beat-duration': `${beatDuration}s` } as React.CSSProperties : undefined}
      >
        {isPlaying ? '■' : '▶'}
      </button>

      {/* Step position indicator */}
      <span className="step-position" title="Current step / total steps">
        {stepDisplay}
        <span className="pattern-length">({patternLengthDisplay})</span>
      </span>

      <div className="tempo-control">
        <label htmlFor="tempo">BPM</label>
        <div className="slider-with-labels">
          <span className="slider-min">60</span>
          <input
            id="tempo"
            type="range"
            min="60"
            max="180"
            value={tempo}
            onChange={(e) => onTempoChange(Number(e.target.value))}
          />
          <span className="slider-max">180</span>
        </div>
        <span
          className={`tempo-value ${tempoAnimating ? 'animating' : ''}`}
          onDoubleClick={handleTempoDoubleClick}
          title="Double-click to reset to 120"
        >
          {tempo}
        </span>
      </div>

      {/* Tap tempo button */}
      <button
        className="tap-tempo-btn"
        onClick={handleTapTempo}
        title="Tap to set tempo"
      >
        TAP
      </button>

      {/* Half/Double time buttons */}
      <div className="tempo-multipliers">
        <button
          className="tempo-mult-btn"
          onClick={handleHalfTime}
          disabled={tempo <= 60}
          title="Half time"
        >
          ½×
        </button>
        <button
          className="tempo-mult-btn"
          onClick={handleDoubleTime}
          disabled={tempo >= 180}
          title="Double time"
        >
          2×
        </button>
      </div>

      <div className="swing-control">
        <label htmlFor="swing">
          Swing
          {/* Swing visual indicator - note icon that tilts */}
          <span
            className="swing-indicator"
            style={{ transform: `rotate(${swingRotation}deg)` }}
            title={`Swing: ${swing}%`}
          >
            ♪
          </span>
        </label>
        <input
          id="swing"
          type="range"
          min="0"
          max="100"
          value={swing}
          onChange={(e) => onSwingChange(Number(e.target.value))}
        />
        <span
          className="swing-value"
          onDoubleClick={handleSwingDoubleClick}
          title="Double-click to reset to 0%"
        >
          {swing}%
        </span>
      </div>

      {/* Mute All / Unmute All / Clear Solos buttons */}
      {(onMuteAll || onUnmuteAll || onClearSolos) && (
        <div className="transport-actions">
          {onMuteAll && (
            <button className="transport-action-btn" onClick={onMuteAll} title="Mute all tracks">
              Mute All
            </button>
          )}
          {onUnmuteAll && (
            <button className="transport-action-btn" onClick={onUnmuteAll} title="Unmute all tracks">
              Unmute All
            </button>
          )}
          {onClearSolos && (
            <button className="transport-action-btn" onClick={onClearSolos} title="Clear all solos">
              Clear Solos
            </button>
          )}
        </div>
      )}
    </div>
  );
}
