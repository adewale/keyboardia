#!/usr/bin/env npx tsx
/**
 * Find test files that no lane executes.
 *
 * The July 2026 audit found six: five obsolete live-server suites and one
 * duplicated E2E staging spec — 103 tests and 226 assertions that no lane ran.
 * Those files were deleted after their claims were mapped to maintained lanes.
 * This gate prevents an uncollected corpus from accumulating again.
 *
 * The lanes are asked what they collect rather than having their include and
 * exclude globs reimplemented here; the pure set logic and its fixtures live in
 * test-quality-analyzers.ts. The repository has no permanent exceptions: a test
 * file is either collected by a lane or it does not belong in the tree.
 *
 * Run: npx tsx scripts/check-unrun-tests.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { findUnrunTestFiles } from './test-quality-analyzers';

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

const { unlisted } = findUnrunTestFiles(onDisk, collected, []);

if (!unlisted.length) {
  console.log(
    `✅ Every test file is collected by a lane (${onDisk.length} files, zero exceptions).`,
  );
  process.exit(0);
}

if (unlisted.length) {
  console.log(`\nNO LANE RUNS THESE (${unlisted.length}) — they read as coverage and are never executed:`);
  for (const file of unlisted) console.log(`  ${file}`);
  console.log('\n  Wire the file into a lane, or delete it if its coverage is redundant.');
}
process.exit(1);
