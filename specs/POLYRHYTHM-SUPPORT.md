# Polyrhythm Support Specification

## Overview

This spec defines the addition of **odd step counts** (3, 5, 6, 7, 9, 10, 11, etc.) to enable true polyrhythmic patterns in Keyboardia. Currently, the sequencer only offers step counts divisible by 4 (4, 8, 12, 16, 24, 32, 64, 96, 128). Adding odd step counts unlocks polyrhythms like 5:8, 3:4, and 7:8 that are foundational to electronic music production.

**Key distinction:**
- **Polyrhythm (5:8)**: 5 notes played against 8 notes in the same time span
- **5/8 Time Signature**: A measure with 5 eighth notes (different concept, not this spec)

---

## Musical Context

### Why Polyrhythms Matter

| Genre | Common Polyrhythms | Notes |
|-------|-------------------|-------|
| **Techno** | 3:4, 6:8 | Off-beat percussion layers |
| **House** | 3:4, 2:3 | Latin-influenced percussion |
| **IDM** | 5:4, 5:8, 7:8, 11:8 | Aphex Twin, Autechre territory |
| **Afrobeat** | 3:2, 6:4 | West African drumming patterns |
| **Drum & Bass** | 3:2, 6:4 | Amen break layering |
| **Math Rock** | 5:4, 7:8 | Progressive complexity |

### How It Works in a Step Sequencer

When Track A has 5 steps and Track B has 8 steps:
- They loop at different rates
- Pattern fully resolves after LCM(5, 8) = 40 steps
- Creates shifting, interlocking accents

```
Track A (5): ●○○○○●○○○○●○○○○●○○○○●○○○○●○○○○●○○○○●○○○○○
Track B (8): ●○○○○○○○●○○○○○○○●○○○○○○○●○○○○○○○●○○○○○○○○○
             |___LCM = 40 steps before patterns realign___|
```

---

## Recommended Step Count Options

### New Array (24 options)

```typescript
export const STEP_COUNT_OPTIONS = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 18, 20, 21, 24, 27, 32, 36, 48, 64, 96, 128
] as const;
```

### Breakdown by Musical Use

| Count | Division | Musical Use | Priority |
|-------|----------|-------------|----------|
| **3** | Triplet pulse | Minimal triplet patterns, waltz | HIGH |
| **4** | Quarter bar | Minimal techno pulse | ESSENTIAL |
| **5** | Quintuplet | 5:4 polyrhythm, IDM | HIGH |
| **6** | Half triplet bar | 3:2 base, shuffle | HIGH |
| **7** | Septuplet | 7:8 polyrhythm, prog | MEDIUM |
| **8** | Half bar | Standard subdivisions | ESSENTIAL |
| **9** | Three triplets | Jazz feel, 9/8 time | MEDIUM |
| **10** | Half of 20 | 5:4 time base | MEDIUM |
| **11** | Prime | Experimental, evolving | LOW |
| **12** | Triplet bar | Jazz, gospel, trap | ESSENTIAL |
| **13** | Prime | Non-repeating patterns | LOW |
| **15** | 5×3 | Quintuplet triplets | LOW |
| **16** | Full bar | Universal standard | ESSENTIAL |
| **18** | 1.5 bar triplet | Extended triplet phrases | LOW |
| **20** | 5:4 bar | 5/4 time approximation | MEDIUM |
| **21** | 7×3 | 7:3 polyrhythm | LOW |
| **24** | 2 bar triplet | Trap hi-hats | HIGH |
| **27** | 3³ | Three nonaplets | LOW |
| **32** | 2 bars | Long basslines | ESSENTIAL |
| **36** | 3 bar triplet | Extended sections | LOW |
| **48** | 3 bars | Multi-divisible | MEDIUM |
| **64** | 4 bars | Full phrases | HIGH |
| **96** | 6 bars | Long triplet sections | MEDIUM |
| **128** | 8 bars | Verse/chorus | MEDIUM |

### What to Skip

**Large primes (17, 19, 23, 29, 31):** LCM explodes, no musical utility
**Awkward composites (14, 22, 25, 26, 28):** Redundant, no clear use case
**High multiples (40, 50, 60, 80+):** Too close to existing options

---

## Technical Changes Required

### Files to Modify

| File | Change | Severity |
|------|--------|----------|
| `app/src/types.ts:24` | Update `STEP_COUNT_OPTIONS` array | Required |
| `app/src/worker/validation.ts:138` | Update whitelist | Required |
| `app/src/worker/live-session.ts:1021` | Update whitelist | Required |
| `app/src/audio/scheduler.ts:198` | Fix swing behavior | Critical |
| `app/src/components/StepCell.tsx:22` | Improve beat markers | Optional |

### Critical Issue: Swing on Odd Step Counts

**Current code** (`scheduler.ts:198`):
```typescript
const isSwungStep = this.currentStep % 2 === 1; // Uses GLOBAL step parity
```

**Problem:** Swing applies based on global step counter, not pattern-local position.

For a 5-step pattern:
```
Global step:  0  1  2  3  4  5  6  7  8  9
Local step:   0  1  2  3  4  0  1  2  3  4
Swing:        -  Y  -  Y  -  Y  -  Y  -  Y  (global)
Expected:     -  Y  -  Y  -  -  Y  -  Y  -  (local)
```

**Recommended fix:** Use pattern-local swing (Option B)
```typescript
// Per-track swing based on local step position
const trackStepCount = track.stepCount ?? 16;
const localStep = globalStep % trackStepCount;
const isSwungStep = localStep % 2 === 1;
```

### Validation Synchronization

**CRITICAL:** Two whitelists must be updated simultaneously:

1. `worker/validation.ts:138` - Server-side validation
2. `worker/live-session.ts:1021` - WebSocket message validation

If these don't match, step count changes will be silently rejected.

---

## UI/UX Considerations

### Beat Markers for Odd Counts

**Current:** Beat markers every 4 steps (`stepIndex % 4 === 0`)

**Recommendation:** Keep as-is for consistency. Users understand 16th-note grid. Odd step counts naturally create polyrhythmic feel without special markers.

**Alternative:** For primes (5, 7, 11, 13), only highlight downbeat (step 0).

### Pattern Length Display

Show users when patterns realign:

```
Kick (16 steps)  — Loops: 1×
HiHat (12 steps) — Loops: 1.33×
Perc (5 steps)   — Loops: 3.2×

Full pattern: 240 steps (15 bars)
```

### Dropdown Grouping (Future Enhancement)

Group step counts visually:
- **Standard:** 4, 8, 16, 32, 64, 128
- **Triplets:** 3, 6, 12, 24, 48, 96
- **Polyrhythmic:** 5, 7, 9, 10, 11, 13, 15

---

## LCM Reference

Common polyrhythm combinations and their pattern lengths:

| Track A | Track B | LCM | Bars (@ 16 steps/bar) |
|---------|---------|-----|----------------------|
| 3 | 4 | 12 | 0.75 |
| 3 | 8 | 24 | 1.5 |
| 4 | 5 | 20 | 1.25 |
| 5 | 6 | 30 | 1.875 |
| 5 | 8 | 40 | 2.5 |
| 5 | 16 | 80 | 5 |
| 7 | 8 | 56 | 3.5 |
| 7 | 16 | 112 | 7 |
| 11 | 13 | 143 | ~9 |

**Note:** The MIDI export already uses LCM calculation (`midiExport.ts:252-269`) and handles arbitrary step counts correctly.

---

## Implementation Phases

### Phase 1: Core Support (This PR)

1. Update `STEP_COUNT_OPTIONS` in `types.ts`
2. Update validation whitelists (2 files)
3. Fix swing behavior in `scheduler.ts`
4. Add tests for new step counts

**Deliverables:**
- Users can select 3, 5, 6, 7, 9, 10, 11, 13, 15, 18, 20, 21, 27, 36, 48 steps
- Polyrhythms work correctly in playback
- MIDI export handles all combinations
- Multiplayer sync works

### Phase 2: UI Enhancements (Future)

- Pattern length calculator tooltip
- Per-track loop count display
- Grouped dropdown menu
- Visual realignment indicator

### Phase 3: Advanced Features (Future)

- Euclidean rhythm generator
- Polyrhythm preset library (3:2 Afrobeat, 5:4 IDM, etc.)
- "Snap to polyrhythm" tool

---

## Testing Requirements

### Unit Tests

```typescript
// grid.test.ts - State management
describe('odd step counts', () => {
  it('accepts step counts 3, 5, 6, 7', () => { /* ... */ });
  it('clamps step count to valid range', () => { /* ... */ });
});

// scheduler.test.ts - Timing
describe('polyrhythm playback', () => {
  it('plays 5:8 polyrhythm correctly', () => { /* ... */ });
  it('applies swing based on local step position', () => { /* ... */ });
});

// midiExport.test.ts - Export
describe('odd step count export', () => {
  it('calculates LCM for 5:7 pattern', () => { /* ... */ });
  it('exports correct pattern length', () => { /* ... */ });
});
```

### Integration Tests

- Multiplayer: Two players with different odd step counts
- MIDI export: Verify timing accuracy for odd patterns
- Long patterns: Test LCM edge cases (11:13 = 143 steps)

---

## Competitive Positioning

| Sequencer | Step Count Support | Polyrhythm Quality |
|-----------|-------------------|-------------------|
| Elektron Digitakt | 1-64 (any integer) | Excellent |
| Ableton Push | Fixed 16 (clip length varies) | Good |
| Roland TR-8S | Fixed 16 | None |
| **Keyboardia (current)** | 4,8,12,16,24,32,64,96,128 | Good |
| **Keyboardia (proposed)** | 24 options including primes | Excellent |

With this change, Keyboardia matches Elektron-level polyrhythm flexibility while being web-based and multiplayer - a unique combination.

---

## Summary

Adding odd step counts is a **high-impact, low-complexity** change that unlocks significant musical capability. The core architecture already supports arbitrary step counts via modulo arithmetic. The main work is:

1. Expanding the options array (3 files)
2. Fixing swing behavior (1 file, critical)
3. Adding tests

This positions Keyboardia as a serious tool for polyrhythmic electronic music production.

---

## Roadmap Overlaps

This spec overlaps with several existing roadmap items:

### Directly Related (Already Documented)

| Roadmap Item | Location | Relationship |
|--------------|----------|--------------|
| **Phase 4A: Per-Track Step Count** | STATUS.md | ✅ Completed — this spec extends it |
| **Future Polyrhythm Enhancements** | ROADMAP.md:260-272 | Lists Euclidean, per-track swing, step rotation as future work |
| **Phase 18: Musical Foundations** | STATUS.md | ✅ Completed — added triplet grids (12, 24, 96) |

### Indirectly Related (May Benefit from This Work)

| Roadmap Item | Location | Interaction |
|--------------|----------|-------------|
| **Euclidean Rhythm Generator** | ROADMAP.md:266, COMPOSITION-AFFORDANCES.md | Euclidean works better with odd step counts (E(5,8), E(7,16)) |
| **Held Notes / Ties** | HELD-NOTES.md | Ties interact with polyrhythms — need to decide behavior at loop boundaries |
| **Step Probability** | ROADMAP.md:269, UI-PHILOSOPHY.md:117 | Probability per step — works independently of step count |
| **Ratcheting** | ROADMAP.md:270, HELD-NOTES.md:654 | Multiple triggers per step — orthogonal to step count |
| **Step Rotation** | ROADMAP.md:268 | Rotate pattern by N steps — useful for polyrhythmic phase shifting |
| **Per-Track Swing** | ROADMAP.md:267 | J Dilla style — would require local swing anyway (same fix as this spec) |

### Key Insight

The **swing fix** in this spec (using local step position instead of global) is a **prerequisite** for per-track swing. Implementing this spec's swing fix enables the future "J Dilla style" per-track swing feature with minimal additional work.

---

## Extra Features Required

Features that significantly enhance the polyrhythm experience but are out of scope for Phase 1:

### Tier 1: High Value, Medium Effort

| Feature | Description | Why It Matters |
|---------|-------------|----------------|
| **Pattern Length Display** | Show LCM and "loops until realign" | Users can't predict when patterns sync |
| **Euclidean Rhythm Generator** | Auto-distribute N hits across M steps | Perfect complement to odd step counts |
| **Step Rotation** | Rotate pattern by N steps | Phase-shift polyrhythms for variation |

### Tier 2: Medium Value, Low Effort

| Feature | Description | Why It Matters |
|---------|-------------|----------------|
| **Grouped Dropdown** | Visual categories in step count selector | 24 options is overwhelming without organization |
| **Polyrhythm Presets** | One-click 3:2 Afrobeat, 5:4 IDM setups | Discovery and education |
| **Per-Track Swing** | Different swing per track | J Dilla, hip-hop micro-timing |

### Tier 3: Nice to Have

| Feature | Description | Why It Matters |
|---------|-------------|----------------|
| **Visual Phase Indicator** | Show relative position of all track playheads | Advanced feedback for complex patterns |
| **LCM Warning** | Alert when pattern length exceeds threshold (e.g., 143 steps) | Prevent accidentally unusable patterns |
| **Beat Marker Modes** | Toggle between 4/4 markers and pattern-relative markers | Cater to different mental models |

---

## Deferred Ideas

Ideas that emerged during research but are explicitly out of scope:

### 1. Arbitrary Step Counts (1-128)

**Idea:** Let users enter any integer from 1-128 instead of a fixed list.

**Why Deferred:**
- Dropdown UI becomes unwieldy
- Most values have no musical utility (e.g., 14, 22, 26)
- Elektron does this but has dedicated hardware interface
- Can revisit with "advanced mode" toggle later

### 2. Per-Track Time Signature

**Idea:** Each track has its own time signature (5/8, 7/8, etc.), not just step count.

**Why Deferred:**
- Time signature affects beat display, MIDI export, tempo calculation
- Much larger architectural change than step counts
- Overkill for current use cases
- Step counts achieve similar result with simpler model

### 3. Non-Integer Step Counts (Irrational Rhythms)

**Idea:** Support patterns like √2:1 or φ:1 (golden ratio) for evolving, never-repeating rhythms.

**Why Deferred:**
- Extremely experimental (Autechre territory)
- Breaks LCM calculation (patterns never align)
- No hardware precedent
- Would require fundamental scheduler rearchitecture

### 4. Swing Curve Presets

**Idea:** Instead of linear swing percentage, offer named curves like "MPC Swing", "SP-1200 Swing", "J Dilla".

**Why Deferred:**
- Requires swing curve research and implementation
- Out of scope for step count feature
- Good future enhancement for per-track swing

### 5. Polyrhythm Visualization Canvas

**Idea:** Dedicated visualization showing all tracks' phase relationships as rotating circles (like OP-Z).

**Why Deferred:**
- Significant UI development effort
- Not essential for functionality
- Cool but not critical path

### 6. Tempo-Relative Step Counts

**Idea:** "Half-time" or "double-time" per track instead of absolute step counts.

**Why Deferred:**
- Clock divider/multiplier model is different from step count model
- Could coexist but adds complexity
- Current model (absolute step counts) is clearer

---

## Alternative Approaches

### Alternative A: Keep Current Step Counts, Add Euclidean Only

**Approach:** Don't add new step counts. Instead, add Euclidean rhythm generator that distributes hits across the existing step counts.

**Pros:**
- Smaller change
- Euclidean naturally creates polyrhythmic feel
- Simpler dropdown (9 options vs 24)

**Cons:**
- True 5:8 polyrhythm is impossible without 5-step track
- Euclidean on 16 steps can approximate but isn't the same
- Limits creative possibilities

**Verdict:** Not recommended. Euclidean and odd step counts complement each other.

### Alternative B: Add Only Prime Step Counts (3, 5, 7, 11, 13)

**Approach:** Minimal addition of just the 5 prime numbers most useful for polyrhythms.

**Pros:**
- Smaller dropdown (14 options)
- Primes are the most "polyrhythmic" values
- Simpler implementation

**Cons:**
- Missing useful composites (6, 9, 10, 15, 18, 20, 21)
- 6-step is very useful for 3:2 patterns
- 9-step is useful for jazz

**Verdict:** Possible MVP approach. Could ship primes first, add composites later.

### Alternative C: Tiered Visibility (Simple/Advanced Mode)

**Approach:** Default to current 9 options. Add "Advanced" toggle that reveals all 24.

**Pros:**
- Doesn't overwhelm beginners
- Power users get full flexibility
- Progressive disclosure

**Cons:**
- Hidden features are less discoverable
- Extra UI state to manage
- May confuse multiplayer (one user sees different options)

**Verdict:** Good compromise. Recommend for Phase 2 UI enhancement.

### Alternative D: Per-Track "Polyrhythm Mode" Toggle

**Approach:** Keep 16-step default. Add toggle that enables "polyrhythm mode" showing all options.

**Pros:**
- Clear intent signal from user
- Can show educational content when enabled
- Preserves simple default

**Cons:**
- Mode toggle adds complexity
- Arbitrary distinction (why is 12 "normal" but 5 "polyrhythm"?)

**Verdict:** Not recommended. Better to just show all options with good grouping.

### Alternative E: Clock Divider Model

**Approach:** Instead of step counts, each track has a clock divider (1x, 2x, 0.5x, etc.) relative to master clock.

**Pros:**
- Simpler mental model for some users
- Matches Eurorack paradigm
- Automatic alignment at musical boundaries

**Cons:**
- Can't express 5-step or 7-step patterns
- Different paradigm from current implementation
- Would require major rearchitecture

**Verdict:** Not recommended. Step count model is more flexible and already implemented.

---

## Recommended Approach

Based on analysis, the recommended approach is:

1. **Phase 1 (This PR):** Add all 24 step counts with flat dropdown
2. **Phase 2:** Add grouped dropdown UI (Standard/Triplet/Polyrhythmic categories)
3. **Phase 3:** Add Euclidean rhythm generator
4. **Future:** Consider tiered visibility if user feedback indicates overwhelm

This maximizes capability while maintaining implementation simplicity.

---

## Research Document

Comprehensive musical and technical research is documented separately:

**→ [specs/research/POLYRHYTHM-RESEARCH.md](./research/POLYRHYTHM-RESEARCH.md)**

Covers:
- Polyrhythm fundamentals and theory
- Genre-specific usage patterns
- Hardware sequencer survey
- LCM reference tables
- UI/UX patterns from industry
- Competitive analysis
