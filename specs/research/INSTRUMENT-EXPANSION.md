# Keyboardia Instrument Expansion Research

A comprehensive guide to adding new instruments to Keyboardia, including current architecture, implementation patterns, verified sample sources, and prioritized instrument lists.

**Last Updated:** Phase 23 (December 2025)
**Current Instrument Count:** 68

---

## Table of Contents

1. [Current Instrument Architecture](#current-instrument-architecture)
2. [Implementation Patterns](#implementation-patterns)
3. [Missing Procedural Samples](#missing-procedural-samples)
4. [Prioritized Instrument List](#prioritized-instrument-list)
5. [Verified Sample Sources](#verified-sample-sources)
6. [Implementation Recommendations](#implementation-recommendations)
7. [Feature Synergy Matrix](#feature-synergy-matrix)

---

## Current Instrument Architecture

### Sound Source Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  KEYBOARDIA SOUND SOURCES (68 total)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SYNTHESIZED SAMPLES (samples.ts) — 16 sounds                              │
│  ──────────────────────────────────────────                                │
│  Generated using Web Audio API synthesis at runtime:                        │
│                                                                             │
│  Drums (8):     kick, snare, hihat, clap, tom, rim, cowbell, openhat       │
│  Bass (2):      bass (sawtooth), subbass (sine)                            │
│  Synth (4):     lead, pluck, chord, pad                                    │
│  FX (2):        zap (sweep), noise (white burst)                           │
│                                                                             │
│  Implementation: Math.sin() + envelope shaping                              │
│  Location: app/src/audio/samples.ts                                        │
│  File size: 0 bytes (generated on demand)                                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  WEB AUDIO SYNTH PRESETS (synth.ts) — 32 sounds                            │
│  ──────────────────────────────────────────────                            │
│  Real-time OscillatorNode synthesis with ADSR envelopes:                    │
│                                                                             │
│  Core (5):       bass, lead, pad, pluck, acid                              │
│  Funk/Soul (2):  funkbass, clavinet                                        │
│  Keys (6):       rhodes, organ, wurlitzer, epiano, vibes, organphase       │
│  Disco (3):      discobass, strings, brass                                 │
│  House (2):      stab, sub                                                 │
│  Atmospheric (8): shimmer, jangle, dreampop, bell, evolving, sweep,        │
│                   warmpad, glass                                            │
│  Electronic (4): supersaw, hypersaw, wobble, growl                         │
│  Bass (2):       reese, hoover                                             │
│                                                                             │
│  Implementation: OscillatorNode → BiquadFilterNode → GainNode               │
│  Enhanced features: Osc2 (detuning), FilterEnv, LFO                        │
│  Location: app/src/audio/synth.ts                                          │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TONE.JS SYNTH PRESETS (toneSynths.ts) — 11 sounds                         │
│  ────────────────────────────────────────────────                          │
│  Advanced synthesis using Tone.js library:                                  │
│                                                                             │
│  FM (3):        fm-epiano, fm-bass, fm-bell                                │
│  AM (2):        am-bell, am-tremolo                                        │
│  Membrane (2):  membrane-kick, membrane-tom                                │
│  Metal (2):     metal-cymbal, metal-hihat                                  │
│  Other (2):     pluck-string, duo-lead                                     │
│                                                                             │
│  Implementation: Tone.js FMSynth, AMSynth, MembraneSynth, MetalSynth       │
│  Location: app/src/audio/toneSynths.ts                                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ADVANCED SYNTH PRESETS (advancedSynth.ts) — 8 sounds                      │
│  ───────────────────────────────────────────────────                       │
│  Dual-oscillator + filter envelope + LFO using Tone.js:                     │
│                                                                             │
│  Leads (3):     supersaw, thick-lead, vibrato-lead                         │
│  Bass (3):      sub-bass, wobble-bass, acid-bass                           │
│  Pads (2):      warm-pad, tremolo-strings                                  │
│                                                                             │
│  Implementation: Tone.js PolySynth + Filter + LFO + AutoFilter             │
│  Location: app/src/audio/advancedSynth.ts                                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SAMPLED INSTRUMENTS — 1 instrument (expandable)                           │
│  ───────────────────────────────────────────────                           │
│  Multi-sample instruments loaded from audio files:                          │
│                                                                             │
│  Piano:         4 samples (C2, C3, C4, C5), pitch-shifted between          │
│                                                                             │
│  Implementation: SampledInstrumentEngine with LRU cache                     │
│  Location: app/src/audio/sampled-instrument.ts                             │
│  Samples: app/public/instruments/piano/*.mp3                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### UI Organization (sample-constants.ts)

Instruments are organized by musical function for the SamplePicker UI:

| Category | Count | Instruments |
|----------|-------|-------------|
| **Drums** | 12 | kick, snare, hihat, clap, tom, rim, cowbell, openhat, membrane-kick, membrane-tom, metal-cymbal, metal-hihat |
| **Bass** | 13 | bass, subbass, synth:bass, synth:acid, synth:sub, synth:funkbass, synth:discobass, synth:reese, synth:hoover, tone:fm-bass, advanced:sub-bass, advanced:wobble-bass, advanced:acid-bass |
| **Keys** | 9 | sampled:piano, synth:rhodes, synth:wurlitzer, synth:epiano, synth:organ, synth:organphase, synth:clavinet, synth:vibes, tone:fm-epiano |
| **Leads** | 11 | lead, pluck, synth:lead, synth:pluck, synth:supersaw, synth:hypersaw, tone:pluck-string, tone:duo-lead, advanced:supersaw, advanced:thick-lead, advanced:vibrato-lead |
| **Pads** | 13 | pad, chord, synth:pad, synth:warmpad, synth:strings, synth:shimmer, synth:dreampop, synth:glass, synth:jangle, synth:evolving, synth:sweep, advanced:warm-pad, advanced:tremolo-strings |
| **FX** | 10 | zap, noise, synth:bell, synth:stab, synth:brass, synth:wobble, synth:growl, tone:fm-bell, tone:am-bell, tone:am-tremolo |

---

## Implementation Patterns

### Pattern 1: Synthesized Samples (Easiest)

**Effort:** Hours
**File changes:** `samples.ts`, `types.ts`
**External files:** None

Add new procedural drum/percussion sounds:

```typescript
// 1. Add generator function in samples.ts
async function createShaker(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.15; // Short duration
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High-frequency filtered noise
    const noise = Math.random() * 2 - 1;
    // Fast attack, medium decay envelope
    const envelope = Math.exp(-t * 25) * (1 - Math.exp(-t * 500));
    // Highpass effect (simple approximation)
    const highpass = noise * 0.7 + (Math.random() * 2 - 1) * 0.3;
    data[i] = highpass * envelope * 0.6;
  }
  return buffer;
}

// 2. Register in createSynthesizedSamples()
samples.set('shaker', {
  id: 'shaker',
  name: 'Shaker',
  buffer: await createShaker(audioContext),
  url: '',
});

// 3. Add to SAMPLE_CATEGORIES in types.ts
drums: ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat', 'shaker'],

// 4. Add to INSTRUMENT_CATEGORIES in sample-constants.ts
{ id: 'shaker', name: 'Shaker', type: 'sample' },
```

### Pattern 2: Web Audio Synth Presets (Easy)

**Effort:** Minutes per preset
**File changes:** `synth.ts`, `sample-constants.ts`
**External files:** None

```typescript
// 1. Add preset to SYNTH_PRESETS in synth.ts
newpreset: {
  waveform: 'sawtooth',
  filterCutoff: 2000,
  filterResonance: 5,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.3,
  // Optional enhanced features (Phase 22):
  osc2: { waveform: 'sine', detune: 10, coarse: 0, mix: 0.3 },
  filterEnv: { amount: 0.5, attack: 0.1, decay: 0.3, sustain: 0.2 },
  lfo: { waveform: 'sine', rate: 2, depth: 0.5, destination: 'filter' },
},

// 2. Add to sample-constants.ts INSTRUMENT_CATEGORIES
{ id: 'synth:newpreset', name: 'New Preset', type: 'synth' },
```

### Pattern 3: Tone.js Synth Presets (Medium)

**Effort:** Hours per preset
**File changes:** `toneSynths.ts`, `sample-constants.ts`
**External files:** None

```typescript
// 1. Add to TONE_SYNTH_PRESETS in toneSynths.ts
'new-fm-sound': {
  type: 'fm',
  config: {
    harmonicity: 3,
    modulationIndex: 10,
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.5 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.1 },
  },
},

// Available types: 'fm', 'am', 'membrane', 'metal', 'pluck', 'duo'

// 2. Add to sample-constants.ts INSTRUMENT_CATEGORIES
{ id: 'tone:new-fm-sound', name: 'FM Sound', type: 'tone' },
```

### Pattern 4: Advanced Synth Presets (Medium)

**Effort:** Hours per preset
**File changes:** `advancedSynth.ts`, `sample-constants.ts`
**External files:** None

```typescript
// 1. Add to ADVANCED_SYNTH_PRESETS in advancedSynth.ts
'new-preset': {
  name: 'New Preset',
  oscillator1: { waveform: 'sawtooth', level: 0.5, detune: -10, coarseDetune: 0 },
  oscillator2: { waveform: 'triangle', level: 0.5, detune: 10, coarseDetune: 12 },
  amplitudeEnvelope: { attack: 0.1, decay: 0.3, sustain: 0.6, release: 0.8 },
  filter: { frequency: 2000, resonance: 4, type: 'lowpass', envelopeAmount: 0.4 },
  filterEnvelope: { attack: 0.2, decay: 0.3, sustain: 0.5, release: 0.5 },
  lfo: { frequency: 0.5, waveform: 'sine', destination: 'filter', amount: 0.3, sync: false },
  noiseLevel: 0,
},

// 2. Add to sample-constants.ts INSTRUMENT_CATEGORIES
{ id: 'advanced:new-preset', name: 'New Preset', type: 'advanced' },
```

### Pattern 5: Sampled Instruments (Complex)

**Effort:** Days per instrument
**File changes:** `sampled-instrument.ts`, `sample-constants.ts`, manifest.json
**External files:** Audio samples in `/public/instruments/{id}/`

This pattern follows the existing piano implementation:

```typescript
// 1. Create directory: /public/instruments/bass/

// 2. Create manifest.json:
{
  "id": "bass",
  "name": "Electric Bass",
  "type": "sampled",
  "samples": [
    { "note": 28, "file": "E1.mp3" },
    { "note": 40, "file": "E2.mp3" },
    { "note": 52, "file": "E3.mp3" },
    { "note": 64, "file": "E4.mp3" }
  ],
  "baseNote": 40,
  "releaseTime": 0.3,
  "credits": {
    "source": "University of Iowa",
    "url": "https://theremin.music.uiowa.edu/",
    "license": "Public Domain"
  }
}

// 3. Register in SAMPLED_INSTRUMENTS (sampled-instrument.ts)
export const SAMPLED_INSTRUMENTS = ['piano', 'bass'] as const;

// 4. Add to sample-constants.ts INSTRUMENT_CATEGORIES
{ id: 'sampled:bass', name: 'Electric Bass', type: 'sampled' },

// 5. The SampledInstrumentEngine handles:
//    - Lazy loading with progress indication
//    - LRU cache with reference counting
//    - Pitch-shifting between sample zones
//    - Proper release envelopes
```

---

## Missing Procedural Samples

These percussion sounds were designed but never implemented. All can be created using the existing `samples.ts` pattern:

### Shaker

```typescript
async function createShaker(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.15;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High-frequency noise with fast attack/decay
    const noise = Math.random() * 2 - 1;
    const envelope = Math.exp(-t * 25) * (1 - Math.exp(-t * 500));
    // Simple highpass approximation
    const filtered = noise * 0.7 + (Math.random() * 0.6 - 0.3);
    data[i] = filtered * envelope * 0.6;
  }
  return buffer;
}
```
**Character:** Bright, rhythmic texture. Essential for Latin, Afrobeat, pop.

### Conga

```typescript
async function createConga(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.4;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pitched membrane sound (200Hz fundamental)
    const freq = 200 * Math.exp(-t * 3); // Slight pitch drop
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    // Add harmonics for wood/skin character
    const harmonic2 = Math.sin(2 * Math.PI * freq * 2.3 * t) * 0.3;
    const harmonic3 = Math.sin(2 * Math.PI * freq * 3.1 * t) * 0.15;
    // Attack transient (slap)
    const slap = (Math.random() * 2 - 1) * Math.exp(-t * 100) * 0.4;
    // Envelope
    const envelope = Math.exp(-t * 6);
    data[i] = (fundamental + harmonic2 + harmonic3 + slap) * envelope * 0.7;
  }
  return buffer;
}
```
**Character:** Deep, resonant hand drum. Essential for Latin, Afrobeat, world.

### Tambourine

```typescript
async function createTambourine(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.25;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Metallic jingles (multiple inharmonic frequencies)
    const jingle1 = Math.sin(2 * Math.PI * 2100 * t);
    const jingle2 = Math.sin(2 * Math.PI * 3400 * t);
    const jingle3 = Math.sin(2 * Math.PI * 4800 * t);
    const jingle4 = Math.sin(2 * Math.PI * 6200 * t);
    // Noise component for stick hit
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 50);
    // Envelope with sustain for jingles
    const envelope = Math.exp(-t * 8);
    const jingles = (jingle1 + jingle2 * 0.7 + jingle3 * 0.5 + jingle4 * 0.3) * 0.15;
    data[i] = (jingles + noise * 0.3) * envelope;
  }
  return buffer;
}
```
**Character:** Bright, metallic accent. Essential for pop, soul, gospel.

### Cabasa

```typescript
async function createCabasa(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.08; // Very short
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Very high frequency noise burst
    const noise = Math.random() * 2 - 1;
    // Very fast attack and decay
    const envelope = Math.exp(-t * 60) * (1 - Math.exp(-t * 2000));
    data[i] = noise * envelope * 0.5;
  }
  return buffer;
}
```
**Character:** Ultra-short scratch/scrape. Latin percussion texture.

### Clave

```typescript
async function createClave(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.12;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Two-tone wooden click (like two sticks hitting)
    const freq1 = 2500;
    const freq2 = 3200;
    const tone1 = Math.sin(2 * Math.PI * freq1 * t);
    const tone2 = Math.sin(2 * Math.PI * freq2 * t) * 0.6;
    // Very fast decay
    const envelope = Math.exp(-t * 40);
    data[i] = (tone1 + tone2) * envelope * 0.6;
  }
  return buffer;
}
```
**Character:** Sharp wooden click. The rhythmic backbone of Latin music.

### Woodblock

```typescript
async function createWoodblock(ctx: AudioContext): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const duration = 0.15;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Resonant filtered click
    const freq = 800;
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const harmonic = Math.sin(2 * Math.PI * freq * 2.7 * t) * 0.4;
    // Sharp attack, medium decay with resonance
    const envelope = Math.exp(-t * 20);
    const attack = Math.exp(-t * 200);
    data[i] = (fundamental + harmonic) * envelope * (0.7 + attack * 0.3);
  }
  return buffer;
}
```
**Character:** Hollow, resonant knock. Orchestral, latin, world.

---

## Prioritized Instrument List

### Tier 1: Highest Impact (Immediate Implementation)

These unlock the most genres with the least effort.

| Instrument | Type | Implementation | Genres Unlocked | Priority |
|------------|------|----------------|-----------------|----------|
| **Shaker** | Procedural | `samples.ts` (30 min) | All genres (texture) | **1** |
| **Conga** | Procedural | `samples.ts` (1 hr) | Latin, Afrobeat, World | **2** |
| **Vinyl Crackle** | Loop sample | Single file (~30KB) | Lo-fi hip-hop | **3** |
| **Electric Bass (fingered)** | Multi-sample | 4 samples (~400KB) | Funk, Soul, Jazz, Rock | **4** |
| **Brass Stabs** | Single sample | VSCO 2 CE (~200KB) | Soul, Disco, Funk | **5** |

### Tier 2: Genre-Specific Winners

| Instrument | Type | Source | Genres Unlocked |
|------------|------|--------|-----------------|
| **Hammond B3 Organ** | Multi-sample | Pianobook | Gospel, Jazz, Rock |
| **Slap Bass** | Single sample | Freesound CC0 | Funk, Disco |
| **String Section** | Multi-sample | VSCO 2 CE | Cinematic, Ambient, Ballads |
| **Kalimba** | Multi-sample | Pianobook | Lo-fi, Ambient |
| **808 Kick** | Procedural | `samples.ts` | Hip-hop, Trap |

### Tier 3: Texture & World

| Instrument | Type | Source | Genres Unlocked |
|------------|------|--------|-----------------|
| **Tape Hiss** | Loop sample | Freesound CC0 | Lo-fi, Synthwave |
| **Orchestral Hits** | Sample pack | VSCO 2 CE | Cinematic, EDM |
| **Marimba** | Multi-sample | U of Iowa | World, Pop |
| **Tambourine** | Procedural | `samples.ts` | Pop, Soul |
| **Melodica** | Multi-sample | Pianobook | Reggae, Dub |

### Tier 4: World & Ethnic Percussion

| Instrument | Type | Source | Genres Unlocked |
|------------|------|--------|-----------------|
| **Tabla** | Sample pack | Freesound | Indian, Ambient |
| **Steel Drums** | Multi-sample | Philharmonia | Caribbean |
| **Cabasa** | Procedural | `samples.ts` | Latin |
| **Clave** | Procedural | `samples.ts` | Latin, Afro-Cuban |
| **Woodblock** | Procedural | `samples.ts` | Orchestral, World |

---

## Verified Sample Sources

### Primary Sources (Recommended)

#### 1. University of Iowa Musical Instrument Samples
- **URL:** https://theremin.music.uiowa.edu/
- **License:** Public domain (no restrictions since 1997)
- **Format:** 16-bit 44.1kHz AIFF (mono), piano in stereo
- **Quality:** Academic-grade, anechoic chamber recordings
- **Instruments:** Flute, Oboe, Clarinet, Bassoon, Saxophone, Horn, Trumpet, Trombone, Tuba, Violin, Viola, Cello, Double Bass, Marimba, Xylophone, Vibraphone, Bells, Piano, Guitar
- **Best for:** Multi-sample instruments (each note recorded individually)
- **Used for:** Keyboardia's piano samples

#### 2. Philharmonia Orchestra Sound Samples
- **URL:** https://philharmonia.co.uk/resources/sound-samples/
- **License:** Creative Commons (free for commercial use, no resale)
- **Format:** 16-bit WAV or AIFF
- **Quality:** Professional, recorded by Philharmonia musicians
- **Instruments:** All standard orchestral instruments, guitar, mandolin, banjo, percussion
- **Best for:** Orchestral sounds, brass stabs, strings

#### 3. VSCO 2: Community Edition
- **URL:** https://versilian-studios.com/vsco-community/
- **GitHub:** https://github.com/sgossner/VSCO-2-CE
- **License:** Creative Commons 0 (public domain)
- **Format:** 24-bit WAV, ~3GB total
- **Quality:** Good, with round-robin samples for some instruments
- **Best for:** Strings, brass, woodwinds, french horn
- **Note:** CC0 means no attribution required

#### 4. Pianobook
- **URL:** https://www.pianobook.co.uk/
- **License:** Free for music creation (not for resale as sample libraries)
- **Format:** Decent Sampler, Kontakt, EXS24, SFZ
- **Quality:** Variable (community submissions), some excellent
- **Highlights:**
  - [Spring Piano](https://www.pianobook.co.uk/packs/spring-piano/) — Beautiful Schimmel piano
  - Kalimba, Melodica, world instruments
  - Weird/experimental sounds
- **Note:** Requires Decent Sampler or sample extraction

#### 5. Freesound
- **URL:** https://freesound.org/
- **CC0 Browse:** https://freesound.org/browse/tags/cc0/
- **License:** Mixed (filter by CC0 for public domain)
- **Format:** Various (WAV, MP3, FLAC)
- **Quality:** Highly variable (curate carefully)
- **Best for:** One-shots, loops, FX, vinyl crackle, tape hiss

### Secondary Sources

#### 6. Decent Samples Freebies
- **URL:** https://www.decentsamples.com/product-category/freebies/
- **License:** Various (check each)
- **Content:** 58+ free instruments in Decent Sampler format
- **Note:** Format requires conversion for web

#### 7. Spitfire LABS
- **URL:** https://www.spitfireaudio.com/labs
- **License:** Free for music creation
- **Quality:** High quality monthly free instruments
- **Note:** Requires their plugin (not web-compatible directly)

---

## Implementation Recommendations

### Phase 1: Quick Wins (1-2 days)

Add these using procedural synthesis:

```
PRIORITY PROCEDURAL SAMPLES:
├─ shaker       → Filtered noise burst, fast decay        [30 min]
├─ conga        → Pitched membrane with slap transient    [1 hr]
├─ tambourine   → Metallic jingles + noise               [1 hr]
├─ clave        → Two-tone wooden click                  [30 min]
├─ cabasa       → Ultra-short noise burst                [15 min]
└─ woodblock    → Resonant filtered click                [30 min]

Total: ~4 hours of implementation
Unlocks: Latin, Afrobeat, World percussion
No external files needed
```

### Phase 2: Texture Samples (2-3 days)

Add atmospheric/texture samples:

```
SINGLE-SAMPLE INSTRUMENTS (1 sample each):
├─ vinyl_crackle  → Loop from Freesound CC0           [~30KB]
├─ tape_hiss      → Loop from Freesound CC0           [~30KB]
├─ brass_stab     → VSCO 2 CE brass section hit       [~100KB]
└─ orch_hit       → VSCO 2 CE orchestral hit          [~100KB]

Total: ~260KB
Unlocks: Lo-fi, Cinematic, Disco, Soul
```

### Phase 3: Multi-Sample Instruments (1-2 weeks)

Following the piano implementation pattern:

```
MULTI-SAMPLE INSTRUMENTS:
├─ electric_bass  → U of Iowa (4 samples)             [~400KB]
├─ upright_bass   → U of Iowa (4 samples)             [~400KB]
├─ nylon_guitar   → U of Iowa (5 samples)             [~500KB]
└─ organ          → Pianobook (4 samples)             [~400KB]

Total: ~1.7MB
Unlocks: Jazz, Funk, Folk, Gospel, Rock
```

### Storage Estimate

| Phase | Instruments | Samples | Est. Size |
|-------|-------------|---------|-----------|
| Phase 1 | 6 | 0 | 0 KB (procedural) |
| Phase 2 | 5 | 5-10 | ~500 KB |
| Phase 3 | 4 | 16-20 | ~1.7 MB |
| **Total** | **15** | **~25** | **~2.2 MB** |

With lazy loading via the existing SampledInstrumentEngine, initial page load remains fast.

---

## Feature Synergy Matrix

How instrument additions interact with other features:

```
                        │ Impact on        │ Impact on
Feature                 │ Synth Sounds     │ Sampled Instruments
────────────────────────┼──────────────────┼─────────────────────
Reverb (Phase 22) ✅    │ Nice to have     │ ESSENTIAL (acoustics
                        │                  │ need room sound)
────────────────────────┼──────────────────┼─────────────────────
Delay (Phase 22) ✅     │ Creates rhythm   │ Creates realistic
                        │                  │ space (slapback, etc)
────────────────────────┼──────────────────┼─────────────────────
Triplet Mode            │ Opens jazz/soul  │ ESSENTIAL for jazz
(12/24 steps) ✅        │                  │ piano/bass
────────────────────────┼──────────────────┼─────────────────────
Extended Pitch          │ Good for leads   │ ESSENTIAL (piano
(±24 semitones) ✅      │                  │ needs 4+ octave range)
────────────────────────┼──────────────────┼─────────────────────
Filter Automation       │ ESSENTIAL        │ Less critical (real
                        │ (acid, wobble)   │ instruments don't filter)
────────────────────────┼──────────────────┼─────────────────────
Dual-Osc + LFO ✅       │ Adds richness    │ Not needed (already
                        │                  │ complex sounds)
────────────────────────┼──────────────────┼─────────────────────
Pattern Chaining        │ Song structure   │ Song structure
(proposed)              │                  │
────────────────────────┼──────────────────┼─────────────────────
Euclidean Rhythms       │ World rhythms    │ World rhythms
(proposed)              │                  │
```

✅ = Already implemented in current codebase

### Key Insight

**Adding sampled instruments INCREASES the value of effects (reverb/delay).**

A dry sampled piano sounds cheap. The same piano with room reverb sounds expensive. Effects that were "nice to have" for synths become "essential" for acoustic sounds.

---

## Demo Sessions with Broken Instruments

The following demo sessions reference instruments that don't exist:

| Session | Broken IDs | Fix |
|---------|------------|-----|
| `extended-afrobeat.json` | shaker, conga, synth:piano | Implement shaker/conga; change synth:piano → sampled:piano |
| `polyrhythmic-evolution.json` | shaker, conga | Implement shaker/conga |
| `progressive-house-build.json` | synth:piano | Change to sampled:piano |

**After implementing the procedural samples above, these sessions will work correctly.**

---

## Appendix: Technical References

### Web Audio API
- [AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode) — Sample playback
- [decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) — Loading samples
- [OscillatorNode](https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode) — Waveform generation

### Existing Implementation
- `app/src/audio/samples.ts` — Procedural sample generation
- `app/src/audio/synth.ts` — Web Audio synth presets
- `app/src/audio/toneSynths.ts` — Tone.js synth presets
- `app/src/audio/advancedSynth.ts` — Dual-oscillator synth presets
- `app/src/audio/sampled-instrument.ts` — Multi-sample instrument engine
- `app/src/components/sample-constants.ts` — UI instrument categories

---

*This document is part of the Keyboardia research collection. See also: [MUSICAL-COVERAGE-ANALYSIS.md](./MUSICAL-COVERAGE-ANALYSIS.md), [specs/ROADMAP.md](../../specs/ROADMAP.md)*
