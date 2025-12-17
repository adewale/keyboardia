#!/usr/bin/env npx tsx
/**
 * Debug tool for exploring Keyboardia metrics
 *
 * Usage:
 *   npx tsx scripts/debug-metrics.ts
 *   npx tsx scripts/debug-metrics.ts --logs
 *   npx tsx scripts/debug-metrics.ts --recent-sessions
 */

const API_BASE = process.env.API_BASE || 'https://keyboardia.adewale-883.workers.dev';

interface Metrics {
  totalSessions: number;
  sessionsCreatedToday: number;
  timestamp: string;
}

interface LogEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status: number;
  duration: number;
  sessionId?: string;
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

async function printMetrics() {
  console.log('\n' + '='.repeat(60));
  console.log('KEYBOARDIA METRICS');
  console.log('='.repeat(60));

  const metrics = await fetchJson<Metrics>(`${API_BASE}/api/metrics`);
  if (!metrics) {
    console.log('\n❌ Metrics not available');
    return;
  }

  console.log('\n📊 Overview:');
  console.log(`  Total Sessions:  ${metrics.totalSessions}`);
  console.log(`  Created Today:   ${metrics.sessionsCreatedToday}`);
  console.log(`  Timestamp:       ${formatTimestamp(metrics.timestamp)}`);
}

async function printLogs(count: number = 50) {
  console.log('\n📝 Recent API Logs:');

  const logsData = await fetchJson<{ logs: LogEntry[] }>(`${API_BASE}/api/debug/logs?last=${count}`);
  if (!logsData || logsData.logs.length === 0) {
    console.log('  (no recent logs)');
    return;
  }

  // Group by path for summary
  const pathCounts: Record<string, number> = {};
  const errorPaths: Record<string, number> = {};

  for (const log of logsData.logs) {
    pathCounts[log.path] = (pathCounts[log.path] || 0) + 1;
    if (log.status >= 400) {
      errorPaths[log.path] = (errorPaths[log.path] || 0) + 1;
    }
  }

  console.log('\n  Request Distribution:');
  for (const [path, count] of Object.entries(pathCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const errors = errorPaths[path] || 0;
    const errorStr = errors > 0 ? ` (${errors} errors)` : '';
    console.log(`    ${count.toString().padStart(4)}x  ${path}${errorStr}`);
  }

  console.log('\n  Recent Requests:');
  for (const log of logsData.logs.slice(-15)) {
    const time = new Date(log.timestamp).toISOString().slice(11, 19);
    const status = log.status >= 400 ? `❌${log.status}` : `✓${log.status}`;
    const duration = `${log.duration}ms`.padStart(6);
    console.log(`    [${time}] ${log.method.padEnd(6)} ${status} ${duration}  ${log.path}`);
  }
}

async function printRecentSessions() {
  console.log('\n🗂️  Recent Session Activity:');

  // Fetch logs and extract session IDs
  const logsData = await fetchJson<{ logs: LogEntry[] }>(`${API_BASE}/api/debug/logs?last=100`);
  if (!logsData || logsData.logs.length === 0) {
    console.log('  (no recent activity)');
    return;
  }

  // Extract unique session IDs from paths
  const sessionPattern = /\/sessions\/([a-f0-9-]{36})/;
  const sessionIds = new Set<string>();

  for (const log of logsData.logs) {
    const match = log.path.match(sessionPattern);
    if (match) {
      sessionIds.add(match[1]);
    }
  }

  console.log(`  Found ${sessionIds.size} unique sessions in recent logs:\n`);

  for (const sessionId of Array.from(sessionIds).slice(0, 10)) {
    const session = await fetchJson<{
      id: string;
      state: { tracks: unknown[] };
      updatedAt: number;
    }>(`${API_BASE}/api/sessions/${sessionId}`);

    if (session) {
      const trackCount = session.state.tracks.length;
      const trackStatus = trackCount === 0 ? '⚠️  0 tracks' : `✓ ${trackCount} tracks`;
      const updated = formatTimestamp(session.updatedAt).slice(11, 19);
      console.log(`    ${sessionId.slice(0, 8)}... ${trackStatus.padEnd(12)} (updated ${updated})`);
    } else {
      console.log(`    ${sessionId.slice(0, 8)}... ❌ not found`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const showLogs = args.includes('--logs') || args.includes('--all');
  const showRecent = args.includes('--recent-sessions') || args.includes('--all');

  await printMetrics();

  if (showLogs) {
    await printLogs();
  }

  if (showRecent) {
    await printRecentSessions();
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main().catch(console.error);
