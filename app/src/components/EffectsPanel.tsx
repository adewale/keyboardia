import { useState, useCallback, useEffect } from 'react';
import { audioEngine } from '../audio/engine';
import type { EffectsState } from '../audio/toneEffects';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
import { DELAY_TIME_OPTIONS } from '../audio/delay-constants';
import { applyEffectToEngine } from '../audio/effects-util';
import { useSyncExternalStateWithSideEffect } from '../hooks/useSyncExternalState';
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

  // Sync effects state from props with side effect to apply to audio engine
  const [effects, setEffects] = useSyncExternalStateWithSideEffect<EffectsState>(
    initialState,
    { ...DEFAULT_EFFECTS_STATE },
    (state) => {
      // Only apply to audio engine if Tone.js is initialized
      if (audioEngine.isToneInitialized()) {
        audioEngine.applyEffectsState(state);
      }
    }
  );

  // Bypass is now synced via effects.bypass instead of local state
  // Debug: Log expansion state changes
  useEffect(() => {
    console.log('[EffectsPanel] isExpanded changed to:', isExpanded);
  }, [isExpanded]);

  // Update a single effect parameter (excludes 'bypass' which is boolean, not an object)
  const updateEffect = useCallback(<K extends Exclude<keyof EffectsState, 'bypass'>>(
    effectName: K,
    param: keyof EffectsState[K],
    value: number | string
  ) => {
    setEffects(prev => {
      const prevEffect = prev[effectName] as Record<string, unknown>;
      const newEffects = {
        ...prev,
        [effectName]: {
          ...prevEffect,
          [param]: value,
        },
      };

      // Apply to audio engine immediately
      applyEffectToEngine(effectName, param, value);

      // Notify parent of change
      onEffectsChange?.(newEffects);

      return newEffects;
    });
  }, [onEffectsChange, setEffects]);

  // Check if any effects are active (wet > 0)
  const hasActiveEffects =
    effects.reverb.wet > 0 ||
    effects.delay.wet > 0 ||
    effects.chorus.wet > 0 ||
    effects.distortion.wet > 0;

  // Toggle effects bypass (mutes all effects without losing settings)
  // Bypass is synced across multiplayer - everyone hears the same music
  const toggleBypass = useCallback(() => {
    const newBypassed = !(effects.bypass ?? false);
    const newEffects = { ...effects, bypass: newBypassed };
    setEffects(newEffects);
    audioEngine.setEffectsEnabled(!newBypassed);
    onEffectsChange?.(newEffects);  // Sync to server
  }, [effects, onEffectsChange, setEffects]);

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
          {/* Master Bypass toggle */}
          <div className="effects-master-controls">
            <button
              className={`effects-bypass-btn ${effects.bypass ? 'bypassed' : ''}`}
              onClick={toggleBypass}
              disabled={disabled || !hasActiveEffects}
              title={effects.bypass ? 'Enable effects' : 'Bypass all effects'}
            >
              {effects.bypass ? '⊗ Bypassed' : '● Active'}
            </button>
          </div>
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
