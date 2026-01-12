import { useCallback, useState, useEffect, useTransition } from 'react';
import { signalMusicIntent, previewInstrument, tryGetEngineForPreview } from '../audio/audioTriggers';
import { getAudioEngine } from '../audio/lazyAudioLoader';
import { useAudioUnlocked } from '../hooks/useAudioUnlocked';
import { getSampledInstrumentId } from '../audio/instrument-types';
import { getInaudibleWarning, isSubBassInstrument } from '../audio/instrument-ranges';
import { dispatchToastEvent } from '../utils/toastEvents';
import {
  INSTRUMENT_CATEGORIES,
  CATEGORY_ORDER,
  getInstrumentName,
  type InstrumentCategory,
} from './sample-constants';
import './SamplePicker.css';

// Track if we've shown the sub-bass warning this session (avoid spamming)
let subBassWarningShown = false;

interface SamplePickerProps {
  onSelectSample: (sampleId: string, name: string) => void;
  disabled: boolean;
  previewsDisabled?: boolean;
}

export function SamplePicker({ onSelectSample, disabled, previewsDisabled }: SamplePickerProps) {
  const audioUnlocked = useAudioUnlocked();

  // Phase 34: useTransition for non-blocking category updates
  const [isPending, startTransition] = useTransition();

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

    // Phase 34: Use transition to keep UI responsive during category expansion
    startTransition(() => {
      setExpandedCategories(prev => {
        const next = new Set(prev);
        if (next.has(category)) {
          next.delete(category);
        } else {
          next.add(category);
        }
        return next;
      });
    });
  }, [startTransition]);

  // Preview on hover - uses unified preview instrument function
  const handlePreview = useCallback(async (instrumentId: string) => {
    if (previewsDisabled) return;

    // For basic samples (kick, snare, etc.), use playNow directly
    if (!instrumentId.includes(':')) {
      const audioEngine = await tryGetEngineForPreview('preview_hover');
      if (audioEngine) {
        audioEngine.playNow(instrumentId);
      }
      return;
    }

    // For prefixed instruments, use unified preview function
    await previewInstrument('preview_hover', {
      sampleId: instrumentId,
      previewId: `preview-${instrumentId}`,
      pitch: 0,
      duration: 0.3,
    });
  }, [previewsDisabled]);

  // Click to add track
  const handleSelect = useCallback((instrumentId: string) => {
    signalMusicIntent('add_track');

    // Phase 31: Show warning for sub-bass instruments (once per session)
    if (!subBassWarningShown && isSubBassInstrument(instrumentId)) {
      const warning = getInaudibleWarning(instrumentId);
      if (warning) {
        dispatchToastEvent(warning, 'warning');
        subBassWarningShown = true;
      }
    }

    // Phase 23 fix: Immediately preload instruments when selected
    // This fixes the bug where instruments added mid-playback were never preloaded
    // See: docs/DEBUGGING-LESSONS-LEARNED.md #008
    getAudioEngine().then(engine => {
      // Trigger Tone.js init for tone/advanced instruments
      if ((instrumentId.startsWith('tone:') || instrumentId.startsWith('advanced:')) && !engine.isToneInitialized()) {
        engine.initializeTone().catch(() => {
          // Ignore errors - scheduler will warn on next play
        });
      }
      // Preload sampled instruments
      const sampledId = getSampledInstrumentId(instrumentId);
      if (sampledId) {
        engine.preloadInstrumentsForTracks([{ sampleId: instrumentId }]);
      }
    }).catch(() => {
      // Ignore errors - scheduler will show "not ready" warning and retry on next play
    });

    const name = getInstrumentName(instrumentId);
    onSelectSample(instrumentId, name);
  }, [onSelectSample]);

  const previewsAvailable = audioUnlocked && !previewsDisabled;

  return (
    <div className={`sample-picker ${disabled ? 'disabled' : ''} ${!previewsAvailable ? 'previews-unavailable' : ''} ${isPending ? 'pending' : ''}`}>
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
                title={`${category.label} instruments`}
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
                      data-testid={`add-track-${instrument.id}`}
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
