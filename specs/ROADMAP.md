# Next Steps: Cloudflare Implementation

## Why Cloudflare Works Well Here

| Requirement | Cloudflare Solution |
|-------------|---------------------|
| Real-time WebSockets | Durable Objects handle WebSocket connections with state |
| Session isolation | Each session = one Durable Object instance |
| Low latency | Edge network, Durable Objects placed near first user |
| No server management | Fully serverless |
| Sample storage | R2 for temporary audio files |
| Session persistence | KV for saving/sharing patterns |
| Simple deployment | Pages + Workers in one project |

---

## Implementation Phases

> **Design principle:** Get to playable sound as fast as possible. The app works offline first, adds persistence, then multiplayer sync.

### Phase 1: Local Audio Playground (Single Player) ✅ Sound works!

Build a standalone step sequencer that runs entirely in the browser — no backend required.

1. **Set up frontend project**
   ```bash
   npm create vite@latest keyboardia -- --template react-ts
   cd keyboardia && npm install
   ```

2. **Core audio modules:**
   ```
   src/
   ├── App.tsx
   ├── components/
   │   ├── StepSequencer.tsx  # 16-step grid
   │   ├── StepCell.tsx       # Individual step toggle
   │   ├── Transport.tsx      # Play/stop, tempo slider
   │   └── TrackRow.tsx       # One row of steps + sample selector
   ├── audio/
   │   ├── engine.ts          # AudioContext, sample loading
   │   ├── scheduler.ts       # Lookahead scheduling pattern
   │   ├── samples.ts         # Synthesized preset samples
   │   └── synth.ts           # Real-time synthesizer engine
   ├── state/
   │   └── grid.ts            # Local grid state (React Context + useReducer)
   └── types.ts
   ```

3. **Audio engine implementation:**
   - Create AudioContext on first user click
   - Synthesized samples (16 sounds: drums, bass, synth, FX)
   - Real-time synth engine (5 presets: bass, lead, pad, pluck, acid)
   - Implement lookahead scheduler (25ms timer, 100ms lookahead)
   - Gated playback: samples cut off at step boundary

4. **UI:**
   - Up to 16 tracks × 16 steps grid
   - Click to toggle steps
   - Shift+click for parameter locks (pitch, volume)
   - Play/stop button
   - Tempo slider (60-180 BPM)
   - Swing slider (0-100%)

**Outcome:** User can create beats and hear them immediately. No account, no backend, no network.

---

### Phase 2: Mic Recording & Custom Instruments (Still Single Player) ✅

Add the ability to record custom samples that become new instruments.

1. **Recording module:**
   ```
   src/audio/
   └── recorder.ts            # MediaRecorder wrapper
   ```

2. **Recording features:**
   - Hold-to-record button (max 5 seconds, auto-stop at limit)
   - Preview before adding to grid
   - Store recorded samples in memory (ArrayBuffer → AudioBuffer)
   - Auto-slice with transient detection

3. **Recording becomes a new instrument (track):**
   - "Add to Grid" creates a **new track** with the recording as its sample
   - Original preset instruments remain unchanged (additive, not destructive)
   - New track starts with empty step pattern
   - Maximum 16 tracks enforced

4. **Track management:**
   - Copy sequence: copy step pattern from one track to another
   - Delete track: remove custom recording tracks
   - Clear track: remove all steps from a track

**Outcome:** User can record sounds that become new instruments alongside the presets, and copy beat patterns between tracks.

---

### Phase 3: Session Persistence & Sharing ✅ COMPLETE

Save sessions to KV storage so users can share links and return to their work.

> See [SESSION-SHARING.md](./SESSION-SHARING.md) for full specification.

1. **Create KV namespace:**
   ```bash
   npx wrangler kv namespace create SESSIONS
   ```

2. **Update wrangler.jsonc:**
   ```jsonc
   {
     "kv_namespaces": [
       {
         "binding": "SESSIONS",
         "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
       }
     ]
   }
   ```

3. **Worker API endpoints:**
   ```
   worker/
   ├── index.ts              # Entry point, routes requests
   ├── sessions.ts           # Session CRUD operations
   └── types.ts              # Shared types
   ```

   | Endpoint | Method | Description |
   |----------|--------|-------------|
   | `/api/sessions` | POST | Create new session |
   | `/api/sessions/{uuid}` | GET | Load session |
   | `/api/sessions/{uuid}` | PUT | Save session (debounced auto-save) |
   | `/api/sessions/{uuid}/remix` | POST | Remix session |

4. **Session data model:**
   ```typescript
   interface Session {
     id: string;                    // UUID v4 (unguessable)
     createdAt: number;
     updatedAt: number;
     remixedFrom: string | null;     // Parent session ID
     state: {
       tracks: Track[];
       tempo: number;
       swing: number;
       version: number;             // Schema version
     };
   }
   ```

5. **Frontend integration:**
   ```
   src/sync/
   └── session.ts             # Load, save, remix sessions
   ```

   - Auto-save with 2-second debounce
   - Update URL on session create/remix
   - Handle invalid session IDs gracefully

6. **URL scheme:**
   ```
   /                           # New empty session (generates UUID)
   /s/{uuid}                   # Load existing session
   /s/{uuid}/remix              # Remix to new session
   ```

7. **UI additions:**
   - Share button (copy URL to clipboard)
   - Remix button (create editable copy)
   - New button (create fresh session)
   - Handle "session not found" error

**Outcome:** Users can share a link to their pattern. Anyone with the link can view, edit, or remix it. Sessions persist permanently.

---

### Phase 4: Extended Patterns & Cloudflare Backend Setup ✅ (Partial)

Extend beat lengths beyond 1 bar, and set up infrastructure for multiplayer.

#### 4A: Per-Track Step Count ✅ IMPLEMENTED

Each track can have a different step count, creating polyrhythmic patterns.

> **Design decision:** We chose actual step count (4/8/12/16/24/32/64) over multipliers because:
> - Simpler mental model — "8 steps" is clearer than "0.5x multiplier"
> - All steps are visible and editable (with inline scrolling)
> - Matches hardware like Elektron Digitakt and OP-Z

```typescript
interface Track {
  // ... existing fields
  stepCount: 4 | 8 | 12 | 16 | 24 | 32 | 64;  // Default: 16
}
```

| Step Count | Bars | Loops/Bar | Use Case |
|------------|------|-----------|----------|
| **4** | 0.25 | 4× | Four-on-the-floor kick, pulse patterns, motorik beat |
| **8** | 0.5 | 2× | Half-bar phrases, 8th-note arpeggios, Afrobeat percussion |
| **12** | 0.75 | 1.33× | Triplet feel, jazz/gospel shuffle, waltz |
| 16 | 1 | 1× | Standard drums, basslines |
| **24** | 1.5 | 0.67× | Triplet hi-hats (trap), Afro-Cuban rhythms |
| 32 | 2 | 0.5× | Basslines with variation, 2-bar melodies |
| 64 | 4 | 0.25× | Long melodies, chord progressions, evolving patterns |

**Polyrhythmic possibilities:**

| Combo | Resolution | Musical Style |
|-------|------------|---------------|
| 4 vs 16 | 1 bar | Pulse under complex melody (minimal techno) |
| 4 vs 32 | 2 bars | Hypnotic repetition (Berlin minimal) |
| 8 vs 16 | 1 bar | Half-time feel (boom-bap, lo-fi) |
| 8 vs 12 | LCM=24 | Afrobeat / West African clave |
| 12 vs 16 | LCM=48 | Jazz swing against straight time |
| 16 vs 24 | LCM=48 | Trap hi-hat rolls over standard drums |
| 4 vs 8 vs 16 | 1 bar | Layered polyrhythm |

**How it works:**
- Each track shows its actual number of steps (with horizontal scrolling if needed)
- Step count **dropdown** in track controls (7 options including triplet grids)
- Global counter runs 0-63 (MAX_STEPS)
- Each track calculates position: `globalStep % track.stepCount`
- Playhead per track shows that track's position

**Implementation:**
```typescript
// In scheduler - each track loops independently
const trackStepCount = track.stepCount ?? 16;
const trackStep = globalStep % trackStepCount;
if (track.steps[trackStep]) { /* play */ }

// In UI - each track shows its own playing position
const trackPlayingStep = globalStep >= 0 ? globalStep % trackStepCount : -1;

// Step count options in types.ts (includes triplet grids: 12, 24)
export const STEP_COUNT_OPTIONS = [4, 8, 12, 16, 24, 32, 64] as const;
```

**Visual design:**
- Page separators every 16 steps (subtle gap)
- Inline scrolling when steps exceed viewport width
- Fixed-width track controls prevent layout shift during playback
- Dropdown replaces buttons for cleaner scaling

**Example sessions demonstrating polyrhythms:**
- Polyrhythm Demo: `/s/cab63f7d-7aea-4e26-b990-2ce7d5d1401c`
- Afrobeat Groove: `/s/4c889c91-1c43-4c4a-ab8a-4a2bff3f50fd`

#### Pattern Chaining (Future)

Chain multiple patterns for song arrangement — deferred to future phase.

#### Future Polyrhythm Enhancements (Ideas)

Features that would complement the current polyrhythmic capabilities:

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| **Euclidean rhythms** | Auto-distribute N hits across M steps | Medium | High |
| **Per-track swing** | Different swing per track (J Dilla style) | Low | Medium |
| **Step rotation** | Rotate pattern by N steps (phase shifting) | Low | Medium |
| **Conditional triggers** | Probability per step (0-100%) | Medium | High |
| **Ratcheting** | Multiple triggers per step (fills, glitches) | Medium | Medium |
| **Step multipliers** | Alternative to step count for some use cases | Low | Low |

These features are informed by hardware like Elektron Digitakt, OP-Z, and Ableton Push.

#### 4B: Chromatic Step View

> **Problem:** Creating melodies requires multiple tracks (one per pitch) or tedious per-step parameter lock editing. Tools like Ableton's Learning Music use a piano roll where clicking places notes at different pitches intuitively.

**Research Summary:**

| Approach | Pros | Cons |
|----------|------|------|
| Full piano roll modal | Familiar paradigm | Violates inline philosophy, modal workflow |
| Auto-generate tracks from piano roll | Uses existing model | Track explosion, confusing |
| Enhanced p-lock UI | Minimal change | Still step-by-step, no contour view |
| **Chromatic Step View** | Inline, visual, click-to-place | More vertical space when expanded |

**Recommended: Chromatic Step View**

Expand synth track rows to show a mini piano roll inline (not modal):

```
Track: Lead [M] [-][+3][+] [16] [▼]
├──────────────────────────────────────────────────────────────────┤
│ +7 (G) │ ●─────────●───────────────────●                         │
│ +4 (E) │ ────●───●─────────●─────────────●                       │
│ +2 (D) │ ──────────────●───────●─────────────●                   │
│  0 (C) │ ──────────────────────────●─────────────●               │
│ -3 (A) │ ────────────────────────────────────────────●           │
├──────────────────────────────────────────────────────────────────┤
│          1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16          │
└──────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Inline, not modal** — Expands within track row, collapses back
- **Click-to-place** — Same simplicity as piano roll
- **Monophonic** — One pitch per step (use multiple tracks for chords)
- **Uses existing data model** — `parameterLocks[].pitch` already supports this
- **4 octaves range** — ±24 semitones for cinematic, orchestral, and bass music

**UI Philosophy Alignment:**

| Principle | Alignment | Notes |
|-----------|-----------|-------|
| Controls live where they act | ✅ Pass | Pitch grid is inline with track |
| Visual feedback is immediate | ✅ Pass | Notes appear instantly, contour visible |
| No confirmation dialogs | ✅ Pass | Click = place, click again = remove |
| Modes are visible | ⚠️ Partial | Expand toggle must be obvious |
| Progressive disclosure | ✅ Pass | Normal = simple, expand = power feature |

**Mitigations for mode concern:**
1. Show **pitch contour line** on collapsed view (see melody shape without expanding)
2. Expand toggle is **always visible** on synth tracks (not hidden in menu)
3. Expanded state **persists** per track (no surprise collapses)

**Collapsed view with contour overlay:**
```
[M] Lead [●][♪]  [■][■][□][■][□][■]...  [▼][CLR]
                  ╭─╮   ╭───╮   ╭─╮      ← pitch contour
```

**Implementation phases:**
1. Add expand/collapse toggle to synth track rows
2. Render pitch rows (2 octaves: -12 to +12 semitones)
3. Click-to-place note at pitch/step intersection
4. Visual melody contour line on collapsed view
5. Keyboard shortcuts (up/down to adjust selected step's pitch)

**Effort estimate:** ~1 week

---

### Phase 5: Sharing UI Polish ✅ COMPLETE

Complete the sharing model defined in [SESSION-LIFECYCLE.md](./SESSION-LIFECYCLE.md).

> **Note:** The original "Sessions vs Beats" concept has been moved to Phase 12 (Publishing Platform) for reconsideration. The current Invite/Send Copy/Remix model covers core sharing needs.

#### Remaining Tasks

1. **Button renaming:**
   - Rename "Share" → "Invite" (copies current session URL)
   - Add "Send Copy" button (creates remix, copies that URL, stays here)

2. **Remix lineage display:**
   - Show "Remixed from {parent name}" in session header
   - Show "{n} remixes" count (social proof)
   - Link to parent session (if exists)

3. **Tracking fields:**
   - Add `lastAccessedAt` to sessions
   - Add `remixCount` to sessions
   - Increment on remix

4. **Orphan banner:**
   - Show informational banner for sessions inactive 90+ days
   - Dismissible, auto-dismissed on edit

> See [SESSION-LIFECYCLE.md](./SESSION-LIFECYCLE.md) for full specification of sharing modes, state machine, and orphan handling.

**Outcome:** Polished sharing experience with clear terminology and remix lineage visibility.

---

### Phase 6: Observability ✅ COMPLETE

Add logging, metrics, and debugging tools to understand system behavior and diagnose issues.

> **Motivation:** Without observability, debugging issues like "session appears empty after creation" requires guesswork. Structured logging and metrics endpoints make it easy to trace requests, understand state changes, and identify root causes.

#### 1. Structured Request Logging

Add request/response logging to all API endpoints:

```typescript
interface RequestLog {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  sessionId?: string;

  // Request details
  requestBody?: {
    trackCount?: number;
    tempo?: number;
    swing?: number;
  };

  // Response details
  status: number;
  responseTime: number;

  // Session state (for debugging)
  sessionState?: {
    trackCount: number;
    hasData: boolean;
  };

  error?: string;
}
```

#### 2. Debug Endpoints

```
GET /api/debug/session/:id
Response:
{
  "id": "...",
  "exists": true,
  "createdAt": "...",
  "updatedAt": "...",
  "state": {
    "trackCount": 10,
    "tempo": 108,
    "swing": 15,
    "tracks": [
      { "id": "track-1", "sampleId": "kick", "activeSteps": 8 },
      ...
    ]
  },
  "sizeBytes": 4521
}

GET /api/debug/logs?sessionId=xxx&last=100
Response:
{
  "logs": [
    { "timestamp": "...", "requestId": "...", "method": "POST", ... },
    ...
  ]
}
```

#### 3. Session Metrics Endpoint

```
GET /api/metrics
Response:
{
  "sessions": {
    "total": 1234,
    "activeToday": 89,
    "createdToday": 12
  },
  "requests": {
    "last5Minutes": {
      "creates": 5,
      "reads": 42,
      "updates": 18
    }
  }
}
```

#### 4. Client-Side Debug Mode

Add `?debug=1` query parameter to enable:
- Console logging of all session operations
- Display session ID and state in UI
- Show network request/response in overlay

#### 5. Playwright Debug Tests

Create E2E tests that:
1. Create a session via API with known data
2. Load the session in browser
3. Verify the loaded state matches created state
4. Log all intermediate states for debugging

```typescript
test('session persistence integrity', async ({ page, request }) => {
  // Create session via API
  const createRes = await request.post('/api/sessions', {
    data: { tracks: [...], tempo: 108, swing: 15, version: 1 }
  });
  const { id } = await createRes.json();

  // Fetch session via API to verify it was saved
  const fetchRes = await request.get(`/api/sessions/${id}`);
  const session = await fetchRes.json();
  console.log('API session state:', JSON.stringify(session.state, null, 2));

  // Load in browser
  await page.goto(`/s/${id}`);
  await page.waitForSelector('.tracks');

  // Check what the browser sees
  const trackCount = await page.locator('.track-row').count();
  console.log('Browser track count:', trackCount);

  expect(trackCount).toBe(session.state.tracks.length);
});
```

**Outcome:** Ability to trace any request through the system and quickly identify where data is lost or corrupted.

---

### Phase 7: Multiplayer Observability & Testing Infrastructure ✅

Build the debugging, logging, and testing infrastructure needed to safely implement multiplayer.

> **Motivation:** Multiplayer introduces WebSocket connections, distributed state, and clock synchronization — all harder to debug than HTTP requests. This phase ensures we can see what's happening and verify correctness.

#### 1. WebSocket Lifecycle Logging

Extend the logging system to cover WebSocket events:

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
  duration?: number;
}
```

Console output:
```
[WS] connect session=abc123 player=xyz
[WS] message session=abc123 player=xyz type=toggle_step
[WS] disconnect session=abc123 player=xyz reason=closed duration=342s
```

#### 2. Debug Endpoints for Multiplayer

```
GET /api/debug/session/:id/connections
{
  "activeConnections": 3,
  "players": [
    { "id": "abc", "connectedAt": "...", "lastMessage": "...", "messageCount": 42 }
  ],
  "messageRate": "12/sec"
}

GET /api/debug/session/:id/clock
{
  "serverTime": 1699999999999,
  "connectedClients": [
    { "id": "abc", "reportedOffset": 45, "lastPing": 82 }
  ]
}

GET /api/debug/session/:id/state-sync
{
  "serverStateHash": "abc123",
  "clientHashes": [
    { "playerId": "abc", "hash": "abc123", "match": true },
    { "playerId": "def", "hash": "xyz789", "match": false }
  ]
}

GET /api/debug/durable-object/:sessionId
{
  "id": "...",
  "connectedPlayers": 3,
  "isPlaying": true,
  "currentStep": 12,
  "messageQueueSize": 0,
  "lastActivity": "2s ago"
}
```

#### 3. Client-Side Debug Overlay Additions

Extend `?debug=1` mode with multiplayer info:

```
┌─────────────────────────┐
│ Multiplayer             │
│ Status: connected       │
│ Players: 3              │
│ Messages: 142 sent/recv │
├─────────────────────────┤
│ Clock Sync              │
│ Offset: +45ms           │
│ RTT: 82ms               │
│ Quality: good           │
├─────────────────────────┤
│ State Hash: abc123      │
│ Last sync: 2s ago       │
└─────────────────────────┘
```

#### 4. State Consistency Verification

Hash-based state comparison to detect divergence:

```typescript
function hashState(state: GridState): string {
  return crypto.subtle.digest('SHA-256', JSON.stringify(state));
}

// Periodic verification (every 5 seconds)
{ type: "state_hash", sessionId, playerId, hash: "abc123" }

// Server detects mismatch
{ type: "state_mismatch", sessionId, players: ["abc", "def"] }
```

#### 5. Testing Infrastructure

**Unit tests for Durable Object:**
```typescript
describe('LiveSessionDurableObject', () => {
  test('broadcasts step toggle to all clients');
  test('handles player disconnect gracefully');
  test('rejects 11th connection (max 10)');
  test('recovers state after hibernation');
});
```

**Multi-client integration tests:**
```typescript
test('two clients see same state', async () => {
  const client1 = await connectWebSocket(session.id);
  const client2 = await connectWebSocket(session.id);

  client1.send({ type: 'toggle_step', trackId: 0, step: 4 });

  await waitFor(() => {
    expect(client1.state.tracks[0].steps[4]).toBe(true);
    expect(client2.state.tracks[0].steps[4]).toBe(true);
  });
});
```

**Playwright multi-context E2E tests:**
```typescript
test('multiplayer jam session', async ({ browser }) => {
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  await page1.goto('/s/test-session');
  await page2.goto('/s/test-session');

  await page1.click('[data-track="0"][data-step="4"]');
  await expect(page2.locator('[data-track="0"][data-step="4"]')).toHaveClass(/active/);
});
```

**Network failure tests:**
```typescript
test('handles WebSocket disconnect and reconnect');
test('queues changes during disconnect');
test('replays queued changes on reconnect');
test('falls back to single-player if DO unavailable');
```

#### 6. Local Development Tools

**Mock Durable Object for local dev:**
```typescript
class MockLiveSession {
  private clients: Map<string, MockWebSocket> = new Map();

  connect(playerId: string): MockWebSocket { ... }
  broadcast(message: any) { ... }
  simulateLatency(ms: number) { ... }
  simulateDisconnect(playerId: string) { ... }
}
```

**Multi-client dev script:**
```bash
npm run dev:multiplayer
# Opens localhost:5173/s/dev-session in two browser windows
```

**Outcome:** Complete observability into WebSocket connections, state sync, and clock synchronization. Test infrastructure ready for multiplayer development.

---

### Phase 8: Cloudflare Backend Setup

Set up the infrastructure for multiplayer — but keep single-player working as fallback.

1. **Create Cloudflare account** (if needed)
   - Durable Objects are available on the free tier (with SQLite storage backend)

2. **Initialize Cloudflare project**
   ```bash
   # Add Cloudflare worker to existing project
   npm install wrangler --save-dev
   ```

3. **Configure wrangler.jsonc**
   ```jsonc
   // wrangler.jsonc (recommended over wrangler.toml for new projects)
   {
     "$schema": "./node_modules/wrangler/config-schema.json",
     "name": "keyboardia",
     "main": "worker/index.ts",
     "compatibility_date": "2025-01-01",
     "assets": {
       "directory": "./dist"
     },
     "kv_namespaces": [
       {
         "binding": "SESSIONS",
         "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
       }
     ],
     "durable_objects": {
       "bindings": [
         {
           "name": "LIVE_SESSIONS",
           "class_name": "LiveSessionDurableObject"
         }
       ]
     },
     "migrations": [
       {
         "tag": "v1",
         "new_sqlite_classes": ["LiveSessionDurableObject"]
       }
     ],
     "r2_buckets": [
       {
         "binding": "SAMPLES",
         "bucket_name": "keyboardia-samples"
       }
     ]
   }
   ```

4. **Set up R2 bucket**
   ```bash
   npx wrangler r2 bucket create keyboardia-samples
   ```

5. **Worker structure:**
   ```
   worker/
   ├── index.ts              # Entry point, routes requests
   ├── sessions.ts           # KV session CRUD (from Phase 3)
   ├── live-session.ts       # LiveSessionDurableObject class
   └── types.ts              # Shared types
   ```

**Outcome:** Backend is deployed with KV (persistence) + DO (real-time) + R2 (samples).

---

### Phase 9: Multiplayer State Sync

Connect the frontend to the backend. Grid state becomes shared in real-time.

1. **Durable Object implementation:**

   **Key responsibilities of LiveSessionDurableObject:**
   - Accept WebSocket connections (up to 10 per session)
   - Maintain authoritative session state (grid, clips, tempo)
   - Broadcast state changes to all connected clients
   - Auto-cleanup when all players disconnect

   **Skeleton (using modern Hibernation API):**
   ```typescript
   import { DurableObject } from 'cloudflare:workers';

   export class LiveSessionDurableObject extends DurableObject<Env> {
     sessions: Map<WebSocket, PlayerInfo> = new Map();
     gridState: GridState;

     constructor(ctx: DurableObjectState, env: Env) {
       super(ctx, env);
       // Restore sessions from hibernation
       this.ctx.getWebSockets().forEach((ws) => {
         const attachment = ws.deserializeAttachment() as PlayerInfo;
         if (attachment) {
           this.sessions.set(ws, attachment);
         }
       });
       // Auto-respond to ping/pong for connection health
       this.ctx.setWebSocketAutoResponse(
         new WebSocketRequestResponsePair('ping', 'pong')
       );
     }

     async fetch(request: Request) {
       if (request.headers.get("Upgrade") === "websocket") {
         return this.handleWebSocket(request);
       }
       return this.handleHTTP(request);
     }

     async handleWebSocket(request: Request) {
       const [client, server] = Object.values(new WebSocketPair());
       this.ctx.acceptWebSocket(server);  // Use ctx, not state
       const playerInfo: PlayerInfo = { id: crypto.randomUUID(), /* ... */ };
       server.serializeAttachment(playerInfo);  // Persist for hibernation
       this.sessions.set(server, playerInfo);
       return new Response(null, { status: 101, webSocket: client });
     }

     // Hibernation-compatible event handlers (not addEventListener)
     async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
       // Handle: toggle_step, tempo_change, etc.
       // Broadcast to all other clients
     }

     async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
       this.sessions.delete(ws);
       // Broadcast player leave, cleanup if empty
     }
   }
   ```

2. **Frontend sync layer:**
   ```
   src/sync/
   ├── websocket.ts       # Connection management, reconnection
   ├── state.ts           # Sync local state with server
   └── offline.ts         # Queue changes when disconnected
   ```

3. **State sync messages:**
   ```typescript
   // Sent on any grid change
   { type: "toggle_step", trackId: 0, step: 4 }

   // Received: state update
   { type: "step_changed", trackId: 0, step: 4, value: true }

   // Received on join: full snapshot
   { type: "snapshot", grid: [...], tempo: 120, players: [...] }
   ```

**Outcome:** Two players see the same grid. Clicking a step updates both screens.

---

### Phase 10: Clock Sync (Multiplayer Audio)

Synchronize playback so all players hear the same thing at the same time.

1. **Server clock authority:**
   ```typescript
   // Server sends every 50ms:
   { type: "clock", serverTime: 1699999999999, beat: 4, bar: 2 }

   // Client calculates offset:
   offset = serverTime - Date.now() + (rtt / 2)
   ```

2. **Update scheduler:**
   - Switch from local clock to server-relative timing
   - Schedule notes using `serverTimeToAudioTime()` conversion
   - Handle clock drift with periodic re-sync

3. **Quantized actions:**
   - Step toggles take effect on next bar (optional)
   - Tempo changes sync across all clients

**Outcome:** Multiple players hear identical audio at the same moment (within 20ms).

---

### Phase 11: Presence & Awareness ✅ COMPLETE

Make multiplayer feel alive and prevent the "poltergeist" problem (unexplained changes).

> **Research:** See [MULTIPLAYER-PRESENCE-RESEARCH.md](./research/MULTIPLAYER-PRESENCE-RESEARCH.md)
> **Lessons Learned:** See [Multiplayer_lessons.md](../app/docs/Multiplayer_lessons.md)

#### ✅ Implemented

**Anonymous Identities (Backend)**
- **18 colors × 73 animals** = 1,314 unique combinations
- Identity generated deterministically from playerId hash
- Sent to clients in `player_joined` message and initial snapshot
- Hard cap: **10 concurrent editors**

**Change Attribution (Backend)**
- All broadcasts include `playerId` for attribution
- Player info includes color, colorIndex, animal, and display name

**State Integrity (Hardening)**
- **Invariant validation** — `validateStateInvariants()` checks for corruption
- **Auto-repair** — `repairStateInvariants()` fixes recoverable issues
- **DO Alarms** — `ctx.storage.setAlarm()` replaces setTimeout (survives hibernation)
- **Production logging** — `logInvariantStatus()` logs violations to Cloudflare logs

#### ✅ Also Implemented (Phase 11 UI)

**1. Session Naming** ✅ (Originally deferred, now complete)
- Inline editable session name in header (`SessionName.tsx`)
- Updates browser tab `<title>` dynamically
- Persisted via PATCH `/api/sessions/:id/name`

**2. Avatar Stack UI** ✅
- `AvatarStack.tsx` shows connected players with color dots
- Shows up to 5 players, then "+N" for overflow
- Displays player animal names on hover

**3. Cursor Tracking** ✅
- `CursorOverlay.tsx` shows remote cursor positions
- Throttled to 50ms updates
- Fades out after inactivity
- **Hidden on mobile** — cursor arrows are misleading on small screens because desktop and mobile layouts differ significantly; the same grid position points to different visual locations. Mobile users see presence via the avatar stack instead.

**4. Visual Change Attribution** ✅
- `RemoteChangeContext.tsx` tracks who made each change
- Step toggles flash with player's color (600ms)
- `ToastNotification.tsx` for player join/leave events

**Outcome:** Users always know who's in the session, where they're working, and who made each change.

> **Note:** Beat-Quantized Changes moved to Phase 21 as a standalone feature requiring dedicated design work.

---

### Phase 12: Error Handling & Testing ✅ COMPLETE

Ensure reliability before adding more features.

#### ✅ Implemented

**Error Handling:**
- **WebSocket reconnection** with exponential backoff + jitter ✅
- **Graceful degradation** to single-player mode after 10 failed attempts ✅
- **Connection status indicator** in header (`ConnectionStatus.tsx`) ✅
  - Shows: connected (green), connecting (yellow pulse), disconnected (red), single_player (gray)
- **Offline queue** — buffers changes during disconnect ✅
- **Manual retry** — button to attempt reconnection from single-player mode ✅

**Testing:**
- Unit tests for DO message handlers ✅ (378 tests passing)
- Mock Durable Object for local testing ✅

#### ✅ Also Implemented (Unit Tests)

**Testing (Vitest only - 443 tests passing):**
- [x] WebSocket reconnection logic unit tests (exponential backoff with jitter)
- [x] Offline queue behavior tests (queue, replay, dedup, stale message handling)
- [x] Clock sync algorithm tests (offset calculation, RTT handling, median filtering)
- [x] State hash comparison tests (deterministic hash, change detection)
- [x] Message serialization/deserialization tests (actionToMessage, validation)
- [x] Connection state machine tests (transitions, graceful degradation, retry)

#### ✅ Polish Items (Implemented)

The following polish/optimization work was completed:

- **Stale session handling** ✅ — Periodic state hash checks (every 30s) with auto-recovery after 2 consecutive mismatches
- **WebSocket latency measurement** ✅ — RTT tracking with P95 calculation (target: <100ms p95)
- **State sync accuracy measurement** ✅ — Clock drift tracking between syncs (target: <50ms drift)
- **Message optimization** ✅ — Using synchronized hash function for efficient state comparison

**Outcome:** Multiplayer is reliable and tested. Users can trust it won't lose their work.

---

### Phase 13A: Backend Hardening (Cloudflare Best Practices) ✅ COMPLETE

Apply Cloudflare-recommended patterns to improve reliability and reduce costs.

> **Source:** [Cloudflare DO WebSocket Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

#### ✅ Implemented

| Improvement | Location | Description |
|-------------|----------|-------------|
| **Worker-level validation** | worker/validation.ts | Validate requests BEFORE routing to DO (saves DO billing) |
| **UUID format validation** | worker/index.ts | Reject malformed session IDs early |
| **Body size validation** | worker/index.ts | Check Content-Length before parsing JSON |
| **Session state validation** | worker/validation.ts | Validate tempo, swing, tracks against invariants |
| **Session name XSS prevention** | worker/validation.ts | Block `<script>`, `javascript:`, event handlers |
| **Stub recreation on errors** | worker/index.ts | Recreate DO stub on retryable errors |
| **Overload error handling** | worker/index.ts | Return 503 on DO overload (no retry) |
| **Request timeouts** | sync/session.ts | AbortController with 10-15s timeouts |

**Outcome:** Backend follows Cloudflare best practices, reducing costs and improving reliability.

---

### Phase 13B: Frontend Hardening ✅ COMPLETE

Address remaining technical debt from code audit.

> **Source:** Comprehensive codebase audit (December 2025)
> **Lessons Learned:** See [PHASE-13B-LESSONS.md](./research/PHASE-13B-LESSONS.md)

#### ✅ Critical Issues (Fixed)

| Issue | Location | Fix |
|-------|----------|-----|
| Race condition in session loading | useSession.ts | State machine: `idle` → `loading` → `applying` → `ready` |
| WebSocket message ordering | live-session.ts, multiplayer.ts | Client/server sequence numbers for ordering |
| Missing Error Boundary | App.tsx | React Error Boundary with recovery UI |

#### ✅ High Priority Issues (Fixed)

| Issue | Location | Fix |
|-------|----------|-----|
| Memory leak in RemoteChangeContext | RemoteChangeContext.tsx | Track timers in Set, clear in cleanup |
| Audio volume reset timers | scheduler.ts | Added `pendingTimers` Set with cleanup on `stop()` |
| Missing null check | multiplayer.ts | Defensive null checks with fallback |
| Race condition in useMultiplayer | useMultiplayer.ts | Cancellation flag pattern |
| Unbounded message queue | multiplayer.ts | Priority queue: `high` > `normal` > `low` |

#### ✅ Medium Priority Issues (Fixed)

| Issue | Location | Fix |
|-------|----------|-----|
| Inconsistent constants | types.ts vs worker/invariants.ts | Aligned server to client bounds + parity tests |
| Missing error handling in audio decode | engine.ts | try/catch with meaningful error messages |
| Scheduler timing drift | scheduler.ts | Multiplicative timing: `startTime + (stepCount * duration)` |
| Missing mic cleanup | recorder.ts | `releaseMicAccess()` stops MediaStream tracks |

#### 🔲 Low Priority Issues (Deferred to Phase 15)

| Issue | Status | Notes |
|-------|--------|-------|
| Console logging in production | ✅ Done | Created `logger.ts` with dev-only logging, updated all client files |
| Magic numbers | ✅ Partial | Many extracted to `types.ts` (MAX_STEPS, tempos, swing) — some remain |
| Inconsistent naming | ✅ Reviewed | Actually follows React conventions: `on*` (props), `handle*` (handlers), `send*` (network) |

#### Documentation Created

- [PHASE-13B-LESSONS.md](./research/PHASE-13B-LESSONS.md) — Patterns, anti-patterns, key takeaways
- [DURABLE-OBJECTS-TESTING.md](./research/DURABLE-OBJECTS-TESTING.md) — Comprehensive DO testing guide
- [REACT-BEST-PRACTICES.md](./research/REACT-BEST-PRACTICES.md) — React patterns for real-time collaborative apps

**Outcome:** Codebase is robust, maintainable, and free of known critical bugs. Key patterns documented for future reference.

---

### Phase 14: Resilience & Testing Infrastructure ✅ COMPLETE

Improve API resilience and establish integration testing patterns.

> **Motivation:** KV quota exhaustion caused silent save failures. We need retry logic, better error handling, and tests that exercise real Cloudflare services.

#### ✅ HTTP API Retry with Exponential Backoff

**File:** `src/sync/session.ts`

Added `fetchWithRetry()` wrapper with:
- Exponential backoff: 1s → 2s → 4s → 8s (capped at 30s)
- Jitter (±25%) to prevent thundering herd
- Respects `Retry-After` header from server
- Retryable status codes: 408, 429, 500, 502, 503, 504
- Network errors and timeouts also retried
- Quota errors (503 with long Retry-After) NOT retried

```typescript
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;
const RETRY_JITTER = 0.25;
const MAX_RETRIES = 3;
```

All API functions updated: `createSession`, `loadSession`, `saveSessionNow`, `remixSession`, `sendCopy`

#### ✅ Integration Tests with vitest-pool-workers

**Directory:** `test/integration/`

Separate test infrastructure using `@cloudflare/vitest-pool-workers`:
- Tests run against **real** Durable Objects and KV (via Miniflare)
- Uses vitest 3.x (separate from unit tests on vitest 4.x)
- `isolatedStorage: false` due to `waitUntil()` logging

**Tests implemented:**
| Test | Description |
|------|-------------|
| DO: 404 for non-WS requests | HTTP routing |
| DO: debug endpoint | Internal state exposure |
| DO: runInDurableObject access | Direct instance inspection |
| Router: create session | POST /api/sessions |
| Router: load session | GET /api/sessions/:id |
| Router: 404 for missing | Error handling |
| Router: validation | Request body validation |

**npm scripts:**
```bash
npm run test:unit        # Fast unit tests (vitest 4.x)
npm run test:integration # Real DO/KV tests (vitest 3.x)
npm run test:all         # Both
```

#### ✅ Quota Observability Strategy

**Document:** `specs/QUOTA-OBSERVABILITY.md`

Comprehensive plan for detecting and monitoring quota issues:
- In-memory write counter (zero KV cost)
- Batched budget tracking via DO alarms
- Cloudflare Analytics API integration
- Structured logging for quota events
- 3-phase implementation plan

#### Documentation Created

- [QUOTA-OBSERVABILITY.md](./QUOTA-OBSERVABILITY.md) — Quota detection and monitoring strategy
- [INTEGRATION-TESTING.md](./research/INTEGRATION-TESTING.md) — vitest-pool-workers patterns and lessons

**Outcome:** API calls automatically retry on transient failures. Integration tests verify real Cloudflare service behavior. Quota issues are detectable before causing user-facing errors.

---

### Phase 15: iOS Ghost Click Fix ✅ COMPLETE

Fix iOS Safari/Chrome touch event handling that caused unintended step toggles.

> **Problem:** iOS browsers fire both touch and click events, causing "ghost clicks" that toggle steps twice or trigger unintended actions.

#### Implementation

- Migrated from `onClick`/`onTouchStart` to Pointer Events API (`onPointerDown`, `onPointerUp`)
- Pointer Events provide unified handling across mouse, touch, and pen inputs
- Eliminates duplicate event firing on iOS

**Files changed:** `StepCell.tsx`, `StepButton.tsx`

**Outcome:** Touch interactions work correctly on iOS Safari and Chrome.

---

### Phase 16: Audio Engineering ✅ COMPLETE

Improve instrument sound quality and fix critical audio issues.

> **Research:** See [AUDIO-ENGINEERING-101.md](./research/AUDIO-ENGINEERING-101.md)

#### Improvements

| Issue | Fix |
|-------|-----|
| Thin instrument sounds | Adjusted oscillator configurations, filter settings |
| Clipping/distortion | Proper gain staging |
| Inconsistent volumes | Normalized sample levels |
| Missing presence | Enhanced synth presets |

#### Testing

- Added comprehensive audio tests (part of 443 unit test suite)
- Validated synth preset audibility (attack < 0.1s for 120 BPM compatibility)

**Outcome:** Instruments sound fuller and more present without distortion.

---

### Phase 17: Favicon ✅ COMPLETE

Add a distinctive favicon representing Keyboardia's step sequencer.

> **Spec:** See [FAVICON.md](./FAVICON.md)

#### Design

- 4×4 step grid pattern inspired by classic drum machine grooves
- Orange (#FF6B35) active steps on dark (#1a1a1a) background
- Works at 16×16, 32×32, and 192×192 sizes
- SVG source for crisp rendering

**Files:** `public/favicon.svg`, `specs/FAVICON.md`

**Outcome:** Recognizable browser tab icon that reinforces Keyboardia's identity.

---

### Phase 18: Musical Foundations ✅ COMPLETE

Extend rhythmic and melodic capabilities with triplet grids and expanded pitch range.

#### Triplet Grids (12 and 24 steps)

Added to `STEP_COUNT_OPTIONS`: `[4, 8, 12, 16, 24, 32, 64]`

| Step Count | Musical Use |
|------------|-------------|
| **12** | Triplet feel, jazz/gospel shuffle, waltz (3/4 time) |
| **24** | Triplet hi-hats (trap), Afro-Cuban rhythms, swing patterns |

**Polyrhythmic possibilities:**
- 8 vs 12 (LCM=24): Afrobeat / West African clave
- 12 vs 16 (LCM=48): Jazz swing against straight time
- 16 vs 24 (LCM=48): Trap hi-hat rolls over standard drums

#### Extended Pitch Range (±24 semitones)

Expanded from ±12 to ±24 semitones (4 octaves total):

| Range | Musical Use |
|-------|-------------|
| -24 to -13 | Sub-bass, cinematic rumble |
| -12 to -1 | Bass register |
| 0 | Root note |
| +1 to +12 | Melody register |
| +13 to +24 | High leads, arpeggios, sparkle |

**Outcome:** Support for triplet-based genres (jazz, trap, Afrobeat) and orchestral-range melodies.

---

### Phase 19: Session Name API Fix ✅ COMPLETE

Fix bug where session names weren't saved when creating sessions via POST API.

#### Problem

`POST /api/sessions` accepted a `name` field but ignored it — sessions were always created with `name: null`.

#### Fix

- Added `CreateSessionOptions` interface with optional `name` parameter
- Updated `createSession()` to accept and validate names
- Added XSS prevention (blocks `<script>`, `javascript:`, event handlers)

#### Testing

- Added 9 integration tests for session field persistence
- Tests verify: name, tracks, tempo, swing, triplet grids, extended pitch

**Files:** `worker/sessions.ts`, `test/integration/live-session.test.ts`

**Outcome:** Session names persist correctly when created via API.

---

### Phase 20: QR Code Sharing ✅ COMPLETE

Add `?qr=1` URL modifier for QR-prominent display mode, optimized for conference booths and quick sharing.

> **Spec:** See [QR-MODIFIER.md](./QR-MODIFIER.md)

#### Features

- **URL modifier** — `?qr=1` transforms any session URL into QR display mode
- **Responsive layouts:**
  - Large (≥1024px): Side panel, sequencer remains interactive
  - Medium (768-1023px, height ≥500px): Floating card in corner
  - Small (<768px OR height <500px): Fullscreen modal
- **Share button integration** — "Invite ▾" dropdown with "Show QR Code" option

#### Mobile Optimizations

- 44×44px close button (Apple HIG minimum touch target)
- Safe area insets for notch/home indicator
- Dynamic viewport units (`dvh`) for URL bar handling
- Height-based display mode detection (fixes mobile landscape)
- Body scroll lock prevents background scrolling

#### Accessibility

- Escape key closes overlay
- Focus management (trap focus, restore on close)
- ARIA labels for screen readers

**Files:** `components/QROverlay/`, `hooks/useQRMode.ts`, `hooks/useDisplayMode.ts`

**Outcome:** Easy QR sharing for in-person collaboration and conference demos.

---

### Phase 21: Polish & Production

Remaining polish work for production readiness.

> **Reference:** [REACT-BEST-PRACTICES.md](./research/REACT-BEST-PRACTICES.md)

#### React Best Practices

| Area | Action | Priority |
|------|--------|----------|
| **State Management** | Evaluate Zustand for high-frequency sequencer state | Medium |
| **Performance** | Profile with React DevTools, add React.memo to StepButton | High |
| **Concurrent Features** | Use useTransition for pattern search, useDeferredValue for cursors | Medium |
| **Error Boundaries** | Add feature-level boundaries (sequencer, multiplayer, audio) | High |
| **WebSocket** | Review message queueing, consider delta updates | Medium |

#### UI Polish

- [ ] Loading states and skeleton screens
- [ ] Improved touch interactions (long-press for parameter locks)

#### Performance

- [ ] Profile and optimize hot paths (StepButton rendering)
- [ ] Lazy-load preset samples
- [ ] Limit concurrent audio playback
- [ ] Code splitting for faster initial load

#### Documentation

- [ ] User guide / help overlay
- [ ] Keyboard shortcuts reference

**Outcome:** Production-ready quality and polish, with React best practices applied throughout.

---

### Phase 22: Authentication & Session Ownership

Add optional authentication so users can claim ownership of sessions and control access.

> **Library:** [BetterAuth](https://www.better-auth.com/) — framework-agnostic TypeScript auth

1. **Authentication setup:**
   - Integrate BetterAuth with Cloudflare Workers
   - Support email magic link and/or OAuth (Google, GitHub)
   - Store user accounts in D1 (Cloudflare's SQLite)

2. **Session ownership model:**
   ```typescript
   interface Session {
     // ... existing fields
     ownerId: string | null;        // User ID (null = anonymous)
     mode: 'collaborative' | 'readonly';  // Default: collaborative
   }
   ```

3. **Access control:**
   | Mode | Owner | Others |
   |------|-------|--------|
   | `collaborative` | Full edit | Full edit (current behavior) |
   | `readonly` | Full edit | View only, must remix to edit |

4. **Claiming anonymous sessions:**
   - User creates session anonymously → later signs in → can claim ownership
   - Ownership stored in session, verified via auth token

5. **UI additions:**
   - Sign in / Sign out button in header
   - "Lock session" toggle (owner only) → switches to readonly mode
   - Readonly indicator for non-owners viewing locked sessions
   - "Remix to edit" button when viewing readonly session

6. **API changes:**
   - `PATCH /api/sessions/:id` — Update mode (owner only)
   - `POST /api/sessions/:id/claim` — Claim ownership (authenticated users)
   - All write endpoints check ownership + mode before allowing edits

**Outcome:** Users can sign in to claim sessions and lock them for solo playback. Anonymous sessions remain collaborative by default.

---

### Phase 23: Shared Sample Recording

Allow multiplayer users to share recorded samples in real-time.

> **iOS Compatibility Note:** Before shipping, fix `recorder.ts` to use `MediaRecorder.isTypeSupported()` for codec detection. iOS/Safari produces MP4/AAC, not WebM/Opus. See `specs/research/IOS-CHROME-COMPATIBILITY.md` for details.

1. **Recording in multiplayer context:**
   - Any player can record a sample
   - Recording is uploaded to R2 with session-scoped key
   - All players receive notification of new sample

2. **R2 upload flow:**
   ```typescript
   // Client records audio → converts to WAV/WebM
   const audioBlob = await recorder.stop();

   // Upload to R2 via Worker
   const response = await fetch(`/api/sessions/${sessionId}/samples`, {
     method: 'POST',
     body: audioBlob,
     headers: { 'Content-Type': 'audio/webm' }
   });

   // Get sample URL back
   const { sampleId, url } = await response.json();
   ```

3. **Sample storage structure:**
   ```
   R2 Bucket: keyboardia-samples
   └── sessions/
       └── {sessionId}/
           └── {sampleId}.webm
   ```

4. **Sync recorded samples:**
   ```typescript
   // Durable Object broadcasts new sample to all clients
   { type: "sample_added", sampleId: "xxx", url: "...", addedBy: "player-1" }

   // Clients fetch and decode the sample
   const response = await fetch(url);
   const buffer = await response.arrayBuffer();
   const audioBuffer = await audioContext.decodeAudioData(buffer);
   ```

5. **Sample lifecycle:**
   - Samples stored in R2 permanently (tied to session)
   - Remixing a session copies sample references (not duplicates)
   - Future: cleanup orphaned samples not referenced by any session

6. **UI considerations:**
   - Show recording indicator when any player is recording
   - Display who added each custom sample
   - Loading state while samples sync

**Outcome:** Multiple players can contribute custom recordings to a shared session. All players can use any recorded sample as an instrument.

---

### Phase 24: Publishing Platform (Beats)

> ⚠️ **NEEDS RETHINKING** — This phase was originally "Sessions vs Beats" but requires reconsideration. The core sharing model (Invite/Send Copy/Remix) already handles most use cases. This phase should only be pursued if there's clear demand for a publishing/social platform.

#### The Original Idea

Distinguish between:
- **Session** — "Come make music with me" (mutable, collaborative)
- **Beat** — "Listen to what I made" (immutable, presentational)

#### Why It Was Deferred

1. **"Send Copy" already creates snapshots** — Recipient gets a frozen copy at that moment
2. **Immutability adds complexity** — Separate `/b/` URLs, readonly views, Beat data type
3. **Against UI Philosophy** — Mode switching, separate views, extra flows
4. **It's really a platform feature** — Publishing implies social features, discoverability, attribution

#### What "Beats" Actually Requires

If pursued, this is not just "readonly sessions" — it's a publishing platform:

| Feature | Scope |
|---------|-------|
| **Immutable snapshots** | New data type, separate URL scheme (`/b/{id}`) |
| **Readonly playback UI** | Simplified player-only interface |
| **Attribution** | Artist name, track title, description |
| **Social features** | Play count, likes, comments |
| **Discoverability** | Browse, search, featured beats |
| **User profiles** | "My published beats" gallery |

#### Data Model (If Implemented)

```typescript
interface Beat {
  id: string;                    // UUID v4
  sourceSessionId: string;       // Session it was created from
  createdAt: number;
  createdBy: string | null;      // User ID (requires auth)

  // Metadata
  name: string;                  // Track title (required)
  description: string | null;
  tags: string[];

  // State
  state: SessionState;           // Frozen copy

  // Social
  playCount: number;
  likeCount: number;
  isPublic: boolean;             // Listed in browse/search
}
```

#### Questions to Answer First

1. Is there demand for public publishing, or is private sharing enough?
2. Do we want to become a "platform" with user-generated content moderation needs?
3. What's the minimum viable version that adds value beyond Send Copy?
4. Should beats be tied to user accounts, or allow anonymous publishing?

#### Possible Minimal Version

Instead of a full platform, consider a simpler "readonly mode" on sessions:

```typescript
interface Session {
  // ...existing
  isLocked: boolean;  // Owner can lock; others can only view/remix
}
```

This gives "view-only sharing" without the platform complexity.

**Outcome:** TBD — requires product decision on whether Keyboardia should become a publishing platform or remain focused on collaboration.

---

### Phase 25: Advanced Synthesis Engine

> **Motivation:** The current synth engine is a simple single-oscillator + filter + ADSR architecture. It works well for bass, leads, and electronic sounds, but can't produce rich acoustic instruments like piano, strings, or realistic brass. Tools like Ableton's Learning Music use high-quality sampled instruments that sound full and expressive.

#### Current Limitations

| Limitation | Impact |
|------------|--------|
| Single oscillator per voice | No harmonic richness, detuning, or layering |
| Basic waveforms only | Sine, saw, square, triangle — no complex timbres |
| No sampled instruments | Can't reproduce acoustic piano, real strings |
| No effects | No reverb, delay, chorus for space/depth |
| Static filter | No filter envelope or modulation |
| No velocity sensitivity | All notes play at same intensity |

#### Exploration Areas

##### 1. Sampled Instruments (Highest Impact)

Add high-quality sampled instruments stored in R2:

```
R2 Bucket: keyboardia-samples
└── instruments/
    ├── piano/
    │   ├── C2.mp3, C3.mp3, C4.mp3, C5.mp3  # Multi-sampled
    │   └── manifest.json                    # Note mapping, loop points
    ├── strings/
    ├── brass/
    └── ...
```

**Implementation approach:**
- Store 1 sample per octave (pitch-shift for intermediate notes)
- Lazy-load instruments on first use
- ~500KB-2MB per instrument (compressed)
- Could use free samples from [Freesound](https://freesound.org/) or [Pianobook](https://pianobook.co.uk/)

**Tradeoffs:**
| Approach | Quality | Size | Latency |
|----------|---------|------|---------|
| 1 sample per octave | Good | ~500KB | Low |
| 1 sample per 3 semitones | Better | ~2MB | Medium |
| Full multi-velocity | Excellent | ~10MB+ | High |

##### 2. Full Synthesizer Architecture (Ableton Learning Synths Reference)

Model our synth engine after [Ableton's Learning Synths Playground](https://learningsynths.ableton.com/en/playground), which provides an excellent reference for essential synth controls:

**Dual Oscillator Section:**
```typescript
interface OscillatorConfig {
  waveform: 'sine' | 'saw' | 'square' | 'triangle';
  level: number;           // 0 to 1 (mix between oscillators)
  detune: number;          // Cents (-100 to +100) - fine pitch adjustment
  coarseDetune: number;    // Semitones (-24 to +24) - octave/interval shifts
  noise: number;           // 0 to 1 - noise amplitude mix
}
```

**Amplitude Envelope (ADSR):**
```typescript
interface ADSREnvelope {
  attack: number;    // 0.001 to 2s - time to reach peak
  decay: number;     // 0.001 to 2s - time to fall to sustain level
  sustain: number;   // 0 to 1 - held level while note is down
  release: number;   // 0.001 to 4s - fade time after note release
}
```

**Low-Pass Filter with Modulation:**
```typescript
interface FilterConfig {
  frequency: number;       // 20 to 20000 Hz - cutoff frequency
  resonance: number;       // 0 to 30 - peak at cutoff (Q factor)
  envelopeAmount: number;  // -1 to 1 - how much envelope modulates cutoff
  lfoAmount: number;       // 0 to 1 - how much LFO modulates cutoff
}
```

**LFO (Low Frequency Oscillator):**
```typescript
interface LFOConfig {
  frequency: number;       // 0.1 to 20 Hz (typically 0.5-10 Hz)
  waveform: 'sine' | 'saw' | 'square' | 'triangle';
  destination: 'filter' | 'pitch' | 'amplitude';
  amount: number;          // 0 to 1
}
```

**Complete Synth Preset:**
```typescript
interface SynthPreset {
  name: string;
  oscillators: [OscillatorConfig, OscillatorConfig];  // Dual oscillator
  amplitudeEnvelope: ADSREnvelope;
  filter: FilterConfig;
  filterEnvelope: ADSREnvelope;   // Dedicated filter envelope
  lfo: LFOConfig;
}
```

**Learning Synths Playground Controls to Implement:**

| Section | Control | Range | Purpose |
|---------|---------|-------|---------|
| **Oscillator 1** | Waveform | Saw/Square/Sine/Tri | Base timbre |
| | Detune (Fine) | -100 to +100 cents | Subtle pitch variation |
| | Detune (Coarse) | -24 to +24 st | Octave/interval shifts |
| | Noise | 0-100% | Add noise texture |
| **Oscillator 2** | Same as Osc 1 | | Layer/detune for richness |
| | Mix | 0-100% | Balance between oscillators |
| **Amp Envelope** | Attack | 0.001-2s | Fade in speed |
| | Decay | 0.001-2s | Initial drop |
| | Sustain | 0-100% | Held level |
| | Release | 0.001-4s | Fade out |
| **Filter** | Frequency | 20-20kHz | Brightness control |
| | Resonance | 0-30 | Peak/emphasis |
| | Env Amount | -100 to +100% | Envelope → filter mod |
| | LFO Amount | 0-100% | LFO → filter mod |
| **Filter Envelope** | ADSR | Same as Amp | Shape filter over time |
| **LFO** | Rate | 0.1-20 Hz | Modulation speed |
| | Waveform | Sine/Saw/Sq/Tri | Modulation shape |
| | Destination | Filter/Pitch/Amp | What to modulate |

**New sounds enabled:**
- Detuned supersaw (trance/EDM) — two saws slightly detuned
- Layered octaves (full pads) — osc2 at +12 semitones
- PWM-style thickness — square + saw mix
- Vibrato — LFO → pitch at 5-7 Hz
- Tremolo — LFO → amplitude at 4-8 Hz
- Filter sweeps — high LFO amount on filter
- Plucks — fast attack, short decay, low sustain
- Pads — slow attack, high sustain, long release
- Wobble bass — LFO → filter at 1-4 Hz

##### 3. XY Pad / Macro Controls

Learning Synths includes a "Perform" box — an XY pad that controls multiple parameters simultaneously:

```typescript
interface XYPadMapping {
  parameter: 'filterFrequency' | 'filterResonance' | 'lfoRate' | 'lfoAmount' | 'oscMix' | 'attack' | 'release';
  axis: 'x' | 'y';
  min: number;
  max: number;
  curve: 'linear' | 'exponential';  // Filter freq often exponential
}

interface XYPad {
  mappings: XYPadMapping[];  // Up to 4 parameters per axis
  x: number;  // 0 to 1
  y: number;  // 0 to 1
}
```

**Use cases:**
- X = filter cutoff, Y = resonance (classic filter sweep)
- X = LFO rate, Y = LFO amount (wobble control)
- X = attack, Y = release (envelope shape)
- Drag finger/mouse for expressive real-time control

**Implementation:**
1. Add XY pad component to synth track expanded view
2. Allow mapping any synth parameter to X or Y axis
3. Record XY movements as automation (future)

##### 4. FM Synthesis

Add frequency modulation for bell-like and metallic tones:

```typescript
interface FMPreset {
  carriers: OscillatorConfig[];
  modulators: {
    target: number;      // Which carrier to modulate
    ratio: number;       // Frequency ratio
    depth: number;       // Modulation amount
    envelope: ADSRConfig;
  }[];
}
```

**Sounds enabled:** Electric piano (DX7-style), bells, metallic percussion, evolving textures

##### 5. Effects Chain

> ⚠️ **ARCHITECTURAL WARNING: Effects Require Full Integration**
>
> Effects (reverb, delay, etc.) are **end-of-project work** due to high integration cost and coherence risk. See `app/docs/lessons-learned.md` — "Local-Only Audio Features Are a Category Risk".
>
> **Requirements for proper implementation:**
> 1. Add effect state to `SessionState` (e.g., `reverbMix: number`, `delayMix: number`)
> 2. Add WebSocket message types (`set_reverb_mix`, `reverb_mix_changed`, etc.)
> 3. Add server-side validation in `worker/validation.ts`
> 4. Add UI controls matching existing patterns (like Swing slider)
> 5. Ensure all players hear identical audio (the "same music" guarantee)
>
> **Do NOT implement effects as client-side only.** This breaks multiplayer sync and session persistence.

Add master effects for polish:

```typescript
interface EffectsChain {
  reverb?: {
    type: 'room' | 'hall' | 'plate';
    mix: number;         // 0 to 1
    decay: number;       // Seconds
  };
  delay?: {
    time: number;        // Beat-synced or ms
    feedback: number;
    mix: number;
  };
  chorus?: {
    rate: number;
    depth: number;
    mix: number;
  };
  compressor?: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
  };
}
```

**Note:** Web Audio API has built-in ConvolverNode (reverb) and DelayNode. Chorus requires LFO + delay modulation.

##### 6. Physical Modeling (Advanced)

For truly realistic acoustic sounds, explore Karplus-Strong or waveguide synthesis:

- **Karplus-Strong:** Plucked strings (guitar, harp)
- **Waveguide:** Wind instruments, bowed strings

**Complexity:** High. May be overkill for step sequencer context.

#### Recommended Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | **Sampled piano** | Medium | High — solves the immediate gap |
| 2 | **Reverb effect** | Low | High — adds space and polish |
| 3 | **Dual oscillator + filter mod** | Medium | High — Learning Synths parity |
| 4 | **LFO with destinations** | Medium | High — movement and expression |
| 5 | XY Pad / macro controls | Medium | Medium — expressive performance |
| 6 | Filter envelope (dedicated) | Low | Medium — more tonal shaping |
| 7 | Sampled strings/brass | Medium | Medium — orchestral sounds |
| 8 | FM synthesis | High | Medium — niche but powerful |
| 9 | Full effects chain | Medium | Medium — production quality |
| 10 | Physical modeling | Very High | Low — diminishing returns |

#### Implementation Plan

**Step 1: Sampled Piano (MVP)**
1. Source or record piano samples (C2, C3, C4, C5)
2. Upload to R2 with manifest.json
3. Create `SampledInstrument` class that pitch-shifts between samples
4. Add `piano` to SamplePicker
5. Test latency and quality

**Step 2: Reverb**
1. Create impulse response or use algorithmic reverb
2. Add global reverb bus
3. Per-track send level
4. Master mix control

**Step 3: Dual Oscillator Engine**
1. Refactor `synth.ts` to support two oscillators per voice
2. Add oscillator mix, detune (fine + coarse), and noise parameters
3. Create new presets: supersaw, layered pad, thick lead
4. Maintain backwards compatibility (single osc = osc1 only)

**Step 4: Filter Modulation**
1. Add `envelopeAmount` and `lfoAmount` to filter config
2. Implement filter envelope (separate from amplitude envelope)
3. Route LFO to filter cutoff
4. Update presets with filter movement

**Step 5: LFO System**
1. Create LFO oscillator (0.1-20 Hz)
2. Add waveform selection (sine, saw, square, triangle)
3. Implement routing to filter, pitch, or amplitude
4. Add LFO sync to tempo (optional)

**Step 6: XY Pad Component**
1. Create draggable XY pad UI component
2. Implement parameter mapping system
3. Add to synth track expanded view
4. Preset mappings for common use cases

#### Open Questions

1. **Sample licensing:** Can we use CC0/public domain samples, or do we need to record our own?
2. **Bundle size:** How do we balance quality vs. load time? Lazy loading? Progressive enhancement?
3. **Mobile performance:** Can low-end devices handle multi-oscillator + effects?
4. **Preset management:** Do users get to create custom synths, or just pick from presets?
5. **Per-track effects:** Should reverb/delay be global or per-track?

#### Success Criteria

- [ ] Piano preset sounds "nice and full" (comparable to Ableton Learning Music)
- [ ] Reverb adds depth without muddiness
- [ ] Dual oscillator with detune creates rich, full sounds
- [ ] LFO creates audible movement (filter sweeps, vibrato, tremolo)
- [ ] Filter envelope shapes sound over time (plucks, swells)
- [ ] XY pad allows expressive real-time control
- [ ] New presets don't break existing sessions
- [ ] Load time increase < 2 seconds on 3G
- [ ] Works on mobile Safari/Chrome
- [ ] Feature parity with [Learning Synths Playground](https://learningsynths.ableton.com/en/playground) core controls

**Outcome:** Keyboardia sounds as good as commercial music tools while remaining simple to use. Users can explore synthesis concepts interactively, just like Ableton's Learning Synths.

---

### Phase 26: Session Provenance

Enhanced clipboard and session lineage features for power users.

> **Research:** See [MULTIPLAYER-PRESENCE-RESEARCH.md](./research/MULTIPLAYER-PRESENCE-RESEARCH.md) - Parts 3 & 6

#### 1. Rich Clipboard Format

Dual-format clipboard with metadata:

```javascript
clipboard = {
  format: "keyboardia/track/v1",
  pattern: "x---x---x---x---",
  metadata: {
    instrument: "kick-808",
    bpm: 120,
    sourceSession: "abc123xyz"
  },
  plainText: "Kick: x---x---x---x---" // Fallback
}
```

- Rich paste within Keyboardia (preserves instrument, BPM)
- Plain text fallback for Discord, ChatGPT, etc.
- Enables AI collaboration workflows

#### 2. Session Family Tree

Visual ancestry and descendant tree:

```
       [Original Groove]
       (you, 3 days ago)
              ↓
       ┌──────┴──────┐
       ↓             ↓
[Dark Techno]  [Light Version]
       ↓
[Current Session] ← You are here
       ↓
[Forked by Sarah] 🟢 ACTIVE
```

- Provenance visualization
- Jump to any ancestor/descendant
- See who's currently working on forks

**Outcome:** Power users can track idea evolution across sessions and leverage AI tools for pattern generation.

---

### Phase 27: Beat-Quantized Changes

Batch remote changes to musical boundaries for a more musical collaborative experience.

> **Moved from Phase 11** — This feature requires dedicated design work and careful consideration of edge cases.

#### Problem Statement

When multiple users edit a session simultaneously, changes can feel jarring and random. A user might toggle a step while the beat is playing, causing an audible "pop" or unexpected timing.

#### Proposed Solution

Quantize remote changes to musical boundaries:

```
16th note @ 120 BPM = 125ms delay (imperceptible)
```

#### Design Questions to Resolve

1. **Which changes should be quantized?**
   - Step toggles: Yes (most jarring when immediate)
   - Mute/solo: Maybe (could be intentional performance gesture)
   - Tempo/swing: No (should be immediate for DJ-style control)
   - Track add/delete: No (rare, user expects immediate feedback)

2. **How to handle rapid successive changes?**
   - Coalesce multiple changes to same step within quantization window
   - Last-write-wins for conflicting changes

3. **Interaction with playback state:**
   - Only quantize when playing? Or always?
   - Different quantization for local vs remote changes?

4. **Visual feedback:**
   - Show pending changes with different opacity?
   - Animate the "snap" to beat boundary?

#### Implementation Approach

```typescript
interface QuantizedChange {
  action: GridAction;
  targetBeat: number;  // Beat to apply at
  receivedAt: number;  // When received from server
}

// In scheduler, apply pending changes at beat boundaries
if (currentBeat !== lastBeat) {
  applyPendingChanges(currentBeat);
}
```

#### Success Criteria

- Remote step changes feel musical, not random
- Local changes remain instant (no perceived lag)
- No audible artifacts when changes apply
- Visual feedback clearly communicates pending changes

**Outcome:** Collaborative editing feels like musical call-and-response rather than chaotic interference.

---

### Phase 28: Playwright E2E Testing

Browser-based end-to-end tests for features that cannot be tested with Vitest alone.

> **Rationale:** Some features require real browser environments, multiple client contexts, or actual network conditions. These tests are separated from unit tests due to their complexity, setup requirements, and longer execution time.

#### Tests to Implement

**Multi-client Sync Verification:**
- [ ] Two clients see same state after step toggle
- [ ] Player join/leave updates avatar stack in both clients
- [ ] Cursor movements sync between clients
- [ ] Reconnection resumes state correctly

**Network Resilience:**
- [ ] Disconnect simulation (network offline → reconnect)
- [ ] Server restart handling (WebSocket close → reopen)
- [ ] Slow network conditions (high latency, packet loss)
- [ ] Offline queue replay after reconnect

**Cross-browser Testing:**
- [ ] Chrome (desktop + mobile)
- [ ] Firefox (desktop)
- [ ] Safari (desktop + iOS)
- [ ] Edge (desktop)

**Audio Timing Verification:**
- [ ] Web Audio API timing accuracy
- [ ] Sample playback sync between clients
- [ ] Clock sync accuracy under real network conditions

**Visual Regression:**
- [ ] Step grid appearance
- [ ] Cursor overlay positioning
- [ ] Connection status indicator states
- [ ] Toast notification animations

#### Infrastructure

```typescript
// playwright.config.ts additions
export default defineConfig({
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
  ],
});
```

**Test Utilities:**
```typescript
// Multi-client test helper
async function withTwoClients(test: (client1: Page, client2: Page) => Promise<void>) {
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  try {
    await test(page1, page2);
  } finally {
    await context1.close();
    await context2.close();
  }
}

// Network simulation helper
async function simulateNetworkConditions(page: Page, conditions: 'offline' | 'slow' | 'normal') {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: conditions === 'offline',
    latency: conditions === 'slow' ? 500 : 0,
    downloadThroughput: conditions === 'slow' ? 50 * 1024 : -1,
    uploadThroughput: conditions === 'slow' ? 50 * 1024 : -1,
  });
}
```

**Outcome:** Comprehensive browser testing that validates real-world multiplayer behavior and cross-browser compatibility.

---

### Phase 29: Public API

Provide authenticated API access for third-party integrations, bots, and developer tools.

> **Prerequisite:** Phase 15 (Authentication) must be complete before implementing public API access.

#### Use Cases

1. **Bot Integration** — Discord/Slack bots that can create sessions, add patterns
2. **CLI Tools** — Command-line interface for power users
3. **AI Integration** — LLMs that can programmatically create/modify beats
4. **Data Export** — Bulk export of user's sessions
5. **Webhooks** — Notify external services of session events

#### API Design

**Authentication:**
```
Authorization: Bearer <api_key>
X-API-Key: <api_key>  (alternative header)
```

**Rate Limiting:**
| Tier | Requests/min | Burst |
|------|--------------|-------|
| Free | 60 | 10 |
| Pro | 600 | 100 |
| Enterprise | Custom | Custom |

**Endpoints:**
```
GET    /api/v1/sessions              # List user's sessions
POST   /api/v1/sessions              # Create session
GET    /api/v1/sessions/:id          # Get session
PUT    /api/v1/sessions/:id          # Update session
DELETE /api/v1/sessions/:id          # Delete session
POST   /api/v1/sessions/:id/remix    # Create remix

GET    /api/v1/user                  # Get current user info
GET    /api/v1/user/api-keys         # List API keys
POST   /api/v1/user/api-keys         # Create API key
DELETE /api/v1/user/api-keys/:id     # Revoke API key
```

**Response Format:**
```json
{
  "data": { ... },
  "meta": {
    "requestId": "...",
    "rateLimit": {
      "remaining": 59,
      "reset": 1699999999
    }
  }
}
```

#### Implementation

1. **API Key Management:**
   - Store hashed API keys in D1
   - Associate keys with user accounts
   - Support key rotation and revocation

2. **Rate Limiting:**
   - Use Cloudflare Rate Limiting or DO-based counter
   - Per-key and per-IP limits
   - Return `429 Too Many Requests` with `Retry-After` header

3. **Scopes & Permissions:**
   ```typescript
   type APIScope =
     | 'sessions:read'
     | 'sessions:write'
     | 'sessions:delete'
     | 'user:read';
   ```

4. **Audit Logging:**
   - Log all API requests with key ID, endpoint, response code
   - Store in Analytics Engine or external service

5. **Documentation:**
   - OpenAPI/Swagger spec
   - Interactive API explorer
   - Code examples (curl, JavaScript, Python)

**Outcome:** Developers can build integrations with Keyboardia using authenticated API access.

---

## Quick Start Commands

```bash
# Phase 1-2: Local frontend development
npm create vite@latest keyboardia -- --template react-ts
cd keyboardia
npm install
npm run dev

# Phase 3: Add KV for session persistence
npm install wrangler --save-dev
npx wrangler kv namespace create SESSIONS

# Phase 4+: Add Durable Objects and R2
npx wrangler r2 bucket create keyboardia-samples

# Deploy
npm run build
npx wrangler deploy
```

---

## Key Cloudflare Docs

### Getting Started
- [Workers](https://developers.cloudflare.com/workers/) — Serverless compute platform
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) — wrangler.jsonc format (recommended)
- [Pages](https://developers.cloudflare.com/pages/) — Static frontend hosting

### Storage
- [KV](https://developers.cloudflare.com/kv/) — Key-value storage for sessions
- [R2 Storage](https://developers.cloudflare.com/r2/) — Object storage for samples
- [R2 Object Lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) — TTL-based cleanup

### Durable Objects (Real-time State)
- [Durable Objects Overview](https://developers.cloudflare.com/durable-objects/) — Stateful coordination
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — Cost-efficient WebSockets
- [In-memory State](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/) — Single-threaded execution
- [Data Location](https://developers.cloudflare.com/durable-objects/reference/data-location/) — Geographic placement
- [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — Free tier with SQLite

### Examples
- [WebSocket Hibernation Server](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/) — Reference implementation

---

## Estimated Build Order

> **Note:** Phase numbers match the detailed sections above. Phases 15-20 were completed out of original order and inserted chronologically.

| Phase | Focus | Outcome | Backend | Status |
|-------|-------|---------|---------|--------|
| 1 | Local audio + step sequencer | **Sound works!** | None | ✅ |
| 2 | Mic recording + custom instruments | Recordings become new tracks | None | ✅ (hidden) |
| 3 | **Session persistence & sharing** | **Save, share, remix patterns** | **KV** | ✅ |
| 4A | Per-track step count (4/8/12/16/24/32/64) | Polyrhythms, triplet grids | KV | ✅ |
| 4B | Chromatic Step View (±24 semitones) | Inline pitch editing, 4-octave range | KV | ✅ |
| 5 | **Sharing UI polish** | **Invite/Send Copy/Remix, lineage** | **KV** | ✅ |
| 6 | Observability | Logging, metrics, debug mode | KV | ✅ |
| 7 | Multiplayer observability | WebSocket logging, debug endpoints, test infra | KV | ✅ |
| 8 | Cloudflare backend setup | Infra deployed | KV + DO + R2 | ✅ |
| 9 | Multiplayer state sync | Shared grid | DO | ✅ |
| 10 | Clock sync | Synced playback | DO | ✅ |
| 11 | Presence & awareness | Identities, attribution, hardening | DO | ✅ |
| 12 | Error handling & testing | Reconnection, offline queue, tests | DO | ✅ |
| **13A** | **Backend hardening (CF best practices)** | **Validation, stub recreation, timeouts** | All | ✅ |
| **13B** | **Frontend hardening** | **State machines, timing fixes, docs** | All | ✅ |
| **14** | **Resilience & Testing** | **HTTP retry, integration tests, quota observability** | All | ✅ |
| **15** | **iOS Ghost Click Fix** | **Pointer Events API for touch** | All | ✅ |
| **16** | **Audio Engineering** | **Sound quality, gain staging** | All | ✅ |
| **17** | **Favicon** | **Step sequencer icon** | — | ✅ |
| **18** | **Musical Foundations** | **Triplet grids (12/24), ±24 semitones** | KV | ✅ |
| **19** | **Session Name API Fix** | **POST /api/sessions accepts name** | KV | ✅ |
| **20** | **QR Code Sharing** | **?qr=1 modifier, mobile optimized** | — | ✅ |
| 21 | Polish & production | Loading states, performance, docs | All | Next |
| 22 | Auth & ownership | Claim sessions, lock to readonly | D1 + BetterAuth | — |
| 23 | Shared sample recording | Shared custom sounds | R2 | — |
| 24 | ⚠️ Publishing platform | Beats, social features (TBD) | KV + D1 | — |
| 25 | ⚠️ Advanced Synthesis (incl. effects) | Rich instruments, reverb, delay | R2 | — |
| 26 | Session Provenance | Rich clipboard, family tree | KV | — |
| 27 | Beat-Quantized Changes | Musical sync for remote edits | DO | — |
| 28 | Playwright E2E Testing | Multi-client, cross-browser, network tests | All | — |
| 29 | Public API | Authenticated API access for integrations | All | — |

> ⚠️ **Phase 25 (Effects):** Requires full integration with session state and multiplayer sync. See `app/docs/lessons-learned.md` for architectural lessons. Effects should be implemented last among audio features.
