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
const profiles = ['samples', 'worker'] as const;
const graphs = profiles.map(profile => collectValidatorImportGraph(profile));
const gaps = graphs.flatMap(graph => findValidatorOwnershipGaps(
  inventory,
  graph.profile,
  graph,
));

if (gaps.length > 0) {
  console.error('A validator profile would be skipped for its runtime dependencies:');
  for (const gap of gaps) console.error(`  ${gap.importPath.join(' -> ')}`);
  process.exit(1);
}

for (const graph of graphs) {
  console.log(
    `Validator impact ownership covers ${graph.modules.length} transitive modules and `
      + `${graph.inputs.length} declared runtime inputs from ${graph.entrypoints.length} `
      + `${graph.profile} entrypoints.`,
  );
}
