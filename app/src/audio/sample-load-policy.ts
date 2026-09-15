/** Aggregate fetch/decode pressure shared by all sampled instruments. */
export const MAX_CONCURRENT_SAMPLE_LOADS = 6;

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

export function estimatedSampleTransferSeconds(bytes: number, fileCount: number): number {
  if (bytes <= 0 || fileCount <= 0) return 0;
  const transferSeconds = bytes / (THROTTLED_SAMPLE_NETWORK_PROFILE.bitsPerSecond / 8);
  const requestRounds = Math.ceil(fileCount / MAX_CONCURRENT_SAMPLE_LOADS);
  return transferSeconds + requestRounds * THROTTLED_SAMPLE_NETWORK_PROFILE.roundTripSeconds;
}
