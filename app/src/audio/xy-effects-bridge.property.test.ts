/**
 * Property-based tests for XY Effects Bridge
 *
 * Verifies invariants that must hold for ALL possible XY positions and presets:
 * 1. Batched updates never lose parameters (no stale closure)
 * 2. Values stay within mapped ranges
 * 3. Effect vs synth routing is mutually exclusive
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  XYPadController,
  XY_PAD_PRESETS,
  type XYPadParameter,
} from './xyPad';
import {
  buildBatchedEffectsUpdate,
  type XYParamUpdate,
} from './xy-effects-bridge';
import { isEffectParam, isSynthParam } from './effect-param-mapping';

const PRESET_IDS = Object.keys(XY_PAD_PRESETS);
const presetArb = fc.constantFrom(...PRESET_IDS);
const normalizedArb = fc.double({ min: 0, max: 1, noNaN: true });

import type { EffectsState } from './toneEffects';

const baseEffects: EffectsState = {
  bypass: false,
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

// ─── Range invariants ───────────────────────────────────────────────────

describe('Property: mapped values stay within parameter ranges', () => {
  it('for any preset and position, all values are within [min, max]', () => {
    fc.assert(
      fc.property(presetArb, normalizedArb, normalizedArb, (presetId, x, y) => {
        const controller = new XYPadController(presetId);
        controller.setPosition(x, y);
        const values = controller.getAllParameterValues();
        const preset = XY_PAD_PRESETS[presetId];

        for (const mapping of preset.mappings) {
          const value = values[mapping.parameter];
          expect(value).toBeGreaterThanOrEqual(mapping.min - 0.001);
          expect(value).toBeLessThanOrEqual(mapping.max + 0.001);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ─── Batching invariants ────────────────────────────────────────────────

describe('Property: batched updates preserve all parameters', () => {
  it('every effect param in updates appears in the result', () => {
    fc.assert(
      fc.property(presetArb, normalizedArb, normalizedArb, (presetId, x, y) => {
        const controller = new XYPadController(presetId);
        controller.setPosition(x, y);
        const values = controller.getAllParameterValues();

        const updates: XYParamUpdate[] = Object.entries(values).map(
          ([parameter, value]) => ({ parameter: parameter as XYPadParameter, value })
        );

        const result = buildBatchedEffectsUpdate(baseEffects, updates);

        // Check that every effect-type update was applied
        for (const update of updates) {
          if (isEffectParam(update.parameter)) {
            // The value should appear somewhere in the result
            const found = findEffectValue(result, update.parameter);
            expect(found).toBeCloseTo(update.value, 5);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('untouched effect parameters are never modified', () => {
    fc.assert(
      fc.property(presetArb, normalizedArb, normalizedArb, (presetId, x, y) => {
        const controller = new XYPadController(presetId);
        controller.setPosition(x, y);
        const values = controller.getAllParameterValues();

        const updates: XYParamUpdate[] = Object.entries(values).map(
          ([parameter, value]) => ({ parameter: parameter as XYPadParameter, value })
        );

        const result = buildBatchedEffectsUpdate(baseEffects, updates);

        // Parameters NOT in updates should be unchanged
        const touchedParams = new Set(updates.map(u => u.parameter));

        if (!touchedParams.has('chorusWet')) {
          expect(result.chorus.wet).toBe(baseEffects.chorus.wet);
        }
        if (!touchedParams.has('distortionWet')) {
          expect(result.distortion.wet).toBe(baseEffects.distortion.wet);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ─── Routing exclusivity ────────────────────────────────────────────────

describe('Property: effect and synth routing are mutually exclusive', () => {
  it('every parameter used by a production preset has exactly one destination', () => {
    const parameters = new Set(
      Object.values(XY_PAD_PRESETS).flatMap(preset =>
        preset.mappings.map(mapping => mapping.parameter)),
    );
    expect(parameters.size).toBeGreaterThan(0);
    for (const param of parameters) {
      const isEffect = isEffectParam(param);
      const isSynth = isSynthParam(param);
      expect(isEffect || isSynth).toBe(true);
      expect(isEffect && isSynth).toBe(false);
    }
  });
});

// ─── Helper ─────────────────────────────────────────────────────────────

function findEffectValue(
  effects: typeof baseEffects,
  param: XYPadParameter
): number | undefined {
  switch (param) {
    case 'reverbWet': return effects.reverb.wet;
    case 'reverbDecay': return effects.reverb.decay;
    case 'delayWet': return effects.delay.wet;
    case 'delayFeedback': return effects.delay.feedback;
    case 'chorusWet': return effects.chorus.wet;
    case 'distortionWet': return effects.distortion.wet;
    default: return undefined;
  }
}
