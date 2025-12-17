#!/usr/bin/env npx tsx
/**
 * Debug tool for exploring Keyboardia session state
 *
 * Usage:
 *   npx tsx scripts/debug-session.ts <session-id>
 *   npx tsx scripts/debug-session.ts <session-id> --full
 *   npx tsx scripts/debug-session.ts <session-id> --ws-logs
 *   npx tsx scripts/debug-session.ts <session-id> --connections
 */

const API_BASE = process.env.API_BASE || 'https://keyboardia.adewale-883.workers.dev';

interface SessionState {
  tracks: Array<{
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    stepCount?: number;
  }>;
  tempo: number;
  swing: number;
  version: number;
}

interface Session {
  id: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  remixedFrom: string | null;
  remixCount: number;
  immutable: boolean;
  state: SessionState;
}

interface DebugSession {
  id: string;
  exists: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  state: {
    trackCount: number;
    tempo: number;
    swing: number;
    version: number;
    tracks: SessionState['tracks'];
  };
  sizeBytes: number;
}

interface DODebug {
  sessionId: string;
  connectedPlayers: number;
  players: Array<{
    id: string;
    name: string;
    color: string;
    connectedAt: number;
    messageCount: number;
  }>;
  playingPlayerIds: string[];
  trackCount: number;
  tempo: number;
  swing: number;
  pendingKVSave: boolean;
  invariants: {
    valid: boolean;
    violations: string[];
    warnings: string[];
  };
}

interface WSLog {
  id: string;
  timestamp: number;
  type: string;
  playerId?: string;
  message?: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    return await response.json() as T;
  } catch (error) {
    console.error(`Fetch error: ${error}`);
    return null;
  }
}

function formatTimestamp(ts: number | string): string {
  const date = new Date(typeof ts === 'string' ? ts : ts);
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s ago`;
  return `${seconds}s ago`;
}

async function getSession(sessionId: string): Promise<Session | null> {
  return fetchJson<Session>(`${API_BASE}/api/sessions/${sessionId}`);
}

async function getDebugSession(sessionId: string): Promise<DebugSession | null> {
  return fetchJson<DebugSession>(`${API_BASE}/api/debug/session/${sessionId}`);
}

async function _getDODebug(sessionId: string): Promise<DODebug | null> {
  return fetchJson<DODebug>(`${API_BASE}/api/sessions/${sessionId}/ws/debug`);
}

async function getWSLogs(sessionId: string): Promise<{ logs: WSLog[] } | null> {
  return fetchJson<{ logs: WSLog[] }>(`${API_BASE}/api/debug/session/${sessionId}/ws-logs`);
}

async function getConnections(sessionId: string): Promise<{
  activeConnections: number;
  players: Array<{ id: string; name: string; color: string }>;
  messageRate: string;
} | null> {
  return fetchJson(`${API_BASE}/api/debug/session/${sessionId}/connections`);
}

async function printSessionSummary(sessionId: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`SESSION: ${sessionId}`);
  console.log('='.repeat(60));

  // Get session from KV
  const session = await getSession(sessionId);
  if (!session) {
    console.log('\n❌ Session not found in KV');
    return;
  }

  const now = Date.now();
  console.log('\n📋 KV Storage:');
  console.log(`  Created:    ${formatTimestamp(session.createdAt)} (${formatDuration(now - session.createdAt)})`);
  console.log(`  Updated:    ${formatTimestamp(session.updatedAt)} (${formatDuration(now - session.updatedAt)})`);
  console.log(`  Accessed:   ${formatTimestamp(session.lastAccessedAt)} (${formatDuration(now - session.lastAccessedAt)})`);
  console.log(`  Name:       ${session.name || '(unnamed)'}`);
  console.log(`  Immutable:  ${session.immutable}`);
  console.log(`  Remixed:    ${session.remixCount} times`);

  console.log('\n🎵 State:');
  console.log(`  Tracks:     ${session.state.tracks.length}`);
  console.log(`  Tempo:      ${session.state.tempo} BPM`);
  console.log(`  Swing:      ${session.state.swing}%`);
  console.log(`  Version:    ${session.state.version}`);

  if (session.state.tracks.length > 0) {
    console.log('\n  Tracks:');
    for (const track of session.state.tracks) {
      const activeSteps = track.steps.filter(Boolean).length;
      const totalSteps = track.stepCount || track.steps.length;
      console.log(`    - ${track.name} (${track.sampleId}): ${activeSteps}/${totalSteps} steps active`);
    }
  }
}

async function printDebugSession(sessionId: string) {
  const debug = await getDebugSession(sessionId);
  if (!debug) {
    console.log('\n❌ Debug endpoint not available');
    return;
  }

  console.log('\n🔍 Debug Info:');
  console.log(`  Exists:     ${debug.exists}`);
  console.log(`  Size:       ${debug.sizeBytes} bytes`);
}

async function printConnections(sessionId: string) {
  const conn = await getConnections(sessionId);

  console.log('\n🔌 WebSocket Connections:');
  if (!conn) {
    console.log('  (not available)');
    return;
  }

  console.log(`  Active:     ${conn.activeConnections}`);
  console.log(`  Msg Rate:   ${conn.messageRate}`);

  if (conn.players.length > 0) {
    console.log('  Players:');
    for (const player of conn.players) {
      console.log(`    - ${player.name} (${player.id.slice(0, 8)}...)`);
    }
  }
}

async function printWSLogs(sessionId: string) {
  const logsData = await getWSLogs(sessionId);

  console.log('\n📝 WebSocket Logs:');
  if (!logsData || logsData.logs.length === 0) {
    console.log('  (no recent logs)');
    return;
  }

  for (const log of logsData.logs.slice(-20)) {
    const time = formatTimestamp(log.timestamp);
    console.log(`  [${time}] ${log.type} ${log.playerId ? `(${log.playerId.slice(0, 8)})` : ''} ${log.message || ''}`);
  }
}

async function printFullTrackData(sessionId: string) {
  const session = await getSession(sessionId);
  if (!session) return;

  console.log('\n📊 Full Track Data:');
  console.log(JSON.stringify(session.state.tracks, null, 2));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/debug-session.ts <session-id> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --full        Show full track data as JSON');
    console.log('  --ws-logs     Show WebSocket logs');
    console.log('  --connections Show active WebSocket connections');
    console.log('  --all         Show everything');
    console.log('');
    console.log('Environment:');
    console.log('  API_BASE      Base URL (default: https://keyboardia.adewale-883.workers.dev)');
    process.exit(1);
  }

  const sessionId = args[0];
  const showFull = args.includes('--full') || args.includes('--all');
  const showWSLogs = args.includes('--ws-logs') || args.includes('--all');
  const showConnections = args.includes('--connections') || args.includes('--all');

  await printSessionSummary(sessionId);
  await printDebugSession(sessionId);

  if (showConnections) {
    await printConnections(sessionId);
  }

  if (showWSLogs) {
    await printWSLogs(sessionId);
  }

  if (showFull) {
    await printFullTrackData(sessionId);
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main().catch(console.error);
