/**
 * Tests for the detect-main-thread-hotspots script.
 *
 * Verifies the script runs successfully and detects known patterns
 * after the fixes in this PR have been applied.
 *
 * These tests previously recovered from a failed run with
 * `output = (err as { stdout?: string }).stdout ?? ''` and then asserted
 * `expect(output).not.toContain('orphaned-vitest-config')`. A script that
 * crashed before printing anything produced `''`, which contains nothing, so
 * every negative assertion passed — a total failure read as a clean bill of
 * health. The run is now asserted to have succeeded *before* anything is
 * asserted about its output.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import { join } from 'path';

const APP_ROOT = join(__dirname, '..', '..');
const SCRIPT_PATH = join(APP_ROOT, 'scripts', 'detect-main-thread-hotspots.ts');

interface ScriptRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

// The script takes several seconds; run it once and share the result rather
// than spawning it per assertion.
let run: ScriptRun;

describe('detect-main-thread-hotspots script', { timeout: 60000 }, () => {
  beforeAll(() => {
    // spawnSync does not throw on a non-zero exit, so a failure surfaces as
    // data we can assert on instead of an exception we have to guess about.
    // Use Node's loader form rather than the tsx CLI. The CLI creates an IPC
    // socket before it runs the script, which can be denied in sandboxes and
    // leaves us with the same exit code (1) as a legitimate hotspot finding.
    const result = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT_PATH], {
      cwd: APP_ROOT,
      encoding: 'utf-8',
      timeout: 60000,
    });

    run = {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  });

  it('runs to completion with a documented exit code', () => {
    // The script exits 0 when clean and 1 when it finds high-severity hotspots
    // (scripts/detect-main-thread-hotspots.ts:244, :272). Anything else — a
    // crash, a timeout, a missing tsx — is a broken test environment, not a
    // finding, and must not be silently absorbed.
    expect(run.stderr).not.toContain('Cannot find module');
    expect(
      [0, 1],
      `unexpected exit ${run.status}; stderr: ${run.stderr.slice(0, 500)}`
    ).toContain(run.status);

    // Pre-mask check: the negative assertions below are only meaningful if the
    // script actually produced its report.
    expect(run.stdout).toContain('Scanning for main-thread performance hotspots');

    if (run.status === 1) {
      expect(run.stdout).toContain('potential hotspot');
      expect(run.stdout).toMatch(/Summary: [1-9]\d* high,/);
      return;
    }

    // A zero exit means there are no high-severity findings. Medium/low
    // findings are still reported, so both a completely clean report and a
    // report whose summary starts with zero high findings are valid.
    if (!run.stdout.includes('No hotspots detected.')) {
      expect(run.stdout).toContain('potential hotspot');
      expect(run.stdout).toMatch(/Summary: 0 high, \d+ medium, \d+ low/);
    }
  });

  it('detects the known config conflict has been fixed', () => {
    expect(run.stdout).toContain('Scanning for main-thread performance hotspots');
    // vite.config.ts should no longer have a test.environment block
    expect(run.stdout).not.toContain('duplicate-test-environment');
  });

  it('detects the orphaned vitest.integration.config.ts has been removed', () => {
    expect(run.stdout).toContain('Scanning for main-thread performance hotspots');
    expect(run.stdout).not.toContain('orphaned-vitest-config');
  });
});
