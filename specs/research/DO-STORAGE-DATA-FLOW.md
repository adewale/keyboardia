> **STATUS: IMPLEMENTED in Phase 27**
> This architecture is now in production. The hybrid approach is live.
> See `live-session.ts:persistToDoStorage()` for the per-mutation write pattern.

# DO Storage Data Flow Architecture

## Terminology

**Mutation** = Any state-changing action from a client:
- `toggle_step` (click a grid cell)
- `add_track` (add a new track)
- `set_tempo` (change BPM)
- `set_track_volume`, `delete_track`, etc.

**"DO per-mutation"** = Write to Durable Object storage (`ctx.storage.put()`) on every single mutation, not debounced.

---

## Current Architecture (KV Debounced)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT DATA FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  CLIENT A                    DURABLE OBJECT                         KV STORAGE
  ─────────                   ──────────────                         ──────────
      │                             │                                     │
      │  1. toggle_step             │                                     │
      │────────────────────────────>│                                     │
      │        (WebSocket)          │                                     │
      │                             │                                     │
      │                        ┌────┴────┐                                │
      │                        │ Memory  │  2. Apply mutation             │
      │                        │  State  │     state.tracks[0].steps[3]=T │
      │                        └────┬────┘                                │
      │                             │                                     │
      │                             │  3. Start/reset 5s timer            │
      │                             │     ┌─────────────────┐             │
      │                             │     │ debounceTimer   │             │
      │                             │     │ (5000ms)        │             │
      │                             │     └─────────────────┘             │
      │                             │                                     │
      │  4. Broadcast to clients    │                                     │
      │<────────────────────────────│                                     │
      │     step_toggled            │                                     │
      │                             │                                     │
      │  5. Another toggle_step     │                                     │
      │────────────────────────────>│                                     │
      │        (50ms later)         │                                     │
      │                             │  6. Reset timer to 5s again!        │
      │                             │     ┌─────────────────┐             │
      │                             │     │ debounceTimer   │◄── RESET    │
      │                             │     │ (5000ms)        │             │
      │                             │     └─────────────────┘             │
      │                             │                                     │
      ·                             ·                                     ·
      ·  (user keeps clicking...)   ·                                     ·
      ·                             ·                                     ·
      │                             │                                     │
      │                             │  7. Finally 5s of silence...        │
      │                             │                                     │
      │                             │  8. Write to KV                     │
      │                             │────────────────────────────────────>│
      │                             │     PUT /sessions/{id}              │
      │                             │     { state: {...} }                │
      │                             │                                     │
```

---

## The Vulnerability Window

```
  ⚠️  THE VULNERABILITY WINDOW:
  ════════════════════════════════════════════════════════════════════════════

      │                             │                                     │
      │  toggle_step (x10)          │                                     │
      │────────────────────────────>│  Memory has all 10 changes          │
      │                             │                                     │
      │                             │  Timer still counting down...       │
      │                             │                                     │
      │         ┌───────────────────┴───────────────────┐                 │
      │         │     💥 DO EVICTED (idle timeout,      │                 │
      │         │        deployment, memory pressure)   │                 │
      │         └───────────────────┬───────────────────┘                 │
      │                             │                                     │
      │                             ▼                                     │
      │                        ╔═════════╗                                │
      │                        ║ MEMORY  ║                                │
      │                        ║  LOST!  ║  KV still has OLD state        │
      │                        ╚═════════╝                                │
      │                                                                   │
      │  CLIENT B CONNECTS                                                │
      │                             │                                     │
      │                        ┌────┴────┐                                │
      │                        │  NEW DO │  1. Check DO storage (empty)   │
      │                        │ INSTANCE│  2. Load from KV (STALE!)      │
      │                        └────┬────┘                                │
      │                             │<────────────────────────────────────│
      │                             │     GET (stale state)               │
      │                             │                                     │
      │  Snapshot (missing 10 changes!)                                   │
      │<────────────────────────────│                                     │
      │     😢 DATA LOST            │                                     │
```

---

## Proposed Architecture (DO Storage Per-Mutation)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROPOSED DATA FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  CLIENT A                    DURABLE OBJECT                         STORAGE
  ─────────                   ──────────────                    ─────────────────
      │                             │                           DO Storage │ KV
      │                             │                           (durable)  │(API)
      │  1. toggle_step             │                               │      │
      │────────────────────────────>│                               │      │
      │        (WebSocket)          │                               │      │
      │                             │                               │      │
      │                        ┌────┴────┐                          │      │
      │                        │ Memory  │  2. Apply mutation       │      │
      │                        │  State  │                          │      │
      │                        └────┬────┘                          │      │
      │                             │                               │      │
      │                             │  3. IMMEDIATE write to        │      │
      │                             │     DO storage (sync)         │      │
      │                             │──────────────────────────────>│      │
      │                             │   ctx.storage.put('state',    │      │
      │                             │                    state)     │      │
      │                             │<──────────────────────────────│      │
      │                             │   ✅ Durably persisted        │      │
      │                             │                               │      │
      │  4. Broadcast to clients    │                               │      │
      │<────────────────────────────│                               │      │
      │     step_toggled            │                               │      │
      │                             │                               │      │
      │                             │  5. Schedule KV write         │      │
      │                             │     (debounced, async)        │      │
      │                             │     ┌─────────────────┐       │      │
      │                             │     │ kvDebounce(5s)  │───────│─────>│
      │                             │     └─────────────────┘       │      │
      │                             │     (fire and forget)         │      │
      │                             │                               │      │
```

---

## No Vulnerability Window

```
  ✅  NO VULNERABILITY WINDOW:
  ════════════════════════════════════════════════════════════════════════════

      │                             │                               │      │
      │  toggle_step (x10)          │                               │      │
      │────────────────────────────>│                               │      │
      │                             │  Each mutation:               │      │
      │                             │    Memory ✓                   │      │
      │                             │    DO Storage ✓ (immediate)   │      │
      │                             │    KV (debounced, eventual)   │      │
      │                             │                               │      │
      │         ┌───────────────────┴───────────────────┐           │      │
      │         │     💥 DO EVICTED                     │           │      │
      │         │        (doesn't matter anymore!)      │           │      │
      │         └───────────────────┬───────────────────┘           │      │
      │                             │                               │      │
      │                             ▼                               │      │
      │                        ╔═════════╗                          │      │
      │                        ║ Memory  ║  But DO Storage          │      │
      │                        ║  gone   ║  still has all 10!       │      │
      │                        ╚═════════╝                          │      │
      │                                                             │      │
      │  CLIENT B CONNECTS                                          │      │
      │                             │                               │      │
      │                        ┌────┴────┐                          │      │
      │                        │  NEW DO │  1. Check DO storage     │      │
      │                        │ INSTANCE│<─────────────────────────│      │
      │                        └────┬────┘  ✅ Found! All 10 changes│      │
      │                             │                               │      │
      │                             │  2. Skip KV (not needed)      │      │
      │                             │                               │      │
      │  Snapshot (all 10 changes!) │                               │      │
      │<────────────────────────────│                               │      │
      │     ✅ NO DATA LOST         │                               │      │
```

---

## Storage Hierarchy Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STORAGE HIERARCHY                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                    CURRENT                          PROPOSED
                    ───────                          ────────

                 ┌──────────┐                     ┌──────────┐
                 │  Memory  │ ◄── Fast            │  Memory  │ ◄── Fast
                 │ (in DO)  │     Volatile!       │ (in DO)  │     Volatile
                 └────┬─────┘                     └────┬─────┘
                      │                                │
                      │ 5s debounce                    │ Immediate (sync)
                      ▼                                ▼
               ┌────────────┐                   ┌────────────┐
               │     KV     │ ◄── Durable       │ DO Storage │ ◄── Durable
               │            │     but stale!    │(ctx.storage│     & fresh!
               └────────────┘                   └─────┬──────┘
                                                      │
                                                      │ 5s debounce (async)
                                                      ▼
                                                ┌────────────┐
                                                │     KV     │ ◄── For API
                                                │            │     reads only
                                                └────────────┘


  LOAD ORDER ON DO WAKE:

  Current:   KV only (may be stale)
  Proposed:  DO Storage first → KV fallback (only for legacy sessions)
```

---

## Code Change

```typescript
// CURRENT: live-session.ts
async handleMutation(msg: ClientMessage) {
  this.applyToMemory(msg);           // 1. Memory (volatile)
  this.broadcast(msg);               // 2. Tell clients
  this.scheduleKVFlush();            // 3. Debounced KV write
}

// PROPOSED: live-session.ts
async handleMutation(msg: ClientMessage) {
  this.applyToMemory(msg);           // 1. Memory
  await this.ctx.storage.put(        // 2. DO Storage (DURABLE!) ← NEW
    'state',
    this.state
  );
  this.broadcast(msg);               // 3. Tell clients
  this.scheduleKVFlush();            // 4. Debounced KV (for API)
}
```

The single added line (`await this.ctx.storage.put(...)`) ensures every mutation is durably persisted before the client is told it succeeded.

---

## Summary

| Aspect | Current (KV Debounced) | Proposed (DO Storage) |
|--------|------------------------|----------------------|
| **Write timing** | Every 5s (debounced) | Every mutation (immediate) |
| **Durability** | Volatile for up to 5s | Immediate |
| **Data loss risk** | 100% of recent changes | None |
| **Cost** | ~$145/month at 1M sessions | ~$149/month at 1M sessions |
| **Latency added** | None | ~1-2ms per mutation |
| **Complexity** | Simple | Simple (one line change) |

---

## DECISION: Hybrid Approach Selected

The final implementation uses **DO Storage per-mutation + KV write on-disconnect only**:

```
  CLIENT                    DURABLE OBJECT                      STORAGE
  ──────                    ──────────────                 ─────────────────
      │                           │                        DO Storage │ KV
      │  mutation                 │                            │      │
      │──────────────────────────>│                            │      │
      │                           │                            │      │
      │                      ┌────┴────┐                       │      │
      │                      │ Memory  │  1. Apply             │      │
      │                      └────┬────┘                       │      │
      │                           │                            │      │
      │                           │  2. ctx.storage.put()      │      │
      │                           │───────────────────────────>│      │
      │                           │     (immediate, ~1ms)      │      │
      │                           │                            │      │
      │  broadcast                │                            │      │
      │<──────────────────────────│  3. Tell clients           │      │
      │                           │                            │      │
      │                           │  (NO KV write here!)       │      │
      │                           │                            │      │
      ·  (more mutations...)      ·                            ·      ·
      │                           │                            │      │
      │  disconnect               │                            │      │
      │──────────────────────────>│                            │      │
      │                           │  4. Last client left       │      │
      │                           │                            │      │
      │                           │  5. KV.put() ──────────────│─────>│
      │                           │     (single write)         │      │
      │                           │                            │      │
```

### Why Hybrid?

| Approach | DO writes/session | KV writes/session | Cost at 1M sessions |
|----------|-------------------|-------------------|---------------------|
| Current (KV debounced) | 0 | 30 | $145 |
| Naive DO + KV | 150 | 30 | $294 |
| **Hybrid** | 150 | 1 | **$149** |

Hybrid eliminates the KV debounce overhead, saving $145/month at scale.

---

## Related Documents

- [KV Staleness Fix Options](./KV-STALENESS-FIX-OPTIONS.md) - All fix options considered
- [Cost Analysis](./COST-ANALYSIS-DO-STORAGE.md) - Detailed cost comparison
- [`state-machine-fuzz.test.ts`](../../test/integration/state-machine-fuzz.test.ts) and [`eviction-recovery.test.ts`](../../test/integration/eviction-recovery.test.ts) — maintained Worker-runtime coverage for KV lag/convergence and recovery
