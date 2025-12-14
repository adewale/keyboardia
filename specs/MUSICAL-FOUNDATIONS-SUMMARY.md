# Musical Foundations Summary

## Phase 20: Musical Foundations

Two foundational features that unlock additional musical genres.

---

## Features Delivered

### 1. Triplet Grids
**Implementation:** Added 12 and 24 to step count options
**Unlocks:** Jazz, Gospel, Blues, Waltz, Afro-Cuban, Trap (hi-hat rolls)

```typescript
export const STEP_COUNT_OPTIONS = [4, 8, 12, 16, 24, 32, 64] as const;
```

- **12 steps**: Triplet feel, shuffle rhythms, jazz/gospel swing
- **24 steps**: High-resolution triplets for trap hi-hat rolls

### 2. Extended Pitch Range
**Implementation:** ±24 semitones (4 octaves total)
**Unlocks:** Cinematic, Orchestral, Bass Music, Jazz bebop lines

```typescript
export const MIN_TRANSPOSE = -24;
export const MAX_TRANSPOSE = 24;
```

- Tracks can now span 4 octaves instead of 2
- Enables deep sub-bass (-24) and high melodic content (+24)
- ChromaticGrid updated to show extended range

---

## Features Deferred

### Reverb and Delay

**Why deferred:** These features require integration with session state and multiplayer sync to maintain Keyboardia's core principle: "Everyone hears the same music."

A local-only implementation was prototyped but rolled back because:
1. Effects that don't sync break the shared experience
2. Effects that don't persist lose creative intent on reload
3. API capabilities that exceed UI create a two-tier experience

**Requirements for proper implementation:**
- Add `reverbMix` and `delayMix` to `SessionState`
- Add WebSocket message types for effect changes
- Add server-side validation
- Add UI controls that match existing patterns (like Swing slider)
- Ensure all players hear identical audio

See `app/docs/lessons-learned.md` for the architectural lesson.

---

## Coverage Impact

| Before | After |
|--------|-------|
| ~35% genres | ~45% genres |

Triplet grids and extended pitch unlock: Jazz, Gospel, Blues, Waltz, Afro-Cuban, Trap, Cinematic, Orchestral, Bass Music.

Genres still requiring effects (deferred): Dub Reggae, Ambient, Lo-fi Hip-Hop, Shoegaze, Post-Punk.

---

## Files Changed

- `src/types.ts` — Added 12, 24 to STEP_COUNT_OPTIONS
- `src/worker/invariants.ts` — Extended transpose to ±24
- `src/worker/validation.ts` — Updated validation for new ranges
- `src/components/TrackRow.tsx` — Extended transpose UI controls
- `src/components/ChromaticGrid.tsx` — Extended pitch rows to 4 octaves
