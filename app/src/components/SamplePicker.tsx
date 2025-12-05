import { useCallback } from 'react';
import { SAMPLE_CATEGORIES } from '../types';
import { audioEngine } from '../audio/engine';
import './SamplePicker.css';

interface SamplePickerProps {
  onSelectSample: (sampleId: string, name: string) => void;
  disabled: boolean;
}

// Friendly display names for samples
const SAMPLE_NAMES: Record<string, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-Hat',
  clap: 'Clap',
  tom: 'Tom',
  rim: 'Rim',
  cowbell: 'Cowbell',
  openhat: 'Open Hat',
  bass: 'Bass',
  subbass: 'Sub Bass',
  lead: 'Lead',
  pluck: 'Pluck',
  chord: 'Chord',
  pad: 'Pad',
  zap: 'Zap',
  noise: 'Noise',
};

// Real-time synth presets (not sample-based)
const SYNTH_PRESETS = ['synth:bass', 'synth:lead', 'synth:pad', 'synth:pluck', 'synth:acid'] as const;
const SYNTH_NAMES: Record<string, string> = {
  'synth:bass': 'Bass',
  'synth:lead': 'Lead',
  'synth:pad': 'Pad',
  'synth:pluck': 'Pluck',
  'synth:acid': 'Acid',
};

const CATEGORY_LABELS: Record<string, string> = {
  drums: 'Drums',
  bass: 'Bass',
  synth: 'Samples',
  fx: 'FX',
  realsynth: 'Synth',
};

export function SamplePicker({ onSelectSample, disabled }: SamplePickerProps) {
  const handlePreview = useCallback((sampleId: string) => {
    if (audioEngine.isInitialized()) {
      // Check if it's a real-time synth preset
      if (sampleId.startsWith('synth:')) {
        const preset = sampleId.replace('synth:', '');
        audioEngine.playSynthNote(`preview-${sampleId}`, preset, 0, audioEngine.getCurrentTime(), 0.3);
      } else {
        audioEngine.playNow(sampleId);
      }
    }
  }, []);

  const handleSelect = useCallback((sampleId: string) => {
    const name = SAMPLE_NAMES[sampleId] || SYNTH_NAMES[sampleId] || sampleId;
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

        {/* Real-time synth presets */}
        <div className="picker-category synth-category">
          <span className="category-label">{CATEGORY_LABELS.realsynth}</span>
          <div className="category-samples">
            {SYNTH_PRESETS.map(synthId => (
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
      </div>
    </div>
  );
}
