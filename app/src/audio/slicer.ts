/**
 * Transient detection for recordings — finds the onsets a recording should be
 * cut at, in seconds.
 *
 * This module used to also export sliceByTransients/sliceEqual/extractSlice/
 * autoSlice. Nothing imported them: Recorder.tsx calls detectTransients and
 * does its own cutting, correctly, in samples. The unused slicing helpers had
 * drifted into a units bug — sliceByTransients fed detectTransients' *seconds*
 * straight into Slice.startSample and then divided by sampleRate again — so
 * they were removed rather than tested. Tests for code nothing calls would
 * have reported a working slicer that no user could reach.
 */

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
