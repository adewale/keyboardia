# Synchronization Bug Audit

**Date**: 2026-01-04
**Auditor**: Claude (Property-Based Testing Session)
**Scope**: All client actions that modify state vs. server message handlers

## Executive Summary

Found **7 synchronization bugs** where client-side mutations modify state locally but don't sync to server, causing silent data loss when server snapshots arrive.

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 5 | Pattern operations - changes lost on snapshot |
| **MEDIUM** | 1 | SET_TRACK_NAME - track names don't sync |
| **LOW** | 1 | Architectural inconsistency in batch operations |

---

## Bug Pattern Explanation

```
The Silent Data Loss Bug:

1. User performs action (e.g., rotates pattern)
2. Client reducer updates local state immediately (optimistic UI)
3. NO message sent to server (actionToMessage returns null)
4. Server state remains unchanged
5. Server sends snapshot (on reconnect, new player joins, etc.)
6. Client state overwritten with server state
7. User's change is SILENTLY LOST
```

---

## CRITICAL: Pattern Operations Don't Sync

### Affected Actions

| Action | Modifies | Server Handler | Status |
|--------|----------|----------------|--------|
| `ROTATE_PATTERN` | `track.steps`, `track.parameterLocks` | None | **BUG** |
| `INVERT_PATTERN` | `track.steps`, `track.parameterLocks` | None | **BUG** |
| `REVERSE_PATTERN` | `track.steps`, `track.parameterLocks` | None | **BUG** |
| `MIRROR_PATTERN` | `track.steps`, `track.parameterLocks` | None | **BUG** |
| `EUCLIDEAN_FILL` | `track.steps`, `track.parameterLocks` | None | **BUG** |

### Evidence

**sync-classification.ts:49-54** - Listed as SYNCED_ACTIONS:
```typescript
'ROTATE_PATTERN',        // Grid edit - shared
'INVERT_PATTERN',        // Grid edit - shared
'REVERSE_PATTERN',       // Grid edit - shared
'MIRROR_PATTERN',        // Grid edit - shared
'EUCLIDEAN_FILL',        // Grid edit - shared
```

**multiplayer.ts:actionToMessage()** - NO cases for these actions (returns null)

**live-session.ts** - NO handlers for `rotate_pattern`, `invert_pattern`, etc.

### Reproduction

1. Open session in two browser tabs
2. In Tab A: Add a track, toggle some steps
3. In Tab A: Click "Rotate Left" on the pattern
4. Tab A shows rotated pattern
5. Tab B still shows original pattern
6. In Tab B: Toggle any step (triggers sync)
7. Tab A receives snapshot → pattern reverts to un-rotated

### Impact

- User's creative work is silently lost
- Collaborators see different patterns
- INVERT/EUCLIDEAN also clear parameter locks - that data is destroyed locally but server still has it

### Fix Required

1. Add message types: `rotate_pattern`, `invert_pattern`, `reverse_pattern`, `mirror_pattern`, `euclidean_fill`
2. Add cases to `actionToMessage()` in multiplayer.ts
3. Add handlers in live-session.ts
4. Add broadcast message types for responses

---

## MEDIUM: SET_TRACK_NAME Doesn't Sync

### Evidence

**sync-classification.ts:42** - Listed as SYNCED_ACTIONS:
```typescript
'SET_TRACK_NAME',        // Track property - shared
```

**StepSequencer.tsx:227** - Only dispatches locally:
```typescript
const handleSetName = useCallback((trackId: string, name: string) => {
  dispatch({ type: 'SET_TRACK_NAME', trackId, name });
  // NO multiplayer sync call!
}, [dispatch]);
```

**multiplayer.ts:actionToMessage()** - NO case for SET_TRACK_NAME

**live-session.ts** - NO handler for `set_track_name`

### Impact

- Track names are local-only despite being listed as synced
- Collaborators see default names ("Kick", "Snare") instead of custom names
- Custom names lost on page refresh (server doesn't have them)

### Fix Required

1. Add `set_track_name` message type
2. Add case to `actionToMessage()` OR add `multiplayer?.handleSetTrackName()` call
3. Add handler in live-session.ts
4. Persist track name in session state

---

## LOW: Inconsistent Sync Patterns

### Two Different Sync Patterns Exist

**Pattern A: actionToMessage()** (most actions)
```typescript
// In multiplayer.ts - centralized mapping
function actionToMessage(action: GridAction): ClientMessage | null {
  switch (action.type) {
    case 'TOGGLE_STEP':
      return { type: 'toggle_step', trackId: action.trackId, step: action.step };
    // ...
  }
}
```

**Pattern B: Direct Sync Calls** (batch operations, reorder)
```typescript
// In StepSequencer.tsx - manual sync
dispatch({ type: 'DELETE_SELECTED_STEPS' });
multiplayer?.handleBatchClearSteps(trackId, stepsArray);  // Separate call!
```

### Affected Actions

| Action | Pattern | Notes |
|--------|---------|-------|
| `DELETE_SELECTED_STEPS` | B - Direct | Works, but inconsistent |
| `APPLY_TO_SELECTION` | B - Direct | Works, but inconsistent |
| `REORDER_TRACKS` | B - Direct | Works, but inconsistent |

### Risk

- New code might forget the second sync call
- No centralized place to audit sync coverage
- Harder to add middleware (e.g., offline queue)

### Recommendation

Either:
1. Move all actions to Pattern A (actionToMessage), OR
2. Document Pattern B as intentional for batch operations

---

## VERIFIED CORRECT: Local-Only Actions

These actions are correctly local-only per "My Ears, My Control" philosophy:

| Action | Reason | Verification |
|--------|--------|--------------|
| `TOGGLE_MUTE` | Personal mix | actionToMessage returns null, BUG-10 fix preserves on load |
| `TOGGLE_SOLO` | Personal mix | actionToMessage returns null |
| `EXCLUSIVE_SOLO` | Personal mix | actionToMessage returns null |
| `CLEAR_ALL_SOLOS` | Personal mix | actionToMessage returns null |
| `UNMUTE_ALL` | Personal mix | actionToMessage returns null |
| `SELECT_STEP` | UI state | actionToMessage returns null |
| `CLEAR_SELECTION` | UI state | actionToMessage returns null |
| `SET_PLAYING` | Per-player | Sends play/stop but doesn't affect pattern state |
| `SET_CURRENT_STEP` | UI state | Playhead position is local |

**Evidence of Correct Implementation**:

grid.tsx:258-268 (LOAD_STATE preserves local mute/solo):
```typescript
// BUG-10 FIX: Preserve local-only state (muted, soloed) for existing tracks
// Per "My Ears, My Control" philosophy, each player controls their own mix
muted: localTrack ? localTrack.muted : (serverTrack.muted ?? false),
soloed: localTrack ? localTrack.soloed : (serverTrack.soloed ?? false),
```

---

## Complete Action Inventory

### Synced Actions (should have server handlers)

| Action | actionToMessage | Server Handler | Status |
|--------|-----------------|----------------|--------|
| TOGGLE_STEP | toggle_step | handleToggleStep | ✅ |
| SET_TEMPO | set_tempo | handleSetTempo | ✅ |
| SET_SWING | set_swing | handleSetSwing | ✅ |
| SET_PARAMETER_LOCK | set_parameter_lock | handleSetParameterLock | ✅ |
| ADD_TRACK | (sendAddTrack) | handleAddTrack | ✅ |
| DELETE_TRACK | delete_track | handleDeleteTrack | ✅ |
| CLEAR_TRACK | clear_track | handleClearTrack | ✅ |
| SET_TRACK_SAMPLE | set_track_sample | handleSetTrackSample | ✅ |
| SET_TRACK_VOLUME | set_track_volume | handleSetTrackVolume | ✅ |
| SET_TRACK_TRANSPOSE | set_track_transpose | handleSetTrackTranspose | ✅ |
| SET_TRACK_STEP_COUNT | set_track_step_count | handleSetTrackStepCount | ✅ |
| SET_TRACK_SWING | set_track_swing | handleSetTrackSwing | ✅ |
| SET_EFFECTS | set_effects | handleSetEffects | ✅ |
| SET_SCALE | set_scale | handleSetScale | ✅ |
| SET_FM_PARAMS | set_fm_params | handleSetFMParams | ✅ |
| COPY_SEQUENCE | copy_sequence | handleCopySequence | ✅ |
| MOVE_SEQUENCE | move_sequence | handleMoveSequence | ✅ |
| SET_SESSION_NAME | set_session_name | handleSetSessionName | ✅ |
| SET_LOOP_REGION | set_loop_region | handleSetLoopRegion | ✅ |
| REORDER_TRACKS | (handleTrackReorder) | handleReorderTracks | ✅ |
| DELETE_SELECTED_STEPS | (handleBatchClearSteps) | handleBatchClearSteps | ✅ |
| APPLY_TO_SELECTION | (handleBatchSetParameterLocks) | handleBatchSetParameterLocks | ✅ |
| **SET_TRACK_NAME** | **MISSING** | **MISSING** | **BUG** |
| **ROTATE_PATTERN** | **MISSING** | **MISSING** | **BUG** |
| **INVERT_PATTERN** | **MISSING** | **MISSING** | **BUG** |
| **REVERSE_PATTERN** | **MISSING** | **MISSING** | **BUG** |
| **MIRROR_PATTERN** | **MISSING** | **MISSING** | **BUG** |
| **EUCLIDEAN_FILL** | **MISSING** | **MISSING** | **BUG** |

### Local-Only Actions (correctly don't sync)

| Action | Reason | Status |
|--------|--------|--------|
| TOGGLE_MUTE | Personal mix | ✅ Correct |
| TOGGLE_SOLO | Personal mix | ✅ Correct |
| EXCLUSIVE_SOLO | Personal mix | ✅ Correct |
| CLEAR_ALL_SOLOS | Personal mix | ✅ Correct |
| UNMUTE_ALL | Personal mix | ✅ Correct |
| SELECT_STEP | UI state | ✅ Correct |
| CLEAR_SELECTION | UI state | ✅ Correct |
| SET_PLAYING | Per-player | ✅ Correct |
| SET_CURRENT_STEP | UI state | ✅ Correct |
| LOAD_STATE | Internal | ✅ Correct |
| RESET_STATE | Internal | ✅ Correct |
| REMOTE_* | Incoming only | ✅ Correct |

---

## Recommended Fixes

### Priority 1: Pattern Operations (CRITICAL)

Add to refactoring plan Phase 1.3 (already documented).

### Priority 2: SET_TRACK_NAME (MEDIUM)

**Option A**: Add full sync support
```typescript
// message-types.ts
| { type: 'set_track_name'; trackId: string; name: string }

// multiplayer.ts actionToMessage
case 'SET_TRACK_NAME':
  return { type: 'set_track_name', trackId: action.trackId, name: action.name };

// live-session.ts
private handleSetTrackName = createTrackMutationHandler<...>({
  getTrackId: (msg) => msg.trackId,
  mutate: (track, msg) => { track.name = msg.name; },
  toBroadcast: (msg, playerId) => ({ type: 'track_name_set', ... }),
});
```

**Option B**: Move to LOCAL_ONLY (if names should be personal)
- Remove from SYNCED_ACTIONS
- Add to LOCAL_ONLY_ACTIONS
- Document decision

**Recommendation**: Option A - track names should sync so collaborators know what each track is.

### Priority 3: Architectural Consistency (LOW)

Consider consolidating all sync patterns to use actionToMessage() for better auditability.

---

## Testing Recommendations

### 1. Property-Based Test for Sync Coverage

```typescript
it('every SYNCED_ACTION has corresponding server handler', () => {
  for (const action of SYNCED_ACTIONS) {
    const message = actionToMessage({ type: action, ...minimalPayload(action) });
    expect(message).not.toBeNull();
    expect(serverHandlers).toContain(`handle${pascalCase(message.type)}`);
  }
});
```

### 2. Integration Test for Round-Trip

```typescript
it('mutations applied locally match server state after sync', async () => {
  // Apply mutation locally
  // Wait for server acknowledgment
  // Request snapshot
  // Compare local vs server state
});
```

### 3. Add sync-classification.ts Validation

```typescript
// Ensure SYNCED_ACTIONS and LOCAL_ONLY_ACTIONS are exhaustive
const allActions = [...SYNCED_ACTIONS, ...LOCAL_ONLY_ACTIONS, ...INTERNAL_ACTIONS];
const definedActions = Object.keys(GridActionTypes);
expect(allActions.sort()).toEqual(definedActions.sort());
```

---

## Files Referenced

| File | Purpose |
|------|---------|
| `app/src/types.ts:130-162` | GridAction type definitions |
| `app/src/state/grid.tsx` | gridReducer implementation |
| `app/src/sync/multiplayer.ts:2264-2375` | actionToMessage() mapping |
| `app/src/shared/sync-classification.ts` | SYNCED_ACTIONS / LOCAL_ONLY_ACTIONS |
| `app/src/worker/live-session.ts:638-736` | Server message handlers |
| `app/src/shared/message-types.ts` | ClientMessage types |
| `app/src/components/StepSequencer.tsx` | UI dispatch calls |
