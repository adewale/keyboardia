import { useState, useCallback } from 'react';
import type { EffectsState, ScaleState } from '../types';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
import { DELAY_TIME_OPTIONS } from '../audio/delay-constants';
import { audioEngine } from '../audio/engine';
import { applyEffectToEngine } from '../audio/effects-util';
import { XYPad } from './XYPad';
import { ScaleSelector } from './ScaleSelector';
import { DEFAULT_SCALE_STATE } from '../state/grid';
import { useSyncExternalState, useSyncExternalStateWithSideEffect } from '../hooks/useSyncExternalState';
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
  // Scale props for Key Assistant (Phase 29E)
  scaleState?: ScaleState;
  onScaleChange?: (scale: ScaleState) => void;
  // Phase 31A: Beat pulse for metronome visual
  beatPulse?: boolean;
  beatPulseDuration?: number; // Duration in ms, proportional to tempo
  // Phase 31D: Unmute all
  onUnmuteAll?: () => void;
  mutedTrackCount?: number;
  // Phase 31I: Mixer panel toggle
  onToggleMixer?: () => void;
  isMixerOpen?: boolean;
  // Phase 31 TCG: Badge indicator when any track volume is adjusted
  hasAdjustedVolumes?: boolean;
  // Phase 31: Primary Action Button Pattern - Play is primary when stopped with tracks
  hasTracks?: boolean;
  // Phase 31H: Pitch overview panel toggle
  onTogglePitch?: () => void;
  isPitchOpen?: boolean;
  hasMelodicTracks?: boolean;
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
  scaleState,
  onScaleChange,
  beatPulse = false,
  beatPulseDuration = 100,
  onUnmuteAll,
  mutedTrackCount = 0,
  onToggleMixer,
  isMixerOpen = false,
  hasAdjustedVolumes = false,
  hasTracks = false,
  onTogglePitch,
  isPitchOpen = false,
  hasMelodicTracks = false,
}: TransportProps) {
  const [fxExpanded, setFxExpanded] = useState(false);

  // Sync effects state from props with side effect to apply to audio engine
  const [effects, setEffects] = useSyncExternalStateWithSideEffect<EffectsState>(
    effectsState,
    { ...DEFAULT_EFFECTS_STATE },
    (state) => {
      // Apply to audio engine if Tone.js is initialized
      if (audioEngine.isToneInitialized()) {
        audioEngine.applyEffectsState(state);
      }
    }
  );

  // Sync scale state from external sources (multiplayer, session load)
  const [scale, setScale] = useSyncExternalState<ScaleState>(
    scaleState,
    { ...DEFAULT_SCALE_STATE }
  );

  // Handle scale change - syncs to server
  const handleScaleChange = useCallback((newScale: ScaleState) => {
    setScale(newScale);
    onScaleChange?.(newScale);
  }, [onScaleChange, setScale]);

  // Check if any effects are active
  const hasActiveEffects =
    effects.reverb.wet > 0 ||
    effects.delay.wet > 0 ||
    effects.chorus.wet > 0 ||
    effects.distortion.wet > 0;

  // Update a single effect parameter - syncs to server immediately
  // Excludes 'bypass' which is boolean, not an object with params
  const updateEffect = useCallback(<K extends Exclude<keyof EffectsState, 'bypass'>>(
    effectName: K,
    param: keyof EffectsState[K],
    value: number | string
  ) => {
    // Compute new effects state
    const currentEffect = effects[effectName] as Record<string, unknown>;
    const newEffects = {
      ...effects,
      [effectName]: {
        ...currentEffect,
        [param]: value,
      },
    };

    setEffects(newEffects);
    applyEffectToEngine(effectName, param, value);
    onEffectsChange?.(newEffects);  // Sync to server immediately (like toggleBypass)
  }, [effects, onEffectsChange, setEffects]);

  // Toggle effects bypass (mutes all effects without losing settings)
  // Bypass is synced across multiplayer - everyone hears the same music
  const toggleBypass = useCallback(() => {
    const newBypassed = !(effects.bypass ?? false);
    const newEffects = { ...effects, bypass: newBypassed };
    setEffects(newEffects);
    audioEngine.setEffectsEnabled(!newBypassed);
    onEffectsChange?.(newEffects);  // Sync to server
  }, [effects, onEffectsChange, setEffects]);

  // XY Pad handler for reverb (X = wet, Y = decay normalized)
  // Batches both updates into single state change to avoid stale closure issue
  // (calling updateEffect twice would cause second call to overwrite first)
  const handleReverbXY = useCallback((x: number, y: number) => {
    // X = wet (0-1)
    // Y = decay (0.1-10, mapped from 0-1)
    const decay = 0.1 + y * 9.9; // 0.1 to 10

    // Build complete new state with both values
    const newEffects = {
      ...effects,
      reverb: {
        ...effects.reverb,
        wet: x,
        decay: decay,
      },
    };

    // Single state update, single server sync
    setEffects(newEffects);
    applyEffectToEngine('reverb', 'wet', x);
    applyEffectToEngine('reverb', 'decay', decay);
    onEffectsChange?.(newEffects);
  }, [effects, onEffectsChange, setEffects]);

  return (
    <div className={`transport ${fxExpanded ? 'fx-expanded' : ''}`}>
      {/* Top row: playback controls and FX toggle */}
      <div className="transport-controls">
        <button
          className={`play-button ${isPlaying ? 'playing' : ''} ${beatPulse ? 'beat-pulse' : ''} ${hasTracks && !isPlaying ? 'primary-action' : ''}`}
          onClick={onPlayPause}
          data-testid="play-button"
          title={isPlaying ? 'Stop (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Stop' : 'Play'}
          style={{ '--beat-pulse-duration': `${beatPulseDuration}ms` } as React.CSSProperties}
        >
          {isPlaying ? '■' : '▶'}
        </button>

        <div className="tempo-control" title="Tempo in beats per minute">
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

        <div className="swing-control" title="Swing feel: 0% = straight, higher = shuffle">
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

        {/* Scale selector - Phase 29E Key Assistant */}
        <ScaleSelector
          scale={scale}
          onScaleChange={handleScaleChange}
          disabled={effectsDisabled}
        />

        {/* Transport control group: Unmute, FX, Mixer - unified styling */}
        <div className="transport-control-group">
          {/* Unmute All button - always visible, enabled when tracks muted */}
          {onUnmuteAll && (
            <button
              className={`control-group-btn unmute-btn ${mutedTrackCount > 0 ? 'has-muted' : ''}`}
              onClick={onUnmuteAll}
              disabled={mutedTrackCount === 0}
              title={mutedTrackCount > 0 ? `Unmute all tracks (⌘⇧M)` : 'No tracks muted'}
              aria-label={mutedTrackCount > 0 ? `Unmute all ${mutedTrackCount} muted tracks` : 'Unmute all (no tracks muted)'}
            >
              <span className="btn-label">Unmute all</span>
              {mutedTrackCount > 0 && <span className="btn-badge">{mutedTrackCount}</span>}
            </button>
          )}

          {/* FX button - simple panel toggle (bypass control moved inside panel) */}
          <button
            className={`control-group-btn fx-btn ${hasActiveEffects ? 'has-effects' : ''} ${effects.bypass ? 'bypassed' : ''} ${fxExpanded ? 'expanded' : ''}`}
            onClick={() => setFxExpanded(!fxExpanded)}
            disabled={effectsDisabled}
            title={fxExpanded ? 'Close effects panel' : 'Open effects panel'}
            aria-label={fxExpanded ? 'Close effects panel' : 'Open effects panel'}
            aria-expanded={fxExpanded}
          >
            <span className="btn-label">FX</span>
            {hasActiveEffects && (
              <span className={`btn-badge ${effects.bypass ? 'bypassed' : ''}`}>
                {effects.bypass ? '⊗' : '●'}
              </span>
            )}
          </button>

          {/* Mixer panel toggle */}
          {onToggleMixer && (
            <button
              className={`control-group-btn mixer-btn ${isMixerOpen ? 'active' : ''} ${hasAdjustedVolumes ? 'has-adjustments' : ''}`}
              onClick={onToggleMixer}
              title={isMixerOpen ? 'Close mixer (return to pattern view)' : 'Open mixer (all volumes)'}
              aria-label={isMixerOpen ? 'Close mixer' : 'Open mixer'}
              aria-pressed={isMixerOpen}
            >
              <span className="btn-label">Mixer</span>
            </button>
          )}

          {/* Phase 31H: Pitch overview panel toggle */}
          {onTogglePitch && hasMelodicTracks && (
            <button
              className={`control-group-btn pitch-btn ${isPitchOpen ? 'active' : ''}`}
              onClick={onTogglePitch}
              title={isPitchOpen ? 'Close pitch overview' : 'Open pitch overview (chord detection, pitch range)'}
              aria-label={isPitchOpen ? 'Close pitch overview' : 'Open pitch overview'}
              aria-pressed={isPitchOpen}
            >
              <span className="btn-label">Pitch</span>
            </button>
          )}

        </div>

      </div>

      {/* Effects panel - expands below controls, pushes content down */}
      <div className={`transport-fx-panel ${fxExpanded ? 'expanded' : ''}`}>
        <div className="fx-panel-content">
          {/* Header row with title and Master control - matches Mixer/Pitch Overview */}
          <div className="fx-header">
            <h2 className="fx-title">FX</h2>
            <button
              className={`fx-master-toggle ${effects.bypass ? 'bypassed' : ''}`}
              onClick={toggleBypass}
              disabled={effectsDisabled || !hasActiveEffects}
              title={effects.bypass ? 'Enable all effects' : 'Bypass all effects'}
              aria-pressed={!effects.bypass}
            >
              <span className="master-indicator">{effects.bypass ? '⊗' : '●'}</span>
              <span className="master-label">{effects.bypass ? 'Bypassed' : 'Active'}</span>
            </button>
          </div>

          {/* Effect groups in a 4-column grid */}
          <div className="fx-groups">
          {/* Reverb */}
          <div className="fx-group" title="Reverb adds space and depth to your sound">
            <span className="fx-label">Reverb</span>
            <div className="fx-controls fx-controls-with-xy">
              <XYPad
                x={effects.reverb.wet}
                y={(effects.reverb.decay - 0.1) / 9.9}
                onChange={handleReverbXY}
                xLabel="Mix"
                yLabel="Decay"
                size={120}
                disabled={effectsDisabled}
                color="#9c27b0"
              />
              <div className="fx-sliders">
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
          </div>{/* Close fx-groups */}
        </div>
      </div>
    </div>
  );
}
