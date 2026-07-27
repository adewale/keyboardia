import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  nearestSampleNote,
  selectVelocityGroupBlend,
  validatedLoop,
} from './sample-selection';

const midiNote = fc.integer({ min: 0, max: 127 });
const noteList = fc.uniqueArray(midiNote, { minLength: 1, maxLength: 16 });

describe('nearestSampleNote properties', () => {
  it('always returns a member of the input list', () => {
    fc.assert(
      fc.property(noteList, midiNote, (notes, target) => {
        const chosen = nearestSampleNote(notes, target);
        expect(notes).toContain(chosen);
      })
    );
  });

  it('no other sample is strictly closer (optimality)', () => {
    fc.assert(
      fc.property(noteList, midiNote, (notes, target) => {
        const chosen = nearestSampleNote(notes, target)!;
        const chosenDist = Math.abs(chosen - target);
        for (const n of notes) {
          expect(Math.abs(n - target)).toBeGreaterThanOrEqual(chosenDist);
        }
      })
    );
  });

  it('among equally-close samples, the chosen one is the highest (downshift preference)', () => {
    fc.assert(
      fc.property(noteList, midiNote, (notes, target) => {
        const chosen = nearestSampleNote(notes, target)!;
        const chosenDist = Math.abs(chosen - target);
        const tied = notes.filter(n => Math.abs(n - target) === chosenDist);
        expect(chosen).toBe(Math.max(...tied));
      })
    );
  });
});

/** Generate a contiguous non-overlapping velocity layer split, like real manifests. */
const layerSplit = fc
  .uniqueArray(fc.integer({ min: 1, max: 126 }), { minLength: 0, maxLength: 3 })
  .map(cuts => {
    const bounds = [0, ...cuts.sort((a, b) => a - b), 128];
    const layers = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      layers.push({
        velocityMin: bounds[i],
        velocityMax: bounds[i + 1] - 1,
        file: `layer-${i}`,
      });
    }
    return layers;
  });

describe('selectVelocityGroupBlend properties', () => {
  it('always returns non-negative weights summing to one for contiguous layers', () => {
    fc.assert(fc.property(
      layerSplit,
      fc.integer({ min: 0, max: 127 }),
      fc.integer({ min: 0, max: 32 }),
      (layers, velocity, width) => {
        const blend = selectVelocityGroupBlend(layers, velocity, width);
        expect(blend.length).toBeGreaterThan(0);
        expect(blend.length).toBeLessThanOrEqual(2);
        expect(blend.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 10);
        for (const item of blend) {
          expect(item.weight).toBeGreaterThanOrEqual(0);
          expect(item.weight).toBeLessThanOrEqual(1);
        }
      }
    ));
  });
});

describe('validatedLoop properties', () => {
  it('output is null or a well-formed region: 0 ≤ start, and end (if present) > start', () => {
    const anyNumber = fc.oneof(
      fc.double({ noNaN: false }),
      fc.constant(undefined)
    );
    fc.assert(
      fc.property(fc.boolean(), anyNumber, anyNumber, (loop, loopStart, loopEnd) => {
        const spec = validatedLoop({ loop, loopStart, loopEnd });
        if (spec === null) return;
        expect(loop).toBe(true);
        expect(Number.isFinite(spec.start)).toBe(true);
        expect(spec.start).toBeGreaterThanOrEqual(0);
        if (spec.end !== undefined) {
          expect(Number.isFinite(spec.end)).toBe(true);
          expect(spec.end).toBeGreaterThan(spec.start);
        }
      })
    );
  });
});
