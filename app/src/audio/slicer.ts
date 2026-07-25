/**
 * Auto-Slice — automatically divide a recording into playable slices.
 *
 * Modes:
 * - transient: Detect transients (drum hits, syllables) and slice at each one
 * - equal: Divide evenly into N equal parts
 *
 * UNITS. `detectTransients` returns **seconds**; `Slice` carries **sample
 * indices** plus their second-valued equivalents. Everything between the two
 * must convert explicitly. The July 2026 audit found this module had lost that
 * discipline — `sliceByTransients` assigned onset seconds straight to
 * `Slice.startSample` and then divided by the sample rate a second time, so
 * `autoSlice(ctx, buf, 'transient')` asked `createBuffer` for a fractional
 * length. It went unnoticed because nothing outside the module's own tests
 * imported it. `slicer.test.ts` now covers every export, and the round-trip
 * tests exist specifically to pin the units down.
 */
import { logger } from '../utils/logger';

export type SliceMode = 'transient' | 'equal';

export interface Slice {
  startSample: number;
  endSample: number;
  startTime: number; // seconds
  endTime: number; // seconds
}

export interface SliceResult {
  slices: Slice[];
  sourceBuffer: AudioBuffer;
}

/**
 * Detect transients in an audio buffer using onset detection.
 * Returns time positions (in seconds) where transients occur.
 */
export function detectTransients(buffer: AudioBuffer, sensitivity: number = 0.3, minGapSeconds: number = 0.05): number[] {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;

  // Use a simple energy-based onset detection
  const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
  const hopSize = Math.floor(windowSize / 2);

  const energies: number[] = [];

  // Calculate RMS energy for each window
  for (let i = 0; i < data.length - windowSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      sum += data[i + j] * data[i + j];
    }
    energies.push(Math.sqrt(sum / windowSize));
  }

  // Find onset positions (where energy increases significantly)
  const transients: number[] = []; // Return times in seconds (excluding 0)
  const threshold = sensitivity;
  const minSamples = Math.floor(sampleRate * minGapSeconds);

  for (let i = 1; i < energies.length; i++) {
    const diff = energies[i] - energies[i - 1];
    const relativeDiff = energies[i - 1] > 0.001 ? diff / energies[i - 1] : diff;

    // Detect onset when energy increases significantly
    if (relativeDiff > threshold && energies[i] > 0.01) {
      const samplePosition = i * hopSize;
      const timePosition = samplePosition / sampleRate;

      // Avoid slices too close together
      const lastTime = transients.length > 0 ? transients[transients.length - 1] : 0;
      if (samplePosition - (lastTime * sampleRate) > minSamples) {
        transients.push(timePosition);
      }
    }
  }

  return transients;
}

/**
 * Build a Slice from a sample range, filling in the second-valued fields.
 *
 * Every Slice is constructed here so the two representations cannot disagree:
 * the units bug this module carried was possible only because callers built
 * the object literal by hand.
 */
function makeSlice(startSample: number, endSample: number, sampleRate: number): Slice {
  return {
    startSample,
    endSample,
    startTime: startSample / sampleRate,
    endTime: endSample / sampleRate,
  };
}

/**
 * Slice an audio buffer at its transients.
 *
 * The returned slices tile the whole buffer: audio before the first onset
 * becomes a leading slice rather than being discarded. That matches what
 * `Recorder.tsx` does with `detectTransients` directly (`[0, ...points, 1]`),
 * and what this function's own comment always claimed — the previous version
 * said "start and end will be added" and then added neither, silently dropping
 * everything before the first hit.
 */
export function sliceByTransients(
  buffer: AudioBuffer,
  maxSlices: number = 16,
  sensitivity: number = 0.3
): SliceResult {
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;

  // detectTransients works in seconds; Slice works in samples. Convert once,
  // here, and keep everything below in samples.
  const onsetSamples = detectTransients(buffer, sensitivity)
    .map((seconds) => Math.floor(seconds * sampleRate))
    .filter((sample) => sample > 0 && sample < totalSamples);

  // Cut points always start at 0 so the slices tile the buffer.
  let cutPoints = [0, ...onsetSamples];

  // Thin evenly if there are more cut points than requested slices. The first
  // point must survive — dropping it would reintroduce the leading gap.
  if (cutPoints.length > maxSlices && maxSlices > 0) {
    const step = cutPoints.length / maxSlices;
    cutPoints = Array.from(
      { length: maxSlices },
      (_, i) => cutPoints[Math.floor(i * step)]
    );
  }

  const slices = cutPoints.map((startSample, i) =>
    makeSlice(startSample, i < cutPoints.length - 1 ? cutPoints[i + 1] : totalSamples, sampleRate)
  );

  logger.audio.log(`Slicer: Found ${slices.length} slices by transient detection`);

  return { slices, sourceBuffer: buffer };
}

/**
 * Slice an audio buffer into equal parts.
 *
 * The final slice absorbs the remainder, so the slices always tile the buffer
 * exactly even when `numSlices` does not divide its length.
 */
export function sliceEqual(buffer: AudioBuffer, numSlices: number = 16): SliceResult {
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;

  // A caller asking for zero or negative slices gets the whole buffer rather
  // than an empty result or a NaN-length one.
  const count = Math.max(1, Math.floor(numSlices));
  const samplesPerSlice = Math.floor(totalSamples / count);

  const slices = Array.from({ length: count }, (_, i) =>
    makeSlice(
      i * samplesPerSlice,
      i === count - 1 ? totalSamples : (i + 1) * samplesPerSlice,
      sampleRate
    )
  );

  logger.audio.log(`Slicer: Created ${count} equal slices`);

  return { slices, sourceBuffer: buffer };
}

/**
 * Extract a single slice as a new mono AudioBuffer.
 *
 * The range is clamped to the source buffer: an out-of-range Slice would
 * otherwise read `undefined` past the end of the channel data and write NaN
 * samples into the result, which plays as silence or a click rather than
 * failing visibly.
 */
export function extractSlice(
  audioContext: AudioContext,
  sourceBuffer: AudioBuffer,
  slice: Slice
): AudioBuffer {
  const start = Math.max(0, Math.min(Math.floor(slice.startSample), sourceBuffer.length));
  const end = Math.max(start, Math.min(Math.floor(slice.endSample), sourceBuffer.length));
  // createBuffer rejects a zero length, so a collapsed range yields one frame.
  const sliceLength = Math.max(1, end - start);

  const sliceBuffer = audioContext.createBuffer(1, sliceLength, sourceBuffer.sampleRate);
  const sourceData = sourceBuffer.getChannelData(0);
  const sliceData = sliceBuffer.getChannelData(0);

  for (let i = 0; i < sliceLength; i++) {
    sliceData[i] = sourceData[start + i] ?? 0;
  }

  return sliceBuffer;
}

/**
 * Auto-slice a buffer and return individual AudioBuffers for each slice.
 */
export function autoSlice(
  audioContext: AudioContext,
  sourceBuffer: AudioBuffer,
  mode: SliceMode = 'equal',
  numSlices: number = 16,
  sensitivity: number = 0.3
): AudioBuffer[] {
  const result = mode === 'transient'
    ? sliceByTransients(sourceBuffer, numSlices, sensitivity)
    : sliceEqual(sourceBuffer, numSlices);

  return result.slices.map((slice) => extractSlice(audioContext, sourceBuffer, slice));
}
