#!/usr/bin/env npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Interactive Debug Session
 *
 * Launches a Playwright browser for manual testing while recording:
 * - All user actions (clicks, keystrokes, navigation)
 * - Console logs (filtered for audio-related)
 * - Errors and warnings
 *
 * The recorded session can be replayed for automated regression testing.
 *
 * Usage:
 *   npx tsx scripts/interactive-debug-session.ts
 *   npx tsx scripts/interactive-debug-session.ts --url http://localhost:5174
 */

import { chromium, type Page, type ConsoleMessage, type Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_URL = 'http://localhost:5173';

interface RecordedAction {
  timestamp: number;
  type: 'click' | 'keypress' | 'input' | 'navigation' | 'custom';
  selector?: string;
  value?: string;
  key?: string;
  x?: number;
  y?: number;
  description?: string;
}

interface LogEntry {
  timestamp: number;
  type: string;
  text: string;
  isAudioRelated: boolean;
}

interface RecordedSession {
  startTime: number;
  endTime: number;
  url: string;
  actions: RecordedAction[];
  logs: LogEntry[];
  errors: string[];
  summary: {
    totalActions: number;
    totalLogs: number;
    totalErrors: number;
    audioErrors: number;
  };
}

const session: RecordedSession = {
  startTime: Date.now(),
  endTime: 0,
  url: '',
  actions: [],
  logs: [],
  errors: [],
  summary: {
    totalActions: 0,
    totalLogs: 0,
    totalErrors: 0,
    audioErrors: 0,
  },
};

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function isAudioRelated(text: string): boolean {
  const keywords = [
    '[Audio]', 'AudioContext', 'Tone.js', 'synth', 'Synth',
    'AdvancedSynth', 'playback', 'sample', 'instrument',
    'context', 'mismatch', 'dispose', 'HMR'
  ];
  return keywords.some(k => text.includes(k));
}

async function setupPageRecording(page: Page): Promise<void> {
  // Record console messages
  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    const type = msg.type();
    const isAudio = isAudioRelated(text);

    const entry: LogEntry = {
      timestamp: Date.now() - session.startTime,
      type,
      text,
      isAudioRelated: isAudio,
    };
    session.logs.push(entry);
    session.summary.totalLogs++;

    // Print audio-related and error logs
    if (isAudio || type === 'error') {
      const timeStr = formatTime(entry.timestamp);
      const color = type === 'error' ? '\x1b[31m' : (isAudio ? '\x1b[36m' : '\x1b[37m');
      console.log(`${color}[${timeStr}] [${type.toUpperCase()}]\x1b[0m ${text.slice(0, 200)}`);
    }

    if (type === 'error') {
      session.summary.totalErrors++;
      if (isAudio) session.summary.audioErrors++;
    }
  });

  // Record page errors
  page.on('pageerror', (error) => {
    const msg = `PAGE ERROR: ${error.message}`;
    session.errors.push(msg);
    session.summary.totalErrors++;
    console.log(`\x1b[31m[${formatTime(Date.now() - session.startTime)}] ${msg}\x1b[0m`);
  });

  // Inject action recording script into page
  await page.addInitScript(() => {
    // Track clicks
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const selector = target.tagName.toLowerCase() +
        (target.id ? `#${target.id}` : '') +
        (target.className ? `.${target.className.split(' ').join('.')}` : '');

      (window as any).__recordAction__?.({
        type: 'click',
        selector,
        x: e.clientX,
        y: e.clientY,
        description: target.textContent?.slice(0, 50) || selector,
      });
    }, true);

    // Track key presses
    document.addEventListener('keydown', (e) => {
      if (e.key.length === 1 || ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        (window as any).__recordAction__?.({
          type: 'keypress',
          key: e.key,
          description: `Key: ${e.key}`,
        });
      }
    }, true);
  });

  // Expose action recording function
  await page.exposeFunction('__recordAction__', (action: Omit<RecordedAction, 'timestamp'>) => {
    const recordedAction: RecordedAction = {
      ...action,
      timestamp: Date.now() - session.startTime,
    };
    session.actions.push(recordedAction);
    session.summary.totalActions++;

    // Print action
    const timeStr = formatTime(recordedAction.timestamp);
    console.log(`\x1b[33m[${timeStr}] ACTION: ${action.type}\x1b[0m ${action.description || ''}`);
  });
}

async function injectDebugHelpers(page: Page): Promise<void> {
  // Wait for audioDebug to be available
  try {
    await page.waitForFunction(() => typeof (window as any).audioDebug !== 'undefined', { timeout: 10000 });
    console.log('\x1b[32m[DEBUG] audioDebug API available\x1b[0m');
  } catch {
    console.log('\x1b[33m[DEBUG] audioDebug API not available yet\x1b[0m');
  }

  // Inject diagnostic commands
  await page.evaluate(() => {
    (window as any).__runDiagnostic__ = async () => {
      const engine = (window as any).__audioEngine__;
      const Tone = await import('tone');

      const diagnostic = {
        engineInitialized: engine?.isInitialized?.() ?? false,
        toneInitialized: engine?.isToneInitialized?.() ?? false,
        advancedReady: engine?.isToneSynthReady?.('advanced') ?? false,
        toneReady: engine?.isToneSynthReady?.('tone') ?? false,
        engineContextState: engine?.getAudioContext?.()?.state ?? 'none',
        toneContextState: Tone.getContext?.().state ?? 'none',
        contextMismatch: Tone.getContext?.().rawContext !== engine?.getAudioContext?.(),
        advancedDiagnostics: engine?.getAdvancedSynthDiagnostics?.() ?? null,
      };

      console.log('[DIAGNOSTIC]', JSON.stringify(diagnostic, null, 2));
      return diagnostic;
    };

    console.log('[DEBUG] Diagnostic helper injected. Run: __runDiagnostic__()');
  });
}

function saveSession(): void {
  session.endTime = Date.now();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `debug-session-${timestamp}.json`;
  const filepath = path.join(process.cwd(), 'test-results', filename);

  // Ensure directory exists
  fs.mkdirSync(path.dirname(filepath), { recursive: true });

  fs.writeFileSync(filepath, JSON.stringify(session, null, 2));
  console.log(`\n\x1b[32mSession saved to: ${filepath}\x1b[0m`);

  // Also generate a replay script
  const replayScript = generateReplayScript(session);
  const replayPath = filepath.replace('.json', '-replay.ts');
  fs.writeFileSync(replayPath, replayScript);
  console.log(`\x1b[32mReplay script saved to: ${replayPath}\x1b[0m`);
}

function generateReplayScript(sess: RecordedSession): string {
  const actionsCode = sess.actions
    .filter(a => a.type === 'click' || a.type === 'keypress')
    .map(a => {
      if (a.type === 'click' && a.x !== undefined && a.y !== undefined) {
        return `  await page.mouse.click(${a.x}, ${a.y}); // ${a.description || ''}
  await page.waitForTimeout(100);`;
      } else if (a.type === 'keypress' && a.key) {
        const key = a.key === ' ' ? 'Space' : a.key;
        return `  await page.keyboard.press('${key}');
  await page.waitForTimeout(50);`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return `/**
 * Auto-generated replay script from debug session
 * Generated: ${new Date().toISOString()}
 * Original session duration: ${formatTime(sess.endTime - sess.startTime)}
 * Total actions: ${sess.summary.totalActions}
 */

import { chromium } from 'playwright';

async function replay() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Setup console logging
  page.on('console', msg => {
    if (msg.text().includes('[Audio]') || msg.type() === 'error') {
      console.log(\`[\${msg.type()}] \${msg.text()}\`);
    }
  });

  await page.goto('${sess.url}');
  await page.waitForLoadState('networkidle');

  console.log('Starting replay...');

  // Recorded actions
${actionsCode}

  console.log('Replay complete. Press Ctrl+C to close.');

  // Keep browser open
  await new Promise(() => {});
}

replay().catch(console.error);
`;
}

async function main(): Promise<void> {
  const url = process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : DEFAULT_URL;

  session.url = url;

  console.log('\x1b[36m╔════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║       Interactive Debug Session                        ║\x1b[0m');
  console.log('\x1b[36m╚════════════════════════════════════════════════════════╝\x1b[0m');
  console.log(`\nURL: ${url}`);
  console.log('\nRecording:');
  console.log('  - All clicks and keypresses');
  console.log('  - Audio-related console logs');
  console.log('  - Errors and warnings');
  console.log('\nCommands in browser console:');
  console.log('  __runDiagnostic__()  - Run full audio diagnostic');
  console.log('  audioDebug.status()  - Check audio status');
  console.log('\nPress Ctrl+C to end session and save recording.\n');

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });

    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });

    const page = await context.newPage();

    await setupPageRecording(page);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await injectDebugHelpers(page);

    console.log('\x1b[32m✓ Page loaded. Start testing!\x1b[0m\n');

    // Keep running until Ctrl+C
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        console.log('\n\x1b[33mEnding session...\x1b[0m');
        resolve();
      });
    });

  } finally {
    // Save session before closing
    saveSession();

    // Print summary
    console.log('\n\x1b[36m=== Session Summary ===\x1b[0m');
    console.log(`Duration: ${formatTime(session.endTime - session.startTime)}`);
    console.log(`Actions recorded: ${session.summary.totalActions}`);
    console.log(`Logs captured: ${session.summary.totalLogs}`);
    console.log(`Errors: ${session.summary.totalErrors} (${session.summary.audioErrors} audio-related)`);

    if (session.summary.audioErrors > 0) {
      console.log('\n\x1b[31mAudio errors detected:\x1b[0m');
      session.logs
        .filter(l => l.type === 'error' && l.isAudioRelated)
        .slice(-5)
        .forEach(l => console.log(`  - ${l.text.slice(0, 100)}`));
    }

    if (browser) {
      await browser.close();
    }
  }
}

main().catch(console.error);
