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

## 3. [Template for Future Patterns]

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
