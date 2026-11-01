# Composition Affordances Research

> **Status:** Research Document
> **Created:** December 2025
> **Purpose:** Identify features that would make composing complex tracks in Keyboardia easier and more intuitive

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Gap Analysis](#2-gap-analysis)
3. [Pain Points](#3-pain-points)
4. [Proposed Solutions](#4-proposed-solutions)
5. [Inspiration Gallery](#5-inspiration-gallery)
6. [Recommendations](#6-recommendations)

---

## 1. Current State Analysis

### What Keyboardia Already Does Well

Keyboardia has a strong foundation with several well-implemented features:

#### Core Sequencer Strengths

| Feature | Implementation | Quality |
|---------|----------------|---------|
| **Step Sequencing** | 16 tracks x up to 128 steps | Solid foundation |
| **Parameter Locks** | Per-step pitch (-24 to +24) and volume (0-200%) | Elektron-inspired, works well |
| **Polyrhythms** | Per-track step counts (4, 8, 12, 16, 24, 32, 64, 96, 128) | Industry-leading flexibility |
| **Chromatic Grid** | Inline piano-roll view for melodic tracks | Great for visual melodies |
| **Real-time Multiplayer** | WebSocket sync, cursor tracking, presence | Unique differentiator |
| **Mobile Support** | Touch-optimized, inline drawers | Functional on small screens |
| **Swing/Shuffle** | Global 0-100% | Standard implementation |

#### Synthesis & Sound Design

| Feature | Implementation | Quality |
|---------|----------------|---------|
| **Procedural Drums** | 20+ synthesized drum sounds | Good variety |
| **Basic Synths** | 5 synth: presets (bass, lead, pad, pluck, acid) | Adequate |
| **Advanced Synths** | Dual-oscillator with filter envelope, LFO | Professional-quality |
| **Tone.js Synths** | FM, AM, Membrane, Metal, Pluck, Duo | Excellent variety |
| **Sampled Piano** | Multi-sampled with 4 velocity layers | High quality |
| **Effects Chain** | Reverb, Delay, Chorus, Distortion | Well-implemented |

#### UI/UX Strengths

| Feature | Implementation | Alignment with Philosophy |
|---------|----------------|---------------------------|
| **Direct Manipulation** | Controls live where they act | Strong OP-Z alignment |
| **No Modals** | Inline editing throughout | Excellent |
| **Visual Feedback** | Playhead, parameter badges, remote cursors | Good feedback loop |
| **Progressive Disclosure** | Expand/collapse for advanced features | Follows philosophy |
| **Copy/Paste Patterns** | Track-level copy with inline controls | Works well |

---

## 2. Gap Analysis

### Comparison with Professional Tools

#### Missing vs. Elektron Digitakt II / Octatrack

| Elektron Feature | Keyboardia Status | Impact |
|------------------|-------------------|--------|
| **128-step sequencer** | Implemented | N/A |
| **Parameter locks** | Implemented (pitch, volume only) | Could add more parameters |
| **Euclidean generator** | Missing | High - instant interesting rhythms |
| **Conditional trigs (probability)** | Missing | High - adds variation |
| **Song Mode / Arranger** | Missing | High - can't build full songs |
| **Fill mode** | Missing | Medium - performance feature |
| **Retrig/Ratcheting** | Missing | Medium - creates fills/rolls |
| **Trig modes (velocity levels)** | Missing | Medium - expressive drums |
| **Slice Machine** | Partially (auto-slice on record) | Could expand |
| **LFO per track** | Missing (only on advanced synths) | Low - advanced feature |

#### Missing vs. Teenage Engineering OP-Z

| OP-Z Feature | Keyboardia Status | Impact |
|--------------|-------------------|--------|
| **Step components** | Missing | Very High - unique per-step behaviors |
| **Pattern chaining** | Missing | High - song structure |
| **160 patterns per project** | Only 1 pattern | High - limits composition |
| **384 steps (24 subdivisions)** | 128 steps max | Medium - already generous |
| **Punch-in effects** | Missing | Medium - performance feature |
| **Tape track (master)** | Missing | Low - advanced |
| **Track groups** | Missing | Medium - organization |

#### Missing vs. Novation Circuit Tracks

| Circuit Feature | Keyboardia Status | Impact |
|-----------------|-------------------|--------|
| **Probability per step** | Missing | High - automatic variation |
| **Mutate function** | Missing | High - instant variations |
| **Micro-timing nudge** | Only swing | Medium - finer groove control |
| **Scenes (pattern groups)** | Missing | High - live performance |
| **Pattern chains** | Missing | High - song structure |
| **Scale lock** | Missing | Medium - helps beginners |
| **Arpeggiator** | Missing | Medium - melodic helper |

#### Missing vs. Web-Based Tools

| Feature | Common in Web Tools | Keyboardia Status | Impact |
|---------|---------------------|-------------------|--------|
| **Undo/Redo** | Standard | Missing | Very High - safety net |
| **Export (MIDI, WAV)** | Common | MIDI partial, WAV missing | Medium |
| **Scale constraints** | Common | Missing | Medium - helps beginners |
| **Quantization options** | Common | Fixed 16th notes | Low |
| **Tempo tap** | Common | Missing | Low |

---

## 3. Pain Points

### Pain Point 1: No Way to Build Full Songs

**Current Limitation:**
Keyboardia has one pattern per session. Users can only create loops, not complete songs with intro, verse, chorus, bridge, outro.

**User Impact:**
- Cannot compose music with structure
- Must create separate sessions for each section (loses context)
- No way to perform or arrange a complete piece

**Severity:** Critical for serious composition

---

### Pain Point 2: No Undo/Redo

**Current Limitation:**
Any accidental change is permanent. No way to recover from mistakes.

**User Impact:**
- Fear of experimentation
- One wrong click can ruin work
- Especially problematic in multiplayer (can't undo others' mistakes)

**Severity:** High - affects confidence and exploration

---

### Pain Point 3: Tedious Melody Creation

**Current Limitation:**
Creating melodies requires either:
1. Opening ChromaticGrid and clicking each note individually
2. Using parameter locks step-by-step

**User Impact:**
- No scale assistance (can play "wrong" notes)
- No arpeggiator for quick melodic patterns
- No way to generate melodic ideas automatically

**Severity:** Medium-High for melodic composition

---

### Pain Point 4: No Pattern Variation Tools

**Current Limitation:**
To create variations, users must manually edit each step.

**User Impact:**
- Fills require tedious manual work
- No probability for automatic variation
- Patterns become static/boring quickly

**Severity:** Medium-High - affects musicality

---

### Pain Point 5: Long Patterns Are Hard to Navigate

**Current Limitation:**
64-128 step patterns require horizontal scrolling with no overview.

**User Impact:**
- Lose context of full pattern
- Hard to see structure at a glance
- Page separators help but aren't enough

**Severity:** Medium - affects usability of longer patterns

---

### Pain Point 6: No Rhythm Generation Helpers

**Current Limitation:**
All rhythms must be created step-by-step.

**User Impact:**
- New users don't know where to start
- Experienced users can't quickly sketch ideas
- No Euclidean, random, or template generators

**Severity:** Medium - affects speed and inspiration

---

### Pain Point 7: Chord Progressions Are Clumsy

**Current Limitation:**
Chords require multiple tracks (one per note) or careful parameter lock coordination.

**User Impact:**
- Building chord progressions is tedious
- No chord assistant or templates
- Polyphony limited to one note per step per track

**Severity:** Medium - limits harmonic sophistication

---

### Pain Point 8: No Track Organization

**Current Limitation:**
All tracks are in a flat list with no grouping or reordering.

**User Impact:**
- Can't organize by instrument type (drums, bass, leads)
- Can't collapse groups to focus on specific section
- Visual clutter with many tracks

**Severity:** Low-Medium - affects workflow with many tracks

---

## 4. Proposed Solutions

### Priority 1: Undo/Redo System

**Description:**
Implement comprehensive undo/redo for all user actions.

**User Benefit:**
- Safety net for experimentation
- Recover from mistakes instantly
- Explore freely without fear

**Implementation Complexity:** Medium-High

**Technical Approach:**
```typescript
// Command pattern - each action is reversible
interface Command {
  execute(): void;
  undo(): void;
  description: string;
}

// History stack per user (multiplayer consideration)
interface UndoHistory {
  past: Command[];
  future: Command[];
  maxSize: number; // Limit memory usage (e.g., 100 actions)
}
```

**Multiplayer Considerations:**
- Per-user undo (don't undo others' actions)
- Pause history during drag operations
- Handle conflicts when undo affects shared state

**Mobile Compatibility:** Excellent (shake to undo, or button)

**References:**
- [Liveblocks: Multiplayer Undo/Redo](https://liveblocks.io/blog/how-to-build-undo-redo-in-a-multiplayer-environment)
- [ACM: Undo/Redo for Replicated Systems](https://dl.acm.org/doi/10.1145/3642976.3653029)

---

### Priority 2: Pattern Chaining / Song Mode

**Description:**
Allow multiple patterns (8-16) per session that can be chained into an arrangement.

**User Benefit:**
- Build complete songs with structure
- Reuse patterns (verse plays twice)
- Live performance capability

**Implementation Complexity:** High

**Data Model:**
```typescript
interface Session {
  patterns: Pattern[];  // Up to 16 patterns
  arrangement: PatternChain[];  // Ordered list for playback
  currentPatternIndex: number;
}

interface Pattern {
  id: string;
  name: string;  // "Intro", "Verse", "Chorus"
  tracks: Track[];
  tempo?: number;  // Optional per-pattern tempo
}

interface PatternChain {
  patternId: string;
  repeats: number;  // How many times to play
}
```

**UI Approach (OP-Z Inspired):**
- Pattern selector row above tracks (1-16 buttons)
- Current pattern highlighted
- Long-press to copy pattern
- Chain mode: click patterns in order to build arrangement
- Visual timeline showing arrangement structure

**Mobile Compatibility:** Good (compact pattern selector)

**References:**
- [Polyend Play Manual](https://polyend.com/manuals/play/)
- [OP-Z Pattern Chaining](https://teenage.engineering/products/op-z)

---

### Priority 3: Euclidean Rhythm Generator

**Description:**
Auto-generate rhythms by specifying number of hits and steps.

**User Benefit:**
- Instant interesting rhythms
- Discover patterns you wouldn't create manually
- Educational tool for rhythm concepts

**Implementation Complexity:** Low

**Algorithm:**
```typescript
// Bjorklund's algorithm for Euclidean distribution
function euclidean(steps: number, hits: number, rotation: number = 0): boolean[] {
  if (hits > steps) hits = steps;
  if (hits === 0) return new Array(steps).fill(false);

  // Distribute hits as evenly as possible
  const pattern: boolean[] = [];
  let bucket = 0;

  for (let i = 0; i < steps; i++) {
    bucket += hits;
    if (bucket >= steps) {
      bucket -= steps;
      pattern.push(true);
    } else {
      pattern.push(false);
    }
  }

  // Rotate pattern
  const rotated = [...pattern.slice(rotation), ...pattern.slice(0, rotation)];
  return rotated;
}

// Examples:
// euclidean(8, 3) → [●○○●○○●○] (Cuban tresillo)
// euclidean(8, 5) → [●○●●○●●○] (Cuban cinquillo)
// euclidean(16, 4) → [●○○○●○○○●○○○●○○○] (4-on-the-floor)
```

**UI Approach:**
```
┌─────────────────────────────────────────────┐
│ [Track: Kick]                               │
│                                             │
│ Euclidean:  Steps: [16 ▾]  Hits: [4  ▾]    │
│             Rotation: ←○○○○●→              │
│                                             │
│ Preview: [●○○○●○○○●○○○●○○○]               │
│                                             │
│ [Apply] [Cancel]                            │
└─────────────────────────────────────────────┘
```

**Mobile Compatibility:** Excellent

**References:**
- [MusicRadar: Euclidean Sequencing](https://www.musicradar.com/how-to/what-is-euclidean-sequencing-and-how-do-you-use-it)
- [eMastered: Euclidean Rhythms Guide](https://emastered.com/blog/euclidean-rhythms)
- [LANDR: Euclidean Rhythms](https://blog.landr.com/euclidean-rhythms/)

---

### Priority 4: Step Probability / Conditional Triggers

**Description:**
Each step can have a probability (0-100%) of playing.

**User Benefit:**
- Automatic variation without manual work
- Prevents patterns from becoming stale
- Creates human-like feel

**Implementation Complexity:** Low

**Data Model Extension:**
```typescript
interface ParameterLock {
  pitch?: number;
  volume?: number;
  probability?: number;  // 0-100, default 100 (always play)
}
```

**Scheduler Change:**
```typescript
// In scheduler.ts
if (track.steps[step]) {
  const lock = track.parameterLocks[step];
  const probability = lock?.probability ?? 100;

  if (Math.random() * 100 < probability) {
    // Play the note
    scheduleNote(track, step, time);
  }
}
```

**UI Approach:**
- Add probability slider to p-lock editor (Shift+click)
- Visual indicator on step: opacity reflects probability
- Or: dedicated "%" badge on step

**Mobile Compatibility:** Excellent

---

### Priority 5: Scale Lock / Key Assistant

**Description:**
Constrain ChromaticGrid to a selected musical scale.

**User Benefit:**
- Can't play "wrong" notes
- Educational for learning scales
- Faster melodic composition

**Implementation Complexity:** Low-Medium

**Scale Definitions:**
```typescript
const SCALES: Record<string, number[]> = {
  major:        [0, 2, 4, 5, 7, 9, 11],
  minor:        [0, 2, 3, 5, 7, 8, 10],
  pentatonic:   [0, 2, 4, 7, 9],
  blues:        [0, 3, 5, 6, 7, 10],
  dorian:       [0, 2, 3, 5, 7, 9, 10],
  mixolydian:   [0, 2, 4, 5, 7, 9, 10],
  chromatic:    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

interface ScaleLock {
  root: number;  // 0-11 (C, C#, D, etc.)
  scale: keyof typeof SCALES;
}
```

**UI Approach:**
- Scale selector in track header or transport
- ChromaticGrid highlights in-scale notes
- Out-of-scale notes dimmed or hidden
- Optional: snap to nearest scale note

**Mobile Compatibility:** Excellent

---

### Priority 6: Quick Fill / Variation Generator

**Description:**
One-click or gesture to create variations of current pattern.

**User Benefit:**
- Instant fills for transitions
- Break monotony with minimal effort
- Experimental discovery

**Implementation Complexity:** Low-Medium

**Variation Types:**
```typescript
type VariationType =
  | 'fill'       // Add extra hits on beat 4
  | 'sparse'     // Remove 25-50% of hits randomly
  | 'dense'      // Double density (retrig style)
  | 'shift'      // Rotate pattern by N steps
  | 'reverse'    // Play pattern backwards
  | 'humanize'   // Add slight timing/velocity variations
  | 'mutate';    // Randomly flip some steps

function generateVariation(
  track: Track,
  type: VariationType,
  amount: number
): Track {
  // Return modified copy
}
```

**UI Approach:**
- "Variations" button in track controls
- Dropdown or radial menu with variation types
- Or: dedicated "Fill" button that applies temporary variation

**Mobile Compatibility:** Good (button + menu)

---

### Priority 7: Pattern Overview / Mini-Map

**Description:**
Visual overview of entire pattern for long sequences.

**User Benefit:**
- See structure at a glance
- Quick navigation
- Understand where you are in 64-128 step patterns

**Implementation Complexity:** Low

**UI Approach:**
```
┌─────────────────────────────────────────────────────────────┐
│ Pattern Overview (128 steps)                                 │
│ ┌───────────────────────────────────────────────────────┐   │
│ │▓▓░░▓░░░│▓▓░░▓░░░│▓▓░░▓░░░│▓▓░░▓░░░│▓▓▓░▓░░░│▓▓░░▓░░░│   │
│ │░░▓░░░▓░│░░▓░░░▓░│░░▓░░░▓░│░░▓░░░▓░│░░▓▓░░▓░│░░▓░░░▓░│   │
│ │▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│   │
│ └───────────────────────────────────────────────────────┘   │
│                    ▲ Current view (steps 33-48)             │
└─────────────────────────────────────────────────────────────┘
```

- Each row = track
- Each pixel = step (on/off)
- Highlight current view
- Click to jump to location

**Mobile Compatibility:** Good (pinch to zoom)

---

### Priority 8: Ratcheting / Retrigger

**Description:**
Play multiple triggers within a single step (drum rolls, hi-hat patterns).

**User Benefit:**
- Create fills and rolls easily
- Trap-style hi-hat patterns
- More expressive drum programming

**Implementation Complexity:** Medium

**Data Model:**
```typescript
interface ParameterLock {
  pitch?: number;
  volume?: number;
  probability?: number;
  retrigger?: number;  // 1-8: how many times to play within step
}
```

**Scheduler Change:**
```typescript
const retrigs = lock?.retrigger ?? 1;
const retrigInterval = stepDuration / retrigs;

for (let i = 0; i < retrigs; i++) {
  scheduleNote(track, step, time + (i * retrigInterval));
}
```

**UI:**
- Retrig count in p-lock editor
- Visual: step shows subdivision markers

**Mobile Compatibility:** Excellent

---

### Priority 9: Arpeggiator

**Description:**
Auto-generate melodic patterns from held/entered notes.

**User Benefit:**
- Quick melodic ideas
- Classic synth feature
- Works great with chord inputs

**Implementation Complexity:** Medium

**Parameters:**
```typescript
interface ArpeggiatorSettings {
  mode: 'up' | 'down' | 'updown' | 'random' | 'order';
  octaves: 1 | 2 | 3 | 4;
  rate: '16n' | '8n' | '4n' | '32n';
  gate: number;  // 0-100%
}
```

**UI Approach:**
- Per-track arpeggiator toggle
- Settings in inline drawer
- Works with chromatic grid input

**Mobile Compatibility:** Good

---

### Priority 10: Track Groups / Folders

**Description:**
Group related tracks (e.g., "Drums", "Bass", "Leads").

**User Benefit:**
- Better organization with many tracks
- Collapse groups to focus
- Group mute/solo

**Implementation Complexity:** Medium

**Data Model:**
```typescript
interface TrackGroup {
  id: string;
  name: string;
  trackIds: string[];
  collapsed: boolean;
  color: string;
}
```

**UI:**
- Collapsible headers above track groups
- Drag tracks between groups
- Group-level mute/solo

**Mobile Compatibility:** Good

---

### Summary Table

| Feature | User Impact | Complexity | Mobile-Friendly | Priority |
|---------|-------------|------------|-----------------|----------|
| Undo/Redo | Very High | Medium-High | Yes | 1 |
| Pattern Chaining | Very High | High | Moderate | 2 |
| Euclidean Generator | High | Low | Yes | 3 |
| Step Probability | High | Low | Yes | 4 |
| Scale Lock | Medium-High | Low | Yes | 5 |
| Quick Fill/Variation | Medium-High | Low-Medium | Yes | 6 |
| Pattern Overview | Medium | Low | Yes | 7 |
| Ratcheting/Retrig | Medium | Medium | Yes | 8 |
| Arpeggiator | Medium | Medium | Yes | 9 |
| Track Groups | Low-Medium | Medium | Yes | 10 |

---

## 5. Inspiration Gallery

### Elektron Digitakt II

**What Makes It Great:**
- **Euclidean sequencing** built-in
- **Conditional triggers** (probability, fill mode, first/last)
- **Song Mode** chains patterns into complete arrangements
- **128 steps** with clear page navigation
- **Slice Machine** divides samples into playable slices

**Keyboardia Takeaway:** Euclidean and probability are low-effort, high-impact features.

**Reference:** [Elektron Digitakt II](https://www.elektron.se)

---

### Teenage Engineering OP-Z

**What Makes It Great:**
- **Step Components**: Per-step modifiers that add variation, direction changes, parameter sweeps
- **Pattern Chaining**: Chain up to 160 patterns into songs
- **Dual-layer sequencing**: Base pattern + step components layer
- **No screen dependency**: UI designed to work without looking

**Keyboardia Takeaway:** Step components are uniquely powerful - worth considering for differentiation.

**Reference:** [OP-Z Product Page](https://teenage.engineering/products/op-z)

---

### Novation Circuit Tracks

**What Makes It Great:**
- **Probability per step**: Easy slider in step editor
- **Mutate function**: One-button pattern variation
- **Scenes**: Group patterns for performance sections
- **Micro-timing**: Per-step nudge for groove

**Keyboardia Takeaway:** Probability and Mutate are quick wins that add huge value.

**Reference:** [Novation Circuit Tracks](https://novationmusic.com/products/circuit-tracks)

---

### Polyend Play

**What Makes It Great:**
- **128 patterns per project**
- **Sample-based with pattern chaining**
- **Pattern variations** with randomization tools
- **Visual step editing** with clear feedback

**Keyboardia Takeaway:** Pattern chaining is essential for complete composition.

**Reference:** [Polyend Play Manual](https://polyend.com/manuals/play/)

---

### Chrome Music Lab

**What Makes It Great:**
- **Extreme simplicity**: One-tap operation
- **Immediate audio feedback**
- **No menus or modes**
- **Educational focus**: Learn by doing

**Keyboardia Takeaway:** Keep the core interaction as simple as possible. Advanced features should be discoverable but not required.

**Reference:** [Chrome Music Lab](https://musiclab.chromeexperiments.com/)

---

### Ableton Learning Music

**What Makes It Great:**
- **Grid-based simplicity**: Click cells to toggle
- **Pre-populated examples**: Users modify, not create from scratch
- **Progressive disclosure**: Complexity revealed gradually
- **Excellent lookahead scheduling**: Rock-solid timing

**Keyboardia Takeaway:** Already implemented the scheduling pattern. Could add more pre-built template patterns for beginners.

**Reference:** [Ableton Learning Music](https://learningmusic.ableton.com/)

---

## 6. Recommendations

### Top 10 Features to Implement (In Order)

#### Tier 1: Critical Foundations (Implement First)

**1. Undo/Redo System**
- **Why First:** Safety net enables experimentation. Currently, fear of mistakes limits creativity.
- **Scope:** All grid actions (step toggle, parameter changes, track operations)
- **Effort:** 2-3 weeks
- **Special consideration:** Per-user undo in multiplayer

**2. Euclidean Rhythm Generator**
- **Why Second:** Lowest effort, highest inspiration. New users get interesting results immediately.
- **Scope:** Apply to any track, with steps/hits/rotation controls
- **Effort:** 3-5 days
- **UI:** Modal or inline panel, preview before apply

**3. Step Probability**
- **Why Third:** Minimal effort, maximum musical value. Patterns stay fresh.
- **Scope:** Add probability field to ParameterLock, update scheduler
- **Effort:** 2-3 days
- **UI:** Slider in existing p-lock editor

---

#### Tier 2: Compositional Power (Build Complete Songs)

**4. Pattern Chaining / Multiple Patterns**
- **Why:** Transform from loop-maker to song-maker
- **Scope:** 8-16 patterns per session, pattern selector UI, chain mode
- **Effort:** 3-4 weeks
- **Multiplayer:** All users see same pattern, pattern changes sync

**5. Scale Lock**
- **Why:** Removes "wrong note" anxiety, helps beginners
- **Scope:** Global or per-track scale selection
- **Effort:** 1 week
- **UI:** Dropdown in transport or track header

---

#### Tier 3: Variation & Performance

**6. Quick Fill / Variation Generator**
- **Why:** One-click pattern modifications for fills and breaks
- **Scope:** 5-6 variation types (sparse, dense, shift, reverse, humanize)
- **Effort:** 1 week
- **UI:** Dropdown menu or dedicated button

**7. Pattern Overview / Mini-Map**
- **Why:** Navigate long patterns without losing context
- **Scope:** Compact visualization of all tracks/steps
- **Effort:** 3-5 days
- **UI:** Collapsible panel above or below tracks

**8. Ratcheting / Retrigger**
- **Why:** Essential for fills, hi-hat rolls, drum programming
- **Scope:** Add retrigger count to p-lock
- **Effort:** 3-5 days
- **UI:** In p-lock editor alongside pitch/volume

---

#### Tier 4: Advanced Composition (Power Users)

**9. Arpeggiator**
- **Why:** Quick melodic patterns, classic synth feature
- **Scope:** Per-track arp with mode/octave/rate
- **Effort:** 1-2 weeks
- **UI:** Toggle + settings in track drawer

**10. Track Groups**
- **Why:** Organization at scale (8+ tracks)
- **Scope:** Collapsible groups with group mute/solo
- **Effort:** 1-2 weeks
- **UI:** Group headers, drag-drop between groups

---

### Implementation Timeline Suggestion

```
Month 1:
  Week 1-2: Undo/Redo foundation
  Week 3: Euclidean generator
  Week 4: Step probability

Month 2:
  Week 1-2: Pattern chaining (data model, basic UI)
  Week 3: Pattern chaining (multiplayer sync)
  Week 4: Scale lock

Month 3:
  Week 1: Quick fill/variation
  Week 2: Pattern overview
  Week 3: Ratcheting
  Week 4: Polish and testing

Month 4+:
  Arpeggiator
  Track groups
  Additional refinements
```

---

### Design Principles for All New Features

1. **Controls live where they act** - No separate menus for track features
2. **Visual feedback is immediate** - Changes visible instantly
3. **No confirmation dialogs** - Actions are reversible via undo
4. **Mobile-first thinking** - Touch targets, no hover-dependent features
5. **Multiplayer-aware** - All new state must sync across clients
6. **Progressive disclosure** - Simple by default, power features discoverable

---

### Metrics for Success

| Feature | Success Metric |
|---------|----------------|
| Undo/Redo | Usage rate > 5 undos per session |
| Euclidean | 30%+ of sessions use generator |
| Probability | Steps with probability < 100% in active sessions |
| Pattern Chaining | Average patterns per session > 2 |
| Scale Lock | 50%+ of melodic tracks use scale lock |

---

## Appendix: Research Sources

### Hardware References
- [Elektron Octatrack MKII](https://www.elektron.se/explore/octatrack-mkii)
- [Elektron Digitakt II](https://synthanatomy.com/2025/06/elektron-digitakt-ii-popular-hardware-sampler-goes-stereo-with-more-creative-power.html)
- [Teenage Engineering OP-Z](https://teenage.engineering/products/op-z)
- [OP-Z Review](https://magazinmehatronika.com/en/teenage-engineering-op-z-review/)
- [Novation Circuit Tracks](https://novationmusic.com/products/circuit-tracks)
- [Circuit Tracks Review](https://www.soundonsound.com/reviews/novation-circuit-tracks)
- [Polyend Play Manual](https://polyend.com/manuals/play/)

### Algorithm References
- [Euclidean Sequencing Guide](https://www.musicradar.com/how-to/what-is-euclidean-sequencing-and-how-do-you-use-it)
- [Euclidean Rhythms Complete Guide](https://emastered.com/blog/euclidean-rhythms)
- [LANDR: Euclidean Rhythms](https://blog.landr.com/euclidean-rhythms/)

### Multiplayer Undo Research
- [Liveblocks: Multiplayer Undo/Redo](https://liveblocks.io/blog/how-to-build-undo-redo-in-a-multiplayer-environment)
- [ACM: Undo for Replicated Registers](https://dl.acm.org/doi/10.1145/3642976.3653029)

### Web-Based Tools
- [Ableton Learning Music](https://learningmusic.ableton.com/)
- [Chrome Music Lab](https://musiclab.chromeexperiments.com/)
- [Soundation](https://soundation.com/)
- [Muted.io Sequencer](https://muted.io/sequencer/)

---

*Document created as part of Keyboardia composition affordances research, December 2025*
