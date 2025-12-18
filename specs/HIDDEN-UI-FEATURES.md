# Hidden UI Features Specification

> **Status:** Specification for Phase 24 (Hidden Feature UI Exposure)
> **Context:** These features are fully implemented in the audio engine but lack UI exposure.

## Overview

A Phase 22 codebase audit identified three significant features that are implemented but completely hidden from users:

| Feature | Engine Implementation | Lines | UI Status |
|---------|----------------------|-------|-----------|
| XY Pad | `xyPad.ts` | 371 | No UI component |
| Playback Mode | `types.ts`, `engine.ts` | — | Hardcoded to `oneshot` |
| Effects Master Bypass | `toneEffects.ts` | — | `setEnabled()` not exposed |

This spec defines how to expose these features while maintaining alignment with Keyboardia's UI philosophy.

---

## UI Philosophy Alignment

Keyboardia's UI philosophy (derived from the FX Panel pattern):

1. **Controls live where they act** — No modal dialogs; controls appear inline
2. **Progressive disclosure** — Simple by default, power features behind expandable sections
3. **Visual feedback is immediate** — Changes are reflected instantly
4. **Indicators show active state** — Dot/badge when feature is engaged
5. **No confirmation dialogs** — Direct manipulation, undo via reset

---

## 1. XY Pad UI

### Current State

The `XYPadController` class (371 lines) provides:
- 2D control surface mapping X/Y to synth parameters
- 6 presets: Filter Sweep, LFO Control, Envelope Shape, Space Control, Delay Modulation, Oscillator + Filter
- Linear and exponential curve support
- Multiplayer-syncable state (`getState()` / `applyState()`)

### Proposed UI

#### Location

Below the Effects Panel in Transport, using the same expand/collapse pattern:

```
[Play] [Stop] [120 BPM ▾] [Swing: 25%]         [FX]
                                              [XY] ← New toggle
─────────────────────────────────────────────────────
│ [Filter Sweep ▾]        │  Parameter readouts     │
│ ┌─────────────────────┐ │  X: Filter    2.4kHz   │
│ │                     │ │  Y: Resonance 8.2      │
│ │        ●────────────│ │                        │
│ │                     │ │  [Reset]               │
│ └─────────────────────┘ │                        │
─────────────────────────────────────────────────────
```

#### Interaction

| Action | Result |
|--------|--------|
| Click XY toggle | Expand/collapse XY pad panel |
| Drag in pad area | Update X/Y position, apply to mapped parameters |
| Select preset | Load new parameter mappings |
| Click Reset | Return to center (0.5, 0.5) |
| Touch (mobile) | Same as drag with touch events |

#### Component Structure

```typescript
// src/components/XYPadPanel.tsx
interface XYPadPanelProps {
  onStateChange?: (state: XYPadState) => void;
  initialState?: XYPadState;
  disabled?: boolean;
}
```

#### Multiplayer Sync

XY pad state must sync like effects state:
- Include in session state: `{ effects: EffectsState, xyPad: XYPadState }`
- Broadcast on change: `{ type: 'xy_pad_change', state: XYPadState }`
- Apply on receive: Update local controller + UI

#### CSS Classes

Follow FX panel naming:
```css
.xy-pad-panel { }
.xy-pad-toggle { }
.xy-pad-toggle.expanded { }
.xy-pad-toggle.active { } /* When position != center */
.xy-pad-container { }
.xy-pad-surface { }
.xy-pad-cursor { }
.xy-pad-preset-select { }
.xy-pad-param-readout { }
```

---

## 2. Playback Mode

### Current State

The `PlaybackMode` type exists with two values:
- `'oneshot'` — Sample plays to completion (current default, always used)
- `'gate'` — Sample cuts at step boundary

The scheduler passes `playbackMode` to `audioEngine.playSample()`, but:
- All tracks are created with `playbackMode: 'oneshot'`
- No UI allows changing this

### Proposed UI

#### Location

In TrackRow controls, as a per-track toggle:

```
[M] [S] Lead ♪ [●][●][○][●]... [16 ▾] [⏸] ← New toggle
                                      ↑
                               Playback mode toggle
```

#### Visual Design

| Icon | Mode | Tooltip |
|------|------|---------|
| `⏵` | oneshot | "One-shot: Sample plays fully" |
| `⏸` | gate | "Gate: Sample cuts at step end" |

The icon reflects current mode; clicking toggles to the other.

#### When Gate Mode Matters

Gate mode is most useful for:
- Sustained synth pads (avoid overlapping tails)
- Drones and ambient textures
- Tight rhythmic gating effects
- Sidechain-style pumping

For drums and percussive samples, one-shot is preferred (and remains default).

#### Implementation

```typescript
// In grid reducer
case 'SET_PLAYBACK_MODE':
  return updateTrack(state, action.trackId, {
    playbackMode: action.mode
  });

// In TrackRow.tsx
<button
  className={`playback-mode-toggle ${track.playbackMode}`}
  onClick={() => dispatch({
    type: 'SET_PLAYBACK_MODE',
    trackId: track.id,
    mode: track.playbackMode === 'oneshot' ? 'gate' : 'oneshot'
  })}
  title={track.playbackMode === 'oneshot'
    ? 'One-shot: Sample plays fully (click to switch to gate)'
    : 'Gate: Sample cuts at step end (click to switch to one-shot)'}
>
  {track.playbackMode === 'oneshot' ? '⏵' : '⏸'}
</button>
```

#### Multiplayer Sync

Already supported — `playbackMode` is part of `Track` interface and persisted.

---

## 3. Effects Master Bypass

### Current State

`ToneEffectsChain.setEnabled(boolean)` exists and:
- Saves current wet values
- Sets all wet to 0 (bypass)
- Restores saved values on re-enable

But there's no UI to call it.

### Proposed UI

#### Location

As part of the FX toggle button itself:

```
[FX] ← Single click: expand panel
      Long press / right-click: toggle bypass

[FX] ← Normal (effects processing)
[FX̶] ← Bypassed (strikethrough or dimmed)
```

#### Alternative: Dedicated Button

If long-press feels too hidden:

```
[FX] [⏻] ← Bypass toggle next to FX button
```

#### Visual States

| State | Appearance |
|-------|------------|
| Enabled, effects active | `FX` with indicator dot |
| Enabled, effects dry | `FX` without indicator dot |
| Bypassed | `FX` dimmed/strikethrough, no indicator |

#### Implementation

```typescript
// In EffectsPanel.tsx or Transport.tsx
const [isBypassed, setIsBypassed] = useState(false);

const handleBypassToggle = useCallback(() => {
  const newBypassed = !isBypassed;
  setIsBypassed(newBypassed);
  audioEngine.setEffectsEnabled(!newBypassed);
  onBypassChange?.(newBypassed);
}, [isBypassed, onBypassChange]);
```

#### Use Case

Effects bypass is useful for:
- A/B comparison (hear dry vs wet)
- Performance optimization (disable effects temporarily)
- Troubleshooting (isolate audio issues)

#### Multiplayer Sync

Effects bypass should sync (everyone hears the same):
- Include in session state: `{ effectsBypass: boolean }`
- Broadcast: `{ type: 'effects_bypass', bypassed: boolean }`

---

## Implementation Priority

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| Playback Mode toggle | High | Low | Medium (enables gate-style playback) |
| Effects Master Bypass | High | Low | High (A/B comparison, troubleshooting) |
| XY Pad UI | Medium | Medium | High (expressive performance control) |

Recommended order:
1. Effects Master Bypass (quick win, high utility)
2. Playback Mode toggle (simple, already syncs)
3. XY Pad UI (more complex, bigger visual addition)

---

## Testing Requirements

### Unit Tests

- XY Pad: Position updates, preset loading, state serialization
- Playback Mode: Toggle dispatch, persistence, sync messages
- Effects Bypass: Enable/disable, wet value preservation

### Integration Tests

- Multiplayer: XY pad state syncs between clients
- Multiplayer: Bypass state syncs between clients
- Session persistence: All new state fields save/load correctly

### Manual Testing

- XY Pad: Drag interaction feels responsive (< 16ms update)
- Mobile: Touch events work on XY pad surface
- Accessibility: Keyboard navigation for all new controls

---

## Files to Create/Modify

### New Files

```
src/components/XYPadPanel.tsx
src/components/XYPadPanel.css
src/components/XYPadPanel.test.tsx
```

### Modified Files

```
src/components/Transport.tsx      # Add XY toggle, bypass button
src/components/Transport.css      # Styles for new controls
src/components/EffectsPanel.tsx   # Optional: bypass integration
src/components/TrackRow.tsx       # Add playback mode toggle
src/components/TrackRow.css       # Playback mode button styles
src/state/grid.ts                 # SET_PLAYBACK_MODE action
src/sync/multiplayer.ts           # New message types
src/worker/live-session.ts        # Handle new messages
```

---

## Appendix: XY Pad Presets Reference

From `xyPad.ts`:

| Preset ID | Name | X Parameter | Y Parameter |
|-----------|------|-------------|-------------|
| `filter-sweep` | Filter Sweep | Filter Frequency (100-8kHz) | Filter Resonance (0.5-15) |
| `lfo-control` | LFO Control | LFO Rate (0.1-10Hz) | LFO Amount (0-1) |
| `envelope-shape` | Envelope Shape | Attack (0.001-1s) | Release (0.05-2s) |
| `space-control` | Space Control | Reverb Wet (0-80%) | Delay Wet (0-60%) |
| `delay-modulation` | Delay Modulation | Delay Wet (0-70%) | Delay Feedback (0-85%) |
| `oscillator-filter` | Oscillator + Filter | Osc Mix (0-1) | Filter Frequency (200-6kHz) |
