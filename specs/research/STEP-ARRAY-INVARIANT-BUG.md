# Step Array Invariant Bug Analysis

## Overview

This document analyzes a bug where the `handleSetTrackStepCount` handler in `live-session.ts` resizes track arrays (steps, parameterLocks) to match the `stepCount`, violating the invariant that arrays must always be exactly `MAX_STEPS` (128) elements.

**Severity**: Medium (data loss potential, invariant violation)
**Discovered**: 2026-01-01 (Codebase audit)
**Status**: FIXED (2026-01-01)
**Implementation**: Option A - Arrays stay at MAX_STEPS (128), stepCount is view window

---

## The Bug

### Conflicting Behaviors

Two parts of the codebase have incompatible expectations about track array lengths:

| Location | Expectation | Behavior |
|----------|-------------|----------|
| `worker/invariants.ts:233-240` | Arrays MUST be exactly 128 elements | Validation fails if not |
| `worker/live-session.ts:1036-1044` | Arrays should match `stepCount` | Resizes on step count change |

### Code Evidence

**Invariant definition** (`invariants.ts:227-244`):
```typescript
function checkTracksHaveValidArrays(tracks: SessionTrack[]): string[] {
  const violations: string[] = [];
  for (const track of tracks) {
    // ...
    } else if (track.steps.length !== MAX_STEPS) {
      violations.push(`Track ${track.id}: steps length ${track.steps.length} !== ${MAX_STEPS}`);
    }
    // Same check for parameterLocks
  }
  return violations;
}
```

**Violating mutation** (`live-session.ts:1034-1044`):
```typescript
// Resize steps and parameterLocks arrays to match new step count
if (msg.stepCount > oldStepCount) {
  // Expand arrays with empty values
  track.steps = [...track.steps, ...new Array(msg.stepCount - oldStepCount).fill(false)];
  track.parameterLocks = [...track.parameterLocks, ...new Array(msg.stepCount - oldStepCount).fill(null)];
} else if (msg.stepCount < oldStepCount) {
  // Truncate arrays
  track.steps = track.steps.slice(0, msg.stepCount);
  track.parameterLocks = track.parameterLocks.slice(0, msg.stepCount);
}
```

### Why 128 Works But Others Fail

| stepCount | Array length after | Invariant | Notes |
|-----------|-------------------|-----------|-------|
| 128 | 128 | PASS | Only valid case |
| 64 | 64 | FAIL | `64 !== 128` |
| 16 | 16 | FAIL | `16 !== 128` |
| 5 | 5 | FAIL | `5 !== 128` |

---

## Impact Analysis

### 1. Silent Invariant Violations

`validateAndRepairState` is NOT called after `handleSetTrackStepCount`:

```bash
# validateAndRepairState call sites (from grep):
loadFromDOStorage     # ✓ Called
loadFromKV            # ✓ Called
handleAddTrack        # ✓ Called
handleDeleteTrack     # ✓ Called
handleClearTrack      # ✓ Called
handleCopySequence    # ✓ Called
handleSetTrackPlaybackMode  # ✓ Called
handleMoveSequence    # ✓ Called
handleSetTrackStepCount     # ✗ NOT CALLED
```

This means step count changes create violations that go undetected until:
- A track is added (triggers validation)
- Session is reloaded from storage (triggers validation + repair)

### 2. Deferred Repair Creates Inconsistency

When repair eventually runs (`repairStateInvariants`), it pads arrays back to 128:

```typescript
// invariants.ts:370-377
if (track.steps.length < MAX_STEPS) {
  const padding = Array(MAX_STEPS - track.steps.length).fill(false);
  track.steps = [...track.steps, ...padding];
  repairs.push(`Padded steps array for track ${track.id}`);
}
```

This creates a cycle:
1. User sets stepCount to 64 → arrays become length 64
2. User adds a track → repair runs → arrays padded to 128
3. User sets stepCount to 32 → arrays become length 32
4. ...

### 3. Potential Data Loss

When arrays are truncated:
```typescript
track.steps = track.steps.slice(0, msg.stepCount);
```

If user had data in positions 64-127 and sets stepCount to 64, that data is **permanently lost**.

When repair pads:
```typescript
track.steps = [...track.steps, ...padding];
```

The lost data is replaced with `false` (empty steps).

### 4. Multiplayer Desync Risk

If Client A and Client B have different array lengths due to race conditions:
- State hash comparison will fail (different array lengths = different hashes)
- Snapshot reconciliation may produce unexpected results

---

## Root Cause Analysis

### Mental Model Mismatch

There are two valid mental models for step sequencing:

**Model A: Fixed-Length Arrays (Invariant Model)**
- Arrays are always MAX_STEPS (128) length
- `stepCount` indicates how many steps are "active"
- Extra array positions are ignored during playback
- Pros: Consistent state, no data loss, simpler invariants
- Cons: Slightly larger payloads

**Model B: Variable-Length Arrays (Handler Model)**
- Arrays match `stepCount` exactly
- No wasted space
- Pros: Minimal memory/storage
- Cons: Complex invariants, data loss on shrink

The codebase **claims** Model A (via invariants) but **implements** Model B (in the handler).

### Historical Speculation

The array resizing code in `handleSetTrackStepCount` was likely added with the comment:
```typescript
// Resize steps and parameterLocks arrays to match new step count
// This ensures arrays stay in sync with stepCount for snapshot consistency
```

This suggests the author believed Model B was correct. However, they didn't update the invariants or the repair logic, creating the conflict.

---

## Fix Options

### Option A: Align Handler with Invariants (Recommended)

Remove the array resizing code. Arrays stay at 128 elements.

**Changes required:**
1. Delete lines 1034-1044 in `live-session.ts`
2. Add `validateAndRepairState('handleSetTrackStepCount')` after the mutation
3. Add test verifying arrays stay at 128

**Pros:**
- Minimal code change (deletion)
- Aligns with documented invariants
- No data loss ever
- Repair logic already correct

**Cons:**
- Slightly larger state payloads (128 vs stepCount elements)

### Option B: Align Invariants with Handler

Change invariants to expect variable-length arrays.

**Changes required:**
1. Change `checkTracksHaveValidArrays` to validate `length === stepCount`
2. Update `repairStateInvariants` to resize to stepCount
3. Update all array creation to use stepCount
4. Handle backward compatibility for stored sessions

**Pros:**
- Minimal storage size

**Cons:**
- Complex migration
- Data loss on stepCount reduction remains
- All array creation sites need updates
- Risk of bugs in repair logic

### Option C: Hybrid (Expand Only, Never Shrink)

Only expand arrays when stepCount increases. Never truncate.

**Changes required:**
1. Remove truncation code (lines 1040-1044)
2. Keep expansion code
3. Update invariants to expect `length >= stepCount`

**Pros:**
- No data loss
- Arrays only grow

**Cons:**
- Unbounded growth potential
- Complex invariant (>= vs ===)
- Still inconsistent with current invariants

---

## How We Know We're Right

### Evidence Analysis

The question is: which model is correct?
- **Model A**: Arrays fixed at MAX_STEPS (128), `stepCount` is a view window
- **Model B**: Arrays match `stepCount` exactly

| Source | What It Says | Existed Before af466ff? |
|--------|--------------|------------------------|
| `invariants.ts:233` | `length !== MAX_STEPS` is violation | ✅ Yes |
| `grid.tsx:200` | `ADD_TRACK` creates `Array(MAX_STEPS)` | ✅ Yes |
| `track-utils.ts:23` | `createStepsArray()` defaults to `MAX_STEPS` | ✅ Yes |
| `invariants.ts:371` | Repair pads to `MAX_STEPS` | ✅ Yes |
| `scheduler.ts:277` | Guard `trackStep < trackStepCount` | ✅ Yes |
| `midiExport.fidelity.test.ts:47` | Tests use `Array(128)` | ✅ Yes |
| `multiplayer.test.ts:2546` | Tests use `Array(MAX_STEPS)` | ✅ Yes |
| `live-session.ts:1042` | Truncates to `stepCount` | ❌ **Added in af466ff** |
| `grid.tsx:97` | Truncates to `stepCount` | ❌ **Added in af466ff** |
| `bug-patterns.ts:634` | Says `length === stepCount` | ❌ **Added in af466ff** |
| `grid.test.ts:225` | Tests `length === stepCount` | ❌ **Added in af466ff** |

**Conclusion**: All evidence for Model B was introduced by the same commit. The pre-existing codebase expects Model A.

### Scheduler Proof

```typescript
// scheduler.ts:277
if (trackStep < trackStepCount && track.steps[trackStep]) {
```

This guard `trackStep < trackStepCount` would be **unnecessary** if arrays were always exactly `stepCount` length. The guard exists because the original design expected arrays might be longer.

### The "Fix" Introduced the Bug

Commit `af466ff` titled "fix: Step count sync and array resizing bug" actually **introduced** the bug:

1. Original `handleSetTrackStepCount`: Just set `stepCount`, no array resizing
2. "Fix" added: Array resizing code that violates invariants
3. Also added: `bug-patterns.ts` documenting the new (wrong) pattern
4. Also added: Tests verifying the new (wrong) behavior

### Original Code (CORRECT)

```typescript
// grid.tsx BEFORE af466ff - just sets stepCount, no resizing
case 'SET_TRACK_STEP_COUNT': {
  const tracks = state.tracks.map((track) => {
    if (track.id !== action.trackId) return track;
    return { ...track, stepCount: Math.max(1, Math.min(MAX_STEPS, action.stepCount)) };
  });
  return { ...state, tracks };
}
```

This is exactly what we're proposing to restore.

---

## Missing Documentation: Root Cause of the Bug

### What Was Documented

| Location | What It Said |
|----------|--------------|
| `invariants.ts:106` | `steps.length !== MAX_STEPS` is a violation |
| `invariants.ts:243-249` | Repair pads/truncates to MAX_STEPS |
| `LESSONS-LEARNED.md:2886` | `assert(t.steps.length <= 128)` (note: uses `<=` not `===`) |

### What Was NOT Documented

**The critical design decision was never explicitly stated:**

> "Arrays are always fixed at MAX_STEPS length. The `stepCount` property indicates how many steps are 'active' or 'visible', but arrays never resize."

This missing documentation allowed a developer to reasonably conclude:
- "Arrays should match stepCount for consistency"
- "Let me add a 'fix' to resize arrays"
- "Let me document this 'pattern' for others"

### The Documentation Gap

The invariant check **enforced** the design but didn't **explain** it:

```typescript
// invariants.ts - WHAT (the check)
if (track.steps.length !== MAX_STEPS) {
  violations.push(`Track ${track.id}: steps length ${track.steps.length} !== ${MAX_STEPS}`);
}

// MISSING: WHY (the rationale)
// Arrays are fixed-length because:
// 1. stepCount is a "view window" - users may reduce then expand
// 2. Data beyond stepCount should be preserved (non-destructive editing)
// 3. Playback uses modulo arithmetic: track.steps[globalStep % stepCount]
// 4. Simpler invariant: arrays are always exactly MAX_STEPS
```

### Lesson Learned

**Invariants should include rationale, not just checks.**

When adding an invariant, document:
1. **WHAT** the constraint is
2. **WHY** it exists (the design intent)
3. **CONSEQUENCES** of violating it

This would have prevented af466ff - the developer would have seen:
> "stepCount is a view window, arrays never resize"

...and would not have added resizing code.

---

## Recommended Fix

**Option A** is recommended because:

1. **Minimal change**: Delete code rather than add code
2. **Invariant alignment**: Matches existing expectations
3. **No data loss**: User's step data is preserved
4. **Existing repair works**: `repairStateInvariants` already handles padding

---

## Implementation Requirements

### Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `worker/live-session.ts` | Delete lines 1031-1044 (array resizing) | **Critical** |
| `worker/mock-durable-object.ts` | Delete lines 643-650 (mirror of above) | **Critical** |
| `state/grid.tsx` | Fix SET_TRACK_STEP_COUNT, CLEAR_TRACK, MOVE_SEQUENCE | **Critical** |
| `utils/bug-patterns.ts` | Delete or correct array-count-mismatch pattern | **Required** |
| `state/grid.test.ts` | Fix tests that verify wrong behavior | **Required** |

### Conflicting Documentation to Update

The following documentation must be corrected or removed:

**`app/src/utils/bug-patterns.ts:594-638`** - Contains wrong guidance:
```typescript
// WRONG - This guidance must be removed/corrected:
fix: {
  summary: 'When changing count properties, ALWAYS resize associated arrays in the same operation',
  // ...
  prevention: [
    'Add invariant check: track.steps.length === track.stepCount',  // WRONG
  ],
}
```

**Should be replaced with:**
```typescript
fix: {
  summary: 'Arrays stay at MAX_STEPS length. stepCount indicates active steps only.',
  steps: [
    '1. NEVER resize arrays when stepCount changes',
    '2. stepCount is a "view window" into the fixed-length array',
    '3. Invariant: track.steps.length === MAX_STEPS (128)',
  ],
}
```

### Server-Side Fix

```typescript
// live-session.ts - handleSetTrackStepCount

// BEFORE (buggy):
const oldStepCount = track.stepCount ?? 16;
track.stepCount = msg.stepCount;

// Resize steps and parameterLocks arrays to match new step count
if (msg.stepCount > oldStepCount) {
  track.steps = [...track.steps, ...new Array(msg.stepCount - oldStepCount).fill(false)];
  track.parameterLocks = [...track.parameterLocks, ...new Array(msg.stepCount - oldStepCount).fill(null)];
} else if (msg.stepCount < oldStepCount) {
  track.steps = track.steps.slice(0, msg.stepCount);
  track.parameterLocks = track.parameterLocks.slice(0, msg.stepCount);
}

// AFTER (fixed):
track.stepCount = msg.stepCount;
// Arrays stay at MAX_STEPS length - stepCount indicates active steps only
// Invariant: track.steps.length === MAX_STEPS (128)
```

### Client-Side Fix (grid.tsx)

```typescript
// BEFORE (buggy):
case 'SET_TRACK_STEP_COUNT': {
  // ... truncation/expansion code
  return { ...track, stepCount: newStepCount, steps: newSteps, parameterLocks: newLocks };
}

// AFTER (fixed):
case 'SET_TRACK_STEP_COUNT': {
  const newStepCount = Math.max(1, Math.min(MAX_STEPS, action.stepCount));
  return { ...track, stepCount: newStepCount };
  // Arrays stay at MAX_STEPS - don't resize
}
```

Also fix `CLEAR_TRACK` and `MOVE_SEQUENCE` to use `MAX_STEPS` instead of `stepCount`.

---

## Consequences of the Fix

### Positive Consequences

1. **Invariants pass**: `validateStateInvariants()` will pass after all mutations
2. **No data loss**: Reducing `stepCount` from 128→64→128 preserves steps 64-127
3. **Consistent state**: Arrays always 128, no variation based on mutation history
4. **Hash stability**: State hashes will be more consistent in multiplayer
5. **Simpler mental model**: "Arrays are always 128, stepCount is a view window"

### No Breaking Changes for UI

The UI already handles this correctly:

```typescript
// TrackRow.tsx:384 - Already slices for display
return track.steps.slice(0, trackStepCount).map((active, index) => ...

// ChromaticGrid.tsx:67 - Already iterates to stepCount
for (let i = 0; i < trackStepCount; i++) {
  if (track.steps[i]) { ... }
}
```

The fix is **invisible to users** - the UI renders the same number of steps.

### Backward Compatibility

**Stored sessions with truncated arrays**: Will be auto-repaired on load.

The `repairStateInvariants()` function already handles this:
```typescript
// invariants.ts:370-373
if (track.steps.length < MAX_STEPS) {
  const padding = Array(MAX_STEPS - track.steps.length).fill(false);
  track.steps = [...track.steps, ...padding];
}
```

No migration needed - repair runs automatically.

### State Payload Size

| stepCount | Before Fix | After Fix | Delta |
|-----------|------------|-----------|-------|
| 16 | 16 bools + 16 locks | 128 bools + 128 locks | +112 each |
| 64 | 64 bools + 64 locks | 128 bools + 128 locks | +64 each |
| 128 | 128 bools + 128 locks | 128 bools + 128 locks | No change |

**Impact**: Slightly larger JSON payloads for low stepCount tracks.
- `false` in JSON: 5 bytes
- `null` in JSON: 4 bytes
- Extra 112 steps: ~1KB per track

**Mitigations**:
- gzip compression reduces this significantly (repeated `false`/`null` compress well)
- State sync already handles 128 elements for most tracks
- This is the original design - we're restoring correctness, not adding bloat

### Rollout Considerations

**Must deploy atomically**: Client and server fixes must be deployed together.

If only server is fixed:
- Server sends 128-length arrays
- Old client reducer truncates them
- State hash mismatch on next sync
- Causes snapshot storm

**Recommended rollout**:
1. Fix client reducer (`grid.tsx`)
2. Fix server handler (`live-session.ts`)
3. Fix mock (`mock-durable-object.ts`)
4. Deploy all together

### Tests That Will Break

The following tests verify the **wrong** (current) behavior and must be updated:

| File | Test | Current Assertion | Correct Assertion |
|------|------|-------------------|-------------------|
| `grid.test.ts:220` | "expand steps array" | `length === 16` | `length === 128` |
| `grid.test.ts:225` | "should expand" | `length === 32` | `length === 128` |
| `grid.test.ts:254` | "should truncate" | `length === 8` | `length === 128` |

These tests were added in af466ff and verify the bug, not correct behavior.

---

## Snapshot Storm Detection and Resolution

### What is a Snapshot Storm?

If server and client have different array lengths, their state hashes will differ. This causes:

1. Client computes hash of truncated state (64 elements)
2. Server sends hash of full state (128 elements)
3. Hashes don't match
4. Client requests snapshot
5. Client receives snapshot (128 elements)
6. User changes stepCount → client reducer truncates to 64
7. Hashes don't match again
8. Repeat forever

### Existing Defenses

The codebase already has snapshot storm prevention:

| Mechanism | Location | Protection |
|-----------|----------|------------|
| Debounce | `multiplayer.ts:96` | `RECOVERY_DEBOUNCE_MS = 2000` |
| Consecutive threshold | `sync-health.ts:64` | `mismatchThreshold: 2` |
| Hash check interval | `multiplayer.ts:106` | `STATE_HASH_CHECK_INTERVAL_MS = 30000` |

**Worst case**: 1 snapshot every 30 seconds (hash check interval) × 2 (threshold) = 1 snapshot per minute.

### Detection During Rollout

**Metrics to monitor** (from `SyncHealthMetrics`):

```typescript
interface SyncHealthMetrics {
  hashCheckCount: number;        // Total checks
  mismatchCount: number;         // Total mismatches
  consecutiveMismatches: number; // Current streak
  // ...
}
```

**Storm indicators**:
- `mismatchCount` growing rapidly
- `consecutiveMismatches` repeatedly hitting threshold then resetting
- High `request_snapshot` frequency in server logs

**Log patterns to grep for**:
```bash
# On server (Cloudflare Workers logs)
grep "request_snapshot" | wc -l  # Should be low
grep "state_sync" | wc -l        # High = many snapshots sent

# On client (browser console)
grep "[RECOVERY] Requesting snapshot" | uniq -c | sort -rn
```

### Resolution if Storm Detected

1. **Immediate**: Roll back server change (re-enable array resizing)
2. **Root cause**: Client reducer is still truncating
3. **Fix**: Deploy client fix first, then server fix

### Prevention: Atomic Rollout

**Recommended deployment order**:
1. Deploy client bundle with fixed `grid.tsx` reducer
2. Old clients continue working (server still resizes)
3. Once CDN propagated, deploy server fix
4. New clients + new server = consistent 128-length arrays

**Or use feature flag**:
```typescript
// live-session.ts
const FIXED_ARRAY_LENGTH = env.FEATURE_FIXED_ARRAYS ?? false;

if (!FIXED_ARRAY_LENGTH) {
  // Old resizing behavior for backward compatibility
  if (msg.stepCount < oldStepCount) {
    track.steps = track.steps.slice(0, msg.stepCount);
  }
}
```

---

## Demo Session: Before/After Impact

### Scenario: "The Vanishing Pattern"

A session that demonstrates data loss with current behavior and data preservation with fix.

#### Setup

1. Create a track with `stepCount = 128`
2. Add a distinctive pattern in positions 64-127:
   ```
   Steps 64-79:  ●○○○●○○○●○○○●○○○  (kick pattern)
   Steps 80-95:  ○●○●○●○●○●○●○●○●  (hi-hat pattern)
   Steps 96-111: ●○○●○○●○○●○○●○○●  (syncopated)
   Steps 112-127: ○○○○●●●●○○○○●●●●  (build-up)
   ```
3. Switch to `stepCount = 64` (work on first half)
4. Switch back to `stepCount = 128`

#### Current Behavior (BUG)

| Step | stepCount | Array Length | Pattern 64-127 |
|------|-----------|--------------|----------------|
| 1 | 128 | 128 | ✅ Present |
| 2 | 64 | **64** (truncated) | ❌ **DELETED** |
| 3 | 128 | 128 (padded with `false`) | ❌ **GONE** |

**User experience**: "My pattern disappeared when I changed step count!"

#### Fixed Behavior

| Step | stepCount | Array Length | Pattern 64-127 |
|------|-----------|--------------|----------------|
| 1 | 128 | 128 | ✅ Present |
| 2 | 64 | 128 (unchanged) | ✅ Still there (hidden) |
| 3 | 128 | 128 (unchanged) | ✅ **VISIBLE AGAIN** |

**User experience**: "My pattern came back when I expanded the view!"

### Test Script

```typescript
describe('Demo: The Vanishing Pattern', () => {
  it('should preserve hidden steps when reducing stepCount (FIXED)', async () => {
    const session = createMockSession('demo');

    // Create track with MAX_STEPS arrays
    const steps = Array(128).fill(false);
    steps[64] = true;   // Kick at 64
    steps[80] = true;   // Hi-hat at 80
    steps[100] = true;  // Syncopated at 100
    steps[120] = true;  // Build-up at 120

    session['state'].tracks = [{
      id: 'demo-track',
      name: 'Demo',
      sampleId: 'kick',
      steps,
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 128,
    }];

    const ws = session.connect('player-1');

    // Reduce to 64 steps
    ws.send(JSON.stringify({ type: 'set_track_step_count', trackId: 'demo-track', stepCount: 64 }));
    await vi.waitFor(() => expect(session.getState().tracks[0].stepCount).toBe(64));

    // Pattern should still exist in the array (just hidden from view)
    expect(session.getState().tracks[0].steps[64]).toBe(true);   // FAILS with bug
    expect(session.getState().tracks[0].steps[100]).toBe(true);  // FAILS with bug

    // Expand back to 128
    ws.send(JSON.stringify({ type: 'set_track_step_count', trackId: 'demo-track', stepCount: 128 }));
    await vi.waitFor(() => expect(session.getState().tracks[0].stepCount).toBe(128));

    // Pattern is visible again
    expect(session.getState().tracks[0].steps[64]).toBe(true);   // FAILS with bug
    expect(session.getState().tracks[0].steps[100]).toBe(true);  // FAILS with bug
  });
});
```

### User Story for Demo

> **As a producer**, I want to work on just the first 64 steps of a 128-step pattern without losing my work in steps 65-128, so that I can focus on one section without destroying another.
>
> **Acceptance criteria**:
> - Reducing stepCount hides but does not delete steps beyond the new count
> - Increasing stepCount reveals previously hidden steps
> - Pattern data survives any sequence of stepCount changes

---

## Test Plan

### Failing Test (Write First)

```typescript
describe('set_track_step_count invariants', () => {
  it('should NOT resize arrays when stepCount changes - arrays must stay at MAX_STEPS', async () => {
    const session = createMockSession('test-session');

    // Initialize with a track that has MAX_STEPS length arrays
    session['state'].tracks = [{
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: Array(128).fill(false),
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 128,
    }];

    const ws = session.connect('player-1');
    ws.send(JSON.stringify({
      type: 'set_track_step_count',
      trackId: 'track-1',
      stepCount: 64
    }));

    await vi.waitFor(() => {
      expect(session.getState().tracks[0].stepCount).toBe(64);
    });

    const track = session.getState().tracks[0];

    // These assertions will FAIL with current code
    expect(track.steps.length).toBe(128);
    expect(track.parameterLocks.length).toBe(128);

    // Invariants should pass
    const result = validateStateInvariants(session.getState());
    expect(result.valid).toBe(true);
  });

  it('should preserve step data when reducing stepCount', async () => {
    const session = createMockSession('test-session');

    const steps = Array(128).fill(false);
    steps[100] = true;  // Active step beyond position 64

    session['state'].tracks = [{
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps,
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 128,
    }];

    const ws = session.connect('player-1');

    // Reduce to 64, then back to 128
    ws.send(JSON.stringify({ type: 'set_track_step_count', trackId: 'track-1', stepCount: 64 }));
    await vi.waitFor(() => expect(session.getState().tracks[0].stepCount).toBe(64));

    ws.send(JSON.stringify({ type: 'set_track_step_count', trackId: 'track-1', stepCount: 128 }));
    await vi.waitFor(() => expect(session.getState().tracks[0].stepCount).toBe(128));

    // Step at position 100 should still be there
    expect(session.getState().tracks[0].steps[100]).toBe(true);
  });
});
```

### Additional Tests

1. **All valid step counts**: Loop through `VALID_STEP_COUNTS`, set each, verify arrays stay at 128
2. **Invariant validation**: After each step count change, call `validateStateInvariants`, expect valid
3. **Multiplayer sync**: Two clients change step count, verify state hashes match

---

## Related Issues

### Toggle Step Dynamic Resizing

There's similar dynamic resizing in `handleToggleStep` (`live-session.ts:600-603`):

```typescript
// Ensure steps array is long enough
while (track.steps.length <= msg.step) {
  track.steps.push(false);
}
```

This is **also** an invariant violation, but less severe because:
- It only expands, never truncates
- It's triggered by user action on a specific step
- Repair will eventually pad to 128

Should be audited and potentially fixed together.

---

## Codebase Audit Results

### Mutation Handlers Without Validation

| Handler | Mutates State? | Array Invariant Risk | Calls validateAndRepairState? |
|---------|----------------|---------------------|------------------------------|
| `handleToggleStep` | Yes (steps array) | **YES** (pushes to expand) | ✗ No |
| `handleSetSessionName` | Yes (via KV only) | No | ✗ No (OK) |
| `handleSetTrackStepCount` | Yes (arrays) | **YES** (THE BUG) | ✗ No |
| `handleSetEffects` | Yes (effects object) | No | ✗ No (OK) |
| `handleSetScale` | Yes (scale object) | No | ✗ No (OK) |
| `handleSetFMParams` | Yes (FM params) | No | ✗ No (OK) |

### Array Mutations Found

**In `live-session.ts`:**

| Line | Code | Issue |
|------|------|-------|
| 602 | `track.steps.push(false)` | Expands beyond MAX_STEPS |
| 1038-1039 | `track.steps = [...track.steps, ...new Array(...)]` | Expands (benign) |
| 1042-1043 | `track.steps = track.steps.slice(0, msg.stepCount)` | **TRUNCATES (BUG)** |

**In `mock-durable-object.ts` (test mock replicates bugs):**

| Line | Code | Issue |
|------|------|-------|
| 558-559 | `toTrack.steps = [...fromTrack.steps.slice(0, stepCount)]` | Slices to stepCount |
| 581-582 | Same pattern in handleMoveSequence | Slices to stepCount |
| 584-585 | `new Array(fromTrack.stepCount ?? 16).fill(false)` | Creates non-MAX_STEPS array |
| 645-649 | Same resizing as production | Replicates THE BUG |

### Risk Matrix

| Issue | Severity | Impact | Fix Effort |
|-------|----------|--------|------------|
| `handleSetTrackStepCount` truncation | **HIGH** | Data loss | Low (delete code) |
| `handleToggleStep` expansion | MEDIUM | Temporary violation | Low (delete code) |
| Mock replicating bugs | LOW | Tests won't catch bug | Low (sync with fix) |
| Missing validation calls | LOW | Deferred detection | Medium (add calls) |

### Mock Object Warning

The `mock-durable-object.ts` was written to mirror production code, including the bugs:

```typescript
// mock-durable-object.ts:644-649 - Replicates production bug
if (message.stepCount < oldStepCount) {
  track.steps = track.steps.slice(0, message.stepCount);
  track.parameterLocks = track.parameterLocks.slice(0, message.stepCount);
}
```

**Implication**: Tests using the mock will PASS because the mock also violates invariants. The fix must update both:
1. `live-session.ts` (production)
2. `mock-durable-object.ts` (test mock)

Alternatively, tests should validate against `validateStateInvariants()` directly.

---

## Appendix: Related Code Locations

| File | Lines | Description |
|------|-------|-------------|
| `worker/invariants.ts` | 17 | `MAX_STEPS = 128` constant |
| `worker/invariants.ts` | 227-244 | Array length validation |
| `worker/invariants.ts` | 367-396 | Array repair logic |
| `worker/live-session.ts` | 1014-1058 | `handleSetTrackStepCount` handler |
| `worker/live-session.ts` | 590-603 | `handleToggleStep` dynamic resize |
| `worker/live-session.ts` | 1432-1448 | `validateAndRepairState` method |
| `worker/mock-durable-object.ts` | 644-649 | Mock replicates the bug |
| `worker/mock-durable-object.ts` | 558-559, 581-582 | Other array slicing |
| `shared/sync-types.ts` | 100-106 | `VALID_STEP_COUNTS` definition |
| `types.ts` | 17-27 | Client-side constants |
