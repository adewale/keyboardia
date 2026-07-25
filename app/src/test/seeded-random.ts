/**
 * Deterministic PRNG helpers for tests.
 *
 * `Math.random()` in a test makes a red run unreproducible: the inputs that
 * triggered the failure are gone the moment the process exits. Every random
 * choice a test makes should come from a seed that is printed on failure, so
 * the exact run can be replayed.
 *
 * This is the pattern already used by test/integration/eviction-recovery.test.ts
 * and test/integration/state-machine-fuzz.test.ts, lifted here so the rest of
 * the suite can share it instead of re-declaring mulberry32.
 *
 * Usage:
 *
 *   const SEED = 0x1234;
 *   const rng = mulberry32(SEED);
 *   const index = randInt(rng, 0, tracks.length - 1);
 *   expect(result, `seed=${SEED}`).toBe(expected);   // <- always label the seed
 */

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 * Returns a function producing floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [lo, hi], inclusive. */
export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Pick one element of a non-empty array. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pick() called with an empty array');
  }
  return items[randInt(rng, 0, items.length - 1)];
}
