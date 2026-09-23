#!/usr/bin/env npx tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectValidatorImportGraph,
  findValidatorOwnershipGaps,
  type VerificationImpactInventory,
} from './verification-impact-graph';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const inventory = JSON.parse(
  readFileSync(resolve(appRoot, 'e2e/verification-impact.json'), 'utf8'),
) as VerificationImpactInventory;
const graph = collectValidatorImportGraph();
const gaps = findValidatorOwnershipGaps(inventory, graph);

if (gaps.length > 0) {
  console.error('Instrument Validation would be skipped for validator dependencies:');
  for (const gap of gaps) console.error(`  ${gap.importPath.join(' -> ')}`);
  process.exit(1);
}

console.log(
  `Validator impact ownership covers ${graph.modules.length} transitive modules from `
    + `${graph.entrypoints.length} validate:all entrypoints.`,
);
