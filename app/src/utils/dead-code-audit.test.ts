/**
 * Dead Code Audit Tests
 *
 * Verifies that built-but-unwired features are tracked and that
 * cleanup doesn't accidentally remove code that is actually used.
 *
 * These tests serve as living documentation of known dead code.
 * When dead code is wired in or removed, update these tests accordingly.
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 19 & 20
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const SRC = join(__dirname, '..');

function fileExists(relPath: string): boolean {
  return existsSync(join(SRC, relPath));
}

function fileContent(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

function isImportedBy(symbol: string, ...excludeFiles: string[]): boolean {
  // Check if a symbol is imported by any source file (excluding specified files)
  try {
    const result = execSync(
      `grep -rl "\\b${symbol}\\b" "${SRC}" --include="*.ts" --include="*.tsx" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const files = result.trim().split('\n').filter(f => f);
    const nonExcluded = files.filter(f => !excludeFiles.some(ex => f.includes(ex)));
    return nonExcluded.length > 0;
  } catch {
    return false;
  }
}

// =============================================================================
// CATEGORY 1: Feature flags that are always off
// =============================================================================

describe('Feature flags: verify known off-by-default flags', () => {
  it('VITE_LAZY_AUDIO defaults to off (eager loading)', () => {
    const content = fileContent('audio/lazyAudioLoader.ts');
    expect(content).toContain("=== 'true'");
    // The flag exists and is checked, but defaults to false (eager loading)
  });
});

// =============================================================================
// CATEGORY 2: Classes/modules built but never wired in
// =============================================================================

describe('Unwired modules: built but never integrated', () => {
  it('SchedulerWorkletHost is never instantiated outside tests', () => {
    expect(fileExists('audio/scheduler-worklet-host.ts')).toBe(true);
    const imported = isImportedBy(
      'SchedulerWorkletHost',
      'scheduler-worklet-host.ts',
      'dead-code-audit.test.ts',
      '.test.ts'
    );
    expect(imported).toBe(false);
  });

  it('useTrackMeter hook is never used in any component', () => {
    expect(fileExists('audio/useTrackMeter.ts')).toBe(true);
    const imported = isImportedBy(
      'useTrackMeter',
      'useTrackMeter.ts',
      'dead-code-audit.test.ts'
    );
    expect(imported).toBe(false);
  });

});

// =============================================================================
// CATEGORY 3: Config files that should not exist
// =============================================================================

describe('Config hygiene: no orphaned configs', () => {
  it('vitest.integration.config.ts should not exist (was removed)', () => {
    expect(existsSync(join(SRC, '..', 'vitest.integration.config.ts'))).toBe(false);
  });

  it('vite.config.ts should NOT contain a test block', () => {
    const viteConfig = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf-8');
    // The test block was removed; only a comment explaining why should remain
    const hasTestEnvironment = /test:\s*\{[^}]*environment:/s.test(viteConfig);
    expect(hasTestEnvironment).toBe(false);
  });
});

// =============================================================================
// CATEGORY 4: Exports from this PR that ARE wired in (regression guards)
// =============================================================================

describe('Regression: exports from recent work ARE used', () => {
  it('exportToMidi is imported by midiExport.worker.ts and App.tsx', () => {
    const imported = isImportedBy(
      'exportToMidi',
      'midiExport.ts',
      'dead-code-audit.test.ts'
    );
    expect(imported).toBe(true);
  });

  it('hashState is imported by useSyncExternalState and useSession', () => {
    const imported = isImportedBy(
      'hashState',
      'canonicalHash.ts',
      'dead-code-audit.test.ts'
    );
    expect(imported).toBe(true);
  });

  it('computePeaks is used within Waveform.tsx', () => {
    const content = fileContent('components/Waveform.tsx');
    expect(content).toContain('computePeaks');
  });
});
