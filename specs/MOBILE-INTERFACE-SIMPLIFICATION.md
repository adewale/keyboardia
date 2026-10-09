# Mobile Interface Simplification Spec

> **Planned dock-specific amendment (October 2026):** [PIANO-ROLL-DOCK.md](./PIANO-ROLL-DOCK.md) governs the proposed editor cutover. The general mobile goals, existing drawer plan and implementation examples below remain unchanged. The following scoped differences apply to the dock rollout only; they are not claims of production deployment. Keep original entry points until working replacements ship atomically.

- Mode is one shared JS decision: desktop if width>=768 AND height≥500; otherwise landscape if height<500 OR width>height; else portrait. Publish root data-display-mode for CSS and behavior; no independent orientation/max-height queries. Thus450×499 and700×600 use landscape,1024×500 uses desktop. Preview remains width<768 AND portrait AND height≥500. These thresholds reuse the existing app decision unchanged; validate767px portrait,768/769px desktop at height≥500 and768×499 landscape.
- Root `data-display-mode` drives CSS, lifecycle and inert/focus state together. Acceptance also includes 390×499 landscape. Reuse the app's exact768px desktop boundary unchanged; the earlier implementation examples below are historical context, not a second dock mode selector.
- Landscape row left216 = name64 + M44 + S44 + Edit44 + three4px gaps + padding8; row48/pitch50, cells36×44. Copy/Paste, Clear and Delete remain outside the column with44px targets and copy indicators. Below440px landscape width, position actions statically at the far end of the horizontal row, reachable by scrolling, so Edit remains unobscured; at440px and above retain sticky-right actions and protect final-step access. Root `data-narrow-landscape` comes from the same JS mode/width decision, without a new display mode, wrapping or extra height. Probe390×499,439×499 and440×499.
- Expanded editor stays in the current sequencer, inset8, with its own horizontal body scroller/key column84=18rail+66keys. Header88 + toolbar48 + status16 + borders2 leaves body150 at568×320: `--dock-grid-h: calc(100dvh - 170px)`. The status strip labels bar.beat at `92 + stepX(s) - body.scrollLeft`; cursor-updated title and hidden live context provide the separate timeline without body-height cost or synchronized row scroll. Close restores invoker and row scroll.
- The Step toolbar picker and Notes-toolbar Loop start/end native inputs/Clear are44px mobile/32px desktop. No Track-details loop surface or desktop body picker is required. Pan uses native `touch-action: auto`; Draw owns the editing hit surface. Notes mount/H/scroll remain retained between detail panes.
- Explicit/ghost Fit comparison uses fractional largest H2..36 with two-row padding; initial/track-switch Fit caps18 and defers until first Notes when initially opened in Track/Step. Initial Step minimally reveals its selected effective pitch without changing H. Resize/detent Fit measures new body height after layout. White-key labels retain `--piano-key-label`; bracket/grid decoration conveys range/scale without dimming labels or blocking audition. Muted controls and informative text retain contrast.
- Desktop remains horizontally aligned, body252/432 + header84 + toolbar48 + status24 + top border1 = total409/589. These numerical targets and production mutation/scheduler/read-only acceptance belong to the dock spec; the mock's small synth remains preview evidence.

## Overview

This specification defines a simplification of Keyboardia's mobile interface by introducing **two distinct modes** based on device orientation:

- **Portrait Mode**: Consumption-only (watch, listen, share)
- **Landscape Mode**: Creation (edit, compose, sketch) — minimal changes from current

This is a **refactoring** of the existing responsive system, not a rewrite. The existing components will be progressively adapted to support orientation-aware feature sets.

---

## Design Philosophy

### The Core Insight

Portrait and landscape orientations represent different **user intents**:

| Orientation | Intent | Metaphor |
|-------------|--------|----------|
| Portrait | "Show me" | Watching a music video |
| Landscape | "Let me play" | Using a drum machine |
| Desktop | "Let me produce" | Sitting at a DAW |

The rotation gesture becomes the mode switch. It's physical, intentional, and universally understood.

### The "Hardware Instrument" Aesthetic

The mobile interface should feel like a **hardware drum machine** (TR-808, SP-404, Teenage Engineering PO series). These devices succeed because fixed constraints become creative features.

- **Dark, high-contrast** — Standard for music production
- **Grid-dominant** — The step grid IS the instrument
- **Minimal chrome** — Every pixel serves the music
- **Touch-optimized** — Large targets, gesture-based interaction

---

## Portrait Mode: Consumption

### Purpose

Portrait mode is for **watching and sharing**. The grid becomes a living visualization, not an input device. Think: screensaver, music visualizer, Instagram full-screen content.

**Use cases:**
- Listening to your own creation (playback)
- Showing a friend what you made
- Browsing beats others have made
- Checking out a beat someone shared
- Ambient/background listening

### Interface Specification

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│   ┌───────────────────────────────────────────────────────┐   │
│   │                                                       │   │
│   │    ▶     Keyboardia / Funky Beat #42           127   │   │   HEADER
│   │   ───    ═══════════════════════════           ═══   │   │   ├─ Play button (KEEP, left, large)
│   │   Play   App name    Session name              BPM   │   │   ├─ App name (KEEP)
│   │   (unchanged)                                        │   │   ├─ Session name (KEEP)
│   │                                                       │   │   └─ BPM display (read-only)
│   └───────────────────────────────────────────────────────┘   │
│                                                               │
│   ┌───────────────────────────────────────────────────────┐   │
│   │     1    2    3    4    5    6    7    8              │   │   STEP NUMBERS (subtle)
│   │   ┌────────────────────────────────────────────────┐  │   │
│   │   │                                                │  │   │
│   │   │  K   ██   ░░   ░░   ░░   ██   ░░   ░░   ░░    │  │   │
│   │   │       ▓▓                                       │  │   │   PLAYHEAD (glowing column)
│   │   │  S   ░░   ░░   ░░   ░░   ██   ░░   ░░   ░░    │  │   │   ├─ Sweeps across pattern
│   │   │                                                │  │   │   ├─ Cells pulse when triggered
│   │   │  H   ██   ░░   ██   ░░   ██   ░░   ██   ░░    │  │   │   └─ Smooth 60fps animation
│   │   │                                                │  │   │
│   │   │  C   ░░   ░░   ░░   ██   ░░   ░░   ░░   ██    │  │   │   VISUALIZATION GRID
│   │   │                                                │  │   │   ├─ All tracks visible (compact)
│   │   │  B   ██   ░░   ░░   ██   ░░   ░░   ██   ░░    │  │   │   ├─ Read-only (no touch editing)
│   │   │                                                │  │   │   └─ Tap anywhere = play/pause
│   │   │  L   ░░   ░░   ██   ░░   ░░   ██   ░░   ░░    │  │   │
│   │   │                                                │  │   │
│   │   └────────────────────────────────────────────────┘  │   │
│   │     9   10   11   12   13   14   15   16             │   │   SECOND HALF
│   │   ┌────────────────────────────────────────────────┐  │   │   └─ Scrolls or pages automatically
│   │   │  K   ██   ░░   ░░   ░░   ██   ░░   ░░   ░░    │  │   │
│   │   │  S   ░░   ░░   ░░   ░░   ██   ░░   ░░   ░░    │  │   │
│   │   │  H   ██   ░░   ██   ░░   ██   ░░   ██   ░░    │  │   │
│   │   │  C   ░░   ░░   ░░   ██   ░░   ░░   ░░   ██    │  │   │
│   │   │  B   ░░   ██   ░░   ░░   ░░   ██   ░░   ░░    │  │   │
│   │   │  L   ░░   ░░   ░░   ██   ░░   ░░   ░░   ██    │  │   │
│   │   └────────────────────────────────────────────────┘  │   │
│   └───────────────────────────────────────────────────────┘   │
│                                                               │
│   ┌───────────────────────────────────────────────────────┐   │
│   │  ════════════════════●════════════════════════════   │   │   PROGRESS BAR (KEEP)
│   └───────────────────────────────────────────────────────┘   │   └─ Shows position in pattern
│                                                               │
│   ┌───────────────────────────────────────────────────────┐   │
│   │                                                       │   │   ACTION DRAWER
│   │                  ↻ Rotate to edit                     │   │   ├─ Rotation hint (MODIFY text)
│   │                                                       │   │   └─ Swipe up for share/QR (ADD)
│   │                     ⌃ Share                           │   │
│   │                                                       │   │
│   └───────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

### Portrait Mode: Changes to Existing UI

#### Header Changes

| Element | Change | Details |
|---------|--------|---------|
| Play button | **KEEP** | Unchanged — left position, large size |
| App name "Keyboardia" | **KEEP** | Unchanged |
| Session name | **KEEP** | Unchanged |
| BPM value | **KEEP** | Display only |
| Connection status (🔗) | **REMOVE** | |
| Avatar stack (👤👤) | **REMOVE** | |
| Publish button | **REMOVE** | |
| Remix button | **REMOVE** | |
| New button | **REMOVE** | |
| Export button | **REMOVE** | |
| Invite button | **REMOVE** | |

#### Transport Changes

| Element | Change |
|---------|--------|
| BPM slider | **REMOVE** |
| Swing slider | **REMOVE** |
| Swing value | **REMOVE** |
| Scale Selector | **REMOVE** |
| Unmute All button | **REMOVE** |
| FX button | **REMOVE** |
| Mixer button | **REMOVE** |
| Pitch button | **REMOVE** |

#### Track Row Changes

| Element | Change | Details |
|---------|--------|---------|
| Track label (K, S, H...) | **KEEP** | Abbreviated form |
| Step cells | **MODIFY** | Read-only (tap grid = play/pause) |
| Mobile track header | **REMOVE** | |
| Drag handle (⠿) | **REMOVE** | |
| Mute button (M) | **REMOVE** | |
| Solo button (S) | **REMOVE** | |
| Transpose dropdown | **REMOVE** | |
| Key badge | **REMOVE** | |
| Step count dropdown | **REMOVE** | |
| Expand toggle (🎹) | **REMOVE** | |
| Velocity toggle (▎) | **REMOVE** | |
| Pattern tools toggle (⚙) | **REMOVE** | |
| Copy button | **REMOVE** | |
| Clear button | **REMOVE** | |
| Delete button | **REMOVE** | |
| Mobile edit panel | **REMOVE** | |

#### Panel Changes

| Element | Change |
|---------|--------|
| Effects Panel | **REMOVE** |
| Mixer Panel | **REMOVE** |
| Pitch Overview | **REMOVE** |
| Pattern tools panel | **REMOVE** |
| Velocity lane | **REMOVE** |
| Inline drawer | **REMOVE** |
| Chromatic grid | **REMOVE** |
| Piano roll | **REMOVE** |
| P-lock editor | **REMOVE** |
| FM controls | **REMOVE** |

#### Other Changes

| Element | Change | Details |
|---------|--------|---------|
| Sample Picker | **REMOVE** | Entire component |
| Progress bar | **KEEP** | Make more prominent |
| Orientation hint | **MODIFY** | Text → "↻ Rotate to edit" |
| Share action | **ADD** | Swipe up for QR/share |
| Playhead glow | **ADD** | Visual enhancement |
| Cell pulse | **ADD** | Animation on trigger |
| All tracks visible | **ADD** | Compact simultaneous view |

---

### Portrait Changes Summary

```
KEEP (6 elements):
──────────────────
• Play button (left, large, unchanged)
• App name "Keyboardia"
• Session name
• BPM value display
• Progress bar
• Track labels (abbreviated)

REMOVE (40 elements):
─────────────────────
Header:      7  (connection, avatars, 5 action buttons)
Transport:   8  (BPM slider, swing slider, swing value, scale, unmute, FX, mixer, pitch)
Track row:  14  (header, drag, M, S, ±, key, steps, 🎹, ▎, ⚙, copy, clear, del, edit panel)
Panels:     10  (effects, mixer, pitch, pattern, velocity, drawer, chromatic, piano, plock, FM)
Other:       1  (sample picker)

MODIFY (2 elements):
────────────────────
• Step cells → read-only (tap = play/pause)
• Orientation hint → "↻ Rotate to edit"

ADD (4 elements):
─────────────────
• Share action (swipe up)
• Playhead glow effect
• Cell pulse animation
• All tracks visible (compact view)
```

### Portrait Interactions

| Action | Behavior |
|--------|----------|
| Tap anywhere on grid | Play/Pause |
| Tap ▶ button | Play/Pause |
| Swipe up | Reveal share options / QR |
| Swipe down | Dismiss (if in modal context) |
| Rotate device | Enter edit mode (landscape) |
| Long-press | Copy pattern link (optional) |

### Portrait Visual Behavior

- Playhead column glows/highlights as it moves
- Active cells **pulse** when their step is triggered
- Colors differentiate tracks (subtle, not garish)
- Smooth 60fps animation
- Cells have slight "bounce" on trigger (juice)
- Overall mood: ambient, mesmerizing, "musicality visible"

---

## Landscape Mode: Creation

### Purpose

Landscape mode is the **mobile editing interface**. It provides full editing capability while maximizing step grid visibility through an **Inline Drawer** pattern.

**Use cases:**
- Quick sketch of a beat idea
- Tweaking a pattern while commuting
- Jamming/playing with sounds
- Modifying a remix
- Adding to a pattern started on desktop

### Design Principle: Maximum Grid Visibility

The current mobile landscape UI dedicates **~550px to per-track controls**, leaving only 5-6 steps visible. By moving most controls into an expandable inline drawer, we reclaim **~400px for the step grid** — showing 10+ more steps.

**Key insight from UI-PHILOSOPHY.md:**
> "Controls live where they act" ≠ "controls always visible"

The inline drawer keeps controls **on the track** (aligned with OP-Z philosophy) while using **progressive disclosure** to maximize grid space.

---

### Landscape Interface: Collapsed State (Default)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  ▶   BPM [====●====] 127    Swing [====●====] 12%                          │  │  TRANSPORT
│  └────────────────────────────────────────────────────────────────────────────┘  │  ├─ Play (KEEP)
│                                                                                  │  ├─ BPM slider (KEEP)
│   REMOVED: Scale Selector, FX, Mixer, Pitch, Unmute All                          │  └─ Swing slider (KEEP)
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                            │  │
│  │  M S │ Kick ▾  │ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ░░ ░░  │  │  TRACK ROW (collapsed)
│  │      │         │                                                          │  │  ├─ M: Mute (KEEP visible)
│  │  M S │ Snare ▾ │ ░░ ░░ ░░ ░░ ██ ░░ ░░ ░░ ░░ ░░ ░░ ░░ ██ ░░ ░░ ░░ ░░ ░░  │  │  ├─ S: Solo (KEEP visible)
│  │      │         │                                                          │  │  ├─ Name: Tap to expand (MODIFY)
│  │  M S │ HiHat ▾ │ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░  │  │  │       ▾ chevron hints drawer
│  │      │         │                                                          │  │  └─ Steps: NOW MUCH WIDER
│  │  M S │ Clap ▾  │ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░  │  │
│  │      │         │                                                          │  │  HIDDEN IN DRAWER:
│  └────────────────────────────────────────────────────────────────────────────┘  │  ├─ Drag handle (⠿)
│        │      │              │                                                   │  ├─ Transpose (±0)
│        │      │              └─────────────────────────────────────────────────  │  ├─ Step count (16▾)
│       MUTE  SOLO           STEP GRID (editable, ~400px wider than before)        │  ├─ Expand toggle (🎹)
│      (always    NAME                                                             │  ├─ Velocity toggle (▎)
│       visible)  (tap to                                                          │  ├─ Pattern tools (⚙)
│                 expand)                                                          │  └─ Copy/Clear/Delete
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  Sample Picker (collapsible categories - unchanged)                   ▾    │  │  SAMPLE PICKER (KEEP)
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Space comparison:**

| Layout | Control Width | Steps Visible |
|--------|---------------|---------------|
| Current (all controls visible) | ~550px | ~5-6 steps |
| Inline Drawer (collapsed) | ~144px | ~15-16 steps |
| **Space saved** | **~400px** | **+10 steps** |

---

### Landscape Interface: Expanded State (Snare tapped)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  ▶   BPM [====●====] 127    Swing [====●====] 12%                          │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                            │  │
│  │  M S │ Kick ▾  │ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ░░ ░░  │  │
│  │      │         │                                                          │  │
│  │  M S │ Snare ▲ │ ░░ ░░ ░░ ░░ ██ ░░ ░░ ░░ ░░ ░░ ░░ ░░ ██ ░░ ░░ ░░ ░░ ░░  │  │  ← EXPANDED (▲)
│  │      ├─────────┴──────────────────────────────────────────────────────────┤  │
│  │      │                                                                    │  │    INLINE DRAWER
│  │      │   ⠿   │  ± 0 ▾  │  16 ▾  │  🎹  │  ▎  │  ⚙  │ Copy  Clear  Del   │  │    ├─ ⠿ Drag handle
│  │      │  drag   transpose  steps   chrom   vel  tools      actions         │  │    ├─ Transpose dropdown
│  │      │                                                                    │  │    ├─ Step count dropdown
│  │      └────────────────────────────────────────────────────────────────────┤  │    ├─ 🎹 Chromatic toggle
│  │                                                                            │  │    ├─ ▎ Velocity toggle
│  │  M S │ HiHat ▾ │ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░ ██ ░░  │  │    ├─ ⚙ Pattern tools
│  │      │         │                                                          │  │    └─ Copy/Clear/Delete
│  │  M S │ Clap ▾  │ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ ░░ ░░  │  │
│  │      │         │                                                          │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  Sample Picker                                                        ▾    │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Drawer behavior:**
- Only one drawer open at a time (accordion pattern)
- Tapping another track name closes current drawer, opens new one
- Tapping same track name closes drawer
- Drawer animates open/closed (200ms ease-out)

---

### Landscape Mode: Changes to Existing UI

#### Transport Changes

| Element | Change | Details |
|---------|--------|---------|
| Play button | **KEEP** | Unchanged |
| BPM slider + value | **KEEP** | Unchanged |
| Swing slider + value | **KEEP** | Unchanged |
| Scale Selector | **REMOVE** | Desktop-only (complex interaction) |
| FX button | **REMOVE** | Desktop-only |
| Effects Panel | **REMOVE** | Desktop-only (precision sliders) |
| Mixer button | **REMOVE** | Desktop-only |
| Mixer Panel | **REMOVE** | Desktop-only (per-track volume/pan) |
| Pitch button | **REMOVE** | Desktop-only |
| Pitch Overview | **REMOVE** | Desktop-only (secondary visualization) |
| Unmute All button | **REMOVE** | Desktop-only (niche feature) |

#### Track Row Changes

| Element | Change | Details |
|---------|--------|---------|
| Mute button (M) | **KEEP** | Always visible (essential for jamming) |
| Solo button (S) | **KEEP** | Always visible (essential for jamming) |
| Track name | **MODIFY** | Now a tap target; shows ▾ chevron; tap to expand drawer |
| Step grid | **KEEP** | Now ~400px wider |
| Drag handle (⠿) | **MOVE** | Into inline drawer |
| Transpose dropdown | **MOVE** | Into inline drawer |
| Key badge | **MOVE** | Into inline drawer (with transpose) |
| Step count dropdown | **MOVE** | Into inline drawer |
| Expand toggle (🎹) | **MOVE** | Into inline drawer |
| Velocity toggle (▎) | **MOVE** | Into inline drawer |
| Pattern tools (⚙) | **MOVE** | Into inline drawer |
| Copy button | **MOVE** | Into inline drawer |
| Clear button | **MOVE** | Into inline drawer |
| Delete button | **MOVE** | Into inline drawer |

#### Panel Changes

| Element | Change | Details |
|---------|--------|---------|
| Pattern tools panel | **KEEP** | Opens from ⚙ in drawer |
| Velocity lane | **KEEP** | Opens from ▎ in drawer |
| Chromatic grid | **KEEP** | Opens from 🎹 in drawer |
| P-lock editor | **KEEP** | Opens from shift+tap step |
| Inline drawer | **KEEP** | Used for track controls (repurposed) |

#### Other Changes

| Element | Change | Details |
|---------|--------|---------|
| Sample Picker | **KEEP** | Unchanged (collapsible below grid) |
| Horizontal scroll | **KEEP** | For step grid |
| Drag-to-paint | **KEEP** | Step editing gesture |

---

### Landscape Interaction Model

| Action | Result |
|--------|--------|
| Tap track name | Toggle inline drawer open/closed |
| Tap M button | Toggle mute (instant, drawer stays as-is) |
| Tap S button | Toggle solo (instant, drawer stays as-is) |
| Tap different track name | Close current drawer, open tapped track's drawer |
| Tap step cell | Toggle step on/off |
| Drag across steps | Paint steps on/off |
| Tap control in drawer | Perform action (transpose, etc.) |
| Tap outside drawer | Close drawer |

---

### Landscape Visual States

```
NORMAL ROW:
│  M  S │ Kick ▾  │ ██ ░░ ░░ ░░ ██ ░░ ... │     Standard appearance
                ↑
         subtle chevron hints expandability

MUTED ROW:
│ [M] S │ Kick ▾  │ ░░ ░░ ░░ ░░ ░░ ░░ ... │     Row dimmed 50%
    ↑                                            M button highlighted (yellow bg)
  yellow

SOLOED ROW:
│  M [S]│ Lead ▾  │ ██ ░░ ██ ░░ ██ ░░ ... │     S button highlighted (purple bg)
       ↑
    purple

EXPANDED ROW:
│  M  S │ Kick ▲  │ ██ ░░ ░░ ░░ ██ ░░ ... │     Chevron flips to ▲
│       └─────────┴───────────────────────┤     Drawer visible below
│         [drawer contents...]            │
│       └─────────────────────────────────┤
```

---

### Landscape Changes Summary

```
KEEP (8 elements):
──────────────────
Transport:
• Play button
• BPM slider + value
• Swing slider + value

Per-track (always visible):
• Mute button (M)
• Solo button (S)
• Step grid (now wider)

Other:
• Sample Picker
• All per-track panels (pattern tools, velocity, chromatic, p-lock)

REMOVE (8 elements → desktop-only):
───────────────────────────────────
Transport:
• Scale Selector
• FX button + Effects Panel
• Mixer button + Mixer Panel
• Pitch button + Pitch Overview
• Unmute All button

MOVE TO INLINE DRAWER (9 elements):
───────────────────────────────────
• Drag handle (⠿)
• Transpose dropdown + key badge
• Step count dropdown
• Expand toggle (🎹)
• Velocity toggle (▎)
• Pattern tools toggle (⚙)
• Copy button
• Clear button
• Delete button

MODIFY (1 element):
───────────────────
• Track name → tap target for drawer (shows ▾/▲ chevron)
```

---

## Feature Matrix

```
┌─────────────────────────┬───────────┬───────────┬─────────┐
│ Feature                 │ Portrait  │ Landscape │ Desktop │
├─────────────────────────┼───────────┼───────────┼─────────┤
│ View pattern            │    ✓      │     ✓     │    ✓    │
│ Play/Stop               │    ✓      │     ✓     │    ✓    │
│ Playhead animation      │    ✓      │     ✓     │    ✓    │
│ BPM display             │    ✓      │     ✓     │    ✓    │
│ ─────────────────────── │ ───────── │ ───────── │ ─────── │
│ Edit steps              │    ✗      │     ✓     │    ✓    │
│ BPM editing             │    ✗      │     ✓     │    ✓    │
│ Swing control           │    ✗      │     ✓     │    ✓    │
│ Sample picker           │    ✗      │     ✓     │    ✓    │
│ Track Mute/Solo         │    ✗      │     ✓     │    ✓    │
│ Transpose               │    ✗      │     ✓     │    ✓    │
│ Step count              │    ✗      │     ✓     │    ✓    │
│ Velocity lane           │    ✗      │     ✓     │    ✓    │
│ Pattern tools           │    ✗      │     ✓     │    ✓    │
│ Chromatic grid          │    ✗      │     ✓     │    ✓    │
│ Drag-to-paint           │    ✗      │     ✓     │    ✓    │
│ ─────────────────────── │ ───────── │ ───────── │ ─────── │
│ Scale Selector          │    ✗      │     ✗     │    ✓    │
│ Effects Panel           │    ✗      │     ✗     │    ✓    │
│ Mixer Panel             │    ✗      │     ✗     │    ✓    │
│ Pitch Overview          │    ✗      │     ✗     │    ✓    │
│ Unmute All button       │    ✗      │     ✗     │    ✓    │
│ Session Management      │    ✗      │     ✗     │    ✓    │
│ Export                  │    ✗      │     ✗     │    ✓    │
├─────────────────────────┼───────────┼───────────┼─────────┤
│ MODE                    │ CONSUME   │  CREATE   │ PRODUCE │
│ Grid behavior           │ Visualizer│ Instrument│  Both   │
│ Touch means             │ Play/Pause│   Edit    │  Edit   │
│ Primary use case        │   Watch   │  Sketch   │  Polish │
└─────────────────────────┴───────────┴───────────┴─────────┘

Legend: ✓ = Full feature, ✗ = Hidden
```

---

## Implementation Strategy

This is a **refactoring** of the existing system, not a rewrite. The implementation proceeds in two phases.

### Phase 1: Portrait Mode (Major Changes)

**Goal**: Create the consumption-only portrait experience.

#### Phase 1A: Orientation Detection Infrastructure

**Tasks**:
1. Extend `useDisplayMode` hook to detect orientation:
   - `portrait-mobile`: width < 768px AND height > width
   - `landscape-mobile`: width < 768px AND width > height (OR height < 500px)
   - `desktop`: width >= 768px AND height >= 500px
2. Create `useOrientationMode` hook that returns `'portrait' | 'landscape' | 'desktop'`
3. Add orientation change event listeners with debouncing

**Files to modify**:
- `app/src/hooks/useDisplayMode.ts`
- Create `app/src/hooks/useOrientationMode.ts`

#### Phase 1B: Portrait Read-Only Grid

**Tasks**:
1. Disable all touch handlers on grid cells in portrait
2. Implement tap-anywhere-to-play-pause
3. Show all tracks simultaneously in compact view
4. Hide all editing UI (transport controls, track controls, sample picker)

**Files to modify**:
- `app/src/components/StepSequencer.tsx`
- `app/src/components/StepCell.tsx`
- `app/src/components/Transport.tsx`
- `app/src/components/TrackRow.tsx`

#### Phase 1C: Portrait Header & Visuals

**Tasks**:
1. Create minimal header with session name + play button + BPM display
2. Enhance playhead animation (glow effect, cell pulse on trigger)
3. Add progress bar prominence

**Files to modify**:
- Create `app/src/components/PortraitHeader.tsx`
- `app/src/components/StepSequencer.css`
- `app/src/components/StepCell.css`

#### Phase 1D: Portrait Share & Rotate Hint

**Tasks**:
1. Create share drawer (swipe up gesture)
2. Implement rotation hint component (dismissible, localStorage persistence)
3. Integrate QR code sharing in portrait

**Files to modify**:
- Create `app/src/components/PortraitActionDrawer.tsx`
- Modify `app/src/components/OrientationHint.tsx`

### Phase 2: Landscape Mode (Minimal Changes)

**Goal**: Hide 5 specific elements in landscape mobile. Everything else unchanged.

#### Phase 2A: Hide Transport Elements

**Tasks**:
1. Hide Scale Selector in landscape mobile
2. Hide FX button in landscape mobile
3. Hide Mixer button in landscape mobile
4. Hide Pitch button in landscape mobile
5. Hide Unmute All button in landscape mobile

**Files to modify**:
- `app/src/components/Transport.tsx`
- `app/src/components/Transport.css`

#### Phase 2B: Hide Panels

**Tasks**:
1. Hide Effects Panel in landscape mobile (already hidden when FX button gone)
2. Hide Mixer Panel in landscape mobile (already hidden when Mixer button gone)
3. Hide Pitch Overview in landscape mobile (already hidden when Pitch button gone)

**Files to modify**:
- `app/src/components/StepSequencer.tsx`
- `app/src/components/StepSequencer.css`

### Phase 3: Polish & Testing

**Tasks**:
1. Portrait: Cell pulse animation on trigger
2. Portrait: Smooth playhead glow effect
3. Orientation change transition (fade or slide)
4. Test on various mobile devices
5. Test orientation lock scenarios
6. Add Playwright tests for orientation-specific behavior

---

## Technical Considerations

### Breakpoints

| Mode | Width | Height | Orientation |
|------|-------|--------|-------------|
| Portrait Mobile | < 768px | > width | portrait |
| Landscape Mobile | < 768px OR any | < 500px | landscape |
| Desktop | >= 768px | >= 500px | any |

### CSS Implementation for Landscape

The landscape changes involve two parts: hiding desktop-only elements and restructuring track rows with inline drawers.

#### 1. Hide Desktop-Only Transport Elements

```css
/* Hide desktop-tier features in landscape mobile */
@media (max-width: 768px) and (orientation: landscape),
       (max-height: 500px) {
  .scale-selector,
  .fx-btn,
  .mixer-btn,
  .pitch-btn,
  .unmute-btn {
    display: none;
  }

  .transport-fx-panel,
  .mixer-panel-container,
  .pitch-panel-container {
    display: none;
  }
}
```

#### 2. Inline Drawer Track Row Structure

```css
/* Landscape mobile: collapsed track row */
@media (max-width: 768px) and (orientation: landscape),
       (max-height: 500px) {
  .track-row {
    display: grid;
    grid-template-columns: 32px 32px minmax(60px, 80px) 1fr;
    /* M | S | Name | Steps */
    align-items: center;
    gap: 4px;
  }

  /* Hide inline controls (moved to drawer) */
  .track-row .drag-handle,
  .track-row .transpose-dropdown,
  .track-row .key-badge,
  .track-row .step-count-dropdown,
  .track-row .expand-toggle,
  .track-row .velocity-toggle,
  .track-row .pattern-tools-toggle,
  .track-row .track-actions {
    display: none;
  }

  /* Show these in drawer instead */
  .track-drawer .drag-handle,
  .track-drawer .transpose-dropdown,
  .track-drawer .key-badge,
  .track-drawer .step-count-dropdown,
  .track-drawer .expand-toggle,
  .track-drawer .velocity-toggle,
  .track-drawer .pattern-tools-toggle,
  .track-drawer .track-actions {
    display: flex;
  }

  /* Inline drawer animation */
  .track-drawer {
    grid-column: 2 / -1; /* Span from S column to end */
    max-height: 0;
    overflow: hidden;
    transition: max-height 200ms ease-out;
    background: var(--color-surface-elevated);
    border-radius: 0 0 8px 8px;
  }

  .track-drawer.expanded {
    max-height: 56px;
    padding: 8px 12px;
  }

  /* Track name becomes tap target */
  .track-name {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .track-name::after {
    content: '▾';
    font-size: 10px;
    opacity: 0.6;
    transition: transform 200ms ease;
  }

  .track-name.expanded::after {
    transform: rotate(180deg);
  }
}
```

### Touch Targets

- Minimum touch target: 44px × 44px (iOS HIG)
- Grid cells: Existing sizes maintained in landscape
- Grid cells in portrait: Can be larger since read-only

### Performance

- Use `will-change` sparingly for animated elements
- Debounce orientation change handlers (100ms)
- Avoid layout thrashing during orientation transitions

### Accessibility

- Respect `prefers-reduced-motion` for all animations
- Maintain focus management during orientation changes
- Ensure portrait mode is still usable (play/pause) for users who can't rotate

---

## Open Questions

1. **Mute in Portrait?** Should portrait mode allow muting tracks for focused listening, or is that too much editing capability?

2. **Orientation Lock**: How do we handle users who have orientation lock enabled? Should we show a prominent "unlock to edit" message?

3. **Tablet Behavior**: Should tablets (iPad) use landscape mode in both orientations, or follow the phone behavior?

4. **Published Sessions**: Should published (read-only) sessions always show portrait-style interface regardless of orientation?

---

## Success Metrics

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Portrait load time | < 1s to interactive | Lighthouse mobile audit |
| Orientation switch | < 200ms transition | Manual testing, performance profiling |
| Touch responsiveness | < 50ms feedback | Input latency measurement |
| Grid frame rate | 60fps during playback | Chrome DevTools Performance |
| Feature discoverability | Users find rotate-to-edit | User testing, analytics |

---

## Summary of Changes

### Portrait Mode (Major)

**KEEP (6 elements):**
- Play button (left, large, unchanged)
- App name "Keyboardia"
- Session name
- BPM value display
- Progress bar
- Track labels (abbreviated)

**REMOVE (40 elements):**
- Header: connection status, avatars, 5 action buttons (Publish, Remix, New, Export, Invite)
- Transport: BPM slider, swing slider, swing value, scale selector, unmute, FX, mixer, pitch buttons
- Track row: all controls (M/S, dropdowns, toggles, action buttons, edit panel)
- Panels: all 10 expandable panels
- Sample picker

**MODIFY (2 elements):**
- Step cells → read-only (tap = play/pause)
- Orientation hint → "↻ Rotate to edit"

**ADD (4 elements):**
- Share action (swipe up)
- Playhead glow effect
- Cell pulse animation
- All tracks visible (compact view)

### Landscape Mode (Inline Drawer)

**KEEP (8 elements):**
- Transport: Play, BPM slider, Swing slider
- Per-track: Mute (M), Solo (S), Step grid
- Sample Picker
- All per-track panels (pattern tools, velocity, chromatic, p-lock)

**REMOVE (8 elements → desktop-only):**
- Scale Selector
- FX button + Effects Panel
- Mixer button + Mixer Panel
- Pitch button + Pitch Overview
- Unmute All button

**MOVE TO INLINE DRAWER (9 elements):**
- Drag handle (⠿)
- Transpose dropdown + key badge
- Step count dropdown
- Expand toggle (🎹)
- Velocity toggle (▎)
- Pattern tools toggle (⚙)
- Copy / Clear / Delete buttons

**MODIFY (1 element):**
- Track name → tap target for drawer (shows ▾/▲ chevron)

**Result:** Step grid gains ~400px width → 10+ more steps visible

---

## References

- [Existing SPEC.md](./SPEC.md) — Main product specification
- [useDisplayMode.ts](../app/src/hooks/useDisplayMode.ts) — Current viewport detection
- [features.ts](../app/src/config/features.ts) — Existing feature flag system
- [OrientationHint.tsx](../app/src/components/OrientationHint.tsx) — Current orientation hint
