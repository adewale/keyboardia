import { describe, expect, it } from 'vitest';
import { GrainPitchShifter } from './pitch-shift-engine';

const SAMPLE_RATE = 48_000;
const GRAIN_SIZE = 1_024;
const INPUT_FREQUENCY = 440;

function sineWave(samples: number): Float32Array {
  return Float32Array.from(
    { length: samples },
    (_, index) => Math.sin((2 * Math.PI * INPUT_FREQUENCY * index) / SAMPLE_RATE),
  );
}

function processBuffer(input: Float32Array, ratio: number): Float32Array {
  const shifter = new GrainPitchShifter(GRAIN_SIZE);
  const output = new Float32Array(input.length);
  for (let offset = 0; offset < input.length; offset += 128) {
    shifter.write(input.subarray(offset, offset + 128));
    shifter.read(output.subarray(offset, offset + 128), ratio);
  }
  return output;
}

/** Brute-force spectral peak, sufficient for the narrow regression band. */
function dominantFrequency(buffer: Float32Array): number {
  const start = GRAIN_SIZE * 4;
  let strongestFrequency = 0;
  let strongestMagnitude = -Infinity;

  for (let frequency = 100; frequency <= 1_200; frequency += 5) {
    let real = 0;
    let imaginary = 0;
    for (let index = start; index < buffer.length; index++) {
      const angle = (2 * Math.PI * frequency * (index - start)) / SAMPLE_RATE;
      real += buffer[index] * Math.cos(angle);
      imaginary -= buffer[index] * Math.sin(angle);
    }
    const magnitude = real * real + imaginary * imaginary;
    if (magnitude > strongestMagnitude) {
      strongestMagnitude = magnitude;
      strongestFrequency = frequency;
    }
  }
  return strongestFrequency;
}

describe('production GrainPitchShifter spectrum', () => {
  it('preserves the input pitch at ratio 1', () => {
    const output = processBuffer(sineWave(GRAIN_SIZE * 24), 1);
    expect(dominantFrequency(output)).toBeCloseTo(INPUT_FREQUENCY, -1);
  });

  it('moves spectral energy down and up when the ratio changes', () => {
    const input = sineWave(GRAIN_SIZE * 24);
    const down = dominantFrequency(processBuffer(input, 0.5));
    const up = dominantFrequency(processBuffer(input, 2));

    expect(down).toBeLessThan(INPUT_FREQUENCY * 0.7);
    expect(up).toBeGreaterThan(INPUT_FREQUENCY * 1.45);
  });
});
