# Shared Mutation Refactoring Plan

## Executive Summary

This plan outlines the refactoring of `gridReducer` (client) and `live-session.ts` handlers (server) to use a shared `state-mutations.ts` module. This ensures **identical mutation logic** across client and server, eliminating sync bugs caused by divergent implementations.

**Current State**: Two separate implementations that *should* produce identical results but have subtle differences.

**Target State**: One shared implementation used by both client and server, with separate handling only for side effects.

---

## Phase 0: Behavior Capture (Before Any Changes)

### 0.1 Create Golden Test Suite

Before refactoring, capture current behavior with comprehensive snapshot tests.

**File**: `app/src/test/golden-mutations.test.ts`

```typescript
// Test every mutation type against known inputs → expected outputs
// These tests will FAIL if we accidentally change behavior during refactoring
```

**Tests to Create**:
1. **State Snapshot Tests**: Apply each mutation to a known state, snapshot the result
2. **Edge Case Tests**: Empty state, max tracks, boundary values
3. **Round-Trip Tests**: Client mutation → server broadcast → client state

**Why**: If any golden test fails after refactoring, we've changed behavior. This is our safety net.

### 0.2 Integration Test for Client-Server Sync

**File**: `app/src/test/integration/client-server-sync.test.ts`

```typescript
// For each mutation type:
// 1. Apply mutation on client (gridReducer)
// 2. Simulate server receiving same message
// 3. Compare resulting states (using canonicalEqual)
```

**Current Differences to Document**:
| Mutation | Client | Server | Risk |
|----------|--------|--------|------|
| SET_TRACK_TRANSPOSE | No rounding | Math.round() | Sync drift |
| SET_TRACK_STEP_COUNT | Any value 1-128 | VALID_STEP_COUNTS_SET only | Rejected by server |
| SET_EFFECTS | No validation | Full clamping | Invalid values |
| SET_SCALE | No validation | Root note allowlist | Invalid values |
| SET_LOOP_REGION | Clamps to longestTrack | Clamps to MAX_STEPS | Different bounds |
| APPLY_TO_SELECTION | Merge locks | Merge + validate | Missing validation |
| Pattern ops (ROTATE, etc.) | Implemented | NOT IMPLEMENTED | No server sync |

---

## Phase 1: Align state-mutations.ts with Server (Authority)

The server is the source of truth. `state-mutations.ts` must match server behavior exactly.

### 1.1 Add Validation Functions

**File**: `app/src/shared/validation.ts` (new)

```typescript
// Move/consolidate validation from live-session.ts
export const VALID_STEP_COUNTS = [4, 6, 8, 12, 16, 24, 32] as const;
export const VALID_STEP_COUNTS_SET = new Set([...VALID_STEP_COUNTS, /* odd counts for polyrhythm */]);

export function validateEffects(effects: EffectsState): EffectsState {
  // Clamp all nested values (reverb.decay, wet values, etc.)
}

export function validateScale(scale: ScaleState): ScaleState | null {
  // Validate root note against allowlist
}

export function validateLoopRegion(region: LoopRegion | null, maxSteps: number): LoopRegion | null {
  // Normalize and clamp
}

export function validateParameterLock(lock: ParameterLock | null): ParameterLock | null {
  // Already exists in invariants.ts, move here
}
```

### 1.2 Update state-mutations.ts to Use Validation

```typescript
case 'set_track_step_count': {
  // Use VALID_STEP_COUNTS_SET instead of just clamping
  if (!VALID_STEP_COUNTS_SET.has(message.stepCount)) return state;
  // ... rest
}

case 'set_track_transpose': {
  // Add Math.round() to match server
  return { ...track, transpose: Math.round(clamp(message.transpose, MIN_TRANSPOSE, MAX_TRANSPOSE)) };
}

case 'set_effects': {
  // Validate effects before applying
  const validatedEffects = validateEffects(message.effects);
  return { ...state, effects: validatedEffects };
}

case 'set_scale': {
  // Validate scale before applying
  const validatedScale = validateScale(message.scale);
  if (!validatedScale) return state;
  return { ...state, scale: validatedScale };
}

case 'batch_set_parameter_locks': {
  // FIX: Merge locks instead of direct assignment
  const existingLock = parameterLocks[step];
  parameterLocks[step] = { ...existingLock, ...lock };
}
```

### 1.3 Add Pattern Operations to state-mutations.ts

Currently pattern operations (ROTATE, INVERT, REVERSE, MIRROR, EUCLIDEAN) are **client-only**. Decision needed:

**Option A**: Add to server (full sync)
- Pros: All changes visible to all players
- Cons: More server complexity

**Option B**: Document as local-only (current behavior)
- Pros: No server changes
- Cons: Pattern edits don't sync (acceptable for per-player experimentation)

**Recommendation**: Option B for now. Document pattern operations as local-only. They can be made syncable in a future phase if needed.

---

## Phase 2: Create Action-to-Message Adapter

The client uses `GridAction` types (UPPER_CASE), the server uses `ClientMessage` types (snake_case). We need an adapter layer.

### 2.1 Create Type Mapping

**File**: `app/src/shared/action-adapters.ts` (new)

```typescript
import type { GridAction } from '../types';
import type { ClientMessageBase } from './message-types';

/**
 * Convert a GridAction to a ClientMessageBase for shared mutation logic.
 * Returns null for actions that don't map to sync messages (local-only).
 */
export function gridActionToMessage(action: GridAction): ClientMessageBase | null {
  switch (action.type) {
    case 'TOGGLE_STEP':
      return { type: 'toggle_step', trackId: action.trackId, step: action.step };
    case 'SET_TEMPO':
      return { type: 'set_tempo', tempo: action.tempo };
    case 'SET_SWING':
      return { type: 'set_swing', swing: action.swing };
    case 'SET_TRACK_VOLUME':
      return { type: 'set_track_volume', trackId: action.trackId, volume: action.volume };
    // ... all sync-able mutations

    // Local-only actions return null
    case 'SET_PLAYING':
    case 'SET_CURRENT_STEP':
    case 'SELECT_STEP':
    case 'CLEAR_SELECTION':
    case 'ROTATE_PATTERN':  // Local-only pattern ops
    case 'INVERT_PATTERN':
    case 'REVERSE_PATTERN':
    case 'MIRROR_PATTERN':
    case 'EUCLIDEAN_FILL':
      return null;

    default:
      return null;
  }
}

/**
 * Convert GridState to SessionState for shared mutation logic.
 */
export function gridStateToSessionState(gridState: GridState): SessionState {
  return {
    tracks: gridState.tracks.map(t => ({
      id: t.id,
      name: t.name,
      sampleId: t.sampleId,
      steps: t.steps,
      parameterLocks: t.parameterLocks,
      volume: t.volume,
      muted: t.muted,
      soloed: t.soloed,
      transpose: t.transpose,
      stepCount: t.stepCount,
      swing: t.swing,
      fmParams: t.fmParams,
    })),
    tempo: gridState.tempo,
    swing: gridState.swing,
    effects: gridState.effects,
    scale: gridState.scale,
    loopRegion: gridState.loopRegion,
    version: 1,
  };
}

/**
 * Apply SessionState back to GridState, preserving local-only fields.
 */
export function sessionStateToGridState(
  sessionState: SessionState,
  existingGridState: GridState
): GridState {
  return {
    ...existingGridState,
    tracks: sessionState.tracks,
    tempo: sessionState.tempo,
    swing: sessionState.swing,
    effects: sessionState.effects,
    scale: sessionState.scale,
    loopRegion: sessionState.loopRegion,
    // Preserve local-only fields
    isPlaying: existingGridState.isPlaying,
    currentStep: existingGridState.currentStep,
    selection: existingGridState.selection,
  };
}
```

---

## Phase 3: Refactor gridReducer

### 3.1 New gridReducer Structure

```typescript
import { applyMutation } from '../shared/state-mutations';
import { gridActionToMessage, gridStateToSessionState, sessionStateToGridState } from '../shared/action-adapters';

export function gridReducer(state: GridState, action: GridAction): GridState {
  // Step 1: Try to convert to shared mutation
  const message = gridActionToMessage(action);

  if (message) {
    // Step 2: Apply shared mutation
    const sessionState = gridStateToSessionState(state);
    const newSessionState = applyMutation(sessionState, message);
    let newState = sessionStateToGridState(newSessionState, state);

    // Step 3: Handle client-only side effects
    newState = applyClientSideEffects(newState, action);

    return newState;
  }

  // Step 4: Handle local-only actions directly
  return handleLocalOnlyAction(state, action);
}

function applyClientSideEffects(state: GridState, action: GridAction): GridState {
  // Selection clearing on track delete/clear/pattern change
  switch (action.type) {
    case 'DELETE_TRACK':
    case 'CLEAR_TRACK':
      if (state.selection?.trackId === action.trackId) {
        return { ...state, selection: null };
      }
      break;
    // Pattern operations also clear selection
    case 'ROTATE_PATTERN':
    case 'INVERT_PATTERN':
    case 'REVERSE_PATTERN':
    case 'MIRROR_PATTERN':
    case 'EUCLIDEAN_FILL':
      if (state.selection?.trackId === action.trackId) {
        return { ...state, selection: null };
      }
      break;
  }
  return state;
}

function handleLocalOnlyAction(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.isPlaying };
    case 'SET_CURRENT_STEP':
      return { ...state, currentStep: action.step };
    case 'SELECT_STEP':
      // ... existing selection logic
    case 'CLEAR_SELECTION':
      return { ...state, selection: null };
    case 'LOAD_STATE':
      // ... existing load logic with local state preservation
    case 'RESET_STATE':
      return createInitialState();
    // Pattern operations (local-only for now)
    case 'ROTATE_PATTERN':
    case 'INVERT_PATTERN':
    case 'REVERSE_PATTERN':
    case 'MIRROR_PATTERN':
    case 'EUCLIDEAN_FILL':
      // ... existing pattern logic
    default:
      return state;
  }
}
```

### 3.2 Testing gridReducer Refactoring

1. Run golden tests - all must pass
2. Run existing unit tests - all must pass
3. Run integration tests - all must pass
4. Manual testing of pattern operations (local-only)

---

## Phase 4: Refactor live-session.ts Handlers

### 4.1 New Handler Structure

Each handler becomes much simpler:

```typescript
import { applyMutation } from '../shared/state-mutations';

private async handleToggleStep(
  ws: WebSocket,
  player: PlayerInfo,
  msg: { type: 'toggle_step'; trackId: string; step: number; seq?: number }
): Promise<void> {
  if (!this.state) return;

  // Step 1: Apply shared mutation
  const newState = applyMutation(this.state, msg);

  // Step 2: Check if state actually changed
  if (newState === this.state) {
    console.log(`[WS] toggle_step no-op (validation failed or no change)`);
    return;
  }

  // Step 3: Update state
  this.state = newState;

  // Step 4: Server-only side effects
  this.validateAndRepairState('handleToggleStep');
  await this.persistToDoStorage();

  // Step 5: Broadcast
  this.broadcast({
    type: 'step_toggled',
    trackId: msg.trackId,
    step: msg.step,
    value: newState.tracks.find(t => t.id === msg.trackId)?.steps[msg.step] ?? false,
    playerId: player.id,
  }, undefined, msg.seq);
}
```

### 4.2 Factory Pattern Update

Update `createTrackMutationHandler` and `createGlobalMutationHandler` to use `applyMutation`:

```typescript
export function createTrackMutationHandler<TMsg, TBroadcast>({
  getTrackId,
  toBroadcast,
}: {
  getTrackId: (msg: TMsg) => string;
  toBroadcast: (msg: TMsg, playerId: string) => TBroadcast;
}) {
  return async function(
    this: LiveSessionDurableObject,
    ws: WebSocket,
    player: PlayerInfo,
    msg: TMsg & { type: string; seq?: number }
  ): Promise<void> {
    if (!this.state) return;

    // Apply shared mutation
    const newState = applyMutation(this.state, msg as ClientMessageBase);
    if (newState === this.state) return; // No change

    this.state = newState;

    // Server side effects
    this.validateAndRepairState(`handle${msg.type}`);
    await this.persistToDoStorage();

    // Broadcast
    this.broadcast(toBroadcast(msg, player.id), undefined, msg.seq);
  };
}
```

### 4.3 Migrate All Handlers

Order of migration (by complexity):

1. **Simple handlers** (use factory):
   - `handleSetTempo` - already uses factory
   - `handleSetSwing` - already uses factory
   - `handleMuteTrack` - already uses factory
   - `handleSoloTrack` - already uses factory
   - `handleSetParameterLock` - already uses factory
   - `handleSetTrackSample` - already uses factory
   - `handleSetTrackVolume` - already uses factory
   - `handleSetTrackTranspose` - already uses factory
   - `handleSetTrackStepCount` - already uses factory
   - `handleSetTrackSwing` - already uses factory
   - `handleSetFMParams` - already uses factory

2. **Medium handlers** (custom but simple):
   - `handleToggleStep`
   - `handleClearTrack`
   - `handleCopySequence`
   - `handleMoveSequence`
   - `handleReorderTracks`
   - `handleSetLoopRegion`

3. **Complex handlers** (custom with extra logic):
   - `handleAddTrack` - duplicate handling, BUG-09 fix
   - `handleDeleteTrack` - duplicate handling, BUG-09 fix
   - `handleSetEffects` - extensive validation
   - `handleSetScale` - root note validation
   - `handleBatchClearSteps` - multi-step validation
   - `handleBatchSetParameterLocks` - multi-step validation + merge

---

## Phase 5: Testing Strategy

### 5.1 Unit Tests

**Existing tests** should continue to pass:
- `gridReducer.test.ts` (if exists)
- `state-mutations.property.test.ts`
- `sync-convergence.property.test.ts`

**New tests**:
- `golden-mutations.test.ts` - Behavior capture
- `action-adapters.test.ts` - Adapter unit tests

### 5.2 Integration Tests

**File**: `app/src/test/integration/shared-mutation.integration.test.ts`

```typescript
describe('Client-Server Mutation Equivalence', () => {
  for (const mutationType of MUTATION_TYPES) {
    it(`${mutationType}: client and server produce identical state`, () => {
      // 1. Generate random initial state
      // 2. Generate random mutation of this type
      // 3. Apply via gridReducer
      // 4. Apply via server handler
      // 5. Compare with canonicalEqual
    });
  }
});
```

### 5.3 E2E Tests

Manual testing checklist:
- [ ] Toggle step in multiplayer - all players see same state
- [ ] Change tempo - syncs correctly
- [ ] Add/delete track - no duplicates, proper cleanup
- [ ] Copy/move sequence - data integrity
- [ ] Pattern operations - confirm local-only (intentional)
- [ ] Effects changes - validation working
- [ ] Scale changes - validation working
- [ ] Loop region - normalization working

### 5.4 Property-Based Tests

Update existing property tests to verify shared implementation:

```typescript
it('SC-007: gridReducer produces same state as applyMutation', () => {
  fc.assert(fc.property(arbGridState, arbSyncableGridAction, (state, action) => {
    // Apply via gridReducer
    const reducerResult = gridReducer(state, action);

    // Apply via applyMutation
    const message = gridActionToMessage(action);
    if (message) {
      const sessionState = gridStateToSessionState(state);
      const mutationResult = applyMutation(sessionState, message);

      // Compare (excluding local-only fields)
      expect(canonicalEqual(
        gridStateToSessionState(reducerResult),
        mutationResult
      )).toBe(true);
    }
  }));
});
```

---

## Phase 6: Rollout Strategy

### 6.1 Feature Flag Approach

```typescript
// app/src/config/features.ts
export const USE_SHARED_MUTATIONS = {
  client: false,  // Start with false
  server: false,  // Start with false
};

// gridReducer
if (USE_SHARED_MUTATIONS.client) {
  // New path using applyMutation
} else {
  // Old path (current code)
}

// live-session.ts
if (USE_SHARED_MUTATIONS.server) {
  // New path using applyMutation
} else {
  // Old path (current code)
}
```

### 6.2 Phased Rollout

1. **Week 1**: Enable for client only, server unchanged
   - Verify client behavior identical
   - Monitor for issues

2. **Week 2**: Enable for server only, client reverted
   - Verify server behavior identical
   - Monitor for issues

3. **Week 3**: Enable for both
   - Full integration testing
   - Monitor sync behavior

4. **Week 4**: Remove feature flags, delete old code

---

## Phase 7: Cleanup

After rollout is complete:

1. Remove feature flags
2. Delete duplicate code from gridReducer
3. Delete duplicate code from live-session.ts handlers
4. Update documentation
5. Update architecture diagrams

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Behavior change breaks existing sessions | Medium | High | Golden tests catch changes |
| Performance regression | Low | Medium | Benchmark before/after |
| Complex edge cases missed | Medium | Medium | Property-based testing |
| Rollout issues in production | Low | High | Feature flags allow instant rollback |

---

## Success Criteria

1. All golden tests pass after refactoring
2. All property tests pass
3. No behavior changes detected (by comparison tests)
4. No performance regression (>10% slower)
5. Code duplication reduced by ~60%
6. Single source of truth for mutation logic

---

## Appendix: Files Modified

### New Files
- `app/src/shared/validation.ts`
- `app/src/shared/action-adapters.ts`
- `app/src/test/golden-mutations.test.ts`
- `app/src/test/integration/shared-mutation.integration.test.ts`

### Modified Files
- `app/src/shared/state-mutations.ts` - Add validation, fix merge logic
- `app/src/state/grid.tsx` - Use shared mutations
- `app/src/worker/live-session.ts` - Use shared mutations
- `app/src/worker/handler-factory.ts` - Update factories

### Deleted Files (after cleanup)
- None (code removed from existing files)

---

## Timeline Estimate

This is a significant refactoring. Key work items:

1. Phase 0 (Behavior Capture): Create golden tests
2. Phase 1 (Align state-mutations.ts): Add validation, fix differences
3. Phase 2 (Adapters): Create type adapters
4. Phase 3 (Client): Refactor gridReducer
5. Phase 4 (Server): Refactor live-session.ts handlers
6. Phase 5 (Testing): Run full test suite
7. Phase 6 (Rollout): Phased deployment
8. Phase 7 (Cleanup): Remove old code

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-04 | Pattern ops stay local-only | Simpler, allows per-player experimentation |
| 2026-01-04 | Server is source of truth | Server has validation, is authoritative |
| 2026-01-04 | Feature flags for rollout | Safe incremental deployment |
