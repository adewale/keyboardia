/** Machine-readable prefix consumed by scripts/promote-pbt-counterexamples.ts. */
export const PBT_COUNTEREXAMPLE_PREFIX = 'PBT_COUNTEREXAMPLE=';

export type PbtKnownFailureLane =
  | 'stateMachine'
  | 'overlap'
  | 'evictionRecovery'
  | 'schedulerMutationRace';

interface FailedCheckDetails {
  seed: number;
  numShrinks: number;
  counterexamplePath: string | null;
  errorInstance: unknown | null;
}

/**
 * Preserve the normal test failure while giving the host runner the final,
 * already-shrunk value in a stable format. Workers tests cannot write files;
 * the weekly workflow parses this line outside the Workers isolate.
 */
export function failWithPbtCounterexample(
  lane: PbtKnownFailureLane,
  example: unknown,
  details: FailedCheckDetails,
): never {
  console.error(`${PBT_COUNTEREXAMPLE_PREFIX}${JSON.stringify({
    lane,
    example,
    seed: details.seed,
    path: details.counterexamplePath,
    shrinks: details.numShrinks,
  })}`);

  const original = details.errorInstance instanceof Error
    ? details.errorInstance.message
    : String(details.errorInstance ?? 'property check failed');
  throw new Error(
    `${lane} property failed after ${details.numShrinks} shrink(s) `
    + `(seed=${details.seed}, path=${details.counterexamplePath ?? 'unavailable'}): ${original}`,
  );
}
