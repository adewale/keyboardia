# Sample Quality Fixes - Implementation Plan

> Concrete, actionable fixes for the quality issues identified in SAMPLE-QUALITY-IMPROVEMENTS.md

**Date:** January 2026
**Status:** Ready for Implementation

---

## Fix Categories

| Category | Fixes | Effort | Samples Needed |
|----------|-------|--------|----------------|
| **Immediate** | Rhodes mapping, release times | 1-2 days | No |
| **Short-term** | Detection tools, UI warnings, playable ranges | 3-5 days | No |
| **Medium-term** | French Horn improvement, Alto Sax sample | 1-2 weeks | Maybe |
| **Long-term** | Velocity layers | 3-4 weeks | Yes |

---

## Immediate Fixes (No New Samples)

### Fix 1: Rhodes EP Manifest Bug

**Problem:** Files are named C2.mp3, C3.mp3, C4.mp3, C5.mp3 but mapped to wrong MIDI notes.

**Current (WRONG):**
```json
{
  "samples": [
    { "note": 40, "file": "C2.mp3" },  // 40 = E2, but file is C2!
    { "note": 50, "file": "C3.mp3" },  // 50 = D3, but file is C3!
    { "note": 62, "file": "C4.mp3" },  // 62 = D4, but file is C4!
    { "note": 65, "file": "C5.mp3" }   // 65 = F4, but file is C5!
  ]
}
```

**Fixed:**
```json
{
  "samples": [
    { "note": 36, "file": "C2.mp3" },  // C2 = 36 ✓
    { "note": 48, "file": "C3.mp3" },  // C3 = 48 ✓
    { "note": 60, "file": "C4.mp3" },  // C4 = 60 ✓
    { "note": 72, "file": "C5.mp3" }   // C5 = 72 ✓
  ]
}
```

**Impact:** Fixes 12 semitone gaps, creates consistent octave spacing.

**Verification:** Play C4 on Rhodes - should sound like middle C, not D4.

---

### Fix 2: Release Time Calibration

Update these manifests with corrected release times:

| Instrument | Current | Fixed | Rationale |
|------------|---------|-------|-----------|
| `acoustic-hihat-closed` | 0.05s | **0.15s** | Natural hi-hat ring |
| `acoustic-hihat-open` | 0.3s | 0.3s | OK |
| `acoustic-kick` | 0.1s | **0.2s** | Room ambience |
| `acoustic-snare` | 0.1s | **0.25s** | Room ambience |
| `vibraphone` | 1.5s | **1.0s** | Reduce mud |
| `rhodes-ep` | 1.0s | **0.8s** | Tighter response |

**Implementation:**
```bash
# Update each manifest.json with new releaseTime value
```

---

## Short-term Fixes (Code Changes)

### Fix 3: Pitch-Shift Quality Analyzer

**File:** `app/scripts/analyze-pitch-shift-quality.ts`

```typescript
#!/usr/bin/env npx tsx

/**
 * Analyzes pitch-shift quality for all sampled instruments.
 * Run: npx tsx app/scripts/analyze-pitch-shift-quality.ts
 */

import fs from 'fs';
import path from 'path';

const INSTRUMENTS_DIR = 'app/public/instruments';
const MAX_ACCEPTABLE_GAP = 6;

interface Manifest {
  id: string;
  name: string;
  samples: { note: number; file: string }[];
}

interface GapAnalysis {
  from: number;
  to: number;
  semitones: number;
  fromNote: string;
  toNote: string;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function analyzeInstrument(instrumentDir: string): void {
  const manifestPath = path.join(instrumentDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const notes = manifest.samples.map(s => s.note).sort((a, b) => a - b);

  if (notes.length < 2) {
    console.log(`⚠️  ${manifest.id}: Single sample (${midiToNoteName(notes[0])})`);
    console.log(`   Cannot pitch-shift reliably across range\n`);
    return;
  }

  const gaps: GapAnalysis[] = [];
  let maxGap = 0;

  for (let i = 0; i < notes.length - 1; i++) {
    const semitones = notes[i + 1] - notes[i];
    gaps.push({
      from: notes[i],
      to: notes[i + 1],
      semitones,
      fromNote: midiToNoteName(notes[i]),
      toNote: midiToNoteName(notes[i + 1]),
    });
    maxGap = Math.max(maxGap, semitones);
  }

  const status = maxGap <= MAX_ACCEPTABLE_GAP ? '✅' : '⚠️';
  console.log(`${status} ${manifest.id}`);
  console.log(`   Samples: ${notes.map(midiToNoteName).join(', ')}`);
  console.log(`   Max gap: ${maxGap} semitones`);

  if (maxGap > MAX_ACCEPTABLE_GAP) {
    const badGaps = gaps.filter(g => g.semitones > MAX_ACCEPTABLE_GAP);
    for (const gap of badGaps) {
      console.log(`   ❌ ${gap.fromNote} → ${gap.toNote}: ${gap.semitones} semitones`);
    }
    console.log(`   💡 Add samples to reduce gaps to ≤${MAX_ACCEPTABLE_GAP} semitones`);
  }
  console.log();
}

function main(): void {
  console.log('\n🎵 PITCH-SHIFT QUALITY ANALYSIS\n');
  console.log(`Threshold: ≤${MAX_ACCEPTABLE_GAP} semitones between samples\n`);
  console.log('─'.repeat(50) + '\n');

  const instruments = fs.readdirSync(INSTRUMENTS_DIR)
    .filter(f => fs.statSync(path.join(INSTRUMENTS_DIR, f)).isDirectory())
    .sort();

  for (const instrument of instruments) {
    analyzeInstrument(path.join(INSTRUMENTS_DIR, instrument));
  }

  console.log('─'.repeat(50));
  console.log('\nLegend:');
  console.log('  ✅ = All gaps ≤ 6 semitones (good quality)');
  console.log('  ⚠️  = Some gaps > 6 semitones (artifacts likely)');
  console.log('  ❌ = Specific problematic gap\n');
}

main();
```

---

### Fix 4: Playable Range Limits

Add `playableRange` to manifests for single-sample instruments:

**File:** `app/public/instruments/808-kick/manifest.json`
```json
{
  "id": "808-kick",
  "name": "808 Kick",
  "type": "sampled",
  "baseNote": 36,
  "releaseTime": 0.1,
  "playableRange": {
    "min": 24,
    "max": 48,
    "warnMin": 30,
    "warnMax": 42
  },
  "samples": [
    { "note": 36, "file": "kick.mp3" }
  ]
}
```

**Update `sampled-instrument.ts`:**
```typescript
interface InstrumentManifest {
  // ... existing fields
  playableRange?: {
    min: number;    // Hard limit - notes outside are skipped
    max: number;
    warnMin?: number;  // Soft limit - show warning in UI
    warnMax?: number;
  };
}

playNote(noteId: string, midiNote: number, time: number, duration?: number, volume: number = 1): AudioBufferSourceNode | null {
  // Check playable range
  if (this.manifest?.playableRange) {
    const { min, max } = this.manifest.playableRange;
    if (midiNote < min || midiNote > max) {
      logger.audio.warn(`Note ${midiNote} outside playable range [${min}, ${max}] for ${this.instrumentId}`);
      return null; // Skip note
    }
  }
  // ... rest of method
}
```

---

### Fix 5: UI Quality Indicator

Add visual feedback in ChromaticGrid when pitch shift quality is poor:

```typescript
// In ChromaticGrid.tsx or PitchOverview.tsx

function getPitchShiftQuality(instrument: string, basePitch: number, targetPitch: number): 'good' | 'fair' | 'poor' {
  const manifest = getInstrumentManifest(instrument);
  if (!manifest) return 'good';

  const sampleNotes = manifest.samples.map(s => s.note);
  const nearestSample = sampleNotes.reduce((a, b) =>
    Math.abs(b - targetPitch) < Math.abs(a - targetPitch) ? b : a
  );

  const shift = Math.abs(targetPitch - nearestSample);

  if (shift <= 6) return 'good';
  if (shift <= 12) return 'fair';
  return 'poor';
}

// Visual indicator
<div
  className={cn(
    'pitch-cell',
    quality === 'poor' && 'border-orange-500',
    quality === 'fair' && 'border-yellow-500',
  )}
  title={quality !== 'good' ? `${shift} semitone pitch shift` : undefined}
/>
```

---

## Medium-term Fixes (May Need Samples)

### Fix 6: French Horn Sample Gap

**Current situation:**
- Source: VSCO 2 CE (F Horn Sustain)
- Available samples: C1, F2, C3, D4 (notes 24, 41, 48, 62)
- Worst gap: C1→F2 = 17 semitones

**Investigation needed:**
1. Check if VSCO 2 CE has more French Horn samples we didn't include
2. Check alternative sources (Philharmonia, University of Iowa)

**Option A: Source additional samples**

If VSCO 2 CE or another CC0 source has samples at C2 (36) and C4 (60):
```json
{
  "samples": [
    { "note": 24, "file": "C1.mp3" },
    { "note": 36, "file": "C2.mp3" },  // NEW - reduces gap to 12
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },  // NEW - replaces D4
    { "note": 72, "file": "C5.mp3" }   // NEW - extends range
  ]
}
```

**Option B: Accept limitation with range restriction**

If no additional samples available:
```json
{
  "playableRange": {
    "min": 41,   // Start at F2 to avoid worst gap
    "max": 72,
    "warnMin": 44,
    "warnMax": 68
  }
}
```

**Option C: Use different instrument**

Philharmonia Orchestra has extensive brass samples. Consider replacing VSCO 2 CE source entirely.

---

### Fix 7: Alto Sax Sample Coverage

**Current:** D2, C3, C4, Ab4 (notes 38, 48, 60, 68)
**Gaps:** 10, 12, 8 semitones

**Fix:** Add sample at F#3 (note 54) to reduce 12-semitone gap:
```json
{
  "samples": [
    { "note": 38, "file": "D2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 54, "file": "F#3.mp3" },  // NEW
    { "note": 60, "file": "C4.mp3" },
    { "note": 68, "file": "Ab4.mp3" }
  ]
}
```

Source: Karoryfer Weresax likely has this sample available.

---

## Long-term Fixes (Requires Sample Sourcing)

### Fix 8: Velocity Layers

**Priority instruments:**

| Instrument | Layers | Sources | Effort |
|------------|--------|---------|--------|
| **Piano** | 3 (pp/mf/ff) | University of Iowa, Pianobook | High |
| **Rhodes EP** | 3 (pp/mf/ff) | jRhodes3d has velocity layers | Medium |
| **Acoustic Snare** | 2 (ghost/full) | Virtuosity Drums | Medium |

**Implementation approach:**

1. **Update manifest schema** (already designed in SAMPLE-QUALITY-IMPROVEMENTS.md)
2. **Source velocity samples:**
   - jRhodes3d already includes velocity layers - just need to export them
   - University of Iowa piano has multiple dynamics
   - Virtuosity Drums has velocity layers
3. **Update loading logic** to select by velocity
4. **Update playback** to pass velocity through

**jRhodes3d velocity layers available:**
The source repo has `pp`, `mf`, `ff` folders. We currently only use one.

```bash
# jRhodes3d structure:
# /pp/C2.wav, /pp/C3.wav, ...
# /mf/C2.wav, /mf/C3.wav, ...
# /ff/C2.wav, /ff/C3.wav, ...
```

**New manifest structure:**
```json
{
  "id": "rhodes-ep",
  "name": "Rhodes EP",
  "type": "sampled",
  "baseNote": 60,
  "releaseTime": 0.8,
  "samples": [
    { "note": 36, "file": "pp/C2.mp3", "velocityMin": 0, "velocityMax": 50 },
    { "note": 36, "file": "mf/C2.mp3", "velocityMin": 51, "velocityMax": 100 },
    { "note": 36, "file": "ff/C2.mp3", "velocityMin": 101, "velocityMax": 127 },
    { "note": 48, "file": "pp/C3.mp3", "velocityMin": 0, "velocityMax": 50 },
    // ... etc
  ]
}
```

---

## Implementation Order

### Week 1: Immediate Fixes
1. ✅ Fix Rhodes EP manifest (note mapping bug)
2. ✅ Update release times in 6 manifests
3. ✅ Create pitch-shift analyzer script
4. ✅ Run analyzer, document results

### Week 2: Short-term Fixes
5. Add playableRange to single-sample instruments
6. Add UI quality indicator for pitch shifts
7. Investigate French Horn source for additional samples
8. Investigate Alto Sax source for F#3 sample

### Week 3-4: Medium-term Fixes
9. Source and process French Horn samples (if available)
10. Source and process Alto Sax F#3 sample
11. Update manifests with new samples

### Week 5-6: Velocity Layers
12. Export jRhodes3d velocity layers (pp/mf/ff)
13. Update manifest schema for velocity
14. Update sampled-instrument.ts for velocity selection
15. Process and integrate Rhodes velocity samples

### Week 7-8: Extended Velocity
16. Source Piano velocity layers
17. Source Acoustic Snare velocity layers
18. Integrate remaining velocity samples

---

## Verification Checklist

### After Immediate Fixes
- [ ] Rhodes EP C4 sounds like middle C (not D4)
- [ ] Pitch-shift analyzer reports Rhodes as ✅
- [ ] Hi-hat closed rings naturally (0.15s)
- [ ] Vibraphone doesn't muddy fast passages

### After Short-term Fixes
- [ ] 808 kick outside range is skipped gracefully
- [ ] UI shows warning for poor quality pitch shifts
- [ ] Analyzer script runs without errors

### After Medium-term Fixes
- [ ] French Horn max gap ≤ 12 semitones
- [ ] Alto Sax max gap ≤ 8 semitones
- [ ] All instruments pass analyzer

### After Velocity Layers
- [ ] Rhodes soft notes sound bell-like
- [ ] Rhodes loud notes have bark/growl
- [ ] Piano dynamics change timbre, not just volume
- [ ] Snare ghost notes sound thin

---

## Risk Assessment

| Fix | Risk | Mitigation |
|-----|------|------------|
| Rhodes mapping | Low - clear bug | Verify with pitch detection before/after |
| Release times | Low - easily reversible | A/B test with users |
| Playable range | Medium - may surprise users | Show clear UI feedback |
| French Horn samples | Medium - may not find CC0 source | Fall back to range restriction |
| Velocity layers | Low - additive change | Feature flag for rollback |

---

## Related Documents

- [SAMPLE-QUALITY-IMPROVEMENTS.md](./SAMPLE-QUALITY-IMPROVEMENTS.md) — Full analysis
- [VALUABLE-SAMPLES-SPEC.md](./VALUABLE-SAMPLES-SPEC.md) — Missing instruments
- [SAMPLE-IMPACT-RESEARCH.md](./SAMPLE-IMPACT-RESEARCH.md) — Original research
