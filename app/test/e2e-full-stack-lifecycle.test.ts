import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  healthBelongsToRun,
  parseWallTimeout,
  signalExitCode,
  waitForOwnedHealth,
} from '../scripts/e2e-full-stack-lifecycle';

describe('full-stack E2E ownership and lifecycle', () => {
  it('accepts health only from the Worker nonce started by this run', () => {
    expect(healthBelongsToRun({ status: 'ok', runId: 'current' }, 'current')).toBe(true);
    expect(healthBelongsToRun({ status: 'ok', runId: 'stale' }, 'current')).toBe(false);
    expect(healthBelongsToRun({ status: 'ok' }, 'current')).toBe(false);
  });

  it('uses conventional non-zero signal exit codes', () => {
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
  });

  it('rejects invalid wall-clock limits', () => {
    expect(() => parseWallTimeout('999')).toThrow(/at least 1000/);
    expect(parseWallTimeout('60000')).toBe(60_000);
  });

  it('fails immediately when Wrangler exits before becoming ready', async () => {
    const child = new EventEmitter() as ChildProcess;
    const readiness = waitForOwnedHealth(child, 'http://127.0.0.1:1', 'run', 60_000, 10_000);
    child.emit('exit', 1, null);
    await expect(readiness).rejects.toThrow(/exited before readiness/);
  });
});
