#!/usr/bin/env npx tsx
/**
 * Audio Debug Watcher
 *
 * This script uses Playwright to open the app and monitor audio-related
 * console logs in real-time. It captures all [Audio] logs and any errors
 * to help diagnose the "instruments stop working" issue.
 *
 * Usage:
 *   npx tsx scripts/watch-audio-logs.ts
 *   npx tsx scripts/watch-audio-logs.ts --url http://localhost:5174
 */

import { chromium, type Page, type ConsoleMessage } from 'playwright';

const DEFAULT_URL = 'http://localhost:5173';

interface LogEntry {
  timestamp: Date;
  type: string;
  text: string;
  location?: string;
}

const logs: LogEntry[] = [];
let lastInstrumentTest = 0;

function formatLog(entry: LogEntry): string {
  const time = entry.timestamp.toLocaleTimeString();
  const typeColor = {
    'error': '\x1b[31m',    // red
    'warning': '\x1b[33m',  // yellow
    'info': '\x1b[36m',     // cyan
    'log': '\x1b[37m',      // white
  }[entry.type] || '\x1b[37m';

  return `${typeColor}[${time}] [${entry.type.toUpperCase()}]\x1b[0m ${entry.text}`;
}

async function setupConsoleCapture(page: Page): Promise<void> {
  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    const type = msg.type();

    // Filter for audio-related logs
    const isAudioLog = text.includes('[Audio]') ||
                       text.includes('AdvancedSynth') ||
                       text.includes('Tone.js') ||
                       text.includes('AudioContext') ||
                       text.includes('playAdvancedSynth') ||
                       text.includes('invariant') ||
                       text.includes('BLOCKED');

    const isError = type === 'error';
    const isWarning = type === 'warning' && (
      text.includes('audio') ||
      text.includes('Audio') ||
      text.includes('synth') ||
      text.includes('Synth')
    );

    if (isAudioLog || isError || isWarning) {
      const entry: LogEntry = {
        timestamp: new Date(),
        type,
        text,
        location: msg.location()?.url,
      };
      logs.push(entry);
      console.log(formatLog(entry));
    }
  });

  page.on('pageerror', (error) => {
    const entry: LogEntry = {
      timestamp: new Date(),
      type: 'error',
      text: `PAGE ERROR: ${error.message}`,
    };
    logs.push(entry);
    console.log(formatLog(entry));
  });
}

async function triggerInstrumentTests(page: Page): Promise<void> {
  console.log('\n\x1b[36m=== Testing Advanced Synths ===\x1b[0m\n');

  // Get diagnostics first
  const diagnostics = await page.evaluate(async () => {
    if (typeof window.audioDebug === 'undefined') {
      return { error: 'audioDebug not available' };
    }
    return window.audioDebug.getAdvancedSynthDiagnostics();
  });

  console.log('\x1b[33mAdvanced Synth Diagnostics:\x1b[0m');
  console.log(JSON.stringify(diagnostics, null, 2));

  // Test each advanced synth
  const presets = ['supersaw', 'thick-lead', 'warm-pad', 'sub-bass', 'wobble-bass', 'acid-bass', 'vibrato-lead'];

  for (const preset of presets) {
    console.log(`\n\x1b[36mTesting: advanced:${preset}\x1b[0m`);

    const result = await page.evaluate(async (p) => {
      if (typeof window.audioDebug === 'undefined') {
        return { status: 'error', error: 'audioDebug not available' };
      }
      return window.audioDebug.testInstrument(`advanced:${p}`);
    }, preset);

    const statusColor = result.status === 'success' ? '\x1b[32m' : '\x1b[31m';
    console.log(`${statusColor}Result: ${result.status}\x1b[0m`);
    if (result.error) {
      console.log(`\x1b[31mError: ${result.error}\x1b[0m`);
    }

    // Wait between tests
    await page.waitForTimeout(300);
  }

  lastInstrumentTest = Date.now();
}

async function monitorLoop(page: Page): Promise<void> {
  console.log('\n\x1b[32m=== Starting Monitor Loop ===\x1b[0m');
  console.log('Will check diagnostics every 5 seconds and test instruments every 30 seconds\n');

  // Start the in-browser monitor
  await page.evaluate(() => {
    if (typeof window.audioDebug !== 'undefined') {
      window.audioDebug.startMonitor(2000);
    }
  });

  while (true) {
    await page.waitForTimeout(5000);

    // Get current state
    const state = await page.evaluate(async () => {
      if (typeof window.audioDebug === 'undefined') {
        return null;
      }
      const engine = window.__audioEngine__;
      if (!engine) return null;

      return {
        initialized: engine.isInitialized(),
        toneInitialized: engine.isToneInitialized(),
        advancedReady: engine.isToneSynthReady('advanced'),
        toneReady: engine.isToneSynthReady('tone'),
      };
    });

    if (state) {
      const hasIssue = !state.initialized || !state.toneInitialized || !state.advancedReady;
      const color = hasIssue ? '\x1b[31m' : '\x1b[32m';
      console.log(`${color}[${new Date().toLocaleTimeString()}] State: init=${state.initialized}, toneInit=${state.toneInitialized}, advReady=${state.advancedReady}\x1b[0m`);

      if (hasIssue) {
        console.log('\x1b[31m⚠️ Issue detected! Getting detailed diagnostics...\x1b[0m');
        await triggerInstrumentTests(page);
      }
    }

    // Periodically test instruments
    if (Date.now() - lastInstrumentTest > 30000) {
      await triggerInstrumentTests(page);
    }
  }
}

async function main(): Promise<void> {
  const url = process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : DEFAULT_URL;

  console.log('\x1b[36m╔════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║       Audio Debug Watcher                  ║\x1b[0m');
  console.log('\x1b[36m╚════════════════════════════════════════════╝\x1b[0m');
  console.log(`\nOpening: ${url}`);
  console.log('Press Ctrl+C to stop\n');

  const browser = await chromium.launch({
    headless: false,  // Show browser so we can interact
    args: ['--autoplay-policy=no-user-gesture-required'],  // Allow audio without gesture
  });

  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  const page = await context.newPage();

  // Set up console capture before navigation
  await setupConsoleCapture(page);

  // Navigate to app
  await page.goto(url);
  await page.waitForLoadState('networkidle');

  console.log('\x1b[32mPage loaded. Waiting for audio debug API...\x1b[0m');

  // Wait for audioDebug to be available
  await page.waitForFunction(() => typeof window.audioDebug !== 'undefined', { timeout: 10000 });

  console.log('\x1b[32maudioDebug API available.\x1b[0m');

  // Click to trigger audio initialization
  console.log('\x1b[33mClicking to unlock audio...\x1b[0m');
  await page.click('body', { force: true });
  await page.waitForTimeout(500);

  // Force initialize Tone.js
  console.log('\x1b[33mForce initializing Tone.js...\x1b[0m');
  await page.evaluate(async () => {
    await window.audioDebug.forceInitAndTest();
  });

  await page.waitForTimeout(1000);

  // Run initial instrument tests
  await triggerInstrumentTests(page);

  // Start monitor loop
  await monitorLoop(page);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\x1b[33mShutting down...\x1b[0m');

  // Print summary
  const errors = logs.filter(l => l.type === 'error');
  const warnings = logs.filter(l => l.type === 'warning');

  console.log('\n\x1b[36m=== Session Summary ===\x1b[0m');
  console.log(`Total logs captured: ${logs.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);

  if (errors.length > 0) {
    console.log('\n\x1b[31mErrors:\x1b[0m');
    errors.slice(-10).forEach(e => console.log(`  - ${e.text.slice(0, 100)}`));
  }

  process.exit(0);
});

main().catch(console.error);

// Type declarations
declare global {
  interface Window {
    audioDebug: {
      status: () => Promise<Record<string, unknown>>;
      testInstrument: (id: string) => Promise<{ status: string; error?: string }>;
      forceInitAndTest: () => Promise<void>;
      getAdvancedSynthDiagnostics: () => Promise<Record<string, unknown> | null>;
      startMonitor: (interval?: number) => () => void;
      stopMonitor: () => void;
    };
    __audioEngine__: {
      isInitialized: () => boolean;
      isToneInitialized: () => boolean;
      isToneSynthReady: (type: 'tone' | 'advanced') => boolean;
    };
  }
}
