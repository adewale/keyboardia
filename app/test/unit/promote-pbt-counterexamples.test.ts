import { describe, expect, it } from 'vitest';
import {
  parsePbtCounterexamples,
  promotePbtCounterexamples,
  type PbtKnownFailureDatabase,
} from '../../scripts/promote-pbt-counterexamples';

function emptyDatabase(): PbtKnownFailureDatabase {
  return {
    stateMachine: [],
    overlap: [],
    evictionRecovery: [],
    schedulerMutationRace: [],
  };
}

const marker = (payload: object) => `stderr | property\nPBT_COUNTEREXAMPLE=${JSON.stringify(payload)}`;

describe('PBT counterexample promotion', () => {
  it('extracts runner-prefixed markers and appends the minimal example to its lane', () => {
    const log = marker({
      lane: 'evictionRecovery',
      example: { evictAfter: 1, ops: [{ kind: 'tempo', tempo: 60 }, { kind: 'swing', swing: 0 }] },
      seed: 42,
      path: '0:1:0',
      shrinks: 7,
    });

    const result = promotePbtCounterexamples(log, emptyDatabase());

    expect(result.database.evictionRecovery).toEqual([
      { evictAfter: 1, ops: [{ kind: 'tempo', tempo: 60 }, { kind: 'swing', swing: 0 }] },
    ]);
    expect(result.additions).toHaveLength(1);
  });

  it('deduplicates an example already committed for that lane', () => {
    const example = [{ kind: 'tempo', tempo: 60 }];
    const database = emptyDatabase();
    database.schedulerMutationRace.push(example);
    const log = marker({
      lane: 'schedulerMutationRace', example, seed: 1, path: '0', shrinks: 2,
    });

    const result = promotePbtCounterexamples(log, database);

    expect(result.database.schedulerMutationRace).toEqual([example]);
    expect(result.additions).toEqual([]);
  });

  it('rejects malformed marker payloads instead of silently losing a failure', () => {
    expect(() => parsePbtCounterexamples(marker({ lane: 'unknown', example: [] })))
      .toThrow(/Malformed PBT_COUNTEREXAMPLE/);
  });
});
