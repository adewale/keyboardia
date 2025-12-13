# Session Notation Research

A comprehensive analysis of Keyboardia's text pattern notation: its design philosophy, theoretical foundations, relationship to other notation systems, expressive boundaries, and principles for future evolution.

**Date:** December 2025
**Version:** 1.0.0

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [The Notation Format](#the-notation-format)
3. [Theoretical Foundations](#theoretical-foundations)
4. [Relationship to Other Notations](#relationship-to-other-notations)
5. [Expressive Boundaries](#expressive-boundaries)
6. [The Three-Layer Architecture](#the-three-layer-architecture)
7. [Notation and JSON API Relationship](#notation-and-json-api-relationship)
8. [Future Features and Notation Impact](#future-features-and-notation-impact)
9. [Design Principles for Evolution](#design-principles-for-evolution)
10. [References](#references)

---

## Executive Summary

Keyboardia uses a **Text Pattern Notation** — a simple ASCII format for representing step sequencer patterns that can be shared across any text medium (Discord, SMS, email, GitHub, AI chat).

```
Kick:  x---x---x---x---
Snare: ----x-------x---
HiHat: x-x-x-x-x-x-x-x-
```

This notation is:
- **Simple** — Single character per step (`x` = on, `-` = off)
- **Universal** — Works in any text channel without special tools
- **AI-friendly** — LLMs can read, generate, and discuss patterns
- **Extensible** — Metadata annotations (`[swing:60]`) add context without breaking the core format

The notation is deliberately **incomplete** — it captures musical intent (rhythm, basic dynamics, pitch hints) while delegating synthesis details to the application. This separation keeps the notation eternal (plain text survives everything) while allowing the app to evolve.

### Key Design Insight

The notation serves as a **boundary object** (Star & Griesemer, 1989) — an artifact that lives at the intersection of different communities (musicians, programmers, AI systems) while remaining plastic enough to adapt to each context.

---

## The Notation Format

### Basic Syntax

| Symbol | Meaning | Example |
|--------|---------|---------|
| `x` | Step ON (note triggered) | `x---x---` |
| `-` | Step OFF (silence) | `----x---` |
| `o` | Ghost note (soft/quiet) | `--o-x---` |
| `X` | Accent (loud/emphasized) | `----X---` |

**Resolution:** 16 characters = 1 bar at 16th-note resolution

### Extended Syntax with Annotations

```
Kick:  x---x---x---x--- [transpose:-2]
Snare: --o-X-----o-X--- [o=ghost, X=accent]
Bass:  x-------x------- [synth:acid, swing:60]
HiHat: x-x-x-x-x-x-x-x- [stepCount:8]
```

**Metadata annotations** use bracket syntax:
- `[swing:60]` — Swing percentage (0-100)
- `[bpm:120]` — Tempo
- `[transpose:5]` — Pitch offset in semitones
- `[synth:acid]` — Instrument/preset hint
- `[stepCount:8]` — Loop length for polyrhythms
- `[pitches:0,7,5,3]` — Per-step pitch sequence

### Multi-Bar Patterns

```
Bass (32 steps):
x-------x-------x-------x---x---
```

Or using explicit step count:
```
Bass: x-------x-------x-------x---x--- [stepCount:32]
```

---

## Theoretical Foundations

### Whitehead's Notation Principle

> "By relieving the brain of unnecessary work, a good notation sets it free to concentrate on more advanced problems."
>
> — Alfred North Whitehead, *An Introduction to Mathematics* (1911), Chapter 5

**Codebase reference:** [`specs/research/EMERGENCE.md:46-57`](../research/EMERGENCE.md#L46-L57)

The step sequencer grid embodies this principle:
- **External Memory** — Pattern stored visually, not mentally
- **Parallel Processing** — See 16+ simultaneous relationships
- **Manipulation Without Recall** — Edit what you see, not what you remember
- **Cognitive Offloading** — Brain freed for higher-level musical thinking

### Boundary Objects Theory

> "Boundary objects are objects which are both plastic enough to adapt to local needs and constraints of the several parties employing them, yet robust enough to maintain a common identity across sites."
>
> — Star & Griesemer (1989), "Institutional Ecology, 'Translations' and Boundary Objects"

**Codebase reference:** [`specs/research/EMERGENCE.md:293-299`](../research/EMERGENCE.md#L293-L299)

The text notation serves as a boundary object connecting:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Musicians ←→ Text Pattern ←→ Programmers                      │
│       ↑              ↑              ↑                           │
│       │              │              │                           │
│   Discord        Reddit/GitHub     AI/LLMs                      │
│   Community       Community        Systems                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Design for Emergence

> "Emergent systems are ones where simple rules create complex, unpredictable outcomes."
>
> — Kasey Klimes (2022), "Design for Emergence"

**Codebase reference:** [`specs/research/EMERGENCE.md:34-44`](../research/EMERGENCE.md#L34-L44)

The notation enables **community emergence** through:
- Zero-friction sharing (copy/paste works everywhere)
- Inline discussion ("Try changing beat 3 to `--x-`")
- AI collaboration (LLMs can read/write patterns)
- Version control (patterns are diffable, grep-able)

### The Emergence Equation

```
Emergence = (Simple Rules × Combinatorial Space × Feedback Speed) / Friction
```

**Codebase reference:** [`specs/research/EMERGENCE.md:556-561`](../research/EMERGENCE.md#L556-L561)

The notation maximizes this equation:
- **Simple rules** — Just `x` and `-`
- **Combinatorial space** — 16 positions × multiple tracks = infinite patterns
- **Feedback speed** — Copy/paste is instant
- **Low friction** — Works in any text medium

---

## Relationship to Other Notations

### Direct Ancestors

#### 1. ASCII Drum Tablature (Internet Folk Tradition, 1990s)

The `x`/`-` notation emerged organically in Usenet, forums, and guitar tab sites:

```
Traditional drum tab:
H |x-x-x-x-x-x-x-x-|
S |----o-------o---|
B |o-------o-------|
```

**What Keyboardia takes:** The `x`/`-` symbols, monospace grid alignment, community shareability ethos

**What Keyboardia adds:** Formal metadata annotations, structured clipboard format, AI-native design

#### 2. Tracker Music Notation (1980s-present)

MOD files, FastTracker, Renoise, LSDJ use grid-based notation:

```
FastTracker pattern:
| C-4 01 .. C40 | ... .. .. ... |
| ... .. .. ... | E-4 01 .. C40 |
```

**Similarities:** Grid-based step sequencing, per-step parameter control, visual pattern of filled vs empty

**Differences:** Trackers use note names (C-4); trackers are vertical; Keyboardia is horizontal and rhythm-focused

#### 3. TR-808/909 Step Notation (Hardware Tradition)

Roland drum machines established the 16-step paradigm:

```
808 step buttons:
[●][○][○][○][●][○][○][○][●][○][○][○][●][○][○][○]
 1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16
```

**What Keyboardia takes:** The `x`/`-` directly maps to filled/unfilled step buttons; 16-step default

### Related Notations

#### 4. ABC Notation (Folk/Traditional Music, 1980s)

Text-based music notation standard:

```
X:1
T:Cooley's
M:4/4
K:Emin
|:D2|EB{c}BA B2 EB|~B2 AB dBAG|
```

**Similarities:** Text-based, clipboard-friendly, metadata in headers, community-driven standardization

**Differences:** ABC is melodic/pitched; Keyboardia's drum notation is rhythmic/trigger-based

**Reference:** [ABC Notation Standard](https://abcnotation.com/)

#### 5. Guitar Tablature

```
e|--0--0--0--0--|
B|--1--1--1--1--|
G|--0--0--0--0--|
D|--2--2--2--2--|
```

**Shared DNA:** Grid alignment using monospace, symbols represent actions, emerged from community need

#### 6. Regular Expressions / Pattern Languages

Structural similarity to regex:

```
Regex:   x..x..x..x..   (dots match any)
Pattern: x---x---x---   (dashes are silence)
```

Both are compact symbolic representations, shareable as plain text, readable by humans and machines.

#### 7. Binary / Bitfield Notation

The pattern `x---x---x---x---` is semantically equivalent to:

```
Binary:  1000100010001000
Hex:     0x8888
```

Some music software stores patterns this way internally. The `x`/`-` notation is human-readable binary.

### Notation Comparison Matrix

| Notation | Domain | Pitch | Rhythm | Dynamics | Text-based | AI-friendly |
|----------|--------|-------|--------|----------|------------|-------------|
| **Keyboardia** | Step sequencer | Via p-locks | ✅ Primary | `o`/`x`/`X` | ✅ | ✅ |
| ABC | Folk/Traditional | ✅ Primary | ✅ | Limited | ✅ | Moderate |
| Drum Tab | Drums | ❌ | ✅ | Limited | ✅ | Moderate |
| Tracker | General | ✅ | ✅ | ✅ | ✅ | Complex |
| Guitar Tab | Guitar | ✅ | Implicit | ❌ | ✅ | Moderate |
| MusicXML | General | ✅ | ✅ | ✅ | ✅ (verbose) | Complex |
| MIDI | General | ✅ | ✅ | ✅ | ❌ (binary) | Via parsing |

---

## Expressive Boundaries

### What CAN Be Represented

| Dimension | Notation | Coverage |
|-----------|----------|----------|
| **Rhythm** (binary) | `x` / `-` | Complete |
| **Dynamics** (3 levels) | `o` / `x` / `X` | Sufficient for most genres |
| **Pitch offset** | `[pitch:+5]` or p-lock | ±12 semitones (2 octaves) |
| **Volume offset** | `[vol:0.5]` or p-lock | 0-1 multiplier per step |
| **Track transpose** | `[transpose:-2]` | ±12 semitones |
| **Polyrhythm** | `[stepCount:8]` | 4/8/16/32/64 steps |
| **Swing** | `[swing:60]` | 0-100% |
| **Tempo** | `[bpm:120]` | 60-180 BPM |
| **Instrument hint** | `[synth:acid]` | 35+ instruments |
| **Multi-track** | Labeled lines | Up to 16 tracks |

### What CANNOT Be Represented

#### Continuous Parameters
| Feature | Status | Workaround |
|---------|--------|------------|
| Pitch bends | ❌ | Discrete pitch p-locks |
| Filter sweeps | ❌ | Future: Phase F filter automation |
| LFO modulation | ❌ | Future: Phase 19 synthesis |
| Crescendo/decrescendo | ❌ | Discrete volume p-locks |

#### Harmonic Complexity
| Feature | Status | Workaround |
|---------|--------|------------|
| Chords | ❌ Monophonic only | Use multiple tracks |
| Voicings | ❌ | Multiple tracks at different octaves |
| Inversions | ❌ | Explicit pitch p-locks |

#### Temporal Flexibility
| Feature | Status | Workaround |
|---------|--------|------------|
| Rubato | ❌ Grid is quantized | Architectural limitation |
| Tempo changes | ❌ Global tempo only | Future: pattern chaining |
| Odd meters (5/4, 7/8) | ❌ Powers of 2 only | Approximate with polyrhythm |
| Triplets | ❌ Not yet | Phase B: 12/24 step counts |

#### Articulation & Expression
| Feature | Status | Workaround |
|---------|--------|------------|
| Attack character | ❌ | Playback mode (oneshot/gate) |
| Staccato/legato | ❌ | Gate length not controllable |
| Release tails | ❌ | Synthesis parameter |

### The Three Architectural Walls

These are fundamental limitations that cannot be fixed without complete redesign:

**Codebase reference:** [`docs/research/MUSICAL-COVERAGE-ANALYSIS.md:146-191`](../../docs/research/MUSICAL-COVERAGE-ANALYSIS.md#L146-L191)

#### 1. The Pitch Wall
- **12-TET only** — No microtones, quarter-tones
- **Blocks:** Maqam music, Indian classical, Turkish music, "blue notes"
- **Why:** Entire pitch system assumes 12 equal semitones

#### 2. The Timing Wall
- **Quantized grid** — Required for multiplayer sync
- **Blocks:** Rubato, expressive timing, micro-timing "feel"
- **Why:** Multiple users editing simultaneously requires shared grid

#### 3. The Platform Wall
- **Web Audio latency** (~30-100ms)
- **Blocks:** Live performance monitoring, real-time MIDI input
- **Why:** Browser audio is not designed for <10ms latency

### Musical Surface Coverage

**Codebase reference:** [`docs/research/MUSICAL-COVERAGE-ANALYSIS.md:25-58`](../../docs/research/MUSICAL-COVERAGE-ANALYSIS.md#L25-L58)

| Genre | Today | With Roadmap | Notes |
|-------|-------|--------------|-------|
| House/Techno | 95% | 95% | Excellent fit |
| Disco | 90% | 95% | Strong |
| Synth-pop | 75% | 90% | Good |
| Lo-fi Hip-hop | 50% | 85% | Needs effects |
| Funk | 40% | 85% | Needs triplets |
| Soul/R&B | 35% | 80% | Needs triplets + effects |
| Jazz | 20% | 60% | Limited by grid |
| Rock | 10% | 55% | Needs live instruments |
| Classical | 5% | 30% | Needs expression |
| Maqam/Indian | 0% | 0% | Blocked by pitch wall |

**Summary:** ~35% of music today → ~65% with planned features

---

## The Three-Layer Architecture

The project uses three layers to balance expressiveness vs simplicity:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Plain Text (Human/AI/Community)                       │
│                                                                 │
│  Kick:  x---x---x---x---                                        │
│  Snare: ----x-------x---                                        │
│  HiHat: x-x-x-x-x-x-x-x-                                        │
│                                                                 │
│  • Maximum shareability                                         │
│  • Works in Discord, SMS, email, Reddit                         │
│  • AI can read/write directly                                   │
│  • Rhythm + basic dynamics only                                 │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: Annotated Text (Extended Notation)                    │
│                                                                 │
│  Kick:  x---x---x---x--- [transpose:-2, swing:60]               │
│  Bass:  x-------x------- [synth:acid, pitches:[0,7,5,3]]        │
│                                                                 │
│  • Still clipboard-friendly                                     │
│  • Machine-parseable with regex                                 │
│  • Pitch sequences, synthesis hints                             │
│  • Graceful degradation (ignore unknown annotations)            │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: Rich Clipboard / JSON (Full Fidelity)                 │
│                                                                 │
│  {                                                              │
│    format: "keyboardia/track/v1",                               │
│    tracks: [{                                                   │
│      steps: [true,false,false,false,...],                       │
│      parameterLocks: [{pitch:0,volume:1.0}, null, ...],         │
│      instrument: "kick-808",                                    │
│      stepCount: 16,                                             │
│      transpose: -2                                              │
│    }],                                                          │
│    tempo: 120,                                                  │
│    swing: 60                                                    │
│  }                                                              │
│                                                                 │
│  • Full parameter lock detail                                   │
│  • Round-trip with app state                                    │
│  • Future-proof (add fields without breaking)                   │
└─────────────────────────────────────────────────────────────────┘
```

**Codebase reference:** [`specs/ROADMAP.md:1685-1704`](../ROADMAP.md#L1685-L1704) (Rich Clipboard Format)

---

## Notation and JSON API Relationship

### Internal Data Model

**Codebase reference:** [`app/src/worker/types.ts:14-30`](../../app/src/worker/types.ts#L14-L30)

```typescript
interface SessionTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];                    // Up to 64 steps
  parameterLocks: (ParameterLock | null)[];  // Up to 64 slots
  volume: number;
  muted: boolean;
  soloed?: boolean;
  playbackMode: PlaybackMode;          // 'oneshot' | 'gate'
  transpose: number;                   // -12 to +12 semitones
  stepCount?: number;                  // 1-64, defaults to 16
}

interface ParameterLock {
  pitch?: number;    // Semitones offset (-12 to +12)
  volume?: number;   // 0-1 multiplier on track volume
}
```

### JSON ↔ Text Notation Mapping

| JSON Property | Text Notation |
|---------------|---------------|
| `steps: [true, false, false, false, ...]` | `x---x---x---x---` |
| `parameterLocks[i].volume = 0.3` | `o` (ghost note) |
| `parameterLocks[i].volume = 1.0` | `X` (accent) |
| `parameterLocks[i].pitch = 5` | `[pitches:...,5,...]` |
| `tempo: 120` | `[bpm:120]` |
| `swing: 60` | `[swing:60]` |
| `stepCount: 32` | `[stepCount:32]` |
| `transpose: -2` | `[transpose:-2]` |

### Round-Trip Translation

```
Text → JSON:
  "x---x---" → { steps: [true,false,false,false,true,false,false,false] }

JSON → Text:
  { steps: [true,false,false,false,...] } → "x---..."
```

The translation is **lossy** in one direction:
- **Text → JSON:** Lossless (all notation maps to data)
- **JSON → Text:** Potentially lossy (synthesis params may not be representable)

---

## Future Features and Notation Impact

### Phase A: Effects Engine

**Codebase reference:** [`specs/ROADMAP.md:473-574`](../ROADMAP.md#L473-L574)

**New capabilities:** Reverb, delay per track

**Notation extension:**
```
Lead: x-x-x-x-x-x-x-x- [reverb:hall@50%, delay:1/8@30%]
```

### Phase B: Triplet Mode

**Codebase reference:** [`specs/ROADMAP.md:577-638`](../ROADMAP.md#L577-L638)

**New capabilities:** 12 and 24 step counts for triplet grids

**Notation impact:** Display triplet steps in groups of 3:
```
Snare: x--x--x--x-- [stepCount:12, triplet:true]
```

### Phase C: Extended Pitch Range

**New capabilities:** ±24 semitones (4 octaves)

**Notation impact:** Widen chromatic view, allow larger pitch annotations

### Phase F: Filter Automation

**Codebase reference:** [`specs/ROADMAP.md:905-959`](../ROADMAP.md#L905-L959)

**New capabilities:** Per-step filter cutoff locks

**Notation extension:**
```
Bass: x-------x------- [filter:100,80,60,40,...]
```

### Phase 19: Advanced Synthesis

**Codebase reference:** [`specs/ROADMAP.md:1374-1675`](../ROADMAP.md#L1374-L1675)

**New capabilities:** Dual oscillators, LFO, filter envelope, effects chain

**Notation approach:** These do NOT extend the pattern format. Synthesis configuration stays in app/preset:
```
Bass: x-------x------- [synth:supersaw, lfo:filter@5Hz]
```

The pattern (`x-------`) remains unchanged; synthesis is metadata.

---

## Design Principles for Evolution

### For Human Writers

1. **One symbol = one step** — Never require multi-character step representations
2. **Metadata in brackets** — Keep pattern itself clean
3. **Optional complexity** — Simple patterns work without annotations
4. **Monospace assumption** — Alignment is part of the meaning

### For Human Readers

1. **Visual rhythm** — The pattern should "look like" the sound
2. **No hidden state** — Everything visible in the text
3. **Left-to-right time** — First character = first beat
4. **Whitespace tolerance** — `x - - -` = `x---`

### For Machine Writers (AI)

1. **Context-free grammar** — Each line parseable independently
2. **No escape sequences** — Characters mean what they are
3. **Predictable structure** — `Label: pattern [metadata]`
4. **Round-trip safe** — Parse → generate → parse = identical

### For Machine Readers (Parsers)

1. **No lookahead required** — Parse character by character
2. **Explicit > implicit** — No defaults hidden in syntax
3. **Error-tolerant** — Unknown characters can be ignored or flagged
4. **Versioned format** — `keyboardia/track/v1` allows evolution

### What Could Be Added (Low Complexity Cost)

| Feature | Proposed Notation | Complexity |
|---------|-------------------|------------|
| Pitch sequence | `[pitches:0,7,5,3]` | Low |
| Probability | `?` for 50% chance | Low |
| Triplet marker | `[triplet]` | Low |
| Filter cutoff | `[filter:50]` | Medium |
| Velocity curve | `[vel:0.3,0.5,0.7,1.0]` | Medium |

### What Should NOT Be Added (Complexity Too High)

| Feature | Why Not |
|---------|---------|
| Inline pitch names | `C4--D4--E4--` breaks fixed-width |
| Continuous curves | `x~~~x` ambiguous, hard to parse |
| Nested patterns | `[x---][x-x-]` adds nesting complexity |
| Effect chains | Too many parameters for inline |
| MIDI CC values | 128 × steps = data explosion |

### The Guiding Principle

The notation should express **musical intent**, not **synthesis parameters**:

```
NOTATION (intent)          →    APP (realization)
"x---x---x---x---"         →    Kick drum at 120 BPM
"[synth:acid]"             →    303-style filter + waveform
"[swing:60]"               →    Timing adjustments
```

This separation keeps the notation **simple and eternal** while allowing the application to evolve with new synthesis capabilities.

---

## References

### Academic Sources

1. **Whitehead, A.N.** (1911). *An Introduction to Mathematics*. Chapter 5: The Symbolism of Mathematics.
   - Foundation for notation as cognitive offloading

2. **Star, S.L. & Griesemer, J.R.** (1989). "Institutional Ecology, 'Translations' and Boundary Objects: Amateurs and Professionals in Berkeley's Museum of Vertebrate Zoology, 1907-39." *Social Studies of Science*, 19(3), 387-420.
   - Theoretical foundation for notation as boundary object

3. **Klimes, K.** (2022). "Design for Emergence." kaseyklimes.com.
   - Framework for designing emergent systems

4. **Eno, B.** (1996). "Generative Music." In Motion Magazine interview.
   - Philosophy of emergence in music systems

5. **Suchman, L.** (1987). *Plans and Situated Actions: The Problem of Human-Machine Communication*. Cambridge University Press.
   - Theoretical foundation for situated design

### Codebase References

| Document | Path | Relevant Sections |
|----------|------|-------------------|
| Emergence Research | [`specs/research/EMERGENCE.md`](./EMERGENCE.md) | Whitehead notation (L46-57), Boundary objects (L293-299), Emergence equation (L556-561) |
| Musical Coverage | [`docs/research/MUSICAL-COVERAGE-ANALYSIS.md`](../../docs/research/MUSICAL-COVERAGE-ANALYSIS.md) | Coverage map (L25-58), Architectural limits (L146-191), Notation examples (L232-334) |
| UI Philosophy | [`specs/UI-PHILOSOPHY.md`](../UI-PHILOSOPHY.md) | OP-Z principles informing notation simplicity |
| Roadmap | [`specs/ROADMAP.md`](../ROADMAP.md) | Rich clipboard (L1685-1704), Effects (L473-574), Synthesis (L1374-1675) |
| Type Definitions | [`app/src/worker/types.ts`](../../app/src/worker/types.ts) | SessionTrack (L14-26), ParameterLock (L28-30) |
| Main Spec | [`specs/SPEC.md`](../SPEC.md) | Step sequencer (L99-158), Parameter locks (L231-250) |

### External Notation Systems

- [ABC Notation Standard](https://abcnotation.com/) — Text-based music notation
- [MusicXML](https://www.musicxml.com/) — Structured music interchange format
- [MIDI Specification](https://www.midi.org/specifications) — Binary music data standard

### Hardware Inspirations

- **Ableton Learning Music** — Grid interface, immediate feedback ([`specs/research/ABLETON-LEARNING-MUSIC-ANALYSIS.md`](./ABLETON-LEARNING-MUSIC-ANALYSIS.md))
- **Teenage Engineering OP-Z** — UI philosophy ([`specs/UI-PHILOSOPHY.md`](../UI-PHILOSOPHY.md))
- **Elektron Digitakt** — Per-track polyrhythm handling ([`specs/SPEC.md:157`](../SPEC.md#L157))
- **Roland TR-808/909** — 16-step paradigm, `x`/`-` visual metaphor

---

## Appendix A: Grammar Specification

### EBNF Grammar (Informal)

```ebnf
session     = { track_line } ;
track_line  = [ label ":" ] pattern [ metadata ] newline ;
label       = identifier ;
pattern     = { step } ;
step        = "x" | "-" | "o" | "X" ;
metadata    = "[" key_value { "," key_value } "]" ;
key_value   = key ":" value ;
key         = identifier ;
value       = number | string | array ;
array       = "[" value { "," value } "]" ;
```

### Example Parse

```
Input:  "Kick: x---x---x---x--- [bpm:120, swing:60]"

Parsed:
{
  label: "Kick",
  pattern: [true, false, false, false, true, false, false, false, ...],
  metadata: {
    bpm: 120,
    swing: 60
  }
}
```

---

## Appendix B: Notation Evolution Timeline

| Version | Features | Status |
|---------|----------|--------|
| v1.0 | Basic `x`/`-` patterns | ✅ Implemented |
| v1.1 | Ghost (`o`) and accent (`X`) | ✅ Implemented |
| v1.2 | Bracket metadata (`[key:value]`) | ✅ Implemented |
| v2.0 | Rich clipboard format | 🔜 Phase 20 |
| v2.1 | Triplet notation (`[triplet]`) | 🔜 Phase B |
| v2.2 | Filter automation (`[filter:...]`) | 🔜 Phase F |

---

*This document captures the design philosophy, theoretical foundations, and practical constraints of Keyboardia's session notation system as of December 2025.*
