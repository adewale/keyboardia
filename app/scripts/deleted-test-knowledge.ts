#!/usr/bin/env npx tsx
/**
 * One-off forensic: what did deleted tests know that the current suite does not?
 *
 * `recording-123` is why this exists. When instrument-types' isMelodicInstrument
 * tests were deleted, three of their four assertions were redundant and one
 * encoded the only knowledge in the codebase that user recordings are unpitched
 * — a live bug once it went. Test names and describe blocks did not reveal that;
 * a specific input literal did.
 *
 * So this extracts distinctive literals from every deleted test file and reports
 * the ones that appear nowhere in the surviving suite. A literal that survived
 * is covered somewhere. A literal that vanished is a question to answer by hand:
 * either the case is genuinely gone, or nothing checks it any more.
 *
 * Usage: npx tsx scripts/deleted-test-knowledge.ts <since>
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const since = process.argv[2] ?? '1 month ago';
const sh = (cmd: string) => execSync(cmd, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });

// Every test file deleted in the window, with the commit that removed it.
const log = sh(
  `git log --since="${since}" --diff-filter=D --name-only --format='C|%h|%s' origin/main HEAD`,
);
const deleted = new Map<string, string>(); // path -> commit
let commit = '';
for (const line of log.split('\n')) {
  if (line.startsWith('C|')) { commit = line.split('|')[1]; continue; }
  if (/\.(test|spec)\.tsx?$/.test(line.trim()) && !deleted.has(line.trim())) {
    deleted.set(line.trim(), commit);
  }
}

// The surviving corpus: every test file that exists now.
const current = sh(`find src test e2e -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts'`)
  .trim().split('\n').filter(Boolean)
  .map((f) => readFileSync(f, 'utf-8')).join('\n');

/**
 * Literals worth tracking: string constants that look like data rather than
 * prose. Ids, prefixes, message types, and hyphenated/colon-separated tokens
 * are the ones that carry behavioural meaning.
 */
function distinctiveLiterals(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/'([^'\n]{3,40})'|"([^"\n]{3,40})"/g)) {
    const lit = (m[1] ?? m[2]).trim();
    if (!/^[\w:@./-]+$/.test(lit)) continue;      // no spaces: data, not prose
    if (!/[:\-_.\d]/.test(lit)) continue;          // must look structured
    if (/^\.{0,2}\//.test(lit)) continue;          // import paths
    if (/^\d+(\.\d+)?$/.test(lit)) continue;       // bare numbers
    out.add(lit);
  }
  return out;
}

interface Row { file: string; commit: string; lost: string[]; total: number }
const rows: Row[] = [];

for (const [file, sha] of deleted) {
  let source: string;
  try {
    source = sh(`git show ${sha}^:${file}`);
  } catch {
    continue;
  }
  const literals = distinctiveLiterals(source);
  const lost = [...literals].filter((lit) => !current.includes(lit)).sort();
  rows.push({ file, commit: sha, lost, total: literals.size });
}

rows.sort((a, b) => b.lost.length - a.lost.length);

console.log(`Deleted test files since "${since}": ${rows.length}\n`);
for (const r of rows) {
  const pct = r.total ? Math.round((r.lost.length / r.total) * 100) : 0;
  console.log(`${r.commit}  ${r.file}`);
  console.log(`    ${r.lost.length}/${r.total} distinctive literals (${pct}%) appear nowhere in the current suite`);
  if (r.lost.length) console.log(`    ${r.lost.slice(0, 18).join('  ')}`);
  console.log();
}
