# Solo Button Specification

## Overview

Solo allows users to temporarily hear only selected tracks without modifying their mute states. This is essential for auditioning individual tracks, debugging mix issues, and focusing on specific elements during composition.

## Core Behavior

### State Model

Solo and mute are **independent boolean states**:

```typescript
interface Track {
  muted: boolean;   // User explicitly muted this track
  soloed: boolean;  // User explicitly soloed this track
}
```

### Playback Logic

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

### State Preservation

Solo does NOT modify mute state. When all solos are removed, the previous mute configuration is restored automatically.

**Example scenario:**

| Step | Action | Track 1 | Track 2 | Track 3 | What Plays |
|------|--------|---------|---------|---------|------------|
| 1 | Initial state | muted | muted | - | Track 3 |
| 2 | Solo Track 2 | muted | muted + soloed | - | Track 2 |
| 3 | Un-solo Track 2 | muted | muted | - | Track 3 (restored) |

### Edge Cases

#### Muted + Soloed Track

**Decision: Solo wins**

A track that is both muted and soloed will play. Rationale:
- Solo means "I want to hear this NOW"
- User explicitly requested to hear it
- Matches industry standard (Ableton, Logic, Pro Tools, FL Studio)

#### Multiple Solos

Multiple tracks can be soloed simultaneously. All soloed tracks play together.

#### All Tracks Soloed

If every track is soloed, behavior is identical to no tracks soloed (all unmuted tracks play). This is a degenerate case but handles gracefully.

---

## UI Design

### Button Placement

Solo button appears next to mute button in track controls:

```
[M] [S] Kick  ████████████████
 ↑   ↑
 │   Solo
 Mute
```

### Visual States

| State | Mute Button | Solo Button |
|-------|-------------|-------------|
| Normal | Gray/dim | Gray/dim |
| Muted | Highlighted (orange/red) | Gray/dim |
| Soloed | Gray/dim | Highlighted (yellow/gold) |
| Muted + Soloed | Gray/dim (overridden) | Highlighted (yellow/gold) |

### Color Rationale

- **Mute: Orange/Red** - Warning color, "this is silenced"
- **Solo: Yellow/Gold** - Spotlight color, "this is featured"

These colors are industry standard across DAWs.

### Icon Options

See research section below for icon recommendations.

---

## Interactions

### Click Behavior

| Action | Result |
|--------|--------|
| Click Solo (off → on) | Solo this track |
| Click Solo (on → off) | Un-solo this track |

### Why No Exclusive Solo

We intentionally omit "exclusive solo" (Shift+Click or similar to un-solo all others). Reasons:

1. **Breaks modifier semantics** - Shift+Click means "disclose details" (p-lock editor), not "exclude others"
2. **No touch equivalent** - Modifier+click has no natural touch gesture
3. **Unnecessary complexity** - Users can click other solo buttons to un-solo
4. **Mental model** - Solo is additive; exclusive behavior is surprising

If a user wants to hear only one track, they can:
1. Click that track's solo button (solos it)
2. Click other soloed tracks to un-solo them

This explicit action matches the explicit nature of the UI.

---

## Implementation

### State Changes

Add to `Track` interface in `types.ts`:

```typescript
interface Track {
  id: string;
  sampleId: SampleId;
  steps: boolean[];
  muted: boolean;
  soloed: boolean;  // NEW
  // ... other fields
}
```

### Reducer Actions

Add to grid reducer:

```typescript
type GridAction =
  | { type: 'TOGGLE_SOLO'; trackId: string }
  // ... existing actions

case 'TOGGLE_SOLO':
  return {
    ...state,
    tracks: state.tracks.map(t =>
      t.id === action.trackId ? { ...t, soloed: !t.soloed } : t
    )
  };
```

> **Note:** EXCLUSIVE_SOLO and CLEAR_ALL_SOLOS actions exist in the codebase but are not exposed in the UI. They may be removed in a future cleanup.

### Scheduler Changes

Update scheduler to check solo state:

```typescript
// In playStep or equivalent
const anySoloed = state.tracks.some(t => t.soloed);

state.tracks.forEach(track => {
  const shouldPlay = anySoloed ? track.soloed : !track.muted;

  if (shouldPlay && track.steps[currentStep]) {
    playSound(track);
  }
});
```

### Session Persistence

Solo state should be saved to session:

```typescript
interface SessionTrack {
  // ... existing fields
  soloed: boolean;
}
```

**Migration:** Existing sessions without `soloed` field default to `false`.

---

## Mobile Considerations

On mobile (Swim Lanes pattern), solo button should:
- Be large enough for touch (44px minimum, currently 36px)
- Be visible in the track row alongside mute

---

## Testing

### Unit Tests

```typescript
describe('Solo behavior', () => {
  it('solo track plays when soloed', () => {});
  it('non-soloed tracks are silenced when any track is soloed', () => {});
  it('mute state preserved after un-soloing', () => {});
  it('soloed + muted track plays (solo wins)', () => {});
  it('multiple tracks can be soloed', () => {});
});
```

### E2E Tests

```typescript
describe('Solo UI', () => {
  it('clicking solo button toggles solo state', () => {});
  it('solo button highlights when active', () => {});
  it('solo state persists in session', () => {});
});
```

---

## Icon Research

### Final Decision: Letter "S" with Yellow Active State

After researching major DAWs (Ableton, Logic, Pro Tools, FL Studio, Bitwig, Reaper) and hardware (Elektron, MPC), the industry-standard "S" letter was chosen.

### Rationale

1. **Universal recognition** - Every major DAW uses M/S pairing for Mute/Solo
2. **Perfect consistency** - Matches existing "M" for mute button
3. **Color does the work** - Yellow (#f1c40f) when active, gray when inactive
4. **Compact** - Works at 26x26px alongside mute button

### Visual Design

```
[M] [S] Kick  ████████████████
 ↑   ↑
 │   Yellow (#f1c40f) when active
 Orange/red (#e74c3c) when active
```

### Alternatives Considered

| Icon | Verdict |
|------|---------|
| 🎧 Headphones | Breaks letter consistency, used by GarageBand only |
| ⓢ Circled S | More visually heavy than "M" |
| "Solo" text | Takes too much space |
| 👤 Person | No DAW precedent |

---

## Implementation Status

✅ **Implemented** - All features complete and tested.

### Files Modified

| File | Changes |
|------|---------|
| `src/types.ts` | Added `soloed: boolean` to Track, added TOGGLE_SOLO action |
| `src/state/grid.tsx` | Added reducer case for TOGGLE_SOLO |
| `src/audio/scheduler.ts` | Updated to check solo state before playing |
| `src/components/TrackRow.tsx` | Added solo button UI |
| `src/components/TrackRow.css` | Added solo button styles and grid column |
| `src/components/StepSequencer.tsx` | Wired up solo handler |
| `src/worker/types.ts` | Added `soloed?: boolean` to SessionTrack |
| `src/state/grid.test.ts` | Added unit tests for solo behavior |
| `src/audio/scheduler.test.ts` | Updated test helper with soloed field |

---

## References

- [Ableton Live Manual - Solo](https://www.ableton.com/en/manual/mixing/)
- [Pro Tools Solo Modes](https://avid.secure.force.com/pkb/articles/en_US/how_to/Solo-Modes-in-Pro-Tools)
- [FL Studio Mixer](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/mixer.htm)
