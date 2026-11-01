# Chromatic Grid Redesign

## Problem Statement

The current ChromaticGrid shows only 13 "key interval" pitch rows (0, ±5, ±7, ±12, ±17, ±19, ±24). However, users can set any pitch from -24 to +24 via the pitch slider in ParameterLockEditor. This creates a UX problem where notes exist but are invisible in the grid.

Example: Session 592c0308-b786-49d8-a4f9-d451cbda7b3d has Piano 2 with pitches at -8, -9, -10, -11, which don't appear in the grid (it jumps from -7 to -12).

## Solution: Segmented Control with Two View Modes

### UI Design

```
┌─────────────────────────────────────────────────────────────────────┐
│ CHROMATIC GRID HEADER - Segmented Control                           │
│                                                                     │
│  ┌─────────────────────────┐  ┌─────────────┐                      │
│  │ Events ││ All │         │  │ 🎵 C Major │                      │
│  └─────────────────────────┘  └─────────────┘                      │
│     ▲         ▲                Scale Lock                           │
│     │         │                (existing)                           │
│     │         └── All 49 chromatic pitches                          │
│     └─────────── Key intervals + pitches with events (default)      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### View Modes

#### Mode 1: "Events" (Default - Dynamic rows)
- Shows key intervals (0, ±5, ±7, ±12, ±17, ±19, ±24) PLUS any pitches that have notes
- Typically 13-20 rows depending on content
- Matches Cubase's "Show Pitches with Events" feature
- Solves the invisible pitch problem

#### Mode 2: "All" (Full Chromatic - 49 rows)
- Shows all pitches from -24 to +24
- Visual hierarchy via CSS opacity:
  - ROOT (0): Brightest, highlighted background
  - OCTAVES (±12, ±24): Strong visual weight
  - FIFTHS/FOURTHS (±5, ±7, ±17, ±19): Medium weight
  - CHROMATIC (all others): Dimmed, 50% opacity
- Requires vertical scrolling on most screens

### Scale Lock Interaction

Scale Lock works orthogonally with view modes. **Guardrail #1 applies in ALL modes**: pitches with events are always shown.

| Mode | Scale Lock OFF | Scale Lock ON |
|------|----------------|---------------|
| Events | Key intervals + used pitches | (Key intervals ∩ scale) + used pitches* |
| All | All 49 pitches | All scale pitches (~7 per octave) + used pitches* |

*\*used pitches = pitches that have notes, shown regardless of scale (guardrail #1)*

### Guardrails (Cubase-inspired)

1. **Never hide notes**: If a pitch has events, always show it even if:
   - It's not a key interval (this was the bug in the original design)
   - It's outside the selected scale (in Scale Lock mode)

2. **Never show empty grid**: If filtering would result in 0 rows:
   - Fall back to showing all in-scale pitches (if Scale Lock on)
   - Fall back to showing key intervals (if Scale Lock off)

3. **Visual warning for out-of-scale notes**: When Scale Lock is on and notes exist outside the scale, show those rows with `--color-yellow` (not orange, which conflicts with selected state styling) to indicate "these notes don't fit your selected scale"

### Algorithm

```javascript
function getVisiblePitchRows(mode, scale, track) {
  const KEY_INTERVALS = [24, 19, 17, 12, 7, 5, 0, -5, -7, -12, -17, -19, -24];
  const ALL_PITCHES = Array.from({length: 49}, (_, i) => 24 - i);

  // Get pitches that have events
  const usedPitches = new Set();
  track.parameterLocks.forEach((lock, i) => {
    if (track.steps[i] && lock?.pitch !== undefined) {
      usedPitches.add(lock.pitch);
    }
  });
  // Include pitch 0 for steps without pitch locks
  track.steps.forEach((active, i) => {
    if (active && !track.parameterLocks[i]?.pitch) {
      usedPitches.add(0);
    }
  });

  let rows;

  switch (mode) {
    case 'events':
      // Key intervals + any pitches with notes (GUARDRAIL #1)
      rows = [...new Set([...KEY_INTERVALS, ...usedPitches])];
      rows.sort((a, b) => b - a);
      break;

    case 'all':
      rows = ALL_PITCHES;
      break;
  }

  // Apply scale lock filter (uses scale.root and scale.scaleId per existing API)
  if (scale?.locked) {
    const inScaleRows = rows.filter(p => isInScale(p, scale.root, scale.scaleId));
    const usedOutOfScale = [...usedPitches].filter(p =>
      !isInScale(p, scale.root, scale.scaleId)
    );

    // GUARDRAIL #1: Always show rows with events, even if out of scale
    rows = [...new Set([...inScaleRows, ...usedOutOfScale])];
    rows.sort((a, b) => b - a);

    // GUARDRAIL #2: If empty, show all in-scale pitches
    if (rows.length === 0) {
      rows = ALL_PITCHES.filter(p => isInScale(p, scale.root, scale.scaleId));
    }
  }

  return rows;
}
```

### Mobile Layout

```
┌─────────────────────────┐
│ ┌─────────┬─────────┐   │
│ │ Events  │   All   │   │
│ └─────────┴─────────┘   │
│ ┌───────────────────┐   │
│ │ 🎵 Scale: C Major │   │
│ └───────────────────┘   │
└─────────────────────────┘
```

Segmented control stacks above scale lock on narrow viewports.

### Files to Modify

1. `src/components/ChromaticGrid.tsx` - Add view mode state and logic
2. `src/components/ChromaticGrid.css` - Add segmented control styles, tier styling for "All" mode
3. Possibly `src/types.ts` - If persisting view mode preference

### Industry Precedent

- **Cubase/Nuendo**: "Show Pitches with Events" option (best implementation)
- **Ableton Live**: "Fold" button
- **Logic Pro**: "Collapse Mode" button
- **Reaper**: "Hide unused" mode

All major DAWs provide a way to show only pitches with events. This plan follows that pattern with "Events" mode as the default, while "All" mode provides full chromatic visibility.

### Tooltips

#### Mode Button Tooltips
Each segment in the control should have a tooltip explaining its function:

| Mode | Tooltip Text |
|------|-------------|
| Events | "Show key intervals plus pitches with notes" |
| All | "Show all 49 chromatic pitches (-24 to +24)" |

#### Out-of-Scale Warning Notification
When Scale Lock is enabled and notes exist outside the selected scale, show a toast notification:

```
"3 notes are outside C Major scale. They're shown with a yellow indicator."
```

This follows the Cubase pattern of never silently hiding user data. Since guardrail #1 ensures notes are never hidden, the notification explains WHY certain rows appear highlighted rather than warning about hidden content.

### CSS Component Specification

Follow existing Keyboardia design system (see `index.css` for all CSS variables):

```css
/* Segmented control container - matches expand-toggle pattern */
.chromatic-view-mode-control {
  display: flex;
  gap: 0;
  border-radius: 3px;
  background: var(--color-surface-elevated);
  padding: 2px;
}

/* Individual segment buttons - matches expand-toggle sizing */
.chromatic-view-mode-control__button {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.chromatic-view-mode-control__button:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

/* Active state uses cyan to match expand-toggle.expanded pattern */
.chromatic-view-mode-control__button--active {
  background: var(--color-cyan-muted);
  border-color: var(--color-cyan);
  color: var(--color-cyan);
}

/* Pitch row visual hierarchy for "All" mode */
/* Root row - matches existing .chromatic-row.root pattern */
.chromatic-row--root {
  background: var(--color-blue-muted);
}

.chromatic-row--octave {
  opacity: 1;
}

/* Fifth/fourth - matches existing .chromatic-row.fifth pattern */
.chromatic-row--fifth,
.chromatic-row--fourth {
  background: var(--color-purple-muted);
  opacity: 0.85;
}

.chromatic-row--chromatic {
  opacity: 0.5;
}

/* Out-of-scale warning - uses yellow (same as pitch-shift-fair warnings) */
/* Note: orange is reserved for active notes (.chromatic-cell.note) */
.chromatic-row--out-of-scale {
  background: var(--color-yellow-muted);
  border-left: 3px solid var(--color-yellow);
}
```

**Design System Alignment Notes:**
- Uses `--color-cyan` for active toggle (consistent with `.expand-toggle.expanded`)
- Uses `--color-blue-muted` for root rows (consistent with existing `.chromatic-row.root`)
- Uses `--color-purple-muted` for fifths/fourths (consistent with existing `.chromatic-row.fifth`)
- Uses `--color-yellow` for warnings (consistent with `.chromatic-cell.note.pitch-shift-fair`)
- Avoids `--color-orange` for warnings since it's used for active notes

### Open Questions

1. Should the view mode preference persist per-track, per-session, or globally?
2. Should we add a keyboard shortcut to toggle between modes?

---

Created: 2026-01-18
Updated: 2026-01-18
Status: Draft - Audited for internal consistency and design system alignment
