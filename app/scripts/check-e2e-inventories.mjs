import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(appRoot, '..');
const e2eRoot = resolve(appRoot, 'e2e');

function readDispositionContract(path, resultFile) {
  const source = readFileSync(path, 'utf8');
  const escapedResultFile = resultFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(
    `assert-playwright-stats\\.mjs\\s+\\S*${escapedResultFile}\\s+(\\d+)\\s+(\\d+)`,
  ));
  if (!match) {
    throw new Error(`Unable to find ${resultFile} disposition contract in ${path}`);
  }
  return { expected: Number(match[1]), skipped: Number(match[2]) };
}

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
// These contracts have dedicated mock-backed lanes in CI. Keep them out of
// the broad offline lane here exactly as the workflow's `offline_specs`
// construction does, otherwise the disposition validator counts tests the
// lane never executes.
const dedicatedEnvelopeSpecs = new Set([
  'e2e/envelope-v2.spec.ts',
  'e2e/envelope-v2-headless.spec.ts',
  'e2e/tone-envelope-release.spec.ts',
]);
const missingWorkerCoverage = [...new Set([...realBackendGuards, ...mandatoryWorkerSpecs])]
  .filter(path => !workerSpecs.includes(path));
const overlappingBackends = mockSpecs.filter(path => workerSpecs.includes(path));
const workflowPath = resolve(repoRoot, '.github/workflows/ci.yml');
const prePushPath = resolve(appRoot, '.husky/pre-push');
const dispositionContracts = [
  {
    label: 'Chromium real-backend',
    project: 'chromium',
    noDeps: false,
    ci: readDispositionContract(workflowPath, 'real-backend-results.json'),
    local: readDispositionContract(prePushPath, 'prepush-chromium.json'),
  },
  {
    label: 'WebKit real-backend',
    project: 'webkit',
    noDeps: true,
    ci: readDispositionContract(workflowPath, 'webkit-results.json'),
    local: readDispositionContract(prePushPath, 'prepush-webkit.json'),
  },
];
const mockLaneContracts = [
  {
    label: 'Mock-compatible Chromium',
    specs: mockSpecs,
    resultFile: 'blocking-results.json',
    env: { USE_MOCK_API: '1', E2E_FUNCTIONAL_ONLY: '', CI: 'true' },
  },
  {
    label: 'Remaining offline Chromium',
    specs: allSpecs
      .filter(path => !mockSpecs.includes(path) && !dedicatedEnvelopeSpecs.has(path))
      .sort(),
    resultFile: 'offline-results.json',
    env: { USE_MOCK_API: '1', E2E_FUNCTIONAL_ONLY: '1', CI: 'true' },
  },
  {
    label: 'Worker-required Chromium',
    specs: workerSpecs,
    resultFile: 'worker-results.json',
    env: {
      USE_MOCK_API: '',
      E2E_FUNCTIONAL_ONLY: '',
      CI: 'true',
      PLAYWRIGHT_BASE_URL: 'http://localhost:8787',
    },
  },
].map(contract => ({
  ...contract,
  disposition: readDispositionContract(workflowPath, contract.resultFile),
}));
const pcmContract = {
  spec: 'e2e/capture-session.spec.ts',
  ...readDispositionContract(prePushPath, 'prepush-pcm.json'),
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
for (const contract of dispositionContracts) {
  if (JSON.stringify(contract.ci) !== JSON.stringify(contract.local)) {
    throw new Error(`${contract.label} disposition contract differs between CI and pre-push: `
      + `${JSON.stringify({ ci: contract.ci, prePush: contract.local })}`);
  }
  const args = ['test', `--project=${contract.project}`];
  if (contract.noDeps) args.push('--no-deps');
  args.push('--list');
  const collected = spawnSync(playwright, args, {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, E2E_FUNCTIONAL_ONLY: '1', USE_MOCK_API: '' },
  });
  if (collected.status !== 0) {
    throw new Error(`Unable to collect ${contract.label} disposition total:\n`
      + `${collected.stderr || collected.stdout}`);
  }
  const totalMatch = collected.stdout.match(/Total:\s+(\d+)\s+tests?\b/);
  if (!totalMatch) {
    throw new Error(`Unable to parse ${contract.label} disposition total:\n${collected.stdout}`);
  }
  const collectedTotal = Number(totalMatch[1]);
  const contractedTotal = contract.ci.expected + contract.ci.skipped;
  if (contractedTotal !== collectedTotal) {
    throw new Error(`${contract.label} disposition contract accounts for ${contractedTotal} results, `
      + `but Playwright collects ${collectedTotal} with the gate's project and environment`);
  }
}

for (const contract of mockLaneContracts) {
  const collected = spawnSync(playwright, [
    'test', ...contract.specs, '--project=chromium', '--list',
  ], {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, ...contract.env },
  });
  if (collected.status !== 0) {
    throw new Error(`Unable to collect ${contract.label} disposition total:\n`
      + `${collected.stderr || collected.stdout}`);
  }
  const totalMatch = collected.stdout.match(/Total:\s+(\d+)\s+tests?\b/);
  if (!totalMatch) {
    throw new Error(`Unable to parse ${contract.label} disposition total:\n${collected.stdout}`);
  }
  const collectedTotal = Number(totalMatch[1]);
  const contractedTotal = contract.disposition.expected + contract.disposition.skipped;
  if (contractedTotal !== collectedTotal) {
    throw new Error(`${contract.label} disposition contract accounts for ${contractedTotal} results, `
      + `but Playwright collects ${collectedTotal} with the gate's exact spec set and environment`);
  }
}

const pcmListed = spawnSync(playwright, [
  'test', pcmContract.spec, '--project=chromium', '--list',
], {
  cwd: appRoot,
  encoding: 'utf8',
  env: { ...process.env, E2E_FUNCTIONAL_ONLY: '1', USE_MOCK_API: '1', CI: 'true' },
});
if (pcmListed.status !== 0) {
  throw new Error(`Unable to collect local PCM gate inventory:\n${pcmListed.stderr || pcmListed.stdout}`);
}
const pcmTotalMatch = pcmListed.stdout.match(/Total:\s+(\d+)\s+tests?\b/);
if (!pcmTotalMatch) {
  throw new Error(`Unable to parse local PCM gate inventory:\n${pcmListed.stdout}`);
}
const pcmCollectedTotal = Number(pcmTotalMatch[1]);
const pcmContractedTotal = pcmContract.expected + pcmContract.skipped;
if (pcmCollectedTotal !== pcmContractedTotal) {
  throw new Error(`Local PCM gate accounts for ${pcmContractedTotal} results, `
    + `but Playwright collects ${pcmCollectedTotal} from ${pcmContract.spec}`);
}

console.log(`E2E inventories valid: ${mockSpecs.length} mock-required, ${workerSpecs.length} Worker-required, ${allSpecs.length} total specs, ${expectedTitles.length} exact tests, ${dispositionContracts.length} local/CI full-stack disposition contracts, ${mockLaneContracts.length} CI mock-lane disposition contracts, ${pcmCollectedTotal}-test local PCM contract`);
