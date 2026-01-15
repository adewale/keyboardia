# Observability Architecture

> **Status:** Phase 7 Complete
> **Related:** [ROADMAP.md](./ROADMAP.md) Phase 7
> **See Also:** [Observability 2.0 Research](./research/OBSERVABILITY-2-0.md), [Observability 2.0 Implementation Spec](./OBSERVABILITY-2-0-IMPLEMENTATION.md)

---

## Overview

Keyboardia's observability stack is designed for debugging multiplayer WebSocket connections, state synchronization, and clock sync - problems that are notoriously difficult to diagnose in distributed systems.

The architecture has three layers:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Cloudflare Native Tools                           │
│  (Dashboard, wrangler tail, KV/DO metrics)                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Application Logging (Phase 7)                     │
│  (WebSocket events, state hashes, connection metrics)       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Debug Endpoints & Client Overlay (Phase 7)        │
│  (Queryable APIs, real-time client-side debugging)          │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Cloudflare Native Tools

These are available out of the box with Cloudflare Workers:

### Cloudflare Dashboard
- **Workers Analytics**: Request count, CPU time, error rates
- **KV Analytics**: Read/write operations, latency percentiles
- **Durable Objects Metrics**: Active instances, WebSocket connections, storage

### Real-time Logs
```bash
# Stream live logs from production
wrangler tail --format=pretty

# Filter to specific session
wrangler tail --format=pretty | grep "session=abc123"
```

### What Cloudflare Shows vs What We Need

| Cloudflare Shows | What We Also Need |
|------------------|-------------------|
| "5 WebSocket connections" | Which players, which session? |
| "Error rate 2%" | Which message type failed? |
| "DO request latency 50ms" | Is state actually in sync? |

This gap is why we built Layer 2.

---

## Layer 2: Application Logging

### WebSocket Lifecycle Logging

Every WebSocket event is logged with a consistent format:

```typescript
interface WebSocketLog {
  type: 'ws_connect' | 'ws_message' | 'ws_disconnect';
  timestamp: string;
  sessionId: string;
  playerId: string;

  // For messages
  messageType?: string;
  payload?: unknown;

  // For disconnect
  reason?: string;
  duration?: number; // seconds
}
```

### Console Output Format

Designed for `wrangler tail` readability:

```
[WS] connect session=abc123 player=xyz
[WS] message session=abc123 player=xyz type=toggle_step
[WS] message session=abc123 player=xyz type=set_tempo
[WS] disconnect session=abc123 player=xyz reason=closed duration=342s
```

### KV Storage Strategy

Logs are stored in KV with TTL for later querying:

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `ws-log:{id}` | 1 hour | Individual log entries |
| `ws-session-logs:{sessionId}` | 1 hour | Index of logs per session |
| `ws-metrics:{sessionId}` | 24 hours | Connection/message counts |

**Why KV instead of external logging?**
- Zero additional infrastructure
- Queryable via debug endpoints
- Auto-expires (no cleanup needed)
- Sufficient for debugging (not analytics)

### State Hashing

For detecting state divergence between clients:

```typescript
// Sync version (for tests)
function hashState(state: unknown): string {
  // Returns 8-character hex hash
  return "a1b2c3d4";
}

// Async version (for production, uses SHA-256)
async function hashStateAsync(state: unknown): Promise<string>;
```

**Usage in multiplayer:**
1. Server computes hash of authoritative state
2. Clients periodically report their local hash
3. Mismatches trigger state resync

---

## Layer 3: Debug Endpoints

### Available Endpoints

All endpoints require a valid session ID:

#### `GET /api/debug/session/:id/connections`

WebSocket connection info for a session.

```json
{
  "activeConnections": 3,
  "players": [
    {
      "id": "abc",
      "connectedAt": "2024-12-09T10:30:00Z",
      "lastMessage": "2024-12-09T10:35:42Z",
      "messageCount": 42
    }
  ],
  "messageRate": "0.5/sec"
}
```

#### `GET /api/debug/session/:id/clock`

Clock synchronization debug info (populated in Phase 10).

```json
{
  "serverTime": 1699999999999,
  "connectedClients": [
    { "id": "abc", "reportedOffset": 45, "lastPing": 82 }
  ]
}
```

#### `GET /api/debug/session/:id/state-sync`

State consistency verification.

```json
{
  "serverStateHash": "a1b2c3d4",
  "clientHashes": [
    { "playerId": "abc", "hash": "a1b2c3d4", "match": true },
    { "playerId": "def", "hash": "x9y8z7w6", "match": false }
  ]
}
```

#### `GET /api/debug/session/:id/ws-logs`

Recent WebSocket events for the session.

```json
{
  "logs": [
    {
      "type": "ws_connect",
      "timestamp": "2024-12-09T10:30:00Z",
      "sessionId": "abc123",
      "playerId": "xyz"
    },
    {
      "type": "ws_message",
      "timestamp": "2024-12-09T10:30:05Z",
      "sessionId": "abc123",
      "playerId": "xyz",
      "messageType": "toggle_step"
    }
  ]
}
```

Query parameter: `?last=N` (default 100)

#### `GET /api/debug/durable-object/:id`

Durable Object internal state (populated in Phase 8).

```json
{
  "id": "abc123",
  "connectedPlayers": 3,
  "isPlaying": true,
  "currentStep": 12,
  "messageQueueSize": 0,
  "lastActivity": "2s ago"
}
```

---

## Client-Side Debug Overlay

Enable with `?debug=1` in the URL.

### Overlay Sections

```
┌─────────────────────────┐
│ Session                 │
│ ID: abc123...           │
│ Tracks: 8               │
│ Tempo: 120 BPM          │
│ Swing: 25%              │
├─────────────────────────┤
│ Multiplayer             │
│ Status: connected       │  ← Green when connected
│ Player ID: xyz789       │
│ Players: 3              │
│ Messages: 42 sent/recv  │
├─────────────────────────┤
│ Clock Sync              │
│ Offset: +45ms           │
│ RTT: 82ms               │
│ Quality: good           │  ← Green/yellow/red
├─────────────────────────┤
│ State Hash              │
│ Hash: a1b2c3d4          │
│ Last sync: 2s ago       │
├─────────────────────────┤
│ Recent Logs (20)        │
│ 10:35:42 ws [connect]   │
│ 10:35:45 ws [message]   │
├─────────────────────────┤
│ API Endpoints           │
│ → /api/debug/session/...│
│ → .../connections       │
│ → .../clock             │
│ → .../state-sync        │
│ → .../ws-logs           │
└─────────────────────────┘
```

### Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| `disconnected` | Gray | Not connected to multiplayer |
| `connecting` | Yellow | WebSocket handshake in progress |
| `connected` | Green | Active multiplayer session |

| Quality | Color | RTT Threshold |
|---------|-------|---------------|
| `good` | Green | < 100ms |
| `fair` | Yellow | 100-250ms |
| `poor` | Red | > 250ms |

---

## Debugging Workflows

### "User says changes aren't syncing"

```bash
# 1. Check connection status
curl https://keyboardia.../api/debug/session/abc123/connections
# → Are both users actually connected?

# 2. Check state consistency
curl https://keyboardia.../api/debug/session/abc123/state-sync
# → Do hashes match?

# 3. Check message flow
curl https://keyboardia.../api/debug/session/abc123/ws-logs?last=50
# → Did the message arrive at the server?

# 4. Real-time monitoring
wrangler tail --format=pretty | grep "abc123"
# → Watch live message flow
```

### "Playback is out of sync between users"

```bash
# 1. Check clock sync
curl https://keyboardia.../api/debug/session/abc123/clock
# → What's the offset between clients?

# 2. Check DO state
curl https://keyboardia.../api/debug/durable-object/abc123
# → Is the server playing? What step?

# 3. Ask user to check debug overlay
# → Their local offset and RTT
```

### "Session feels laggy"

```bash
# 1. Check message rate
curl https://keyboardia.../api/debug/session/abc123/connections
# → Is messageRate unusually high?

# 2. Check DO queue
curl https://keyboardia.../api/debug/durable-object/abc123
# → Is messageQueueSize backing up?

# 3. Check Cloudflare dashboard
# → Is CPU time spiking?
```

---

## Local Development

### Mock Durable Object

For testing multiplayer without Cloudflare:

```typescript
import { createMockSession, createMockClients } from './worker/mock-durable-object';

const session = createMockSession('test-session');
const [client1, client2] = createMockClients(session, 2);

// Simulate latency
session.simulateLatency(100);

// Send message from client 1
client1.send(JSON.stringify({ type: 'toggle_step', trackId: 0, step: 4 }));

// Client 2 receives broadcast
client2.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};
```

### Multi-Client Development Script

```bash
# Opens two browser windows to the same session with debug mode
npm run dev:multiplayer

# Or with existing session
npm run dev:multiplayer abc123-def456-...
```

---

## File Locations

| File | Purpose |
|------|---------|
| `app/src/worker/logging.ts` | WebSocket logging types and functions |
| `app/src/worker/index.ts` | Debug endpoint handlers |
| `app/src/debug/DebugContext.tsx` | Client-side debug state |
| `app/src/debug/DebugOverlay.tsx` | Debug overlay UI |
| `app/src/debug/DebugOverlay.css` | Overlay styling |
| `app/src/worker/mock-durable-object.ts` | Mock DO for testing |
| `app/scripts/dev-multiplayer.ts` | Multi-client dev script |

---

## CLI Debugging Scripts

Scripts in `app/scripts/` for command-line debugging. Created during Phase 12 bug investigations.

### Quick Reference

| Script | npm alias | Purpose |
|--------|-----------|---------|
| `session-api.ts` | `npm run session` | Session CRUD operations |
| `dev-multiplayer.ts` | `npm run dev:multiplayer` | Local multiplayer testing |
| `analyze-bug-patterns.ts` | `npm run analyze:bugs` | Scan for known bug patterns |
| `analyze-logs.ts` | `npm run analyze:logs` | Analyze application logs |
| `post-fix-analysis.ts` | `npm run post-fix` | Post-fix verification |
| `bug-capture.ts` | `npm run bug:capture` | Interactive bug capture |

### Connection & WebSocket Debugging

These tools diagnose the WebSocket connection storm bug (Phase 12).

#### monitor-connections.ts

Long-running connection health monitor that detects connection storms.

```bash
npx tsx scripts/monitor-connections.ts <session-id> [duration-minutes] [base-url]

# Examples:
npx tsx scripts/monitor-connections.ts test-session 15 http://localhost:8787
npx tsx scripts/monitor-connections.ts prod-session 30 https://keyboardia.adewale-883.workers.dev
```

**Features:** Tracks connection stability, detects storms (>5 reconnects in 10 seconds), reports peak/min counts.

#### analyze-ws-storm.ts

Analyzes wrangler tail logs for reconnection storm patterns.

```bash
# Live analysis
npx wrangler tail keyboardia --format json | npx tsx scripts/analyze-ws-storm.ts

# From saved logs
npx tsx scripts/analyze-ws-storm.ts --file /path/to/logs.json
```

#### debug-ws-storm-local.ts

Reproduces WebSocket storms locally for debugging.

```bash
npx tsx scripts/debug-ws-storm-local.ts
```

### State & Hash Debugging

Created to diagnose state hash mismatch issues (Phase 12).

#### debug-state-hash.ts

Diagnoses client/server state hash mismatches.

```bash
npx tsx scripts/debug-state-hash.ts <session-id>
npx tsx scripts/debug-state-hash.ts <session-id> --local
```

**Features:** Fetches session, computes hash, compares field-by-field for differences.

#### compare-sessions.ts

Compares state between two sessions.

```bash
npx tsx scripts/compare-sessions.ts <session-id-1> <session-id-2>
```

### Session Inspection

#### debug-session.ts

Deep inspection of session state and connections.

```bash
npx tsx scripts/debug-session.ts <session-id>
npx tsx scripts/debug-session.ts <session-id> --full        # Complete dump
npx tsx scripts/debug-session.ts <session-id> --ws-logs     # WebSocket logs
npx tsx scripts/debug-session.ts <session-id> --connections # Active connections
```

#### debug-metrics.ts

View WebSocket metrics from Durable Object.

```bash
npx tsx scripts/debug-metrics.ts <session-id>
```

### Testing Utilities

#### create-test-sessions.ts

Creates test sessions with sample data.

```bash
npx tsx scripts/create-test-sessions.ts
```

#### trigger-state-changes.ts

Triggers state changes for testing sync behavior.

```bash
npx tsx scripts/trigger-state-changes.ts <session-id>
```

#### ci-connection-stability.ts

CI-friendly connection stability test.

```bash
npx tsx scripts/ci-connection-stability.ts
```

### Bug Analysis

#### analyze-bug-patterns.ts

Scans codebase for known bug patterns. Runs automatically on pre-commit.

```bash
npm run analyze:bugs
npm run analyze:bugs -- --pattern unstable-callback-in-effect
```

**Detected patterns:** Unstable callbacks in useEffect (connection storm), serialization mismatches, singleton issues.

**Reference:** [BUG-PATTERNS.md](../docs/BUG-PATTERNS.md)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `https://keyboardia.adewale-883.workers.dev` | Production API |
| `LOCAL_API` | `http://localhost:8787` | Local dev API |
| `DEBUG` | - | Enable verbose logging |

---

## Testing

### Unit Tests

```bash
# WebSocket logging tests (17 tests)
npm test -- --run src/worker/logging.test.ts

# Mock DO tests (18 tests)
npm test -- --run src/worker/mock-durable-object.test.ts
```

### Integration Testing

The Mock DO supports testing scenarios like:

- Multiple clients receiving broadcasts
- Player join/leave notifications
- State sync on connect
- Simulated latency
- Simulated disconnects

---

## Audio Debugging (Phase 29)

### Browser Console API

Access via `window.audioDebug` in the browser console after page load:

```javascript
// Show full audio system status
await window.audioDebug.status()

// Test a specific instrument
await window.audioDebug.testInstrument('advanced:supersaw')

// Test all advanced synths (Fat Saw, Thick, etc.)
await window.audioDebug.testAdvancedSynths()

// Test ALL instruments across all categories
await window.audioDebug.testAllInstruments()

// Debug the audio connection chain
await window.audioDebug.debugConnectionChain()

// Check if a specific preset exists
window.audioDebug.checkPreset('advanced:thick-lead')
```

### Common Issues

| Symptom | Likely Cause | Debug Command |
|---------|--------------|---------------|
| No sound on hover preview | Tone.js not initialized | `await audioDebug.status()` |
| Advanced synths silent | Audio context suspended | `audioDebug.debugConnectionChain()` |
| Sampled instruments not playing | Samples not preloaded | `audioDebug.testInstrument('sampled:piano')` |

### File Location

| File | Purpose |
|------|---------|
| `app/src/debug/audio-debug.ts` | Browser console debugging API |

---

## Future Enhancements (Not in Phase 7)

- **Structured logging to external service** (Datadog, Logtail)
- **Distributed tracing** (correlate requests across DO instances)
- **Alerting** on error rate spikes
- **Replay** of WebSocket sessions for debugging

These are deferred because KV-based logging is sufficient for initial multiplayer launch.

---

*Document created: December 2025*
*Phase 7 implementation complete*
*Phase 29: Added audio debugging tools*
