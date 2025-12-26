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

#### Desktop

| Action | Gesture | Notes |
|--------|---------|-------|
| **Create tied note** | Activate step, then Shift+Click next step | Matches "Shift = modify detail" pattern |
| **Extend existing tie** | Shift+Click additional steps | Same gesture, additive |
| **Break tie** | Click tied step (toggles it off) | Consistent with current toggle behavior |
| **Quick multi-step note** | Shift+Drag across steps | Power user gesture |

#### Mobile

| Action | Gesture | Notes |
|--------|---------|-------|
| **Create tied note** | Long-press step → "Tie to next" option | Fits existing p-lock editor pattern |
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

## Research Sources

### Hardware Sequencers
- Roland TB-303: Tie-forward flag, tied notes ignore pitch
- Elektron Digitakt/Syntakt: Gate length parameter (LEN), per-step
- Novation Circuit: Tie-forward + gate length, orange color for ties
- Teenage Engineering OP-Z: Gate percentage via encoder

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

## References

- [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md) — Design principles
- [RESEARCH-PLAYBACK-MODES.md](./research/RESEARCH-PLAYBACK-MODES.md) — Gate vs oneshot analysis
- [MUSICAL-COVERAGE-ANALYSIS.md](./research/MUSICAL-COVERAGE-ANALYSIS.md) — Genre impact
- [COMPOSITION-AFFORDANCES.md](./research/COMPOSITION-AFFORDANCES.md) — Feature priorities
