import { useState, useCallback, useEffect } from 'react';
import { audioEngine } from '../audio/engine';
import type { EffectsState } from '../audio/toneEffects';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
import { DELAY_TIME_OPTIONS } from '../audio/delay-constants';
import './EffectsPanel.css';

interface EffectsPanelProps {
  onEffectsChange?: (effects: EffectsState) => void;
  initialState?: EffectsState;
  disabled?: boolean;
}

/**
 * EffectsPanel - Hardware-inspired effects controls
 *
 * Provides controls for:
 * - Reverb (decay, wet)
 * - Delay (time, feedback, wet)
 * - Chorus (frequency, depth, wet)
 * - Distortion (amount, wet)
 *
 * Design follows spec in specs/SYNTHESIS-ENGINE.md Section 9.2
 */
export function EffectsPanel({
  onEffectsChange,
  initialState,
  disabled = false,
}: EffectsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [effects, setEffects] = useState<EffectsState>(
    initialState ?? { ...DEFAULT_EFFECTS_STATE }
  );
  // Debug: Log expansion state changes
  useEffect(() => {
    console.log('[EffectsPanel] isExpanded changed to:', isExpanded);
  }, [isExpanded]);

  // Apply initial state when it changes (e.g., from multiplayer sync or session load)
  // Phase 22 pattern: Only apply effects if Tone.js effects chain is initialized
  useEffect(() => {
    if (initialState) {
      setEffects(initialState);
      // Only apply to audio engine if Tone.js is initialized
      // This prevents the "Cannot apply effects state: Tone.js not initialized" warning
      if (audioEngine.isToneInitialized()) {
        audioEngine.applyEffectsState(initialState);
      }
    }
  }, [initialState]);

  // Apply a single effect change to the audio engine
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

      // Apply to audio engine immediately
      applyEffectToEngine(effectName, param, value);

      // Notify parent of change
      onEffectsChange?.(newEffects);

      return newEffects;
    });
  }, [onEffectsChange, applyEffectToEngine]);

  // Check if any effects are active (wet > 0)
  const hasActiveEffects =
    effects.reverb.wet > 0 ||
    effects.delay.wet > 0 ||
    effects.chorus.wet > 0 ||
    effects.distortion.wet > 0;

  // Debug: Log state changes for troubleshooting
  const handleToggle = () => {
    console.log('[EffectsPanel] Toggle clicked, current isExpanded:', isExpanded, ', disabled:', disabled);
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={`effects-panel ${disabled ? 'disabled' : ''}`}>
      <button
        className={`effects-toggle ${isExpanded ? 'expanded' : ''} ${hasActiveEffects ? 'active' : ''}`}
        onClick={handleToggle}
        disabled={disabled}
        title="Toggle effects panel"
      >
        <span className="effects-icon">FX</span>
        {hasActiveEffects && <span className="effects-indicator" />}
      </button>

      {isExpanded && (
        <div className="effects-container">
          {/* Reverb */}
          <div className="effect-group" title="Reverb adds space and depth to your sound">
            <span className="effect-label">Reverb</span>
            <div className="effect-controls">
              <div className="effect-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.reverb.wet}
                  onChange={(e) => updateEffect('reverb', 'wet', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="Reverb amount (0% = dry, 100% = fully wet)"
                />
                <span className="param-value">{Math.round(effects.reverb.wet * 100)}%</span>
              </div>
              <div className="effect-param">
                <label>Decay</label>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={effects.reverb.decay}
                  onChange={(e) => updateEffect('reverb', 'decay', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="How long the reverb tail lasts"
                />
                <span className="param-value">{effects.reverb.decay.toFixed(1)}s</span>
              </div>
            </div>
          </div>

          {/* Delay */}
          <div className="effect-group" title="Delay creates echoes synced to the tempo">
            <span className="effect-label">Delay</span>
            <div className="effect-controls">
              <div className="effect-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.delay.wet}
                  onChange={(e) => updateEffect('delay', 'wet', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="Delay amount (0% = dry, 100% = fully wet)"
                />
                <span className="param-value">{Math.round(effects.delay.wet * 100)}%</span>
              </div>
              <div className="effect-param">
                <label>Time</label>
                <select
                  value={effects.delay.time}
                  onChange={(e) => updateEffect('delay', 'time', e.target.value)}
                  disabled={disabled}
                  title="Delay time in musical notation (synced to BPM)"
                >
                  {DELAY_TIME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="effect-param">
                <label>Feedback</label>
                <input
                  type="range"
                  min="0"
                  max="0.95"
                  step="0.01"
                  value={effects.delay.feedback}
                  onChange={(e) => updateEffect('delay', 'feedback', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="How much signal feeds back (more = longer echoes)"
                />
                <span className="param-value">{Math.round(effects.delay.feedback * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Chorus */}
          <div className="effect-group" title="Chorus adds width and movement by detuning copies of the signal">
            <span className="effect-label">Chorus</span>
            <div className="effect-controls">
              <div className="effect-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.chorus.wet}
                  onChange={(e) => updateEffect('chorus', 'wet', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="Chorus amount (0% = dry, 100% = fully wet)"
                />
                <span className="param-value">{Math.round(effects.chorus.wet * 100)}%</span>
              </div>
              <div className="effect-param">
                <label>Rate</label>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={effects.chorus.frequency}
                  onChange={(e) => updateEffect('chorus', 'frequency', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="Modulation speed (Hz)"
                />
                <span className="param-value">{effects.chorus.frequency.toFixed(1)}Hz</span>
              </div>
              <div className="effect-param">
                <label>Depth</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.chorus.depth}
                  onChange={(e) => updateEffect('chorus', 'depth', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="How much the pitch wobbles"
                />
                <span className="param-value">{Math.round(effects.chorus.depth * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Distortion */}
          <div className="effect-group" title="Distortion adds grit and edge to your sound">
            <span className="effect-label">Distortion</span>
            <div className="effect-controls">
              <div className="effect-param">
                <label>Mix</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.distortion.wet}
                  onChange={(e) => updateEffect('distortion', 'wet', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="Distortion amount (0% = clean, 100% = fully distorted)"
                />
                <span className="param-value">{Math.round(effects.distortion.wet * 100)}%</span>
              </div>
              <div className="effect-param">
                <label>Drive</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effects.distortion.amount}
                  onChange={(e) => updateEffect('distortion', 'amount', parseFloat(e.target.value))}
                  disabled={disabled}
                  title="How hard the signal is driven (more = more harmonics)"
                />
                <span className="param-value">{Math.round(effects.distortion.amount * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
