# Transport Control Group Specification

## Overview

The Transport Control Group is a unified set of three buttons (Unmute, FX, Mixer) positioned at the right side of the transport bar. All three buttons share consistent styling and behavior patterns.

```
┌────────────┬──────┬─────────┐
│ UNMUTE (2) │ FX ● │ MIXER ● │
└────────────┴──────┴─────────┘
```

## Design Principles

1. **Visual Unity**: All three buttons share the same base styling and appear as a single cohesive unit
2. **State Indication**: Each button shows its "active" state via a badge/indicator
3. **Consistent Interactions**: All buttons use the same hover, active, and disabled patterns
4. **Animation Parity**: Both panels (FX and Mixer) use identical expand/collapse animations

---

## Button Specifications

### Common Base Styling

All buttons use `.control-group-btn` class:

```css
.control-group-btn {
  height: 36px;
  padding: 0 14px;
  background: var(--color-surface-elevated);
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.control-group-btn:hover:not(:disabled) {
  background: var(--color-surface-active);
  color: var(--color-text);
}

.control-group-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

### Container Styling

```css
.transport-control-group {
  display: flex;
  gap: 1px;                              /* Creates visual divider */
  background: var(--color-border-hover); /* Divider color */
  border-radius: 8px;
  overflow: hidden;
  margin-left: auto;                     /* Push to right */
}
```

### Badge Styling

```css
.control-group-btn .btn-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;
  color: white;
}
```

---

## Individual Button Specifications

### 1. Unmute Button

**Purpose**: Unmute all muted tracks with a single click

**States**:
| State | Appearance | Enabled |
|-------|------------|---------|
| No tracks muted | `UNMUTE` (dim, no badge) | Disabled |
| N tracks muted | `UNMUTE (N)` (lit + red badge) | Enabled |

**Badge**:
- Content: Count of muted tracks
- Color: `var(--color-error)` (red)
- Only visible when count > 0

**Interaction**:
- Click: Unmutes all tracks immediately
- No panel association

**CSS Classes**: `.control-group-btn .unmute-btn`

---

### 2. FX Button

**Purpose**: Toggle FX panel visibility, show effects status

**States**:
| State | Appearance | Panel |
|-------|------------|-------|
| No effects active | `FX` (dim, no badge) | Closed |
| Effects active | `FX ●` (lit + green badge) | Any |
| Effects bypassed | `FX ⊗` (lit + orange badge) | Any |
| Panel open | Button highlighted | Open |

**Badge**:
- Content: `●` (active) or `⊗` (bypassed)
- Color: `var(--color-success)` (green) or `var(--color-warning)` (orange)
- Only visible when any effect wet > 0

**Interaction**:
- Click: Toggle FX panel open/closed
- No longer has split button with separate bypass action
- Bypass control moved inside FX panel

**CSS Classes**: `.control-group-btn .fx-btn`

---

### 3. Mixer Button

**Purpose**: Toggle Mixer panel visibility, show volume adjustment status

**States**:
| State | Appearance | Panel |
|-------|------------|-------|
| All tracks at 100% | `MIXER` (dim, no badge) | Closed |
| Volumes adjusted | `MIXER ●` (lit + accent badge) | Any |
| Panel open | Button highlighted | Open |

**Badge**:
- Content: `●` (indicator)
- Color: `var(--color-accent)` (orange)
- Visible when any track volume ≠ 100%

**Interaction**:
- Click: Toggle Mixer panel open/closed

**CSS Classes**: `.control-group-btn .mixer-btn`

---

## Panel Specifications

### Common Animation

Both FX and Mixer panels use the same expand/collapse animation:

```css
.panel-container {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease-out;
  overflow: hidden;
}

.panel-container.expanded {
  grid-template-rows: 1fr;
}

.panel-content {
  min-height: 0;
  overflow: hidden;
}
```

### FX Panel

**Location**: Rendered inside Transport component, below transport controls

**Layout**: 5-column grid
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  MASTER      REVERB         DELAY          CHORUS        DISTORTION         │
│  ┌───────┐   ┌───────┐                                                      │
│  │ ● ON  │   │  X Y  │      Mix ════●      Mix ════●     Mix ════●          │
│  │       │   │       │      Time [1/8▼]    Rate ═══●     Drive ══●          │
│  │bypass │   └───────┘      Fdbk ════●     Depth ══●                        │
│  └───────┘   Mix ════●                                                      │
│              Decay ══●                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Master Column**:
- First column in the grid
- Contains bypass toggle as a large button
- Shows "● ON" or "⊗ BYPASSED" state
- Click to toggle bypass

### Mixer Panel

**Location**: Rendered in place of track grid (replaces pattern view)

**Layout**: Horizontal strip of volume faders, one per track

**Behavior**:
- When Mixer is open, track pattern grid is hidden
- Button label changes: "Mixer" → "Pattern" (to return to pattern view)

---

## State Matrix

| Button | Default (dim) | Active State | Badge Color |
|--------|---------------|--------------|-------------|
| Unmute | 0 muted tracks | N tracks muted | `--color-error` |
| FX | No effects (all wet=0) | Any wet > 0 | `--color-success` / `--color-warning` |
| Mixer | All volumes = 100% | Any volume ≠ 100% | `--color-accent` |

---

## Consistency Checklist

- [x] All buttons use `.control-group-btn` base class
- [x] All buttons have same height (36px)
- [x] All buttons have same padding (0 14px)
- [x] All buttons use same disabled opacity (0.4)
- [x] All buttons use same hover background (`--color-surface-active`)
- [x] All badges use same dimensions (18px height)
- [x] All badges use same font-size (10px)
- [x] Both panels use grid-template-rows animation
- [x] Both panels use 0.25s ease-out timing
- [x] MixerPanel.css uses standard `--color-*` design tokens

---

## Implementation Tasks

### Phase 1: Simplify FX Button ✅
- [x] Remove split button structure (no more separate chevron)
- [x] Make FX button a simple toggle like Mixer
- [x] Move bypass toggle inside FX panel as first column

### Phase 2: Add Mixer Button Badge ✅
- [x] Calculate `hasAdjustedVolumes` (any track volume ≠ 100%)
- [x] Pass flag from StepSequencer to Transport
- [x] Display badge on Mixer button when true

### Phase 3: Unify Panel Animations ✅
- [x] Add expand/collapse animation to Mixer panel
- [x] Use same CSS pattern as FX panel
- [x] Ensure both panels have same timing (0.25s ease-out)

### Phase 4: CSS Consistency ✅
- [x] Unify disabled opacity to 0.4 across all buttons
- [x] Unify hover background to `--color-surface-active`
- [x] Update MixerPanel.css to use `--color-*` design tokens
- [x] Remove inline fallback values from MixerPanel.css

### Phase 5: FX Panel Bypass Column ✅
- [x] Add MASTER column as first item in FX panel grid
- [x] Style as large toggle button matching effect columns
- [x] Show clear ON/BYPASSED state

---

## File References

| File | Purpose |
|------|---------|
| `src/components/Transport.tsx` | Button group, FX panel |
| `src/components/Transport.css` | Button and FX panel styling |
| `src/components/StepSequencer.tsx` | Mixer panel rendering |
| `src/components/MixerPanel.tsx` | Mixer panel component |
| `src/components/MixerPanel.css` | Mixer panel styling |

---

## Version History

| Date | Changes |
|------|---------|
| 2026-01-01 | Initial specification based on consistency audit |
| 2026-01-01 | Implemented all 5 phases: simplified FX button, added Mixer badge, unified animations, CSS consistency, MASTER bypass column |
