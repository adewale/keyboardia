# Keyboardia Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE EDGE                                 │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────────────────┐    │
│  │                 │    │           DURABLE OBJECT                     │    │
│  │  Cloudflare     │    │         (one per session)                    │    │
│  │  Worker         │    │                                              │    │
│  │                 │    │  ┌─────────────────────────────────────┐    │    │
│  │  - Route /new   │───▶│  │  Session State                      │    │    │
│  │  - Route        │    │  │  - grid: step patterns + clips      │    │    │
│  │    /session/:id │    │  │  - tempo: BPM                       │    │    │
│  │  - Serve static │    │  │  - isPlaying: boolean               │    │    │
│  │    assets       │    │  │  - playStartedAt: timestamp         │    │    │
│  │                 │    │  │  - players: Map<WebSocket, Player>  │    │    │
│  └─────────────────┘    │  └─────────────────────────────────────┘    │    │
│                         │                                              │    │
│                         │  ┌─────────────────────────────────────┐    │    │
│                         │  │  Responsibilities                    │    │    │
│                         │  │  - Accept WebSocket connections      │    │    │
│                         │  │  - Broadcast state changes           │    │    │
│                         │  │  - Emit clock sync (50ms interval)   │    │    │
│                         │  │  - Coordinate sample uploads         │    │    │
│                         │  │  - Calculate playhead position       │    │    │
│                         │  └─────────────────────────────────────┘    │    │
│                         │                                              │    │
│                         └──────────────────┬──────────────────────────┘    │
│                                            │                               │
│  ┌─────────────────┐                       │                               │
│  │  Cloudflare R2  │◀──────────────────────┘                               │
│  │  (Sample Store) │   Upload samples, get signed URLs                     │
│  │                 │                                                       │
│  │  - Temporary    │                                                       │
│  │  - TTL cleanup  │                                                       │
│  └─────────────────┘                                                       │
│                                                                             │
│  ┌─────────────────┐                                                       │
│  │ Cloudflare Pages│   Static frontend assets (HTML, JS, CSS)              │
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

**Role:** HTTP router, static asset server, Durable Object gateway

```
Request → Worker → Route Decision
                      │
                      ├── GET /           → Serve index.html (Pages)
                      ├── GET /new        → Create session, redirect
                      ├── GET /session/:id → Proxy to Durable Object
                      └── GET /assets/*   → Serve static files (Pages)
```

### 2. Durable Object (Session Coordinator)

> 📚 [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/) | [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | [In-memory State](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)

**Role:** Single source of truth for each session

**One instance per session.** All players in session `fuzzy-penguin-42` connect to the same Durable Object instance, regardless of geographic location. Durable Objects are placed near the first user who creates them and remain stationary ([Data Location](https://developers.cloudflare.com/durable-objects/reference/data-location/)).

| Responsibility | How |
|----------------|-----|
| WebSocket hub | Accept connections via Hibernation API, broadcast messages |
| State holder | Grid, tempo, playback state in memory (restored after hibernation) |
| Clock authority | `Date.now()` is the reference for all timing |
| Change coordinator | Process edits serially, broadcast to all |
| Sample broker | Coordinate upload to R2, distribute URLs |
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

### 4. Browser Client

Three main subsystems:

#### 4a. Web UI (React/Svelte)

```
┌─────────────────────────────────────────────┐
│  App                                         │
│  ├── Header (session name, players, tempo)  │
│  ├── StepSequencer                          │
│  │   ├── TrackRow (one per drum sample)     │
│  │   └── StepCell (click to toggle)         │
│  ├── ClipLauncher                           │
│  │   ├── Track (bass, keys, fx)             │
│  │   └── ClipCell (click to trigger)        │
│  ├── Recorder (mic input, preview)          │
│  └── Mixer (track volumes, master)          │
└─────────────────────────────────────────────┘
```

#### 4b. Sync Engine

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

#### 4c. Audio Engine

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
keyboardia/
├── src/
│   ├── index.ts              # Worker entry point
│   ├── session.ts            # SessionDurableObject class
│   ├── types.ts              # Shared TypeScript types
│   └── utils/
│       ├── names.ts          # Funny name generator
│       └── timing.ts         # Tempo/beat calculations
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── StepSequencer.tsx
│   │   │   ├── ClipLauncher.tsx
│   │   │   ├── Recorder.tsx
│   │   │   └── Mixer.tsx
│   │   ├── audio/
│   │   │   ├── engine.ts     # Web Audio setup
│   │   │   └── scheduler.ts  # Lookahead scheduler
│   │   ├── sync/
│   │   │   ├── socket.ts     # WebSocket connection
│   │   │   └── clock.ts      # Server clock sync
│   │   └── store/
│   │       └── session.ts    # Client state management
│   └── index.html
│
├── wrangler.jsonc            # Cloudflare config (JSON recommended)
└── package.json
```

---

## Cloudflare Documentation References

| Component | Primary Docs | Key References |
|-----------|--------------|----------------|
| Workers | [developers.cloudflare.com/workers](https://developers.cloudflare.com/workers/) | Entry point, routing, bindings |
| Durable Objects | [developers.cloudflare.com/durable-objects](https://developers.cloudflare.com/durable-objects/) | Stateful coordination, WebSockets |
| R2 Storage | [developers.cloudflare.com/r2](https://developers.cloudflare.com/r2/) | Sample storage, lifecycle rules |
| Pages | [developers.cloudflare.com/pages](https://developers.cloudflare.com/pages/) | Static frontend hosting |
| Wrangler Config | [developers.cloudflare.com/workers/wrangler/configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) | wrangler.jsonc format |
| DO WebSockets | [developers.cloudflare.com/durable-objects/best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | Hibernation API |
| DO Data Location | [developers.cloudflare.com/durable-objects/reference/data-location](https://developers.cloudflare.com/durable-objects/reference/data-location/) | Geographic placement |
| DO Pricing | [developers.cloudflare.com/durable-objects/platform/pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Free tier, SQLite storage |
