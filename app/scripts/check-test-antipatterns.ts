#!/usr/bin/env npx tsx
/**
 * Guard against the always-green test patterns fixed in July 2026.
 *
 * Each of these shipped in this repo and each produced a passing test that
 * could not fail. They are cheap to detect and expensive to find by hand, so
 * they are checked rather than trusted. See docs/TEST-AUDIT-2026-07.md.
 *
 * Matching runs over comment-stripped source. The first version of this script
 * did not, and reported 17 findings of which 13 were its own documentation:
 * every place the audit *described* `expect(true).toBe(true)` was reported as
 * an instance of it. A checker whose output is mostly noise gets muted, so the
 * stripping is not a nicety.
 *
 * Run: npx tsx scripts/check-test-antipatterns.ts
 */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

interface Finding { rule: string; file: string; line: number; text: string }

/**
 * Blank out comments and string bodies, preserving line and column offsets so
 * reported line numbers still point at the real source.
 *
 * String bodies go too: a test name like `it('expect(true).toBe(true) is a
 * tautology')` is prose, not an assertion. Quotes are kept so the test-name
 * capture below still works.
 */
function strip(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  let i = 0;
  let prev = ''; // last significant char, for regex-vs-division disambiguation
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === '\\') { k += 2; continue; }
        if (source[k] === c) break;
        k++;
      }
      blank(i + 1, k);
      prev = c;
      i = k + 1;
      continue;
    }
    // A `/` after a value is division; after an operator or keyword it opens a
    // regex literal, whose body must not be scanned for comment markers.
    if (c === '/' && !/[\w)\]]/.test(prev)) {
      let k = i + 1;
      let inClass = false;
      while (k < source.length && source[k] !== '\n') {
        if (source[k] === '\\') { k += 2; continue; }
        if (source[k] === '[') inClass = true;
        else if (source[k] === ']') inClass = false;
        else if (source[k] === '/' && !inClass) break;
        k++;
      }
      blank(i + 1, k);
      prev = '/';
      i = k + 1;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

const files = execSync(
  `find src test e2e \\( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" \\) | grep -v node_modules`,
  { encoding: 'utf-8' }
).trim().split('\n').filter(Boolean).sort();

const findings: Finding[] = [];
const add = (rule: string, file: string, i: number, text: string) =>
  findings.push({ rule, file, line: i + 1, text: text.trim().slice(0, 100) });

/**
 * Anything that can make a test fail. Named assertion helpers count — a test
 * whose whole body is `await expectSessionSynced(page)` asserts plenty — so
 * this deliberately admits `expectFoo(`, `assertFoo(`, and `waitFor`-shaped
 * helpers rather than demanding a literal `expect(`.
 */
const ASSERTION_SHAPED =
  /\bexpect\b|\bassert\w*\(|\.toPass\(|fc\.assert|throw new Error|\.rejects\b|\.resolves\b|\b(?:expect|assert|verify|check|poll|await)[A-Z]\w*\(|\.waitFor\w*\(|\bwaitFor\w*\(/;

for (const file of files) {
  const raw = readFileSync(file, 'utf-8');
  const src = strip(raw);
  const lines = src.split('\n');
  const rawLines = raw.split('\n');

  lines.forEach((line, i) => {
    // An expect whose rejection is swallowed asserts nothing.
    if (/await\s+expect\(.*?\)\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line)) {
      add('nullified-assertion', file, i, rawLines[i]);
    }
    // A test that disables itself when the app misbehaves reports "skipped",
    // never "failed". Environmental guards (isWebkit, useMockAPI) are fine.
    if (/test\.skip\(\s*true\s*,/.test(line)) {
      add('runtime-self-skip', file, i, rawLines[i]);
    }
    // Tautologies.
    if (/expect\(\s*(true|false|1)\s*\)\.toBe\(\s*(true|false|1)\s*\)/.test(line)) {
      add('tautological-assertion', file, i, rawLines[i]);
    }
    // Comparing a value to itself. Literals are excluded: `expect(true)
    // .toBe(true)` is already reported above, and reporting one line under two
    // rules trains readers to skim the output.
    const self = line.match(/expect\(\s*(\w+)\s*\)\.(?:toBe|toEqual|toStrictEqual)\(\s*(\w+)\s*\)/);
    if (self && self[1] === self[2] && !/^(?:true|false|null|undefined|\d+)$/.test(self[1])) {
      add('self-comparison', file, i, rawLines[i]);
    }
  });

  // An assertion inside a `try` whose `catch` also asserts on the caught value.
  // When the code under test misbehaves, the assertion in the `try` throws, the
  // `catch` catches the *assertion error*, and `expect(err).toBeDefined()`
  // passes on it — so the test cannot fail. Four tests in this repo were built
  // this way; the nullified-assertion rule above missed them because there is
  // no `.catch(() => {})` anywhere in sight.
  for (const m of src.matchAll(
    /try\s*\{([\s\S]*?)\}\s*catch\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*?)\n[ \t]*\}/g
  )) {
    const [, tryBody, errName, catchBody] = m;
    if (!/\bexpect\b/.test(tryBody)) continue;
    // Only flag when the catch's assertion would be satisfied by an assertion
    // error: `expect(err).toBeDefined()`, `.toBeTruthy()`, `not.toBeNull()`.
    const swallows = new RegExp(
      `expect\\(\\s*${errName}\\s*\\)\\s*\\.(?:not\\.)?(?:toBeDefined|toBeTruthy|toBeNull|toBeInstanceOf)\\(`
    );
    if (swallows.test(catchBody)) {
      add('assertion-swallowed-by-own-catch', file, src.slice(0, m.index!).split('\n').length - 1,
          catchBody.trim().split('\n').find((l) => l.includes('expect')) ?? catchBody.trim());
    }
  }

  // Tests with no assertion at all.
  const testBlocks = [...src.matchAll(/^([ \t]*)(?:it|test)\(\s*['"`]/gm)];
  for (const m of testBlocks) {
    const start = m.index!;
    const startLine = src.slice(0, start).split('\n').length - 1;
    const indent = m[1].length;
    const rest = src.slice(start).split('\n');
    let body = '';
    for (let k = 1; k < rest.length; k++) {
      const col = rest[k].search(/\S/);
      // The block ends at a `})` that closes the test call itself: same
      // indent, and nothing after it but an optional `;`. Requiring the line
      // to *end* there is what separates the real terminator from `}));`
      // closing an inline `JSON.stringify({...})` and from the `}) => {` of a
      // destructured multi-line signature — both of which ended the scan
      // early in the first version and produced four false positives.
      if (col >= 0 && col <= indent && /^\s*\}\)\s*;?\s*$/.test(rest[k])) break;
      body += rest[k] + '\n';
    }
    if (!body.trim()) continue;
    if (!ASSERTION_SHAPED.test(body)) {
      const name = rawLines[startLine]?.match(/['"`]([^'"`]+)/)?.[1] ?? '(unnamed)';
      add('zero-assertion-test', file, startLine, name);
    }
  }
}

if (!findings.length) {
  console.log(`✅ No always-green test patterns found (${files.length} files).`);
  process.exit(0);
}

const byRule = new Map<string, Finding[]>();
for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
for (const [rule, group] of byRule) {
  console.log(`\n${rule} (${group.length}):`);
  for (const f of group) console.log(`  ${f.file}:${f.line}  ${f.text}`);
}
console.log(`\n${findings.length} finding(s).`);
process.exit(1);
