# Synthesis Enhancement

> **Phase 21B** — Can be executed in parallel with Phase 21 (Polish & Production)

This phase enhances the synthesis engine and adds sampled instruments while maintaining strict adherence to the UI philosophy and "everyone hears the same music" principle.

---

## Motivation

### The Current State

The synth engine (`src/audio/synth.ts`) is a simple single-oscillator design:

```
Oscillator → Filter → Gain (ADSR) → Output
```

This produces 18 presets that sound functional but lack the richness of professional tools like Ableton's Learning Music or hardware synths like the OP-Z.

### The Gap

| Limitation | Impact |
|------------|--------|
| Single oscillator | No detuning, layering, or harmonic richness |
| Static filter | No filter sweeps, no envelope modulation |
| No LFO | No movement, vibrato, tremolo, or wobble |
| No sampled instruments | Can't produce realistic piano, strings, brass |

### The Opportunity

We can dramatically improve sound quality **without breaking any architectural rules** by:

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

Extend `SynthParams` with optional fields that enable richer sounds:

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
- Filter envelope uses a second gain envelope routed to `filter.frequency`

### Part B: New Presets

Add these presets to `SYNTH_PRESETS`:

#### Enhanced Electronic

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `supersaw` | Classic trance/EDM lead | Dual saw, heavy detune (+25/-25 cents) |
| `hypersaw` | Even thicker than supersaw | Dual saw, extreme detune (+50/-50), slight filter env |
| `wobble` | Dubstep bass | LFO → filter @ 2Hz, saw wave, high resonance |
| `growl` | Aggressive bass | LFO → filter @ 4Hz, square wave, filter env |

#### Atmospheric

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `evolving` | Slow-moving texture | Filter env (slow attack), LFO → filter @ 0.2Hz |
| `sweep` | Build/transition sound | Filter env with 1s attack, dual osc |
| `warmpad` | Rich, full pad | Dual sine/saw, slight detune (+7 cents), long release |
| `glass` | Crystalline, bell-like | High filter env amount, fast decay, sine + triangle |

#### Vintage Keys

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `epiano` | Electric piano | Triangle + sine, slight detune, medium decay |
| `vibes` | Vibraphone | Sine wave, LFO → amplitude @ 5Hz (tremolo) |
| `organphase` | Phasing organ | Dual square, slow LFO → pitch (rotary effect) |

#### Bass Enhancement

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `reese` | Reese bass | Dual saw, slow detune modulation via LFO |
| `hoover` | Hoover/mentasm | Dual saw, heavy detune, filter env down |

### Part C: Sampled Piano

Add one high-quality sampled instrument to establish the pattern.

#### R2 Storage Structure

```
keyboardia-samples/
└── instruments/
    └── piano/
        ├── manifest.json
        ├── C2.mp3      (~80KB, 2s sample)
        ├── C3.mp3      (~80KB)
        ├── C4.mp3      (~80KB)
        └── C5.mp3      (~80KB)
```

**Total size**: ~320KB (lazy-loaded on first use)

#### Manifest Format

```json
{
  "id": "piano",
  "name": "Piano",
  "type": "sampled",
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ],
  "baseNote": 60,
  "releaseTime": 0.5
}
```

#### Pitch Mapping Strategy

For a note request at MIDI note N:

1. Find the two nearest samples (e.g., C3=48 and C4=60)
2. Pick the closer one to minimize pitch-shifting artifacts
3. Apply `playbackRate` adjustment: `2^((N - sampleNote) / 12)`

**Example**: Playing E4 (MIDI 64) uses C4 sample with rate `2^(4/12) ≈ 1.26`

#### Loading Strategy

```typescript
// src/audio/sampled-instrument.ts

class SampledInstrument {
  private samples: Map<number, AudioBuffer> = new Map();
  private loading: Promise<void> | null = null;

  async ensureLoaded(): Promise<void> {
    if (this.samples.size > 0) return;
    if (this.loading) return this.loading;

    this.loading = this.loadSamples();
    await this.loading;
  }

  private async loadSamples(): Promise<void> {
    const manifest = await fetch('/instruments/piano/manifest.json').then(r => r.json());
    await Promise.all(
      manifest.samples.map(async (s) => {
        const response = await fetch(`/instruments/piano/${s.file}`);
        const buffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(buffer);
        this.samples.set(s.note, audioBuffer);
      })
    );
  }

  playNote(midiNote: number, time: number, duration: number): void {
    const { buffer, rate } = this.findNearestSample(midiNote);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    // ... envelope, connect, start
  }
}
```

### Part D: Sample Picker Updates

#### New Categories

```typescript
// src/types.ts

export const SAMPLE_CATEGORIES = {
  drums: ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat'],
  bass: ['bass', 'subbass', 'wobble', 'growl', 'reese', 'hoover'],  // Enhanced
  synth: ['lead', 'pluck', 'chord', 'pad', 'supersaw', 'hypersaw', 'sweep'],  // Enhanced
  keys: ['rhodes', 'wurlitzer', 'organ', 'piano', 'epiano', 'vibes'],  // New category
  atmospheric: ['shimmer', 'evolving', 'warmpad', 'glass', 'dreampop'],  // New category
  fx: ['zap', 'noise'],
} as const;
```

#### Visual Distinction

In the picker, sampled instruments show a different indicator:

```
Drums:  🥁 Kick, Snare, HiHat...
Keys:   🎹 Piano*, Rhodes, Wurlitzer...
              ↑ asterisk or icon indicates "sampled"
```

This is purely informational—behavior is identical.

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

## Implementation Plan

### Step 1: Enhanced SynthVoice (~3 days)

1. Extend `SynthParams` interface with optional fields
2. Update `SynthVoice` constructor to create osc2, filter env, LFO nodes when specified
3. Proper node cleanup in `cleanup()` method
4. Unit tests for each new feature (isolated)

**Files:**
- `src/audio/synth.ts` — Core changes
- `src/audio/synth.test.ts` — New tests

### Step 2: New Presets (~1 day)

1. Add 12 new presets to `SYNTH_PRESETS`
2. Verify each plays correctly at 120 BPM
3. Audio quality check (no clipping, good gain staging)

**Files:**
- `src/audio/synth.ts` — Preset definitions

### Step 3: Sampled Piano (~3 days)

1. Source or record piano samples (C2, C3, C4, C5)
2. Create R2 bucket structure and manifest
3. Implement `SampledInstrument` class
4. Integrate with audio engine (detect `sampleId === 'piano'`)
5. Lazy loading with loading indicator

**Files:**
- `src/audio/sampled-instrument.ts` — New file
- `src/audio/engine.ts` — Integration
- `worker/` — R2 routing if needed

### Step 4: Sample Picker Updates (~1 day)

1. Update `SAMPLE_CATEGORIES` with new presets
2. Add "Keys" and "Atmospheric" categories
3. Visual indicator for sampled vs synthesized (optional polish)

**Files:**
- `src/types.ts` — Categories
- `src/components/SamplePicker.tsx` — Display updates

### Step 5: Testing & Polish (~1 day)

1. Integration tests with existing sessions
2. Verify no sync issues (existing sessions with new presets)
3. Mobile performance check (voice limiting still effective)
4. Audio quality audit

---

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| **Richer sounds** | A/B comparison: new presets sound fuller than old |
| **No sync issues** | Two clients select same preset → identical audio |
| **Backwards compatible** | Existing sessions load and play correctly |
| **Performance maintained** | Mobile CPU usage ≤ current with 8 active tracks |
| **Load time acceptable** | Piano samples load in <2s on 3G |
| **All tests pass** | Unit + integration test suites green |

---

## Sample Sourcing Options

For the piano samples, in order of preference:

1. **Pianobook** (https://pianobook.co.uk/) — Free, high-quality samples, permissive licensing
2. **Freesound** (https://freesound.org/) — CC0 piano samples available
3. **Record ourselves** — Use a MIDI keyboard + good piano VST, export stems
4. **University of Iowa** (http://theremin.music.uiowa.edu/) — Public domain instrument samples

**Requirement**: Samples must be CC0, public domain, or have perpetual royalty-free license for web distribution.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LFO causes CPU spikes | Low | Medium | LFO uses single oscillator per voice; voice limiting already in place |
| Dual oscillator doubles CPU | Medium | Low | Only 2 voices per note (vs unlimited); MAX_VOICES=16 limits total |
| Piano samples too large | Low | Medium | One sample per octave keeps total <500KB |
| Filter envelope causes clicks | Low | Medium | Use same micro-fade technique as existing envelope |
| New presets break existing sessions | Very Low | High | Preset lookup is additive; unknown IDs fallback to default |

---

## Future Extensions

Once this phase establishes the pattern:

1. **More sampled instruments**: Strings, brass, vibraphone (same R2 pattern)
2. **Preset browser**: Search/filter presets by tag (bass, pad, bright, dark)
3. **Preset randomizer**: "Surprise me" button for discovery
4. **User preset naming**: Rename track to create personal preset library (local only)

These are out of scope for this phase but become easier with the foundation in place.

---

## Appendix: Preset Specifications

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

(Full specifications for remaining presets to be added during implementation)
