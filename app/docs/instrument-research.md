# Instrument Research Document

## Overview

This document catalogs all instruments currently available in Keyboardia and provides research on recommended future additions. All instruments are designed to be deterministic and multiplayer-compatible.

**Last Updated:** Phase 21A

---

## Part 1: Current Instrument Inventory

### Summary

| Category | Count | Type |
|----------|-------|------|
| Synthesized Samples | 10 | Runtime-generated AudioBuffers (drums + FX) |
| Synth Presets | 33 | Real-time synthesis (oscillators + filters) |
| Sampled Instruments | 1 | Pre-recorded audio files (piano) |
| **Total** | **44** | |

**Note:** Melodic one-shot samples (bass, subbass, lead, pluck, chord, pad) were removed as redundant — the real-time synth presets (`synth:bass`, `synth:lead`, etc.) provide the same sounds with better pitch control and envelope features.

---

## 1.1 Synthesized Samples (10 total)

These are one-shot sounds generated at runtime using Web Audio API oscillators. Zero external files.

### Drums (8)

| ID | Name | Waveform | Character | Use Case |
|----|------|----------|-----------|----------|
| `kick` | Kick | Sine + pitch envelope | Deep, punchy low-end | 4-on-the-floor, downbeats |
| `snare` | Snare | Noise + triangle | Sharp crack with body | Backbeat (2 & 4) |
| `hihat` | Hi-Hat | Filtered noise | Bright, short | Eighth notes, groove |
| `clap` | Clap | Layered noise bursts | Wide, room-y | Emphasize snare, fills |
| `tom` | Tom | Sine + pitch sweep | Melodic, deep | Fills, tribal patterns |
| `rim` | Rim | Triangle + noise | Sharp, woody | Ghost notes, accents |
| `cowbell` | Cowbell | Square + bandpass | Metallic, cutting | Disco, Latin, funk |
| `openhat` | Open Hat | Long noise decay | Sizzle, sustain | Offbeats, transitions |

### FX (2)

| ID | Name | Waveform | Character | Use Case |
|----|------|----------|-----------|----------|
| `zap` | Zap | Saw + fast pitch drop | Laser, sci-fi | Accents, transitions |
| `noise` | Noise | White noise | Texture, hiss | Builds, fills |

---

## 1.2 Synth Presets (33 total)

Real-time synthesis using oscillators, filters, envelopes, and LFOs. All parameters are preset-locked (no user adjustment) to ensure multiplayer sync.

### Core (5 presets)

| ID | Name | Waveform | Filter | ADSR | Character |
|----|------|----------|--------|------|-----------|
| `bass` | Bass | Sawtooth | 900Hz, Q6 | 0.01/0.2/0.5/0.1 | Warm, fundamental bass |
| `lead` | Lead | Square | 2500Hz, Q5 | 0.01/0.1/0.8/0.3 | Cutting, present melody |
| `pad` | Pad | Sine | 5000Hz, Q2 | 0.05/0.3/0.85/1.0 | Soft, atmospheric sustain |
| `pluck` | Pluck | Triangle | 3500Hz, Q10 | 0.005/0.4/0.15/0.25 | Percussive, bright attack |
| `acid` | Acid | Sawtooth | 600Hz, Q16 | 0.01/0.15/0.35/0.1 | TB-303 style, squelchy |

### Keys (8 presets)

| ID | Name | Waveform | Special Features | Character |
|----|------|----------|------------------|-----------|
| `piano` | Piano | Triangle | Osc2: sine +2¢, filterEnv | Hammer attack, natural decay |
| `rhodes` | Rhodes | Sine | — | Mellow, bell-like (Herbie Hancock) |
| `organ` | Organ | Square | — | Sustained, churchy (Hammond B3) |
| `wurlitzer` | Wurli | Triangle | — | Warmer than Rhodes, more bark |
| `clavinet` | Clav | Sawtooth | — | Bright, percussive (Stevie Wonder) |
| `epiano` | E.Piano | Triangle | Osc2: sine +5¢ | Electric piano, layered |
| `vibes` | Vibes | Sine | LFO→amplitude 5Hz | Vibraphone tremolo |
| `organphase` | Phase | Square | Osc2: -12st, LFO→pitch 0.8Hz | Rotary speaker effect |

### Electronic (6 presets)

| ID | Name | Waveform | Special Features | Character |
|----|------|----------|------------------|-----------|
| `supersaw` | Super | Sawtooth | Osc2: saw +25¢ | Classic trance, thick |
| `hypersaw` | Hyper | Sawtooth | Osc2: saw +50¢, filterEnv | Massive, even thicker |
| `wobble` | Wobble | Sawtooth | LFO→filter 2Hz | Dubstep bass wobble |
| `growl` | Growl | Square | LFO→filter 4Hz (square), filterEnv | Aggressive modulation |
| `stab` | Stab | Sawtooth | Q10 | Classic house chord stab |
| `sub` | Sub | Sine | 200Hz cutoff, Q0 | Deep sub bass, minimal |

### Bass (4 presets)

| ID | Name | Waveform | Special Features | Character |
|----|------|----------|------------------|-----------|
| `funkbass` | Funk | Square | Short release (0.05s) | Punchy, Bootsy Collins |
| `discobass` | Disco | Sawtooth | — | Octave-jumping groove |
| `reese` | Reese | Sawtooth | Osc2: saw +15¢, LFO→filter 0.5Hz | Jungle/DnB, phasing |
| `hoover` | Hoover | Sawtooth | Osc2: saw -12st +40¢, filterEnv(-) | Mentasm, downward sweep |

### Strings (3 presets)

| ID | Name | Waveform | Special Features | Character |
|----|------|----------|------------------|-----------|
| `strings` | Strings | Sawtooth | Long release (0.8s) | Philly strings, lush |
| `brass` | Brass | Sawtooth | Q3, attack 0.05s | Punchy horn stabs |
| `warmpad` | Warm | Sawtooth | Osc2: sine +7¢ | Subtle chorus, full pad |

### Ambient (7 presets)

| ID | Name | Waveform | Special Features | Character |
|----|------|----------|------------------|-----------|
| `shimmer` | Shimmer | Sine | Release 2.0s | Ethereal tail, shoegaze |
| `jangle` | Jangle | Triangle | Q4 | Bright, chiming (Jazzmaster) |
| `dreampop` | Dream | Sawtooth | Release 1.5s | Hazy, shoegaze texture |
| `bell` | Bell | Sine | Decay 0.5s, release 1.0s | Pure tone, vibraphone-like |
| `evolving` | Evolve | Sawtooth | FilterEnv 2s attack, LFO 0.2Hz | Slow organic movement |
| `sweep` | Sweep | Sawtooth | Osc2: +15¢, filterEnv 1s attack | Build/transition sound |
| `glass` | Glass | Sine | Osc2: triangle +12st, filterEnv | Crystalline, bright attack |

---

## 1.3 Sampled Instruments (1 total)

Pre-recorded audio samples loaded from files. Used when synthesis cannot convincingly replicate the sound.

### Piano

| Property | Value |
|----------|-------|
| **ID** | `piano` |
| **Source** | University of Iowa Musical Instrument Samples |
| **License** | Public Domain |
| **Samples** | 4 notes: C2, C3, C4, C5 (MIDI 36, 48, 60, 72) |
| **Size** | ~320KB total |
| **Technique** | Pitch-shifting between sampled notes |
| **Loading** | Progressive (C4 first, others in background) |
| **Release** | 0.8 seconds |

**Why Sampled:** Piano hammer attack and string resonance cannot be convincingly synthesized. Even dual-oscillator synthesis sounds like "sine + triangle blend," not a real piano.

---

## Part 2: Synthesis Engine Capabilities

### Core Parameters (all presets)

| Parameter | Range | Description |
|-----------|-------|-------------|
| `waveform` | sine, triangle, sawtooth, square | Oscillator shape |
| `filterCutoff` | 100-10000 Hz | Lowpass filter frequency |
| `filterResonance` | 0-20 | Filter emphasis at cutoff |
| `attack` | 0-1s | Time to reach peak volume |
| `decay` | 0-1s | Time to reach sustain level |
| `sustain` | 0-1 | Volume while held |
| `release` | 0-2s | Fade time after release |

### Enhanced Parameters (Phase 21A)

| Feature | Parameters | Use Case |
|---------|------------|----------|
| **Osc2** | waveform, detune (±100¢), coarse (±24st), mix | Layering, detuning, octaves |
| **Filter Envelope** | amount (±1), attack, decay, sustain | Filter movement over time |
| **LFO** | waveform, rate (0.1-20Hz), depth, destination | Wobble, vibrato, tremolo |

### Audio Engineering Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_VOICES` | 16 | Prevent CPU overload |
| `ENVELOPE_PEAK` | 0.85 | Full, rich sound (was 0.1 before gain fix) |
| `MAX_FILTER_RESONANCE` | 20 | Prevent self-oscillation |

---

## Part 3: Recommended Future Instruments

### Priority Order (by impact-to-effort ratio)

#### Priority 1: Electric Bass (Fingered/Plucked)

| Aspect | Details |
|--------|---------|
| **Why** | Single biggest genre unlock: funk, soul, jazz, rock, disco, indie |
| **Gap** | Synth bass sounds "synthy" — real bass has distinctive string attack |
| **Source** | University of Iowa or Philharmonia (public domain) |
| **Samples** | 4 notes: E1, E2, E3, E4 |
| **Size** | ~300-400KB |
| **Coverage Impact** | +15-20% |
| **Technical** | Same pattern as piano: pitch-shift between sampled notes |

#### Priority 2: Vinyl Crackle / Tape Hiss

| Aspect | Details |
|--------|---------|
| **Why** | Tiny effort, huge aesthetic impact for lo-fi |
| **Gap** | No texture/ambiance sounds currently |
| **Implementation** | Single looping sample, not pitched |
| **Size** | ~30-50KB |
| **Coverage Impact** | +8-10% (lo-fi genre) |
| **Technical** | Loop with crossfade, volume control via gain |

#### Priority 3: Clean Electric Guitar

| Aspect | Details |
|--------|---------|
| **Why** | Unlocks indie, rock, funk rhythm parts |
| **Gap** | `jangle` preset attempts this but lacks string character |
| **Source** | Philharmonia or similar |
| **Samples** | 4-5 notes spanning range |
| **Size** | ~400-500KB |
| **Coverage Impact** | +10-12% |
| **Technical** | May need longer samples for sustain |

#### Priority 4: Brass Stabs (Short)

| Aspect | Details |
|--------|---------|
| **Why** | Better disco and funk coverage |
| **Gap** | `brass` synth preset lacks breath attack realism |
| **Source** | Philharmonia brass section |
| **Samples** | Short stabs only (not sustained) |
| **Size** | ~200KB |
| **Coverage Impact** | +5-8% |
| **Technical** | Short samples = small files |

#### Priority 5: Choir "Aah" Pad

| Aspect | Details |
|--------|---------|
| **Why** | Emotional depth for ballads, cinematic, ambient |
| **Gap** | No vocal/choir sounds |
| **Source** | Public domain choir samples |
| **Samples** | Single sustained "aah," pitch-shifted |
| **Size** | ~200-300KB |
| **Coverage Impact** | +5% |
| **Technical** | Works like piano with long sustain |

### Synth Presets (No Samples Needed)

These can be added as new presets using existing synthesis engine:

| Sound | Approach | Effort |
|-------|----------|--------|
| **FM Bass** (DX7) | FM synthesis with 2 oscillators | Medium |
| **Chip/8-bit** | Simple square waves, low-fi | Low |
| **PWM Pad** | Pulse width modulation (needs engine work) | High |
| **Sync Lead** | Oscillator sync (needs engine work) | High |

### What to Avoid (For Now)

| Instrument | Reason |
|------------|--------|
| **Distorted Guitar** | Distortion modeling is complex; sounds bad when wrong |
| **Full Drum Kit Samples** | Synthesized drums work well; multisampled drums are huge |
| **Full Orchestra** | Requires many articulations (legato, staccato, pizzicato) |
| **Saxophone** | Breath control and expression too nuanced for step sequencer |
| **Acoustic Guitar** | Strumming patterns need multiple articulations |

---

## Part 4: Genre Coverage Analysis

### Current Coverage

| Genre | Coverage | Limiting Factors |
|-------|----------|------------------|
| House/Techno | 95% | ✓ Solved |
| Disco | 90% | ✓ Solved |
| Synth-pop | 75% | Minor gaps |
| Lo-fi Hip-hop | 50% | No vinyl crackle, limited keys |
| Funk/Soul | 45% | Need real bass, better brass |
| Jazz | 25% | Need upright bass, brushes |
| Rock/Indie | 20% | Need guitar, real bass |
| Classical | 5% | Architectural limits |

### Projected Coverage After Additions

| Addition | Cumulative Coverage |
|----------|-------------------|
| Current | ~35% of all music |
| + Electric Bass | ~50% |
| + Vinyl Crackle | ~58% |
| + Clean Guitar | ~68% |
| + Brass Stabs | ~73% |
| + Choir | ~78% |

### Architectural Limits (Cannot Overcome)

| Blocker | Affected Genres | Why |
|---------|-----------------|-----|
| **12-TET only** | Maqam, Indian classical | Microtonal pitch system is fundamental |
| **Power-of-2 steps** | Progressive rock (5/4, 7/8) | Step counts limited by design |
| **Grid quantization** | Jazz phrasing, classical rubato | Required for multiplayer sync |
| **Web Audio latency** | Live monitoring | 30-100ms minimum latency |
| **Discrete steps** | Blues, slide guitar | No pitch bends between steps |

---

## Part 5: Implementation Pattern

### For New Sampled Instruments

Follow the piano implementation pattern:

```typescript
// 1. Add to SAMPLED_INSTRUMENTS array
export const SAMPLED_INSTRUMENTS = [
  'piano',
  'bass',  // NEW
] as const;

// 2. Create manifest.json in /public/instruments/{id}/
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
    "url": "https://...",
    "license": "Public Domain"
  }
}

// 3. Register in AudioEngine.initialize()
sampledInstrumentRegistry.register('bass');

// 4. Add synth fallback preset (optional but recommended)
// In synth.ts SYNTH_PRESETS

// 5. Add to SamplePicker categories
// In SamplePicker.tsx SYNTH_CATEGORIES
```

### For New Synth Presets

```typescript
// Add to SYNTH_PRESETS in synth.ts
newpreset: {
  waveform: 'sawtooth',
  filterCutoff: 2000,
  filterResonance: 5,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.3,
  // Optional enhanced features:
  osc2: { waveform: 'sine', detune: 10, coarse: 0, mix: 0.3 },
  filterEnv: { amount: 0.5, attack: 0.1, decay: 0.3, sustain: 0.2 },
  lfo: { waveform: 'sine', rate: 2, depth: 0.5, destination: 'filter' },
},

// Then add to SYNTH_CATEGORIES and SYNTH_NAMES in SamplePicker.tsx
```

---

## Part 6: Design Philosophy

### The OP-Z Approach

Keyboardia follows the Elektron OP-Z philosophy: complex synthesis engine with simple, preset-based interface.

**Principles:**
1. Users pick presets, not parameters
2. Every preset is carefully tuned by sound designers
3. `sampleId` is the only state that syncs (zero new fields needed)
4. Presets are discoverable via category-based picker

### The Three Surfaces Rule

Any instrument feature must exist across three surfaces simultaneously:

| Surface | What it means |
|---------|---------------|
| **API** | Audio code can produce the sound |
| **UI** | Users can select/control it |
| **Session State** | It persists and syncs via WebSocket |

If any surface is missing, the feature breaks product coherence.

### Deterministic Audio Requirement

All instruments must produce identical audio across all players. This rules out:
- Local-only effects (reverb, delay without sync)
- Random variations
- User-adjustable parameters (without state sync)

---

## Appendix: Quick Reference

### All Instrument IDs

**One-Shot Samples (10):**
```
Drums: kick, snare, hihat, clap, tom, rim, cowbell, openhat
FX: zap, noise
```

**Synth Presets (33):**
```
Core: bass, lead, pad, pluck, acid
Keys: piano, rhodes, organ, wurlitzer, clavinet, epiano, vibes, organphase
Electronic: supersaw, hypersaw, wobble, growl, stab, sub
Bass: funkbass, discobass, reese, hoover
Strings: strings, brass, warmpad
Ambient: shimmer, jangle, dreampop, bell, evolving, sweep, glass
```

**Sampled Instruments (1):**
```
piano
```
