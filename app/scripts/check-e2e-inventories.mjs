import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const e2eRoot = resolve(appRoot, 'e2e');

function readManifest(name) {
  const path = resolve(e2eRoot, name);
  const entries = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const canonical = [...new Set(entries)].sort();
  if (JSON.stringify(entries) !== JSON.stringify(canonical)) {
    throw new Error(`${name} must be sorted and contain no duplicates`);
  }
  for (const entry of entries) {
    try {
      readFileSync(resolve(appRoot, entry));
    } catch {
      throw new Error(`${name} references missing file: ${entry}`);
    }
  }
  return entries;
}

function listSpecs(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listSpecs(path);
    if (!entry.name.endsWith('.spec.ts')) return [];
    return [relative(appRoot, path).replaceAll('\\', '/')];
  });
}

function listTypeScript(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTypeScript(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const mockSpecs = readManifest('mock-compatible-files.txt');
const workerSpecs = readManifest('worker-required-files.txt');
const allSpecs = listSpecs(e2eRoot);
const unguardedContexts = listTypeScript(e2eRoot)
  .filter(path => relative(e2eRoot, path).replaceAll('\\', '/') !== 'browser-context.ts')
  .filter(path => /\bbrowser\s*\.\s*newContext\s*\(/.test(readFileSync(path, 'utf8')))
  .map(path => relative(appRoot, path).replaceAll('\\', '/'));
const realBackendGuards = allSpecs.filter(path =>
  /test\.skip\(\s*useMockAPI\b/.test(readFileSync(resolve(appRoot, path), 'utf8')),
);
const mandatoryWorkerSpecs = [
  'e2e/pitch-contour-alignment.spec.ts',
  'e2e/session-api-contract.spec.ts',
  'e2e/track-reorder.spec.ts',
];
const missingWorkerCoverage = [...new Set([...realBackendGuards, ...mandatoryWorkerSpecs])]
  .filter(path => !workerSpecs.includes(path));
const overlappingBackends = mockSpecs.filter(path => workerSpecs.includes(path));

const playwright = process.platform === 'win32'
  ? resolve(appRoot, 'node_modules/.bin/playwright.cmd')
  : resolve(appRoot, 'node_modules/.bin/playwright');
const listed = spawnSync(playwright, ['test', '--project=chromium', '--list'], {
  cwd: appRoot,
  encoding: 'utf8',
  env: { ...process.env, USE_MOCK_API: '' },
});
if (listed.status !== 0) {
  throw new Error(`Unable to collect Playwright inventory:\n${listed.stderr || listed.stdout}`);
}
const discoveredTitles = listed.stdout.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s+\[chromium\]\s+›\s+([^:]+\.spec\.ts):\d+:\d+\s+›\s+(.+)$/);
  return match ? [`${match[1]} › ${match[2]}`] : [];
}).sort();
const expectedTitles = readFileSync(resolve(e2eRoot, 'test-title-inventory.txt'), 'utf8')
  .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
if (JSON.stringify(discoveredTitles) !== JSON.stringify(expectedTitles)) {
  const discovered = new Set(discoveredTitles);
  const expected = new Set(expectedTitles);
  const removed = expectedTitles.filter(title => !discovered.has(title));
  const added = discoveredTitles.filter(title => !expected.has(title));
  throw new Error(`E2E title inventory changed. Review and update e2e/test-title-inventory.txt.`
    + `\nRemoved/replaced:\n${removed.join('\n') || '(none)'}`
    + `\nAdded/replaced:\n${added.join('\n') || '(none)'}`);
}

if (missingWorkerCoverage.length > 0) {
  throw new Error(`Worker manifest is missing real-backend specs:\n${missingWorkerCoverage.join('\n')}`);
}
if (overlappingBackends.length > 0) {
  throw new Error(`Specs cannot be required in both backend manifests:\n${overlappingBackends.join('\n')}`);
}
if (unguardedContexts.length > 0) {
  throw new Error(`Custom browser contexts must use createE2EContext so WebKit setup is not bypassed:\n${unguardedContexts.join('\n')}`);
}

console.log(`E2E inventories valid: ${mockSpecs.length} mock-required, ${workerSpecs.length} Worker-required, ${allSpecs.length} total specs, ${expectedTitles.length} exact tests`);
