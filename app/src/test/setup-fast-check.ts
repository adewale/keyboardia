/**
 * Global fast-check configuration.
 *
 * Without this, fast-check picks a fresh random seed on every run. That has two
 * costs:
 *
 *   1. A property that fails on, say, 1-in-500 inputs shows up as an
 *      intermittent CI failure that "goes away" on re-run — the classic flaky
 *      test, except the flakiness is designed in.
 *   2. Two green runs do not mean the same thing. The suite explores a
 *      different slice of the input space each time, so "the tests passed" is
 *      not a repeatable claim.
 *
 * Pinning the seed makes property runs reproducible: the same commit explores
 * the same inputs and a failure replays exactly. The tradeoff is that a fixed
 * seed stops discovering *new* inputs over time, so this is deliberately
 * overridable — see the nightly-exploration note below.
 *
 * Override for a one-off exploration:
 *   FC_SEED=$RANDOM npx vitest run
 *
 * Reproduce a specific failure (fast-check prints the seed on failure):
 *   FC_SEED=1234567 npx vitest run src/path/to.property.test.ts
 *
 * Per-call `{ seed: ... }` options still win over this global default, so the
 * files that already pin their own seed keep doing so.
 *
 * NOTE: a scheduled job running with a random FC_SEED is the intended companion
 * to this — it keeps widening coverage while PR runs stay deterministic. That
 * job is not wired up yet; see docs/TEST-AUDIT-2026-07.md.
 */
import fc from 'fast-check';

/** Default seed. Arbitrary but fixed — any constant works, this one is legible. */
const DEFAULT_SEED = 0x5eed;

const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : DEFAULT_SEED;

if (Number.isNaN(seed)) {
  throw new Error(`FC_SEED must be a number, got: ${process.env.FC_SEED}`);
}

fc.configureGlobal({
  seed,
  // Print the failing counterexample and the path to re-run it.
  verbose: process.env.CI ? fc.VerbosityLevel.Verbose : fc.VerbosityLevel.None,
});

// Surface the seed once per worker so a red CI run can be replayed without
// digging for it.
if (process.env.CI) {
  console.log(`[fast-check] seed=${seed} (override with FC_SEED=<n>)`);
}
