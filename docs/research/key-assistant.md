# Research: Key Assistant

## The Core Insight

> "The most successful musical systems don't ask 'how do we show all the scale options?' They ask **'how do we make it impossible to sound bad?'**"

This document explores how to implement a Key Assistant feature that combines **intelligent constraint** with **clear visualization**—aligned with Keyboardia's OP-Z-inspired UI philosophy.

---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Two-Part Solution](#the-two-part-solution)
3. [How Constraint and Visualization Complement Each Other](#how-constraint-and-visualization-complement-each-other)
4. [Prior Art: Constraint + Visualization Together](#prior-art-constraint--visualization-together)
5. [Real-World Precedents](#real-world-precedents)
6. [Multiplayer Patterns](#multiplayer-patterns)
7. [Design Aligned with UI Philosophy](#design-aligned-with-ui-philosophy)
8. [Implementation Concepts](#implementation-concepts)
9. [References](#references)

---

## The Problem

### What Users Say
> "A vertical key scale that expands out to the right of the tracks could be a cool way to visualize the pitches + keys."

### What Users Mean
- "I want to **see** what scale we're in"
- "I want to **see** which notes are being used"
- "I don't want to hit wrong notes"
- "In multiplayer, I want to know what's happening harmonically"

### The Generativity Angle
> "Scale Lock: Constrain all notes to a scale (C major, A minor pentatonic). Now random selection always sounds good. Removes fear of wrong notes. Enables exploration."

**Both needs are valid.** Users want to:
1. **See** the harmonic space (visualization)
2. **Stay safe** within it (constraint)

---

## The Two-Part Solution

### Part 1: Scale Lock (Constraint)
> **Make it impossible to sound bad.**

Constrain the ChromaticGrid to only show in-scale notes. Random exploration always sounds good. Fear of wrong notes eliminated.

### Part 2: Scale Sidebar (Visualization)
> **Show the harmonic space clearly.**

A vertical display showing which notes are in the scale and how they're being used across tracks. Answers: "What scale are we in? What's everyone playing?"

### Why Both?

Research into how tools combine constraint with visualization reveals a key pattern:

| Component | Purpose | When Used |
|-----------|---------|-----------|
| **Visualization** | Teaching, understanding, awareness | Before and during performance |
| **Constraint** | Safety, flow, confidence | During performance |

**Novation Launchpad Pro** exemplifies this: the **Scale Viewer** shows the full chromatic keyboard with scale notes highlighted (visualization), then **Scale Mode** constrains the pads to only those notes (constraint). You learn the space, then perform safely within it.

---

## How Constraint and Visualization Complement Each Other

### The Novation Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│  SCALE VIEWER (Visualization)          SCALE MODE (Constraint)     │
│                                                                     │
│  Shows full 88-key piano:               Pads only play scale notes: │
│  ┌─────────────────────────┐            ┌─────────────────────────┐ │
│  │ Blue = in scale         │     →      │ Only blue notes exist   │ │
│  │ Purple = root           │            │ Can't hit wrong notes   │ │
│  │ Dim = out of scale      │            │ Perform with confidence │ │
│  └─────────────────────────┘            └─────────────────────────┘ │
│                                                                     │
│  TEACHES the space                      ENABLES safe performance    │
└─────────────────────────────────────────────────────────────────────┘
```

### Applied to Keyboardia

```
┌─────────────────────────────────────────────────────────────────────┐
│  SCALE SIDEBAR (Visualization)          CHROMATIC GRID (Constraint) │
│                                                                     │
│  Shows scale notes:                     Only shows in-scale rows:   │
│  ┌────────────┐                         ┌───────────────────────┐   │
│  │ C  ← Root  │                         │ C  [●][○][●][○]       │   │
│  │ D          │                         │ D  [○][●][○][ ]       │   │
│  │ D#         │                         │ D# [●][○][○][○]       │   │
│  │ F          │                         │ F  [○][○][●][○]       │   │
│  │ G  ← Fifth │                         │ G  [●][○][ ][ ]       │   │
│  │ G#         │                         │ G# [○][●][○][ ]       │   │
│  │ A#         │                         │ A# [○][○][●][○]       │   │
│  └────────────┘                         └───────────────────────┘   │
│                                                                     │
│  SHOWS what's available                 CONSTRAINS to safe notes    │
│  Root/fifth emphasized                  ENABLES fearless play       │
└─────────────────────────────────────────────────────────────────────┘
```

### What Each Part Does

| Scale Sidebar (Visualization) | Scale Lock (Constraint) |
|------------------------------|------------------------|
| Shows the 7 notes in C minor | Hides the 5 notes NOT in C minor |
| Emphasizes root and fifth | Prevents wrong notes from being played |
| Updates when scale changes | Makes random selection always sound good |
| Visible to all players | Removes cognitive load |
| Answers "what scale are we in?" | Enables flow state |

### The Synergy

Neither is complete without the other:

- **Constraint without visualization:** Safe but blind. "I know I can't fail, but I don't understand why."
- **Visualization without constraint:** Informed but anxious. "I can see everything, but I'm still afraid to explore."
- **Both together:** Safe AND informed. "I understand the space AND I can't fail within it."

---

## Prior Art: Constraint + Visualization Together

### Best-in-Class: Bitwig Studio 6

**Visualization:**
- Piano roll lanes colored by **scale degree** (not just in/out)
- Root note = distinct color
- 3rd, 5th = different colors
- Unstable degrees = different colors
- You can see the **harmonic function** of each note

**Constraint:**
- "Snap to Key" (K) forces notes to scale
- Arrow keys move by scale degree, not semitone
- "Quantize to Key" snaps existing clips

**Integration:** The color-coding shows WHY notes belong in the scale, while Snap to Key prevents mistakes. Understanding + safety.

### Best Hardware: Novation Launchpad Pro

**Visualization:**
- **Scale Viewer** shows piano keyboard
- Blue pads = in scale
- Purple pad = root
- Dim white = out of scale
- Available BEFORE entering performance mode

**Constraint:**
- **Scale Mode** limits pads to scale notes
- Can't play wrong notes
- 32 scales available

**Integration:** Learn the space in Scale Viewer, perform safely in Scale Mode.

### Best Mobile: GarageBand Scale Mode

**Visualization:**
- Keyboard **transforms** to show only scale notes
- Visual interface itself becomes the constraint
- No separate "view" and "perform" modes

**Constraint:**
- Same as visualization—the interface IS the constraint

**Integration:** The most seamless version. Seeing and doing are unified.

---

## Real-World Precedents

### Physical Instruments with Built-In Constraints

| Instrument | Constraint Mechanism | Why People Love It |
|------------|---------------------|-------------------|
| **Handpan** | Pre-tuned to one scale (usually D minor) | "Frees the mind"; enables flow states |
| **Kalimba** | Tuned to specific scales (C/G major) | "Cannot play an inharmonious note" |
| **Steel Tongue Drum** | Pentatonic tuning | "Each note pairs well in any order" |
| **Autoharp** | Chord bars mute non-chord strings | Strum freely; only correct notes sound |
| **Omnichord** | Chord buttons + strumplate | Complex chords from simple gestures |
| **Orff Xylophone** | Removable bars | Teachers remove "bad" notes |

**The pattern:** Constraints remove cognitive load. Instead of "Will this sound bad?", players enter a **flow state** of pure creation.

### Scale Establishment in Ensembles

| Tradition | How Scale is Communicated |
|-----------|--------------------------|
| **Nashville Number System** | Relative degrees (1-7); fingers signal changes |
| **Tanpura/Shruti Box** | Continuous drone establishes tonal center |
| **Jazz Count-In** | "1, 2, 3, 4" establishes tempo AND key context |
| **Jam Session** | Leader states: "We're in F, here's the progression" |

**Key insight:** Scale is communicated through **context** (drone), **reference points** (count-in), and **symbolic shortcuts** (numbers).

### Visualization in Education

| System | Approach |
|--------|----------|
| **Kodály Hand Signs** | Spatial height = pitch; embeds scale in physical memory |
| **Figurenotes** | Colored shapes instead of notation; pattern matching |
| **Boomwhackers** | Color-coded tubes; visual harmony maps to color wheel |
| **Synthesia** | Scale numbers label each degree (1, 2, 3...) |

**Pattern:** Successful systems use **shape, color, and position** to communicate pitch relationships spatially.

---

## Multiplayer Patterns

### The Core Principle

**Scale Lock IS the multiplayer coordination.** When everyone is constrained to the same scale, harmonic clashes are impossible. The question becomes: how do players coordinate the *social* aspects—who controls the scale, and how do players stay aware of each other?

### What Existing Tools Do

| Platform | Approach | Outcome |
|----------|----------|---------|
| **Endlesss** | Session-level key/scale; host sets context | Simple, effective |
| **Incredibox** | Pre-designed sound pool; all combinations work | Zero harmonic failures |
| **Ableton Link** | Timing sync only; no harmonic system | Musicians coordinate externally |

---

### Multiplayer Coordination: Active Listening

**How it works in real life:**

String quartets coordinate through *active listening*—attending to each other's playing and adapting in real-time. Research shows quartets achieve synchronization through visual cues (bow speed, body sway) and mutual listening, not explicit communication.

Free jazz improvisers do the same: *"To say that a player 'doesn't listen' is a grave insult."* Musicians strategically adapt their playing based on what they hear others doing.

**How it works in Keyboardia:**

```
┌─────────────────────────────────────────────────────────────────┐
│  SESSION: Cool Jam                                              │
│  Players: @alice @bob @charlie                                  │
│                                                                 │
│  ▶ Play  [BPM: 120]  [Swing: 30%]  [Scale: C minor ▼] [🔒]     │
│                                                                 │
│  Anyone can change scale (peer-to-peer, like Ableton Link)     │
│                                                                 │
│  Coordination happens through:                                  │
│  - What notes you HEAR others playing                          │
│  - What gaps exist in the harmonic texture                     │
│  - Your musical instinct to fill or complement                 │
└─────────────────────────────────────────────────────────────────┘
```

**Evidence:**
- String quartet research (Frontiers in Psychology): quartets synchronize through listening and visual cues, not explicit communication
- Free jazz research (2024 SAGE study): musicians "strategically adapt their listening behavior to the specificities of the interactional context"
- Jazz pedagogy: active listening is the foundation of ensemble playing

**Why this approach:**
- Aligns with Scale Lock philosophy—constraint enables freedom
- Zero additional UI complexity
- Organic and musical—feels like playing together, not using software
- Scales to any number of players
- Evidence shows ensembles coordinate beautifully through listening alone

---

## Design Aligned with UI Philosophy

### OP-Z Principles Applied

From `/specs/UI-PHILOSOPHY.md`:

| Principle | How Key Assistant Applies It |
|-----------|------------------------------|
| **Controls live where they act** | Scale selector in transport (global); sidebar near tracks |
| **Visual feedback is immediate** | Sidebar updates instantly when notes played |
| **No confirmation dialogs** | Change scale → see and hear immediately |
| **Modes are visible, not hidden** | Current scale always shown; usage always visible |
| **Progressive disclosure** | Sidebar can collapse; expands to show detail |

### The UI Philosophy Test

> For any new feature, ask:
> 1. Can I see the effect immediately? ✓ (Grid constrains; sidebar shows usage)
> 2. Is the control on or near the thing it affects? ✓ (Sidebar is next to tracks)
> 3. Does it require mode switching or navigation? ✗ (Always visible)
> 4. Would this work on a device with no screen? ✓ (Scale lock works; viz is bonus)
> 5. Can I discover it by experimenting? ✓ (Play notes, see sidebar update)

---

## Implementation Concepts

### Concept 1: The Full Picture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ▶ Play   [BPM: 120]   [Swing: 30%]   [Scale: C minor ▼] [🔒]          │
├───────────────────────────────────────────────────────┬─────────────────┤
│                                                        │                 │
│  Track 1: Bass   [●●●○●●○●]                           │  C   ← Root     │
│    (ChromaticGrid constrained to C minor)             │  D              │
│      C  [●][○][●][○]                                  │  D#             │
│      D  [○][●][○][ ]                                  │  F              │
│      D# [●][○][○][○]   ← Only in-scale notes          │  G   ← Fifth    │
│      F  [○][○][●][○]     visible when Lock ON         │  G#             │
│      G  [●][○][ ][ ]                                  │  A#             │
│      G# [○][●][○][ ]                                  │                 │
│      A# [○][○][●][○]                                  │  C minor        │
│                                                        │  [Collapse ▲]   │
│  Track 2: Lead   [●○●○●○●○]                           │                 │
│                                                        │                 │
└───────────────────────────────────────────────────────┴─────────────────┘
                                                         ↑
                                            Scale Sidebar (DJ's request)
                                            - Shows available notes
                                            - Root/fifth emphasized
```

### Concept 2: Transport Bar (Control)

```
┌──────────────────────────────────────────────────────────────────┐
│  ▶ Play   [BPM: 120]   [Swing: 30%]   [Scale: C minor ▼] [🔒]    │
└──────────────────────────────────────────────────────────────────┘
                                         ↑               ↑
                                   Scale selector   Lock toggle
                                   (what scale)     (constrain?)
```

### Concept 3: Scale Sidebar (Visualization)

**Collapsed (minimal):**
```
┌─────────┐
│ C minor │
│ [▼]     │
└─────────┘
```

**Expanded (full detail):**
```
┌─────────────────┐
│  C   ← Root     │
│  D              │
│  D#             │
│  F              │
│  G   ← Fifth    │
│  G#             │
│  A#             │
│                 │
│  C minor        │
│  [▲ Collapse]   │
└─────────────────┘
```

Root and fifth have paler backgrounds for visual emphasis.

### Concept 4: Constrained ChromaticGrid

**With Scale Lock ON:**
- Only 7 rows visible (in-scale notes)
- Root row has paler background
- Fifth row has slightly paler background
- Click anywhere → sounds good

**With Scale Lock OFF:**
- All 13 rows visible
- In-scale rows have subtle highlight
- Out-of-scale rows are dimmed
- Full chromatic access

### Concept 5: Progressive Disclosure

| Level | What's Visible |
|-------|----------------|
| **Minimal** | Transport bar shows "C minor" |
| **Collapsed sidebar** | Shows scale name, expandable |
| **Expanded sidebar** | Shows all scale notes with root/fifth emphasis |
| **With Lock ON** | ChromaticGrid constrains to scale |
| **Multiplayer** | Coordination through active listening |

---

## Summary: The Key Assistant System

### Two Parts, One System

| Part | What It Does | User Need |
|------|--------------|-----------|
| **Scale Lock** (constraint) | Removes wrong notes from grid | "I want to explore without fear" |
| **Scale Sidebar** (visualization) | Shows scale notes | "I want to see what's available" |

### How They Reinforce Each Other

```
    ┌─────────────────┐
    │  Scale Sidebar  │
    │  (Visualization)│
    └────────┬────────┘
             │
             │ "These are the notes available"
             │ "This is how they're being used"
             ▼
    ┌─────────────────┐
    │   Scale Lock    │
    │  (Constraint)   │
    └────────┬────────┘
             │
             │ "You can only play these notes"
             │ "Random exploration = always good"
             ▼
    ┌─────────────────┐
    │   Flow State    │
    │  Safe + Aware   │
    └─────────────────┘
```

### The DJ's Request Fulfilled

> "A vertical key scale that expands out to the right of the tracks could be a cool way to visualize the pitches + keys."

✓ **Vertical:** Scale Sidebar is vertical (pitches stacked top to bottom)
✓ **Expands to the right:** Sidebar is to the right of tracks, expandable
✓ **Visualize pitches:** Shows which pitches are in the scale
✓ **Visualize keys:** Shows current key and usage across tracks

### The Generativity Request Fulfilled

> "Constrain all notes to a scale... Now random selection always sounds good."

✓ **Constrain:** Scale Lock removes out-of-scale notes
✓ **Random = good:** Any click on constrained grid sounds good
✓ **Removes fear:** Can't make mistakes
✓ **Enables exploration:** Flow state achieved

---

## Implementation Phases

### Phase 1: Foundation
1. Add Scale selector to transport bar
2. Implement Scale Lock toggle (🔒)
3. ChromaticGrid respects scale—hides or dims out-of-scale notes
4. Sync session scale across multiplayer
5. **Create demo sessions showcasing scale lock**

### Phase 2: Visualization
1. Add Scale Sidebar (collapsible, to right of tracks)
2. Show scale notes with root/fifth emphasis
3. Root and fifth visual emphasis ("paler" treatment)
4. Real-time updates as notes are played

### Phase 3: Polish
1. Pentatonic as default scale
2. Active listening coordination in multiplayer
3. Smooth animations for scale changes
4. Keyboard shortcuts for scale cycling

### Phase 4: Advanced
1. Custom scale editor
2. Optional drone/reference tone
3. Scale presets by genre (optional)

---

## Demo Sessions Required

Scale Lock's value is the ABSENCE of wrong notes — users must HEAR harmonic safety to understand it. Each demo should:
- Use multiple melodic instruments in the same scale
- Sound musically compelling (showcase the scale's character)
- Be remixable (users can change notes and still sound good)
- Include session-level scale metadata

### Essential Demos (Phase 1)

| Demo Name | Scale | Instruments | Genre | Musical Goal |
|-----------|-------|-------------|-------|--------------|
| **"Pentatonic Flow"** | C minor pentatonic | Piano, Rhodes, Strings | Lo-fi/Chill | "Any note sounds good" safety |
| **"Jazz Exploration"** | D Dorian | Rhodes, Finger Bass, Vibes | Neo-soul/Jazz | Modal character, sophistication |
| **"Minor Key Feels"** | A natural minor | Strings, Synth Pad, Lead | EDM/Pop | Emotional, dramatic quality |

### Demo: "Pentatonic Flow"
```
Scale: C minor pentatonic (C, Eb, F, G, Bb)
Track 1 (Piano):     Melody using all 5 notes
Track 2 (Rhodes):    Chord stabs on root and fifth
Track 3 (Strings):   Sustained pad
Track 4 (Hi-hat):    Rhythm foundation
```
**Why it works:** Pentatonic is the "safest" scale — no note clashes. Perfect for beginners. The demo proves "I can click anywhere and it sounds good."

### Demo: "Jazz Exploration"
```
Scale: D Dorian (D, E, F, G, A, B, C)
Track 1 (Rhodes):    Jazz voicings
Track 2 (Finger Bass): Walking bass line
Track 3 (Vibraphone): Melodic fills
Track 4 (Acoustic Ride): Jazz rhythm
```
**Why it works:** Dorian mode has a distinctly "jazzy" quality. The demo shows that Scale Lock isn't just for beginners — it enables genre-specific exploration.

### Demo: "Minor Key Feels"
```
Scale: A natural minor (A, B, C, D, E, F, G)
Track 1 (String Section): Emotional pad
Track 2 (Synth Lead):     Melody
Track 3 (Piano):          Arpeggios
Track 4 (Kick):           Four-on-floor
```
**Why it works:** Natural minor is dramatic and emotional. The demo shows how Scale Lock enables expressive music-making without theory knowledge.

### Optional Demos (Phase 2)

| Demo Name | Scale | Genre | Musical Goal |
|-----------|-------|-------|--------------|
| **"Happy Vibes"** | C major pentatonic | Pop/Children's | Bright, cheerful mood |
| **"Multiplayer Jam"** | G major | Session template | Explicitly designed for 2+ players |

---

## References

### Constraint + Visualization Together
- Bitwig Studio 6: Scale degree coloring + Snap to Key
- Novation Launchpad Pro: Scale Viewer + Scale Mode
- GarageBand: Transformed keyboard interface
- Ableton Push: In-Key mode with pad coloring

### Real-World Instruments
- Handpan/Hang drum scale constraints and flow states
- Kalimba tuning and "no wrong notes" philosophy
- Steel tongue drum pentatonic design
- Orff-Schulwerk removable bar approach

### Educational Methods
- Kodály method hand signs and spatial pitch
- Figurenotes color notation system
- Synthesia scale numbers

### Multiplayer Music Apps
- Endlesss: session-level key/scale
- Incredibox: pre-designed harmonic sound pools

### Keyboardia Internal
- `/specs/UI-PHILOSOPHY.md`: OP-Z principles
- UI test: "Can I discover it by experimenting?"
- Anti-patterns: no modals, no hidden modes
