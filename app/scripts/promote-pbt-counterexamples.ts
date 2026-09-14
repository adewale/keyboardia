#!/usr/bin/env npx tsx
/**
 * Promote final fast-check counterexamples emitted by property lanes.
 *
 * Usage:
 *   npx tsx scripts/promote-pbt-counterexamples.ts <vitest-log> <database-json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PBT_COUNTEREXAMPLE_PREFIX, type PbtKnownFailureLane } from '../src/test/pbt-failure';

const LANES = [
  'stateMachine',
  'overlap',
  'evictionRecovery',
  'schedulerMutationRace',
] as const satisfies readonly PbtKnownFailureLane[];

export type PbtKnownFailureDatabase = Record<PbtKnownFailureLane, unknown[]>;

interface EmittedCounterexample {
  lane: PbtKnownFailureLane;
  example: unknown;
  seed: number;
  path: string | null;
  shrinks: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLane(value: unknown): value is PbtKnownFailureLane {
  return typeof value === 'string' && (LANES as readonly string[]).includes(value);
}

export function parsePbtCounterexamples(log: string): EmittedCounterexample[] {
  const emitted: EmittedCounterexample[] = [];
  for (const line of log.split(/\r?\n/)) {
    const marker = line.indexOf(PBT_COUNTEREXAMPLE_PREFIX);
    if (marker === -1) continue;

    const raw = line.slice(marker + PBT_COUNTEREXAMPLE_PREFIX.length).trim();
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value)
      || !isLane(value.lane)
      || !('example' in value)
      || typeof value.seed !== 'number'
      || (value.path !== null && typeof value.path !== 'string')
      || typeof value.shrinks !== 'number'
    ) {
      throw new Error(`Malformed ${PBT_COUNTEREXAMPLE_PREFIX} payload: ${raw}`);
    }
    emitted.push(value as unknown as EmittedCounterexample);
  }
  return emitted;
}

export function promotePbtCounterexamples(
  log: string,
  database: PbtKnownFailureDatabase,
): { database: PbtKnownFailureDatabase; additions: EmittedCounterexample[] } {
  const next = structuredClone(database);
  for (const lane of LANES) {
    if (!Array.isArray(next[lane])) throw new Error(`Counterexample database is missing array ${lane}`);
  }

  const additions: EmittedCounterexample[] = [];
  for (const emitted of parsePbtCounterexamples(log)) {
    const existing = new Set(next[emitted.lane].map((value) => JSON.stringify(value)));
    const serialized = JSON.stringify(emitted.example);
    if (existing.has(serialized)) continue;
    next[emitted.lane].push(emitted.example);
    additions.push(emitted);
  }
  return { database: next, additions };
}

function runCli(): void {
  const logPath = process.argv[2];
  const databasePath = process.argv[3];
  if (!logPath || !databasePath) {
    throw new Error('Usage: promote-pbt-counterexamples.ts <vitest-log> <database-json>');
  }

  const log = readFileSync(logPath, 'utf8');
  const database = JSON.parse(readFileSync(databasePath, 'utf8')) as PbtKnownFailureDatabase;
  const promoted = promotePbtCounterexamples(log, database);
  writeFileSync(databasePath, `${JSON.stringify(promoted.database, null, 2)}\n`);

  if (promoted.additions.length === 0) {
    console.log('No new PBT counterexamples found in the failing run.');
    return;
  }
  for (const addition of promoted.additions) {
    console.log(
      `Promoted ${addition.lane} seed=${addition.seed} path=${addition.path ?? 'unavailable'} `
      + `after ${addition.shrinks} shrink(s).`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
