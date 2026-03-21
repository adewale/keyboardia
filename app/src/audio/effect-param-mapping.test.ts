/**
 * Routing Consistency Tests for Effect Parameter Mapping
 *
 * Verifies that the shared EFFECT_PARAM_MAP is consistent:
 * - Every effect param has a mapping
 * - Effect and synth classification is mutually exclusive and exhaustive
 * - Mapping covers all known XY pad effect parameters
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { XYPadParameter } from './xyPad';
import {
  EFFECT_PARAM_MAP,
  EFFECT_PARAMS,
  SYNTH_PARAMS,
  isEffectParam,
  isSynthParam,
} from './effect-param-mapping';

const ALL_XY_PARAMS: XYPadParameter[] = [
  'filterFrequency', 'filterResonance', 'lfoRate', 'lfoAmount',
  'oscMix', 'attack', 'release',
  'reverbWet', 'reverbDecay', 'delayWet', 'delayFeedback', 'chorusWet', 'distortionWet',
];

describe('EFFECT_PARAM_MAP consistency', () => {
  it('every EFFECT_PARAMS member has a mapping in EFFECT_PARAM_MAP', () => {
    for (const param of EFFECT_PARAMS) {
      expect(EFFECT_PARAM_MAP[param]).toBeDefined();
    }
  });

  it('every EFFECT_PARAM_MAP key is in EFFECT_PARAMS', () => {
    for (const key of Object.keys(EFFECT_PARAM_MAP)) {
      expect(EFFECT_PARAMS.has(key as XYPadParameter)).toBe(true);
    }
  });

  it('EFFECT_PARAM_MAP entries reference valid effect names', () => {
    const validEffects = new Set(['reverb', 'delay', 'chorus', 'distortion']);
    for (const [, mapping] of Object.entries(EFFECT_PARAM_MAP)) {
      expect(validEffects.has(mapping!.effect)).toBe(true);
    }
  });
});

describe('classification is mutually exclusive and exhaustive', () => {
  it('every XYPadParameter is either effect or synth, never both', () => {
    for (const param of ALL_XY_PARAMS) {
      const isEffect = isEffectParam(param);
      const isSynth = isSynthParam(param);
      expect(isEffect || isSynth).toBe(true);
      expect(isEffect && isSynth).toBe(false);
    }
  });

  it('EFFECT_PARAMS and SYNTH_PARAMS have no overlap', () => {
    for (const param of EFFECT_PARAMS) {
      expect(SYNTH_PARAMS.has(param)).toBe(false);
    }
    for (const param of SYNTH_PARAMS) {
      expect(EFFECT_PARAMS.has(param)).toBe(false);
    }
  });

  it('EFFECT_PARAMS + SYNTH_PARAMS covers all known XY params', () => {
    for (const param of ALL_XY_PARAMS) {
      expect(EFFECT_PARAMS.has(param) || SYNTH_PARAMS.has(param)).toBe(true);
    }
  });
});

describe('PBT: random XYPadParameter classification', () => {
  const paramArb = fc.constantFrom(...ALL_XY_PARAMS);

  it('isEffectParam and isSynthParam are consistent with sets', () => {
    fc.assert(
      fc.property(paramArb, (param) => {
        expect(isEffectParam(param)).toBe(EFFECT_PARAMS.has(param));
        expect(isSynthParam(param)).toBe(SYNTH_PARAMS.has(param));
      }),
      { numRuns: 200 }
    );
  });

  it('effect params always have a mapping entry', () => {
    fc.assert(
      fc.property(paramArb, (param) => {
        if (isEffectParam(param)) {
          expect(EFFECT_PARAM_MAP[param]).toBeDefined();
        }
      }),
      { numRuns: 200 }
    );
  });
});
