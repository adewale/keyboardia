# Next Steps: Cloudflare Implementation

## Why Cloudflare Works Well Here

| Requirement | Cloudflare Solution |
|-------------|---------------------|
| Real-time WebSockets | Durable Objects handle WebSocket connections with state |
| Session isolation | Each session = one Durable Object instance |
| Low latency | Edge network, Durable Objects placed near first user |
| No server management | Fully serverless |
| Sample storage | R2 for temporary audio files |
| Simple deployment | Pages + Workers in one project |

---

## Implementation Phases

### Phase 1: Project Setup

1. **Create Cloudflare account** (if needed)
   - Durable Objects are available on the free tier (with SQLite storage backend)

2. **Initialize project**
   ```bash
   npm create cloudflare@latest keyboardia
   # Select: "Hello World" Worker
   # Select: TypeScript
   ```

3. **Add Durable Objects support**
   ```jsonc
   // wrangler.jsonc (recommended over wrangler.toml for new projects)
   {
     "$schema": "./node_modules/wrangler/config-schema.json",
     "name": "keyboardia",
     "main": "src/index.ts",
     "compatibility_date": "2025-01-01",
     "durable_objects": {
       "bindings": [
         {
           "name": "SESSIONS",
           "class_name": "SessionDurableObject"
         }
       ]
     },
     "migrations": [
       {
         "tag": "v1",
         "new_sqlite_classes": ["SessionDurableObject"]
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
   wrangler r2 bucket create keyboardia-samples
   ```

---

### Phase 2: Core Backend (Durable Object)

Build the `SessionDurableObject` class:

```
src/
├── index.ts              # Worker entry, routes requests
├── session.ts            # SessionDurableObject class
├── types.ts              # Shared types
└── clock.ts              # Server clock logic
```

**Key responsibilities of SessionDurableObject:**
- Accept WebSocket connections (up to 10 per session)
- Maintain authoritative session state (grid, clips, tempo)
- Broadcast state changes to all connected clients
- Emit clock sync messages every 50-100ms
- Handle sample upload coordination
- Auto-cleanup when all players disconnect

**Skeleton (using modern Hibernation API):**
```typescript
import { DurableObject } from 'cloudflare:workers';

export class SessionDurableObject extends DurableObject<Env> {
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
    // Handle: trigger_clip, stop_clip, add_clip, tempo_change, etc.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.sessions.delete(ws);
    // Broadcast player leave, cleanup if empty
  }
}
```

---

### Phase 3: Frontend Foundation

1. **Set up frontend build**
   ```bash
   # In project root, add frontend
   npm create vite@latest frontend -- --template react-ts
   cd frontend && npm install
   ```

2. **Configure Pages deployment**
   ```jsonc
   // Add to wrangler.jsonc
   {
     "assets": {
       "directory": "./frontend/dist"
     }
   }
   ```

3. **Core frontend modules:**
   ```
   frontend/src/
   ├── App.tsx
   ├── components/
   │   ├── Grid.tsx           # Main clip grid
   │   ├── Clip.tsx           # Individual clip cell
   │   ├── TrackControls.tsx  # Volume, mute, solo
   │   ├── Transport.tsx      # Play/stop, tempo
   │   ├── Recorder.tsx       # Mic recording UI
   │   └── SoundLibrary.tsx   # Preset sounds
   ├── audio/
   │   ├── engine.ts          # Web Audio setup
   │   ├── scheduler.ts       # Quantized playback
   │   └── recorder.ts        # MediaRecorder wrapper
   ├── sync/
   │   ├── websocket.ts       # Connection management
   │   ├── clock.ts           # Server clock sync
   │   └── state.ts           # Shared state store
   └── types.ts
   ```

---

### Phase 4: Audio Engine

1. **Web Audio setup**
   - Create AudioContext on user gesture
   - Load samples into AudioBuffers
   - Create gain nodes per track + master

2. **Quantized scheduling**
   - Calculate next beat/bar boundary from server clock
   - Schedule clip start/stop using `audioContext.currentTime`
   - Compensate for local clock drift

3. **Recording pipeline**
   ```
   Mic → MediaRecorder → Blob → ArrayBuffer → Upload to R2 → Broadcast URL
   ```

---

### Phase 5: Real-Time Sync

1. **Clock synchronization protocol**
   ```typescript
   // Server sends every 50ms:
   { type: "clock", serverTime: 1699999999999, beat: 4, bar: 2 }

   // Client calculates offset:
   offset = serverTime - Date.now() + (rtt / 2)
   ```

2. **State sync messages**
   ```typescript
   // Clip triggered
   { type: "clip_trigger", trackId: 0, sceneId: 1, atBeat: 5 }

   // State snapshot (on join)
   { type: "snapshot", grid: [...], tempo: 120, players: [...] }
   ```

---

### Phase 6: Polish & Testing

1. **Multi-player testing**
   - Open multiple browser tabs/windows
   - Test on different networks
   - Measure sync accuracy

2. **Error handling**
   - Reconnection logic
   - Graceful degradation if mic unavailable
   - Handle R2 upload failures

3. **Performance**
   - Lazy-load samples
   - Limit concurrent audio playback
   - Optimize WebSocket message size

---

## Quick Start Commands

```bash
# 1. Create project
npm create cloudflare@latest keyboardia

# 2. Install dependencies
cd keyboardia
npm install

# 3. Create R2 bucket
npx wrangler r2 bucket create keyboardia-samples

# 4. Run locally
npm run dev

# 5. Deploy
npm run deploy
```

---

## Key Cloudflare Docs

### Getting Started
- [Workers](https://developers.cloudflare.com/workers/) — Serverless compute platform
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) — wrangler.jsonc format (recommended)
- [Pages](https://developers.cloudflare.com/pages/) — Static frontend hosting

### Durable Objects (Real-time State)
- [Durable Objects Overview](https://developers.cloudflare.com/durable-objects/) — Stateful coordination
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — Cost-efficient WebSockets
- [In-memory State](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/) — Single-threaded execution
- [Data Location](https://developers.cloudflare.com/durable-objects/reference/data-location/) — Geographic placement
- [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — Free tier with SQLite

### Storage
- [R2 Storage](https://developers.cloudflare.com/r2/) — Object storage for samples
- [R2 Object Lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) — TTL-based cleanup

### Examples
- [WebSocket Hibernation Server](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/) — Reference implementation

---

## Estimated Build Order

| Step | Focus | Outcome |
|------|-------|---------|
| 1 | Project scaffold + deploy empty worker | Infra working |
| 2 | Durable Object + WebSocket handshake | Players can connect |
| 3 | Basic state sync (add/remove clips) | Shared grid |
| 4 | Audio engine + local playback | Sound works |
| 5 | Clock sync + quantized triggers | Synced playback |
| 6 | Mic recording + R2 upload | Custom samples |
| 7 | UI polish + preset sounds | Usable MVP |
