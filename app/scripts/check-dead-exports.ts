#!/usr/bin/env npx tsx
/**
 * Find exported symbols that no production code imports.
 *
 * `check-test-subject-links.ts` asks the same question one level up — does
 * anything import this *module* — and that granularity is why this script
 * exists. A module passes that check on the strength of a single live export
 * while the rest of its surface is unreachable, and two modules in this repo
 * did exactly that:
 *
 *   src/audio/slicer.ts             1 live export, 4 dead ones carrying a
 *                                   units bug
 *   src/audio/instrument-types.ts   6 live exports, 1 dead one that answered
 *                                   "is this melodic?" wrongly for 24 of the
 *                                   99 catalogue ids
 *
 * Both had tests. Tests are what keep a dead export alive: they import it, so
 * it looks used, and they pass, so it looks correct. That is why the report
 * separates "imported only by tests" from "imported by nothing" — the first
 * group is the dangerous one, because it comes with green ticks.
 *
 * Advisory, like the module-level check. A newly-added export that its caller
 * has not landed yet is a normal state, so this informs rather than blocks.
 *
 * Run: npx tsx scripts/check-dead-exports.ts
 */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const files = execSync(
  `find src -name '*.ts' -o -name '*.tsx' | grep -v node_modules`,
  { encoding: 'utf-8' },
).trim().split('\n').filter(Boolean);

const isTest = (f: string) =>
  /\.test\.tsx?$|\.spec\.tsx?$|__fixtures__|__fakes__|(^|\/)src\/test\//.test(f);

/**
 * Excluded because "no importer" is their normal state:
 *   index.ts        re-exports; consumers import the directory
 *   *.worker.ts     loaded by `new Worker(url)`, never imported
 *   *.worklet.ts    loaded by `audioWorklet.addModule(url)`
 *   *.d.ts          declarations only
 *   *-evals.ts      benchmark definitions, test support by nature
 */
const excluded = (f: string) =>
  /(^|\/)index\.tsx?$|\.worker\.ts$|\.worklet\.ts$|\.d\.ts$|-evals\.ts$/.test(f);

const prodSrc = new Map(files.filter((f) => !isTest(f)).map((f) => [f, readFileSync(f, 'utf-8')]));
const testSrc = new Map(files.filter(isTest).map((f) => [f, readFileSync(f, 'utf-8')]));

/** Names pulled in by a named import — `import { a, b as c }` yields a and b. */
function importedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '');
      if (name) names.add(name);
    }
  }
  return names;
}

const prodImports = new Map([...prodSrc].map(([f, s]) => [f, importedNames(s)]));
const testImports = new Map([...testSrc].map(([f, s]) => [f, importedNames(s)]));

interface Finding { file: string; name: string; kind: string; testFiles: number }
const findings: Finding[] = [];

for (const [file, src] of prodSrc) {
  if (excluded(file)) continue;

  for (const m of src.matchAll(/^export\s+(?:async\s+)?(function|const|class)\s+(\w+)/gm)) {
    const [, kind, name] = m;

    const importedByProd = [...prodImports].some(([f, names]) => f !== file && names.has(name));
    if (importedByProd) continue;

    // Referenced elsewhere in its own module? Then it is over-exported rather
    // than dead, and that is a different (much smaller) problem.
    const selfUses = (src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
    if (selfUses > 1) continue;

    const testFiles = [...testImports].filter(([, names]) => names.has(name)).length;
    findings.push({ file, name, kind, testFiles });
  }
}

const withTests = findings.filter((f) => f.testFiles > 0);
const without = findings.filter((f) => f.testFiles === 0);

const show = (label: string, group: Finding[], note: string) => {
  console.log(`\n${label} (${group.length})${note}`);
  for (const f of [...group].sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))) {
    const suffix = f.testFiles ? `  [${f.testFiles} test file${f.testFiles > 1 ? 's' : ''}]` : '';
    console.log(`  ${f.file}:  ${f.kind} ${f.name}${suffix}`);
  }
};

if (!findings.length) {
  console.log(`✅ Every export is imported by production code (${prodSrc.size} modules).`);
  process.exit(0);
}

show('TESTED BUT UNREACHABLE', withTests,
  ' — green ticks on code nothing runs. Delete, or wire up the caller.');
show('EXPORTED BUT UNIMPORTED', without,
  ' — no consumer at all. Un-export, or delete.');
console.log(`\n${findings.length} finding(s). Advisory; see docs/TEST-AUDIT-2026-07.md.`);
