# Keyboardia Musical Reach Analysis

A deep research study into what music Keyboardia can and cannot reach, informed by web research on music theory, Web Audio API capabilities, collaborative music tools, and detailed codebase analysis.

**Date:** December 2025
**Version:** 0.2.0

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [What's Within Reach](#whats-within-reach)
3. [What's Out of Reach](#whats-out-of-reach)
4. [What's Close (Minimal Changes)](#whats-close-minimal-changes)
5. [What's Out of Reach but Goal-Aligned](#whats-out-of-reach-but-goal-aligned)
6. [Technical Deep Dive](#technical-deep-dive)
7. [Competitive Landscape](#competitive-landscape)
8. [Recommendations](#recommendations)
9. [Sources](#sources)

---

## Executive Summary

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                    KEYBOARDIA MUSICAL REACH MAP                           ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  ┌─────────────────────────────────────────────────────────────────────┐  ║
║  │                         FULL REACH                                   │  ║
║  │  • 4/4 electronic music (house, techno, disco, synth-pop)           │  ║
║  │  • Loop-based production (8-bar patterns)                           │  ║
║  │  • Collaborative jam sessions (5-10 players)                        │  ║
║  │  • Chromatic melodies (2 octaves)                                   │  ║
║  │  • Polyrhythmic patterns (4/8/16/32/64 steps)                       │  ║
║  │  • Real-time synthesis (19 presets)                                 │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                  │                                        ║
║                                  ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────┐  ║
║  │              CLOSE (1-2 weeks implementation)                        │  ║
║  │  • Scale quantization (pentatonic, major, minor)                    │  ║
║  │  • Reverb/delay effects (ConvolverNode)                             │  ║
║  │  • Euclidean rhythm generator                                       │  ║
║  │  • Triplet mode (24 steps per bar)                                  │  ║
║  │  • Extended pitch range (±24 semitones)                             │  ║
║  │  • Filter automation per step                                       │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                  │                                        ║
║                                  ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────┐  ║
║  │            GOAL-ALIGNED BUT COMPLEX (1-3 months)                    │  ║
║  │  • Pattern chaining (song arrangement)                              │  ║
║  │  • Sampled instruments (piano, strings)                             │  ║
║  │  • Dual-oscillator synth engine                                     │  ║
║  │  • LFO modulation (filter sweeps, vibrato)                          │  ║
║  │  • Beat-quantized collaboration                                     │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                  │                                        ║
║                                  ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────┐  ║
║  │               OUT OF REACH (Fundamentally Different)                │  ║
║  │  • Microtonal music (quarter tones, maqam)                          │  ║
║  │  • Odd time signatures (5/4, 7/8, 11/8)                             │  ║
║  │  • Live instrument recording (latency-critical)                     │  ║
║  │  • Full DAW production (mixing, mastering)                          │  ║
║  │  • Pitch bend / continuous pitch control                            │  ║
║  │  • MIDI controller support                                          │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Keyboardia's Musical Identity

Keyboardia is **not trying to be a DAW**. It's a collaborative musical toy optimized for:

1. **Instant gratification** — Sound in < 30 seconds from landing
2. **Zero learning curve** — Click squares, make music
3. **Multiplayer magic** — "Everyone hears the same music"
4. **Ephemeral creativity** — Jam sessions, not albums

This identity intentionally excludes some musical territory to remain focused.

---

## What's Within Reach

### Pitch Domain

| Capability | Implementation | Code Location |
|------------|----------------|---------------|
| **12-TET chromatic scale** | `playbackRate = 2^(semitones/12)` | `engine.ts:235` |
| **±12 semitone transposition** | Track-level `transpose` property | `types.ts:67` |
| **Per-step pitch locks** | `ParameterLock.pitch` | `types.ts:29-32` |
| **19 synth presets** | ADSR + filter per preset | `synth.ts:22-206` |
| **Frequency range 40Hz-8kHz** | Sample/oscillator frequencies | `samples.ts` |

**Scales achievable via step selection:**
```
Major:        C  D  E  F  G  A  B   (0, 2, 4, 5, 7, 9, 11)
Minor:        C  D  Eb F  G  Ab Bb  (0, 2, 3, 5, 7, 8, 10)
Pentatonic:   C  D  E  G  A         (0, 2, 4, 7, 9)
Blues:        C  Eb F  Gb G  Bb     (0, 3, 5, 6, 7, 10)
Dorian:       C  D  Eb F  G  A  Bb  (0, 2, 3, 5, 7, 9, 10)
```

Users can play any 12-TET scale — they just have to select the right notes manually.

### Rhythm Domain

| Capability | Range | Implementation |
|------------|-------|----------------|
| **Step resolution** | 16th notes | `STEPS_PER_BEAT = 4` |
| **Pattern length** | 4-64 steps | `STEP_COUNT_OPTIONS` |
| **Polyrhythm** | Independent per-track | `globalStep % trackStepCount` |
| **Swing** | 0-100% | Off-beat delay calculation |
| **Tempo** | 60-180 BPM | `MIN_TEMPO/MAX_TEMPO` |

**Polyrhythmic combinations possible:**
```
4 vs 16:   ●───●───●───●───  over  ●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─
           (minimal techno pulse)

8 vs 16:   ●─●─●─●─●─●─●─●─  over  ●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─
           (boom-bap half-time feel)

16 vs 32:  Standard bar vs 2-bar evolution
64 steps:  4-bar progressive patterns
```

### Timbre Domain

**35 Sound Sources:**

```
DRUMS (8)                    SYNTH PRESETS (19)
─────────────                ──────────────────
kick     ▓▓▓▓▓ 150→40Hz      bass      saw + LP 800Hz
snare    ▓▓▓▓▓ noise+tone    lead      square + LP 2kHz
hihat    ▓▓▓▓▓ HP noise      pad       sine + slow ADSR
clap     ▓▓▓▓▓ multi-burst   pluck     triangle + resonance
tom      ▓▓▓▓▓ 200→80Hz      acid      saw + LP 500Hz + Q15
rim      ▓▓▓▓▓ click         funkbass  square punchy
cowbell  ▓▓▓▓▓ inharmonic    clavinet  saw percussive
openhat  ▓▓▓▓▓ long noise    rhodes    sine mellow
                              organ     square sustained
BASS (2)                      wurlitzer triangle warm
─────────                     discobass saw groovy
bass     55Hz sawtooth        strings   saw slow attack
subbass  40Hz pure sine       brass     saw punchy
                              stab      saw + Q8
SYNTH SAMPLES (4)             sub       sine deep
─────────────────             shimmer   sine ethereal
lead     440Hz square-ish     jangle    triangle bright
pluck    330Hz Karplus-ish    dreampop  saw hazy
chord    Am triad             bell      sine pure
pad      220Hz detuned

FX (2)
───────
zap      freq sweep 2k→100Hz
noise    white noise burst

CUSTOM (∞)
──────────
Mic recordings (max 5s)
Auto-sliced samples
```

### Harmonic Capabilities

**Chord construction via track layering:**

```
C Major Chord (16 tracks available):
Track 1: synth:pad    transpose=0   (C)
Track 2: synth:pad    transpose=+4  (E)
Track 3: synth:pad    transpose=+7  (G)
Track 4: synth:sub    transpose=-12 (C bass)

Progression (via per-step p-locks on same track):
Step 1-4:   pitch=0  (Cmaj)
Step 5-8:   pitch=5  (Fmaj)
Step 9-12:  pitch=7  (Gmaj)
Step 13-16: pitch=5  (Fmaj)
```

### Genre Suitability Analysis

| Genre | Fit | What Works | What's Missing |
|-------|-----|------------|----------------|
| **House** | ★★★★★ | 4/4, 120-130 BPM, synth-centric | Nothing major |
| **Techno** | ★★★★★ | Driving rhythms, acid, minimal | Industrial textures |
| **Disco** | ★★★★☆ | Strings, brass, groovy bass | Live funk feel |
| **Synth-pop** | ★★★★☆ | Synths, pop structures | Vocal samples |
| **Lo-fi Hip-hop** | ★★★☆☆ | Samples, swing | Vinyl FX, side-chain |
| **Ambient** | ★★★☆☆ | Pads, long release | Reverb, granular |
| **Drum & Bass** | ★★☆☆☆ | Fast tempo possible | Complex breaks |
| **Jazz** | ★★☆☆☆ | Swing, rhodes | Expression, rubato |
| **Rock** | ★☆☆☆☆ | Basic rhythm | Guitars, dynamics |
| **Classical** | ★☆☆☆☆ | — | Everything |

---

## What's Out of Reach

### 1. Microtonal Music

**Current limitation:** Pitch is quantized to 12-TET semitones.

```typescript
// From engine.ts:235
source.playbackRate.value = Math.pow(2, pitchSemitones / 12);
// Only integer semitones supported
```

**What this excludes:**
- Middle Eastern maqam (quarter tones)
- Indian classical (microtonal gamakas)
- Blues bends between notes
- Experimental microtonal compositions

**Why it's fundamental:** Supporting microtones would require:
1. Float semitones in ParameterLock interface
2. UI for sub-semitone selection (cents)
3. Completely different chromatic grid design
4. User education on unfamiliar tuning systems

**Assessment:** Not aligned with "no musical knowledge required" goal.

### 2. Odd Time Signatures

**Current limitation:** Step counts are 4, 8, 16, 32, 64 (powers of 2 × options).

```typescript
// From types.ts:40
export const STEP_COUNT_OPTIONS = [4, 8, 16, 32, 64] as const;
```

**What this excludes:**
- 5/4 (progressive rock, Dave Brubeck's "Take Five")
- 7/8 (Balkan folk, tool)
- 9/8 (compound meter)
- 11/8, 13/8 (math rock)
- Mixed meter (changing time signatures)

**Why it's fundamental:**
- UI designed around 4×4 grid (16 = 4×4)
- Polyrhythm logic assumes power-of-2 cycles
- "4/4" is part of the genre focus

**Assessment:** Could add 12 steps (for 6/8, 12/8), but true odd meters are a different paradigm.

### 3. Continuous Pitch Control

**Current limitation:** Each step has exactly one discrete pitch.

**What this excludes:**
- Pitch bends (guitar bends, synth wheel)
- Portamento/glide between notes
- Vibrato (pitch oscillation)
- Theremin-style continuous pitch
- DJ-style pitch fader

**Why it's fundamental:**
- Step sequencer paradigm = discrete events
- No "between steps" concept
- Parameter locks are step-atomic

**Assessment:** LFO→pitch could simulate vibrato (see Phase 19), but true continuous control needs different input method.

### 4. Expressive Timing

**Current limitation:** All notes are quantized to the grid.

**What this excludes:**
- Playing "behind" or "ahead" of the beat (jazz feel)
- Rubato (tempo flexibility)
- Humanization (random micro-timing)
- Accelerando/ritardando (tempo curves)

**Why it's fundamental:**
- Multiplayer sync requires quantized grid
- "Same music for everyone" = deterministic playback
- Adding timing variance breaks sync

**Assessment:** Per-step micro-timing (nudge) could be added as p-lock, but true rubato is incompatible with real-time collaboration.

### 5. Live Audio Input

**Current limitation:** Recording is offline-only (record → finish → add to grid).

**What this excludes:**
- Live jamming with acoustic instruments
- Real-time audio processing
- Monitoring through effects
- Side-chain compression

**Why it's fundamental:**
- Browser audio latency (~30-100ms round-trip)
- Web Audio API scheduling is for playback, not live input
- Monitoring requires < 10ms latency for musicians

**Assessment:** Web platform limitation. Native apps can achieve lower latency.

### 6. Full DAW Production

**Current limitation:** Single pattern loop, no arrangement view.

**What this excludes:**
- Song sections (verse, chorus, bridge)
- Automation lanes (filter sweeps over time)
- Mixing console (EQ, compression, panning)
- Mastering (limiting, stereo enhancement)
- Bounce/export to audio file

**Why it's fundamental:**
- Keyboardia is a musical toy, not a production tool
- Arrangement adds massive complexity
- Export requires server-side audio rendering

**Assessment:** Pattern chaining (Phase 18) would partially address this.

---

## What's Close (Minimal Changes)

### 1. Scale Quantization (2-3 days)

**Current state:** Full chromatic access; users must know which notes to select.

**Proposed change:** Add optional scale lock to chromatic grid.

```typescript
// New type
type ScaleType = 'chromatic' | 'major' | 'minor' | 'pentatonic' | 'blues' | 'dorian';

// New track property
interface Track {
  // ... existing
  scaleQuantize?: ScaleType;  // undefined = chromatic (current behavior)
}

// Scale definitions
const SCALES: Record<ScaleType, number[]> = {
  chromatic:   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major:       [0, 2, 4, 5, 7, 9, 11],
  minor:       [0, 2, 3, 5, 7, 8, 10],
  pentatonic:  [0, 2, 4, 7, 9],
  blues:       [0, 3, 5, 6, 7, 10],
  dorian:      [0, 2, 3, 5, 7, 9, 10],
};
```

**UI change:** Dropdown in track header when ChromaticGrid is expanded.

**Impact:** Beginners can click any cell and sound good (pentatonic guarantee).

**Why it's easy:**
- Chromatic grid already exists
- Just filter which rows are visible/clickable
- No audio engine changes needed

**Research support:**
> "We can't hit any 'wrong' notes when playing a pentatonic scale. All the notes will sound harmonious and pleasing to the ear." — [Pentatonic Scale Guide](https://emastered.com/blog/pentatonic-scale)

### 2. Reverb Effect (3-5 days)

**Current state:** Dry output only.

**Proposed change:** Add master reverb bus using ConvolverNode.

```typescript
// New in engine.ts
private reverbNode: ConvolverNode | null = null;
private reverbGain: GainNode | null = null;

async initializeReverb(impulseResponseUrl: string) {
  const response = await fetch(impulseResponseUrl);
  const buffer = await this.audioContext.decodeAudioData(await response.arrayBuffer());

  this.reverbNode = this.audioContext.createConvolver();
  this.reverbNode.buffer = buffer;

  this.reverbGain = this.audioContext.createGain();
  this.reverbGain.gain.value = 0.3;  // 30% wet by default

  // Parallel routing: dry + wet
  // masterGain → destination (dry)
  // masterGain → reverbNode → reverbGain → destination (wet)
}
```

**UI change:** Global "Reverb" knob in transport bar.

**Impact:** Instant professional sound; adds space and depth.

**Why it's easy:**
- Web Audio ConvolverNode is built-in
- Impulse responses are small (~100KB)
- No per-track changes needed initially

**Research support:**
> "The createConvolver() method is commonly used to apply reverb effects to your audio." — [MDN ConvolverNode](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode)

### 3. Delay Effect (2-3 days)

**Current state:** No delay.

**Proposed change:** Add tempo-synced delay.

```typescript
// Delay time = (60 / tempo) / division
// At 120 BPM: 1/4 note = 500ms, 1/8 = 250ms, 1/16 = 125ms
const delayTime = (60 / tempo) / division;

const delayNode = audioContext.createDelay(2.0);  // Max 2 seconds
delayNode.delayTime.value = delayTime;

const feedbackGain = audioContext.createGain();
feedbackGain.gain.value = 0.4;  // 40% feedback

// Connect: source → delay → feedback → delay (loop)
//                         ↘ output
```

**UI change:** "Delay" knob + division selector (1/4, 1/8, 1/16).

**Impact:** Rhythmic echoes; essential for dub, ambient, electronic.

### 4. Euclidean Rhythm Generator (3-5 days)

**Current state:** Users manually toggle steps.

**Proposed change:** "Euclidean fill" button on each track.

```typescript
// Euclidean algorithm distributes N hits across K steps
function euclideanRhythm(hits: number, steps: number): boolean[] {
  const pattern = new Array(steps).fill(false);
  // Bjorklund's algorithm implementation
  // ...
  return pattern;
}

// Example: E(5, 16) = "x--x--x--x--x---" (Cuban clave)
// Example: E(3, 8) = "x--x--x-" (tresillo)
```

**UI change:** "Generate" button → modal with hits/steps sliders.

**Impact:** Instant world rhythms; polyrhythmic exploration.

**Research support:**
> "Many salient rhythms found across cultures are naturally Euclidean — the Brazilian bossa nova is 5 onsets across 16 steps, Cuba's tresillo is 3 across 8." — [Euclidean Rhythms](https://blog.landr.com/euclidean-rhythms/)

### 5. Triplet Mode (4-6 days)

**Current state:** 16th note grid only (4 steps per beat).

**Proposed change:** Add 6-steps-per-beat option (triplet 16ths).

```typescript
// New step count options
export const STEP_COUNT_OPTIONS = [4, 6, 8, 12, 16, 24, 32, 48, 64] as const;
//                                   ↑     ↑      ↑      ↑
//                                 triplet variants

// Change scheduler calculation
const STEPS_PER_BEAT = track.tripletMode ? 6 : 4;
```

**UI change:** "Triplet" toggle per track (or global).

**Impact:** True shuffle feel; jazz, swing, R&B rhythms.

**Why it's harder than the others:**
- UI grid changes (6 columns per beat vs 4)
- Polyrhythm math changes
- Visual design for 6-column groups

### 6. Extended Pitch Range (1-2 days)

**Current state:** ±12 semitones (2 octaves).

**Proposed change:** ±24 semitones (4 octaves).

```typescript
// In types.ts, update ParameterLock comment and validation
interface ParameterLock {
  pitch?: number;  // -24 to +24 semitones (was -12 to +12)
  volume?: number;
}

// In ChromaticGrid, add more rows or scrolling
```

**UI change:** Scroll in chromatic grid; wider transpose dropdown.

**Impact:** Full piano range (roughly); deep bass to high leads.

### 7. Filter Automation per Step (3-5 days)

**Current state:** Filter cutoff is preset-global.

**Proposed change:** Add filter cutoff to ParameterLock.

```typescript
interface ParameterLock {
  pitch?: number;
  volume?: number;
  filterCutoff?: number;  // NEW: 100-10000 Hz
}

// In scheduler, apply filter cutoff before playing synth
if (pLock?.filterCutoff !== undefined) {
  // Modify synth voice filter before trigger
}
```

**UI change:** Third slider in step editor (below pitch, volume).

**Impact:** Filter sweeps per step; acid basslines, movement.

---

## What's Out of Reach but Goal-Aligned

These features are complex but align with Keyboardia's mission.

### 1. Pattern Chaining (Phase 18 in Roadmap)

**Goal alignment:** Enables song creation without leaving the loop paradigm.

**Complexity:**
- Separate pattern storage (A, B, C, D)
- Chain sequencer (A → A → B → A → C → ...)
- UI for pattern selection and ordering
- State sync across multiplayer (which pattern is active?)

**Effort:** 3-4 weeks

**Impact:** Transforms Keyboardia from "toy" to "tool."

### 2. Sampled Instruments (Phase 19 in Roadmap)

**Goal alignment:** "Nice and full" sounds like Ableton Learning Music.

**Complexity:**
- Sample storage in R2 (~500KB-2MB per instrument)
- Multi-sample mapping (one sample per octave, pitch-shift between)
- Lazy loading (don't block initial load)
- Memory management on mobile

**Effort:** 2-3 weeks

**Implementation:**
```
R2: /instruments/piano/C2.mp3, C3.mp3, C4.mp3, C5.mp3
    /instruments/piano/manifest.json

manifest.json:
{
  "name": "Piano",
  "samples": {
    "C2": { "url": "C2.mp3", "baseNote": 36 },
    "C3": { "url": "C3.mp3", "baseNote": 48 },
    ...
  }
}
```

**Impact:** Acoustic instrument sounds; piano, strings, brass.

### 3. Dual-Oscillator Synth Engine (Phase 19 in Roadmap)

**Goal alignment:** Rich, full sounds; Learning Synths parity.

**Current synth architecture:**
```
Oscillator → Filter → Gain (ADSR) → Master
```

**Proposed architecture:**
```
Oscillator 1 ─┬→ Mix → Filter → Gain (ADSR) → Master
Oscillator 2 ─┘      ↑
              LFO ───┘ (filter modulation)
```

**New capabilities:**
- Detuned supersaw (trance pads)
- Octave layering (full leads)
- PWM-style thickness
- Filter sweeps via LFO

**Effort:** 2-3 weeks

**Research support:**
> "Ableton's Learning Synths Playground provides an excellent reference for essential synth controls: dual oscillator, filter envelope, LFO with destinations." — Phase 19 spec

### 4. LFO Modulation (Part of Phase 19)

**Goal alignment:** Movement and expression in sounds.

**Complexity:**
- LFO oscillator (0.1-20 Hz)
- Routing to filter, pitch, or amplitude
- Per-preset LFO settings
- Optional tempo sync

**Impact:**
- Vibrato (LFO → pitch at 5-7 Hz)
- Tremolo (LFO → amplitude at 4-8 Hz)
- Filter sweeps (LFO → filter cutoff)
- Wobble bass (LFO → filter at 1-4 Hz)

### 5. Beat-Quantized Collaboration (Phase 21 in Roadmap)

**Goal alignment:** Musical feel during multiplayer editing.

**Problem:** Remote step toggles feel random and jarring.

**Solution:** Quantize remote changes to beat boundaries.

```
16th note @ 120 BPM = 125ms delay (imperceptible)
```

**Complexity:**
- Distinguish local vs remote changes
- Queue remote changes until beat
- Visual feedback for pending changes
- Edge cases (rapid successive edits)

**Effort:** 1-2 weeks

---

## Technical Deep Dive

### Web Audio API Capabilities Used

| Node Type | Used For | Performance |
|-----------|----------|-------------|
| `OscillatorNode` | Synth waveforms | Cheap, unlimited |
| `BiquadFilterNode` | Lowpass filter | Cheap |
| `GainNode` | ADSR envelope, mixing | Free when static |
| `AudioBufferSourceNode` | Sample playback | Cheap per instance |

### Web Audio API Capabilities Available (Unused)

| Node Type | Could Be Used For | Complexity |
|-----------|-------------------|------------|
| `ConvolverNode` | Reverb | Low — just needs impulse response |
| `DelayNode` | Delay, chorus | Low |
| `WaveShaperNode` | Distortion | Medium |
| `StereoPannerNode` | Stereo positioning | Low |
| `DynamicsCompressorNode` | Master compression | Low |
| `AnalyserNode` | Visualizations | Low |
| `AudioWorkletNode` | Custom DSP | High |

### Latency Budget Analysis

```
┌─────────────────────────────────────────────────────────────────┐
│                    KEYBOARDIA LATENCY BUDGET                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Click                                                     │
│       │                                                         │
│       ▼ ~0-5ms (browser event handling)                        │
│  React State Update                                             │
│       │                                                         │
│       ▼ ~0-16ms (React render cycle)                           │
│  Scheduler Check                                                │
│       │                                                         │
│       ▼ ~0-25ms (LOOKAHEAD_MS timer interval)                  │
│  Web Audio Schedule                                             │
│       │                                                         │
│       ▼ ~0-100ms (SCHEDULE_AHEAD_SEC buffer)                   │
│  Audio Plays                                                    │
│       │                                                         │
│       ▼ ~3-15ms (audio hardware buffer)                        │
│  Sound Reaches Ear                                              │
│                                                                 │
│  TOTAL: 3-161ms (typical: 20-50ms)                             │
│                                                                 │
│  For step sequencer, this is EXCELLENT.                        │
│  For live instrument monitoring, this is TOO HIGH.             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Research finding:**
> "Web Audio API processes frames in blocks of 128 samples (3ms at 44.1kHz). All audio computations for 128 frames must be performed in less than 3ms." — [Web Audio Performance](https://padenot.github.io/web-audio-perf/)

### Polyphony Analysis

**Current model:**
- Synth presets: Monophonic (1 voice per track)
- Samples: Polyphonic (unlimited BufferSourceNodes)

**Why monophonic synths:**
```typescript
// From synth.ts:236-238
// Stop any existing voice with this ID
this.stopNote(noteId);
const voice = new SynthVoice(...);
```

Step sequencers typically want monophonic behavior — one note at a time per track, with the previous note cutting off.

**Could be changed to polyphonic:**
- Remove `stopNote` call
- Implement voice stealing (oldest voice freed when limit hit)
- Increase memory usage

**Assessment:** Monophonic is correct for step sequencer; polyphonic better for live play.

---

## Competitive Landscape

### Browser-Based Collaborative Music Tools

| Tool | Model | Strengths | Weaknesses |
|------|-------|-----------|------------|
| **Keyboardia** | Real-time multiplayer sequencer | Instant jam, no signup | No song arrangement |
| **Soundtrap** | Full DAW, collaboration | Complete production tool | Complex, subscription |
| **BandLab** | Full DAW, free | Full featured, social | Not real-time sync |
| **Flat** | Notation + collaboration | Music education | Not audio-focused |
| **Endlesss** | Real-time loops (shut down) | Musical feel | No longer available |

### Research Finding: Latency Challenge

> "While online jamming has never been better, there is still one factor that makes it tough — latency. Some tools like Ninjam deal with latency by measuring it in musical measures and recalibrating." — [Online Jamming Apps](https://blog.landr.com/online-jamming-apps/)

**Keyboardia's approach:** Server clock sync + lookahead scheduling. Everyone hears the same music, but not in perfect real-time with each other's actions.

### Hardware Inspiration

| Device | Key Feature to Emulate | Status |
|--------|------------------------|--------|
| **Elektron Digitakt** | Parameter locks per step | ✅ Implemented |
| **Teenage Engineering OP-Z** | Direct manipulation UI | ✅ Philosophy adopted |
| **Ableton Push** | Scale mode, pad grid | 🔄 Scale quantize proposed |
| **Roland TR-808** | Step sequencer paradigm | ✅ Core design |

---

## Recommendations

### Immediate Wins (Next 2 Weeks)

| Feature | Effort | Impact | Priority |
|---------|--------|--------|----------|
| **Reverb** | 3 days | ★★★★★ | 1 |
| **Scale quantization** | 3 days | ★★★★☆ | 2 |
| **Delay** | 2 days | ★★★★☆ | 3 |
| **Extended pitch range** | 2 days | ★★★☆☆ | 4 |

### Medium-Term (1-2 Months)

| Feature | Effort | Impact | Priority |
|---------|--------|--------|----------|
| **Euclidean generator** | 1 week | ★★★★☆ | 1 |
| **Triplet mode** | 1 week | ★★★☆☆ | 2 |
| **Filter p-locks** | 1 week | ★★★★☆ | 3 |
| **Sampled piano** | 2 weeks | ★★★★★ | 4 |

### Long-Term (3+ Months)

| Feature | Effort | Impact | Priority |
|---------|--------|--------|----------|
| **Pattern chaining** | 4 weeks | ★★★★★ | 1 |
| **Dual-osc + LFO** | 3 weeks | ★★★★☆ | 2 |
| **Beat-quantized collab** | 2 weeks | ★★★★☆ | 3 |

### What NOT to Build

| Feature | Why Not |
|---------|---------|
| Microtonality | Not goal-aligned; "no musical knowledge required" |
| Odd meters | Niche; breaks grid-based simplicity |
| Live instrument monitoring | Web platform limitation |
| Full DAW features | Different product; complexity explosion |
| MIDI support | Requires desktop app or complex browser permissions |

---

## Sources

### Music Theory
- [Bedroom Producers Blog: Music Theory](https://bedroomproducersblog.com/2024/03/13/music-theory/)
- [Pentatonic Scale Guide](https://emastered.com/blog/pentatonic-scale)
- [Euclidean Rhythms](https://blog.landr.com/euclidean-rhythms/)
- [House Music BPM Guide](https://unison.audio/house-music-bpm/)

### Web Audio API
- [Web Audio API Performance](https://padenot.github.io/web-audio-perf/)
- [MDN: ConvolverNode](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode)
- [Audio Worklets for Low-Latency Processing](https://dev.to/omriluz1/audio-worklets-for-low-latency-audio-processing-3b9p)
- [W3C Web Audio API 1.1 Draft](https://www.w3.org/news/2024/first-public-working-draft-web-audio-api-1-1/)

### Collaborative Music
- [Multiplayer DAWs and Remote Music Collaboration](https://www.audiocipher.com/post/multiplayer-daw-remote-music-collaboration-apps)
- [Online Jamming Apps](https://blog.landr.com/online-jamming-apps/)
- [Flat for Education](https://flat.io/edu)

### Hardware/Software Design
- [Elektron Parameter Locks](https://www.elektronauts.com/t/parameter-lock-in-ableton-live-push/33556)
- [Ableton Learning Music](https://learningmusic.ableton.com/)
- [Ableton Learning Synths](https://learningsynths.ableton.com/)

---

*This document is part of the Keyboardia research collection. See also: [specs/ROADMAP.md](../../specs/ROADMAP.md), [specs/SPEC.md](../../specs/SPEC.md), [specs/UI-PHILOSOPHY.md](../../specs/UI-PHILOSOPHY.md)*
