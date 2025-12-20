# Solo/Mute Sync Analysis: "My Ears, My Control"

## Executive Summary

This research document analyzes whether Solo and Mute actions should sync between users in Keyboardia's collaborative music sequencer. The current implementation intends for these to be "local-only" (each user controls their own audio mix), but there is an **architectural inconsistency** where hash verification and snapshot recovery can inadvertently override local mute/solo state.

**Recommendation: Keep Local-Only, But Fix the Hash Inconsistency**

---

## 1. Current State Machine

### 1.1 State Tracked

Each track stores independent boolean flags:

```typescript
// From src/types.ts (lines 41-54)
interface Track {
  id: string;
  name: string;
  muted: boolean;    // User explicitly muted this track
  soloed: boolean;   // User explicitly soloed this track
  // ... other fields
}
```

### 1.2 Actions

Four actions handle mute/solo state (from `src/types.ts`, lines 82-85):

| Action | Effect |
|--------|--------|
| `TOGGLE_MUTE` | Toggles `track.muted` for a specific track |
| `TOGGLE_SOLO` | Toggles `track.soloed` for a specific track |
| `EXCLUSIVE_SOLO` | Un-solos all others, solos only this track |
| `CLEAR_ALL_SOLOS` | Sets all tracks to `soloed: false` |

Note: `EXCLUSIVE_SOLO` and `CLEAR_ALL_SOLOS` exist in the reducer but are NOT exposed in the UI (per SOLO.md spec).

### 1.3 Reducer Behavior

From `src/state/grid.tsx` (lines 98-129):

```typescript
case 'TOGGLE_MUTE': {
  const tracks = state.tracks.map((track) => {
    if (track.id !== action.trackId) return track;
    return { ...track, muted: !track.muted };
  });
  return { ...state, tracks };
}

case 'TOGGLE_SOLO': {
  const tracks = state.tracks.map((track) => {
    if (track.id !== action.trackId) return track;
    return { ...track, soloed: !track.soloed };
  });
  return { ...state, tracks };
}

case 'EXCLUSIVE_SOLO': {
  // Un-solo all others, solo only this track
  const tracks = state.tracks.map((track) => ({
    ...track,
    soloed: track.id === action.trackId,
  }));
  return { ...state, tracks };
}

case 'CLEAR_ALL_SOLOS': {
  const tracks = state.tracks.map((track) => ({
    ...track,
    soloed: false,
  }));
  return { ...state, tracks };
}
```

### 1.4 Playback Logic

From `specs/SOLO.md`:

```typescript
function shouldTrackPlay(track: Track, tracks: Track[]): boolean {
  const anySoloed = tracks.some(t => t.soloed);

  if (anySoloed) {
    // Solo mode: only soloed tracks play
    return track.soloed;
  } else {
    // Normal mode: respect mute state
    return !track.muted;
  }
}
```

**Key behavior: Solo wins over Mute.** A track that is both muted and soloed will play.

### 1.5 Current Sync Behavior

**Intended: Local-Only**

From `src/sync/multiplayer.ts` (lines 1641-1654):

```typescript
private handleTrackMuted(msg: { trackId: string; muted: boolean; playerId: string }): void {
  // Mute is LOCAL ONLY - "my ears, my control"
  // We receive the message but don't apply it to local state
  // Each user controls their own mix
  if (msg.playerId === this.state.playerId) return;
  logger.multiplayer.log('Remote mute (not applied locally):', msg.trackId, msg.muted, 'by', msg.playerId);
}

private handleTrackSoloed(msg: { trackId: string; soloed: boolean; playerId: string }): void {
  // Solo is LOCAL ONLY - "my ears, my control"
  // We receive the message but don't apply it to local state
  // Each user controls their own focus
  if (msg.playerId === this.state.playerId) return;
  logger.multiplayer.log('Remote solo (not applied locally):', msg.trackId, msg.soloed, 'by', msg.playerId);
}
```

**But the server still processes and stores them:**

From `src/worker/live-session.ts` (lines 628-654), the server uses handler factories that:
1. Validate the message
2. Mutate server state
3. Broadcast to all clients
4. Schedule KV save

---

## 2. Architectural Inconsistency Found

### 2.1 The Problem

The hash verification system **includes mute/solo state**, which can cause unintended state sync:

From `src/sync/canonicalHash.ts` (lines 83-105):

```typescript
function canonicalizeTrack(track: TrackForHash): CanonicalTrack {
  return {
    // ... other fields
    muted: track.muted,      // INCLUDED IN HASH
    soloed,                   // INCLUDED IN HASH
    // ...
  };
}
```

From `src/App.tsx` (lines 121-124):

```typescript
const stateForHashRef = useRef({ tracks: state.tracks, tempo: state.tempo, swing: state.swing });
stateForHashRef.current = { tracks: state.tracks, tempo: state.tempo, swing: state.swing };
// tracks includes muted/soloed fields
```

### 2.2 The Failure Scenario

1. **User A** mutes Track 1 (local: `muted=true`, server: `muted=true`)
2. **User B** doesn't mute anything (local: `muted=false`)
3. Server broadcasts `track_muted` to User B
4. **User B ignores it** (local-only philosophy)
5. Hash check runs (every 30 seconds)
6. **User B's hash differs from server** (their `muted=false` vs server's `muted=true`)
7. Server sends `state_mismatch`
8. User B requests snapshot
9. Snapshot applies `LOAD_STATE` with server's mute/solo values
10. **User B's local mute/solo is OVERWRITTEN**

### 2.3 Impact

- "Local-only" mute/solo is **not truly local-only**
- State can be unexpectedly overwritten during snapshot recovery
- User's personal mix settings are lost during normal sync operations
- E2E test (`e2e/multiplayer.spec.ts:182-208`) verifies local-only behavior but doesn't test recovery scenarios

---

## 3. The "My Ears, My Control" Philosophy

### 3.1 Origin

From `src/hooks/useMultiplayer.ts` (lines 110-112):

```typescript
// Playback started callback - INFORMATIONAL ONLY
// We do NOT control local playback from remote events
// "My ears, my control" - playback state is personal
```

### 3.2 What It Means

| State Type | Synced | Rationale |
|------------|--------|-----------|
| Steps, Tempo, Swing | Yes | Composition content - everyone creates together |
| Track Volume | Yes | Part of the mix that everyone should hear |
| Effects, FM params | Yes | Affects the sound everyone hears |
| **Mute/Solo** | **No (intended)** | Personal monitoring preference |
| **Playback (play/stop)** | **No** | Each user can start/stop independently |
| Cursors | Yes (ephemeral) | Awareness, not audio |

### 3.3 Reasoning (from code comments)

1. **Personal monitoring** - Each user may want to focus on different tracks
2. **No conflicts** - If User A solos drums and User B solos melody, both can work comfortably
3. **Teaching scenarios** - Teacher can solo to demonstrate without forcing student to hear the same
4. **Live mixing** - Each musician controls their own in-ear mix

---

## 4. Use Case Analysis

### 4.1 Collaborative Composition (LOCAL-ONLY WINS)

| Scenario | If Synced | If Local-Only |
|----------|-----------|---------------|
| User A solos drums to hear them | User B forced to hear only drums | User B hears full mix |
| User A mutes melody to check bass | User B loses melody | User B works uninterrupted |
| Both users solo different tracks | Last-write-wins chaos | Both hear what they need |

**Verdict: Local-only is clearly better for composition**

### 4.2 Teaching/Demonstration (MIXED)

| Scenario | If Synced | If Local-Only |
|----------|-----------|---------------|
| Teacher shows bass line alone | Student hears isolated bass (maybe helpful) | Student hears full mix (maybe confusing) |
| Teacher wants student to hear full mix | Must un-solo, affecting their own view | Works naturally |

**Verdict: Slight edge to local-only (student can always ask to hear teacher's mix)**

### 4.3 Live Performance (DEPENDS ON CONTEXT)

| Scenario | If Synced | If Local-Only |
|----------|-----------|---------------|
| DJ mutes for effect | Audience hears mute (intended) | Only DJ hears mute (wrong) |
| Rehearsal - experimenting | Changes affect everyone (bad) | Each person experiments safely |

**Verdict: Different use cases need different behavior**
- If Keyboardia were a performance tool: Sync might make sense
- As a composition/jam tool: Local-only is correct

### 4.4 Mixing Session (LOCAL-ONLY WINS)

| Scenario | If Synced | If Local-Only |
|----------|-----------|---------------|
| Multiple users adjusting mutes | Constant conflicts | Each has preview mix |
| A/B testing different mute combos | Affects everyone | Safe experimentation |

**Verdict: Local-only is essential for mixing workflow**

---

## 5. Industry Standards

### 5.1 Online DAWs

Based on web search research:

| Platform | Mute/Solo Sync? | Collaboration Model |
|----------|-----------------|---------------------|
| **Soundtrap** | Unclear, likely no | Real-time editing |
| **BandLab** | No (asynchronous) | Turn-based collaboration |
| **Splice Studio** | No | Project-level sync, not real-time |

[Source: Soundtrap Support](https://support.soundtrap.com/hc/en-us/articles/212437805-Solo-and-Mute-tracks), [BandLab Blog](https://blog.bandlab.com/studio-faq/)

Most online DAWs use **asynchronous collaboration** where users work on separate sessions and merge changes. Real-time sync of mixer controls is uncommon because it creates the conflict issues described above.

### 5.2 Traditional DAWs

Ableton Live, Logic, Pro Tools, FL Studio - all have mute/solo as **local to each user's view**. When collaborating via screen share or version control, each user maintains their own mixer view.

### 5.3 Video Editing Analogy

In collaborative video editors (like Frame.io review tools), playback controls are **per-user**. Each reviewer can play, pause, and mute at their own pace. Changes to the timeline sync; viewing preferences don't.

---

## 6. Architectural Implications

### 6.1 If We Fix Local-Only (Recommended)

**Changes needed:**

1. **Exclude mute/solo from hash calculation**

```typescript
// In src/sync/canonicalHash.ts
function canonicalizeTrack(track: TrackForHash): CanonicalTrack {
  return {
    // ... other fields
    // REMOVE: muted: track.muted,
    // REMOVE: soloed,
    // OR set to constant values:
    muted: false,   // Ignored in hash
    soloed: false,  // Ignored in hash
  };
}
```

2. **Filter mute/solo from snapshot application**

In the client's `handleSnapshot`, don't overwrite local mute/solo:

```typescript
// Before applying snapshot tracks, preserve local mute/solo
const localMuteState = new Map(currentTracks.map(t => [t.id, { muted: t.muted, soloed: t.soloed }]));

// After creating new tracks from snapshot
newTracks = snapshotTracks.map(t => ({
  ...t,
  muted: localMuteState.get(t.id)?.muted ?? t.muted,
  soloed: localMuteState.get(t.id)?.soloed ?? t.soloed,
}));
```

3. **Consider not storing on server at all**

Since mute/solo are truly local, the server doesn't need to store them. This would require:
- Remove `mute_track` and `solo_track` from `MUTATING_MESSAGE_TYPES`
- Remove server handlers
- Remove from session state schema
- Handle backwards compatibility for existing sessions

4. **Update documentation**

Add explicit note to `ARCHITECTURE-PRINCIPLES.md` explaining the exception for mute/solo.

### 6.2 If We Were to Sync (NOT Recommended)

**Changes needed:**

1. Remove local-only handling in `handleTrackMuted` and `handleTrackSoloed`
2. Apply remote mute/solo to local state
3. Update E2E tests
4. Accept conflict issues in use cases above

**Message types already exist** - `mute_track`, `solo_track`, `track_muted`, `track_soloed` are all defined.

---

## 7. Recommendation

### 7.1 Decision: Keep Local-Only, Fix the Hash Bug

**Rationale:**

1. **Product fit** - Keyboardia is a composition/jam tool, not a live performance tool
2. **User expectation** - Musicians expect mixer controls to be personal (per industry standards)
3. **Conflict avoidance** - Syncing creates constant conflicts with no good resolution
4. **Philosophy alignment** - "My ears, my control" is the right mental model

### 7.2 Implementation Plan

| Priority | Task | Effort |
|----------|------|--------|
| P0 | Exclude mute/solo from hash calculation | Small |
| P1 | Preserve local mute/solo during snapshot recovery | Medium |
| P2 | Add E2E test for snapshot + local mute preservation | Small |
| P3 | Document in ARCHITECTURE-PRINCIPLES.md | Small |
| P3 | Consider removing server storage entirely | Large |

### 7.3 Edge Cases to Consider

1. **New track added** - Should inherit global mute/solo? (Currently: starts as `muted: false, soloed: false`)
2. **Session refresh** - User loses local mute/solo state (acceptable, matches DAW behavior)
3. **Multiple tabs** - Each tab would have independent mute/solo (could be confusing)

### 7.4 Future Consideration: "Follow Host" Mode

For performance/teaching scenarios, a future feature could be:

```
[x] Follow host mix
```

When enabled, user's mute/solo mirrors the session creator. This would be opt-in per user, not forced sync.

---

## 8. Files Referenced

| File | Lines | Purpose |
|------|-------|---------|
| `src/types.ts` | 41-54, 82-85 | Track interface, mute/solo actions |
| `src/state/grid.tsx` | 98-129, 283-297 | Reducer handlers |
| `src/sync/multiplayer.ts` | 1641-1654, 2092-2105 | Local-only handling |
| `src/sync/canonicalHash.ts` | 83-105 | Hash calculation (BUG) |
| `src/worker/live-session.ts` | 628-654 | Server handlers |
| `src/shared/messages.ts` | 22-39 | MUTATING_MESSAGE_TYPES |
| `e2e/multiplayer.spec.ts` | 182-208 | Local-only test |
| `specs/SOLO.md` | Full file | Solo specification |
| `specs/ARCHITECTURE-PRINCIPLES.md` | 86-95 | Sync philosophy |
| `src/hooks/useMultiplayer.ts` | 110-112 | "My ears, my control" comment |

---

## 9. Conclusion

Solo and Mute should remain **local-only** as originally intended. However, there is a bug where hash verification includes mute/solo state, which can cause unintended state sync during snapshot recovery. This should be fixed by excluding mute/solo from hash calculations and preserving local state during snapshot application.

The "My Ears, My Control" philosophy is correct for Keyboardia's use case as a collaborative composition tool. Syncing these controls would create constant conflicts and degrade the user experience for all core use cases.
