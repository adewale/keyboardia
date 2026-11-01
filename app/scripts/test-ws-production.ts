#!/usr/bin/env npx tsx
/**
 * Test WebSocket connection to production
 */
import WebSocket from 'ws';

const SESSION_ID = process.argv[2] || "d559a713-fd08-467e-b10e-506e60cf39e0";
const WS_URL = `wss://keyboardia.adewale-883.workers.dev/api/sessions/${SESSION_ID}/ws`;

console.log("Connecting to:", WS_URL);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✓ WebSocket connected!');

  // Send join message
  ws.send(JSON.stringify({
    type: 'join',
    name: 'cli-test-client',
    color: '#ff0000'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('← Received:', msg.type);

  if (msg.type === 'session_state') {
    console.log('  Tempo:', msg.tempo);
    console.log('  Tracks:', msg.tracks?.length || 0);
  }
});

ws.on('error', (err) => {
  console.error('✗ Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log("Connection closed:", code, String(reason));
  process.exit(0);
});

// Close after 5 seconds
setTimeout(() => {
  console.log('Test complete. Closing connection...');
  ws.close();
}, 5000);
