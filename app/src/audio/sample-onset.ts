/** Loudness floor used by both delivery calibration and decoded-buffer playback. */
const ONSET_ABSOLUTE_FLOOR = 10 ** (-70 / 20);
/** Relative threshold keeps low-level codec noise from being mistaken for an attack. */
const ONSET_RELATIVE_TO_PEAK = 10 ** (-50 / 20);

/** Shipped sample attacks should begin within this window after scheduling. */
export const MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS = 0.005;

/**
 * Decoder priming varies by codec implementation. Values above this bound are
 * treated as authored silence (or a bad asset), not something playback should
 * silently remove.
 */
export const MAX_ADAPTIVE_CODEC_DELAY_SECONDS = 0.03;
/** Hard ceiling for a provenance-backed per-manifest decoder-delay allowance. */
export const MAX_CONFIGURED_ADAPTIVE_CODEC_DELAY_SECONDS = 0.1;

export interface DecodedAudioBufferView {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

const decodedOnsetCache = new WeakMap<object, number>();

/** Measure the first audible frame using the same gate as the sample audit. */
export function measureDecodedLeadingSilenceSeconds(buffer: DecodedAudioBufferView): number {
  const cached = decodedOnsetCache.get(buffer);
  if (cached !== undefined) return cached;

  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let frame = 0; frame < data.length; frame++) {
      peak = Math.max(peak, Math.abs(data[frame]));
    }
  }

  // A silent/invalid buffer has no onset to compensate. It is reported by the
  // quality audit instead of being turned into an almost-end-of-file offset.
  if (peak < ONSET_ABSOLUTE_FLOOR || buffer.sampleRate <= 0) {
    decodedOnsetCache.set(buffer, 0);
    return 0;
  }

  const threshold = Math.max(ONSET_ABSOLUTE_FLOOR, peak * ONSET_RELATIVE_TO_PEAK);
  let onsetFrame = buffer.length;
  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      if (Math.abs(buffer.getChannelData(channel)[frame] ?? 0) > threshold) {
        onsetFrame = frame;
        frame = buffer.length;
        break;
      }
    }
  }

  const seconds = onsetFrame / buffer.sampleRate;
  decodedOnsetCache.set(buffer, seconds);
  return seconds;
}

/**
 * Preserve authored offsets and adapt only the residual, decoder-dependent
 * delay for known lossy deliveries. Five milliseconds of pre-attack margin remains
 * so the correction cannot clip the detected transient.
 */
export function compensatedSampleStartOffset(
  configuredStart: number | undefined,
  decodedLeadingSilence: number,
  adaptCodecDelay: boolean,
  maxAdaptiveCodecDelay: number = MAX_ADAPTIVE_CODEC_DELAY_SECONDS,
): number | undefined {
  const configured = Number.isFinite(configuredStart) && (configuredStart ?? -1) >= 0
    ? configuredStart
    : undefined;
  const adaptiveLimit = Number.isFinite(maxAdaptiveCodecDelay)
    ? Math.min(
        MAX_CONFIGURED_ADAPTIVE_CODEC_DELAY_SECONDS,
        Math.max(0, maxAdaptiveCodecDelay),
      )
    : MAX_ADAPTIVE_CODEC_DELAY_SECONDS;
  const canAdapt = adaptCodecDelay &&
    Number.isFinite(decodedLeadingSilence) &&
    decodedLeadingSilence > MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS &&
    decodedLeadingSilence <= adaptiveLimit;
  if (!canAdapt) return configured;

  const adaptive = decodedLeadingSilence - MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS;
  return Math.max(configured ?? 0, adaptive);
}
