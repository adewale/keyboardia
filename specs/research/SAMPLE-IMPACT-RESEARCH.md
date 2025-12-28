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

## Quality Assessment of Current Instruments

### Instruments That NEED Samples (Quality Issues)

| Instrument | Current Implementation | Problem | Impact |
|------------|----------------------|---------|--------|
| `kick`, `snare`, `hihat`, `clap` | Procedural synthesis mimicking 808 | Lacks punch, transients too soft, no harmonic richness | Users can tell it's "fake" - hurts credibility |
| `synth:rhodes` | FM synthesis approximation | Missing bell-like attack, no tine "bark", sustain too even | Sounds like a toy keyboard, not a real Rhodes |
| `synth:strings` | Sawtooth + filter + slow attack | No bow noise, no section width, unrealistic dynamics | Sounds like a 90s General MIDI string patch |
| `synth:brass` | Square wave + portamento | No breath, no ensemble variation, static timbre | Sounds like a video game, not a brass section |
| `synth:vibes` | FM bell synthesis | Missing mallet attack, no motor vibrato, wrong decay | Sounds metallic rather than warm |

### Instruments That Are FINE as Synths

| Instrument | Why It Works |
|------------|--------------|
| `synth:organ` | Hammond IS additive synthesis - drawbars mix sine waves |
| `synth:acid` | TB-303 IS a synthesizer - this is authentic |
| `synth:supersaw`, `synth:hypersaw` | Detuned saws ARE the sound - no "real" version exists |
| `synth:sub`, `synth:bass` | Low frequencies are simple - synthesis is perfect |
| `synth:pad`, `synth:warmpad` | Pads are meant to be synthetic - no realism needed |
| `synth:wobble`, `synth:growl` | LFO modulation IS the sound - dubstep expects this |
| `synth:pluck` | Generic enough that synthesis works |

### Instruments That Are MARGINAL (Consider Later)

| Instrument | Current State | Upgrade Path |
|------------|---------------|--------------|
| `synth:wurlitzer` | Acceptable FM | Rhodes sample covers EP space |
| `synth:clavinet` | Acceptable synthesis | Niche demand, low priority |
| `fm-epiano` | Good Tone.js FM | Rhodes sample is better but this is decent |

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
| `sampled:bass-slap` | No CC0 source, finger bass covers funk |
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
| `sampled:guitar-muted` | No CC0 source, process clean guitar if needed |

**20 items cut**

---

## Final Instrument List (24 items)

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

### NEW ADDITIONS (16 items)

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
| 17 | `sampled:guitar-clean` | Clean Gtr | 450KB | Indie, Lo-fi, Funk |
| 18 | `sampled:guitar-acoustic` | Acoustic Gtr | 500KB | Folk, Unplugged |
| 19 | `sampled:marimba` | Marimba | 400KB | Afrobeat, Latin |
| 20 | `sampled:kalimba` | Kalimba | 160KB | Lo-fi, Ambient |
| 21 | `sampled:choir-aah` | Choir | 450KB | Cinematic, Gospel |
| 22 | `sampled:sax-alto` | Alto Sax | 400KB | Jazz, Funk, Soul |
| 23 | `sampled:vocal-f` | Vocal F | 250KB | House, Pop |
| 24 | `sampled:vocal-m` | Vocal M | 250KB | Hip-hop, R&B |

**New additions: 3.65MB**

---

## Priority Tiers

### Prioritization Rationale

The order is based on **genre unlock multiplier** — how many new genres become viable with each addition:

| Priority | Instrument | Genres Unlocked | Rationale |
|----------|------------|-----------------|-----------|
| 1 | 808 Kit | Hip-hop, Trap, R&B, Pop, Electronic | **Highest impact** — 808 is THE sound of modern music. Current procedural version sounds amateur. |
| 2 | Acoustic Kit | Rock, Indie, Jazz, Folk, Pop | **Second highest** — Enables all organic/live-sounding genres that 808 can't cover. |
| 3 | Finger Bass | Funk, R&B, Jazz, Soul, Disco | **Foundation instrument** — No realistic bass = no funk/R&B. High demand. |
| 4 | Rhodes | Neo-soul, Lo-fi, Jazz, R&B | **Signature sound** — Lo-fi hip-hop and neo-soul require real Rhodes. Current synth is thin. |
| 5 | Vinyl Crackle | Lo-fi, Chillhop | **Tiny file, huge impact** — 80KB enables entire lo-fi aesthetic. |
| 6 | Clean Guitar | Indie, Lo-fi, Funk, R&B | **Versatile** — Clean guitar works across many genres, high utility. |
| 7 | Strings | Cinematic, Pop, R&B, Classical | **Emotional depth** — Real strings add production value to any genre. |
| 8 | Vocal Chops | House, Pop, Hip-hop | **Modern production staple** — Vocal chops are in 50%+ of current hits. |
| 9 | Brass Stab | Funk, Disco, Hip-hop | **Punch and energy** — Brass stabs add life to rhythm sections. |
| 10 | Sax | Jazz, Funk, Soul | **Melody instrument** — Enables jazz/soul lead lines. |
| 11+ | Rest | Niche genres | Lower priority but complete the offering. |

### Implementation Order

**Within each tier:** Implement all items before moving to next tier.
**Why:** Each tier is designed as a complete "upgrade pack" that unlocks a genre cluster. Partial tiers leave genres half-enabled.

**Exception:** If a specific CC0 source is blocked (e.g., Rhodes), skip and return later rather than blocking the whole tier.

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

### Tier 3: Complete (~5.75MB) — 100% genre coverage

| Pri | Instrument | Type | Size | Cumulative |
|-----|------------|------|------|------------|
| 11 | Acoustic Guitar | NEW | 500KB | 4.7MB |
| 12 | Vibraphone | REPLACE | 350KB | 5.0MB |
| 13 | Marimba | NEW | 400KB | 5.4MB |
| 14 | Choir | NEW | 450KB | 5.9MB |
| 15 | Kalimba | NEW | 160KB | 6.0MB |

---

## Final Summary

| Metric | Original | Revised | Savings |
|--------|----------|---------|---------|
| Total instruments | 44 | **24** | -20 |
| Replacements | 6 | **8** | +2 |
| Net new UI items | +38 | **+16** | -22 |
| Bundle size | 11.8MB | **5.75MB** | **-6.05MB** |

### UI Impact

```
CATEGORY        CURRENT    REPLACE    +NEW    FINAL
────────────────────────────────────────────────────
drums           18         -4         +6      20
bass            12         0          +1      13
keys            10         -1         0       9
leads           11         -1         +5      15
pads            12         -1         +1      12
fx              10         -1         +2      11
────────────────────────────────────────────────────
TOTAL           73         -8         +16     81
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

## Sample Sourcing Plan

### Confirmed CC0/Public Domain Sources

| Instrument | Source | License | Quality | URL |
|------------|--------|---------|---------|-----|
| **808-kick** | SMD Records TR-808 | Free (verify) | Professional | http://smd-records.com/tr808/ |
| **808-snare** | SMD Records TR-808 | Free (verify) | Professional | http://smd-records.com/tr808/ |
| **808-hat** | SMD Records TR-808 | Free (verify) | Professional | http://smd-records.com/tr808/ |
| **808-clap** | SMD Records TR-808 | Free (verify) | Professional | http://smd-records.com/tr808/ |
| **Vibraphone** | University of Iowa EMS | Public Domain | Professional | https://theremin.music.uiowa.edu/mis.html |
| **Marimba** | University of Iowa EMS | Public Domain | Professional | https://theremin.music.uiowa.edu/mis.html |
| **Alto Sax** | University of Iowa EMS | Public Domain | Professional | https://theremin.music.uiowa.edu/mis.html |
| **Acoustic Kit** | Open Source Drumkit | Public Domain | Professional | https://nucleus-soundlab.com/downloads/open-source-drumkit-free-refill-for-propellerhead-reason-5/ |
| **Brushes** | Ben Burnes | CC0 | Professional | https://ben-burnes.gumroad.com/l/bb_brushed |
| **Finger Bass** | Karoryfer Meatbass | CC0 | Professional | https://shop.karoryfer.com/pages/free-samples |
| **Clean Guitar** | FreePats Project | CC0 | Usable | https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html |
| **Acoustic Guitar** | VSCO2 CE | CC0 | Professional | https://versilian-studios.com/vsco-community/ |
| **Strings** | Philharmonia Orchestra | Free (no resale) | Professional | https://philharmonia.co.uk/resources/sound-samples/ |
| **Brass Stab** | Philharmonia Orchestra | Free (no resale) | Professional | https://philharmonia.co.uk/resources/sound-samples/ |
| **Vocal Chops** | Producer Space | CC0 | Usable | https://producerspace.com/ |
| **Vinyl Crackle** | Freesound.org | CC0 | Usable | https://freesound.org/browse/tags/cc0/ |
| **Kalimba** | Freesound (arioke) | Check license | Usable | https://freesound.org/people/arioke/packs/3759/ |
| **Choir** | Freesound.org | CC0 | Variable | https://freesound.org/browse/tags/cc0/ |

### Challenging Instruments (Need Alternatives)

| Instrument | Issue | Recommended Solution |
|------------|-------|---------------------|
| **Rhodes** | No high-quality CC0 source | Search Freesound CC0 + verify quality, or keep synth |

### Priority Sources

1. **University of Iowa EMS** (already used for piano) - Best for: Vibraphone, Marimba, Alto Sax
2. **Open Source Drumkit** - Best for: Full acoustic kit (300+ MB, 20+ velocity layers)
3. **SMD Records TR-808** - Best for: All 808 sounds (116 samples, real TR-808 Serial #103852)
4. **Philharmonia Orchestra** - Best for: Strings, Brass (MP3 format, may need conversion)
5. **Karoryfer Samples** - Best for: Electric bass, Brush drums (all CC0)
6. **VSCO2 Community Edition** - Best for: Orchestral, Acoustic guitar (CC0, WAV + SFZ)

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
| Total sampled instruments | **24** |
| Replacements | **8** |
| Net new UI items | **+16** |
| Total bundle increase | **~5.75MB** |
| Essential tier (4 items) | ~2.0MB |
| Professional tier (10 items) | ~4.2MB |
| Complete tier (15 items) | ~5.75MB |
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
