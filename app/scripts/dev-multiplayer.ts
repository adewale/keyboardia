#!/usr/bin/env npx tsx
/**
 * Phase 7: Multi-client development script
 *
 * Opens two browser windows to the same session for testing multiplayer behavior.
 *
 * Usage:
 *   npm run dev:multiplayer
 *   npm run dev:multiplayer <session-id>
 *
 * This script:
 * 1. Creates a new session (or uses provided ID)
 * 2. Opens two browser windows to the same session
 * 3. Adds ?debug=1 to show debug overlay
 *
 * Requirements:
 * - Vite dev server must be running (npm run dev)
 * - Uses 'open' package to open browser windows
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const DEV_SERVER = 'http://localhost:5173';
const PROD_SERVER = 'https://keyboardia.adewale-883.workers.dev';

// Check if dev server is running
async function isDevServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(DEV_SERVER, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

// Create a new session
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
          steps: Array(16).fill(false).map((_, i) => i % 4 === 0),
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        },
        {
          id: 'track-hihat',
          name: 'Hi-Hat',
          sampleId: 'hihat',
          steps: Array(16).fill(false).map((_, i) => i % 2 === 1),
          parameterLocks: Array(16).fill(null),
          volume: 0.7,
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

// Open URL in browser
function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${command} "${url}"`);
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let sessionId = args[0];
  let baseUrl: string;

  // Check if dev server is running
  if (await isDevServerRunning()) {
    console.log('📡 Using dev server at', DEV_SERVER);
    baseUrl = DEV_SERVER;
  } else {
    console.log('🌐 Dev server not running, using production at', PROD_SERVER);
    console.log('   Tip: Run "npm run dev" first for hot reload');
    baseUrl = PROD_SERVER;
  }

  // Create or validate session
  if (!sessionId) {
    console.log('🎵 Creating new multiplayer test session...');
    try {
      sessionId = await createSession(baseUrl);
      console.log(`✓ Created session: ${sessionId}`);
    } catch (error) {
      console.error('❌ Failed to create session:', error);
      process.exit(1);
    }
  } else {
    console.log(`🎵 Using existing session: ${sessionId}`);
  }

  const sessionUrl = `${baseUrl}/s/${sessionId}?debug=1`;

  console.log('\n🎹 Opening two browser windows...');
  console.log(`   Session URL: ${sessionUrl}`);
  console.log('\n   Window 1: "Player 1" (will open first)');
  console.log('   Window 2: "Player 2" (will open after 1 second)');

  // Open first window
  openInBrowser(sessionUrl);

  // Open second window after a short delay
  setTimeout(() => {
    openInBrowser(sessionUrl);
    console.log('\n✓ Both windows opened');
    console.log('\n📋 Debug Tips:');
    console.log('   - Look for "Multiplayer" section in debug panel');
    console.log('   - Check browser console for [WS] messages');
    console.log(`   - API: ${baseUrl}/api/debug/session/${sessionId}/connections`);
    console.log(`   - API: ${baseUrl}/api/debug/session/${sessionId}/ws-logs`);
    console.log('\n🔧 Note: Real-time sync requires Durable Objects (Phase 8+)');
    console.log('   Currently, both windows operate independently.');
  }, 1000);
}

main().catch(console.error);
