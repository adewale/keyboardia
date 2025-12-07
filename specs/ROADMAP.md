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
   | `/api/sessions/{uuid}/fork` | POST | Fork session |

4. **Session data model:**
   ```typescript
   interface Session {
     id: string;                    // UUID v4 (unguessable)
     createdAt: number;
     updatedAt: number;
     forkedFrom: string | null;     // Parent session ID
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
   └── session.ts             # Load, save, fork sessions
   ```

   - Auto-save with 2-second debounce
   - Update URL on session create/fork
   - Handle expired/invalid session IDs gracefully

6. **URL scheme:**
   ```
   /                           # New empty session (generates UUID)
   /s/{uuid}                   # Load existing session
   /s/{uuid}/fork              # Fork to new session
   ```

7. **UI additions:**
   - Share button (copy URL to clipboard)
   - Fork button (create editable copy)
   - New button (create fresh session)
   - Handle "session not found" error

**Outcome:** Users can share a link to their pattern. Anyone with the link can view, edit, or fork it. Sessions persist for 30 days.

---

### Phase 4: Extended Patterns & Cloudflare Backend Setup ✅ (Partial)

Extend beat lengths beyond 1 bar, and set up infrastructure for multiplayer.

#### 4A: Per-Track Step Count ✅ IMPLEMENTED

Each track can have a different step count, creating polyrhythmic patterns.

> **Design decision:** We chose actual step count (16/32/64) over multipliers because:
> - Simpler mental model — "32 steps" is clearer than "2x multiplier"
> - All steps are visible and editable (with inline scrolling)
> - Matches hardware like Elektron Digitakt

```typescript
interface Track {
  // ... existing fields
  stepCount: 16 | 32 | 64;  // Default: 16
}
```

| Step Count | Bars | Use Case |
|------------|------|----------|
| 16 | 1 | Drums, short loops |
| 32 | 2 | Basslines with variation |
| 64 | 4 | Melodies, chord progressions |

**How it works:**
- Each track shows its actual number of steps (with horizontal scrolling if needed)
- Step preset buttons `[16] [32] [64]` in track controls
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
```

**Visual design:**
- Page separators every 16 steps (subtle gap)
- Inline scrolling when steps exceed viewport width
- Fixed-width track controls prevent layout shift during playback

#### Pattern Chaining (Future)

Chain multiple patterns for song arrangement — deferred to future phase.

---

#### 4B: Cloudflare Backend Setup

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

### Phase 5: Multiplayer State Sync

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

### Phase 6: Clock Sync (Multiplayer Audio)

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

### Phase 7: Shared Sample Recording

Allow recorded samples to be shared with other players in the session.

1. **Upload pipeline:**
   ```
   Mic → MediaRecorder → Blob → Upload to R2 → Get URL → Broadcast to session
   ```

2. **R2 integration:**
   - Upload samples via Worker endpoint
   - Return signed URL for download
   - Set lifecycle rule for auto-cleanup (e.g., 2 hours)

3. **Broadcast:**
   ```typescript
   { type: "sample_added", trackId: 2, url: "https://...", name: "my-sound" }
   ```

4. **Client handling:**
   - Receive URL, fetch sample, decode to AudioBuffer
   - Add to local sample library

**Outcome:** Player A records a sound, Player B hears it in the mix.

---

### Phase 8: Polish & Production

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

### Phase 9: Authentication & Session Ownership

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
   | `readonly` | Full edit | View only, must fork to edit |

4. **Claiming anonymous sessions:**
   - User creates session anonymously → later signs in → can claim ownership
   - Ownership stored in session, verified via auth token

5. **UI additions:**
   - Sign in / Sign out button in header
   - "Lock session" toggle (owner only) → switches to readonly mode
   - Readonly indicator for non-owners viewing locked sessions
   - "Fork to edit" button when viewing readonly session

6. **API changes:**
   - `PATCH /api/sessions/:id` — Update mode (owner only)
   - `POST /api/sessions/:id/claim` — Claim ownership (authenticated users)
   - All write endpoints check ownership + mode before allowing edits

**Outcome:** Users can sign in to claim sessions and lock them for solo playback. Anonymous sessions remain collaborative by default.

---

### Phase 10: Sessions vs Beats (Collaboration vs Sharing)

Distinguish between two fundamentally different sharing intentions:

1. **Share Session** — "Come make music with me" (collaboration)
2. **Share Beat** — "Listen to what I made" (publishing)

#### Core Concepts

| Concept | Purpose | Mutability | URL Pattern |
|---------|---------|------------|-------------|
| **Session** | Live workspace for creating music | Editable by collaborators | `/s/{sessionId}` |
| **Beat** | Snapshot of a session at a point in time | Immutable | `/b/{beatId}` |

#### Data Model

```typescript
interface Session {
  id: string;
  // ... existing fields
  beats: string[];  // IDs of beats published from this session
}

interface Beat {
  id: string;                    // UUID v4
  sourceSessionId: string;       // Session it was created from
  createdAt: number;
  createdBy: string | null;      // User ID if authenticated
  name: string | null;           // Optional title
  state: SessionState;           // Frozen copy of session state
}
```

#### User Flows

**Creating a Beat (Publishing):**
```
1. User working in session
2. Clicks "Publish Beat" button
3. Optionally names the beat
4. System creates immutable Beat snapshot
5. User gets shareable URL: /b/{beatId}
6. Session continues to evolve independently
```

**Viewing a Beat:**
```
1. Visitor opens /b/{beatId}
2. Sees readonly playback interface
3. Can listen, but cannot edit
4. "Remix" button → forks into new session for editing
```

**Sharing a Session (Collaboration):**
```
1. User clicks "Invite" (not "Share")
2. Gets session URL: /s/{sessionId}
3. Collaborators join and edit together
4. Changes sync in real-time (Phase 5-6)
```

#### UI Changes

**Session view (workspace):**
- "Invite" button → copies session URL for collaborators
- "Publish Beat" button → creates immutable snapshot
- Beat history panel showing previously published beats

**Beat view (readonly):**
- Clean playback-focused interface
- Play/pause, tempo display (no editing)
- "Remix" button → fork to new session
- Link back to source session (if still exists)
- Creator attribution (if authenticated)

#### API Endpoints

```
POST /api/sessions/{id}/beats     Create beat from session
GET  /api/beats/{id}              Get beat
GET  /api/sessions/{id}/beats     List beats from session
```

#### Conceptual Distinction

| Sharing Sessions | Sharing Beats |
|-----------------|---------------|
| "Let's jam together" | "Check out my track" |
| Mutable, collaborative | Immutable, presentational |
| Real-time sync | Static snapshot |
| Work in progress | Finished (enough to share) |
| `/s/{id}` | `/b/{id}` |

#### Storage Considerations

- Beats are stored in KV (like sessions)
- Beats reference the same R2 samples as source session
- Beats have longer TTL (90 days? or permanent for authenticated users)
- Session deletion doesn't delete its beats

**Outcome:** Clear separation between collaborative workspaces (sessions) and shareable artifacts (beats). Users can publish snapshots of their work without worrying about future edits affecting what they shared.

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
| 3 | **Session persistence & sharing** | **Save, share, fork patterns** | **KV** | **No (single player)** |
| 4 | Cloudflare backend setup | Infra deployed | KV + DO + R2 | Backend only |
| 5 | Multiplayer state sync | Shared grid | DO | Yes (visual sync) |
| 6 | Clock sync | Synced playback | DO | Yes (audio sync) |
| 7 | Shared sample recording | Shared custom sounds | R2 | Yes (full feature) |
| 8 | Polish & production | Usable MVP | All | Yes |
| 9 | Auth & ownership | Claim sessions, lock to readonly | D1 + BetterAuth | Optional |
| 10 | Sessions vs Beats | Collaborate (session) vs publish (beat) | KV | Conceptual |
