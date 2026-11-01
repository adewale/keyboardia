# Mobile UI Patterns Research

## Teenage Engineering Design Philosophy

Research into mobile UI patterns inspired by Teenage Engineering products (OP-1, OP-Z, EP-133) for Keyboardia's mobile experience.

### Core Principles from TE

1. **Single-screen focus**: Each mode shows only what's needed, no tabs or navigation hierarchies
2. **Hardware-first thinking**: UI designed as if physical buttons exist
3. **Immediate feedback**: Every action has instant visual/audio response
4. **Constraint as feature**: Limited options prevent paralysis of choice
5. **Playful aesthetics**: Bold colors, pixel fonts, retro charm

---

## Recommended Mobile Patterns

### 1. Single-Track Focus Mode

Instead of showing all tracks at once (overwhelming on mobile), show one track in full detail:

```
┌─────────────────────────────────┐
│  ← Track 3: Kick Drum →         │  (swipe to change track)
├─────────────────────────────────┤
│                                 │
│  ○ ● ○ ○ │ ● ○ ○ ● │ ...       │  (step grid, larger cells)
│                                 │
├─────────────────────────────────┤
│  [Vol] [Pitch] [Sample]         │  (parameter controls)
│                                 │
│  ──────●────────────            │  (slider for selected param)
│                                 │
├─────────────────────────────────┤
│  [Solo] [Mute] [Copy] [Clear]   │  (track actions)
└─────────────────────────────────┘
```

**Benefits:**
- Large touch targets
- Full parameter access
- No pinch/zoom needed
- Swipe-based navigation (like OP-Z encoder)

### 2. Bottom Sheet Navigation

Use bottom sheets for contextual actions instead of modals:

```
┌─────────────────────────────────┐
│  Main sequencer view            │
│                                 │
│                                 │
├─────────────────────────────────┤
│  ═══════════════════            │  (drag handle)
│  Sample Picker                  │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │ 🥁│ │ 🎹│ │ 🔔│ │ 🎸│       │
│  │kick│ │bass│ │hat│ │snr│       │
│  └───┘ └───┘ └───┘ └───┘       │
└─────────────────────────────────┘
```

**Implementation:**
- Partial reveal shows 2-3 items
- Full drag reveals all options
- Tap outside to dismiss
- Matches iOS/Android native patterns

### 3. Portrait-First Layout

Design for one-handed use:

```
Portrait (Primary):              Landscape (Secondary):
┌──────────┐                     ┌────────────────────────┐
│ Controls │                     │ Track │    Grid       │
├──────────┤                     │  List │ ○ ● ○ ○ ● ... │
│   Grid   │                     │  [1]  │               │
│ (compact)│                     │  [2]  │    Controls   │
├──────────┤                     │  [3]  │               │
│  Tracks  │                     └────────────────────────┘
└──────────┘
```

### 4. Gesture-Based Interactions

Inspired by TE's physical interfaces:

| Gesture | Action |
|---------|--------|
| Tap cell | Toggle step |
| Long-press cell | Parameter lock editor |
| Swipe track left | Mute |
| Swipe track right | Solo |
| Pinch grid | Zoom to 8/16/32 steps |
| Two-finger rotate | Adjust tempo |
| Shake device | Clear pattern (with confirm) |

### 5. Haptic Feedback Map

Essential for non-visual feedback:

```typescript
const HAPTICS = {
  stepToggleOn: { type: 'impact', style: 'medium' },
  stepToggleOff: { type: 'impact', style: 'light' },
  beatMarker: { type: 'impact', style: 'light' },  // On steps 0, 4, 8, 12
  parameterLock: { type: 'selection' },
  trackSwitch: { type: 'selection' },
  mute: { type: 'notification', style: 'warning' },
  solo: { type: 'notification', style: 'success' },
  playStart: { type: 'notification', style: 'success' },
  playStop: { type: 'notification', style: 'warning' },
};
```

### 6. Compact Transport Bar

Fixed at bottom, always accessible:

```
┌─────────────────────────────────────┐
│ ▶/■ │ 120 BPM │ ─●── │ 4/16 │ 👥3  │
│     │         │swing │ step │ live │
└─────────────────────────────────────┘
```

- **Play/Stop**: Large, left-aligned for thumb access
- **Tempo**: Tap to edit, drag to fine-tune
- **Swing**: Mini slider
- **Step indicator**: Current position
- **Players**: Connection status

---

## OP-Z Specific Inspirations

### Screen Modes (via swipe)

The OP-Z has multiple "screens" accessed by button combos. For mobile:

```
← Swipe left/right between modes →

[Pattern] ↔ [Track] ↔ [Mixer] ↔ [FX]
```

Each mode is a distinct, focused view:

1. **Pattern Mode**: Overview of all tracks (compact)
2. **Track Mode**: Single track focus (detailed)
3. **Mixer Mode**: All faders/volumes
4. **FX Mode**: Global effects (future)

### Color Language

TE uses consistent color coding:

```css
:root {
  /* TE-inspired palette */
  --te-yellow: #FFE135;   /* Active/Selected */
  --te-green: #00FF00;    /* Playing */
  --te-red: #FF3B30;      /* Muted/Alert */
  --te-blue: #007AFF;     /* Info/Link */
  --te-gray: #8E8E93;     /* Inactive */
  --te-black: #1C1C1E;    /* Background */
}
```

### LED-Style Indicators

Use dot-based indicators like hardware:

```
Playing: ● ● ● ○ ○ ○ ○ ○  (LEDs showing position)
Volume:  ▪ ▪ ▪ ▪ ▪ ▫ ▫ ▫  (8-segment display)
Steps:   ◆ ◇ ◇ ◇ │ ◇ ◆ ◇ ◇ │ ...
```

---

## Chrome Music Lab Patterns

Simpler UI for accessibility:

1. **One-tap operation**: Everything works with single tap
2. **No menus**: All actions visible on screen
3. **Auto-play on interaction**: Start making sound immediately
4. **Visual sound feedback**: See the sound as you make it
5. **Mobile-native sharing**: Share button prominent

---

## Implementation Recommendations

### Phase 1: Responsive Foundation
- CSS Grid/Flexbox responsive layout
- Touch target minimum 44px
- Viewport meta tag for mobile
- Disable zoom on inputs

### Phase 2: Single-Track Focus
- Swipe-based track navigation
- Larger step cells for mobile
- Bottom-anchored transport

### Phase 3: Gesture Enhancement
- Add swipe for mute/solo
- Long-press for parameter locks
- Haptic feedback integration

### Phase 4: Native Feel
- Bottom sheet sample picker
- Pull-to-refresh sessions
- System dark mode support
- PWA manifest for home screen

---

## Technical Considerations

### Touch Event Handling

```typescript
// Prevent double-tap zoom while allowing taps
const handleTouchStart = (e: TouchEvent) => {
  if (e.touches.length > 1) return; // Allow pinch
  e.preventDefault();
  // Handle tap
};

// Use passive listeners for scroll
element.addEventListener('scroll', handler, { passive: true });
```

### Performance on Mobile

1. **Reduce repaints**: Use CSS transforms for animations
2. **Virtualize long lists**: Only render visible tracks
3. **Debounce rapid taps**: Prevent double-toggles
4. **Reduce WebSocket messages**: Batch cursor updates

### Offline Support

```typescript
// Service worker for offline use
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
```

---

## Reference Links

- [Teenage Engineering OP-Z Guide](https://teenage.engineering/guides/op-z)
- [Chrome Music Lab](https://musiclab.chromeexperiments.com/)
- [Apple Human Interface Guidelines - Touch](https://developer.apple.com/design/human-interface-guidelines/inputs/touchscreen-gestures/)
- [Material Design Touch Targets](https://material.io/design/usability/accessibility.html#layout-and-typography)
- [Web.dev Touch Events](https://web.dev/mobile-touch/)

---

## Summary

The key insight from Teenage Engineering is that **constraints breed creativity**. Rather than trying to cram the desktop experience onto mobile, Keyboardia should embrace mobile's unique affordances:

1. **Focus over features**: Show one thing at a time
2. **Touch over mouse**: Design for fingers, not cursors
3. **Motion over modals**: Gestures and swipes over dialogs
4. **Sound over sight**: Haptic/audio feedback as primary
5. **Sessions over files**: URLs and links, not file management

The goal is to make Keyboardia feel like a **native music toy**, not a shrunken web app.
