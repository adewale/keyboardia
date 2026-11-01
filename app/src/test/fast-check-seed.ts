export const DEFAULT_FAST_CHECK_SEED = 0x5eed;

export function resolveFastCheckSeed(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_FAST_CHECK_SEED;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`FC_SEED must be a safe integer, got: ${value}`);
  }
  return seed;
}
