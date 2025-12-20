# Bug Patterns

This document captures bug patterns discovered in Keyboardia to prevent recurrence.

## 1. Serialization Boundary Mismatch

**Discovered**: Phase 12 (State Hash Mismatch Investigation)

**Root Cause**: Client and server had parallel type definitions with different optionality, causing JSON serialization to produce different output for logically equivalent state.

### The Pattern

```typescript
// Client type - REQUIRED field
interface Track {
  soloed: boolean;  // Always present
}

// Server type - OPTIONAL field (for "backwards compatibility")
interface SessionTrack {
  soloed?: boolean;  // May be undefined
}
```

When serialized:
- Client: `{"soloed":false}`
- Server: `{}` (undefined fields omitted by JSON.stringify)

### Why It's Dangerous

1. **Silent divergence**: Both sides work correctly in isolation
2. **Comparison failures**: Hashes, equality checks, diffs all fail
3. **Hard to debug**: The data is "the same" logically but different structurally
4. **Scattered fixes**: Normalization gets added in multiple places

### Prevention Checklist

When adding a new field to a type that crosses a serialization boundary:

- [ ] **Same optionality**: If client has `field: T`, server should too (not `field?: T`)
- [ ] **Update parity tests**: Add the field to `TRACK_FIELDS` and `SESSION_TRACK_FIELDS` in `types.test.ts`
- [ ] **Single normalization point**: Add defaults in ONE place, not scattered
- [ ] **Cross-boundary test**: Add a test that verifies both sides produce identical serialization
- [ ] **Document the default**: If field can be missing in stored data, document where/how it's defaulted

### Code Locations

**Type definitions**:
- Client: `src/types.ts` → `Track`
- Server: `src/worker/types.ts` → `SessionTrack`

**Parity test**: `src/worker/types.test.ts`

**Canonical normalization**: `src/sync/canonicalHash.ts` (client), `src/worker/logging.ts` (server)

### Example Fix

Instead of scattered `?? false` throughout the codebase:

```typescript
// BEFORE: Scattered normalization
const soloed = track.soloed ?? false;  // In 6+ places

// AFTER: Single canonical normalization before any comparison
const canonical = canonicalizeForHash(state);  // Normalizes once
const hash = hashState(canonical);
```

---

## 2. Unstable Callback in useEffect Dependency (Connection Storm Bug)

**Discovered**: Phase 12 (WebSocket Connection Storm Investigation)

**Root Cause**: A callback created with `useCallback` had state values in its dependency array. This callback was then passed to a hook that used it as a `useEffect` dependency. Every state change caused the callback to get a new reference, triggering the effect to re-run (disconnect + reconnect).

### The Pattern

```typescript
// BUGGY PATTERN - causes reconnection storm
function MyComponent() {
  const [state, setState] = useState({ tempo: 120 });

  // This callback changes reference when state changes
  const getState = useCallback(() => ({
    tempo: state.tempo,
  }), [state.tempo]);  // <-- Problem: dependency on state

  // This effect re-runs every time getState changes
  useEffect(() => {
    websocket.connect(getState);
    return () => websocket.disconnect();
  }, [getState]);  // <-- Callback in dependency array
}
```

**What happens:**
1. Component renders, effect runs, WebSocket connects
2. User changes tempo → state updates
3. `getState` gets new reference (due to `state.tempo` dependency)
4. useEffect cleanup runs → WebSocket disconnects
5. useEffect runs → WebSocket reconnects with new player ID
6. Repeat for every state change = "connection storm"

### Why It's Dangerous

1. **Performance**: Constant disconnect/reconnect cycles
2. **Data loss**: Queued messages may be lost during disconnect
3. **Server load**: Each reconnect creates new player ID, server sees as new user
4. **Hard to debug**: React DevTools shows clean renders, bug is in reference equality
5. **Cascading effects**: Multiple useEffect hooks may all re-run

### Prevention Checklist

When creating callbacks that will be used as effect dependencies:

- [ ] **Use ref pattern**: Store state in a ref, access via ref in callback
- [ ] **Empty dependency array**: Callback should have `[]` dependencies if possible
- [ ] **Audit downstream effects**: Check if callback is used in any useEffect dependency arrays
- [ ] **Test for stability**: Add tests that verify callback reference doesn't change on state update
- [ ] **Comment the pattern**: Explain WHY the ref pattern is used

### Code Locations

**Fixed example**: `src/App.tsx:113-124` - `getStateForHash` callback

**Test coverage**: `src/hooks/useMultiplayer.test.ts` - Documents both buggy and fixed patterns

**Hook using the callback**: `src/hooks/useMultiplayer.ts:175` - Effect dependency array

### Example Fix

```typescript
// BEFORE: Unstable callback
const getState = useCallback(() => ({
  tempo: state.tempo,
  tracks: state.tracks,
}), [state.tempo, state.tracks]);  // Changes on every state update!

// AFTER: Stable callback using ref pattern
const stateRef = useRef({ tempo: state.tempo, tracks: state.tracks });
stateRef.current = { tempo: state.tempo, tracks: state.tracks };  // Update ref on every render

const getState = useCallback(() => stateRef.current, []);  // Empty deps = stable reference
```

### Detection Script

```bash
# Find potential instances of this pattern
# Look for useCallback with state dependencies that might be effect dependencies
grep -rn "useCallback.*\[.*state\." src/ --include="*.tsx" | grep -v test
```

### Known Instances (Audited 2024)

| File | Status | Notes |
|------|--------|-------|
| App.tsx getStateForHash | ✅ Fixed | Uses ref pattern |
| StepSequencer.tsx handleToggleMute | ⚠️ Watch | state.tracks dep, but local use only |
| TrackRow.tsx handlePitchChange | ⚠️ Watch | track.* deps, but local use only |
| Recorder.tsx handleStopRecording | ✅ Safe | Empty deps |

---

## 3. Computed Value Logged But Not Used

**Discovered**: Phase 25 (Volume P-Lock Investigation)

**Root Cause**: A value is computed, logged for debugging, but never actually passed to the function that needs it. The logging creates a false sense that the feature works.

### The Pattern

```typescript
// BUGGY PATTERN - value computed and logged but not passed
function scheduleNote(track: Track, step: number) {
  const pLock = track.parameterLocks[step];
  const volumeMultiplier = pLock?.volume ?? 1;

  // Looks like it works! But volumeMultiplier is NEVER USED below
  logger.log(`Playing note, vol=${volumeMultiplier}`);

  // Bug: volumeMultiplier not passed to playSample
  audioEngine.playSample(track.sampleId, time, duration);
}

// The function doesn't even accept volume!
function playSample(sampleId: string, time: number, duration: number) {
  // volume parameter is missing entirely
}
```

### Why It's Dangerous

1. **False confidence**: Logging makes it LOOK like the feature works
2. **Untested paths**: If you only check logs, you'll think volume is being applied
3. **Inconsistent behavior**: Some code paths may correctly use the value while others don't
4. **Silent failures**: No error is thrown - the feature just doesn't work
5. **Difficult to detect**: Manual testing might miss it if you don't verify audio output carefully

### Prevention Checklist

When adding a new parameter that flows through multiple layers:

- [ ] **Trace the full path**: Follow the value from input to final use (e.g., UI → state → scheduler → engine → audio)
- [ ] **Check function signatures**: Ensure EVERY function in the chain accepts the parameter
- [ ] **Write end-to-end test**: Verify the parameter actually affects output, not just that it's passed
- [ ] **Search for logging without usage**: `grep` for the variable name and verify it's used, not just logged
- [ ] **Add type-level enforcement**: If a parameter is required, make it non-optional in types

### Detection Script

```bash
# Find potential "logged but not used" bugs
# Look for variables that appear in log statements but might not be passed to functions

# 1. Find all variables being logged
grep -rn "log.*=.*\${" src/ --include="*.ts" | grep -v test

# 2. Check if computed P-lock values are actually used
grep -rn "pLock\?\." src/audio/ --include="*.ts" -A5 | grep -v test
```

### Code Locations

**Scheduler (where P-locks are read)**:
- `src/audio/scheduler.ts:274-340` - P-lock extraction and note scheduling

**Engine methods (where volume should be applied)**:
- `src/audio/engine.ts:playSample()` - Sample playback
- `src/audio/engine.ts:playSynthNote()` - Synth playback
- `src/audio/engine.ts:playToneSynth()` - Tone.js synth playback
- `src/audio/engine.ts:playAdvancedSynth()` - Advanced synth playback
- `src/audio/engine.ts:playSampledInstrument()` - Sampled instrument playback (ONLY ONE THAT WORKS)

### Example Fix

```typescript
// BEFORE: Volume computed but not passed
const volumeMultiplier = pLock?.volume ?? 1;
logger.log(`vol=${volumeMultiplier}`);
audioEngine.playSample(sampleId, time, duration);

// AFTER: Volume passed through entire chain
const volumeMultiplier = pLock?.volume ?? 1;
logger.log(`vol=${volumeMultiplier}`);
audioEngine.playSample(sampleId, time, duration, volumeMultiplier);

// And the function signature must accept it:
playSample(sampleId: string, time: number, duration: number, volume: number = 1) {
  // Apply volume to gain node
  gainNode.gain.value = volume;
}
```

### Known Instances (Fixed Phase 25)

| Location | Parameter | Status | Notes |
|----------|-----------|--------|-------|
| scheduler.ts:342 → playSample | volume | ✅ FIXED | Now passes volumeMultiplier |
| scheduler.ts:300 → playSynthNote | volume | ✅ FIXED | Now passes volumeMultiplier |
| scheduler.ts:312 → playToneSynth | volume | ✅ FIXED | Now passes volumeMultiplier |
| scheduler.ts:324 → playAdvancedSynth | volume | ✅ FIXED | Now passes volumeMultiplier |
| scheduler.ts:337 → playSampledInstrument | volume | ✅ WORKS | Was already correct |

**Phase 25 Fix Summary:**
- Added `volume` parameter to all engine play methods: `playSample`, `playSynthNote`, `playToneSynth`, `playAdvancedSynth`
- Updated scheduler to pass `volumeMultiplier` to all methods
- Updated underlying synth engines: `synthEngine.playNote`, `SynthVoice.start`, `ToneSynthManager.playNote`, `AdvancedSynthEngine.playNoteFrequency`, `AdvancedSynthVoice.triggerAttackRelease`
- Added contract tests in `src/audio/volume-plock.test.ts`

---

## 4. Conditional Assertion Anti-pattern (Test Quality)

**Discovered**: Phase 26 (Weak Test Audit)

**Root Cause**: Tests with `if` conditions around assertions silently pass when the condition isn't met. The test appears to run successfully, but no assertion actually executes.

### The Pattern

```typescript
// BUGGY: Silently passes if condition is false
it('should verify recovery state', () => {
  const mp = multiplayer as Record<string, unknown>;

  if (typeof mp['recoveryState'] === 'string') {
    expect(mp['recoveryState']).not.toBe('applying_snapshot');
  }
  // If recoveryState isn't a string, NO assertion runs!
  // Test passes with 0 assertions.
});
```

### Why It's Dangerous

1. **Silent pass**: Test "passes" but validates nothing
2. **False confidence**: Code coverage shows lines as tested
3. **Regression blind spot**: When condition becomes false, bugs go undetected
4. **Hard to catch in review**: The test LOOKS correct at first glance

### Prevention Checklist

- [ ] **Unconditional assertions**: Always have at least one assertion that runs
- [ ] **Explicit existence checks**: If checking for property, assert explicitly: `expect('prop' in obj).toBe(true)` or `expect('prop' in obj).toBe(false)`
- [ ] **Use vitest's expect.assertions(n)**: Declare expected assertion count at test start
- [ ] **Review test output**: Check that tests run >0 assertions

### Example Fix

```typescript
// BEFORE: Conditional assertion silently passes
if (typeof mp['recoveryState'] === 'string') {
  expect(mp['recoveryState']).not.toBe('applying_snapshot');
}

// AFTER: Explicit unconditional check
it('old 3-state recovery enum no longer exists', () => {
  const mp = multiplayer as Record<string, unknown>;

  // Directly test what we care about
  const hasOldEnum =
    mp['recoveryState'] === 'idle' ||
    mp['recoveryState'] === 'applying_snapshot' ||
    mp['recoveryState'] === 'requesting_snapshot';

  expect(hasOldEnum).toBe(false);  // Always runs
});
```

### Detection Script

```bash
# Find conditional assertions in tests
grep -rn "if.*\['" test/ --include="*.ts" | grep -v ".test.ts.snap"
```

---

## 5. Meaningless Import Verification (Test Quality)

**Discovered**: Phase 26 (Weak Test Audit)

**Root Cause**: Tests that only verify an import succeeded provide no value. If the import failed, the test would throw before reaching the assertion anyway.

### The Pattern

```typescript
// WEAK: Only checks import didn't throw
it('types module exports correctly', async () => {
  const types = await import('../../src/worker/types');
  expect(types).toBeDefined();  // Always true if import succeeded!
});
```

### Why It's Dangerous

1. **Zero validation**: The assertion can never fail if import works
2. **False coverage**: Appears to test the module but tests nothing
3. **Maintenance burden**: Takes time to run/maintain useless tests
4. **Blocks real tests**: Developers may skip writing real tests, thinking module is covered

### Prevention Checklist

- [ ] **Test actual exports**: Verify specific functions/values from the module
- [ ] **Test behavior**: Call exported functions with inputs, verify outputs
- [ ] **Test type conformance**: Create objects that conform to exported types, verify structure
- [ ] **Delete pure import tests**: If a test only imports and asserts `.toBeDefined()`, delete it

### Example Fix

```typescript
// BEFORE: Meaningless import check
const types = await import('../../src/worker/types');
expect(types).toBeDefined();

// AFTER: Verify actual exports and behavior
it('MUTATING_MESSAGE_TYPES contains expected message types', async () => {
  const { MUTATING_MESSAGE_TYPES, isStateMutatingMessage } = await import('../../src/worker/types');

  // Verify the Set exists and has expected content
  expect(MUTATING_MESSAGE_TYPES).toBeInstanceOf(Set);
  expect(MUTATING_MESSAGE_TYPES.has('toggle_step')).toBe(true);
  expect(MUTATING_MESSAGE_TYPES.has('set_tempo')).toBe(true);

  // Verify the function works
  expect(isStateMutatingMessage('toggle_step')).toBe(true);
  expect(isStateMutatingMessage('play')).toBe(false);
});
```

### Detection Script

```bash
# Find meaningless toBeDefined() assertions on imports
grep -rn "toBeDefined()" test/ --include="*.ts" -B2 | grep "import\|require"
```

---

## 6. Mutation Without Delivery Confirmation (Sync Reliability)

**Discovered**: Phase 26 (MUTATION-TRACKING Spec)

**Root Cause**: Client sends mutations to server but doesn't track whether the server acknowledged them. Network drops message silently, user's changes are lost.

### The Pattern

```typescript
// BUGGY: Fire and forget mutation
function sendMutation(mutation) {
  websocket.send(JSON.stringify(mutation));
  // No tracking! No confirmation! Hope for the best!
}

// User clicks save, mutation sent, network drops it
// Client shows success, server never received it
// Data is lost forever
```

### Why It's Dangerous

1. **Silent data loss**: User thinks change was saved
2. **Inconsistent state**: Client shows one thing, server has another
3. **Hard to reproduce**: Works 99% of time, fails on network hiccup
4. **No recovery**: Without tracking, can't know what was lost

### Prevention Checklist

- [ ] **Assign sequence numbers**: Every mutation gets a unique `clientSeq`
- [ ] **Track pending mutations**: Map of seq → mutation + timestamp
- [ ] **Confirm on echo**: Server echoes back `clientSeq`, client removes from pending
- [ ] **Timeout detection**: If mutation pending > 30s, mark as lost
- [ ] **Invariant check on snapshot**: Compare pending mutations against received state

### Code Locations

**Client tracking**: `src/sync/multiplayer.ts` - `pendingMutations` Map, `trackMutation()`, `confirmMutation()`

**Server echo**: `src/worker/live-session.ts` - `broadcast()` includes `clientSeq`

**Invariant check**: `src/sync/multiplayer.ts` - `checkMutationInvariant()`

### Example Fix

```typescript
// BEFORE: Untracked mutation
send(mutation) {
  this.ws.send(JSON.stringify(mutation));
}

// AFTER: Tracked mutation with confirmation
send(mutation) {
  const seq = ++this.clientSeq;
  const tracked = { ...mutation, seq, timestamp: Date.now() };

  this.pendingMutations.set(seq, tracked);
  this.ws.send(JSON.stringify({ ...mutation, seq }));

  // Timeout after 30s
  setTimeout(() => {
    if (this.pendingMutations.has(seq)) {
      this.pendingMutations.delete(seq);
      this.lostMutations++;
      console.warn(`INVARIANT VIOLATION: Mutation ${seq} not confirmed`);
    }
  }, 30000);
}

// On server echo
handleServerMessage(msg) {
  if (msg.clientSeq && this.pendingMutations.has(msg.clientSeq)) {
    this.pendingMutations.delete(msg.clientSeq);
    this.confirmedMutations++;
  }
}
```

---

## 7. Snapshot Overwriting Pending Work (Sync Reliability)

**Discovered**: Phase 26 (MUTATION-TRACKING Spec)

**Root Cause**: When a snapshot arrives (on reconnect or sync mismatch), it replaces local state entirely without checking if user has pending mutations. Recent changes are silently lost.

### The Pattern

```typescript
// BUGGY: Snapshot overwrites pending work
handleSnapshot(snapshot) {
  // User just toggled 5 steps, but network was slow
  // Snapshot arrives with old state, wipes out their work
  this.state = snapshot.state;  // LOST: pending mutations
  this.notifyUI();              // UI shows old state, user confused
}
```

### Why It's Dangerous

1. **User work vanishes**: Steps they just toggled disappear
2. **No warning**: User doesn't know their work was lost
3. **Frustrating UX**: "I just clicked that!" experience
4. **Trust erosion**: Users stop trusting the app to save their work

### Prevention Checklist

- [ ] **Check pending count**: Before applying snapshot, check `pendingMutations.size`
- [ ] **Compare timestamps**: Is snapshot older than pending mutations?
- [ ] **Log conflicts**: Warn about each pending mutation that snapshot overwrites
- [ ] **Consider re-apply**: For simple mutations (toggle step), re-apply after snapshot
- [ ] **UI indication**: Show user when pending changes exist, warn before refresh

### Code Locations

**Snapshot handling**: `src/sync/multiplayer.ts` - `handleSnapshot()`

**Invariant check**: `src/sync/multiplayer.ts` - `checkMutationInvariant()`

**Pending tracking**: `src/sync/multiplayer.ts` - `pendingMutations` Map

### Example Fix

```typescript
// BEFORE: Snapshot blindly overwrites
handleSnapshot(snapshot) {
  this.state = snapshot.state;
}

// AFTER: Check pending mutations, log conflicts
handleSnapshot(snapshot) {
  // Check for pending mutations that might be lost
  if (this.pendingMutations.size > 0) {
    console.warn(
      `INVARIANT VIOLATION: Snapshot received with ${this.pendingMutations.size} pending mutations. ` +
      `These changes may be lost.`
    );

    // Log each pending mutation for debugging
    for (const [seq, mutation] of this.pendingMutations) {
      const age = Date.now() - mutation.timestamp;
      console.warn(`  - Pending mutation ${seq} (${mutation.type}, age=${age}ms)`);
    }

    // Mark pending mutations as lost
    this.lostMutations += this.pendingMutations.size;
    this.pendingMutations.clear();
  }

  this.state = snapshot.state;
}
```

---

## 8. DO Hibernation State Loss (Durable Object Persistence)

**Discovered**: Phase 26 (Hibernation Audit)

**Root Cause**: Durable Objects can hibernate at any time when idle (no active WebSocket connections or pending requests). When they wake up, ALL class instance variables are reset to their constructor defaults. Only data explicitly persisted to `ctx.storage` survives hibernation.

### The Pattern

```typescript
// BUGGY: In-memory state that resets on hibernation
export class LiveSessionDO extends DurableObject {
  // This flag is lost when DO hibernates!
  private pendingKVSave: boolean = false;

  private scheduleKVSave(): void {
    this.pendingKVSave = true;  // Set in memory only
    this.ctx.storage.setAlarm(Date.now() + 5000);  // Alarm survives hibernation
  }

  async alarm(): Promise<void> {
    // After hibernation, pendingKVSave is false again!
    if (this.pendingKVSave) {  // Always false after hibernation
      await this.saveToKV();   // Never runs!
    }
  }
}
```

**Timeline of the bug:**
1. User makes changes → `scheduleKVSave()` sets `pendingKVSave = true`
2. All users disconnect → DO becomes idle
3. DO hibernates → class instance destroyed, `pendingKVSave` lost
4. Alarm fires → DO wakes up with `pendingKVSave = false`
5. `alarm()` runs but skips save → Changes never saved to KV!
6. Next user connects → Gets stale state from KV

### Why It's Dangerous

1. **Silent data loss**: User changes are lost without any error
2. **Intermittent failure**: Only fails after hibernation, works fine during active use
3. **Hard to reproduce**: Must simulate idle period + hibernation
4. **False confidence**: Code looks correct, passes unit tests
5. **Delayed symptom**: Data loss only noticed on next session load

### Prevention Checklist

When working with Durable Objects:

- [ ] **Audit class variables**: List all `private` variables that hold state across operations
- [ ] **Categorize each variable**:
  - Transient (can reconstruct from WebSocket attachments/storage): OK to lose
  - Critical (must survive hibernation): MUST persist to `ctx.storage`
  - Presence-only (nice-to-have): Decide based on UX impact
- [ ] **Persist immediately**: When critical state changes, write to `ctx.storage` synchronously
- [ ] **Check in alarm()**: Always check PERSISTED flag, not class variable
- [ ] **Test hibernation**: Add tests that call `simulateHibernation()` before alarm
- [ ] **Document persistence**: Comment which variables are persisted and where

### Variable Classification for LiveSessionDO

| Variable | Survives Hibernation? | Mechanism | Status |
|----------|----------------------|-----------|--------|
| `players` | Yes | `ctx.getWebSockets()` + attachments | ✅ Correct |
| `state` | Yes | `ctx.storage.put('state')` | ✅ Correct |
| `sessionId` | Yes | `ctx.storage.put('sessionId')` | ✅ Correct |
| `pendingKVSave` | Yes | `ctx.storage.put('pendingKVSave')` | ✅ Fixed |
| `serverSeq` | Yes | `ctx.storage.put('serverSeq')` | ✅ Correct |
| `playingPlayers` | **No** | Not persisted | ⚠️ See Finding #1 |
| `immutable` | Yes | Loaded from KV on state load | ✅ Correct |
| `stateLoaded` | N/A | Correctly resets (triggers reload) | ✅ Correct |

### Code Locations

**Durable Object class**: `src/worker/live-session.ts`

**Correct persistence pattern**:
- `scheduleKVSave()` (line 1188-1212): Persists state AND flag to DO storage
- `alarm()` (line 1224-1255): Checks PERSISTED flag, not class variable

**Hibernation test helper**: `src/worker/mock-durable-object.ts:554-561`

### Example Fix (Already Applied)

```typescript
// BEFORE: Only in-memory flag
private scheduleKVSave(): void {
  this.pendingKVSave = true;  // Lost on hibernation!
  this.ctx.storage.setAlarm(Date.now() + 5000);
}

async alarm(): Promise<void> {
  if (this.pendingKVSave) {  // Always false after hibernation!
    await this.saveToKV();
  }
}

// AFTER: Persist both flag AND state to DO storage
private scheduleKVSave(): void {
  this.pendingKVSave = true;

  // Persist to DO storage so it survives hibernation
  const persistPromises = [
    this.ctx.storage.put('pendingKVSave', true),
    this.ctx.storage.put('sessionId', this.sessionId),
  ];

  if (this.state) {
    persistPromises.push(this.ctx.storage.put('state', this.state));
  }

  Promise.all(persistPromises).catch(console.error);
  this.ctx.storage.setAlarm(Date.now() + KV_SAVE_DEBOUNCE_MS);
}

async alarm(): Promise<void> {
  // Check PERSISTED flag (survives hibernation)
  const persistedPending = await this.ctx.storage.get<boolean>('pendingKVSave');

  if (this.pendingKVSave || persistedPending) {
    // If we don't have state in memory (hibernation), load from DO storage
    if (!this.state) {
      const storedState = await this.ctx.storage.get<SessionState>('state');
      if (storedState) {
        this.state = storedState;
      }
    }

    await this.saveToKV();
    this.pendingKVSave = false;
    await this.ctx.storage.delete('pendingKVSave');
  }
}
```

### Detection Script

```bash
# Find class variables in Durable Objects that might need persistence
# Look for private variables that aren't reconstructed from storage

# 1. List all private class variables in DO files
grep -rn "private \w\+:" src/worker/live-session.ts | head -20

# 2. Check if variables are persisted
for VAR in pendingKVSave state sessionId serverSeq playingPlayers; do
  echo "=== $VAR ==="
  grep -n "storage.put.*$VAR\|storage.get.*$VAR" src/worker/live-session.ts
done

# 3. Check alarm() implementation
grep -A30 "async alarm()" src/worker/live-session.ts
```

---

## 9. [Template for Future Patterns]

**Discovered**: [Phase/Date]

**Root Cause**: [Brief description]

### The Pattern
[Code example showing the problematic pattern]

### Why It's Dangerous
[List of consequences]

### Prevention Checklist
[Actionable items]

### Code Locations
[Where to look/fix]

### Example Fix
[Before/after code]
