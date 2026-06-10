/**
 * Statistical helpers for audio metrics.
 */

/**
 * Compute a percentile value from an array of numbers.
 * Uses linear interpolation between nearest ranks.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower];

  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Compute mean of an array.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Compute standard deviation.
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  let sumSquaredDiff = 0;
  for (const v of values) {
    const diff = v - avg;
    sumSquaredDiff += diff * diff;
  }
  return Math.sqrt(sumSquaredDiff / (values.length - 1));
}
