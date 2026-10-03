// @vitest-environment jsdom
/**
 * Transport XY Pad Sync Tests
 *
 * Verifies that the generic XY pad produces batched state updates
 * (single onEffectsChange call per drag) for all presets.
 *
 * Previously tested the bespoke handleReverbXY — now tests the
 * unified handleXYChange which uses buildBatchedEffectsUpdate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { Transport } from './Transport';
import type { EffectsState } from '../audio/toneEffects';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
import type { Track } from '../types';

// Mock audio engine to prevent Tone.js initialization
vi.mock('../audio/engine', () => ({
  audioEngine: {
    isToneInitialized: () => false,
    applyEffectsState: vi.fn(),
    setReverbWet: vi.fn(),
    setReverbDecay: vi.fn(),
    setDelayWet: vi.fn(),
    setDelayTime: vi.fn(),
    setDelayFeedback: vi.fn(),
    setChorusWet: vi.fn(),
    setChorusFrequency: vi.fn(),
    setChorusDepth: vi.fn(),
    setDistortionWet: vi.fn(),
    setDistortionAmount: vi.fn(),
    setEffectsEnabled: vi.fn(),
    setFilterFrequency: vi.fn(),
    setFilterResonance: vi.fn(),
    setLfoRate: vi.fn(),
    setLfoAmount: vi.fn(),
    setAttack: vi.fn(),
    setRelease: vi.fn(),
    setOscMix: vi.fn(),
  },
}));

function renderTransport(
  initialEffects: EffectsState,
  onEffectsChange: (effects: EffectsState) => void,
) {
  return render(
    <Transport
      isPlaying={false}
      tempo={120}
      swing={0}
      onPlayPause={vi.fn()}
      onTempoChange={vi.fn()}
      onSwingChange={vi.fn()}
      effectsState={initialEffects}
      onEffectsChange={onEffectsChange}
    />
  );
}

function expandFxPanel(container: HTMLElement) {
  const fxBtn = container.querySelector('.fx-btn') as HTMLElement;
  act(() => { fxBtn.click(); });
}

function dragXYPad(xyPad: HTMLElement, clientX: number, clientY: number) {
  vi.spyOn(xyPad, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 80, height: 80,
    right: 80, bottom: 80, x: 0, y: 0, toJSON: () => ({}),
  });
  fireEvent.pointerDown(xyPad, { pointerId: 1, clientX: 5, clientY: 75 });
  fireEvent.pointerMove(xyPad, { pointerId: 1, clientX, clientY });
  fireEvent.pointerUp(xyPad, { pointerId: 1, clientX, clientY });
}

describe('Transport XY Pad — batched effect updates', () => {
  let capturedEffects: EffectsState[];
  let onEffectsChange: (effects: EffectsState) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEffects = [];
    onEffectsChange = vi.fn((effects: EffectsState) => {
      capturedEffects.push(structuredClone(effects));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('space-control preset: single drag updates both reverbWet and delayWet', () => {
    const { container } = renderTransport(DEFAULT_EFFECTS_STATE, onEffectsChange);
    expandFxPanel(container);

    // The generic XY pad defaults to space-control (reverbWet x, delayWet y)
    const xyPad = container.querySelector('.xy-pad') as HTMLElement;
    expect(xyPad).toBeTruthy();

    // Drag to center: x=0.5, y=0.5
    dragXYPad(xyPad, 40, 40);

    // Single batched call with both values
    expect(capturedEffects.length).toBe(1);
    expect(capturedEffects[0].reverb.wet).toBeGreaterThan(0);
    expect(capturedEffects[0].delay.wet).toBeGreaterThan(0);
  });

  it('space-control max corner: both params at their mapped max', () => {
    const { container } = renderTransport(DEFAULT_EFFECTS_STATE, onEffectsChange);
    expandFxPanel(container);

    const xyPad = container.querySelector('.xy-pad') as HTMLElement;
    // Top-right corner: x=1.0, y=1.0 (max reverb wet = 0.8, max delay wet = 0.6)
    dragXYPad(xyPad, 80, 0);

    expect(capturedEffects.length).toBe(1);
    expect(capturedEffects[0].reverb.wet).toBeCloseTo(0.8, 1);
    expect(capturedEffects[0].delay.wet).toBeCloseTo(0.6, 1);
  });

  it('no stale closure: second param is not overwritten by first', () => {
    const initialEffects: EffectsState = {
      ...DEFAULT_EFFECTS_STATE,
      reverb: { wet: 0.1, decay: 2.0 },
      delay: { ...DEFAULT_EFFECTS_STATE.delay, wet: 0.1 },
    };

    const { container } = renderTransport(initialEffects, onEffectsChange);
    expandFxPanel(container);

    const xyPad = container.querySelector('.xy-pad') as HTMLElement;
    dragXYPad(xyPad, 60, 20);

    // Both values must be present and different from initial
    expect(capturedEffects.length).toBe(1);
    expect(capturedEffects[0].reverb.wet).not.toBe(0.1);
    expect(capturedEffects[0].delay.wet).not.toBe(0.1);
    // Decay should be unchanged (not part of space-control preset)
    expect(capturedEffects[0].reverb.decay).toBe(2.0);
  });

  it('slider-only update works independently of XY pad', () => {
    const { container } = renderTransport(DEFAULT_EFFECTS_STATE, onEffectsChange);
    expandFxPanel(container);

    // Reverb sliders still work independently
    const sliders = container.querySelectorAll('.fx-param input[type="range"]');
    expect(sliders.length).toBeGreaterThan(0);
  });

  it('commits Envelope Shape once to the selected track while preserving stage units', () => {
    const onEnvelopeV2Change = vi.fn();
    const onEnvelopePreview = vi.fn();
    const track: Track = {
      id: 'selected-track',
      name: 'Selected bass',
      sampleId: 'tone:fm-bass',
      steps: Array(16).fill(false),
      parameterLocks: Array(16).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: 16,
      envelopeV2: {
        model: 'adsr',
        attack: { value: 0.01, unit: 'seconds' },
        decay: { value: 0.2, unit: 'seconds' },
        sustain: 0.7,
        release: { value: 2, unit: 'steps' },
      },
    };
    const { container } = render(
      <Transport
        isPlaying={false}
        tempo={120}
        swing={0}
        onPlayPause={vi.fn()}
        onTempoChange={vi.fn()}
        onSwingChange={vi.fn()}
        effectsState={DEFAULT_EFFECTS_STATE}
        onEffectsChange={onEffectsChange}
        tracks={[track]}
        selectedTrackId={track.id}
        onEnvelopeV2Change={onEnvelopeV2Change}
        onEnvelopePreview={onEnvelopePreview}
      />,
    );
    expandFxPanel(container);
    fireEvent.change(container.querySelector('.xy-preset-select') as HTMLSelectElement, {
      target: { value: 'envelope-shape' },
    });

    const xyPad = container.querySelector('.xy-pad') as HTMLElement;
    dragXYPad(xyPad, 80, 0);

    expect(onEnvelopeV2Change).toHaveBeenCalledOnce();
    expect(onEnvelopePreview.mock.calls.length).toBeGreaterThan(1);
    expect(onEnvelopeV2Change.mock.calls[0][0]).toBe(track.id);
    expect(onEnvelopeV2Change.mock.calls[0][1]).toMatchObject({
      model: 'adsr',
      attack: { value: 4, unit: 'seconds' },
      release: { value: 64, unit: 'steps' },
    });
    expect(capturedEffects).toEqual([]);
  });

  it('gates Envelope Shape when the connected worker lacks envelope v2', () => {
    const onEnvelopeV2Change = vi.fn();
    const track: Track = {
      id: 'legacy-worker-track',
      name: 'Legacy worker track',
      sampleId: 'tone:fm-bass',
      steps: Array(16).fill(false),
      parameterLocks: Array(16).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: 16,
      envelopeV2: {
        model: 'ar',
        attack: { value: 0.01, unit: 'seconds' },
        release: { value: 0.2, unit: 'seconds' },
      },
    };
    const { container } = render(
      <Transport
        isPlaying={false}
        tempo={120}
        swing={0}
        onPlayPause={vi.fn()}
        onTempoChange={vi.fn()}
        onSwingChange={vi.fn()}
        tracks={[track]}
        selectedTrackId={track.id}
        supportsEnvelopeV2={false}
        onEnvelopeV2Change={onEnvelopeV2Change}
      />,
    );
    expandFxPanel(container);
    const preset = container.querySelector('.xy-preset-select') as HTMLSelectElement;
    const envelopeOption = preset.querySelector('option[value="envelope-shape"]') as HTMLOptionElement;
    expect(envelopeOption.disabled).toBe(true);

    fireEvent.change(preset, { target: { value: 'envelope-shape' } });
    expect(preset.value).toBe('space-control');
    expect(onEnvelopeV2Change).not.toHaveBeenCalled();
  });

  it('removes Envelope Shape entirely when envelope authoring is feature-disabled', () => {
    const track: Track = {
      id: 'headless-track', name: 'Headless track', sampleId: 'tone:fm-bass',
      steps: Array(16).fill(false), parameterLocks: Array(16).fill(null),
      volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
      envelopeV2: {
        model: 'ar', attack: { value: 0.01, unit: 'seconds' },
        release: { value: 0.2, unit: 'seconds' },
      },
    };
    const onEnvelopeV2Change = vi.fn();
    const { container } = render(
      <Transport
        isPlaying={false}
        tempo={120}
        swing={0}
        onPlayPause={vi.fn()}
        onTempoChange={vi.fn()}
        onSwingChange={vi.fn()}
        tracks={[track]}
        selectedTrackId={track.id}
        supportsEnvelopeV2
        envelopeEditingEnabled={false}
        onEnvelopeV2Change={onEnvelopeV2Change}
      />,
    );
    expandFxPanel(container);
    const preset = container.querySelector('.xy-preset-select') as HTMLSelectElement;

    expect(preset.querySelector('option[value="envelope-shape"]')).toBeNull();
    fireEvent.change(preset, { target: { value: 'envelope-shape' } });
    expect(preset.value).toBe('space-control');
    expect(onEnvelopeV2Change).not.toHaveBeenCalled();
  });

  it('disables every Envelope Shape control if a rolling connection loses v2 capability', () => {
    const track: Track = {
      id: 'rolling-track', name: 'Rolling track', sampleId: 'tone:fm-bass',
      steps: Array(16).fill(false), parameterLocks: Array(16).fill(null),
      volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
      envelopeV2: {
        model: 'ar',
        attack: { value: 0.01, unit: 'seconds' },
        release: { value: 0.2, unit: 'seconds' },
      },
    };
    const baseProps = {
      isPlaying: false,
      tempo: 120,
      swing: 0,
      onPlayPause: vi.fn(),
      onTempoChange: vi.fn(),
      onSwingChange: vi.fn(),
      tracks: [track],
      selectedTrackId: track.id,
      onEnvelopeV2Change: vi.fn(),
    };
    const view = render(<Transport {...baseProps} supportsEnvelopeV2 />);
    expandFxPanel(view.container);
    fireEvent.change(view.container.querySelector('.xy-preset-select')!, {
      target: { value: 'envelope-shape' },
    });

    view.rerender(<Transport {...baseProps} supportsEnvelopeV2={false} />);

    expect((view.container.querySelector('[aria-label="Envelope target track"]') as HTMLSelectElement).disabled)
      .toBe(true);
    expect(view.container.querySelector('.xy-pad')?.getAttribute('aria-disabled')).toBe('true');
    expect(view.container.textContent).toContain('requires the connected session');
  });
});
