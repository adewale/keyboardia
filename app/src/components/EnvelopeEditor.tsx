import { useId, useMemo, useRef, useState } from 'react';
import type { EnvelopeDurationUnit, EnvelopeTimeUnit, TrackEnvelope } from '../types';
import type { EnvelopeCapability } from '../shared/envelope-capabilities';
import {
  DEFAULT_TRACK_ENVELOPE_V2,
  ENVELOPE_DURATION_RANGES_V2,
  TRACK_GATE_RANGE_V2,
  activeEnvelopeStages,
  clampEnvelopeDurationV2,
  durationToSeconds,
  legacyTrackEnvelopeToV2,
  trackEnvelopeV2ToLegacySeconds,
  type EnvelopeDuration,
  type EnvelopeModel,
  type EnvelopeStageName,
  type SamplePlaybackMode,
  type TrackEnvelopeV2,
} from '../shared/envelope-contract-v2';
import {
  amplitudeAtEnvelopeTimeV2,
  buildEnvelopeOracleTimelineV2,
} from '../shared/envelope-oracle-v2';
import { DEFAULT_TRACK_GATE } from '../shared/envelope';
import './EnvelopeEditor.css';

type DisplayUnit = 'ms' | 's' | 'st';

interface EnvelopeEditorProps {
  /** Legacy v2.3 value. Used only when envelopeV2 has not reached this track yet. */
  envelope: TrackEnvelope;
  /** Canonical mixed-unit/model value. Takes precedence over envelope. */
  envelopeV2?: TrackEnvelopeV2;
  capability?: EnvelopeCapability;
  overridden: boolean;
  timeUnit: EnvelopeTimeUnit;
  playbackMode?: SamplePlaybackMode;
  gate: number;
  bpm?: number;
  disabled?: boolean;
  /** Track-level launchers open the detailed second level immediately. */
  initiallyExpanded?: boolean;
  inactiveReason?: string;
  onChange: (envelope: TrackEnvelope) => void;
  onEnvelopeV2Change?: (envelope: TrackEnvelopeV2) => void;
  onEnvelopePreview?: (envelope: TrackEnvelopeV2) => void;
  /** Convert every timed stage in one authoritative mutation. */
  onConvertAllUnits?: (unit: EnvelopeDurationUnit) => void;
  onReset: () => void;
  onTimeUnitChange: (unit: EnvelopeTimeUnit) => void;
  onPlaybackModeChange?: (mode: SamplePlaybackMode) => void;
  onGateChange: (gate: number) => void;
  onAudition?: () => void;
}

const STAGE_LABELS: Record<EnvelopeStageName, string> = {
  attack: 'Attack',
  hold: 'Hold',
  decay: 'Decay',
  release: 'Release',
};

const MODEL_LABELS: Record<EnvelopeModel, string> = {
  ad: 'Attack / Decay',
  ahd: 'Attack / Hold / Decay',
  ar: 'Attack / Release',
  adsr: 'Attack / Decay / Sustain / Release',
};

const MODEL_DEFAULTS: Record<EnvelopeModel, TrackEnvelopeV2> = {
  ad: {
    model: 'ad',
    attack: { value: 0.003, unit: 'seconds' },
    decay: { value: 0.25, unit: 'seconds' },
  },
  ahd: {
    model: 'ahd',
    attack: { value: 0.003, unit: 'seconds' },
    hold: { value: 0.05, unit: 'seconds' },
    decay: { value: 0.25, unit: 'seconds' },
  },
  ar: {
    model: 'ar',
    attack: { value: 0.003, unit: 'seconds' },
    release: { value: 0.1, unit: 'seconds' },
  },
  adsr: DEFAULT_TRACK_ENVELOPE_V2,
};

const DEFAULT_CAPABILITY: EnvelopeCapability = {
  models: ['adsr'],
  sustainSource: 'oscillator',
  releaseSource: 'gain-only',
  lockableStages: ['attack', 'decay', 'release'],
  defaultModel: 'adsr',
};

function durationForStage(
  envelope: TrackEnvelopeV2,
  stage: EnvelopeStageName,
): EnvelopeDuration | undefined {
  if (stage === 'attack') return envelope.attack;
  if (stage === 'hold' && envelope.model === 'ahd') return envelope.hold;
  if (stage === 'decay' && (envelope.model === 'ad' || envelope.model === 'ahd' || envelope.model === 'adsr')) {
    return envelope.decay;
  }
  if (stage === 'release' && (envelope.model === 'ar' || envelope.model === 'adsr')) {
    return envelope.release;
  }
  return undefined;
}

function withDuration(
  envelope: TrackEnvelopeV2,
  stage: EnvelopeStageName,
  duration: EnvelopeDuration,
): TrackEnvelopeV2 {
  return { ...envelope, [stage]: clampEnvelopeDurationV2(stage, duration) } as TrackEnvelopeV2;
}

function withModel(envelope: TrackEnvelopeV2, model: EnvelopeModel): TrackEnvelopeV2 {
  const defaults = MODEL_DEFAULTS[model];
  const get = (stage: EnvelopeStageName): EnvelopeDuration => (
    durationForStage(envelope, stage)
    ?? durationForStage(defaults, stage)
    ?? { value: 0, unit: 'seconds' }
  );
  if (model === 'ad') return { model, attack: get('attack'), decay: get('decay') };
  if (model === 'ahd') {
    return { model, attack: get('attack'), hold: get('hold'), decay: get('decay') };
  }
  if (model === 'ar') return { model, attack: get('attack'), release: get('release') };
  return {
    model,
    attack: get('attack'),
    decay: get('decay'),
    sustain: envelope.model === 'adsr' ? envelope.sustain : 1,
    release: get('release'),
  };
}

function defaultDisplayUnit(duration: EnvelopeDuration): DisplayUnit {
  if (duration.unit === 'steps') return 'st';
  return duration.value !== 0 && Math.abs(duration.value) < 1 ? 'ms' : 's';
}

function displayValue(duration: EnvelopeDuration, unit: DisplayUnit): number {
  return unit === 'ms' ? duration.value * 1000 : duration.value;
}

function durationFromDisplay(value: number, unit: DisplayUnit): EnvelopeDuration {
  return unit === 'st'
    ? { value, unit: 'steps' }
    : { value: unit === 'ms' ? value / 1000 : value, unit: 'seconds' };
}

function displayRange(stage: EnvelopeStageName, unit: DisplayUnit) {
  const canonical = ENVELOPE_DURATION_RANGES_V2[stage][unit === 'st' ? 'steps' : 'seconds'];
  return unit === 'ms'
    ? { min: canonical.min * 1000, max: canonical.max * 1000 }
    : canonical;
}

const RANGE_ADJUSTMENT_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
]);

function sameEnvelope(a: TrackEnvelopeV2, b: TrackEnvelopeV2): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Reversible coarse control mapping that preserves useful travel for milliseconds. */
function durationToPosition(stage: EnvelopeStageName, duration: EnvelopeDuration): number {
  const range = ENVELOPE_DURATION_RANGES_V2[stage][duration.unit];
  if (range.max === range.min) return 0;
  return Math.cbrt((duration.value - range.min) / (range.max - range.min));
}

function positionToDuration(
  stage: EnvelopeStageName,
  position: number,
  unit: EnvelopeDuration['unit'],
): EnvelopeDuration {
  const range = ENVELOPE_DURATION_RANGES_V2[stage][unit];
  const normalized = Math.min(1, Math.max(0, position));
  return clampEnvelopeDurationV2(stage, {
    unit,
    value: range.min + (normalized ** 3) * (range.max - range.min),
  });
}

function convertDurationUnit(
  stage: EnvelopeStageName,
  duration: EnvelopeDuration,
  target: EnvelopeDuration['unit'],
  bpm: number,
): EnvelopeDuration {
  if (duration.unit === target) return duration;
  const seconds = durationToSeconds(duration, bpm);
  const value = target === 'seconds' ? seconds : seconds / (60 / bpm / 4);
  return clampEnvelopeDurationV2(stage, { value, unit: target });
}

function curveGeometry(envelope: TrackEnvelopeV2, gate: number, bpm: number) {
  const timeline = buildEnvelopeOracleTimelineV2({
    envelope,
    bpm,
    onsetSeconds: 0,
    tiedSteps: 2,
    gatePercent: gate,
  });
  const duration = Math.max(timeline.completionSeconds, 0.001);
  const points = Array.from({ length: 49 }, (_, index) => {
    const time = duration * (index / 48);
    const x = (time / duration) * 100;
    const amplitude = amplitudeAtEnvelopeTimeV2(timeline, time);
    const y = 36 - Math.min(1, Math.max(0, amplitude)) * 32;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  const landmarkTimes = [
    timeline.attackEndSeconds,
    timeline.holdEndSeconds,
    timeline.decayEndSeconds,
    timeline.releaseStartSeconds,
    timeline.releaseEndSeconds,
  ].filter((value): value is number => value !== undefined);
  const landmarks = [...new Set(landmarkTimes)].map((time) => ({
    x: Math.min(100, (time / duration) * 100),
    y: 36 - Math.min(1, Math.max(0, amplitudeAtEnvelopeTimeV2(timeline, time))) * 32,
  }));
  return { points, landmarks };
}

function EnvelopeCurve({
  envelope,
  gate,
  bpm,
  compact = false,
}: {
  envelope: TrackEnvelopeV2;
  gate: number;
  bpm: number;
  compact?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const geometry = useMemo(() => curveGeometry(envelope, gate, bpm), [bpm, envelope, gate]);
  return (
    <svg
      className={`envelope-editor__curve${compact ? ' envelope-editor__curve--compact' : ''}`}
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
      data-model={envelope.model}
    >
      <title id={titleId}>{MODEL_LABELS[envelope.model]} envelope</title>
      <desc id={descriptionId}>Amplitude over time; the curve follows the same semantic timeline as playback.</desc>
      <path className="envelope-editor__curve-axis" d="M 0 36 L 100 36" />
      <path className="envelope-editor__curve-line" d={geometry.points} />
      {!compact && geometry.landmarks.map((point, index) => (
        <circle
          // A timeline may contain coincident zero-duration landmarks, so index is part of the identity.
          key={`${point.x}-${point.y}-${index}`}
          className="envelope-editor__curve-landmark"
          cx={point.x}
          cy={point.y}
          r="1.8"
        />
      ))}
    </svg>
  );
}

export function EnvelopeEditor({
  envelope,
  envelopeV2,
  capability = DEFAULT_CAPABILITY,
  overridden,
  timeUnit,
  playbackMode,
  gate = DEFAULT_TRACK_GATE,
  bpm = 120,
  disabled = false,
  initiallyExpanded = false,
  inactiveReason,
  onChange,
  onEnvelopeV2Change,
  onEnvelopePreview,
  onConvertAllUnits,
  onReset,
  onTimeUnitChange,
  onPlaybackModeChange,
  onGateChange,
  onAudition,
}: EnvelopeEditorProps) {
  const sourceEnvelope = useMemo(
    () => envelopeV2 ?? legacyTrackEnvelopeToV2(envelope, timeUnit),
    [envelope, envelopeV2, timeUnit],
  );
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const gateId = useId();
  const gateInactiveId = useId();
  const playbackGroupName = useId();
  const [draft, setDraft] = useState<TrackEnvelopeV2>(sourceEnvelope);
  const [draftGate, setDraftGate] = useState(gate);
  const [envelopeGestureActive, setEnvelopeGestureActive] = useState(false);
  const [gateGestureActive, setGateGestureActive] = useState(false);
  const [displayUnits, setDisplayUnits] = useState<Partial<Record<EnvelopeStageName, DisplayUnit>>>(() => {
    const initial: Partial<Record<EnvelopeStageName, DisplayUnit>> = {};
    for (const stage of activeEnvelopeStages(sourceEnvelope.model)) {
      const duration = durationForStage(sourceEnvelope, stage);
      if (duration) initial[stage] = defaultDisplayUnit(duration);
    }
    return initial;
  });
  const draftRef = useRef(draft);
  const baselineRef = useRef<TrackEnvelopeV2 | null>(null);
  const gateRef = useRef(draftGate);
  const gateBaselineRef = useRef<number | null>(null);
  const visibleDraft = envelopeGestureActive ? draft : sourceEnvelope;
  const visibleGate = gateGestureActive ? draftGate : gate;

  const models = capability.models.length > 0 ? capability.models : [sourceEnvelope.model];
  const modelSupported = capability.models.includes(visibleDraft.model);
  const playbackSupported = !playbackMode
    || capability.samplePlaybackModes?.includes(playbackMode) === true;
  const reason = inactiveReason
    ?? (!modelSupported
      ? `${MODEL_LABELS[visibleDraft.model]} is retained but inactive for this instrument.`
      : !playbackSupported
        ? `${playbackMode} playback is retained but inactive for this instrument.`
        : capability.models.length === 0
          ? 'This instrument does not expose an editable amplitude envelope.'
          : undefined);
  const controlsDisabled = disabled || capability.models.length === 0;

  const publishEnvelope = (next: TrackEnvelopeV2) => {
    if (onEnvelopeV2Change) {
      onEnvelopeV2Change(next);
      return;
    }
    const legacy = trackEnvelopeV2ToLegacySeconds(next, bpm);
    onTimeUnitChange('seconds');
    onChange(legacy);
  };

  const previewEnvelope = (next: TrackEnvelopeV2) => {
    setDraft(next);
    draftRef.current = next;
    onEnvelopePreview?.(next);
  };

  const beginEnvelopeGesture = () => {
    if (baselineRef.current !== null) return;
    const current = envelopeGestureActive ? draftRef.current : sourceEnvelope;
    baselineRef.current = current;
    draftRef.current = current;
    setDraft(current);
    setEnvelopeGestureActive(true);
  };
  const commitEnvelopeGesture = () => {
    // This null guard is the transaction de-duplicator: pointerup may release
    // capture and cause lostpointercapture synchronously, but only the first
    // terminal event is allowed to publish the visible draft.
    if (baselineRef.current === null) return;
    const baseline = baselineRef.current;
    baselineRef.current = null;
    setEnvelopeGestureActive(false);
    if (!sameEnvelope(baseline, draftRef.current)) publishEnvelope(draftRef.current);
  };
  const cancelEnvelopeGesture = () => {
    const baseline = baselineRef.current;
    if (!baseline) return;
    baselineRef.current = null;
    previewEnvelope(baseline);
    setEnvelopeGestureActive(false);
  };
  const commitDiscreteEnvelope = (next: TrackEnvelopeV2) => {
    previewEnvelope(next);
    publishEnvelope(next);
  };

  const beginGateGesture = () => {
    if (gateBaselineRef.current !== null) return;
    const current = gateGestureActive ? gateRef.current : gate;
    gateBaselineRef.current = current;
    gateRef.current = current;
    setGateGestureActive(true);
  };
  const previewGate = (next: number) => {
    const clamped = Math.min(TRACK_GATE_RANGE_V2.max, Math.max(TRACK_GATE_RANGE_V2.min, next));
    setDraftGate(clamped);
    gateRef.current = clamped;
  };
  const commitGateGesture = () => {
    const baseline = gateBaselineRef.current;
    if (baseline === null) return;
    gateBaselineRef.current = null;
    setGateGestureActive(false);
    if (baseline !== gateRef.current) onGateChange(gateRef.current);
  };
  const cancelGateGesture = () => {
    if (gateBaselineRef.current === null) return;
    const baseline = gateBaselineRef.current;
    gateBaselineRef.current = null;
    previewGate(baseline);
    setGateGestureActive(false);
  };

  const cancelAllDrafts = () => {
    cancelEnvelopeGesture();
    cancelGateGesture();
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    cancelAllDrafts();
  };

  const setDurationValue = (stage: EnvelopeStageName, value: number, unit: DisplayUnit) => {
    const next = withDuration(draftRef.current, stage, durationFromDisplay(value, unit));
    previewEnvelope(next);
  };

  const setDurationPosition = (stage: EnvelopeStageName, position: number) => {
    const current = durationForStage(draftRef.current, stage);
    if (!current) return;
    previewEnvelope(withDuration(
      draftRef.current,
      stage,
      positionToDuration(stage, position, current.unit),
    ));
  };

  const changeDisplayUnit = (stage: EnvelopeStageName, nextDisplayUnit: DisplayUnit) => {
    const current = durationForStage(visibleDraft, stage);
    if (!current) return;
    const targetUnit = nextDisplayUnit === 'st' ? 'steps' : 'seconds';
    const converted = convertDurationUnit(stage, current, targetUnit, bpm);
    setDisplayUnits((units) => ({ ...units, [stage]: nextDisplayUnit }));
    if (converted !== current) commitDiscreteEnvelope(withDuration(visibleDraft, stage, converted));
  };

  const sourceDescription = `${capability.sustainSource.replace('-', ' ')} sustain · ${capability.releaseSource.replace('-', ' ')} release`;
  const activeStages = activeEnvelopeStages(visibleDraft.model);
  const gateActive = playbackMode !== 'trigger';

  return (
    <section
      className={`envelope-editor${reason ? ' envelope-editor--inactive' : ''}`}
      aria-label="Amplitude envelope"
      onKeyDown={handleEditorKeyDown}
    >
      <button
        type="button"
        className="envelope-editor__summary"
        aria-label={`${visibleDraft.model.toUpperCase()} amplitude envelope, ${playbackMode ? `${playbackMode} sample` : sourceDescription}, ${overridden ? 'Override' : 'Preset'}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <EnvelopeCurve envelope={visibleDraft} gate={visibleGate} bpm={bpm} compact />
        <span className="envelope-editor__summary-copy">
          <strong>{visibleDraft.model.toUpperCase()}</strong>
          <span>{playbackMode ? `${playbackMode} sample` : sourceDescription}</span>
        </span>
        <span className="envelope-editor__source">{overridden ? 'Override' : 'Preset'}</span>
        {reason && <span className="envelope-editor__warning">Inactive</span>}
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="envelope-editor__panel">
          <div className="envelope-editor__panel-header">
            <div>
              <strong>Amplitude envelope</strong>
              <p>{sourceDescription}</p>
            </div>
            <div className="envelope-editor__actions">
              {onAudition && (
                <button type="button" onClick={onAudition} disabled={controlsDisabled}>Audition</button>
              )}
              {overridden && (
                <button type="button" onClick={onReset} disabled={disabled}>Reset</button>
              )}
              <button type="button" onClick={() => setExpanded(false)}>Done</button>
            </div>
          </div>

          {reason && <p className="envelope-editor__inactive-reason" role="status">{reason}</p>}

          <div className="envelope-editor__configuration">
            <label>
              Model
              <select
                aria-label="Envelope model"
                value={visibleDraft.model}
                disabled={controlsDisabled}
                onChange={(event) => commitDiscreteEnvelope(withModel(
                  visibleDraft,
                  event.target.value as EnvelopeModel,
                ))}
              >
                {!capability.models.includes(visibleDraft.model) && (
                  <option value={visibleDraft.model}>{MODEL_LABELS[visibleDraft.model]} (inactive)</option>
                )}
                {models.map((model) => <option key={model} value={model}>{MODEL_LABELS[model]}</option>)}
              </select>
            </label>

            {capability.samplePlaybackModes && capability.samplePlaybackModes.length > 0 && (
              <fieldset>
                <legend>Sample behavior</legend>
                {capability.samplePlaybackModes.map((mode) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name={playbackGroupName}
                      value={mode}
                      checked={playbackMode === mode}
                      disabled={controlsDisabled || !onPlaybackModeChange}
                      onChange={() => onPlaybackModeChange?.(mode)}
                    />
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </label>
                ))}
              </fieldset>
            )}

            {onConvertAllUnits && (
              <fieldset className="envelope-editor__convert-units">
                <legend>Convert all timings</legend>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => onConvertAllUnits('seconds')}
                >
                  All to seconds
                </button>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => onConvertAllUnits('steps')}
                >
                  All to steps
                </button>
              </fieldset>
            )}
          </div>

          <EnvelopeCurve envelope={visibleDraft} gate={visibleGate} bpm={bpm} />

          <div className="envelope-editor__controls">
            {activeStages.map((stage) => {
              const duration = durationForStage(visibleDraft, stage);
              if (!duration) return null;
              const preferredUnit = displayUnits[stage];
              // A canonical seconds<->steps conversion is authoritative. A
              // remembered presentation preference is valid only inside the
              // same canonical unit family (ms and s are both seconds).
              const unit = duration.unit === 'steps'
                ? 'st'
                : preferredUnit && preferredUnit !== 'st'
                  ? preferredUnit
                  : defaultDisplayUnit(duration);
              const range = displayRange(stage, unit);
              const precision = unit === 'ms' ? 1 : unit === 'st' ? 0.01 : 0.001;
              return (
                <fieldset key={stage} className="envelope-editor__control">
                  <legend>{STAGE_LABELS[stage]}</legend>
                  <input
                    aria-label={`${STAGE_LABELS[stage]} envelope shape`}
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={durationToPosition(stage, duration)}
                    disabled={controlsDisabled}
                    onPointerDown={beginEnvelopeGesture}
                    onPointerUp={commitEnvelopeGesture}
                    onPointerCancel={commitEnvelopeGesture}
                    onLostPointerCapture={commitEnvelopeGesture}
                    onChange={(event) => setDurationPosition(stage, Number(event.target.value))}
                    onKeyDown={(event) => {
                      if (RANGE_ADJUSTMENT_KEYS.has(event.key)) beginEnvelopeGesture();
                    }}
                    onKeyUp={commitEnvelopeGesture}
                    onBlur={commitEnvelopeGesture}
                  />
                  <div className="envelope-editor__exact">
                    <input
                      aria-label={`${STAGE_LABELS[stage]} exact value`}
                      type="number"
                      min={range.min}
                      max={range.max}
                      step={precision}
                      value={Number(displayValue(duration, unit).toFixed(unit === 'ms' ? 1 : 3))}
                      disabled={controlsDisabled}
                      onFocus={beginEnvelopeGesture}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) setDurationValue(stage, value, unit);
                      }}
                      onBlur={commitEnvelopeGesture}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitEnvelopeGesture();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <select
                      aria-label={`${STAGE_LABELS[stage]} unit`}
                      value={unit}
                      disabled={controlsDisabled}
                      onChange={(event) => changeDisplayUnit(stage, event.target.value as DisplayUnit)}
                    >
                      <option value="ms">ms</option>
                      <option value="s">s</option>
                      <option value="st">st</option>
                    </select>
                  </div>
                </fieldset>
              );
            })}

            {visibleDraft.model === 'adsr' && (
              <fieldset className="envelope-editor__control">
                <legend>Sustain</legend>
                <input
                  aria-label="Sustain envelope shape"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={visibleDraft.sustain}
                  disabled={controlsDisabled}
                  onPointerDown={beginEnvelopeGesture}
                  onPointerUp={commitEnvelopeGesture}
                  onPointerCancel={commitEnvelopeGesture}
                  onLostPointerCapture={commitEnvelopeGesture}
                  onChange={(event) => previewEnvelope({
                    ...draftRef.current as Extract<TrackEnvelopeV2, { model: 'adsr' }>,
                    sustain: Math.min(1, Math.max(0, Number(event.target.value))),
                  })}
                  onKeyDown={(event) => {
                    if (RANGE_ADJUSTMENT_KEYS.has(event.key)) beginEnvelopeGesture();
                  }}
                  onKeyUp={commitEnvelopeGesture}
                  onBlur={commitEnvelopeGesture}
                />
                <div className="envelope-editor__exact">
                  <input
                    aria-label="Sustain exact value"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Number(visibleDraft.sustain.toFixed(2))}
                    disabled={controlsDisabled}
                    onFocus={beginEnvelopeGesture}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isFinite(value)) return;
                      previewEnvelope({
                        ...draftRef.current as Extract<TrackEnvelopeV2, { model: 'adsr' }>,
                        sustain: Math.min(1, Math.max(0, value)),
                      });
                    }}
                    onBlur={commitEnvelopeGesture}
                  />
                  <span aria-hidden="true">level</span>
                </div>
              </fieldset>
            )}
          </div>

          <div className="envelope-editor__gate">
            <label htmlFor={gateId}>Gate</label>
            <input
              id={gateId}
              aria-describedby={!gateActive ? gateInactiveId : undefined}
              type="range"
              min={TRACK_GATE_RANGE_V2.min}
              max={TRACK_GATE_RANGE_V2.max}
              value={visibleGate}
              disabled={controlsDisabled || !gateActive}
              onPointerDown={beginGateGesture}
              onPointerUp={commitGateGesture}
              onPointerCancel={commitGateGesture}
              onLostPointerCapture={commitGateGesture}
              onChange={(event) => previewGate(Number(event.target.value))}
              onKeyDown={(event) => {
                if (RANGE_ADJUSTMENT_KEYS.has(event.key)) beginGateGesture();
              }}
              onKeyUp={commitGateGesture}
              onBlur={commitGateGesture}
            />
            <output>{Math.round(visibleGate)}%</output>
            {!gateActive && <span id={gateInactiveId}>Trigger plays the source independently of note-off.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
