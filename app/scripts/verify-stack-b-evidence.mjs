#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const appRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(appRoot, '..');
const evidenceRoot = resolve(repoRoot, 'audit/css-consistency/stack-b-evidence');
const receiptsRoot = resolve(evidenceRoot, 'receipts');
const manifestPath = resolve(evidenceRoot, 'approval-manifest.json');
const shaPattern = /^[\da-f]{40}$/;
const digestPattern = /^[\da-f]{64}$/;

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', ...options }).trim();
}

function sha256(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filename = resolve(root, entry.name);
    return entry.isDirectory() ? listFiles(filename) : [filename];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const stackBManifest = readFileSync(resolve(appRoot, 'identity/stack-b-manifest.ts'), 'utf8');
const migrationBase = stackBManifest.match(/STACK_B_MIGRATION_BASE_SHA = '([\da-f]{40})'/)?.[1];
assert(migrationBase, 'Unable to read the Stack B migration base');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert(manifest.schemaVersion === 1, 'Unsupported Stack B approval manifest schema');
assert(manifest.generator?.name === 'app/scripts/finalize-stack-b-evidence.mjs', 'Unexpected evidence finalizer');
assert(manifest.generator?.version === 1, 'Unexpected evidence finalizer version');
assert(shaPattern.test(manifest.baseRevision), 'Approval manifest has an invalid base revision');
assert(shaPattern.test(manifest.headRevision), 'Approval manifest has an invalid head revision');
assert(manifest.checks?.receiptsPassed === true, 'Approval manifest does not record passed receipts');

const actualFiles = listFiles(evidenceRoot)
  .filter((filename) => filename !== manifestPath)
  .filter((filename) => statSync(filename).isFile())
  .sort()
  .map((filename) => relative(evidenceRoot, filename).replaceAll('\\', '/'));
const recordedFiles = manifest.files.map((entry) => entry.path);
assert(JSON.stringify(recordedFiles) === JSON.stringify(actualFiles), 'Evidence file inventory differs from approval manifest');
for (const entry of manifest.files) {
  assert(digestPattern.test(entry.sha256), `Invalid SHA-256 for ${entry.path}`);
  assert(sha256(resolve(evidenceRoot, entry.path)) === entry.sha256, `Evidence hash mismatch: ${entry.path}`);
}
assert(manifest.checks.boundFileCount === actualFiles.length, 'Bound evidence file count is stale');

const expectedReceipts = readFileSync(resolve(appRoot, 'identity/test-title-inventory.txt'), 'utf8')
  .split(/\r?\n/)
  .flatMap((line) => {
    const match = line.match(/stack-b-visual\.spec\.ts .* › ([^ ]+) @stack-b-(visual|full-app)$/);
    if (!match) return [];
    return [`${match[2] === 'visual' ? 'catalogue' : 'full-app'}--${match[1]}.json`];
  })
  .sort();
const actualReceipts = readdirSync(receiptsRoot).filter((name) => name.endsWith('.json')).sort();
assert(JSON.stringify(actualReceipts) === JSON.stringify(expectedReceipts), 'Receipt inventory differs from Stack B test inventory');
assert(manifest.receiptCount === actualReceipts.length, 'Approval manifest receipt count is stale');

for (const name of actualReceipts) {
  const receipt = JSON.parse(readFileSync(resolve(receiptsRoot, name), 'utf8'));
  assert(receipt.baseRevision === manifest.baseRevision, `${name} has the wrong base revision`);
  assert(receipt.headRevision === manifest.headRevision, `${name} has the wrong head revision`);
  assert(receipt.generator?.name === 'app/identity/stack-b-visual.spec.ts', `${name} has the wrong generator`);
  assert(receipt.generator?.version === 4, `${name} has the wrong receipt generator version`);
  assert(digestPattern.test(receipt.inputConfigSha256), `${name} has an invalid input/config hash`);
  assert(receipt.checks?.result === 'passed', `${name} does not record a passed check`);
  assert(receipt.checks?.accessibilityTreeIdentity === true, `${name} failed accessibility-tree identity`);
  assert(receipt.checks?.geometryAndStyleViolations === 0, `${name} has geometry/style violations`);
  assert(receipt.checks?.targetGeometryIdentity === true, `${name} failed dropdown geometry identity`);
  assert(receipt.checks?.unexpectedChangedPixels === 0, `${name} has pixels outside approved regions`);
  for (const side of ['before', 'after', 'diff']) {
    const filename = resolve(evidenceRoot, side, name.replace(/\.json$/, '.png'));
    assert(sha256(filename) === receipt[`${side}Sha256`], `${name} has a stale ${side} hash`);
  }
}

const readme = readFileSync(resolve(evidenceRoot, 'README.md'), 'utf8');
assert(readme.includes(manifest.baseRevision), 'Evidence README omits the approved base revision');
assert(readme.includes(manifest.headRevision), 'Evidence README omits the candidate source revision');

const requestedBase = process.env.STACK_A_BASE_REF
  || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
const currentBase = git(['merge-base', 'HEAD', requestedBase]);
if (currentBase === migrationBase) {
  assert(manifest.baseRevision === currentBase, 'The merge base moved; regenerate Stack B evidence');
  const candidateExists = spawnSync(
    'git',
    ['cat-file', '-e', `${manifest.headRevision}^{commit}`],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  assert(candidateExists.status === 0, 'The candidate source revision is unavailable');
  const isAncestor = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', manifest.headRevision, 'HEAD'],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  assert(isAncestor.status === 0, 'The candidate source revision is not an ancestor of HEAD');
  const drift = git(['diff', '--name-only', manifest.headRevision, 'HEAD', '--'])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => !path.startsWith('audit/css-consistency/stack-b-evidence/'));
  assert(drift.length === 0, `Source changed after evidence generation:\n${drift.join('\n')}`);
}

console.log(
  `Stack B evidence verified: ${actualReceipts.length} receipts and ${actualFiles.length} bound files for ${manifest.headRevision}.`,
);
