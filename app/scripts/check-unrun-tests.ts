#!/usr/bin/env npx tsx
/**
 * Find test files that no lane executes.
 *
 * The July 2026 audit found six: the five in test/staging/ and one e2e staging
 * spec — 103 tests and 226 assertions that CI has never run. They are not a
 * gap in coverage (every limit they touch is asserted 2-21 times over by lanes
 * that do run) but they are unmaintained, and one of them had carried an
 * always-green try/catch for months because nothing ever executed it.
 *
 * The lanes are asked what they collect rather than having their include and
 * exclude globs reimplemented here; the pure set logic and its fixtures live in
 * test-quality-analyzers.ts. UNRUN_ALLOWLIST is the deliberate exception, and a
 * stale entry is reported too, so it cannot outlive the reason it was added.
 *
 * Run: npx tsx scripts/check-unrun-tests.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { findUnrunTestFiles } from './test-quality-analyzers';

/**
 * Staging needs a deployed backend, so no CI lane can run it today. Either
 * schedule it against a real environment or delete it — see §21 of
 * docs/TEST-AUDIT-2026-07.md. Until that call is made, these are declared.
 */
const UNRUN_ALLOWLIST = [
  'e2e/staging/vu-meters.spec.ts',
  'test/staging/effects-bypass-sync.test.ts',
  'test/staging/effects-immediate-sync.test.ts',
  'test/staging/failure-modes.test.ts',
  'test/staging/kv-staleness.test.ts',
  'test/staging/multiplayer-sync.test.ts',
];

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

const run = (command: string, args: string[], cwd?: string) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failure = error as { message?: string; stderr?: string; stdout?: string };
    const diagnostic = failure.stderr?.trim() || failure.stdout?.trim() || failure.message;
    const location = cwd ? ` in ${path.relative(process.cwd(), cwd) || '.'}` : '';
    throw new Error(
      `Test collector failed${location}: ${command} ${args.join(' ')}\n${diagnostic ?? 'No diagnostic output.'}`,
      { cause: error },
    );
  }
};

const onDisk = ['src', 'test', 'e2e', 'scripts']
  .flatMap(filesBelow)
  .filter((file) => !file.split(path.sep).includes('node_modules'))
  .filter((file) => /(?:\.test|\.spec)\.tsx?$/.test(file))
  .sort();

// `vitest list --filesOnly` prints an absolute path, or `[project] relative`
// when the config names a project — the integration tier does. Normalise both
// against the directory the runner was invoked from.
const vitestFiles = (cwd: string) =>
  run('npx', ['vitest', 'list', '--filesOnly'], cwd)
    .split('\n')
    .filter((line) => /\.(test|spec)\.tsx?$/.test(line))
    .map((line) => line.trim().replace(/^\[[^\]]*\]\s*/, ''))
    .map((file) => path.relative(process.cwd(), path.resolve(cwd, file)));

const unit = vitestFiles(process.cwd());
const integration = vitestFiles(path.join(process.cwd(), 'test/integration'));

const e2e = run('npx', ['playwright', 'test', '--list', '--reporter=json'])
  .split('\n').filter((line) => /"file":/.test(line))
  .map((line) => line.replace(/.*"file":\s*"([^"]+)".*/, '$1'))
  .map((file) => (path.isAbsolute(file) ? path.relative(process.cwd(), file) : path.join('e2e', file)));

const collected = [...new Set([...unit, ...integration, ...e2e])];

if (!collected.length) {
  console.error('❌ No lane reported collecting anything — the runners did not answer.');
  process.exit(1);
}

const { unlisted, staleAllowances } = findUnrunTestFiles(onDisk, collected, UNRUN_ALLOWLIST);

if (!unlisted.length && !staleAllowances.length) {
  console.log(
    `✅ Every test file is collected by a lane (${onDisk.length} files, ` +
    `${UNRUN_ALLOWLIST.length} declared unrun).`,
  );
  process.exit(0);
}

if (unlisted.length) {
  console.log(`\nNO LANE RUNS THESE (${unlisted.length}) — they read as coverage and are never executed:`);
  for (const file of unlisted) console.log(`  ${file}`);
  console.log('\n  Wire the file into a lane, or add it to UNRUN_ALLOWLIST with a reason.');
}
if (staleAllowances.length) {
  console.log(`\nSTALE ALLOWLIST ENTRIES (${staleAllowances.length}) — a lane now runs these, or they are gone:`);
  for (const file of staleAllowances) console.log(`  ${file}`);
  console.log('\n  Remove them from UNRUN_ALLOWLIST in scripts/check-unrun-tests.ts.');
}
process.exit(1);
