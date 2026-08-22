import { useState, useCallback, useRef, useMemo } from 'react';
import type { EffectsState, ScaleState, Track, TrackEnvelope, TrackEnvelopeV2 } from '../types';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
import { DELAY_TIME_OPTIONS } from '../audio/delay-constants';
import { audioEngine } from '../audio/engine';
import { applyEffectToEngine } from '../audio/effects-util';
import { XYPad } from './XYPad';
import { XYPadController, XY_PAD_PRESETS } from '../audio/xyPad';
import { buildBatchedEffectsUpdate, applySynthParam, type XYParamUpdate } from '../audio/xy-effects-bridge';
import { ScaleSelector } from './ScaleSelector';
import { FxActive, FxBypass, Play, Stop } from '../icons';
import { DEFAULT_SCALE_STATE } from '../state/grid';
import { useSyncExternalState, useSyncExternalStateWithSideEffect } from '../hooks/useSyncExternalState';
import './Transport.css';
import { getEffectiveTrackEnvelopeV2 } from '../shared/envelope';
import {
  clampEnvelopeDurationV2,
  legacyTrackEnvelopeToV2,
  trackEnvelopeV2ToLegacySeconds,
  type EnvelopeDuration,
} from '../shared/envelope-contract-v2';

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
  tracks?: Track[];
  selectedTrackId?: string;
  /** False while connected to a worker that cannot persist v2 envelopes. */
  supportsEnvelopeV2?: boolean;
  /** False for the headless release profile; removes every envelope authoring surface. */
  envelopeEditingEnabled?: boolean;
  onEnvelopeChange?: (trackId: string, envelope: TrackEnvelope) => void;
  onEnvelopeV2Change?: (trackId: string, envelope: TrackEnvelopeV2) => void;
  /** Local-only audio preview for a draft; never persists or broadcasts. */
  onEnvelopePreview?: (trackId: string, envelope: TrackEnvelopeV2) => void;
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
  tracks = [],
  selectedTrackId,
  supportsEnvelopeV2 = true,
  envelopeEditingEnabled = true,
  onEnvelopeChange,
  onEnvelopeV2Change,
  onEnvelopePreview,
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

  // XY Pad controller state
  const [xyPreset, setXyPreset] = useState('space-control');
  const [xyPos, setXyPos] = useState({ x: 0.5, y: 0.5 });
  const xyPresetIds = useMemo(
    () => Object.keys(XY_PAD_PRESETS).filter(id => envelopeEditingEnabled || id !== 'envelope-shape'),
    [envelopeEditingEnabled],
  );
  const xyControllerRef = useRef(new XYPadController(xyPreset));
  const [envelopeTrackId, setEnvelopeTrackId] = useState('');
  const envelopeTrack = tracks.find(track => track.id === envelopeTrackId)
    ?? tracks.find(track => track.id === selectedTrackId)
    ?? tracks[0];
  const xyEffectsBaselineRef = useRef<EffectsState | null>(null);
  const xyEffectsDraftRef = useRef(effects);
  const [xyGestureActive, setXyGestureActive] = useState(false);

  const positionForEnvelopeTrack = useCallback((track: Track | undefined) => {
    if (!track) return { x: 0.5, y: 0.5 };
    const report = getEffectiveTrackEnvelopeV2(track);
    const editable = track.envelopeV2
      ?? (track.envelope
        ? legacyTrackEnvelopeToV2(track.envelope, track.envelopeTimeUnit ?? 'seconds')
        : report.effective);
    const current = trackEnvelopeV2ToLegacySeconds(editable, tempo);
    const mappings = XY_PAD_PRESETS['envelope-shape'].mappings;
    const inverse = (parameter: 'attack' | 'release', value: number) => {
      const mapping = mappings.find(candidate => candidate.parameter === parameter);
      if (!mapping || mapping.max === mapping.min) return 0;
      const normalized = Math.min(1, Math.max(0, (value - mapping.min) / (mapping.max - mapping.min)));
      return mapping.curve === 'exponential' ? Math.sqrt(normalized) : normalized;
    };
    return {
      x: inverse('attack', current.attack),
      y: inverse('release', current.release),
    };
  }, [tempo]);

  const envelopeXYActive = useMemo(() => {
    if (!envelopeEditingEnabled || !supportsEnvelopeV2 || !envelopeTrack) return false;
    const report = getEffectiveTrackEnvelopeV2(envelopeTrack);
    const model = envelopeTrack.envelopeV2?.model
      ?? (envelopeTrack.envelope ? 'adsr' : report.effective.model);
    return report.capability.models.includes(model) && (model === 'ar' || model === 'adsr');
  }, [envelopeEditingEnabled, envelopeTrack, supportsEnvelopeV2]);

  const displayedXYPos = xyPreset === 'envelope-shape' && !xyGestureActive
    ? positionForEnvelopeTrack(envelopeTrack)
    : xyPos;

  const handlePresetChange = useCallback((newPreset: string) => {
    if (newPreset === 'envelope-shape' && (!envelopeEditingEnabled || !supportsEnvelopeV2)) return;
    setXyPreset(newPreset);
    xyControllerRef.current = new XYPadController(newPreset);
    const next = newPreset === 'envelope-shape'
      ? positionForEnvelopeTrack(envelopeTrack)
      : { x: 0.5, y: 0.5 };
    xyControllerRef.current.setPosition(next.x, next.y);
    setXyPos(next);
  }, [envelopeEditingEnabled, envelopeTrack, positionForEnvelopeTrack, supportsEnvelopeV2]);

  const handleEnvelopeTargetChange = useCallback((trackId: string) => {
    setEnvelopeTrackId(trackId);
    const nextTrack = tracks.find(track => track.id === trackId);
    const next = positionForEnvelopeTrack(nextTrack);
    xyControllerRef.current.setPosition(next.x, next.y);
    setXyPos(next);
  }, [positionForEnvelopeTrack, tracks]);

  const handleXYStart = useCallback((x: number, y: number) => {
    setXyGestureActive(true);
    xyControllerRef.current.setPosition(x, y);
    setXyPos({ x, y });
    xyEffectsBaselineRef.current = effects;
    xyEffectsDraftRef.current = effects;
  }, [effects]);

  const envelopeForXYValues = useCallback((track: Track | undefined) => {
    if (!track || !envelopeXYActive) return null;
    const values = xyControllerRef.current.getAllParameterValues();
    const report = getEffectiveTrackEnvelopeV2(track);
    const editable = track.envelopeV2
      ?? (track.envelope
        ? legacyTrackEnvelopeToV2(track.envelope, track.envelopeTimeUnit ?? 'seconds')
        : report.effective);
    if (editable.model !== 'ar' && editable.model !== 'adsr') return null;
    const inExistingUnit = (
      stage: 'attack' | 'release',
      seconds: number,
      current: EnvelopeDuration,
    ): EnvelopeDuration => clampEnvelopeDurationV2(stage, current.unit === 'seconds'
      ? { value: seconds, unit: 'seconds' }
      : { value: seconds / (60 / tempo / 4), unit: 'steps' });
    return {
      ...editable,
      attack: inExistingUnit('attack', values.attack ?? 0, editable.attack),
      release: inExistingUnit('release', values.release ?? 0, editable.release),
    };
  }, [envelopeXYActive, tempo]);

  // Unified XY handler: collects all param values, batches effect state,
  // and routes synth params — replacing both the old per-param switch and
  // the bespoke handleReverbXY with a single code path.
  const handleXYChange = useCallback((x: number, y: number) => {
    setXyPos({ x, y });
    const controller = xyControllerRef.current;
    if (!controller) return;
    controller.setPosition(x, y);
    const values = controller.getAllParameterValues();

    if (xyPreset === 'envelope-shape') {
      const next = envelopeForXYValues(envelopeTrack);
      if (next && envelopeTrack) onEnvelopePreview?.(envelopeTrack.id, next);
      return;
    }

    // Build batched updates list
    const updates: XYParamUpdate[] = Object.entries(values).map(
      ([parameter, value]) => ({ parameter: parameter as XYParamUpdate['parameter'], value })
    );

    // Single state update for all effect params (no stale closure)
    const currentEffects = xyEffectsBaselineRef.current ? xyEffectsDraftRef.current : effects;
    const newEffects = buildBatchedEffectsUpdate(currentEffects, updates);
    if (newEffects !== currentEffects) {
      setEffects(newEffects);
      xyEffectsDraftRef.current = newEffects;
      // Apply each effect param to audio engine
      for (const { parameter, value } of updates) {
        applyEffectToEngine(
          parameter === 'reverbWet' || parameter === 'reverbDecay' ? 'reverb' :
          parameter === 'delayWet' || parameter === 'delayFeedback' ? 'delay' :
          parameter === 'chorusWet' ? 'chorus' :
          parameter === 'distortionWet' ? 'distortion' : 'reverb',
          parameter === 'reverbWet' ? 'wet' :
          parameter === 'reverbDecay' ? 'decay' :
          parameter === 'delayWet' ? 'wet' :
          parameter === 'delayFeedback' ? 'feedback' :
          parameter === 'chorusWet' ? 'wet' :
          parameter === 'distortionWet' ? 'wet' : 'wet',
          value
        );
      }
    }

    // Route synth parameters directly to the shared live engine.
    for (const { parameter, value } of updates) {
      applySynthParam(parameter, value, audioEngine);
    }
  }, [effects, envelopeForXYValues, envelopeTrack, onEnvelopePreview, setEffects, xyPreset]);

  const handleXYCommit = useCallback((_x: number, _y: number) => {
    setXyGestureActive(false);
    if (xyPreset === 'envelope-shape') {
      if (!envelopeTrack || !envelopeXYActive) return;
      const next = envelopeForXYValues(envelopeTrack);
      if (next) {
        if (onEnvelopeV2Change) onEnvelopeV2Change(envelopeTrack.id, next);
        else if (onEnvelopeChange) {
          onEnvelopeChange(envelopeTrack.id, trackEnvelopeV2ToLegacySeconds(next, tempo));
        }
      }
      return;
    }
    if (xyEffectsDraftRef.current !== xyEffectsBaselineRef.current) {
      onEffectsChange?.(xyEffectsDraftRef.current);
    }
    xyEffectsBaselineRef.current = null;
  }, [envelopeForXYValues, envelopeTrack, envelopeXYActive, onEffectsChange, onEnvelopeChange, onEnvelopeV2Change, tempo, xyPreset]);

  const handleXYCancel = useCallback(() => {
    setXyGestureActive(false);
    const baseline = xyEffectsBaselineRef.current;
    xyEffectsBaselineRef.current = null;
    if (!baseline || xyPreset === 'envelope-shape') return;
    xyEffectsDraftRef.current = baseline;
    setEffects(baseline);
    if (audioEngine.isToneInitialized()) audioEngine.applyEffectsState(baseline);
  }, [setEffects, xyPreset]);

  // Toggle effects bypass (mutes all effects without losing settings)
  // Bypass is synced across multiplayer - everyone hears the same music
  const toggleBypass = useCallback(() => {
    const newBypassed = !(effects.bypass ?? false);
    const newEffects = { ...effects, bypass: newBypassed };
    setEffects(newEffects);
    audioEngine.setEffectsEnabled(!newBypassed);
    onEffectsChange?.(newEffects);  // Sync to server
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
          {isPlaying
            ? <Stop size={24} fill="currentColor" aria-hidden="true" />
            : <Play size={24} fill="currentColor" aria-hidden="true" />}
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
            aria-controls="effects-panel"
          >
            <span className="btn-label">FX</span>
            {hasActiveEffects && (
              <span className={`btn-badge ${effects.bypass ? 'bypassed' : ''}`}>
                {effects.bypass
                  ? <FxBypass size={12} aria-hidden="true" />
                  : <FxActive size={12} fill="currentColor" aria-hidden="true" />}
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
              aria-expanded={isMixerOpen}
              aria-controls="mixer-panel"
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
              aria-expanded={isPitchOpen}
              aria-controls="pitch-panel"
            >
              <span className="btn-label">Pitch</span>
            </button>
          )}

        </div>

      </div>

      {/* Effects panel - expands below controls, pushes content down */}
      <div
        id="effects-panel"
        className={`transport-fx-panel ${fxExpanded ? 'expanded' : ''}`}
        aria-hidden={!fxExpanded}
        inert={!fxExpanded}
      >
        <div className="fx-panel-content">
          {/* Header row with title and Master control - matches Mixer/Pitch Overview */}
          <div className="fx-header">
            <h2 className="fx-title">FX</h2>
            <button
              className={`fx-master-toggle ${effects.bypass ? 'bypassed' : ''}`}
              onClick={toggleBypass}
              disabled={effectsDisabled || !hasActiveEffects}
              title={effects.bypass ? 'Enable all effects' : 'Bypass all effects'}
              aria-label="Effects enabled"
              aria-pressed={!effects.bypass}
            >
              <span className="master-indicator">
                {effects.bypass
                  ? <FxBypass size={14} aria-hidden="true" />
                  : <FxActive size={14} fill="currentColor" aria-hidden="true" />}
              </span>
              <span className="master-label">{effects.bypass ? 'Bypassed' : 'Active'}</span>
            </button>
          </div>

          {/* Effect groups in a 4-column grid */}
          <div className="fx-groups">
          {/* XY Pad Controller */}
          <div className="fx-group fx-group--xy-controller" title="XY Pad — drag to modulate effects with preset mappings">
            <div className="fx-label-row">
              <span className="fx-label">XY Pad</span>
              <select
                className="xy-preset-select"
                value={xyPreset}
                onChange={(e) => handlePresetChange(e.target.value)}
                disabled={effectsDisabled}
              >
                {xyPresetIds.map((id) => (
                  <option
                    key={id}
                    value={id}
                    disabled={id === 'envelope-shape' && !supportsEnvelopeV2}
                  >
                    {XY_PAD_PRESETS[id].name}
                  </option>
                ))}
              </select>
              {xyPreset === 'envelope-shape' && tracks.length > 0 && (
                <select
                  aria-label="Envelope target track"
                  value={envelopeTrack?.id ?? ''}
                  onChange={(event) => handleEnvelopeTargetChange(event.target.value)}
                  disabled={effectsDisabled || !supportsEnvelopeV2}
                >
                  {tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
                </select>
              )}
            </div>
            <XYPad
              x={displayedXYPos.x}
              y={displayedXYPos.y}
              onChangeStart={handleXYStart}
              onChange={handleXYChange}
              onChangeEnd={handleXYCommit}
              onChangeCancel={handleXYCancel}
              xLabel={XY_PAD_PRESETS[xyPreset].mappings.find(m => m.axis === 'x')?.parameter ?? 'X'}
              yLabel={XY_PAD_PRESETS[xyPreset].mappings.find(m => m.axis === 'y')?.parameter ?? 'Y'}
              size={120}
              disabled={effectsDisabled || (xyPreset === 'envelope-shape' && (!supportsEnvelopeV2 || !envelopeXYActive))}
              color="#e91e63"
            />
            {xyPreset === 'envelope-shape' && !envelopeXYActive && (
              <span className="xy-envelope-inactive" role="status">
                {supportsEnvelopeV2
                  ? 'Select a track with an active Attack/Release envelope.'
                  : 'Envelope Shape requires the connected session to support envelope v2.'}
              </span>
            )}
          </div>
          {/* Reverb */}
          <div className="fx-group" title="Reverb adds space and depth to your sound">
            <span className="fx-label">Reverb</span>
            <div className="fx-controls">
              <div className="fx-param">
                <label htmlFor="transport-reverb-mix">Mix</label>
                <input
                  id="transport-reverb-mix"
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
                <label htmlFor="transport-reverb-decay">Decay</label>
                <input
                  id="transport-reverb-decay"
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
                <label htmlFor="transport-delay-mix">Mix</label>
                <input
                  id="transport-delay-mix"
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
                <label htmlFor="transport-delay-time">Time</label>
                <select
                  id="transport-delay-time"
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
                <label htmlFor="transport-delay-feedback">Feedback</label>
                <input
                  id="transport-delay-feedback"
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
                <label htmlFor="transport-chorus-mix">Mix</label>
                <input
                  id="transport-chorus-mix"
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
                <label htmlFor="transport-chorus-rate">Rate</label>
                <input
                  id="transport-chorus-rate"
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
                <label htmlFor="transport-chorus-depth">Depth</label>
                <input
                  id="transport-chorus-depth"
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
                <label htmlFor="transport-distortion-mix">Mix</label>
                <input
                  id="transport-distortion-mix"
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
                <label htmlFor="transport-distortion-drive">Drive</label>
                <input
                  id="transport-distortion-drive"
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
