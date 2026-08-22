import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const [lane, outputPath, executable, ...args] = process.argv.slice(2);
if (!lane || !outputPath || !executable) {
  console.error('Usage: node scripts/measure-envelope-verification.mjs <lane> <output.json> <command> [...args]');
  process.exit(2);
}

async function bytesBelow(path) {
  try {
    const entry = await stat(path);
    if (entry.isFile()) return entry.size;
    const { readdir } = await import('node:fs/promises');
    const children = await readdir(path);
    return (await Promise.all(children.map(child => bytesBelow(resolve(path, child)))))
      .reduce((sum, bytes) => sum + bytes, 0);
  } catch {
    return 0;
  }
}

const start = process.hrtime.bigint();
const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: false,
});
const wallTimeMs = Number(process.hrtime.bigint() - start) / 1_000_000;
const artifactPaths = (process.env.ENVELOPE_VERIFICATION_ARTIFACT_PATHS ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const artifactBytes = (await Promise.all(artifactPaths.map(bytesBelow)))
  .reduce((sum, bytes) => sum + bytes, 0);
const report = {
  schemaVersion: 1,
  lane,
  command: [executable, ...args],
  wallTimeMs: Math.round(wallTimeMs),
  estimatedRunnerMinutes: Number((wallTimeMs / 60_000).toFixed(4)),
  artifactBytes,
  retryBudget: 0,
  exitCode: result.status ?? 1,
  signal: result.signal ?? null,
  runner: process.env.RUNNER_OS ?? process.platform,
  commit: process.env.GITHUB_SHA ?? null,
  baselineStatus: 'collecting-ci-distribution',
  note: 'Set a blocking p50/p95 regression budget only after comparable CI runner samples exist.',
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
process.exit(result.status ?? 1);
