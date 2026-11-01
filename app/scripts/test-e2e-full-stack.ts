#!/usr/bin/env npx tsx
import { randomUUID } from 'node:crypto';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildPlaywrightArgs, getWranglerStdio, type TestScope } from './e2e-full-stack-args';
import {
  assertPortAvailable,
  parseWallTimeout,
  signalExitCode,
  waitForOwnedHealth,
} from './e2e-full-stack-lifecycle';

const WRANGLER_PORT = Number(process.env.E2E_WORKER_PORT ?? 8787);
if (!Number.isInteger(WRANGLER_PORT) || WRANGLER_PORT < 1 || WRANGLER_PORT > 65535) {
  throw new Error('E2E_WORKER_PORT must be a valid TCP port');
}
const WRANGLER_URL = `http://localhost:${WRANGLER_PORT}`;
const MAX_STARTUP_WAIT_MS = 120_000;
const HEALTH_CHECK_INTERVAL_MS = 1_000;
const E2E_TIMEOUT_MS = parseWallTimeout(process.env.E2E_TIMEOUT_MS);

let wranglerProcess: ChildProcess | null = null;
let playwrightProcess: ChildProcess | null = null;
let cleanupPromise: Promise<void> | null = null;

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (process.platform === 'win32' && (child.exitCode !== null || child.signalCode !== null)) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
  }
}

function treeIsAlive(child: ChildProcess): boolean {
  if (!child.pid) return false;
  if (process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

async function waitForTreeExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (treeIsAlive(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !treeIsAlive(child);
}

async function terminateTrees(children: Array<ChildProcess | null>): Promise<boolean> {
  const live = children.filter((child): child is ChildProcess =>
    Boolean(child?.pid) && treeIsAlive(child!),
  );
  // Signal every owned tree before the first await. npm may stop waiting for
  // this runner as soon as Ctrl-C reaches its foreground process group; a
  // sequential cleanup could otherwise exit before Wrangler was signalled.
  for (const child of live) signalTree(child, 'SIGTERM');
  const graceful = await Promise.all(live.map((child) => waitForTreeExit(child, 5_000)));
  const survivors = live.filter((_child, index) => !graceful[index]);
  for (const child of survivors) signalTree(child, 'SIGKILL');
  const forced = await Promise.all(survivors.map((child) => waitForTreeExit(child, 5_000)));
  return forced.every(Boolean);
}

function startWrangler(runId: string): ChildProcess {
  const createLimit = process.env.E2E_SESSION_CREATE_RATE_LIMIT_PER_MINUTE ?? '1000';
  return spawn('npx', [
    'wrangler', 'dev', '--port', String(WRANGLER_PORT),
    '--var', `SESSION_CREATE_RATE_LIMIT_PER_MINUTE:${createLimit}`,
    '--var', `E2E_RUN_ID:${runId}`,
  ], {
    stdio: getWranglerStdio(),
    detached: process.platform !== 'win32',
  });
}

const WORKER_REQUIRED_SPECS = readFileSync(
  new URL('../e2e/worker-required-files.txt', import.meta.url),
  'utf8',
).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

async function runE2ETests(scope: TestScope, passthroughArgs: string[]): Promise<number> {
  const args = buildPlaywrightArgs(scope, WORKER_REQUIRED_SPECS, passthroughArgs);
  playwrightProcess = spawn('npx', args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, PLAYWRIGHT_BASE_URL: WRANGLER_URL, BASE_URL: WRANGLER_URL },
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(`\n❌ E2E exceeded the ${Math.round(E2E_TIMEOUT_MS / 60_000)} minute wall-clock limit`);
    void terminateTrees([playwrightProcess]);
  }, E2E_TIMEOUT_MS);
  const status = await new Promise<number>((resolve) => {
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    playwrightProcess!.once('error', (error) => {
      console.error('❌ Failed to start Playwright:', error.message);
      finish(1);
    });
    playwrightProcess!.once('exit', (code, signal) => {
      finish(timedOut ? 124 : code ?? (signal ? signalExitCode(signal) : 1));
    });
  });
  clearTimeout(timeout);
  playwrightProcess = null;
  return status;
}

async function cleanup(): Promise<void> {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const stopped = await terminateTrees([playwrightProcess, wranglerProcess]);
    if (!stopped) {
      console.error('❌ Failed to terminate an owned E2E process tree');
      if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
    }
    playwrightProcess = null;
    wranglerProcess = null;
  })();
  return cleanupPromise;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scopeFlags = ['--collaboration', '--session-contract', '--smoke'];
  const scope: TestScope = args.includes('--collaboration') ? 'collaboration'
    : args.includes('--session-contract') ? 'session-contract'
      : args.includes('--smoke') ? 'smoke' : 'all';
  const passthroughArgs = args.filter((arg) => !scopeFlags.includes(arg));
  const runId = randomUUID();

  const handleSignal = (signal: NodeJS.Signals) => {
    process.exitCode = signalExitCode(signal);
    void cleanup();
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    await assertPortAvailable(WRANGLER_PORT);
    console.log('📦 Building project...');
    execSync('npm run build', { stdio: 'inherit' });
    wranglerProcess = startWrangler(runId);
    console.log(`⏳ Waiting for the owned Worker on port ${WRANGLER_PORT}...`);
    await waitForOwnedHealth(
      wranglerProcess, WRANGLER_URL, runId, MAX_STARTUP_WAIT_MS, HEALTH_CHECK_INTERVAL_MS,
    );
    console.log('✅ Owned Worker is ready');
    const status = await runE2ETests(scope, passthroughArgs);
    if (process.exitCode === undefined) process.exitCode = status;
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

void main();
