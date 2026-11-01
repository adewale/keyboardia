/** Aggregate fetch/decode pressure shared by all sampled instruments. */
export const MAX_CONCURRENT_SAMPLE_LOADS = 6;

/** Leave one browser connection available for manifests and new foreground roots. */
export const MAX_CONCURRENT_BACKGROUND_SAMPLE_LOADS = MAX_CONCURRENT_SAMPLE_LOADS - 1;

/**
 * Deterministic transfer-only budget used to guard progressive sample packs.
 * Decode time and browser scheduling remain covered by runtime tests.
 */
export const THROTTLED_SAMPLE_NETWORK_PROFILE = Object.freeze({
  name: '1.6 Mbps / 150 ms RTT',
  bitsPerSecond: 1_600_000,
  roundTripSeconds: 0.15,
  priorityReadySeconds: 20,
  backgroundTransferSeconds: 60,
});

export function estimatedSampleTransferSeconds(
  bytes: number,
  fileCount: number,
  concurrency = MAX_CONCURRENT_SAMPLE_LOADS,
): number {
  if (bytes <= 0 || fileCount <= 0) return 0;
  const transferSeconds = bytes / (THROTTLED_SAMPLE_NETWORK_PROFILE.bitsPerSecond / 8);
  const requestRounds = Math.ceil(fileCount / concurrency);
  return transferSeconds + requestRounds * THROTTLED_SAMPLE_NETWORK_PROFILE.roundTripSeconds;
}
