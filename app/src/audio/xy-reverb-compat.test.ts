/**
 * Backward Compatibility: Old Reverb XY Pad → New reverb-control Preset
 *
 * The old bespoke handleReverbXY did:
 *   wet = x                    (identity)
 *   decay = 0.1 + y * 9.9     (linear map from [0,1] → [0.1, 10])
 *
 * The new reverb-control preset should produce identical values.
 * Existing sessions that relied on the old mapping must behave the same.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { XYPadController } from './xyPad';
import { buildBatchedEffectsUpdate, type XYParamUpdate } from './xy-effects-bridge';
import type { EffectsState } from './toneEffects';

/**
 * The old handleReverbXY mapping (extracted verbatim from the deleted code)
 */
function oldHandleReverbXY(x: number, y: number) {
  const wet = x;
  const decay = 0.1 + y * 9.9;
  return { wet, decay };
}

const baseEffects: EffectsState = {
  bypass: false,
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

describe('Reverb XY Pad backward compatibility', () => {
  const normalizedArb = fc.double({ min: 0, max: 1, noNaN: true });

  it('reverb-control preset produces identical wet values to old handleReverbXY', () => {
    fc.assert(
      fc.property(normalizedArb, normalizedArb, (x, y) => {
        const old = oldHandleReverbXY(x, y);

        const controller = new XYPadController('reverb-control');
        controller.setPosition(x, y);
        const values = controller.getAllParameterValues();

        expect(values.reverbWet).toBeCloseTo(old.wet, 10);
      }),
      { numRuns: 500 }
    );
  });

  it('reverb-control preset produces identical decay values to old handleReverbXY', () => {
    fc.assert(
      fc.property(normalizedArb, normalizedArb, (x, y) => {
        const old = oldHandleReverbXY(x, y);

        const controller = new XYPadController('reverb-control');
        controller.setPosition(x, y);
        const values = controller.getAllParameterValues();

        expect(values.reverbDecay).toBeCloseTo(old.decay, 10);
      }),
      { numRuns: 500 }
    );
  });

  it('batched state update produces same effects state as old handler', () => {
    fc.assert(
      fc.property(normalizedArb, normalizedArb, (x, y) => {
        const old = oldHandleReverbXY(x, y);

        // Simulate what old handleReverbXY did to state
        const oldState = {
          ...baseEffects,
          reverb: { ...baseEffects.reverb, wet: old.wet, decay: old.decay },
        };

        // Simulate what new system does
        const controller = new XYPadController('reverb-control');
        controller.setPosition(x, y);
        const values = controller.getAllParameterValues();

        const updates: XYParamUpdate[] = Object.entries(values).map(
          ([parameter, value]) => ({ parameter: parameter as XYParamUpdate['parameter'], value })
        );
        const newState = buildBatchedEffectsUpdate(baseEffects, updates);

        // Final effects states should be identical
        expect(newState.reverb.wet).toBeCloseTo(oldState.reverb.wet, 10);
        expect(newState.reverb.decay).toBeCloseTo(oldState.reverb.decay, 10);

        // All other effect fields untouched
        expect(newState.delay).toEqual(oldState.delay);
        expect(newState.chorus).toEqual(oldState.chorus);
        expect(newState.distortion).toEqual(oldState.distortion);
      }),
      { numRuns: 500 }
    );
  });

  it('edge case: (0, 0) → wet=0, decay=0.1', () => {
    const old = oldHandleReverbXY(0, 0);
    const controller = new XYPadController('reverb-control');
    controller.setPosition(0, 0);
    const values = controller.getAllParameterValues();

    expect(values.reverbWet).toBe(old.wet);      // 0
    expect(values.reverbDecay).toBe(old.decay);   // 0.1
  });

  it('edge case: (1, 1) → wet=1, decay=10', () => {
    const old = oldHandleReverbXY(1, 1);
    const controller = new XYPadController('reverb-control');
    controller.setPosition(1, 1);
    const values = controller.getAllParameterValues();

    expect(values.reverbWet).toBe(old.wet);      // 1
    expect(values.reverbDecay).toBe(old.decay);   // 10
  });

  it('edge case: (0.5, 0.5) → wet=0.5, decay≈5.05', () => {
    const old = oldHandleReverbXY(0.5, 0.5);
    const controller = new XYPadController('reverb-control');
    controller.setPosition(0.5, 0.5);
    const values = controller.getAllParameterValues();

    expect(values.reverbWet).toBeCloseTo(old.wet, 10);
    expect(values.reverbDecay).toBeCloseTo(old.decay, 10);
  });

  it('space-control preset is unchanged (not affected by reverb-control addition)', () => {
    const controller = new XYPadController('space-control');
    controller.setPosition(0.5, 0.5);
    const values = controller.getAllParameterValues();

    // space-control maps x→reverbWet [0, 0.8], y→delayWet [0, 0.6]
    expect(values.reverbWet).toBeCloseTo(0.4, 5);  // 0.5 * 0.8
    expect(values.delayWet).toBeCloseTo(0.3, 5);    // 0.5 * 0.6
    expect(values.reverbDecay).toBeUndefined();
  });
});
