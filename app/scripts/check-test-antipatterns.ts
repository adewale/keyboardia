#!/usr/bin/env npx tsx
/**
 * Guard against always-green and zero-oracle test patterns.
 *
 * The analysis lives in a pure, fixture-tested module. Keeping this file as a
 * small CLI wrapper means the checker itself is covered by the ordinary unit
 * gate rather than becoming another untested regex program.
 *
 * Run: npx tsx scripts/check-test-antipatterns.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { scanTestSource, type TestFinding } from './test-quality-analyzers';

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

const files = ['src', 'test', 'e2e']
  .flatMap(filesBelow)
  .filter((file) => !file.split(path.sep).includes('node_modules'))
  .filter((file) => /(?:\.test|\.spec)\.tsx?$/.test(file))
  .sort();

const findings = files.flatMap((file) => scanTestSource(file, readFileSync(file, 'utf8')));

if (!findings.length) {
  console.log(`✅ No always-green test patterns found (${files.length} files).`);
  process.exit(0);
}

const byRule = new Map<string, TestFinding[]>();
for (const finding of findings) {
  byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
}
for (const [rule, group] of byRule) {
  console.log(`\n${rule} (${group.length}):`);
  for (const finding of group) {
    console.log(`  ${finding.file}:${finding.line}  ${finding.text}`);
  }
}
console.log(`\n${findings.length} finding(s).`);
process.exit(1);
