import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashPlaywrightIdentities,
  parsePlaywrightListIdentities,
} from './playwright-contract-identities.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const e2eRoot = resolve(appRoot, 'e2e');

function readManifest(name) {
  const entries = readFileSync(resolve(e2eRoot, name), 'utf8')
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
const audioSpecs = readManifest('audio-matrix-files.txt');
const allSpecs = listSpecs(e2eRoot).sort();
const offlineFunctionalSpecs = allSpecs
  .filter(path => !mockSpecs.includes(path) && !audioSpecs.includes(path));
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
const misplacedAudioSpecs = audioSpecs.filter(path => mockSpecs.includes(path));

const laneFile = JSON.parse(readFileSync(resolve(e2eRoot, 'lane-contracts.json'), 'utf8'));
if (laneFile.schemaVersion !== 2 || !laneFile.lanes) {
  throw new Error('lane-contracts.json has an unsupported schema');
}

const laneDefinitions = {
  'mock-required': {
    label: 'Mock-compatible Chromium',
    specs: mockSpecs,
    project: 'chromium',
    env: { USE_MOCK_API: '1', E2E_FUNCTIONAL_ONLY: '', CI: 'true' },
  },
  'offline-functional': {
    label: 'Offline functional Chromium',
    specs: offlineFunctionalSpecs,
    project: 'chromium',
    env: { USE_MOCK_API: '1', E2E_FUNCTIONAL_ONLY: '1', CI: 'true' },
  },
  'offline-audio': {
    label: 'Offline audio matrix Chromium',
    specs: audioSpecs,
    project: 'chromium',
    env: { USE_MOCK_API: '1', E2E_FUNCTIONAL_ONLY: '1', CI: 'true' },
  },
  worker: {
    label: 'Worker collaboration Chromium',
    specs: workerSpecs,
    project: 'chromium',
    env: { USE_MOCK_API: '', E2E_FUNCTIONAL_ONLY: '', CI: 'true', PLAYWRIGHT_BASE_URL: 'http://localhost:8787' },
  },
  'worker-smoke': {
    label: 'Worker smoke Chromium',
    specs: [
      'e2e/track-reorder.spec.ts',
      'e2e/plock-editor.spec.ts',
      'e2e/pitch-contour-alignment.spec.ts',
    ],
    project: 'chromium',
    env: { USE_MOCK_API: '', E2E_FUNCTIONAL_ONLY: '', CI: 'true', PLAYWRIGHT_BASE_URL: 'http://localhost:8787' },
  },
  'real-chromium': {
    label: 'Full real-backend Chromium',
    specs: allSpecs,
    project: 'chromium',
    env: { USE_MOCK_API: '', E2E_FUNCTIONAL_ONLY: '1', CI: 'true' },
  },
  'real-webkit': {
    label: 'Full real-backend WebKit',
    specs: allSpecs,
    project: 'webkit',
    noDeps: true,
    env: { USE_MOCK_API: '', E2E_FUNCTIONAL_ONLY: '1', CI: 'true' },
  },
  'visual-linux': {
    label: 'Linux visual regression',
    specs: allSpecs,
    project: 'chromium',
    grep: '@visual',
    env: { USE_MOCK_API: '', E2E_FUNCTIONAL_ONLY: '', CI: 'true' },
  },
  'visual-macos': {
    label: 'macOS populated visual regression',
    specs: ['e2e/populated-visual.spec.ts'],
    project: 'chromium',
    env: { USE_MOCK_API: '1', E2E_FUNCTIONAL_ONLY: '', CI: 'true' },
  },
  pcm: {
    label: 'PCM capture',
    specs: ['e2e/capture-session.spec.ts'],
    project: 'chromium',
    env: { USE_MOCK_API: '1', E2E_FUNCTIONAL_ONLY: '1', CI: 'true' },
  },
  'mobile-safari': {
    label: 'Mobile Safari',
    specs: ['e2e/mobile-iphone.spec.ts'],
    project: 'mobile-safari',
    env: { USE_MOCK_API: '', E2E_FUNCTIONAL_ONLY: '', CI: 'true' },
  },
};

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
const discoveredTitles = parsePlaywrightListIdentities(listed.stdout)
  .map(identity => identity.split('\0')[1])
  .sort();
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
if (misplacedAudioSpecs.length > 0) {
  throw new Error(`CPU-bound audio specs cannot also be in the strict mock manifest:\n${misplacedAudioSpecs.join('\n')}`);
}
if (unguardedContexts.length > 0) {
  throw new Error(`Custom browser contexts must use createE2EContext so WebKit setup is not bypassed:\n${unguardedContexts.join('\n')}`);
}

const configuredLanes = Object.keys(laneFile.lanes).sort();
const definedLanes = Object.keys(laneDefinitions).sort();
if (JSON.stringify(configuredLanes) !== JSON.stringify(definedLanes)) {
  throw new Error(`Lane contract and collector definitions differ: ${JSON.stringify({ configuredLanes, definedLanes })}`);
}

for (const [name, definition] of Object.entries(laneDefinitions)) {
  const args = ['test', ...definition.specs, `--project=${definition.project}`];
  if (definition.noDeps) args.push('--no-deps');
  if (definition.grep) args.push('--grep', definition.grep);
  args.push('--list');
  const collected = spawnSync(playwright, args, {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, ...definition.env },
  });
  if (collected.status !== 0) {
    throw new Error(`Unable to collect ${definition.label} disposition total:\n`
      + `${collected.stderr || collected.stdout}`);
  }
  const identities = parsePlaywrightListIdentities(collected.stdout);
  if (new Set(identities).size !== identities.length) {
    throw new Error(`${definition.label} collects duplicate project/test identities`);
  }
  const collectedTotal = identities.length;
  const contract = laneFile.lanes[name];
  const contractedTotal = contract.expected + contract.skipped;
  if (contractedTotal !== collectedTotal) {
    throw new Error(`${definition.label} contract accounts for ${contractedTotal} results, `
      + `but Playwright collects ${collectedTotal} with the lane's exact project, files, and environment`);
  }
  const identitySha256 = hashPlaywrightIdentities(identities);
  if (contract.identitySha256 !== identitySha256) {
    throw new Error(`${definition.label} exact identity contract changed: ${JSON.stringify({
      expected: contract.identitySha256,
      actual: identitySha256,
    })}`);
  }
}

console.log(`E2E inventories valid: ${mockSpecs.length} mock-required, ${workerSpecs.length} Worker-required, ${audioSpecs.length} CPU-bound audio specs, ${allSpecs.length} total specs, ${expectedTitles.length} exact tests, ${configuredLanes.length} centralized lane contracts`);
