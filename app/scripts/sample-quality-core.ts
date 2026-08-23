import { loudnessKMax } from '../src/test/audio-measures';

export interface DecodedAudioLike {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface SampleContext {
  instrumentId: string;
  instrumentName: string;
  file: string;
  note: number;
  velocityMin?: number;
  velocityMax?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  pitched: boolean;
  /** Instrument + sample gain applied by production playback. */
  playbackGainDb?: number;
  /** Runtime playback trim used to remove measured codec/onset delay. */
  playbackStartOffsetMs?: number;
}

export interface QualityThresholds {
  hotPeakDb: number;
  dcWarnDb: number;
  dcFailDb: number;
  leadingSilenceMs: number;
  tailTruncationDbRelPeak: number;
  pitchReviewCents: number;
  minPitchConfidence: number;
  phaseCorrelationMin: number;
  monoLossDb: number;
  /** Maximum boundary-value discontinuity, relative to sample peak. */
  loopValueJumpDbMax: number;
  /** Maximum C1 (slope) discontinuity, normalized by local derivative RMS. */
  loopDerivativeRatioMax: number;
  velocityInversionDb: number;
  noteLevelStepDb: number;
  rangeOverextensionSemitones: number;
  tonalLoudnessToleranceDb: number;
}

export interface SpectralMetrics {
  centroidHz: number | null;
  highFrequencyRatio: number | null;
}

export interface PitchMetrics {
  midi: number | null;
  frequencyHz: number | null;
  rawCents: number | null;
  /**
   * Threshold deviation after cent folding. The estimator searches near the
   * mapped note, so this should not be read as broad octave-error detection.
   */
  foldedCents: number | null;
  confidence: number;
}

export interface LoopMetrics {
  checked: boolean;
  skippedReason?: string;
  /** Difference between the signal values at loopEnd and loopStart. */
  seamJumpDb: number | null;
  /** Difference between the incoming/outgoing slopes at the boundary. */
  derivativeDiscontinuityRatio: number | null;
}

export interface StereoMetrics {
  correlation: number | null;
  monoLossDb: number | null;
  leftRightBalanceDb: number | null;
}

export interface AnalyzedDecodedSample {
  metrics: SampleQualityMetrics;
  mono: Float32Array;
}

export interface SampleQualityMetrics {
  instrumentId: string;
  instrumentName: string;
  file: string;
  note: number;
  velocityMin?: number;
  velocityMax?: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
  activeRmsDb: number;
  /** Maximum 400ms BS.1770 K-weighted loudness (LKFS/LUFS). */
  loudnessKMax: number | null;
  /** Manifest gain used when evaluating delivered playback loudness. */
  playbackGainDb: number;
  dcOffset: number;
  dcOffsetDb: number;
  crestFactorDb: number | null;
  leadingSilenceMs: number;
  effectiveLeadingSilenceMs: number;
  trailingSilenceMs: number;
  attackMs: number | null;
  tailLevelDbRelPeak: number | null;
  clippingSamples: number;
  flatTopRuns: number;
  activeStartMs: number | null;
  activeEndMs: number | null;
  spectral: SpectralMetrics;
  pitch: PitchMetrics;
  loop: LoopMetrics | null;
  stereo: StereoMetrics | null;
}

export type IssueSeverity = 'error' | 'review';

export interface QualityIssue {
  severity: IssueSeverity;
  code: string;
  instrumentId: string;
  file?: string;
  message: string;
  value?: number | string | null;
  threshold?: number | string;
}

/**
 * Canonical sampled-audio thresholds.
 *
 * These consolidate the older Python audit rationale from
 * validate-audio-defects.py and compare-sample-quality.py:
 * - lossy delivery should be encoded with about 2.5 dB of decoded headroom
 *   (EBU R128-style delivery margin; 128k MP3/AAC can overshoot bright content),
 * - >1% DC offset is a hard defect because it wastes headroom and can thump,
 * - onset lead around 10ms is perceptible and should be reviewed,
 * - free-decay tails above about -35 dB relative to peak can sound truncated,
 * - pitch JND for complex tones is roughly 5-10 cents,
 * - adjacent note/layer level steps above 3 dB read as uneven,
 * - loop seams compare the actual boundary value and first derivative; windows
 *   away from the seam are not phase-aligned and therefore are not compared,
 * - playable ranges more than 6 semitones past the outer sampled notes are
 *   audible overextensions unless waived.
 */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  hotPeakDb: -2.5,
  dcWarnDb: -60,
  dcFailDb: -40,
  leadingSilenceMs: 10,
  tailTruncationDbRelPeak: -35,
  pitchReviewCents: 10,
  minPitchConfidence: 0.52,
  phaseCorrelationMin: -0.2,
  monoLossDb: -3,
  loopValueJumpDbMax: -35,
  loopDerivativeRatioMax: 4,
  velocityInversionDb: 1,
  noteLevelStepDb: 3,
  rangeOverextensionSemitones: 6,
  tonalLoudnessToleranceDb: 2.5,
};

const NEGATIVE_INFINITY_DB = -120;
const SPECTRAL_FFT_SIZE = 2048;
const PITCH_WINDOW_SIZE = 4096;

export function amplitudeToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return NEGATIVE_INFINITY_DB;
  return Math.max(NEGATIVE_INFINITY_DB, 20 * Math.log10(value));
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

export function foldCents(cents: number): number {
  return ((cents + 600) % 1200) - 600;
}

export function mixToMono(decoded: DecodedAudioLike): Float32Array {
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
  }
  return mono;
}

function calculateRms(data: ArrayLike<number>, start = 0, end = data.length): number {
  const length = Math.max(0, end - start);
  if (length === 0) return 0;
  let sumSquares = 0;
  for (let i = start; i < end; i++) sumSquares += data[i] * data[i];
  return Math.sqrt(sumSquares / length);
}

function calculateMean(data: ArrayLike<number>, start = 0, end = data.length): number {
  const length = Math.max(0, end - start);
  if (length === 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i];
  return sum / length;
}

function calculatePeak(data: ArrayLike<number>, start = 0, end = data.length): number {
  let peak = 0;
  for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
}

function findActiveRegion(mono: Float32Array, sampleRate: number, peak: number): {
  start: number | null;
  end: number | null;
  threshold: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
} {
  const threshold = Math.max(10 ** (-70 / 20), peak * 10 ** (-50 / 20));
  let start: number | null = null;
  let end: number | null = null;
  for (let i = 0; i < mono.length; i++) {
    if (Math.abs(mono[i]) > threshold) {
      start = i;
      break;
    }
  }
  for (let i = mono.length - 1; i >= 0; i--) {
    if (Math.abs(mono[i]) > threshold) {
      end = i;
      break;
    }
  }
  return {
    start,
    end,
    threshold,
    leadingSilenceMs: start === null ? 0 : (start / sampleRate) * 1000,
    trailingSilenceMs: end === null ? 0 : ((mono.length - 1 - end) / sampleRate) * 1000,
  };
}

/** Runtime/stereo analysis starts and ends on audible PCM in any channel. */
function findAnyChannelActiveRegion(
  decoded: DecodedAudioLike,
  peak: number,
): { start: number | null; end: number | null } {
  if (decoded.sampleRate <= 0 || decoded.length <= 0 || peak <= 0) {
    return { start: null, end: null };
  }
  const threshold = Math.max(10 ** (-70 / 20), peak * 10 ** (-50 / 20));
  // Some decoder implementations materialize/copy channel views on each call;
  // resolve them once so a whole-buffer scan remains O(frames × channels).
  const channels = Array.from(
    { length: decoded.numberOfChannels },
    (_, channel) => decoded.getChannelData(channel),
  );
  let start: number | null = null;
  let end: number | null = null;
  for (let frame = 0; frame < decoded.length; frame++) {
    for (const channel of channels) {
      if (Math.abs(channel[frame] ?? 0) > threshold) {
        start = frame;
        break;
      }
    }
    if (start !== null) break;
  }
  for (let frame = decoded.length - 1; frame >= 0; frame--) {
    for (const channel of channels) {
      if (Math.abs(channel[frame] ?? 0) > threshold) {
        end = frame;
        break;
      }
    }
    if (end !== null) break;
  }
  return { start, end };
}

function countFlatTopRuns(decoded: DecodedAudioLike, peak: number): { clippingSamples: number; flatTopRuns: number } {
  let clippingSamples = 0;
  let flatTopRuns = 0;
  if (peak <= 0) return { clippingSamples, flatTopRuns };
  // A level threshold alone is not evidence of a flat top: smooth peaks spend
  // several frames near their maximum, and attenuating a clipped source used
  // to disable this check entirely. Detect the scale-invariant *shape* instead:
  // at least four near-peak samples with effectively zero slope, bounded by
  // substantially steeper edges. Multiplying every sample by a gain therefore
  // leaves this count unchanged.
  const nearPeakThreshold = peak * 0.9;
  const flatDelta = Math.max(peak * 1e-5, Number.EPSILON);
  const edgeDelta = flatDelta * 4;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    let runStart = -1;
    const finishRun = (end: number): void => {
      if (runStart < 0) return;
      const runLength = end - runStart + 1;
      const hasEdges = runStart > 0 && end + 1 < data.length;
      if (
        runLength >= 4
        && hasEdges
        && Math.abs(data[runStart] - data[runStart - 1]) > edgeDelta
        && Math.abs(data[end + 1] - data[end]) > edgeDelta
      ) {
        flatTopRuns++;
      }
      runStart = -1;
    };
    for (let i = 0; i < data.length; i++) {
      const sample = data[i];
      const abs = Math.abs(sample);
      if (abs >= 0.999) clippingSamples++;

      if (i === 0) continue;
      const previous = data[i - 1];
      const flatPair = abs >= nearPeakThreshold
        && Math.abs(previous) >= nearPeakThreshold
        && Math.sign(sample) === Math.sign(previous)
        && Math.abs(sample - previous) <= flatDelta;
      if (flatPair) {
        if (runStart < 0) runStart = i - 1;
      } else if (runStart >= 0) {
        finishRun(i - 1);
      }
    }
    finishRun(data.length - 1);
  }
  return { clippingSamples, flatTopRuns };
}

function calculateAttackMs(mono: Float32Array, sampleRate: number, activeStart: number | null, peak: number): number | null {
  if (activeStart === null || peak <= 0) return null;
  const target = peak * 0.9;
  const maxSamples = Math.min(mono.length, activeStart + Math.floor(sampleRate * 0.75));
  for (let i = activeStart; i < maxSamples; i++) {
    if (Math.abs(mono[i]) >= target) return ((i - activeStart) / sampleRate) * 1000;
  }
  return null;
}

function nextPowerOfTwo(value: number): number {
  let out = 1;
  while (out < value) out <<= 1;
  return out;
}

function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenR = Math.cos(angle);
    const wLenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j];
        const uI = imag[i + j];
        const vR = real[i + j + len / 2] * wr - imag[i + j + len / 2] * wi;
        const vI = real[i + j + len / 2] * wi + imag[i + j + len / 2] * wr;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR;
        imag[i + j + len / 2] = uI - vI;
        const nextWr = wr * wLenR - wi * wLenI;
        wi = wr * wLenI + wi * wLenR;
        wr = nextWr;
      }
    }
  }
}

export function calculateSpectralMetrics(
  mono: Float32Array,
  sampleRate: number,
  activeStart: number | null,
  activeEnd: number | null
): SpectralMetrics {
  if (activeStart === null || activeEnd === null || activeEnd <= activeStart) {
    return { centroidHz: null, highFrequencyRatio: null };
  }
  const available = activeEnd - activeStart + 1;
  const size = Math.max(32, nextPowerOfTwo(Math.min(SPECTRAL_FFT_SIZE, available)));
  const start = Math.min(activeStart + Math.floor(sampleRate * 0.02), Math.max(activeStart, activeEnd - size + 1));
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const sourceIndex = start + i;
    const sample = sourceIndex <= activeEnd && sourceIndex < mono.length ? mono[sourceIndex] : 0;
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, size - 1));
    real[i] = sample * window;
  }
  fft(real, imag);
  let weighted = 0;
  let total = 0;
  let high = 0;
  const nyquistBin = size / 2;
  for (let i = 1; i <= nyquistBin; i++) {
    const mag = Math.hypot(real[i], imag[i]);
    const hz = (i * sampleRate) / size;
    total += mag;
    weighted += hz * mag;
    if (hz >= 4000) high += mag;
  }
  if (total <= 0) return { centroidHz: null, highFrequencyRatio: null };
  return { centroidHz: weighted / total, highFrequencyRatio: high / total };
}

export function estimatePitch(
  mono: Float32Array,
  sampleRate: number,
  midiNote: number,
  activeStart: number | null,
  activeEnd: number | null
): PitchMetrics {
  if (activeStart === null || activeEnd === null || activeEnd - activeStart < 512 || midiNote < 33) {
    return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };
  }
  const activeLength = activeEnd - activeStart + 1;
  const size = Math.min(PITCH_WINDOW_SIZE, activeLength);
  const start = Math.min(
    activeStart + Math.floor(activeLength * 0.25),
    Math.max(activeStart, activeEnd - size + 1)
  );
  const segment = new Float64Array(size);
  const mean = calculateMean(mono, start, start + size);
  let energy = 0;
  for (let i = 0; i < size; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, size - 1));
    const value = (mono[start + i] - mean) * window;
    segment[i] = value;
    energy += value * value;
  }
  if (energy <= 1e-12) return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };

  const expectedFrequency = midiToFrequency(midiNote);
  const expectedLag = sampleRate / expectedFrequency;
  const minLag = Math.max(2, Math.floor(expectedLag * 0.75));
  const maxLag = Math.min(Math.ceil(expectedLag * 1.25), Math.floor(size / 2));
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let e1 = 0;
    let e2 = 0;
    const limit = size - lag;
    for (let i = 0; i < limit; i++) {
      const a = segment[i];
      const b = segment[i + lag];
      sum += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const corr = sum / Math.sqrt(Math.max(1e-20, e1 * e2));
    if (corr > bestCorrelation) {
      bestCorrelation = corr;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };
  const frequencyHz = sampleRate / bestLag;
  const midi = frequencyToMidi(frequencyHz);
  const rawCents = (midi - midiNote) * 100;
  return {
    midi,
    frequencyHz,
    rawCents,
    foldedCents: foldCents(rawCents),
    confidence: bestCorrelation,
  };
}

/**
 * Wide-band YIN-style fundamental estimator for matrix octave validation.
 * Unlike estimatePitch(), this does not search around the declared note and
 * does not fold octaves, so C3/C5 cannot masquerade as an in-tune C4.
 */
export function estimateAbsolutePitch(
  mono: Float32Array,
  sampleRate: number,
  midiNote: number,
  activeStart: number | null,
  activeEnd: number | null,
): PitchMetrics {
  if (activeStart === null || activeEnd === null || activeEnd - activeStart < 512 || sampleRate <= 0) {
    return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };
  }
  const activeLength = activeEnd - activeStart + 1;
  const size = Math.min(Math.max(PITCH_WINDOW_SIZE, 8192), activeLength);
  const start = Math.min(
    activeStart + Math.floor(activeLength * 0.2),
    Math.max(activeStart, activeEnd - size + 1),
  );
  const segment = new Float64Array(size);
  const mean = calculateMean(mono, start, start + size);
  let energy = 0;
  for (let i = 0; i < size; i++) {
    const value = mono[start + i] - mean;
    segment[i] = value;
    energy += value * value;
  }
  if (energy <= 1e-12) {
    return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };
  }

  const minLag = Math.max(2, Math.floor(sampleRate / 5000));
  const maxLag = Math.min(Math.ceil(sampleRate / 30), Math.floor(size / 2));
  if (maxLag <= minLag) {
    return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };
  }
  // FFT autocorrelation keeps the wide search O(N log N), rather than doing
  // a multi-million-operation lag scan for every matrix case.
  const fftSize = nextPowerOfTwo(size * 2);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  real.set(segment);
  fft(real, imag);
  for (let i = 0; i < fftSize; i++) {
    real[i] = real[i] * real[i] + imag[i] * imag[i];
    imag[i] = 0;
  }
  // For real power spectra, a second forward FFT has the inverse's real part;
  // divide by N. (The imaginary sign is irrelevant to autocorrelation.)
  fft(real, imag);
  const prefixSquares = new Float64Array(size + 1);
  for (let i = 0; i < size; i++) prefixSquares[i + 1] = prefixSquares[i] + segment[i] * segment[i];
  const nsdf = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const overlapEnergy = prefixSquares[size - lag] + (prefixSquares[size] - prefixSquares[lag]);
    nsdf[lag] = overlapEnergy > 1e-20 ? (2 * (real[lag] / fftSize)) / overlapEnergy : 0;
  }
  const peaks: number[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (nsdf[lag] > 0 && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] > nsdf[lag + 1]) peaks.push(lag);
  }
  if (peaks.length === 0) {
    return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };
  }
  const strongest = Math.max(...peaks.map(lag => nsdf[lag]));
  const bestLag = peaks.find(lag => nsdf[lag] >= Math.max(0.6, strongest * 0.9)) ?? 0;
  const confidence = bestLag > 0 ? Math.max(0, Math.min(1, nsdf[bestLag])) : 0;
  if (!Number.isFinite(confidence) || confidence <= 0) {
    return { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };
  }
  const before = nsdf[Math.max(minLag, bestLag - 1)];
  const center = nsdf[bestLag];
  const after = nsdf[Math.min(maxLag, bestLag + 1)];
  const denominator = before - 2 * center + after;
  const offset = Math.abs(denominator) > 1e-12
    ? Math.max(-0.5, Math.min(0.5, 0.5 * (before - after) / denominator))
    : 0;
  const refinedLag = bestLag + offset;
  const frequencyHz = sampleRate / refinedLag;
  const midi = frequencyToMidi(frequencyHz);
  const rawCents = (midi - midiNote) * 100;
  return {
    midi,
    frequencyHz,
    rawCents,
    foldedCents: foldCents(rawCents),
    confidence,
  };
}

function calculateLoopMetrics(
  mono: Float32Array,
  sampleRate: number,
  peak: number,
  context: SampleContext
): LoopMetrics | null {
  if (!context.loop) return null;
  // Loop points originate as integer source frames. Round instead of floor so
  // JSON decimal serialization cannot move an exact source marker one frame.
  const start = Math.max(0, Math.round((context.loopStart ?? 0) * sampleRate));
  const endBoundary = context.loopEnd === undefined
    ? mono.length
    : Math.min(mono.length, Math.round(context.loopEnd * sampleRate));
  const loopLength = endBoundary - start;
  const window = Math.min(Math.floor(sampleRate * 0.005), loopLength);
  if (peak <= 0) {
    return { checked: false, skippedReason: 'silent loop sample', seamJumpDb: null, derivativeDiscontinuityRatio: null };
  }
  if (start < 0 || start + 1 >= mono.length || endBoundary <= start || endBoundary > mono.length || window < 16) {
    return { checked: false, skippedReason: 'loop region too short for boundary analysis', seamJumpDb: null, derivativeDiscontinuityRatio: null };
  }

  // Web Audio's continuous-time loop boundary at E transitions from the slope
  // approaching x[E] to x[start]. For the authoritative SFZ loops x[E] is the
  // continuity oracle even though the last discrete sample emitted beforehand
  // is E-1; duplicating E by mapping loopEnd to E+1 worsens the rendered slope.
  const endValue = endBoundary < mono.length
    ? mono[endBoundary]
    : 2 * mono[mono.length - 1] - mono[mono.length - 2];
  const leftSlope = endBoundary < mono.length
    ? mono[endBoundary] - mono[endBoundary - 1]
    : mono[mono.length - 1] - mono[mono.length - 2];
  const rightSlope = mono[start + 1] - mono[start];

  let derivativeSquares = 0;
  let derivativeCount = 0;
  const leftFirst = Math.max(1, endBoundary - window + 1);
  const leftLast = Math.min(endBoundary, mono.length - 1);
  for (let i = leftFirst; i <= leftLast; i++) {
    const derivative = mono[i] - mono[i - 1];
    derivativeSquares += derivative * derivative;
    derivativeCount++;
  }
  const rightLast = Math.min(mono.length - 1, start + window);
  for (let i = start + 1; i <= rightLast; i++) {
    const derivative = mono[i] - mono[i - 1];
    derivativeSquares += derivative * derivative;
    derivativeCount++;
  }
  if (derivativeCount < 16) {
    return { checked: false, skippedReason: 'loop derivative neighborhoods are too short', seamJumpDb: null, derivativeDiscontinuityRatio: null };
  }

  const derivativeRms = Math.sqrt(derivativeSquares / derivativeCount);
  const derivativeDifference = Math.abs(leftSlope - rightSlope);
  const derivativeDiscontinuityRatio = derivativeRms <= 1e-12
    ? derivativeDifference <= 1e-12 ? 0 : Number.POSITIVE_INFINITY
    : derivativeDifference / derivativeRms;
  return {
    checked: true,
    seamJumpDb: amplitudeToDb(Math.abs(endValue - mono[start]) / peak),
    derivativeDiscontinuityRatio,
  };
}

function calculateStereoMetrics(decoded: DecodedAudioLike, activeStart: number | null, activeEnd: number | null): StereoMetrics | null {
  if (decoded.numberOfChannels < 2 || activeStart === null || activeEnd === null || activeEnd <= activeStart) return null;
  const left = decoded.getChannelData(0);
  const right = decoded.getChannelData(1);
  const start = activeStart;
  const end = Math.min(activeEnd + 1, left.length, right.length);
  const length = end - start;
  if (length <= 0) return null;
  let sumL = 0;
  let sumR = 0;
  for (let i = start; i < end; i++) {
    sumL += left[i];
    sumR += right[i];
  }
  const meanL = sumL / length;
  const meanR = sumR / length;
  let covariance = 0;
  let varL = 0;
  let varR = 0;
  let monoSquares = 0;
  let stereoSquares = 0;
  for (let i = start; i < end; i++) {
    const l = left[i] - meanL;
    const r = right[i] - meanR;
    covariance += l * r;
    varL += l * l;
    varR += r * r;
    monoSquares += ((left[i] + right[i]) / 2) ** 2;
    stereoSquares += (left[i] ** 2 + right[i] ** 2) / 2;
  }
  const correlation = covariance / Math.sqrt(Math.max(1e-20, varL * varR));
  const monoRms = Math.sqrt(monoSquares / length);
  const stereoRms = Math.sqrt(stereoSquares / length);
  const leftRms = Math.sqrt(varL / length);
  const rightRms = Math.sqrt(varR / length);
  return {
    correlation,
    monoLossDb: amplitudeToDb(monoRms / (stereoRms + 1e-12)),
    leftRightBalanceDb: amplitudeToDb((leftRms + 1e-12) / (rightRms + 1e-12)),
  };
}

export function analyzeDecodedSampleWithMono(context: SampleContext, decoded: DecodedAudioLike): AnalyzedDecodedSample {
  const mono = mixToMono(decoded);
  let peak = 0;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    peak = Math.max(peak, calculatePeak(decoded.getChannelData(channel)));
  }
  const active = findActiveRegion(mono, decoded.sampleRate, peak);
  const anyChannelActive = findAnyChannelActiveRegion(decoded, peak);
  const anyChannelLeadingSilenceMs = anyChannelActive.start === null
    ? 0
    : (anyChannelActive.start / decoded.sampleRate) * 1000;
  const activeStart = active.start;
  const activeEnd = active.end;
  const activeRms = activeStart === null || activeEnd === null
    ? 0
    : calculateRms(mono, activeStart, activeEnd + 1);
  const wholeRms = calculateRms(mono);
  const dcOffset = activeStart === null || activeEnd === null
    ? calculateMean(mono)
    : calculateMean(mono, activeStart, activeEnd + 1);
  const { clippingSamples, flatTopRuns } = countFlatTopRuns(decoded, peak);
  const tailWindow = Math.min(mono.length, Math.floor(decoded.sampleRate * 0.02));
  const tailPeak = tailWindow > 0 ? calculatePeak(mono, mono.length - tailWindow, mono.length) : 0;
  const spectral = calculateSpectralMetrics(mono, decoded.sampleRate, activeStart, activeEnd);
  const supportedKRate = decoded.sampleRate === 44100 || decoded.sampleRate === 48000
    ? decoded.sampleRate
    : null;
  const kChannels = Array.from(
    { length: decoded.numberOfChannels },
    (_, channel) => decoded.getChannelData(channel),
  );
  const pitch = context.pitched
    ? estimatePitch(mono, decoded.sampleRate, context.note, activeStart, activeEnd)
    : { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 };

  const metrics: SampleQualityMetrics = {
    instrumentId: context.instrumentId,
    instrumentName: context.instrumentName,
    file: context.file,
    note: context.note,
    velocityMin: context.velocityMin,
    velocityMax: context.velocityMax,
    durationSec: decoded.duration,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    peak,
    peakDb: amplitudeToDb(peak),
    rmsDb: amplitudeToDb(wholeRms),
    activeRmsDb: amplitudeToDb(activeRms),
    loudnessKMax: supportedKRate === null
      ? null
      : loudnessKMax(kChannels, supportedKRate),
    playbackGainDb: context.playbackGainDb ?? 0,
    dcOffset,
    dcOffsetDb: amplitudeToDb(Math.abs(dcOffset)),
    crestFactorDb: activeRms > 0 ? amplitudeToDb(peak / activeRms) : null,
    leadingSilenceMs: anyChannelLeadingSilenceMs,
    effectiveLeadingSilenceMs: Math.max(
      0,
      anyChannelLeadingSilenceMs - (context.playbackStartOffsetMs ?? 0),
    ),
    trailingSilenceMs: active.trailingSilenceMs,
    attackMs: calculateAttackMs(mono, decoded.sampleRate, activeStart, peak),
    tailLevelDbRelPeak: peak > 0 ? amplitudeToDb(tailPeak / peak) : null,
    clippingSamples,
    flatTopRuns,
    activeStartMs: activeStart === null ? null : (activeStart / decoded.sampleRate) * 1000,
    activeEndMs: activeEnd === null ? null : (activeEnd / decoded.sampleRate) * 1000,
    spectral,
    pitch,
    loop: calculateLoopMetrics(mono, decoded.sampleRate, peak, context),
    // Never derive the stereo/mono-translation window from the mono sum: exact
    // polarity inversion would erase that window and make the worst possible
    // fold-down report `null` instead of a fatal loss.
    stereo: calculateStereoMetrics(decoded, anyChannelActive.start, anyChannelActive.end),
  };
  return { metrics, mono };
}

export function analyzeDecodedSample(context: SampleContext, decoded: DecodedAudioLike): SampleQualityMetrics {
  return analyzeDecodedSampleWithMono(context, decoded).metrics;
}

export function classifySampleIssues(
  metrics: SampleQualityMetrics,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (
    severity: IssueSeverity,
    code: string,
    message: string,
    value?: number | string | null,
    threshold?: number | string
  ): void => {
    issues.push({ severity, code, instrumentId: metrics.instrumentId, file: metrics.file, message, value, threshold });
  };

  if (!Number.isFinite(metrics.peak) || !Number.isFinite(metrics.activeRmsDb)) {
    add('error', 'NON_FINITE_METRIC', 'Decoded sample produced non-finite quality metrics');
    return issues;
  }
  const lossyDelivery = /\.(?:aac|m4a|mp3|ogg|opus|webm)$/i.test(metrics.file);
  if (lossyDelivery && metrics.peakDb > thresholds.hotPeakDb) {
    add(
      'review',
      'HOT_PEAK',
      `Decoded lossy peak ${metrics.peakDb.toFixed(1)} dBFS leaves little/no codec crest margin`,
      metrics.peakDb,
      thresholds.hotPeakDb,
    );
  }
  if (metrics.flatTopRuns > 3) {
    add('error', 'FLAT_TOP_CLIPPING', `${metrics.flatTopRuns} flat-top clipping runs detected`, metrics.flatTopRuns, 3);
  } else if (metrics.clippingSamples > 0) {
    add('review', 'CLIPPING_SAMPLES', `${metrics.clippingSamples} samples are at/near full scale`, metrics.clippingSamples, 0);
  }
  if (metrics.dcOffsetDb > thresholds.dcFailDb) {
    add('error', 'DC_OFFSET', `DC offset ${metrics.dcOffsetDb.toFixed(1)} dBFS is excessive`, metrics.dcOffsetDb, thresholds.dcFailDb);
  } else if (metrics.dcOffsetDb > thresholds.dcWarnDb) {
    add('review', 'DC_OFFSET', `DC offset ${metrics.dcOffsetDb.toFixed(1)} dBFS should be reviewed`, metrics.dcOffsetDb, thresholds.dcWarnDb);
  }
  if (metrics.effectiveLeadingSilenceMs > thresholds.leadingSilenceMs) {
    add(
      'review',
      'LEADING_SILENCE',
      `Effective leading silence ${metrics.effectiveLeadingSilenceMs.toFixed(1)}ms may feel late (decoded ${metrics.leadingSilenceMs.toFixed(1)}ms)`,
      metrics.effectiveLeadingSilenceMs,
      thresholds.leadingSilenceMs,
    );
  }
  if (!metrics.loop && metrics.tailLevelDbRelPeak !== null && metrics.tailLevelDbRelPeak > thresholds.tailTruncationDbRelPeak && metrics.trailingSilenceMs < 5) {
    add('review', 'TAIL_TRUNCATION', `Tail remains ${metrics.tailLevelDbRelPeak.toFixed(1)} dB below peak at EOF; possible truncation`, metrics.tailLevelDbRelPeak, thresholds.tailTruncationDbRelPeak);
  }
  if (
    metrics.pitch.foldedCents !== null &&
    metrics.pitch.confidence >= thresholds.minPitchConfidence &&
    Math.abs(metrics.pitch.foldedCents) > thresholds.pitchReviewCents
  ) {
    add('review', 'PITCH_DEVIATION', `Estimated pitch is ${metrics.pitch.foldedCents.toFixed(1)} cents from mapped note`, metrics.pitch.foldedCents, thresholds.pitchReviewCents);
  }
  if (metrics.loop) {
    if (!metrics.loop.checked) {
      add('review', 'LOOP_SEAM_UNCHECKED', `Loop seam could not be checked: ${metrics.loop.skippedReason ?? 'unknown reason'}`);
    } else {
      if (metrics.loop.seamJumpDb !== null && metrics.loop.seamJumpDb > thresholds.loopValueJumpDbMax) {
        add(
          'review',
          'LOOP_VALUE_DISCONTINUITY',
          `Loop boundary value jumps at ${metrics.loop.seamJumpDb.toFixed(1)} dB relative to peak`,
          metrics.loop.seamJumpDb,
          thresholds.loopValueJumpDbMax,
        );
      }
      if (
        metrics.loop.derivativeDiscontinuityRatio !== null
        && metrics.loop.derivativeDiscontinuityRatio > thresholds.loopDerivativeRatioMax
      ) {
        add(
          'review',
          'LOOP_DERIVATIVE_DISCONTINUITY',
          `Loop boundary slope changes by ${metrics.loop.derivativeDiscontinuityRatio.toFixed(2)}× local derivative RMS`,
          metrics.loop.derivativeDiscontinuityRatio,
          thresholds.loopDerivativeRatioMax,
        );
      }
    }
  }
  if (metrics.stereo) {
    if (metrics.stereo.correlation !== null && metrics.stereo.correlation < thresholds.phaseCorrelationMin) {
      add('review', 'NEGATIVE_PHASE_CORRELATION', `Stereo correlation ${metrics.stereo.correlation.toFixed(3)} may collapse poorly to mono`, metrics.stereo.correlation, thresholds.phaseCorrelationMin);
    }
    if (metrics.stereo.monoLossDb !== null && metrics.stereo.monoLossDb < thresholds.monoLossDb) {
      add('review', 'MONO_LOSS', `Mono fold-down loses ${Math.abs(metrics.stereo.monoLossDb).toFixed(1)} dB`, metrics.stereo.monoLossDb, thresholds.monoLossDb);
    }
  }
  return issues;
}
