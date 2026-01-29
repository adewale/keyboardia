# Keyboardia Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE EDGE                                 │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────────────────┐    │
│  │                 │    │           DURABLE OBJECT                     │    │
│  │  Cloudflare     │    │         (one per live session)               │    │
│  │  Worker         │    │                                              │    │
│  │                 │    │  ┌─────────────────────────────────────┐    │    │
│  │  Routes:        │───▶│  │  Session State                      │    │    │
│  │  - /api/sessions│    │  │  - tracks: step patterns + samples  │    │    │
│  │  - /s/:id       │    │  │  - tempo: BPM                       │    │    │
│  │  - /api/.../ws  │    │  │  - swing: 0-100%                    │    │    │
│  │  - Static assets│    │  │  - players: Map<WebSocket, Player>  │    │    │
│  └─────────────────┘    │  └─────────────────────────────────────┘    │    │
│                         │                                              │    │
│                         │  ┌─────────────────────────────────────┐    │    │
│                         │  │  Responsibilities                    │    │    │
│                         │  │  - Accept WebSocket connections      │    │    │
│                         │  │  - Broadcast state changes           │    │    │
│                         │  │  - Clock sync (on request)           │    │    │
│                         │  │  - State hash verification           │    │    │
│                         │  │  - Player identity generation        │    │    │
│                         │  │  - Debounced KV persistence          │    │    │
│                         │  └─────────────────────────────────────┘    │    │
│                         │                                              │    │
│                         └──────────────────┬──────────────────────────┘    │
│                                            │                               │
│  ┌─────────────────┐                       │         ┌─────────────────┐   │
│  │  Cloudflare R2  │◀──────────────────────┤         │  Cloudflare KV  │   │
│  │  (Sample Store) │   Upload samples      │         │  (Session Store)│   │
│  │                 │                       └────────▶│                 │   │
│  │  - User samples │                                 │  - Permanent    │   │
│  │  - TTL cleanup  │                                 │  - No TTL       │   │
│  └─────────────────┘                                 └─────────────────┘   │
│                                                                             │
│  ┌─────────────────┐                                                       │
│  │ Static Assets   │   Served via Worker (not Pages)                       │
│  └─────────────────┘                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket + HTTPS
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌───────────────┐             ┌───────────────┐             ┌───────────────┐
│   Browser A   │             │   Browser B   │             │   Browser C   │
│   (London)    │             │   (Tokyo)     │             │   (NYC)       │
│               │             │               │             │               │
│ ┌───────────┐ │             │ ┌───────────┐ │             │ ┌───────────┐ │
│ │  Web UI   │ │             │ │  Web UI   │ │             │ │  Web UI   │ │
│ │  - Grid   │ │             │ │  - Grid   │ │             │ │  - Grid   │ │
│ │  - Mixer  │ │             │ │  - Mixer  │ │             │ │  - Mixer  │ │
│ └───────────┘ │             │ └───────────┘ │             │ └───────────┘ │
│       │       │             │       │       │             │       │       │
│ ┌───────────┐ │             │ ┌───────────┐ │             │ ┌───────────┐ │
│ │  Sync     │ │             │ │  Sync     │ │             │ │  Sync     │ │
│ │  Engine   │ │             │ │  Engine   │ │             │ │  Engine   │ │
│ │  offset:  │ │             │ │  offset:  │ │             │ │  offset:  │ │
│ │  +15ms    │ │             │ │  -42ms    │ │             │ │  +8ms     │ │
│ └───────────┘ │             │ └───────────┘ │             │ └───────────┘ │
│       │       │             │       │       │             │       │       │
│ ┌───────────┐ │             │ ┌───────────┐ │             │ ┌───────────┐ │
│ │  Audio    │ │             │ │  Audio    │ │             │ │  Audio    │ │
│ │  Engine   │ │             │ │  Engine   │ │             │ │  Engine   │ │
│ │ (WebAudio)│ │             │ │ (WebAudio)│ │             │ │ (WebAudio)│ │
│ └───────────┘ │             │ └───────────┘ │             │ └───────────┘ │
│       │       │             │       │       │             │       │       │
│      🔊       │             │      🔊       │             │      🔊       │
│  Same audio   │             │  Same audio   │             │  Same audio   │
│  at same time │             │  at same time │             │  at same time │
└───────────────┘             └───────────────┘             └───────────────┘
```

---

## Component Breakdown

### 1. Cloudflare Worker (Entry Point)

> 📚 [Workers Documentation](https://developers.cloudflare.com/workers/)

**Role:** HTTP router, static asset server, Durable Object gateway, KV session manager

```
Request → Worker → Route Decision
                      │
                      ├── GET /                        → Serve index.html
                      ├── GET /s/:id                   → Serve SPA (session page)
                      ├── POST /api/sessions           → Create session (KV)
                      ├── GET /api/sessions/:id        → Load session (KV)
                      ├── PUT /api/sessions/:id        → Update session (KV)
                      ├── PATCH /api/sessions/:id/name → Update session name
                      ├── POST /api/sessions/:id/remix → Remix session (KV)
                      ├── GET /api/sessions/:id/ws     → WebSocket → Durable Object
                      ├── GET /api/debug/*             → Debug endpoints
                      └── GET /assets/*                → Serve static files
```

### 2. Durable Object (Session Coordinator)

> 📚 [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/) | [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | [In-memory State](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)

**Role:** Single source of truth for each session

**One instance per session.** All players in session `fuzzy-penguin-42` connect to the same Durable Object instance, regardless of geographic location. Durable Objects are placed near the first user who creates them and remain stationary ([Data Location](https://developers.cloudflare.com/durable-objects/reference/data-location/)).

| Responsibility | How |
|----------------|-----|
| WebSocket hub | Accept connections via Hibernation API, broadcast messages |
| State holder | Grid, tempo, swing, playback state in memory (restored after hibernation) |
| Clock authority | `Date.now()` is the reference for all timing (sync on request) |
| Change coordinator | Process edits serially, broadcast to all |
| State verification | Hash comparison detects client/server drift |
| Player identity | Generate unique color + animal names for anonymous users |
| Hybrid persistence | DO storage per-mutation (immediate), KV on disconnect for API reads |
| Cost efficiency | Hibernation API suspends idle DOs while keeping WebSockets connected |

**Key property:** Single-threaded execution means no race conditions. If two players toggle the same step simultaneously, one will be processed first—no conflicts.

### 3. Cloudflare R2 (Sample Storage)

> 📚 [R2 Documentation](https://developers.cloudflare.com/r2/) | [Object Lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

**Role:** Temporary storage for user-recorded samples

```
Player records sample
        │
        ▼
┌─────────────────┐     ┌─────────────────┐
│  Browser        │     │  Durable Object │
│                 │     │                 │
│  1. Record via  │     │  3. Store in R2 │
│     MediaRecorder     │     with TTL    │
│                 │     │                 │
│  2. Upload to   │────▶│  4. Broadcast   │
│     session     │     │     URL to all  │
│                 │     │                 │
└─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  All browsers   │
                        │  fetch sample,  │
                        │  cache as       │
                        │  AudioBuffer    │
                        └─────────────────┘
```

**Lifecycle:**
- Samples uploaded during session
- TTL-based expiration (e.g., 2 hours after last access)
- No persistence after session ends

### 4. Cloudflare KV (Session Storage)

> 📚 [KV Documentation](https://developers.cloudflare.com/kv/)

**Role:** Persistent storage for session state

Sessions are stored in KV permanently (no TTL). This allows:
- Sessions to persist across DO hibernation and eviction
- Shareable URLs that work even when no one is connected
- Remix tracking (who forked from whom)

**Session data model:**
```typescript
interface Session {
  id: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  remixedFrom: string | null;
  remixedFromName: string | null;
  remixCount: number;
  state: {
    tracks: SessionTrack[];
    tempo: number;
    swing: number;
    version: number;
  };
}
```

**Write patterns:**
- Create: On POST /api/sessions
- Update: Debounced via DO alarm (5s delay)
- Read: On session load or DO wake

### 5. Browser Client

Three main subsystems:

#### 5a. Web UI (React)

```
┌─────────────────────────────────────────────┐
│  App                                         │
│  ├── Header (session name, players, tempo)  │
│  ├── StepSequencer                          │
│  │   ├── TrackRow (one per drum sample)     │
│  │   └── StepCell (click to toggle)         │
│  ├── ChromaticGrid (melodic note entry)     │
│  ├── Recorder (mic input, preview)          │
│  ├── AvatarStack (connected players)        │
│  ├── CursorOverlay (remote cursors)         │
│  ├── ConnectionStatus (online/offline)      │
│  └── ToastNotification (join/leave)         │
└─────────────────────────────────────────────┘
```

#### 5b. Sync Engine

Maintains alignment with server clock:

```typescript
class SyncEngine {
  serverOffset: number = 0;      // Local time + offset = server time
  latency: number = 0;           // Round-trip time / 2

  // Called on every "pong" response
  updateOffset(clientTime: number, serverTime: number) {
    const rtt = Date.now() - clientTime;
    this.latency = rtt / 2;
    this.serverOffset = serverTime - clientTime + this.latency;
  }

  // Get current server time
  getServerTime(): number {
    return Date.now() + this.serverOffset;
  }

  // Convert server timestamp to local audio time
  toAudioTime(serverTime: number, audioCtx: AudioContext): number {
    const localTime = serverTime - this.serverOffset;
    const deltaMs = localTime - Date.now();
    return audioCtx.currentTime + (deltaMs / 1000);
  }
}
```

#### 5c. Audio Engine

Web Audio API graph with lookahead scheduling:

```typescript
class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  trackGains: Map<string, GainNode>;
  samples: Map<string, AudioBuffer>;   // Cached samples

  // Lookahead scheduler (runs every 25ms)
  scheduler() {
    const scheduleAhead = 0.1; // 100ms

    while (this.nextNoteTime < this.ctx.currentTime + scheduleAhead) {
      this.scheduleNote(this.currentStep, this.nextNoteTime);
      this.advanceStep();
    }

    setTimeout(() => this.scheduler(), 25);
  }

  // Schedule a sample to play at exact time
  scheduleNote(step: number, audioTime: number) {
    for (const [trackId, track] of this.tracks) {
      if (track.steps[step]) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.samples.get(track.sampleId);
        source.connect(this.trackGains.get(trackId));
        source.start(audioTime);

        // Gated playback: stop at step end
        const stepDuration = 60 / this.tempo / 4; // 16th note
        source.stop(audioTime + stepDuration);
      }
    }
  }
}
```

---

## Data Flow

### Player Joins Session

```
1. Browser → GET /session/fuzzy-penguin-42
2. Worker  → Forward to Durable Object (by name)
3. DO      → WebSocket upgrade, add to sessions map
4. DO      → Send "snapshot" (grid, tempo, players, playhead)
5. DO      → Broadcast "player_joined" to others
6. Browser → Initialize UI, start audio engine, begin clock sync
```

### Player Toggles Step

```
1. Browser → WS: { type: "toggle_step", trackId: 0, step: 4 }
2. DO      → Update grid state
3. DO      → Broadcast: { type: "step_changed", trackId: 0, step: 4, value: true, serverTime }
4. All browsers → Update UI, audio engine picks up on next loop
```

### Player Triggers Clip

```
1. Browser → WS: { type: "trigger_clip", trackId: 2, sceneId: 1 }
2. DO      → Calculate next bar boundary (serverTime)
3. DO      → Update grid state
4. DO      → Broadcast: { type: "clip_triggered", trackId: 2, sceneId: 1, startsAt: 1700000500 }
5. All browsers → Convert startsAt to local audio time, schedule sample
6. All browsers → Clip starts at same absolute moment 🎵
```

### Player Records Sample

```
1. Browser → MediaRecorder captures audio
2. Browser → POST audio blob to /session/:id/upload
3. DO      → Store in R2, get URL
4. DO      → Broadcast: { type: "sample_added", sampleId, url, addedBy }
5. All browsers → Fetch URL, decode to AudioBuffer, add to cache
6. Sample now available for all players to use
```

### Clock Sync (Continuous)

```
Every 50ms:
  DO      → Broadcast: { type: "clock", serverTime, playhead: { bar, beat, sixteenth } }

Every 1s:
  Browser → WS: { type: "ping", clientTime: Date.now() }
  DO      → WS: { type: "pong", clientTime, serverTime: Date.now() }
  Browser → Update serverOffset for accurate sync
```

---

## State Management

### Server State (Durable Object)

```typescript
interface SessionState {
  // Players
  players: Map<WebSocket, Player>;

  // Sequencer grid
  stepSequencer: {
    tracks: Array<{
      id: string;
      sampleId: string;
      steps: boolean[];      // 16 or 32 steps
      volume: number;
      muted: boolean;
    }>;
  };

  // Clip launcher
  clipLauncher: {
    tracks: Array<{
      id: string;
      clips: Array<{
        sceneId: number;
        sampleId: string;
        isPlaying: boolean;
        startedAt: number | null;
      }>;
      volume: number;
      muted: boolean;
    }>;
  };

  // Transport
  tempo: number;
  isPlaying: boolean;
  playStartedAt: number | null;

  // Samples
  samples: Map<string, {
    id: string;
    url: string;
    name: string;
    duration: number;
    addedBy: string;
  }>;
}
```

### Client State (Browser)

```typescript
interface ClientState {
  // Mirror of server state
  session: SessionState;

  // Local-only state
  me: Player;
  serverOffset: number;
  audioContext: AudioContext;
  sampleBuffers: Map<string, AudioBuffer>;  // Decoded audio

  // UI state
  selectedTrack: string | null;
  isRecording: boolean;
  pendingRecording: Blob | null;
}
```

---

## Scaling Characteristics

| Dimension | Behavior |
|-----------|----------|
| Sessions | Unlimited (each is isolated Durable Object) |
| Players per session | 5-10 (self-imposed limit for UX) |
| Geographic distribution | DO placed near first user, remains stationary (use locationHint for control) |
| WebSocket connections | Handled by DO hibernation (efficient) |
| Sample storage | R2 scales infinitely, TTL prevents bloat |
| Concurrent sessions | Limited only by Cloudflare account limits |

---

## Failure Modes & Recovery

| Failure | Behavior |
|---------|----------|
| Player disconnects | Removed from session, others notified |
| Player reconnects | Receives fresh snapshot, resumes |
| Durable Object hibernates | Wakes on next WebSocket message, state restored from SQLite/attachments |
| Code deployment | All WebSockets disconnect (plan for client reconnection) |
| R2 sample unavailable | Graceful degradation, skip sample |
| Clock drift detected | Client re-syncs on next ping/pong |
| All players leave | Session state garbage collected |

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Session hijacking | Unguessable session IDs (UUID or word combo) |
| Sample abuse | Size limits, duration limits, TTL expiration |
| DoS on session | Player limit enforced by Durable Object |
| WebSocket flooding | Rate limiting in Durable Object |
| XSS via sample names | Sanitize all user input in UI |

---

## File Structure

```
app/
├── src/
│   ├── App.tsx               # Main app with session/multiplayer orchestration
│   ├── main.tsx              # React entry point
│   ├── types.ts              # Shared TypeScript types
│   │
│   ├── components/
│   │   ├── StepSequencer.tsx    # Main sequencer grid
│   │   ├── StepCell.tsx         # Individual step with p-lock badges
│   │   ├── TrackRow.tsx         # Track row with inline controls
│   │   ├── Transport.tsx        # Tempo/swing display
│   │   ├── TransportBar.tsx     # Play/stop, tempo controls
│   │   ├── ChromaticGrid.tsx    # Melodic note entry grid
│   │   ├── SamplePicker.tsx     # Sample/synth selection
│   │   ├── Recorder.tsx         # Mic recording UI
│   │   ├── Waveform.tsx         # Audio waveform display
│   │   ├── AvatarStack.tsx      # Connected player avatars
│   │   ├── CursorOverlay.tsx    # Remote cursor visualization
│   │   ├── ConnectionStatus.tsx # Online/offline indicator
│   │   ├── ToastNotification.tsx # Join/leave notifications
│   │   ├── SessionName.tsx      # Editable session name
│   │   ├── BottomSheet.tsx      # Mobile drawer component
│   │   ├── InlineDrawer.tsx     # Parameter editing drawer
│   │   ├── FloatingAddButton.tsx # Add track button
│   │   └── ErrorBoundary.tsx    # React error boundary
│   │
│   ├── audio/
│   │   ├── engine.ts         # Web Audio setup, sample loading
│   │   ├── scheduler.ts      # Lookahead scheduling (25ms/100ms)
│   │   ├── samples.ts        # Synthesized preset samples
│   │   ├── synth.ts          # Real-time synthesizer (19 presets)
│   │   ├── recorder.ts       # MediaRecorder wrapper
│   │   └── slicer.ts         # Transient detection for auto-slice
│   │
│   ├── sync/
│   │   ├── session.ts        # KV session sync (debounced saves)
│   │   └── multiplayer.ts    # WebSocket client, reconnection, offline queue
│   │
│   ├── hooks/
│   │   ├── useSession.ts     # Session loading/saving hook
│   │   ├── useMultiplayer.ts # Multiplayer connection hook
│   │   └── useLongPress.ts   # Long press gesture hook
│   │
│   ├── context/
│   │   ├── MultiplayerContext.tsx  # Cursor sharing context
│   │   └── RemoteChangeContext.tsx # Flash animation state
│   │
│   ├── state/
│   │   └── grid.tsx          # React Context + useReducer state
│   │
│   ├── utils/
│   │   └── identity.ts       # Player identity generation (color + animal)
│   │
│   ├── debug/
│   │   ├── DebugContext.tsx  # Debug mode state
│   │   └── DebugOverlay.tsx  # Debug panel UI
│   │
│   └── worker/               # Cloudflare Worker (backend)
│       ├── index.ts          # Worker entry, API routing
│       ├── sessions.ts       # KV CRUD operations
│       ├── live-session.ts   # LiveSessionDurableObject class
│       ├── mock-durable-object.ts # Local dev mock DO
│       ├── types.ts          # Server-side type definitions
│       ├── validation.ts     # Input validation
│       ├── invariants.ts     # State invariant checking
│       └── logging.ts        # Structured logging, metrics
│
├── e2e/                      # Playwright E2E tests
│   └── session-persistence.spec.ts
│
├── specs/                    # Project documentation
│   ├── ARCHITECTURE.md       # This file
│   ├── SPEC.md              # Product specification
│   ├── STATUS.md            # Implementation status
│   ├── TESTING.md           # Testing strategy
│   └── research/            # Background research docs
│
├── wrangler.jsonc            # Cloudflare config
├── vite.config.ts            # Vite build config
├── vitest.config.ts          # Vitest test config
└── package.json
```

---

## Cloudflare Documentation References

| Component | Primary Docs | Key References |
|-----------|--------------|----------------|
| Workers | [developers.cloudflare.com/workers](https://developers.cloudflare.com/workers/) | Entry point, routing, bindings |
| Durable Objects | [developers.cloudflare.com/durable-objects](https://developers.cloudflare.com/durable-objects/) | Stateful coordination, WebSockets |
| KV Storage | [developers.cloudflare.com/kv](https://developers.cloudflare.com/kv/) | Session persistence |
| R2 Storage | [developers.cloudflare.com/r2](https://developers.cloudflare.com/r2/) | Sample storage, lifecycle rules |
| Wrangler Config | [developers.cloudflare.com/workers/wrangler/configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) | wrangler.jsonc format |
| DO WebSockets | [developers.cloudflare.com/durable-objects/best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | Hibernation API |
| DO Data Location | [developers.cloudflare.com/durable-objects/reference/data-location](https://developers.cloudflare.com/durable-objects/reference/data-location/) | Geographic placement |
| DO Pricing | [developers.cloudflare.com/durable-objects/platform/pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Free tier, SQLite storage |
| Workers Testing | [developers.cloudflare.com/workers/testing](https://developers.cloudflare.com/workers/testing/) | Vitest integration, DO testing |
