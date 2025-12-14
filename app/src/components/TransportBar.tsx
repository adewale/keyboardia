import { useCallback, useRef, useState } from 'react';
import { audioEngine } from '../audio/engine';
import './TransportBar.css';

interface TransportBarProps {
  isPlaying: boolean;
  tempo: number;
  swing: number;
  onPlayPause: () => void;
  onTempoChange: (tempo: number) => void;
  onSwingChange: (swing: number) => void;
}

/**
 * TransportBar - Mobile-optimized playback controls
 *
 * LESSON FOR DESKTOP: Drag-to-adjust values (like Teenage Engineering knobs)
 * are more intuitive than +/- buttons. Less precise but faster.
 * Consider backporting this interaction pattern.
 */
export function TransportBar({
  isPlaying,
  tempo,
  swing,
  onPlayPause,
  onTempoChange,
  onSwingChange,
}: TransportBarProps) {
  const tempoRef = useRef<HTMLDivElement>(null);
  const swingRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ value: number; y: number } | null>(null);

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

  // Drag handler for tempo/swing values
  const handleDragStart = useCallback((
    e: React.TouchEvent | React.MouseEvent,
    currentValue: number,
    _type: 'tempo' | 'swing'
  ) => {
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { value: currentValue, y };
  }, []);

  const handleDragMove = useCallback((
    e: React.TouchEvent | React.MouseEvent,
    type: 'tempo' | 'swing',
    min: number,
    max: number,
    onChange: (value: number) => void
  ) => {
    if (!dragStartRef.current) return;

    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const delta = dragStartRef.current.y - y; // Drag up = increase
    const sensitivity = type === 'tempo' ? 0.5 : 0.3;
    const newValue = Math.round(
      Math.min(max, Math.max(min, dragStartRef.current.value + delta * sensitivity))
    );
    onChange(newValue);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  return (
    <div className="transport-bar">
      {/* Play/Pause button */}
      <button
        className={`transport-play ${isPlaying ? 'playing' : ''}`}
        onClick={onPlayPause}
        aria-label={isPlaying ? 'Stop' : 'Play'}
      >
        {isPlaying ? '■' : '▶'}
      </button>

      {/* Tempo - drag to adjust */}
      <div
        className="transport-value"
        ref={tempoRef}
        onTouchStart={(e) => handleDragStart(e, tempo, 'tempo')}
        onTouchMove={(e) => handleDragMove(e, 'tempo', 60, 180, onTempoChange)}
        onTouchEnd={handleDragEnd}
        onMouseDown={(e) => handleDragStart(e, tempo, 'tempo')}
        onMouseMove={(e) => e.buttons === 1 && handleDragMove(e, 'tempo', 60, 180, onTempoChange)}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        title="Drag up/down to adjust tempo"
      >
        <span className="transport-label">BPM</span>
        <span className="transport-number">{tempo}</span>
      </div>

      {/* Swing - drag to adjust */}
      <div
        className="transport-value"
        ref={swingRef}
        onTouchStart={(e) => handleDragStart(e, swing, 'swing')}
        onTouchMove={(e) => handleDragMove(e, 'swing', 0, 100, onSwingChange)}
        onTouchEnd={handleDragEnd}
        onMouseDown={(e) => handleDragStart(e, swing, 'swing')}
        onMouseMove={(e) => e.buttons === 1 && handleDragMove(e, 'swing', 0, 100, onSwingChange)}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        title="Drag up/down to adjust swing"
      >
        <span className="transport-label">Swing</span>
        <span className="transport-number">{swing}%</span>
      </div>

      {/* Effects toggles (Phase 19) */}
      <div className="transport-effects">
        <button
          className={`transport-effect-btn ${reverbEnabled ? 'active' : ''}`}
          onClick={toggleReverb}
          title="Toggle reverb effect"
        >
          Reverb
        </button>
        <button
          className={`transport-effect-btn ${delayEnabled ? 'active' : ''}`}
          onClick={toggleDelay}
          title="Toggle delay effect"
        >
          Delay
        </button>
      </div>
    </div>
  );
}
