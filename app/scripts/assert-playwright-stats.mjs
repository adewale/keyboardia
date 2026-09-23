import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  collectPlaywrightReportIdentities,
  hashPlaywrightIdentities,
} from './playwright-contract-identities.mjs';

const [resultsFile, expectedArg, skippedArg, inventoryArg] = process.argv.slice(2);
if (!resultsFile || expectedArg === undefined || skippedArg === undefined) {
  throw new Error(
    'Usage: node scripts/assert-playwright-stats.mjs <results.json> <expected|inventory> <skipped> [inventory.txt]\n'
      + '   or: node scripts/assert-playwright-stats.mjs <results.json> lane <lane-name> [inventory.txt]',
  );
}
const inventoryFile = inventoryArg
  ? resolve(inventoryArg)
  : new URL('../e2e/test-title-inventory.txt', import.meta.url);
const reviewed = new Set(readFileSync(inventoryFile, 'utf8')
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
const report = JSON.parse(readFileSync(resolve(resultsFile), 'utf8'));
let disposition;
let laneName;
if (expectedArg === 'lane') {
  const laneContracts = JSON.parse(readFileSync(
    new URL('../e2e/lane-contracts.json', import.meta.url), 'utf8',
  ));
  if (laneContracts.schemaVersion !== 2) {
    throw new Error('lane-contracts.json has an unsupported schema');
  }
  laneName = skippedArg;
  disposition = laneContracts.lanes?.[laneName];
  if (!disposition) throw new Error(`Unknown Playwright lane: ${skippedArg}`);
} else {
  disposition = {
    expected: expectedArg === 'inventory' ? reviewed.size : Number(expectedArg),
    skipped: Number(skippedArg),
  };
}
const contract = {
  expected: disposition.expected,
  skipped: disposition.skipped,
  flaky: 0,
  unexpected: 0,
};
const actual = Object.fromEntries(Object.keys(contract).map((key) => [key, report.stats?.[key] ?? 0]));
if (JSON.stringify(actual) !== JSON.stringify(contract)) {
  throw new Error(`Playwright disposition contract failed: ${JSON.stringify({ contract, actual })}`);
}

const observed = collectPlaywrightReportIdentities(report);
const dispositionTotal = Object.values(actual).reduce((sum, count) => sum + count, 0);
if (observed.length !== dispositionTotal) {
  throw new Error(
    `Playwright report result count does not match its dispositions: ${JSON.stringify({ dispositionTotal, observed: observed.length })}`,
  );
}
const unknown = observed.map((entry) => entry.split('\0')[1]).filter((identity) => !reviewed.has(identity));
if (unknown.length > 0) throw new Error(`Playwright report contains unreviewed tests:\n${unknown.join('\n')}`);
if (new Set(observed).size !== observed.length) throw new Error('Playwright report contains duplicate project/test identities');
if (laneName) {
  if (typeof disposition.identitySha256 !== 'string') {
    throw new Error(`Playwright lane ${laneName} has no exact identity contract`);
  }
  const identitySha256 = hashPlaywrightIdentities(observed);
  if (identitySha256 !== disposition.identitySha256) {
    throw new Error(`Playwright lane identity contract failed: ${JSON.stringify({
      lane: laneName,
      expected: disposition.identitySha256,
      actual: identitySha256,
    })}`);
  }
}

console.log(`Playwright contract valid: ${actual.expected} passed, ${actual.skipped} reviewed skips, ${observed.length} exact results`);
