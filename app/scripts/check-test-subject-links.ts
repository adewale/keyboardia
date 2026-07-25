#!/usr/bin/env npx tsx
/**
 * Check that every test file is actually connected to the code it names.
 *
 * Three failure modes, all found in this repo in July 2026 and all invisible to
 * coverage tools, linters and a green test run:
 *
 *   1. ORPHAN     `foo.test.ts` names a module `foo` that exists but is never
 *                 imported. The name is a claim the file does not honour.
 *   2. REIMPL     ...and the file defines its own copy of production logic
 *                 instead. The copy drifts, and the test's reach is then
 *                 bounded by the copy rather than by production.
 *   3. DEAD       a module under test is imported by nothing but its own tests,
 *                 so the tests cannot fail for any reason that matters.
 *
 * Run: npx tsx scripts/check-test-subject-links.ts
 */
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { basename } from 'path';

interface Finding { kind: 'ORPHAN' | 'REIMPL' | 'DEAD'; file: string; detail: string }

const sh = (cmd: string) => execSync(cmd, { encoding: 'utf-8' }).trim();

const testFiles = sh(`find src test -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules`)
  .split('\n')
  .filter(Boolean);

const findings: Finding[] = [];

for (const file of testFiles) {
  const subject = basename(file).replace(/\.(property\.)?test\.tsx?$/, '');
  const src = readFileSync(file, 'utf-8');
  const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

  if (specifiers.some((s) => s.split('/').pop() === subject)) continue;

  // Integration tests are black-box by design: they reach the Worker through
  // SELF.fetch / cloudflare:test bindings rather than importing it. Naming them
  // after the subsystem they drive is correct, not a mismatch.
  if (file.startsWith('test/integration/') && /cloudflare:test/.test(src)) continue;

  // Only complain when a module of that name actually exists — a test named for
  // a feature rather than a file (e.g. drag-to-paint.test.tsx) is fine.
  const module = sh(`find src -name "${subject}.ts" -o -name "${subject}.tsx" | head -1`);
  if (!module || !existsSync(module)) continue;

  const localFns = [...src.matchAll(/^function\s+([a-z][A-Za-z0-9]*)\s*\(/gm)].map((m) => m[1]);
  const logicFns = localFns.filter(
    (n) => !/^(create|make|build|mock|setup|render|expect|arb)/.test(n)
  );

  findings.push(
    logicFns.length
      ? { kind: 'REIMPL', file, detail: `names ${module} but defines its own ${logicFns.join(', ')}` }
      : { kind: 'ORPHAN', file, detail: `names ${module} but never imports it` }
  );
}

// DEAD: a src module whose only importers are test files.
//
// Heuristic, and deliberately narrow. Excluded because "nothing imports it" is
// the normal, correct state for these:
//   - index.ts barrels        re-exported, often only referenced by path
//   - __fixtures__/__fakes__  test support code; test-only by design
//   - *.worker/*.worklet      loaded by URL via new Worker()/addModule(), never imported
// Anything still reported needs a human to confirm before deletion — a module
// can also be reached dynamically. Treat this as a shortlist, not a verdict.
const EXCLUDED = /(^|\/)index\.ts$|__fixtures__|__fakes__|\.worker\.ts$|\.worklet\.ts$|(^|\/)src\/test\//;
const srcModules = sh(`find src -name "*.ts" -not -name "*.test.ts" -not -name "*.d.ts"`)
  .split('\n')
  .filter(Boolean)
  .filter((m) => !EXCLUDED.test(m));
for (const module of srcModules) {
  const stem = basename(module).replace(/\.tsx?$/, '');
  if (!sh(`grep -rl "${stem}" src --include="*.test.ts" --include="*.test.tsx" | head -1`)) continue;
  // Match static `from './x'` AND dynamic `await import('./x')` — the worker
  // entry reaches src/worker/mcp.ts only through the dynamic form, and an
  // import-only regex reports it as dead.
  const prodImporters = sh(
    `grep -rlE "(from|import\\() *'[^']*${stem}'" src --include="*.ts" --include="*.tsx" | grep -v "\\.test\\." | grep -v "${module}" || true`
  );
  if (!prodImporters) {
    findings.push({ kind: 'DEAD', file: module, detail: 'imported only by tests — confirm before deleting' });
  }
}

if (!findings.length) {
  console.log('✅ Every test file is linked to the code it names.');
  process.exit(0);
}

for (const kind of ['REIMPL', 'DEAD', 'ORPHAN'] as const) {
  const group = findings.filter((f) => f.kind === kind);
  if (!group.length) continue;
  console.log(`\n${kind} (${group.length}):`);
  for (const f of group) console.log(`  ${f.file}\n      ${f.detail}`);
}
console.log(`\n${findings.length} finding(s). See docs/TEST-PLACEMENT-ANALYSIS.md.`);
// Informational for now — the existing findings are catalogued, not yet fixed.
process.exit(0);
