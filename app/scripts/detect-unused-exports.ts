#!/usr/bin/env npx tsx
/**
 * Detection tool: Find exported symbols that are never imported.
 *
 * Scans src/ for exports and checks if each is imported by any other file.
 * Excludes test files from the "consumer" side (tests can import anything).
 * Includes test files on the "export" side so we catch dead test utilities.
 *
 * Usage: npx tsx scripts/detect-unused-exports.ts
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 19 & 20
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_DIR = join(__dirname, '..', 'src');

interface UnusedExport {
  file: string;
  line: number;
  symbol: string;
  kind: string;
}

// ============================================================================
// File walking
// ============================================================================

function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkDir(full));
      } else if (entry.match(/\.(ts|tsx)$/) && !entry.endsWith('.d.ts')) {
        results.push(full);
      }
    }
  } catch { /* skip */ }
  return results;
}

// ============================================================================
// Export extraction
// ============================================================================

const EXPORT_RE = /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
const EXPORT_DEFAULT_RE = /export\s+default\s+(?:function|class)\s+(\w+)/g;

function extractExports(filePath: string): { symbol: string; line: number; kind: string }[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const exports: { symbol: string; line: number; kind: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;

    // Match named exports
    EXPORT_RE.lastIndex = 0;
    let match;
    while ((match = EXPORT_RE.exec(line)) !== null) {
      // Skip underscore-prefixed exports (private by convention, e.g., _resetHashCache)
      if (!match[1].startsWith('_')) {
        exports.push({ symbol: match[1], line: i + 1, kind: 'named' });
      }
    }

    // Match default exports
    EXPORT_DEFAULT_RE.lastIndex = 0;
    while ((match = EXPORT_DEFAULT_RE.exec(line)) !== null) {
      exports.push({ symbol: match[1], line: i + 1, kind: 'default' });
    }
  }

  return exports;
}

// ============================================================================
// Import checking
// ============================================================================

function isImportedAnywhere(symbol: string, sourceFile: string, allFiles: string[]): boolean {

  for (const file of allFiles) {
    if (file === sourceFile) continue;

    const content = readFileSync(file, 'utf-8');

    // Check for import of this symbol (named import, default import, or re-export)
    if (content.includes(symbol)) {
      // Quick check — could be a false positive from substring matches
      // Use word boundary check
      const wordBoundary = new RegExp(`\\b${symbol}\\b`);
      if (wordBoundary.test(content)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Main
// ============================================================================

console.log('Scanning for unused exports in src/...\n');

const allFiles = walkDir(SRC_DIR);

// Files that export things
const sourceFiles = allFiles.filter(f => !f.includes('.test.'));

// Files that can import things (all files including tests)
const consumerFiles = allFiles;

const unused: UnusedExport[] = [];

for (const file of sourceFiles) {
  const exports = extractExports(file);
  const rel = relative(join(__dirname, '..'), file);

  for (const exp of exports) {
    if (!isImportedAnywhere(exp.symbol, file, consumerFiles)) {
      unused.push({
        file: rel,
        line: exp.line,
        symbol: exp.symbol,
        kind: exp.kind,
      });
    }
  }
}

// Report
if (unused.length === 0) {
  console.log('No unused exports found.');
  process.exit(0);
}

console.log(`Found ${unused.length} potentially unused export(s):\n`);

// Group by file
const byFile = new Map<string, UnusedExport[]>();
for (const u of unused) {
  if (!byFile.has(u.file)) byFile.set(u.file, []);
  byFile.get(u.file)!.push(u);
}

for (const [file, exports] of byFile) {
  console.log(`  ${file}:`);
  for (const exp of exports) {
    console.log(`    L${exp.line}: ${exp.kind} export \`${exp.symbol}\``);
  }
  console.log();
}

console.log(`Total: ${unused.length} unused exports across ${byFile.size} files`);
