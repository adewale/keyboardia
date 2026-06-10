#!/usr/bin/env npx tsx
/**
 * Detection tool: Find main-thread performance hotspots
 *
 * Scans the codebase for patterns known to cause UI jank:
 * 1. JSON.stringify in hot paths (sync hooks, render loops, comparison logic)
 * 2. setInterval/setTimeout in React components (should be CSS animations)
 * 3. Nested loops over typed arrays (should be in Web Workers)
 * 4. Disabled feature flags (finished work sitting unused)
 * 5. Conflicting test/build configs
 *
 * Usage: npx tsx scripts/detect-main-thread-hotspots.ts
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 19 & 20
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_DIR = join(__dirname, '..', 'src');
const ROOT_DIR = join(__dirname, '..');

interface Finding {
  file: string;
  line: number;
  category: string;
  severity: 'high' | 'medium' | 'low';
  pattern: string;
  context: string;
}

const findings: Finding[] = [];

// ============================================================================
// File walker
// ============================================================================

function walkDir(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...walkDir(fullPath, extensions));
      } else if (extensions.some(ext => entry.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip permission errors
  }
  return results;
}

// ============================================================================
// Pattern detectors
// ============================================================================

function scanFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rel = relative(ROOT_DIR, filePath);

  // Skip test files for performance patterns (they're expected to have these)
  if (rel.includes('.test.') || rel.includes('__test__') || rel.includes('scripts/')) return;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // --- 1. JSON.stringify in comparison/hot paths ---
    if (line.includes('JSON.stringify') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
      // Check if it's inside a comparison (===, !==) or inside useEffect/useMemo/render
      const isComparison = line.includes('===') || line.includes('!==');
      const isInHook = isInsideHook(lines, i);
      const isInLoop = isInsideLoop(lines, i);

      if (isComparison || isInHook) {
        findings.push({
          file: rel,
          line: lineNum,
          category: 'JSON.stringify in hot path',
          severity: isInLoop ? 'high' : 'medium',
          pattern: 'JSON.stringify',
          context: line.trim(),
        });
      }
    }

    // --- 2. setInterval/setTimeout in React components ---
    if (rel.includes('components/') && (line.includes('setInterval(') || line.includes('setTimeout('))) {
      if (!line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
        // Check if it's for animation/UI purposes (not cleanup/debounce)
        const _isForAnimation = hasAnimationContext(lines, i);
        findings.push({
          file: rel,
          line: lineNum,
          category: 'Timer in React component',
          severity: line.includes('setInterval') ? 'medium' : 'low',
          pattern: line.includes('setInterval') ? 'setInterval' : 'setTimeout',
          context: line.trim(),
        });
      }
    }

    // --- 3. Nested loops over typed arrays ---
    if (line.includes('getChannelData') || line.includes('Float32Array') || line.includes('Uint8Array')) {
      if (rel.includes('components/') && !line.trimStart().startsWith('//')) {
        // Check for enclosing for-loop
        const hasLoop = lines.slice(Math.max(0, i - 10), i).some(l => l.includes('for (') || l.includes('for('));
        if (hasLoop) {
          findings.push({
            file: rel,
            line: lineNum,
            category: 'Typed array processing in component',
            severity: 'high',
            pattern: 'typed-array-in-render',
            context: line.trim(),
          });
        }
      }
    }

    // --- 4. Disabled feature flags ---
    if (line.includes('import.meta.env.VITE_') && (line.includes("=== 'true'") || line.includes('=== true'))) {
      // This is a feature flag check - note it for awareness
      const flagMatch = line.match(/VITE_(\w+)/);
      if (flagMatch) {
        findings.push({
          file: rel,
          line: lineNum,
          category: 'Feature flag gate',
          severity: 'low',
          pattern: `VITE_${flagMatch[1]}`,
          context: line.trim(),
        });
      }
    }
  }
}

// Helper: check if a line is inside a React hook (useEffect, useMemo, useCallback)
function isInsideHook(lines: string[], index: number): boolean {
  // Look backwards up to 20 lines for hook calls
  for (let i = index; i >= Math.max(0, index - 20); i--) {
    if (lines[i].includes('useEffect') || lines[i].includes('useMemo') || lines[i].includes('useCallback')) {
      return true;
    }
    // Stop at function boundaries
    if (lines[i].match(/^(export\s+)?(function|const\s+\w+\s*=)/)) break;
  }
  return false;
}

// Helper: check if a line is inside a loop
function isInsideLoop(lines: string[], index: number): boolean {
  for (let i = index; i >= Math.max(0, index - 10); i--) {
    if (lines[i].includes('for (') || lines[i].includes('for(') || lines[i].includes('while (') || lines[i].includes('.forEach(')) {
      return true;
    }
  }
  return false;
}

// Helper: check if a timer is for animation purposes
function hasAnimationContext(lines: string[], index: number): boolean {
  const surrounding = lines.slice(Math.max(0, index - 5), Math.min(lines.length, index + 5)).join(' ');
  return surrounding.includes('fade') || surrounding.includes('opacity') || surrounding.includes('animation') ||
         surrounding.includes('tick') || surrounding.includes('render');
}

// ============================================================================
// Config conflict detector
// ============================================================================

function checkConfigConflicts(): void {
  // Check for test.environment in vite.config.ts (should only be in vitest.config.ts)
  try {
    const viteConfig = readFileSync(join(ROOT_DIR, 'vite.config.ts'), 'utf-8');
    if (viteConfig.includes('environment:') && viteConfig.includes('test:')) {
      const lineNum = viteConfig.split('\n').findIndex(l => l.includes('environment:')) + 1;
      findings.push({
        file: 'vite.config.ts',
        line: lineNum,
        category: 'Config conflict',
        severity: 'high',
        pattern: 'duplicate-test-environment',
        context: 'test.environment in vite.config.ts conflicts with vitest.config.ts',
      });
    }
  } catch {
    // File doesn't exist, that's fine
  }

  // Check for orphaned vitest config variants
  try {
    const entries = readdirSync(ROOT_DIR);
    const vitestConfigs = entries.filter(e => e.match(/vitest\..*\.config\.ts/));
    for (const config of vitestConfigs) {
      // Check if it's referenced by any package.json script
      const pkgJson = readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8');
      if (!pkgJson.includes(config)) {
        findings.push({
          file: config,
          line: 1,
          category: 'Orphaned config',
          severity: 'medium',
          pattern: 'orphaned-vitest-config',
          context: `${config} is not referenced in package.json scripts`,
        });
      }
    }
  } catch {
    // Skip
  }
}

// ============================================================================
// Main
// ============================================================================

console.log('Scanning for main-thread performance hotspots...\n');

const sourceFiles = walkDir(SRC_DIR, ['.ts', '.tsx']);
for (const file of sourceFiles) {
  scanFile(file);
}
checkConfigConflicts();

// Sort by severity
const severityOrder = { high: 0, medium: 1, low: 2 };
findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

// Report
if (findings.length === 0) {
  console.log('No hotspots detected.');
  process.exit(0);
}

console.log(`Found ${findings.length} potential hotspot(s):\n`);

const grouped = new Map<string, Finding[]>();
for (const f of findings) {
  const key = f.category;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key)!.push(f);
}

for (const [category, items] of grouped) {
  const icon = items[0].severity === 'high' ? '!!' : items[0].severity === 'medium' ? ' !' : '  ';
  console.log(`${icon} ${category} (${items.length}):`);
  for (const item of items) {
    console.log(`   ${item.file}:${item.line}`);
    console.log(`   ${item.context}\n`);
  }
}

// Summary
const highCount = findings.filter(f => f.severity === 'high').length;
const mediumCount = findings.filter(f => f.severity === 'medium').length;
const lowCount = findings.filter(f => f.severity === 'low').length;
console.log(`\nSummary: ${highCount} high, ${mediumCount} medium, ${lowCount} low`);

if (highCount > 0) {
  process.exit(1);
}
