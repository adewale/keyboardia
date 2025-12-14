# Keyboard Shortcuts Specification

A future-looking spec for keyboard shortcuts in Keyboardia. Currently, Keyboardia is primarily mouse/touch-driven with minimal keyboard support.

## Current State

### Implemented

| Shortcut | Action | Location |
|----------|--------|----------|
| Escape | Cancel copy mode | StepSequencer |
| Escape | Close QR overlay | QROverlay |
| Hold + Click | Open p-lock editor | StepCell |
| Shift+Click | Open p-lock editor (desktop) | StepCell |

### Not Implemented

No global keyboard shortcuts exist yet. All interactions require mouse/touch.

---

## Design Principles

Before adding keyboard shortcuts, consider these principles derived from our UI philosophy and mobile lessons:

### 1. Discoverability Over Efficiency

From MOBILE-LESSONS.md:
> "Long-press is more discoverable than modifier keys."

Keyboard shortcuts are **power user features**. They should:
- Never be the *only* way to do something
- Supplement visible UI, not replace it
- Be documented in a discoverable place (help menu, tooltips)

### 2. Consistent Modifier Semantics

Currently, **Shift+Click** means "open detail editor" (p-lock editor for steps). Any new Shift+Click behavior should follow this semantic:

| Context | Shift+Click Meaning |
|---------|---------------------|
| Step cell | Open p-lock editor (edit step details) |
| Solo button | ??? (see analysis below) |
| Track name | ??? |

### 3. Touch Parity

Every keyboard shortcut should have a touch equivalent:
- Single-key shortcuts → Single tap
- Shift+Click → Long-press
- Ctrl/Cmd+Click → ??? (no touch equivalent - avoid)

---

## Shift+Click for Exclusive Solo: Analysis

### The Question

Should Shift+Click on the Solo button trigger "exclusive solo" (un-solo all others)?

### Current Shift+Click Semantics

Shift+Click on **step cells** means: "I want to edit the details of this specific thing."

This is a **disclosure** action - it reveals more options for the clicked element.

### Exclusive Solo Semantics

Exclusive solo means: "I want ONLY this one, turn off all others."

This is an **exclusion** action - it affects other elements, not the clicked one.

### The Conflict

These are different semantic categories:

| Modifier | Current Meaning | Proposed Solo Meaning |
|----------|-----------------|----------------------|
| Shift+Click | Disclose details of *this* | Exclude *others* |

Using Shift+Click for exclusive solo would create **inconsistent modifier semantics**.

### Alternatives to Shift+Click

| Alternative | Pros | Cons |
|-------------|------|------|
| **Double-click** | Quick, no modifier key | Not discoverable, no touch equivalent |
| **Long-press** | Touch-friendly, consistent with p-lock | Conflicts with "edit details" pattern |
| **Alt+Click** | Different modifier = different action | Alt has OS conflicts, no touch equivalent |
| **Context menu** | Discoverable, extensible | Breaks flow, feels heavy |
| **Dedicated button** | Always visible | Takes space, clutters UI |
| **No exclusive solo** | Simplest | Users must manually un-solo |

### Decision: No Exclusive Solo

**We will not implement exclusive solo.** Rationale:

1. **Breaks modifier semantics** - Shift+Click means "disclose details", not "exclude others"
2. **No touch equivalent** - Modifier+click has no natural touch gesture
3. **Unnecessary complexity** - Users can click other solo buttons to un-solo
4. **Mental model violation** - Solo is additive; exclusive behavior is surprising
5. **Explicit UI philosophy** - Keyboardia favors explicit actions over hidden shortcuts

If a user wants to hear only one track, they explicitly un-solo the others. This matches the direct manipulation philosophy of the UI.

---

## Future Keyboard Shortcuts (If Implemented)

These are candidates for future implementation, prioritized by impact:

### High Priority (Transport)

| Shortcut | Action | Rationale |
|----------|--------|-----------|
| Space | Play/Pause | Universal media control |
| Escape | Stop + Reset to step 0 | Emergency stop |

### Medium Priority (Navigation)

| Shortcut | Action | Rationale |
|----------|--------|-----------|
| ↑/↓ | Select previous/next track | Keyboard navigation |
| Tab | Move to next track | Standard focus navigation |
| Enter | Toggle step on focused track | Keyboard step editing |

### Medium Priority (Chromatic Grid / Pitch Editing)

From [ROADMAP.md Phase 4B](./ROADMAP.md) - deferred during ChromaticGrid implementation.

| Shortcut | Action | Rationale |
|----------|--------|-----------|
| ↑/↓ | Adjust pitch of selected step ±1 semitone | Quick melodic editing |
| Shift+↑/↓ | Adjust pitch ±12 semitones (octave) | Quick octave jumps |

**Context:**
- Requires: Selected step in expanded ChromaticGrid view
- Touch equivalent: Tap different pitch row in ChromaticGrid (already implemented)
- Note: ChromaticGrid already supports click-to-place at any pitch; these shortcuts would enable finer control once a step is selected

### Low Priority (Editing)

| Shortcut | Action | Rationale |
|----------|--------|-----------|
| M | Toggle mute on focused track | Quick mute |
| S | Toggle solo on focused track | Quick solo |
| Delete/Backspace | Clear focused track | Quick clear |
| Ctrl+C / Ctrl+V | Copy/Paste pattern | Standard clipboard |
| Ctrl+Z | Undo | Standard undo (requires undo system) |

### Power User (Future)

| Shortcut | Action | Rationale |
|----------|--------|-----------|
| 1-9 | Select track 1-9 | Quick track access |
| +/- | Adjust tempo ±1 BPM | Fine tempo control |
| [ / ] | Adjust swing ±5% | Fine swing control |
| ⌘+Shift+E / Ctrl+Shift+E | Download MIDI | Export session to DAW |

---

## Implementation Notes

### Focus Management

Keyboard shortcuts require a focus model:
1. **Global shortcuts** (Space for play) work regardless of focus
2. **Track shortcuts** (M, S) require a "focused track" concept
3. **Step shortcuts** require a "focused step" concept

Currently, Keyboardia has no focus indicators. Adding keyboard shortcuts would require:
- Visual focus ring on tracks
- Arrow key navigation between tracks
- Possibly step-level focus for melodic editing

### Accessibility Considerations

Keyboard shortcuts are an accessibility feature:
- Screen reader users need keyboard navigation
- Motor-impaired users may prefer keyboard over mouse
- Should follow ARIA patterns for grid navigation

### Touch Equivalents Required

Before implementing any shortcut, define the touch equivalent:

| Keyboard | Touch | Notes |
|----------|-------|-------|
| Space | Tap play button | Already exists |
| M | Tap mute button | Already exists |
| S | Tap solo button | Already exists |
| Shift+Click | Long-press | Already implemented |
| Double-click | Double-tap | Not yet implemented |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2024-12 | No exclusive solo (ever) | Breaks modifier semantics, no touch equivalent, unnecessary complexity |
| 2024-12 | Shift+Click = "disclose details" | Established by p-lock editor pattern |

---

## References

- [MOBILE-LESSONS.md](./MOBILE-LESSONS.md) - Discoverability vs efficiency
- [SOLO.md](./SOLO.md) - Solo feature specification
- [WAI-ARIA Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) - Accessibility patterns
