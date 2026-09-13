/**
 * Known-failure schedules for the integration fuzz lanes (issue #97, T2 —
 * the committed half of a Hypothesis-style failing-example database).
 *
 * Promotion flow: when a fuzz lane fails, fast-check prints the shrunk
 * counterexample (a schedule value) and the seed. Paste the schedule here
 * with a comment naming what it caught; every future run replays these
 * FIRST, before any generated schedules, so a fixed bug stays fixed.
 * Lanes run these explicitly — an entry here is a regression test, not a
 * hint to the generator.
 *
 * Workers-pool tests cannot write files, so promotion is a manual paste by
 * design; the failure output contains the exact value to paste.
 */

/** One client-op inside an overlap wave (see overlap-fuzz.test.ts). */
export type OverlapOp =
  | { kind: 'toggle'; track: 't1' | 't2'; step: number }
  | { kind: 'tempo'; tempo: number }
  | { kind: 'swing'; swing: number };

/** A schedule is waves of ops; ops in a wave are fired with no awaits between sends. */
export type OverlapSchedule = OverlapOp[][];

export const OVERLAP_KNOWN_FAILURES: OverlapSchedule[] = [
  // (none yet — see promotion flow above)
];

/** One step of the cross-layer state machine (see state-machine-fuzz.test.ts). */
export type StateMachineOp =
  | { kind: 'ws_tempo'; tempo: number }
  | { kind: 'ws_swing'; swing: number }
  | { kind: 'rest_put'; tempo: number; swing: number }
  | { kind: 'rest_patch'; tempo: number; swing: number }
  | { kind: 'patch_name'; n: number }
  | { kind: 'hibernate' }
  | { kind: 'evict_close' }
  | { kind: 'disconnect' }
  | { kind: 'reconnect' };

export const STATE_MACHINE_KNOWN_FAILURES: StateMachineOp[][] = [
  // (none yet — see promotion flow above)
];
