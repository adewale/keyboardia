# Server-Side Fix: Stale Snapshot Prevention

> Created: 2025-12-19
> Priority: P0 (Critical)
> Related: MULTIPLAYER-RELIABILITY-SPEC.md (BUG-04), INTEGRATION-TEST-GAPS.md

## Problem Statement

When a client reconnects, the Durable Object may send a snapshot containing stale state from KV, causing tracks and steps to disappear from the UI.

**The bug flow:**
```
1. Player adds track "kick"
2. Server updates DO memory, broadcasts track_added
3. KV save is SCHEDULED (5-second debounce via setAlarm)
4. Player disconnects (network blip)
5. DO may be evicted (no connections, hibernation)
6. Player reconnects within 5 seconds
7. DO wakes up, loads state from KV
8. KV doesn't have "kick" yet (alarm never fired)
9. DO sends snapshot WITHOUT "kick"
10. Client applies snapshot → track disappears
```

---

## Root Cause Analysis

### 1. Debounced KV Saves Create a Window

```typescript
// live-session.ts:1057-1075
private scheduleKVSave(): void {
  this.pendingKVSave = true;
  // Alarm fires in 5 seconds - state is NOT in KV until then
  this.ctx.storage.setAlarm(Date.now() + KV_SAVE_DEBOUNCE_MS);
}
```

The 5-second debounce exists to reduce KV writes (cost and rate limits), but creates a window where DO memory and KV are inconsistent.

### 2. DO Hibernation Loses Memory State

When all players disconnect, the DO may be evicted:
- DO memory (with latest state) is lost
- On next connection, DO loads from KV
- KV has stale state if alarm hadn't fired

### 3. No "Dirty State" Indicator

The DO doesn't track whether its in-memory state differs from KV. On wake-up, it assumes KV is authoritative.

---

## Proposed Solutions

### Solution A: Flush KV on Last Player Disconnect (Recommended)

**Concept:** When the last player disconnects, immediately save to KV instead of waiting for the alarm.

```typescript
// In webSocketClose handler
async webSocketClose(ws: WebSocket): Promise<void> {
  // ... existing cleanup ...

  // If this was the last player, flush pending KV save immediately
  if (this.players.size === 0 && this.pendingKVSave) {
    await this.saveToKV();
    this.pendingKVSave = false;
    // Cancel the pending alarm
    await this.ctx.storage.deleteAlarm();
  }
}
```

**Pros:**
- Simple to implement
- Guarantees state is persisted before eviction
- No change to client code

**Cons:**
- Extra KV write on every session end
- Slight latency on disconnect

**Estimated effort:** 1-2 hours

---

### Solution B: Store State in DO Storage, Not Just KV

**Concept:** Use `ctx.storage.put()` for immediate persistence, KV for cross-DO access.

```typescript
// After every mutation
private persistState(): void {
  // Immediate write to DO storage (SQLite, survives hibernation)
  this.ctx.storage.put('sessionState', this.state);

  // Debounced write to KV (for API access)
  this.scheduleKVSave();
}

// On wake-up
async loadState(): Promise<void> {
  // Try DO storage first (most recent)
  const doState = await this.ctx.storage.get('sessionState');
  if (doState) {
    this.state = doState;
    return;
  }

  // Fall back to KV
  const kvState = await this.loadFromKV();
  this.state = kvState;
}
```

**Pros:**
- DO storage survives hibernation
- No change to debounce timing
- Fastest recovery

**Cons:**
- More complex state management
- Two sources of truth to reconcile
- DO storage has size limits

**Estimated effort:** 4-6 hours

---

### Solution C: Include State Version in Snapshot

**Concept:** Track a monotonic version number. Client rejects snapshots with lower version than confirmed state.

```typescript
// Server-side
interface SessionState {
  // ... existing fields ...
  stateVersion: number;  // Incremented on every mutation
}

// In snapshot message
{ type: 'snapshot', state: {...}, stateVersion: 42 }

// Client-side
private handleSnapshot(msg: SnapshotMessage): void {
  if (msg.stateVersion < this.lastConfirmedVersion) {
    logger.ws.warn('Rejecting stale snapshot', {
      received: msg.stateVersion,
      confirmed: this.lastConfirmedVersion,
    });
    // Request fresh snapshot or stay with current state
    return;
  }
  // Apply snapshot...
}
```

**Pros:**
- Client can detect stale snapshots
- Works with any persistence strategy

**Cons:**
- Requires client-side changes
- Version must survive KV round-trip
- Doesn't prevent stale snapshot from being sent

**Estimated effort:** 3-4 hours

---

### Solution D: Hybrid - Flush on Disconnect + Version Tracking

**Concept:** Combine Solutions A and C for defense in depth.

1. Server flushes KV on last disconnect (prevents most stale snapshots)
2. Client tracks version (catches edge cases)

**Pros:**
- Multiple layers of protection
- Handles edge cases

**Cons:**
- Most complex
- Requires changes on both sides

**Estimated effort:** 5-6 hours

---

## Recommended Approach: Solution A (Flush on Disconnect)

### Implementation Plan

#### Step 1: Add Immediate Save on Last Disconnect

```typescript
// src/worker/live-session.ts

async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
  const player = this.getPlayer(ws);
  if (!player) return;

  // Remove player
  this.players.delete(ws as unknown as WebSocket);

  // Broadcast player_left
  this.broadcast({ type: 'player_left', playerId: player.id });

  // If last player, flush KV immediately
  if (this.players.size === 0) {
    await this.flushPendingKVSave();
  }
}

private async flushPendingKVSave(): Promise<void> {
  if (!this.pendingKVSave) return;

  try {
    await this.saveToKV();
    this.pendingKVSave = false;
    await this.ctx.storage.deleteAlarm();
    console.log(`[KV] Flushed on last disconnect: session=${this.sessionId}`);
  } catch (e) {
    console.error(`[KV] Flush failed: session=${this.sessionId}`, e);
  }
}
```

#### Step 2: Handle webSocketError Similarly

```typescript
async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
  const player = this.getPlayer(ws);
  if (player) {
    this.players.delete(ws as unknown as WebSocket);
    this.broadcast({ type: 'player_left', playerId: player.id });

    // If last player, flush KV
    if (this.players.size === 0) {
      await this.flushPendingKVSave();
    }
  }
}
```

#### Step 3: Add Logging for Debugging

```typescript
private async flushPendingKVSave(): Promise<void> {
  if (!this.pendingKVSave) {
    console.log(`[KV] No pending save on disconnect: session=${this.sessionId}`);
    return;
  }

  const flushStart = Date.now();
  try {
    await this.saveToKV();
    this.pendingKVSave = false;
    await this.ctx.storage.deleteAlarm();
    console.log(`[KV] Flushed on last disconnect: session=${this.sessionId}, took=${Date.now() - flushStart}ms`);
  } catch (e) {
    console.error(`[KV] Flush failed: session=${this.sessionId}`, e);
    // Don't clear pendingKVSave - let alarm retry
  }
}
```

---

## Testing Plan

### Unit Tests

```typescript
// test/unit/kv-flush-on-disconnect.test.ts

describe('KV flush on last disconnect', () => {
  it('saves to KV when last player disconnects', async () => {
    const { do: durableObject, mockKV } = createMockDO();

    // Connect player
    const ws = await durableObject.connect();

    // Make a change
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 150 }));

    // Verify KV not yet updated (debounced)
    expect(mockKV.get('session:xxx')).not.toContainTempo(150);

    // Disconnect
    ws.close();

    // Verify KV updated immediately
    expect(mockKV.get('session:xxx')).toContainTempo(150);
  });

  it('does not flush if other players still connected', async () => {
    const { do: durableObject, mockKV } = createMockDO();

    const ws1 = await durableObject.connect();
    const ws2 = await durableObject.connect();

    ws1.send(JSON.stringify({ type: 'set_tempo', tempo: 150 }));
    ws1.close();

    // KV should NOT be updated yet (player2 still connected)
    expect(mockKV.get('session:xxx')).not.toContainTempo(150);
  });

  it('cancels pending alarm after flush', async () => {
    const { do: durableObject, ctx } = createMockDO();

    const ws = await durableObject.connect();
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: 150 }));

    // Verify alarm was scheduled
    expect(ctx.storage.getAlarm()).toBeDefined();

    ws.close();

    // Verify alarm was cancelled
    expect(ctx.storage.getAlarm()).toBeNull();
  });
});
```

### Integration Tests

```typescript
// test/staging/kv-flush-on-disconnect.test.ts

describe('KV flush on disconnect (staging)', () => {
  it('state survives rapid disconnect/reconnect', async () => {
    const sessionId = await createSession({ tempo: 120 });

    // Connect, change tempo, disconnect
    const player1 = new PlayerHarness('P1', sessionId);
    await player1.connect();
    player1.send({ type: 'set_tempo', tempo: 150 });
    await player1.waitForMessage('tempo_changed');
    player1.disconnect();

    // Wait briefly (less than 5s debounce)
    await delay(500);

    // Reconnect
    const player2 = new PlayerHarness('P2', sessionId);
    await player2.connect();

    // State should be preserved
    expect(player2.state?.tempo).toBe(150);
  });
});
```

---

## Rollout Plan

1. **Implement** Solution A in `live-session.ts`
2. **Add unit tests** in `test/unit/kv-flush-on-disconnect.test.ts`
3. **Deploy to staging** and run integration tests
4. **Monitor logs** for `[KV] Flushed on last disconnect` messages
5. **Verify** no regressions in KV write count (should be similar, just timed differently)
6. **Deploy to production**

---

## Metrics to Monitor

| Metric | Expected Change |
|--------|-----------------|
| KV writes per session | Similar (just earlier timing) |
| Snapshot regression warnings | Should decrease to near-zero |
| Reconnection success rate | Should improve |
| `[KV] Flush failed` errors | Should be rare |

---

## Related Files

| File | Change |
|------|--------|
| `src/worker/live-session.ts` | Add `flushPendingKVSave()`, call on disconnect |
| `test/unit/kv-flush-on-disconnect.test.ts` | New test file |
| `test/staging/multiplayer-sync.test.ts` | Add reconnection test |

---

## Alternative Considerations

### Why not just remove the debounce?

Writing to KV on every mutation would:
- Hit KV rate limits quickly (1000 writes/sec)
- Increase costs significantly
- Add latency to every operation

The debounce is necessary; we just need to flush before potential eviction.

### Why not use DO storage as primary?

DO storage (SQLite) is limited to ~1MB per DO and has its own cost structure. Using it as a cache alongside KV is viable (Solution B) but adds complexity. For now, the simpler flush-on-disconnect approach should solve the immediate problem.
