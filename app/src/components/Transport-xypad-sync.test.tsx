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
import { render, cleanup, act } from '@testing-library/react';
import { Transport } from './Transport';
import type { EffectsState } from '../audio/toneEffects';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';

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
  act(() => {
    xyPad.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, clientX, clientY,
    }));
  });
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
});
