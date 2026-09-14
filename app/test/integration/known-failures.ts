/**
 * Typed views of the committed property counterexample database (issue #97,
 * T2). The JSON file is deliberately data-only so a host-side workflow can
 * update it after Workers-pool tests finish.
 *
 * Every lane emits its final shrunk value as `PBT_COUNTEREXAMPLE=<json>`.
 * scripts/promote-pbt-counterexamples.ts appends and deduplicates those values
 * in known-failures.json, and CI uploads the resulting patch. Every future run
 * replays the promoted values before generating new schedules.
 */

import database from './known-failures.json';

/** One client-op inside an overlap wave (see overlap-fuzz.test.ts). */
export type OverlapOp =
  | { kind: 'toggle'; track: 't1' | 't2'; step: number }
  | { kind: 'tempo'; tempo: number }
  | { kind: 'swing'; swing: number };

/** A schedule is waves of ops; ops in a wave are fired with no awaits between sends. */
export type OverlapSchedule = OverlapOp[][];

export const OVERLAP_KNOWN_FAILURES = database.overlap as OverlapSchedule[];

/** One step of the cross-layer state machine (see state-machine-fuzz.test.ts). */
export type StateMachineOp =
  | { kind: 'ws_tempo'; tempo: number }
  | { kind: 'ws_swing'; swing: number }
  | { kind: 'rest_put'; tempo: number; swing: number }
  | { kind: 'rest_patch_state'; tempo: number; swing: number }
  | { kind: 'rest_patch_name'; name: string }
  | { kind: 'hibernate' }
  | { kind: 'hard_evict' }
  | { kind: 'disconnect' }
  | { kind: 'connect' };

export const STATE_MACHINE_KNOWN_FAILURES = database.stateMachine as StateMachineOp[][];

export type EvictionRecoveryOp =
  | { kind: 'tempo'; tempo: number }
  | { kind: 'swing'; swing: number }
  | { kind: 'toggle'; step: number };

/** `evictAfter` is the number of acknowledged operations before hibernation. */
export interface EvictionRecoverySchedule {
  evictAfter: number;
  ops: EvictionRecoveryOp[];
}

export const EVICTION_RECOVERY_KNOWN_FAILURES =
  database.evictionRecovery as EvictionRecoverySchedule[];
