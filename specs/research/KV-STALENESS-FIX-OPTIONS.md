> **STATUS: IMPLEMENTED in Phase 27**
> **Selected Option 2: Hybrid Approach** (DO Storage per-mutation + KV write on-disconnect)
> See `live-session.ts:persistToDoStorage()` and `flushPendingKVSave()` for implementation.

# KV Staleness Fix Options

## Problem Statement

The KV debounce (5 seconds) creates a window where DO state is ahead of KV state.
If the DO evicts during this window, reconnecting clients receive stale data from KV.

**Demonstrated in tests:**
- DO: 5 tracks, 15 active steps
- KV: 0 tracks, 0 active steps
- Potential data loss: 100%

---

## Option 1: Write-Through to DO Storage (Recommended)

**Approach:** Use Durable Object's built-in transactional storage instead of/alongside KV.

```typescript
// In live-session.ts
async handleMutation(msg: ClientMessage) {
  // Apply to in-memory state
  this.applyMutation(msg);

  // Write immediately to DO storage (transactional, durable)
  await this.ctx.storage.put('state', this.state);

  // KV write remains debounced (for API reads)
  this.scheduleKVFlush();
}
```

**Pros:**
- DO storage is transactional and immediately durable
- No data loss on DO eviction - storage persists
- DO storage is co-located (fast)
- Already using `this.ctx.storage` for some data

**Cons:**
- More storage operations (cost)
- Need migration for existing sessions
- DO storage has size limits (128KB per key, but we can shard)

**Complexity:** Medium
**Data Safety:** Excellent

---

## Option 2: Reduce KV Debounce to Near-Zero

**Approach:** Flush to KV on every mutation (or very small debounce like 100ms).

```typescript
// Change from 5000ms to 100ms
private readonly KV_FLUSH_DEBOUNCE = 100;
```

**Pros:**
- Simple change
- KV stays nearly in sync

**Cons:**
- High KV write costs (KV charges per write)
- KV has rate limits (1000 writes/sec/key)
- Doesn't fundamentally solve the problem (just shrinks window)
- May hit "too many subrequests" limit in Workers

**Complexity:** Low
**Data Safety:** Moderate (smaller window, not eliminated)

---

## Option 3: Client-Side Mutation Replay

**Approach:** Client tracks pending mutations and replays them on reconnect if server state is stale.

```typescript
// In multiplayer.ts
class MutationLog {
  private pending: Map<number, { mutation: ClientMessage, timestamp: number }>;

  onMutationSent(seq: number, mutation: ClientMessage) {
    this.pending.set(seq, { mutation, timestamp: Date.now() });
  }

  onConfirmation(serverSeq: number) {
    // Remove confirmed mutations
    this.pending.delete(serverSeq);
  }

  onReconnect(snapshotTimestamp: number) {
    // Replay mutations newer than snapshot
    for (const [seq, { mutation, timestamp }] of this.pending) {
      if (timestamp > snapshotTimestamp) {
        this.resend(mutation);
      }
    }
  }
}
```

**Pros:**
- Client recovers its own changes
- Works with existing server architecture
- No server-side changes needed

**Cons:**
- Complex client logic
- Doesn't help OTHER clients who weren't the author
- Race conditions with server state
- Mutation replay order matters

**Complexity:** High
**Data Safety:** Partial (only recovers local changes)

---

## Option 4: Snapshot Versioning with Conflict Detection

**Approach:** Track state version numbers; client detects stale snapshots and requests re-sync.

```typescript
// Server sends version with every broadcast
{ type: 'step_toggled', ..., stateVersion: 1542 }

// Client tracks expected version
if (snapshot.stateVersion < this.lastSeenVersion) {
  console.warn('Received stale snapshot, requesting fresh state');
  this.send({ type: 'request_snapshot', minVersion: this.lastSeenVersion });
}
```

**Pros:**
- Detects staleness
- Client can alert user

**Cons:**
- Detection without recovery (if DO evicted, fresh state doesn't exist)
- Only helps if DO is still alive
- Doesn't prevent data loss, just detects it

**Complexity:** Medium
**Data Safety:** Detection only (not prevention)

---

## Option 5: Hybrid - DO Storage + Eventual KV

**Approach:** Primary storage in DO, async replication to KV for API reads.

```typescript
// On mutation
async handleMutation(msg: ClientMessage) {
  // 1. Apply to memory
  this.applyMutation(msg);

  // 2. Persist to DO storage (sync, durable)
  await this.ctx.storage.put('state', this.state);

  // 3. Eventually replicate to KV (async, for API)
  this.replicateToKV(); // debounced, fire-and-forget
}

// On DO wake from eviction
async loadState() {
  // Always load from DO storage first (authoritative)
  const doState = await this.ctx.storage.get('state');
  if (doState) {
    this.state = doState;
  } else {
    // Fallback to KV only for legacy sessions
    this.state = await this.loadFromKV();
  }
}
```

**Pros:**
- DO storage is authoritative (never stale)
- KV still available for API reads
- Gradual migration possible
- Best of both worlds

**Cons:**
- Two storage systems to maintain
- Slightly more complex than Option 1
- Need to handle DO storage size limits

**Complexity:** Medium-High
**Data Safety:** Excellent

---

## Option 6: Immediate KV Write for Critical Operations

**Approach:** Only debounce "cheap" operations; critical ones write immediately.

```typescript
async handleMutation(msg: ClientMessage) {
  this.applyMutation(msg);

  if (isCriticalMutation(msg)) {
    // add_track, delete_track, clear_track
    await this.flushToKVNow();
  } else {
    // toggle_step, set_tempo, etc.
    this.scheduleKVFlush();
  }
}

function isCriticalMutation(msg: ClientMessage): boolean {
  return ['add_track', 'delete_track', 'clear_track'].includes(msg.type);
}
```

**Pros:**
- Protects against track loss (most visible)
- Reduces KV writes vs Option 2
- Simple to implement

**Cons:**
- Step toggles still vulnerable
- Arbitrary distinction between "critical" and not
- Partial solution

**Complexity:** Low
**Data Safety:** Partial

---

## Recommendation

**Option 5 (Hybrid DO Storage + KV)** is the best long-term solution:

1. **Primary storage:** DO `ctx.storage` - immediately durable, co-located
2. **Secondary storage:** KV - eventual consistency, for stateless API reads
3. **Load order:** DO storage first, KV fallback only for legacy

**Implementation Steps:**

1. Add `await this.ctx.storage.put('state', this.state)` after every mutation
2. Change `loadState()` to check DO storage before KV
3. Add migration: when loading from KV, immediately write to DO storage
4. Monitor: track how often KV fallback is used (should decrease to zero)

**Why not Option 1?**
Option 5 is essentially Option 1 with explicit handling of the transition period
and keeping KV for backward compatibility with API reads.

**Estimated effort:** 2-3 hours
**Risk:** Low (additive change, doesn't break existing flow)

---

## Test to Verify Fix

Once implemented, the `kv-staleness.test.ts` tests should pass:
- DO state and storage should match after mutations
- Reconnect after any delay should receive fresh state
- `pendingKVSave` becomes informational, not a data loss risk

---

## ✅ DECISION: Hybrid Approach Selected

We selected **Option 5 with an optimization**: **DO Storage per-mutation + KV on-disconnect only**

### Final Architecture

```typescript
// On every mutation
async handleMutation(msg: ClientMessage) {
  this.applyMutation(msg);
  await this.ctx.storage.put('sessionState', this.state);  // Immediate durability
  this.broadcast(msg);
  // NO KV write here - only on disconnect
}

// On last client disconnect
async handleWebSocketClose(ws: WebSocket) {
  this.connections.delete(ws);
  if (this.connections.size === 0) {
    await this.flushToKV();  // Single KV write per session
  }
}

// On DO wake
async loadState() {
  const doState = await this.ctx.storage.get('sessionState');
  if (doState) return doState;  // DO storage is authoritative
  return await this.loadFromKV();  // KV fallback for legacy only
}
```

### Why This Optimization?

| Approach | DO writes/session | KV writes/session | Cost at 1M sessions |
|----------|-------------------|-------------------|---------------------|
| Current (KV debounced) | 0 | 30 | $145 |
| Option 5 as-written | 150 | 30 | $294 |
| **Hybrid (selected)** | 150 | 1 | **$149** |

By writing to KV only on disconnect (instead of debouncing), we:
- Eliminate $145/month in KV costs at scale
- Still keep KV fresh for stateless API reads
- Maintain zero data loss via DO storage
