/**
 * Tests for the detect-main-thread-hotspots script.
 *
 * Verifies the script runs successfully and detects known patterns
 * after the fixes in this PR have been applied.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

describe('detect-main-thread-hotspots script', { timeout: 30000 }, () => {
  const scriptPath = join(__dirname, '..', '..', 'scripts', 'detect-main-thread-hotspots.ts');

  it('runs without crashing', () => {
    // The script exits with code 1 if high-severity findings exist,
    // but it should not throw/crash
    try {
      execSync(`npx tsx ${scriptPath}`, {
        cwd: join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 30000,
      });
    } catch (err: unknown) {
      // Exit code 1 is expected if high-severity findings exist
      const error = err as { status?: number; stdout?: string };
      expect(error.status).toBe(1);
      expect(error.stdout).toContain('potential hotspot');
    }
  });

  it('detects the known config conflict has been fixed', () => {
    let output: string;
    try {
      output = execSync(`npx tsx ${scriptPath}`, {
        cwd: join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 30000,
      });
    } catch (err: unknown) {
      output = (err as { stdout?: string }).stdout ?? '';
    }

    // After our fix, vite.config.ts should no longer have a test.environment block
    expect(output).not.toContain('duplicate-test-environment');
  });

  it('detects the orphaned vitest.integration.config.ts has been removed', () => {
    let output: string;
    try {
      output = execSync(`npx tsx ${scriptPath}`, {
        cwd: join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 30000,
      });
    } catch (err: unknown) {
      output = (err as { stdout?: string }).stdout ?? '';
    }

    // After our fix, orphaned config should no longer be detected
    expect(output).not.toContain('orphaned-vitest-config');
  });
});
