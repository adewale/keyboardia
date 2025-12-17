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

> **Design decision:** We chose actual step count (4/8/12/16/24/32/64/96/128) over multipliers because:
> - Simpler mental model — "8 steps" is clearer than "0.5x multiplier"
> - All steps are visible and editable (with inline scrolling)
> - Matches hardware like Elektron Digitakt and OP-Z

```typescript
interface Track {
  // ... existing fields
  stepCount: 4 | 8 | 12 | 16 | 24 | 32 | 64 | 96 | 128;  // Default: 16
}
```

| Step Count | Bars | Loops/Bar | Use Case |
|------------|------|-----------|----------|
| **4** | 0.25 | 8× | Four-on-the-floor kick, pulse patterns, motorik beat |
| **8** | 0.5 | 4× | Half-bar phrases, 8th-note arpeggios, Afrobeat percussion |
| **12** | 0.75 | ~2.67× | Triplet feel, jazz/gospel shuffle, waltz |
| 16 | 1 | 2× | Standard drums, basslines |
| **24** | 1.5 | ~1.33× | Triplet hi-hats (trap), Afro-Cuban rhythms |
| 32 | 2 | 1× | Basslines with variation, 2-bar melodies |
| 64 | 4 | 0.5× | Long melodies, chord progressions, evolving patterns |
| **96** | 6 | ~0.33× | Extended triplet patterns, 6-bar phrases |
| **128** | 8 | 0.25× | Full verse/chorus sections, cinematic builds |

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
- Step count **dropdown** in track controls (9 options including triplet grids)
- Global counter runs 0-127 (MAX_STEPS = 128)
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

// Step count options in types.ts (includes triplet grids: 12, 24, 96)
export const STEP_COUNT_OPTIONS = [4, 8, 12, 16, 24, 32, 64, 96, 128] as const;
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

> **Note:** The sharing model has been simplified. See [SHARING-AND-PUBLISHING.md](./SHARING-AND-PUBLISHING.md) for the current Publish/Invite/Remix/New model. Phase 18 implements publishing (immutable sessions) without the complexity of a separate "Beat" type.

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

#### Triplet Grids and Extended Lengths

Updated `STEP_COUNT_OPTIONS` to: `[4, 8, 12, 16, 24, 32, 64, 96, 128]`

| Step Count | Musical Use |
|------------|-------------|
| **12** | Triplet feel, jazz/gospel shuffle, waltz (3/4 time) |
| **24** | Triplet hi-hats (trap), Afro-Cuban rhythms, swing patterns |
| **96** | Extended triplet patterns, 6-bar phrases |
| **128** | Full verse/chorus sections, cinematic builds |

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

### Phase 21.5: Stabilization ✅

Fix critical bugs and technical debt identified in the December 2025 codebase audit.

> **Reference:** [CODEBASE-AUDIT-2025-12.md](./research/CODEBASE-AUDIT-2025-12.md)

#### Critical Fixes

| Issue | File | Fix | Status |
|-------|------|-----|--------|
| Missing `await` on audioContext.resume() | `engine.ts:238` | Add await before resume() | ✅ |
| Snapshot staleness not checked | `multiplayer.ts:935` | Add version tracking to snapshots | ✅ |

#### High Priority Fixes

| Issue | File | Fix | Status |
|-------|------|-----|--------|
| Interval cleanup on disconnect | `multiplayer.ts` | Verified - cleanup() calls clockSync.stop() | ✅ Already fixed |
| Limited memoization | `TrackRow.tsx` | Wrap in React.memo | ✅ |

#### Medium Priority Fixes

| Issue | File | Fix | Status |
|-------|------|-----|--------|
| Silent clipboard errors | `clipboard.ts` | Add logger.error calls to catch blocks | ✅ |
| Outstanding TODOs | Various | Document decisions or implement | ✅ |

#### Security Hardening

| Issue | File | Fix | Status |
|-------|------|-----|--------|
| No rate limiting | `worker/index.ts` | Add per-IP rate limiting for session creation | ✅ |

#### Implementation Notes

**Snapshot Version Tracking:**
- Server includes `snapshotVersion` in snapshot messages (incremented on each state mutation)
- Client tracks `lastAppliedSnapshotVersion` and ignores stale snapshots
- Prevents data loss from network packet reordering

**Rate Limiting:**
- Uses Cloudflare's `request.headers.get('CF-Connecting-IP')` for IP detection
- In-memory Map with sliding window (60 second window, 10 session creates max)
- Returns 429 Too Many Requests when limit exceeded

**Files Modified:**
```
src/audio/engine.ts          # await audioContext.resume()
src/sync/multiplayer.ts      # Snapshot version checking
src/components/TrackRow.tsx  # React.memo wrapper
src/utils/clipboard.ts       # Error logging
src/worker/index.ts          # Rate limiting
```

**Outcome:** Critical bugs fixed, improved performance, security hardening complete.

---

### Phase 22: Synthesis Engine & Codebase Audit ✅ COMPLETE

Comprehensive implementation of the Advanced Synthesis Engine (pulled forward from Phase 26) plus codebase audit, memory leak fixes, and extensive documentation.

> **Branch:** `claude/display-roadmap-Osuh7`
> **Scope:** ~19,000 lines added across 83 files

---

#### 1. Sampled Instruments (From Phase 26)

**Piano with Multi-Sampling:**
- 4 pitch samples: C2.mp3, C3.mp3, C4.mp3, C5.mp3 (one per octave)
- Pitch-shifting between samples for intermediate notes
- `sampled-instrument.ts` (552 lines) with progressive loading
- Integration tests (513 lines) + unit tests (204 lines)

**Files:**
```
public/instruments/piano/
├── C2.mp3, C3.mp3, C4.mp3, C5.mp3
├── manifest.json
└── LICENSE.md
src/audio/
├── sampled-instrument.ts
├── sampled-instrument.test.ts
└── sampled-instrument-integration.test.ts
```

---

#### 2. Tone.js Integration (From Phase 26)

**New Synth Types:**
| Synth | File | Description |
|-------|------|-------------|
| FM Synth | `toneSynths.ts` | Electric piano, bells, metallic |
| AM Synth | `toneSynths.ts` | Tremolo, vibrato textures |
| Membrane Synth | `toneSynths.ts` | Kick drums, toms |
| Metal Synth | `toneSynths.ts` | Cymbals, hi-hats |
| Pluck Synth | `toneSynths.ts` | Karplus-Strong plucked strings |
| Duo Synth | `toneSynths.ts` | Dual-voice layered synth |

**Files:**
```
src/audio/
├── toneSynths.ts (503 lines)
├── toneSynths.test.ts (358 lines)
├── toneSampler.ts (376 lines)
├── toneSampler.test.ts (242 lines)
├── tone-note-players.ts (210 lines)
```

---

#### 3. Advanced Dual-Oscillator Synth (From Phase 26)

**Features:**
- Dual oscillators with mix, detune (fine + coarse)
- Filter envelope (separate from amplitude ADSR)
- LFO with multiple destinations (filter, pitch, amplitude)
- 40+ presets covering all genres

**File:** `advancedSynth.ts` (863 lines) + tests (558 lines)

---

#### 4. Effects Chain (From Phase 26)

**Master Effects:**
| Effect | Parameters |
|--------|------------|
| Reverb | decay, wet |
| Delay | time (tempo-synced), feedback, wet |
| Chorus | frequency, depth, wet |
| Distortion | amount, wet |

**Files:**
```
src/audio/
├── toneEffects.ts (375 lines)
├── toneEffects.test.ts (364 lines)
src/components/
├── EffectsPanel.tsx (303 lines)
├── EffectsPanel.css (321 lines)
├── EffectsPanel.test.tsx (258 lines)
```

---

#### 5. XY Pad / Macro Controls (From Phase 26)

**Features:**
- Draggable XY pad for expressive control
- Parameter mapping system (filter, LFO, envelope)
- Preset mappings for common use cases

**Files:**
```
src/audio/
├── xyPad.ts (370 lines)
├── xyPad.test.ts (489 lines)
src/components/
├── XYPad.tsx (170 lines) - UI component ready
├── XYPad.css - Styling with touch support
```

**Status:** Engine + UI component both complete. Only needs integration into main app.

---

#### 6. Audio Infrastructure Improvements

| Feature | File | Lines |
|---------|------|-------|
| LRU sample cache | `lru-sample-cache.ts` | 398 |
| Lazy audio loading | `lazyAudioLoader.ts` | 172 |
| Centralized triggers | `audioTriggers.ts` | 391 |
| Note player abstraction | `note-player.ts` | 174 |
| Audio constants | `constants.ts` | 64 |
| Delay constants | `delay-constants.ts` | 28 |

**LRU Sample Cache (Complete):**
- Automatic eviction of least-recently-used samples
- Reference counting for active samples
- Memory budget enforcement
- Prevents unbounded memory growth

---

#### 7. UI Enhancements

**Transport with Integrated FX:**
- FX toggle button with active indicator
- Expandable effects panel below transport
- All effects controls inline

**Effects Master Bypass (Complete):**
- Bypass button in EffectsPanel.tsx (line 149)
- Toggle in Transport.tsx (line 121)
- Visual state indicator (`bypassed` class)

**SamplePicker Expansion:**
- New instrument categories (Keys, Bass, Leads, Pads, Drums)
- Tone.js synth presets
- Sampled instruments section

**Files modified:** `Transport.tsx`, `Transport.css`, `SamplePicker.tsx`, `SamplePicker.css`, `EffectsPanel.tsx`

---

#### 8. Memory Leak Fixes

| Location | Issue | Fix |
|----------|-------|-----|
| `engine.ts` | Unlock listeners never removed | `removeUnlockListeners()` method |
| `useMultiplayer.ts` | Clock sync handler chain | Restore original in cleanup |
| `App.tsx` | setTimeout in callback | useEffect + cleanup |
| `Recorder.tsx` | BufferSource not disconnected | `source.onended` cleanup |
| `StepSequencer.tsx` | Keyboard listener recreation | Ref pattern |

---

#### 9. Code Deduplication

| New File | Contents |
|----------|----------|
| `utils/math.ts` | `clamp()` function |
| `audio/delay-constants.ts` | `DELAY_TIME_OPTIONS` |
| `utils/track-utils.ts` | `findTrackById()`, `createStepsArray()`, `createParameterLocksArray()` |

---

#### 10. Bug Fixes

**Keyboard View for Sampled Instruments:**
- Created `isMelodicInstrument()` function in `TrackRow.tsx`
- Handles all instrument prefixes: `synth:`, `advanced:`, `sampled:`, `tone:`
- 62 tests in `TrackRow.test.ts`

---

#### 11. Test Coverage Expansion

**Audio tests alone: 5,963 lines**

| Test File | Lines | Coverage |
|-----------|-------|----------|
| advancedSynth.test.ts | 558 | Dual-osc, filter env, LFO |
| toneSynths.test.ts | 358 | All Tone.js synth types |
| toneEffects.test.ts | 364 | Effects chain |
| sampled-instrument-integration.test.ts | 513 | End-to-end sampling |
| xyPad.test.ts | 489 | XY pad mapping |
| volume-verification.test.ts | 569 | Audio levels |
| audioTriggers.test.ts | 354 | Trigger routing |
| instrument-routing.test.ts | 332 | Instrument selection |
| grid-effects.test.ts | 276 | Effects state |
| note-player.test.ts | 226 | Note playback |
| sample-constants.test.ts | 213 | Category validation |
| scheduler-synths.test.ts | 193 | Synth scheduling |

---

#### 12. Documentation Created

| Document | Lines | Content |
|----------|-------|---------|
| `specs/SYNTHESIS-ENGINE.md` | 1,808 | Complete synthesis spec |
| `docs/lessons-learned.md` | ~2,000 | Architecture lessons |
| `docs/implementation-comparison.md` | 598 | Engine comparison |
| `docs/instrument-research.md` | 420 | Instrument design |
| `docs/development-tools.md` | 246 | Dev tooling |
| `SYNTHESIS-ENGINE-ARCHITECTURE.md` | 387 | Architecture overview |
| `PHASE-21A-AUDIT-REPORT.md` | 823 | Audit findings |
| `VOLUME-VERIFICATION-ANALYSIS.md` | 318 | Volume analysis |

---

#### 13. Architecture Audit Findings

**Grade: B+ (Very Good)**

| Finding | Priority | Status |
|---------|----------|--------|
| Strong Web Audio best practices | ✅ | Implemented |
| Industry-standard lookahead scheduling | ✅ | Implemented |
| Lost compression when effects enabled | High | Documented |
| No output latency compensation | Medium | Documented |
| Unbounded sample memory growth | Medium | Documented |

---

#### 14. Playback Presence Indicators

**Per-player playback tracking for multiplayer sessions:**

Shows which players are currently playing via visual indicators on their avatars. Key architectural decision: **per-player tracking** (not session-wide boolean) since each player independently controls their own audio ("my ears, my control").

| Component | Implementation |
|-----------|----------------|
| Server tracking | `playingPlayers: Set<string>` in `live-session.ts` |
| Snapshot sync | `playingPlayerIds` included for new/reconnecting clients |
| Disconnect cleanup | Server broadcasts `playback_stopped` on behalf of disconnecting players |
| Client state | `playingPlayerIds: Set<string>` in `multiplayer.ts` |
| UI indicator | Pulsing animation + play icon badge on avatars |

**Files modified:**
```
src/worker/live-session.ts      # Per-player Set, handlers, cleanup
src/worker/mock-durable-object.ts  # Mirror server changes
src/worker/types.ts             # Snapshot type update
src/sync/multiplayer.ts         # Client state tracking
src/hooks/useMultiplayer.ts     # Expose playingPlayerIds
src/components/AvatarStack.tsx  # Play indicator UI
src/components/AvatarStack.css  # Pulsing animation styles
```

**Tests:** 10 new tests in `mock-durable-object.test.ts` covering:
- Play/stop message tracking
- Multiple simultaneous players
- Broadcast events
- Disconnect cleanup
- Idempotent play messages

---

#### Summary: What Was Pulled Forward

| From Phase | Feature | Status |
|------------|---------|--------|
| **26** | Sampled piano (multi-sampling) | ✅ Complete |
| **26** | Tone.js synth integration | ✅ Complete |
| **26** | Dual-oscillator advanced synth | ✅ Complete |
| **26** | Effects chain (reverb, delay, chorus, distortion) | ✅ Complete |
| **26** | Effects master bypass (engine + UI) | ✅ Complete |
| **26** | XY Pad engine + UI component | ✅ Complete |
| **26** | LRU sample cache | ✅ Complete |
| **26** | Lazy audio loading | ✅ Complete |
| **26** | Comprehensive synthesis spec | ✅ Complete |
| **11** | Playback presence indicators | ✅ Complete |

**Outcome:** Phase 26 (Advanced Synthesis Engine) is substantially complete. The app now has professional-quality synthesis comparable to Ableton's Learning Synths, with sampled piano, Tone.js integration, effects, and extensive test coverage. Additionally, multiplayer presence is enhanced with playback indicators. XY Pad has both engine (`xyPad.ts`) and UI component (`XYPad.tsx`) ready - only needs integration into main app flow.

---

### Phase 23: Percussion Expansion & Demo Fix

Add missing procedural percussion instruments to fix broken demo sessions and unlock Latin/Afrobeat/World genres.

> **Reference:** [INSTRUMENT-EXPANSION.md](./research/INSTRUMENT-EXPANSION.md) contains complete implementation code
> **Effort:** ~4 hours total
> **Impact:** Fixes 3 broken demo sessions, unlocks Latin/Afrobeat/World genres

---

#### Problem: Broken Demo Sessions

Three demo sessions reference instruments that were designed but never implemented:

| Session | Broken Instruments | Status |
|---------|-------------------|--------|
| `extended-afrobeat.json` | shaker, conga, synth:piano | 2/9 tracks silent |
| `polyrhythmic-evolution.json` | shaker, conga | 2/N tracks silent |
| `progressive-house-build.json` | synth:piano | 1/N tracks silent |

The `synth:piano` issue is a typo — should be `sampled:piano` (already implemented in Phase 22).

---

#### Solution: Procedural Percussion Samples

Implement 6 missing percussion sounds using the existing `samples.ts` procedural synthesis pattern:

| Instrument | Effort | Character | Genres Unlocked |
|------------|--------|-----------|-----------------|
| **shaker** | 30 min | High-frequency filtered noise burst | All (texture) |
| **conga** | 1 hr | Pitched membrane with slap transient | Latin, Afrobeat, World |
| **tambourine** | 1 hr | Metallic jingles + noise | Pop, Soul, Gospel |
| **clave** | 30 min | Two-tone wooden click | Latin, Afro-Cuban |
| **cabasa** | 15 min | Ultra-short noise burst | Latin |
| **woodblock** | 30 min | Resonant filtered click | Orchestral, World |

**Total: ~4 hours of implementation, zero external files required**

---

#### Implementation

All instruments follow the existing Pattern 1 (Synthesized Samples) from INSTRUMENT-EXPANSION.md:

**1. Add generator functions to `samples.ts`:**

```typescript
// Shaker - high-frequency filtered noise with fast attack/decay
async function createShaker(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.15;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const noise = Math.random() * 2 - 1;
    const envelope = Math.exp(-t * 25) * (1 - Math.exp(-t * 500));
    const filtered = noise * 0.7 + (Math.random() * 0.6 - 0.3);
    data[i] = filtered * envelope * 0.6;
  }
  return buffer;
}

// Conga - pitched membrane with slap transient
async function createConga(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.4;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const freq = 200 * Math.exp(-t * 3);
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const harmonic2 = Math.sin(2 * Math.PI * freq * 2.3 * t) * 0.3;
    const harmonic3 = Math.sin(2 * Math.PI * freq * 3.1 * t) * 0.15;
    const slap = (Math.random() * 2 - 1) * Math.exp(-t * 100) * 0.4;
    const envelope = Math.exp(-t * 6);
    data[i] = (fundamental + harmonic2 + harmonic3 + slap) * envelope * 0.7;
  }
  return buffer;
}
```

Full code for all 6 instruments is in [INSTRUMENT-EXPANSION.md](./research/INSTRUMENT-EXPANSION.md#missing-procedural-samples).

**2. Register in `createSynthesizedSamples()`:**

```typescript
samples.set('shaker', { id: 'shaker', name: 'Shaker', buffer: await createShaker(ctx), url: '' });
samples.set('conga', { id: 'conga', name: 'Conga', buffer: await createConga(ctx), url: '' });
samples.set('tambourine', { id: 'tambourine', name: 'Tambourine', buffer: await createTambourine(ctx), url: '' });
samples.set('clave', { id: 'clave', name: 'Clave', buffer: await createClave(ctx), url: '' });
samples.set('cabasa', { id: 'cabasa', name: 'Cabasa', buffer: await createCabasa(ctx), url: '' });
samples.set('woodblock', { id: 'woodblock', name: 'Woodblock', buffer: await createWoodblock(ctx), url: '' });
```

**3. Add to `INSTRUMENT_CATEGORIES` in `sample-constants.ts`:**

```typescript
// In drums category
{ id: 'shaker', name: 'Shaker', type: 'sample' },
{ id: 'conga', name: 'Conga', type: 'sample' },
{ id: 'tambourine', name: 'Tambourine', type: 'sample' },
{ id: 'clave', name: 'Clave', type: 'sample' },
{ id: 'cabasa', name: 'Cabasa', type: 'sample' },
{ id: 'woodblock', name: 'Woodblock', type: 'sample' },
```

**4. Fix demo session typos:**

| Session | Change |
|---------|--------|
| `progressive-house-build.json` | `synth:piano` → `sampled:piano` |
| `extended-afrobeat.json` | `synth:piano` → `sampled:piano` |

---

#### Testing

Add tests to `samples.test.ts`:

```typescript
describe('Procedural Percussion', () => {
  test.each(['shaker', 'conga', 'tambourine', 'clave', 'cabasa', 'woodblock'])(
    '%s generates valid AudioBuffer',
    async (sampleId) => {
      const samples = await createSynthesizedSamples(audioContext);
      const sample = samples.get(sampleId);
      expect(sample).toBeDefined();
      expect(sample.buffer.length).toBeGreaterThan(0);
    }
  );
});
```

---

#### Success Criteria

- [ ] All 6 percussion samples generate without errors
- [ ] Demo sessions play without silent tracks
- [ ] New instruments appear in SamplePicker under Drums
- [ ] Samples sound musically appropriate (subjective QA)
- [ ] No increase in bundle size (procedural = 0 bytes)

---

#### Outcome

Demo sessions work correctly. Latin, Afrobeat, and World genres are now achievable with authentic percussion palette. The implementation follows established patterns and adds zero bytes to bundle size.

---

### Phase 24: Hidden Feature UI Exposure

Expose Phase 22 engine features that lack UI controls.

> **Reference:** [HIDDEN-UI-FEATURES.md](./HIDDEN-UI-FEATURES.md)

**Note:** Effects bypass, XY Pad component, and LRU cache were already built in Phase 22 - see Phase 22 summary for details.

---

#### Engine Features Awaiting UI

| Feature | Engine Location | UI Status |
|---------|-----------------|-----------|
| Oneshot/Gate mode | `scheduler.ts`, `types.ts` | Needs toggle |
| XY Pad | `xyPad.ts` + `XYPad.tsx` | Needs app integration |
| FM synth params | `toneSynths.ts` | Needs controls |

---

#### 1. Playback Mode Toggle (Oneshot vs Gate)

**Engine:** ✅ Ready (`playbackMode: 'oneshot' | 'gate'` in types.ts)

**UI needed:** Toggle in track header (expanded view).

| Mode | Behavior | Best For |
|------|----------|----------|
| **Oneshot** | Note plays full duration | Drums, percussion |
| **Gate** | Note stops when step ends | Melodic lines, chords |

**Implementation:**
```tsx
// In TrackHeader.tsx (expanded view)
<button
  className="playback-mode-toggle"
  onClick={() => togglePlaybackMode(track.id)}
>
  {track.playbackMode === 'oneshot' ? '⚡ Oneshot' : '🎹 Gate'}
</button>
```

---

#### 2. XY Pad Integration

**Engine:** ✅ Ready (`xyPad.ts` with parameter mapping)
**Component:** ✅ Ready (`XYPad.tsx` with touch support)

**Integration needed:** Connect XYPad component to synth tracks.

```
┌─────────────────────┐
│    ┌─────────┐      │
│    │    ●    │      │
│    │         │      │
│    └─────────┘      │
├─────────────────────┤
│ X: Filter Cutoff    │
│ Y: Resonance        │
│ [Preset: Default ▼] │
└─────────────────────┘
```

**Features:**
- Drag to control two parameters simultaneously
- Preset mappings: Filter/Resonance, Pitch/Mod, Attack/Release
- Touch-friendly (200x200px minimum)
- Values sync to multiplayer

---

#### 3. FM Synthesis Controls

**Engine:** ✅ Ready (`toneSynths.ts` FM params)

**UI needed:** Additional controls when FM synth is selected.

```
┌─────────────────────────────────────────┐
│ FM Electric Piano                        │
├─────────────────────────────────────────┤
│ Harmonicity   [────●────]  1.5x         │
│ Mod Index     [────●────]  2.0          │
└─────────────────────────────────────────┘
```

**Implementation:**
- Show FM controls only when instrument starts with `tone:fm-`
- Store FM params in track state, sync to multiplayer

---

#### Success Criteria

- [ ] Playback mode toggle in track header
- [ ] XY Pad accessible from synth tracks
- [ ] FM controls shown for FM instruments

**Outcome:** All Phase 22 engine features have corresponding UI controls.

---

### Phase 25: Mobile UI Polish

Native mobile experience improvements.

---

#### Mobile Action Sheets

| Item | Description | Priority |
|------|-------------|----------|
| **Invite action sheet** | Native-feeling bottom sheet on iOS/Android | High |
| **QR sharing action sheet** | "Show QR Code" option | High |
| **Track options sheet** | Delete, duplicate, mute options | Medium |

**Implementation:**
```tsx
// Using @radix-ui/react-dialog or custom sheet component
<ActionSheet open={isOpen} onClose={onClose}>
  <ActionSheet.Item onClick={handleInvite}>
    Invite to Session
  </ActionSheet.Item>
  <ActionSheet.Item onClick={handleQR}>
    Show QR Code
  </ActionSheet.Item>
</ActionSheet>
```

---

#### Loading States

| State | Implementation |
|-------|----------------|
| **Session loading** | Skeleton screens for tracks |
| **Instrument loading** | Shimmer effect on SamplePicker |
| **Effects loading** | Disabled state during Tone.js init |

---

#### Touch Interactions

| Interaction | Implementation |
|-------------|----------------|
| **Long-press for p-locks** | Show parameter menu on 500ms hold |
| **Swipe to delete track** | Swipe-to-reveal delete button |
| **Haptic feedback** | Vibrate on step toggle (where supported) |

---

#### Success Criteria

- [ ] Action sheets feel native on iOS and Android
- [ ] No layout shifts during loading
- [ ] Long-press works for parameter locks
- [ ] Haptic feedback on supported devices

**Outcome:** Mobile-first experience matching native app quality.

---

### Phase 26: Performance & React Best Practices

Optimize rendering and apply React best practices.

> **Reference:** [REACT-BEST-PRACTICES.md](./research/REACT-BEST-PRACTICES.md)

---

#### React Optimizations

| Area | Action | Priority | Impact |
|------|--------|----------|--------|
| **State Management** | Evaluate Zustand for sequencer state | Medium | Reduced re-renders |
| **Memoization** | Add React.memo to StepButton | High | Smoother playback |
| **Concurrent Features** | useTransition for search, useDeferredValue for cursors | Medium | Better responsiveness |
| **Error Boundaries** | Add feature-level boundaries | High | Graceful failures |

---

#### Performance Targets

| Metric | Target | Current | Action |
|--------|--------|---------|--------|
| **Lighthouse Performance** | > 90 | TBD | Profile and optimize |
| **First Contentful Paint** | < 1.5s | TBD | Code splitting |
| **Time to Interactive** | < 3s | TBD | Lazy-load audio |
| **StepButton re-renders** | < 1ms | TBD | React.memo |

---

#### Code Splitting

```typescript
// Lazy-load heavy components
const EffectsPanel = lazy(() => import('./components/EffectsPanel'));
const XYPadPanel = lazy(() => import('./components/XYPadPanel'));
const ChromaticGrid = lazy(() => import('./components/ChromaticGrid'));
```

---

#### Error Boundaries

```tsx
// Feature-level error boundaries
<ErrorBoundary fallback={<SequencerError />}>
  <StepSequencer />
</ErrorBoundary>

<ErrorBoundary fallback={<AudioError />}>
  <AudioEngine />
</ErrorBoundary>

<ErrorBoundary fallback={<MultiplayerError />}>
  <MultiplayerProvider />
</ErrorBoundary>
```

---

#### Audio Performance

| Item | Description | Target |
|------|-------------|--------|
| **Concurrent voices** | Limit simultaneous playback | Max 8 |
| **Sample loading** | Load on-demand | < 100ms per sample |
| **Effect processing** | Optimize wet/dry mixing | < 5ms latency |

---

#### Success Criteria

- [ ] Lighthouse performance score > 90
- [ ] No React performance warnings
- [ ] Error boundaries catch and display failures
- [ ] StepButton renders in < 1ms
- [ ] Code splitting reduces initial bundle by 30%

**Outcome:** Professional-grade performance and reliability.

---

### Phase 27: Authentication & Session Ownership

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

### Phase 21: Publishing (Immutable Sessions) ✅ COMPLETE

> **Spec:** See [SHARING-AND-PUBLISHING.md](./SHARING-AND-PUBLISHING.md) for the complete specification.

#### Summary

Replace "Send Copy" with "Publish" — a single action that creates an immutable session safe for 1:many broadcast.

#### ✅ Implemented

**Data & API:**
- [x] Add `immutable: boolean` field to Session data model
- [x] Implement `POST /api/sessions/{id}/publish` endpoint
- [x] Block updates on immutable sessions (return 403)
- [x] Block PATCH (rename) on immutable sessions (return 403)
- [x] Remixes of published sessions are editable (`immutable: false`)

**Desktop UI:**
- [x] Replace "Send Copy" with "Publish", reorder to: Publish, Remix, New, Invite
- [x] Style Invite as outline button with visual separation
- [x] Purple gradient style for Publish button (primary action)
- [x] Published badge shows when viewing published session
- [x] Hide Publish button on already-published sessions

**Testing:**
- [x] 8 integration tests for publishing feature
- [x] Tests cover: publish endpoint, idempotency, 403 blocking, remix from published

#### Button Order

```
[Publish] [Remix] [New]                    [Invite ▾]
─────────────────────────                  ─────────
    Filled (safe)                          Outline (exposes session)
```

#### Key Design Decisions

1. **Immutability at publish** — Published sessions are frozen forever, not toggleable
2. **No separate URL scheme** — All sessions use `/s/{id}`, behavior determined by `immutable` flag
3. **Invite is distinct** — Outline style + separation signals "different intent" for collaboration
4. **Idempotent publish** — Calling publish twice returns success (already published)
5. **403 with helpful message** — Blocked updates explain why and suggest Remix

#### Data Model Change

```typescript
interface Session {
  // ... existing fields
  immutable: boolean;  // true = published (frozen forever)
}
```

**Outcome:** Safe 1:many sharing via immutable published sessions. Users can publish their work and share the link knowing recipients can only listen and remix, not modify.

---

### Phase 28: Session Provenance

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

### Phase 29: Playwright E2E Testing

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

### Phase 30: Public API

Provide authenticated API access for third-party integrations, bots, and developer tools.

> **Prerequisite:** Phase 27 (Authentication) must be complete before implementing public API access.

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

### Phase 31: Keyboard Shortcuts

Add global keyboard shortcuts for efficient workflow.

> **Spec:** See [KEYBOARD-SHORTCUTS.md](./KEYBOARD-SHORTCUTS.md) for full specification and design principles.

#### High Priority (Transport)

| Shortcut | Action | Status |
|----------|--------|--------|
| Space | Play/Pause | ⬜ Not implemented |
| Escape | Stop + Reset / Cancel / Close overlay | ✅ Partial (cancel copy, close QR) |

#### Medium Priority (Navigation)

| Shortcut | Action | Status |
|----------|--------|--------|
| ↑/↓ | Select previous/next track | ⬜ Not implemented |
| Tab | Move to next track | ⬜ Not implemented |
| Enter | Toggle step on focused track | ⬜ Not implemented |

#### Implementation Requirements

1. **Focus management system** — Visual focus ring on tracks, keyboard navigation
2. **Global vs contextual shortcuts** — Space works everywhere, arrow keys need focus context
3. **Touch parity** — Every shortcut must have a touch equivalent (already exists for most)
4. **Accessibility** — Follow ARIA grid patterns for screen reader support

#### Design Decisions (from spec)

- **No exclusive solo** — Shift+Click means "disclose details", not "exclude others"
- **Shift+Click = p-lock editor** — Established pattern, don't overload

**Outcome:** Power users can navigate and control Keyboardia without touching the mouse.

---

### Phase 32: MIDI Export

Export sessions as Standard MIDI Files for DAW integration.

> **Spec:** See [MIDI-EXPORT.md](./MIDI-EXPORT.md) for full specification including note mapping, tempo handling, and file format details.

#### Features

- **SMF Type 1** format (multi-track)
- **480 ticks per quarter note** (industry standard)
- One MIDI track per Keyboardia track
- Tempo and time signature meta events
- Parameter locks → note pitch offsets
- Swing → note timing offsets

#### Implementation

```typescript
// Export flow
const midiFile = exportToMIDI(session);
downloadBlob(midiFile, `${session.name || 'keyboardia'}.mid`);
```

#### UI

- Export button in session controls (or menu)
- Keyboard shortcut: `⌘+Shift+E` / `Ctrl+Shift+E`

#### Mapping (from spec)

| Keyboardia | MIDI |
|------------|------|
| Track | MIDI Track (channel 1-16) |
| Step with note | Note On/Off events |
| Pitch lock | Note number offset |
| Volume lock | Velocity |
| Tempo | Tempo meta event |
| Swing | Timing offset on off-beats |

**Outcome:** Users can export their Keyboardia creations to Ableton, Logic, FL Studio, or any DAW.

---

### Phase 33: Admin Dashboard & Operations

Administrative tools for session management and system health.

> **Reference:** [SESSION-LIFECYCLE.md](./SESSION-LIFECYCLE.md) — Orphan handling section

#### Orphan Session Cleanup

Sessions inactive for 90+ days are "orphaned". Currently we show a UI banner, but no cleanup occurs.

**Background cleanup job:**
```typescript
// Cloudflare Cron Trigger (daily)
export default {
  async scheduled(event, env, ctx) {
    const orphanThreshold = Date.now() - (90 * 24 * 60 * 60 * 1000);
    // Query KV for sessions with lastAccessedAt < threshold
    // Archive to R2 or delete
  }
}
```

**Options:**
| Strategy | Pros | Cons |
|----------|------|------|
| Hard delete | Simple, saves storage | Data loss |
| Archive to R2 | Recoverable | Complexity |
| Soft delete (flag) | Reversible | Still uses KV quota |

**Recommended:** Archive to R2 with 1-year retention, then hard delete.

#### Admin Dashboard

Web UI for operations team (requires auth):

- **Session metrics** — Total sessions, active today, created today
- **Orphan report** — List of orphaned sessions, archive/delete actions
- **Quota monitoring** — KV reads/writes, DO requests, R2 storage
- **Error logs** — Recent 500s, WebSocket failures
- **Player activity** — Concurrent users, peak times

#### Implementation

1. **Cron trigger** for daily orphan scan
2. **Admin API endpoints** (`/api/admin/*`) with auth check
3. **Dashboard UI** — Simple React admin panel
4. **Alerts** — Email/Slack on quota warnings

**Outcome:** Operations visibility and automated cleanup of stale data.

---

### Phase 34: Developer Debug Panel

Hidden debug panel for developers and power users to diagnose multiplayer and audio issues.

> **Activation:** `?debug=1` URL parameter or keyboard shortcut (Ctrl+Shift+D)

#### Sync Metrics Display

Real-time multiplayer connection diagnostics:

```
┌─────────────────────────────────┐
│ 🔧 Debug Panel           [×]   │
├─────────────────────────────────┤
│ Connection                      │
│ Status: connected ●             │
│ Latency (RTT): 45ms             │
│ Clock offset: +12ms             │
│ Last sync: 2s ago               │
├─────────────────────────────────┤
│ Quality                         │
│ P95 RTT: 82ms ✓                 │
│ Drift: 8ms (target <50ms) ✓     │
│ Messages: 142 sent / 138 recv   │
├─────────────────────────────────┤
│ State                           │
│ Hash: abc123                    │
│ Players: 3 connected            │
│ Snapshot v: 47                  │
└─────────────────────────────────┘
```

#### Connection Quality Indicator

Visual indicator in main UI (separate from panel):

| RTT | Icon | Meaning |
|-----|------|---------|
| <50ms | 🟢 | Excellent |
| 50-100ms | 🟡 | Good |
| 100-200ms | 🟠 | Fair |
| >200ms | 🔴 | Poor |

#### Implementation

**Data sources (already exist):**
- `multiplayer.ts`: RTT, clock offset, message counts
- `clockSync.ts`: Drift calculation, P95 latency
- `websocket.ts`: Connection state, retry count

**New components:**
```
src/components/DebugPanel/
├── DebugPanel.tsx       # Main container
├── DebugPanel.css       # Floating panel styles
├── SyncMetrics.tsx      # Connection diagnostics
├── StateInspector.tsx   # Grid state viewer
└── useDebugMode.ts      # ?debug=1 hook
```

**Features:**
1. **Sync Metrics** — RTT, offset, drift, message counts
2. **State Inspector** — View current grid state hash, track count
3. **Connection Quality** — P95 latency, quality grade
4. **Event Log** — Recent WebSocket messages (scrollable)
5. **Export** — Download debug info as JSON for bug reports

#### Privacy Considerations

- Debug panel only shows local client's metrics
- No access to other players' data
- Event log can be cleared
- Panel position persists in localStorage

**Outcome:** Developers can diagnose sync issues without console diving. Power users can verify connection quality.

---

### Phase 35: Beat-Quantized Changes

Batch remote changes to musical boundaries for a more musical collaborative experience.

> **Moved from Phase 11** — This feature requires dedicated design work and careful consideration of edge cases.
> **Priority:** Low — Nice-to-have polish for multiplayer UX

---

#### Problem Statement

When multiple users edit a session simultaneously, changes can feel jarring and random. A user might toggle a step while the beat is playing, causing an audible "pop" or unexpected timing.

#### Proposed Solution

Quantize remote changes to musical boundaries:

```
16th note @ 120 BPM = 125ms delay (imperceptible)
```

---

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

---

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

---

#### Success Criteria

- [ ] Remote step changes feel musical, not random
- [ ] Local changes remain instant (no perceived lag)
- [ ] No audible artifacts when changes apply
- [ ] Visual feedback clearly communicates pending changes

**Outcome:** Collaborative editing feels like musical call-and-response rather than chaotic interference.

---

### Phase 36: Instrument Library Expansion

Expand the sampled instrument library beyond piano to unlock new genres.

> **Status:** Engine complete (Phase 22). This phase adds content using the existing `SampledInstrumentEngine`.
> **Reference:** [INSTRUMENT-EXPANSION.md](./research/INSTRUMENT-EXPANSION.md) for implementation patterns and verified sources
> **Priority:** Low — Core features take precedence; this is content expansion

---

#### Prerequisites (Already Built)

The `SampledInstrumentEngine` infrastructure is production-ready:

| Component | Status | Location |
|-----------|--------|----------|
| Multi-sampling with pitch-shifting | ✅ | `sampled-instrument.ts` |
| Progressive loading (C4 first) | ✅ | `loadIndividualFiles()` |
| LRU cache with memory bounds | ✅ | `lru-sample-cache.ts` |
| Audio sprite support | ✅ | `loadSprite()` |
| Piano reference implementation | ✅ | `/public/instruments/piano/` |

---

#### Tier 1: Texture Samples (~500KB total)

Single-sample instruments that add atmosphere and character:

| Instrument | Source | License | Size | Genres Unlocked |
|------------|--------|---------|------|-----------------|
| `vinyl_crackle` | Freesound | CC0 | ~30KB | Lo-fi hip-hop, Synthwave |
| `tape_hiss` | Freesound | CC0 | ~30KB | Lo-fi, Vaporwave |
| `brass_stab` | VSCO 2 CE | CC0 | ~100KB | Soul, Disco, Funk |
| `orch_hit` | VSCO 2 CE | CC0 | ~100KB | Cinematic, EDM, 80s |
| `choir_ah` | VSCO 2 CE | CC0 | ~200KB | Gospel, Ambient, Cinematic |

**Implementation:** Single-sample instruments use the existing `SampledInstrument` class with just one sample entry in the manifest. Pitch-shifting handles all notes.

---

#### Tier 2: Multi-Sample Instruments (~1.7MB total)

Following the piano pattern (4 samples per octave):

| Instrument | Source | License | Samples | Size | Genres Unlocked |
|------------|--------|---------|---------|------|-----------------|
| `electric_bass` | U of Iowa | Public Domain | 4 | ~400KB | Funk, Soul, Jazz, Rock |
| `upright_bass` | U of Iowa | Public Domain | 4 | ~400KB | Jazz, Soul, Motown |
| `nylon_guitar` | U of Iowa | Public Domain | 5 | ~500KB | Folk, Bossa Nova, Cinematic |
| `organ` | Pianobook | Free | 4 | ~400KB | Gospel, Jazz, Rock |

---

#### Implementation Pattern

Each instrument follows the piano pattern:

**1. Directory structure:**
```
public/instruments/{id}/
├── manifest.json    # Sample mappings, credits
├── C2.mp3          # Low sample
├── C3.mp3          # Mid-low sample
├── C4.mp3          # Middle sample
└── C5.mp3          # High sample
```

**2. Manifest format:**
```json
{
  "id": "electric_bass",
  "name": "Electric Bass",
  "type": "sampled",
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ],
  "baseNote": 48,
  "releaseTime": 0.3,
  "credits": {
    "source": "University of Iowa",
    "url": "https://theremin.music.uiowa.edu/",
    "license": "Public Domain"
  }
}
```

**3. Registration:**
```typescript
// In sample-constants.ts
export const SAMPLED_INSTRUMENTS: SampledInstrumentDefinition[] = [
  { id: 'piano', name: 'Grand Piano', ... },
  { id: 'electric_bass', name: 'Electric Bass', category: 'bass' },
  // ...
];
```

---

#### Verified Sample Sources

| Source | URL | License | Best For |
|--------|-----|---------|----------|
| **U of Iowa** | theremin.music.uiowa.edu | Public Domain | Bass, Guitar, Piano |
| **VSCO 2 CE** | versilian-studios.com/vsco-community | CC0 | Brass, Choir, Strings |
| **Philharmonia** | philharmonia.co.uk/resources/sound-samples | CC | Orchestral one-shots |
| **Freesound** | freesound.org/browse/tags/cc0 | CC0 | Vinyl, Tape, FX |
| **Pianobook** | pianobook.co.uk | Free | Organ, Kalimba, World |

---

#### Success Criteria

- [ ] Each instrument loads and plays without errors
- [ ] Instruments appear in SamplePicker under appropriate category
- [ ] Total additional bundle size < 2.5MB
- [ ] LRU cache handles memory pressure correctly
- [ ] Credits displayed in instrument info

---

#### Deferred

| Feature | Reason |
|---------|--------|
| Per-track effects | Global effects sufficient for MVP |

**Outcome:** Rich instrument palette for soul, funk, jazz, lo-fi, and cinematic genres. All content uses verified CC0/Public Domain sources.

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
| **21** | **Publishing** | **Immutable sessions for 1:many sharing** | KV | ✅ |
| **21.5** | **Stabilization** | **Critical bug fixes from codebase audit** | All | ✅ |
| **22** | **Synthesis Engine & Codebase Audit** | **Tone.js, sampled piano, effects, 19K lines** | All | ✅ |
| **23** | **Percussion Expansion** | **6 procedural samples, fix broken demos** | — | **Next** |
| 24 | Hidden Feature UI Exposure | Playback mode, XY Pad, FM controls | — | — |
| 25 | Mobile UI Polish | Action sheets, loading states, touch | — | — |
| 26 | Performance & React | Memoization, code splitting, error boundaries | — | — |
| 27 | Auth & ownership | Claim sessions, ownership model | D1 + BetterAuth | — |
| 28 | Session Provenance | Rich clipboard, family tree | KV | — |
| 29 | Playwright E2E Testing | Multi-client, cross-browser, network tests | All | — |
| 30 | Public API | Authenticated API access for integrations | All | — |
| 31 | Keyboard Shortcuts | Space for play/pause, arrow navigation | — | — |
| 32 | MIDI Export | Export to DAW (SMF Type 1) | — | — |
| 33 | Admin Dashboard & Operations | Orphan cleanup, metrics, alerts | All | — |
| 34 | Developer Debug Panel | Sync metrics, connection quality, state inspector | — | — |
| 35 | Beat-Quantized Changes | Musical sync for remote edits | DO | — |
| 36 | Instrument Library Expansion | Sampled bass, guitar, organ, textures | R2 | — |

> ✅ **Phase 22:** The synthesis engine was pulled forward and implemented in Phase 22. See `app/docs/lessons-learned.md` for architectural lessons learned.
> 📁 **Archived:** Shared Sample Recording moved to `specs/archive/SHARED-SAMPLE-RECORDING.md`
