# Why Cloudflare? Architecture Deep Dive

This document explains why Keyboardia uses Cloudflare's Developer Platform and how each primitive enables the application's core functionality.

## Cloudflare Primitives Used

| Primitive | Binding | Purpose in Keyboardia |
|-----------|---------|----------------------|
| **Workers** | — | API routing, request handling, orchestration |
| **Workers Assets** | `ASSETS` | Static file serving (React app, CSS, JS) |
| **KV** | `SESSIONS` | Session persistence (tracks, tempo, swing) |
| **Durable Objects** | `LIVE_SESSIONS` | Real-time multiplayer sync, WebSocket coordination |
| **R2** | `SAMPLES` | Audio sample storage (future: user recordings) |

---

## Workers: The Compute Layer

### What It Does in Keyboardia

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge                          │
│                                                                 │
│   User Request ──▶ Worker ──┬──▶ Static Assets (React app)     │
│                             ├──▶ KV (session CRUD)              │
│                             ├──▶ Durable Object (real-time)     │
│                             └──▶ R2 (audio samples)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The Worker is the orchestration layer that:
1. Routes requests to the appropriate backend
2. Handles API endpoints (`/api/sessions/*`)
3. Upgrades HTTP to WebSocket for real-time connections
4. Serves static assets via Workers Assets

### Key Code Patterns

```typescript
// src/worker/index.ts - Request routing
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API routes
    if (url.pathname.startsWith('/api/sessions')) {
      return handleSessionsAPI(request, env);
    }

    // WebSocket upgrade → Durable Object
    if (url.pathname.match(/\/api\/sessions\/[^/]+\/ws/)) {
      const id = env.LIVE_SESSIONS.idFromName(sessionId);
      const stub = env.LIVE_SESSIONS.get(id);
      return stub.fetch(request);
    }

    // Static assets
    return env.ASSETS.fetch(request);
  }
}
```

### Why Workers (Not Traditional Servers)

| Traditional Server | Cloudflare Workers |
|-------------------|-------------------|
| Single region, latency varies by distance | Runs in 300+ cities, <50ms globally |
| Always running, paying for idle | Pay per request, scales to zero |
| Manual scaling, load balancing | Automatic scaling, no cold starts |
| SSL/TLS configuration required | Built-in HTTPS, HTTP/2, HTTP/3 |

### Documentation References

| Feature | URL |
|---------|-----|
| Workers Overview | https://developers.cloudflare.com/workers/ |
| Runtime APIs | https://developers.cloudflare.com/workers/runtime-apis/ |
| Bindings | https://developers.cloudflare.com/workers/runtime-apis/bindings/ |
| Pricing | https://developers.cloudflare.com/workers/platform/pricing/ |

---

## Workers Assets: Static File Serving

### What It Does in Keyboardia

Serves the React application (HTML, CSS, JS, images) from Cloudflare's edge network.

```jsonc
// wrangler.jsonc
{
  "assets": {
    "directory": "./dist",   // Vite build output
    "binding": "ASSETS"      // Access in Worker code
  }
}
```

### Why Workers Assets (Not S3 + CloudFront)

| S3 + CloudFront | Workers Assets |
|-----------------|----------------|
| Separate services to configure | Single deployment with Worker |
| Cache invalidation complexity | Automatic on deploy |
| Additional latency (origin fetch) | Served from same edge location |
| Separate billing | Included in Workers pricing |

### Documentation References

| Feature | URL |
|---------|-----|
| Workers Assets | https://developers.cloudflare.com/workers/frameworks/framework-guides/assets/ |
| Static Assets | https://developers.cloudflare.com/workers/static-assets/ |

---

## KV: Session Persistence

### What It Does in Keyboardia

Stores session state (tracks, tempo, swing, metadata) with eventual consistency.

```
┌─────────────────────────────────────────────────────────────────┐
│                        KV Namespace: SESSIONS                    │
│                                                                 │
│   Key: "session:{uuid}"                                         │
│   Value: {                                                      │
│     "id": "3d833cc4-2995-4565-a609-3523601f71b0",               │
│     "name": "Funky Groove",                                     │
│     "tracks": [...],                                            │
│     "tempo": 120,                                               │
│     "swing": 0,                                                 │
│     "createdAt": "2025-12-11T...",                              │
│     "lastAccessedAt": "2025-12-11T...",                         │
│     "remixedFrom": null,                                        │
│     "remixCount": 5                                             │
│   }                                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Code Patterns

```typescript
// src/worker/sessions.ts

// Create session
await env.SESSIONS.put(`session:${id}`, JSON.stringify(session));

// Read session
const data = await env.SESSIONS.get(`session:${id}`);
const session = data ? JSON.parse(data) : null;

// List sessions (with metadata)
const list = await env.SESSIONS.list({ prefix: 'session:' });
```

### Why KV (Not Redis, DynamoDB, or DO Storage)

| Requirement | KV Solution |
|-------------|-------------|
| Global read latency <50ms | Edge caching, reads from nearest PoP |
| Persist across restarts | Durable storage, not just cache |
| Simple key-value model | Perfect for session blobs |
| Cost at scale | Free tier: 100k reads/day, 1k writes/day |

**Why not Durable Object storage for sessions?**
- DO storage is strongly consistent but requires routing to specific DO instance
- KV is eventually consistent but reads from any edge location
- Sessions are read-heavy (load), write-light (save every 5s during edits)
- KV's eventual consistency (typically <60s) is acceptable for session data

### KV Characteristics

| Characteristic | Value | Impact |
|---------------|-------|--------|
| Read latency | <10ms (cached), <50ms (uncached) | Fast session loads |
| Write latency | ~500ms to propagate globally | Debounce writes |
| Consistency | Eventual (typically <60s) | OK for session data |
| Max value size | 25 MB | Plenty for session JSON |
| Free tier | 100k reads, 1k writes/day | Development friendly |

### Documentation References

| Feature | URL |
|---------|-----|
| KV Overview | https://developers.cloudflare.com/kv/ |
| KV API | https://developers.cloudflare.com/kv/api/ |
| KV Pricing | https://developers.cloudflare.com/kv/platform/pricing/ |
| KV Limits | https://developers.cloudflare.com/kv/platform/limits/ |

---

## Durable Objects: Real-Time Multiplayer

### What It Does in Keyboardia

Coordinates real-time collaboration between multiple users editing the same session.

```
┌─────────────────────────────────────────────────────────────────┐
│           Durable Object: LiveSessionDurableObject              │
│           (One instance per session UUID)                       │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    In-Memory State                       │   │
│   │  • tracks: Track[]                                       │   │
│   │  • tempo: number                                         │   │
│   │  • swing: number                                         │   │
│   │  • players: Map<WebSocket, PlayerInfo>                   │   │
│   │  • isPlaying: boolean                                    │   │
│   │  • playbackStartTime: number                             │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   WebSocket ◀──────▶ Client A (Browser)                        │
│   WebSocket ◀──────▶ Client B (Browser)                        │
│   WebSocket ◀──────▶ Client C (Browser)                        │
│                                                                 │
│   Single-threaded: No race conditions, sequential processing    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### The Multiplayer Problem

**Challenge:** Multiple users editing the same session need:
1. A single source of truth (no conflicts)
2. Real-time sync (<100ms latency)
3. Coordinated playback (everyone hears step 5 at the same time)

**Solution:** Durable Objects provide:
- **Single instance per session** — All clients connect to same DO
- **Single-threaded execution** — No race conditions
- **WebSocket hibernation** — Cost-efficient long connections
- **In-memory state** — Fast reads/writes, persisted to KV on changes

### Clock Synchronization

Each client has its own `AudioContext` with its own clock. The DO coordinates playback:

```
Server (DO)                          Client
    │                                   │
    │◀─────── CLOCK_SYNC request ───────│  (client pings)
    │                                   │
    │─────── serverTime: 1234567 ──────▶│  (server responds)
    │                                   │
    │         Client calculates:        │
    │         RTT = responseTime - sendTime
    │         oneWayLatency = RTT / 2
    │         clockOffset = serverTime + oneWayLatency - localTime
    │                                   │
```

When play is pressed:
```typescript
// All clients receive the same startTime
{ type: 'PLAYBACK_STARTED', startTime: 1234567890 }

// Each client converts to local AudioContext time
const localStartTime = serverStartTime - clockOffset;

// Schedule notes at local time
audioContext.schedule(note, localStartTime + stepOffset);
```

### Key Code Patterns

```typescript
// src/worker/live-session.ts

export class LiveSessionDurableObject {
  private state: DurableObjectState;
  private sessions: SessionState;
  private connections: Map<WebSocket, PlayerInfo>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.connections = new Map();

    // Restore state on wake
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get('session');
      this.sessions = stored || createDefaultSession();
    });
  }

  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);  // Hibernation API
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    const msg = JSON.parse(message);

    switch (msg.type) {
      case 'TOGGLE_STEP':
        // Update authoritative state
        this.sessions.tracks[msg.trackIndex].steps[msg.step] ^= true;
        // Broadcast to all OTHER clients
        this.broadcast(msg, ws);
        // Debounce save to KV
        this.scheduleSave();
        break;

      case 'CLOCK_SYNC':
        ws.send(JSON.stringify({
          type: 'CLOCK_SYNC_RESPONSE',
          serverTime: Date.now(),
          clientTime: msg.clientTime
        }));
        break;
    }
  }

  private broadcast(msg: object, exclude?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}
```

### Why Durable Objects (Not Redis Pub/Sub, Socket.io, Firebase)

| Requirement | DO Solution |
|-------------|-------------|
| Single source of truth | One DO instance per session, single-threaded |
| Global low latency | DO spawns near first user, stays there |
| WebSocket connections | Native support with hibernation for cost savings |
| No separate infrastructure | Part of Cloudflare, no Redis cluster to manage |
| Automatic scaling | New session = new DO instance, unlimited |

### Hibernation for Cost Savings

```typescript
// Without hibernation: DO stays in memory, billing for duration
// With hibernation: DO sleeps between messages, only billed for active time

// Accept WebSocket with hibernation
this.state.acceptWebSocket(ws);

// DO can now hibernate while waiting for messages
// Wake up on: webSocketMessage(), webSocketClose(), webSocketError()
```

### Documentation References

| Feature | URL |
|---------|-----|
| Durable Objects Overview | https://developers.cloudflare.com/durable-objects/ |
| WebSocket Hibernation | https://developers.cloudflare.com/durable-objects/best-practices/websockets/ |
| In-memory State | https://developers.cloudflare.com/durable-objects/reference/in-memory-state/ |
| Storage API | https://developers.cloudflare.com/durable-objects/api/storage-api/ |
| Alarms | https://developers.cloudflare.com/durable-objects/api/alarms/ |
| Data Location | https://developers.cloudflare.com/durable-objects/reference/data-location/ |
| Pricing | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| Limits | https://developers.cloudflare.com/durable-objects/platform/limits/ |

---

## R2: Audio Sample Storage

### What It Does in Keyboardia

Stores audio samples (WAV/MP3 files) for instruments. Currently used for built-in samples, planned for user recordings.

```
┌─────────────────────────────────────────────────────────────────┐
│                    R2 Bucket: keyboardia-samples                 │
│                                                                 │
│   samples/                                                      │
│   ├── drums/                                                    │
│   │   ├── kick.wav                                              │
│   │   ├── snare.wav                                             │
│   │   └── hihat.wav                                             │
│   ├── bass/                                                     │
│   │   └── bass-synth.wav                                        │
│   └── recordings/                    (future: user samples)     │
│       └── {sessionId}/{sampleId}.wav                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Code Patterns

```typescript
// Read sample
const object = await env.SAMPLES.get('samples/drums/kick.wav');
if (object) {
  return new Response(object.body, {
    headers: { 'Content-Type': 'audio/wav' }
  });
}

// Write sample (future: user recordings)
await env.SAMPLES.put(
  `recordings/${sessionId}/${sampleId}.wav`,
  audioBuffer,
  { httpMetadata: { contentType: 'audio/wav' } }
);
```

### Why R2 (Not S3, GCS, or Cloudinary)

| Requirement | R2 Solution |
|-------------|-------------|
| No egress fees | R2 has zero egress costs |
| Global low latency | Served from Cloudflare edge |
| S3-compatible API | Easy migration, familiar tooling |
| Same-platform integration | Direct binding, no network hop |

### R2 vs S3 Pricing

| Operation | S3 | R2 |
|-----------|----|----|
| Storage | $0.023/GB/month | $0.015/GB/month |
| Egress (to internet) | $0.09/GB | **$0.00/GB** |
| Class A ops (PUT, POST) | $0.005/1k | $0.0045/1k |
| Class B ops (GET, HEAD) | $0.0004/1k | $0.0036/1k |

For audio apps streaming samples to browsers, **egress costs dominate**. R2's zero egress is a game-changer.

### Documentation References

| Feature | URL |
|---------|-----|
| R2 Overview | https://developers.cloudflare.com/r2/ |
| R2 API | https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ |
| R2 Pricing | https://developers.cloudflare.com/r2/pricing/ |
| R2 vs S3 | https://developers.cloudflare.com/r2/reference/s3-compatibility/ |

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              User Browser                               │
│                                                                         │
│   React App ◀───────── Workers Assets (HTML/CSS/JS)                    │
│       │                                                                 │
│       ├── HTTP ──────▶ Worker ──────▶ KV (session load/save)           │
│       │                    │                                            │
│       └── WebSocket ──────▶──────────▶ Durable Object (real-time sync) │
│                                              │                          │
│   AudioContext ◀── samples ── Worker ──────▶ R2 (audio files)          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

| Action | Flow |
|--------|------|
| **Load session** | Browser → Worker → KV → Worker → Browser |
| **Toggle step (solo)** | Browser → AudioContext (local only) |
| **Toggle step (multiplayer)** | Browser → WebSocket → DO → WebSocket → All browsers |
| **Play/Stop** | Browser → WebSocket → DO → WebSocket → All browsers (coordinated start time) |
| **Load sample** | Browser → Worker → R2 → Worker → Browser → AudioContext |

### Why This Architecture Works

1. **Low latency everywhere** — Edge compute (Workers), edge storage (KV, R2), regional coordination (DO)
2. **No servers to manage** — Fully serverless, scales automatically
3. **Cost-efficient** — Pay per use, hibernation for WebSockets, zero egress for audio
4. **Single platform** — One deploy, one dashboard, one billing

---

## Cost Analysis (Free Tier)

| Service | Free Tier Limit | Keyboardia Usage |
|---------|-----------------|------------------|
| Workers | 100k requests/day | API calls, asset serving |
| KV | 100k reads, 1k writes/day | Session load/save |
| Durable Objects | 100k requests/day, 13k GB-s/day | WebSocket messages |
| R2 | 10 GB storage, 10M Class B ops/month | Sample storage |

**For a hobby project with <100 daily users, Keyboardia runs entirely within free tier limits.**

### Scaling Beyond Free Tier

| Service | Paid Pricing |
|---------|--------------|
| Workers | $5/month includes 10M requests |
| KV | $5/month includes 10M reads, 1M writes |
| Durable Objects | $5/month includes 1M requests |
| R2 | $0.015/GB/month storage |

---

## References

### Cloudflare Developer Platform
- [Workers Documentation](https://developers.cloudflare.com/workers/)
- [KV Documentation](https://developers.cloudflare.com/kv/)
- [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [Pricing Overview](https://developers.cloudflare.com/workers/platform/pricing/)

### Architecture Patterns
- [Control/Data Plane Pattern](https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/)
- [WebSocket Hibernation Example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Workers Chat Demo](https://github.com/cloudflare/workers-chat-demo)

### Blog Posts
- [Durable Objects: Easy, Fast, Correct](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/)
- [SQLite in Durable Objects](https://blog.cloudflare.com/sqlite-in-durable-objects/)
- [Zero Egress with R2](https://blog.cloudflare.com/r2-open-beta/)
