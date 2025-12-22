# Sample Impact Research for Keyboardia

> Research document analyzing which sampled instruments would have the most impact on Keyboardia's popularity and usefulness.

## Current State

- **40+ synth presets** (all procedurally generated)
- **14 procedural percussion sounds**
- **1 sampled instrument** (Grand Piano - University of Iowa, ~486KB)
- **Target audience**: Musicians, producers, electronic music enthusiasts, collaborative creators

### Reference Point
- Current Piano: 4 samples × 120KB = **486KB** total
- Format: MP3, octave-spaced (C2, C3, C4, C5)

---

## Existing Instrument Inventory

### Procedural Samples (20 items, 0KB - generated at runtime)
```
DRUMS (8):     kick, snare, hihat, clap, tom, rim, cowbell, openhat
WORLD (6):     shaker, conga, tambourine, clave, cabasa, woodblock
BASS (2):      bass, subbass
SYNTH (4):     lead, pluck, chord, pad
FX (2):        zap, noise
```

### Web Audio Synth Presets (28 items, 0KB)
```
CORE (5):      bass, lead, pad, pluck, acid
FUNK (2):      funkbass, clavinet
KEYS (3):      rhodes, organ, wurlitzer
DISCO (3):     discobass, strings, brass
HOUSE (2):     stab, sub
INDIE (4):     shimmer, jangle, dreampop, bell
ENHANCED (9):  supersaw, hypersaw, wobble, growl, evolving, sweep, warmpad, glass, epiano, vibes, organphase, reese, hoover
```

### Tone.js Presets (11 items, 0KB)
```
FM (3):        fm-epiano, fm-bass, fm-bell
DRUMS (4):     membrane-kick, membrane-tom, metal-cymbal, metal-hihat
OTHER (4):     pluck-string, duo-lead, am-bell, am-tremolo
```

### Advanced Synth Presets (8 items, 0KB)
```
LEADS (3):     supersaw, thick-lead, vibrato-lead
BASS (3):      sub-bass, wobble-bass, acid-bass
PADS (2):      warm-pad, tremolo-strings
```

### Sampled Instruments (1 item, 486KB)
```
KEYS (1):      piano
```

**Total existing: 68 instruments, ~486KB**

---

## Replacement Analysis

### PROCEDURAL DRUMS → 808 SAMPLES

The existing procedural drums ARE 808-style synthesis:

```javascript
// Current kick: sine wave with frequency sweep 150Hz→40Hz (808 technique)
const freq = 150 * Math.exp(-t * 10) + 40;

// Current snare: noise + tone mix (808 technique)
const noise = (Math.random() * 2 - 1) * Math.exp(-t * 15);
const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 20);
```

Real 808 samples should **replace** these, not add alongside them:

| Current Procedural | Replace With | Why |
|--------------------|--------------|-----|
| `kick` | `sampled:808-kick` | Already attempting 808 - samples authentic |
| `snare` | `sampled:808-snare` | Already attempting 808 - samples authentic |
| `hihat` | `sampled:808-hat` | Already attempting 808 - samples authentic |
| `clap` | `sampled:808-clap` | Already attempting 808 - samples authentic |

**Keep as procedural**: `tom`, `rim`, `cowbell`, `openhat`, world percussion (unique character)

### SYNTH → SAMPLED UPGRADES

| Current Synth | Replace With | Why Replace | Size |
|---------------|--------------|-------------|------|
| `synth:rhodes` | `sampled:rhodes` | Can't synthesize tines accurately | +500KB |
| `synth:strings` | `sampled:strings` | Can't synthesize ensemble accurately | +600KB |
| `synth:brass` | `sampled:brass-stab` | Can't synthesize brass section accurately | +200KB |
| `synth:vibes` | `sampled:vibraphone` | Can't synthesize mallet resonance | +350KB |

### SHOULD STAY AS SYNTH

These sounds ARE synthesizers - replacement would be wrong:

| Synth | Why Keep |
|-------|----------|
| `synth:acid` | TB-303 IS a synthesizer |
| `synth:reese`, `synth:hoover` | Named synth patches |
| `synth:wobble`, `synth:growl` | LFO modulation IS the sound |
| `synth:supersaw`, `synth:hypersaw` | Detuned saws ARE the sound |
| `synth:sub` | Pure sine - synthesis is perfect |
| `synth:pad`, `synth:warmpad` | Synth pads work well |
| `synth:organ` | Drawbar simulation works |
| `synth:wurlitzer`, `synth:clavinet` | CUT - Rhodes covers EP space |

---

## Items Cut (Redundant/Niche)

| Cut | Reason |
|-----|--------|
| `sampled:808-tom` | Keep procedural `tom` - pitch it |
| `sampled:wurlitzer` | Rhodes covers EP space |
| `sampled:clavinet` | Niche funk, low demand |
| `sampled:piano-upright` | Already have grand piano |
| `sampled:piano-toy` | Very niche |
| `sampled:celesta` | Very niche orchestral |
| `sampled:bass-pick` | Finger bass covers 90% |
| `sampled:bass-upright` | Niche, finger bass approximates |
| `sampled:glockenspiel` | Niche, bell synth covers |
| `sampled:music-box` | Very niche |
| `sampled:strings-pizz` | Niche, pluck synth approximates |
| `sampled:choir-ooh` | One choir sound sufficient |
| `sampled:flute` | Niche orchestral |
| `sampled:brass-swell` | Brass stab sufficient |
| `sampled:tape-stop` | Niche effect |
| `sampled:riser` | EDM-specific, synth sweep exists |
| `sampled:impact` | EDM-specific |
| `sampled:noise-bed` | Existing `noise` covers this |

**18 items cut**

---

## Final Instrument List (26 items)

### REPLACEMENTS (8 items, net zero UI change)

| # | ID | Replaces | Size | Impact |
|---|-----|----------|------|--------|
| 1 | `sampled:808-kick` | `kick` | 180KB | Authentic 808 |
| 2 | `sampled:808-snare` | `snare` | 120KB | Authentic 808 |
| 3 | `sampled:808-hat` | `hihat` | 90KB | Authentic 808 |
| 4 | `sampled:808-clap` | `clap` | 60KB | Authentic 808 |
| 5 | `sampled:rhodes` | `synth:rhodes` | 500KB | Real tines |
| 6 | `sampled:strings` | `synth:strings` | 600KB | Real ensemble |
| 7 | `sampled:brass-stab` | `synth:brass` | 200KB | Real brass |
| 8 | `sampled:vibraphone` | `synth:vibes` | 350KB | Real mallets |

**Replacements: 2.1MB**

### NEW ADDITIONS (18 items)

| # | ID | Name | Size | Genres Unlocked |
|---|-----|------|------|-----------------|
| 9 | `sampled:acoustic-kick` | Ac. Kick | 160KB | Rock, Indie, Jazz |
| 10 | `sampled:acoustic-snare` | Ac. Snare | 160KB | Rock, Indie, Jazz |
| 11 | `sampled:acoustic-hat` | Ac. Hat | 120KB | Rock, Indie, Jazz |
| 12 | `sampled:acoustic-ride` | Ride | 100KB | Jazz, Rock |
| 13 | `sampled:acoustic-crash` | Crash | 120KB | Rock, Pop |
| 14 | `sampled:brushes-snare` | Brushes | 120KB | Jazz, Lo-fi |
| 15 | `sampled:vinyl-crackle` | Vinyl | 80KB | Lo-fi, Chillhop |
| 16 | `sampled:bass-finger` | Finger Bass | 400KB | Funk, R&B, Jazz |
| 17 | `sampled:bass-slap` | Slap Bass | 450KB | Funk, Disco |
| 18 | `sampled:guitar-clean` | Clean Gtr | 450KB | Indie, Lo-fi, Funk |
| 19 | `sampled:guitar-muted` | Muted Gtr | 400KB | Funk, Disco |
| 20 | `sampled:guitar-acoustic` | Acoustic Gtr | 500KB | Folk, Unplugged |
| 21 | `sampled:marimba` | Marimba | 400KB | Afrobeat, Latin |
| 22 | `sampled:kalimba` | Kalimba | 160KB | Lo-fi, Ambient |
| 23 | `sampled:choir-aah` | Choir | 450KB | Cinematic, Gospel |
| 24 | `sampled:sax-alto` | Alto Sax | 400KB | Jazz, Funk, Soul |
| 25 | `sampled:vocal-f` | Vocal F | 250KB | House, Pop |
| 26 | `sampled:vocal-m` | Vocal M | 250KB | Hip-hop, R&B |

**New additions: 4.5MB**

---

## Priority Tiers

### Tier 1: Essential (~2.0MB) — 75% genre coverage

| Pri | Instrument | Type | Size | Cumulative |
|-----|------------|------|------|------------|
| 1 | 808 Kit (4) | REPLACE | 450KB | 450KB |
| 2 | Acoustic Kit (5) | NEW | 660KB | 1.1MB |
| 3 | Finger Bass | NEW | 400KB | 1.5MB |
| 4 | Rhodes | REPLACE | 500KB | 2.0MB |

### Tier 2: Professional (~4.2MB) — 90% genre coverage

| Pri | Instrument | Type | Size | Cumulative |
|-----|------------|------|------|------------|
| 5 | Vinyl Crackle | NEW | 80KB | 2.1MB |
| 6 | Clean Guitar | NEW | 450KB | 2.5MB |
| 7 | Strings | REPLACE | 600KB | 3.1MB |
| 8 | Vocal Chops (2) | NEW | 500KB | 3.6MB |
| 9 | Brass Stab | REPLACE | 200KB | 3.8MB |
| 10 | Alto Sax | NEW | 400KB | 4.2MB |

### Tier 3: Complete (~6.5MB) — 100% genre coverage

| Pri | Instrument | Type | Size | Cumulative |
|-----|------------|------|------|------------|
| 11 | Slap Bass | NEW | 450KB | 4.7MB |
| 12 | Muted Guitar | NEW | 400KB | 5.1MB |
| 13 | Acoustic Guitar | NEW | 500KB | 5.6MB |
| 14 | Vibraphone | REPLACE | 350KB | 5.9MB |
| 15 | Marimba | NEW | 400KB | 6.3MB |
| 16 | Choir | NEW | 450KB | 6.8MB |
| 17 | Kalimba | NEW | 160KB | 6.9MB |

---

## Final Summary

| Metric | Original | Revised | Savings |
|--------|----------|---------|---------|
| Total instruments | 44 | **26** | -18 |
| Replacements | 6 | **8** | +2 |
| Net new UI items | +38 | **+18** | -20 |
| Bundle size | 11.8MB | **6.5MB** | **-5.3MB** |

### UI Impact

```
CATEGORY        CURRENT    REPLACE    +NEW    FINAL
────────────────────────────────────────────────────
drums           18         -4         +6      20
bass            12         0          +2      14
keys            10         -1         0       9
leads           11         -1         +7      17
pads            12         -1         +1      12
fx              10         -1         +2      11
────────────────────────────────────────────────────
TOTAL           73         -8         +18     83
```

### The 8 Replacements
1. `kick` → `sampled:808-kick`
2. `snare` → `sampled:808-snare`
3. `hihat` → `sampled:808-hat`
4. `clap` → `sampled:808-clap`
5. `synth:rhodes` → `sampled:rhodes`
6. `synth:strings` → `sampled:strings`
7. `synth:brass` → `sampled:brass-stab`
8. `synth:vibes` → `sampled:vibraphone`

---

## Licensing Sources

Quality royalty-free sources for samples:

| Source | License | Best For |
|--------|---------|----------|
| University of Iowa | Free, unrestricted | Piano (already used), orchestral |
| Philharmonia Orchestra | CC BY-SA | Orchestral samples |
| Freesound.org | CC0 | Percussion, FX, textures |
| VSCO2 Community Orchestra | CC | Strings, brass, woodwinds |
| Instruments provided by Sonatina | CC | Full orchestra |
| Salamander Grand Piano | CC BY | Alternative piano samples |
| Music Radar | Royalty-free | Drum kits, loops |

---

## Multiplayer Impact

For Keyboardia's unique multiplayer angle, samples enabling clear role separation:

| Player | Role | Recommended Instruments |
|--------|------|------------------------|
| A | Rhythm | 808/Acoustic drums |
| B | Foundation | Bass (finger/slap) |
| C | Harmony | Piano/Rhodes |
| D | Texture | Guitar/Strings |
| E | Ear candy | Vocal chops/FX |

This "band in a browser" experience is Keyboardia's killer differentiator.

---

## Implementation Notes

### Sample Format
- MP3 for size efficiency
- 44.1kHz, mono or stereo depending on instrument
- Octave-spaced sampling with pitch-shifting for missing notes
- Progressive loading (most common note first)

### Manifest Structure
```json
{
  "id": "rhodes",
  "name": "Real Rhodes",
  "type": "sampled",
  "baseNote": 60,
  "releaseTime": 0.8,
  "credits": {
    "source": "Source Name",
    "url": "https://source.url",
    "license": "License Type"
  },
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ]
}
```

---

## Quick Reference Summary

| Metric | Value |
|--------|-------|
| Total sampled instruments | **26** |
| Replacements | **8** |
| Net new UI items | **+18** |
| Total bundle increase | **~6.5MB** |
| Essential tier (4 items) | ~2.0MB |
| Professional tier (10 items) | ~4.2MB |
| Genre coverage (essential) | ~75% |
| Genre coverage (professional) | ~90% |
| Genre coverage (complete) | ~100% |

### The 8 Replacements
**Procedural → 808 Samples:**
1. `kick` → `sampled:808-kick`
2. `snare` → `sampled:808-snare`
3. `hihat` → `sampled:808-hat`
4. `clap` → `sampled:808-clap`

**Synth → Sampled:**
5. `synth:rhodes` → `sampled:rhodes`
6. `synth:strings` → `sampled:strings`
7. `synth:brass` → `sampled:brass-stab`
8. `synth:vibes` → `sampled:vibraphone`
