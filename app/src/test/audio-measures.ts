/**
 * Pure PCM measurements shared by offline-render and browser-capture tests.
 *
 * Amplitudes are linear full scale (1 = 0 dBFS), times are frames unless a
 * function explicitly accepts milliseconds, and silence is reported as
 * `-Infinity`. This module deliberately has no Web Audio or DOM dependency.
 */

const DEFAULT_FLOOR = 1e-12;

export interface SampleWindow {
  start?: number;
  end?: number;
}

export interface PumpingPoint {
  frame: number;
  timeSeconds: number;
  gainDb: number;
}

export interface PumpingResult {
  points: PumpingPoint[];
  latencyFrames: number;
  maxAttenuationDb: number;
  recoveryMonotonic: boolean;
}

export interface HitLevelVariation {
  peakDb: number[];
  rmsDb: number[];
  peakSpreadDb: number;
  rmsSpreadDb: number;
  peakVarianceDb2: number;
  rmsVarianceDb2: number;
}

function bounds(length: number, window?: SampleWindow): [number, number] {
  const start = Math.max(0, Math.min(length, Math.floor(window?.start ?? 0)));
  const end = Math.max(start, Math.min(length, Math.floor(window?.end ?? length)));
  return [start, end];
}

function linearToDb(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return mean(values.map(value => (value - average) ** 2));
}

function finiteSpread(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) - Math.min(...finite) : 0;
}

export function peakDbfs(samples: ArrayLike<number>, window?: SampleWindow): number {
  const [start, end] = bounds(samples.length, window);
  let peak = 0;
  for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(samples[index]));
  return linearToDb(peak);
}

function sinc(value: number): number {
  if (Math.abs(value) < 1e-12) return 1;
  const radians = Math.PI * value;
  return Math.sin(radians) / radians;
}

/**
 * Windowed-sinc intersample peak estimate. Four-times reconstruction is the
 * production safety gate; unlike linear interpolation it can expose peaks
 * between samples rather than being mathematically bounded by the samples.
 */
export function truePeakDbfs(
  samples: ArrayLike<number>,
  oversample = 4,
  halfTaps = 12,
): number {
  if (samples.length === 0) return -Infinity;
  if (!Number.isInteger(oversample) || oversample < 1) {
    throw new RangeError('oversample must be a positive integer');
  }
  if (!Number.isInteger(halfTaps) || halfTaps < 2) {
    throw new RangeError('halfTaps must be an integer of at least 2');
  }

  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  for (let base = 0; base + 1 < samples.length; base++) {
    for (let phase = 1; phase < oversample; phase++) {
      const position = base + phase / oversample;
      const centre = Math.floor(position);
      let sum = 0;
      let weightSum = 0;
      for (let tap = centre - halfTaps + 1; tap <= centre + halfTaps; tap++) {
        if (tap < 0 || tap >= samples.length) continue;
        const distance = position - tap;
        const window = Math.abs(distance) < halfTaps
          ? 0.5 + 0.5 * Math.cos(Math.PI * distance / halfTaps)
          : 0;
        const weight = sinc(distance) * window;
        sum += samples[tap] * weight;
        weightSum += weight;
      }
      if (Math.abs(weightSum) > DEFAULT_FLOOR) peak = Math.max(peak, Math.abs(sum / weightSum));
    }
  }
  return linearToDb(peak);
}

export function rmsDb(samples: ArrayLike<number>, window?: SampleWindow): number {
  const [start, end] = bounds(samples.length, window);
  if (start === end) return -Infinity;
  let sumSquares = 0;
  for (let index = start; index < end; index++) sumSquares += samples[index] ** 2;
  return linearToDb(Math.sqrt(sumSquares / (end - start)));
}

/**
 * Compare synchronized pre-compressor and post-makeup taps.
 * Positive attenuation is represented by a negative gainDb value.
 */
export function pumpingProfile(
  pre: ArrayLike<number>,
  post: ArrayLike<number>,
  sampleRate: number,
  options: { windowMs?: number; latencyFrames?: number; recoveryStartFrame?: number } = {},
): PumpingResult {
  const windowFrames = Math.max(1, Math.round(sampleRate * (options.windowMs ?? 5) / 1000));
  const latencyFrames = Math.max(0, Math.floor(options.latencyFrames ?? 0));
  const comparableFrames = Math.max(0, Math.min(pre.length, post.length - latencyFrames));
  const points: PumpingPoint[] = [];

  for (let start = 0; start + windowFrames <= comparableFrames; start += windowFrames) {
    let preEnergy = 0;
    let postEnergy = 0;
    for (let offset = 0; offset < windowFrames; offset++) {
      preEnergy += pre[start + offset] ** 2;
      postEnergy += post[start + latencyFrames + offset] ** 2;
    }
    const preRms = Math.sqrt(preEnergy / windowFrames);
    const postRms = Math.sqrt(postEnergy / windowFrames);
    if (preRms <= DEFAULT_FLOOR) continue;
    const gainDb = 20 * Math.log10(Math.max(postRms, DEFAULT_FLOOR) / preRms);
    points.push({ frame: start, timeSeconds: start / sampleRate, gainDb });
  }

  const maxAttenuationDb = points.length > 0
    ? Math.max(0, -Math.min(...points.map(point => point.gainDb)))
    : 0;
  const recovery = options.recoveryStartFrame === undefined
    ? []
    : points.filter(point => point.frame >= options.recoveryStartFrame!);
  const recoveryMonotonic = recovery.every((point, index) =>
    index === 0 || point.gainDb >= recovery[index - 1].gainDb - 0.05
  );

  return { points, latencyFrames, maxAttenuationDb, recoveryMonotonic };
}

export function hitLevelVariationDb(
  samples: ArrayLike<number>,
  hitStartFrames: readonly number[],
  windowFrames: number,
): HitLevelVariation {
  const peakDb = hitStartFrames.map(start => peakDbfs(samples, { start, end: start + windowFrames }));
  const rmsValues = hitStartFrames.map(start => rmsDb(samples, { start, end: start + windowFrames }));
  const finitePeaks = peakDb.filter(Number.isFinite);
  const finiteRms = rmsValues.filter(Number.isFinite);
  return {
    peakDb,
    rmsDb: rmsValues,
    peakSpreadDb: finiteSpread(peakDb),
    rmsSpreadDb: finiteSpread(rmsValues),
    peakVarianceDb2: variance(finitePeaks),
    rmsVarianceDb2: variance(finiteRms),
  };
}

/** Normalized, DC-free waveform correlation after implicit level matching. */
export function hitCorrelation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < length; index++) {
    meanA += a[index];
    meanB += b[index];
  }
  meanA /= length;
  meanB /= length;
  let dot = 0;
  let energyA = 0;
  let energyB = 0;
  for (let index = 0; index < length; index++) {
    const av = a[index] - meanA;
    const bv = b[index] - meanB;
    dot += av * bv;
    energyA += av * av;
    energyB += bv * bv;
  }
  const denominator = Math.sqrt(energyA * energyB);
  return denominator > DEFAULT_FLOOR ? Math.max(-1, Math.min(1, dot / denominator)) : 0;
}

/**
 * Estimate positive processor lookahead/latency by normalized correlation.
 * `delayed[n + result]` is aligned with `reference[n]`.
 */
export function estimateLatencyFrames(
  reference: ArrayLike<number>,
  delayed: ArrayLike<number>,
  maxLatencyFrames: number,
): number {
  const maximum = Math.max(0, Math.floor(maxLatencyFrames));
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= maximum; lag++) {
    const length = Math.min(reference.length, delayed.length - lag);
    if (length <= 0) break;
    let dot = 0;
    let referenceEnergy = 0;
    let delayedEnergy = 0;
    for (let index = 0; index < length; index++) {
      dot += reference[index] * delayed[index + lag];
      referenceEnergy += reference[index] ** 2;
      delayedEnergy += delayed[index + lag] ** 2;
    }
    const denominator = Math.sqrt(referenceEnergy * delayedEnergy);
    const score = denominator > DEFAULT_FLOOR ? dot / denominator : 0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

export function midSideRatioDb(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return -Infinity;
  let midEnergy = 0;
  let sideEnergy = 0;
  for (let index = 0; index < length; index++) {
    const mid = (left[index] + right[index]) * 0.5;
    const side = (left[index] - right[index]) * 0.5;
    midEnergy += mid * mid;
    sideEnergy += side * side;
  }
  return linearToDb(Math.sqrt(sideEnergy / length)) - linearToDb(Math.sqrt(midEnergy / length));
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const K_WEIGHTING: Record<number, readonly [BiquadCoefficients, BiquadCoefficients]> = {
  44100: [
    { b0: 1.53084123005035, b1: -2.65097999515473, b2: 1.16907907992159, a1: -1.66365511325602, a2: 0.712595428073225 },
    { b0: 1, b1: -2, b2: 1, a1: -1.9891696736298, a2: 0.989199035787039 },
  ],
  48000: [
    { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 },
    { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 },
  ],
};

function filterBiquad(samples: ArrayLike<number>, coefficients: BiquadCoefficients): Float64Array {
  const output = new Float64Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples.length; index++) {
    const x0 = samples[index];
    const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 + coefficients.b2 * x2
      - coefficients.a1 * y1 - coefficients.a2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

/** Maximum 400 ms BS.1770 K-weighted loudness, in LKFS/LUFS. */
export function loudnessKMax(
  input: ArrayLike<number> | readonly ArrayLike<number>[],
  sampleRate: 44100 | 48000,
): number {
  const channels: readonly ArrayLike<number>[] = Array.isArray(input) ? input : [input];
  if (channels.length === 0) return -Infinity;
  const coefficients = K_WEIGHTING[sampleRate];
  const filtered = channels.map(channel =>
    filterBiquad(filterBiquad(channel, coefficients[0]), coefficients[1])
  );
  const length = Math.min(...filtered.map(channel => channel.length));
  const windowFrames = Math.min(length, Math.max(1, Math.round(sampleRate * 0.4)));
  const hopFrames = Math.max(1, Math.round(sampleRate * 0.1));
  if (length === 0) return -Infinity;
  let maximum = -Infinity;
  for (let start = 0; start + windowFrames <= length; start += hopFrames) {
    let energy = 0;
    for (const channel of filtered) {
      let channelEnergy = 0;
      for (let index = start; index < start + windowFrames; index++) {
        channelEnergy += channel[index] ** 2;
      }
      energy += channelEnergy / windowFrames;
    }
    maximum = Math.max(maximum, energy > DEFAULT_FLOOR ? -0.691 + 10 * Math.log10(energy) : -Infinity);
  }
  return maximum;
}

function fftMagnitudes(samples: ArrayLike<number>): { magnitudes: Float64Array; fftSize: number } {
  let fftSize = 1;
  while (fftSize < samples.length) fftSize <<= 1;
  if (fftSize < 2) fftSize = 2;
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const denominator = Math.max(1, samples.length - 1);
  for (let index = 0; index < samples.length; index++) {
    const hann = samples.length > 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * index / denominator) : 1;
    real[index] = samples[index] * hann;
  }

  for (let index = 1, reversed = 0; index < fftSize; index++) {
    let bit = fftSize >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }

  for (let length = 2; length <= fftSize; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < fftSize; start += length) {
      for (let offset = 0; offset < length / 2; offset++) {
        const cos = Math.cos(angle * offset);
        const sin = Math.sin(angle * offset);
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * cos - imaginary[odd] * sin;
        const oddImaginary = real[odd] * sin + imaginary[odd] * cos;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }

  const magnitudes = new Float64Array(fftSize / 2 + 1);
  for (let bin = 0; bin < magnitudes.length; bin++) {
    magnitudes[bin] = Math.hypot(real[bin], imaginary[bin]);
  }
  return { magnitudes, fftSize };
}

export function spectralCentroidHz(samples: ArrayLike<number>, sampleRate: number): number {
  const { magnitudes, fftSize } = fftMagnitudes(samples);
  let weighted = 0;
  let total = 0;
  for (let bin = 0; bin < magnitudes.length; bin++) {
    weighted += bin * sampleRate / fftSize * magnitudes[bin];
    total += magnitudes[bin];
  }
  return total > DEFAULT_FLOOR ? weighted / total : 0;
}

/** RMS distance between level-normalized log-magnitude spectra, in dB. */
export function logSpectralDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  const left = Array.from({ length }, (_, index) => a[index]);
  const right = Array.from({ length }, (_, index) => b[index]);
  const leftRms = 10 ** (rmsDb(left) / 20);
  const rightRms = 10 ** (rmsDb(right) / 20);
  const scale = leftRms > DEFAULT_FLOOR && rightRms > DEFAULT_FLOOR ? leftRms / rightRms : 1;
  for (let index = 0; index < right.length; index++) right[index] *= scale;
  const leftMagnitudes = fftMagnitudes(left).magnitudes;
  const rightMagnitudes = fftMagnitudes(right).magnitudes;
  let sumSquares = 0;
  for (let bin = 0; bin < leftMagnitudes.length; bin++) {
    const leftDb = 20 * Math.log10(Math.max(leftMagnitudes[bin], DEFAULT_FLOOR));
    const rightDb = 20 * Math.log10(Math.max(rightMagnitudes[bin], DEFAULT_FLOOR));
    sumSquares += (leftDb - rightDb) ** 2;
  }
  return Math.sqrt(sumSquares / leftMagnitudes.length);
}

export function bandRmsDb(
  samples: ArrayLike<number>,
  sampleRate: number,
  lowHz: number,
  highHz: number,
): number {
  const { magnitudes, fftSize } = fftMagnitudes(samples);
  const low = Math.max(0, Math.min(lowHz, highHz));
  const high = Math.min(sampleRate / 2, Math.max(lowHz, highHz));
  let energy = 0;
  let bins = 0;
  for (let bin = 0; bin < magnitudes.length; bin++) {
    const frequency = bin * sampleRate / fftSize;
    if (frequency >= low && frequency <= high) {
      energy += magnitudes[bin] ** 2;
      bins++;
    }
  }
  return bins > 0 ? linearToDb(Math.sqrt(energy / bins) / fftSize) : -Infinity;
}

export function leadingSilenceMs(
  samples: ArrayLike<number>,
  sampleRate: number,
  thresholdDb = -40,
): number {
  const threshold = 10 ** (thresholdDb / 20);
  let frame = 0;
  while (frame < samples.length && Math.abs(samples[frame]) < threshold) frame++;
  return frame * 1000 / sampleRate;
}

export function dcOffset(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index++) sum += samples[index];
  return sum / samples.length;
}

export interface FundamentalEstimate {
  frequencyHz: number;
  centsError: number;
  confidence: number;
}

/** Count NaN and infinite samples before they can make aggregate metrics lie. */
export function nonFiniteSampleCount(samples: ArrayLike<number>): number {
  let count = 0;
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) count++;
  }
  return count;
}

/**
 * Expected-pitch autocorrelation estimator.
 *
 * Restricting the lag search to one semitone either side of the expected note
 * avoids octave errors on harmonic-rich presets while retaining enough scope
 * to expose tuning and note-routing defects. Confidence is the normalized
 * autocorrelation at the selected lag.
 */
export function estimateFundamental(
  samples: ArrayLike<number>,
  sampleRate: number,
  expectedHz: number,
  window?: SampleWindow,
): FundamentalEstimate {
  if (!(sampleRate > 0) || !(expectedHz > 0)) {
    throw new RangeError('sampleRate and expectedHz must be positive');
  }
  const [start, end] = bounds(samples.length, window);
  const length = end - start;
  if (length < 4) return { frequencyHz: 0, centsError: -Infinity, confidence: 0 };

  let average = 0;
  for (let index = start; index < end; index++) average += samples[index];
  average /= length;

  const semitoneRatio = 2 ** (1 / 12);
  const minimumLag = Math.max(1, Math.floor(sampleRate / (expectedHz * semitoneRatio)));
  const maximumLag = Math.min(length - 2, Math.ceil(sampleRate * semitoneRatio / expectedHz));
  const correlations = new Float64Array(maximumLag - minimumLag + 1);

  let bestIndex = 0;
  let bestCorrelation = -Infinity;
  for (let lag = minimumLag; lag <= maximumLag; lag++) {
    let dot = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let offset = 0; offset < length - lag; offset++) {
      const left = samples[start + offset] - average;
      const right = samples[start + offset + lag] - average;
      dot += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    const correlation = denominator > DEFAULT_FLOOR ? dot / denominator : 0;
    const correlationIndex = lag - minimumLag;
    correlations[correlationIndex] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestIndex = correlationIndex;
    }
  }

  // Parabolic interpolation improves the cents estimate without a longer FFT.
  let refinedIndex = bestIndex;
  if (bestIndex > 0 && bestIndex + 1 < correlations.length) {
    const left = correlations[bestIndex - 1];
    const centre = correlations[bestIndex];
    const right = correlations[bestIndex + 1];
    const denominator = left - 2 * centre + right;
    if (Math.abs(denominator) > DEFAULT_FLOOR) {
      refinedIndex += Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator));
    }
  }

  const lag = minimumLag + refinedIndex;
  const frequencyHz = sampleRate / lag;
  return {
    frequencyHz,
    centsError: 1200 * Math.log2(frequencyHz / expectedHz),
    confidence: Math.max(0, Math.min(1, bestCorrelation)),
  };
}

/** Energy-weighted time position, a standard descriptor of envelope shape. */
export function temporalCentroidSeconds(samples: ArrayLike<number>, sampleRate: number): number {
  if (!(sampleRate > 0)) throw new RangeError('sampleRate must be positive');
  let weighted = 0;
  let energy = 0;
  for (let index = 0; index < samples.length; index++) {
    const sampleEnergy = samples[index] ** 2;
    weighted += index / sampleRate * sampleEnergy;
    energy += sampleEnergy;
  }
  return energy > DEFAULT_FLOOR ? weighted / energy : 0;
}

/** Base-10 log of the 10%-to-90% peak-amplitude attack duration. */
export function logAttackTime(
  samples: ArrayLike<number>,
  sampleRate: number,
  window?: SampleWindow,
): number {
  if (!(sampleRate > 0)) throw new RangeError('sampleRate must be positive');
  const [start, end] = bounds(samples.length, window);
  let peak = 0;
  for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(samples[index]));
  if (peak <= DEFAULT_FLOOR) return -Infinity;
  let ten = -1;
  let ninety = -1;
  for (let index = start; index < end; index++) {
    const amplitude = Math.abs(samples[index]);
    if (ten < 0 && amplitude >= peak * 0.1) ten = index;
    if (ten >= 0 && amplitude >= peak * 0.9) {
      ninety = index;
      break;
    }
  }
  if (ten < 0 || ninety < 0) return -Infinity;
  return Math.log10(Math.max(1 / sampleRate, (ninety - ten) / sampleRate));
}

/** Largest instantaneous boundary jump at known note transitions, in dBFS. */
export function boundaryDiscontinuityDbfs(
  samples: ArrayLike<number>,
  boundaryFrames: readonly number[],
): number {
  let maximum = 0;
  for (const boundary of boundaryFrames) {
    const frame = Math.floor(boundary);
    if (frame <= 0 || frame >= samples.length) continue;
    maximum = Math.max(maximum, Math.abs(samples[frame] - samples[frame - 1]));
  }
  return linearToDb(maximum);
}

/**
 * Boundary jump relative to ordinary local sample-to-sample motion.
 * This avoids labelling a perfectly continuous high-frequency waveform a
 * click merely because its normal derivative is large.
 */
export function boundaryDiscontinuityExcessDb(
  samples: ArrayLike<number>,
  boundaryFrames: readonly number[],
  radiusFrames = 128,
): number {
  let maximumExcess = -Infinity;
  for (const boundaryValue of boundaryFrames) {
    const boundary = Math.floor(boundaryValue);
    if (boundary <= 0 || boundary >= samples.length) continue;
    const jump = Math.abs(samples[boundary] - samples[boundary - 1]);
    let localEnergy = 0;
    let localCount = 0;
    const start = Math.max(1, boundary - radiusFrames);
    const end = Math.min(samples.length, boundary + radiusFrames);
    for (let frame = start; frame < end; frame++) {
      if (Math.abs(frame - boundary) <= 1) continue;
      const derivative = samples[frame] - samples[frame - 1];
      localEnergy += derivative * derivative;
      localCount++;
    }
    const localRms = localCount > 0 ? Math.sqrt(localEnergy / localCount) : 0;
    const excess = linearToDb(jump) - linearToDb(localRms);
    maximumExcess = Math.max(maximumExcess, excess);
  }
  return maximumExcess;
}

/** Robust short-time RMS spread between the 10th and 90th percentiles. */
export function amplitudeModulationDepthDb(
  samples: ArrayLike<number>,
  frameSize = 1024,
  hopSize = 512,
): number {
  if (frameSize < 16 || !Number.isInteger(frameSize)) {
    throw new RangeError('frameSize must be an integer of at least 16');
  }
  if (hopSize < 1 || !Number.isInteger(hopSize)) {
    throw new RangeError('hopSize must be a positive integer');
  }
  const levels: number[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const level = rmsDb(samples, { start, end: start + frameSize });
    if (Number.isFinite(level)) levels.push(level);
  }
  if (levels.length < 2) return 0;
  levels.sort((left, right) => left - right);
  const percentile = (position: number) => levels[Math.round((levels.length - 1) * position)];
  return percentile(0.9) - percentile(0.1);
}

/**
 * Normalized positive spectral change between adjacent Hann-windowed frames.
 * Zero is stationary; larger values indicate deliberate or accidental motion.
 */
export function spectralFlux(
  samples: ArrayLike<number>,
  frameSize = 1024,
  hopSize = 512,
): number {
  if (frameSize < 16 || !Number.isInteger(frameSize)) {
    throw new RangeError('frameSize must be an integer of at least 16');
  }
  if (hopSize < 1 || !Number.isInteger(hopSize)) {
    throw new RangeError('hopSize must be a positive integer');
  }
  if (samples.length < frameSize + hopSize) return 0;

  let previous: Float64Array | null = null;
  let flux = 0;
  let frames = 0;
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const magnitudes = fftMagnitudes(Array.from(
      { length: frameSize },
      (_, offset) => samples[start + offset],
    )).magnitudes;
    let norm = 0;
    for (const magnitude of magnitudes) norm += magnitude * magnitude;
    norm = Math.sqrt(norm);
    if (norm > DEFAULT_FLOOR) {
      for (let bin = 0; bin < magnitudes.length; bin++) magnitudes[bin] /= norm;
    }
    if (previous) {
      let positiveChange = 0;
      for (let bin = 0; bin < magnitudes.length; bin++) {
        positiveChange += Math.max(0, magnitudes[bin] - previous[bin]) ** 2;
      }
      flux += Math.sqrt(positiveChange);
      frames++;
    }
    previous = magnitudes;
  }
  return frames > 0 ? flux / frames : 0;
}
