#!/usr/bin/env npx tsx
/**
 * Full-Stack E2E Test Runner
 *
 * Runs E2E tests against the real Cloudflare Worker (wrangler dev) instead of
 * just the Vite dev server. This tests the complete stack including:
 * - Cloudflare Worker API endpoints
 * - Durable Objects (WebSocket, state persistence)
 * - KV storage
 * - Observability 2.0 wide events
 *
 * Usage:
 *   npm run test:e2e:full-stack           # Run all E2E tests against wrangler dev
 *   npm run test:e2e:full-stack -- --smoke # Run only smoke tests
 *   npm run test:e2e:session-contract:worker # Run the HTTP contract against wrangler dev
 *   npm run test:e2e:collaboration:worker # HTTP contract + the connected browser path
 *   E2E_WORKER_PORT=8791 npm run test:e2e:session-contract:worker # Override port
 *
 * Prerequisites:
 *   - Project must be built first (script handles this)
 *   - Port 8787 must be available for wrangler dev
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { readFileSync } from 'node:fs';
import { buildPlaywrightArgs, getWranglerStdio, type TestScope } from './e2e-full-stack-args';

const WRANGLER_PORT = Number(process.env.E2E_WORKER_PORT ?? 8787);
if (!Number.isInteger(WRANGLER_PORT) || WRANGLER_PORT < 1 || WRANGLER_PORT > 65535) {
  throw new Error('E2E_WORKER_PORT must be a valid TCP port');
}
const WRANGLER_URL = `http://localhost:${WRANGLER_PORT}`;
const MAX_STARTUP_WAIT_MS = 120_000; // 2 minutes
const HEALTH_CHECK_INTERVAL_MS = 1000;

let wranglerProcess: ChildProcess | null = null;

/**
 * Check if wrangler dev is ready by hitting the health endpoint
 */
async function isWranglerReady(): Promise<boolean> {
  try {
    const response = await fetch(`${WRANGLER_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for wrangler dev to be ready
 */
async function waitForWrangler(): Promise<void> {
  const startTime = Date.now();
  console.log(`⏳ Waiting for wrangler dev to be ready on port ${WRANGLER_PORT}...`);

  while (Date.now() - startTime < MAX_STARTUP_WAIT_MS) {
    if (await isWranglerReady()) {
      console.log(`✅ Wrangler dev is ready (took ${Math.round((Date.now() - startTime) / 1000)}s)`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  throw new Error(`Wrangler dev failed to start within ${MAX_STARTUP_WAIT_MS / 1000}s`);
}

/**
 * Start wrangler dev in the background
 */
function startWrangler(): ChildProcess {
  console.log('🚀 Starting wrangler dev...');

  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(WRANGLER_PORT)], {
    // Playwright runs through execSync below. Inherited output keeps Wrangler's
    // request log flowing while the parent Node event loop is blocked.
    stdio: getWranglerStdio(),
    detached: false,
    shell: true,
  });

  proc.on('error', (err) => {
    console.error('❌ Failed to start wrangler:', err.message);
  });

  return proc;
}

/**
 * Stop wrangler dev
 */
function stopWrangler(): void {
  if (wranglerProcess) {
    console.log('🛑 Stopping wrangler dev...');
    wranglerProcess.kill('SIGTERM');
    wranglerProcess = null;
  }
}

/** Every browser spec whose contract requires the real Worker. The inventory
 * validator keeps this list aligned with all `useMockAPI` guards. */
const WORKER_REQUIRED_SPECS = readFileSync(
  new URL('../e2e/worker-required-files.txt', import.meta.url),
  'utf8',
).split(/\r?\n/).map(line => line.trim()).filter(Boolean);

function runE2ETests(scope: TestScope): number {
  console.log(`\n🧪 Running E2E tests against ${WRANGLER_URL}...\n`);

  const args = buildPlaywrightArgs(scope, WORKER_REQUIRED_SPECS);

  try {
    execSync(`npx ${args.join(' ')}`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        // Override the base URL to point to wrangler dev
        // PLAYWRIGHT_BASE_URL: Used by playwright.config.ts for browser navigation
        // BASE_URL: Used by test-utils.ts for direct API requests
        PLAYWRIGHT_BASE_URL: WRANGLER_URL,
        BASE_URL: WRANGLER_URL,
      },
    });
    return 0;
  } catch {
    // execSync throws on non-zero exit code
    return 1;
  }
}

/**
 * Build the project
 */
function buildProject(): void {
  console.log('📦 Building project...');
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build complete\n');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scope: TestScope = args.includes('--collaboration')
    ? 'collaboration'
    : args.includes('--session-contract')
      ? 'session-contract'
      : args.includes('--smoke')
        ? 'smoke'
        : 'all';
  let exitCode = 0;

  // Cleanup handler
  const cleanup = () => {
    stopWrangler();
    process.exit(exitCode);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // Step 1: Build
    buildProject();

    // Step 2: Start wrangler dev
    wranglerProcess = startWrangler();

    // Step 3: Wait for wrangler to be ready
    await waitForWrangler();

    // Step 4: Run E2E tests
    exitCode = runE2ETests(scope);

    if (exitCode === 0) {
      console.log('\n✅ All E2E tests passed!');
    } else {
      console.log('\n❌ Some E2E tests failed');
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    exitCode = 1;
  } finally {
    cleanup();
  }
}

main();
