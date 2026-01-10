# Mobile Interface Simplification Spec

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
| BPM slider | **REMOVE** | |
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
| Swing slider + value | **REMOVE** |
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

REMOVE (38 elements):
─────────────────────
Header:      6  (connection, avatars, 4 action buttons)
Transport:   7  (BPM slider, swing×2, scale, unmute, FX, mixer, pitch)
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

Landscape mode is the **mobile editing interface**. It retains nearly all current functionality, with only desktop-tier refinement features hidden.

**Use cases:**
- Quick sketch of a beat idea
- Tweaking a pattern while commuting
- Jamming/playing with sounds
- Modifying a remix
- Adding to a pattern started on desktop

### Design Principle: Minimal Changes

Landscape mode is **the current mobile interface minus 5 specific elements**. All existing functionality (sample picker, track controls, transport, etc.) remains unchanged.

### Landscape Removals

The following elements are **hidden in landscape mobile** (moved to desktop-only):

| Element | Current Location | Reason for Removal |
|---------|------------------|-------------------|
| **Scale Selector** | Transport bar | Complex interaction, desktop-tier |
| **FX button** | Transport bar | Opens panel requiring precision |
| **Effects Panel** | Below transport | Requires precision sliders, desktop-tier refinement |
| **Mixer button** | Transport bar | Opens panel requiring precision |
| **Mixer Panel** | Below transport | Per-track volume/pan is desktop-tier |
| **Pitch button** | Transport bar | Opens visualization panel |
| **Pitch Overview panel** | Below transport | Secondary visualization, desktop-tier |
| **Unmute All button** | Transport bar | Niche feature, declutters transport |

### What Remains in Landscape (Unchanged)

Everything else from the current mobile interface stays:

**Transport:**
- Play/Pause button
- BPM slider and value
- Swing slider and value

**Sample Picker:**
- Collapsible categories below grid
- All existing interaction patterns

**Per-Track Controls:**
- Track name (click to preview, double-click to rename)
- Mute button (M)
- Solo button (S)
- Transpose dropdown
- Step count dropdown
- Expand toggle (chromatic grid)
- Velocity toggle
- Pattern tools toggle (⚙)
- Copy/Clear/Delete buttons

**Panels (per-track):**
- Pattern tools panel (rotate, invert, Euclidean)
- Velocity lane
- Mobile edit panel ("tap to edit" drawer)
- Inline drawer
- Chromatic grid / Piano roll
- P-lock inline editor

**Grid:**
- Full editing capability
- Drag-to-paint
- Horizontal scroll
- All existing interactions

### Landscape Interface (ASCII)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  ▶   BPM [====●====] 127    Swing [====●====] 12%                            │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│     │              │                    │                                          │
│   PLAY           BPM                  SWING                                        │
│              (slider+value)       (slider+value)                                   │
│                                                                                    │
│   REMOVED: Scale Selector, FX button, Mixer button, Pitch button, Unmute All      │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  ⠿ │ Kick    │ M S │ ±0 │ 16▾│ 🎹 │ ▎ │ ⚙ │ ██ ░░ ██ ░░ ... │ Copy Clear Del│  │
│  │  ⠿ │ Snare   │ M S │ ±0 │ 16▾│ 🎹 │ ▎ │ ⚙ │ ░░ ░░ ░░ ░░ ... │ Copy Clear Del│  │
│  │  ⠿ │ HiHat   │ M S │ ±0 │ 16▾│ 🎹 │ ▎ │ ⚙ │ ██ ░░ ██ ░░ ... │ Copy Clear Del│  │
│  │  ⠿ │ Clap    │ M S │ ±0 │ 16▾│ 🎹 │ ▎ │ ⚙ │ ░░ ░░ ░░ ██ ... │ Copy Clear Del│  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│     │      │       │     │    │    │   │   │        │                │             │
│   DRAG   NAME    MUTE  TRANS STEP EXP VEL PAT    STEPS            ACTIONS         │
│   HANDLE        SOLO   POSE  CNT  AND     TOOLS  (editable)                        │
│                              (all existing controls remain)                        │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  Sample Picker (collapsible categories - unchanged)                          │  │
│  │  ├─ Drums (expanded by default)                                              │  │
│  │  ├─ Bass                                                                     │  │
│  │  ├─ Keys                                                                     │  │
│  │  └─ ...                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
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

### CSS Implementation for Landscape Removals

The landscape changes can be implemented with simple CSS media queries:

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

**REMOVE (38 elements):**
- Header: connection status, avatars, action buttons
- Transport: BPM slider, swing, scale selector, unmute, FX, mixer, pitch buttons
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

### Landscape Mode (Minimal)

**Only 5 elements removed:**
1. Scale Selector
2. FX button + Effects Panel
3. Mixer button + Mixer Panel
4. Pitch button + Pitch Overview
5. Unmute All button

**Everything else unchanged** — sample picker, track controls, velocity lane, pattern tools, chromatic grid, etc. all remain.

---

## References

- [Existing SPEC.md](./SPEC.md) — Main product specification
- [useDisplayMode.ts](../app/src/hooks/useDisplayMode.ts) — Current viewport detection
- [features.ts](../app/src/config/features.ts) — Existing feature flag system
- [OrientationHint.tsx](../app/src/components/OrientationHint.tsx) — Current orientation hint
