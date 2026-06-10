/**
 * XY Pad ↔ Effects Integration Tests
 *
 * Tests the desired behavior for routing XY pad parameter changes to the
 * audio engine, including:
 *
 * 1. Batched state updates (no stale closure bug)
 * 2. Synth preset wiring (filter, LFO, envelope, oscillator-filter)
 * 3. Reverb XY pad consolidation into generic system
 *
 * Written TDD-style: these tests define the target behavior BEFORE implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  XYPadController,
  XY_PAD_PRESETS,
  type XYPadParameter,
} from './xyPad';
import {
  buildBatchedEffectsUpdate,
  applySynthParam,
  type XYParamUpdate,
  type SynthParamSink,
} from './xy-effects-bridge';

// ─── Batched State Updates ──────────────────────────────────────────────

describe('buildBatchedEffectsUpdate', () => {
  const baseEffects = {
    bypass: false,
    reverb: { decay: 2.0, wet: 0 },
    delay: { time: '8n' as const, feedback: 0.3, wet: 0 },
    chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
    distortion: { amount: 0.4, wet: 0 },
  };

  it('merges multiple effect params into a single state object', () => {
    const updates: XYParamUpdate[] = [
      { parameter: 'reverbWet', value: 0.6 },
      { parameter: 'delayWet', value: 0.4 },
    ];

    const result = buildBatchedEffectsUpdate(baseEffects, updates);

    expect(result.reverb.wet).toBe(0.6);
    expect(result.delay.wet).toBe(0.4);
    // Untouched fields preserved
    expect(result.reverb.decay).toBe(2.0);
    expect(result.delay.feedback).toBe(0.3);
    expect(result.chorus.wet).toBe(0);
  });

  it('handles reverb wet + decay together (replacing bespoke Reverb XY pad)', () => {
    const updates: XYParamUpdate[] = [
      { parameter: 'reverbWet', value: 0.7 },
      { parameter: 'reverbDecay', value: 5.0 },
    ];

    const result = buildBatchedEffectsUpdate(baseEffects, updates);

    expect(result.reverb.wet).toBe(0.7);
    expect(result.reverb.decay).toBe(5.0);
  });

  it('handles delay wet + feedback together', () => {
    const updates: XYParamUpdate[] = [
      { parameter: 'delayWet', value: 0.5 },
      { parameter: 'delayFeedback', value: 0.7 },
    ];

    const result = buildBatchedEffectsUpdate(baseEffects, updates);

    expect(result.delay.wet).toBe(0.5);
    expect(result.delay.feedback).toBe(0.7);
    expect(result.delay.time).toBe('8n'); // Untouched
  });

  it('handles chorus and distortion wet', () => {
    const updates: XYParamUpdate[] = [
      { parameter: 'chorusWet', value: 0.3 },
      { parameter: 'distortionWet', value: 0.2 },
    ];

    const result = buildBatchedEffectsUpdate(baseEffects, updates);

    expect(result.chorus.wet).toBe(0.3);
    expect(result.distortion.wet).toBe(0.2);
  });

  it('returns unchanged state when updates array is empty', () => {
    const result = buildBatchedEffectsUpdate(baseEffects, []);

    expect(result).toEqual(baseEffects);
  });

  it('ignores synth params (they go through applySynthParam, not effects state)', () => {
    const updates: XYParamUpdate[] = [
      { parameter: 'filterFrequency', value: 2000 },
      { parameter: 'reverbWet', value: 0.5 },
    ];

    const result = buildBatchedEffectsUpdate(baseEffects, updates);

    // Only reverbWet applied to effects state; filterFrequency is a synth param
    expect(result.reverb.wet).toBe(0.5);
    // Everything else unchanged
    expect(result.delay.wet).toBe(0);
  });

  it('does not mutate the input effects object', () => {
    const original = JSON.parse(JSON.stringify(baseEffects));
    const updates: XYParamUpdate[] = [
      { parameter: 'reverbWet', value: 0.9 },
    ];

    buildBatchedEffectsUpdate(baseEffects, updates);

    expect(baseEffects).toEqual(original);
  });
});

// ─── Synth Parameter Routing ────────────────────────────────────────────

describe('applySynthParam', () => {
  let mockEngine: SynthParamSink;

  beforeEach(() => {
    mockEngine = {
      setFilterFrequency: vi.fn<(v: number) => void>(),
      setFilterResonance: vi.fn<(v: number) => void>(),
      setLfoRate: vi.fn<(v: number) => void>(),
      setLfoAmount: vi.fn<(v: number) => void>(),
      setAttack: vi.fn<(v: number) => void>(),
      setRelease: vi.fn<(v: number) => void>(),
      setOscMix: vi.fn<(v: number) => void>(),
    };
  });

  it('routes filterFrequency to engine.setFilterFrequency', () => {
    applySynthParam('filterFrequency', 2000, mockEngine);
    expect(mockEngine.setFilterFrequency).toHaveBeenCalledWith(2000);
  });

  it('routes filterResonance to engine.setFilterResonance', () => {
    applySynthParam('filterResonance', 8.5, mockEngine);
    expect(mockEngine.setFilterResonance).toHaveBeenCalledWith(8.5);
  });

  it('routes lfoRate to engine.setLfoRate', () => {
    applySynthParam('lfoRate', 3.0, mockEngine);
    expect(mockEngine.setLfoRate).toHaveBeenCalledWith(3.0);
  });

  it('routes lfoAmount to engine.setLfoAmount', () => {
    applySynthParam('lfoAmount', 0.7, mockEngine);
    expect(mockEngine.setLfoAmount).toHaveBeenCalledWith(0.7);
  });

  it('routes attack to engine.setAttack', () => {
    applySynthParam('attack', 0.1, mockEngine);
    expect(mockEngine.setAttack).toHaveBeenCalledWith(0.1);
  });

  it('routes release to engine.setRelease', () => {
    applySynthParam('release', 1.5, mockEngine);
    expect(mockEngine.setRelease).toHaveBeenCalledWith(1.5);
  });

  it('routes oscMix to engine.setOscMix', () => {
    applySynthParam('oscMix', 0.3, mockEngine);
    expect(mockEngine.setOscMix).toHaveBeenCalledWith(0.3);
  });

  it('does not call any setter for effect params (not synth params)', () => {
    applySynthParam('reverbWet', 0.5, mockEngine);
    for (const fn of Object.values(mockEngine)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

// ─── XYPadController → Batched Update Integration ───────────────────────

describe('XYPadController batched parameter collection', () => {
  it('getAllParameterValues returns both mapped params for space-control', () => {
    const controller = new XYPadController('space-control');
    controller.setPosition(0.8, 0.6);

    const values = controller.getAllParameterValues();

    expect(values.reverbWet).toBeDefined();
    expect(values.delayWet).toBeDefined();
    expect(typeof values.reverbWet).toBe('number');
    expect(typeof values.delayWet).toBe('number');
  });

  it('getAllParameterValues returns filter params for filter-sweep', () => {
    const controller = new XYPadController('filter-sweep');
    controller.setPosition(0.5, 0.5);

    const values = controller.getAllParameterValues();

    expect(values.filterFrequency).toBeDefined();
    expect(values.filterResonance).toBeDefined();
  });

  it('getAllParameterValues returns envelope params for envelope-shape', () => {
    const controller = new XYPadController('envelope-shape');
    controller.setPosition(0.5, 0.5);

    const values = controller.getAllParameterValues();

    expect(values.attack).toBeDefined();
    expect(values.release).toBeDefined();
  });

  it('getAllParameterValues returns lfo params for lfo-control', () => {
    const controller = new XYPadController('lfo-control');
    controller.setPosition(0.5, 0.5);

    const values = controller.getAllParameterValues();

    expect(values.lfoRate).toBeDefined();
    expect(values.lfoAmount).toBeDefined();
  });

  it('getAllParameterValues returns oscMix + filterFrequency for oscillator-filter', () => {
    const controller = new XYPadController('oscillator-filter');
    controller.setPosition(0.5, 0.5);

    const values = controller.getAllParameterValues();

    expect(values.oscMix).toBeDefined();
    expect(values.filterFrequency).toBeDefined();
  });

  it('all presets return exactly 2 parameter values', () => {
    for (const presetId of Object.keys(XY_PAD_PRESETS)) {
      const controller = new XYPadController(presetId);
      controller.setPosition(0.5, 0.5);
      const values = controller.getAllParameterValues();
      expect(Object.keys(values)).toHaveLength(2);
    }
  });
});

// ─── Classifying params as effect vs synth ───────────────────────────────

describe('XYParamUpdate classification', () => {
  const EFFECT_PARAMS: XYPadParameter[] = [
    'reverbWet', 'reverbDecay', 'delayWet', 'delayFeedback', 'chorusWet', 'distortionWet',
  ];
  const SYNTH_PARAMS: XYPadParameter[] = [
    'filterFrequency', 'filterResonance', 'lfoRate', 'lfoAmount',
    'oscMix', 'attack', 'release',
  ];

  it('buildBatchedEffectsUpdate applies all effect params', () => {
    const base = {
      bypass: false,
      reverb: { decay: 2.0, wet: 0 },
      delay: { time: '8n' as const, feedback: 0, wet: 0 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
      distortion: { amount: 0.4, wet: 0 },
    };

    for (const param of EFFECT_PARAMS) {
      const updates: XYParamUpdate[] = [{ parameter: param, value: 0.5 }];
      const result = buildBatchedEffectsUpdate(base, updates);
      // At least one field should differ from base
      expect(result).not.toEqual(base);
    }
  });

  it('buildBatchedEffectsUpdate ignores all synth params', () => {
    const base = {
      bypass: false,
      reverb: { decay: 2.0, wet: 0 },
      delay: { time: '8n' as const, feedback: 0, wet: 0 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
      distortion: { amount: 0.4, wet: 0 },
    };

    for (const param of SYNTH_PARAMS) {
      const updates: XYParamUpdate[] = [{ parameter: param, value: 0.5 }];
      const result = buildBatchedEffectsUpdate(base, updates);
      expect(result).toEqual(base);
    }
  });

  it('applySynthParam routes all synth params', () => {
    const mock: SynthParamSink = {
      setFilterFrequency: vi.fn<(v: number) => void>(),
      setFilterResonance: vi.fn<(v: number) => void>(),
      setLfoRate: vi.fn<(v: number) => void>(),
      setLfoAmount: vi.fn<(v: number) => void>(),
      setAttack: vi.fn<(v: number) => void>(),
      setRelease: vi.fn<(v: number) => void>(),
      setOscMix: vi.fn<(v: number) => void>(),
    };

    for (const param of SYNTH_PARAMS) {
      applySynthParam(param, 1.0, mock);
    }

    for (const fn of Object.values(mock)) {
      expect(fn).toHaveBeenCalledOnce();
    }
  });

  it('applySynthParam ignores all effect params', () => {
    const mock: SynthParamSink = {
      setFilterFrequency: vi.fn<(v: number) => void>(),
      setFilterResonance: vi.fn<(v: number) => void>(),
      setLfoRate: vi.fn<(v: number) => void>(),
      setLfoAmount: vi.fn<(v: number) => void>(),
      setAttack: vi.fn<(v: number) => void>(),
      setRelease: vi.fn<(v: number) => void>(),
      setOscMix: vi.fn<(v: number) => void>(),
    };

    for (const param of EFFECT_PARAMS) {
      applySynthParam(param, 1.0, mock);
    }

    for (const fn of Object.values(mock)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
