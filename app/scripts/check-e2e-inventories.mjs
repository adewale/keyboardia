import { readFileSync, readdirSync } from 'node:fs';
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

const mockSpecs = readManifest('mock-compatible-files.txt');
const workerSpecs = readManifest('worker-required-files.txt');
const allSpecs = listSpecs(e2eRoot).filter(path => !path.startsWith('e2e/staging/'));
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

if (missingWorkerCoverage.length > 0) {
  throw new Error(`Worker manifest is missing real-backend specs:\n${missingWorkerCoverage.join('\n')}`);
}
if (overlappingBackends.length > 0) {
  throw new Error(`Specs cannot be required in both backend manifests:\n${overlappingBackends.join('\n')}`);
}

console.log(`E2E inventories valid: ${mockSpecs.length} mock-required, ${workerSpecs.length} Worker-required, ${allSpecs.length} total specs`);
