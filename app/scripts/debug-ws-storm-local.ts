#!/usr/bin/env npx tsx
/**
 * Local WebSocket Storm Debugger
 *
 * This script helps debug WebSocket connection storms locally by:
 * 1. Creating a test session on the local wrangler dev server
 * 2. Opening multiple browser windows to the same session
 * 3. Monitoring connection activity via the debug endpoints
 *
 * Usage:
 *   npx tsx scripts/debug-ws-storm-local.ts
 *   npx tsx scripts/debug-ws-storm-local.ts --session <id>
 *   npx tsx scripts/debug-ws-storm-local.ts --production
 *
 * Prerequisites:
 *   - Run `npm run build && npx wrangler dev` first (NOT `npm run dev`)
 *   - Default port: 8787
 */

import { exec } from 'child_process';

const LOCAL_SERVER = process.env.API_BASE || 'http://localhost:8787';
const PROD_SERVER = 'https://keyboardia.adewale-883.workers.dev';

interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  connectedAt: number;
}

interface DebugResponse {
  activeConnections: number;
  players: PlayerInfo[];
  messageRate: string;
}

async function checkServer(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok || response.status === 404; // 404 is fine, server is running
  } catch {
    return false;
  }
}

async function createSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tracks: [
        {
          id: 'track-kick',
          name: 'Kick',
          sampleId: 'kick',
          steps: Array(128).fill(false).map((_, i) => i % 8 === 0),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
        {
          id: 'track-hihat',
          name: 'Hi-Hat',
          sampleId: 'hihat',
          steps: Array(128).fill(false).map((_, i) => i % 4 === 2),
          parameterLocks: Array(128).fill(null),
          volume: 0.7,
          muted: false,
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

async function getConnectionCount(baseUrl: string, sessionId: string): Promise<DebugResponse | null> {
  try {
    const response = await fetch(`${baseUrl}/api/debug/session/${sessionId}/connections`);
    if (!response.ok) return null;
    return await response.json() as DebugResponse;
  } catch {
    return null;
  }
}

function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${command} "${url}"`);
}

async function monitorConnections(baseUrl: string, sessionId: string, durationSeconds: number): Promise<void> {
  console.log(`\n📊 Monitoring connections for ${durationSeconds} seconds...`);
  console.log('   (Looking for connection storm: rapid connect/disconnect cycles)\n');

  const startTime = Date.now();
  const connectionHistory: { time: number; count: number; playerIds: string[] }[] = [];
  let maxConnections = 0;
  const totalUniquePlayerIds = new Set<string>();

  while (Date.now() - startTime < durationSeconds * 1000) {
    const debug = await getConnectionCount(baseUrl, sessionId);
    if (debug) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      connectionHistory.push({
        time: elapsed,
        count: debug.activeConnections,
        playerIds: debug.players.map(p => p.id),
      });

      debug.players.forEach(p => totalUniquePlayerIds.add(p.id));
      maxConnections = Math.max(maxConnections, debug.activeConnections);

      // Print live status
      const bar = '█'.repeat(Math.min(debug.activeConnections, 20));
      process.stdout.write(`\r   +${elapsed.toString().padStart(2)}s: ${bar.padEnd(20)} (${debug.activeConnections} active, ${totalUniquePlayerIds.size} unique IDs)`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n');

  // Analysis
  console.log('=' .repeat(70));
  console.log('ANALYSIS');
  console.log('='.repeat(70));
  console.log(`\n   Duration: ${durationSeconds}s`);
  console.log(`   Max concurrent connections: ${maxConnections}`);
  console.log(`   Total unique player IDs seen: ${totalUniquePlayerIds.size}`);

  // Storm detection
  if (totalUniquePlayerIds.size > 10) {
    console.log(`\n   ⚠️  STORM DETECTED: ${totalUniquePlayerIds.size} unique player IDs`);
    console.log('      Expected: 1-2 per browser window');
    console.log('      This indicates rapid disconnect/reconnect cycles.');
  } else if (totalUniquePlayerIds.size <= 2) {
    console.log('\n   ✅ Connection appears stable');
    console.log(`      ${totalUniquePlayerIds.size} unique player ID(s) as expected`);
  } else {
    console.log(`\n   ⚠️  Possible instability: ${totalUniquePlayerIds.size} unique player IDs`);
    console.log('      Some reconnections occurred, but not a full storm.');
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useProduction = args.includes('--production') || args.includes('--prod');
  const sessionIndex = args.indexOf('--session');
  const existingSession = sessionIndex !== -1 ? args[sessionIndex + 1] : null;

  const baseUrl = useProduction ? PROD_SERVER : LOCAL_SERVER;
  console.log('\n🔍 WebSocket Storm Local Debugger');
  console.log('='.repeat(50));

  // Check server
  console.log(`\n📡 Checking ${baseUrl}...`);
  if (!await checkServer(baseUrl)) {
    if (!useProduction) {
      console.log('\n❌ Local wrangler dev server not running!');
      console.log('\n   To reproduce the WebSocket storm locally:');
      console.log('   1. Run: npm run build');
      console.log('   2. Run: npx wrangler dev');
      console.log('   3. Then run this script again');
      console.log('\n   ⚠️  Note: `npm run dev` uses a mock API without WebSockets!');
      console.log('       You MUST use `npx wrangler dev` to test WebSocket behavior.');
    } else {
      console.log('\n❌ Production server not reachable');
    }
    process.exit(1);
  }
  console.log('   ✓ Server is running');

  // Create or use session
  let sessionId: string;
  if (existingSession) {
    sessionId = existingSession;
    console.log(`\n🎵 Using existing session: ${sessionId}`);
  } else {
    console.log('\n🎵 Creating test session...');
    sessionId = await createSession(baseUrl);
    console.log(`   ✓ Created: ${sessionId}`);
  }

  const sessionUrl = `${baseUrl}/s/${sessionId}?debug=1`;

  console.log('\n📋 Session URL:');
  console.log(`   ${sessionUrl}`);

  console.log('\n🪟 Opening 2 browser windows...');
  console.log('   (If storm occurs, you\'ll see many unique player IDs)');

  // Open browsers
  openInBrowser(sessionUrl);
  await new Promise(resolve => setTimeout(resolve, 1500));
  openInBrowser(sessionUrl);

  // Wait for connections to establish
  console.log('\n⏳ Waiting for connections to establish...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Monitor for storm
  await monitorConnections(baseUrl, sessionId, 30);

  // Helpful commands
  console.log('📋 Debug Commands:');
  console.log(`   curl ${baseUrl}/api/debug/session/${sessionId}/connections`);
  console.log(`   curl ${baseUrl}/api/debug/session/${sessionId}/ws-logs`);
  console.log(`   npx wrangler tail keyboardia --format json | npx tsx scripts/analyze-ws-storm.ts`);

  console.log('\n💡 To trigger state changes (which cause the storm):');
  console.log('   - Click any step in the grid in either browser');
  console.log('   - Change tempo or swing');
  console.log('   - Add a track');
  console.log('\n');
}

main().catch(console.error);
