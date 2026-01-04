# Phase 31: UI Enhancements

> **Status:** 🔄 In Progress
> **Goal:** Transform step entry, add professional workflow features, polish visual feedback, and improve discoverability.
>
> **Completed:** Drag-to-paint, pattern tools, multi-select, velocity lane, velocity overview, track reorder, panel title consistency
> **In Progress:** Loop selection UI
> **Not Started:** Track Drawer consolidation, progress bar, metronome pulse

---

## 31A: Visual Feedback

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

## 31B: Pattern Manipulation

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

## 31C: Information Display

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

## 31D: Editing Conveniences

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

**Location:** In the Track Drawer (see 30I), alongside volume, transpose, step count, and playback mode.

**Use cases:**
- Straight hi-hats over swung kick/snare
- Tight bass with loose drums
- Different groove feels per instrument

### Click Track Name to Preview Sample

Single-click the track name to hear one hit of that instrument.

**Why:** "Which track is the snare?" Instead of soloing and playing, just click the name and hear it.

| Interaction | Result |
|-------------|--------|
| Single-click track name | Preview sound plays immediately |
| Double-click track name | Rename (existing behavior) |

**Preview behavior:**

| Instrument Type | Behavior |
|-----------------|----------|
| Percussion (kick, snare, hat) | Plays full sample with natural decay |
| Sustained (pad, strings, rhodes) | Plays ~300ms note, then releases |

**Audio routing:**
- Respects track volume (hear actual mix level)
- Goes through effects (hear actual sound in context)
- Plays immediately, not quantized to beat
- Works whether sequencer is playing or stopped

**Implementation:**
- 200ms delay after click to distinguish from double-click
- If no second click, trigger preview
- `engine.previewTrack(trackId, { pitch: 0, velocity: 1.0 })`

### Unmute All Button

Reset all tracks to unmuted in one click.

**Why:** You've muted 5 tracks to focus on the drums. Now you want to hear everything. Currently: click M five times. With this: one click.

**Location:** Transport bar, near global controls.

**Behavior:**

| Button | Action |
|--------|--------|
| **Unmute All** | Sets `muted: false` on all tracks |

**Visual:**
- Disabled/hidden when no tracks are muted
- Shows count: "Unmute All (3)" when 3 tracks muted

**Keyboard shortcut:** `Cmd/Ctrl + Shift + M` (unmute all)

**Implementation:**
- `UNMUTE_ALL` action in reducer
- Multiplayer: batch message or individual `track_mute` messages

---

## 31E: Motion

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

## 31F: Core Interaction Improvements

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
| Ctrl/Cmd + click | Start selection / toggle step (sets anchor) |
| Shift + click | Extend selection from anchor to clicked step |
| Click + drag | Draw selection box |
| Delete/Backspace | Clear selected steps |
| Ctrl/Cmd + C | Copy selection |
| Ctrl/Cmd + V | Paste at playhead or selection start |
| ESC | Clear selection |

**Note on Shift+Click:** When no selection exists, Shift+Click opens the p-lock menu (backward compatible). Once a selection is active, Shift+Click extends the selection. See "Modifier Key Conflict Resolution" in Testing & Implementation Strategy for full details.

**Visual:**
- Selection highlight (blue tint + thicker border)
- Selection count badge in transport bar: `░░ 3 selected (ESC) ░░`
- Anchor step indicator (▲) showing extend-from point

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

## 31G: Workflow Features

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

### Velocity Lane (Visual Velocity Editing) ✅ COMPLETE

Parameter locks exist for velocity, but they're buried in a menu per step.

**Why:** Every professional sequencer shows velocity as vertical bars below each track that you can drag to adjust. Transforms dynamics from "tedious" to "visual sculpting."

| Feature | Description |
|---------|-------------|
| Display | Vertical bars below each step (height = velocity) |
| Edit | Click/drag bar to adjust velocity |
| Default | 100% (full height) |
| Range | 0-100% |

**Implementation Details:**

| Component | File |
|-----------|------|
| VelocityLane | `src/components/VelocityLane.tsx` |
| VelocityLane styles | `src/components/VelocityLane.css` |
| E2E tests | `e2e/velocity-lane.spec.ts` |

**Features implemented:**
- ✅ Per-track velocity bars (one per active step)
- ✅ Click to set velocity (position = velocity %)
- ✅ Drag to paint velocity curves
- ✅ Toggle button (V) in track row (36x36px, matches other buttons)
- ✅ Color coding: accent color for bars, warning colors for extremes
- ✅ Hidden by default, toggled per-track
- ✅ Works with polyrhythmic step counts

**Polyrhythm behavior:**

Each track's velocity lane is **proportional to its step count**.

| Track | Step Count | Velocity Bars |
|-------|------------|---------------|
| Kick | 16 | 16 bars |
| Hi-hat | 5 | 5 bars |
| Melody | 32 | 32 bars |

No fake repetition, no empty space. A 5-step track has exactly 5 velocity bars aligned with its 5 steps.

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

## 31H: Discoverability

### Tooltips on All Interactive Elements

Hover to learn what controls do.

**Why:** Currently users have to guess or discover by accident. Especially important for new features (rotate, invert, Euclidean).

| Element | Tooltip |
|---------|---------|
| M button | "Mute track" |
| S button | "Solo track" |
| Track name | "Click to preview, double-click to rename" |
| Unmute All | "Unmute all tracks (⌘⇧M)" |
| Transpose | "Shift pitch by semitones" |
| Rotate ← | "Shift pattern left (wrap)" |
| Rotate → | "Shift pattern right (wrap)" |
| Invert | "Toggle all steps on/off" |
| Euclidean slider | "Euclidean rhythm: distribute hits evenly" |
| Step cell | "Click to toggle, drag to paint, right-click for p-lock" |

**Implementation:**
- Native `title` attribute for simple cases
- Custom tooltip component for rich content (keyboard shortcuts)
- Delay: 500ms before showing
- Touch: long-press shows tooltip, or skip entirely

**Keyboard shortcut hints:**
- Tooltips include shortcut when available
- "Mute track (M)" or "Play/Pause (Space)"

### Velocity Overview Panel ✅ COMPLETE (with caveats)

Multi-track velocity visualization showing all tracks' dynamics at a glance.

**Implementation Details:**

| Component | File |
|-----------|------|
| VelocityOverview | `src/components/VelocityOverview.tsx` |
| VelocityOverview styles | `src/components/VelocityOverview.css` |
| Unit tests | `src/components/VelocityOverview.test.tsx` |

**Features implemented:**
- ✅ Per-track velocity dots positioned by velocity level
- ✅ Color spectrum: purple (pp) → orange (mf) → red (ff)
- ✅ Quality indicators for extreme values
- ✅ Panel header with track count and range info
- ✅ Toggle button in transport bar (matches FX, Mixer, Pitch)
- ✅ 28 unit tests

**Design Decision — Lessons Learned:**

The VelocityOverview was designed to parallel PitchOverview, but the mental model doesn't transfer well:

| Panel | User Question | Actionable? |
|-------|---------------|-------------|
| **PitchOverview** | "What notes are playing?" | ✅ Clear — see melodic contour |
| **VelocityOverview** | "What are all velocities?" | ❓ Unclear — information without action |

**The problem:** Users ask "is my groove right?" (use ears) or "edit this track's velocity" (use VelocityLane). Nobody asks "show me every track's velocity at step 5."

**Future simplification options:**
1. **Remove entirely** — VelocityLane is sufficient for editing
2. **Aggregate view** — Show single loudness bar per step (sum/average)
3. **Accent markers only** — Show accents (>80%) and ghost notes (<40%) as markers
4. **Make editable** — Click step to edit all tracks' velocities there

### Panel Title Consistency ✅ COMPLETE

All transport panels now use consistent title styling.

| Panel | Title | Font | Color |
|-------|-------|------|-------|
| FX | "FX" | 14px | --color-text |
| Mixer | "Mixer" | 14px | --color-text |
| Pitch Overview | "Pitch Overview" | 14px | --color-text |
| Velocity Overview | "Velocity Overview" | 14px | --color-text |

Previously, some panels used 16px and --color-cyan. Now all are unified.

### Track Reorder ✅ COMPLETE

Drag-and-drop track reordering.

**Implementation Details:**
- ✅ Drag handle (☰) on left of each track row
- ✅ Visual feedback during drag (drop indicator line)
- ✅ `REORDER_TRACKS` action in reducer
- ✅ Multiplayer sync via `track_reorder` message
- ✅ E2E tests in `e2e/track-reorder.spec.ts`

---

## 31I: Track Drawer & Mixer Panel

### Design Philosophy

Track controls fall into two categories:

| Category | Controls | Access Pattern |
|----------|----------|----------------|
| **Frequent** | Mute, Solo, Steps | Every few seconds |
| **Occasional** | Volume, Transpose, Swing, Mode, Pattern tools | Every few minutes |

Frequent controls stay visible in the track row. Occasional controls live in the **Track Drawer** — revealed on demand.

### Track Row (Collapsed — Default View)

The collapsed track row prioritizes step entry:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔●▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ progress bar │
├────────────────────────────────────────────────────────────────────────────────┤
│  [▶̲] BPM [120]  Swing [50%]  [FX]  Scale [C Major ▾]  [🎚 Mixer]              │
├────────────────────────────────────────────────────────────────────────────────┤
│ ▌☰ M S  808 Kick              ▾   ●  ●  ○  ○ │ ●  ○  ○  ○ │ ●  ○  ○  ○   📋 🗑 │
│ ▌☰ M S  Hi-hat (5 steps)      ▾   ●  ○  ●  ○ │ ●                         📋 🗑 │
│ ▌☰ M S  Finger Bass           ▾   ●  ○  ○  ○ │ ●  ○  ○  ○ │ ●  ○  ○  ○   📋 🗑 │
│ ▌☰ M S  Rhodes EP             ▾   ●  ○  ●  ○ │ ○  ○  ●  ○ │ ●  ○  ○  ●   📋 🗑 │
├────────────────────────────────────────────────────────────────────────────────┤
│                             [ + Add Track ]                                    │
└────────────────────────────────────────────────────────────────────────────────┘

Legend:
▔▔●▔▔   Progress bar (moves during playback)
▌       Category color border (orange=drums, purple=bass, cyan=keys, etc.)
☰       Drag handle for track reorder
M S     Mute, Solo buttons
▾       Expand drawer toggle
│       Beat marker (every 4 steps)
●/○     Active/inactive step (drag to paint)
📋 🗑    Copy, Delete (sticky — always visible)
```

### Track Drawer (Expanded)

Clicking ▾ expands the drawer below the track:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ▌☰ M S  808 Kick              ▴   ●  ●  ○  ○ │ ●  ○  ○  ○ │ ●  ○  ○  ○   📋 🗑 │
│ ┌────────────────────────────────────────────────────────────────────────────┐ │
│ │                                                                            │ │
│ │   VOLUME             TRANSPOSE            STEPS        MODE                │ │
│ │   ░░░░░░░░████ 75%   ◀─────●─────▶ +0    [16 ▾]     [One-shot ▾]          │ │
│ │                      -12        +12                                        │ │
│ │                                                                            │ │
│ │   SWING (track)                  PATTERN TOOLS                             │ │
│ │   ○──────────── 0%               [↻◀][↻▶][⊘][◇][⇆]                         │ │
│ │   (uses global only)              rot rot inv mir rev                      │ │
│ │                                                                            │ │
│ │   EUCLIDEAN                                                                │ │
│ │   ○────────────────●── 5 hits    Distributes 5 hits across 16 steps       │ │
│ │                                                                            │ │
│ │   ─────────────────────────────────────────────────────────────────────    │ │
│ │   VELOCITY [Hide ▴]                                                        │ │
│ │   ┌──────────────────────────────────────────────────────────────────┐     │ │
│ │   │  ██  ██  ░░  ░░ │ ▄▄  ░░  ░░  ░░ │ ██  ░░  ░░  ░░ │ ...         │     │ │
│ │   └──────────────────────────────────────────────────────────────────┘     │ │
│ │                                                                            │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
│ ▌☰ M S  Hi-hat (5 steps)      ▾   ●  ○  ●  ○ │ ●                         📋 🗑 │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Drawer Contents

| Control | Description | Default |
|---------|-------------|---------|
| **Volume** | Per-track level slider | 100% |
| **Transpose** | Pitch offset slider | +0 semitones |
| **Steps** | Step count grouped dropdown | 16 |
| **Mode** | Playback mode dropdown | One-shot |
| **Swing** | Per-track swing slider | 0% (uses global) |
| **Pattern Tools** | Rotate ◀▶, Invert, Mirror, Reverse | — |
| **Euclidean** | Hit distribution slider | — |
| **Velocity** | Collapsible velocity lane | Hidden |
| **Pitch** | ChromaticGrid (melodic tracks only) | Hidden |

### Step Count Grouped Dropdown

The step count control uses a grouped dropdown organized by musical purpose, with labels explaining each value.

**Desktop: Grouped Dropdown**

```
┌────────────────────────────────────────┐
│ STEPS ▾                                │
├────────────────────────────────────────┤
│ ▾ Standard                             │
│    4     quarter-bar                   │
│    8     half-bar                      │
│   16     one bar              ← current│
│   32     two bars                      │
│   64     four bars                     │
│  128     eight bars                    │
├────────────────────────────────────────┤
│ ▾ Triplet                              │
│    3     triplet pulse                 │
│    6     half-triplet                  │
│   12     triplet bar                   │
│   24     trap hi-hats                  │
│   48     3-bar triplet                 │
│   96     6-bar triplet                 │
├────────────────────────────────────────┤
│ ▾ Polyrhythmic           ● = prime     │
│    5     quintuplet  ●                 │
│    7     septuplet   ●                 │
│    9     nonaplet                      │
│   10     5:4 base                      │
│   11     prime       ●                 │
│   13     prime       ●                 │
│   14     7×2                           │
│   15     5×3                           │
│   18     extended triplet              │
│   20     5:4 bar                       │
│   21     7×3                           │
│   27     3³                            │
│   28     septuplet bar                 │
│   36     extended                      │
└────────────────────────────────────────┘
```

**Mobile: Bottom Sheet with Chips**

On mobile, tapping the step count opens a bottom sheet with chip-style buttons:

```
┌────────────────────────────────────────┐
│ ═══════════════════════════════════    │  ← drag handle
│                                        │
│              Step Count                │
│                                        │
├────────────────────────────────────────┤
│  STANDARD                              │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌─────┐  │
│  │ 4  │ │ 8  │ │ 16 │ │ 32 │ │ 64  │  │
│  └────┘ └────┘ └─▲──┘ └────┘ └─────┘  │
│  ┌─────┐         │ current             │
│  │ 128 │                               │
│  └─────┘                               │
│                                        │
│  TRIPLET                               │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌─────┐  │
│  │ 3  │ │ 6  │ │ 12 │ │ 24 │ │ 48  │  │
│  └────┘ └────┘ └────┘ └────┘ └─────┘  │
│  ┌────┐                                │
│  │ 96 │                                │
│  └────┘                                │
│                                        │
│  POLYRHYTHMIC                          │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌─────┐  │
│  │ 5● │ │ 7● │ │ 9  │ │ 11●│ │ 13● │  │
│  └────┘ └────┘ └────┘ └────┘ └─────┘  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌─────┐  │
│  │ 10 │ │ 14 │ │ 15 │ │ 18 │ │ 20  │  │
│  └────┘ └────┘ └────┘ └────┘ └─────┘  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐          │
│  │ 21 │ │ 27 │ │ 28 │ │ 36 │          │
│  └────┘ └────┘ └────┘ └────┘          │
│                                        │
└────────────────────────────────────────┘
```

**Category Definitions:**

| Category | Values | Musical Purpose |
|----------|--------|-----------------|
| **Standard** | 4, 8, 16, 32, 64, 128 | Powers of 2 — standard 4/4 bar divisions |
| **Triplet** | 3, 6, 12, 24, 48, 96 | Multiples of 3 — shuffle, swing, 12/8 feels |
| **Polyrhythmic** | 5, 7, 9, 10, 11, 13, 14, 15, 18, 20, 21, 27, 28, 36 | Cross-rhythms, odd meters, phasing |

**Value Labels (Desktop):**

| Value | Label | Explanation |
|-------|-------|-------------|
| 4 | quarter-bar | 1/4 of standard 16-step bar |
| 8 | half-bar | Half of standard bar |
| 16 | one bar | Standard bar length |
| 32 | two bars | Extended phrase |
| 64 | four bars | Long phrase |
| 128 | eight bars | Maximum length |
| 3 | triplet pulse | Basic triplet |
| 6 | half-triplet | Half bar in triplet feel |
| 12 | triplet bar | Full bar of triplets |
| 24 | trap hi-hats | Fast triplet subdivision (genre-specific) |
| 48 | 3-bar triplet | Extended triplet phrase |
| 96 | 6-bar triplet | Long triplet phrase |
| 5 | quintuplet ● | 5 against 4 — prime, complex polyrhythm |
| 7 | septuplet ● | 7 against 4 — Balkan, complex |
| 9 | nonaplet | 9 = 3² — extended triplet feel |
| 10 | 5:4 base | 5×2 — double quintuplet |
| 11 | prime ● | Prime — maximally complex |
| 13 | prime ● | Prime — maximally complex |
| 14 | 7×2 | Double septuplet |
| 15 | 5×3 | Quintuplet × triplet |
| 18 | extended triplet | 3×6 — long triplet |
| 20 | 5:4 bar | Full bar of quintuplets |
| 21 | 7×3 | Septuplet × triplet |
| 27 | 3³ | Triple triplet |
| 28 | septuplet bar | Full bar of septuplets |
| 36 | extended | 3×12 — extended |

**The ● Indicator:**

The ● marks **prime numbers** (5, 7, 11, 13). These create the most complex polyrhythms because they share no common factors with standard step counts:

| Prime | Against 16 | Cycle Before Repeat |
|-------|------------|---------------------|
| 5 | 5:16 | 80 steps |
| 7 | 7:16 | 112 steps |
| 11 | 11:16 | 176 steps |
| 13 | 13:16 | 208 steps |

**Interaction:**

| Platform | Trigger | Behavior |
|----------|---------|----------|
| Desktop | Click dropdown | Opens grouped dropdown with collapsible sections |
| Desktop | Hover on value | Shows label as tooltip |
| Mobile | Tap step count | Opens bottom sheet |
| Mobile | Tap chip | Selects value, closes sheet |
| Both | Select value | Immediately applies, syncs via multiplayer |

**Collapsible Sections (Desktop):**

- Sections remember open/closed state
- Default: Standard open, Triplet closed, Polyrhythmic closed
- Clicking ▾/▸ toggles section
- Current value's section auto-opens

### For Melodic Tracks

Melodic instruments (synths, keys, strings) show an additional **Pitch** section:

```
│ │   PITCH [Hide ▴]                                                           │ │
│ │   ┌──────────────────────────────────────────────────────────────────┐     │ │
│ │   │ +12 ○  ○  ○  ○ │ ○  ○  ○  ○ │ ○  ○  ○  ○ │ ...                   │     │ │
│ │   │  +6 ○  ○  ○  ○ │ ○  ○  ○  ○ │ ○  ○  ○  ○ │                       │     │ │
│ │   │   0 ●  ○  ●  ○ │ ○  ○  ●  ○ │ ●  ○  ○  ● │  ← base pitch         │     │ │
│ │   │  -6 ○  ○  ○  ○ │ ○  ○  ○  ○ │ ○  ○  ○  ○ │                       │     │ │
│ │   │ -12 ○  ○  ○  ○ │ ○  ○  ○  ○ │ ○  ○  ○  ○ │                       │     │ │
│ │   └──────────────────────────────────────────────────────────────────┘     │ │
```

---

### Mixer Panel

For focused mixing sessions, a dedicated **Mixer Panel** shows all track volumes at once.

**Access:** Toggle via `[🎚 Mixer]` button in transport bar.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  [▶̲] BPM [120]  Swing [50%]  [FX]  Scale [C Major ▾]  [🎹 Pattern]            │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│    808 Kick     Hi-hat      Finger      Rhodes      Strings     Alto Sax      │
│    ▌            ▌           ▌           ▌           ▌           ▌             │
│    (16)         (5)         (16)        (32)        (24)        (16)          │
│                                                                                │
│     [M]          [M]         [M]         [M]         [M]         [M]          │
│     [S]          [S]         [S]         [S]         [S]         [S]          │
│                                                                                │
│    ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐        │
│    │█████│     │█████│     │░░░░░│     │█████│     │▓▓▓▓▓│     │▓▓▓▓▓│        │
│    │█████│     │█████│     │░░░░░│     │█████│     │▓▓▓▓▓│     │░░░░░│        │
│    │█████│     │▓▓▓▓▓│     │░░░░░│     │▓▓▓▓▓│     │░░░░░│     │░░░░░│        │
│    │▓▓▓▓▓│     │▓▓▓▓▓│     │░░░░░│     │░░░░░│     │░░░░░│     │░░░░░│        │
│    │░░░░░│     │░░░░░│     │░░░░░│     │░░░░░│     │░░░░░│     │░░░░░│        │
│    └──●──┘     └──●──┘     └──●──┘     └──●──┘     └──●──┘     └──●──┘        │
│      75%         80%         45%         90%         55%         65%          │
│                                                                                │
│    Swing        Swing       Swing       Swing       Swing       Swing         │
│    ○────         ○────       ──●──       ────○       ○────       ──●──        │
│     0%           0%          50%        100%         0%          50%          │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘

Legend:
▌       Category color indicator
(16)    Step count
[M][S]  Mute, Solo
█▓░     Volume fader (drag to adjust)
Swing   Per-track swing slider
```

### Mixer Panel Features

| Feature | Description |
|---------|-------------|
| **All volumes visible** | Compare and balance levels across tracks |
| **Per-track swing** | Adjust groove per track without expanding drawers |
| **Mute/Solo** | Same as pattern view |
| **Category colors** | Visual grouping maintained |
| **Step counts** | Shows each track's loop length |

### When to Use Each View

| Task | Recommended View |
|------|------------------|
| Creating patterns | Pattern view (default) |
| Adjusting one track | Expand track drawer |
| Balancing mix | Mixer panel |
| Comparing swings | Mixer panel |
| Fine-tuning velocity | Pattern view with velocity lane |

### Mobile Behavior

| Device | Mixer Panel |
|--------|-------------|
| Desktop | Side-by-side faders, all visible |
| Tablet | Horizontal scroll if needed |
| Phone | Bottom sheet with vertical fader list |

---

## Polyrhythm Considerations

Keyboardia supports per-track step counts (3, 4, 5, 6, 7... up to 128). Each track loops independently. This affects several Phase 31 features.

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
| **Track Drawer** | Critical | Medium | Unified control access |
| **Progress bar** | High | Low | Visual grounding |
| **Metronome pulse** | High | Low | Tempo awareness |
| **Track Reorder** | High | Medium | Basic expectation |
| **Loop Selection** | High | Medium | Workflow essential for long patterns |
| **Tooltips** | High | Low | Discoverability |
| **Velocity Lane** | High | High | Dynamics sculpting |
| **Category color coding** | High | Low | Visual organization |
| **Multi-Select Steps** | Medium | High | Bulk operations |
| **Euclidean Rhythms** | Medium | Medium | Creative tool |
| **Mixer Panel** | Medium | Medium | Mix balancing |
| **Scrolling track list** | Medium | Low | UX fix |
| **Per-track Swing** | Medium | Medium | Musical flexibility |
| **Rotate pattern** | Medium | Low | Quick variation |
| **Invert pattern** | Medium | Low | Quick variation |
| **Reverse pattern** | Medium | Low | Quick variation |
| **Mirror pattern** | Medium | Low | Quick variation |
| **Click to preview** | Medium | Low | Sound identification |
| **Unmute All** | Medium | Low | Workflow shortcut |
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
| Drawer expand/collapse | < 200ms animation |
| Mixer panel toggle | < 100ms view switch |

---

## New Actions Required

| Action | Payload | Description |
|--------|---------|-------------|
| `SET_TRACK_VOLUME` | `{ trackId, volume: number }` | Per-track volume (0-100) |
| `SET_TRACK_SWING` | `{ trackId, swing: number }` | Per-track swing |
| `SET_TRACK_NAME` | `{ trackId, name: string }` | Rename track |
| `REORDER_TRACKS` | `{ fromIndex, toIndex }` | Move track |
| `ROTATE_PATTERN` | `{ trackId, direction: 'left' \| 'right' }` | Rotate steps |
| `INVERT_PATTERN` | `{ trackId }` | Toggle all steps |
| `REVERSE_PATTERN` | `{ trackId }` | Reverse step order |
| `MIRROR_PATTERN` | `{ trackId }` | Mirror pattern |
| `EUCLIDEAN_FILL` | `{ trackId, hits: number }` | Euclidean distribution |
| `SET_LOOP_REGION` | `{ start: number, end: number } \| null` | Loop selection |
| `SET_SELECTION` | `{ trackId, steps: number[] }` | Multi-select steps |
| `CLEAR_SELECTION` | `{}` | Clear selection |
| `APPLY_TO_SELECTION` | `{ plock: ParameterLock }` | Bulk p-lock |
| `TOGGLE_DRAWER` | `{ trackId }` | Expand/collapse track drawer |
| `SET_VIEW` | `{ view: 'pattern' \| 'mixer' }` | Switch between views |
| `UNMUTE_ALL` | `{}` | Reset all tracks to unmuted |

---

## New Message Types (Multiplayer)

| Message | Payload | Description |
|---------|---------|-------------|
| `track_volume` | `{ trackId, volume }` | Track volume sync |
| `track_swing` | `{ trackId, swing }` | Per-track swing sync |
| `track_name` | `{ trackId, name }` | Track rename sync |
| `track_reorder` | `{ fromIndex, toIndex }` | Track order sync |
| `loop_region` | `{ start, end } \| null` | Loop selection sync |

---

## Files to Modify

| File | Changes |
|------|---------|
| `StepSequencer.tsx` | Progress bar, loop region, drag-to-paint state, view toggle |
| `StepSequencer.css` | Progress bar, loop region styles |
| `StepCell.tsx` | Drag-to-paint handlers, multi-select |
| `StepCell.css` | Selection highlight, dim inactive |
| `Transport.tsx` | Metronome pulse, play button hover, mixer toggle |
| `Transport.css` | Pulse animation, fill effect, CSS variables |
| `TrackRow.tsx` | Category color, rename, drag handle, drawer toggle |
| `TrackRow.css` | Category border, drag handle, sticky actions |
| `grid.tsx` | All new reducer actions |
| `types.ts` | New action types |
| `samples.ts` | Category metadata per instrument |
| `scheduler.ts` | Beat event subscription for metronome pulse |
| `live-session.ts` | New message handlers |

### New Components

| File | Description |
|------|-------------|
| `TrackDrawer.tsx` | Expandable drawer with volume, transpose, swing, pattern tools |
| `TrackDrawer.css` | Drawer styles, animations |
| `VelocityLane.tsx` | Visual velocity editing bars |
| `VelocityLane.css` | Velocity bar styles |
| `MixerPanel.tsx` | All-tracks volume/swing view |
| `MixerPanel.css` | Fader and mixer layout styles |
| `PatternTools.tsx` | Rotate, invert, mirror, reverse, random, euclidean buttons |
| `LoopRegion.tsx` | Timeline ruler with loop selection |
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

---

## Primary Action Button Pattern

Every screen in Keyboardia has exactly **one primary action** — the thing the user most likely wants to do next. This button receives elevated visual treatment to guide attention without animation.

### The Pattern

```
Secondary buttons:                    Primary action:
┌──────────┐ ┌──────────┐            ╔══════════════╗
│  Share   │ │  Delete  │            ║    Remix     ║
└──────────┘ └──────────┘            ╚══════════════╝
   flat         flat                    elevated
   1px border   1px border              2px accent border
   no shadow    no shadow               soft glow shadow
                                        1.02× scale
```

### Visual Treatment

| Property | Secondary Button | Primary Action |
|----------|------------------|----------------|
| Border | 1px `--border` | 2px `--accent` |
| Shadow | None | `0 2px 8px rgba(accent, 0.15)` |
| Scale | 1.0 | 1.02 |
| Background | `--surface` | `--surface` (or subtle accent tint) |
| Text weight | Normal | Medium or Semi-bold |

**CSS:**

```css
.button {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.button--primary {
  border: 2px solid var(--accent);
  box-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.15);
  transform: scale(1.02);
  font-weight: 500;
}
```

### Primary Action Per Screen

| Screen / Context | Primary Action | Why |
|------------------|----------------|-----|
| **Published session** | Remix | Convert viewer to creator |
| **Editor (empty)** | Add Track | Only logical next step |
| **Editor (has tracks, stopped)** | Play | User wants to hear their work |
| **Editor (playing)** | Play (still) | Play remains primary; Stop is secondary |
| **Mixer panel** | Back to Pattern | Return to main workflow |
| **Track drawer** | None | Drawer is auxiliary; no single primary |
| **Settings/Preferences** | Save / Done | Confirm and exit |

Note: The **SamplePicker** ("Add Track" panel) is part of the editor view, not a separate screen. When visible, instrument buttons act as the call-to-action — no separate primary button needed.

### Published Session: Remix Button

When viewing someone else's published session, the **Remix** button is the primary action:

```
┌────────────────────────────────────────────────────────────────┐
│  ◄ Back    "Sunset Groove" by @producer123                    │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ╔══════════════╗                 │
│  │  Share   │  │   Like   │  ║    Remix     ║  ← primary      │
│  └──────────┘  └──────────┘  ╚══════════════╝                 │
│       ↑            ↑               ↑                          │
│   secondary    secondary       elevated                       │
│                                accent border                   │
│                                soft shadow                     │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                    [Pattern Grid]                        │ │
│  │                     (read-only)                          │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Why Remix is primary:**
- User has just listened to something inspiring
- Natural next thought: "I want to try my own version"
- Converts passive viewer → active creator
- Key growth mechanism (remixes create new content)

### Implications

#### 1. Only One Primary Per View

A screen cannot have multiple primary actions. If you're tempted to elevate two buttons, you haven't decided what the screen is *for*.

```
❌ Wrong (competing primaries):
╔══════════╗  ╔══════════╗
║   Save   ║  ║  Share   ║
╚══════════╝  ╚══════════╝

✅ Right (clear hierarchy):
╔══════════╗  ┌──────────┐
║   Save   ║  │  Share   │
╚══════════╝  └──────────┘
   primary     secondary
```

#### 2. Secondary Buttons Must Recede

If the primary action is elevated, secondaries must be visually quieter. Otherwise the elevation has no effect.

| Element | Treatment |
|---------|-----------|
| Primary | Elevated (accent border, shadow, slight scale) |
| Secondary | Flat (subtle border, no shadow) |
| Tertiary / Destructive | Text-only or muted color |

#### 3. Primary Can Change With State

The primary action may change based on context:

| State | Primary Action |
|-------|----------------|
| Empty pattern | Add Track |
| Pattern with tracks | Play |
| Pattern playing | Play (or arguably none — let user focus on listening) |

**Implementation:**

```typescript
function getPrimaryAction(state: AppState): string | null {
  if (state.view === 'published-session') return 'remix';
  if (state.view === 'mixer') return 'back-to-pattern';
  if (state.tracks.length === 0) return 'add-track';
  return 'play';
}
```

#### 4. Mobile: Same Position, Same Elevation

On mobile, the primary action stays in its current position — no floating action buttons. The elevated visual treatment (accent border, shadow) applies consistently across screen sizes.

#### 5. Accessibility Benefits

This pattern works for users with motion sensitivity:

| Approach | Motion Required | Works for Everyone |
|----------|-----------------|-------------------|
| Animated pulse | Yes | ❌ Needs fallback |
| Shimmer effect | Yes | ❌ Needs fallback |
| **Elevated resting state** | **No** | ✅ Universal |

The elevated state communicates importance through **static visual hierarchy**, not animation.

#### 6. No Animation Needed

Unlike attention-grabbing animations (pulse, glow, shimmer), the elevated state:
- Is always visible (not time-dependent)
- Doesn't fatigue the user
- Respects `prefers-reduced-motion` automatically
- Works in screenshots and static documentation

### Design Tokens

Add to the design system:

```css
:root {
  /* Primary action elevation */
  --button-primary-border-width: 2px;
  --button-primary-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.15);
  --button-primary-scale: 1.02;

  /* Secondary button (receded) */
  --button-secondary-border-width: 1px;
  --button-secondary-shadow: none;
  --button-secondary-scale: 1;
}
```

---

## Testing & Implementation Strategy

### Known Bug Patterns to Watch

Based on analysis of features, these are the likely bug categories:

| Pattern | Risk Features | Prevention |
|---------|---------------|------------|
| **Race conditions** | Drag-to-paint + multiplayer sync | Debounce paint events, batch multiplayer messages |
| **State desync** | Loop region, selection, drawer open | Single source of truth in reducer |
| **Touch/mouse conflicts** | Drag-to-paint, velocity lane drawing | Use `pointer` events, test on real devices |
| **Animation jank** | Progress bar, drawer expand, metronome pulse | CSS transforms only, avoid layout thrash |
| **Click disambiguation** | Preview (click) vs rename (double-click) | 200ms timer pattern, clear state machine |
| **Modifier key conflicts** | Shift+click (p-lock vs multi-select) | **CRITICAL: Resolve before implementing** |
| **Undo/redo gaps** | Pattern ops, bulk selection ops | Add to action history, test roundtrip |
| **Overflow** | Long track names, many tracks, extreme step counts | Truncation, scroll, limits |

### Modifier Key Conflict Resolution

**Problem:** Shift+Click is currently used for p-lock (Phase 24) and proposed for multi-select extension.

**Solution: State-Dependent Shift+Click**

Shift+Click behavior depends on whether a selection exists:

| State | Shift+Click Does | Rationale |
|-------|------------------|-----------|
| No selection | Opens p-lock menu | **Backward compatible** — existing users unchanged |
| Selection exists | Extends selection to clicked step | Standard multi-select behavior |

**Complete gesture table:**

| Gesture | Desktop | Touch | Action |
|---------|---------|-------|--------|
| Click | ✅ | ✅ | Toggle step |
| Drag | ✅ | ✅ | Paint steps |
| Ctrl/Cmd+Click | ✅ | — | Start/toggle selection (sets anchor) |
| Shift+Click (no selection) | ✅ | — | P-lock menu |
| Shift+Click (with selection) | ✅ | — | Extend selection from anchor |
| Right-click | ✅ | — | P-lock menu (always) |
| Long-press (500ms) | ✅ | ✅ | P-lock menu (always) |

**State machine:**

```
┌──────────────────┐
│   NO SELECTION   │ ◄─── Initial state
│                  │
│  Shift+Click =   │
│    P-LOCK ✓      │
└────────┬─────────┘
         │
         │ Ctrl/Cmd+Click (start selection)
         │ OR drag selection box
         ▼
┌──────────────────┐
│ SELECTION ACTIVE │
│                  │
│  Shift+Click =   │
│  EXTEND RANGE    │
│                  │
│  P-lock via:     │
│  • Right-click   │
│  • Long-press    │
└────────┬─────────┘
         │
         │ ESC, or click empty area,
         │ or deselect all steps
         ▼
┌──────────────────┐
│   NO SELECTION   │
└──────────────────┘
```

**Critical UX requirement: Unmissable selection state**

For state-dependent behavior to work, users must always know when selection is active:

| Visual Element | Purpose |
|----------------|---------|
| **Selection badge** | Shows in transport bar: `░░ 3 selected (ESC) ░░` |
| **Selected steps** | Blue tint + thicker border |
| **Anchor step** | Corner marker (▲) showing extend-from point |
| **ESC hint** | Reminds users how to clear selection |

```
┌────────────────────────────────────────────────────────────────────┐
│  [▶] BPM [120]  Swing [50%]  ░░░░ 3 selected (ESC) ░░░░           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ●  ●  ○  ○ │ ●̲ ̲ ̲●̲ ̲ ̲●̲ ̲ ̲●̲  │ ○  ○  ○  ○      steps 5-8 selected  │
│              │ ▲  ─────│                    anchor at step 5      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
interface SelectionState {
  selected: Set<string>;      // Set of stepIds
  anchor: string | null;      // Starting point for Shift+Click extend
}

function handleStepPointerDown(step: Step, event: React.PointerEvent) {
  const hasSelection = selection.selected.size > 0;

  if (event.shiftKey) {
    if (hasSelection && selection.anchor) {
      // EXTEND selection from anchor to this step
      extendSelection(selection.anchor, step.id);
    } else {
      // NO selection: open p-lock (backward compatible)
      openPLockMenu(step);
    }
    return;
  }

  if (event.ctrlKey || event.metaKey) {
    // Toggle in selection, set as anchor
    toggleInSelection(step.id);
    setAnchor(step.id);
    return;
  }

  // Plain click: toggle step, clear selection
  toggleStep(step);
  clearSelection();
}
```

**Edge cases:**

| Scenario | Behavior |
|----------|----------|
| Shift+Click with no selection | P-lock (backward compatible) |
| Shift+Click with selection | Extend selection |
| Want p-lock while selection exists | Right-click or long-press |
| Click (no modifier) with selection | Clears selection, toggles step |
| ESC key | Clears selection |
| Ctrl+Click on only selected step | Deselects, returns to no-selection state |

**Risk mitigation:**

| Risk | Mitigation |
|------|------------|
| User forgets selection exists | Persistent selection badge with count |
| Surprise extend instead of p-lock | Badge always visible, ESC hint shown |
| Can't access p-lock when selected | Right-click/long-press always work |

---

### Dependency Graph

Features must be implemented in order that respects dependencies:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PHASE 30 DEPENDENCIES                        │
└─────────────────────────────────────────────────────────────────────┘

Category Colors ────────────────────────────────────────────────────────┐
Progress Bar ──────────────────────────────────────────────────────────┐│
Tooltips ──────────────────────────────────────────────────────────────┤│
                                                                        ││
Drag-to-Paint ──────────────────┐                                      ││
                                 │                                      ││
                                 ▼                                      ││
Multi-Select ─────────────────────────────────────────────┐            ││
                                                           │            ││
Track Drawer ──────────────────┐                          │            ││
    │                           │                          │            ││
    ├──► Per-track Volume ──────┤                          │            ││
    ├──► Per-track Swing ───────┤                          │            ││
    ├──► Per-track Transpose ───┤                          │            ││
    │                           ▼                          │            ││
    │                    Mixer Panel                       │            ││
    │                                                      │            ││
    └──► Pattern Tools ────────┐                          │            ││
             │                  │                          │            ││
             ├──► Rotate        │                          │            ││
             ├──► Invert        │                          │            ││
             ├──► Reverse       │                          │            ││
             └──► Mirror        │                          │            ││
                                │                          │            ││
    Euclidean ─────────────────┘                          │            ││
                                                           │            ││
Velocity Lane ────────────────────────────────────────────┘            ││
                                                                        ││
Loop Region ───────────────────────────────────────────────────────────┤│
Track Reorder ─────────────────────────────────────────────────────────┤│
Track Rename ──────────────────────────────────────────────────────────┤│
Click Preview ─────────────────────────────────────────────────────────┤│
Unmute All ────────────────────────────────────────────────────────────┤│
Scrolling List ────────────────────────────────────────────────────────┤│
                                                                        ▼│
                                                              Integration│
                                                                        ▼
                                                              Polish & Test
```

---

### Topological Implementation Order

Based on dependencies, implement in this order:

**Tier 1: Independent foundations (parallelizable)**
1. Category color coding
2. Progress bar
3. Tooltips (can add incrementally)
4. Drag-to-paint
5. Track reorder

**Tier 2: Track Drawer system**
6. Track Drawer (shell component)
7. Per-track volume (in drawer)
8. Per-track transpose (in drawer)
9. Per-track swing (in drawer)
10. Pattern tools (rotate, invert, reverse)

**Tier 3: Drawer extensions**
11. Euclidean rhythms
12. Velocity lane
13. Mixer panel

**Tier 4: Selection & workflow**
14. Multi-select steps (resolve Shift+Click first)
15. Loop selection

**Tier 5: Polish**
16. Track rename (double-click)
17. Click to preview sample
18. Unmute All button
19. Metronome pulse
20. Scrolling track list
21. Dim unused beats
22. Play button hover
23. Mirror pattern

---

### Recommended Phase Split

The audit identified that 24 features is 3-5x larger than typical phases. Recommended split:

#### Phase 31A: Core Interactions (MVP)

| Feature | Rationale |
|---------|-----------|
| Drag-to-paint | Core UX improvement, 5x faster step entry |
| Track Drawer | Foundation for all track controls |
| Per-track Volume | Essential mixing |
| Progress bar | Visual grounding |
| Category colors | Low effort, high visual impact |
| Tooltips | Discoverability |

**Success criteria:** Step entry is dramatically faster. Volumes are adjustable. UI feels more polished.

#### Phase 31B: Pattern Tools

| Feature | Rationale |
|---------|-----------|
| Rotate pattern | Quick variation |
| Invert pattern | Quick variation |
| Reverse pattern | Quick variation |
| Euclidean rhythms | Creative tool |
| Per-track swing | Musical flexibility |
| Per-track transpose | In drawer, simple addition |

**Success criteria:** Users can quickly create pattern variations without manual step editing.

#### Phase 31C: Mixing & Selection

| Feature | Rationale |
|---------|-----------|
| Mixer panel | All volumes visible |
| Velocity lane | Dynamics sculpting |
| Multi-select | Bulk operations |
| Loop selection | Essential for long patterns |

**Success criteria:** Users can mix tracks efficiently. Bulk editing works.

#### Phase 31D: Polish

| Feature | Rationale |
|---------|-----------|
| Track reorder | Expected feature |
| Track rename | Convenience |
| Click to preview | Sound identification |
| Unmute All | Workflow shortcut |
| Metronome pulse | Visual tempo feedback |
| Scrolling track list | UX fix |

**Success criteria:** All rough edges smoothed. Professional feel.

---

### Features Removed From Spec

**Note:** Random fill was removed from this spec. Mirror pattern is retained — creates musically useful ABCDCBA symmetry patterns.

---

### Testing Strategy

#### Unit Tests

| Component | Test Cases |
|-----------|------------|
| Euclidean algorithm | Known patterns (tresillo, cinquillo), edge cases (0 hits, N=steps) |
| Pattern ops | Rotate, invert, reverse on various step counts |
| Selection logic | Range selection, toggle, extend, cross-track |
| Swing calculation | Even/odd step counts, combined with global swing |

#### Integration Tests

| Scenario | Verification |
|----------|--------------|
| Drag-to-paint + undo | Batch paint undoes in single step |
| Multi-select + p-lock | Apply to all selected |
| Track drawer + multiplayer | State syncs correctly |
| Loop region + polyrhythm | All tracks respect global range |
| Mixer panel + track drawer | Volume changes reflect in both |

#### E2E Tests

| Flow | Steps |
|------|-------|
| Pattern creation | Load → add tracks → drag-to-paint → play → hear result |
| Mix session | Add tracks → open mixer → adjust volumes → close mixer → verify |
| Loop workflow | Set loop → play → verify playhead bounces → clear loop |
| Rename track | Double-click → type → blur → verify persists |

#### Performance Tests

| Metric | Target | Test Method |
|--------|--------|-------------|
| Drag-to-paint latency | <16ms | FPS counter during paint |
| Progress bar smoothness | 60fps | Visual inspection + profiler |
| Drawer animation | <200ms, no jank | Timeline profiler |
| Selection with 64 tracks × 32 steps | No lag | Stress test |

#### Accessibility Tests

| Feature | A11y Requirement |
|---------|------------------|
| All animations | Respect `prefers-reduced-motion` |
| Tooltips | Keyboard accessible |
| Drag-to-paint | Keyboard alternative (arrow keys + space) |
| Track drawer | Focus management on open/close |
| Mixer panel | Screen reader announces volume changes |

---

### Edge Cases to Define

#### Euclidean Rhythms

| Case | Behavior |
|------|----------|
| 0 hits | Clear all steps |
| hits = steps | Fill all steps |
| hits > steps | Clamp to steps |
| Slider while playing | Live update (debounced) |

#### Loop Selection

| Case | Behavior |
|------|----------|
| Loop start > end | Swap values |
| Loop = 1 step | Play single step repeatedly |
| Loop beyond longest track | Clamp to longest track length |
| Delete while looping | Clear loop if region becomes invalid |

#### Mirror Pattern

| Case | Behavior |
|------|----------|
| Odd step count | Center step stays, mirrors around it |
| 1-2 steps | No-op (too short to mirror) |
| Empty pattern | No-op |

#### Multi-Select

| Case | Behavior |
|------|----------|
| Select across tracks | Independent selection per track |
| Select beyond track length | Ignore steps beyond track's stepCount |
| Delete with selection | Clear selected steps, keep others |
| Copy/paste across tracks | Paste to same relative positions |

---

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Shift+Click surprise (extend vs p-lock) | Medium | Medium | State-dependent behavior + unmissable selection badge + right-click fallback |
| Drag-to-paint desync in multiplayer | Medium | Medium | Batch messages, reconcile on mouse up |
| Velocity lane performance with 128 steps | Medium | Medium | Virtualization, canvas rendering |
| Drawer animation jank on low-end devices | Medium | Low | CSS-only transforms, test on slow devices |
| Touch drag conflicts with scroll | Medium | Medium | Explicit drag handle, test on tablets |

---

### Definition of Done

Each feature is complete when:

1. ✅ Feature works as specified
2. ✅ Unit tests pass
3. ✅ Integration tests pass
4. ✅ Works in multiplayer mode
5. ✅ Respects `prefers-reduced-motion`
6. ✅ Has tooltip (if interactive)
7. ✅ Keyboard accessible (where applicable)
8. ✅ Mobile responsive
9. ✅ No console errors/warnings
10. ✅ Performance targets met
