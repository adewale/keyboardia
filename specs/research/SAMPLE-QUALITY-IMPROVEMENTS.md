# Sample Quality Improvements Specification

> Comprehensive specification for improving sampled instrument quality: velocity layers, pitch-shift artifact detection, release time calibration, and sample mapping fixes.

**Date:** January 2026
**Status:** Proposed
**Priority:** High
**Depends on:** Phase 29 (Musical Enrichment) complete

---

## Executive Summary

The quality review of Keyboardia's 21 sampled instruments identified four critical issues:

| Issue | Impact | Effort |
|-------|--------|--------|
| No velocity layers | Instruments sound lifeless and robotic | High |
| Pitch-shift artifacts at extremes | Notes sound unnatural when shifted >6 semitones | Medium |
| Inconsistent release times | Some instruments cut off too early/late | Low |
| Irregular sample mappings | French Horn, Rhodes EP have poor note spacing | Medium |

This spec provides detection tools, demonstration sessions, and implementation guidance for each issue.

---

## Table of Contents

1. [Why This Matters](#why-this-matters)
2. [Velocity Layers](#velocity-layers)
3. [Pitch-Shift Artifacts](#pitch-shift-artifacts)
4. [Release Time Calibration](#release-time-calibration)
5. [Sample Mapping Fixes](#sample-mapping-fixes)
6. [Detection Tools](#detection-tools)
7. [Demonstration Sessions](#demonstration-sessions)
8. [Implementation Plan](#implementation-plan)

---

## Why This Matters

### The Problem with Single-Velocity Samples

When a musician plays softly versus loudly, real instruments don't just change volume—they change **timbre**:

| Instrument | Soft (pp) | Loud (ff) |
|------------|-----------|-----------|
| **Piano** | Warm, mellow, rounded | Bright, percussive, with hammer noise |
| **Rhodes** | Bell-like, pure | Growling bark, tine distortion |
| **Drums** | Thin, papery | Full, punchy, with room resonance |
| **Strings** | Airy, delicate | Aggressive bow noise, rich harmonics |
| **Brass** | Muted, smooth | Brassy edge, airiness |

**Current state:** All 21 instruments use single-velocity samples. A MIDI velocity of 1 sounds identical to velocity 127, just quieter. This makes programmed music sound mechanical and lifeless.

**Industry standard:** Professional sample libraries use 3-8 velocity layers. Even budget libraries use 2-3 layers.

### The Problem with Extreme Pitch Shifting

When a sample is pitch-shifted beyond ~6 semitones, artifacts become noticeable:

| Shift Amount | Quality | Description |
|--------------|---------|-------------|
| ±3 semitones | Excellent | Indistinguishable from original |
| ±6 semitones | Good | Subtle artifacts, acceptable |
| ±9 semitones | Fair | Noticeable "chipmunk" or "slowed down" effect |
| ±12 semitones | Poor | Obvious pitch-shifting, formant distortion |
| ±18+ semitones | Bad | Unusable for realistic sounds |

**Current state:** Some instruments have gaps of 12-17 semitones between samples:
- French Horn: 17 semitone gap (C1 to F2)
- Rhodes EP: Irregular mapping (10, 12, 3 semitone gaps)
- 808 Kick: Single sample for entire MIDI range

### The Problem with Inconsistent Release Times

Release time determines how long a note rings after the trigger ends:

| Too Short | Correct | Too Long |
|-----------|---------|----------|
| Notes cut off abruptly | Natural decay | Notes muddy together |
| Staccato feels wrong | Legato feels right | Polyphony sounds messy |
| Loses instrument character | Preserves resonance | Masks other tracks |

**Current state:** Release times range from 0.05s (hi-hat) to 1.5s (vibraphone) with no documented rationale.

---

## Velocity Layers

### Why Velocity Layers Matter

```
MIDI Velocity 20 (soft):
  Real Piano:     Warm, rounded tone, slow attack
  Current Sample: Same tone as loud, just quieter  ← WRONG

MIDI Velocity 120 (loud):
  Real Piano:     Bright, percussive, hammer noise
  Current Sample: Same tone as soft, just louder  ← WRONG
```

The ear perceives **timbre changes**, not just volume changes, when dynamics change. Without velocity layers, instruments sound like they're being played through a volume knob rather than with expressive technique.

### Velocity Layer Specification

#### Tier 1: Essential (3 instruments, highest impact)

| Instrument | Current | Target | Layers | Crossfade |
|------------|---------|--------|--------|-----------|
| **Piano** | 1 layer | 3 layers | pp (1-50), mf (51-100), ff (101-127) | Linear |
| **Rhodes EP** | 1 layer | 3 layers | pp (bell), mf (balanced), ff (bark) | Linear |
| **Acoustic Snare** | 1 layer | 2 layers | ghost (1-80), full (81-127) | Linear |

**File size impact:** ~1.5MB additional (3× samples for 3 instruments)

#### Tier 2: Recommended (5 instruments)

| Instrument | Layers | Rationale |
|------------|--------|-----------|
| Finger Bass | 2 | Soft pluck vs. hard pluck |
| Acoustic Kick | 2 | Light touch vs. full hit |
| Clean Guitar | 2 | Fingerpicked vs. strummed |
| Alto Sax | 2 | Soft breath vs. full blow |
| French Horn | 2 | Muted vs. open |

#### Tier 3: Optional (remaining instruments)

Single velocity is acceptable for:
- **808 drums** — Electronic, consistent by design
- **Vinyl crackle** — Texture, no velocity concept
- **Vibraphone/Marimba** — Mallet instruments have less velocity variation

### Manifest Schema Update

```typescript
interface SampleMapping {
  note: number;              // MIDI note number
  file?: string;             // Filename (individual mode)
  offset?: number;           // Sprite mode: start time
  duration?: number;         // Sprite mode: duration
  velocityMin?: number;      // NEW: Minimum velocity (0-127), default 0
  velocityMax?: number;      // NEW: Maximum velocity (0-127), default 127
}

// Example: Piano with 3 velocity layers
{
  "id": "piano",
  "name": "Grand Piano",
  "type": "sampled",
  "baseNote": 60,
  "releaseTime": 0.5,
  "samples": [
    // C4 with 3 velocity layers
    { "note": 60, "file": "C4-pp.mp3", "velocityMin": 0, "velocityMax": 50 },
    { "note": 60, "file": "C4-mf.mp3", "velocityMin": 51, "velocityMax": 100 },
    { "note": 60, "file": "C4-ff.mp3", "velocityMin": 101, "velocityMax": 127 },
    // Repeat for other octaves...
  ]
}
```

### Playback Logic Update

```typescript
private findNearestSample(midiNote: number, velocity: number = 100): SampleResult {
  // 1. Find samples matching the target note (or nearest)
  const candidateSamples = this.findSamplesNearNote(midiNote);

  // 2. Filter by velocity range
  const velocityMatches = candidateSamples.filter(s =>
    velocity >= (s.velocityMin ?? 0) &&
    velocity <= (s.velocityMax ?? 127)
  );

  // 3. If no exact match, find nearest velocity layer
  if (velocityMatches.length === 0) {
    return this.findNearestVelocityLayer(candidateSamples, velocity);
  }

  // 4. Calculate pitch ratio for the matched sample
  return this.calculatePitchRatio(velocityMatches[0], midiNote);
}
```

### Velocity Crossfading (Advanced)

For smoother transitions between velocity layers:

```typescript
// Optional: Crossfade between adjacent velocity layers
private playWithCrossfade(midiNote: number, velocity: number): void {
  const layers = this.getAdjacentLayers(midiNote, velocity);

  if (layers.length === 1) {
    // Single layer, play normally
    this.playLayer(layers[0], 1.0);
  } else {
    // Two layers, crossfade based on velocity position
    const [lower, upper] = layers;
    const blend = this.calculateBlend(velocity, lower.velocityMax, upper.velocityMin);
    this.playLayer(lower, 1 - blend);
    this.playLayer(upper, blend);
  }
}
```

---

## Pitch-Shift Artifacts

### The Physics of Pitch Shifting

Web Audio's `playbackRate` changes pitch by speeding up or slowing down playback:

```
playbackRate = 2^(semitones / 12)

+12 semitones → playbackRate = 2.0  → plays 2× faster (half duration)
-12 semitones → playbackRate = 0.5  → plays 2× slower (double duration)
```

**Problem:** This also changes:
- **Formants** — Vocal/resonant character shifts unnaturally
- **Attack transients** — Get faster/slower, changing instrument feel
- **Decay characteristics** — Ring time changes proportionally

### Current Problem Instruments

| Instrument | Samples | Max Gap | Problem Notes |
|------------|---------|---------|---------------|
| **808 Kick** | 1 (note 36) | Infinite | Any note ≠ 36 |
| **French Horn** | 4 (24, 41, 48, 62) | 17 semitones | Notes 25-40 |
| **Rhodes EP** | 4 (40, 50, 62, 65) | 12 semitones | Notes 51-61 |
| **Alto Sax** | 4 (38, 48, 60, 68) | 12 semitones | Notes 49-59 |
| **Acoustic Hi-Hat** | 1 (note 42) | Infinite | Any note ≠ 42 |

### Quality Thresholds

```typescript
const PITCH_SHIFT_QUALITY = {
  EXCELLENT: 3,   // ±3 semitones: indistinguishable
  GOOD: 6,        // ±6 semitones: subtle artifacts
  FAIR: 9,        // ±9 semitones: noticeable
  POOR: 12,       // ±12 semitones: obvious
  BAD: 18,        // ±18 semitones: unusable
};

// Maximum recommended shift for different instrument types
const MAX_SHIFT_BY_TYPE = {
  drums: 6,       // Transients are sensitive
  bass: 8,        // Low frequencies tolerate more
  keys: 6,        // Formants matter
  strings: 6,     // Bow noise changes character
  brass: 5,       // Embouchure character is critical
  percussion: 8,  // Mallet sounds are forgiving
};
```

### Solutions

#### Option A: Add More Samples (Preferred)

Reduce maximum gap to 6 semitones:

```json
// French Horn: Current (problematic)
{ "samples": [
  { "note": 24 },  // C1
  { "note": 41 },  // F2  ← 17 semitone gap!
  { "note": 48 },  // C3
  { "note": 62 }   // D4
]}

// French Horn: Fixed (max 6 semitone gap)
{ "samples": [
  { "note": 24 },  // C1
  { "note": 30 },  // F#1 (new)
  { "note": 36 },  // C2  (new)
  { "note": 41 },  // F2
  { "note": 48 },  // C3
  { "note": 54 },  // F#3 (new)
  { "note": 60 },  // C4  (new)
  { "note": 66 }   // F#4 (new, replaces D4)
]}
```

#### Option B: Limit Playable Range

For single-sample instruments like 808 Kick:

```typescript
interface InstrumentManifest {
  // ... existing fields
  playableRange?: {
    min: number;  // Minimum MIDI note
    max: number;  // Maximum MIDI note
  };
  warnRange?: {
    min: number;  // Warn below this
    max: number;  // Warn above this
  };
}

// Example: 808 Kick limited to ±6 semitones
{
  "id": "808-kick",
  "baseNote": 36,
  "playableRange": { "min": 30, "max": 42 },  // ±6 semitones
  "warnRange": { "min": 33, "max": 39 }       // ±3 semitones recommended
}
```

#### Option C: Display Warning in UI

Show visual feedback when pitch shift exceeds threshold:

```typescript
// In track component
function getPitchShiftQuality(instrument: string, midiNote: number): Quality {
  const manifest = getManifest(instrument);
  const nearestSample = findNearestSample(manifest, midiNote);
  const shift = Math.abs(midiNote - nearestSample);

  if (shift <= 3) return 'excellent';
  if (shift <= 6) return 'good';
  if (shift <= 9) return 'fair';
  if (shift <= 12) return 'poor';
  return 'bad';
}

// Visual indicator colors
const QUALITY_COLORS = {
  excellent: 'green',
  good: 'green',
  fair: 'yellow',
  poor: 'orange',
  bad: 'red',
};
```

---

## Release Time Calibration

### Current Release Times (Audit)

| Instrument | Current | Issue | Recommended |
|------------|---------|-------|-------------|
| **acoustic-hihat-closed** | 0.05s | Too short, cuts tail | 0.15s |
| **acoustic-hihat-open** | 0.3s | Acceptable | 0.3s |
| **808-kick** | 0.1s | OK for electronic | 0.1s |
| **808-snare** | 0.1s | OK for electronic | 0.1s |
| **acoustic-kick** | 0.1s | Too short for room | 0.2s |
| **acoustic-snare** | 0.1s | Too short for room | 0.25s |
| **acoustic-ride** | 0.5s | Good | 0.5s |
| **piano** | 0.5s | Good | 0.5s |
| **rhodes-ep** | 1.0s | Slightly long | 0.8s |
| **vibraphone** | 1.5s | Too long, muddies mix | 1.0s |
| **marimba** | 0.8s | Good | 0.8s |
| **string-section** | 0.8s | Good | 0.8s |
| **finger-bass** | 0.3s | Good | 0.3s |
| **french-horn** | 0.6s | Good | 0.6s |
| **alto-sax** | 0.4s | Good | 0.4s |
| **clean-guitar** | 0.3s | Good | 0.3s |
| **acoustic-guitar** | 0.4s | Good | 0.4s |
| **vinyl-crackle** | 0.1s | Good (texture) | 0.1s |

### Calibration Principles

```
DRUMS (percussive):
├── Electronic (808): 0.1s — tight, punchy
├── Acoustic kit:     0.15-0.25s — room ambience
└── Cymbals:          0.3-0.5s — long ring

KEYS (sustained):
├── Piano:            0.5s — natural decay
├── Rhodes:           0.8s — tine ring
├── Organ:            0.1s — stops immediately
└── Vibraphone:       1.0s — motor vibrato

STRINGS (bowed/plucked):
├── Plucked:          0.3-0.4s — string ring
└── Bowed:            0.6-0.8s — bow release

BRASS/WIND (breath):
├── Short notes:      0.3-0.4s — breath end
└── Sustained:        0.5-0.6s — natural fade

BASS:
└── All types:        0.3s — tight low end
```

### Release Time Calculation

Release time should be proportional to the instrument's natural decay:

```typescript
// Recommended formula based on sample analysis
function calculateReleaseTime(sampleDuration: number, type: InstrumentType): number {
  const decayRatios = {
    drums: 0.05,      // 5% of sample duration
    bass: 0.1,        // 10%
    keys: 0.15,       // 15%
    strings: 0.2,     // 20%
    brass: 0.15,      // 15%
    percussion: 0.2,  // 20%
  };

  const ratio = decayRatios[type] || 0.15;
  const calculated = sampleDuration * ratio;

  // Clamp to reasonable range
  return Math.max(0.05, Math.min(1.5, calculated));
}
```

---

## Sample Mapping Fixes

### French Horn: Why It's Wrong

**Current mapping:**
```
Note 24 (C1) ──17 semitones──▶ Note 41 (F2) ──7 semitones──▶ Note 48 (C3) ──14 semitones──▶ Note 62 (D4)
```

**Problems:**
1. **17 semitone gap** between C1 and F2 means any note from C#1 to E2 requires 8+ semitone shift
2. **Irregular intervals** (17, 7, 14) cause inconsistent quality across range
3. **F2 instead of C2** breaks octave alignment, confusing pitch relationships
4. **D4 instead of C4** same issue at top of range

**Why octave alignment matters:**
- Users expect C notes to sound consistent across octaves
- Irregular mapping causes "better" and "worse" regions in the playable range
- Makes chromatic passages sound uneven

**Fixed mapping (max 6 semitone gap):**
```json
{
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ]
}
```

This requires sourcing new samples at C2, C4, and C5.

### Rhodes EP: Why It's Wrong

**Current mapping:**
```
Note 40 (E2) ──10 semitones──▶ Note 50 (D3) ──12 semitones──▶ Note 62 (D4) ──3 semitones──▶ Note 65 (F4)
```

**Problems:**
1. **Files named C2-C5 but mapped to E2, D3, D4, F4** — confusing and likely incorrect
2. **12 semitone gap** between D3 and D4 is too large
3. **3 semitone gap** at top wastes a sample on redundant coverage
4. **No sample above F4** — Rhodes typically goes to C6

**Investigation needed:** Verify if files actually contain the pitches claimed:
```bash
# Analyze actual pitch of each sample
for f in rhodes-ep/*.mp3; do
  aubiopitch -i "$f" -p midi
done
```

**Expected correct mapping (if files are actually C2-C5):**
```json
{
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ]
}
```

### Alto Sax: Acceptable with Caveat

**Current mapping:**
```
Note 38 (D2) ──10 semitones──▶ Note 48 (C3) ──12 semitones──▶ Note 60 (C4) ──8 semitones──▶ Note 68 (Ab4)
```

**Assessment:** The 12 semitone gap is at the edge of acceptable. Alto sax real range is Db3-Ab5, so:
- D2 is below natural range (synthetic extension)
- Ab4 is within range

**Recommendation:** Add one sample at F#3 (note 54) to reduce max gap to 6 semitones.

---

## Detection Tools

### 1. Pitch-Shift Quality Analyzer

**Script:** `scripts/analyze-pitch-shift-quality.ts`

```typescript
#!/usr/bin/env npx ts-node

/**
 * Analyzes pitch-shift quality for all sampled instruments.
 * Reports maximum gaps and problem note ranges.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Manifest {
  id: string;
  name: string;
  samples: { note: number }[];
}

interface QualityReport {
  instrument: string;
  samples: number[];
  gaps: { from: number; to: number; semitones: number }[];
  maxGap: number;
  problemRanges: { min: number; max: number; quality: string }[];
  recommendation: string;
}

const INSTRUMENTS_DIR = 'app/public/instruments';
const MAX_ACCEPTABLE_GAP = 6;

function analyzeInstrument(manifestPath: string): QualityReport {
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const notes = manifest.samples.map(s => s.note).sort((a, b) => a - b);

  // Calculate gaps
  const gaps: QualityReport['gaps'] = [];
  for (let i = 0; i < notes.length - 1; i++) {
    gaps.push({
      from: notes[i],
      to: notes[i + 1],
      semitones: notes[i + 1] - notes[i],
    });
  }

  const maxGap = Math.max(...gaps.map(g => g.semitones), 0);

  // Find problem ranges (notes requiring >6 semitone shift)
  const problemRanges: QualityReport['problemRanges'] = [];
  // ... (implementation details)

  return {
    instrument: manifest.id,
    samples: notes,
    gaps,
    maxGap,
    problemRanges,
    recommendation: maxGap > MAX_ACCEPTABLE_GAP
      ? `Add samples to reduce max gap from ${maxGap} to ≤${MAX_ACCEPTABLE_GAP}`
      : 'OK',
  };
}

function main() {
  const instruments = fs.readdirSync(INSTRUMENTS_DIR);
  const reports: QualityReport[] = [];

  for (const instrument of instruments) {
    const manifestPath = path.join(INSTRUMENTS_DIR, instrument, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      reports.push(analyzeInstrument(manifestPath));
    }
  }

  // Output report
  console.log('\n=== PITCH-SHIFT QUALITY REPORT ===\n');

  for (const report of reports.sort((a, b) => b.maxGap - a.maxGap)) {
    const status = report.maxGap <= MAX_ACCEPTABLE_GAP ? '✅' : '⚠️';
    console.log(`${status} ${report.instrument}`);
    console.log(`   Samples: ${report.samples.join(', ')}`);
    console.log(`   Max gap: ${report.maxGap} semitones`);
    if (report.maxGap > MAX_ACCEPTABLE_GAP) {
      console.log(`   Gaps: ${report.gaps.map(g => `${g.from}→${g.to} (${g.semitones}st)`).join(', ')}`);
      console.log(`   ⚠️  ${report.recommendation}`);
    }
    console.log();
  }
}

main();
```

**Expected output:**
```
=== PITCH-SHIFT QUALITY REPORT ===

⚠️ french-horn
   Samples: 24, 41, 48, 62
   Max gap: 17 semitones
   Gaps: 24→41 (17st), 41→48 (7st), 48→62 (14st)
   ⚠️  Add samples to reduce max gap from 17 to ≤6

⚠️ rhodes-ep
   Samples: 40, 50, 62, 65
   Max gap: 12 semitones
   Gaps: 40→50 (10st), 50→62 (12st), 62→65 (3st)
   ⚠️  Add samples to reduce max gap from 12 to ≤6

✅ piano
   Samples: 36, 48, 60, 72
   Max gap: 12 semitones
   ...
```

### 2. Release Time Validator

**Script:** `scripts/validate-release-times.ts`

```typescript
#!/usr/bin/env npx ts-node

/**
 * Validates release times against instrument type recommendations.
 */

const RECOMMENDED_RELEASE_TIMES: Record<string, { min: number; max: number }> = {
  // Drums
  '808-kick': { min: 0.08, max: 0.15 },
  '808-snare': { min: 0.08, max: 0.15 },
  '808-hihat-closed': { min: 0.03, max: 0.08 },
  '808-hihat-open': { min: 0.15, max: 0.25 },
  '808-clap': { min: 0.08, max: 0.15 },
  'acoustic-kick': { min: 0.15, max: 0.25 },
  'acoustic-snare': { min: 0.2, max: 0.3 },
  'acoustic-hihat-closed': { min: 0.1, max: 0.2 },
  'acoustic-hihat-open': { min: 0.25, max: 0.4 },
  'acoustic-ride': { min: 0.4, max: 0.6 },

  // Keys
  'piano': { min: 0.4, max: 0.6 },
  'rhodes-ep': { min: 0.6, max: 1.0 },
  'vibraphone': { min: 0.8, max: 1.2 },
  'marimba': { min: 0.6, max: 1.0 },

  // Strings
  'string-section': { min: 0.6, max: 1.0 },
  'clean-guitar': { min: 0.25, max: 0.4 },
  'acoustic-guitar': { min: 0.3, max: 0.5 },

  // Bass
  'finger-bass': { min: 0.2, max: 0.4 },

  // Brass/Wind
  'french-horn': { min: 0.4, max: 0.7 },
  'alto-sax': { min: 0.3, max: 0.5 },

  // FX
  'vinyl-crackle': { min: 0.05, max: 0.15 },
};

// ... validation logic
```

### 3. Velocity Layer Coverage Report

**Script:** `scripts/report-velocity-coverage.ts`

```typescript
#!/usr/bin/env npx ts-node

/**
 * Reports velocity layer coverage for all instruments.
 * Identifies instruments that would benefit most from velocity layers.
 */

// ... implementation
```

---

## Demonstration Sessions

### Session 1: Velocity Layer Problem

**File:** `demo-sessions/velocity-problem.json`

```json
{
  "name": "Velocity Layer Demo - The Problem",
  "description": "Demonstrates why single-velocity samples sound robotic",
  "bpm": 90,
  "tracks": [
    {
      "name": "Piano - Crescendo (BROKEN)",
      "instrument": "piano",
      "steps": 16,
      "pattern": "x-x-x-x-x-x-x-x-",
      "pitches": [0, 0, 0, 0, 0, 0, 0, 0],
      "velocities": [20, 40, 60, 80, 100, 120, 127, 127],
      "comment": "Should get brighter as velocity increases - but sounds same, just louder"
    },
    {
      "name": "Acoustic Snare - Ghost Notes (BROKEN)",
      "instrument": "acoustic-snare",
      "steps": 16,
      "pattern": "x-xxx-xxx-xxx-xx",
      "velocities": [100, 0, 30, 30, 100, 0, 30, 30, 100, 0, 30, 30, 100, 0, 30, 100],
      "comment": "Ghost notes should be thinner - but sound same as accents"
    }
  ],
  "expected_behavior": "Soft notes should have different timbre than loud notes",
  "actual_behavior": "All notes sound identical except for volume"
}
```

### Session 2: Pitch-Shift Artifact Problem

**File:** `demo-sessions/pitch-shift-problem.json`

```json
{
  "name": "Pitch-Shift Artifact Demo",
  "description": "Demonstrates pitch-shifting artifacts at extreme ranges",
  "bpm": 120,
  "tracks": [
    {
      "name": "French Horn - Chromatic Scale",
      "instrument": "french-horn",
      "steps": 16,
      "pattern": "x-x-x-x-x-x-x-x-",
      "pitches": [-12, -10, -8, -6, -4, -2, 0, 2],
      "comment": "Notes at -12 to -6 require 8+ semitone shift from C1 sample"
    },
    {
      "name": "808 Kick - Pitched",
      "instrument": "808-kick",
      "steps": 16,
      "pattern": "x---x---x---x---",
      "pitches": [-24, -12, 0, 12],
      "comment": "Base note is 36. -24 = note 12, requires 24 semitone shift = chipmunk"
    },
    {
      "name": "Rhodes EP - Mid Range Gap",
      "instrument": "rhodes-ep",
      "steps": 16,
      "pattern": "x-x-x-x-x-x-x-x-",
      "pitches": [0, 2, 4, 6, 8, 10, 12, 14],
      "comment": "Gap between samples at notes 50-62 causes quality drop"
    }
  ],
  "listen_for": [
    "Formant shift (chipmunk effect) on low French horn notes",
    "Unnatural attack on pitched 808 kick",
    "Quality inconsistency across Rhodes chromatic passage"
  ]
}
```

### Session 3: Release Time Problems

**File:** `demo-sessions/release-time-problem.json`

```json
{
  "name": "Release Time Demo",
  "description": "Demonstrates release time calibration issues",
  "bpm": 100,
  "tracks": [
    {
      "name": "Hi-Hat Closed - Cut Too Short",
      "instrument": "acoustic-hihat-closed",
      "steps": 16,
      "pattern": "x-x-x-x-x-x-x-x-",
      "comment": "0.05s release cuts off natural hi-hat ring"
    },
    {
      "name": "Vibraphone - Too Long",
      "instrument": "vibraphone",
      "steps": 16,
      "pattern": "x---x---x---x---",
      "pitches": [0, 4, 7, 12],
      "comment": "1.5s release causes notes to muddy together"
    },
    {
      "name": "Reference: Piano - Good Release",
      "instrument": "piano",
      "steps": 16,
      "pattern": "x---x---x---x---",
      "pitches": [0, 4, 7, 12],
      "comment": "0.5s release sounds natural"
    }
  ]
}
```

---

## Implementation Plan

### Phase 1: Detection & Documentation (1 week)

| Task | Effort | Output |
|------|--------|--------|
| Create pitch-shift analyzer script | 2 days | `scripts/analyze-pitch-shift-quality.ts` |
| Create release time validator | 1 day | `scripts/validate-release-times.ts` |
| Create velocity coverage report | 1 day | `scripts/report-velocity-coverage.ts` |
| Create demonstration sessions | 1 day | `demo-sessions/*.json` |

### Phase 2: Quick Fixes (1 week)

| Task | Effort | Impact |
|------|--------|--------|
| Fix release times (manifest updates) | 1 day | Immediate quality improvement |
| Verify Rhodes EP sample pitches | 1 day | Determine if remapping or resampling needed |
| Update French Horn manifest (if samples exist) | 1 day | Fix mapping if samples available |
| Add playable range limits | 2 days | Prevent worst artifacts |

### Phase 3: Sample Acquisition (2-3 weeks)

| Task | Effort | Impact |
|------|--------|--------|
| Source additional French Horn samples | 1 week | Fix 17 semitone gap |
| Source Rhodes EP samples (if needed) | 1 week | Fix irregular mapping |
| Source Piano velocity layers (pp, mf, ff) | 1 week | Major expressiveness improvement |

### Phase 4: Velocity Layer Implementation (2 weeks)

| Task | Effort | Impact |
|------|--------|--------|
| Update manifest schema for velocity | 2 days | Enable velocity layers |
| Update sample loading for velocity | 3 days | Select correct layer |
| Update playback for velocity | 2 days | Pass velocity to sample selector |
| Process and integrate velocity samples | 1 week | Complete velocity support |

---

## Success Criteria

### Pitch-Shift Quality
- [ ] No instrument has sample gaps > 6 semitones
- [ ] Analyzer script reports all instruments as "OK"
- [ ] Demo session "pitch-shift-problem" sounds acceptable

### Release Times
- [ ] All release times within documented ranges
- [ ] Hi-hat closed increased to ≥0.1s
- [ ] Vibraphone reduced to ≤1.0s
- [ ] Validator script reports no issues

### Velocity Layers (Tier 1)
- [ ] Piano has 3 velocity layers (pp, mf, ff)
- [ ] Rhodes has 3 velocity layers
- [ ] Acoustic snare has 2 velocity layers
- [ ] Demo session "velocity-problem" shows clear timbre change

### Sample Mappings
- [ ] French Horn uses octave-aligned samples
- [ ] Rhodes EP uses correct note mappings
- [ ] All sample file names match actual pitches

---

## Appendix: MIDI Note Reference

```
Octave:  -1    0    1    2    3    4    5    6    7    8
C        0    12   24   36   48   60   72   84   96  108
C#/Db    1    13   25   37   49   61   73   85   97  109
D        2    14   26   38   50   62   74   86   98  110
D#/Eb    3    15   27   39   51   63   75   87   99  111
E        4    16   28   40   52   64   76   88  100  112
F        5    17   29   41   53   65   77   89  101  113
F#/Gb    6    18   30   42   54   66   78   90  102  114
G        7    19   31   43   55   67   79   91  103  115
G#/Ab    8    20   32   44   56   68   80   92  104  116
A        9    21   33   45   57   69   81   93  105  117
A#/Bb   10    22   34   46   58   70   82   94  106  118
B       11    23   35   47   59   71   83   95  107  119

Middle C = C4 = MIDI note 60
A440 = A4 = MIDI note 69
```

---

## Related Documents

- [VALUABLE-SAMPLES-SPEC.md](./VALUABLE-SAMPLES-SPEC.md) — Missing instruments
- [SAMPLE-IMPACT-RESEARCH.md](./SAMPLE-IMPACT-RESEARCH.md) — Original sample research
- [INSTRUMENT-EXPANSION.md](./INSTRUMENT-EXPANSION.md) — Implementation patterns

---

*This specification addresses quality issues identified in the January 2026 sample audit.*
