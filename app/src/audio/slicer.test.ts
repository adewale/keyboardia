/**
 * detectTransients — onset detection for the recorder's auto-slice.
 *
 * This is pure DSP over a Float32Array and a sample rate, so the tests build
 * signals with known onset times and assert on *where* the onsets land, not
 * just how many there are. A count-only oracle passes when the detector
 * reports the right number of transients at entirely the wrong times, which is
 * the failure a user would actually hear: slices cut in the middle of hits.
 *
 * Verified by sabotage — each of these was confirmed to fail when the detector
 * was broken in a matching way (see docs/TEST-AUDIT-2026-07.md):
 *   - dropping the `relativeDiff > threshold` guard          → onset positions
 *   - dropping the `minSamples` gap guard                    → gap suppression
 *   - `i * hopSize` → `i * windowSize` (a plausible typo)    → onset positions
 */
import { describe, it, expect } from 'vitest';
import {
  detectTransients,
  sliceByTransients,
  sliceEqual,
  extractSlice,
  autoSlice,
  type Slice,
} from './slicer';

const SAMPLE_RATE = 44100;

/**
 * A data-only stand-in for AudioBuffer.
 *
 * detectTransients reads exactly two members, `getChannelData(0)` and
 * `sampleRate`, and does arithmetic on the samples. There is no Web Audio
 * behaviour to be faithful to, so this carries no mock-drift risk: the values
 * the function sees are the real ones. Anything that needs a live AudioContext
 * belongs in an e2e test instead.
 */
function bufferOf(samples: Float32Array, sampleRate = SAMPLE_RATE): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

/**
 * Silence with a decaying burst starting at each of `onsetSeconds`.
 * A burst is loud (amplitude 0.8) and decays over `burstMs`, which is what
 * produces the sharp energy rise the detector looks for.
 */
function signalWithBursts(
  onsetSeconds: number[],
  durationSeconds = 2,
  burstMs = 30,
): Float32Array {
  const samples = new Float32Array(Math.floor(durationSeconds * SAMPLE_RATE));
  const burstLength = Math.floor((burstMs / 1000) * SAMPLE_RATE);

  for (const onset of onsetSeconds) {
    const start = Math.floor(onset * SAMPLE_RATE);
    for (let i = 0; i < burstLength && start + i < samples.length; i++) {
      const decay = 1 - i / burstLength;
      // A tone, so successive windows have real energy rather than one spike.
      samples[start + i] = 0.8 * decay * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    }
  }
  return samples;
}

/** The onset closest to `expected`, or Infinity if none was reported. */
function nearest(times: number[], expected: number): number {
  if (times.length === 0) return Infinity;
  return times.reduce((best, t) =>
    Math.abs(t - expected) < Math.abs(best - expected) ? t : best,
  );
}

describe('detectTransients', () => {
  it('reports no onsets in silence', () => {
    const silence = new Float32Array(SAMPLE_RATE);
    expect(detectTransients(bufferOf(silence))).toEqual([]);
  });

  it('reports no onsets in steady tone with no energy rise', () => {
    // Constant amplitude: energy never *increases*, so there is no onset even
    // though the signal is loud throughout. This separates "detects loudness"
    // from "detects onsets" — a detector that merely thresholds amplitude
    // passes the burst tests below but fails this one.
    const steady = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < steady.length; i++) {
      steady[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    }
    expect(detectTransients(bufferOf(steady))).toEqual([]);
  });

  it('locates a single burst at the time it actually starts', () => {
    const onsets = detectTransients(bufferOf(signalWithBursts([0.5])));

    expect(onsets.length).toBeGreaterThan(0);
    // Window/hop resolution is 10ms/5ms, so the report should land within a
    // couple of windows of the true onset — not merely somewhere in the file.
    expect(nearest(onsets, 0.5)).toBeCloseTo(0.5, 1);
  });

  it('locates every burst in a sequence, in ascending order', () => {
    const expected = [0.3, 0.8, 1.3];
    const onsets = detectTransients(bufferOf(signalWithBursts(expected)));

    for (const time of expected) {
      expect(nearest(onsets, time), `no onset near ${time}s in [${onsets}]`)
        .toBeCloseTo(time, 1);
    }
    expect(onsets).toEqual([...onsets].sort((a, b) => a - b));
  });

  it('never reports an onset outside the buffer', () => {
    const duration = 2;
    const onsets = detectTransients(bufferOf(signalWithBursts([0.3, 1.9], duration)));

    for (const t of onsets) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(duration);
    }
  });

  it('suppresses onsets closer together than minGapSeconds', () => {
    // Four bursts 40ms apart. With a 200ms minimum gap at most one can survive.
    const crowded = signalWithBursts([0.5, 0.54, 0.58, 0.62], 2, 20);

    const tight = detectTransients(bufferOf(crowded), 0.3, 0.01);
    const spaced = detectTransients(bufferOf(crowded), 0.3, 0.2);

    expect(tight.length).toBeGreaterThan(1);
    expect(spaced.length).toBeLessThan(tight.length);
    for (let i = 1; i < spaced.length; i++) {
      expect(spaced[i] - spaced[i - 1]).toBeGreaterThan(0.2);
    }
  });

  it('reports fewer onsets as sensitivity rises', () => {
    // The parameter is a threshold on relative energy increase, so a larger
    // value must be strictly more selective. Recorder.tsx maps its 0-100
    // slider onto this and depends on the direction.
    const signal = bufferOf(signalWithBursts([0.2, 0.5, 0.9, 1.4, 1.7]));

    const permissive = detectTransients(signal, 0.05);
    const strict = detectTransients(signal, 5);

    expect(permissive.length).toBeGreaterThan(0);
    expect(strict.length).toBeLessThanOrEqual(permissive.length);
    // Monotone across the whole range, not just at the two ends.
    const counts = [0.05, 0.3, 1, 3, 10].map((s) => detectTransients(signal, s).length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `sensitivity ${i} produced more onsets than ${i - 1}`)
        .toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it('scales onset times with the sample rate, not the sample index', () => {
    // The same musical signal at two sample rates must yield the same *times*.
    // This is the units check: the detector works in samples internally and
    // divides by sampleRate on the way out. The sibling helpers that skipped
    // that division were the reason this module was cut back.
    const at44k = detectTransients(bufferOf(signalWithBursts([0.4, 1.0])));

    const highRate = 88200;
    const samples = new Float32Array(2 * highRate);
    const burstLength = Math.floor(0.03 * highRate);
    for (const onset of [0.4, 1.0]) {
      const start = Math.floor(onset * highRate);
      for (let i = 0; i < burstLength; i++) {
        const decay = 1 - i / burstLength;
        samples[start + i] = 0.8 * decay * Math.sin((2 * Math.PI * 220 * i) / highRate);
      }
    }
    const at88k = detectTransients(bufferOf(samples, highRate));

    expect(nearest(at44k, 0.4)).toBeCloseTo(0.4, 1);
    expect(nearest(at88k, 0.4)).toBeCloseTo(0.4, 1);
    expect(nearest(at88k, 1.0)).toBeCloseTo(nearest(at44k, 1.0), 1);
  });

  it('handles a buffer shorter than one analysis window', () => {
    // 10ms windows at 44.1kHz = 441 samples; 100 samples cannot fill one.
    // The energy loop must simply not run rather than read past the end.
    const tiny = new Float32Array(100);
    tiny.fill(0.5);
    expect(detectTransients(bufferOf(tiny))).toEqual([]);
  });
});

/**
 * A data-only AudioContext stand-in.
 *
 * `extractSlice` uses exactly one member, `createBuffer`, and then writes into
 * the Float32Array it hands back. Returning a real Float32Array means the
 * assertions below read the actual copied samples rather than a recording of
 * calls made against a mock — the difference between testing the code and
 * testing the double.
 */
function fakeContext(): AudioContext {
  return {
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      if (length < 1) throw new Error(`createBuffer: length must be >= 1, got ${length}`);
      if (!Number.isInteger(length)) {
        // Real createBuffer takes an unsigned long: a fractional length is the
        // exact symptom the units bug produced. Fail loudly rather than round.
        throw new Error(`createBuffer: length must be an integer, got ${length}`);
      }
      const data = new Float32Array(length);
      return {
        sampleRate,
        length,
        duration: length / sampleRate,
        numberOfChannels: channels,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
  } as unknown as AudioContext;
}

/** A buffer whose sample at index i is i, so copied ranges are identifiable. */
function rampBuffer(length: number, sampleRate = SAMPLE_RATE): AudioBuffer {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = i;
  return bufferOf(samples, sampleRate);
}

/** Slices must tile the buffer: no gaps, no overlaps, no leftovers. */
function expectTiles(slices: Slice[], totalSamples: number) {
  expect(slices.length).toBeGreaterThan(0);
  expect(slices[0].startSample).toBe(0);
  expect(slices[slices.length - 1].endSample).toBe(totalSamples);
  for (let i = 1; i < slices.length; i++) {
    expect(slices[i].startSample, `gap or overlap before slice ${i}`)
      .toBe(slices[i - 1].endSample);
  }
}

/** Every Slice's two representations must agree. */
function expectUnitsConsistent(slices: Slice[], sampleRate: number) {
  for (const s of slices) {
    expect(Number.isInteger(s.startSample), `startSample ${s.startSample} not an integer`).toBe(true);
    expect(Number.isInteger(s.endSample), `endSample ${s.endSample} not an integer`).toBe(true);
    expect(s.startTime).toBeCloseTo(s.startSample / sampleRate, 6);
    expect(s.endTime).toBeCloseTo(s.endSample / sampleRate, 6);
    expect(s.endSample).toBeGreaterThan(s.startSample);
  }
}

describe('sliceEqual', () => {
  it('divides the buffer into the requested number of slices', () => {
    const { slices } = sliceEqual(rampBuffer(1000), 4);

    expect(slices).toHaveLength(4);
    expect(slices.map((s) => s.startSample)).toEqual([0, 250, 500, 750]);
    expect(slices.map((s) => s.endSample)).toEqual([250, 500, 750, 1000]);
  });

  it('tiles the buffer exactly when the count does not divide the length', () => {
    // 1000 / 3 = 333.33; the last slice must absorb the remainder rather than
    // leaving a gap the caller never learns about.
    const { slices } = sliceEqual(rampBuffer(1000), 3);

    expectTiles(slices, 1000);
    expectUnitsConsistent(slices, SAMPLE_RATE);
  });

  it('reports sample indices and seconds that agree', () => {
    const { slices } = sliceEqual(rampBuffer(SAMPLE_RATE * 2), 8);

    expectUnitsConsistent(slices, SAMPLE_RATE);
    expect(slices[0].startTime).toBe(0);
    expect(slices[slices.length - 1].endTime).toBeCloseTo(2, 6);
  });

  it('returns the whole buffer rather than nothing for a non-positive count', () => {
    for (const count of [0, -3]) {
      const { slices } = sliceEqual(rampBuffer(500), count);
      expect(slices, `count ${count}`).toHaveLength(1);
      expectTiles(slices, 500);
    }
  });
});

describe('sliceByTransients', () => {
  const signal = () => bufferOf(signalWithBursts([0.3, 0.8, 1.3]));

  it('cuts at the detected onsets, in samples', () => {
    const buffer = signal();
    const { slices } = sliceByTransients(buffer);
    const onsets = detectTransients(buffer, 0.3);

    // The regression this file exists for: onset *seconds* were assigned to
    // startSample directly. A cut point near 0.3s must be near 13230 samples,
    // not near 0.3.
    const cutSamples = slices.slice(1).map((s) => s.startSample);
    expect(cutSamples.length).toBeGreaterThan(0);
    for (const cut of cutSamples) {
      expect(cut).toBeGreaterThan(1);
      const matching = onsets.some((t) => Math.abs(t * SAMPLE_RATE - cut) <= 1);
      expect(matching, `cut at sample ${cut} matches no detected onset`).toBe(true);
    }
  });

  it('tiles the buffer, keeping the audio before the first onset', () => {
    const buffer = signal();
    const { slices } = sliceByTransients(buffer);

    // The old version started at the first transient, silently discarding
    // everything before it — for a recording with a count-in, the whole count-in.
    expectTiles(slices, buffer.length);
    expectUnitsConsistent(slices, SAMPLE_RATE);
  });

  it('never returns more slices than maxSlices', () => {
    const busy = bufferOf(signalWithBursts([0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6], 2, 20));

    for (const max of [1, 2, 3, 4]) {
      const { slices } = sliceByTransients(busy, max);
      expect(slices.length, `maxSlices ${max}`).toBeLessThanOrEqual(max);
      expectTiles(slices, busy.length);
    }
  });

  it('returns one slice covering the buffer when there are no transients', () => {
    const silence = bufferOf(new Float32Array(SAMPLE_RATE));
    const { slices } = sliceByTransients(silence);

    expect(slices).toHaveLength(1);
    expectTiles(slices, SAMPLE_RATE);
  });

  it('returns the source buffer alongside the slices', () => {
    const buffer = signal();
    expect(sliceByTransients(buffer).sourceBuffer).toBe(buffer);
  });
});

describe('extractSlice', () => {
  it('copies exactly the requested sample range', () => {
    const source = rampBuffer(1000);
    const extracted = extractSlice(fakeContext(), source, {
      startSample: 100, endSample: 150, startTime: 0, endTime: 0,
    });

    expect(extracted.length).toBe(50);
    const data = extracted.getChannelData(0);
    expect(data[0]).toBe(100);   // the ramp makes an off-by-one visible
    expect(data[49]).toBe(149);
  });

  it('preserves the source sample rate', () => {
    const extracted = extractSlice(fakeContext(), rampBuffer(1000, 88200), {
      startSample: 0, endSample: 10, startTime: 0, endTime: 0,
    });
    expect(extracted.sampleRate).toBe(88200);
  });

  it('clamps a range that runs past the end of the buffer', () => {
    // Unclamped this reads undefined past the end and writes NaN, which plays
    // as silence or a click — a failure the user hears but no test would catch.
    const extracted = extractSlice(fakeContext(), rampBuffer(100), {
      startSample: 80, endSample: 500, startTime: 0, endTime: 0,
    });

    expect(extracted.length).toBe(20);
    const data = extracted.getChannelData(0);
    expect([...data].every(Number.isFinite), 'extracted NaN samples').toBe(true);
    expect(data[19]).toBe(99);
  });

  it('survives a collapsed or inverted range', () => {
    const context = fakeContext();
    const source = rampBuffer(100);

    // createBuffer throws below length 1, so this must not reach it with 0.
    expect(() => extractSlice(context, source, {
      startSample: 50, endSample: 50, startTime: 0, endTime: 0,
    })).not.toThrow();
    expect(() => extractSlice(context, source, {
      startSample: 80, endSample: 20, startTime: 0, endTime: 0,
    })).not.toThrow();
  });
});

describe('autoSlice', () => {
  it('returns one buffer per equal slice, tiling the source', () => {
    const buffers = autoSlice(fakeContext(), rampBuffer(1000), 'equal', 4);

    expect(buffers).toHaveLength(4);
    expect(buffers.reduce((n, b) => n + b.length, 0)).toBe(1000);
    expect(buffers[0].getChannelData(0)[0]).toBe(0);
    expect(buffers[1].getChannelData(0)[0]).toBe(250);
  });

  it('slices at transients without asking createBuffer for a fractional length', () => {
    // The end-to-end form of the units bug. With onset seconds used as sample
    // indices, slice lengths came out around 0.5 and this call threw — which is
    // the *good* case; the quiet case was a one-frame buffer of silence.
    const buffers = autoSlice(fakeContext(), bufferOf(signalWithBursts([0.3, 0.8, 1.3])), 'transient');

    expect(buffers.length).toBeGreaterThan(1);
    for (const b of buffers) {
      expect(Number.isInteger(b.length)).toBe(true);
      expect(b.length).toBeGreaterThan(1);
    }
  });

  it('covers the whole source in transient mode too', () => {
    const source = bufferOf(signalWithBursts([0.3, 0.8, 1.3]));
    const buffers = autoSlice(fakeContext(), source, 'transient');

    expect(buffers.reduce((n, b) => n + b.length, 0)).toBe(source.length);
  });

  it('defaults to equal mode', () => {
    const source = rampBuffer(800);
    expect(autoSlice(fakeContext(), source, undefined, 4).map((b) => b.length))
      .toEqual(autoSlice(fakeContext(), source, 'equal', 4).map((b) => b.length));
  });
});
