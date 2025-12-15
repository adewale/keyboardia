# Synthesis Enhancement

> **Phase 21A** — ✅ **COMPLETE** (December 2024)

This phase enhanced the synthesis engine and added sampled instruments while maintaining strict adherence to the UI philosophy and "everyone hears the same music" principle.

---

## Status

| Part | Status | Notes |
|------|--------|-------|
| Part A: Enhanced Synth Engine | ✅ Complete | osc2, filterEnv, LFO implemented |
| Part B: New Presets | ✅ Complete | 14 required + 14 bonus presets |
| Part C: Sampled Piano | ✅ Complete | Progressive loading, preloading |
| Part D: Sample Picker Updates | ✅ Complete | Improved architecture |
| Success Criteria | ✅ All Met | 869 tests passing |

---

## Motivation

### The Current State

The synth engine (`src/audio/synth.ts`) was a simple single-oscillator design:

```
Oscillator → Filter → Gain (ADSR) → Output
```

This produced 18 presets that sounded functional but lacked the richness of professional tools like Ableton's Learning Music or hardware synths like the OP-Z.

### The Gap

| Limitation | Impact |
|------------|--------|
| Single oscillator | No detuning, layering, or harmonic richness |
| Static filter | No filter sweeps, no envelope modulation |
| No LFO | No movement, vibrato, tremolo, or wobble |
| No sampled instruments | Can't produce realistic piano, strings, brass |

### The Opportunity

We dramatically improved sound quality **without breaking any architectural rules** by:

1. Enhancing the synth engine internally
2. Exposing new capabilities through **presets only**
3. Adding sampled instruments as new `sampleId` values

This follows the OP-Z philosophy: complex synthesis, simple interface.

---

## Design Principles

### The Preset-Only Constraint

> **Rule**: All new synthesis features are controlled via preset selection, not user-adjustable parameters.

This constraint ensures:

| Principle | How We Maintain It |
|-----------|-------------------|
| **Three Surfaces Align** | `sampleId` already syncs; no new state fields needed |
| **Everyone Hears Same Music** | Preset = deterministic sound; no local-only divergence |
| **No New Modes** | Sample picker works exactly as before |
| **Discoverable** | Users scroll presets, hear differences |

### UI Philosophy Alignment

Applying the five questions from `UI-PHILOSOPHY.md`:

| Question | Answer |
|----------|--------|
| Can I see the effect immediately? | ✅ Change preset, hear difference |
| Is the control on or near the thing it affects? | ✅ Preset picker on track row |
| Does it require mode switching or navigation? | ✅ No, just scroll picker |
| Would this work on a device with no screen? | ✅ Preset = track type |
| Can I discover it by experimenting? | ✅ Scroll presets, hear differences |

---

## Technical Design

### Part A: Enhanced Synth Engine

Extended `SynthParams` with optional fields that enable richer sounds:

```typescript
// src/audio/synth.ts

export interface SynthParams {
  // === EXISTING (required) ===
  waveform: WaveformType;
  filterCutoff: number;
  filterResonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;

  // === NEW: Dual Oscillator (optional) ===
  osc2?: {
    waveform: WaveformType;
    detune: number;          // Cents: -100 to +100 (fine tuning)
    coarse: number;          // Semitones: -24 to +24 (octave/interval)
    mix: number;             // 0 = osc1 only, 1 = osc2 only, 0.5 = equal
  };

  // === NEW: Filter Envelope (optional) ===
  filterEnv?: {
    amount: number;          // -1 to +1 (how much envelope moves cutoff)
    attack: number;          // 0 to 2 seconds
    decay: number;           // 0 to 2 seconds
    sustain: number;         // 0 to 1 (multiplier of amount)
  };

  // === NEW: LFO (optional) ===
  lfo?: {
    waveform: WaveformType;
    rate: number;            // Hz: 0.1 to 20
    depth: number;           // 0 to 1
    destination: 'filter' | 'pitch' | 'amplitude';
  };
}
```

**Implementation notes:**

- All new fields are optional with `undefined` meaning "disabled"
- Existing presets work unchanged (backwards compatible)
- `SynthVoice` class checks for optional fields and adds nodes only when needed
- LFO creates a dedicated `OscillatorNode` at sub-audio rate
- Filter envelope modulates `filter.frequency` directly using exponential ramps

### Part B: New Presets

Added these presets to `SYNTH_PRESETS`:

#### Enhanced Electronic

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `supersaw` | Classic trance/EDM lead | Dual saw, +25 cents detune |
| `hypersaw` | Even thicker than supersaw | Dual saw, +50 cents detune, filter env |
| `wobble` | Dubstep bass | LFO → filter @ 2Hz, saw wave, high resonance |
| `growl` | Aggressive bass | LFO → filter @ 4Hz, square wave, filter env |

#### Atmospheric

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `evolving` | Slow-moving texture | Filter env (2s attack), LFO → filter @ 0.2Hz |
| `sweep` | Build/transition sound | Filter env with 1s attack, dual osc |
| `warmpad` | Rich, full pad | Dual sine/saw, +7 cents detune, long release |
| `glass` | Crystalline, bell-like | High filter env, fast decay, sine + triangle octave |

#### Vintage Keys

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `epiano` | Electric piano | Triangle + sine, +5 cents detune |
| `vibes` | Vibraphone | Sine wave, LFO → amplitude @ 5Hz (tremolo) |
| `organphase` | Phasing organ | Dual square (octave down), LFO → pitch @ 0.8Hz |

#### Bass Enhancement

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `reese` | Reese bass | Dual saw +15 cents, LFO → filter @ 0.5Hz |
| `hoover` | Hoover/mentasm | Dual saw +40 cents (octave down), negative filter env |

#### Synthesized Piano Fallback

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `piano` | Synth fallback when samples unavailable | Triangle + sine, filter env for hammer attack |

**Bonus presets added beyond original spec:**

- **Funk/Soul**: `funkbass`, `clavinet`
- **Keys**: `rhodes`, `organ`, `wurlitzer`
- **Disco**: `discobass`, `strings`, `brass`
- **House/Techno**: `stab`, `sub`
- **Atmospheric**: `shimmer`, `jangle`, `dreampop`, `bell`

### Part C: Sampled Piano

Added one high-quality sampled instrument to establish the pattern.

#### Storage Structure

```
public/instruments/piano/
├── manifest.json     (500 bytes)
├── C2.mp3           (119KB, 5s trimmed sample)
├── C3.mp3           (119KB)
├── C4.mp3           (119KB)
└── C5.mp3           (119KB)
```

**Total size**: 484KB (originally 3.4MB before optimization)

#### Manifest Format

```json
{
  "id": "piano",
  "name": "Grand Piano",
  "type": "sampled",
  "baseNote": 60,
  "releaseTime": 0.5,
  "credits": {
    "source": "University of Iowa Electronic Music Studios",
    "url": "https://theremin.music.uiowa.edu/MISpiano.html",
    "license": "Free for any projects, without restrictions"
  },
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ]
}
```

#### Pitch Mapping Strategy

For a note request at MIDI note N:

1. Find the nearest sample to minimize pitch-shifting artifacts
2. Apply `playbackRate` adjustment: `2^((N - sampleNote) / 12)`

**Example**: Playing E4 (MIDI 64) uses C4 sample with rate `2^(4/12) ≈ 1.26`

#### Loading Strategy: Progressive + Preloading

**Progressive Loading** (implemented in `sampled-instrument.ts`):

```typescript
private async loadIndividualFiles(): Promise<void> {
  // Sort: C4 (60) first, then by distance from C4
  const sortedMappings = [...this.manifest!.samples].sort((a, b) => {
    if (a.note === 60) return -1;
    if (b.note === 60) return 1;
    return Math.abs(a.note - 60) - Math.abs(b.note - 60);
  });

  // Load C4 immediately - playback enabled after this
  const firstSample = await this.loadSingleSample(sortedMappings[0]);
  this.samples.set(firstSample.note, firstSample);
  this.isLoaded = true;  // Ready after C4 loads (~1.2s on 3G)

  // Load remaining samples in background (fire-and-forget)
  this.loadRemainingSamples(sortedMappings.slice(1));
}
```

**Preloading Triggers** (ensures piano is ready before user hits play):

1. **Session Load** (`useSession.ts`):
   ```typescript
   loadState(gridState.tracks, gridState.tempo, gridState.swing);
   audioEngine.preloadInstrumentsForTracks(gridState.tracks);
   ```

2. **Sample Selection** (`SamplePicker.tsx`):
   ```typescript
   if (isSampledInstrument(preset)) {
     sampledInstrumentRegistry.load(preset);
   }
   ```

3. **First Play** (`engine.ts`):
   ```typescript
   // Lazy load triggered in playSynthNote if not already loaded
   if (isSampledInstrument(presetName)) {
     sampledInstrumentRegistry.load(presetName);
   }
   ```

### Part D: Sample Picker Updates

**Deviation from original spec**: Instead of mixing samples and synths in `SAMPLE_CATEGORIES`, implemented a cleaner separation:

#### Actual Architecture

```typescript
// src/types.ts - Audio file samples (unchanged)
export const SAMPLE_CATEGORIES = {
  drums: ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat'],
  bass: ['bass', 'subbass'],
  synth: ['lead', 'pluck', 'chord', 'pad'],
  fx: ['zap', 'noise'],
} as const;

// src/components/SamplePicker.tsx - Real-time synth presets (new)
export const SYNTH_CATEGORIES = {
  core: ['synth:bass', 'synth:lead', 'synth:pad', 'synth:pluck', 'synth:acid'],
  keys: ['synth:piano', 'synth:rhodes', 'synth:organ', 'synth:wurlitzer',
         'synth:clavinet', 'synth:epiano', 'synth:vibes', 'synth:organphase'],
  electronic: ['synth:supersaw', 'synth:hypersaw', 'synth:wobble',
               'synth:growl', 'synth:stab', 'synth:sub'],
  bass: ['synth:funkbass', 'synth:discobass', 'synth:reese', 'synth:hoover'],
  strings: ['synth:strings', 'synth:brass', 'synth:warmpad'],
  ambient: ['synth:shimmer', 'synth:jangle', 'synth:dreampop',
            'synth:bell', 'synth:evolving', 'synth:sweep', 'synth:glass'],
} as const;
```

**Why this is better than the spec proposed:**

| Aspect | Spec Proposal | Actual Implementation |
|--------|---------------|----------------------|
| Categories | 6 mixed categories | Samples (4) + Synths (6) = clearer separation |
| Naming | Implicit distinction | Explicit `synth:` prefix for generated sounds |
| Organization | By sound type | Samples by source, synths by genre/style |
| Extensibility | Would need refactoring | Easy to add more synth categories |

---

## What's NOT In Scope

These features remain in Phase 25 (or later):

| Feature | Why Deferred |
|---------|--------------|
| **Effects (reverb, delay)** | Requires new synced state (`reverbMix`), WS messages, server validation. Explicitly documented as "end-of-project work" in `lessons-learned.md`. |
| **User-editable synth params** | Would need per-track synth config in state, new UI panel, sync protocol. Violates "no modes" and "controls where they act" principles. |
| **XY Pad / macro controls** | If it controls synced params: needs state integration. If local-only: breaks "same music" guarantee. Complex design problem. |
| **FM Synthesis** | Complex modulator/carrier UI doesn't fit "discover by experimenting" principle. High effort, niche benefit. |
| **More sampled instruments** | Piano establishes the pattern. Strings, brass, etc. can follow in later phases using same infrastructure. |

---

## Success Criteria

| Criterion | Target | Result |
|-----------|--------|--------|
| **Richer sounds** | New presets sound fuller than old | ✅ 28 new presets with osc2/filterEnv/LFO |
| **No sync issues** | Same preset = identical audio | ✅ Presets are deterministic |
| **Backwards compatible** | Old sessions work | ✅ Unchanged presets still work |
| **Performance maintained** | Mobile CPU ≤ current | ✅ MAX_VOICES=16 still in place |
| **Load time acceptable** | Piano <2s on 3G | ✅ C4 loads in ~1.2s on 3G |
| **All tests pass** | Unit + integration green | ✅ **869 tests passing** |

---

## Sample Sourcing

Used University of Iowa Electronic Music Studios piano samples (public domain, free for any use):

- **Source**: https://theremin.music.uiowa.edu/MISpiano.html
- **Original format**: AIFF (24-50 seconds each, 3.4MB total)
- **Processed format**: MP3 192kbps (5 seconds each, 484KB total)
- **Notes sampled**: C2 (36), C3 (48), C4 (60), C5 (72)

---

## Risk Assessment (Post-Implementation)

| Risk | Likelihood | Impact | Outcome |
|------|------------|--------|---------|
| LFO causes CPU spikes | Low | Medium | ✅ No issues observed |
| Dual oscillator doubles CPU | Medium | Low | ✅ MAX_VOICES limits total |
| Piano samples too large | Low | Medium | ✅ Optimized from 3.4MB → 484KB |
| Filter envelope causes clicks | Low | Medium | ✅ Exponential ramps prevent clicks |
| New presets break existing sessions | Very Low | High | ✅ Additive changes only |
| **Synth fallback on piano** | Medium | High | ✅ Fixed with preloading |

---

## Future Extensions

Once this phase establishes the pattern:

1. **More sampled instruments**: Strings, brass, vibraphone (same pattern)
2. **Preset browser**: Search/filter presets by tag (bass, pad, bright, dark)
3. **Preset randomizer**: "Surprise me" button for discovery
4. **User preset naming**: Rename track to create personal preset library (local only)
5. **Audio sprite mode**: Combine all samples into single file for faster loading

---

## Appendix A: Preset Specifications

### supersaw

```typescript
supersaw: {
  waveform: 'sawtooth',
  filterCutoff: 4000,
  filterResonance: 2,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.8,
  release: 0.3,
  osc2: {
    waveform: 'sawtooth',
    detune: 25,      // +25 cents
    coarse: 0,
    mix: 0.5,
  },
}
```

### wobble

```typescript
wobble: {
  waveform: 'sawtooth',
  filterCutoff: 400,
  filterResonance: 12,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.1,
  lfo: {
    waveform: 'sine',
    rate: 2,          // 2 Hz wobble
    depth: 0.8,
    destination: 'filter',
  },
}
```

### evolving

```typescript
evolving: {
  waveform: 'sawtooth',
  filterCutoff: 800,
  filterResonance: 4,
  attack: 0.05,
  decay: 0.3,
  sustain: 0.7,
  release: 1.5,
  filterEnv: {
    amount: 0.6,
    attack: 2.0,       // Slow filter open
    decay: 1.0,
    sustain: 0.4,
  },
  lfo: {
    waveform: 'sine',
    rate: 0.2,         // Very slow movement
    depth: 0.3,
    destination: 'filter',
  },
}
```

### warmpad

```typescript
warmpad: {
  waveform: 'sawtooth',
  filterCutoff: 2000,
  filterResonance: 1,
  attack: 0.05,
  decay: 0.3,
  sustain: 0.8,
  release: 1.2,
  osc2: {
    waveform: 'sine',
    detune: 7,         // Subtle beating
    coarse: 0,
    mix: 0.4,
  },
}
```

---

## Appendix B: Implementation Notes

### Sample Duration Optimization

**Key insight**: What's the longest note a user can play?

```
MIN_TEMPO = 60 BPM
Step duration at 60 BPM = 60/60/4 = 0.25s per step
Longest sequence = 64 steps × 0.25s = 16s total
But single note max = 1 step = 0.25s + release (0.5s) = 0.75s

Practical max: ~1.5s of useful sample
```

**Result**: Trimmed samples from 24-50s to 5s each (with margin for pitch-shifting). Total size reduced from 3.4MB to 484KB (86% reduction).

### Audio Processing Pipeline

```bash
ffmpeg -y -i original.aiff \
  -af "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.01,\
       atrim=0:5,\
       afade=t=out:st=4.5:d=0.5,\
       agate=threshold=-30dB:attack=1:release=50,\
       acompressor=threshold=-25dB:ratio=4:attack=5:release=100,\
       loudnorm=I=-12:TP=-1:LRA=7" \
  -codec:a libmp3lame -b:a 192k output.mp3
```

| Stage | Purpose |
|-------|---------|
| `silenceremove` | Trim leading silence (~0.3s in originals) |
| `atrim=0:5` | Trim to 5 seconds max |
| `afade=t=out:st=4.5:d=0.5` | Fade out last 0.5s to prevent click |
| `agate` | Gate noise before compression |
| `acompressor` | Reduce dynamic range |
| `loudnorm=I=-12` | EBU R128 normalization (matches synth level) |

### Web Audio Architecture

**Critical principle**: The master audio chain must be immutable after initialization.

```
Source → GainNode → masterGain → destination
           ↑ stable reference passed at init
```

- Never disconnect/reconnect masterGain during playback
- Pass masterGain reference to instruments at initialization
- Instruments trust this reference; no defensive reconnection
- For monitoring, use parallel AnalyserNode (non-destructive tap)

### Synth Fallback Prevention

The critical behavior is: **When user selects piano, they hear piano (not synth)**.

This is ensured by:

1. **Preloading on session load**: `audioEngine.preloadInstrumentsForTracks()`
2. **Preloading on selection**: `sampledInstrumentRegistry.load(preset)`
3. **Progressive loading**: C4 loads first (~1.2s), enabling playback while rest loads
4. **isReady() check**: `playSynthNote()` only uses samples when `instrument.isReady()`

### Test Coverage

Created comprehensive tests to verify behavior:

- `sampled-instrument.test.ts` (15 tests): Unit tests for identification, loading order, pitch calculation
- `sampled-instrument-integration.test.ts` (8 tests): Integration tests verifying piano plays, not synth

Key test: "should use sampled playback after preloading completes"

```typescript
await instrument.ensureLoaded();
expect(instrument.isReady()).toBe(true);
const source = instrument.playNote('test', 60, 0, 0.5, 1);
expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
```

### Impact Analysis Tool

Created `scripts/audio-impact.sh` to measure:

- Total sample size
- Load time at different connection speeds (3G, 4G, broadband)
- First-note latency (C4 progressive loading)

Example output:
```
=== AUDIO ASSET IMPACT ANALYSIS ===
Total Size: 484K
Estimated Load Times:
  - 3G (750 Kbps):     5.2s
  - 4G (12 Mbps):      0.3s
  - Broadband (50 Mbps): 0.1s
C4 First (Progressive): 1.2s on 3G
```

---

## Appendix C: Files Modified

| File | Changes |
|------|---------|
| `src/audio/synth.ts` | Added Osc2Config, FilterEnvConfig, LFOConfig interfaces; SynthVoice enhanced; 28 new presets |
| `src/audio/sampled-instrument.ts` | New file: SampledInstrument class, registry, progressive loading |
| `src/audio/engine.ts` | Added `preloadInstrumentsForTracks()`, lazy loading integration |
| `src/components/SamplePicker.tsx` | Added SYNTH_CATEGORIES, preload on selection |
| `src/hooks/useSession.ts` | Added preload on session load |
| `src/audio/sampled-instrument.test.ts` | New file: 15 unit tests |
| `src/audio/sampled-instrument-integration.test.ts` | New file: 8 integration tests |
| `public/instruments/piano/*` | Manifest + 4 MP3 samples (484KB total) |
| `scripts/audio-impact.sh` | New file: Impact analysis tool |
