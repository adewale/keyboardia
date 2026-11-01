/**
 * Mirrors app/src/shared/constants.ts. The eval tooling is deliberately
 * dependency-free and outside the app's TypeScript build, so these are
 * duplicated rather than imported; app/test/eval-execution.test.ts asserts they
 * still match the source of truth.
 */
export const MAX_STEPS = 128;
export const DEFAULT_STEP_COUNT = 16;
export const MAX_TRACKS = 16;
export const MIN_TEMPO = 60;
export const MAX_TEMPO = 180;
