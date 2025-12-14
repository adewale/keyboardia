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

// Advanced synth presets (Phase 19) - dual oscillators, LFO, filter envelope
export const ADVANCED_SYNTH_CATEGORIES = {
  bass: ['advsynth:fatbass', 'advsynth:wobblebass', 'advsynth:reesebass'],
  lead: ['advsynth:analogLead', 'advsynth:syncLead', 'advsynth:supersaw'],
  pad: ['advsynth:warmPad', 'advsynth:shimmerPad', 'advsynth:ethereal'],
  keys: ['advsynth:electricPiano', 'advsynth:clavSynth'],
  acid: ['advsynth:acid303', 'advsynth:acidSquare'],
  brass: ['advsynth:brassStab', 'advsynth:stringEnsemble'],
  texture: ['advsynth:darkAmbient', 'advsynth:noiseHit', 'advsynth:windTexture'],
} as const;

export const ADVANCED_SYNTH_NAMES: Record<string, string> = {
  'advsynth:fatbass': 'Fat Bass',
  'advsynth:wobblebass': 'Wobble',
  'advsynth:reesebass': 'Reese',
  'advsynth:analogLead': 'Analog',
  'advsynth:syncLead': 'Sync',
  'advsynth:supersaw': 'Supersaw',
  'advsynth:warmPad': 'Warm Pad',
  'advsynth:shimmerPad': 'Shimmer',
  'advsynth:ethereal': 'Ethereal',
  'advsynth:electricPiano': 'E.Piano',
  'advsynth:clavSynth': 'Clav',
  'advsynth:acid303': 'TB-303',
  'advsynth:acidSquare': 'Acid Sq',
  'advsynth:brassStab': 'Brass',
  'advsynth:stringEnsemble': 'Strings',
  'advsynth:darkAmbient': 'Dark',
  'advsynth:noiseHit': 'Noise',
  'advsynth:windTexture': 'Wind',
  'advsynth:synthPluck': 'Pluck',
  'advsynth:bellPluck': 'Bell',
};

const ADVANCED_SYNTH_CATEGORY_LABELS: Record<string, string> = {
  bass: 'Bass+',
  lead: 'Lead+',
  pad: 'Pad+',
  keys: 'Keys+',
  acid: 'Acid+',
  brass: 'Orch+',
  texture: 'Texture',
};

const CATEGORY_LABELS: Record<string, string> = {
  drums: 'Drums',
  bass: 'Bass',
  synth: 'Samples',
  fx: 'FX',
  realsynth: 'Synth',
};

export function SamplePicker({ onSelectSample, disabled }: SamplePickerProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handlePreview = useCallback(async (sampleId: string) => {
    // Initialize audio engine on first interaction (required for browsers)
    if (!audioEngine.isInitialized()) {
      await audioEngine.initialize();
    }
    // Check if it's an advanced synth preset (Phase 19)
    if (sampleId.startsWith('advsynth:')) {
      const preset = sampleId.replace('advsynth:', '');
      audioEngine.playAdvancedSynthNote(`preview-${sampleId}`, preset, 0, audioEngine.getCurrentTime(), 0.4);
    } else if (sampleId.startsWith('synth:')) {
      // Basic synth preset
      const preset = sampleId.replace('synth:', '');
      audioEngine.playSynthNote(`preview-${sampleId}`, preset, 0, audioEngine.getCurrentTime(), 0.3);
    } else {
      audioEngine.playNow(sampleId);
    }
  }, []);

  const handleSelect = useCallback((sampleId: string) => {
    const name = SAMPLE_NAMES[sampleId] || SYNTH_NAMES[sampleId] || ADVANCED_SYNTH_NAMES[sampleId] || sampleId;
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

        {/* Advanced Synth toggle */}
        <div className="picker-category advanced-toggle-category">
          <button
            className={`advanced-toggle-btn ${showAdvanced ? 'active' : ''}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
            title="Show advanced synth presets with dual oscillators, LFO, and filter envelope"
          >
            {showAdvanced ? '▼ Advanced' : '▶ Advanced'}
          </button>
        </div>

        {/* Advanced synth presets (Phase 19) - shown when toggled */}
        {showAdvanced && (Object.keys(ADVANCED_SYNTH_CATEGORIES) as Array<keyof typeof ADVANCED_SYNTH_CATEGORIES>).map(category => (
          <div key={`adv-${category}`} className="picker-category advanced-synth-category">
            <span className="category-label">{ADVANCED_SYNTH_CATEGORY_LABELS[category]}</span>
            <div className="category-samples">
              {ADVANCED_SYNTH_CATEGORIES[category].map(synthId => (
                <button
                  key={synthId}
                  className="sample-btn advanced-synth-btn"
                  disabled={disabled}
                  onClick={() => handleSelect(synthId)}
                  onMouseEnter={() => handlePreview(synthId)}
                  title={`Add ${ADVANCED_SYNTH_NAMES[synthId]} advanced synth track (dual osc, LFO, filter env)`}
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
