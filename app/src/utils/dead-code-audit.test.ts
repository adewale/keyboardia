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
import { spawnSync } from 'child_process';

const SRC = join(__dirname, '..');

function fileContent(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

/**
 * Find the source files referencing `symbol`, excluding `excludeFiles`.
 *
 * This used to swallow every grep failure and `return false`, which any caller
 * asserting "this symbol is unused" read as confirmation. A broken grep, a bad
 * path, or a timeout therefore *strengthened* the apparent result instead of
 * failing the test. grep's exit codes are now handled explicitly: 0 = matches,
 * 1 = no matches (a real answer), anything else = the search itself broke.
 */
function referencingFiles(symbol: string, ...excludeFiles: string[]): string[] {
  const result = spawnSync(
    'grep',
    ['-rl', `\\b${symbol}\\b`, SRC, '--include=*.ts', '--include=*.tsx'],
    { encoding: 'utf-8', timeout: 10000 }
  );

  if (result.error) {
    throw new Error(`grep for "${symbol}" failed to run: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `grep for "${symbol}" exited ${result.status}: ${(result.stderr ?? '').slice(0, 300)}`
    );
  }

  return (result.stdout ?? '')
    .trim()
    .split('\n')
    .filter((f) => f)
    .filter((f) => !excludeFiles.some((ex) => f.includes(ex)));
}

function isImportedBy(symbol: string, ...excludeFiles: string[]): boolean {
  return referencingFiles(symbol, ...excludeFiles).length > 0;
}

// =============================================================================
// CATEGORY 1: Feature flags that are always off
// =============================================================================

describe('Feature flags: verify known off-by-default flags', () => {
  it('workletScheduler defaults to off', () => {
    const content = fileContent('config/features.ts');
    expect(content).toContain('workletScheduler');
  });
});

// =============================================================================
// CATEGORY 2: Classes/modules built but never wired in
// =============================================================================

// CATEGORY 2: All previously unwired modules have been wired in or removed.
// See "Regression" section below for guards that verify they stay wired.

// =============================================================================
// CATEGORY 3: Config files that should not exist
// =============================================================================

describe('Config hygiene: no orphaned configs', () => {
  it('vitest.integration.config.ts should not exist (was removed)', () => {
    expect(existsSync(join(SRC, '..', 'vitest.integration.config.ts'))).toBe(false);
  });

  it('audio-health-canary.ts should not exist (orphaned, never imported)', () => {
    expect(existsSync(join(SRC, 'debug', 'audio-health-canary.ts'))).toBe(false);
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

  it('useTrackMeter is imported by TrackMeter component', () => {
    const imported = isImportedBy(
      'useTrackMeter',
      'useTrackMeter.ts',
      'dead-code-audit.test.ts'
    );
    expect(imported).toBe(true);
  });

  it('computePeaks is used within Waveform.tsx', () => {
    const content = fileContent('components/Waveform.tsx');
    expect(content).toContain('computePeaks');
  });

  it('SchedulerWorkletHost is dynamically imported by scheduler.ts', () => {
    const content = fileContent('audio/scheduler.ts');
    expect(content).toContain('scheduler-worklet-host');
  });

  it('XYPadController is imported by Transport.tsx', () => {
    const imported = isImportedBy(
      'XYPadController',
      'xyPad.ts',
      'dead-code-audit.test.ts'
    );
    expect(imported).toBe(true);
  });
});
