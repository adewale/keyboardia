# Phase 30: UI Enhancements

> **Status:** Not Started
> **Goal:** Transform step entry, add professional workflow features, polish visual feedback, and improve discoverability.

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
- Smooth easing via CSS custom properties (`--progress-easing: cubic-bezier(0.4, 0, 0.2, 1)`)
- Hidden when stopped

**Polyrhythm behavior:**

Progress bar shows position relative to the **longest track**. Shorter tracks loop multiple times within one progress cycle.

| Longest Track | Progress Range | 5-step track loops |
|---------------|----------------|-------------------|
| 16 steps | 0% → 100% | 3× per cycle |
| 32 steps | 0% → 100% | 6× per cycle |

Individual track looping is already visible via step highlighting. The progress bar provides global orientation, not per-track precision.

**Optional enhancement:** Subtle pulse or marker when shorter tracks restart (low priority).

### Metronome Pulse on Play Button

Visual beat indicator on the play button during playback, synced to tempo.

| Property | Value |
|----------|-------|
| Trigger | Every beat (quarter note), synced to BPM |
| Effect | Brief scale pulse (1.0 → 1.1 → 1.0) or opacity flash |
| Duration | Proportional to tempo (~100ms at 120 BPM) |
| Sync | Aligned to audio scheduler beat events |

**Implementation:**
- Subscribe to scheduler beat events
- CSS animation with duration derived from `--beat-duration` CSS variable
- Smooth easing: `--pulse-easing: cubic-bezier(0.4, 0, 0.6, 1)`
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

### Reverse Pattern

Play the pattern backwards. Instant new groove from existing work.

| Before | After |
|--------|-------|
| `[X][ ][X][ ][ ][ ][ ][X]` | `[X][ ][ ][ ][ ][X][ ][X]` |

**UI:** Reverse button (⇆) in track actions.

### Mirror Pattern

Create ABCDCBA structure from ABCD. Musical symmetry that sounds intentional.

| Before (ABCD) | After (ABCDCBA) |
|---------------|-----------------|
| `[X][ ][X][X]` | `[X][ ][X][X][X][ ][X]` (if space allows) |

**Implementation:**
- Mirrors pattern within current step count
- First half defines pattern, second half mirrors it
- Useful for 8, 16, 32 step patterns

**UI:** Mirror button (◇) in track actions.

### Euclidean Rhythm Generator

Slider that distributes N hits across M steps mathematically. Bjorklund's algorithm creates rhythms found in world music (West African, Cuban, etc.).

| Steps | Hits | Pattern | Musical Style |
|-------|------|---------|---------------|
| 8 | 3 | `[X][ ][ ][X][ ][ ][X][ ]` | Cuban tresillo |
| 8 | 5 | `[X][ ][X][X][ ][X][X][ ]` | Cuban cinquillo |
| 16 | 5 | Distributed evenly | Bossa nova |

**UI:**
- "Fill" slider (1 to stepCount) on each track
- Dragging redistributes active steps using Euclidean algorithm
- Visual feedback is instant as slider moves

**Implementation:**
```typescript
// Bjorklund's algorithm
function euclidean(steps: number, hits: number): boolean[] {
  // Returns array of length `steps` with `hits` trues distributed maximally evenly
}
```

---

## 30C: Information Display

### Category Color Coding on Tracks

Visual indication of instrument category via **left border** on each track row.

| Category | Color | Examples |
|----------|-------|----------|
| Drums/Percussion | Orange (`--color-accent`) | 808-kick, acoustic-snare |
| Bass | Purple (`--color-purple`) | finger-bass, sub-bass |
| Keys/Pads | Cyan (`--color-cyan`) | rhodes-ep, pad |
| Melodic | Teal (`--color-teal`) | vibraphone, marimba |
| Strings/Brass | Info blue (`--color-info`) | string-section, french-horn |
| FX/Ambient | Gray | vinyl-crackle, noise |

**Implementation:**
- 3-4px left border on track row
- Subtle enough not to distract, visible enough to aid scanning
- Category derived from instrument metadata in `samples.ts`

```css
.track-row[data-category="drums"] { border-left: 4px solid var(--color-accent); }
.track-row[data-category="bass"] { border-left: 4px solid var(--color-purple); }
/* etc. */
```

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

### Per-Track Swing

Individual swing amount per track, in addition to global swing.

| Property | Value |
|----------|-------|
| Range | 0-100% (same as global) |
| Behavior | Combines with global swing multiplicatively |
| Default | 0% (uses global swing only) |

**UI:** Small swing knob or dropdown per track row (possibly in expanded view).

**Use cases:**
- Straight hi-hats over swung kick/snare
- Tight bass with loose drums
- Different groove feels per instrument

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

## 30F: Core Interaction Improvements

### Drag to Paint Steps

Step entry is the core activity. Currently it's click-click-click-click. Should be click-drag-release.

**Why:** This is how Ableton, FL Studio, and every hardware sequencer works. Makes step entry roughly 5x faster for typical patterns.

| Interaction | Result |
|-------------|--------|
| Mouse down on step | Start paint mode, toggle that step |
| Mouse move (drag) | Toggle steps under cursor |
| Mouse up | End paint mode |

**Paint mode behavior:**
- First step clicked determines "paint state" (on or off)
- All subsequent steps in the drag get set to that state
- Prevents accidental toggling back and forth

**Implementation:**
```typescript
const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);

onMouseDown={(step) => {
  const newState = !step.active;
  setPaintMode(newState ? 'on' : 'off');
  toggleStep(step);
}}

onMouseEnter={(step) => {
  if (paintMode !== null && step.active !== (paintMode === 'on')) {
    toggleStep(step);
  }
}}

onMouseUp={() => setPaintMode(null)}
```

**Touch support:**
- Same behavior with touch events
- Consider `pointer` events for unified handling

### Multi-Select Steps

Select multiple steps to delete, copy, move, or apply the same parameter lock.

**Why:** Currently every operation is one step at a time. This enables "select beats 1-8 of the hi-hat and copy to beats 9-16."

| Interaction | Result |
|-------------|--------|
| Click + drag | Draw selection box |
| Shift + click | Extend selection to clicked step |
| Ctrl/Cmd + click | Toggle step in selection |
| Delete/Backspace | Clear selected steps |
| Ctrl/Cmd + C | Copy selection |
| Ctrl/Cmd + V | Paste at playhead or selection start |

**Visual:**
- Selection highlight (blue tint or border)
- Selection count indicator

**Operations on selection:**
- Clear all
- Apply p-lock (velocity, pitch, **tie**) to all
- Copy to clipboard (for paste)
- Move (drag selection to new position)

**Tie/Held Note Support:**
- Selection includes tie state — copying preserves ties
- "Apply tie to selection" creates legato phrase across selected steps
- "Remove tie from selection" articulates each step separately
- Enables quick creation of held note passages

**Polyrhythm behavior:**
- Cross-track selection bounded by each track's step count
- Selecting "columns 1-8" on a 5-step track selects steps 1-5 only
- Operations apply to the intersection of selection and actual steps

---

## 30G: Workflow Features

### Loop Selection (Play Only Selected Region)

"Just play steps 17-32 while I work on them."

**Why:** Currently you hear the entire pattern every time. For 64-128 step patterns, this means waiting through 50+ steps to hear your change.

| Interaction | Result |
|-------------|--------|
| Drag on timeline ruler | Select loop region (in steps) |
| Shift + click two points | Define loop start/end |
| Double-click ruler | Clear loop (play all) |

**Visual:**
- Timeline ruler above grid (can combine with progress bar)
- Loop region highlighted
- Loop markers (brackets or flags)
- Steps outside loop are dimmed

**Behavior:**
- Playhead bounces between loop start and end
- Loop persists until cleared

**Polyrhythm behavior:**

Loop selection defines a **global step range**. All tracks play within that range, looping as they normally would.

| Loop Setting | 16-step track | 5-step track | 4-step track |
|--------------|---------------|--------------|--------------|
| Steps 1-16 | Plays once | Loops 3× | Loops 4× |
| Steps 8-16 | Plays steps 8-16 | Loops normally within window | Loops 2× within window |

The loop constrains the **global playhead position**, not individual track positions. Shorter tracks continue their polyrhythmic looping within the selected region.

### Track Reorder (Drag and Drop)

Organize tracks visually: all drums together, bass below, melodic at bottom.

**Why:** You add tracks in the order you think of them. But you want to see them organized. This is such a basic expectation that its absence is jarring.

| Interaction | Result |
|-------------|--------|
| Drag track handle | Track follows cursor |
| Drop between tracks | Track moves to new position |
| Drop indicator | Line shows insertion point |

**Implementation:**
- Drag handle on left of track row (☰ or grip dots)
- `REORDER_TRACKS` action with `fromIndex`, `toIndex`
- Multiplayer sync: `track_reorder` message
- CSS transitions for smooth reflow

### Velocity Lane (Visual Velocity Editing)

Parameter locks exist for velocity, but they're buried in a menu per step.

**Why:** Every professional sequencer shows velocity as vertical bars below each track that you can drag to adjust. Transforms dynamics from "tedious" to "visual sculpting."

| Feature | Description |
|---------|-------------|
| Display | Vertical bars below each step (height = velocity) |
| Edit | Drag bar top to adjust velocity |
| Default | 100% (full height) |
| Range | 0-127 (MIDI standard) or 0-100% |

**Visibility:**

| Property | Value |
|----------|-------|
| Default state | **Hidden** |
| Toggle | Per-track button (📊 or ▾) |
| Desktop | Both velocity lane and ChromaticGrid can be open simultaneously |
| Mobile | Opening one closes the other (space constraint) |

**Rationale for hidden by default:**
1. Keeps UI clean and approachable for beginners
2. Most casual users won't adjust velocity per-step
3. Power users will find the toggle
4. Mobile especially benefits from reduced vertical space
5. Consistent with ChromaticGrid (also hidden until expanded)

**Draw mode:**
- Drag across to "draw" velocity curve
- Click individual bar to adjust single step
- Shift+drag for fine adjustment

**Polyrhythm behavior:**

Each track's velocity lane is **proportional to its step count**.

| Track | Step Count | Velocity Bars |
|-------|------------|---------------|
| Kick | 16 | 16 bars |
| Hi-hat | 5 | 5 bars |
| Melody | 32 | 32 bars |

No fake repetition, no empty space. A 5-step track has exactly 5 velocity bars aligned with its 5 steps.

**Implementation:**
- Velocity lane component below step row
- Updates p-lock volume on drag
- Visual feedback: bar height changes in real-time
- Only shows bars for active steps (inactive steps have no velocity)

### Scrolling Track List with Fixed Actions

The track list should be a scrolling window so that copy/paste/delete are always visible.

**Why:** With many tracks, action buttons scroll off screen. User has to scroll back to find them.

| Element | Behavior |
|---------|----------|
| Track controls (left) | Fixed/sticky |
| Steps (center) | Horizontal scroll (existing) |
| Actions (right) | Fixed/sticky |

**Implementation:**
- CSS `position: sticky` on action column
- Or move actions to track header row
- Ensure actions visible regardless of scroll position

---

## 30H: Discoverability

### Tooltips on All Interactive Elements

Hover to learn what controls do.

**Why:** Currently users have to guess or discover by accident. Especially important for new features (rotate, invert, Euclidean).

| Element | Tooltip |
|---------|---------|
| M button | "Mute track" |
| S button | "Solo track" |
| Transpose | "Shift pitch by semitones" |
| Rotate ← | "Shift pattern left (wrap)" |
| Rotate → | "Shift pattern right (wrap)" |
| Invert | "Toggle all steps on/off" |
| Euclidean slider | "Euclidean rhythm: distribute hits evenly" |
| Step cell | "Click to toggle, Shift+click for p-lock" |

**Implementation:**
- Native `title` attribute for simple cases
- Custom tooltip component for rich content (keyboard shortcuts)
- Delay: 500ms before showing
- Touch: long-press shows tooltip, or skip entirely

**Keyboard shortcut hints:**
- Tooltips include shortcut when available
- "Mute track (M)" or "Play/Pause (Space)"

---

## Polyrhythm Considerations

Keyboardia supports per-track step counts (3, 4, 5, 6, 7... up to 128). Each track loops independently. This affects several Phase 30 features.

### Summary Table

| Feature | Polyrhythm Impact | Resolution |
|---------|-------------------|------------|
| Progress bar | Which track to reference? | Use longest track; individual looping shown via step highlighting |
| Loop selection | What are "bars" for odd counts? | Use steps, not bars; global range applies to all tracks |
| Velocity lane | Width mismatch between tracks | Proportional to each track's step count |
| Multi-select | Cross-track selection | Bounded by each track's step count |
| Pattern ops | None | Operate on individual tracks independently |
| Euclidean | Perfect fit | Algorithm works for any step count |
| Per-track swing | Odd step counts | Modulo 2 works; creates interesting asymmetric patterns |
| Track reorder | None | Independent of step count |

### Per-Track Swing with Odd Step Counts

Swing affects "every other step" — this works for any step count via modulo 2.

| Step Count | On-beat steps | Off-beat (swung) steps |
|------------|---------------|------------------------|
| 16 | 1, 3, 5, 7... | 2, 4, 6, 8... |
| 5 | 1, 3, 5 | 2, 4 |
| 3 | 1, 3 | 2 |
| 7 | 1, 3, 5, 7 | 2, 4, 6 |

Odd step counts create asymmetric swing patterns, which is musically interesting (feature, not bug). A 5-step track with swing has a different groove character than an 8-step track.

### Euclidean Rhythms + Polyrhythms

Euclidean rhythms are *ideal* for polyrhythmic exploration:

| Track 1 | Track 2 | Combined Feel |
|---------|---------|---------------|
| E(3, 8) | E(5, 8) | Interlocking 8th notes |
| E(3, 5) | E(4, 7) | True polyrhythm (35-step cycle) |
| E(7, 12) | E(5, 12) | West African 12/8 feel |

The algorithm works for any step count, making it a perfect tool for polyrhythmic composition.

---

## Implementation Priority

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| **Drag to Paint Steps** | Critical | Medium | 5x faster step entry |
| **Progress bar** | High | Low | Visual grounding |
| **Metronome pulse** | High | Low | Tempo awareness |
| **Track Reorder** | High | Medium | Basic expectation |
| **Loop Selection** | High | Medium | Workflow essential for long patterns |
| **Tooltips** | High | Low | Discoverability |
| **Velocity Lane** | High | High | Dynamics sculpting |
| **Multi-Select Steps** | Medium | High | Bulk operations |
| **Euclidean Rhythms** | Medium | Medium | Creative tool |
| **Category color coding** | Medium | Low | Visual organization |
| **Scrolling track list** | Medium | Low | UX fix |
| **Per-track Swing** | Medium | Medium | Musical flexibility |
| **Rotate pattern** | Medium | Low | Quick variation |
| **Invert pattern** | Medium | Low | Quick variation |
| **Reverse pattern** | Medium | Low | Quick variation |
| **Mirror pattern** | Medium | Low | Quick variation |
| **Random fill** | Medium | Low | Quick variation |
| **Double-click rename** | Medium | Medium | Convenience |
| **Dim unused beats** | Low | Low | Visual polish |
| **Play button hover** | Low | Low | Polish |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Step entry speed | 5x faster with drag-to-paint |
| Visual feedback latency | < 16ms (one frame) |
| Animation smoothness | 60fps, no jank |
| Reduced motion support | All animations respect user preference |
| Pattern operations | Instant (< 50ms) |
| Tooltip discovery | 100% of interactive elements covered |
| Loop selection | Works for patterns up to 128 steps |

---

## New Actions Required

| Action | Payload | Description |
|--------|---------|-------------|
| `ROTATE_PATTERN` | `{ trackId, direction: 'left' \| 'right' }` | Rotate steps |
| `INVERT_PATTERN` | `{ trackId }` | Toggle all steps |
| `REVERSE_PATTERN` | `{ trackId }` | Reverse step order |
| `MIRROR_PATTERN` | `{ trackId }` | Mirror pattern |
| `RANDOM_FILL` | `{ trackId, density: number }` | Random fill |
| `EUCLIDEAN_FILL` | `{ trackId, hits: number }` | Euclidean distribution |
| `SET_TRACK_NAME` | `{ trackId, name: string }` | Rename track |
| `SET_TRACK_SWING` | `{ trackId, swing: number }` | Per-track swing |
| `REORDER_TRACKS` | `{ fromIndex, toIndex }` | Move track |
| `SET_LOOP_REGION` | `{ start: number, end: number } \| null` | Loop selection |
| `SET_SELECTION` | `{ trackId, steps: number[] }` | Multi-select steps |
| `CLEAR_SELECTION` | `{}` | Clear selection |
| `APPLY_TO_SELECTION` | `{ plock: ParameterLock }` | Bulk p-lock |

---

## New Message Types (Multiplayer)

| Message | Payload | Description |
|---------|---------|-------------|
| `track_name` | `{ trackId, name }` | Track rename sync |
| `track_reorder` | `{ fromIndex, toIndex }` | Track order sync |
| `track_swing` | `{ trackId, swing }` | Per-track swing sync |
| `loop_region` | `{ start, end } \| null` | Loop selection sync |

---

## Files to Modify

| File | Changes |
|------|---------|
| `StepSequencer.tsx` | Progress bar, loop region, drag-to-paint state |
| `StepSequencer.css` | Progress bar, loop region styles |
| `StepCell.tsx` | Drag-to-paint handlers, multi-select, velocity mini-bar |
| `StepCell.css` | Selection highlight, dim inactive, velocity bar |
| `Transport.tsx` | Metronome pulse, play button hover |
| `Transport.css` | Pulse animation, fill effect, CSS variables |
| `TrackRow.tsx` | Category color, rename, pattern actions, drag handle, swing, velocity lane |
| `TrackRow.css` | Category border, action buttons, drag handle, sticky actions |
| `grid.tsx` | All new reducer actions |
| `types.ts` | New action types |
| `samples.ts` | Category metadata per instrument |
| `scheduler.ts` | Beat event subscription for metronome pulse |
| `live-session.ts` | New message handlers |
| `multiplayer.ts` | New message types |

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Progress bar position | Above grid | Doesn't interfere with step interaction |
| Category colors | Left border | Subtle, scannable, doesn't compete with step colors |
| Rotate vs shift | Rotate (wrap) | More musical, preserves pattern density |
| Random density | Preset options | Simpler than slider, covers common use cases |
| Rename trigger | Double-click | Standard UI pattern, doesn't conflict with single-click |
| Drag-to-paint state | First click determines | Prevents accidental toggle oscillation |
| Velocity lane | Collapsible | Keeps UI clean when not needed |
| Loop region | Timeline ruler | Familiar from DAWs, combines with progress bar |
| Track reorder | Drag handle | Explicit affordance, prevents accidental drag |
| Euclidean UI | Slider | Immediate visual feedback, intuitive |
| Tooltip delay | 500ms | Avoids flicker, standard UX convention |
