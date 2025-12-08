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

### Phase 3: Session Persistence & Sharing ← NEW

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

> **Design decision:** We chose actual step count (4/8/16/32/64) over multipliers because:
> - Simpler mental model — "8 steps" is clearer than "0.5x multiplier"
> - All steps are visible and editable (with inline scrolling)
> - Matches hardware like Elektron Digitakt and OP-Z

```typescript
interface Track {
  // ... existing fields
  stepCount: 4 | 8 | 16 | 32 | 64;  // Default: 16
}
```

| Step Count | Bars | Loops/Bar | Use Case |
|------------|------|-----------|----------|
| **4** | 0.25 | 4× | Four-on-the-floor kick, pulse patterns, motorik beat |
| **8** | 0.5 | 2× | Half-bar phrases, 8th-note arpeggios, Afrobeat percussion |
| 16 | 1 | 1× | Standard drums, basslines |
| 32 | 2 | 0.5× | Basslines with variation, 2-bar melodies |
| 64 | 4 | 0.25× | Long melodies, chord progressions, evolving patterns |

**Polyrhythmic possibilities:**

| Combo | Resolution | Musical Style |
|-------|------------|---------------|
| 4 vs 16 | 1 bar | Pulse under complex melody (minimal techno) |
| 4 vs 32 | 2 bars | Hypnotic repetition (Berlin minimal) |
| 8 vs 16 | 1 bar | Half-time feel (boom-bap, lo-fi) |
| 8 vs 12* | 1.5 bars | Afrobeat / West African clave |
| 4 vs 8 vs 16 | 1 bar | Layered polyrhythm |

*Note: 12-step patterns require manual entry (reducer accepts 1-64, UI shows 4/8/16/32/64)

**How it works:**
- Each track shows its actual number of steps (with horizontal scrolling if needed)
- Step count **dropdown** in track controls (supports 5 options cleanly)
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

// Step count options in types.ts
export const STEP_COUNT_OPTIONS = [4, 8, 16, 32, 64] as const;
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
- **2 octaves visible** — Scrollable for more range

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

### Phase 5: Sharing UI Polish

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

### Phase 6: Observability

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

### Phase 7: Cloudflare Backend Setup

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

### Phase 8: Multiplayer State Sync

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

### Phase 9: Clock Sync (Multiplayer Audio)

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

### Phase 10: Polish & Production

1. **Error handling:**
   - Reconnection logic with exponential backoff
   - Graceful degradation to single-player mode if backend unavailable
   - Handle R2 upload failures

2. **UI polish:**
   - Player indicators (who's in the session)
   - Visual feedback for other players' actions
   - Better mobile support (optional)

3. **Performance:**
   - Lazy-load preset samples
   - Limit concurrent audio playback
   - Optimize WebSocket message size

4. **Testing:**
   - Multi-player sync accuracy tests
   - Cross-browser testing
   - Network resilience testing

---

### Phase 11: Authentication & Session Ownership

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

### Phase 12: Shared Sample Recording

Allow multiplayer users to share recorded samples in real-time.

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

### Phase 13: Publishing Platform (Beats)

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

### Phase 14: Advanced Synthesis Engine

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

| Phase | Focus | Outcome | Backend | Multiplayer? |
|-------|-------|---------|---------|--------------|
| 1 | Local audio + step sequencer | **Sound works!** | None | No (single player) |
| 2 | Mic recording + custom instruments | Recordings become new tracks | None | No (single player) |
| 3 | **Session persistence & sharing** | **Save, share, remix patterns** | **KV** | **No (single player)** |
| 4A | Per-track step count (4/8/16/32/64) | Polyrhythms, pulse patterns | KV | No (single player) |
| 4B | Chromatic Step View | Inline pitch editing for melodies | KV | No (single player) |
| 5 | **Sharing UI polish** | **Invite/Send Copy/Remix, lineage** | **KV** | **No (single player)** |
| 6 | Observability | Logging, metrics, debug mode | KV | No (single player) |
| 7 | Cloudflare backend setup | Infra deployed | KV + DO + R2 | Backend only |
| 8 | Multiplayer state sync | Shared grid | DO | Yes (visual sync) |
| 9 | Clock sync | Synced playback | DO | Yes (audio sync) |
| 10 | Polish & production | Usable MVP | All | Yes |
| 11 | Auth & ownership | Claim sessions, lock to readonly | D1 + BetterAuth | Optional |
| 12 | Shared sample recording | Shared custom sounds | R2 | Yes (full feature) |
| 13 | ⚠️ Publishing platform | Beats, social features (TBD) | KV + D1 | Platform |
| 14 | Advanced Synthesis | Rich instruments, sampled piano | R2 | No |
