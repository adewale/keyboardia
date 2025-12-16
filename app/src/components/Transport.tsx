import { useState, useCallback, useEffect } from 'react';
import type { EffectsState } from '../audio/toneEffects';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
import { DELAY_TIME_OPTIONS } from '../audio/delay-constants';
import { audioEngine } from '../audio/engine';
import './Transport.css';

interface TransportProps {
  isPlaying: boolean;
  tempo: number;
  swing: number;
  onPlayPause: () => void;
  onTempoChange: (tempo: number) => void;
  onSwingChange: (swing: number) => void;
  // Effects props for integrated FX panel
  effectsState?: EffectsState;
  onEffectsChange?: (effects: EffectsState) => void;
  effectsDisabled?: boolean;
}

export function Transport({
  isPlaying,
  tempo,
  swing,
  onPlayPause,
  onTempoChange,
  onSwingChange,
  effectsState,
  onEffectsChange,
  effectsDisabled = false,
}: TransportProps) {
  const [fxExpanded, setFxExpanded] = useState(false);
  const [effects, setEffects] = useState<EffectsState>(
    effectsState ?? { ...DEFAULT_EFFECTS_STATE }
  );

  // Sync with external state changes (e.g., multiplayer sync, session load)
  // Phase 22: Also apply to audio engine when receiving remote effects
  useEffect(() => {
    if (effectsState) {
      setEffects(effectsState);
      // Apply to audio engine if Tone.js is initialized
      if (audioEngine.isToneInitialized()) {
        audioEngine.applyEffectsState(effectsState);
      }
    }
  }, [effectsState]);

  // Check if any effects are active
  const hasActiveEffects =
    effects.reverb.wet > 0 ||
    effects.delay.wet > 0 ||
    effects.chorus.wet > 0 ||
    effects.distortion.wet > 0;

  // Apply effect to audio engine
  const applyEffectToEngine = useCallback((
    effectName: keyof EffectsState,
    param: string | number | symbol,
    value: number | string
  ) => {
    const paramName = String(param);
    switch (effectName) {
      case 'reverb':
        if (paramName === 'wet') audioEngine.setReverbWet(value as number);
        if (paramName === 'decay') audioEngine.setReverbDecay(value as number);
        break;
      case 'delay':
        if (paramName === 'wet') audioEngine.setDelayWet(value as number);
        if (paramName === 'time') audioEngine.setDelayTime(value as string);
        if (paramName === 'feedback') audioEngine.setDelayFeedback(value as number);
        break;
      case 'chorus':
        if (paramName === 'wet') audioEngine.setChorusWet(value as number);
        if (paramName === 'frequency') audioEngine.setChorusFrequency(value as number);
        if (paramName === 'depth') audioEngine.setChorusDepth(value as number);
        break;
      case 'distortion':
        if (paramName === 'wet') audioEngine.setDistortionWet(value as number);
        if (paramName === 'amount') audioEngine.setDistortionAmount(value as number);
        break;
    }
  }, []);

  // Update a single effect parameter
  const updateEffect = useCallback(<K extends keyof EffectsState>(
    effectName: K,
    param: keyof EffectsState[K],
    value: number | string
  ) => {
    setEffects(prev => {
      const newEffects = {
        ...prev,
        [effectName]: {
          ...prev[effectName],
          [param]: value,
        },
      };

      // Apply to audio engine
      applyEffectToEngine(effectName, param, value);

      // Notify parent
      onEffectsChange?.(newEffects);

      return newEffects;
    });
  }, [onEffectsChange, applyEffectToEngine]);

  return (
    <div className={`transport ${fxExpanded ? 'fx-expanded' : ''}`}>
      {/* Top row: playback controls and FX toggle */}
      <div className="transport-controls">
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

        {/* FX toggle button */}
        <button
          className={`fx-toggle ${fxExpanded ? 'expanded' : ''} ${hasActiveEffects ? 'active' : ''}`}
          onClick={() => setFxExpanded(!fxExpanded)}
          disabled={effectsDisabled}
          title="Toggle effects panel"
        >
          <span className="fx-icon">FX</span>
          {hasActiveEffects && <span className="fx-indicator" />}
        </button>
      </div>

      {/* Effects panel - expands below controls, pushes content down */}
      <div className={`transport-fx-panel ${fxExpanded ? 'expanded' : ''}`}>
        <div className="fx-panel-content">
          {/* Reverb */}
          <div className="fx-group" title="Reverb adds space and depth to your sound">
            <span className="fx-label">Reverb</span>
            <div className="fx-controls">
              <div className="fx-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.reverb.wet}
                  onChange={(e) => updateEffect('reverb', 'wet', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{Math.round(effects.reverb.wet * 100)}%</span>
              </div>
              <div className="fx-param">
                <label>Decay</label>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={effects.reverb.decay}
                  onChange={(e) => updateEffect('reverb', 'decay', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{effects.reverb.decay.toFixed(1)}s</span>
              </div>
            </div>
          </div>

          {/* Delay */}
          <div className="fx-group" title="Delay creates echoes synced to the tempo">
            <span className="fx-label">Delay</span>
            <div className="fx-controls">
              <div className="fx-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.delay.wet}
                  onChange={(e) => updateEffect('delay', 'wet', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{Math.round(effects.delay.wet * 100)}%</span>
              </div>
              <div className="fx-param">
                <label>Time</label>
                <select
                  value={effects.delay.time}
                  onChange={(e) => updateEffect('delay', 'time', e.target.value)}
                  disabled={effectsDisabled}
                >
                  {DELAY_TIME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="fx-param">
                <label>Feedback</label>
                <input
                  type="range"
                  min="0"
                  max="0.95"
                  step="0.01"
                  value={effects.delay.feedback}
                  onChange={(e) => updateEffect('delay', 'feedback', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{Math.round(effects.delay.feedback * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Chorus */}
          <div className="fx-group" title="Chorus adds width and movement">
            <span className="fx-label">Chorus</span>
            <div className="fx-controls">
              <div className="fx-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.chorus.wet}
                  onChange={(e) => updateEffect('chorus', 'wet', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{Math.round(effects.chorus.wet * 100)}%</span>
              </div>
              <div className="fx-param">
                <label>Rate</label>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={effects.chorus.frequency}
                  onChange={(e) => updateEffect('chorus', 'frequency', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{effects.chorus.frequency.toFixed(1)}Hz</span>
              </div>
              <div className="fx-param">
                <label>Depth</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.chorus.depth}
                  onChange={(e) => updateEffect('chorus', 'depth', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{Math.round(effects.chorus.depth * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Distortion */}
          <div className="fx-group" title="Distortion adds grit and edge">
            <span className="fx-label">Distortion</span>
            <div className="fx-controls">
              <div className="fx-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.distortion.wet}
                  onChange={(e) => updateEffect('distortion', 'wet', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{Math.round(effects.distortion.wet * 100)}%</span>
              </div>
              <div className="fx-param">
                <label>Drive</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.distortion.amount}
                  onChange={(e) => updateEffect('distortion', 'amount', parseFloat(e.target.value))}
                  disabled={effectsDisabled}
                />
                <span className="fx-value">{Math.round(effects.distortion.amount * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
