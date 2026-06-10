/**
 * Tests for the pure grain-pitch-shift engine.
 *
 * These run in Node (no AudioWorklet context needed). The same engine is
 * then instantiated once per channel inside pitch-shift.worklet.ts so
 * stereo sources process both channels with identical algorithms.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GrainPitchShifter } from './pitch-shift-engine';

/** Drive N samples of input through the engine and collect N samples of output. */
function processBuffer(
  shifter: GrainPitchShifter,
  input: Float32Array,
  pitchRatio: number,
  blockSize = 128,
): Float32Array {
  const output = new Float32Array(input.length);
  for (let offset = 0; offset < input.length; offset += blockSize) {
    const size = Math.min(blockSize, input.length - offset);
    const inBlock = input.subarray(offset, offset + size);
    const outBlock = output.subarray(offset, offset + size);
    shifter.write(inBlock);
    shifter.read(outBlock, pitchRatio);
  }
  return output;
}

function rms(buf: Float32Array, start = 0, end = buf.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe('GrainPitchShifter', () => {
  it('reports a positive latency equal to the grain size', () => {
    const shifter = new GrainPitchShifter(1024);
    expect(shifter.latencySamples).toBe(1024);
  });

  it('produces zero output while the first grain is still being filled', () => {
    const grainSize = 256;
    const shifter = new GrainPitchShifter(grainSize);
    // Feed a constant-1 signal of length less than one grain.
    const input = new Float32Array(grainSize / 2).fill(1);
    const output = processBuffer(shifter, input, 1.0);
    // No grain has completed yet, so output should still be zero.
    for (const s of output) expect(s).toBe(0);
  });

  it('at pitchRatio=1.0 produces output matching input energy after the first grain', () => {
    const grainSize = 256;
    const shifter = new GrainPitchShifter(grainSize);
    // Feed several grains worth of a sine wave.
    const totalSamples = grainSize * 8;
    const input = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      input[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
    }
    const output = processBuffer(shifter, input, 1.0);

    // After the latency window, output RMS should be in the ballpark of
    // input RMS. Hann-windowed overlap-add with 50% hop introduces
    // amplitude modulation but the long-term energy should be close.
    const steadyStart = grainSize * 2;
    expect(rms(output, steadyStart)).toBeGreaterThan(0.3);
    expect(rms(output, steadyStart)).toBeLessThan(1.5);
  });

  // The bug this tests: the old worklet never processed channel 1.
  // Independent GrainPitchShifter instances per channel must produce
  // independent outputs for independent inputs.
  it('processes channels independently when instantiated per-channel', () => {
    const grainSize = 256;
    const left = new GrainPitchShifter(grainSize);
    const right = new GrainPitchShifter(grainSize);

    const totalSamples = grainSize * 4;
    const leftIn = new Float32Array(totalSamples);
    const rightIn = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      leftIn[i] = Math.sin(2 * Math.PI * 440 * i / 48000);  // L: 440Hz
      rightIn[i] = Math.sin(2 * Math.PI * 880 * i / 48000); // R: 880Hz (different content)
    }

    const leftOut = processBuffer(left, leftIn, 1.0);
    const rightOut = processBuffer(right, rightIn, 1.0);

    // After the first grain, outputs should be non-trivially different.
    const steadyStart = grainSize * 2;
    let diff = 0;
    for (let i = steadyStart; i < totalSamples; i++) {
      diff += Math.abs(leftOut[i] - rightOut[i]);
    }
    expect(diff).toBeGreaterThan(0);
  });

  // Property: output always bounded by (reasonable multiple of) the max
  // absolute input magnitude. Prevents runaway accumulation bugs in the
  // overlap-add path.
  it('output is bounded by the input peak × 2 (Hann overlap)', () => {
    fc.assert(
      fc.property(
        fc.record({
          grainSize: fc.constantFrom(128, 256, 512, 1024),
          len: fc.integer({ min: 512, max: 4096 }),
          pitchRatio: fc.double({ min: 0.5, max: 2.0, noNaN: true }),
          amp: fc.double({ min: 0.01, max: 1.0, noNaN: true }),
        }),
        ({ grainSize, len, pitchRatio, amp }) => {
          const shifter = new GrainPitchShifter(grainSize);
          const input = new Float32Array(len);
          for (let i = 0; i < len; i++) {
            input[i] = amp * Math.sin(2 * Math.PI * 440 * i / 48000);
          }
          const output = processBuffer(shifter, input, pitchRatio);

          let maxOut = 0;
          for (const s of output) maxOut = Math.max(maxOut, Math.abs(s));
          // Overlap-add with Hann windows can briefly double, so allow 2.5×.
          expect(maxOut).toBeLessThanOrEqual(amp * 2.5 + 1e-6);
          expect(Number.isFinite(maxOut)).toBe(true);
        }
      ),
      { numRuns: 100, seed: 0x4a4d5052 }
    );
  });

  it('produces no NaN output for any bounded input', () => {
    fc.assert(
      fc.property(
        fc.record({
          grainSize: fc.constantFrom(128, 256, 512),
          samples: fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 256, maxLength: 1024 }),
          pitchRatio: fc.double({ min: 0.25, max: 4.0, noNaN: true }),
        }),
        ({ grainSize, samples, pitchRatio }) => {
          const shifter = new GrainPitchShifter(grainSize);
          const input = Float32Array.from(samples);
          const output = processBuffer(shifter, input, pitchRatio);
          for (const s of output) expect(Number.isFinite(s)).toBe(true);
        }
      ),
      { numRuns: 100, seed: 0x4a4d5053 }
    );
  });
});
