#!/usr/bin/env npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Advanced Synth Bug Investigation Script
 *
 * Purpose: Capture comprehensive state to understand why advanced synths
 * stop producing sound despite "Voice triggering" logs showing success.
 *
 * Known symptoms:
 * - Logs show "Voice triggering: freq=261.6Hz, vol=1"
 * - playSuccesses counter increments
 * - But NO actual audio output
 * - Filter frequency reads as 0 and cannot be set
 *
 * This script:
 * 1. Launches Playwright with Chrome DevTools Protocol
 * 2. Records every user action
 * 3. Captures comprehensive internal state after each action
 * 4. Monitors for the exact moment audio breaks
 */

import { chromium, type Page, type Browser, type CDPSession } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_URL = 'http://localhost:5173';

interface StateSnapshot {
  timestamp: number;
  relativeTime: number;
  action: string;
  audioEngineState: {
    initialized: boolean;
    toneInitialized: boolean;
    contextState: string;
    contextSampleRate: number;
  } | null;
  advancedSynthState: {
    ready: boolean;
    voiceCount: number;
    activeVoices: number;
    currentPreset: string | null;
    playAttempts: number;
    playSuccesses: number;
    playFailures: number;
  } | null;
  toneJsState: {
    contextState: string;
    contextSampleRate: number;
    transportState: string;
  } | null;
  voiceInternals: Array<{
    voiceIndex: number;
    filterFrequency: number | null;
    filterType: string | null;
    ampEnvelopeValue: number | null;
    osc1Frequency: number | null;
    osc1Type: string | null;
    active: boolean;
    // Deep inspection
    filterInput: string;
    filterOutput: string;
    ampEnvelopeInput: string;
    filterDisposed: boolean;
    osc1Disposed: boolean;
  }>;
  contextComparison: {
    toneRawContext: string;
    engineContext: string;
    sameContext: boolean;
  } | null;
  error: string | null;
}

interface DebugSession {
  startTime: number;
  url: string;
  snapshots: StateSnapshot[];
  userActions: Array<{
    timestamp: number;
    type: string;
    details: string;
  }>;
  consoleErrors: string[];
  breakpointHit: boolean;
  breakpointSnapshot: StateSnapshot | null;
}

const session: DebugSession = {
  startTime: Date.now(),
  url: '',
  snapshots: [],
  userActions: [],
  consoleErrors: [],
  breakpointHit: false,
  breakpointSnapshot: null,
};

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const millis = ms % 1000;
  return `${minutes}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

async function captureState(page: Page, action: string): Promise<StateSnapshot> {
  const timestamp = Date.now();
  const relativeTime = timestamp - session.startTime;

  const snapshot: StateSnapshot = {
    timestamp,
    relativeTime,
    action,
    audioEngineState: null,
    advancedSynthState: null,
    toneJsState: null,
    voiceInternals: [],
    contextComparison: null,
    error: null,
  };

  try {
    const result = await page.evaluate(() => {
      const engine = (window as any).__audioEngine__;
      const Tone = (window as any).Tone;

      if (!engine) {
        return { error: 'No __audioEngine__ found' };
      }

      // Get audio engine state
      const audioEngineState = {
        initialized: engine.isInitialized?.() ?? false,
        toneInitialized: engine.isToneInitialized?.() ?? false,
        contextState: engine.getAudioContext?.()?.state ?? 'none',
        contextSampleRate: engine.getAudioContext?.()?.sampleRate ?? 0,
      };

      // Get advanced synth state
      let advancedSynthState = null;
      if (engine.advancedSynth) {
        const diag = engine.advancedSynth.getDiagnostics?.();
        advancedSynthState = {
          ready: diag?.ready ?? false,
          voiceCount: diag?.voiceCount ?? 0,
          activeVoices: diag?.activeVoices ?? 0,
          currentPreset: diag?.currentPreset ?? null,
          playAttempts: diag?.playAttempts ?? 0,
          playSuccesses: diag?.playSuccesses ?? 0,
          playFailures: diag?.playFailures ?? 0,
        };
      }

      // Get Tone.js state
      let toneJsState = null;
      if (Tone) {
        try {
          const ctx = Tone.getContext();
          toneJsState = {
            contextState: ctx?.state ?? 'none',
            contextSampleRate: ctx?.sampleRate ?? 0,
            transportState: Tone.Transport?.state ?? 'unknown',
          };
        } catch (e) {
          toneJsState = { contextState: 'error', contextSampleRate: 0, transportState: 'error' };
        }
      }

      // Get voice internals - this is the key diagnostic
      const voiceInternals: any[] = [];
      if (engine.advancedSynth?.voices) {
        for (let i = 0; i < Math.min(engine.advancedSynth.voices.length, 8); i++) {
          const voice = engine.advancedSynth.voices[i];
          try {
            voiceInternals.push({
              voiceIndex: i,
              filterFrequency: voice.filter?.frequency?.value ?? null,
              filterType: voice.filter?.type ?? null,
              ampEnvelopeValue: voice.ampEnvelope?.value ?? null,
              osc1Frequency: voice.osc1?.frequency?.value ?? null,
              osc1Type: voice.osc1?.type ?? null,
              active: voice.isActive?.() ?? false,
              // Deep inspection of internal node connections
              filterInput: voice.filter?.input ? typeof voice.filter.input : 'undefined',
              filterOutput: voice.filter?.output ? typeof voice.filter.output : 'undefined',
              ampEnvelopeInput: voice.ampEnvelope?.input ? typeof voice.ampEnvelope.input : 'undefined',
              filterDisposed: voice.filter?.disposed ?? 'unknown',
              osc1Disposed: voice.osc1?.disposed ?? 'unknown',
            });
          } catch (e) {
            voiceInternals.push({
              voiceIndex: i,
              error: String(e),
            });
          }
        }
      }

      // Context comparison - crucial for detecting mismatch
      let contextComparison = null;
      if (Tone && engine.getAudioContext) {
        try {
          const toneCtx = Tone.getContext();
          const engineCtx = engine.getAudioContext();
          contextComparison = {
            toneRawContext: toneCtx?.rawContext ? 'exists' : 'missing',
            engineContext: engineCtx ? 'exists' : 'missing',
            sameContext: toneCtx?.rawContext === engineCtx,
          };
        } catch (e) {
          contextComparison = { error: String(e) };
        }
      }

      return {
        audioEngineState,
        advancedSynthState,
        toneJsState,
        voiceInternals,
        contextComparison,
      };
    });

    if (result.error) {
      snapshot.error = result.error;
    } else {
      snapshot.audioEngineState = result.audioEngineState;
      snapshot.advancedSynthState = result.advancedSynthState;
      snapshot.toneJsState = result.toneJsState;
      snapshot.voiceInternals = result.voiceInternals;
      snapshot.contextComparison = result.contextComparison;
    }

    // Check for breakpoint condition: filter frequency is 0 but playSuccesses > 0
    if (snapshot.voiceInternals.length > 0) {
      const firstVoice = snapshot.voiceInternals[0];
      if (firstVoice.filterFrequency === 0 &&
          snapshot.advancedSynthState &&
          snapshot.advancedSynthState.playSuccesses > 0) {
        console.log('\x1b[31m╔══════════════════════════════════════════════════════════╗\x1b[0m');
        console.log('\x1b[31m║  BREAKPOINT: Filter frequency is 0 but plays succeeded!  ║\x1b[0m');
        console.log('\x1b[31m╚══════════════════════════════════════════════════════════╝\x1b[0m');
        session.breakpointHit = true;
        session.breakpointSnapshot = snapshot;
      }
    }

  } catch (e) {
    snapshot.error = `Exception during capture: ${e}`;
  }

  session.snapshots.push(snapshot);
  return snapshot;
}

function printSnapshot(snapshot: StateSnapshot): void {
  const time = formatTime(snapshot.relativeTime);
  console.log(`\n\x1b[36m[${time}] ${snapshot.action}\x1b[0m`);

  if (snapshot.error) {
    console.log(`  \x1b[31mError: ${snapshot.error}\x1b[0m`);
    return;
  }

  if (snapshot.audioEngineState) {
    const ae = snapshot.audioEngineState;
    console.log(`  Engine: init=${ae.initialized}, toneInit=${ae.toneInitialized}, ctx=${ae.contextState}`);
  }

  if (snapshot.advancedSynthState) {
    const as = snapshot.advancedSynthState;
    console.log(`  AdvSynth: ready=${as.ready}, preset=${as.currentPreset}, plays=${as.playSuccesses}/${as.playAttempts}`);
  }

  if (snapshot.contextComparison) {
    const cc = snapshot.contextComparison;
    const color = cc.sameContext ? '\x1b[32m' : '\x1b[31m';
    console.log(`  ${color}Context match: ${cc.sameContext}\x1b[0m`);
  }

  // Print voice internals summary
  if (snapshot.voiceInternals.length > 0) {
    const v0 = snapshot.voiceInternals[0];
    const freqColor = v0.filterFrequency === 0 ? '\x1b[31m' : '\x1b[32m';
    console.log(`  Voice[0]: ${freqColor}filterFreq=${v0.filterFrequency}\x1b[0m, osc1Freq=${v0.osc1Frequency?.toFixed(1)}, active=${v0.active}`);
    console.log(`    filterInput=${v0.filterInput}, disposed=${v0.filterDisposed}`);
  }
}

async function setupActionRecording(page: Page): Promise<void> {
  // Inject action recording
  await page.addInitScript(() => {
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const text = target.textContent?.slice(0, 30) || target.tagName;
      (window as any).__recordAction__?.('click', text);
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key.length === 1 || ['Enter', 'Space', 'Escape'].includes(e.key)) {
        (window as any).__recordAction__?.('keypress', e.key);
      }
    }, true);
  });

  await page.exposeFunction('__recordAction__', (type: string, details: string) => {
    session.userActions.push({
      timestamp: Date.now(),
      type,
      details,
    });
    console.log(`\x1b[33m[ACTION] ${type}: ${details}\x1b[0m`);
  });
}

async function main(): Promise<void> {
  const url = process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : DEFAULT_URL;

  session.url = url;

  console.log('\x1b[36m╔═══════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║       Advanced Synth Bug Investigation                        ║\x1b[0m');
  console.log('\x1b[36m╚═══════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log(`\nURL: ${url}`);
  console.log('\nThis script will:');
  console.log('  1. Capture state after every user action');
  console.log('  2. Monitor for filter frequency = 0 (bug condition)');
  console.log('  3. Trigger BREAKPOINT when bug condition detected');
  console.log('\nPress Ctrl+C to end session and save report.\n');

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: false,
      devtools: true, // Open DevTools automatically
      args: ['--autoplay-policy=no-user-gesture-required'],
    });

    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });

    const page = await context.newPage();

    // Enable CDP for deeper inspection
    const cdp: CDPSession = await context.newCDPSession(page);

    // Console message monitoring
    page.on('console', async (msg) => {
      const text = msg.text();
      if (text.includes('[Audio]') || msg.type() === 'error') {
        const time = formatTime(Date.now() - session.startTime);
        const color = msg.type() === 'error' ? '\x1b[31m' : '\x1b[90m';
        console.log(`${color}[${time}] ${text.slice(0, 150)}\x1b[0m`);

        if (msg.type() === 'error') {
          session.consoleErrors.push(text);
        }

        // Capture state on audio-related logs
        if (text.includes('Voice triggering') || text.includes('AdvancedSynth playing')) {
          await captureState(page, `Console: ${text.slice(0, 50)}`);
        }
      }
    });

    await setupActionRecording(page);
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // Initial state capture
    const initialSnapshot = await captureState(page, 'Page loaded');
    printSnapshot(initialSnapshot);

    console.log('\n\x1b[32m✓ Page loaded. Start testing!\x1b[0m');
    console.log('\x1b[33mTry: Start session → Add advanced synth (Lush/Fat Saw/Thick) → Toggle steps → Watch for breakpoint\x1b[0m\n');

    // Periodic state capture (every 2 seconds)
    const intervalId = setInterval(async () => {
      try {
        const snapshot = await captureState(page, 'Periodic check');
        // Only print if something interesting changed
        if (snapshot.advancedSynthState &&
            (snapshot.advancedSynthState.playAttempts > 0 ||
             snapshot.voiceInternals.some(v => v.filterFrequency === 0))) {
          printSnapshot(snapshot);
        }
      } catch (e) {
        // Page might be navigating
      }
    }, 2000);

    // Wait for Ctrl+C
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        clearInterval(intervalId);
        console.log('\n\x1b[33mEnding session...\x1b[0m');
        resolve();
      });
    });

  } finally {
    // Save session
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `advanced-synth-debug-${timestamp}.json`;
    const filepath = path.join(process.cwd(), 'test-results', filename);

    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(session, null, 2));

    console.log(`\n\x1b[32mSession saved to: ${filepath}\x1b[0m`);

    // Print summary
    console.log('\n\x1b[36m=== Session Summary ===\x1b[0m');
    console.log(`Duration: ${formatTime(Date.now() - session.startTime)}`);
    console.log(`Snapshots: ${session.snapshots.length}`);
    console.log(`User actions: ${session.userActions.length}`);
    console.log(`Console errors: ${session.consoleErrors.length}`);
    console.log(`Breakpoint hit: ${session.breakpointHit}`);

    if (session.breakpointSnapshot) {
      console.log('\n\x1b[31m=== BREAKPOINT SNAPSHOT ===\x1b[0m');
      console.log(JSON.stringify(session.breakpointSnapshot, null, 2));
    }

    if (browser) {
      await browser.close();
    }
  }
}

main().catch(console.error);
