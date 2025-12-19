# Integration Test Gaps: What We Didn't Test

> Created: 2025-12-19
> Context: 82 integration tests pass against staging, but user still sees sync bugs

## Summary

The staging integration tests validate the **WebSocket protocol and server logic** but do not test the **client-side state management** that actually renders the UI. The sync bugs are in the gap between "server sent correct message" and "user sees correct state."

---

## What The Tests Covered (Server Layer)

| Area | Test Coverage | Result |
|------|---------------|--------|
| WebSocket message sending/receiving | ✅ Full | 40 happy-path tests |
| Server state mutations | ✅ Full | All mutation types tested |
| Broadcast propagation | ✅ Full | 2-player and 5-player scenarios |
| Server validation/clamping | ✅ Full | All boundary conditions |
| Race conditions (server-side) | ✅ Full | Concurrent delete+toggle, rapid mutations |
| KV persistence | ✅ Partial | Debounced save works, but not initialization race |
| Error handling | ✅ Full | 42 failure mode tests |

## What The Tests Did NOT Cover (Client Layer)

### 1. MultiplayerConnection Class (`src/sync/multiplayer.ts`)

| Area | Gap | Risk |
|------|-----|------|
| `handleSnapshot` logic | Not tested with React state | Snapshot may regress confirmed state |
| `checkSnapshotRegression` | Only logs, doesn't prevent | Tracks disappear despite warning |
| `resetConfirmedState` | Wipes evidence after bad snapshot | Can't recover |
| Optimistic updates | Not tested | Local state may diverge from server |
| Pending mutation queue | Not tested | Mutations may be lost on reconnect |
| `confirmMutation` flow | Not tested | Unconfirmed mutations may be dropped |

### 2. React State Application

| Area | Gap | Risk |
|------|-----|------|
| `LOAD_STATE` reducer | Not tested with real multiplayer | May overwrite local changes |
| `isRemote` flag handling | Not tested | Remote vs local changes may conflict |
| Dispatch timing | Not tested | Race between local action and remote broadcast |

### 3. Reconnection Scenarios

| Scenario | Gap | Risk |
|----------|-----|------|
| Reconnect after disconnect | Not tested | May get stale snapshot from KV |
| State hash mismatch recovery | Not tested | Forced snapshot may regress state |
| DO hibernation wake-up | Not tested | DO may load stale KV state |
| Multiple rapid reconnects | Not tested | State may thrash |

### 4. Snapshot Source of Truth

| Scenario | Gap | Risk |
|----------|-----|------|
| DO initialization from KV | Not tested | KV may have stale data |
| Snapshot during active mutations | Not tested | Snapshot may miss in-flight changes |
| Snapshot after KV write but before propagation | Not tested | Eventual consistency window |

---

## The Specific Bug Path

```
1. Player A adds track "kick"
2. Server broadcasts track_added, saves to DO memory
3. KV save is debounced (5 second delay)
4. Player A disconnects (network blip)
5. Player A reconnects within 5 seconds
6. DO may have been evicted, reloads from KV
7. KV doesn't have "kick" yet (debounce not fired)
8. Player A receives snapshot WITHOUT "kick"
9. Client logs warning but applies snapshot anyway
10. Track disappears from UI
```

---

## Test Files Needed

### 1. Client State Machine Tests

```typescript
// test/unit/multiplayer-state-machine.test.ts
describe('MultiplayerConnection state machine', () => {
  it('rejects snapshot that regresses confirmed tracks');
  it('preserves pending mutations across reconnect');
  it('confirms mutations when server echoes clientSeq');
  it('requests resync after mutation invariant violation');
});
```

### 2. Reconnection Scenario Tests

```typescript
// test/integration/reconnection-scenarios.test.ts
describe('Reconnection scenarios', () => {
  it('preserves tracks added before disconnect');
  it('handles rapid disconnect/reconnect cycles');
  it('recovers from DO eviction with fresh KV load');
  it('merges pending mutations with snapshot on reconnect');
});
```

### 3. React Integration Tests

```typescript
// test/integration/react-multiplayer.test.ts
describe('React + Multiplayer integration', () => {
  it('LOAD_STATE preserves local pending changes');
  it('remote changes trigger correct re-renders');
  it('optimistic updates are rolled back on server rejection');
});
```

---

## Why Server Tests Passed But Bugs Exist

| Server Test Says | Reality |
|------------------|---------|
| "Broadcast sent correctly" | Client may not apply it correctly |
| "State is consistent on server" | Client state may diverge |
| "KV persistence works" | KV eventual consistency causes stale reads |
| "Race conditions resolve correctly" | Client-side races not tested |

---

## Recommendations

1. **Add client-side unit tests** for `MultiplayerConnection` state machine
2. **Add E2E tests** with real React app (Playwright)
3. **Fix the snapshot regression logic** to block or merge, not just log
4. **Fix the server** to ensure DO has latest state before sending snapshot

---

## Related Files

| File | Relevance |
|------|-----------|
| `src/sync/multiplayer.ts` | Client-side sync logic, main gap |
| `src/sync/multiplayer.test.ts` | Existing unit tests (may be incomplete) |
| `src/worker/live-session.ts` | Server-side DO, needs initialization fix |
| `specs/research/STALE-SNAPSHOT-FIX.md` | Server-side fix specification |
