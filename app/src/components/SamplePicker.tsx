import { useCallback } from 'react';
import { SAMPLE_CATEGORIES } from '../types';
import { audioEngine } from '../audio/engine';
import { isSampledInstrument, sampledInstrumentRegistry } from '../audio/sampled-instrument';
import './SamplePicker.css';

interface SamplePickerProps {
  onSelectSample: (sampleId: string, name: string) => void;
  disabled: boolean;
}

// Friendly display names for one-shot samples (drums + FX)
// Melodic sounds (bass, lead, pad, etc.) are now in SYNTH_NAMES as synth presets
// Exported for testing - ensures parity with types.ts
export const SAMPLE_NAMES: Record<string, string> = {
  // Drums
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-Hat',
  clap: 'Clap',
  tom: 'Tom',
  rim: 'Rim',
  cowbell: 'Cowbell',
  openhat: 'Open Hat',
  // FX
  zap: 'Zap',
  noise: 'Noise',
};

// Real-time synth presets (not sample-based) - organized by genre
// Exported for testing - ensures UI stays in sync with synth.ts
// Phase 21A: Added 14 new presets with enhanced synthesis features
export const SYNTH_CATEGORIES = {
  core: ['synth:bass', 'synth:lead', 'synth:pad', 'synth:pluck', 'synth:acid'],
  keys: ['synth:piano', 'synth:rhodes', 'synth:organ', 'synth:wurlitzer', 'synth:clavinet', 'synth:epiano', 'synth:vibes', 'synth:organphase'],
  electronic: ['synth:supersaw', 'synth:hypersaw', 'synth:wobble', 'synth:growl', 'synth:stab', 'synth:sub'],
  bass: ['synth:funkbass', 'synth:discobass', 'synth:reese', 'synth:hoover'],
  strings: ['synth:strings', 'synth:brass', 'synth:warmpad'],
  ambient: ['synth:shimmer', 'synth:jangle', 'synth:dreampop', 'synth:bell', 'synth:evolving', 'synth:sweep', 'synth:glass'],
} as const;

export const SYNTH_NAMES: Record<string, string> = {
  // Core
  'synth:bass': 'Bass',
  'synth:lead': 'Lead',
  'synth:pad': 'Pad',
  'synth:pluck': 'Pluck',
  'synth:acid': 'Acid',
  // Keys
  'synth:piano': 'Piano',
  'synth:rhodes': 'Rhodes',
  'synth:organ': 'Organ',
  'synth:wurlitzer': 'Wurli',
  'synth:clavinet': 'Clav',
  'synth:epiano': 'E.Piano',
  'synth:vibes': 'Vibes',
  'synth:organphase': 'Phase',
  // Electronic (Phase 21A)
  'synth:supersaw': 'Super',
  'synth:hypersaw': 'Hyper',
  'synth:wobble': 'Wobble',
  'synth:growl': 'Growl',
  'synth:stab': 'Stab',
  'synth:sub': 'Sub',
  // Bass
  'synth:funkbass': 'Funk',
  'synth:discobass': 'Disco',
  'synth:reese': 'Reese',
  'synth:hoover': 'Hoover',
  // Strings
  'synth:strings': 'Strings',
  'synth:brass': 'Brass',
  'synth:warmpad': 'Warm',
  // Ambient (Phase 21A additions)
  'synth:shimmer': 'Shimmer',
  'synth:jangle': 'Jangle',
  'synth:dreampop': 'Dream',
  'synth:bell': 'Bell',
  'synth:evolving': 'Evolve',
  'synth:sweep': 'Sweep',
  'synth:glass': 'Glass',
};

const SYNTH_CATEGORY_LABELS: Record<string, string> = {
  core: 'Core',
  keys: 'Keys',
  electronic: 'EDM',
  bass: 'Bass',
  strings: 'Strings',
  ambient: 'Ambient',
};

const CATEGORY_LABELS: Record<string, string> = {
  drums: 'Drums',
  fx: 'FX',
};

export function SamplePicker({ onSelectSample, disabled }: SamplePickerProps) {
  const handlePreview = useCallback((sampleId: string) => {
    // IMPORTANT: Don't initialize audio engine from hover events!
    // mouseenter is NOT a valid user gesture for AudioContext creation.
    // Preview only works after user has clicked Play or another valid gesture.
    // This prevents "AudioContext was not allowed to start" warnings.
    if (!audioEngine.isInitialized()) {
      return; // Skip preview if audio not ready - user must click first
    }
    // Check if it's a real-time synth preset
    if (sampleId.startsWith('synth:')) {
      const preset = sampleId.replace('synth:', '');
      audioEngine.playSynthNote(`preview-${sampleId}`, preset, 0, audioEngine.getCurrentTime(), 0.3);
    } else {
      audioEngine.playNow(sampleId);
    }
  }, []);

  const handleSelect = useCallback((sampleId: string) => {
    const name = SAMPLE_NAMES[sampleId] || SYNTH_NAMES[sampleId] || sampleId;

    // Preload sampled instruments when selected (e.g., piano)
    // This ensures they're ready before user hits play
    if (sampleId.startsWith('synth:')) {
      const preset = sampleId.replace('synth:', '');
      if (isSampledInstrument(preset)) {
        sampledInstrumentRegistry.load(preset);
      }
    }

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
      </div>
    </div>
  );
}
