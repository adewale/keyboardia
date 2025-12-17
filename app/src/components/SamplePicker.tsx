import { useCallback, useState, useEffect } from 'react';
import { signalMusicIntent, tryGetEngineForPreview } from '../audio/audioTriggers';
import { getAudioEngine } from '../audio/lazyAudioLoader';
import { useAudioUnlocked } from '../hooks/useAudioUnlocked';
import { getSampledInstrumentId } from '../audio/instrument-types';
import {
  INSTRUMENT_CATEGORIES,
  CATEGORY_ORDER,
  getInstrumentName,
  type InstrumentCategory,
} from './sample-constants';
import './SamplePicker.css';

interface SamplePickerProps {
  onSelectSample: (sampleId: string, name: string) => void;
  disabled: boolean;
  previewsDisabled?: boolean;
}

export function SamplePicker({ onSelectSample, disabled, previewsDisabled }: SamplePickerProps) {
  const audioUnlocked = useAudioUnlocked();

  // Track which categories are expanded
  // On mobile, start with only drums expanded; on desktop, all expanded
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => {
    const isMobile = window.innerWidth <= 768;
    return new Set(isMobile ? ['drums'] : CATEGORY_ORDER);
  });

  // Update expanded state on resize
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth <= 768;
      if (!isMobile) {
        // On desktop, expand all
        setExpandedCategories(new Set(CATEGORY_ORDER));
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleCategory = useCallback((category: string) => {
    // Only allow toggle on mobile - desktop always shows all categories
    if (window.innerWidth > 768) return;

    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // Preview on hover
  const handlePreview = useCallback(async (instrumentId: string) => {
    if (previewsDisabled) return;

    const audioEngine = await tryGetEngineForPreview('preview_hover');
    if (!audioEngine) return;

    const currentTime = audioEngine.getCurrentTime();

    if (instrumentId.startsWith('synth:')) {
      const preset = instrumentId.replace('synth:', '');
      audioEngine.playSynthNote(`preview-${instrumentId}`, preset, 0, currentTime, 0.3);
    } else if (instrumentId.startsWith('tone:')) {
      const preset = instrumentId.replace('tone:', '') as Parameters<typeof audioEngine.playToneSynth>[0];
      audioEngine.playToneSynth(preset, 0, currentTime, 0.3);
    } else if (instrumentId.startsWith('advanced:')) {
      const preset = instrumentId.replace('advanced:', '');
      audioEngine.playAdvancedSynth(preset, 0, currentTime, 0.3);
    } else if (instrumentId.startsWith('sampled:')) {
      const instrument = instrumentId.replace('sampled:', '');
      // Check if instrument is ready before playing
      if (audioEngine.isSampledInstrumentReady(instrument)) {
        const noteId = `preview-${instrument}-${Date.now()}`;
        const midiNote = 60; // C4 (middle C)
        audioEngine.playSampledInstrument(instrument, noteId, midiNote, currentTime, 0.3);
      }
    } else {
      // Regular sample
      audioEngine.playNow(instrumentId);
    }
  }, [previewsDisabled]);

  // Click to add track
  const handleSelect = useCallback((instrumentId: string) => {
    signalMusicIntent('add_track');

    // Phase 23 fix: Immediately preload sampled instruments when selected
    // This fixes the bug where instruments added mid-playback were never preloaded
    // See: docs/DEBUGGING-LESSONS-LEARNED.md #008
    const sampledId = getSampledInstrumentId(instrumentId);
    if (sampledId) {
      // Fire and forget - don't block UI
      getAudioEngine().then(engine => {
        engine.preloadInstrumentsForTracks([{ sampleId: instrumentId }]);
      }).catch(() => {
        // Ignore errors - scheduler will show "not ready" warning and retry on next play
      });
    }

    const name = getInstrumentName(instrumentId);
    onSelectSample(instrumentId, name);
  }, [onSelectSample]);

  const previewsAvailable = audioUnlocked && !previewsDisabled;

  return (
    <div className={`sample-picker ${disabled ? 'disabled' : ''} ${!previewsAvailable ? 'previews-unavailable' : ''}`}>
      <div className="picker-header">
        <span className="picker-label">Add Track</span>
        {!previewsAvailable && (
          <span className="picker-hint">tap to enable previews</span>
        )}
      </div>

      <div className="picker-categories">
        {CATEGORY_ORDER.map(categoryKey => {
          const category = INSTRUMENT_CATEGORIES[categoryKey as InstrumentCategory];
          const isExpanded = expandedCategories.has(categoryKey);

          return (
            <div
              key={categoryKey}
              className={`picker-category ${isExpanded ? 'expanded' : 'collapsed'}`}
              style={{ '--category-color': category.color } as React.CSSProperties}
            >
              <button
                className="category-header"
                onClick={() => toggleCategory(categoryKey)}
                aria-expanded={isExpanded}
              >
                <span className="category-label">{category.label}</span>
                <span className="category-chevron">{isExpanded ? '▼' : '▶'}</span>
              </button>

              {isExpanded && (
                <div className="category-instruments">
                  {category.instruments.map(instrument => (
                    <button
                      key={instrument.id}
                      className={`instrument-btn ${instrument.type}`}
                      disabled={disabled}
                      onClick={() => handleSelect(instrument.id)}
                      onMouseEnter={() => handlePreview(instrument.id)}
                      title={`Add ${instrument.name} track`}
                    >
                      {instrument.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
