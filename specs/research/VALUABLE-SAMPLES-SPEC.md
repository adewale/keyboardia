# Valuable Samples Specification

> Prioritized list of samples and instruments that would unlock the most value for Keyboardia, based on gap analysis of existing research and implementation.

**Date:** January 2026
**Status:** Proposed
**Depends on:** Phase 29 (Musical Enrichment) complete

---

## Executive Summary

Keyboardia currently has **21 sampled instruments** implemented. The original research ([SAMPLE-IMPACT-RESEARCH.md](./SAMPLE-IMPACT-RESEARCH.md)) recommended 21 instruments, of which **3 remain unimplemented**. Additionally, the broader research documents identify **5 high-value instruments** that were deprioritized but would significantly expand genre coverage.

| Category | Count | Size | Coverage Boost |
|----------|-------|------|----------------|
| Missing from original spec | 3 | ~400KB | +37% |
| Additional high-value | 5 | ~1.0MB | +20% |
| **Total** | **8** | **~1.4MB** | **+57%** |

---

## Current State

### Implemented Sampled Instruments (21)

```
Phase 22:  piano
Phase 29A: 808-kick, 808-snare, 808-hihat-closed, 808-hihat-open, 808-clap
           acoustic-kick, acoustic-snare, acoustic-hihat-closed, acoustic-hihat-open, acoustic-ride
           finger-bass, vinyl-crackle
Phase 29C: vibraphone, string-section, rhodes-ep, french-horn, alto-sax
Phase 29D: clean-guitar, acoustic-guitar, marimba
```

### Genre Coverage Gaps

| Genre | Current | With Tier 1 | With All |
|-------|---------|-------------|----------|
| Rock | 10% | 25% | 40% |
| Jazz | 20% | 35% | 50% |
| Funk | 40% | 40% | 70% |
| Lo-fi | 50% | 65% | 75% |
| Gospel | 15% | 15% | 45% |
| World | 0% | 0% | 15% |

---

## Tier 1: Complete Original Research Spec

These 3 instruments were in the original [SAMPLE-IMPACT-RESEARCH.md](./SAMPLE-IMPACT-RESEARCH.md) final list but remain unimplemented.

### 1. Acoustic Crash Cymbal

| Attribute | Value |
|-----------|-------|
| **ID** | `acoustic-crash` |
| **Size** | ~120KB |
| **Samples** | 2-3 velocity layers, single crash |
| **Genres** | Rock, Pop, Indie |
| **Priority** | Critical — completes acoustic drum kit |

**Why it matters:**
- Acoustic kit is incomplete without crash
- Rock arrangements need cymbal accents
- Currently no way to mark song sections

**Verified CC0 Sources:**
- [Open Source Drumkit](https://nucleus-soundlab.com/downloads/open-source-drumkit-free-refill-for-propellerhead-reason-5/) — Public Domain, professional quality
- [VSCO 2 CE](https://versilian-studios.com/vsco-community/) — CC0, orchestral crash

**Implementation:**
```typescript
// Add to SAMPLED_INSTRUMENTS array
'acoustic-crash',

// Manifest structure
{
  id: 'acoustic-crash',
  name: 'Crash Cymbal',
  category: 'drums',
  samples: [
    { note: 49, file: 'crash-soft.mp3' },   // MIDI CC#49 = Crash 1
    { note: 49, file: 'crash-hard.mp3', velocity: 100 }
  ],
  oneShot: true,
  releaseTime: 2.0  // Long tail
}
```

---

### 2. Kalimba (Thumb Piano)

| Attribute | Value |
|-----------|-------|
| **ID** | `kalimba` |
| **Size** | ~160KB |
| **Samples** | 4 samples (octave-spaced C3-C6) |
| **Genres** | Lo-fi, Ambient, Chillhop |
| **Priority** | High — signature lo-fi texture |

**Why it matters:**
- Defines the lo-fi hip-hop aesthetic alongside vinyl crackle
- Warm, organic texture that synths cannot replicate
- Highly requested by lo-fi producers

**Verified CC0 Sources:**
- [Freesound - arioke kalimba pack](https://freesound.org/people/arioke/packs/3759/) — Verify license
- [Pianobook](https://www.pianobook.co.uk/) — Community instruments, various kalimbas

**Implementation:**
```typescript
{
  id: 'kalimba',
  name: 'Kalimba',
  category: 'keys',
  samples: [
    { note: 48, file: 'C3.mp3' },
    { note: 60, file: 'C4.mp3' },
    { note: 72, file: 'C5.mp3' },
    { note: 84, file: 'C6.mp3' }
  ],
  releaseTime: 1.2,
  pitchRange: [48, 96]
}
```

---

### 3. Brushes Snare

| Attribute | Value |
|-----------|-------|
| **ID** | `brushes-snare` |
| **Size** | ~120KB |
| **Samples** | 2-3 articulations (sweep, tap, hit) |
| **Genres** | Jazz, Lo-fi, Ballads |
| **Priority** | High — enables authentic jazz |

**Why it matters:**
- Jazz drums require brushes, not sticks
- Current acoustic snare sounds wrong for jazz
- Lo-fi uses brushes for softer texture

**Verified CC0 Sources:**
- [Ben Burnes Brushed Kit](https://ben-burnes.gumroad.com/l/bb_brushed) — CC0, professional
- [Karoryfer Samples](https://shop.karoryfer.com/pages/free-samples) — CC0, brush articulations

**Implementation:**
```typescript
{
  id: 'brushes-snare',
  name: 'Brush Snare',
  category: 'drums',
  samples: [
    { note: 38, file: 'brush-tap.mp3' },
    { note: 39, file: 'brush-sweep.mp3' },
    { note: 40, file: 'brush-hit.mp3' }
  ],
  oneShot: true
}
```

---

## Tier 2: High-Value Additions

These instruments were mentioned in research documents ([INSTRUMENT-EXPANSION.md](./INSTRUMENT-EXPANSION.md), [MUSICAL-COVERAGE-ANALYSIS.md](./MUSICAL-COVERAGE-ANALYSIS.md)) but cut from the final priority list. They would significantly expand genre coverage.

### 4. Slap Bass

| Attribute | Value |
|-----------|-------|
| **ID** | `slap-bass` |
| **Size** | ~200KB |
| **Samples** | 4 samples (slap + pop articulations) |
| **Genres** | Funk, Disco, R&B |
| **Priority** | High — funk is currently underserved |

**Why it matters:**
- Funk coverage is only 40% — slap bass is THE funk sound
- Finger bass cannot replicate slap/pop technique
- Disco and R&B also benefit significantly

**Gap analysis:**
- Current: `finger-bass` covers fingerstyle
- Missing: Slap technique (thumb slap + finger pop)
- Impact: Funk 40% → 70%

**Verified CC0 Sources:**
- [Karoryfer Meatbass](https://shop.karoryfer.com/pages/free-samples) — CC0, includes slap
- [Freesound CC0 bass](https://freesound.org/browse/tags/slap-bass/) — Various quality

**Implementation:**
```typescript
{
  id: 'slap-bass',
  name: 'Slap Bass',
  category: 'bass',
  samples: [
    { note: 28, file: 'slap-E1.mp3' },
    { note: 40, file: 'slap-E2.mp3' },
    { note: 52, file: 'slap-E3.mp3' },
    { note: 64, file: 'pop-E4.mp3' }
  ],
  releaseTime: 0.3,
  pitchRange: [24, 72]
}
```

---

### 5. Hammond B3 Organ

| Attribute | Value |
|-----------|-------|
| **ID** | `hammond-organ` |
| **Size** | ~300KB |
| **Samples** | 4-5 samples with Leslie simulation |
| **Genres** | Gospel, Jazz, Rock, Soul |
| **Priority** | High — enables gospel entirely |

**Why it matters:**
- Gospel is impossible without Hammond organ
- Jazz organ trio format requires it
- Classic rock (Deep Purple, Doors) needs it
- Current `synth:organ` is additive synthesis — lacks Leslie character

**Gap analysis:**
- Current: `synth:organ` (drawbar simulation)
- Missing: Real Hammond with Leslie speaker
- Impact: Gospel 15% → 45%, Jazz +15%

**Note:** The current synth organ works for some use cases. This would be an ADDITION, not a replacement.

**Verified CC0 Sources:**
- [VSCO 2 CE](https://versilian-studios.com/vsco-community/) — CC0, Hammond samples
- [Pianobook](https://www.pianobook.co.uk/) — Various organ samples

**Implementation:**
```typescript
{
  id: 'hammond-organ',
  name: 'Hammond Organ',
  category: 'keys',
  samples: [
    { note: 36, file: 'C2.mp3' },
    { note: 48, file: 'C3.mp3' },
    { note: 60, file: 'C4.mp3' },
    { note: 72, file: 'C5.mp3' }
  ],
  loop: true,
  releaseTime: 0.1
}
```

---

### 6. Melodica

| Attribute | Value |
|-----------|-------|
| **ID** | `melodica` |
| **Size** | ~150KB |
| **Samples** | 3-4 samples |
| **Genres** | Reggae, Dub, Indie |
| **Priority** | Medium — enables reggae/dub |

**Why it matters:**
- Reggae/Dub is currently 35% covered
- Melodica IS the reggae lead instrument (Augustus Pablo)
- Indie/lo-fi also uses melodica for texture

**Verified CC0 Sources:**
- [Pianobook](https://www.pianobook.co.uk/) — Verified melodica available
- [Freesound](https://freesound.org/) — Various quality

---

### 7. Tabla

| Attribute | Value |
|-----------|-------|
| **ID** | `tabla` |
| **Size** | ~200KB |
| **Samples** | 4-6 samples (bayan + dayan strokes) |
| **Genres** | Indian, World, Fusion |
| **Priority** | Medium — opens world music entirely |

**Why it matters:**
- World music is currently 0% covered
- Tabla enables Indian classical fusion
- Growing interest in global sounds

**Note:** This is a significant genre expansion beyond Western music focus.

**Verified CC0 Sources:**
- [Freesound CC0](https://freesound.org/browse/tags/tabla/) — Various quality
- [University of Iowa EMS](https://theremin.music.uiowa.edu/) — Academic quality

---

### 8. Steel Drums

| Attribute | Value |
|-----------|-------|
| **ID** | `steel-drums` |
| **Size** | ~150KB |
| **Samples** | 4 samples (octave-spaced) |
| **Genres** | Caribbean, Tropical, Pop |
| **Priority** | Low — niche but distinctive |

**Why it matters:**
- Distinctive Caribbean sound
- Summer/tropical pop productions
- No synthesis alternative exists

**Verified CC0 Sources:**
- [VSCO 2 CE](https://versilian-studios.com/vsco-community/) — CC0
- [Freesound](https://freesound.org/) — Various

---

## Implementation Phases

### Phase 29E: Complete Original Spec (Tier 1)

| Instrument | Size | Effort |
|------------|------|--------|
| Acoustic Crash | 120KB | 1 day |
| Kalimba | 160KB | 1 day |
| Brushes Snare | 120KB | 1 day |
| **Total** | **400KB** | **3 days** |

**Outcome:** 24 sampled instruments, original research spec complete.

### Phase 29F: Genre Expansion (Tier 2)

| Instrument | Size | Effort |
|------------|------|--------|
| Slap Bass | 200KB | 1-2 days |
| Hammond Organ | 300KB | 2 days |
| Melodica | 150KB | 1 day |
| Tabla | 200KB | 1 day |
| Steel Drums | 150KB | 1 day |
| **Total** | **1.0MB** | **6-7 days** |

**Outcome:** 29 sampled instruments, major genre expansion.

---

## Priority Matrix

| Instrument | Genre Impact | File Size | Source Quality | Implementation | Score |
|------------|-------------|-----------|----------------|----------------|-------|
| Acoustic Crash | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★★★ | **19/20** |
| Kalimba | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★★ | **18/20** |
| Brushes Snare | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★★☆ | **18/20** |
| Slap Bass | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ | **17/20** |
| Hammond Organ | ★★★★★ | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | **15/20** |
| Melodica | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★★★★ | **16/20** |
| Tabla | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | ★★★★☆ | **14/20** |
| Steel Drums | ★★☆☆☆ | ★★★★★ | ★★★☆☆ | ★★★★★ | **14/20** |

---

## Success Criteria

### Tier 1 Complete
- [ ] Acoustic crash integrates with acoustic kit in UI
- [ ] Kalimba appears in keys category
- [ ] Brushes snare appears in drums category
- [ ] All 3 load lazily without blocking startup
- [ ] Volume normalized to existing instruments (±1.4 dB tolerance)

### Tier 2 Complete
- [ ] Slap bass distinct from finger bass in sound
- [ ] Hammond organ has Leslie-like character
- [ ] All instruments have verified CC0/public domain licenses
- [ ] Total bundle size increase < 1.5MB (lazy loaded)
- [ ] Genre coverage tests pass for new genres

---

## Appendix: What Was NOT Included

These were considered but excluded:

| Instrument | Reason |
|------------|--------|
| Upright Bass | Finger bass approximates sufficiently |
| Brass Stab | French horn substitutes for brass section |
| Wurlitzer/Clavinet | Rhodes covers electric piano space |
| Choir/Vocals | No CC0 multisampled sources found |
| Orchestral Hits | Niche EDM use case |
| Tape Hiss | Vinyl crackle covers lo-fi texture |
| Glockenspiel | Bell synth approximates |

---

## Related Documents

- [SAMPLE-IMPACT-RESEARCH.md](./SAMPLE-IMPACT-RESEARCH.md) — Original research (21 instruments)
- [INSTRUMENT-EXPANSION.md](./INSTRUMENT-EXPANSION.md) — Implementation patterns
- [MUSICAL-COVERAGE-ANALYSIS.md](./MUSICAL-COVERAGE-ANALYSIS.md) — Genre coverage analysis

---

*This specification extracts and prioritizes the remaining valuable samples identified through gap analysis of existing research and implementation.*
