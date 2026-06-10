/**
 * Property-Based Tests for RingBuffer
 *
 * Verifies structural invariants of the circular buffer:
 * - Capacity bounds are never exceeded
 * - Insertion order is preserved
 * - Overflow evicts oldest first (FIFO)
 * - last() always returns the most recent push
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ring-buffer';

// ─── Arbitraries ────────────────────────────────────────────────────────

const arbCapacity = fc.integer({ min: 1, max: 100 });
const arbValues = fc.array(fc.integer(), { minLength: 0, maxLength: 500 });

// ─── Properties ─────────────────────────────────────────────────────────

describe('RingBuffer properties', () => {
  it('size never exceeds capacity', () => {
    fc.assert(
      fc.property(arbCapacity, arbValues, (capacity, values) => {
        const buf = new RingBuffer<number>(capacity);
        for (const v of values) {
          buf.push(v);
          expect(buf.size()).toBeLessThanOrEqual(capacity);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('size equals min(pushCount, capacity)', () => {
    fc.assert(
      fc.property(arbCapacity, arbValues, (capacity, values) => {
        const buf = new RingBuffer<number>(capacity);
        for (const v of values) buf.push(v);
        expect(buf.size()).toBe(Math.min(values.length, capacity));
      }),
      { numRuns: 200 }
    );
  });

  it('toArray returns values in insertion order (oldest first)', () => {
    fc.assert(
      fc.property(arbCapacity, arbValues, (capacity, values) => {
        const buf = new RingBuffer<number>(capacity);
        for (const v of values) buf.push(v);

        const arr = buf.toArray();
        // Should be the last `capacity` values in order
        const expected = values.slice(-capacity);
        expect(arr).toEqual(expected);
      }),
      { numRuns: 200 }
    );
  });

  it('last() returns the most recent push', () => {
    fc.assert(
      fc.property(arbCapacity, fc.array(fc.integer(), { minLength: 1, maxLength: 200 }), (capacity, values) => {
        const buf = new RingBuffer<number>(capacity);
        for (const v of values) buf.push(v);
        expect(buf.last()).toBe(values[values.length - 1]);
      }),
      { numRuns: 200 }
    );
  });

  it('clear resets size to 0 and toArray to empty', () => {
    fc.assert(
      fc.property(arbCapacity, arbValues, (capacity, values) => {
        const buf = new RingBuffer<number>(capacity);
        for (const v of values) buf.push(v);
        buf.clear();
        expect(buf.size()).toBe(0);
        expect(buf.toArray()).toEqual([]);
        expect(buf.last()).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('push after clear works correctly', () => {
    fc.assert(
      fc.property(arbCapacity, arbValues, arbValues, (capacity, before, after) => {
        const buf = new RingBuffer<number>(capacity);
        for (const v of before) buf.push(v);
        buf.clear();
        for (const v of after) buf.push(v);
        expect(buf.toArray()).toEqual(after.slice(-capacity));
      }),
      { numRuns: 100 }
    );
  });

  it('toArray length equals size', () => {
    fc.assert(
      fc.property(arbCapacity, arbValues, (capacity, values) => {
        const buf = new RingBuffer<number>(capacity);
        for (const v of values) buf.push(v);
        expect(buf.toArray().length).toBe(buf.size());
      }),
      { numRuns: 200 }
    );
  });
});
