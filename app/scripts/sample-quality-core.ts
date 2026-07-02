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
  loopCorrelationMin: number;
  loopDiffRatioMax: number;
  loopLowpassBoxcarSamples: number;
  velocityInversionDb: number;
  noteLevelStepDb: number;
  rangeOverextensionSemitones: number;
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
  seamJumpDb: number | null;
  windowDiffRatio: number | null;
  correlation: number | null;
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
  dcOffset: number;
  dcOffsetDb: number;
  crestFactorDb: number | null;
  leadingSilenceMs: number;
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
 * - loop seams compare 5ms windows after an 8-sample (~5.5kHz at 44.1kHz)
 *   box lowpass so lossy high-harmonic requantization does not false-positive,
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
  loopCorrelationMin: 0.9,
  loopDiffRatioMax: 0.1,
  loopLowpassBoxcarSamples: 8,
  velocityInversionDb: 1,
  noteLevelStepDb: 3,
  rangeOverextensionSemitones: 6,
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

function countFlatTopRuns(decoded: DecodedAudioLike, peak: number): { clippingSamples: number; flatTopRuns: number } {
  let clippingSamples = 0;
  let flatTopRuns = 0;
  if (peak <= 0) return { clippingSamples, flatTopRuns };
  const flatThreshold = peak > 0.97 ? Math.max(0.985 * peak, 0.95) : 1.01;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    let run = 0;
    for (const sample of data) {
      const abs = Math.abs(sample);
      if (abs >= 0.999) clippingSamples++;
      if (abs >= flatThreshold) {
        run++;
      } else {
        if (run >= 4) flatTopRuns++;
        run = 0;
      }
    }
    if (run >= 4) flatTopRuns++;
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

function lowpassBoxcar(data: Float32Array, taps: number): Float32Array {
  const size = Math.max(1, Math.floor(taps));
  if (data.length < size) return new Float32Array();
  const out = new Float32Array(data.length - size + 1);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= size) sum -= data[i - size];
    if (i >= size - 1) out[i - size + 1] = sum / size;
  }
  return out;
}

function calculateLoopMetrics(
  mono: Float32Array,
  sampleRate: number,
  peak: number,
  context: SampleContext
): LoopMetrics | null {
  if (!context.loop) return null;
  const start = Math.max(0, Math.floor((context.loopStart ?? 0) * sampleRate));
  const endExclusive = context.loopEnd === undefined
    ? mono.length
    : Math.min(mono.length, Math.floor(context.loopEnd * sampleRate));
  const loopLength = endExclusive - start;
  const window = Math.min(Math.floor(sampleRate * 0.005), endExclusive, mono.length - start, loopLength);
  if (peak <= 0) {
    return { checked: false, skippedReason: 'silent loop sample', seamJumpDb: null, windowDiffRatio: null, correlation: null };
  }
  if (start < 0 || start >= mono.length || endExclusive <= start || window < 16) {
    return { checked: false, skippedReason: 'loop region too short for 5ms seam window', seamJumpDb: null, windowDiffRatio: null, correlation: null };
  }

  const beforeRaw = mono.slice(endExclusive - window, endExclusive);
  const afterRaw = mono.slice(start, start + window);
  const lowpassTaps = DEFAULT_QUALITY_THRESHOLDS.loopLowpassBoxcarSamples;
  const before = lowpassBoxcar(beforeRaw, lowpassTaps);
  const after = lowpassBoxcar(afterRaw, lowpassTaps);
  const length = Math.min(before.length, after.length);
  if (length < 16) {
    return { checked: false, skippedReason: 'loop seam window too short after lowpass', seamJumpDb: null, windowDiffRatio: null, correlation: null };
  }

  const seamJump = Math.abs(mono[endExclusive - 1] - mono[start]);
  let diffSquares = 0;
  let signalSquares = 0;
  let dot = 0;
  let beforeSquares = 0;
  let afterSquares = 0;
  for (let i = 0; i < length; i++) {
    const beforeSample = before[i];
    const afterSample = after[i];
    const diff = beforeSample - afterSample;
    diffSquares += diff * diff;
    signalSquares += beforeSample * beforeSample;
    dot += beforeSample * afterSample;
    beforeSquares += beforeSample * beforeSample;
    afterSquares += afterSample * afterSample;
  }
  const windowDiffRatio = Math.sqrt(diffSquares / length) / (Math.sqrt(signalSquares / length) + 1e-12);
  const correlation = dot / Math.sqrt(Math.max(1e-20, beforeSquares * afterSquares));
  return { checked: true, seamJumpDb: amplitudeToDb(seamJump / peak), windowDiffRatio, correlation };
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
    dcOffset,
    dcOffsetDb: amplitudeToDb(Math.abs(dcOffset)),
    crestFactorDb: activeRms > 0 ? amplitudeToDb(peak / activeRms) : null,
    leadingSilenceMs: active.leadingSilenceMs,
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
    stereo: calculateStereoMetrics(decoded, activeStart, activeEnd),
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
  if (metrics.peakDb > thresholds.hotPeakDb) {
    add('review', 'HOT_PEAK', `Peak ${metrics.peakDb.toFixed(1)} dBFS leaves little/no lossy-codec headroom`, metrics.peakDb, thresholds.hotPeakDb);
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
  if (metrics.leadingSilenceMs > thresholds.leadingSilenceMs) {
    add('review', 'LEADING_SILENCE', `Leading silence ${metrics.leadingSilenceMs.toFixed(1)}ms may feel late`, metrics.leadingSilenceMs, thresholds.leadingSilenceMs);
  }
  if (metrics.tailLevelDbRelPeak !== null && metrics.tailLevelDbRelPeak > thresholds.tailTruncationDbRelPeak && metrics.trailingSilenceMs < 5) {
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
      if (metrics.loop.windowDiffRatio !== null && metrics.loop.windowDiffRatio > thresholds.loopDiffRatioMax) {
        add('review', 'LOOP_SEAM_DIFF', `Loop seam window differs by ${(metrics.loop.windowDiffRatio * 100).toFixed(1)}% of signal RMS`, metrics.loop.windowDiffRatio, thresholds.loopDiffRatioMax);
      }
      if (metrics.loop.correlation !== null && metrics.loop.correlation < thresholds.loopCorrelationMin) {
        add('review', 'LOOP_SEAM_CORRELATION', `Loop seam correlation ${metrics.loop.correlation.toFixed(3)} is low`, metrics.loop.correlation, thresholds.loopCorrelationMin);
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
