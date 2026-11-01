#!/usr/bin/env npx tsx
/**
 * Test multiplayer sync between two clients
 *
 * 1. Client A connects, adds a track
 * 2. Client B connects, receives the track
 * 3. Client B changes tempo
 * 4. Client A receives the tempo change
 */
import WebSocket from 'ws';

const SESSION_ID = process.argv[2] || "d559a713-fd08-467e-b10e-506e60cf39e0";
const WS_URL = `wss://keyboardia.adewale-883.workers.dev/api/sessions/${SESSION_ID}/ws`;

interface TestResult {
  clientAConnected: boolean;
  clientBConnected: boolean;
  clientAReceivedSnapshot: boolean;
  clientBReceivedSnapshot: boolean;
  trackAddedByA: boolean;
  trackReceivedByB: boolean;
  tempoChangedByB: boolean;
  tempoReceivedByA: boolean;
}

const results: TestResult = {
  clientAConnected: false,
  clientBConnected: false,
  clientAReceivedSnapshot: false,
  clientBReceivedSnapshot: false,
  trackAddedByA: false,
  trackReceivedByB: false,
  tempoChangedByB: false,
  tempoReceivedByA: false,
};

let clientAId = '';
let clientBId = '';
let addedTrackId = '';

console.log('=== Multiplayer Sync Test ===\n');
console.log('Session:', SESSION_ID);
console.log('URL:', WS_URL);
console.log('');

// Client A
const clientA = new WebSocket(WS_URL);

clientA.on('open', () => {
  results.clientAConnected = true;
  console.log('[Client A] ✓ Connected');

  clientA.send(JSON.stringify({
    type: 'join',
    name: 'Client-A',
    color: '#ff0000'
  }));
});

clientA.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'snapshot') {
    results.clientAReceivedSnapshot = true;
    clientAId = msg.playerId;
    console.log('[Client A] ✓ Received snapshot, playerId:', clientAId.slice(0, 8));

    // After receiving snapshot, add a track
    setTimeout(() => {
      console.log('[Client A] Adding track...');
      addedTrackId = 'test-track-' + Date.now();
      clientA.send(JSON.stringify({
        type: 'add_track',
        track: {
          id: addedTrackId,
          sample: 'kick',
          steps: new Array(16).fill(false),
          muted: false,
          soloed: false,
          volume: 0.8,
          transpose: 0,
          parameterLocks: {},
          stepCount: 16,
        }
      }));
    }, 500);
  }

  if (msg.type === 'track_added' && msg.playerId === clientAId) {
    results.trackAddedByA = true;
    console.log('[Client A] ✓ Track added confirmed');

    // Wait for state to stabilize before connecting Client B
    setTimeout(() => connectClientB(), 1000);
  }

  if (msg.type === 'tempo_changed' && msg.playerId !== clientAId) {
    results.tempoReceivedByA = true;
    console.log('[Client A] ✓ Received tempo change from B:', msg.tempo);

    // Test complete
    setTimeout(finishTest, 1000);
  }
});

clientA.on('error', (err) => {
  console.error('[Client A] ✗ Error:', err.message);
});

// Client B
let clientB: WebSocket;

function connectClientB() {
  console.log('[Client B] Connecting...');
  clientB = new WebSocket(WS_URL);

  clientB.on('open', () => {
    results.clientBConnected = true;
    console.log('[Client B] ✓ Connected');

    clientB.send(JSON.stringify({
      type: 'join',
      name: 'Client-B',
      color: '#0000ff'
    }));
  });

  clientB.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'snapshot') {
      results.clientBReceivedSnapshot = true;
      clientBId = msg.playerId;
      console.log('[Client B] ✓ Received snapshot, playerId:', clientBId.slice(0, 8));

      // Check if track from A is in the snapshot (tracks are in msg.state.tracks)
      const tracks = msg.state?.tracks || [];
      const hasTrack = tracks.some((t: { id: string }) => t.id === addedTrackId);
      if (hasTrack) {
        results.trackReceivedByB = true;
        console.log('[Client B] ✓ Received track added by A');
      } else {
        console.log('[Client B] Tracks received:', tracks.length);
      }

      // Change tempo
      setTimeout(() => {
        console.log('[Client B] Changing tempo to 140...');
        clientB.send(JSON.stringify({
          type: 'set_tempo',
          tempo: 140
        }));
      }, 500);
    }

    if (msg.type === 'tempo_changed' && msg.playerId === clientBId) {
      results.tempoChangedByB = true;
      console.log('[Client B] ✓ Tempo change confirmed');
    }
  });

  clientB.on('error', (err) => {
    console.error('[Client B] ✗ Error:', err.message);
  });
}

function finishTest() {
  console.log('\n=== Test Results ===\n');

  const checks = [
    ['Client A connected', results.clientAConnected],
    ['Client A received snapshot', results.clientAReceivedSnapshot],
    ['Track added by A', results.trackAddedByA],
    ['Client B connected', results.clientBConnected],
    ['Client B received snapshot', results.clientBReceivedSnapshot],
    ['Track received by B', results.trackReceivedByB],
    ['Tempo changed by B', results.tempoChangedByB],
    ['Tempo received by A', results.tempoReceivedByA],
  ] as const;

  let passed = 0;
  for (const [name, result] of checks) {
    const status = result ? '✓' : '✗';
    console.log(`${status} ${name}`);
    if (result) passed++;
  }

  console.log(`\n${passed}/${checks.length} checks passed`);

  if (passed === checks.length) {
    console.log('\n✓ MULTIPLAYER SYNC TEST PASSED\n');
  } else {
    console.log('\n✗ MULTIPLAYER SYNC TEST FAILED\n');
  }

  clientA.close();
  if (clientB) clientB.close();

  process.exit(passed === checks.length ? 0 : 1);
}

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n✗ Test timed out after 30 seconds');
  finishTest();
}, 30000);
