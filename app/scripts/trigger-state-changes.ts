#!/usr/bin/env npx tsx
/**
 * Trigger State Changes via API
 *
 * This script makes direct API calls to change session state,
 * which should trigger the WebSocket broadcast and cause the
 * connection storm in connected clients.
 *
 * Usage:
 *   npx tsx scripts/trigger-state-changes.ts <session-id>
 *   npx tsx scripts/trigger-state-changes.ts <session-id> --local
 *   npx tsx scripts/trigger-state-changes.ts <session-id> --count 10
 */

const PROD_SERVER = 'https://keyboardia.adewale-883.workers.dev';
const LOCAL_SERVER = 'http://localhost:8787';

interface Session {
  id: string;
  state: {
    tracks: unknown[];
    tempo: number;
    swing: number;
  };
}

async function getSession(baseUrl: string, sessionId: string): Promise<Session | null> {
  try {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    if (!response.ok) return null;
    return await response.json() as Session;
  } catch {
    return null;
  }
}

async function updateSession(baseUrl: string, sessionId: string, state: unknown): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sessionId = args.find(a => !a.startsWith('--'));
  const useLocal = args.includes('--local');
  const countIndex = args.indexOf('--count');
  const count = countIndex !== -1 ? parseInt(args[countIndex + 1]) : 5;

  if (!sessionId) {
    console.log('Usage: npx tsx scripts/trigger-state-changes.ts <session-id> [--local] [--count N]');
    process.exit(1);
  }

  const baseUrl = useLocal ? LOCAL_SERVER : PROD_SERVER;
  console.log(`\n🔄 Triggering state changes on session: ${sessionId}`);
  console.log(`   Server: ${baseUrl}`);
  console.log(`   Changes to make: ${count}`);
  console.log('');

  // Get current session
  const session = await getSession(baseUrl, sessionId);
  if (!session) {
    console.log('❌ Session not found');
    process.exit(1);
  }

  console.log(`   Current tempo: ${session.state.tempo}`);
  console.log('');

  // Make changes
  for (let i = 0; i < count; i++) {
    // Alternate tempo between 120 and 121 to trigger state changes
    const newTempo = 120 + (i % 2);
    const newState = {
      ...session.state,
      tempo: newTempo,
    };

    const success = await updateSession(baseUrl, sessionId, newState);
    if (success) {
      console.log(`   ✓ Change ${i + 1}/${count}: tempo → ${newTempo}`);
    } else {
      console.log(`   ❌ Change ${i + 1}/${count}: failed`);
    }

    // Small delay between changes
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n✅ Done triggering state changes');
  console.log('   Watch the browser windows or monitor-connections.ts output');
  console.log('   to see if a connection storm occurs.\n');
}

main().catch(console.error);
