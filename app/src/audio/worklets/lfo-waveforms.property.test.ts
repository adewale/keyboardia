/**
 * Property-Based Tests for LFO Waveform Math
 *
 * These test the pure math functions extracted from shared-lfo.worklet.ts.
 * Since worklet code can't be imported directly (it runs in a different
 * global scope), we re-implement the identical math here and verify its
 * properties. Any fix in the worklet must be mirrored here and vice versa.
 *
 * Properties verified:
 * - All waveforms output in [-1, 1] for any phase in [0, 1)
 * - Sine/triangle are symmetric around phase 0.5
 * - Square is exactly ±1 (no intermediate values)
 * - Amplitude scaling: amount=0 → gain=1, amount=1 → gain range [0,1]
 * - Filter/pitch scaling is linear with amount
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// ─── Re-implementation of worklet math (must stay in sync) ──────────────

function computeWaveform(phase: number, waveform: string): number {
  switch (waveform) {
    case 'sine':
      return Math.sin(phase * 2 * Math.PI);
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'sawtooth':
      return 2 * phase - 1;
    case 'square':
      return phase < 0.5 ? 1 : -1;
    default:
      return 0;
  }
}

function scaleForDestination(raw: number, amount: number, destination: string): number {
  switch (destination) {
    case 'filter':
      return raw * amount * 2000;
    case 'pitch':
      return raw * amount * 100;
    case 'amplitude':
      return 1.0 - (amount / 2) * (1 - raw);
    default:
      return raw * amount;
  }
}

// ─── Arbitraries ────────────────────────────────────────────────────────

const arbPhase = fc.double({ min: 0, max: 0.9999999, noNaN: true });
const arbWaveform = fc.constantFrom('sine', 'triangle', 'sawtooth', 'square');
const arbAmount = fc.double({ min: 0, max: 1, noNaN: true });

// ─── Waveform Properties ────────────────────────────────────────────────

describe('LFO waveform properties', () => {
  it('all waveforms output in [-1, 1] for phase in [0, 1)', () => {
    fc.assert(
      fc.property(arbPhase, arbWaveform, (phase, waveform) => {
        const value = computeWaveform(phase, waveform);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 }
    );
  });

  it('sine is zero at phase 0 and phase 0.5', () => {
    expect(computeWaveform(0, 'sine')).toBeCloseTo(0, 10);
    expect(computeWaveform(0.5, 'sine')).toBeCloseTo(0, 10);
  });

  it('sine reaches +1 at phase 0.25 and -1 at phase 0.75', () => {
    expect(computeWaveform(0.25, 'sine')).toBeCloseTo(1, 10);
    expect(computeWaveform(0.75, 'sine')).toBeCloseTo(-1, 10);
  });

  it('triangle is symmetric: f(p) = f(1-p)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 0.499, noNaN: true }), (phase) => {
        const a = computeWaveform(phase, 'triangle');
        const b = computeWaveform(1 - phase, 'triangle');
        expect(a).toBeCloseTo(b, 10);
      }),
      { numRuns: 200 }
    );
  });

  it('triangle peaks at +1 (phase 0) and troughs at -1 (phase 0.5)', () => {
    // f(p) = 4 * |p - 0.5| - 1
    // phase 0: 4*0.5 - 1 = 1 (peak)
    // phase 0.25: 4*0.25 - 1 = 0 (zero crossing)
    // phase 0.5: 4*0 - 1 = -1 (trough)
    expect(computeWaveform(0, 'triangle')).toBeCloseTo(1, 10);
    expect(computeWaveform(0.25, 'triangle')).toBeCloseTo(0, 10);
    expect(computeWaveform(0.5, 'triangle')).toBeCloseTo(-1, 10);
  });

  it('sawtooth is linear: f(p) = 2p - 1', () => {
    fc.assert(
      fc.property(arbPhase, (phase) => {
        expect(computeWaveform(phase, 'sawtooth')).toBeCloseTo(2 * phase - 1, 10);
      }),
      { numRuns: 200 }
    );
  });

  it('square is exactly +1 or -1 (no intermediate values)', () => {
    fc.assert(
      fc.property(arbPhase, (phase) => {
        const value = computeWaveform(phase, 'square');
        expect(value === 1 || value === -1).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('square is +1 for first half, -1 for second half', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.499, noNaN: true }), (phase) => {
        expect(computeWaveform(phase, 'square')).toBe(1);
      }),
      { numRuns: 100 }
    );
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 0.999, noNaN: true }), (phase) => {
        expect(computeWaveform(phase, 'square')).toBe(-1);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Destination Scaling Properties ─────────────────────────────────────

describe('LFO destination scaling properties', () => {
  it('amount=0 produces zero modulation for filter and pitch', () => {
    fc.assert(
      fc.property(arbPhase, arbWaveform, (phase, waveform) => {
        const raw = computeWaveform(phase, waveform);
        expect(scaleForDestination(raw, 0, 'filter')).toBeCloseTo(0, 10);
        expect(scaleForDestination(raw, 0, 'pitch')).toBeCloseTo(0, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('amount=0 produces gain=1 for amplitude (no tremolo)', () => {
    fc.assert(
      fc.property(arbPhase, arbWaveform, (phase, waveform) => {
        const raw = computeWaveform(phase, waveform);
        expect(scaleForDestination(raw, 0, 'amplitude')).toBeCloseTo(1, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('amplitude scaling stays in [0, 1] for any amount and raw', () => {
    fc.assert(
      fc.property(arbPhase, arbWaveform, arbAmount, (phase, waveform, amount) => {
        const raw = computeWaveform(phase, waveform);
        const gain = scaleForDestination(raw, amount, 'amplitude');
        expect(gain).toBeGreaterThanOrEqual(-1e-10);
        expect(gain).toBeLessThanOrEqual(1 + 1e-10);
      }),
      { numRuns: 500 }
    );
  });

  it('amplitude: amount=1 gives full range [0, 1]', () => {
    // raw=1 → gain=1, raw=-1 → gain=0
    expect(scaleForDestination(1, 1, 'amplitude')).toBeCloseTo(1, 10);
    expect(scaleForDestination(-1, 1, 'amplitude')).toBeCloseTo(0, 10);
  });

  it('amplitude: amount=0.5 gives range [0.5, 1]', () => {
    expect(scaleForDestination(1, 0.5, 'amplitude')).toBeCloseTo(1, 10);
    expect(scaleForDestination(-1, 0.5, 'amplitude')).toBeCloseTo(0.5, 10);
  });

  it('filter scaling is linear: doubles with doubled amount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (raw, amount) => {
          const single = scaleForDestination(raw, amount, 'filter');
          const doubled = scaleForDestination(raw, amount * 2, 'filter');
          expect(doubled).toBeCloseTo(single * 2, 5);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('filter scaling bounded: |output| ≤ 2000 for any raw and amount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        arbAmount,
        (raw, amount) => {
          const result = Math.abs(scaleForDestination(raw, amount, 'filter'));
          expect(result).toBeLessThanOrEqual(2000 + 1e-6);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('pitch scaling bounded: |output| ≤ 100 cents for any raw and amount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        arbAmount,
        (raw, amount) => {
          const result = Math.abs(scaleForDestination(raw, amount, 'pitch'));
          expect(result).toBeLessThanOrEqual(100 + 1e-6);
        }
      ),
      { numRuns: 200 }
    );
  });
});
