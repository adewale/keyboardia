# Root Cause Analysis: Why Pattern Operations Have No Sync

**Date**: 2026-01-04
**Bug**: Pattern operations (ROTATE, INVERT, REVERSE, MIRROR, EUCLIDEAN) don't sync to server

## The Smoking Gun

In `app/test/unit/sync-classification.test.ts:250-264`:

```typescript
// Special cases: actions classified as synced but with pending wire implementation
// or non-standard send patterns. These still pass compile-time exhaustiveness check.
const specialCases = new Set([
  'ADD_TRACK',         // Uses sendAddTrack separately
  // Pattern manipulation - classified as synced, wire implementation pending
  'SET_TRACK_NAME',    // Phase 31D: Pending implementation
  'ROTATE_PATTERN',    // Phase 31B: Pending implementation
  'INVERT_PATTERN',    // Phase 31B: Pending implementation
  'REVERSE_PATTERN',   // Phase 31B: Pending implementation
  'MIRROR_PATTERN',    // Phase 31B: Pending implementation
  'EUCLIDEAN_FILL',    // Phase 31B: Pending implementation
  ...
]);
```

**The test explicitly skips pattern operations with a "pending implementation" comment.**

All tests pass (2900+), but the sync is broken because the verification was deliberately bypassed.

---

## How Did This Happen?

### Phase 31B Implementation (Pattern Manipulation)

The feature was implemented in layers, each tested in isolation:

| Layer | What Was Done | Test Coverage |
|-------|---------------|---------------|
| **Pure functions** | `patternOps.ts` - rotate, invert, reverse, mirror, euclidean | 394 lines of tests + property tests |
| **Client reducer** | `gridReducer` - ROTATE_PATTERN, etc. action handlers | Covered by reducer tests |
| **Sync classification** | Listed in `SYNCED_ACTIONS` | TypeScript exhaustiveness check |
| **actionToMessage** | **NOT IMPLEMENTED** | Test skipped with "pending" |
| **Server handlers** | **NOT IMPLEMENTED** | No test exists |

### The Testing Gap

```
Layer 1: patternOps.ts          ✅ Tested (pure functions)
Layer 2: gridReducer            ✅ Tested (reducer)
Layer 3: sync-classification    ✅ Design document says "sync"
Layer 4: actionToMessage        ❌ Returns null (test skipped!)
Layer 5: live-session.ts        ❌ No handlers (no test!)
Layer 6: Integration            ❌ No test for round-trip
```

---

## Root Causes

### 1. Layer Isolation Without Integration Tests

Each layer was tested in isolation:
- `patternOps.test.ts` - Tests pure functions work
- `patternOps.property.test.ts` - Tests algebraic properties
- `grid.test.ts` - Tests reducer handles actions
- `sync-classification.test.ts` - Tests classification is complete

**Missing**: Integration test that verifies client mutation → server handler → broadcast → client update.

### 2. "Pending" Comments Without Enforcement

The test comment says "pending implementation" but:
- No GitHub issue tracks this work
- No failing test enforces completion
- No TODO in code references this gap
- No follow-up task was created

**"Pending" became "forgotten".**

### 3. Tests That Pass When They Should Fail

The sync-classification test is designed to verify:
> "SYNCED_ACTIONS should produce messages from actionToMessage()"

But it explicitly skips pattern operations:
```typescript
if (specialCases.has(actionType)) continue;  // ← Skip the check!
```

A better design would be to **fail the test** with a message like:
> "ROTATE_PATTERN is in SYNCED_ACTIONS but actionToMessage returns null. Either implement sync or move to LOCAL_ONLY_ACTIONS."

### 4. No Property Test for Sync Coverage

The property-based tests (`patternOps.property.test.ts`) test that:
- Rotate left then right is identity
- Double invert is identity
- Euclidean produces k hits

**Missing property**: "Every SYNCED_ACTION mutation applied on client produces same state on server."

### 5. Design Document vs Implementation Divergence

`sync-classification.ts` is supposed to be the source of truth:
```typescript
/**
 * SYNCED_ACTIONS: Actions that modify shared state and must sync to server.
 * ...
 */
export const SYNCED_ACTIONS = new Set([
  // ...
  'ROTATE_PATTERN',   // Grid edit - shared
  'INVERT_PATTERN',   // Grid edit - shared
  // ...
]);
```

But the implementation (`actionToMessage`) returns null for these. **The design document and implementation diverged, and no automated check caught it.**

---

## Timeline Reconstruction

1. **Phase 31B planned**: Pattern manipulation added to spec
2. **Pure functions implemented**: `patternOps.ts` with extensive tests
3. **Reducer implemented**: Actions handled locally with tests
4. **Sync classification updated**: Actions listed in SYNCED_ACTIONS
5. **Test written with skip**: "Pending implementation" added to specialCases
6. **Phase 31B marked complete**: All tests pass!
7. **Bug ships to users**: Pattern changes lost on snapshot

---

## Why PBT Didn't Catch This

The property-based tests we wrote in Phase 32 tested:
- **State convergence**: Same mutations → same state
- **Commutativity**: Independent mutations can reorder
- **Reconnection**: State correct after snapshot

But they tested using `applyMutation` from `state-mutations.ts`, which is a **pure function**. They didn't test:
- Whether `actionToMessage` maps actions to messages
- Whether server handlers exist
- Whether broadcast handlers update client state

**PBT tested the wrong layer.** It tested the shared mutation logic (which works), not the sync plumbing (which is broken).

---

## Systemic Issues

| Issue | Description |
|-------|-------------|
| **Layer isolation** | Each layer tested alone, no end-to-end |
| **Skip patterns in tests** | "Pending" cases bypass verification |
| **No sync round-trip test** | Client → server → client never verified |
| **Design/implementation gap** | SYNCED_ACTIONS vs actionToMessage diverged |
| **Insufficient PBT scope** | PBT tested pure functions, not sync layer |

---

## Recommended Fixes

### 1. Remove "Pending" Skip Pattern

Change the test from:
```typescript
if (specialCases.has(actionType)) continue;  // Skip
```

To:
```typescript
if (specialCases.has(actionType)) {
  // These are known-incomplete. Fail explicitly so we fix them.
  throw new Error(
    `${actionType} is in SYNCED_ACTIONS but sync is not implemented. ` +
    `Either implement sync or move to LOCAL_ONLY_ACTIONS.`
  );
}
```

### 2. Add Integration Test

```typescript
describe('Sync Round-Trip', () => {
  for (const actionType of SYNCED_ACTIONS) {
    it(`${actionType}: client mutation syncs to server and back`, async () => {
      // 1. Apply action locally
      // 2. Get message from actionToMessage
      // 3. Send to mock server handler
      // 4. Get broadcast message
      // 5. Apply broadcast to fresh client
      // 6. Compare states with canonicalEqual
    });
  }
});
```

### 3. Add PBT for Sync Coverage

```typescript
it('SC-008: every SYNCED_ACTION has message and handler', () => {
  fc.assert(fc.property(arbSyncedAction, (actionType) => {
    const action = createMockAction(actionType);
    const message = actionToMessage(action);

    // Must produce a message
    expect(message).not.toBeNull();

    // Message type must have a server handler
    expect(serverHandlers).toContain(`handle${pascalCase(message.type)}`);
  }));
});
```

### 4. Make Classification Self-Enforcing

```typescript
// In sync-classification.ts
// Add compile-time check that every SYNCED_ACTION has a message type
type SyncedActionMessages = {
  [K in typeof SYNCED_ACTIONS[number]]: ClientMessageType;
};

// This will fail to compile if any action is missing a message mapping
const ACTION_TO_MESSAGE: SyncedActionMessages = {
  TOGGLE_STEP: 'toggle_step',
  SET_TEMPO: 'set_tempo',
  ROTATE_PATTERN: 'rotate_pattern', // Must add or compilation fails
  // ...
};
```

---

## Lessons Learned

1. **"Pending" comments are technical debt** - Track them as issues or failing tests
2. **Integration tests are essential** - Layer isolation misses cross-layer bugs
3. **Design documents need enforcement** - Automated checks, not just documentation
4. **PBT must test the right layer** - Pure function tests don't catch sync bugs
5. **Skipping tests is dangerous** - Better to fail explicitly than skip silently

---

## Applicable to Other Projects

This pattern of bugs is common in distributed systems:
- Client has logic for X
- Server is supposed to handle X
- No test verifies client→server→client round-trip
- Bug ships because each layer "works" in isolation

**The fix is always the same**: End-to-end integration tests that verify the complete data flow.
