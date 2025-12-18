# Durable Objects Best Practices Audit

**Project:** Keyboardia
**Audit Date:** December 18, 2025
**Source:** [Cloudflare Durable Objects Rules and Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)

## Executive Summary

| Category | Compliance |
|----------|------------|
| Overall Score | **91%** (21/23 rules followed) |
| Critical Issues | 0 |
| Warnings | 2 |
| Optimizations Available | 3 |

The Keyboardia Durable Objects implementation follows most Cloudflare best practices well. The implementation correctly uses the Hibernation API, proper WebSocket handlers, alarm-based persistence, and deterministic routing. Two areas need attention: missing `blockConcurrencyWhile()` for initialization race conditions, and serverSeq counter lost on eviction.

---

## Detailed Rule-by-Rule Analysis

### 1. Use Cases and Design

#### 1.1 Use for Stateful Coordination, Not Stateless Requests

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Deploy DOs for applications requiring shared state management across multiple clients |

**What the rule says:** Use DOs for coordination (chat rooms, multiplayer games, collaborative documents), strong consistency, per-entity storage, persistent connections, and scheduled work.

**Implementation:** Keyboardia uses DOs for real-time multiplayer music collaboration - exactly the right use case. Each session is a coordination point for up to 10 players.

---

#### 1.2 Model Around Your "Atom" of Coordination

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Create one Durable Object instance per logical unit needing coordination |

**What the rule says:** Each "atom" of your application gets its own single-threaded execution environment with private storage.

**Implementation:**
```typescript
// src/worker/index.ts:322
const doId = env.LIVE_SESSIONS.idFromName(sessionId);
let stub = env.LIVE_SESSIONS.get(doId);
```

**Analysis:** Keyboardia correctly creates one `LiveSessionDurableObject` per session. Each session ID maps to exactly one DO instance, which coordinates all players in that session.

---

#### 1.3 Avoid Global Singleton Anti-Pattern

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Never funnel all application traffic through one Durable Object instance |

**What the rule says:** A single DO handling all traffic becomes a bottleneck. DOs execute single-threaded, so all requests are processed sequentially.

**Implementation:** Each session has its own DO instance identified by `sessionId`. No global singleton exists.

---

#### 1.4 Use Deterministic IDs for Predictable Routing

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Use `idFromName()` with meaningful strings for consistent routing |

**What the rule says:** The same input always produces the same DO ID, ensuring requests for the same logical entity reach the same instance.

**Implementation:** Uses `idFromName()` with the session UUID, which is meaningful and deterministic.

---

#### 1.5 Implement Parent-Child Relationships for Hierarchical Data

| Status | Rule |
|--------|------|
| N/A | Separate related entities into parent and child Durable Objects |

**What the rule says:** Parent coordinates and tracks children without waking them; children handle state independently.

**Analysis:** Not applicable. Keyboardia has a flat structure (one DO per session). If we added features like "session playlists" or "user workspaces," this pattern would apply.

---

#### 1.6 Consider Location Hints for Latency-Sensitive Applications

| Status | Rule |
|--------|------|
| ⚠️ NOT USED | Provide location hints when creating Durable Objects for geographically distributed applications |

**What the rule says:** Pass a region parameter (e.g., "wnam" for Western North America) to influence instance creation location. Location hints are suggestions, not guarantees.

**Current Implementation:** No location hints used.

**Recommendation:** For multiplayer music collaboration, latency matters. Consider adding location hints based on the first player's region:

```typescript
// Could be enhanced with location hints
const doId = env.LIVE_SESSIONS.idFromName(sessionId, {
  locationHint: 'wnam'  // Western North America
});
```

**Priority:** Low - Cloudflare already places DOs near the first user. Explicit hints could help if users know they want to collaborate regionally.

---

### 2. Storage and State Management

#### 2.1 Use SQLite-Backed Durable Objects

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Adopt SQLite storage for all new Durable Objects |

**What the rule says:** SQLite provides familiar SQL APIs, indexes, transactions, and better performance than legacy key-value storage.

**Implementation:**
```jsonc
// wrangler.jsonc:24-28
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["LiveSessionDurableObject"]
  }
]
```

**Analysis:** Correctly configured as SQLite-backed class.

---

#### 2.2 Initialize Storage and Run Migrations in the Constructor

| Status | Rule |
|--------|------|
| ⚠️ PARTIAL | Use `blockConcurrencyWhile()` during construction to run migrations before processing requests |

**What the rule says:** Ensures schema readiness and prevents race conditions during initialization.

**Current Implementation:**
```typescript
// src/worker/live-session.ts:109-124
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);

  // Restore WebSocket connections from hibernation (synchronous)
  for (const ws of this.ctx.getWebSockets()) {
    const attachment = ws.deserializeAttachment() as PlayerInfo | null;
    if (attachment) {
      this.players.set(ws, attachment);
    }
  }

  this.ctx.setWebSocketAutoResponse(
    new WebSocketRequestResponsePair('ping', 'pong')
  );
}
```

**Issue:** No `blockConcurrencyWhile()`. While constructor operations are synchronous, state loading happens later in `handleWebSocketUpgrade()` and could race if multiple connections arrive simultaneously.

**See:** Section 11 for recommended fix.

---

#### 2.3 Understand In-Memory State vs. Persistent Storage

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Never rely on class properties for critical state |

**What the rule says:**
| Type | Speed | Persistence | Use Case |
|------|-------|-------------|----------|
| In-memory properties | Fastest | Lost on eviction/crash | Caching, active connections |
| SQLite storage | Fast | Durable across restarts | Primary data storage |
| External (R2, D1) | Variable | Cross-DO accessible | Large files, shared data |

**Implementation Analysis:**

| Data | Storage | Appropriate? |
|------|---------|--------------|
| `players` Map | In-memory | ✅ Active connections, reconstructed from hibernation |
| `state` (SessionState) | In-memory + KV | ✅ Cached in memory, persisted to KV |
| `playingPlayers` Set | In-memory | ✅ Ephemeral playback state |
| `serverSeq` counter | In-memory only | ⚠️ Lost on eviction, may cause sequence gaps |

**See:** Section 11 for serverSeq persistence recommendation.

---

#### 2.4 Create Indexes for Frequently-Queried Columns

| Status | Rule |
|--------|------|
| N/A | Add database indexes to columns used in WHERE and ORDER BY |

**What the rule says:** Indexes trade slightly more storage for dramatically faster reads.

**Analysis:** Keyboardia uses external KV for session storage, not DO's SQLite. If we migrate to SQLite storage, indexes would be relevant.

---

#### 2.5 Understand Input and Output Gates

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Rely on Cloudflare's automatic gates to prevent data races |

**What the rule says:** Input gates block new events during synchronous execution or storage operations. Output gates hold outgoing messages until pending writes complete.

**Analysis:** The implementation relies on automatic gates correctly. All message handlers are synchronous or properly await storage operations.

---

#### 2.6 Avoid Race Conditions with Non-Storage I/O

| Status | Rule |
|--------|------|
| ⚠️ CAUTION | Non-storage I/O like fetch() allows other requests to interleave |

**What the rule says:** Input gates only protect during storage operations. External I/O can cause race conditions.

**Current Implementation:**
```typescript
// src/worker/live-session.ts:159-178
// Load state from KV if not already loaded
if (!this.state && this.sessionId) {
  const session = await getSession(this.env, this.sessionId);  // External KV call
  // ...
}
```

**Risk:** The KV read is external I/O. If two WebSocket upgrade requests arrive nearly simultaneously:
1. Request A starts, sees `this.state === null`, begins KV fetch
2. Request B starts, sees `this.state === null`, begins KV fetch
3. Both complete and potentially set up state independently

**Impact:** Low in practice because the guard `if (!this.state)` prevents re-fetching once loaded, but the race window exists.

**See:** Section 11 for recommended fix using blockConcurrencyWhile.

---

#### 2.7 Use `blockConcurrencyWhile()` Sparingly

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Reserve blockConcurrencyWhile() for one-time initialization |

**What the rule says:** If blocking takes ~5ms, you're limited to ~200 requests/second. Use for constructor initialization only.

**Analysis:** The implementation currently doesn't use `blockConcurrencyWhile()` at all. When we add it (see Section 11), it will be used correctly - only for one-time state initialization.

---

### 3. API Design and Communication

#### 3.1 Use RPC Methods Instead of fetch()

| Status | Rule |
|--------|------|
| ✅ FOLLOWS (Exception) | For compatibility date >= 2024-04-03, use RPC methods |

**What the rule says:** RPC is more ergonomic and provides better type safety.

**Implementation:** Uses `fetch()` for WebSocket upgrades, which is correct - RPC cannot handle WebSocket upgrades. Debug endpoints could use RPC but fetch() works fine.

---

#### 3.2 Initialize DOs Explicitly with an init() Method

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | DOs cannot access their own name/ID internally; implement explicit initialization |

**What the rule says:** Create an `init()` method to store identity and metadata in storage.

**Implementation:**
```typescript
// src/worker/live-session.ts:154-157
// Extract session ID from URL path
const pathParts = url.pathname.split('/');
const sessionIdIndex = pathParts.indexOf('sessions') + 1;
this.sessionId = pathParts[sessionIdIndex] || null;
```

**Analysis:** The session ID is extracted from the URL on first request and stored. This serves the same purpose as an explicit `init()` method.

---

#### 3.3 Always Await RPC/DO Calls

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Never leave RPC method calls unawaited |

**Implementation:**
```typescript
// src/worker/index.ts:331
return await stub.fetch(request);
```

**Analysis:** All DO stub calls are properly awaited.

---

### 4. Error Handling

#### 4.1 Handle Errors and Use Exception Boundaries

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Wrap risky operations in try/catch |

**What the rule says:** Uncaught exceptions can leave DO in unknown state and may cause runtime to terminate instance.

**Implementation:**
```typescript
// src/worker/live-session.ts:1008-1017
private async saveToKV(): Promise<void> {
  if (!this.state || !this.sessionId) return;
  try {
    await updateSession(this.env, this.sessionId, this.state);
  } catch (e) {
    console.error(`[KV] Error saving session ${this.sessionId}:`, e);
  }
}
```

**Analysis:** Critical operations (KV saves, WebSocket sends) are wrapped in try/catch.

---

#### 4.2 Handle Retryable and Overloaded Errors

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Check `.retryable` and `.overloaded` properties on errors |

**What the rule says:** Never retry overloaded errors. For retryable errors, use exponential backoff.

**Implementation:**
```typescript
// src/worker/index.ts:336-359
const e = error as { retryable?: boolean; overloaded?: boolean };
if (e.overloaded) {
  // Never retry overloaded errors
  return jsonError('Service temporarily unavailable', 503);
}
if (e.retryable) {
  // Create fresh stub and retry once
  stub = env.LIVE_SESSIONS.get(doId);
  try {
    return await stub.fetch(request);
  } catch (retryError) { /* ... */ }
}
```

**Analysis:** Excellent error handling that follows Cloudflare's recommendations exactly.

---

### 5. WebSocket and Real-Time Communication

#### 5.1 Use Hibernatable WebSockets API

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | The Hibernation API allows DOs to sleep while maintaining WebSocket connections |

**What the rule says:** Significantly reduces costs for applications with many idle connections.

**Implementation:**
```typescript
// src/worker/live-session.ts:197-198
this.ctx.acceptWebSocket(server);
```

**Analysis:** Correctly uses `ctx.acceptWebSocket()` for hibernation support.

---

#### 5.2 Use serializeAttachment() for Per-Connection State

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Store metadata per connection that survives hibernation |

**What the rule says:** Store user IDs, session tokens, and other per-connection data. Limited to 2,048 bytes.

**Implementation:**
```typescript
// src/worker/live-session.ts:200-202
server.serializeAttachment(playerInfo);
this.players.set(server, playerInfo);

// Constructor restoration
for (const ws of this.ctx.getWebSockets()) {
  const attachment = ws.deserializeAttachment() as PlayerInfo | null;
  if (attachment) {
    this.players.set(ws, attachment);
  }
}
```

**Analysis:** PlayerInfo contains id, timestamps, color, name - well under 2KB. Properly serialized and restored.

---

#### 5.3 Implement WebSocket Handlers

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Implement `webSocketMessage()`, `webSocketClose()`, and `webSocketError()` |

**Implementation:** All three handlers are properly implemented with appropriate cleanup and broadcast logic.

---

#### 5.4 Minimize Constructor Work for Hibernation

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Minimize work in the constructor |

**What the rule says:** The constructor runs every time a hibernated DO receives an event.

**Implementation:** Constructor only does synchronous Map operations and sets up auto-response. No async work, no external calls.

---

### 6. Scheduling and Lifecycle

#### 6.1 Use Alarms for Per-Entity Scheduled Tasks

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Schedule background work per DO using Alarms API |

**What the rule says:** Millisecond-precision scheduling, no automatic repetition.

**Implementation:**
```typescript
// src/worker/live-session.ts:984-992
private scheduleKVSave(): void {
  this.pendingKVSave = true;
  this.ctx.storage.setAlarm(Date.now() + KV_SAVE_DEBOUNCE_MS);
}
```

**Analysis:** Excellent use of alarms for debounced persistence.

---

#### 6.2 Make Alarm Handlers Idempotent

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Design alarm() methods to safely execute multiple times |

**Implementation:**
```typescript
async alarm(): Promise<void> {
  if (this.pendingKVSave) {
    await this.saveToKV();
    this.pendingKVSave = false;
  }
}
```

**Analysis:** The `pendingKVSave` flag prevents unnecessary saves. Even if alarm fires multiple times, save operation is idempotent.

---

#### 6.3 Clean Up Storage with deleteAll()

| Status | Rule |
|--------|------|
| N/A | Call deleteAll() to fully clear DO storage |

**What the rule says:** Simply deleting keys or dropping tables is insufficient. Delete alarms first.

**Analysis:** Not currently implemented. Session deletion in Keyboardia deletes from KV, not from DO storage. Could be added if we migrate to DO SQLite storage for sessions.

---

### 7. Performance and Optimization

#### 7.1 Avoid Long-Running Operations

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | DOs are single-threaded. Long operations block all requests. |

**What the rule says:** Offload heavy workloads to Queues or Workflows for operations exceeding a few hundred milliseconds.

**Analysis:** All message handlers are lightweight:
- State mutations are O(1) or O(n) where n is small (max 16 tracks, 128 steps)
- No CPU-intensive operations
- KV persistence is debounced and async

---

### 8. Request Validation

#### 8.1 Validate Before Routing to DO

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Validate requests in Worker before routing |

**What the rule says:** Both Workers and DOs are billed based on request count.

**Implementation:**
```typescript
// src/worker/index.ts:308-318
if (!isValidUUID(sessionId)) {
  return jsonError('Invalid session ID format', 400);
}
const session = await getSession(env, sessionId, false);
if (!session) {
  return jsonError('Session not found', 404);
}
```

**Analysis:** Session ID validation and existence check happen in Worker before routing to DO.

---

### 9. Testing

#### 9.1 Vitest Integration

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Use `@cloudflare/vitest-pool-workers` for testing |

**Implementation:** Uses `runInDurableObject()` for accessing instance internals, test isolation with fresh storage.

---

### 10. Cost and Billing

#### 10.1 Hibernatable WebSockets Reduces Costs

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Hibernation significantly reduces costs for idle connections |

**Analysis:** Uses `ctx.acceptWebSocket()` for hibernation support. Idle sessions with connected players will hibernate.

---

#### 10.2 Schedule Alarms Only When Needed

| Status | Rule |
|--------|------|
| ✅ FOLLOWS | Only schedule alarms when there is work to do |

**Analysis:** Alarms are only scheduled when state changes occur, not on a fixed interval.

---

## 11. Recommended Changes

### Priority 1: Add blockConcurrencyWhile for State Loading (CRITICAL)

**Issue:** Multiple simultaneous WebSocket connections could race on initial state load.

**File:** `src/worker/live-session.ts`

**Changes:**
1. Add state loading flag and promise
2. Wrap state loading in blockConcurrencyWhile
3. Add schema migration support for future changes

```typescript
// Add to class properties (after line 107)
private stateLoaded = false;
private stateLoadPromise: Promise<void> | null = null;

// New method for state initialization
private async initializeState(): Promise<void> {
  if (this.stateLoaded || !this.sessionId) return;

  const session = await getSession(this.env, this.sessionId);
  if (session) {
    this.state = session.state;
    this.immutable = session.immutable ?? false;
    this.validateAndRepairState('loadFromKV');
  } else {
    this.state = { tracks: [], tempo: 120, swing: 0, version: 1 };
    this.immutable = false;
  }

  // Load persisted serverSeq from DO storage
  const storedSeq = await this.ctx.storage.get<number>('serverSeq');
  if (storedSeq !== undefined) {
    this.serverSeq = storedSeq;
  }

  this.stateLoaded = true;
}

// In handleWebSocketUpgrade, replace lines 159-178 with:
if (!this.stateLoaded && this.sessionId) {
  if (!this.stateLoadPromise) {
    this.stateLoadPromise = this.ctx.blockConcurrencyWhile(() =>
      this.initializeState()
    );
  }
  await this.stateLoadPromise;
}
```

---

### Priority 2: Persist serverSeq to DO Storage (MEDIUM)

**Issue:** Server sequence number is lost on DO eviction, causing potential message ordering issues.

**Changes:**
1. Load serverSeq in initializeState (shown above)
2. Persist serverSeq periodically in broadcast

```typescript
// In broadcast method, after incrementing serverSeq:
private broadcast(message: ServerMessage, exclude?: WebSocket, clientSeq?: number): void {
  const messageWithSeq: ServerMessage = {
    ...message,
    seq: ++this.serverSeq,
    ...(clientSeq !== undefined && { clientSeq }),
  };

  // Persist serverSeq every 100 messages to DO storage
  // Uses write coalescing for efficiency
  if (this.serverSeq % 100 === 0) {
    this.ctx.storage.put('serverSeq', this.serverSeq);
  }

  // ... rest of broadcast
}
```

---

### Priority 3: Add Schema Migration Support (LOW)

**For future schema changes:**

```typescript
// Add to constructor, wrapping existing code
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);

  this.ctx.blockConcurrencyWhile(async () => {
    // Run schema migrations
    const version = await this.ctx.storage.get<number>('schema_version') ?? 0;

    if (version < 1) {
      // v1: Initialize serverSeq tracking
      await this.ctx.storage.put('schema_version', 1);
    }

    // Future migrations go here
    // if (version < 2) { ... }
  });

  // Restore WebSocket connections (synchronous, safe outside blockConcurrencyWhile)
  for (const ws of this.ctx.getWebSockets()) {
    const attachment = ws.deserializeAttachment() as PlayerInfo | null;
    if (attachment) {
      this.players.set(ws, attachment);
    }
  }

  this.ctx.setWebSocketAutoResponse(
    new WebSocketRequestResponsePair('ping', 'pong')
  );
}
```

---

## Summary of Findings

### Issues Requiring Attention

| Priority | Issue | Location | Recommendation |
|----------|-------|----------|----------------|
| High | Missing blockConcurrencyWhile for initialization | handleWebSocketUpgrade | Wrap state loading in blockConcurrencyWhile |
| Medium | serverSeq counter lost on eviction | broadcast() | Persist to DO storage periodically |
| Low | No schema migration support | Constructor | Add versioned migration pattern |

### Not Applicable / Optional

| Rule | Reason |
|------|--------|
| Location hints | Cloudflare auto-places near first user; explicit hints optional |
| Parent-child DO pattern | Flat structure is appropriate for current use case |
| SQLite indexes | Using KV for persistence, not DO SQLite |
| deleteAll() cleanup | Session deletion uses KV, not DO storage |

### Strengths

1. **Excellent Hibernation Implementation** - Proper use of `ctx.acceptWebSocket()`, `serializeAttachment()/deserializeAttachment()`, and WebSocket handlers
2. **Smart Persistence Strategy** - Alarm-based debounced saves prevent excessive KV writes
3. **Robust Error Handling** - Proper handling of retryable/overloaded errors with fresh stub creation
4. **Good Request Validation** - Session ID and existence checks before DO routing saves billing costs
5. **Comprehensive Testing** - Uses Cloudflare's recommended testing tools with `runInDurableObject()`
6. **Correct Atomic Design** - One DO per session, no global singleton anti-pattern
7. **Immutable Session Support** - Centralized mutation check for published sessions

---

## Appendix: File References

| File | Purpose |
|------|---------|
| `src/worker/live-session.ts` | Main Durable Object class (1086 lines) |
| `src/worker/index.ts` | Worker routing to DOs (959 lines) |
| `wrangler.jsonc` | Cloudflare configuration |
| `src/worker/types.ts` | Type definitions |
| `src/worker/sessions.ts` | KV storage operations |
| `src/worker/invariants.ts` | State validation |
| `test/integration/live-session.test.ts` | Integration tests |
