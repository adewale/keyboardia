#!/usr/bin/env npx tsx
/**
 * Check Durable Object in-memory state vs KV state
 */
import WebSocket from 'ws';

const SESSION_ID = process.argv[2];
if (!SESSION_ID) {
  console.error('Usage: npx tsx scripts/check-do-state.ts <session-id>');
  process.exit(1);
}

const API_BASE = 'https://keyboardia.adewale-883.workers.dev';
const WS_URL = `wss://keyboardia.adewale-883.workers.dev/api/sessions/${SESSION_ID}/ws`;

interface Track {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  stepCount: number;
}

interface SessionState {
  tracks: Track[];
  tempo: number;
  swing: number;
}

async function getKVState(): Promise<SessionState> {
  const res = await fetch(`${API_BASE}/api/sessions/${SESSION_ID}`);
  const data = await res.json();
  return data.state;
}

function getDOState(): Promise<SessionState> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', name: 'state-checker', color: '#888' }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'snapshot') {
        ws.close();
        resolve(msg.state);
      }
    });

    ws.on('error', reject);
    setTimeout(() => reject(new Error('Timeout')), 10000);
  });
}

function countActiveSteps(track: Track): number {
  return track.steps.slice(0, track.stepCount || 16).filter(s => s).length;
}

async function main() {
  console.log(`\nChecking session: ${SESSION_ID}\n`);

  // Get both states
  console.log('Fetching KV state...');
  const kvState = await getKVState();

  console.log('Fetching DO state via WebSocket...');
  const doState = await getDOState();

  // Compare
  console.log('\n=== State Comparison ===\n');
  console.log(`Tempo: KV=${kvState.tempo}, DO=${doState.tempo} ${kvState.tempo === doState.tempo ? '✓' : '✗ MISMATCH'}`);
  console.log(`Swing: KV=${kvState.swing}, DO=${doState.swing} ${kvState.swing === doState.swing ? '✓' : '✗ MISMATCH'}`);
  console.log(`Track count: KV=${kvState.tracks.length}, DO=${doState.tracks.length} ${kvState.tracks.length === doState.tracks.length ? '✓' : '✗ MISMATCH'}`);

  console.log('\n=== Track Details ===\n');
  const maxTracks = Math.max(kvState.tracks.length, doState.tracks.length);

  for (let i = 0; i < maxTracks; i++) {
    const kvTrack = kvState.tracks[i];
    const doTrack = doState.tracks[i];

    if (!kvTrack || !doTrack) {
      console.log(`Track ${i + 1}: ${kvTrack ? 'KV only' : 'DO only'}`);
      continue;
    }

    const kvActive = countActiveSteps(kvTrack);
    const doActive = countActiveSteps(doTrack);
    const match = kvActive === doActive;

    console.log(`${i + 1}. ${kvTrack.name.padEnd(10)} KV: ${kvActive}/${kvTrack.stepCount} steps, DO: ${doActive}/${doTrack.stepCount} steps ${match ? '✓' : '✗ MISMATCH'}`);

    if (!match) {
      // Show which steps differ
      const kvSteps = kvTrack.steps.slice(0, kvTrack.stepCount);
      const doSteps = doTrack.steps.slice(0, doTrack.stepCount);
      const diffs: number[] = [];
      for (let j = 0; j < Math.max(kvSteps.length, doSteps.length); j++) {
        if (kvSteps[j] !== doSteps[j]) diffs.push(j);
      }
      console.log(`   Differing steps: ${diffs.join(', ')}`);
    }
  }

  console.log('\n');
}

main().catch(console.error);
