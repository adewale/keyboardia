# Keyboardia Design Language

A comprehensive guide to the visual and interaction language of Keyboardia.

---

## Brand Identity

### Tagline

**Create/Collaborate. Remix. Share.**

Three distinct concepts, each with its own color:
- **Create/Collaborate** (orange) — The Glitch angle: instant creation, real-time multiplayer
- **Remix** (purple) — The GitHub angle: fork any session, build on others' work
- **Share** (teal) — The SoundCloud angle: publish and discover music

### Logo

`keyboardia.svg` — Clean, minimal mark at 80-120px on landing page.

---

## Color System

### CSS Variables (Defined in index.css)

These are the actual CSS custom properties defined in `:root`:

```css
/* Surfaces */
--color-bg: #121212;
--color-surface: #1e1e1e;
--color-surface-elevated: #2a2a2a;
--color-surface-hover: #333333;
--color-surface-active: #444444;

/* Borders */
--color-border: #3a3a3a;
--color-border-light: #4a4a4a;
--color-border-hover: #555555;

/* Text */
--color-text: rgba(255, 255, 255, 0.87);
--color-text-muted: rgba(255, 255, 255, 0.6);
--color-text-dimmed: rgba(255, 255, 255, 0.38);

/* Accent */
--color-accent: #e85a30;
--color-accent-hover: #f07048;
--color-accent-muted: rgba(232, 90, 48, 0.2);
--color-accent-glow: rgba(232, 90, 48, 0.6);
--color-brand: var(--color-accent);  /* alias */

/* Semantic */
--color-success: #1db954;  /* Spotify green */
--color-warning: #ffc107;
--color-error: #e74c3c;
--color-secondary: #d4a054;
--color-info: var(--color-blue);  /* alias */

/* Feature Colors */
--color-blue: #3498db;
--color-purple: #9b59b6;
--color-teal: #4ecdc4;
--color-cyan: #00bcd4;
--color-pink: #e91e63;
--color-green: #2ecc71;
--color-orange: #e67e22;
--color-yellow: #f1c40f;

/* Playhead */
--color-playhead: #ffffff;
--color-playhead-glow: rgba(255, 255, 255, 0.4);
```

### Background Layers (Conceptual)

A progression from deepest black to elevated surfaces. Not all are CSS variables — some are used as literal hex values:

| Hex | Usage | CSS Variable? |
|-----|-------|---------------|
| `#0a0a0a` | Landing page, fullscreen backgrounds | No |
| `#121212` | App background, root | `--color-bg` |
| `#1a1a1a` | Transport bar, panels | No |
| `#1e1e1e` | Cards, panels, bottom sheets | `--color-surface` |
| `#252525` | Input backgrounds, controls | No |
| `#2a2a2a` | Elevated cards, inactive steps | `--color-surface-elevated` |
| `#333333` | Hover states, active surfaces | `--color-surface-hover` |
| `#444444` | Active/pressed state | `--color-surface-active` |

### Border Progression (Conceptual)

| Hex | Usage | CSS Variable? |
|-----|-------|---------------|
| `#333333` | Panel borders | `--color-surface-hover` (shared) |
| `#3a3a3a` | Default borders | `--color-border` |
| `#444444` | Control borders | `--color-surface-active` (shared) |
| `#4a4a4a` | Hover borders, beat markers | `--color-border-light` |
| `#555555` | Interactive elements | `--color-border-hover` |
| `#666666` | Focused elements | No |

### Brand Orange (Primary Accent)

The signature color — energy, action, active state.

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-accent` | `#e85a30` | Active steps, CTA buttons, primary actions |
| `--color-accent-hover` | `#f07048` | Hover states on accent |
| `--color-brand` | `var(--color-accent)` | Alias for accent (brand text, headlines) |
| `--color-accent-glow` | `rgba(232, 90, 48, 0.6)` | Active step glow, shadows |
| `--color-accent-muted` | `rgba(232, 90, 48, 0.2)` | Subtle accent backgrounds |

### Semantic Colors

| Token | Hex | Meaning | Examples |
|-------|-----|---------|----------|
| `--color-purple` | `#9b59b6` | Modes, Parameter Locks | Chromatic mode, p-lock borders, Remix word |
| `--color-info` | `#3498db` | Pitch, Selection | Pitch badges, selected state (aliased to --color-blue) |
| `--color-success` | `#1db954` | Positive, Source | Copy source, add buttons, connection status (Spotify green) |
| `--color-secondary` | `#d4a054` | Volume, Warmth | Volume badges |
| `--color-teal` | `#4ecdc4` | Multiplayer, Share | Share word, avatar rings, presence |
| `--color-cyan` | `#00bcd4` | Effects, FX | Effects panel, FX toggle |

### State Colors

| State | Color | Hex |
|-------|-------|-----|
| Playing | White border | `#ffffff` |
| Error | Red | `#e74c3c` |
| Warning | Yellow | `#f1c40f` |
| Muted | Yellow | `#f1c40f` |
| Solo | Purple | `#9b59b6` |
| Recording | Red pulse | `#e74c3c` |
| Bypassed | Orange-red | `#ff5722` |
| Active | Green | `#1db954` |

### Text Hierarchy

| Level | Color | CSS Variable | Usage |
|-------|-------|--------------|-------|
| Primary | `rgba(255, 255, 255, 0.87)` | `--color-text` | Headlines, values, active labels |
| Muted | `rgba(255, 255, 255, 0.6)` | `--color-text-muted` | Hints, inactive labels, descriptions |
| Dimmed | `rgba(255, 255, 255, 0.38)` | `--color-text-dimmed` | Disabled controls, placeholders |
| Disabled | `#666666` | — | Disabled controls, timestamps |
| Faint | `#444444` | — | Subtle hints |

Note: Three text colors are defined as CSS variables (text, muted, dimmed). Other opacity levels are used directly in CSS where needed.

---

## Effects Color Coding

Each effect has a distinct color for quick identification:

| Effect | Color | Hex |
|--------|-------|-----|
| Reverb | Purple | `#9c27b0` |
| Delay | Blue | `#2196f3` |
| Chorus | Green | `#4caf50` |
| Distortion | Orange-red | `#ff5722` |

This extends to slider thumbs, labels, and indicators.

---

## Instrument Category Colors

Dynamic `--category-color` CSS variable set per instrument category in SamplePicker. Defined in `sample-constants.ts`:

| Category | Hex | Color Name | Contents |
|----------|-----|------------|----------|
| Drums | `#e67e22` | Orange | Kick, Snare, Hi-Hat, Clap, etc. |
| Bass | `#9b59b6` | Purple | Bass, Sub, synth basses |
| Keys | `#3498db` | Blue | Piano, Rhodes, Wurli, Organ |
| Leads | `#e91e63` | Pink | Lead, Pluck, synth leads |
| Pads | `#2ecc71` | Green | Pad, Chord, synth pads |
| FX | `#00bcd4` | Cyan | Zap, Noise, synth FX |

---

## Multiplayer Identity Colors

Players get Google Docs-style anonymous identities (e.g., "Red Fox", "Teal Penguin"). The identity system uses 18 colors × 73 animals = 1,314 unique combinations.

Defined in `utils/identity.ts`:

```typescript
const IDENTITY_COLORS = [
  '#E53935', // Red
  '#D81B60', // Pink
  '#8E24AA', // Purple
  '#5E35B1', // Deep Purple
  '#3949AB', // Indigo
  '#1E88E5', // Blue
  '#039BE5', // Light Blue
  '#00ACC1', // Cyan
  '#00897B', // Teal
  '#43A047', // Green
  '#7CB342', // Light Green
  '#C0CA33', // Lime
  '#FDD835', // Yellow
  '#FFB300', // Amber
  '#FB8C00', // Orange
  '#F4511E', // Deep Orange
  '#6D4C41', // Brown
  '#757575', // Grey
];
```

### How It Works

- Player ID is hashed to deterministically select a color + animal
- Same player ID always gets the same identity
- CSS variables `--player-color`, `--player-color-light`, `--player-color-glow` are set per-player

### Cursor & Attribution

- Player cursors show identity color with animal name tooltip
- Remote step changes flash with player's color (600ms animation)
- Avatar stack shows colored circles with animal initials

---

## Typography

### Font Stack

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

Native system fonts for performance and platform consistency.

### Weights

| Weight | Usage |
|--------|-------|
| 400 | Body text, descriptions |
| 500 | Track names, sample names |
| 600 | Button labels, section headers |
| 700 | Headlines, numeric values (BPM, step count) |
| 800 | Landing page brand name |

### Sizes

| Size | Usage |
|------|-------|
| `5rem` | Landing page brand (desktop) |
| `3rem` | Landing page brand (mobile) |
| `2rem` | Landing tagline |
| `1.25rem` | CTA buttons |
| `1rem` | Section headers, feature titles |
| `0.875rem` | Body text |
| `12px` | Button labels, control labels |
| `11px` | Parameter values, small labels |
| `10px` | Upper-case labels (UPPERCASE) |
| `9px` | Badges, tiny labels |
| `8px` | Micro labels |

### Monospace

```css
font-family: monospace;
```

Used for:
- Numeric displays (BPM, step count)
- Parameter values
- Pitch labels (+12, -5)

---

## Spacing Scale

Based on 4px increments. These are conceptual guidelines — not CSS variables:

| Name | Value | Usage |
|------|-------|-------|
| xs | 4px | Icon gaps, tight spacing |
| sm | 8px | Between related elements |
| md | 12px | Button padding, card padding |
| lg | 16px | Section spacing |
| xl | 24px | Major section gaps |
| 2xl | 32px | Landing page sections |
| 3xl | 48px | Feature card gaps |

---

## Border Radius

Conceptual scale — values used directly in CSS, not as variables:

| Name | Value | Usage |
|------|-------|-------|
| xs | 2-3px | Badges, step cells, tiny elements |
| sm | 4px | Step cells (desktop) |
| md | 6px | Buttons, input fields |
| lg | 8px | Panels, track rows, thumbnails, step cells (mobile) |
| xl | 12px | Bottom sheets, large cards, containers |
| pill | 60px | CTA buttons |
| circle | 50% | Play button, avatars |

---

## Step Cell States

The step sequencer grid is the core interface:

| State | Background | Border | Notes |
|-------|------------|--------|-------|
| Inactive | `#2a2a2a` | `#3a3a3a` | Empty step |
| Inactive:hover | `#3a3a3a` | `#4a4a4a` | Hover feedback |
| Active | `#e85a30` | `#f07048` | Has a note |
| Active:hover | `#f07048` | + white glow | Editable hint |
| Playing | any | `#ffffff` 3px | Playhead position |
| Selected | any | `#4a9ece` | P-lock editing |
| Has P-lock | any | `#9b59b6` | Has parameter lock |
| Dimmed | 20% opacity | — | Beyond track length |
| Beat start | — | Left border `#4a4a4a` 3px | Every 4 steps |

---

## Animation Principles

### Timings

| Type | Duration | Easing |
|------|----------|--------|
| Micro-interaction | 100-150ms | `ease` |
| State change | 150-200ms | `ease` or `ease-out` |
| Hover transitions | 200ms | `ease` |
| Landing page entrance | 1000ms (1s) | `ease-out` |
| Staggered entrance | +200ms per item | `ease-out` |
| Exit | 200ms | `ease-in` |

### Landing Page Sequence

Staggered entrance for dramatic effect:

1. **0.0s** — Logo (scale + fade)
2. **0.2s** — Brand name (slide up)
3. **0.4s** — Tagline (slide up)
4. **0.6s** — CTA button (slide up)
5. **0.8s** — Features (slide up)
6. **1.0s** — Step demo (slide up)
7. **1.2s** — Examples section

### What Animates

**Do animate:**
- Entrance/exit of elements
- Hover states (subtle)
- Button press feedback
- Selection states
- Toast notifications
- Bottom sheet open/close

**Don't animate:**
- Playhead (causes flicker at high BPM)
- Step activation (too frequent)
- Parameter value changes

### Step Grid Demo

The landing page step grid animates at 150ms intervals, showing a beat pattern. Single row, 16 steps.

---

## Shadows

| Level | Shadow | Usage |
|-------|--------|-------|
| Subtle | `0 1px 2px rgba(0,0,0,0.2)` | Badges, small elevations |
| Card | `0 2px 8px rgba(0,0,0,0.3)` | Cards, dropdowns |
| Panel | `0 4px 12px rgba(0,0,0,0.3)` | Panels, popovers |
| Modal | `0 8px 32px rgba(0,0,0,0.5)` | Bottom sheets, modals |
| CTA | `0 4px 20px rgba(232, 90, 48, 0.4)` | Primary CTA button |

---

## Icon Language

Emoji are used sparingly for feature descriptions:

| Emoji | Meaning |
|-------|---------|
| 🎹 | Creation, sequencer |
| 👥 | Multiplayer, collaboration |
| 🔀 | Remix, fork |
| ▶ / ⏸ | Play / Pause |
| ● | Drum mode |
| ♪ | Chromatic mode |
| ↕ | Draggable control |
| → | Navigation, next |

---

## Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| Mobile | < 480px | Single column, larger touch targets (48px), horizontal scroll |
| Tablet | 480-768px | 2-column where appropriate, 44px touch targets |
| Desktop | > 768px | Full layout, 36px step cells, grid layouts |

### Mobile-Specific

- Minimum touch target: 44px (preferably 48px)
- Horizontal scroll for step grid
- Bottom sheets instead of dropdowns
- Transport bar visible (hidden on desktop)
- Scroll snap for step cells

---

## Accessibility

### Color Contrast

- Text on dark backgrounds: minimum 4.5:1 ratio
- Active steps: high contrast orange on near-black
- Disabled states: reduced opacity (0.4-0.5)

### Focus States

Components should support keyboard navigation with visible focus states:

```css
:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 2px;
}
```

**Status**: Not yet implemented globally. Individual components handle focus styling.

### Motion (Aspirational)

Respect `prefers-reduced-motion`:
- Disable staggered entrances
- Reduce animation durations
- Keep essential feedback (playhead)

**Status**: Not yet implemented. Future improvement.

---

## Grid Thumbnails

Session previews use a condensed step grid as "album art":

- 4 rows (tracks) × 16 columns (steps)
- Active steps: `#ff6b35`
- Inactive steps: `#2a2a2a`
- 2px gap between cells
- Background: `#1a1a1a`
- Border radius: 8px top, 0 bottom (card layout)

For tracks > 16 steps, condense using OR logic:
```
column[n] = steps[n*2] || steps[n*2+1]
```

---

## Dark Mode Only

Keyboardia is dark-mode only. No light theme planned.

Rationale:
- Studio/music software convention
- Better for low-light environments
- Reduces eye strain during extended sessions
- LEDs and active elements "glow" against dark

---

## Design Principles Summary

From UI-PHILOSOPHY.md:

1. **Controls live where they act** — Buttons on the thing they affect
2. **Visual feedback is immediate** — No confirmation dialogs
3. **Modes are visible, not hidden** — State is always shown
4. **Progressive disclosure through gesture** — Click vs Shift+click
5. **One screen, no navigation** — Everything visible at once

### The Test

For any new feature:
1. Can I see the effect immediately?
2. Is the control on or near the thing it affects?
3. Does it require mode switching or navigation?
4. Would this work on a device with no screen?
5. Can I discover it by experimenting?

---

## File Reference

### CSS Files
- `/app/src/index.css` — CSS variables, global tokens
- `/app/src/components/LandingPage/LandingPage.css` — Landing page styles
- `/app/src/components/StepCell.css` — Step sequencer cells
- `/app/src/components/EffectsPanel.css` — Effects panel
- `/app/src/components/TrackRow.css` — Track row layout
- `/app/src/components/TransportBar.css` — Mobile transport
- `/app/src/components/SamplePicker.css` — Instrument picker (uses `--category-color`)
- `/app/src/components/AvatarStack.css` — Multiplayer avatars

### TypeScript Files
- `/app/src/components/sample-constants.ts` — Instrument category colors
- `/app/src/utils/identity.ts` — Multiplayer identity colors (18-color palette)

---

## ✅ RESOLVED: Color System Unification (January 2026)

A color system unification effort (PR #28) migrated CSS files to use centralized variables from `index.css`. After visual review, **Option B (Implementation is Source of Truth)** was chosen.

### Resolution Summary

| Variable | Old Spec Value | New Value | Rationale |
|----------|----------------|-----------|-----------|
| `--color-success` | `#4abb8b` | `#1db954` | Spotify green - iconic, proven for success states on dark UIs |
| `--color-info` | `#4a9ece` | `#3498db` | Aliased to `--color-blue` for consistency |
| `--color-text-muted` | `0.5 opacity` | `0.6 opacity` | Better readability on dark backgrounds |

### Additional Variables Added

The implementation added useful variables for interactive states and muted variants:

| Variable | Hex | Purpose |
|----------|-----|---------|
| `--color-surface-hover` | `#333333` | Hover state for surface elements |
| `--color-surface-active` | `#444444` | Active/pressed state |
| `--color-border-hover` | `#555555` | Border hover state |
| `--color-text-dimmed` | `rgba(..., 0.38)` | Disabled/hint text |
| `--color-accent-muted` | `rgba(232,90,48, 0.2)` | Subtle accent backgrounds |
| `--color-*-muted` variants | Various | Background tints for all feature colors |

### Design Decision

The original guidance that some values "should remain as literal hex" has been superseded. Benefits of full tokenization:

1. **Single source of truth** in `index.css`
2. **Easier theming** if light mode is ever added
3. **Consistent naming** across components
4. **Simpler maintenance** — change once, update everywhere

### Files Migrated

- `App.css`, `InlineDrawer.css`, `BottomSheet.css`, `XYPad.css`
- `TransportBar.css`, `Waveform.css`, `ScaleSelector.css`, `AvatarStack.css`
- `StepCell.css` (partial — hover states, tie indicators)

### Files Retaining Hardcoded Values

Some files intentionally retain hardcoded values for isolation or distinct visual language:

- `QROverlay.css` — Local CSS variables for encapsulation
- `TrackRow.css` — Keyboard octave colors
- `ScaleSidebar.css` — Scale-specific colors
- `LandingPage.css` — Landing-specific values
