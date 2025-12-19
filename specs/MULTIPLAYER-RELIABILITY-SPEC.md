# Multiplayer Reliability Specification

> Audit of message syncing bugs and missing tests for multiplayer reliability.
> Generated from comprehensive code review, December 2025.

## Priority Summary

| Priority | Count | Description |
|----------|-------|-------------|
| P0 | 3 | Critical bugs and tests blocking reliable sync |
| P1 | 4 | High-impact bugs causing data loss or missing coverage |
| P2 | 5 | Medium-priority gaps in observability and testing |
| P3 | 4 | Low-priority edge cases and nice-to-have tests |

---

## Part 1: Bugs in Message Syncing

### BUG-01: clientSeq Echo Not Used for Delivery Confirmation
**Priority:** P0 (Critical)
**Location:** `src/sync/multiplayer.ts:862-875`

The `clientSeq` field was designed for delivery confirmation but is completely ignored by the client. The server echoes back `clientSeq` in broadcasts (see `live-session.ts:1007-1013`), but the client never checks this to confirm mutation delivery.

**Root Cause:** Phase 13B infrastructure was built but the connection was never completed.

```typescript
// Server sends this (working):
{ type: 'step_toggled', clientSeq: 42, ... }

// Client receives it but IGNORES clientSeq (BUG):
if (msg.seq !== undefined) {
  // Checks SERVER seq for ordering...
  // But never reads msg.clientSeq for confirmation!
}
```

**Impact:** Silent mutation loss. Users can toggle steps that appear to work locally but never reach the server.

**Fix:** Implement `clientSeq` matching in message handler to confirm mutations and update `TrackedMutation` state.

---

### BUG-02: ack Field Sent But Never Read Server-Side
**Priority:** P2
**Location:** `src/sync/multiplayer.ts:566` (client sends), `src/worker/live-session.ts` (server ignores)

The client sends `ack: this.lastServerSeq` with every message, but the server never reads it. This was designed to let the server detect when clients are falling behind.

**Impact:** Server cannot detect client message gaps. No proactive snapshot push when client is behind.

**Fix:** Add server-side `ack` field parsing and implement gap detection logic.

---

### BUG-03: outOfOrderCount Tracked But Not Surfaced
**Priority:** P2
**Location:** `src/sync/multiplayer.ts:478, 867`

Out-of-order messages are counted but:
- Not displayed in the UI
- Not used to trigger reconnection
- Not logged to observability

```typescript
if (msg.seq > expectedSeq) {
  this.outOfOrderCount++;  // Counted...
  logger.ws.warn(...);      // ...logged locally...
  // But never triggers recovery!
}
```

**Impact:** Connection degradation goes undetected until state divergence occurs.

**Fix:** Surface `outOfOrderCount` in debug overlay and add threshold-based reconnection trigger.

---

### BUG-04: Snapshot Overwrites Pending Local Mutations
**Priority:** P1 (High)
**Location:** `src/sync/multiplayer.ts:1140-1200` (`handleSnapshot`)

When a snapshot arrives, it replaces the entire local state without checking for pending unconfirmed mutations. If a user toggled steps that weren't confirmed before the snapshot, those edits are lost.

```typescript
private handleSnapshot(msg: SnapshotMessage): void {
  // Replaces entire state - no check for pending mutations
  this.dispatch({ type: 'LOAD_SESSION', payload: normalizedState });
}
```

**Impact:** Work loss after reconnection.

**Related Spec:** `MUTATION-TRACKING.md` was written to address this but implementation appears incomplete.

**Fix:** Before applying snapshot, compare pending mutations against snapshot state and preserve valid pending edits.

---

### BUG-05: Missing Mutation Type Classification for set_effects
**Priority:** P2
**Location:** `src/worker/types.ts`, `test/unit/mutation-types.test.ts`

The `set_effects` and `set_fm_params` message types were added in Phases 23-25. While `MUTATING_MESSAGE_TYPES` in `worker/types.ts` correctly includes them, the mutation tracking logic in `multiplayer.ts` may not track them because `trackMutation()` only handles specific types.

**Impact:** Effects and FM param changes may not be tracked for delivery confirmation.

**Fix:** Audit `trackMutation()` to ensure all `MUTATING_MESSAGE_TYPES` are covered.

---

### BUG-06: Stale Session Detection Triggers Reconnect Loop
**Priority:** P3
**Location:** `src/sync/multiplayer.ts:1554-1575`

When a stale session is detected, the code requests a snapshot and may trigger reconnection. If the session is genuinely stale (DO evicted), this causes:
- Multiple reconnection attempts
- Conflicting snapshots
- Race between local queue replay and incoming snapshot

**Fix:** Add state machine to prevent concurrent recovery operations.

---

### BUG-07: Clock Sync RTT Samples Not Bounded
**Priority:** P3
**Location:** `src/sync/multiplayer.ts:325-452`

The clock sync keeps RTT samples but doesn't bound the array:

```typescript
private clockSyncSamples: number[] = [];
// No limit on array size
```

With periodic syncs every 5 seconds, this could grow indefinitely in long sessions.

**Fix:** Implement ring buffer with max size (e.g., 100 samples).

---

### BUG-08: Connection Storm Detection Threshold is Arbitrary
**Priority:** P3
**Location:** `src/sync/multiplayer.ts:517-545`

The connection storm detection uses a hardcoded 10-connection-per-minute threshold with no dynamic adjustment:

```typescript
const connectionsPerMinute = count / ((now - windowStart) / 60000);
if (connectionsPerMinute > 10) {
  // Storm detected
}
```

**Impact:** May be too sensitive or insensitive depending on network conditions.

**Fix:** Consider adaptive thresholds or make configurable.

---

### BUG-09: Track Deletion Race Condition
**Priority:** P3
**Location:** `src/worker/live-session.ts` (`handleDeleteTrack`)

If two clients simultaneously try to delete the same track, the server broadcasts two `track_deleted` messages. The second client to process will fail to find the track and may log an error, causing temporary state divergence.

**Fix:** Add idempotency check - ignore deletion if track already deleted.

---

### BUG-10: Parameter Lock Validation Gap
**Priority:** P3
**Location:** `src/worker/live-session.ts:handleSetParameterLock`

Parameter locks accept arbitrary objects without full validation:

```typescript
// Only validates step bounds, not lock contents
```

**Impact:** A malformed parameter lock could cause issues in the audio engine.

**Fix:** Add schema validation for lock contents.

---

## Part 2: Missing Tests for Multiplayer Reliability

### TEST-01: Mutation Tracking State Machine
**Priority:** P0 (Critical)

The `MUTATION-TRACKING.md` spec defines a complete state machine but no tests exist for it.

```typescript
describe('TrackedMutation state machine', () => {
  describe('PENDING -> CONFIRMED', () => { /* clientSeq echo */ });
  describe('PENDING -> SUPERSEDED', () => { /* other player edits */ });
  describe('PENDING -> LOST', () => { /* snapshot contradicts */ });
  describe('Timeout', () => { /* 30s without confirmation */ });
});
```

**File:** `test/unit/mutation-tracking.test.ts` (to create)

---

### TEST-02: Multi-Client Concurrent Edits
**Priority:** P0 (Critical)

No E2E test for:
- Two clients editing the same step simultaneously
- Three+ clients making rapid edits
- Edit order preservation across clients

```typescript
// Needed: e2e/concurrent-edits.spec.ts
test('two clients editing same step resolves to last-write-wins', async () => {
  // Client A toggles step 5 ON
  // Client B toggles step 5 OFF (simultaneously)
  // Both should converge to same state
});
```

**File:** `e2e/concurrent-edits.spec.ts` (to create)

---

### TEST-03: Offline Queue Behavior
**Priority:** P1 (High)

No tests for:
- Queue priority ordering (high > normal > low)
- Queue size limits (100 messages)
- Queue age limits (30 seconds)
- Queue replay order after reconnection
- Queue behavior when reconnection fails

```typescript
describe('Offline queue', () => {
  test('respects priority ordering');
  test('enforces max queue size');
  test('drops messages older than 30s');
  test('replays in correct order on reconnect');
});
```

**File:** `test/unit/offline-queue.test.ts` (to create)

---

### TEST-04: State Hash Mismatch Recovery
**Priority:** P1 (High)

The hash verification triggers snapshot recovery, but no test verifies:
- Correct hash calculation on both sides
- Recovery actually restores correct state
- Consecutive mismatch handling
- UI notification of recovery

```typescript
describe('State hash recovery', () => {
  test('detects hash mismatch after mutation');
  test('recovers by requesting snapshot');
  test('limits consecutive recovery attempts');
});
```

**File:** `test/unit/state-hash-recovery.test.ts` (to create)

---

### TEST-05: WebSocket Reconnection Scenarios
**Priority:** P1 (High)

Current `connection-storm.spec.ts` tests prevention, but not:
- Reconnection after server restart
- Reconnection after network change (WiFi -> cellular)
- Reconnection with queued messages
- Reconnection timeout and fallback to single-player

```typescript
describe('Reconnection scenarios', () => {
  test('reconnects after server restart');
  test('replays queue after reconnect');
  test('falls back to single-player after max attempts');
});
```

**File:** `test/unit/reconnection-scenarios.test.ts` (to create)

---

### TEST-06: Clock Sync Accuracy
**Priority:** P2

No tests for:
- Clock offset calculation accuracy
- RTT measurement with simulated latency
- Clock sync during high-latency conditions
- Clock sync recovery after network issues

```typescript
describe('Clock synchronization', () => {
  test('calculates accurate offset with known latency');
  test('handles variable latency gracefully');
  test('95th percentile RTT calculation');
});
```

**File:** `test/unit/clock-sync.test.ts` (to create)

---

### TEST-07: Message Ordering Verification
**Priority:** P2

No tests for:
- Sequence number gaps detection
- Out-of-order message handling
- Sequence number wraparound (unlikely but possible)

```typescript
describe('Message ordering', () => {
  test('detects sequence number gap');
  test('handles out-of-order messages');
  test('increments outOfOrderCount correctly');
});
```

**File:** `test/unit/message-ordering.test.ts` (to create)

---

### TEST-08: Published Session WebSocket Blocking
**Priority:** P2

Tests exist for HTTP blocking on published sessions, but no WebSocket tests:

```typescript
describe('Published session WebSocket', () => {
  test('blocks mutation messages on published session');
  test('allows read-only messages on published session');
  test('returns appropriate error for blocked mutations');
});
```

**File:** `test/unit/published-session-ws.test.ts` (to create)

---

### TEST-09: Player Join/Leave Synchronization
**Priority:** P2

No tests for:
- Player list updates on join
- Player list updates on leave
- Cursor position cleanup on leave
- Graceful handling of orphaned player data

```typescript
describe('Player lifecycle', () => {
  test('broadcasts player_joined to all clients');
  test('cleans up cursor on player_left');
  test('handles rapid join/leave cycles');
});
```

**File:** `test/unit/player-lifecycle.test.ts` (to create)

---

### TEST-10: Effects and FM Params Sync Parity
**Priority:** P2

Tests exist for basic sync but not for:
- Complex nested effects state
- FM params with all parameters
- Round-trip serialization of effects

```typescript
describe('Effects sync parity', () => {
  test('syncs all reverb parameters');
  test('syncs all delay parameters');
  test('syncs FM params with correct types');
  test('hash matches after effects change');
});
```

**File:** `test/unit/effects-sync-parity.test.ts` (to create)

---

### TEST-11: Invariant Violation Detection and Repair
**Priority:** P3

`invariants.ts` has repair logic but no tests for:
- Repair of duplicate track IDs
- Repair of out-of-bounds values
- Repair logging

```typescript
describe('Invariant repair', () => {
  test('removes duplicate track IDs');
  test('clamps out-of-bounds tempo');
  test('pads short step arrays');
  test('logs all repairs');
});
```

**File:** `test/unit/invariant-repair.test.ts` (to create)

---

### TEST-12: Handler Factory Edge Cases
**Priority:** P3

Factory tests exist but don't cover:
- Handler with null WebSocket
- Handler with disconnected player
- Handler with malformed message

**File:** Extend `test/unit/handler-factory.test.ts`

---

## Part 3: Testing Infrastructure Gaps

### GAP-01: No Mock WebSocket for Unit Tests

The `multiplayer.test.ts` file doesn't have a proper mock WebSocket that simulates:
- Message delays
- Connection drops
- Partial message delivery
- Out-of-order delivery

**Recommendation:** Create `test/mocks/MockWebSocket.ts` with configurable behaviors.

---

### GAP-02: No Integration Test for Full Round-Trip

No test sends a mutation from Client A -> Server -> Client B and verifies:
- Same state on both clients
- Same hash on both clients
- Timing within acceptable bounds

**Recommendation:** Create `test/integration/full-round-trip.test.ts`.

---

### GAP-03: No Chaos Testing

No tests simulate:
- Random message drops
- Random connection failures
- Random latency spikes
- Server restarts during active session

**Recommendation:** Implement chaos testing framework or use existing tools like `toxiproxy`.

---

### GAP-04: No Performance Benchmarks

No tests measure:
- Latency from click to broadcast received
- Throughput of mutations per second
- Memory growth over long sessions
- Connection stability over hours

**Recommendation:** Create `test/benchmarks/` directory with performance test suite.

---

## Implementation Checklist

### Phase 1: P0 Critical Fixes
- [ ] BUG-01: Implement `clientSeq` confirmation in message handler
- [ ] TEST-01: Create mutation tracking state machine tests
- [ ] TEST-02: Create multi-client concurrent edit E2E tests

### Phase 2: P1 High Priority
- [ ] BUG-04: Preserve pending mutations during snapshot application
- [ ] TEST-03: Create offline queue behavior tests
- [ ] TEST-04: Create state hash recovery tests
- [ ] TEST-05: Create WebSocket reconnection scenario tests

### Phase 3: P2 Medium Priority
- [ ] BUG-02: Implement server-side `ack` field reading
- [ ] BUG-03: Surface `outOfOrderCount` in debug overlay
- [ ] BUG-05: Audit mutation type classification
- [ ] TEST-06: Create clock sync accuracy tests
- [ ] TEST-07: Create message ordering tests
- [ ] TEST-08: Create published session WebSocket tests
- [ ] TEST-09: Create player lifecycle tests
- [ ] TEST-10: Create effects sync parity tests

### Phase 4: P3 Low Priority
- [ ] BUG-06: Add recovery state machine
- [ ] BUG-07: Bound clock sync RTT samples array
- [ ] BUG-08: Consider adaptive connection storm thresholds
- [ ] BUG-09: Add track deletion idempotency
- [ ] BUG-10: Add parameter lock schema validation
- [ ] TEST-11: Create invariant repair tests
- [ ] TEST-12: Add handler factory edge case tests

### Infrastructure
- [ ] GAP-01: Create `MockWebSocket` test utility
- [ ] GAP-02: Create full round-trip integration test
- [ ] GAP-03: Evaluate chaos testing options
- [ ] GAP-04: Create performance benchmark suite

---

## Related Documentation

- `specs/MUTATION-TRACKING.md` - Mutation tracking state machine spec
- `specs/SYNC-ABSTRACTIONS.md` - Sync layer architecture
- `docs/MULTIPLAYER-SYNC.md` - Multiplayer sync documentation
- `specs/research/PHASE-13B-LESSONS.md` - Phase 13B lessons learned
