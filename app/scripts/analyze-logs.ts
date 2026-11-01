#!/usr/bin/env npx tsx
/**
 * Log Analysis Tool
 *
 * Analyzes exported logs from the browser's IndexedDB log store.
 * Export logs from browser using: await __exportLogsToFile__()
 *
 * Usage:
 *   npx tsx scripts/analyze-logs.ts <log-file.json>
 *   npx tsx scripts/analyze-logs.ts <log-file.json> --errors
 *   npx tsx scripts/analyze-logs.ts <log-file.json> --category audio
 *   npx tsx scripts/analyze-logs.ts <log-file.json> --search "AudioContext"
 *   npx tsx scripts/analyze-logs.ts <log-file.json> --timeline
 *   npx tsx scripts/analyze-logs.ts <log-file.json> --sessions
 */

import * as fs from 'fs';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

interface StoredLog {
  id: number;
  timestamp: number;
  level: 'debug' | 'log' | 'warn' | 'error';
  category: string;
  message: string;
  data?: Record<string, unknown>;
  sessionId: string;
  url: string;
  stack?: string;
}

interface LogExport {
  exportedAt: string;
  currentSessionId: string;
  stats: {
    totalLogs: number;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    oldestLog: number | null;
    newestLog: number | null;
    sessions: string[];
  };
  logs: StoredLog[];
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
  return `${(ms / 3600000).toFixed(1)}hr`;
}

function levelColor(level: string): string {
  switch (level) {
    case 'error': return c.red;
    case 'warn': return c.yellow;
    case 'debug': return c.gray;
    default: return c.reset;
  }
}

function printLog(log: StoredLog, showData: boolean = false): void {
  const time = formatTimestamp(log.timestamp);
  const color = levelColor(log.level);
  const level = log.level.toUpperCase().padEnd(5);

  console.log(
    `${c.gray}${time}${c.reset} ${color}${level}${c.reset} ` +
    `${c.cyan}[${log.category}]${c.reset} ${log.message}`
  );

  if (showData && log.data && Object.keys(log.data).length > 0) {
    console.log(`  ${c.dim}${JSON.stringify(log.data)}${c.reset}`);
  }

  if (log.stack && log.level === 'error') {
    const stackLines = log.stack.split('\n').slice(1, 4);
    for (const line of stackLines) {
      console.log(`  ${c.gray}${line.trim()}${c.reset}`);
    }
  }
}

function printSummary(data: LogExport): void {
  const { stats } = data;

  console.log(`\n${c.bright}${c.cyan}Log Analysis Summary${c.reset}`);
  console.log(`${c.gray}${'─'.repeat(50)}${c.reset}`);
  console.log(`Exported: ${data.exportedAt}`);
  console.log(`Total logs: ${stats.totalLogs}`);

  if (stats.oldestLog && stats.newestLog) {
    const duration = stats.newestLog - stats.oldestLog;
    console.log(`Time span: ${formatDuration(duration)}`);
    console.log(`  From: ${formatTimestamp(stats.oldestLog)}`);
    console.log(`  To:   ${formatTimestamp(stats.newestLog)}`);
  }

  console.log(`\n${c.bright}By Level:${c.reset}`);
  for (const [level, count] of Object.entries(stats.byLevel)) {
    const color = levelColor(level);
    const bar = '█'.repeat(Math.min(50, Math.ceil(count / stats.totalLogs * 50)));
    console.log(`  ${color}${level.padEnd(6)}${c.reset} ${count.toString().padStart(6)} ${c.dim}${bar}${c.reset}`);
  }

  console.log(`\n${c.bright}By Category:${c.reset}`);
  const sortedCategories = Object.entries(stats.byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  for (const [category, count] of sortedCategories) {
    console.log(`  ${c.cyan}${category.padEnd(15)}${c.reset} ${count}`);
  }

  console.log(`\n${c.bright}Sessions:${c.reset} ${stats.sessions.length}`);
  for (const session of stats.sessions.slice(0, 5)) {
    const sessionLogs = data.logs.filter(l => l.sessionId === session);
    const errors = sessionLogs.filter(l => l.level === 'error').length;
    const errorIndicator = errors > 0 ? ` ${c.red}(${errors} errors)${c.reset}` : '';
    console.log(`  ${session} - ${sessionLogs.length} logs${errorIndicator}`);
  }
  if (stats.sessions.length > 5) {
    console.log(`  ${c.dim}... and ${stats.sessions.length - 5} more${c.reset}`);
  }
}

function showErrors(data: LogExport): void {
  const errors = data.logs.filter(l => l.level === 'error');

  console.log(`\n${c.bright}${c.red}Errors (${errors.length})${c.reset}`);
  console.log(`${c.gray}${'─'.repeat(50)}${c.reset}`);

  if (errors.length === 0) {
    console.log(`${c.green}No errors found!${c.reset}`);
    return;
  }

  // Group by message
  const grouped = new Map<string, StoredLog[]>();
  for (const error of errors) {
    const key = error.message.slice(0, 100);
    const existing = grouped.get(key) || [];
    existing.push(error);
    grouped.set(key, existing);
  }

  for (const [message, logs] of grouped) {
    console.log(`\n${c.red}${message}${c.reset}`);
    console.log(`  ${c.dim}Occurrences: ${logs.length}${c.reset}`);
    console.log(`  ${c.dim}First: ${formatTimestamp(logs[0].timestamp)}${c.reset}`);
    console.log(`  ${c.dim}Last:  ${formatTimestamp(logs[logs.length - 1].timestamp)}${c.reset}`);
    if (logs[0].stack) {
      const stackLines = logs[0].stack.split('\n').slice(1, 3);
      for (const line of stackLines) {
        console.log(`  ${c.gray}${line.trim()}${c.reset}`);
      }
    }
  }
}

function showCategory(data: LogExport, category: string): void {
  const logs = data.logs.filter(l =>
    l.category.toLowerCase().includes(category.toLowerCase())
  );

  console.log(`\n${c.bright}Category: ${category} (${logs.length} logs)${c.reset}`);
  console.log(`${c.gray}${'─'.repeat(50)}${c.reset}`);

  for (const log of logs.slice(-100)) {
    printLog(log);
  }

  if (logs.length > 100) {
    console.log(`${c.dim}... showing last 100 of ${logs.length} logs${c.reset}`);
  }
}

function searchLogs(data: LogExport, search: string): void {
  const searchLower = search.toLowerCase();
  const logs = data.logs.filter(l =>
    l.message.toLowerCase().includes(searchLower) ||
    l.category.toLowerCase().includes(searchLower) ||
    JSON.stringify(l.data || {}).toLowerCase().includes(searchLower)
  );

  console.log(`\n${c.bright}Search: "${search}" (${logs.length} matches)${c.reset}`);
  console.log(`${c.gray}${'─'.repeat(50)}${c.reset}`);

  for (const log of logs.slice(-50)) {
    printLog(log, true);
  }

  if (logs.length > 50) {
    console.log(`${c.dim}... showing last 50 of ${logs.length} matches${c.reset}`);
  }
}

function showTimeline(data: LogExport): void {
  console.log(`\n${c.bright}Timeline${c.reset}`);
  console.log(`${c.gray}${'─'.repeat(50)}${c.reset}`);

  // Group by minute
  const byMinute = new Map<string, { logs: number; errors: number; warns: number }>();

  for (const log of data.logs) {
    const minute = new Date(log.timestamp).toISOString().slice(0, 16);
    const existing = byMinute.get(minute) || { logs: 0, errors: 0, warns: 0 };
    existing.logs++;
    if (log.level === 'error') existing.errors++;
    if (log.level === 'warn') existing.warns++;
    byMinute.set(minute, existing);
  }

  for (const [minute, counts] of byMinute) {
    const errorIndicator = counts.errors > 0 ? `${c.red} ●${counts.errors}${c.reset}` : '';
    const warnIndicator = counts.warns > 0 ? `${c.yellow} ▲${counts.warns}${c.reset}` : '';
    const bar = '░'.repeat(Math.min(40, counts.logs));
    console.log(`${minute} ${bar} ${counts.logs}${errorIndicator}${warnIndicator}`);
  }
}

function showSessions(data: LogExport): void {
  console.log(`\n${c.bright}Sessions${c.reset}`);
  console.log(`${c.gray}${'─'.repeat(50)}${c.reset}`);

  for (const sessionId of data.stats.sessions) {
    const sessionLogs = data.logs.filter(l => l.sessionId === sessionId);
    const errors = sessionLogs.filter(l => l.level === 'error');
    const warns = sessionLogs.filter(l => l.level === 'warn');

    const firstLog = sessionLogs[0];
    const lastLog = sessionLogs[sessionLogs.length - 1];
    const duration = lastLog.timestamp - firstLog.timestamp;

    console.log(`\n${c.cyan}Session: ${sessionId}${c.reset}`);
    console.log(`  Duration: ${formatDuration(duration)}`);
    console.log(`  Logs: ${sessionLogs.length}`);
    console.log(`  Errors: ${errors.length > 0 ? c.red : ''}${errors.length}${c.reset}`);
    console.log(`  Warnings: ${warns.length > 0 ? c.yellow : ''}${warns.length}${c.reset}`);
    console.log(`  URL: ${firstLog.url}`);

    if (errors.length > 0) {
      console.log(`  ${c.red}First error:${c.reset}`);
      printLog(errors[0]);
    }
  }
}

function printHelp(): void {
  console.log(`
${c.bright}Log Analysis Tool${c.reset}

Analyzes exported logs from the browser's IndexedDB log store.

${c.bright}Usage:${c.reset}
  npx tsx scripts/analyze-logs.ts <log-file.json> [options]

${c.bright}Options:${c.reset}
  --errors           Show only errors, grouped by message
  --category <name>  Filter by category (e.g., --category audio)
  --search <text>    Search logs for text
  --timeline         Show activity timeline by minute
  --sessions         Show breakdown by session
  --help             Show this help

${c.bright}Export logs from browser:${c.reset}
  await __exportLogsToFile__()

${c.bright}Examples:${c.reset}
  npx tsx scripts/analyze-logs.ts keyboardia-logs-2025-12-16.json
  npx tsx scripts/analyze-logs.ts logs.json --errors
  npx tsx scripts/analyze-logs.ts logs.json --category Audio
  npx tsx scripts/analyze-logs.ts logs.json --search "AudioContext mismatch"
  npx tsx scripts/analyze-logs.ts logs.json --timeline
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const filePath = args[0];

  if (!fs.existsSync(filePath)) {
    console.error(`${c.red}Error: File not found: ${filePath}${c.reset}`);
    process.exit(1);
  }

  let data: LogExport;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(content);
  } catch (error) {
    console.error(`${c.red}Error: Failed to parse log file${c.reset}`);
    console.error(error);
    process.exit(1);
  }

  // Always show summary
  printSummary(data);

  // Handle specific commands
  if (args.includes('--errors')) {
    showErrors(data);
  } else if (args.includes('--category')) {
    const categoryIndex = args.indexOf('--category') + 1;
    const category = args[categoryIndex];
    if (category) {
      showCategory(data, category);
    }
  } else if (args.includes('--search')) {
    const searchIndex = args.indexOf('--search') + 1;
    const search = args[searchIndex];
    if (search) {
      searchLogs(data, search);
    }
  } else if (args.includes('--timeline')) {
    showTimeline(data);
  } else if (args.includes('--sessions')) {
    showSessions(data);
  } else {
    // Default: show recent errors if any
    const errors = data.logs.filter(l => l.level === 'error');
    if (errors.length > 0) {
      console.log(`\n${c.yellow}Tip: Found ${errors.length} errors. Use --errors to see details.${c.reset}`);
    }
  }
}

main();
