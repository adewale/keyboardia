#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectCssConsistencyMetrics } from './css-consistency-metrics.mjs';

const baseline = JSON.parse(readFileSync(resolve('scripts/css-consistency-baseline.json'), 'utf8'));
const metrics = collectCssConsistencyMetrics();
const failures = [];

if (metrics.unscopedGenericSelectors.length) {
  failures.push(`unscoped generic selectors:\n  ${metrics.unscopedGenericSelectors.join('\n  ')}`);
}
if (metrics.undefinedRequiredTokens.length) {
  failures.push(`undefined required root tokens: ${metrics.undefinedRequiredTokens.join(', ')}`);
}
if (metrics.rawColorsOutsideIndex > baseline.maxRawColorsOutsideIndex) {
  failures.push(
    `raw colors outside index.css increased: ${metrics.rawColorsOutsideIndex} > ${baseline.maxRawColorsOutsideIndex}`,
  );
}
if (metrics.importantDeclarations > baseline.maxImportantDeclarations) {
  failures.push(
    `!important declarations increased: ${metrics.importantDeclarations} > ${baseline.maxImportantDeclarations}`,
  );
}
if (metrics.dropdown.sharedConsumers < 2) {
  failures.push(`shared dropdown recipe has ${metrics.dropdown.sharedConsumers} consumer(s), expected at least 2`);
}
if (metrics.dropdown.declarations > baseline.maxDropdownDeclarations) {
  failures.push(
    `dropdown declarations increased: ${metrics.dropdown.declarations} > ${baseline.maxDropdownDeclarations}`,
  );
}
if (
  metrics.dropdown.duplicatedDeclarationsBetweenComponents
  > baseline.maxDropdownDuplicateDeclarations
) {
  failures.push(
    'duplicated dropdown component declarations increased: '
    + `${metrics.dropdown.duplicatedDeclarationsBetweenComponents} `
    + `> ${baseline.maxDropdownDuplicateDeclarations}`,
  );
}

if (failures.length) {
  console.error(`CSS consistency invariant failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}

console.log(
  `CSS consistency invariant passed: ${metrics.unscopedGenericSelectors.length} unscoped generic selectors, `
  + `${metrics.undefinedRequiredTokens.length} required undefined tokens, `
  + `${metrics.rawColorsOutsideIndex}/${baseline.maxRawColorsOutsideIndex} raw colors, `
  + `${metrics.dropdown.sharedConsumers} shared dropdown consumers.`,
);
