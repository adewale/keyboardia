# Keyboardia Favicon

The favicon is a 32×32 SVG representing a 4×4 step sequencer grid with a classic drum pattern.

**Date:** December 2025
**Version:** 1.0.0

---

## The Design

```
┌██┬██┬██┬██┐   Row 1: Hi-Hat (steady 8ths)
├──┼██┼──┼██┤   Row 2: Snare (backbeat on 2 & 4)
├──┼──┼──┼──┤   Row 3: Silent (breathing room)
├██┼──┼██┼──┤   Row 4: Kick (beats 1 & 3)
└──┴──┴──┴──┘

██ = Active step (accent gradient #f07048 → #e85a30)
── = Inactive step (#3a3a3a)
```

**In Keyboardia notation:**
```
HiHat: x-x-x-x-x-x-x-x-
Snare: ----x-------x---
Tom:   ----------------
Kick:  x-------x-------
```

**What it sounds like:** `BOOM-tss-CRACK-tss-BOOM-tss-CRACK-tss`

---

## Design Decision

### Two Alternatives Were Considered

#### Option A: Experimental/IDM Pattern (Rejected)

```
┌──┬██┬──┬██┐   HiHat: ----x-------x---
├██┼──┼██┼──┤   Snare: x-------x-------  ← Inverted backbeat
├──┼██┼──┼──┤   Tom:   ----x-----------
├██┼──┼──┼██┤   Kick:  x-----------x---  ← Syncopated
└──┴──┴──┴──┘
```

**Character:** Unusual, march-like, experimental. The snare on beats 1 & 3 (instead of 2 & 4) creates an inverted backbeat that sounds "wrong" to ears trained on Western pop music.

**Sound:** `BOOM-crack...tss-tok...CRACK...tss-boom`

**Pros:**
- Memorable and distinctive
- Suggests polyrhythmic experimentation
- Asymmetric visual interest

**Cons:**
- Not immediately recognizable as a drum beat
- Requires musical knowledge to appreciate
- Could confuse new users about what the app does

#### Option B: Classic Groove (Chosen)

```
┌██┬██┬██┬██┐   HiHat: x-x-x-x-x-x-x-x-
├──┼██┼──┼██┤   Snare: ----x-------x---  ← Classic backbeat
├──┼──┼──┼──┤   Tom:   ----------------
├██┼──┼██┼──┤   Kick:  x-------x-------  ← Foundation
└──┴──┴──┴──┘
```

**Character:** Universal, instantly groovy, the foundation of rock/pop/dance music worldwide.

**Sound:** `BOOM-tss-CRACK-tss-BOOM-tss-CRACK-tss`

**Pros:**
- Immediately recognizable as "a drum beat"
- Self-evident — no explanation needed
- Matches the product's accessibility focus

**Cons:**
- Generic (this is every basic beat ever)
- Less distinctive in a sea of music app icons

---

## Why Classic Groove Won

The decision aligns with Keyboardia's core principles:

### 1. Immediate Recognition (UI Philosophy)

From [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md):

> **Visual Feedback Is Immediate** — Twist a knob, see the LED respond.

The favicon should communicate "step sequencer" and "drum beat" at a glance. The classic groove pattern is universally understood — even non-musicians recognize it as a rhythm. The experimental pattern requires analysis to understand.

### 2. Self-Evident Design (UI Philosophy)

From [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md):

> **Tooltips as primary documentation** — UI should be self-evident.

A favicon is the smallest piece of UI. If it requires explanation, it has failed. The classic groove needs no explanation; anyone who has heard music recognizes the kick-snare relationship.

### 3. Accessibility First (Design Philosophy)

From [SPEC.md](./SPEC.md):

> **Grid-based simplicity** — Click cells to toggle sounds, no musical knowledge required.

Keyboardia targets casual users who may never have used a DAW. The favicon should welcome them, not intimidate them with avant-garde rhythms. A recognizable beat says "you can make music here."

### 4. The Five-Second Test

When someone sees the favicon in a browser tab, they should think:

| Pattern | Reaction |
|---------|----------|
| Experimental | "What is that grid?" |
| Classic Groove | "Oh, that's a drum beat!" |

The classic groove passes the test. The experimental pattern makes people think — which is interesting but not the goal of a favicon.

---

## Technical Specification

### File Location
```
app/public/keyboardia.svg
```

### HTML Reference
```html
<link rel="icon" type="image/svg+xml" href="/keyboardia.svg" />
```

### SVG Structure

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- Gradient for active steps -->
  <defs>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f07048" />
      <stop offset="100%" style="stop-color:#e85a30" />
    </linearGradient>
  </defs>

  <!-- Dark rounded background -->
  <rect width="32" height="32" rx="6" fill="#1e1e1e"/>

  <!-- 4×4 grid of 5×5 cells with 1.5px gaps -->
  <!-- Active cells use url(#glow), inactive use #3a3a3a -->
</svg>
```

### Color Palette

| Element | Color | Source |
|---------|-------|--------|
| Background | `#1e1e1e` | `--color-surface` from index.css |
| Inactive step | `#3a3a3a` | `--color-border` from index.css |
| Active step (light) | `#f07048` | `--color-accent-light` from index.css |
| Active step (dark) | `#e85a30` | `--color-accent` from index.css |

### Grid Geometry

```
Viewbox: 32×32
Cell size: 5×5
Gap: 1.5px
Padding: 4px (left/top), 3.5px (right/bottom)
Corner radius: 6px (background), 1px (cells)

Cell positions:
  x: 4, 10.5, 17, 23.5
  y: 4, 10.5, 17, 23.5
```

---

## Pattern as Data

For testing or programmatic generation, here's the pattern in various formats:

### Boolean Grid (Row-major)
```javascript
const pattern = [
  [true,  true,  true,  true ],  // HiHat: all on
  [false, true,  false, true ],  // Snare: 2, 4
  [false, false, false, false],  // Tom: silent
  [true,  false, true,  false],  // Kick: 1, 3
];
```

### Keyboardia JSON
```json
{
  "tracks": [
    {"name": "Hi-Hat", "sampleId": "hihat", "steps": [true,false,true,false,true,false,true,false,true,false,true,false,true,false,true,false]},
    {"name": "Snare", "sampleId": "snare", "steps": [false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false]},
    {"name": "Tom", "sampleId": "tom", "steps": [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]},
    {"name": "Kick", "sampleId": "kick", "steps": [true,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false]}
  ],
  "tempo": 120,
  "swing": 0
}
```

### Binary / Hex
```
HiHat: 1111 = 0xF
Snare: 0101 = 0x5
Tom:   0000 = 0x0
Kick:  1010 = 0xA
```

---

## Future Considerations

### Animated Favicon
Could animate the playhead moving across the grid when audio is playing. Browser support is limited but improving.

### Dark/Light Mode
Current design uses dark background, matching the app's dark theme. If a light theme is added, consider a variant with `#ffffff` background.

### Apple Touch Icon
The SVG works at any size, but consider a dedicated 180×180 PNG for iOS home screen with more detail or wordmark.

### PWA Manifest
When adding PWA support, include multiple icon sizes:
```json
{
  "icons": [
    {"src": "/keyboardia.svg", "type": "image/svg+xml"},
    {"src": "/keyboardia-192.png", "sizes": "192x192"},
    {"src": "/keyboardia-512.png", "sizes": "512x512"}
  ]
}
```

---

## References

- [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md) — Core design principles
- [SPEC.md](./SPEC.md) — Product vision and design philosophy
- [SESSION-NOTATION-RESEARCH.md](./research/SESSION-NOTATION-RESEARCH.md) — Pattern notation format
- [index.css](../app/src/index.css) — Color palette source

---

*The favicon is the smallest expression of Keyboardia's identity: a step sequencer that makes music accessible to everyone. The classic groove pattern embodies this by being instantly recognizable — no explanation required.*
