import { basename, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const [resultsFile, expectedArg, skippedArg] = process.argv.slice(2);
if (!resultsFile || expectedArg === undefined || skippedArg === undefined) {
  throw new Error('Usage: node scripts/assert-playwright-stats.mjs <results.json> <expected> <skipped>');
}
const report = JSON.parse(readFileSync(resolve(resultsFile), 'utf8'));
const contract = { expected: Number(expectedArg), skipped: Number(skippedArg), flaky: 0, unexpected: 0 };
const actual = Object.fromEntries(Object.keys(contract).map((key) => [key, report.stats?.[key] ?? 0]));
if (JSON.stringify(actual) !== JSON.stringify(contract)) {
  throw new Error(`Playwright disposition contract failed: ${JSON.stringify({ contract, actual })}`);
}

const reviewed = new Set(readFileSync(new URL('../e2e/test-title-inventory.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
const observed = [];
const walk = (suites, ancestors = []) => {
  for (const suite of suites ?? []) {
    const isFileSuite = suite.title === basename(suite.file ?? '');
    const nextAncestors = isFileSuite ? ancestors : [...ancestors, suite.title];
    for (const spec of suite.specs ?? []) {
      const identity = `${basename(spec.file)} › ${[...nextAncestors, spec.title].join(' › ')}`;
      for (const test of spec.tests ?? []) observed.push(`${test.projectName}\0${identity}`);
    }
    walk(suite.suites, nextAncestors);
  }
};
walk(report.suites);
const dispositionTotal = Object.values(actual).reduce((sum, count) => sum + count, 0);
if (observed.length !== dispositionTotal) {
  throw new Error(
    `Playwright report result count does not match its dispositions: ${JSON.stringify({ dispositionTotal, observed: observed.length })}`,
  );
}
const unknown = observed.map((entry) => entry.split('\0')[1]).filter((identity) => !reviewed.has(identity));
if (unknown.length > 0) throw new Error(`Playwright report contains unreviewed tests:\n${unknown.join('\n')}`);
if (new Set(observed).size !== observed.length) throw new Error('Playwright report contains duplicate project/test identities');

console.log(`Playwright contract valid: ${actual.expected} passed, ${actual.skipped} reviewed skips, ${observed.length} exact results`);
