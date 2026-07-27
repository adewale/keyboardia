import { useCallback, useState, useEffect, useTransition } from 'react';
import { signalMusicIntent, previewInstrument, tryGetEngineForPreview } from '../audio/audioTriggers';
import { prepareInstrument } from '../audio/prepare-instrument';
import { useAudioUnlocked } from '../hooks/useAudioUnlocked';
import { getInaudibleWarning, isSubBassInstrument } from '../audio/instrument-ranges';
import { dispatchToastEvent } from '../utils/toastEvents';
import { ChevronDown, ChevronRight } from '../icons';
import {
  INSTRUMENT_CATEGORIES,
  CATEGORY_ORDER,
  getInstrumentName,
  type InstrumentCategory,
} from './sample-constants';
import './SamplePicker.css';

// Track if we've shown the sub-bass warning this session (avoid spamming)
let subBassWarningShown = false;

/**
 * What the picker is for. Both variants browse the same canonical catalog and
 * preview the same way; only the wording, the test IDs, and whether a current
 * selection is marked differ.
 *
 * The 'add' variant must keep rendering exactly what it rendered before the
 * 'change' variant existed — e2e/visual.spec.ts holds a `sample-picker.png`
 * baseline of it.
 */
export type SamplePickerVariant = 'add' | 'change';

interface SamplePickerProps {
  onSelectSample: (sampleId: string, name: string) => void;
  disabled: boolean;
  previewsDisabled?: boolean;
  /** Defaults to 'add' (create a new track). */
  variant?: SamplePickerVariant;
  /** The track's current instrument, marked as selected in the 'change' variant. */
  selectedSampleId?: string;
}

export function SamplePicker({
  onSelectSample,
  disabled,
  previewsDisabled,
  variant = 'add',
  selectedSampleId,
}: SamplePickerProps) {
  const isChange = variant === 'change';
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
      const audioEngine = tryGetEngineForPreview('preview_hover');
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

  // Click commits: add a track, or replace the open track's instrument.
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

    // Phase 23 fix: Immediately preload instruments when selected.
    // This fixes the bug where instruments added mid-playback were never
    // preloaded. See: docs/DEBUGGING-LESSONS-LEARNED.md #008
    //
    // No trackId here in either variant. For 'add' the track does not exist
    // yet; for 'change' the per-track synth is rebuilt by
    // useTrackInstrumentReconcile once the new sampleId reaches state, which
    // is the path a collaborator's change takes too.
    prepareInstrument(instrumentId);

    const name = getInstrumentName(instrumentId);
    onSelectSample(instrumentId, name);
  }, [onSelectSample]);

  const previewsAvailable = audioUnlocked && !previewsDisabled;

  return (
    <div className={`sample-picker ${isChange ? 'variant-change' : ''} ${disabled ? 'disabled' : ''} ${!previewsAvailable ? 'previews-unavailable' : ''} ${isPending ? 'pending' : ''}`}>
      <div className="picker-header">
        <span className="picker-label">{isChange ? 'Change Instrument' : 'Add Track'}</span>
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
                <span className="category-chevron">
                  {isExpanded
                    ? <ChevronDown size={14} aria-hidden="true" />
                    : <ChevronRight size={14} aria-hidden="true" />}
                </span>
              </button>

              {isExpanded && (
                <div className="category-instruments">
                  {category.instruments.map(instrument => {
                    const isCurrent = isChange && instrument.id === selectedSampleId;
                    return (
                      <button
                        key={instrument.id}
                        className={`instrument-btn ${instrument.type}${isCurrent ? ' current' : ''}`}
                        disabled={disabled}
                        onClick={() => handleSelect(instrument.id)}
                        onMouseEnter={() => handlePreview(instrument.id)}
                        title={isChange
                          ? `${isCurrent ? 'Current instrument: ' : 'Use '}${instrument.name}`
                          : `Add ${instrument.name} track`}
                        aria-current={isCurrent ? 'true' : undefined}
                        data-testid={isChange
                          ? `set-instrument-${instrument.id}`
                          : `add-track-${instrument.id}`}
                      >
                        {instrument.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
