#!/usr/bin/env npx tsx
/**
 * Find exported symbols that no production code imports.
 *
 * Imports are resolved to their source module. The previous implementation
 * pooled imported names globally, so importing `createFoo` from one module
 * accidentally marked every unrelated `createFoo` export as live. The pure
 * analyzer and its adversarial fixtures live in test-quality-analyzers.ts.
 *
 * This is a blocking gate. Land a caller with a new runtime export, keep a
 * tooling-only export reachable from an explicit build root, or do not export
 * the symbol yet.
 *
 * Run: npx tsx scripts/check-dead-exports.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  analyzeExportReachability,
  type DeadExportFinding,
  type ExportReachability,
  type SourceUnit,
} from './test-quality-analyzers';

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
  /\.d\.ts$|-evals\.ts$/.test(file);

const rootTypeScriptFiles = readdirSync('.', { withFileTypes: true })
  .filter((entry) => entry.isFile() && /(?:\.config)?\.tsx?$/.test(entry.name))
  .map((entry) => entry.name);
const sourceFiles = [...['src', 'test', 'e2e', 'scripts'].flatMap(filesBelow), ...rootTypeScriptFiles];
const units: SourceUnit[] = sourceFiles
  .filter((file) => !file.split(path.sep).includes('node_modules'))
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => {
    const test = isTest(file);
    const build = file.startsWith(`scripts${path.sep}`) || !file.includes(path.sep);
    return {
      file,
      source: readFileSync(file, 'utf8'),
      isTest: test,
      role: test ? 'test' : build ? 'build' : 'runtime',
      isEntry: test || build || ['src/main.tsx', 'src/worker/index.ts'].includes(file.replaceAll('\\', '/')),
    } satisfies SourceUnit;
  });
const reachability = analyzeExportReachability(units, excluded);
const findings = reachability.filter((finding) =>
  finding.status === 'test-only' || finding.status === 'unreferenced');
const runtimeCount = reachability.filter((finding) => finding.status === 'runtime').length;
const buildOnly = reachability.filter((finding) => finding.status === 'build-only');

const show = (label: string, group: Array<DeadExportFinding | ExportReachability>, note: string) => {
  if (group.length === 0) return;
  console.log(`\n${label} (${group.length})${note}`);
  for (const finding of [...group].sort((a, b) =>
    a.file.localeCompare(b.file) || a.name.localeCompare(b.name))) {
    const suffix = finding.testFiles
      ? `  [${finding.testFiles} test file${finding.testFiles > 1 ? 's' : ''}]`
      : '';
    console.log(`  ${finding.file}:  ${finding.kind} ${finding.name}${suffix}`);
  }
};

show('BUILD-ONLY', buildOnly,
  ' — consumed by tooling/configuration, not shipped browser or Worker entry points.');
show('TESTED BUT UNREACHABLE', findings.filter((finding) => finding.status === 'test-only'),
  ' — green ticks on code nothing runs. Delete, or wire up the caller.');
show('EXPORTED BUT UNIMPORTED', findings.filter((finding) => finding.status === 'unreferenced'),
  ' — no consumer at all. Un-export, or delete.');
if (!findings.length) {
  console.log(`\n✅ No dead runtime exports (${runtimeCount} runtime, ${buildOnly.length} build-only).`);
} else {
  console.log(`\n${findings.length} dead runtime export finding(s).`);
  process.exit(1);
}
