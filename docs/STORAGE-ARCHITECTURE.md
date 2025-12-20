# Storage Architecture: DO Storage vs KV

**Created:** 2025-12-20
**Status:** Active Architecture Decision

## Overview

Keyboardia uses a dual-storage architecture for session data:

1. **Durable Object (DO) Storage** - Source of truth, survives hibernation
2. **Workers KV** - Read-optimized copy, eventually consistent

This document explains why both exist, their tradeoffs, and the mental model for working with them.

---

## The Question

> If there's 1 Durable Object per session and it has attached storage, why shouldn't the session only be stored there?

This is a valid question. DO storage alone could work, but the dual-storage architecture exists for specific reasons.

---

## Current Data Flow

```
                                    ┌─────────────────┐
                                    │   WebSocket     │
                                    │   Connection    │
                                    └────────┬────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Durable Object                               │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │   Memory    │───▶│   DO Storage    │───▶│      KV         │  │
│  │   State     │    │   (immediate)   │    │   (debounced)   │  │
│  └─────────────┘    └─────────────────┘    └─────────────────┘  │
│        ▲                    │                      │            │
│        │                    │                      │            │
│   Mutations            Source of              Read-optimized    │
│                         Truth                    Copy           │
└─────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │   REST API      │
                                    │   (reads KV)    │
                                    └─────────────────┘
```

---

## Why KV Exists

### 1. Direct API Access Without DO Instantiation

The REST API needs to read sessions for display, preview, and embedding:

```typescript
// GET /api/sessions/:id
export async function getSession(env: Env, sessionId: string): Promise<Session | null> {
  return await env.SESSIONS.get(sessionId, 'json');  // Reads directly from KV
}
```

**Without KV:**
- Every API read requires instantiating the DO
- DO billing: per-request + duration charges
- Potential cold start latency (~50-200ms)
- Single point of access (all requests route to one DO instance)

**With KV:**
- Direct read from globally-replicated store
- ~10ms latency from nearest edge
- Cheaper for read-heavy patterns
- No DO instantiation needed

### 2. Session Listing and Discovery

Future features like "browse sessions", "my recent sessions", or "popular beats":

| Approach | To List 100 Sessions |
|----------|---------------------|
| DO-only | Instantiate 100 DOs, read each storage |
| KV | Iterate KV keys, read metadata directly |

KV supports `list()` operations that return keys matching a prefix. DO storage has no cross-DO query capability.

### 3. Published Sessions Are Read-Heavy

When a user publishes a beat and shares the link:
- Hundreds/thousands of people may load the same session
- Each load is a read, not a collaborative edit
- No WebSocket needed, just fetch the state

**KV advantages for published sessions:**
- Globally replicated (reads served from nearest edge)
- Handles read fanout efficiently
- No single-instance bottleneck

**DO disadvantages for this pattern:**
- Single instance handles all requests
- Every read incurs DO instantiation cost
- Latency for users far from the DO's region

### 4. Backup and Recovery

KV provides durability outside the DO lifecycle:

- **DO eviction**: Rare, but Cloudflare can evict DOs under extreme circumstances. KV persists independently.
- **Migration**: Easier to export, transform, or migrate session data from KV.
- **Admin tools**: Can inspect/modify sessions without complex DO interaction.
- **Disaster recovery**: KV data can be backed up via API.

### 5. Cost Profile Differences

| Operation | DO Storage | KV |
|-----------|-----------|-----|
| Read | $0.20/million | $0.50/million |
| Write | $1.00/million | $5.00/million |
| Storage | $0.20/GB/month | $0.50/GB/month |
| Instantiation | ~$0.15/million requests | N/A |

**Analysis:**
- DO storage is cheaper per-operation
- But DO requires instantiation for every access
- For read-heavy published sessions, KV avoids instantiation costs
- For real-time collaboration, DO is already instantiated (WebSocket), so DO storage wins

---

## Why NOT Just DO Storage?

A DO-only architecture could work if:

1. **All access is via WebSocket** - Already have DO connection
2. **No session listing/search needed** - Direct URL access only
3. **No published session sharing** - Or willing to instantiate DO for every view
4. **Willing to pay DO instantiation** - For every API read

### The Problem We Hit

Dual-storage adds sync complexity. We had a bug where:

1. State was modified in DO memory
2. `scheduleKVSave()` set a debounced alarm
3. DO hibernated before alarm fired
4. Alarm woke DO, but class variables were reset
5. KV save never happened
6. State was lost

**Root cause:** We weren't fully treating DO storage as the source of truth. The fix was to persist state to DO storage immediately, then debounce only the KV copy.

---

## The Correct Mental Model

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   DO Storage = SOURCE OF TRUTH                                  │
│   - Immediate writes on every mutation                          │
│   - Survives hibernation                                        │
│   - Authoritative for real-time state                          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   KV = MATERIALIZED VIEW (Read Cache)                           │
│   - Eventually consistent (5-second debounce)                   │
│   - Optimized for API reads                                     │
│   - Can be regenerated from DO storage                          │
│   - NOT authoritative - may be stale                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle:** If KV is stale or missing, DO storage can regenerate it. The reverse is NOT true.

---

## Code Locations

### DO Storage Operations
```
src/worker/live-session.ts:
  - scheduleKVSave()     : Persists to DO storage immediately, schedules KV save
  - alarm()              : Loads from DO storage, saves to KV
  - ensureStateLoaded()  : Checks DO storage first, falls back to KV
```

### KV Operations
```
src/worker/sessions.ts:
  - getSession()         : Reads from KV
  - createSession()      : Writes to KV
  - updateSession()      : Writes to KV
  - deleteSession()      : Deletes from KV
```

### The Sync Point
```typescript
// In scheduleKVSave() - immediate DO storage write
this.ctx.storage.put('state', this.state);

// In alarm() - debounced KV write
await this.saveToKV();
```

---

## When to Use Which

| Use Case | Storage | Reason |
|----------|---------|--------|
| Real-time collaboration | DO Storage | Already connected via WebSocket |
| REST API read (session preview) | KV | Avoid DO instantiation |
| Published session view | KV | Read-heavy, global distribution |
| Session mutation | DO Storage → KV | Source of truth, then sync |
| Session listing | KV | Cross-session query capability |
| Disaster recovery | KV | Independent of DO lifecycle |

---

## Alternative Architectures Considered

### 1. DO Storage Only

**Pros:**
- Single source of truth
- No sync complexity
- Simpler code

**Cons:**
- Every API read instantiates DO
- No cross-session queries without index DO
- Published sessions route all reads to one instance

**Verdict:** Viable for small scale, but doesn't scale for read-heavy published sessions.

### 2. KV Only (No DO Storage)

**Pros:**
- Globally replicated reads
- Simple key-value model

**Cons:**
- No real-time collaboration (KV has no WebSocket)
- Eventual consistency not suitable for multiplayer
- Would need separate real-time solution

**Verdict:** Not viable for real-time collaboration use case.

### 3. DO Storage + Separate Read Replica DO

**Pros:**
- Keeps real-time in DO ecosystem
- Could route read traffic to replica

**Cons:**
- Complex to implement
- Still single-region per replica
- Higher cost than KV

**Verdict:** Over-engineered for current needs.

### 4. Current: DO Storage (Primary) + KV (Read Cache)

**Pros:**
- Best of both worlds
- Real-time via DO
- Read scaling via KV
- Clear source of truth

**Cons:**
- Sync complexity (mitigated by fix)
- Two storage costs

**Verdict:** Correct choice for Keyboardia's use case.

---

## Invariants to Maintain

1. **DO storage is always written first** - Never write to KV without DO storage having the data
2. **KV can be stale** - Code reading from KV must accept eventual consistency
3. **DO storage survives hibernation** - Critical state persisted immediately, not debounced
4. **KV is regenerable** - If KV is corrupted/missing, DO can recreate it

---

## Testing Implications

### Unit Tests
- Mock both DO storage and KV
- Test that DO storage is written before KV
- Test hibernation scenarios (class variables reset)

### Integration Tests
- Verify DO → KV sync happens within debounce window
- Verify API reads work when KV is stale
- Verify recovery when KV is missing

### E2E Tests
- Real-time collaboration uses DO storage
- Published session sharing uses KV
- Verify consistency after hibernation cycle

---

## Future Considerations

### If Read Traffic Grows
- KV handles this well (global replication)
- Consider caching layer for hot sessions
- Published sessions could use CDN caching

### If Write Traffic Grows
- DO handles this well (single writer)
- Consider sharding by session prefix
- Monitor DO storage limits (128KB per key, 10GB total)

### If Cross-Session Queries Needed
- Add dedicated index in KV or separate DO
- Consider D1 (SQLite) for complex queries
- Don't try to query across DOs directly

---

## Summary

The dual-storage architecture exists because:

1. **Real-time collaboration** needs DO's WebSocket and transactional guarantees
2. **Read-heavy access patterns** (API, published sessions) benefit from KV's global distribution
3. **Session listing/search** requires cross-session query capability that DO storage lacks

The key insight is treating them as **primary (DO) + cache (KV)**, not as equal peers. With this mental model and the hibernation fix in place, the architecture is sound.

---

**Related Documents:**
- `specs/research/DURABLE-OBJECTS-TESTING.md` - Lesson 17: Hibernation
- `docs/BUG-PATTERNS.md` - Pattern #8: DO Hibernation State Loss
- `specs/research/CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md` - DO behavior reference
