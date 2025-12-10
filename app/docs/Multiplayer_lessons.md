# Multiplayer System Lessons Learned

This document captures lessons learned building real-time multiplayer functionality for Keyboardia using Cloudflare's edge infrastructure.

## Architecture Overview

```
┌─────────────────┐     WebSocket      ┌─────────────────────────┐
│   Browser(s)    │◄──────────────────►│  Durable Object (DO)    │
│   React App     │                    │  - In-memory state      │
│   Audio Engine  │                    │  - WebSocket handling   │
└─────────────────┘                    │  - Broadcast to clients │
                                       └───────────┬─────────────┘
                                                   │ Debounced save
                                                   │ (2s) or on
                                                   │ last disconnect
                                                   ▼
                                       ┌─────────────────────────┐
                                       │   Cloudflare KV         │
                                       │   - Persistent storage  │
                                       │   - 30-day TTL          │
                                       └─────────────────────────┘
```

---

## Lesson 1: Duplicate Track IDs Cause Corruption

**Date:** 2024-12 (Phase 11)

### The Bug
A session ended up with 16 tracks: 1 Bass + 15 duplicate Rhodes tracks, all with the same track ID.

### Root Cause
The `handleAddTrack` method in the Durable Object didn't check for duplicate track IDs before adding. When rapid client-side actions (or reconnections) sent multiple `add_track` messages with the same ID, all were blindly appended.

### Fix
Added duplicate ID check to both:
1. **DO (`live-session.ts:456`):**
   ```typescript
   if (this.state.tracks.some(t => t.id === msg.track.id)) {
     console.log(`[WS] Ignoring duplicate track: ${msg.track.id}`);
     return;
   }
   ```

2. **Frontend reducer (`grid.tsx:146`):**
   ```typescript
   if (state.tracks.some(t => t.id === newTrack.id)) {
     return state;
   }
   ```

### Lesson
**Defense in depth:** Validate at both server (DO) and client (reducer). The server is the authoritative check, but client-side validation prevents unnecessary network traffic and provides faster feedback.

---

## Lesson 2: KV and DO State Can Diverge

**Date:** 2024-12 (Phase 11)

### The Bug
After fixing duplicate tracks via WebSocket, the KV still showed corrupted state with 16 tracks while the DO had the correct 2 tracks.

### Root Cause
The DO saves to KV via:
1. **Debounced save (2 seconds)** - after any state change
2. **Immediate save** - when the last player disconnects

The debounced save hadn't fired yet when we checked KV.

### State Sync Flow
```
State Change → scheduleKVSave() → setTimeout(2000ms) → saveToKV()
                    │
                    └── If DO hibernates before timeout: SAVE IS LOST
```

### Fix
Triggered a state change (toggled a step) to force the debounce timer to fire, which synced KV with DO.

### Lesson
**Debouncing is a trade-off:** Reduces KV writes but creates a window where DO and KV diverge. For critical operations, consider:
- Immediate saves for structural changes (add/delete track)
- Debounced saves for frequent changes (step toggles, volume)

---

## Lesson 3: DO Hibernation Breaks setTimeout

**Date:** 2024-12 (Phase 11)

### The Problem
Durable Objects use the **Hibernation API** for cost efficiency. When all WebSocket connections are idle, the DO can hibernate (be evicted from memory).

**Critical issue:** `setTimeout` does NOT survive hibernation.

### Impact
```
1. User makes change → scheduleKVSave() starts 2s timer
2. User goes idle → DO hibernates after ~10s inactivity
3. Timer is lost → KV never saved
4. User reconnects → DO loads stale state from KV
```

### Mitigation Strategies

1. **Save on disconnect (implemented):**
   ```typescript
   async webSocketClose(ws, code, reason, wasClean) {
     // ...
     if (this.players.size === 0 && this.state && this.sessionId) {
       await this.saveToKV(); // Immediate save when last player leaves
     }
   }
   ```

2. **Use Durable Object Alarms (implemented - Phase 11):**
   Replaced `setTimeout` with `ctx.storage.setAlarm()`. Alarms persist across hibernation:
   ```typescript
   private scheduleKVSave(): void {
     this.pendingKVSave = true;
     // Alarms survive hibernation, unlike setTimeout
     this.ctx.storage.setAlarm(Date.now() + KV_SAVE_DEBOUNCE_MS).catch(e => {
       console.error('[KV] Error scheduling alarm:', e);
     });
   }

   async alarm(): Promise<void> {
     if (this.pendingKVSave) {
       await this.saveToKV();
       this.pendingKVSave = false;
     }
   }
   ```

3. **Periodic client-side sync requests:**
   Have clients periodically request state hash verification.

### Lesson
**Hibernation-aware design:** Any time-based operations in DOs must account for hibernation. Use Alarms for reliable scheduling, not setTimeout.

---

## Lesson 4: Browser Must Refresh to See KV Updates

**Date:** 2024-12 (Phase 11)

### The Observation
After KV was updated with correct state, the open browser tab still showed old state (1 track instead of 2).

### Explanation
The browser connects via WebSocket to the DO. If the DO is still running with old in-memory state, that's what's served. Only when:
1. DO hibernates (no connections), AND
2. Browser reconnects (refresh or new tab)

...does the DO reload from KV.

### The Flow
```
Browser Tab Open (showing old state)
         │
         │ (WebSocket connected to DO with old state)
         │
         ▼
    DO in Memory ──── Old State (1 track)
         │
         │ (Meanwhile, KV was updated externally)
         │
         ▼
       KV Store ────── New State (2 tracks)
         │
         │ (User refreshes browser)
         │
         ▼
    DO loads from KV → New State (2 tracks) → Browser shows 2 tracks
```

### Lesson
**DO is the live source of truth** during active sessions. KV is only consulted when DO starts fresh (after hibernation or restart).

---

## Lesson 5: The DELETE Operation Pitfall

**Date:** 2024-12 (Phase 11)

### The Bug
When trying to delete 14 duplicate Rhodes tracks, all 15 Rhodes tracks were deleted (including the one we wanted to keep).

### Root Cause
All duplicate tracks had the same ID. The delete operation:
```typescript
const index = this.state.tracks.findIndex(t => t.id === trackId);
this.state.tracks.splice(index, 1);
```

This only removes one at a time, but we sent 14 delete messages, each finding the "first" Rhodes track.

### Lesson
**Unique IDs are fundamental:** Track IDs must be unique. Operations that assume uniqueness will behave unexpectedly when duplicates exist. Always validate uniqueness at creation time.

---

## Cloudflare Component Interactions

### Durable Objects (DO)

| Aspect | Behavior |
|--------|----------|
| **State** | In-memory, lost on hibernation unless explicitly saved |
| **Hibernation** | Automatic after idle period; setTimeout/setInterval are cleared |
| **WebSockets** | Use Hibernation API with `acceptWebSocket()` for efficient handling |
| **Persistence** | Must explicitly save to KV/R2/SQLite; nothing automatic |
| **Geographic** | Created near first user, stays there (doesn't migrate) |
| **Alarms** | Survive hibernation; use for scheduled tasks |

### KV (Key-Value Store)

| Aspect | Behavior |
|--------|----------|
| **Consistency** | Eventually consistent (can take up to 60s to propagate globally) |
| **Read Performance** | Very fast (edge-cached) |
| **Write Performance** | Slower than DO; avoid frequent writes |
| **TTL** | Can set expiration; we use 30 days |
| **Size Limit** | 25 MB per value |

### Best Practices for KV ↔ DO Sync

1. **DO is authoritative during active sessions**
2. **KV is the persistence layer for inactive sessions**
3. **Debounce frequent writes to KV** (2s minimum)
4. **Always save on last disconnect**
5. **Consider state versioning** for conflict detection
6. **Use state hashing** to detect divergence

---

## Testing Multiplayer Systems

### Key Test Scenarios

Based on ultrathink analysis:

1. **Concurrency Stress:**
   - 10 simultaneous users toggling same step
   - Rapid-fire tempo changes from multiple clients
   - High message volume (100+ messages in quick succession)

2. **Race Conditions:**
   - Two users adding track with same ID simultaneously
   - Delete + modify race condition
   - Concurrent mute/solo toggles

3. **State Synchronization:**
   - KV debounce timing verification
   - Hibernation and wake-up cycles
   - Client reconnection with stale state

4. **Edge Cases:**
   - Network partition (client can't reach server)
   - Client disconnect mid-operation
   - Maximum player limit (10)
   - Invalid/malformed messages

5. **Chaos Engineering:**
   - Random disconnection during operations
   - Message reordering/dropping simulation
   - State corruption detection

### Invariants That Must ALWAYS Hold

```typescript
// No duplicate track IDs
const trackIds = state.tracks.map(t => t.id);
assert(new Set(trackIds).size === trackIds.length);

// Track count within limit
assert(state.tracks.length <= 16);

// Tempo within bounds
assert(state.tempo >= 30 && state.tempo <= 300);

// All tracks have correct array sizes
state.tracks.forEach(t => {
  assert(t.steps.length === 64);
  assert(t.parameterLocks.length === 64);
});
```

---

## Future Considerations

### Conflict Resolution

Currently using "last write wins" which can lose data in race conditions. Consider:
- **Operational Transformation (OT):** Track intentions, transform conflicts
- **CRDTs:** Conflict-free replicated data types for automatic merging
- **Optimistic locking:** Version numbers to detect conflicts

### Clock Synchronization

For synchronized audio playback across clients:
- Implement clock offset calculation using RTT/2 approximation
- Use server time as reference for playback start
- Consider Web Audio API's `currentTime` for precise local scheduling

### State Recovery (Implemented - Phase 11)

State corruption detection and auto-repair are now implemented:

1. **Invariant validation module (`invariants.ts`):**
   - `validateStateInvariants()` - checks all state invariants
   - `logInvariantStatus()` - logs violations to Cloudflare logs
   - `repairStateInvariants()` - auto-repairs when possible

2. **Validation points in DO:**
   - `loadFromKV` - validates state loaded from KV
   - `handleAddTrack` - validates after adding track
   - `handleDeleteTrack` - validates after deletion
   - `handleClearTrack` - validates after clearing

3. **Log output format:**
   ```
   [INVARIANT VIOLATION][handleAddTrack] session=abc-123 { violations: [...], trackCount: 16, trackIds: [...] }
   [INVARIANT] Auto-repaired state for session=abc-123 { repairs: [...] }
   ```

4. **Monitoring via `wrangler tail`:**
   - Use `npx wrangler tail --format=pretty` to monitor live logs
   - Filter for `[INVARIANT]` prefix to see corruption events

---

## Lesson 6: Reconnection Needs Jitter

**Date:** 2024-12 (Phase 12)

### The Problem

When a server goes down and comes back up, all disconnected clients try to reconnect at exactly the same time. This "thundering herd" can:
- Overwhelm the server immediately after recovery
- Cause cascading failures
- Result in poor user experience as connections are rejected

### The Solution

**Exponential backoff with jitter:**

```typescript
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_JITTER = 0.25; // ±25%

function calculateReconnectDelay(attempt: number): number {
  // Exponential: 1s, 2s, 4s, 8s, 16s, 30s (capped)
  const exponentialDelay = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
    RECONNECT_MAX_DELAY_MS
  );

  // Jitter: ±25% randomization
  const jitterRange = exponentialDelay * RECONNECT_JITTER;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(exponentialDelay + jitter);
}
```

### Why ±25% Jitter?

- **Too little jitter (±5%):** Clients still cluster together
- **Too much jitter (±50%):** Some clients wait unnecessarily long
- **±25% is a good balance:** Spreads reconnections while keeping wait times reasonable

### Lesson

**Always add jitter to retry logic.** The exponential backoff alone isn't enough — without jitter, all clients with the same retry count will reconnect simultaneously.

---

## Lesson 7: Offline Queues Need Limits

**Date:** 2024-12 (Phase 12)

### The Problem

When disconnected, users may continue editing. Naively queueing all changes can:
- Consume unbounded memory
- Replay stale/conflicting changes on reconnect
- Cause confusing state after long disconnections

### The Solution

**Bounded queue with age limits:**

```typescript
private maxQueueSize: number = 100;
private maxQueueAge: number = 30000; // 30 seconds

private queueMessage(message: ClientMessage): void {
  // Don't queue time-sensitive messages
  if (message.type === 'clock_sync_request' || message.type === 'state_hash') {
    return;
  }

  // Drop oldest if full
  if (this.offlineQueue.length >= this.maxQueueSize) {
    this.offlineQueue.shift();
  }

  this.offlineQueue.push({
    message,
    timestamp: Date.now(),
  });
}

private replayQueuedMessages(): void {
  const now = Date.now();
  for (const queued of this.offlineQueue) {
    // Skip stale messages
    if (now - queued.timestamp > this.maxQueueAge) continue;
    this.ws.send(JSON.stringify(queued.message));
  }
  this.offlineQueue = [];
}
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Queue size limit | 100 messages | Reasonable for ~30s of editing |
| Message age limit | 30 seconds | Old changes likely conflict with server state |
| What to queue | State changes only | Skip clock sync, state hash requests |
| When to queue | Only during 'connecting' | Fresh state on new connection anyway |

### Lesson

**Offline queues need boundaries.** Define max size, max age, and which message types to queue. After long disconnections, sync fresh state rather than replaying potentially conflicting changes.

---

## Lesson 8: Connection Status Must Be Visible

**Date:** 2024-12 (Phase 12)

### The Problem

Users can't tell if:
- Their changes are being saved
- They're working in single-player mode
- Reconnection is happening

This leads to confusion and lost work when they think they're connected but aren't.

### The Solution

**Visual connection indicator with states:**

```
┌──────────────────────────┐
│ ● Connected              │  (green, solid)
│ ● Connecting...          │  (yellow, pulsing)
│ ● Reconnecting (3)...    │  (yellow, shows attempt count)
│ ● Offline                │  (red)
│ ● Offline (5 queued)     │  (red, shows pending changes)
└──────────────────────────┘
```

### State Transitions

```
disconnected ──connect()──► connecting ──snapshot──► connected
     ▲                           │                       │
     │                           │                       │
     └─────── max retries ◄──────┴──── close/error ◄────┘
                  (removed in Phase 12 - keep trying)
```

### Lesson

**Make connection state obvious.** Users need to know:
1. Current status (connected/connecting/offline)
2. Reconnection progress (attempt count)
3. Pending changes (queue size)

---

## Phase 12: Error Handling Summary

### Implemented Features

1. **Exponential Backoff + Jitter**
   - Base delay: 1s, max: 30s
   - ±25% jitter to prevent thundering herd
   - No max attempts (keep trying indefinitely)

2. **Offline Queue**
   - Max 100 messages
   - Max 30 second age
   - Skips time-sensitive messages
   - Replays on reconnect after snapshot

3. **Connection Status Indicator**
   - Visual dot (green/yellow/red)
   - Status text with reconnect count
   - Queue size display

4. **Graceful Degradation**
   - Local dispatch always works
   - KV sync continues via session layer
   - Changes replay on reconnect

### Files Modified

| File | Changes |
|------|---------|
| `src/sync/multiplayer.ts` | Added jitter, queue, status state |
| `src/hooks/useMultiplayer.ts` | Exposed reconnect state |
| `src/components/ConnectionStatus.tsx` | New component |
| `src/components/ConnectionStatus.css` | New styles |
| `src/App.tsx` | Added ConnectionStatus to header |
| `src/sync/multiplayer.test.ts` | 13 new tests |

---

## References

- [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [Hibernation API Guide](https://developers.cloudflare.com/durable-objects/reference/websockets/)
- [KV Documentation](https://developers.cloudflare.com/kv/)
- [Durable Objects Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Exponential Backoff And Jitter (AWS)](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
