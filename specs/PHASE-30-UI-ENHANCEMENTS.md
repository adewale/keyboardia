# Phase 30: UI Enhancements

> **Status:** Not Started
> **Goal:** Polish visual feedback, add pattern manipulation tools, improve information display, and enhance editing conveniences.

---

## 30A: Visual Feedback

### Progress Bar Above Grid

Display a thin progress indicator above the step grid showing playback position.

| Property | Value |
|----------|-------|
| Height | 2-3px |
| Position | Above step grid, full width |
| Color | `--color-playhead` (white) |
| Behavior | Moves left-to-right during playback, resets on stop |

**Implementation:**
- Calculate position from current step / total steps (use longest track for reference)
- CSS transition for smooth movement between steps
- Hidden when stopped

### Metronome Pulse on Play Button

Visual beat indicator on the play button during playback.

| Property | Value |
|----------|-------|
| Trigger | Every beat (quarter note) |
| Effect | Brief scale pulse (1.0 → 1.1 → 1.0) or opacity flash |
| Duration | ~100ms |
| Sync | Aligned to audio scheduler beat |

**Implementation:**
- Subscribe to scheduler beat events
- CSS animation triggered by class toggle
- Respect `prefers-reduced-motion`

---

## 30B: Pattern Manipulation

Add pattern transformation tools to each track.

### Rotate Pattern Left/Right

Shift all active steps by one position, wrapping around.

| Action | Result |
|--------|--------|
| Rotate Left | Step 0 → Step 15, Step 1 → Step 0, etc. |
| Rotate Right | Step 15 → Step 0, Step 0 → Step 1, etc. |

**UI:** Arrow buttons (← →) in track actions or context menu.

### Invert Pattern

Toggle all steps: active becomes inactive, inactive becomes active.

| Before | After |
|--------|-------|
| `[X][ ][ ][X]` | `[ ][X][X][ ]` |

**UI:** Invert button (⊘ or similar) in track actions.

### Random Fill

Fill track with random pattern based on density setting.

| Option | Description |
|--------|-------------|
| Density | 25% / 50% / 75% probability per step |
| Preserve existing | Option to only fill empty steps |

**UI:** Dice button (🎲) with density dropdown or shift-click for variants.

---

## 30C: Information Display

### Category Color Coding on Tracks

Visual indication of instrument category via color accent.

| Category | Color | Examples |
|----------|-------|----------|
| Drums/Percussion | Orange (`--color-accent`) | 808-kick, acoustic-snare |
| Bass | Purple (`--color-purple`) | finger-bass, sub-bass |
| Keys/Pads | Cyan (`--color-cyan`) | rhodes-ep, pad |
| Melodic | Teal (`--color-teal`) | vibraphone, marimba |
| Strings/Brass | Info blue (`--color-info`) | string-section, french-horn |
| FX/Ambient | Gray | vinyl-crackle, noise |

**Implementation:**
- Left border or background tint on track row
- Subtle enough not to distract, visible enough to aid scanning
- Category derived from instrument metadata in `samples.ts`

### Dim Unused Beat Markers

Reduce visual noise by dimming steps that are off.

| State | Opacity |
|-------|---------|
| Active step | 100% |
| Inactive step (in use area) | 60-70% |
| Inactive step (beyond track length) | 30-40% |

**Implementation:**
- CSS opacity on `.step-cell:not(.active)`
- Darker for steps beyond current track's `stepCount`

---

## 30D: Editing Conveniences

### Double-Click Track Name to Rename

Inline editing of track names.

| Interaction | Result |
|-------------|--------|
| Double-click track name | Text input appears |
| Enter / blur | Save name |
| Escape | Cancel edit |

**Implementation:**
- `contentEditable` or controlled input overlay
- Dispatch `SET_TRACK_NAME` action
- Sync via multiplayer (`track_name` message type)
- Max length: 32 characters
- XSS prevention: sanitize on save

---

## 30E: Motion

### Play Button Fill Effect on Hover

Subtle fill animation on hover for play button.

| State | Effect |
|-------|--------|
| Hover | Background fills from left to right |
| Press | Instant fill |
| Release | Fill drains or fades |

**Implementation:**
- CSS `::before` pseudo-element with `transform: scaleX(0)` → `scaleX(1)`
- Transition: 200-300ms ease-out
- Respect `prefers-reduced-motion`

---

## Implementation Priority

| Feature | Priority | Effort | Dependencies |
|---------|----------|--------|--------------|
| Progress bar | High | Low | Scheduler beat events |
| Metronome pulse | High | Low | Scheduler beat events |
| Category color coding | High | Low | Instrument metadata |
| Dim unused beats | Medium | Low | None |
| Rotate pattern | Medium | Medium | New reducer actions |
| Invert pattern | Medium | Low | New reducer action |
| Random fill | Medium | Medium | New reducer action |
| Double-click rename | Medium | Medium | New message type |
| Play button hover | Low | Low | CSS only |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Visual feedback latency | < 16ms (one frame) |
| Animation smoothness | 60fps, no jank |
| Reduced motion support | All animations respect user preference |
| Pattern operations | Instant (< 50ms) |

---

## Files to Modify

| File | Changes |
|------|---------|
| `StepSequencer.tsx` | Progress bar component |
| `StepSequencer.css` | Progress bar styles |
| `Transport.tsx` | Metronome pulse, play button hover |
| `Transport.css` | Pulse animation, fill effect |
| `TrackRow.tsx` | Category color, rename, pattern actions |
| `TrackRow.css` | Category border, action buttons |
| `StepCell.css` | Dim inactive steps |
| `grid.tsx` | ROTATE_PATTERN, INVERT_PATTERN, RANDOM_FILL actions |
| `types.ts` | New action types |
| `samples.ts` | Category metadata per instrument |
| `live-session.ts` | `track_name` message handler |

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Progress bar position | Above grid | Doesn't interfere with step interaction |
| Category colors | Left border | Subtle, scannable, doesn't compete with step colors |
| Rotate vs shift | Rotate (wrap) | More musical, preserves pattern density |
| Random density | Preset options | Simpler than slider, covers common use cases |
| Rename trigger | Double-click | Standard UI pattern, doesn't conflict with single-click |
