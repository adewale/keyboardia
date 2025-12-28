# Held Notes Specification

A proposal to replace the track-level `playbackMode` (oneshot/gate) with per-step note ties, enabling sustained notes across multiple steps while simplifying the conceptual model.

## Status: Proposal

This spec captures design research and architectural decisions. Implementation has not started.

---

## The Problem

### Current Limitation

Keyboardia cannot express notes that sustain across multiple steps. Each active step triggers a new note:

```
Step:    1     2     3     4
Current: ●     ●     ●     ○      ← Three separate note attacks
Desired: ●─────────────────○      ← One sustained note
```

This blocks entire musical genres:
- **Ambient/drone**: Requires sustained pads
- **Soul/R&B ballads**: Requires legato melodic lines
- **303-style acid**: Requires tied notes with slides
- **Piano/orchestral**: Requires held chords and phrases

### The Gate Mode Workaround

The current `playbackMode: 'oneshot' | 'gate'` attempts to address duration at the track level:
- `oneshot`: Sample plays to completion (ignores step boundaries)
- `gate`: Sample cuts at step boundary (exactly 1 step duration)

**Why this is insufficient:**
1. It's track-wide — you can't have short and long notes on the same track
2. It's binary — no option for "2 steps" or "3 steps"
3. It conflicts with per-step parameter locks — pitch and volume are per-step, but duration is per-track

---

## The Proposal: Replace Gate Mode with Ties

### Core Insight

Gate mode is a workaround for not having per-note duration. If we add per-step ties, gate mode becomes redundant:

| Gate Mode | Equivalent Tie Behavior |
|-----------|------------------------|
| `gate` (1 step) | No tie (default) |
| `oneshot` | No tie + sample plays naturally |
| N/A | `tie: true` → note continues to next step |

**Ties subsume gate mode as a more fundamental primitive.**

### Data Model Change

#### Before (Current)
```typescript
interface Track {
  steps: boolean[];
  parameterLocks: (ParameterLock | null)[];
  playbackMode: 'oneshot' | 'gate';  // Track-level duration
}

interface ParameterLock {
  pitch?: number;   // Per-step
  volume?: number;  // Per-step
}
```

#### After (Proposed)
```typescript
interface Track {
  steps: boolean[];
  parameterLocks: (ParameterLock | null)[];
  // playbackMode REMOVED
}

interface ParameterLock {
  pitch?: number;   // Per-step
  volume?: number;  // Per-step
  tie?: boolean;    // NEW: Continue note from previous step
}
```

### Behavioral Rules

1. **Active step without tie**: Triggers a new note
2. **Active step with `tie: true`**: Continues the note from the previous step (no retrigger)
3. **Inactive step**: Note ends (if one was playing)
4. **Velocity**: Comes from the FIRST step only (industry standard)
5. **Pitch**: Comes from the first step; pitch changes on tied steps are ignored (like TB-303)

### Duration Calculation

When scheduling a note, the scheduler counts forward ties to determine total duration:

```typescript
function calculateNoteDuration(track: Track, startStep: number, stepDuration: number): number {
  let duration = 1;
  let step = startStep + 1;

  while (step < track.steps.length) {
    const pLock = track.parameterLocks[step];
    if (track.steps[step] && pLock?.tie) {
      duration++;
      step++;
    } else {
      break;
    }
  }

  return duration * stepDuration;
}
```

---

## Visual Representation

### Research Findings

From analyzing Bitwig, Logic Pro, Novation Circuit, and Elektron devices:

| Approach | Used By | Description |
|----------|---------|-------------|
| **Connected blocks** | Bitwig Gate Mode, Logic Pro | Adjacent steps merge visually (no gap) |
| **Color differentiation** | Novation Circuit | Note start = red, continuation = orange |
| **Horizontal bars** | Piano rolls (all DAWs) | Note spans its full duration as one rectangle |
| **Gate fill indicator** | Elektron | Step cell shows fill percentage |

### Proposed Design

Use **connected blocks with opacity differentiation**:

```
Note starts here    Tied continuation
      ↓                   ↓
┌─────────┬─────────┬─────────┐
│    ●    │    ─    │    ─    │   ← Orange → Lighter orange
│  100%   │   80%   │   80%   │   ← Opacity indicates continuation
└─────────┴─────────┴─────────┘
     1         2         3

Compared to separate notes:
┌─────────┐ ┌─────────┐ ┌─────────┐
│    ●    │ │    ●    │ │    ●    │   ← Gaps between cells
└─────────┘ └─────────┘ └─────────┘
     1         2         3
```

**Visual indicators:**
- **Note start**: Full opacity, filled circle (●)
- **Tied step**: Reduced opacity (80%), horizontal line (─)
- **Connection**: No gap between tied cells (cells merge visually)

### Badge System

Extend the existing parameter lock badge system:

| Badge | Meaning | Current? |
|-------|---------|----------|
| ↑/↓ (blue) | Pitch offset | ✅ Exists |
| +/− (orange) | Volume change | ✅ Exists |
| ─ (purple) | Tied to previous | ❌ New |

---

## Interaction Design

### Research: Industry Patterns

| Platform | Create Tie | Extend Note | Break Tie |
|----------|-----------|-------------|-----------|
| **Logic Pro** | Click edge in Tie mode | Drag edge | Click tied edge |
| **Novation Circuit** | Shift + step in Gate View | Increase gate length | Toggle tie off |
| **Bitwig** | Enable Gate mode | Steps auto-connect | Disable step |
| **FL Studio** | Drag right edge | Continue dragging | Drag left |
| **Launchpad Pro** | Hold start + press end | Same gesture | Press at length 2 twice |

### Proposed Interactions

#### Desktop: Primary Gesture (OP-Z Style)

The OP-Z uses a "hold start + press end" gesture. We adapt this for keyboard/mouse:

| Action | Gesture | Notes |
|--------|---------|-------|
| **Create tied note** | Hold first step + Click end step | Matches OP-Z exactly; intuitive "from here to there" |
| **Alternative** | Shift+Click on subsequent steps | Matches existing "Shift = modify" pattern |
| **Extend existing tie** | Hold first step + Click new end | Same gesture, replaces previous end |
| **Break tie** | Click tied step (toggles it off) | Consistent with current toggle behavior |
| **Quick multi-step** | Shift+Drag across steps | Power user gesture |

**Rationale for OP-Z gesture**: "Hold start + press end" maps duration directly to spatial extent. Users see exactly what they're getting. This also matches how Launchpad Pro handles note length.

#### Mobile

| Action | Gesture | Notes |
|--------|---------|-------|
| **Create tied note** | Long-press step → "Tie to next" option | Fits existing p-lock editor pattern |
| **Alternative** | Long-press first step, then tap end step | Matches OP-Z pattern for touch |
| **Extend/break** | Same long-press menu | Toggle tie option |

### Why This Fits UI Philosophy

| Principle | Assessment |
|-----------|------------|
| Controls live where they act | ✅ Tie is set on the step being tied |
| Visual feedback is immediate | ✅ Connected blocks appear instantly |
| No confirmation dialogs | ✅ Tie toggles directly |
| Modes are visible | ✅ Tied steps have distinct appearance |
| Progressive disclosure | ✅ Basic use (toggle) unchanged; ties via Shift+Click |

### The Five-Question Test

1. **Can I see the effect immediately?** → Yes, cells visually connect
2. **Is the control near what it affects?** → Yes, on the step itself
3. **Does it require mode switching?** → No, Shift is a modifier, not a mode
4. **Would this work on a device with no screen?** → Partial (needs visual feedback)
5. **Can I discover it by experimenting?** → Likely, if cells visually merge on Shift+Click

---

## Instrument-Specific Behavior

### Synths
- Default: Play for step duration (like current gate mode)
- With ties: Play for combined duration of all tied steps
- Release envelope applies after final step

### Samples (Drums)
- Default: Play full sample (like current oneshot mode)
- Ties are **ignored** for one-shot samples (drums don't "hold")
- Exception: Gated samples (pads, stabs) respect ties

### Sampled Instruments (Piano)
- Default: Play for step duration + release time
- With ties: Play for combined duration + release time
- Matches physical instrument behavior (hold key = sustain)

### Implementation Detail

```typescript
function shouldRespectTie(track: Track): boolean {
  // Drums and one-shot samples ignore ties
  if (track.sampleId && isOneShot(track.sampleId)) {
    return false;
  }
  // Synths and melodic instruments respect ties
  return true;
}
```

---

## What We Remove

### Track-Level `playbackMode`

The `playbackMode: 'oneshot' | 'gate'` field is **removed** from the Track interface.

**Migration:**
- Tracks with `playbackMode: 'gate'` → No change needed (default behavior is now 1-step)
- Tracks with `playbackMode: 'oneshot'` → Drums continue to play full sample by default

### UI Changes

- Remove gate/oneshot toggle from track controls
- Net UI simplification (one less button per track)

---

## Multiplayer Considerations

### Sync Payload

Ties are stored in `parameterLocks`, which already syncs. No new sync mechanism needed.

```typescript
// Existing mutation type handles this
type Mutation = {
  type: 'SET_PARAMETER_LOCK';
  trackId: string;
  step: number;
  lock: ParameterLock | null;  // Now includes tie?: boolean
}
```

### Late Joiner Behavior

If a note is mid-sustain when a user joins:
- They receive full state including tie information
- Next loop will play correctly
- Current sustained note may be missed (acceptable — matches current behavior for samples)

### Conflict Resolution

If two users modify adjacent steps simultaneously:
- Last-write-wins (existing behavior)
- No special handling needed for ties

---

## Implementation Phases

### Phase 1: Data Model
- [ ] Add `tie?: boolean` to `ParameterLock` interface
- [ ] Remove `playbackMode` from `Track` interface
- [ ] Update sync types and validation
- [ ] Migrate existing sessions (remove playbackMode, default to no ties)

### Phase 2: Scheduler
- [ ] Implement `calculateNoteDuration()` with forward tie counting
- [ ] Skip retriggering on tied steps
- [ ] Handle tempo changes mid-note
- [ ] Handle loop boundary (note spans from step 16 to step 1)

### Phase 3: Visual Representation
- [ ] Update `StepCell` to show tied appearance
- [ ] Remove gaps between tied cells
- [ ] Add tie badge (─) to parameter lock indicators
- [ ] Update ChromaticGrid to show held notes as horizontal bars

### Phase 4: Interaction
- [ ] Implement Shift+Click to create ties (desktop)
- [ ] Add tie toggle to p-lock editor (mobile)
- [ ] Implement Shift+Drag for quick multi-step notes
- [ ] Update cursor feedback during tie gesture

### Phase 5: Cleanup
- [ ] Remove gate/oneshot toggle UI
- [ ] Update documentation
- [ ] Add migration for existing patterns

---

## Alternatives Considered

### Alternative A: Gate as Parameter Lock

Add `gate?: number` (0-200%) to ParameterLock instead of ties.

**Pros:**
- Single value per step (simpler)
- Matches Elektron pattern

**Cons:**
- Gate > 100% is less intuitive than ties
- Harder to visualize in step grid
- Doesn't match sheet music mental model

### Alternative B: Separate Ties Array

Add `ties: boolean[]` parallel to `steps: boolean[]`.

**Pros:**
- Keeps ParameterLock unchanged
- Explicit tie data structure

**Cons:**
- Two arrays to sync for note state
- Ties without active steps are invalid state

### Alternative C: Event-Based Notes

Replace `steps: boolean[]` with `notes: NoteEvent[]`.

**Pros:**
- Maximum flexibility
- Standard MIDI representation
- Supports polyphony

**Cons:**
- Complete architectural change
- Much more complex sync
- Abandons step sequencer paradigm

**Decision:** Use ties in ParameterLock (the proposal above) because:
1. Fits existing per-step parameter model
2. Minimal sync changes
3. Familiar to musicians (ties are standard notation)
4. Enables future features (legato, portamento)

---

## Impact Assessment

### Musical Surface Area

| Genre | Before | After | Change |
|-------|--------|-------|--------|
| House/Techno | 95% | 95% | — |
| Ambient | 30% | 75% | +45% |
| Soul/R&B | 35% | 70% | +35% |
| Synth-pop | 75% | 90% | +15% |
| Lo-fi Hip-hop | 50% | 75% | +25% |

### Complexity Budget

| Aspect | Change |
|--------|--------|
| Track controls | −1 button (gate toggle removed) |
| Step interactions | +1 gesture (Shift+Click for tie) |
| Concepts to learn | ±0 (replace "gate mode" with "tied notes") |
| Data model | +1 optional field on ParameterLock |
| Scheduler logic | +~50 lines for duration calculation |

### UI Philosophy Alignment

| Principle | Score |
|-----------|-------|
| Controls live where they act | ✅ Improved (tie on step, not track) |
| Visual feedback immediate | ✅ Maintained |
| No hidden modes | ✅ Improved (gate toggle was hidden state) |
| Progressive disclosure | ✅ Maintained (ties via modifier) |

---

## Teenage Engineering Research

Keyboardia's UI philosophy is inspired by Teenage Engineering. This section documents how TE handles note duration across their product range.

### Product Hierarchy (Most to Least Sophisticated)

| Product | Note Duration Approach |
|---------|----------------------|
| **OP-Z / OP-XY** | Track note length + step ties + step components + drone mode |
| **PO-14/16/28** | Per-step note length parameter + glide |
| **OP-1 Field** | ADSR envelope + Hold sequencer mode |
| **TX-6** | Portamento/slide for melodic sequences |
| **EP-133** | Sample plays to completion (no gating) |
| **PO-12/24/32** | One-shot only + step multiplier for rolls |

### OP-Z: The Most Complete Implementation

The OP-Z has the most sophisticated note duration system in TE's lineup:

#### 1. Track-Level Note Length Default

Each track has a **note length parameter** (`TRACK + Green dial`):

| Setting | Behavior |
|---------|----------|
| 1/64 to 1 bar | Fixed note length |
| Poly mode | Polyphonic, notes overlap |
| Mono mode | Monophonic, new notes cut old |
| Legato mode | Monophonic with glide |
| **Drone mode** | Notes sustain infinitely until retriggered |

#### 2. Step-Level Ties (Matches Our Proposal)

The OP-Z gesture for creating multi-step notes:

```
1. Hold the first step button
2. Press the step where you want the note to END
3. Keep holding the first step
4. Press the notes you want played
```

This is the **exact interaction pattern** proposed in this spec.

#### 3. Step Components

The OP-Z has **14 step components**, three of which control duration:

| Component | Function | Values |
|-----------|----------|--------|
| **Pulse** | Retriggers note N times across extended steps | 1-9, Random |
| **Pulse Hold** | Holds note without retriggering for N steps | 1-9, Random |
| **Multiply** (Ratchet) | Retriggers within single step (subdivides) | 2-9, Random |

**Pulse Hold** is essentially the same as our `tie` proposal — it sustains the note for additional steps without retriggering.

#### 4. Portamento (Glide)

`TRACK + Red dial` adds pitch glide between notes, creating TB-303-style slides.

### OP-1's Limitation (Validates Our Approach)

The OP-1 notably **lacks** per-step note duration. Users frequently ask:
> "How to enter long notes on pattern sequencer?"

The OP-1 Field added a "Hold" sequencer specifically to address this gap — evidence that sustained notes are a real user need.

### EP-133's Gap (User Feedback)

The EP-133 shipped without gate modes. Forum feedback explicitly identifies this as a limitation:
> "PLAYBACK MODE = GATE / SUSTAIN / LOOP" — top requested feature
> "If samples only trigger by gate I would stress that as the 2nd biggest downfall"

This validates that note duration control is a feature users expect.

### TE's Implicit Design Rule

Across all products, TE follows this pattern:

| Instrument Type | Duration Behavior |
|-----------------|-------------------|
| **Drums/Percussion** | One-shot (plays to completion) |
| **Synths** | Envelope-based + optional ties |
| **Samples** | One-shot default, configurable |

Our proposal aligns with this: drums ignore ties, synths respect them.

### Design Philosophy Insight

TE's approach to constraints:
> "Deliberate limitations in features... are not weaknesses but intentional design choices. These constraints force users to be more creative and resourceful."

This validates our decision to use a simple `tie: boolean` rather than complex gate percentages — **constraints breed creativity**.

---

## Research Sources

### Teenage Engineering (Primary Inspiration)
- [OP-Z Guide: Step Components](https://teenage.engineering/guides/op-z/step-components) — Pulse, Pulse Hold, Multiply
- [OP-Z Guide: Track](https://teenage.engineering/guides/op-z/track) — Note length, drone mode, legato
- [OP-XY Guide: Step Components](https://teenage.engineering/guides/op-xy/step-components) — Same 14 components
- [OP-1 Guide: Sequencers](https://teenage.engineering/guides/op-1/original/sequencers) — Endless, Pattern, Tombola
- [EP-133 Guide](https://teenage.engineering/guides/ep-133) — Fader automation limitations
- [PO-33 Guide](https://teenage.engineering/guides/po-33/en) — Sample playback modes

### Other Hardware Sequencers
- Roland TB-303: Tie-forward flag, tied notes ignore pitch
- Elektron Digitakt/Syntakt: Gate length parameter (LEN), per-step
- Novation Circuit: Tie-forward + gate length, orange color for ties

### Desktop DAWs
- Logic Pro Step Sequencer: Tie subrow, click edges to connect
- Bitwig Stepwise: Gate mode auto-connects adjacent steps
- FL Studio: Drag note edges, right-click deletes
- Ableton Push: Hold pad + turn encoder for length

### Web/Mobile
- Korg Gadget: Tap-hold-drag for note length
- Audio Evolution: Tap-hold-drag on note end

### Key Insight from Research

**Velocity is set once at note start** — this is universal:
> "In Gate mode... two or more steps enabled in a row result in a single, longer note — using the initial trigger velocity." — Bitwig Manual

---

## Open Questions

1. **Loop boundary**: Should a note tie from step 16 back to step 1? (Probably no — treat loop boundary as implicit note-off)

2. **Polyrhythmic tracks**: If track A has 16 steps and track B has 12 steps, how do ties interact with different loop lengths? (Likely: each track is independent)

3. **Chromatic grid**: Should ties be editable in the chromatic view? (Yes, probably as horizontal bars that can be dragged to resize)

4. **MIDI export**: How do ties map to MIDI note duration? (Directly — tied steps become longer note-on to note-off span)

---

## Interactions with Roadmap Features

This section analyzes how held notes interacts with other planned features — both positively and negatively.

### Strongly Positive Interactions

#### MIDI Export (Phase 35)

**Synergy: Critical enabler**

Without ties, all exported notes are 1/16th duration. With ties, MIDI export can produce correct note lengths that sound right in DAWs.

```
Current export (no ties):     With ties:
Note On  C4 @ beat 1          Note On  C4 @ beat 1
Note Off C4 @ beat 1.25       Note Off C4 @ beat 2  ← musically correct
Note On  C4 @ beat 1.25
Note Off C4 @ beat 1.5
...
```

**Implementation:** When exporting, scan for tied sequences and emit single Note On → Note Off spanning the full duration.

#### Pattern Chaining (Priority 2 in Composition Affordances)

**Synergy: Independent, complementary**

Ties work within patterns. Pattern chaining works across patterns. No interference — they compose naturally.

A tied note spanning steps 15-16 simply ends at step 16. The next pattern starts fresh. No cross-pattern ties needed (and none supported — keeps it simple).

#### Scale Lock (Priority 5)

**Synergy: Orthogonal**

Scale lock constrains **pitch**. Ties control **duration**. They work on different dimensions and enhance each other:
- Scale lock ensures melodic correctness
- Ties enable legato phrasing

Together they make melodic composition easier for beginners.

#### Keyboard Shortcuts (Phase 34)

**Synergy: Natural extension**

Keyboard shortcuts can accelerate tie workflows:

| Shortcut | Action |
|----------|--------|
| `→` (while step selected) | Extend tie forward |
| `←` (while step selected) | Shorten tie / break |
| `Shift+→` | Create tie to next step |

This matches how arrow keys adjust duration in DAW piano rolls.

#### Undo/Redo (Priority 1)

**Synergy: No special handling needed**

Tie creation/removal is just a parameter lock change. The existing undo model (command pattern on ParameterLock mutations) handles ties automatically.

### Complex Interactions (Decisions Required)

#### Step Probability (Priority 4)

**Tension: What happens when a tied step has probability < 100%?**

| Scenario | Question |
|----------|----------|
| Step 1 triggers, step 2 (tied) has 50% probability | Does the note get cut short if step 2's coin flip fails? |
| Step 1 has 50% probability, step 2 tied | If step 1 doesn't play, does step 2 play? |

**Recommendation:** Probability only applies to **note-start** steps. Tied continuation steps are not subject to probability — they either continue or don't exist.

```typescript
// In scheduler
if (track.steps[step]) {
  const pLock = track.parameterLocks[step];

  // Tied steps don't roll probability (they continue previous note)
  if (pLock?.tie) {
    return; // Note already playing from previous step
  }

  // Only note-starts roll probability
  const probability = pLock?.probability ?? 100;
  if (Math.random() * 100 < probability) {
    const duration = calculateTiedDuration(track, step);
    playNote(track, step, duration);
  }
}
```

#### Ratcheting / Retrigger (Priority 8)

**Tension: Opposite concepts**

| Feature | What it does |
|---------|--------------|
| **Tie** | Extend one note across multiple steps (fewer triggers) |
| **Ratchet** | Multiple triggers within one step (more triggers) |

These are conceptually inverse. Can a step have both?

**Recommendation:** Mutually exclusive. If a step has `tie: true`, ignore any `ratchet` value. Rationale: a tied step doesn't trigger at all — it continues the previous note.

```typescript
interface ParameterLock {
  pitch?: number;
  volume?: number;
  tie?: boolean;
  ratchet?: number;  // Ignored if tie is true
}
```

#### Beat-Quantized Changes (Phase 31)

**Tension: What if a tied note is mid-sustain when a remote edit arrives?**

Scenario: Player A has a note tied across steps 1-4. Player B edits step 3 while Player A is at step 2.

**Options:**
1. **Immediate apply**: Note continues, edit takes effect next loop
2. **Wait for note end**: Defer edit until step 4 boundary
3. **Interrupt**: Cut the note, apply edit immediately

**Recommendation:** Option 1 (immediate apply, next-loop effect). This matches how other parameter locks work — the change syncs immediately but affects playback on the next trigger. A mid-sustain note continues unaffected.

#### Euclidean Generator (Priority 3)

**Tension: Should Euclidean generate ties?**

Euclidean rhythms are inherently **trigger patterns** — they determine *where* notes occur, not *how long* they last.

**Recommendation:** Euclidean generates triggers only. Ties are applied manually afterward.

**Future enhancement:** Add a "legato" checkbox that auto-ties consecutive hits:
```
Euclidean(8, 3):           [●○○●○○●○]
Euclidean(8, 3) + legato:  [●──●──●○]  ← ties fill gaps
```

But this is out of scope for initial tie implementation.

#### Quick Fill / Variation (Priority 6)

**Tension: How do variations affect tied notes?**

| Variation | Tie Behavior |
|-----------|--------------|
| **Sparse** (remove steps) | If a tied step is removed, break the tie chain at that point |
| **Dense** (add steps) | New steps are untied (triggers) |
| **Shift** (rotate) | Ties rotate with their steps — relationships preserved |
| **Reverse** | Ties... reverse? (start becomes end) — complex, maybe don't preserve |
| **Humanize** | Ties unaffected (humanize affects timing/velocity) |
| **Mutate** | Ties could be randomly broken or created — TBD |

**Recommendation:** Document these behaviors when implementing variations. Simplest approach: variations operate on triggers only, resetting ties. Users can re-add ties after variation.

### Neutral Interactions

#### Velocity Sensitivity (Phase 28)

**Already addressed in spec:** Velocity comes from the first step only. This is the industry standard and is already documented in the Behavioral Rules section.

#### Shared Sample Recording (Phase 29)

**No interaction.** Recorded samples are one-shot by default (ties ignored per instrument-specific behavior).

#### Track Groups (Priority 10)

**No interaction.** Groups are organizational; ties are per-step data. They don't affect each other.

#### Pattern Overview / Mini-Map (Priority 7)

**Minor consideration:** The mini-map should visually indicate tied notes (connected dots or horizontal bars). But this is a visualization detail, not a data model concern.

### Interaction Summary

| Feature | Interaction | Complexity | Decision Needed |
|---------|-------------|------------|-----------------|
| MIDI Export | ✅ Strongly positive | Low | No |
| Pattern Chaining | ✅ Positive | None | No |
| Scale Lock | ✅ Positive | None | No |
| Keyboard Shortcuts | ✅ Positive | Low | No |
| Undo/Redo | ✅ Positive | None | No |
| Step Probability | ⚠️ Complex | Medium | Yes — tied steps exempt |
| Ratcheting | ⚠️ Conflicting | Medium | Yes — mutually exclusive |
| Beat-Quantized | ⚠️ Complex | Medium | Yes — next-loop effect |
| Euclidean | ⚠️ Interaction | Low | No — triggers only |
| Quick Fill | ⚠️ Interaction | Medium | Yes — per-variation rules |
| Velocity | ✅ Already addressed | None | No |
| Sample Recording | ⚡ None | None | No |
| Track Groups | ⚡ None | None | No |

---

## References

- [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md) — Design principles
- [RESEARCH-PLAYBACK-MODES.md](./research/RESEARCH-PLAYBACK-MODES.md) — Gate vs oneshot analysis
- [MUSICAL-COVERAGE-ANALYSIS.md](./research/MUSICAL-COVERAGE-ANALYSIS.md) — Genre impact
- [COMPOSITION-AFFORDANCES.md](./research/COMPOSITION-AFFORDANCES.md) — Feature priorities
