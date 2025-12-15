import { useCallback } from 'react';
import { SAMPLE_CATEGORIES } from '../types';
import { signalMusicIntent, tryGetEngineForPreview } from '../audio/audioTriggers';
import {
  SAMPLE_NAMES,
  SYNTH_CATEGORIES,
  SYNTH_NAMES,
  TONE_SYNTH_CATEGORIES,
  TONE_SYNTH_NAMES,
  ADVANCED_SYNTH_CATEGORIES,
  ADVANCED_SYNTH_NAMES,
  ALL_SYNTH_NAMES
} from './sample-constants';
import './SamplePicker.css';

interface SamplePickerProps {
  onSelectSample: (sampleId: string, name: string) => void;
  disabled: boolean;
  previewsDisabled?: boolean; // When true, hovering doesn't trigger audio (e.g. published sessions)
}

const SYNTH_CATEGORY_LABELS: Record<string, string> = {
  core: 'Core',
  keys: 'Keys',
  genre: 'Genre',
  ambient: 'Ambient',
};

const TONE_CATEGORY_LABELS: Record<string, string> = {
  fm: 'FM',
  drum: 'Drum',
  modulation: 'Mod',
};

const ADVANCED_CATEGORY_LABELS: Record<string, string> = {
  leads: 'Leads',
  bass: 'Bass',
  pads: 'Pads',
};

const CATEGORY_LABELS: Record<string, string> = {
  drums: 'Drums',
  bass: 'Bass',
  synth: 'Samples',
  fx: 'FX',
  realsynth: 'Synth',
};

export function SamplePicker({ onSelectSample, disabled, previewsDisabled }: SamplePickerProps) {
  // Preview on hover - but hover is NOT a valid gesture for AudioContext unlock
  // So we can only preview if audio is already loaded AND initialized
  // First few hovers may be silent until user performs a click gesture
  const handlePreview = useCallback(async (sampleId: string) => {
    // Skip preview if disabled (e.g. published sessions)
    if (previewsDisabled) return;

    // Use tryGetEngineForPreview - returns null if not ready (won't block)
    const audioEngine = await tryGetEngineForPreview('preview_hover');
    if (!audioEngine) return;

    // Check if it's a real-time synth preset
    if (sampleId.startsWith('synth:')) {
      const preset = sampleId.replace('synth:', '');
      audioEngine.playSynthNote(`preview-${sampleId}`, preset, 0, audioEngine.getCurrentTime(), 0.3);
    } else {
      audioEngine.playNow(sampleId);
    }
  }, [previewsDisabled]);

  // Click IS a valid gesture - Tier 2 trigger (preload)
  const handleSelect = useCallback((sampleId: string) => {
    // Tier 2 - adding a track signals music intent
    signalMusicIntent('add_track');

    const name = SAMPLE_NAMES[sampleId] || ALL_SYNTH_NAMES[sampleId] || sampleId;
    onSelectSample(sampleId, name);
  }, [onSelectSample]);

  return (
    <div className={`sample-picker ${disabled ? 'disabled' : ''}`}>
      <span className="picker-label">Add Track:</span>
      <div className="picker-categories">
        {/* Sample categories */}
        {(Object.keys(SAMPLE_CATEGORIES) as Array<keyof typeof SAMPLE_CATEGORIES>).map(category => (
          <div key={category} className="picker-category">
            <span className="category-label">{CATEGORY_LABELS[category]}</span>
            <div className="category-samples">
              {SAMPLE_CATEGORIES[category].map(sampleId => (
                <button
                  key={sampleId}
                  className="sample-btn"
                  disabled={disabled}
                  onClick={() => handleSelect(sampleId)}
                  onMouseEnter={() => handlePreview(sampleId)}
                  title={`Add ${SAMPLE_NAMES[sampleId]} track`}
                >
                  {SAMPLE_NAMES[sampleId]}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Real-time synth presets by category */}
        {(Object.keys(SYNTH_CATEGORIES) as Array<keyof typeof SYNTH_CATEGORIES>).map(category => (
          <div key={category} className="picker-category synth-category">
            <span className="category-label">{SYNTH_CATEGORY_LABELS[category]}</span>
            <div className="category-samples">
              {SYNTH_CATEGORIES[category].map(synthId => (
                <button
                  key={synthId}
                  className="sample-btn synth-btn"
                  disabled={disabled}
                  onClick={() => handleSelect(synthId)}
                  onMouseEnter={() => handlePreview(synthId)}
                  title={`Add ${SYNTH_NAMES[synthId]} synth track`}
                >
                  {SYNTH_NAMES[synthId]}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Tone.js synth presets - FM, AM, Drum synthesis */}
        {(Object.keys(TONE_SYNTH_CATEGORIES) as Array<keyof typeof TONE_SYNTH_CATEGORIES>).map(category => (
          <div key={`tone-${category}`} className="picker-category tone-category">
            <span className="category-label">{TONE_CATEGORY_LABELS[category]}</span>
            <div className="category-samples">
              {TONE_SYNTH_CATEGORIES[category].map(synthId => (
                <button
                  key={synthId}
                  className="sample-btn tone-btn"
                  disabled={disabled}
                  onClick={() => handleSelect(synthId)}
                  onMouseEnter={() => handlePreview(synthId)}
                  title={`Add ${TONE_SYNTH_NAMES[synthId]} synth track`}
                >
                  {TONE_SYNTH_NAMES[synthId]}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Advanced dual-oscillator synth presets */}
        {(Object.keys(ADVANCED_SYNTH_CATEGORIES) as Array<keyof typeof ADVANCED_SYNTH_CATEGORIES>).map(category => (
          <div key={`advanced-${category}`} className="picker-category advanced-category">
            <span className="category-label">{ADVANCED_CATEGORY_LABELS[category]}</span>
            <div className="category-samples">
              {ADVANCED_SYNTH_CATEGORIES[category].map(synthId => (
                <button
                  key={synthId}
                  className="sample-btn advanced-btn"
                  disabled={disabled}
                  onClick={() => handleSelect(synthId)}
                  onMouseEnter={() => handlePreview(synthId)}
                  title={`Add ${ADVANCED_SYNTH_NAMES[synthId]} synth track`}
                >
                  {ADVANCED_SYNTH_NAMES[synthId]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
