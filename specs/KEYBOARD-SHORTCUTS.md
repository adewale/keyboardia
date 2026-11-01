# Keyboard Shortcuts Specification

Keyboard shortcuts for efficient Keyboardia workflows. The app supports both mouse/touch and keyboard interactions.

## Supported Shortcuts

All currently implemented keyboard shortcuts:

| Shortcut | Action | Context | Touch Equivalent |
|----------|--------|---------|------------------|
| **Space** | Play/Pause | Global | Tap play button |
| **Escape** | Cancel copy mode | StepSequencer | Tap elsewhere |
| **Escape** | Clear selection | StepSequencer | Tap elsewhere |
| **Escape** | Close QR overlay | QROverlay | Tap X button |
| **Escape** | Close bottom sheet | BottomSheet | Tap outside |
| **Delete / Backspace** | Delete selected steps | With selection | — |
| **Cmd/Ctrl+Shift+M** | Unmute all tracks | Global | — |
| **Shift+Click** | Open p-lock editor | StepCell | Long-press |
| **Hold + Click** | Open p-lock editor | StepCell | Long-press |
| **Ctrl/Cmd+Click** | Toggle step selection | StepCell | — |
| **Shift+Click** | Extend selection | StepCell (with anchor) | — |

---

## Implementation Status

### Phase 1: Basic Keyboard Support ✅
- ✅ Escape to cancel copy mode
- ✅ Escape to close QR overlay
- ✅ Escape to close bottom sheets
- ✅ Escape to clear selection
- ✅ Delete/Backspace to delete selected steps
- ✅ Hold + Click to open p-lock editor
- ✅ Shift+Click to open p-lock editor (desktop)
- ✅ ? to show keyboard shortcuts help panel

### Phase 2: Transport Shortcuts ✅
- ✅ Space for Play/Pause
- ✅ Cmd/Ctrl+Shift+M for Unmute All
- ⬜ Escape for Stop + Reset (not yet, Escape used for cancel/close)

### Phase 3: Navigation & Editing (Not Started)
- ⬜ Arrow keys for track/step navigation
- ⬜ Enter to toggle steps
- ⬜ Single-letter shortcuts (M/S)
- ⬜ Focus management system

---

## Design Principles

### 1. Discoverability Over Efficiency

Keyboard shortcuts are **power user features**. They should:
- Never be the *only* way to do something
- Supplement visible UI, not replace it
- Be documented in a discoverable place (help menu, tooltips)

### 2. Consistent Modifier Semantics

**Shift+Click** means "open detail editor" (p-lock editor for steps). Any new Shift+Click behavior should follow this semantic:

| Context | Shift+Click Meaning |
|---------|---------------------|
| Step cell | Open p-lock editor (edit step details) |

### 3. Touch Parity

Every keyboard shortcut should have a touch equivalent:
- Single-key shortcuts → Single tap
- Shift+Click → Long-press
- Ctrl/Cmd+Click → No touch equivalent (use sparingly)

---

## Future Shortcuts

Candidates for future implementation:

### Navigation (Requires Focus System)

| Shortcut | Action | Prerequisite |
|----------|--------|--------------|
| ↑/↓ | Select previous/next track | Focus management |
| Tab | Move to next track | Focus indicators |
| Enter | Toggle step on focused track | Step focus |

### Pitch Editing (ChromaticGrid)

| Shortcut | Action | Prerequisite |
|----------|--------|--------------|
| ↑/↓ | Adjust pitch ±1 semitone | Selected step in ChromaticGrid |
| Shift+↑/↓ | Adjust pitch ±12 semitones | Selected step in ChromaticGrid |

### Track Shortcuts (Requires Focused Track)

| Shortcut | Action | Prerequisite |
|----------|--------|--------------|
| M | Toggle mute on focused track | Focus management |
| S | Toggle solo on focused track | Focus management |

---

## Implementation Notes

### Focus Management (Not Yet Implemented)

Keyboard shortcuts require a focus model:
1. **Global shortcuts** (Space for play) work regardless of focus ✅
2. **Track shortcuts** (M, S) require a "focused track" concept
3. **Step shortcuts** require a "focused step" concept

Currently, Keyboardia has no focus indicators. Adding navigation shortcuts would require:
- Visual focus ring on tracks
- Arrow key navigation between tracks
- Possibly step-level focus for melodic editing

### Accessibility Considerations

Keyboard shortcuts are an accessibility feature:
- Screen reader users need keyboard navigation
- Motor-impaired users may prefer keyboard over mouse
- Should follow ARIA patterns for grid navigation

### Text Input Guards

Global shortcuts (Space, Escape, Delete) skip activation when:
- User is typing in an `<input>` element
- User is typing in a `<textarea>` element
- User is in a `contenteditable` element

This prevents conflicts with text editing.

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2024-12-01 | No exclusive solo (ever) | Breaks modifier semantics, no touch equivalent |
| 2024-12-01 | Shift+Click = "disclose details" | Established by p-lock editor pattern |
| 2026-01-16 | Space for Play/Pause | Universal expectation, high value |

---

## References

- [WAI-ARIA Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) - Accessibility patterns
- [SOLO.md](./SOLO.md) - Solo feature specification
