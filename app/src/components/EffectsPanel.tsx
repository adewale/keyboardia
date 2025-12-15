import { memo, useCallback, useMemo } from 'react';
import type { EffectsState } from '../types';
import { VALID_DELAY_TIMES } from '../worker/invariants';
import './EffectsPanel.css';

interface EffectsPanelProps {
  effects: EffectsState;
  onEffectsChange: (effects: Partial<EffectsState>) => void;
  disabled?: boolean;
  isOpen: boolean;
  onClose: () => void;
}

const LED_SEGMENTS = 10;

// Convert wet value (0-1) to LED segments lit (0-10)
function wetToSegments(wet: number): number {
  return Math.round(wet * LED_SEGMENTS);
}

// Convert LED segment click to wet value
function segmentToWet(segment: number): number {
  return segment / LED_SEGMENTS;
}

interface LedBarProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

const LedBar = memo(function LedBar({ value, onChange, disabled }: LedBarProps) {
  const litSegments = wetToSegments(value);

  const handleSegmentClick = useCallback((segment: number) => {
    if (disabled) return;
    // Click on lit segment = set to that level, click on unlit = set to that level
    // Click on last lit segment = turn off (set to segment - 1)
    const newValue = segment === litSegments ? segmentToWet(segment - 1) : segmentToWet(segment);
    onChange(Math.max(0, Math.min(1, newValue)));
  }, [litSegments, onChange, disabled]);

  return (
    <div className="led-bar" role="slider" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: LED_SEGMENTS }, (_, i) => (
        <div
          key={i}
          className={`led-segment ${i < litSegments ? 'lit' : ''}`}
          onClick={() => handleSegmentClick(i + 1)}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label={`Set level to ${(i + 1) * 10}%`}
        />
      ))}
    </div>
  );
});

interface EffectUnitProps {
  name: string;
  effect: keyof EffectsState;
  wet: number;
  params: { label: string; value: number | string; min?: number; max?: number; step?: number; options?: string[] }[];
  onWetChange: (wet: number) => void;
  onParamChange: (param: string, value: number | string) => void;
  disabled?: boolean;
}

const EffectUnit = memo(function EffectUnit({
  name,
  effect,
  wet,
  params,
  onWetChange,
  onParamChange,
  disabled
}: EffectUnitProps) {
  const isActive = wet > 0;

  return (
    <div
      className={`effect-unit ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      data-effect={effect}
    >
      <div className="effect-label">
        <span className="effect-indicator" />
        {name}
      </div>

      <LedBar value={wet} onChange={onWetChange} disabled={disabled} />

      <div className="effect-value">{Math.round(wet * 100)}%</div>

      <div className="effect-params">
        {params.map((param) => (
          <div key={param.label} className="effect-param">
            <span className="param-label">{param.label}</span>
            {param.options ? (
              <select
                className="param-select"
                value={param.value}
                onChange={(e) => onParamChange(param.label.toLowerCase(), e.target.value)}
                disabled={disabled}
              >
                {param.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type="range"
                  className="param-slider"
                  min={param.min ?? 0}
                  max={param.max ?? 1}
                  step={param.step ?? 0.01}
                  value={param.value as number}
                  onChange={(e) => onParamChange(param.label.toLowerCase(), parseFloat(e.target.value))}
                  disabled={disabled}
                />
                <span className="param-value">
                  {typeof param.value === 'number' ? param.value.toFixed(param.step && param.step >= 0.1 ? 1 : 2) : param.value}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

export const EffectsPanel = memo(function EffectsPanel({
  effects,
  onEffectsChange,
  disabled,
  isOpen,
  onClose
}: EffectsPanelProps) {

  // Reverb handlers
  const handleReverbWetChange = useCallback((wet: number) => {
    onEffectsChange({ reverb: { ...effects.reverb, wet } });
  }, [effects.reverb, onEffectsChange]);

  const handleReverbParamChange = useCallback((param: string, value: number | string) => {
    if (param === 'decay' && typeof value === 'number') {
      onEffectsChange({ reverb: { ...effects.reverb, decay: value } });
    }
  }, [effects.reverb, onEffectsChange]);

  // Delay handlers
  const handleDelayWetChange = useCallback((wet: number) => {
    onEffectsChange({ delay: { ...effects.delay, wet } });
  }, [effects.delay, onEffectsChange]);

  const handleDelayParamChange = useCallback((param: string, value: number | string) => {
    if (param === 'time' && typeof value === 'string') {
      onEffectsChange({ delay: { ...effects.delay, time: value } });
    } else if (param === 'feedback' && typeof value === 'number') {
      onEffectsChange({ delay: { ...effects.delay, feedback: value } });
    }
  }, [effects.delay, onEffectsChange]);

  // Chorus handlers
  const handleChorusWetChange = useCallback((wet: number) => {
    onEffectsChange({ chorus: { ...effects.chorus, wet } });
  }, [effects.chorus, onEffectsChange]);

  const handleChorusParamChange = useCallback((param: string, value: number | string) => {
    if (param === 'rate' && typeof value === 'number') {
      onEffectsChange({ chorus: { ...effects.chorus, frequency: value } });
    } else if (param === 'depth' && typeof value === 'number') {
      onEffectsChange({ chorus: { ...effects.chorus, depth: value } });
    }
  }, [effects.chorus, onEffectsChange]);

  // Distortion handlers
  const handleDistortionWetChange = useCallback((wet: number) => {
    onEffectsChange({ distortion: { ...effects.distortion, wet } });
  }, [effects.distortion, onEffectsChange]);

  const handleDistortionParamChange = useCallback((param: string, value: number | string) => {
    if (param === 'drive' && typeof value === 'number') {
      onEffectsChange({ distortion: { ...effects.distortion, amount: value } });
    }
  }, [effects.distortion, onEffectsChange]);

  // Memoize delay time options
  const delayTimeOptions = useMemo(() => [...VALID_DELAY_TIMES], []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={`effects-panel ${!isOpen ? 'collapsed' : ''}`}>
      <div className="effects-header">
        <div className="effects-title">
          <span className="effects-title-icon">FX</span>
          Effects Rack
        </div>
        <button className="effects-close" onClick={onClose} aria-label="Close effects panel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="effects-rack">
        <EffectUnit
          name="Reverb"
          effect="reverb"
          wet={effects.reverb.wet}
          params={[
            { label: 'Decay', value: effects.reverb.decay, min: 0.1, max: 10, step: 0.1 }
          ]}
          onWetChange={handleReverbWetChange}
          onParamChange={handleReverbParamChange}
          disabled={disabled}
        />

        <EffectUnit
          name="Delay"
          effect="delay"
          wet={effects.delay.wet}
          params={[
            { label: 'Time', value: effects.delay.time, options: delayTimeOptions },
            { label: 'Feedback', value: effects.delay.feedback, min: 0, max: 0.95, step: 0.05 }
          ]}
          onWetChange={handleDelayWetChange}
          onParamChange={handleDelayParamChange}
          disabled={disabled}
        />

        <EffectUnit
          name="Chorus"
          effect="chorus"
          wet={effects.chorus.wet}
          params={[
            { label: 'Rate', value: effects.chorus.frequency, min: 0.1, max: 10, step: 0.1 },
            { label: 'Depth', value: effects.chorus.depth, min: 0, max: 1, step: 0.05 }
          ]}
          onWetChange={handleChorusWetChange}
          onParamChange={handleChorusParamChange}
          disabled={disabled}
        />

        <EffectUnit
          name="Distort"
          effect="distortion"
          wet={effects.distortion.wet}
          params={[
            { label: 'Drive', value: effects.distortion.amount, min: 0, max: 1, step: 0.05 }
          ]}
          onWetChange={handleDistortionWetChange}
          onParamChange={handleDistortionParamChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
});

// Export the FX toggle button for use in transport
export const FxToggleButton = memo(function FxToggleButton({
  isOpen,
  hasActiveEffects,
  onClick,
  disabled
}: {
  isOpen: boolean;
  hasActiveEffects: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`fx-toggle ${isOpen || hasActiveEffects ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={isOpen ? 'Close effects panel' : 'Open effects panel'}
      aria-expanded={isOpen}
    >
      <span className="fx-toggle-indicator" />
      FX
    </button>
  );
});
