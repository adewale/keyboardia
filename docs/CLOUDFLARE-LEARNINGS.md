# What Keyboardia Taught Us About Cloudflare

Keyboardia is a multiplayer step sequencer built entirely on Cloudflare's Developer Platform. Over 35+ development phases, from solo playback to real-time 10-player collaboration, the project uncovered hard-won lessons about Workers, Durable Objects, KV, and R2. This document distills those learnings into a reference for anyone building on Cloudflare.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Durable Objects: The Hard Lessons](#durable-objects-the-hard-lessons)
3. [KV: Eventual Consistency in Practice](#kv-eventual-consistency-in-practice)
4. [The Hybrid Persistence Pattern](#the-hybrid-persistence-pattern)
5. [WebSocket Hibernation: What They Don't Tell You](#websocket-hibernation-what-they-dont-tell-you)
6. [Worker-Level Patterns](#worker-level-patterns)
7. [R2 for Audio: Zero Egress Matters](#r2-for-audio-zero-egress-matters)
8. [Cost Efficiency at Scale](#cost-efficiency-at-scale)
9. [Observability on Cloudflare](#observability-on-cloudflare)
10. [Testing Cloudflare Services](#testing-cloudflare-services)
11. [Production-Only Bugs](#production-only-bugs)
12. [Summary of Rules](#summary-of-rules)

---

## Architecture Overview

Keyboardia uses five Cloudflare primitives working together:

```
User Browser
    |
    +-- HTTP ----------> Worker ---------> KV (session CRUD)
    |                       |
    +-- WebSocket --------->+-----------> Durable Object (real-time sync)
    |                       |
    +-- Audio fetch ------->+-----------> R2 (sample storage)
    |
    +-- Static assets <---- Workers Assets (React app)
```

| Primitive | Binding | Role |
|-----------|---------|------|
| **Workers** | -- | API routing, request validation, orchestration |
| **Workers Assets** | `ASSETS` | Static file serving (React app) |
| **KV** | `SESSIONS` | Session persistence (eventual consistency) |
| **Durable Objects** | `LIVE_SESSIONS` | Real-time multiplayer coordination |
| **R2** | `SAMPLES` | Audio sample storage (zero egress) |

The key architectural insight: **each primitive has a specific consistency and latency profile, and the art is in combining them correctly.**

---

## Durable Objects: The Hard Lessons

### 1. One DO per session, not a global singleton

Each session gets its own DO instance via `idFromName(sessionId)`. This is critical because DOs are single-threaded -- a global singleton would serialize all traffic across all sessions. With per-session DOs, you get unlimited horizontal scaling: new session = new DO instance, no bottleneck.

### 2. `setTimeout` does not survive hibernation

This was one of the most consequential discoveries. When a DO hibernates (to save on duration billing), all in-flight `setTimeout` and `setInterval` calls are silently lost.

**What broke:** A 5-second debounced KV save was scheduled with `setTimeout`. The DO hibernated before it fired. State was lost.

**The fix:** Replace `setTimeout` with Cloudflare's Alarms API (`ctx.storage.setAlarm()`). Alarms persist across hibernation and guarantee at-least-once execution:

```typescript
private scheduleKVSave(): void {
  this.pendingKVSave = true;
  this.ctx.storage.setAlarm(Date.now() + KV_SAVE_DEBOUNCE_MS);
}

async alarm(): Promise<void> {
  if (this.pendingKVSave) {
    await this.saveToKV();
    this.pendingKVSave = false;
  }
}
```

**Rule: Never use `setTimeout` in a Durable Object for anything that matters. Use Alarms.**

### 3. `blockConcurrencyWhile()` prevents initialization races

DO constructors are synchronous, but state loading is async. Without concurrency control, two simultaneous WebSocket connections can trigger parallel state loads, each overwriting the other.

**The fix:** Wrap initialization in `blockConcurrencyWhile()`:

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  this.ctx.blockConcurrencyWhile(async () => {
    const storedSeq = await this.ctx.storage.get<number>('serverSeq');
    if (storedSeq !== undefined) this.serverSeq = storedSeq;
  });
}
```

Use it sparingly -- it blocks all incoming requests. Reserve it for one-time initialization only.

### 4. Recreate stubs on retryable errors

A `DurableObjectStub` can enter a "broken" state after transient errors. Reusing it will fail repeatedly even though the DO itself is fine.

```typescript
try {
  return await stub.fetch(request);
} catch (error) {
  const e = error as { retryable?: boolean; overloaded?: boolean };

  if (e.overloaded) {
    return jsonError('Service temporarily unavailable', 503); // NEVER retry
  }

  if (e.retryable) {
    stub = env.LIVE_SESSIONS.get(doId); // Fresh stub
    return await stub.fetch(request);   // Retry once
  }

  return jsonError('Request failed', 500);
}
```

**Critical:** Never retry overloaded errors. You'll make the situation worse.

### 5. DO is the live source of truth; KV is only for cold starts

While a DO instance is running, it holds authoritative state in memory. KV is only consulted when a DO wakes from hibernation/eviction. If you update KV externally, connected browsers won't see the change until the DO restarts. This is by design.

### 6. In-memory state is volatile -- persist what matters

Class properties on a DO are fast but ephemeral. They vanish on eviction or hibernation. Anything that must survive (like a server sequence counter) needs to be written to DO storage:

```typescript
if (this.serverSeq % 100 === 0) {
  this.ctx.storage.put('serverSeq', this.serverSeq);
}
```

The Keyboardia audit found that `serverSeq` was only in memory, which meant sequence gaps after DO eviction.

---

## KV: Eventual Consistency in Practice

### 7. KV reads are fast, writes propagate slowly

KV reads from the nearest edge PoP in <10ms (cached) or <50ms (uncached). Writes take up to 60 seconds to propagate globally. This is fine for session data (read-heavy, write-light), but creates real problems for real-time state.

### 8. The KV staleness window is a data loss risk

With a 5-second debounced write to KV, there's a window where DO memory has changes that KV doesn't. If the DO evicts during this window, those changes are permanently lost:

```
User makes 10 edits -> DO memory has all 10
Timer still counting down -> DO evicts (deployment, idle, memory pressure)
Memory lost -> KV still has old state
Next user connects -> Loads stale state from KV -> DATA LOST
```

This vulnerability led to the hybrid persistence pattern (see next section).

### 9. KV writes are the #1 cost driver at scale

At $5 per million writes, KV writes dominate costs before anything else. Keyboardia's original logging wrote 3-6 KV entries per API request. At 10,000 sessions/day, that's $16/month just in log writes. The fix: migrate observability to Workers Logs (wide events), eliminating KV-based logging entirely.

---

## The Hybrid Persistence Pattern

This is arguably the most important architectural innovation in the project. It solves the KV staleness problem while keeping costs low.

### The pattern: DO Storage per-mutation + KV write on-disconnect

```typescript
async handleMutation(msg: ClientMessage) {
  this.applyToMemory(msg);                         // 1. In-memory (fast)
  await this.ctx.storage.put('state', this.state);  // 2. DO storage (durable, ~1ms)
  this.broadcast(msg);                              // 3. Tell clients
  // NO KV write here
}

async webSocketClose(ws: WebSocket) {
  this.players.delete(ws);
  if (this.players.size === 0) {
    await this.flushToKV();  // 4. Single KV write when everyone leaves
  }
}

async loadState() {
  const doState = await this.ctx.storage.get('state');
  if (doState) return doState;           // DO storage is authoritative
  return await this.loadFromKV();        // KV fallback for legacy only
}
```

### Why this works

| Approach | DO writes/session | KV writes/session | Cost at 1M sessions |
|----------|-------------------|-------------------|---------------------|
| KV debounced (original) | 0 | 30 | $145/mo |
| Naive DO + KV | 150 | 30 | $294/mo |
| **Hybrid** | 150 | 1 | **$149/mo** |

- Every mutation is immediately durable in DO storage (~1-2ms latency added)
- KV only gets one write when the last client disconnects
- If the DO evicts unexpectedly, DO storage still has the latest state
- Zero data loss, minimal cost increase

### The storage hierarchy

```
Memory (fast, volatile)
    |
    | Immediate write on every mutation
    v
DO Storage (fast, durable)
    |
    | Single write on last disconnect
    v
KV (edge-cached, eventual consistency, for API reads)
```

---

## WebSocket Hibernation: What They Don't Tell You

### 10. Hibernation is mandatory for cost efficiency

Without hibernation, an idle WebSocket connection keeps the DO in memory, billing for duration continuously. At 10,000 sessions/day, that's **$1,687/month** in duration charges. With hibernation: **$0.01/month** for idle connections.

Use `ctx.acceptWebSocket()` (not the standard `WebSocket` constructor) to enable hibernation.

### 11. WebSocket attachments survive hibernation; class properties don't

Use `serializeAttachment()` / `deserializeAttachment()` to store per-connection metadata (player ID, color, name) that survives hibernation:

```typescript
// On connect
server.serializeAttachment(playerInfo);

// In constructor (after wake)
for (const ws of this.ctx.getWebSockets()) {
  const attachment = ws.deserializeAttachment() as PlayerInfo | null;
  if (attachment) this.players.set(ws, attachment);
}
```

Attachment data is limited to 2,048 bytes per connection.

### 12. Auto-response keeps connections alive during hibernation

Configure `setWebSocketAutoResponse()` so the platform handles ping/pong without waking the DO:

```typescript
this.ctx.setWebSocketAutoResponse(
  new WebSocketRequestResponsePair('ping', 'pong')
);
```

### 13. Minimize constructor work

The constructor runs every time a hibernated DO receives a message. Keep it synchronous and lightweight. Defer heavy initialization to the first actual request.

---

## Worker-Level Patterns

### 14. Validate before routing to Durable Objects

Every request that reaches a DO costs money. Validate in the Worker first:

```typescript
if (!isValidUUID(sessionId)) {
  return jsonError('Invalid session ID format', 400); // Never hits DO
}
if (!isBodySizeValid(request.headers.get('content-length'))) {
  return jsonError('Request body too large', 413);    // Never hits DO
}
// Only THEN route to DO
const stub = env.LIVE_SESSIONS.get(doId);
```

This is Cloudflare's own recommendation: "Validate requests in the Worker before routing to Durable Objects to avoid billing for invalid requests."

### 15. XSS prevention at the boundary

User-controlled fields (session names) flow through the Worker to KV and then to other users' browsers. Validate server-side with pattern blocking:

```typescript
if (/<script|javascript:|on\w+\s*=/i.test(name)) {
  return jsonError('Name contains potentially unsafe content');
}
```

React's JSX escaping provides a second layer, but server-side validation is the authoritative gate.

### 16. Client-side timeouts prevent hung connections

Use `AbortController` on all fetch calls. Without timeouts, a half-open connection leaves the UI frozen indefinitely:

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);
try {
  return await fetch(url, { ...options, signal: controller.signal });
} finally {
  clearTimeout(timeoutId);
}
```

---

## R2 for Audio: Zero Egress Matters

### 17. R2's zero egress is a game-changer for media apps

For an audio app streaming samples to browsers, egress costs dominate on traditional platforms:

| | S3 | R2 |
|---|---|---|
| Storage | $0.023/GB/mo | $0.015/GB/mo |
| Egress | **$0.09/GB** | **$0.00/GB** |

A user loading 10MB of samples costs $0.0009 on S3. On R2, it's free. At scale, this is the difference between viable and not.

### 18. Keep small assets in Workers Assets, not R2

R2 is best for dynamic or large assets. For built-in audio samples that ship with the app, Workers Assets (static files in the `dist/` directory) are simpler and free. Only move to R2 when you need dynamic storage (user recordings, uploaded samples).

---

## Cost Efficiency at Scale

### 19. Cloudflare's pricing model rewards scale

The marginal cost per session **decreases** as usage grows:

| Daily Sessions | Monthly Cost | Cost per Session |
|----------------|--------------|------------------|
| 100 | $5.00 | $0.017 |
| 1,000 | $5.00 | $0.0017 |
| 10,000 | $9.14 | $0.0003 |
| 100,000 | ~$80 | $0.00027 |

The $5/month base plan includes generous free tiers across all services. You hit meaningful overage charges only at enterprise scale.

### 20. The 20:1 WebSocket message ratio makes real-time cheap

Cloudflare bills Durable Object requests at a 20:1 ratio for incoming WebSocket messages. That means 20 user actions (step toggles, tempo changes) count as a single request. For a music collaboration tool where users make rapid edits, this pricing model is extremely favorable.

### 21. WebSocket Hibernation is the single most important cost optimization

| | Without Hibernation | With Hibernation |
|---|---|---|
| Idle connection cost | $0.36/month | $0.01/month |
| 10K sessions/day duration | $1,687/month | ~$0.14/month |

If you're using Durable Objects with WebSockets, hibernation isn't optional -- it's the difference between $5/month and $1,700/month.

---

## Observability on Cloudflare

### 22. Wide events beat log lines

The project migrated from per-request KV-based logging (Observability 1.0) to wide structured events emitted to Workers Logs (Observability 2.0). Instead of many small log entries per request, build up context in memory and emit a single rich event at the end:

```typescript
// One event per WebSocket session lifecycle
{
  sessionId: "abc",
  playerId: "xyz",
  duration: 120,
  messageCount: 47,
  messagesByType: { toggle_step: 42, set_tempo: 5 },
  peakConcurrentPlayers: 3,
  disconnectReason: "normal_close"
}
```

This eliminated KV-based logging costs entirely and provides richer debugging context.

### 23. Workers Logs + `wrangler tail` is sufficient for most projects

Cloudflare's built-in observability (Workers Logs with the dashboard query builder, plus `wrangler tail` for real-time streaming) covers most debugging needs without third-party tools. Enable full observability in `wrangler.jsonc`:

```jsonc
"observability": {
  "enabled": true,
  "logs": { "enabled": true, "invocation_logs": true, "head_sampling_rate": 1 },
  "traces": { "enabled": true, "head_sampling_rate": 1 }
}
```

---

## Testing Cloudflare Services

### 24. Use `@cloudflare/vitest-pool-workers` for integration tests

This runs tests in the actual Workers runtime (workerd), eliminating behavior mismatches between tests and production. Use `runInDurableObject()` to test DO internals.

### 25. KV debouncing causes test timing issues

Tests that write to KV and immediately read back may see stale data due to debouncing. Either:
- Use `await` on explicit flush methods in tests
- Add small delays after writes in integration tests
- Test DO state directly rather than through KV

### 26. E2E tests need retry logic for API resilience

Cloudflare's edge network occasionally returns transient errors. E2E tests must include retry logic with exponential backoff, or they'll be flaky in CI.

---

## Production-Only Bugs

Two of the most significant bugs in Keyboardia were invisible in local development.

### 27. WebSocket connection storms (production-only)

**The bug:** Every user interaction caused the WebSocket to disconnect and reconnect with a new player ID, generating hundreds of connections per minute.

**Why it was invisible locally:** The Vite dev server used a mock API plugin that intercepted `/api/*` requests. WebSocket upgrade requests never reached real code.

**Root cause:** A `useCallback` with state dependencies was passed as a `useEffect` dependency. Every state change created a new callback reference, triggering the effect cleanup (disconnect) and re-run (reconnect).

**The fix:** Use a ref to hold current state, keeping the callback reference stable:

```typescript
const stateRef = useRef(state);
stateRef.current = state;
const getStateForHash = useCallback(() => ({
  tracks: stateRef.current.tracks,
  tempo: stateRef.current.tempo,
  swing: stateRef.current.swing,
}), []); // Empty deps = stable reference
```

**Lesson:** Test with `wrangler dev` (real backend), not just Vite mocks.

### 28. State hash mismatches (production-only)

**The bug:** Client and server computed different hashes for identical state.

**Root cause:** TypeScript optional fields (`soloed?: boolean`) become `undefined` in JSON, while required fields (`soloed: boolean`) serialize as `false`. `JSON.stringify` omits `undefined` but includes `false`, producing different outputs.

**The fix:** Canonicalize before hashing -- apply explicit defaults for all optional fields:

```typescript
function canonicalizeForHash(state) {
  return {
    tracks: state.tracks.map(t => ({
      id: t.id,
      soloed: t.soloed ?? false,
      stepCount: t.stepCount ?? 16,
    })),
  };
}
```

---

## Summary of Rules

These are the rules we'd follow if we built this again from scratch:

| # | Rule | Source |
|---|------|--------|
| 1 | One DO per logical entity (session), never a global singleton | DO design |
| 2 | Never use `setTimeout` in a DO -- use Alarms | Hibernation |
| 3 | Use `blockConcurrencyWhile()` for initialization, nothing else | DO lifecycle |
| 4 | Recreate stubs on retryable errors; never retry overloaded | Error handling |
| 5 | DO is the live source of truth; KV is for cold starts | State management |
| 6 | Persist critical counters to DO storage, not just memory | Eviction |
| 7 | KV writes propagate in <60s; plan for the window | KV consistency |
| 8 | Use hybrid persistence: DO storage per-mutation + KV on-disconnect | Data durability |
| 9 | WebSocket Hibernation is mandatory, not optional | Cost |
| 10 | `serializeAttachment()` for per-connection data that survives hibernation | WebSocket |
| 11 | Auto-response for ping/pong during hibernation | WebSocket |
| 12 | Validate in the Worker before routing to DOs | Cost + security |
| 13 | R2 for media assets (zero egress); Workers Assets for static files | Storage |
| 14 | Wide events > log lines for observability | Debugging |
| 15 | Test with `wrangler dev`, not just mocks | Testing |
| 16 | Exponential backoff + jitter (25%) for reconnection | Resilience |
| 17 | Bound offline queues (100 items, 30s max age) | Resilience |
| 18 | Make connection status visible to users | UX |
| 19 | Use AbortController timeouts on all fetch calls | Reliability |
| 20 | Canonicalize state before hashing across serialization boundaries | Correctness |

---

## References

### Project Documentation
- [Why Cloudflare (Architecture Deep Dive)](../specs/WHY_CLOUDFLARE.md)
- [Durable Objects Reference](../specs/research/CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md)
- [DO Storage Data Flow](../specs/research/DO-STORAGE-DATA-FLOW.md)
- [KV Staleness Fix Options](../specs/research/KV-STALENESS-FIX-OPTIONS.md)
- [Durable Objects Audit (91% compliance)](../specs/research/DURABLE-OBJECTS-AUDIT.md)
- [Cost Analysis](../specs/research/COST-ANALYSIS.md)
- [Lessons Learned (full)](./LESSONS-LEARNED.md)

### Cloudflare Documentation
- [Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [KV](https://developers.cloudflare.com/kv/)
- [R2](https://developers.cloudflare.com/r2/)
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [DO Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
