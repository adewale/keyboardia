export interface PcmMetrics {
  peak: number;
  rms: number;
  tailRms: number;
  spectralCentroidHz: number;
  clippingSamples: number;
}

export interface PcmComparison {
  peakDeltaDb: number;
  rmsDeltaDb: number;
  tailDeltaDb: number;
  spectralCentroidRatio: number;
  newClippingSamples: number;
}

function rms(samples: Float32Array, start = 0): number {
  if (start >= samples.length) return 0;
  let sum = 0;
  for (let index = start; index < samples.length; index++) sum += samples[index] ** 2;
  return Math.sqrt(sum / Math.max(1, samples.length - start));
}

function toDb(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-12));
}

/** Deterministic single-window centroid used for renderer migration evidence. */
function spectralCentroid(samples: Float32Array, sampleRate: number): number {
  const size = Math.min(2048, 2 ** Math.floor(Math.log2(Math.max(2, samples.length))));
  if (size < 2) return 0;
  const offset = Math.max(0, Math.floor((samples.length - size) / 2));
  let weighted = 0;
  let magnitudeTotal = 0;
  for (let bin = 0; bin <= size / 2; bin++) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < size; index++) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
      const angle = (-2 * Math.PI * bin * index) / size;
      const sample = samples[offset + index] * window;
      real += sample * Math.cos(angle);
      imaginary += sample * Math.sin(angle);
    }
    const magnitude = Math.hypot(real, imaginary);
    const frequency = (bin * sampleRate) / size;
    weighted += frequency * magnitude;
    magnitudeTotal += magnitude;
  }
  return magnitudeTotal === 0 ? 0 : weighted / magnitudeTotal;
}

export function measurePcm(
  samples: Float32Array,
  sampleRate: number,
  tailStartSeconds: number,
): PcmMetrics {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive');
  const tailStart = Math.max(0, Math.min(samples.length, Math.floor(tailStartSeconds * sampleRate)));
  let peak = 0;
  let clippingSamples = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    if (magnitude > 1) clippingSamples++;
  }
  return {
    peak,
    rms: rms(samples),
    tailRms: rms(samples, tailStart),
    spectralCentroidHz: spectralCentroid(samples, sampleRate),
    clippingSamples,
  };
}

export function comparePcmMetrics(baseline: PcmMetrics, candidate: PcmMetrics): PcmComparison {
  return {
    peakDeltaDb: Math.abs(toDb(candidate.peak) - toDb(baseline.peak)),
    rmsDeltaDb: Math.abs(toDb(candidate.rms) - toDb(baseline.rms)),
    tailDeltaDb: Math.abs(toDb(candidate.tailRms) - toDb(baseline.tailRms)),
    spectralCentroidRatio: baseline.spectralCentroidHz === 0
      ? (candidate.spectralCentroidHz === 0 ? 0 : Number.POSITIVE_INFINITY)
      : Math.abs(candidate.spectralCentroidHz - baseline.spectralCentroidHz)
        / baseline.spectralCentroidHz,
    newClippingSamples: Math.max(0, candidate.clippingSamples - baseline.clippingSamples),
  };
}
