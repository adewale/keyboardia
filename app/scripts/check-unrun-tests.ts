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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

const onDisk = ['src', 'test', 'e2e', 'identity', 'scripts']
  .flatMap(filesBelow)
  .filter((file) => !file.split(path.sep).includes('node_modules'))
  .filter((file) => /(?:\.test|\.spec)\.tsx?$/.test(file))
  .sort();

// `vitest list --filesOnly` prints an absolute path, or `[project] relative`
// when the config names a project — the integration tier does. Normalise both
// against the directory the runner was invoked from.
const vitestFiles = (cwd: string, filters: string[] = []) =>
  run('npx', ['vitest', 'list', '--filesOnly', ...filters], cwd)
    .split('\n')
    .filter((line) => /\.(test|spec)\.tsx?$/.test(line))
    .map((line) => line.trim().replace(/^\[[^\]]*\]\s*/, ''))
    .map((file) => path.relative(process.cwd(), path.resolve(cwd, file)));

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};
const renderGlob = 'src/audio/*.render.test.ts';
const envelopeRender = 'src/audio/synth-envelope.render.test.ts';
const envelopePcmFilters = [
  'src/audio/envelope-pcm-manifest.test.ts',
  'src/audio/pcm-metrics.test.ts',
  'src/audio/synth-renderer-migration.test.ts',
  envelopeRender,
];

// Keep native OfflineAudioContext files out of broad parallel collection and
// prove that every such file has exactly one named owner. Checking the package
// scripts as well as the collector output prevents this inventory from passing
// against a theoretical lane that CI and pre-push do not actually invoke.
const ownershipErrors: string[] = [];
if (!scripts['test:unit']?.includes(`--exclude '${renderGlob}'`)) {
  ownershipErrors.push(`test:unit must exclude '${renderGlob}'`);
}
if (!scripts['test:audio-render']?.includes(renderGlob)
  || !scripts['test:audio-render']?.includes(`--exclude ${envelopeRender}`)) {
  ownershipErrors.push('test:audio-render must own general renders and exclude the envelope canary');
}
if (!envelopePcmFilters.every((file) => scripts['test:envelope:pcm']?.includes(file))) {
  ownershipErrors.push('test:envelope:pcm must own its four declared files');
}
if (scripts['test:envelope:correctness']?.includes(envelopeRender)) {
  ownershipErrors.push('test:envelope:correctness must not duplicate the envelope PCM render');
}
if (ownershipErrors.length) {
  throw new Error(`Invalid native-render lane ownership:\n- ${ownershipErrors.join('\n- ')}`);
}

const unit = vitestFiles(process.cwd(), ['--exclude', renderGlob]);
const nativeRenderFiles = onDisk.filter((file) => /^src\/audio\/.*\.render\.test\.ts$/.test(file));
const generalRenderFilters = nativeRenderFiles.filter((file) => file !== envelopeRender);
const audioRender = vitestFiles(process.cwd(), generalRenderFilters);
const envelopePcm = vitestFiles(process.cwd(), envelopePcmFilters);
const integration = vitestFiles(path.join(process.cwd(), 'test/integration'));

const e2e = run('npx', ['playwright', 'test', '--list', '--reporter=json'])
  .split('\n').filter((line) => /"file":/.test(line))
  .map((line) => line.replace(/.*"file":\s*"([^"]+)".*/, '$1'))
  .map((file) => (path.isAbsolute(file) ? path.relative(process.cwd(), file) : path.join('e2e', file)));

const identity = run(
  'npx',
  ['playwright', 'test', '--config', 'playwright.stack-a.config.ts', '--list', '--reporter=json'],
)
  .split('\n').filter((line) => /"file":/.test(line))
  .map((line) => line.replace(/.*"file":\s*"([^"]+)".*/, '$1'))
  .map((file) => (
    path.isAbsolute(file) ? path.relative(process.cwd(), file) : path.join('identity', file)
  ));

const collected = [...new Set([
  ...unit,
  ...audioRender,
  ...envelopePcm,
  ...integration,
  ...e2e,
  ...identity,
])];

const nativeRenderOwners = new Map(nativeRenderFiles.map((file) => [file, 0]));
for (const file of [...unit, ...audioRender, ...envelopePcm]) {
  if (nativeRenderOwners.has(file)) {
    nativeRenderOwners.set(file, nativeRenderOwners.get(file)! + 1);
  }
}
const invalidRenderOwners = [...nativeRenderOwners]
  .filter(([, ownerCount]) => ownerCount !== 1);
if (invalidRenderOwners.length) {
  throw new Error(
    `Native render tests require exactly one owner:\n${invalidRenderOwners
      .map(([file, ownerCount]) => `- ${file}: ${ownerCount}`)
      .join('\n')}`,
  );
}

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
