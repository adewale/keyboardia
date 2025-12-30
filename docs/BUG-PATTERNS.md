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

## 9. Async Engine Initialization Race Condition

**Discovered**: Phase 29 (Fat Saw / Thick Instruments Not Producing Sound)

**Root Cause**: The audio engine has two-stage initialization: `initialize()` for basic audio, and `initializeTone()` for Tone.js synths and effects. When `initialize()` completes, it fires `initializeTone()` asynchronously (fire-and-forget). Code that checks `isInitialized()` returns true, but `isToneSynthReady()` returns false because Tone.js is still initializing.

### The Pattern

```typescript
// BUGGY: Only checks basic initialization, not Tone.js readiness
async function handlePreview(instrumentId: string) {
  const engine = await tryGetEngineForPreview();
  if (!engine) return;

  // engine.isInitialized() returns true, but Tone.js may not be ready!

  if (instrumentId.startsWith('advanced:')) {
    const preset = instrumentId.replace('advanced:', '');
    // This fails silently - advancedSynth is null
    engine.playAdvancedSynth(preset, 0, time, 0.3);
  }
}

// In the engine:
playAdvancedSynth(preset, ...args) {
  if (!this.advancedSynth) {  // null during Tone.js init!
    logger.warn('Cannot play: not initialized');
    return;  // Silent failure
  }
}
```

**Timeline of the bug:**
1. User triggers audio (play button, first tap)
2. `engine.initialize()` completes, sets `initialized = true`
3. `initializeTone()` starts async (not awaited)
4. User hovers over "Fat Saw" instrument panel
5. `tryGetEngineForPreview()` returns engine (initialized = true)
6. Code calls `playAdvancedSynth()` but `advancedSynth = null`
7. Silent failure - no sound, no error visible to user

### Why It's Dangerous

1. **Timing-dependent failure**: Works after a few seconds, fails immediately after load
2. **Silent failure**: Log warning goes to console, user just sees no sound
3. **Inconsistent behavior**: Regular synths work, advanced synths don't
4. **Hard to reproduce**: Only happens in the narrow window during Tone.js init
5. **False confidence**: Some instrument types work fine, masking the bug

### Prevention Checklist

When playing instruments that require Tone.js:

- [ ] **Trigger initialization proactively**: Call `initializeTone()` when needed, don't just skip
- [ ] **Check readiness after init**: Use `isToneSynthReady('tone')` or `isToneSynthReady('advanced')` after awaiting init
- [ ] **Fresh timestamps**: Get `getCurrentTime()` AFTER any async operations, not before
- [ ] **Consistent handling**: Handle ALL instrument types (synth, tone, advanced, sampled) with proper init
- [ ] **Document init stages**: Comment which init stage is required for each feature
- [ ] **Add debug tooling**: Include readiness checks in debug utilities

**CRITICAL INSIGHT**: The first version of this fix just added readiness checks that skipped silently when not ready. This made the problem WORSE because instruments never played. The correct fix is to trigger `initializeTone()` when needed, then play after it completes.

### Detection Script

```bash
# Find playAdvancedSynth/playToneSynth calls without readiness checks
grep -rn "playAdvancedSynth\|playToneSynth" src/components/ --include="*.tsx" | \
  grep -v "isToneSynthReady"

# Check for consistent handling across instrument types
grep -rn "else if.*startsWith\('advanced:\'\)" src/ --include="*.tsx" -A3 | \
  grep -v "isToneSynthReady"
```

### Code Locations

**Fixed locations (trigger init, then check readiness):**
- `src/components/SamplePicker.tsx:70-105` - Hover preview now triggers init for tone/advanced
- `src/components/SamplePicker.tsx:114-120` - Track selection triggers init for tone/advanced
- `src/components/ChromaticGrid.tsx:81-98` - Note preview now triggers init for tone/advanced

**Engine initialization:**
- `src/audio/engine.ts:139` - `initializeTone()` fired async (intentional for UX)
- `src/audio/engine.ts:406-415` - `isToneSynthReady()` checks for specific engine types

**Already correct:**
- `src/audio/scheduler.ts:358-370` - Scheduler checks readiness (logs warning if not ready)
- `src/components/StepSequencer.tsx:60-62` - Awaits Tone.js init before playback

### Example Fix

```typescript
// BEFORE: No initialization - just fails silently
} else if (instrumentId.startsWith('advanced:')) {
  const preset = instrumentId.replace('advanced:', '');
  audioEngine.playAdvancedSynth(preset, 0, currentTime, 0.3);
}

// WRONG FIX: Just checking readiness (skips silently - never plays!)
} else if (instrumentId.startsWith('advanced:')) {
  if (audioEngine.isToneSynthReady('advanced')) {
    // This never runs if Tone.js never initialized!
    audioEngine.playAdvancedSynth(preset, 0, currentTime, 0.3);
  }
}

// CORRECT FIX: Trigger initialization, then play
} else if (instrumentId.startsWith('advanced:')) {
  // Ensure Tone.js is initialized for advanced: instruments
  if (!audioEngine.isToneInitialized()) {
    await audioEngine.initializeTone();
  }
  if (audioEngine.isToneSynthReady('advanced')) {
    const preset = instrumentId.replace('advanced:', '');
    // Get fresh time AFTER async operations
    audioEngine.playAdvancedSynth(preset, 0, audioEngine.getCurrentTime(), 0.3);
  }
  // If not ready, silently skip (same as sampled instruments)
}
```

### Consistent Pattern for All Instrument Types

```typescript
// Full pattern with readiness checks for ALL types
if (sampleId.startsWith('synth:')) {
  // Native Web Audio synth - no Tone.js needed
  const preset = sampleId.replace('synth:', '');
  audioEngine.playSynthNote(noteId, preset, pitch, time, duration);

} else if (sampleId.startsWith('tone:')) {
  // Tone.js synth - check readiness
  if (audioEngine.isToneSynthReady('tone')) {
    const preset = sampleId.replace('tone:', '');
    audioEngine.playToneSynth(preset, pitch, time, duration);
  }

} else if (sampleId.startsWith('advanced:')) {
  // Advanced synth (dual oscillator) - check readiness
  if (audioEngine.isToneSynthReady('advanced')) {
    const preset = sampleId.replace('advanced:', '');
    audioEngine.playAdvancedSynth(preset, pitch, time, duration);
  }

} else if (sampleId.startsWith('sampled:')) {
  // Sampled instrument - check if loaded
  const instrument = sampleId.replace('sampled:', '');
  if (audioEngine.isSampledInstrumentReady(instrument)) {
    audioEngine.playSampledInstrument(instrument, noteId, midiNote, time, duration);
  }

} else {
  // Regular procedural sample - always available
  audioEngine.playSample(sampleId, noteId, time, duration, 'oneshot', pitch);
}
```

### Debug Tooling

```javascript
// In browser console: window.audioDebug.status()
// Shows:
// - initialized: true
// - toneInitialized: true/false
// - engineReadiness: { sample: true, synth: true, tone: true/false, advanced: true/false }

// Test specific instrument:
await window.audioDebug.testInstrument('advanced:supersaw')
// Returns: { status: 'success' | 'error', error?: 'engine not ready' }
```

---

## 10. Silent Skip Anti-Pattern (Defensive Check Without Recovery)

**Discovered**: Phase 29 (Second attempt at fixing Fat Saw / Thick instruments)

**Root Cause**: When fixing a race condition or availability issue, the instinctive "fix" is to add a guard clause that checks if a resource is ready and skips if not. But if the resource is **never** initialized proactively, the guard clause causes **permanent** silent failure.

### The Pattern

```typescript
// ORIGINAL BUG: No check at all
async function handlePreview(instrumentId: string) {
  const engine = await getEngine();
  if (instrumentId.startsWith('advanced:')) {
    // Crashes or fails silently if advancedSynth is null
    engine.playAdvancedSynth(preset, 0, time, 0.3);
  }
}

// "FIX" ATTEMPT: Add defensive check
async function handlePreview(instrumentId: string) {
  const engine = await getEngine();
  if (instrumentId.startsWith('advanced:')) {
    // Check if ready, skip if not
    if (engine.isToneSynthReady('advanced')) {  // ← THE TRAP
      engine.playAdvancedSynth(preset, 0, time, 0.3);
    }
    // Silent skip - no error, no sound, no feedback
  }
}
```

**Why this "fix" makes things worse:**

1. Original bug: Crashes or fails for ~2 seconds during init window
2. "Fixed" bug: Fails **forever** if init never triggered

**The trap:**
- Developer adds check: "if not ready, skip"
- Assumes something else will initialize the resource
- But nothing does - the check becomes a permanent gate
- User gets zero feedback - just silence

### Timeline of the Meta-Bug

1. User reports: "Fat Saw doesn't make sound"
2. Developer investigates: "Ah, advancedSynth is null during Tone.js init"
3. Developer adds fix: `if (isToneSynthReady('advanced')) { play(); }`
4. Developer tests: Sound works (because Tone.js initialized during testing)
5. Deploy to production
6. User loads fresh page, hovers immediately → **still no sound**
7. User reports: "Still broken"
8. Developer confused: "But I added the check!"

**The actual sequence:**
1. Page loads → `initialize()` called
2. `initializeTone()` starts async (fire-and-forget)
3. User hovers over Fat Saw (before Tone.js ready)
4. `isToneSynthReady('advanced')` returns `false`
5. Guard clause skips → no sound
6. User waits... nothing happens
7. User hovers again → `isToneSynthReady()` now `true` → sound works!
8. But on fresh page load, same problem repeats

### Why It's Dangerous

1. **Permanent failure mode**: Unlike the original race condition (temporary), this fails forever until something else triggers init
2. **No error signal**: Original might log warnings; skip is completely silent
3. **Intermittent appearance**: Works on second try, fails on first - hard to reproduce
4. **False sense of security**: "I added the check, it must be safe now"
5. **Debugging misdirection**: Developer looks for what's breaking, not what's preventing execution
6. **Cargo cult spread**: Other developers copy the "check and skip" pattern

### The Cognitive Trap

The pattern feels correct because:
- Defensive programming says "check before use"
- Guard clauses are good practice
- "Skip if not ready" sounds safe

But it ignores the question: **"What ensures the resource becomes ready?"**

### Prevention Checklist

Before adding a "check and skip" guard:

- [ ] **Ask: "Who initializes this resource?"** - If "fire-and-forget" or "lazy", you have a problem
- [ ] **Ask: "Will this ever become ready?"** - Trace the initialization path
- [ ] **Prefer "ensure then use" over "check and skip"**: Trigger init, await it, then use
- [ ] **Add timeout/retry for lazy resources**: If skipping, retry after delay
- [ ] **Log skips at INFO level**: Make silent skips visible in console
- [ ] **Consider user feedback**: Can we show "loading..." instead of nothing?

### Correct Fix Pattern

```typescript
// WRONG: Check and skip
if (engine.isToneSynthReady('advanced')) {
  engine.playAdvancedSynth(preset, 0, time, 0.3);
}

// RIGHT: Ensure and use
if (!engine.isToneInitialized()) {
  await engine.initializeTone();  // ← Proactive initialization
}
if (engine.isToneSynthReady('advanced')) {
  // Get fresh time AFTER async operation
  engine.playAdvancedSynth(preset, 0, engine.getCurrentTime(), 0.3);
}
```

### Detection Questions

When reviewing "check and skip" code, ask:

1. What triggers the initialization?
2. Is that trigger guaranteed to run before this check?
3. What happens if it doesn't?
4. Can we trigger initialization here instead of skipping?

### Related Patterns in Other Domains

| Domain | Silent Skip Anti-Pattern | Correct Pattern |
|--------|-------------------------|-----------------|
| Database | `if (conn.isConnected()) query()` | `await conn.ensureConnected(); query()` |
| Auth | `if (user.isLoggedIn()) fetchData()` | `await auth.ensureSession(); fetchData()` |
| Cache | `if (cache.has(key)) return cache.get(key)` | `return cache.getOrFetch(key, fetchFn)` |
| Feature flags | `if (feature.isEnabled()) show()` | `await features.load(); if (enabled) show()` |
| WebSocket | `if (ws.isOpen()) send()` | `await ws.ensureOpen(); send()` |

### Code Locations (Keyboardia-specific)

**Original silent skip (wrong):**
```typescript
// src/components/SamplePicker.tsx (before fix)
if (audioEngine.isToneSynthReady('advanced')) {
  audioEngine.playAdvancedSynth(preset, 0, currentTime, 0.3);
}
// No sound if Tone.js not initialized - silent failure
```

**Corrected to ensure-and-use:**
```typescript
// src/components/SamplePicker.tsx (after fix)
if (!audioEngine.isToneInitialized()) {
  await audioEngine.initializeTone();
}
if (audioEngine.isToneSynthReady('advanced')) {
  audioEngine.playAdvancedSynth(preset, 0, audioEngine.getCurrentTime(), 0.3);
}
```

### Key Lesson

> **"Check and skip" guards availability issues. "Ensure and use" solves them.**

When a resource might not be ready, the question isn't "how do I avoid crashing?" - it's "how do I make sure it's ready?"

---

## 11. Tone.js Context Suspension Desync

**Discovered**: Phase 29 (Instruments Stop Working)

**Root Cause**: When the browser suspends the AudioContext (e.g., tab goes to background), the Web Audio API stops producing sound. When resumed, we call `audioContext.resume()` but don't also resume Tone.js, leaving Tone.js synths (advanced:*, tone:*) in a desync state.

### The Pattern

```typescript
// WRONG: Only resume Web Audio context
async ensureAudioReady(): Promise<boolean> {
  if (this.audioContext.state === 'suspended') {
    await this.audioContext.resume();  // ← Only resumes Web Audio
    // Tone.js context may still be in bad state!
  }
  return this.audioContext.state === 'running';
}

// User experience:
// 1. Tab goes to background → AudioContext suspended
// 2. Tab returns → user clicks → ensureAudioReady() resumes Web Audio
// 3. Native synths (synth:*) work ✓
// 4. Tone.js synths (advanced:*, tone:*) are silent ✗
```

### Why It's Dangerous

1. **Intermittent failure**: Works initially, stops after context suspension
2. **Hard to reproduce**: Requires tab switch/background/wake-from-sleep
3. **Partial failure**: Native Web Audio works, Tone.js doesn't
4. **User confusion**: "It worked earlier, now it doesn't"
5. **Silent**: No errors, just no sound

### The Fix

```typescript
// RIGHT: Resume both Web Audio AND Tone.js contexts
async ensureAudioReady(): Promise<boolean> {
  if (this.audioContext.state === 'suspended') {
    await this.audioContext.resume();

    // Also resume Tone.js if initialized
    if (this.toneInitialized) {
      await Tone.start();  // ← Ensures Tone.js context is running
    }
  }
  return this.audioContext.state === 'running';
}
```

### Prevention Checklist

When working with hybrid audio systems (Web Audio + Tone.js):

- [ ] **Dual resume**: Always resume both contexts together
- [ ] **Unlock listeners**: Audio unlock handlers should resume both
- [ ] **Context sync check**: Verify `Tone.getContext().rawContext === audioContext`
- [ ] **Test suspension**: Manually test tab backgrounding
- [ ] **Debug tooling**: Add `audioDebug.repairContext()` for diagnosis

### Detection Questions

1. Are there multiple audio libraries/contexts in use?
2. Does the code resume all of them when the main context resumes?
3. Have you tested with tab backgrounding/foregrounding?
4. Is there a way to diagnose context desync?

### Code Locations

**AudioEngine unlock handlers:**
- `src/audio/engine.ts` → `attachUnlockListeners()` - must resume Tone.js too
- `src/audio/engine.ts` → `ensureAudioReady()` - must resume Tone.js too

**Debug tooling:**
- `src/debug/audio-debug.ts` → `repairContext()` - diagnose and repair
- `src/debug/audio-debug.ts` → `testToneJsDirect()` - test Tone.js isolation

---

## 12. Tone.js AudioContext Auto-Creation Mismatch

**Discovered**: Phase 29 (Instruments Stop Working - Part 2)

**Root Cause**: Tone.js automatically creates its own AudioContext when imported. If `initializeTone()` is called before the AudioEngine has created its own AudioContext, or if we try to close Tone.js's context before switching, Tone.js internal state becomes corrupted.

### The Pattern

**Problem 1**: Calling initializeTone() too early
```typescript
// BAD: initializeTone() called when AudioEngine.audioContext is null
async initializeTone() {
  if (this.audioContext) {
    Tone.setContext(this.audioContext);  // Skipped because audioContext is null!
  }
  await Tone.start();  // Tone.js uses its own context
}
// Later: AudioEngine creates its own context → MISMATCH
```

**Problem 2**: Closing Tone.js context corrupts internal state
```typescript
// BAD: Closing the old context breaks Tone.js
if (existingToneContext.rawContext !== this.audioContext) {
  await existingToneContext.rawContext.close();  // CORRUPTS TONE.JS!
}
Tone.setContext(this.audioContext);
await Tone.start();  // ERROR: Cannot read property 'resume' of null
```

### Why It's Dangerous

1. **Silent failure**: Tone.js synths (advanced:*, tone:*) won't produce sound
2. **Null pointer errors**: Closing the context makes `rawContext` null, causing crashes
3. **Hard to reproduce**: Only happens with specific timing (HMR, early API calls)
4. **No obvious symptoms**: Basic synths still work, only advanced synths fail

### The Fix

```typescript
async initializeTone(): Promise<void> {
  // CRITICAL: Require AudioEngine to be initialized first
  if (!this.audioContext) {
    throw new Error('Cannot initialize Tone.js: AudioEngine.audioContext is not set.');
  }

  // Just set our context - DON'T close the old one (let it be GC'd)
  const existingToneContext = Tone.getContext();
  if (existingToneContext.rawContext !== this.audioContext) {
    logger.audio.log('Switching Tone.js to engine context (old context will be GC\'d)');
  }
  Tone.setContext(this.audioContext);
  await Tone.start();
}
```

### Prevention Checklist

- [ ] **Never close Tone.js context**: Let old contexts be garbage collected
- [ ] **Require audioContext exists**: Throw if initializeTone() called without audioContext
- [ ] **Guard debug tools**: forceInitAndTest() should check engine.isInitialized() first
- [ ] **Test HMR scenarios**: Verify audio works after hot reload

### Code Locations

**AudioEngine initialization:**
- `src/audio/engine.ts` → `initializeTone()` - must require audioContext exists

**Debug tooling:**
- `src/debug/audio-debug.ts` → `forceInitAndTest()` - must check isInitialized() first

---

## 13. [Template for Future Patterns]

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
