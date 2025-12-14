import { useCallback, useState } from 'react';
import { SAMPLE_CATEGORIES } from '../types';
import { audioEngine } from '../audio/engine';
import './SamplePicker.css';

interface SamplePickerProps {
  onSelectSample: (sampleId: string, name: string) => void;
  disabled: boolean;
}

// Friendly display names for samples
// Exported for testing - ensures parity with types.ts
export const SAMPLE_NAMES: Record<string, string> = {
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

// Real-time synth presets (not sample-based) - organized by genre
// Exported for testing - ensures UI stays in sync with synth.ts
export const SYNTH_CATEGORIES = {
  core: ['synth:bass', 'synth:lead', 'synth:pad', 'synth:pluck', 'synth:acid'],
  keys: ['synth:rhodes', 'synth:organ', 'synth:wurlitzer', 'synth:clavinet'],
  genre: ['synth:funkbass', 'synth:discobass', 'synth:strings', 'synth:brass', 'synth:stab', 'synth:sub'],
  ambient: ['synth:shimmer', 'synth:jangle', 'synth:dreampop', 'synth:bell'],
} as const;

export const SYNTH_NAMES: Record<string, string> = {
  'synth:bass': 'Bass',
  'synth:lead': 'Lead',
  'synth:pad': 'Pad',
  'synth:pluck': 'Pluck',
  'synth:acid': 'Acid',
  'synth:rhodes': 'Rhodes',
  'synth:organ': 'Organ',
  'synth:wurlitzer': 'Wurli',
  'synth:clavinet': 'Clav',
  'synth:funkbass': 'Funk',
  'synth:discobass': 'Disco',
  'synth:strings': 'Strings',
  'synth:brass': 'Brass',
  'synth:stab': 'Stab',
  'synth:sub': 'Sub',
  'synth:shimmer': 'Shimmer',
  'synth:jangle': 'Jangle',
  'synth:dreampop': 'Dream',
  'synth:bell': 'Bell',
};

const SYNTH_CATEGORY_LABELS: Record<string, string> = {
  core: 'Core',
  keys: 'Keys',
  genre: 'Genre',
  ambient: 'Ambient',
};

const CATEGORY_LABELS: Record<string, string> = {
  drums: 'Drums',
  bass: 'Bass',
  synth: 'Samples',
  fx: 'FX',
  realsynth: 'Synth',
};

export function SamplePicker({ onSelectSample, disabled }: SamplePickerProps) {
  const [addingSample, setAddingSample] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handlePreview = useCallback(async (sampleId: string) => {
    // Initialize audio engine on first interaction (required for browsers)
    if (!audioEngine.isInitialized()) {
      await audioEngine.initialize();
    }
    // Check if it's a real-time synth preset
    if (sampleId.startsWith('synth:')) {
      const preset = sampleId.replace('synth:', '');
      audioEngine.playSynthNote(`preview-${sampleId}`, preset, 0, audioEngine.getCurrentTime(), 0.3);
    } else {
      audioEngine.playNow(sampleId);
    }
  }, []);

  // Mobile touch preview
  const handleTouchStart = useCallback((sampleId: string) => {
    handlePreview(sampleId);
  }, [handlePreview]);

  const handleSelect = useCallback((sampleId: string) => {
    const name = SAMPLE_NAMES[sampleId] || SYNTH_NAMES[sampleId] || sampleId;
    setAddingSample(sampleId);
    onSelectSample(sampleId, name);
    // Clear loading state after a short delay
    setTimeout(() => setAddingSample(null), 300);
  }, [onSelectSample]);

  return (
    <div className={`sample-picker ${disabled ? 'disabled' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        className="picker-collapse-btn"
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? 'Expand sample picker' : 'Collapse sample picker'}
      >
        {isCollapsed ? '▶' : '▼'}
      </button>
      <span className="picker-label" onClick={() => setIsCollapsed(!isCollapsed)}>
        {isCollapsed ? 'Add Track ▸' : 'Add Track:'}
      </span>
      {!isCollapsed && (
      <div className="picker-categories">
        {/* Sample categories */}
        {(Object.keys(SAMPLE_CATEGORIES) as Array<keyof typeof SAMPLE_CATEGORIES>).map(category => (
          <div key={category} className="picker-category">
            <span className="category-label">{CATEGORY_LABELS[category]}</span>
            <div className="category-samples">
              {SAMPLE_CATEGORIES[category].map(sampleId => (
                <button
                  key={sampleId}
                  className={`sample-btn ${addingSample === sampleId ? 'adding' : ''}`}
                  disabled={disabled || addingSample === sampleId}
                  onClick={() => handleSelect(sampleId)}
                  onMouseEnter={() => handlePreview(sampleId)}
                  onTouchStart={() => handleTouchStart(sampleId)}
                  title={`Add ${SAMPLE_NAMES[sampleId]} track`}
                >
                  {addingSample === sampleId ? '...' : SAMPLE_NAMES[sampleId]}
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
                  className={`sample-btn synth-btn ${addingSample === synthId ? 'adding' : ''}`}
                  disabled={disabled || addingSample === synthId}
                  onClick={() => handleSelect(synthId)}
                  onMouseEnter={() => handlePreview(synthId)}
                  onTouchStart={() => handleTouchStart(synthId)}
                  title={`Add ${SYNTH_NAMES[synthId]} synth track`}
                >
                  {addingSample === synthId ? '...' : SYNTH_NAMES[synthId]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
