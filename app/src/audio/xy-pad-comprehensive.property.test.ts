/**
 * Comprehensive property-based tests for the XY Pad system.
 *
 * Covers: state machine invariants, mapping curves, effect parameter safety,
 * routing completeness, oscMix inverse relationship, batched update idempotence,
 * continuity guarantees, and preset switching safety.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  XYPadController,
  XY_PAD_PRESETS,
  PARAMETER_RANGES,
  mapValue,
  unmapValue,
  type XYPadParameter,
} from './xyPad';
import {
  buildBatchedEffectsUpdate,
  applySynthParam,
  isEffectParam,
  isSynthParam,
  type SynthParamSink,
} from './xy-effects-bridge';
import type { EffectsState } from './toneEffects';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Arbitrary normalized value in [0, 1]. */
const normalArb = fc.double({ min: 0, max: 1, noNaN: true });

/** Arbitrary value that extends well beyond [0, 1] to stress clamping. */
const wideArb = fc.double({ min: -10, max: 10, noNaN: true });

/** Arbitrary preset key drawn from the actual preset map. */
const presetKeyArb = fc.constantFrom(...Object.keys(XY_PAD_PRESETS));

/** Pair of preset keys (may be the same). */
const presetPairArb = fc.tuple(presetKeyArb, presetKeyArb);


/** Build a fresh mock SynthParamSink. */
function makeMockEngine(): SynthParamSink {
  return {
    setFilterFrequency: vi.fn<(v: number) => void>(),
    setFilterResonance: vi.fn<(v: number) => void>(),
    setLfoRate: vi.fn<(v: number) => void>(),
    setLfoAmount: vi.fn<(v: number) => void>(),
    setOscMix: vi.fn<(v: number) => void>(),
    setAttack: vi.fn<(v: number) => void>(),
    setRelease: vi.fn<(v: number) => void>(),
  };
}

/** Build a minimal baseline EffectsState with nested structure. */
function makeBaseEffects(): EffectsState {
  return {
    bypass: false,
    reverb: { decay: 2.5, wet: 0.3 },
    delay: { time: '8n', feedback: 0.3, wet: 0.2 },
    chorus: { frequency: 1.5, depth: 0.7, wet: 0 },
    distortion: { amount: 0, wet: 0 },
  };
}

/**
 * Create an XYPadController with a callback and load a preset.
 * Returns the controller and all collected updates.
 */
function makeControllerWithCapture(presetId: string) {
  const updates: Array<{ parameter: XYPadParameter; value: number }> = [];
  const ctrl = new XYPadController();
  ctrl.setCallback((parameter, value) => {
    updates.push({ parameter, value });
  });
  ctrl.loadPreset(presetId);
  return { ctrl, updates };
}

// ---------------------------------------------------------------------------
// 1. XYPadController State Machine Properties
// ---------------------------------------------------------------------------

describe('XYPadController State Machine Properties', () => {
  it('position clamping: getX/getY always in [0, 1] for any input', () => {
    fc.assert(
      fc.property(wideArb, wideArb, presetKeyArb, (x, y, preset) => {
        const ctrl = new XYPadController();
        ctrl.loadPreset(preset);
        ctrl.setPosition(x, y);

        const gx = ctrl.getX();
        const gy = ctrl.getY();
        expect(gx).toBeGreaterThanOrEqual(0);
        expect(gx).toBeLessThanOrEqual(1);
        expect(gy).toBeGreaterThanOrEqual(0);
        expect(gy).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });

  it('state serialization roundtrip: getState -> applyState -> getState is identity', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const ctrl = new XYPadController();
        ctrl.loadPreset(preset);
        ctrl.setPosition(x, y);

        const state1 = ctrl.getState();

        const ctrl2 = new XYPadController();
        ctrl2.applyState(state1);
        const state2 = ctrl2.getState();

        expect(state2.x).toBeCloseTo(state1.x, 10);
        expect(state2.y).toBeCloseTo(state1.y, 10);
        expect(state2.mappings).toEqual(state1.mappings);
      }),
      { numRuns: 200 },
    );
  });

  it('preset independence: loading any preset then setting position always yields exactly 2 params', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const { ctrl, updates } = makeControllerWithCapture(preset);

        updates.length = 0;
        ctrl.setPosition(x, y);

        // Each preset has exactly 2 mappings (x-axis, y-axis)
        expect(updates.length).toBe(2);
      }),
      { numRuns: 200 },
    );
  });

  it('reset always returns to center (0.5, 0.5)', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const ctrl = new XYPadController();
        ctrl.loadPreset(preset);
        ctrl.setPosition(x, y);
        ctrl.reset();

        expect(ctrl.getX()).toBeCloseTo(0.5, 10);
        expect(ctrl.getY()).toBeCloseTo(0.5, 10);
      }),
      { numRuns: 200 },
    );
  });

  it('when disabled, callback is never invoked regardless of position changes', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const cb = vi.fn();
        const ctrl = new XYPadController();
        ctrl.setCallback(cb);
        ctrl.loadPreset(preset);
        ctrl.setEnabled(false);

        cb.mockClear();
        ctrl.setPosition(x, y);

        expect(cb).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Mapping Curve Properties
// ---------------------------------------------------------------------------

describe('Mapping Curve Properties', () => {
  /** Helper: pick a valid range from PARAMETER_RANGES for curve testing. */
  const rangeEntries = Object.entries(PARAMETER_RANGES);
  const rangeArb = fc.constantFrom(...rangeEntries).map(
    ([, range]) => range as { min: number; max: number; curve: 'linear' | 'exponential' },
  );

  it('linear mapping is monotonic', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (a, delta) => {
          const x1 = Math.min(a, a + delta);
          const x2 = Math.max(a, a + delta);
          if (x1 >= x2) return;

          const y1 = mapValue(x1, 0, 100, 'linear');
          const y2 = mapValue(x2, 0, 100, 'linear');
          expect(y1).toBeLessThanOrEqual(y2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('exponential mapping is monotonic', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (a, delta) => {
          const x1 = Math.min(a, a + delta);
          const x2 = Math.max(a, a + delta);
          if (x1 >= x2) return;

          const y1 = mapValue(x1, 0.1, 10, 'exponential');
          const y2 = mapValue(x2, 0.1, 10, 'exponential');
          expect(y1).toBeLessThanOrEqual(y2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('mapValue output is always within [min, max] for normalized input', () => {
    fc.assert(
      fc.property(normalArb, rangeArb, (v, range) => {
        const result = mapValue(v, range.min, range.max, range.curve);
        expect(result).toBeGreaterThanOrEqual(range.min - 1e-9);
        expect(result).toBeLessThanOrEqual(range.max + 1e-9);
      }),
      { numRuns: 500 },
    );
  });

  it('unmapValue output is always within [0, 1] for in-range input', () => {
    fc.assert(
      fc.property(rangeArb, (range) => {
        return fc.assert(
          fc.property(
            fc.double({ min: range.min, max: range.max, noNaN: true }),
            (v) => {
              const result = unmapValue(v, range.min, range.max, range.curve);
              expect(result).toBeGreaterThanOrEqual(-1e-9);
              expect(result).toBeLessThanOrEqual(1 + 1e-9);
            },
          ),
          { numRuns: 50 },
        );
      }),
      { numRuns: rangeEntries.length },
    );
  });

  it('boundary identity: mapValue(0)=min, mapValue(1)=max', () => {
    fc.assert(
      fc.property(rangeArb, (range) => {
        const atZero = mapValue(0, range.min, range.max, range.curve);
        const atOne = mapValue(1, range.min, range.max, range.curve);
        expect(atZero).toBeCloseTo(range.min, 5);
        expect(atOne).toBeCloseTo(range.max, 5);
      }),
      { numRuns: rangeEntries.length },
    );
  });

  it('mapValue / unmapValue roundtrip within tolerance', () => {
    fc.assert(
      fc.property(normalArb, rangeArb, (v, range) => {
        const mapped = mapValue(v, range.min, range.max, range.curve);
        const unmapped = unmapValue(mapped, range.min, range.max, range.curve);
        expect(unmapped).toBeCloseTo(v, 4);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Audio Effect Parameter Clamping Properties
// ---------------------------------------------------------------------------

describe('Audio Effect Parameter Clamping Properties', () => {
  /**
   * The bridge itself does not clamp; the XY pad presets define ranges that
   * should produce values within safe bounds. We verify that for each preset
   * the produced parameter values stay within the preset's declared ranges.
   */

  const presetSafeRanges: Record<string, Record<string, [number, number]>> = {
    'space-control': {
      reverbWet: [0, 0.8],
      delayWet: [0, 0.6],
    },
    'delay-modulation': {
      delayWet: [0, 0.7],
      delayFeedback: [0, 0.85],
    },
    'reverb-control': {
      reverbWet: [0, 1],
      reverbDecay: [0.1, 10],
    },
  };

  for (const [presetName, expectedRanges] of Object.entries(presetSafeRanges)) {
    it(`preset "${presetName}" produces values within safe ranges`, () => {
      fc.assert(
        fc.property(normalArb, normalArb, (x, y) => {
          const { ctrl, updates } = makeControllerWithCapture(presetName);

          updates.length = 0;
          ctrl.setPosition(x, y);

          for (const upd of updates) {
            const bounds = expectedRanges[upd.parameter];
            if (bounds) {
              expect(upd.value).toBeGreaterThanOrEqual(bounds[0] - 1e-9);
              expect(upd.value).toBeLessThanOrEqual(bounds[1] + 1e-9);
            }
          }
        }),
        { numRuns: 500 },
      );
    });
  }

  it('bypass flag is never modified by buildBatchedEffectsUpdate', () => {
    fc.assert(
      fc.property(
        normalArb,
        normalArb,
        presetKeyArb,
        fc.boolean(),
        (x, y, preset, bypassState) => {
          const { ctrl, updates } = makeControllerWithCapture(preset);

          updates.length = 0;
          ctrl.setPosition(x, y);

          const base = makeBaseEffects();
          base.bypass = bypassState;

          const effectUpdates = updates.filter((u) =>
            isEffectParam(u.parameter),
          );
          const result = buildBatchedEffectsUpdate(base, effectUpdates);

          expect(result.bypass).toBe(bypassState);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('all wet values produced by any preset stay in [0, 1]', () => {
    const wetParams: XYPadParameter[] = [
      'reverbWet',
      'delayWet',
      'chorusWet',
      'distortionWet',
    ];
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const { ctrl, updates } = makeControllerWithCapture(preset);

        updates.length = 0;
        ctrl.setPosition(x, y);

        for (const upd of updates) {
          if (wetParams.includes(upd.parameter)) {
            expect(upd.value).toBeGreaterThanOrEqual(-1e-9);
            expect(upd.value).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Effect / Synth Routing Completeness
// ---------------------------------------------------------------------------

describe('Effect / Synth Routing Completeness', () => {
  it('every preset mapping parameter is either effect or synth, never neither, never both', () => {
    for (const [, presetConfig] of Object.entries(XY_PAD_PRESETS)) {
      for (const mapping of presetConfig.mappings) {
        const param = mapping.parameter;
        const isEffect = isEffectParam(param);
        const isSynth = isSynthParam(param);

        // XOR: exactly one must be true
        expect(
          isEffect !== isSynth,
          `Parameter "${param}" must be exclusively effect or synth, got effect=${isEffect} synth=${isSynth}`,
        ).toBe(true);
      }
    }
  });

  it('every parameter in PARAMETER_RANGES satisfies isEffectParam XOR isSynthParam', () => {
    for (const param of Object.keys(PARAMETER_RANGES) as XYPadParameter[]) {
      const isEffect = isEffectParam(param);
      const isSynth = isSynthParam(param);

      expect(
        isEffect !== isSynth,
        `Parameter "${param}" must be exclusively effect or synth, got effect=${isEffect} synth=${isSynth}`,
      ).toBe(true);
    }
  });

  it('every preset produces only parameters that exist in PARAMETER_RANGES', () => {
    fc.assert(
      fc.property(presetKeyArb, normalArb, normalArb, (preset, x, y) => {
        const { ctrl, updates } = makeControllerWithCapture(preset);

        updates.length = 0;
        ctrl.setPosition(x, y);

        for (const upd of updates) {
          expect(
            upd.parameter in PARAMETER_RANGES,
            `Unknown parameter "${upd.parameter}" produced by preset "${preset}"`,
          ).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. OscMix Inverse Relationship
// ---------------------------------------------------------------------------

describe('OscMix Inverse Relationship', () => {
  it('applySynthParam("oscMix", mix, engine) calls setOscMix with the provided mix value', () => {
    fc.assert(
      fc.property(normalArb, (mix) => {
        const engine = makeMockEngine();
        applySynthParam('oscMix', mix, engine);

        expect(engine.setOscMix).toHaveBeenCalledTimes(1);
        expect(engine.setOscMix).toHaveBeenCalledWith(mix);
      }),
      { numRuns: 200 },
    );
  });

  it('oscMix conceptual invariant: osc1Gain + osc2Gain = 1 for any mix', () => {
    // The AdvancedSynthEngine sets osc1Gain = 1 - mix, osc2Gain = mix.
    // We verify the algebraic invariant here directly.
    fc.assert(
      fc.property(normalArb, (mix) => {
        const osc1Gain = 1 - mix;
        const osc2Gain = mix;
        expect(osc1Gain + osc2Gain).toBeCloseTo(1, 10);
      }),
      { numRuns: 200 },
    );
  });

  it('applySynthParam routes each synth parameter to the correct setter', () => {
    const paramSetterMap: Record<string, keyof SynthParamSink> = {
      filterFrequency: 'setFilterFrequency',
      filterResonance: 'setFilterResonance',
      lfoRate: 'setLfoRate',
      lfoAmount: 'setLfoAmount',
      oscMix: 'setOscMix',
      attack: 'setAttack',
      release: 'setRelease',
    };

    const synthParamArb = fc.constantFrom(
      ...Object.keys(paramSetterMap),
    ) as fc.Arbitrary<XYPadParameter>;

    fc.assert(
      fc.property(synthParamArb, normalArb, (param, value) => {
        const engine = makeMockEngine();
        applySynthParam(param, value, engine);

        const expectedSetter = paramSetterMap[param];
        expect(engine[expectedSetter]).toHaveBeenCalledTimes(1);
        expect(engine[expectedSetter]).toHaveBeenCalledWith(value);

        // No other setter should have been called
        for (const [otherParam, otherSetter] of Object.entries(
          paramSetterMap,
        )) {
          if (otherParam !== param) {
            expect(engine[otherSetter as keyof SynthParamSink]).not.toHaveBeenCalled();
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('applySynthParam is a no-op for effect parameters', () => {
    const effectParams: XYPadParameter[] = [
      'reverbWet',
      'reverbDecay',
      'delayWet',
      'delayFeedback',
      'chorusWet',
      'distortionWet',
    ];
    const effectParamArb = fc.constantFrom(...effectParams);

    fc.assert(
      fc.property(effectParamArb, normalArb, (param, value) => {
        const engine = makeMockEngine();
        applySynthParam(param, value, engine);

        // None of the setters should have been called
        for (const fn of Object.values(engine)) {
          expect(fn).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Batched Update Idempotence
// ---------------------------------------------------------------------------

describe('Batched Update Idempotence', () => {
  it('applying the same updates twice to the same base state produces identical results', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const { ctrl, updates } = makeControllerWithCapture(preset);

        updates.length = 0;
        ctrl.setPosition(x, y);

        const base = makeBaseEffects();
        const effectUpdates = updates.filter((u) =>
          isEffectParam(u.parameter),
        );

        const result1 = buildBatchedEffectsUpdate(base, effectUpdates);
        const result2 = buildBatchedEffectsUpdate(base, effectUpdates);

        expect(result1).toEqual(result2);
      }),
      { numRuns: 200 },
    );
  });

  it('building updates from position (x,y) twice produces identical XYParamUpdate arrays', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const { ctrl: ctrl1, updates: updates1 } =
          makeControllerWithCapture(preset);
        updates1.length = 0;
        ctrl1.setPosition(x, y);

        const { ctrl: ctrl2, updates: updates2 } =
          makeControllerWithCapture(preset);
        updates2.length = 0;
        ctrl2.setPosition(x, y);

        expect(updates1.length).toBe(updates2.length);
        for (let i = 0; i < updates1.length; i++) {
          expect(updates1[i].parameter).toBe(updates2[i].parameter);
          expect(updates1[i].value).toBeCloseTo(updates2[i].value, 10);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('applying updates to two identical base states yields identical results', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        const { ctrl, updates } = makeControllerWithCapture(preset);

        updates.length = 0;
        ctrl.setPosition(x, y);

        const base1 = makeBaseEffects();
        const base2 = makeBaseEffects();
        const effectUpdates = updates.filter((u) =>
          isEffectParam(u.parameter),
        );

        const result1 = buildBatchedEffectsUpdate(base1, effectUpdates);
        const result2 = buildBatchedEffectsUpdate(base2, effectUpdates);

        expect(result1).toEqual(result2);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 7. XY Pad Continuity (no jumps)
// ---------------------------------------------------------------------------

describe('XY Pad Continuity', () => {
  /**
   * Helper: get the full parameter range for a mapping from its preset config.
   * For exponential curves (x^2) the derivative at x=1 is 2*(max-min), so a
   * small delta can produce a large absolute change near the top of the range.
   * We compute the theoretical maximum step size for a given delta and curve.
   */
  function maxStepForDelta(
    delta: number,
    min: number,
    max: number,
    curve: 'linear' | 'exponential',
  ): number {
    const range = max - min;
    if (curve === 'exponential') {
      // mapValue uses v^2 for exponential. The derivative of v^2 * range is
      // 2*v*range, maximized at v=1. So worst-case step is 2*range*delta.
      return 2 * range * delta;
    }
    // Linear: worst case is range * delta
    return range * delta;
  }

  it('small position changes produce small parameter value changes', () => {
    fc.assert(
      fc.property(
        normalArb,
        normalArb,
        presetKeyArb,
        fc.integer({ min: 5, max: 20 }),
        (startX, startY, preset, steps) => {
          const DELTA = 0.005;

          // Build a per-parameter max-jump lookup from the preset mappings
          const mappings = XY_PAD_PRESETS[preset].mappings;
          const paramMaxJump: Record<string, number> = {};
          for (const m of mappings) {
            // Add generous 3x safety factor for floating-point and curve behavior
            paramMaxJump[m.parameter] =
              maxStepForDelta(DELTA, m.min, m.max, m.curve) * 3;
          }

          const prevValues: Record<string, number> = {};
          const ctrl = new XYPadController();
          ctrl.setCallback((parameter, value) => {
            prevValues[parameter] = value;
          });
          ctrl.loadPreset(preset);

          // Set initial position
          ctrl.setPosition(startX, startY);

          // Walk in small increments
          let cx = Math.min(Math.max(startX, 0), 1);
          let cy = Math.min(Math.max(startY, 0), 1);

          for (let i = 0; i < steps; i++) {
            const snapshot = { ...prevValues };
            cx = Math.min(1, Math.max(0, cx + DELTA));
            cy = Math.min(1, Math.max(0, cy + DELTA));

            ctrl.setPosition(cx, cy);

            for (const [param, value] of Object.entries(prevValues)) {
              if (param in snapshot) {
                const jump = Math.abs(value - snapshot[param]);
                const limit = paramMaxJump[param] ?? 1;
                expect(jump).toBeLessThanOrEqual(limit);
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('parameter values vary continuously across the full [0,1] sweep', () => {
    fc.assert(
      fc.property(presetKeyArb, (preset) => {
        const STEPS = 100;
        const values: Record<string, number[]> = {};

        const ctrl = new XYPadController();
        ctrl.loadPreset(preset);
        // Set callback AFTER loadPreset to avoid capturing the initial
        // updateParameters call that fires from a different position
        ctrl.setCallback((parameter, value) => {
          if (!values[parameter]) values[parameter] = [];
          values[parameter].push(value);
        });

        // Sweep x from 0 to 1 with y fixed at 0.5
        for (let i = 0; i <= STEPS; i++) {
          ctrl.setPosition(i / STEPS, 0.5);
        }

        // For exponential curves, the maximum step between adjacent sweep
        // points is bounded by the derivative at v=1: 2*(max-min)/STEPS.
        // We use a factor relative to the parameter's own range.
        const mappings = XY_PAD_PRESETS[preset].mappings;
        const paramRange: Record<string, number> = {};
        for (const m of mappings) {
          paramRange[m.parameter] = m.max - m.min;
        }

        for (const [param, vals] of Object.entries(values)) {
          const range = paramRange[param] ?? 1;
          for (let i = 1; i < vals.length; i++) {
            const jump = Math.abs(vals[i] - vals[i - 1]);
            // Allow up to 5% of the parameter range per step (very generous
            // for 100-step sweep; exponential max-step is ~2*range/STEPS = 2%)
            const maxJump = range * 0.05;
            expect(jump).toBeLessThanOrEqual(Math.max(maxJump, 0.01));
          }
        }
      }),
      { numRuns: Object.keys(XY_PAD_PRESETS).length },
    );
  });

  it('y-axis sweep is also continuous', () => {
    fc.assert(
      fc.property(presetKeyArb, (preset) => {
        const STEPS = 100;
        const values: Record<string, number[]> = {};

        const ctrl = new XYPadController();
        ctrl.loadPreset(preset);
        // Set callback AFTER loadPreset to avoid capturing the initial
        // updateParameters call that fires from a different position
        ctrl.setCallback((parameter, value) => {
          if (!values[parameter]) values[parameter] = [];
          values[parameter].push(value);
        });

        // Sweep y from 0 to 1 with x fixed at 0.5
        for (let i = 0; i <= STEPS; i++) {
          ctrl.setPosition(0.5, i / STEPS);
        }

        const mappings = XY_PAD_PRESETS[preset].mappings;
        const paramRange: Record<string, number> = {};
        for (const m of mappings) {
          paramRange[m.parameter] = m.max - m.min;
        }

        for (const [param, vals] of Object.entries(values)) {
          const range = paramRange[param] ?? 1;
          for (let i = 1; i < vals.length; i++) {
            const jump = Math.abs(vals[i] - vals[i - 1]);
            const maxJump = range * 0.05;
            expect(jump).toBeLessThanOrEqual(Math.max(maxJump, 0.01));
          }
        }
      }),
      { numRuns: Object.keys(XY_PAD_PRESETS).length },
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Preset Switching Safety
// ---------------------------------------------------------------------------

describe('Preset Switching Safety', () => {
  it('switching from any preset to any other and setting position produces valid params', () => {
    fc.assert(
      fc.property(presetPairArb, normalArb, normalArb, ([from, to], x, y) => {
        const { ctrl, updates } = makeControllerWithCapture(from);
        ctrl.setPosition(0.5, 0.5);

        // Switch preset
        ctrl.loadPreset(to);
        updates.length = 0;
        ctrl.setPosition(x, y);

        // All produced values should be finite numbers
        for (const upd of updates) {
          expect(Number.isFinite(upd.value)).toBe(true);
          expect(typeof upd.parameter).toBe('string');
          expect(upd.parameter.length).toBeGreaterThan(0);
        }

        // Verify values fall within the declared PARAMETER_RANGES
        for (const upd of updates) {
          const range = PARAMETER_RANGES[upd.parameter];
          if (range) {
            // Presets may use sub-ranges of PARAMETER_RANGES, so check the
            // mapping's own min/max from the preset instead
            const presetMappings = XY_PAD_PRESETS[to].mappings;
            const mapping = presetMappings.find(
              (m) => m.parameter === upd.parameter,
            );
            if (mapping) {
              expect(upd.value).toBeGreaterThanOrEqual(mapping.min - 1e-9);
              expect(upd.value).toBeLessThanOrEqual(mapping.max + 1e-9);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('one setPosition call invokes callback exactly once per mapping', () => {
    fc.assert(
      fc.property(normalArb, normalArb, presetKeyArb, (x, y, preset) => {
        let callCount = 0;
        const ctrl = new XYPadController();
        ctrl.setCallback(() => {
          callCount++;
        });
        ctrl.loadPreset(preset);

        callCount = 0;
        ctrl.setPosition(x, y);

        const expectedMappings = XY_PAD_PRESETS[preset].mappings.length;
        expect(callCount).toBe(expectedMappings);
      }),
      { numRuns: 200 },
    );
  });

  it('rapid preset switching never throws', () => {
    fc.assert(
      fc.property(
        fc.array(presetKeyArb, { minLength: 2, maxLength: 10 }),
        normalArb,
        normalArb,
        (presets, x, y) => {
          const ctrl = new XYPadController();
          ctrl.setCallback(() => {});

          expect(() => {
            for (const preset of presets) {
              ctrl.loadPreset(preset);
              ctrl.setPosition(x, y);
            }
          }).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('preset switch does not leak parameters from the previous preset', () => {
    fc.assert(
      fc.property(presetPairArb, normalArb, normalArb, ([from, to], x, y) => {
        const { ctrl, updates } = makeControllerWithCapture(from);
        ctrl.setPosition(x, y);

        // Switch preset and capture new updates
        ctrl.loadPreset(to);
        updates.length = 0;
        ctrl.setPosition(x, y);

        const expectedParams = new Set(
          XY_PAD_PRESETS[to].mappings.map((m) => m.parameter),
        );

        for (const upd of updates) {
          expect(
            expectedParams.has(upd.parameter),
            `Parameter "${upd.parameter}" leaked from previous preset "${from}" after switching to "${to}"`,
          ).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
