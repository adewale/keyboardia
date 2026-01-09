# Mobile Interface Simplification Spec

## Overview

This specification defines a radical simplification of Keyboardia's mobile interface by introducing **two distinct modes** based on device orientation:

- **Portrait Mode**: Consumption-only (watch, listen, share)
- **Landscape Mode**: Creation (edit, compose, sketch)

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
┌─────────────────────────────────────────┐
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │   HEADER (minimal)
│  │   Funky Beat #42        ▶ 127  │    │   ├─ Session name (content title)
│  │                                 │    │   ├─ Play/Pause button (44px)
│  └─────────────────────────────────┘    │   └─ BPM display (read-only)
│                                         │
│  ┌─────────────────────────────────┐    │
│  │    1   2   3   4   5   6   7   8│    │   STEP NUMBERS (subtle)
│  │┌─────────────────────────────┐  │    │
│  ││                             │  │    │
│  ││ K  ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ │  │    │
│  ││    ══                       │  │    │   PLAYHEAD (glowing column)
│  ││ S  ░░ ░░ ░░ ░░ ██ ░░ ░░ ░░ │  │    │   ├─ Sweeps across pattern
│  ││                             │  │    │   ├─ Cells pulse when triggered
│  ││ H  ██ ░░ ██ ░░ ██ ░░ ██ ░░ │  │    │   └─ Smooth 60fps animation
│  ││                             │  │    │
│  ││ C  ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ │  │    │   VISUALIZATION GRID
│  ││                             │  │    │   ├─ All tracks visible
│  ││ B  ██ ░░ ░░ ██ ░░ ░░ ██ ░░ │  │    │   ├─ Read-only (no touch editing)
│  ││                             │  │    │   └─ Tap anywhere = play/pause
│  ││ L  ░░ ░░ ██ ░░ ░░ ██ ░░ ░░ │  │    │
│  ││                             │  │    │
│  │└─────────────────────────────┘  │    │
│  │    9  10  11  12  13  14  15 16 │    │   SECOND HALF
│  │┌─────────────────────────────┐  │    │   └─ Scrolls or pages automatically
│  ││ K  ██ ░░ ░░ ░░ ██ ░░ ░░ ░░ │  │    │
│  ││ S  ░░ ░░ ░░ ░░ ██ ░░ ░░ ░░ │  │    │
│  ││ H  ██ ░░ ██ ░░ ██ ░░ ██ ░░ │  │    │
│  ││ C  ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ │  │    │
│  ││ B  ░░ ██ ░░ ░░ ░░ ██ ░░ ░░ │  │    │
│  ││ L  ░░ ░░ ░░ ██ ░░ ░░ ░░ ██ │  │    │
│  │└─────────────────────────────┘  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ ═══════════════●═══════════════ │    │   PROGRESS BAR
│  └─────────────────────────────────┘    │   └─ Shows position in pattern
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │   ACTION DRAWER
│  │      ↻ Rotate to edit           │    │   ├─ Rotation hint
│  │                                 │    │   ├─ Swipe up for share/QR
│  │      ⌃ Share                    │    │   └─ Minimal, dismissible
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

### Portrait Features

| Feature | Included | Notes |
|---------|----------|-------|
| Session name | Yes | Prominent, this is "content" |
| Play/Pause | Yes | Large touch target (44px+) or tap-anywhere |
| BPM display | Yes | Read-only context |
| Visualization grid | Yes | All tracks, read-only, animated |
| Playhead animation | Yes | The "show" — cells pulse on trigger |
| Progress bar | Yes | Loop position indicator |
| Share action | Yes | Swipe up or button |
| Rotate hint | Yes | Call to action for editing |
| Creator attribution | Optional | If viewing someone else's beat |

### Portrait Exclusions

Everything else is excluded:

- Step toggling / editing
- Track selection (for editing purposes)
- Sample picker
- Mute/Solo controls
- BPM editing
- Swing control
- Effects panel
- Mixer panel
- Velocity lane
- Scale selector
- Step count selector
- Session management
- Export
- Full multiplayer UI

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

Landscape mode is the **only mobile editing interface**. It must be complete enough to create a full beat, but native to mobile — not a cramped desktop. Uses gestures, bottom sheets, and progressive disclosure.

**Use cases:**
- Quick sketch of a beat idea
- Tweaking a pattern while commuting
- Jamming/playing with sounds
- Modifying a remix
- Adding to a pattern started on desktop

### Interface Specification

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  ▶  ■   127 BPM   ⟳ 12%  │░░░░░░░░░░░░░░░░░░░█░░░░░│  ●●●●○○   [Sounds]  ⋮  │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│     │       │        │              │                       │          │       │   │
│   PLAY   STOP      BPM           SWING              PLAYHEAD        TRACKS   MORE │
│                  (tap to         (tap to            POSITION         DOTS    MENU │
│                   edit)           edit)             (animated)                     │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │        │  1     2     3     4  ┆  5     6     7     8  ┆  9    10    11   12 │  │
│  │  ──────┼───────────────────────┼───────────────────────┼──────────────────── │  │
│  │        │                   ┃   │                       │                     │  │
│  │  K  ●▶ │  ██    ░░    ░░  ┃░░ │  ██    ░░    ░░    ░░ │  ██    ░░    ░░    │  │
│  │        │                   ┃   │                       │                     │  │
│  │  ──────┼───────────────────┼───┼───────────────────────┼──────────────────── │  │
│  │        │                   ┃   │                       │                     │  │
│  │  S  ○  │  ░░    ░░    ░░  ┃░░ │  ██    ░░    ░░    ░░ │  ░░    ░░    ░░    │  │
│  │        │                   ┃   │                       │                     │  │
│  │  ──────┼───────────────────┼───┼───────────────────────┼──────────────────── │  │
│  │        │                   ┃   │                       │                     │  │
│  │  H  ○  │  ██    ░░    ██  ┃░░ │  ██    ░░    ██    ░░ │  ██    ░░    ██    │  │
│  │        │                   ┃   │                       │                     │  │
│  │  ──────┼───────────────────┼───┼───────────────────────┼──────────────────── │  │
│  │        │                   ┃   │                       │                     │  │
│  │  P  ○  │  ░░    ░░    ░░  ┃░░ │  ░░    ░░    ░░    ██ │  ░░    ░░    ░░    │  │
│  │        │                   ┃   │                       │                     │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│     │  │                      │                                                    │
│  TRACK SELECT              PLAYHEAD                                                │
│  LABEL INDICATOR           (animated)           ← SCROLL HORIZONTALLY FOR 13-16 → │
│     ●=selected                                    (or pinch to zoom)               │
│     ▶=playing                                                                      │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Transport Bar Elements

| Element | Behavior |
|---------|----------|
| ▶ Play | Tap to start playback (44px touch target) |
| ■ Stop | Tap to stop and reset to beat 1 |
| 127 BPM | Tap to open numeric input, or drag vertically to adjust ±1 |
| ⟳ 12% | Swing amount. Tap to cycle (0→12→25→50→0) or drag for fine control |
| Playhead bar | Visual feedback of loop progress |
| ●●●●○○ | Track dots. Filled = has steps. Tap to jump to track |
| [Sounds] | Opens bottom sheet with sample picker |
| ⋮ | Overflow menu (mute all, solo clear, session info) |

### Grid Interactions

| Action | Behavior |
|--------|----------|
| Tap cell | Toggle step on/off (immediate audio feedback) |
| Drag across row | Paint mode (set multiple steps ON) |
| Drag starting on ON cell | Erase mode (set multiple steps OFF) |
| Tap track label | Select track (for sample picker) |
| Long-press track label | Context menu: Mute, Solo, Clear, Duplicate |
| Swipe grid left/right | Scroll to more steps (if pattern > visible) |
| Pinch grid | Zoom: see more/fewer steps |

### Visual Indicators

| Symbol | Meaning |
|--------|---------|
| ● | Selected track (in label column) |
| ▶ | Currently playing note (pulses on trigger) |
| ┃ | Playhead line (animated, sweeps right) |
| ┆ | Beat dividers (every 4 steps, subtle) |
| ██ | Active step (filled, accent color) |
| ░░ | Inactive step (empty, dark) |

### Bottom Sheet: Sample Picker

When the user taps `[Sounds]`, a bottom sheet slides up:

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  [Transport bar - dimmed]                                                          │
│  [Grid area - dimmed/shrunk]                                                       │
│                                                                                    │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃                                                                              ┃  │
│  ┃   ─────────────────  ← Drag handle (swipe down to close)                     ┃  │
│  ┃                                                                              ┃  │
│  ┃   KICK                                      ← Category header               ┃  │
│  ┃                                                                              ┃  │
│  ┃   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               ┃  │
│  ┃   │         │ │  ████   │ │         │ │         │ │         │               ┃  │
│  ┃   │ Kick 1  │ │Kick 808 │ │ Kick 2  │ │ Kick 3  │ │ Kick Lo │  → scroll    ┃  │
│  ┃   │         │ │(current)│ │         │ │         │ │         │               ┃  │
│  ┃   └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘               ┃  │
│  ┃                                                                              ┃  │
│  ┃   TAP = preview (plays sound)                                                ┃  │
│  ┃   TAP current = confirm (closes sheet)                                       ┃  │
│  ┃   SWIPE DOWN = close without change                                          ┃  │
│  ┃                                                                              ┃  │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Bottom sheet behavior:**
- Opens from `[Sounds]` button tap
- Shows samples for selected track's category
- Tapping a sample = preview (hear it)
- Tapping again = confirm selection
- Swipe down = close without change
- Grid stays visible but dimmed above
- Sheet height: ~40% of screen

### Landscape Features

| Feature | Included | Notes |
|---------|----------|-------|
| Step grid (editable) | Yes | Full editing capability |
| Play/Stop | Yes | 44px touch targets |
| BPM editing | Yes | Tap or drag to adjust |
| Swing control | Yes | Essential for groove |
| Track selection | Yes | Tap label to select |
| Sample picker | Yes | Via bottom sheet |
| Mute/Solo | Yes | Via long-press context menu |
| Drag-to-paint | Yes | Draw multiple steps |
| Multi-track view | Yes | 4 tracks visible simultaneously |
| Playhead animation | Yes | Visual feedback |
| Horizontal scroll | Yes | For patterns > 12 steps |
| Pinch to zoom | Yes | See more/fewer steps |

### Landscape Exclusions

| Feature | Why Excluded |
|---------|--------------|
| Effects Panel | Requires precision, desktop-tier refinement |
| Mixer Panel | Per-track volume/pan is desktop-tier |
| Velocity Lane | Precision editing, desktop-tier |
| Pitch Overview | Secondary visualization, desktop-tier |
| Scale Selector | Complex interaction, desktop-tier |
| Step Count Selector | Pattern length changes are desktop-tier |
| Session Management | Full session control is desktop-tier |
| Export | Desktop-tier feature |
| Full Multiplayer UI | Minimal indicator only (connection status) |

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
│ Track selection         │    ✗      │     ✓     │    ✓    │
│ Sample picker           │    ✗      │     ✓     │    ✓    │
│ BPM editing             │    ✗      │     ✓     │    ✓    │
│ Swing control           │    ✗      │     ✓     │    ✓    │
│ Mute/Solo (via menu)    │    ✗      │     ✓     │    ✓    │
│ Drag-to-paint           │    ✗      │     ✓     │    ✓    │
│ ─────────────────────── │ ───────── │ ───────── │ ─────── │
│ Effects Panel           │    ✗      │     ✗     │    ✓    │
│ Mixer Panel             │    ✗      │     ✗     │    ✓    │
│ Velocity Lane           │    ✗      │     ✗     │    ✓    │
│ Pitch Overview          │    ✗      │     ✗     │    ✓    │
│ Scale Selector          │    ✗      │     ✗     │    ✓    │
│ Step Count Selector     │    ✗      │     ✗     │    ✓    │
│ Session Management      │    ✗      │     ✗     │    ✓    │
│ Multiplayer UI          │    ✗      │     ○     │    ✓    │
│ Export                  │    ✗      │     ✗     │    ✓    │
├─────────────────────────┼───────────┼───────────┼─────────┤
│ MODE                    │ CONSUME   │  CREATE   │ PRODUCE │
│ Grid behavior           │ Visualizer│ Instrument│  Both   │
│ Touch means             │ Play/Pause│   Edit    │  Edit   │
│ Primary use case        │   Watch   │  Sketch   │  Polish │
└─────────────────────────┴───────────┴───────────┴─────────┘

Legend: ✓ = Full feature, ○ = Minimal/indicator only, ✗ = Hidden
```

---

## Implementation Strategy

This is a **refactoring** of the existing system, not a rewrite. The implementation proceeds in phases, each building on the last.

### Phase 1: Orientation Detection Infrastructure

**Goal**: Create robust orientation detection that distinguishes portrait from landscape on mobile devices.

**Tasks**:
1. Extend `useDisplayMode` hook to detect orientation:
   - `portrait-mobile`: width < 768px AND height > width
   - `landscape-mobile`: width < 768px AND width > height (OR height < 500px)
   - `desktop`: width >= 768px AND height >= 500px
2. Create `useOrientationMode` hook that returns `'portrait' | 'landscape' | 'desktop'`
3. Add orientation change event listeners with debouncing
4. Handle edge cases (tablets, foldables, desktop resize)

**Files to modify**:
- `app/src/hooks/useDisplayMode.ts`
- Create `app/src/hooks/useOrientationMode.ts`

### Phase 2: Feature Flag System for Orientation

**Goal**: Extend existing feature flags to be orientation-aware.

**Tasks**:
1. Create orientation-aware feature configuration:
   ```typescript
   type OrientationFeatures = {
     portrait: FeatureSet;
     landscape: FeatureSet;
     desktop: FeatureSet;
   };
   ```
2. Create `useOrientationFeatures` hook that returns active features for current orientation
3. Update components to check orientation-specific feature flags

**Files to modify**:
- `app/src/config/features.ts`
- Create `app/src/hooks/useOrientationFeatures.ts`

### Phase 3: Portrait Mode - Read-Only Grid

**Goal**: Make the step grid read-only in portrait mode while maintaining visualization.

**Tasks**:
1. Create `PortraitVisualization` component (or modify `StepSequencer` with conditional rendering)
2. Disable all touch handlers on grid cells in portrait
3. Enhance playhead animation (glow effect, cell pulse on trigger)
4. Implement tap-anywhere-to-play-pause
5. Show all tracks simultaneously in compact view
6. Hide transport controls except Play and BPM display

**Files to modify**:
- `app/src/components/StepSequencer.tsx`
- `app/src/components/StepCell.tsx`
- `app/src/components/Transport.tsx`
- Create `app/src/components/PortraitHeader.tsx`

### Phase 4: Portrait Mode - Share & Rotate Hint

**Goal**: Add share functionality and rotation hint to portrait mode.

**Tasks**:
1. Create share drawer (swipe up gesture)
2. Implement rotation hint component (dismissible, localStorage persistence)
3. Integrate QR code sharing in portrait
4. Add session name/title display

**Files to modify**:
- Create `app/src/components/PortraitActionDrawer.tsx`
- Modify `app/src/components/OrientationHint.tsx` (repurpose or replace)
- `app/src/components/QROverlay.tsx`

### Phase 5: Landscape Mode - Streamlined Transport

**Goal**: Create the compact landscape transport bar with essential controls only.

**Tasks**:
1. Create `LandscapeTransport` component with:
   - Play/Stop buttons
   - Tappable BPM control
   - Swing control (tap to cycle or drag)
   - Playhead progress indicator
   - Track dots
   - Sounds button (sample picker trigger)
2. Hide desktop-specific controls (effects toggle, mixer toggle, etc.)
3. Implement inline BPM editing (numeric input or drag)

**Files to modify**:
- Create `app/src/components/LandscapeTransport.tsx`
- `app/src/components/Transport.tsx` (conditional rendering)

### Phase 6: Landscape Mode - Bottom Sheet Sample Picker

**Goal**: Replace full sample picker with mobile-native bottom sheet.

**Tasks**:
1. Extend existing `BottomSheet` component for sample picker use case
2. Create `SamplePickerSheet` component:
   - Shows samples for selected track's category
   - Tap to preview, tap again to confirm
   - Swipe down to dismiss
3. Dim/shrink main content when sheet is open
4. Implement smooth spring animations

**Files to modify**:
- `app/src/components/BottomSheet.tsx`
- Create `app/src/components/SamplePickerSheet.tsx`
- `app/src/components/SamplePicker.tsx` (hide in landscape, use sheet instead)

### Phase 7: Landscape Mode - Context Menu for Track Actions

**Goal**: Implement long-press context menu for Mute/Solo/Clear/Duplicate.

**Tasks**:
1. Extend `useLongPress` hook if needed
2. Create `TrackContextMenu` component (popover or action sheet style)
3. Implement Mute/Solo toggle from context menu
4. Implement Clear track action
5. (Optional) Implement Duplicate track action

**Files to modify**:
- `app/src/hooks/useLongPress.ts`
- Create `app/src/components/TrackContextMenu.tsx`
- `app/src/components/TrackRow.tsx`

### Phase 8: Hide Desktop-Only Features in Landscape

**Goal**: Ensure desktop-only features are hidden in landscape mobile.

**Tasks**:
1. Hide Effects Panel in landscape
2. Hide Mixer Panel toggle in landscape
3. Hide Velocity Lane in landscape
4. Hide Pitch Overview in landscape
5. Hide Scale Selector in landscape
6. Hide Step Count dropdown in landscape
7. Minimize header/session controls in landscape

**Files to modify**:
- `app/src/components/EffectsPanel.tsx`
- `app/src/components/MixerPanel.tsx`
- `app/src/components/VelocityLane.tsx`
- `app/src/components/PitchOverview.tsx`
- `app/src/components/ScaleSelector.tsx`
- `app/src/components/StepCountDropdown.tsx`
- `app/src/components/SessionControls.tsx`

### Phase 9: Polish & Animation

**Goal**: Add micro-interactions and visual polish.

**Tasks**:
1. Portrait: Cell pulse animation on trigger
2. Portrait: Smooth playhead glow effect
3. Landscape: Bottom sheet spring animations
4. Landscape: Context menu appear/dismiss animations
5. Orientation change transition (fade or slide)
6. Haptic feedback on track switch (if supported)

**Files to modify**:
- Various component CSS files
- Consider using CSS custom properties for animation timing

### Phase 10: Testing & Edge Cases

**Goal**: Ensure robust behavior across devices and orientations.

**Tasks**:
1. Test on various mobile devices (iPhone SE, iPhone 14 Pro Max, Pixel, etc.)
2. Test orientation lock scenarios
3. Test rapid orientation changes
4. Test with keyboard attached (iPad)
5. Test accessibility (screen readers, reduced motion)
6. Add Playwright tests for orientation-specific behavior

---

## Technical Considerations

### Breakpoints

| Mode | Width | Height | Orientation |
|------|-------|--------|-------------|
| Portrait Mobile | < 768px | > width | portrait |
| Landscape Mobile | < 768px OR any | < 500px | landscape |
| Desktop | >= 768px | >= 500px | any |

### Height Constraint in Landscape

Landscape mobile has severe height constraints (~375px usable after browser chrome). The layout must fit:

- Transport bar: 48px
- 4 track rows: 4 × 56px = 224px
- Padding: ~40px
- **Total**: ~312px

This leaves minimal breathing room. Components must be compact.

### Touch Targets

- Minimum touch target: 44px × 44px (iOS HIG)
- Grid cells in landscape: ~32px width (tight but usable on larger phones)
- Grid cells in portrait: Can be larger since read-only

### Performance

- Use `will-change` sparingly for animated elements
- Debounce orientation change handlers (100ms)
- Avoid layout thrashing during orientation transitions
- Consider using `transform` instead of `top/left` for animations

### Accessibility

- Respect `prefers-reduced-motion` for all animations
- Maintain focus management during orientation changes
- Ensure portrait mode is still usable (play/pause) for users who can't rotate
- Provide alternative to long-press (accessibility menu or button)

---

## Open Questions

1. **Mute in Portrait?** Should portrait mode allow muting tracks for focused listening, or is that too much editing capability?

2. **Orientation Lock**: How do we handle users who have orientation lock enabled? Should we show a prominent "unlock to edit" message?

3. **Tablet Behavior**: Should tablets (iPad) use landscape mode in both orientations, or follow the phone behavior?

4. **Published Sessions**: Should published (read-only) sessions always show portrait-style interface regardless of orientation?

5. **Multiplayer in Portrait**: Should portrait mode show any indication of other connected users, or is it purely a consumption view?

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

## References

- [Existing SPEC.md](./SPEC.md) — Main product specification
- [useDisplayMode.ts](../app/src/hooks/useDisplayMode.ts) — Current viewport detection
- [features.ts](../app/src/config/features.ts) — Existing feature flag system
- [OrientationHint.tsx](../app/src/components/OrientationHint.tsx) — Current orientation hint
- [BottomSheet.tsx](../app/src/components/BottomSheet.tsx) — Existing bottom sheet component
