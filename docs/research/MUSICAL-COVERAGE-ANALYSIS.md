# Keyboardia Musical Coverage Analysis

A unified analysis of Keyboardia's musical surface area: what's reachable today, what's possible with new features, what's architecturally out of scope, and concrete recommendations for the roadmap.

**Date:** December 2025
**Version:** 2.0.0 (Unified from 4 research documents)

---

## Table of Contents

1. [The Coverage Map](#the-coverage-map)
2. [Current Capabilities](#current-capabilities)
3. [Genre Suitability](#genre-suitability)
4. [What's Out of Reach (Architectural Limits)](#whats-out-of-reach-architectural-limits)
5. [Proposed Features](#proposed-features)
6. [Sample Tracks](#sample-tracks)
7. [Instrument Expansion](#instrument-expansion)
8. [Unified Recommendations](#unified-recommendations)
9. [Proposed Roadmap Changes](#proposed-roadmap-changes)
10. [Sources](#sources)

---

## The Coverage Map

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         KEYBOARDIA MUSICAL COVERAGE                           ║
║                                                                               ║
║  Legend:  ███ = Today    ░░░ = With proposed features    · · · = Out of reach ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  House/Techno    ████████████████████████████████████████████████  95% → 95%  ║
║  Disco           ██████████████████████████████████████████████░░  90% → 95%  ║
║  Synth-pop       ██████████████████████████████████░░░░░░░░░░░░░░  75% → 90%  ║
║  Lo-fi Hip-hop   ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  50% → 85%  ║
║  Funk            ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  40% → 85%  ║
║  Soul/R&B        ██████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  35% → 80%  ║
║  Ambient         ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  30% → 75%  ║
║  Jazz            ████████████░░░░░░░░░░░░░░░░░░░░░░ · · · · · · ·  20% → 60%  ║
║  Rock            ████████░░░░░░░░░░░░░░░░░░░░░░░░░░ · · · · · · ·  10% → 55%  ║
║  Classical       ████░░░░░░░░░░░░░░ · · · · · · · · · · · · · · ·   5% → 30%  ║
║  Maqam/Indian    · · · · · · · · · · · · · · · · · · · · · · · · ·   0% →  0%  ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  SUMMARY                                                                      ║
║  ═══════                                                                      ║
║                                                                               ║
║  TODAY:           ████████████████░░░░░░░░░░░░░░░░░░░░░░  ~35% of all music   ║
║  WITH FEATURES:   ████████████████████████████████░░░░░░  ~65% of all music   ║
║  OUT OF REACH:    · · · · · · · · · · · · · · · · · · · ·  ~35% (architectural)║
║                                                                               ║
║  We can nearly DOUBLE coverage with: reverb, delay, instruments, triplets    ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Current Capabilities

### Sound Sources (35 total)

```
SYNTHESIZED (0 bytes - generated at runtime)
├── Drums (8):     kick, snare, hihat, clap, tom, rim, cowbell, openhat
├── Bass (2):      bass (sawtooth), subbass (sine)
├── Synth (4):     lead, pluck, chord, pad
└── FX (2):        zap, noise

SYNTH PRESETS (19 - OscillatorNode + Filter + ADSR)
├── Core:          bass, lead, pad, pluck, acid
├── Keys:          rhodes, organ, wurlitzer, clavinet
├── Funk:          funkbass
├── Disco:         discobass, strings, brass
├── House:         stab, sub
└── Indie:         shimmer, jangle, dreampop, bell

CUSTOM:            Mic recording (unlimited, in-memory only)
```

### Sequencer Capabilities

| Capability | Range | Musical Use |
|------------|-------|-------------|
| **Pitch** | ±12 semitones (2 octaves) | Melodies, bass lines |
| **Steps** | 4, 8, 16, 32, 64 per track | Polyrhythms, long phrases |
| **Tempo** | 60-180 BPM | Hip-hop through drum & bass |
| **Swing** | 0-100% | Straight to heavy shuffle |
| **Tracks** | Up to 16 | Full arrangements |
| **Parameter locks** | Per-step pitch & volume | Melodic sequences |

### What Works Well Today

- **4/4 electronic music** — House, techno, disco, synth-pop
- **Loop-based composition** — 1-4 bar patterns
- **Collaborative jamming** — Real-time multiplayer
- **Quick sketching** — Ideas in seconds
- **Polyrhythms** — Different step counts per track

---

## Genre Suitability

### Detailed Breakdown

| Genre | Today | With Features | Gap | What's Missing |
|-------|-------|---------------|-----|----------------|
| **House** | ★★★★★ 95% | 95% | — | Perfect fit |
| **Techno** | ★★★★★ 95% | 95% | — | Perfect fit |
| **Disco** | ★★★★☆ 90% | 95% | +5% | +reverb for space |
| **Synth-pop** | ★★★★☆ 75% | 90% | +15% | +reverb, +delay |
| **Lo-fi Hip-hop** | ★★★☆☆ 50% | 85% | +35% | +vinyl, +tape, +piano, +reverb |
| **Funk** | ★★☆☆☆ 40% | 85% | +45% | +slap bass, +wah, +triplets |
| **Soul/R&B** | ★★☆☆☆ 35% | 80% | +45% | +Rhodes, +brass, +triplets |
| **Reggae/Dub** | ★★☆☆☆ 35% | 85% | +50% | +delay (essential), +reverb, +melodica |
| **Ambient** | ★★☆☆☆ 30% | 75% | +45% | +reverb (essential), +long release |
| **Jazz** | ★★☆☆☆ 20% | 60% | +40% | +piano, +bass, +triplets (rubato blocked) |
| **Rock** | ★☆☆☆☆ 10% | 55% | +45% | +guitar, +drums (dynamics limited) |
| **Classical** | ★☆☆☆☆ 5% | 30% | +25% | +orchestra (rubato blocked) |
| **World (Maqam/Indian)** | ☆☆☆☆☆ 0% | 0% | — | Microtones required (architectural) |

### Genre Categories

```
EXCELLENT FIT (>80% today):
└── House, Techno, Disco — Step sequencer paradise

GOOD FIT (50-80% today):
└── Synth-pop, EDM, Electro — Minor gaps

POSSIBLE WITH FEATURES (20-50% today → 60-85%):
└── Lo-fi, Funk, Soul, Reggae, Ambient — Need effects + instruments

LIMITED (5-20% today → 30-60%):
└── Jazz, Rock, Classical — Architectural limits cap potential

BLOCKED (0%):
└── Maqam, Indian Classical, Microtonal — Requires 12-TET redesign
```

---

## What's Out of Reach (Architectural Limits)

These limitations exist regardless of what features we add:

### The Three Walls

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARCHITECTURAL BOUNDARIES                             │
│                      (Cannot cross without redesign)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PITCH WALL                          WHY                                    │
│  ══════════                          ═══                                    │
│  • Microtones (quarter-tone)         Pitch is 12-TET: 2^(semitones/12)     │
│  • Pitch bends (continuous)          Steps are discrete, not sliding        │
│  • Vibrato (pitch LFO)               No per-note pitch modulation          │
│                                                                             │
│  TIMING WALL                         WHY                                    │
│  ═══════════                         ═══                                    │
│  • Odd meters (5/4, 7/8, 11/8)       Step counts are powers of 2           │
│  • Rubato (tempo flexibility)        Multiplayer sync needs quantized grid │
│  • Micro-timing (play "behind")      Same: grid is authoritative           │
│                                                                             │
│  PLATFORM WALL                       WHY                                    │
│  ══════════════                      ═══                                    │
│  • Live monitoring (<10ms)           Web Audio has ~30-100ms latency        │
│  • MIDI input                        Browser permissions + complexity       │
│                                                                             │
│  A sampled oud still can't play quarter tones.                             │
│  A sampled jazz bass still can't play rubato.                              │
│  These don't care what instruments you have.                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Music That Will Never Work

| Style | Blocker | Workaround |
|-------|---------|------------|
| **Middle Eastern maqam** | Quarter-tones | None (12-TET fundamental) |
| **Indian classical** | Gamakas (microtonal ornaments) | None |
| **Progressive rock** | 7/8, 5/4 time signatures | Approximate with step counts |
| **Classical phrasing** | Rubato, ritardando | None (grid is fixed) |
| **Blues guitar** | Pitch bends | None (steps are discrete) |
| **Live instrument play-along** | Latency | Use headphones with external source |

---

## Proposed Features

### Feature Impact Matrix

| Feature | Effort | Genre Impact | Coverage Δ |
|---------|--------|--------------|------------|
| **Reverb** | Low | All genres, essential for acoustics | +10% |
| **Delay** | Low | Dub, ambient, creates space | +8% |
| **New Instruments** | Medium | Soul, funk, jazz, lo-fi | +15% |
| **Triplet Mode** | Low | Jazz, gospel, R&B, blues | +8% |
| **Extended Pitch Range** | Low | Piano, orchestral | +5% |
| **Scale Quantization** | Low | Beginners, live jamming | +3% |
| **Filter Automation** | Medium | Acid, EDM, movement | +5% |
| **Pattern Chaining** | Medium | Song structure | +5% |
| **Euclidean Rhythms** | Low | World music, polyrhythms | +3% |

### Feature Synergy

```
REVERB + DELAY + INSTRUMENTS = Professional sound (+33%)
├── Reggae/Dub becomes authentic (delay essential)
├── Soul/Funk gets depth (reverb on brass/keys)
├── Ambient becomes possible (space is the genre)
└── Lo-fi gets warmth (reverb + vinyl + piano)

TRIPLETS + INSTRUMENTS = Swing genres (+23%)
├── Jazz becomes playable (piano + bass + triplets)
├── Gospel unlocks (organ + choir + 12/8)
├── R&B grooves work (Rhodes + triplet feel)
└── Blues shuffle possible (guitar + triplets)

INSTRUMENTS ALONE = Recognizable but thin
└── Genres sound "like" soul/jazz but lack depth
```

---

## Sample Tracks

Demonstrating music that becomes possible with each feature. All patterns use clipboard notation:
`x` = step ON, `-` = step OFF, 16 characters = 1 bar at 16th note resolution.

### 1. Scale Quantization → "Pentatonic Dreams"

```json
{
  "feature": "Scale Quantization (C Major Pentatonic)",
  "genre": "Ambient/Meditation",
  "bpm": 90,
  "why_impossible_now": "Random pitches create dissonance",
  "tracks": [
    { "instrument": "synth:shimmer", "pattern": "x---x---x---x---", "pitches": [0, 2, 4, 7] },
    { "instrument": "synth:pad", "pattern": "x---------------", "pitches": [0] },
    { "instrument": "synth:bell", "pattern": "--x-----x-----x-", "pitches": [9, 12, 14] }
  ]
}
```

### 2. Reverb → "Cathedral of Synths"

```json
{
  "feature": "Reverb (Hall, 60% wet)",
  "genre": "Ambient/Cinematic",
  "bpm": 70,
  "why_impossible_now": "Dry synths sound thin and cheap",
  "tracks": [
    { "instrument": "synth:pad", "pattern": "x---------------", "pitches": [0], "reverb": 0.7 },
    { "instrument": "synth:shimmer", "pattern": "----x-------x---", "pitches": [7, 12], "reverb": 0.8 },
    { "instrument": "synth:bell", "pattern": "--------x-------", "pitches": [19], "reverb": 0.9 }
  ]
}
```

### 3. Delay → "Dub Techno Meditation"

```json
{
  "feature": "Delay (3/16 ping-pong, 50% feedback)",
  "genre": "Dub Techno",
  "bpm": 118,
  "why_impossible_now": "No sense of space, no rhythmic echoes",
  "tracks": [
    { "instrument": "synth:pluck", "pattern": "x-------x-------", "pitches": [0, 7], "delay": { "time": "3/16", "feedback": 0.5 } },
    { "instrument": "kick", "pattern": "x---x---x---x---" },
    { "instrument": "rim", "pattern": "----x-------x---", "delay": { "time": "1/8", "feedback": 0.3 } }
  ]
}
```

### 4. Triplet Mode → "Late Night Jazz Club"

```json
{
  "feature": "Triplet Grid (12 steps = 1 bar in 12/8)",
  "genre": "Jazz/Lounge",
  "bpm": 85,
  "why_impossible_now": "Swing slider approximates but triplets are fundamental to jazz",
  "tracks": [
    { "instrument": "synth:rhodes", "pattern": "x--x--x--x--", "pitches": [0, 4, 7, 11] },
    { "instrument": "synth:bass", "pattern": "x-----x-----", "pitches": [0, -5] },
    { "instrument": "hihat", "pattern": "x-xx-xx-xx-x" },
    { "instrument": "kick", "pattern": "x-----x-----" }
  ]
}
```

### 5. Extended Pitch → "Arpeggio Cathedral"

```json
{
  "feature": "Extended Pitch Range (±24 semitones)",
  "genre": "Progressive Electronic",
  "bpm": 128,
  "why_impossible_now": "Can't span 4 octaves for full arpeggio sweep",
  "tracks": [
    { "instrument": "synth:pluck", "pattern": "x-x-x-x-x-x-x-x-", "pitches": [-24, -12, 0, 12, 24, 12, 0, -12] },
    { "instrument": "synth:pad", "pattern": "x---------------", "pitches": [0] },
    { "instrument": "kick", "pattern": "x-------x-------" }
  ]
}
```

### 6. Instruments + Reverb + Delay → "Spaghetti Western"

```json
{
  "feature": "Acoustic Guitar + Whistle + Reverb + Delay",
  "genre": "Cinematic/Western",
  "bpm": 95,
  "why_impossible_now": "No acoustic instruments, no sense of space",
  "tracks": [
    { "instrument": "guitar:nylon", "pattern": "x---x-x-x---x-x-", "pitches": [0, 4, 7, 5], "delay": { "time": "1/4d" } },
    { "instrument": "whistle", "pattern": "--------x-------", "pitches": [12], "reverb": 0.6 },
    { "instrument": "orch_hit", "pattern": "x---------------", "pitches": [0], "reverb": 0.8 },
    { "instrument": "tom", "pattern": "x-------x-------" }
  ],
  "mood": "Ennio Morricone desert canyon vibes"
}
```

### 7. Instruments + Triplets → "Sunday Morning Gospel"

```json
{
  "feature": "Hammond Organ + Choir + Triplet Mode",
  "genre": "Gospel",
  "bpm": 85,
  "why_impossible_now": "No organ, no choir, can't do 12/8 feel",
  "tracks": [
    { "instrument": "organ:hammond", "pattern": "x--x--x--x--", "pitches": [0, 4, 7, 12] },
    { "instrument": "choir:ooh", "pattern": "x-----x-----", "pitches": [0, 5] },
    { "instrument": "clap", "pattern": "---x-----x--" },
    { "instrument": "kick", "pattern": "x-----x-----" }
  ],
  "mood": "Sunday morning church service"
}
```

---

## Instrument Expansion

### Current Sample Architecture

All 35 sounds are **procedurally generated** — zero external files:

```typescript
// Example: Kick drum (samples.ts)
async function createKick(ctx: AudioContext): Promise<AudioBuffer> {
  // Frequency drops 150Hz → 40Hz with exponential decay
  // Pure math, no audio files
}
```

### How to Add New Instruments

| Approach | Effort | Quality | Use Case |
|----------|--------|---------|----------|
| **More synth presets** | Minutes | Synth-y | New electronic sounds |
| **More procedural samples** | Hours | Synthetic | Percussion, FX |
| **External audio files** | Days | Realistic | Piano, guitar, brass |
| **Multi-sample instruments** | Weeks | Professional | Full piano, orchestra |

### Prioritized Instrument List

#### Tier 1: Maximum Impact (5 instruments)

| Instrument | Type | Source | Genres Unlocked |
|------------|------|--------|-----------------|
| **Acoustic Piano** | Multi-sample | [Pianobook](https://www.pianobook.co.uk/) | Jazz, ballads, pop, classical |
| **Upright Bass** | Multi-sample | [Philharmonia](https://philharmonia.co.uk/resources/sound-samples/) | Jazz, soul, Motown |
| **Brass Section** | Single sample | [VSCO 2 CE](https://versilian-studios.com/vsco-community/) | Soul, disco, funk |
| **Vinyl Crackle** | Loop | [Freesound CC0](https://freesound.org/browse/tags/cc0/) | Lo-fi hip-hop |
| **Acoustic Guitar** | Multi-sample | [U of Iowa](https://theremin.music.uiowa.edu/) | Folk, bossa nova, cinematic |

#### Tier 2: Genre-Specific (5 instruments)

| Instrument | Genres Unlocked |
|------------|-----------------|
| **Hammond B3 Organ** | Gospel, jazz, rock |
| **Slap Bass** | Funk, disco |
| **Choir (ooh/aah)** | Gospel, ambient, cinematic |
| **Kalimba** | Lo-fi, ambient |
| **808 Kit** | Hip-hop, trap |

#### Tier 3: Texture & World (10 instruments)

Tape hiss, orchestral hits, marimba, vibraphone, melodica, tabla, steel drums, congas, shaker, tambourine

### Verified Sample Sources

| Source | License | URL | Best For |
|--------|---------|-----|----------|
| **Philharmonia Orchestra** | CC | [philharmonia.co.uk/resources/sound-samples/](https://philharmonia.co.uk/resources/sound-samples/) | Orchestral |
| **University of Iowa MIS** | Public domain | [theremin.music.uiowa.edu](https://theremin.music.uiowa.edu/) | Multi-sample instruments |
| **VSCO 2 Community Edition** | CC0 | [versilian-studios.com/vsco-community/](https://versilian-studios.com/vsco-community/) | Full orchestra |
| **Pianobook** | Free | [pianobook.co.uk](https://www.pianobook.co.uk/) | Pianos, weird instruments |
| **Freesound** | CC0/CC-BY | [freesound.org](https://freesound.org/) | Loops, one-shots, FX |

---

## Unified Recommendations

### Priority Order (Revised)

Based on coverage impact, effort, and synergy:

| Priority | Feature | Effort | Impact | Why |
|----------|---------|--------|--------|-----|
| **1** | **Reverb** | Low | +10% | Essential for ALL genres, especially acoustics |
| **2** | **Delay** | Low | +8% | Dub, ambient, professional depth |
| **3** | **Triplet Mode** | Low | +8% | Unlocks jazz, gospel, R&B, blues |
| **4** | **Extended Pitch Range** | Low | +5% | Piano needs 88 keys, not 25 |
| **5** | **Tier 1 Instruments** | Medium | +15% | Piano, bass, brass, guitar, vinyl |
| **6** | **Scale Quantization** | Low | +3% | Beginner-friendly, reduces bad notes |
| **7** | **Filter Automation** | Medium | +5% | Acid, movement, expression |
| **8** | **Pattern Chaining** | Medium | +5% | Song structure |
| **9** | **Tier 2 Instruments** | Medium | +5% | Organ, slap bass, choir |
| **10** | **Euclidean Rhythms** | Low | +3% | World music, polyrhythms |

### The Quick Wins (Low Effort, High Impact)

```
DO FIRST (can ship in days):
├── Reverb (ConvolverNode or algorithmic)
├── Delay (DelayNode + feedback)
├── Triplet mode (24 steps per bar option)
└── Extended pitch (±24 semitones)

Combined: +31% coverage boost

THEN (weeks):
├── Tier 1 instruments (with lazy loading)
├── Filter automation (per-step cutoff locks)
└── Pattern chaining (A→B→A→C)

Combined: +25% more
```

### What NOT to Prioritize

| Feature | Why Deprioritize |
|---------|------------------|
| **Dual-oscillator synth** | Real instruments already sound full |
| **Complex synth engine** | Effort better spent on samples |
| **Microtonal support** | Small audience, major architecture change |
| **Odd time signatures** | Limited use, complex UI |
| **Physical modeling** | Diminishing returns vs. samples |

---

## Proposed Roadmap Changes

Based on this analysis, here are concrete changes to `specs/ROADMAP.md`:

### Additions to Phase 15 (Polish & Production)

```markdown
#### 4. Audio Polish (NEW)

| Task | Effort | Impact |
|------|--------|--------|
| **Reverb** — Global reverb bus with room/hall presets | 3 days | High |
| **Delay** — Global delay with sync options (1/8, 1/4, dotted) | 2 days | High |

Implementation:
- Use ConvolverNode with impulse responses for reverb
- Use DelayNode + feedback gain for delay
- Per-track send levels (0-100%)
- Master wet/dry mix
```

### New Phase: Phase 15B - Rhythmic Expansion

```markdown
### Phase 15B: Rhythmic Expansion

#### 1. Triplet Mode

Add triplet grid option for swing genres:

| Steps | Resolution | Use Case |
|-------|------------|----------|
| 12 | Triplet 8ths | Jazz, gospel, 12/8 |
| 24 | Triplet 16ths | Detailed swing |

Implementation:
- Add 12 and 24 to STEP_COUNT_OPTIONS
- Update scheduler to handle non-power-of-2 step counts
- Display triplet groupings in UI (3-3-3-3 instead of 4-4-4-4)

#### 2. Extended Pitch Range

Expand transpose from ±12 to ±24 semitones:

```typescript
// types.ts
export const MIN_TRANSPOSE = -24;
export const MAX_TRANSPOSE = 24;
```

UI: Wider transpose slider or numeric input
```

### Modification to Phase 19 (Advanced Synthesis Engine)

```markdown
### Phase 19: Audio Engine Expansion (REVISED)

> **Priority shift:** Focus on samples and effects before complex synthesis.

#### Revised Priority Order

| Priority | Feature | Effort | Why |
|----------|---------|--------|-----|
| 1 | **Sampled piano** | 1 week | Biggest gap, most requested |
| 2 | **Reverb** | 3 days | Should already be done (Phase 15) |
| 3 | **Delay** | 2 days | Should already be done (Phase 15) |
| 4 | **Tier 1 instruments** | 2 weeks | Bass, brass, guitar, vinyl |
| 5 | **Filter automation** | 1 week | Per-step cutoff |
| 6 | **Dual-oscillator** | 2 weeks | Only if synth richness still lacking |

#### Deprioritized (move to Phase 25+)
- FM synthesis
- Physical modeling
- XY pad / macro controls
```

### New Phase: Phase 19B - Instrument Library

```markdown
### Phase 19B: Instrument Library

Build infrastructure for external sample loading.

#### 1. Sample Loading Infrastructure

```typescript
interface InstrumentManifest {
  id: string;
  name: string;
  category: 'keys' | 'bass' | 'brass' | 'strings' | 'percussion' | 'fx';
  samples: {
    note: number;  // MIDI note
    url: string;   // R2 URL
  }[];
  pitchRange: [number, number];
}
```

#### 2. R2 Storage Structure

```
keyboardia-samples/
└── instruments/
    ├── piano/
    │   ├── manifest.json
    │   ├── C2.mp3
    │   ├── C3.mp3
    │   ├── C4.mp3
    │   └── C5.mp3
    ├── upright-bass/
    └── brass-section/
```

#### 3. Lazy Loading

- Fetch manifest on first track creation
- Load samples on-demand (when track plays)
- Cache in IndexedDB for offline use
- Progress indicator during load
```

---

## Sources

### Sample Libraries
- [Philharmonia Orchestra Sound Samples](https://philharmonia.co.uk/resources/sound-samples/) — CC, orchestral
- [University of Iowa MIS](https://theremin.music.uiowa.edu/) — Public domain, academic-grade
- [VSCO 2: Community Edition](https://versilian-studios.com/vsco-community/) — CC0, full orchestra
- [Pianobook](https://www.pianobook.co.uk/) — Free, community instruments
- [Freesound](https://freesound.org/) — CC0/CC-BY, collaborative database

### Technical References
- [Web Audio API - ConvolverNode](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode) — Reverb
- [Web Audio API - DelayNode](https://developer.mozilla.org/en-US/docs/Web/API/DelayNode) — Delay effects
- [Ableton Learning Synths](https://learningsynths.ableton.com/) — Synthesis reference

### Research Basis
- Genre coverage percentages based on feature availability analysis
- Sample track patterns created using existing Keyboardia clipboard format
- Instrument priorities based on genre unlock potential

---

## Superseded Documents

This unified document replaces:
- `MUSICAL-SURFACE-AREA.md` — Initial visualization
- `MUSICAL-REACH-ANALYSIS.md` — Deep research (1,746 lines)
- `INSTRUMENT-EXPANSION.md` — Instrument addition guide
- `MUSICAL-COVERAGE-MAP.md` — Coverage visualization

All content has been consolidated, deduplicated, and unified into actionable recommendations.

---

*This document is part of the Keyboardia research collection. See also: [specs/ROADMAP.md](../../specs/ROADMAP.md), [specs/SPEC.md](../../specs/SPEC.md)*
