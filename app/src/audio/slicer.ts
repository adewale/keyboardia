/**
 * Auto-Slice - automatically divide a recording into playable slices
 *
 * Modes:
 * - transient: Detect transients (drum hits, syllables) and slice at each one
 * - equal: Divide evenly into N equal parts
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
 * Slice an audio buffer by detecting transients.
 */
export function sliceByTransients(
  buffer: AudioBuffer,
  maxSlices: number = 16,
  sensitivity: number = 0.3
): SliceResult {
  const transients = detectTransients(buffer, sensitivity);
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;

  // Limit to maxSlices by keeping the most significant ones
  let slicePoints = transients;
  if (slicePoints.length > maxSlices) {
    // Keep evenly distributed slice points
    const step = Math.floor(slicePoints.length / maxSlices);
    slicePoints = slicePoints.filter((_, i) => i % step === 0).slice(0, maxSlices);
  }

  // Ensure we have at least 2 points (start and end will be added)
  if (slicePoints.length === 0) {
    slicePoints = [0];
  }

  // Create slices from points
  const slices: Slice[] = [];
  for (let i = 0; i < slicePoints.length; i++) {
    const startSample = slicePoints[i];
    const endSample = i < slicePoints.length - 1 ? slicePoints[i + 1] : totalSamples;

    slices.push({
      startSample,
      endSample,
      startTime: startSample / sampleRate,
      endTime: endSample / sampleRate,
    });
  }

  logger.audio.log(`Slicer: Found ${slices.length} slices by transient detection`);

  return { slices, sourceBuffer: buffer };
}

/**
 * Slice an audio buffer into equal parts.
 */
export function sliceEqual(buffer: AudioBuffer, numSlices: number = 16): SliceResult {
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;
  const samplesPerSlice = Math.floor(totalSamples / numSlices);

  const slices: Slice[] = [];

  for (let i = 0; i < numSlices; i++) {
    const startSample = i * samplesPerSlice;
    const endSample = i === numSlices - 1 ? totalSamples : (i + 1) * samplesPerSlice;

    slices.push({
      startSample,
      endSample,
      startTime: startSample / sampleRate,
      endTime: endSample / sampleRate,
    });
  }

  logger.audio.log(`Slicer: Created ${numSlices} equal slices`);

  return { slices, sourceBuffer: buffer };
}

/**
 * Extract a single slice as a new AudioBuffer.
 */
export function extractSlice(
  audioContext: AudioContext,
  sourceBuffer: AudioBuffer,
  slice: Slice
): AudioBuffer {
  const sliceLength = slice.endSample - slice.startSample;
  const sliceBuffer = audioContext.createBuffer(
    1, // mono
    sliceLength,
    sourceBuffer.sampleRate
  );

  const sourceData = sourceBuffer.getChannelData(0);
  const sliceData = sliceBuffer.getChannelData(0);

  for (let i = 0; i < sliceLength; i++) {
    sliceData[i] = sourceData[slice.startSample + i];
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
