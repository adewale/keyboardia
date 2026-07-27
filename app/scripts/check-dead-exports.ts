#!/usr/bin/env npx tsx
/**
 * Find exported symbols that no production code imports.
 *
 * Imports are resolved to their source module. The previous implementation
 * pooled imported names globally, so importing `createFoo` from one module
 * accidentally marked every unrelated `createFoo` export as live. The pure
 * analyzer and its adversarial fixtures live in test-quality-analyzers.ts.
 *
 * Advisory: a new export may legitimately land before its caller.
 *
 * Run: npx tsx scripts/check-dead-exports.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { analyzeDeadExports, type DeadExportFinding, type SourceUnit } from './test-quality-analyzers';

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

const isTest = (file: string) =>
  /^(?:test|e2e)\/|(?:\.test|\.spec)\.tsx?$|__fixtures__|__fakes__|(^|\/)src\/test\//.test(file);
const excluded = (file: string) =>
  /(^|\/)index\.tsx?$|\.worker\.ts$|\.worklet\.ts$|\.d\.ts$|-evals\.ts$/.test(file);

const units: SourceUnit[] = ['src', 'test', 'e2e']
  .flatMap(filesBelow)
  .filter((file) => !file.split(path.sep).includes('node_modules'))
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => ({ file, source: readFileSync(file, 'utf8'), isTest: isTest(file) }));
const findings = analyzeDeadExports(units, excluded);
const productionModules = units.filter((unit) => !unit.isTest).length;

const show = (label: string, group: DeadExportFinding[], note: string) => {
  console.log(`\n${label} (${group.length})${note}`);
  for (const finding of [...group].sort((a, b) =>
    a.file.localeCompare(b.file) || a.name.localeCompare(b.name))) {
    const suffix = finding.testFiles
      ? `  [${finding.testFiles} test file${finding.testFiles > 1 ? 's' : ''}]`
      : '';
    console.log(`  ${finding.file}:  ${finding.kind} ${finding.name}${suffix}`);
  }
};

if (!findings.length) {
  console.log(`✅ Every export is imported by production code (${productionModules} modules).`);
  process.exit(0);
}

show('TESTED BUT UNREACHABLE', findings.filter((finding) => finding.testFiles > 0),
  ' — green ticks on code nothing runs. Delete, or wire up the caller.');
show('EXPORTED BUT UNIMPORTED', findings.filter((finding) => finding.testFiles === 0),
  ' — no consumer at all. Un-export, or delete.');
console.log(`\n${findings.length} finding(s). Advisory; see docs/TEST-AUDIT-2026-07.md.`);
