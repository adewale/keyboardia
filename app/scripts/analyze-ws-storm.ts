#!/usr/bin/env npx tsx
/**
 * WebSocket Connection Storm Analyzer
 *
 * Monitors wrangler tail output and analyzes connection patterns
 * to detect and diagnose reconnection storms.
 *
 * Usage:
 *   # Run live analysis (pipe wrangler tail into this)
 *   npx wrangler tail keyboardia --format json | npx tsx scripts/analyze-ws-storm.ts
 *
 *   # Or analyze from a file
 *   npx tsx scripts/analyze-ws-storm.ts --file /path/to/logs.json
 */

import * as readline from 'readline';
import * as fs from 'fs';

interface WranglerLog {
  wallTime: number;
  cpuTime: number;
  outcome: string;
  durableObjectId?: string;
  logs?: Array<{ message: string[]; level: string; timestamp: number }>;
  eventTimestamp: number;
  event?: {
    request?: { url: string; method: string };
    getWebSocketEvent?: { wasClean: boolean; code: number; webSocketEventType: string };
  };
}

interface ConnectionEvent {
  timestamp: number;
  sessionId: string;
  playerId: string;
  type: 'connect' | 'disconnect' | 'upgrade';
  tracks?: number;
  code?: number;
  reason?: string;
  outcome: string;
}

interface SessionStats {
  sessionId: string;
  connections: number;
  disconnections: number;
  upgrades: number;
  uniquePlayers: Set<string>;
  events: ConnectionEvent[];
  firstEvent: number;
  lastEvent: number;
  stormDetected: boolean;
  avgConnectionInterval: number;
}

const sessionStats = new Map<string, SessionStats>();

function parseWsLogMessage(message: string): Partial<ConnectionEvent> | null {
  // Parse [WS] connect session=xxx player=xxx total=xxx
  const connectMatch = message.match(/\[WS\] connect session=([^ ]+) player=([^ ]+) total=(\d+)/);
  if (connectMatch) {
    return {
      type: 'connect',
      sessionId: connectMatch[1],
      playerId: connectMatch[2],
    };
  }

  // Parse [WS] disconnect session=xxx player=xxx reason=xxx code=xxx
  const disconnectMatch = message.match(/\[WS\] disconnect session=([^ ]+) player=([^ ]+) reason=([^ ]+) code=(\d+)/);
  if (disconnectMatch) {
    return {
      type: 'disconnect',
      sessionId: disconnectMatch[1],
      playerId: disconnectMatch[2],
      reason: disconnectMatch[3],
      code: parseInt(disconnectMatch[4]),
    };
  }

  // Parse [ASSERT] snapshot SENT (initial connect): to=xxx, tracks=xxx
  const snapshotMatch = message.match(/\[ASSERT\] snapshot SENT.*to=([^,]+), tracks=(\d+)/);
  if (snapshotMatch) {
    return {
      playerId: snapshotMatch[1],
      tracks: parseInt(snapshotMatch[2]),
    };
  }

  // Parse [GET] /api/sessions/xxx/ws -> 101
  const upgradeMatch = message.match(/\[GET\] \/api\/sessions\/([^/]+)\/ws -> 101/);
  if (upgradeMatch) {
    return {
      type: 'upgrade',
      sessionId: upgradeMatch[1],
    };
  }

  return null;
}

function processLogEntry(entry: WranglerLog): void {
  const timestamp = entry.eventTimestamp;
  const outcome = entry.outcome;

  // Process log messages
  for (const log of entry.logs || []) {
    const message = log.message.join(' ');
    const parsed = parseWsLogMessage(message);

    if (parsed && parsed.sessionId) {
      const event: ConnectionEvent = {
        timestamp: log.timestamp || timestamp,
        sessionId: parsed.sessionId,
        playerId: parsed.playerId || 'unknown',
        type: parsed.type || 'connect',
        tracks: parsed.tracks,
        code: parsed.code,
        reason: parsed.reason,
        outcome,
      };

      recordEvent(event);
    }
  }

  // Check for WebSocket close events
  if (entry.event?.getWebSocketEvent) {
    const wsEvent = entry.event.getWebSocketEvent;
    if (wsEvent.webSocketEventType === 'close') {
      // This is a DO-level close event, might not have session context
      // Log for analysis
      if (wsEvent.code !== 1000) {
        console.error(`[ABNORMAL CLOSE] code=${wsEvent.code} clean=${wsEvent.wasClean} outcome=${outcome}`);
      }
    }
  }
}

function recordEvent(event: ConnectionEvent): void {
  let stats = sessionStats.get(event.sessionId);

  if (!stats) {
    stats = {
      sessionId: event.sessionId,
      connections: 0,
      disconnections: 0,
      upgrades: 0,
      uniquePlayers: new Set(),
      events: [],
      firstEvent: event.timestamp,
      lastEvent: event.timestamp,
      stormDetected: false,
      avgConnectionInterval: 0,
    };
    sessionStats.set(event.sessionId, stats);
  }

  stats.events.push(event);
  stats.lastEvent = Math.max(stats.lastEvent, event.timestamp);
  stats.firstEvent = Math.min(stats.firstEvent, event.timestamp);

  if (event.playerId) {
    stats.uniquePlayers.add(event.playerId);
  }

  switch (event.type) {
    case 'connect':
      stats.connections++;
      break;
    case 'disconnect':
      stats.disconnections++;
      break;
    case 'upgrade':
      stats.upgrades++;
      break;
  }

  // Detect storm: more than 5 connections in 10 seconds
  const recentConnections = stats.events.filter(
    e => e.type === 'connect' && e.timestamp > event.timestamp - 10000
  );
  if (recentConnections.length > 5) {
    if (!stats.stormDetected) {
      console.error(`\n⚠️  STORM DETECTED: Session ${event.sessionId}`);
      console.error(`   ${recentConnections.length} connections in last 10 seconds`);
      stats.stormDetected = true;
    }
  }

  // Calculate average interval between connections
  const connectionEvents = stats.events.filter(e => e.type === 'connect');
  if (connectionEvents.length > 1) {
    let totalInterval = 0;
    for (let i = 1; i < connectionEvents.length; i++) {
      totalInterval += connectionEvents[i].timestamp - connectionEvents[i - 1].timestamp;
    }
    stats.avgConnectionInterval = totalInterval / (connectionEvents.length - 1);
  }
}

function printSummary(): void {
  console.log('\n' + '='.repeat(80));
  console.log('WEBSOCKET CONNECTION ANALYSIS SUMMARY');
  console.log('='.repeat(80));

  for (const [sessionId, stats] of sessionStats) {
    const duration = (stats.lastEvent - stats.firstEvent) / 1000;
    const shortId = sessionId.length > 20 ? sessionId.slice(0, 8) + '...' : sessionId;

    console.log(`\n📊 Session: ${shortId}`);
    console.log(`   Duration: ${duration.toFixed(1)}s`);
    console.log(`   Connections: ${stats.connections}`);
    console.log(`   Disconnections: ${stats.disconnections}`);
    console.log(`   Unique Players: ${stats.uniquePlayers.size}`);
    console.log(`   Avg Interval: ${stats.avgConnectionInterval.toFixed(0)}ms`);

    if (stats.stormDetected) {
      console.log(`   ⚠️  STORM: Yes (${(stats.connections / duration).toFixed(1)} conn/sec)`);
    }

    // Check for patterns
    const abnormalCloses = stats.events.filter(e => e.code && e.code !== 1000);
    if (abnormalCloses.length > 0) {
      console.log(`   ⚠️  Abnormal closes: ${abnormalCloses.length}`);
      const codes = new Map<number, number>();
      for (const e of abnormalCloses) {
        codes.set(e.code!, (codes.get(e.code!) || 0) + 1);
      }
      for (const [code, count] of codes) {
        console.log(`      - Code ${code}: ${count}x`);
      }
    }

    // Show track distribution if available
    const tracksEvents = stats.events.filter(e => e.tracks !== undefined);
    if (tracksEvents.length > 0) {
      const trackCounts = new Map<number, number>();
      for (const e of tracksEvents) {
        trackCounts.set(e.tracks!, (trackCounts.get(e.tracks!) || 0) + 1);
      }
      console.log(`   Snapshots sent:`);
      for (const [tracks, count] of trackCounts) {
        console.log(`      - ${tracks} tracks: ${count}x`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
}

function printReconnectionPattern(): void {
  for (const [sessionId, stats] of sessionStats) {
    if (!stats.stormDetected) continue;

    console.log(`\n📈 Reconnection Pattern for ${sessionId.slice(0, 8)}...:`);

    // Group connections by second
    const bySecond = new Map<number, number>();
    for (const e of stats.events.filter(e => e.type === 'connect')) {
      const second = Math.floor(e.timestamp / 1000);
      bySecond.set(second, (bySecond.get(second) || 0) + 1);
    }

    const minSecond = Math.min(...bySecond.keys());
    for (const [second, count] of [...bySecond].sort((a, b) => a[0] - b[0])) {
      const relSecond = second - minSecond;
      const bar = '█'.repeat(Math.min(count, 50));
      console.log(`   +${relSecond.toString().padStart(3)}s: ${bar} (${count})`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('WebSocket Storm Analyzer');
    console.log('');
    console.log('Usage:');
    console.log('  npx wrangler tail keyboardia --format json | npx tsx scripts/analyze-ws-storm.ts');
    console.log('  npx tsx scripts/analyze-ws-storm.ts --file logs.json');
    console.log('');
    console.log('Options:');
    console.log('  --file <path>   Analyze from a JSON file instead of stdin');
    console.log('  --help          Show this help');
    process.exit(0);
  }

  const fileIndex = args.indexOf('--file');
  if (fileIndex !== -1 && args[fileIndex + 1]) {
    // Read from file
    const filePath = args[fileIndex + 1];
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as WranglerLog;
        processLogEntry(entry);
      } catch {
        // Skip invalid lines
      }
    }
    printSummary();
    printReconnectionPattern();
    return;
  }

  // Read from stdin (live wrangler tail)
  console.log('📡 Analyzing WebSocket connections from stdin...');
  console.log('   (Pipe wrangler tail output here, Ctrl+C to stop and see summary)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const entry = JSON.parse(line) as WranglerLog;
      processLogEntry(entry);
    } catch {
      // Not JSON, might be wrangler startup message
      if (line.includes('Connected to')) {
        console.log('✓ ' + line);
      }
    }
  });

  rl.on('close', () => {
    printSummary();
    printReconnectionPattern();
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    rl.close();
  });
}

main().catch(console.error);
