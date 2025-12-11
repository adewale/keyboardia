# Keyboardia Instrument Expansion Research

A comprehensive analysis of how to add new instruments to Keyboardia, including current architecture, implementation approaches, prioritized instrument lists, and verified sample sources with URLs.

**Date:** December 2025
**Version:** 1.0.0

---

## Table of Contents

1. [Current Instrument Architecture](#current-instrument-architecture)
2. [How to Add New Instruments](#how-to-add-new-instruments)
3. [Prioritized Instrument List](#prioritized-instrument-list)
4. [Verified Sample Sources](#verified-sample-sources)
5. [Implementation Recommendations](#implementation-recommendations)

---

## Current Instrument Architecture

### Where Do Current Samples Come From?

**All 35 current sounds are procedurally generated in code** — there are no external audio files.

```
┌─────────────────────────────────────────────────────────────────────┐
│  CURRENT KEYBOARDIA SOUND SOURCES                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  PROCEDURAL SAMPLES (samples.ts) — 16 sounds                       │
│  ──────────────────────────────────────────────                    │
│  Generated using Web Audio API synthesis at runtime:                │
│                                                                     │
│  Drums (8):     kick, snare, hihat, clap, tom, rim, cowbell, openhat│
│  Bass (2):      bass (sawtooth), subbass (sine)                    │
│  Synth (4):     lead, pluck, chord, pad                            │
│  FX (2):        zap (sweep), noise (white burst)                   │
│                                                                     │
│  Implementation: Math.sin() + envelope shaping                      │
│  Location: app/src/audio/samples.ts                                │
│  File size: 0 bytes (generated on demand)                          │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SYNTH PRESETS (synth.ts) — 19 sounds                              │
│  ─────────────────────────────────────                             │
│  Real-time OscillatorNode synthesis with ADSR envelopes:            │
│                                                                     │
│  Core:      bass, lead, pad, pluck, acid                           │
│  Funk/Soul: funkbass, clavinet                                     │
│  Keys:      rhodes, organ, wurlitzer                               │
│  Disco:     discobass, strings, brass                              │
│  House:     stab, sub                                              │
│  Indie:     shimmer, jangle, dreampop, bell                        │
│                                                                     │
│  Implementation: OscillatorNode → BiquadFilterNode → GainNode       │
│  Location: app/src/audio/synth.ts                                  │
│  File size: 0 bytes (real-time synthesis)                          │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CUSTOM RECORDINGS (user-generated)                                │
│  ──────────────────────────────────                                │
│  Mic recordings stored as AudioBuffer, max 5 seconds               │
│  Implementation: MediaRecorder API → AudioContext.decodeAudioData   │
│  Storage: In-memory only (not persisted)                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Technical Details

**Procedural Drum Generation Example (kick):**
```typescript
// From samples.ts:130-146
async function createKick(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.5;
  const buffer = ctx.createBuffer(1, duration * ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / ctx.sampleRate;
    // Frequency drops from 150Hz to 40Hz (pitch envelope)
    const freq = 150 * Math.exp(-t * 10) + 40;
    // Amplitude envelope (exponential decay)
    const amp = Math.exp(-t * 8);
    data[i] = Math.sin(2 * Math.PI * freq * t) * amp;
  }
  return buffer;
}
```

**Synth Preset Example (rhodes):**
```typescript
// From synth.ts:91-99
rhodes: {
  waveform: 'sine',
  filterCutoff: 2500,
  filterResonance: 1,
  attack: 0.01,
  decay: 0.4,
  sustain: 0.5,
  release: 0.6,  // Mellow, bell-like - Herbie Hancock style
},
```

### Unused Infrastructure

The `Sample` interface has a `url` field that is currently empty for all samples:

```typescript
// From types.ts:72-77
export interface Sample {
  id: string;
  name: string;
  buffer: AudioBuffer | null;
  url: string;  // Currently '' for all samples — ready for external loading
}
```

This provides a foundation for loading external audio files.

---

## How to Add New Instruments

### Option 1: More Synth Presets (Easiest)

**Effort:** Minutes
**File changes:** `synth.ts` only
**External files:** None

Add new entries to `SYNTH_PRESETS`:

```typescript
// Example: adding a "wobble" preset
wobble: {
  waveform: 'sawtooth',
  filterCutoff: 400,
  filterResonance: 18,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.4,
  release: 0.2,
},
```

**Limitations:** Single oscillator, basic waveforms only.

### Option 2: More Procedural Samples (Easy)

**Effort:** Hours
**File changes:** `samples.ts`, `types.ts`
**External files:** None

Add new `createXxx()` functions and register in `SAMPLE_CATEGORIES`:

```typescript
// 1. Add generator function in samples.ts
async function createShaker(ctx: AudioContext): Promise<AudioBuffer> {
  // High-frequency filtered noise with fast attack/decay
  // ...
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
```

**Limitations:** Only sounds that can be synthesized mathematically.

### Option 3: External Audio Files (Medium)

**Effort:** Days
**File changes:** `engine.ts`, new loader module
**External files:** .mp3/.wav on R2 or CDN

```typescript
// New sample loader
async function loadExternalSample(
  audioContext: AudioContext,
  url: string
): Promise<AudioBuffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

// Usage
samples.set('piano', {
  id: 'piano',
  name: 'Piano',
  buffer: await loadExternalSample(ctx, 'https://r2.keyboardia.com/samples/piano-c4.mp3'),
  url: 'https://r2.keyboardia.com/samples/piano-c4.mp3',
});
```

**Considerations:**
- Loading time on slow connections
- Memory usage on mobile
- Error handling for failed fetches
- Caching strategy

### Option 4: Multi-Sample Instruments (Complex)

**Effort:** Weeks
**File changes:** New multi-sample system
**External files:** Multiple .mp3/.wav per instrument

For realistic piano, each octave needs its own sample with pitch-shifting between:

```typescript
// Instrument manifest format
interface MultiSampleInstrument {
  id: string;
  name: string;
  samples: {
    note: number;      // MIDI note (e.g., 60 = C4)
    url: string;       // Sample URL
    loopStart?: number;
    loopEnd?: number;
  }[];
  pitchRange: [number, number];  // Min/max playable notes
}

// Example: Piano with 5 samples spanning 4 octaves
const piano: MultiSampleInstrument = {
  id: 'piano',
  name: 'Acoustic Piano',
  samples: [
    { note: 36, url: '/instruments/piano/C2.mp3' },  // C2
    { note: 48, url: '/instruments/piano/C3.mp3' },  // C3
    { note: 60, url: '/instruments/piano/C4.mp3' },  // C4 (middle C)
    { note: 72, url: '/instruments/piano/C5.mp3' },  // C5
    { note: 84, url: '/instruments/piano/C6.mp3' },  // C6
  ],
  pitchRange: [24, 96],  // C1 to C7
};

// Playback: find nearest sample, pitch-shift
function playMultiSample(instrument: MultiSampleInstrument, midiNote: number) {
  const nearest = findNearestSample(instrument.samples, midiNote);
  const semitoneOffset = midiNote - nearest.note;
  const playbackRate = Math.pow(2, semitoneOffset / 12);
  // Play sample at playbackRate
}
```

---

## Prioritized Instrument List

### Tier 1: Highest Impact (5 instruments)

These unlock the most new genres with the least effort.

| Instrument | Type | Source | Genres Unlocked | Priority |
|------------|------|--------|-----------------|----------|
| **Acoustic Piano** | Multi-sample | [Pianobook](https://www.pianobook.co.uk/) | Jazz, ballads, pop, classical | 1 |
| **Upright Bass (pizz)** | Multi-sample | [Philharmonia](https://philharmonia.co.uk/resources/sound-samples/) | Jazz, soul, Motown | 2 |
| **Brass Section** | Single sample | [VSCO 2 CE](https://versilian-studios.com/vsco-community/) | Soul, disco, funk | 3 |
| **Vinyl Crackle** | Loop | [Freesound CC0](https://freesound.org/browse/tags/cc0/) | Lo-fi hip-hop | 4 |
| **Acoustic Guitar** | Multi-sample | [U of Iowa](https://theremin.music.uiowa.edu/) | Folk, bossa nova, cinematic | 5 |

### Tier 2: Genre-Specific Winners (5 instruments)

| Instrument | Type | Source | Genres Unlocked |
|------------|------|--------|-----------------|
| **Hammond B3 Organ** | Multi-sample | [Pianobook](https://www.pianobook.co.uk/) | Gospel, jazz, rock |
| **Slap Bass** | Single sample | [Freesound](https://freesound.org/) | Funk, disco |
| **Choir (ooh/aah)** | Multi-sample | [VSCO 2 CE](https://versilian-studios.com/vsco-community/) | Gospel, ambient, cinematic |
| **Kalimba** | Multi-sample | [Pianobook](https://www.pianobook.co.uk/) | Lo-fi, ambient |
| **808 Kit** | Sample pack | [Freesound CC0](https://freesound.org/browse/tags/cc0/) | Hip-hop, trap |

### Tier 3: Texture & Color (5 instruments)

| Instrument | Type | Source | Genres Unlocked |
|------------|------|--------|-----------------|
| **Tape Hiss** | Loop | [Freesound CC0](https://freesound.org/browse/tags/cc0/) | Lo-fi, synthwave |
| **Orchestral Hits** | Sample pack | [VSCO 2 CE](https://versilian-studios.com/vsco-community/) | Cinematic, EDM |
| **Marimba** | Multi-sample | [U of Iowa](https://theremin.music.uiowa.edu/) | World, pop |
| **Vibraphone** | Multi-sample | [U of Iowa](https://theremin.music.uiowa.edu/) | Jazz, ambient |
| **Melodica** | Multi-sample | [Pianobook](https://www.pianobook.co.uk/) | Reggae, dub |

### Tier 4: World & Percussion (5 instruments)

| Instrument | Type | Source | Genres Unlocked |
|------------|------|--------|-----------------|
| **Tabla** | Sample pack | [Freesound](https://freesound.org/) | Indian, ambient |
| **Steel Drums** | Multi-sample | [Philharmonia](https://philharmonia.co.uk/resources/sound-samples/) | Caribbean, tropical |
| **Congas** | Sample pack | [Freesound](https://freesound.org/) | Latin, Afrobeat |
| **Shaker** | Procedural | (generate in code) | All genres |
| **Tambourine** | Single sample | [Freesound CC0](https://freesound.org/browse/tags/cc0/) | Pop, soul |

---

## Verified Sample Sources

### Primary Sources (Recommended)

#### 1. Philharmonia Orchestra Sound Samples
- **URL:** https://philharmonia.co.uk/resources/sound-samples/
- **License:** Creative Commons (free for commercial use, no resale)
- **Format:** 16-bit WAV or AIFF
- **Content:** All standard orchestral instruments, guitar, mandolin, banjo, percussion
- **Quality:** Professional, recorded by Philharmonia musicians
- **Notes:** The go-to source for orchestral samples. Strings, brass, woodwinds, percussion all available.

#### 2. University of Iowa Musical Instrument Samples (MIS)
- **URL:** https://theremin.music.uiowa.edu/
- **License:** Public domain (no restrictions since 1997)
- **Format:** 16-bit 44.1kHz AIFF (mono), piano in stereo; new strings at 24/96
- **Content:** 23 orchestral instruments recorded note-by-note at 3 dynamics
- **Instruments:** Flute, Oboe, Clarinet, Bassoon, Saxophone, Horn, Trumpet, Trombone, Tuba, Violin, Viola, Cello, Double Bass, Marimba, Xylophone, Vibraphone, Bells, Piano, Guitar
- **Quality:** Academic-grade, anechoic chamber recordings
- **Notes:** Perfect for multi-sample instruments. Each note recorded individually.

#### 3. VSCO 2: Community Edition
- **URL:** https://versilian-studios.com/vsco-community/
- **GitHub:** https://github.com/sgossner/VSCO-2-CE
- **License:** Creative Commons 0 (public domain)
- **Format:** 24-bit WAV, ~3GB total
- **Content:** Full orchestral library with articulations
- **Quality:** Good, with round-robin samples for some instruments
- **Notes:** Great for strings, brass, woodwinds. CC0 means no attribution required.

#### 4. Pianobook
- **URL:** https://www.pianobook.co.uk/
- **License:** Free for music creation (not for resale as sample libraries)
- **Format:** Decent Sampler, Kontakt, EXS24, SFZ
- **Content:** 1,000+ free virtual instruments
- **Quality:** Variable (community submissions), some excellent
- **Highlights:**
  - [Spring Piano](https://www.pianobook.co.uk/packs/spring-piano/) — Beautiful Schimmel piano
  - Kalimba, Melodica, world instruments
  - Weird/experimental sounds
- **Notes:** Requires free Decent Sampler plugin or converting samples.

#### 5. Freesound
- **URL:** https://freesound.org/
- **CC0 Browse:** https://freesound.org/browse/tags/cc0/
- **License:** Mixed (filter by CC0 for public domain)
- **Format:** Various (WAV, MP3, FLAC)
- **Content:** ~600,000 sounds, collaborative database
- **Quality:** Highly variable (curate carefully)
- **Notes:** Best for one-shots, loops, and FX. Search for "drum kit", "vinyl crackle", etc.

### Secondary Sources

#### 6. Decent Samples Freebies
- **URL:** https://www.decentsamples.com/product-category/freebies/
- **License:** Various (check each)
- **Content:** 58+ free instruments in Decent Sampler format
- **Notes:** Ready-to-use instruments, but format requires conversion for web.

#### 7. Spitfire LABS
- **URL:** https://www.spitfireaudio.com/labs
- **License:** Free for music creation
- **Content:** Monthly free instruments from Spitfire Audio
- **Highlights:** Soft Piano, Strings, Drums, Choir
- **Notes:** High quality but requires their plugin (not web-compatible).

#### 8. Virtual Playing Orchestra
- **URL:** https://virtualplaying.com/virtual-playing-orchestra/
- **License:** Various CC licenses (check each)
- **Content:** Combines VSCO 2 CE, U of Iowa, Sonatina, and others
- **Notes:** Pre-organized orchestral library, SFZ format.

---

## Implementation Recommendations

### Phase 1: Quick Wins (1-2 days)

Add these using **procedural synthesis** (Option 2):

```
NEW PROCEDURAL SAMPLES:
├─ shaker       → Filtered noise burst, fast decay
├─ tambourine   → Noise + metallic partials
├─ cabasa       → Very short noise burst
├─ clave        → Two-tone click (like rim but pitched)
└─ woodblock    → Filtered click with resonance
```

These are achievable with the existing `samples.ts` pattern.

### Phase 2: External Sample Loading (1 week)

1. Build sample fetcher with caching
2. Add loading states to UI
3. Start with single-sample instruments:

```
SINGLE-SAMPLE INSTRUMENTS (1 sample each):
├─ vinyl_crackle  → Loop from Freesound CC0
├─ tape_hiss      → Loop from Freesound CC0
├─ brass_stab     → VSCO 2 CE brass section hit
├─ orch_hit       → VSCO 2 CE orchestral hit
└─ choir_ah       → VSCO 2 CE choir sustain
```

### Phase 3: Multi-Sample Instruments (2-3 weeks)

1. Design manifest format
2. Build pitch-mapping player
3. Add lazy loading with progress indicator
4. Start with:

```
MULTI-SAMPLE INSTRUMENTS:
├─ piano         → Pianobook Spring Piano (5-6 samples)
├─ upright_bass  → U of Iowa (5 samples across range)
├─ vibraphone    → U of Iowa (chromatic samples)
└─ guitar_nylon  → U of Iowa (5 samples across range)
```

### Storage Estimate

| Tier | Instruments | Samples | Est. Size |
|------|-------------|---------|-----------|
| Phase 1 | 5 | 0 | 0 KB (procedural) |
| Phase 2 | 5 | 5-10 | ~2 MB |
| Phase 3 | 4 | 20-25 | ~15 MB |
| **Total** | **14** | **~30** | **~17 MB** |

With lazy loading, initial page load stays fast.

---

## Sources

### Official Sample Libraries
- [Philharmonia Orchestra Sound Samples](https://philharmonia.co.uk/resources/sound-samples/) — CC license, orchestral
- [University of Iowa MIS](https://theremin.music.uiowa.edu/) — Public domain, academic-grade
- [VSCO 2: Community Edition](https://versilian-studios.com/vsco-community/) — CC0, orchestral
- [Pianobook](https://www.pianobook.co.uk/) — Free, community instruments
- [Freesound](https://freesound.org/) — CC0/CC-BY, collaborative database

### Plugin Platforms (Reference)
- [Decent Sampler](https://www.decentsamples.com/product/decent-sampler-plugin/) — Free sample player
- [Spitfire LABS](https://www.spitfireaudio.com/labs) — Free monthly instruments

### Technical References
- [Web Audio API - AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode) — Sample playback
- [Web Audio API - decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) — Loading samples

---

*This document is part of the Keyboardia research collection. See also: [MUSICAL-REACH-ANALYSIS.md](./MUSICAL-REACH-ANALYSIS.md), [specs/ROADMAP.md](../../specs/ROADMAP.md)*
