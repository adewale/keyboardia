#!/usr/bin/env npx tsx
/**
 * CI Connection Stability Test
 *
 * Automated test for CI pipelines that verifies WebSocket connections
 * remain stable during state changes. This catches the "connection storm"
 * bug pattern where unstable callbacks cause reconnection cycles.
 *
 * Exit codes:
 *   0 - All tests passed
 *   1 - Connection instability detected
 *   2 - Infrastructure error (wrangler not running, etc.)
 *
 * Usage:
 *   npx tsx scripts/ci-connection-stability.ts
 *   npx tsx scripts/ci-connection-stability.ts --base-url http://localhost:8787
 *   npx tsx scripts/ci-connection-stability.ts --duration 60  # 60 seconds
 */

import { spawn } from 'child_process';

const BASE_URL = process.env.BASE_URL || process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1] || 'http://localhost:8787';
const DURATION_SECONDS = parseInt(process.env.DURATION || process.argv.find(a => a.startsWith('--duration='))?.split('=')[1] || '30');
const POLL_INTERVAL_MS = 1000;

interface TestResult {
  passed: boolean;
  reason?: string;
  metrics: {
    duration: number;
    peakConnections: number;
    totalUniquePlayerIds: number;
    expectedPlayerIds: number;
    connectionDrops: number;
    stormDetected: boolean;
  };
}

interface DebugResponse {
  connectedPlayers: number;
  players: Array<{ id: string; name: string; connectedAt: number }>;
}

async function checkWranglerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/sessions`, { method: 'HEAD' });
    return response.ok || response.status === 405; // 405 = method not allowed, but server is running
  } catch {
    return false;
  }
}

async function createSession(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tracks: [
        {
          id: 'track-1',
          name: 'Test Track',
          sampleId: 'kick',
          steps: Array(16).fill(false).map((_, i) => i % 4 === 0),
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }

  const data = await response.json() as { id: string };
  return data.id;
}

async function getDebugInfo(sessionId: string): Promise<DebugResponse | null> {
  try {
    const response = await fetch(`${BASE_URL}/api/debug/durable-object/${sessionId}`);
    if (!response.ok) return null;
    return await response.json() as DebugResponse;
  } catch {
    return null;
  }
}

function openBrowsers(url: string, count: number): Promise<void> {
  return new Promise((resolve) => {
    let opened = 0;
    const interval = setInterval(() => {
      const command = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(command, [url], { stdio: 'ignore', detached: true });
      opened++;
      if (opened >= count) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function runStabilityTest(sessionId: string, browserCount: number): Promise<TestResult> {
  const startTime = Date.now();
  const allPlayerIds = new Set<string>();
  let peakConnections = 0;
  let connectionDrops = 0;
  let previousCount = 0;
  let stormDetected = false;
  const connectionHistory: number[] = [];

  console.log(`  Monitoring for ${DURATION_SECONDS} seconds...`);

  while (Date.now() - startTime < DURATION_SECONDS * 1000) {
    const debug = await getDebugInfo(sessionId);
    if (debug) {
      debug.players.forEach(p => allPlayerIds.add(p.id));
      peakConnections = Math.max(peakConnections, debug.connectedPlayers);

      if (previousCount > 0 && debug.connectedPlayers < previousCount) {
        connectionDrops++;
      }
      previousCount = debug.connectedPlayers;

      // Track connection history for storm detection
      connectionHistory.push(debug.connectedPlayers);
      if (connectionHistory.length > 5) {
        connectionHistory.shift();
      }

      // Storm detection: if we've seen significantly more unique IDs than browsers
      if (allPlayerIds.size > browserCount * 3) {
        stormDetected = true;
      }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  const duration = Date.now() - startTime;
  const metrics = {
    duration,
    peakConnections,
    totalUniquePlayerIds: allPlayerIds.size,
    expectedPlayerIds: browserCount,
    connectionDrops,
    stormDetected,
  };

  // Determine pass/fail
  // Allow some tolerance: up to 2x the browser count for player IDs
  // (accounts for some reconnection during initial connection)
  const playerIdTolerance = browserCount * 2;

  if (stormDetected) {
    return {
      passed: false,
      reason: `Connection storm detected: ${allPlayerIds.size} unique player IDs for ${browserCount} browsers`,
      metrics,
    };
  }

  if (allPlayerIds.size > playerIdTolerance) {
    return {
      passed: false,
      reason: `Too many unique player IDs: ${allPlayerIds.size} (expected max ${playerIdTolerance})`,
      metrics,
    };
  }

  if (connectionDrops > browserCount) {
    return {
      passed: false,
      reason: `Too many connection drops: ${connectionDrops}`,
      metrics,
    };
  }

  return { passed: true, metrics };
}

async function main(): Promise<void> {
  console.log('\n🔬 CI Connection Stability Test');
  console.log('═'.repeat(50));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Duration: ${DURATION_SECONDS} seconds`);
  console.log('');

  // Check wrangler is running
  console.log('1. Checking backend availability...');
  if (!await checkWranglerRunning()) {
    console.error('   ❌ Backend not reachable');
    console.error('   Start wrangler dev first: npm run build && npx wrangler dev');
    process.exit(2);
  }
  console.log('   ✓ Backend is running');

  // Create test session
  console.log('\n2. Creating test session...');
  let sessionId: string;
  try {
    sessionId = await createSession();
    console.log(`   ✓ Session: ${sessionId}`);
  } catch (err) {
    console.error(`   ❌ Failed to create session: ${err}`);
    process.exit(2);
  }

  // Open browsers
  const browserCount = 3;
  console.log(`\n3. Opening ${browserCount} browser windows...`);
  const sessionUrl = `${BASE_URL}/s/${sessionId}?debug=1`;
  await openBrowsers(sessionUrl, browserCount);
  console.log('   ✓ Browsers opened');

  // Wait for connections to establish
  console.log('\n4. Waiting for connections to establish...');
  await new Promise(r => setTimeout(r, 5000));

  const initialDebug = await getDebugInfo(sessionId);
  if (initialDebug) {
    console.log(`   ✓ ${initialDebug.connectedPlayers} connections established`);
  }

  // Run stability test
  console.log('\n5. Running stability test...');
  const result = await runStabilityTest(sessionId, browserCount);

  // Report results
  console.log('\n' + '═'.repeat(50));
  console.log('RESULTS');
  console.log('═'.repeat(50));
  console.log(`Duration:           ${Math.round(result.metrics.duration / 1000)}s`);
  console.log(`Peak connections:   ${result.metrics.peakConnections}`);
  console.log(`Unique player IDs:  ${result.metrics.totalUniquePlayerIds} (expected: ${result.metrics.expectedPlayerIds})`);
  console.log(`Connection drops:   ${result.metrics.connectionDrops}`);
  console.log(`Storm detected:     ${result.metrics.stormDetected ? 'YES' : 'No'}`);
  console.log('');

  if (result.passed) {
    console.log('✅ TEST PASSED');
    console.log('   Connections remained stable during monitoring period');
    process.exit(0);
  } else {
    console.log('❌ TEST FAILED');
    console.log(`   Reason: ${result.reason}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(2);
});
