import { useCallback, useMemo, useState } from 'react';
// SamplePicker is lazy-loaded before the track/dropdown bundle in production.
// Keep this order so the catalogue exercises the same stylesheet cascade.
import { SamplePicker } from '../components/SamplePicker';
import { StepCountDropdown } from '../components/StepCountDropdown';
import { TransposeDropdown } from '../components/TransposeDropdown';
import { EffectsPanel } from '../components/EffectsPanel';
import { TrackDrawer } from '../components/TrackDrawer';
import { Transport } from '../components/Transport';
import '../components/TrackRow.css';
import { DEFAULT_EFFECTS_STATE } from '../shared/effects-defaults';
import type { EffectsState } from '../shared/sync-types';
import './catalog.css';

type StoryName = 'dropdowns' | 'picker' | 'effects' | 'transport-fx' | 'drawer';

function activeEffects(bypassed = false): EffectsState {
  return {
    bypass: bypassed,
    reverb: { ...DEFAULT_EFFECTS_STATE.reverb, wet: 0.32 },
    delay: { ...DEFAULT_EFFECTS_STATE.delay, wet: 0.18 },
    chorus: { ...DEFAULT_EFFECTS_STATE.chorus },
    distortion: { ...DEFAULT_EFFECTS_STATE.distortion },
  };
}

function useEventLog() {
  const [events, setEvents] = useState<string[]>([]);
  const record = useCallback((event: string) => {
    setEvents((current) => [...current, event]);
  }, []);
  return { events, record };
}

function Surface({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="stack-a-surface" aria-label={label}>
      <span className="stack-a-surface-label">{label}</span>
      {children}
    </section>
  );
}

function DropdownsStory({ variant }: { variant: string }) {
  const { events, record } = useEventLog();
  const disabled = variant === 'disabled';
  const selected = variant === 'selected';

  return (
    <>
      <div className="stack-a-stage" data-capture="dropdowns">
        <Surface label="Production track pitch and step group">
          <div className="track-pitch-step-group">
            <TransposeDropdown
              value={selected ? 7 : 0}
              onChange={(value) => record(`transpose:${value}`)}
              disabled={disabled}
            />
            <StepCountDropdown
              value={selected ? 24 : 16}
              onChange={(value) => record(`step:${value}`)}
              disabled={disabled}
            />
          </div>
        </Surface>
        <Surface label="Collision canary">
          <SamplePicker
            onSelectSample={(id) => record(`sample:${id}`)}
            disabled={disabled}
            previewsDisabled
          />
        </Surface>
      </div>
      <output className="stack-a-event-log" data-event-log>{events.join('|')}</output>
    </>
  );
}

function PickerStory({ variant }: { variant: string }) {
  const { events, record } = useEventLog();
  const isChange = variant === 'change';
  return (
    <>
      <div className="stack-a-stage stack-a-stage--column" data-capture="picker">
        <SamplePicker
          onSelectSample={(id) => record(`sample:${id}`)}
          disabled={variant === 'disabled'}
          previewsDisabled
          variant={isChange ? 'change' : 'add'}
          selectedSampleId={isChange ? 'kick' : undefined}
        />
      </div>
      <output className="stack-a-event-log" data-event-log>{events.join('|')}</output>
    </>
  );
}

function EffectsStory({ variant }: { variant: string }) {
  const { events, record } = useEventLog();
  const state = variant === 'active'
    ? activeEffects()
    : variant === 'bypassed'
      ? activeEffects(true)
      : DEFAULT_EFFECTS_STATE;
  return (
    <>
      <div className="stack-a-stage stack-a-stage--column" data-capture="effects">
        <EffectsPanel
          initialState={state}
          disabled={variant === 'disabled'}
          onEffectsChange={(effects) => record(`effects:${JSON.stringify(effects)}`)}
        />
      </div>
      <output className="stack-a-event-log" data-event-log>{events.join('|')}</output>
    </>
  );
}

function TransportFxStory({ variant }: { variant: string }) {
  const { events, record } = useEventLog();
  const effects = variant === 'bypassed' ? activeEffects(true) : activeEffects();
  return (
    <>
      <div className="stack-a-stage stack-a-stage--column" data-capture="transport-fx">
        <Transport
          isPlaying={false}
          tempo={120}
          swing={0}
          onPlayPause={() => record('play')}
          onTempoChange={(tempo) => record(`tempo:${tempo}`)}
          onSwingChange={(swing) => record(`swing:${swing}`)}
          effectsState={effects}
          effectsDisabled={variant === 'disabled'}
          onEffectsChange={(next) => record(`effects:${JSON.stringify(next)}`)}
          hasTracks
        />
      </div>
      <output className="stack-a-event-log" data-event-log>{events.join('|')}</output>
    </>
  );
}

function DrawerStory({ variant }: { variant: string }) {
  const { events, record } = useEventLog();
  const [isOpen, setIsOpen] = useState(variant !== 'closed');
  return (
    <>
      <div className="stack-a-stage stack-a-stage--column" data-capture="drawer">
        <div className="stack-a-drawer-host">
          <TrackDrawer
            isOpen={isOpen}
            onClose={(reason) => {
              record(`close:${reason}`);
              setIsOpen(false);
            }}
            trackId="catalog-track"
            trackName="Catalog Bass"
            transpose={variant === 'active' ? 7 : 0}
            stepCount={16}
            volume={1}
            isMelodicTrack
            hasSteps
            isPitchExpanded={variant === 'active'}
            isVelocityExpanded={false}
            arePatternToolsVisible={false}
            onTransposeChange={(value) => record(`transpose:${value}`)}
            onStepCountChange={(value) => record(`steps:${value}`)}
            onVolumeChange={(value) => record(`volume:${value}`)}
            onExpandPitch={() => record('pitch')}
            onExpandVelocity={() => record('velocity')}
            onShowPatternTools={() => record('pattern')}
            onChangeInstrument={() => record('instrument')}
            instrumentName="FM Bass"
            onCopy={() => record('copy')}
            onClear={() => record('clear')}
            onDelete={() => record('delete')}
          />
        </div>
      </div>
      <output className="stack-a-event-log" data-event-log>{events.join('|')}</output>
    </>
  );
}

export function StackACatalog() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const story = (params.get('story') ?? 'dropdowns') as StoryName;
  const variant = params.get('variant') ?? 'default';

  let content: React.ReactNode;
  switch (story) {
    case 'picker':
      content = <PickerStory variant={variant} />;
      break;
    case 'effects':
      content = <EffectsStory variant={variant} />;
      break;
    case 'transport-fx':
      content = <TransportFxStory variant={variant} />;
      break;
    case 'drawer':
      content = <DrawerStory variant={variant} />;
      break;
    case 'dropdowns':
    default:
      content = <DropdownsStory variant={variant} />;
      break;
  }

  return (
    <main className="stack-a-catalog" data-stack-a-ready data-story={story} data-variant={variant}>
      <header className="stack-a-catalog-header">
        <h1 className="stack-a-catalog-title">Stack A state catalogue</h1>
        <p className="stack-a-catalog-description">
          Deterministic component states for identity verification; not shipped in the application bundle.
        </p>
      </header>
      {content}
    </main>
  );
}
