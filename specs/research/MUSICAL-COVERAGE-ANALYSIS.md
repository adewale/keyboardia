# Keyboardia Musical Coverage Analysis

A unified analysis of Keyboardia's musical surface area: what's reachable today, what's possible with new features, what's architecturally out of scope, and concrete recommendations for the roadmap.

**Date:** December 2025
**Version:** 3.0.0 (Updated for Phase 23 implementation)

> **Implementation Guide:** For step-by-step instructions on adding new instruments, see [INSTRUMENT-EXPANSION.md](./INSTRUMENT-EXPANSION.md)

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

### Sound Sources (68 total)

```
SYNTHESIZED SAMPLES (16 - generated at runtime via Web Audio API)
├── Drums (8):     kick, snare, hihat, clap, tom, rim, cowbell, openhat
├── Bass (2):      bass (sawtooth), subbass (sine)
├── Synth (4):     lead, pluck, chord, pad
└── FX (2):        zap, noise

WEB AUDIO SYNTH PRESETS (32 - OscillatorNode + Filter + ADSR + LFO)
├── Core (5):      bass, lead, pad, pluck, acid
├── Keys (6):      rhodes, organ, wurlitzer, epiano, vibes, clavinet, organphase
├── Funk (2):      funkbass, clavinet
├── Disco (3):     discobass, strings, brass
├── House (2):     stab, sub
├── Atmospheric (8): shimmer, jangle, dreampop, bell, evolving, sweep, warmpad, glass
├── Electronic (4): supersaw, hypersaw, wobble, growl
└── Bass (2):      reese, hoover

TONE.JS SYNTH PRESETS (11 - FM, AM, Membrane, Metal)
├── FM (3):        fm-epiano, fm-bass, fm-bell
├── AM (2):        am-bell, am-tremolo
├── Membrane (2):  membrane-kick, membrane-tom
├── Metal (2):     metal-cymbal, metal-hihat
└── Other (2):     pluck-string, duo-lead

ADVANCED SYNTH PRESETS (8 - Dual-oscillator + Filter Envelope + LFO)
├── Leads (3):     supersaw, thick-lead, vibrato-lead
├── Bass (3):      sub-bass, wobble-bass, acid-bass
└── Pads (2):      warm-pad, tremolo-strings

SAMPLED INSTRUMENTS (1 - multi-sample with pitch-shifting)
└── Piano:         4 samples (C2, C3, C4, C5), loaded from R2

CUSTOM:            Mic recording (unlimited, in-memory only)
```

> **Full breakdown:** See [INSTRUMENT-EXPANSION.md](./INSTRUMENT-EXPANSION.md) for implementation details.

### Sequencer Capabilities

| Capability | Range | Musical Use |
|------------|-------|-------------|
| **Pitch** | ±24 semitones (4 octaves) | Melodies, bass lines, sub-bass, high leads |
| **Steps** | 4, 8, 12, 16, 24, 32, 64, 96, 128 per track | Polyrhythms, triplets, full verses |
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

## Proposed Phases

Based on this analysis, here are new phases to add to `specs/ROADMAP.md`. These are ordered by impact and effort, designed to maximize musical coverage expansion.

---

### Phase A: Effects Engine

Add reverb and delay to transform dry synths into professional-sounding output.

> **Research:** See [MUSICAL-COVERAGE-ANALYSIS.md](./MUSICAL-COVERAGE-ANALYSIS.md)
> **Coverage Impact:** +18% (biggest single improvement)

#### Why This Matters

| Without Effects | With Effects |
|-----------------|--------------|
| Dry synths sound thin and cheap | Professional mix quality |
| No sense of space or depth | Realistic acoustic environments |
| Ambient genre impossible | Ambient, dub, cinematic unlocked |
| Lo-fi sounds incomplete | Vinyl + reverb = authentic lo-fi |

#### 1. Reverb

Global reverb bus using ConvolverNode with impulse responses:

```typescript
interface ReverbConfig {
  type: 'room' | 'hall' | 'plate' | 'spring';
  decay: number;      // 0.5 - 10 seconds
  mix: number;        // 0 - 1 (dry/wet)
  preDelay: number;   // 0 - 100ms
}
```

**Presets:**
| Preset | Decay | Use Case |
|--------|-------|----------|
| Small Room | 0.8s | Drums, tight sound |
| Hall | 2.5s | Pads, orchestral |
| Plate | 1.5s | Vocals, snare |
| Cathedral | 5s+ | Ambient, cinematic |

**Implementation:**
1. Create impulse response files or use algorithmic reverb (Freeverb)
2. Add reverb send knob to each track (0-100%)
3. Master reverb mix control in transport area
4. Store reverb settings in session state

**Effort:** 3-5 days

#### 2. Delay

Global delay bus with tempo-sync options:

```typescript
interface DelayConfig {
  time: '1/4' | '1/8' | '1/16' | '3/16' | '1/4d' | number;  // Sync or ms
  feedback: number;   // 0 - 0.9 (higher = more repeats)
  mix: number;        // 0 - 1 (dry/wet)
  pingPong: boolean;  // Stereo ping-pong
  filter: number;     // Low-pass on repeats (darkening)
}
```

**Presets:**
| Preset | Time | Feedback | Use Case |
|--------|------|----------|----------|
| Slapback | 1/16 | 0.2 | Rockabilly, snare |
| Dub | 3/16 | 0.6 | Reggae, dub techno |
| Dotted 8th | 1/8d | 0.4 | U2 style, ambient |
| Tape Echo | 1/4 | 0.5 | Vintage, lo-fi |

**Implementation:**
1. Use DelayNode + feedback GainNode
2. Add delay send knob to each track (0-100%)
3. Tempo-sync calculation: `delayTime = (60 / bpm) * beatFraction`
4. Optional: Add filter on feedback path for tape-style darkening

**Effort:** 2-3 days

#### 3. Per-Track Send Levels

Each track gets send knobs for reverb and delay:

```typescript
interface Track {
  // ... existing fields
  reverbSend: number;  // 0-100, default 0
  delaySend: number;   // 0-100, default 0
}
```

**UI:**
- Add REV and DLY knobs to track controls (collapsed by default)
- Show in expanded track edit panel on mobile
- Quick presets: "Dry", "Wet", "Dub", "Ambient"

#### Success Criteria

- [ ] Reverb adds depth without muddiness
- [ ] Delay syncs to tempo correctly
- [ ] Effects don't add perceptible latency
- [ ] Mobile performance remains smooth
- [ ] Sessions with effects load correctly

**Outcome:** Keyboardia sounds professional. Ambient, dub, and cinematic genres become possible.

---

### Phase B: Triplet Mode

Add triplet grid options for swing-based genres.

> **Coverage Impact:** +8% (unlocks jazz, gospel, R&B, blues)

#### Why This Matters

| Without Triplets | With Triplets |
|------------------|---------------|
| Swing slider approximates | True triplet feel |
| Jazz sounds stiff | Authentic jazz swing |
| Gospel 12/8 impossible | Sunday morning grooves |
| Blues shuffle awkward | Real shuffle rhythm |

#### Implementation

✅ **Implemented** — Triplet grids (12, 24) plus extended lengths (96, 128):

```typescript
// types.ts (current)
export const STEP_COUNT_OPTIONS = [4, 8, 12, 16, 24, 32, 64, 96, 128] as const;
```

| Steps | Resolution | Musical Use |
|-------|------------|-------------|
| 12 | Triplet 8ths (1 bar) | Jazz, gospel, 12/8 grooves |
| 24 | Triplet 16ths (1 bar) | Detailed swing, triplet fills |
| 36 | Triplet 8ths (3 bars) | Extended triplet patterns |
| 48 | Triplet 16ths (2 bars) | Complex swing arrangements |

#### Scheduler Changes

```typescript
// scheduler.ts
const stepsPerBeat = track.stepCount % 3 === 0 ? 3 : 4;
const stepDuration = (60 / tempo) / stepsPerBeat;
```

#### UI Changes

1. **Visual grouping:** Display triplet steps in groups of 3, not 4
   ```
   Standard 16:  [■][■][■][■] [■][■][■][■] [■][■][■][■] [■][■][■][■]
   Triplet 12:   [■][■][■] [■][■][■] [■][■][■] [■][■][■]
   ```

2. **Step count dropdown:** Add 12 and 24 options

3. **Beat markers:** Adjust to show triplet beat boundaries

#### Compatibility

- Triplet tracks can coexist with standard tracks (polyrhythm)
- 12-step track loops 4× per 48-step track (natural alignment)
- Session state unchanged (stepCount is already flexible)

**Effort:** 3-5 days

**Outcome:** Jazz, gospel, R&B, and blues become playable. Swing feels authentic.

---

### Phase C: Extended Pitch Range

Expand transpose range from ±12 to ±24 semitones (4 octaves total).

> **Coverage Impact:** +5% (piano, orchestral, prog)

#### Why This Matters

| Current (±12) | Extended (±24) |
|---------------|----------------|
| 2 octaves | 4 octaves |
| Piano sounds cramped | Full piano range feel |
| Can't do bass-to-lead arpeggios | Sweeping 4-octave arpeggios |
| Orchestral limited | Cello to piccolo range |

#### Implementation

```typescript
// types.ts
export const MIN_TRANSPOSE = -24;  // Was -12
export const MAX_TRANSPOSE = 24;   // Was 12
```

#### UI Changes

1. **Transpose control:** Wider slider or numeric stepper
2. **Chromatic view:** Extend piano roll to show 4 octaves
3. **Quick octave buttons:** -2, -1, 0, +1, +2 octave presets

#### Backward Compatibility

- Existing sessions with ±12 values work unchanged
- New sessions can use full ±24 range
- No migration needed

**Effort:** 1-2 days

**Outcome:** Piano and orchestral arrangements feel complete. Prog-style arpeggios possible.

---

### Phase D: Instrument Library

Add infrastructure for loading external sampled instruments from R2.

> **Coverage Impact:** +15% (soul, funk, jazz, lo-fi, cinematic)

#### Why This Matters

| Synthesized Only | With Sampled Instruments |
|------------------|--------------------------|
| Rhodes sounds like sine wave | Real Rhodes warmth |
| No acoustic piano | Steinway character |
| Brass is buzzy | Real horn section punch |
| Limited to electronic genres | Soul, funk, jazz unlocked |

#### 1. Instrument Manifest Format

```typescript
interface InstrumentManifest {
  id: string;                    // e.g., "piano-steinway"
  name: string;                  // e.g., "Steinway Grand"
  category: 'keys' | 'bass' | 'brass' | 'strings' | 'percussion' | 'fx' | 'texture';
  author?: string;               // Attribution
  license: 'cc0' | 'cc-by' | 'proprietary';
  samples: {
    note: number;                // MIDI note (e.g., 60 = C4)
    url: string;                 // R2 URL
    loopStart?: number;          // For sustained sounds
    loopEnd?: number;
  }[];
  pitchRange: [number, number];  // Playable MIDI range
  defaultVolume?: number;        // 0-1
}
```

#### 2. R2 Storage Structure

```
keyboardia-samples/
└── instruments/
    ├── index.json                    # List of all instruments
    ├── piano-steinway/
    │   ├── manifest.json
    │   ├── C2.mp3 (48kbps, ~50KB)
    │   ├── C3.mp3
    │   ├── C4.mp3
    │   └── C5.mp3
    ├── upright-bass/
    │   ├── manifest.json
    │   └── ...
    ├── brass-section/
    ├── vinyl-crackle/
    └── tape-hiss/
```

#### 3. Sample Loading

```typescript
class SampledInstrument {
  private samples: Map<number, AudioBuffer> = new Map();
  private manifest: InstrumentManifest;

  async load(manifest: InstrumentManifest): Promise<void> {
    this.manifest = manifest;
    // Lazy load - only fetch samples when first played
  }

  async play(note: number, time: number, duration: number): Promise<void> {
    const sample = await this.getSampleForNote(note);
    const source = audioContext.createBufferSource();
    source.buffer = sample;
    source.playbackRate.value = this.calculatePlaybackRate(note);
    source.connect(destination);
    source.start(time);
    source.stop(time + duration);
  }

  private calculatePlaybackRate(targetNote: number): number {
    const nearestSample = this.findNearestSample(targetNote);
    const semitoneOffset = targetNote - nearestSample.note;
    return Math.pow(2, semitoneOffset / 12);
  }
}
```

#### 4. Lazy Loading Strategy

1. **Index fetch:** Load `instruments/index.json` on app start (~1KB)
2. **Manifest fetch:** Load instrument manifest when track created (~500B)
3. **Sample fetch:** Load individual samples on first play (~50KB each)
4. **Cache:** Store in IndexedDB for offline use

#### 5. UI Integration

```typescript
// In SamplePicker
const INSTRUMENT_CATEGORIES = {
  drums: ['kick', 'snare', ...],           // Existing
  bass: ['bass', 'subbass', ...],          // Existing
  synth: [...SYNTH_PRESETS],               // Existing
  // NEW:
  keys: ['piano-steinway', 'rhodes-mk1', 'organ-hammond'],
  acoustic: ['guitar-nylon', 'upright-bass'],
  brass: ['brass-section', 'trumpet'],
  texture: ['vinyl-crackle', 'tape-hiss'],
};
```

#### 6. Tier 1 Instruments (Priority)

| Instrument | Source | Size | Genres Unlocked |
|------------|--------|------|-----------------|
| **Acoustic Piano** | [Pianobook](https://www.pianobook.co.uk/) | ~500KB | Jazz, ballads, classical |
| **Upright Bass** | [U of Iowa](https://theremin.music.uiowa.edu/) | ~300KB | Jazz, soul, Motown |
| **Brass Section** | [VSCO 2 CE](https://versilian-studios.com/vsco-community/) | ~200KB | Soul, disco, funk |
| **Vinyl Crackle** | [Freesound CC0](https://freesound.org/) | ~100KB | Lo-fi hip-hop |
| **Acoustic Guitar** | [U of Iowa](https://theremin.music.uiowa.edu/) | ~400KB | Folk, bossa nova |

**Total Tier 1:** ~1.5MB (lazy loaded)

#### Success Criteria

- [ ] Instruments load in <2s on 3G
- [ ] Piano sounds "real" (not like sine wave)
- [ ] Pitch-shifting artifacts are minimal
- [ ] Offline playback works after first load
- [ ] Mobile memory usage is acceptable

**Effort:** 2-3 weeks

**Outcome:** Soul, funk, jazz, lo-fi, and cinematic genres become authentic. Keyboardia sounds professional.

---

### Phase E: Scale Quantization

Auto-quantize pitches to musical scales for beginners and live jamming.

> **Coverage Impact:** +3% (reduces bad notes, improves jamming)

#### Why This Matters

| Without Scale Lock | With Scale Lock |
|--------------------|-----------------|
| Random clicks = dissonance | Every note sounds good |
| Requires music theory | Beginners can jam |
| Live collaboration risky | Safe to experiment |

#### Implementation

```typescript
interface ScaleConfig {
  root: number;      // 0-11 (C=0, C#=1, ... B=11)
  type: ScaleType;
}

type ScaleType =
  | 'chromatic'      // No quantization (default)
  | 'major'          // Ionian: 0,2,4,5,7,9,11
  | 'minor'          // Aeolian: 0,2,3,5,7,8,10
  | 'pentatonic'     // Major penta: 0,2,4,7,9
  | 'blues'          // Blues: 0,3,5,6,7,10
  | 'dorian'         // 0,2,3,5,7,9,10
  | 'mixolydian';    // 0,2,4,5,7,9,10

const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  chromatic: [0,1,2,3,4,5,6,7,8,9,10,11],
  major: [0,2,4,5,7,9,11],
  minor: [0,2,3,5,7,8,10],
  pentatonic: [0,2,4,7,9],
  blues: [0,3,5,6,7,10],
  dorian: [0,2,3,5,7,9,10],
  mixolydian: [0,2,4,5,7,9,10],
};
```

#### Quantization Logic

```typescript
function quantizeToScale(pitch: number, scale: ScaleConfig): number {
  if (scale.type === 'chromatic') return pitch;

  const intervals = SCALE_INTERVALS[scale.type];
  const octave = Math.floor(pitch / 12);
  const noteInOctave = ((pitch % 12) + 12) % 12;

  // Find nearest scale degree
  let nearest = intervals[0];
  let minDistance = Math.abs(noteInOctave - intervals[0]);

  for (const interval of intervals) {
    const distance = Math.abs(noteInOctave - interval);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = interval;
    }
  }

  return octave * 12 + ((nearest + scale.root) % 12);
}
```

#### Session State

```typescript
interface GridState {
  // ... existing
  scale: ScaleConfig;  // Default: { root: 0, type: 'chromatic' }
}
```

#### UI

1. **Scale selector** in transport area: `[C] [Major ▼]`
2. **Visual feedback:** Non-scale notes dimmed in chromatic view
3. **Quick presets:** "C Major", "A Minor", "Blues in E"

**Effort:** 3-5 days

**Outcome:** Beginners can make music without theory knowledge. Live jamming is safer.

---

### Phase F: Filter Automation

Add per-step filter cutoff control for acid lines and movement.

> **Coverage Impact:** +5% (acid, EDM, movement)

#### Why This Matters

| Static Filter | Animated Filter |
|---------------|-----------------|
| Flat, lifeless synths | TB-303 acid squelch |
| No tonal movement | Builds and drops |
| EDM sounds amateur | Professional filter sweeps |

#### Implementation

Extend ParameterLock to include filter cutoff:

```typescript
interface ParameterLock {
  pitch?: number;
  volume?: number;
  filterCutoff?: number;  // NEW: 0-100 (maps to 100Hz-10kHz)
}
```

#### Synth Engine Changes

```typescript
// In SynthVoice.start()
if (paramLock.filterCutoff !== undefined) {
  const cutoffHz = mapRange(paramLock.filterCutoff, 0, 100, 100, 10000);
  this.filter.frequency.setValueAtTime(cutoffHz, time);
}
```

#### UI

1. **Filter row** in chromatic step view (like pitch row but for cutoff)
2. **Per-step knob** when step is selected
3. **Visual:** Color gradient showing filter brightness

#### Acid Pattern Example

```
Step:    1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16
Pitch:   0  0  12 0  0  0  12 0  0  0  12 0  0  0  7  0
Cutoff:  20 40 100 30 20 50 100 20 30 60 100 20 20 40 80 30
         ↑ gradually opens, snaps high on accents
```

**Effort:** 1 week

**Outcome:** Acid house and EDM filter sweeps become possible. Synths come alive.

---

### Phase G: Euclidean Rhythms

Auto-generate rhythms by distributing N hits across M steps.

> **Coverage Impact:** +3% (world music, polyrhythms)

#### Why This Matters

| Manual Programming | Euclidean Generator |
|--------------------|---------------------|
| Tedious step-by-step | One-click patterns |
| Western-biased rhythms | World music patterns |
| Hard to discover | Algorithmic exploration |

#### The Algorithm

Euclidean rhythms distribute N onsets as evenly as possible across M steps:

| Pattern | Result | Musical Name |
|---------|--------|--------------|
| E(3,8) | `x..x..x.` | Cuban tresillo |
| E(5,8) | `x.xx.xx.` | Cinquillo |
| E(4,12) | `x..x..x..x..` | Standard 12/8 |
| E(7,16) | `x.x.x.x.xx.x.x.x.` | Brazilian samba |
| E(5,12) | `x..x.x..x.x.` | West African bell |

#### Implementation

```typescript
function euclidean(hits: number, steps: number): boolean[] {
  if (hits >= steps) return new Array(steps).fill(true);
  if (hits === 0) return new Array(steps).fill(false);

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

  return pattern;
}
```

#### UI

1. **Euclidean generator button** in track controls
2. **Modal/popover:** "Distribute [5▼] hits across [16] steps"
3. **Preview** before applying
4. **Rotation control:** Shift pattern start point

**Effort:** 2-3 days

**Outcome:** World music rhythms accessible. Pattern exploration becomes fun.

---

## Phase Summary Table

| Phase | Feature | Effort | Coverage Δ | Genres Unlocked |
|-------|---------|--------|------------|-----------------|
| **A** | **Effects Engine** | 1 week | +18% | Ambient, dub, cinematic, lo-fi |
| **B** | **Triplet Mode** | 3-5 days | +8% | Jazz, gospel, R&B, blues |
| **C** | **Extended Pitch** | 1-2 days | +5% | Piano, orchestral, prog |
| **D** | **Instrument Library** | 2-3 weeks | +15% | Soul, funk, jazz, cinematic |
| **E** | **Scale Quantization** | 3-5 days | +3% | Beginner-friendly |
| **F** | **Filter Automation** | 1 week | +5% | Acid, EDM |
| **G** | **Euclidean Rhythms** | 2-3 days | +3% | World music |
| | **TOTAL** | ~7 weeks | **+57%** | |

### Recommended Order

```
QUICK WINS (do first, 2 weeks):
├── Phase A: Effects (reverb + delay)      +18%
├── Phase B: Triplet Mode                  +8%
└── Phase C: Extended Pitch                +5%
                                          ─────
                                    Total: +31%

INSTRUMENT INVESTMENT (next, 3 weeks):
└── Phase D: Instrument Library            +15%
                                          ─────
                                    Total: +46%

POLISH (as time permits):
├── Phase E: Scale Quantization            +3%
├── Phase F: Filter Automation             +5%
└── Phase G: Euclidean Rhythms             +3%
                                          ─────
                                    Total: +57%
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
