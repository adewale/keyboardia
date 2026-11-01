#!/usr/bin/env npx tsx
/**
 * Connection Health Monitor
 *
 * Monitors WebSocket connections for a session over time, tracking:
 * - Connection count stability
 * - Connection/disconnection events
 * - Connection establishment latency
 * - Connection storms (rapid reconnects)
 *
 * Usage:
 *   npx tsx scripts/monitor-connections.ts <session-id> [duration-minutes] [base-url]
 *
 * Example:
 *   npx tsx scripts/monitor-connections.ts test-session 15 http://localhost:8787
 */

const SESSION_ID = process.argv[2] || 'monitor-test-' + Date.now();
const DURATION_MINUTES = parseInt(process.argv[3] || '15');
const BASE_URL = process.argv[4] || 'http://localhost:8787';
const POLL_INTERVAL_MS = 2000;

interface ConnectionSnapshot {
  timestamp: number;
  elapsed: number;
  activeConnections: number;
  playerIds: string[];
  players: Array<{
    id: string;
    name: string;
    connectedAt: number;
    messageCount: number;
  }>;
}

interface ConnectionEvent {
  timestamp: number;
  elapsed: number;
  type: 'connect' | 'disconnect' | 'storm_warning';
  playerId?: string;
  playerName?: string;
  details?: string;
}

interface MonitorStats {
  startTime: number;
  snapshots: ConnectionSnapshot[];
  events: ConnectionEvent[];
  peakConnections: number;
  minConnections: number;
  connectionDrops: number;
  stormWarnings: number;
  avgConnectionTime: number;
  connectionTimes: number[];
}

const stats: MonitorStats = {
  startTime: Date.now(),
  snapshots: [],
  events: [],
  peakConnections: 0,
  minConnections: Infinity,
  connectionDrops: 0,
  stormWarnings: 0,
  avgConnectionTime: 0,
  connectionTimes: [],
};

let previousPlayerIds = new Set<string>();
const connectionCountHistory: number[] = [];

async function fetchDebugInfo(): Promise<{
  activeConnections: number;
  players: Array<{ id: string; name: string; connectedAt: number; messageCount: number }>;
} | null> {
  try {
    // Use the Durable Object debug endpoint which has real-time connection data
    const response = await fetch(`${BASE_URL}/api/debug/durable-object/${SESSION_ID}`);
    if (!response.ok) return null;
    const data = await response.json() as {
      connectedPlayers: number;
      players: Array<{ id: string; name: string; connectedAt: number; messageCount: number }>;
    };
    return {
      activeConnections: data.connectedPlayers,
      players: data.players,
    };
  } catch {
    return null;
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function detectConnectionStorm(): boolean {
  const recentHistory = connectionCountHistory.slice(-5);
  if (recentHistory.length < 5) return false;
  let changes = 0;
  for (let i = 1; i < recentHistory.length; i++) {
    if (Math.abs(recentHistory[i] - recentHistory[i-1]) > 0) {
      changes++;
    }
  }
  return changes >= 3;
}

async function pollConnections(): Promise<void> {
  const debug = await fetchDebugInfo();
  const now = Date.now();
  const elapsed = now - stats.startTime;

  if (!debug) {
    console.log(`[${formatElapsed(elapsed)}] ⚠️  Failed to fetch debug info`);
    return;
  }

  const currentPlayerIds = new Set(debug.players.map(p => p.id));

  const snapshot: ConnectionSnapshot = {
    timestamp: now,
    elapsed,
    activeConnections: debug.activeConnections,
    playerIds: Array.from(currentPlayerIds),
    players: debug.players,
  };
  stats.snapshots.push(snapshot);
  connectionCountHistory.push(debug.activeConnections);

  stats.peakConnections = Math.max(stats.peakConnections, debug.activeConnections);
  if (debug.activeConnections > 0) {
    stats.minConnections = Math.min(stats.minConnections, debug.activeConnections);
  }

  for (const player of debug.players) {
    if (!previousPlayerIds.has(player.id)) {
      const connectionTime = now - player.connectedAt;
      stats.connectionTimes.push(connectionTime);

      stats.events.push({
        timestamp: now,
        elapsed,
        type: 'connect',
        playerId: player.id,
        playerName: player.name,
        details: `Connection established in ~${connectionTime}ms`,
      });

      console.log(`[${formatElapsed(elapsed)}] 🟢 CONNECT: ${player.name} (${player.id.slice(0, 8)}...) - ${connectionTime}ms`);
    }
  }

  for (const prevId of previousPlayerIds) {
    if (!currentPlayerIds.has(prevId)) {
      stats.connectionDrops++;
      stats.events.push({
        timestamp: now,
        elapsed,
        type: 'disconnect',
        playerId: prevId,
      });

      console.log(`[${formatElapsed(elapsed)}] 🔴 DISCONNECT: ${prevId.slice(0, 8)}...`);
    }
  }

  if (detectConnectionStorm()) {
    stats.stormWarnings++;
    stats.events.push({
      timestamp: now,
      elapsed,
      type: 'storm_warning',
      details: `Rapid connection changes detected! History: ${connectionCountHistory.slice(-5).join(' -> ')}`,
    });

    console.log(`[${formatElapsed(elapsed)}] 🚨 STORM WARNING: Rapid connection changes detected!`);
  }

  if (Math.floor(elapsed / 30000) > Math.floor((elapsed - POLL_INTERVAL_MS) / 30000)) {
    console.log(`[${formatElapsed(elapsed)}] 📊 Status: ${debug.activeConnections} connections, ${stats.connectionDrops} drops, ${stats.stormWarnings} warnings`);
  }

  previousPlayerIds = currentPlayerIds;
}

function generateReport(): void {
  const duration = Date.now() - stats.startTime;
  const avgConnTime = stats.connectionTimes.length > 0
    ? stats.connectionTimes.reduce((a, b) => a + b, 0) / stats.connectionTimes.length
    : 0;

  console.log('\n' + '='.repeat(60));
  console.log('CONNECTION HEALTH REPORT');
  console.log('='.repeat(60));
  console.log(`Session: ${SESSION_ID}`);
  console.log(`Duration: ${formatElapsed(duration)} (${Math.round(duration / 60000)} minutes)`);
  console.log(`Samples: ${stats.snapshots.length}`);
  console.log('');

  console.log('📈 CONNECTION METRICS');
  console.log('-'.repeat(40));
  console.log(`Peak connections:     ${stats.peakConnections}`);
  console.log(`Min connections:      ${stats.minConnections === Infinity ? 0 : stats.minConnections}`);
  console.log(`Total connects:       ${stats.events.filter(e => e.type === 'connect').length}`);
  console.log(`Total disconnects:    ${stats.connectionDrops}`);
  console.log(`Storm warnings:       ${stats.stormWarnings}`);
  console.log('');

  console.log('⏱️  CONNECTION LATENCY');
  console.log('-'.repeat(40));
  if (stats.connectionTimes.length > 0) {
    const sorted = [...stats.connectionTimes].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    console.log(`Avg connection time:  ${Math.round(avgConnTime)}ms`);
    console.log(`P50 connection time:  ${p50}ms`);
    console.log(`P95 connection time:  ${p95}ms`);
    console.log(`P99 connection time:  ${p99}ms`);
    console.log(`Min connection time:  ${sorted[0]}ms`);
    console.log(`Max connection time:  ${sorted[sorted.length - 1]}ms`);
  } else {
    console.log('No connection time data (no new connections observed)');
  }
  console.log('');

  console.log('🔍 HEALTH ASSESSMENT');
  console.log('-'.repeat(40));

  const issues: string[] = [];

  if (stats.stormWarnings > 0) {
    issues.push(`❌ ${stats.stormWarnings} connection storm warning(s) detected`);
  }

  if (stats.connectionDrops > stats.events.filter(e => e.type === 'connect').length) {
    issues.push(`⚠️  More disconnects than connects (unstable connections)`);
  }

  if (avgConnTime > 1000) {
    issues.push(`⚠️  Average connection time is high (${Math.round(avgConnTime)}ms > 1000ms)`);
  }

  if (stats.peakConnections > 0 && stats.minConnections === 0) {
    issues.push(`⚠️  Connections dropped to zero during monitoring`);
  }

  if (issues.length === 0) {
    console.log('✅ All health checks passed!');
    console.log('   - No connection storms detected');
    console.log('   - Connection latency is acceptable');
    console.log('   - Connections are stable');
  } else {
    for (const issue of issues) {
      console.log(issue);
    }
  }

  console.log('');
  console.log('📝 EVENT LOG (last 20 events)');
  console.log('-'.repeat(40));
  const recentEvents = stats.events.slice(-20);
  if (recentEvents.length === 0) {
    console.log('No events recorded');
  } else {
    for (const event of recentEvents) {
      const icon = event.type === 'connect' ? '🟢' : event.type === 'disconnect' ? '🔴' : '🚨';
      console.log(`[${formatElapsed(event.elapsed)}] ${icon} ${event.type.toUpperCase()}${event.playerName ? ` ${event.playerName}` : ''}${event.details ? ` - ${event.details}` : ''}`);
    }
  }

  console.log('\n' + '='.repeat(60));
}

async function main(): Promise<void> {
  console.log('🔍 Connection Health Monitor');
  console.log('='.repeat(60));
  console.log(`Session ID:    ${SESSION_ID}`);
  console.log(`Duration:      ${DURATION_MINUTES} minutes`);
  console.log(`Base URL:      ${BASE_URL}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log('');
  console.log('To open browsers, run in separate terminals:');
  console.log(`  open "${BASE_URL.replace(':8787', ':5173')}/s/${SESSION_ID}"`);
  console.log('');
  console.log('Starting monitoring...');
  console.log('-'.repeat(60));

  const endTime = stats.startTime + (DURATION_MINUTES * 60 * 1000);

  await pollConnections();

  while (Date.now() < endTime) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    await pollConnections();
  }

  generateReport();

  if (stats.stormWarnings > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Monitor failed:', err);
  process.exit(1);
});
