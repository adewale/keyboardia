# Advanced Synthesis Engine Specification

> **Status:** Proposal
> **Last Updated:** December 2025
> **Related:** [ROADMAP.md](./ROADMAP.md) Phase 25

## Executive Summary

This document consolidates all remaining music synthesis functionality from the roadmap into a comprehensive specification, analyzes Tone.js as an implementation option, and evaluates the costs and implications of adoption.

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Requirements](#2-requirements)
3. [Tone.js Analysis](#3-tonejs-analysis)
4. [Implementation Options](#4-implementation-options)
5. [Migration Analysis](#5-migration-analysis)
6. [Recommendations](#6-recommendations)

---

## 1. Current State

### 1.1 Existing Architecture

The current audio system is built on raw Web Audio API with these components:

| Component | File | Description |
|-----------|------|-------------|
| **SynthEngine** | `synth.ts` | 16-voice polyphonic synthesizer with voice stealing |
| **SynthVoice** | `synth.ts` | Single oscillator → filter → gain chain |
| **AudioEngine** | `engine.ts` | Sample playback, track routing, master compression |
| **Scheduler** | `scheduler.ts` | Drift-free lookahead scheduling (25ms timer, 100ms lookahead) |
| **Samples** | `samples.ts` | 16 procedurally-generated drum/synth samples |

**Signal Chain:**
```
Source (Oscillator/Sample)
    → Envelope Gain
    → Track Gain
    → Master Gain
    → Compressor
    → Destination
```

### 1.2 Current Capabilities

| Feature | Status | Notes |
|---------|--------|-------|
| Basic oscillators | ✅ | sine, triangle, sawtooth, square |
| ADSR envelope | ✅ | Single envelope per voice |
| Lowpass filter | ✅ | With resonance (Q) control |
| 19 synth presets | ✅ | bass, lead, pad, pluck, acid, rhodes, etc. |
| 16 procedural samples | ✅ | kick, snare, hihat, clap, etc. |
| Polymetric sequencing | ✅ | Per-track step counts (4-64) |
| Swing | ✅ | Global 0-100% |
| Pitch shifting | ✅ | Via playback rate (semitones) |
| Parameter locks | ✅ | Per-step pitch and volume |
| Master compression | ✅ | Prevents clipping |

### 1.3 Current Limitations

| Limitation | Impact |
|------------|--------|
| **Single oscillator** | No detuning, layering, or harmonic richness |
| **No filter envelope** | Can't shape brightness over time |
| **No LFO** | No vibrato, tremolo, or filter sweeps |
| **No effects** | No reverb, delay, chorus, distortion |
| **No sampled instruments** | Can't reproduce acoustic piano, strings |
| **No velocity sensitivity** | All notes play at same intensity |
| **Monophonic synth presets** | PolySynth wrapper not utilized |
| **Fixed filter type** | Only lowpass available |

---

## 2. Requirements

### 2.1 Synthesis Features (from Roadmap Phase 25)

#### 2.1.1 Dual Oscillator Architecture

```typescript
interface OscillatorConfig {
  waveform: 'sine' | 'sawtooth' | 'square' | 'triangle';
  level: number;           // 0 to 1 (mix between oscillators)
  detune: number;          // Cents (-100 to +100)
  coarseDetune: number;    // Semitones (-24 to +24)
  noise: number;           // 0 to 1 (noise mix)
}
```

**New sounds enabled:**
- Detuned supersaw (trance/EDM)
- Layered octaves (full pads)
- PWM-style thickness
- Sub-oscillator bass

#### 2.1.2 Filter Modulation

```typescript
interface FilterConfig {
  frequency: number;       // 20 to 20000 Hz
  resonance: number;       // 0 to 30 (Q factor)
  type: 'lowpass' | 'highpass' | 'bandpass';
  envelopeAmount: number;  // -1 to 1 (envelope → cutoff)
  lfoAmount: number;       // 0 to 1 (LFO → cutoff)
}

interface FilterEnvelope {
  attack: number;    // 0.001 to 2s
  decay: number;     // 0.001 to 2s
  sustain: number;   // 0 to 1
  release: number;   // 0.001 to 4s
}
```

#### 2.1.3 LFO System

```typescript
interface LFOConfig {
  frequency: number;       // 0.1 to 20 Hz
  waveform: 'sine' | 'sawtooth' | 'square' | 'triangle';
  destination: 'filter' | 'pitch' | 'amplitude';
  amount: number;          // 0 to 1
  sync: boolean;           // Sync to transport tempo
}
```

**New sounds enabled:**
- Vibrato (LFO → pitch at 5-7 Hz)
- Tremolo (LFO → amplitude at 4-8 Hz)
- Filter sweeps (LFO → filter)
- Wobble bass (LFO → filter at 1-4 Hz)

#### 2.1.4 Complete Synth Preset Model

```typescript
interface SynthPreset {
  name: string;
  oscillators: [OscillatorConfig, OscillatorConfig];
  amplitudeEnvelope: ADSREnvelope;
  filter: FilterConfig;
  filterEnvelope: ADSREnvelope;
  lfo: LFOConfig;
}
```

### 2.2 Effects (from Roadmap Phase 25)

> ⚠️ **CRITICAL:** Effects must be synchronized across multiplayer sessions. All effect parameters must be stored in session state and broadcast via WebSocket.

#### 2.2.1 Required Effects

| Effect | Priority | Parameters | Use Case |
|--------|----------|------------|----------|
| **Reverb** | High | type, decay, mix | Space, depth |
| **Delay** | High | time, feedback, mix | Rhythmic interest |
| **Chorus** | Medium | rate, depth, mix | Stereo width, warmth |
| **Distortion** | Medium | amount, mix | Grit, edge |
| **Compressor** | Low | Already exists | Dynamics control |

#### 2.2.2 Effect Architecture

```typescript
interface EffectsChain {
  reverb?: {
    type: 'room' | 'hall' | 'plate';
    decay: number;       // 0.1 to 10s
    mix: number;         // 0 to 1
  };
  delay?: {
    time: number;        // ms or beat-synced ("8n")
    feedback: number;    // 0 to 0.95
    mix: number;         // 0 to 1
  };
  chorus?: {
    rate: number;        // 0.1 to 10 Hz
    depth: number;       // 0 to 1
    mix: number;         // 0 to 1
  };
  distortion?: {
    amount: number;      // 0 to 1
    mix: number;         // 0 to 1
  };
}
```

#### 2.2.3 Multiplayer Sync Requirements

Effects must be:
1. Stored in `SessionState` (persisted to KV)
2. Broadcast via WebSocket on change
3. Validated server-side
4. Applied identically on all clients

### 2.3 Sampled Instruments (from Roadmap Phase 25)

#### 2.3.1 Requirements

| Requirement | Specification |
|-------------|---------------|
| Storage | R2 bucket (`keyboardia-samples/instruments/`) |
| Formats | MP3 (compressed) or WAV (quality) |
| Multi-sampling | 1 sample per octave minimum |
| Pitch shifting | Fill gaps between sampled notes |
| Lazy loading | Load on first use |
| Size budget | ~500KB-2MB per instrument |

#### 2.3.2 Initial Instruments

| Instrument | Priority | Samples Needed | Estimated Size |
|------------|----------|----------------|----------------|
| **Piano** | High | C2, C3, C4, C5 | ~800KB |
| **Strings** | Medium | C2, C3, C4, C5 | ~1MB |
| **Brass** | Medium | C3, C4, C5 | ~600KB |
| **Electric Piano** | Medium | C3, C4, C5 | ~500KB |

#### 2.3.3 Sample Manifest Format

```typescript
interface InstrumentManifest {
  name: string;
  samples: {
    note: string;        // "C4", "G#3", etc.
    url: string;         // R2 URL
    loopStart?: number;  // For sustaining instruments
    loopEnd?: number;
  }[];
  envelope?: ADSREnvelope;
  defaultVelocity?: number;
}
```

### 2.4 XY Pad / Macro Controls (from Roadmap Phase 25)

```typescript
interface XYPadMapping {
  parameter: 'filterFrequency' | 'filterResonance' | 'lfoRate' | 'lfoAmount' | 'oscMix' | 'attack' | 'release';
  axis: 'x' | 'y';
  min: number;
  max: number;
  curve: 'linear' | 'exponential';
}

interface XYPad {
  mappings: XYPadMapping[];
  x: number;  // 0 to 1
  y: number;  // 0 to 1
}
```

### 2.5 FM Synthesis (from Roadmap Phase 25)

```typescript
interface FMPreset {
  carriers: OscillatorConfig[];
  modulators: {
    target: number;      // Which carrier to modulate
    ratio: number;       // Frequency ratio
    depth: number;       // Modulation amount
    envelope: ADSREnvelope;
  }[];
}
```

**Sounds enabled:** Electric piano (DX7-style), bells, metallic percussion

---

## 3. Tone.js Analysis

### 3.1 Overview

[Tone.js](https://tonejs.github.io/) is a Web Audio framework for creating interactive music in the browser. It provides DAW-like features including:

- Global transport for synchronization
- Prebuilt synthesizers and effects
- High-performance building blocks
- Musical time notation ("4n", "8t", "1m")

### 3.2 Available Synthesizers

| Synth | Description | Polyphonic | Maps To |
|-------|-------------|------------|---------|
| **Synth** | Single oscillator + ADSR | No | Basic tones |
| **MonoSynth** | Oscillator + filter + envelopes | No | Lead, bass |
| **DuoSynth** | Two MonoSynths in parallel | No | Rich leads |
| **FMSynth** | Frequency modulation | No | Bells, e-piano |
| **AMSynth** | Amplitude modulation | No | Tremolo tones |
| **MembraneSynth** | Frequency sweep | No | Kicks, toms |
| **MetalSynth** | 6 FM oscillators | No | Cymbals, metallic |
| **NoiseSynth** | Filtered noise | No | Hi-hats, snares |
| **PluckSynth** | Karplus-Strong | No | Plucked strings |
| **PolySynth** | Wrapper for polyphony | Yes | Chords, pads |
| **Sampler** | Note-mapped samples | Yes | Piano, instruments |

### 3.3 Available Effects

| Effect | Description | Parameters |
|--------|-------------|------------|
| **Reverb** | Convolution reverb | decay, preDelay, wet |
| **Freeverb** | Algorithmic reverb | roomSize, dampening, wet |
| **JCReverb** | Simple reverb | roomSize |
| **FeedbackDelay** | Delay with feedback | delayTime, feedback, wet |
| **PingPongDelay** | Stereo ping-pong | delayTime, feedback, wet |
| **Chorus** | Chorus effect | frequency, delayTime, depth, wet |
| **Phaser** | Phaser effect | frequency, octaves, baseFrequency |
| **Tremolo** | Amplitude modulation | frequency, depth, wet |
| **Vibrato** | Pitch modulation | frequency, depth, wet |
| **Distortion** | Waveshaping distortion | distortion, wet |
| **BitCrusher** | Bit depth reduction | bits |
| **Chebyshev** | Harmonic distortion | order |
| **AutoFilter** | LFO-controlled filter | frequency, baseFrequency, octaves |
| **AutoPanner** | LFO-controlled pan | frequency, depth |
| **AutoWah** | Envelope follower wah | baseFrequency, octaves, sensitivity |
| **PitchShift** | Pitch without speed change | pitch, windowSize, wet |
| **StereoWidener** | Stereo enhancement | width |
| **Compressor** | Dynamics compression | threshold, ratio, attack, release |
| **Limiter** | Hard limiting | threshold |
| **Gate** | Noise gate | threshold, attack, release |
| **EQ3** | 3-band EQ | low, mid, high |

### 3.4 Transport & Scheduling

```javascript
// Musical time notation
Tone.Transport.bpm.value = 120;
Tone.Transport.start();

// Schedule events
Tone.Transport.schedule((time) => {
  synth.triggerAttackRelease("C4", "8n", time);
}, "0:0:0");

// Looping
const loop = new Tone.Loop((time) => {
  // Called every quarter note
}, "4n").start(0);

// Tempo ramping
Tone.Transport.bpm.rampTo(140, 4); // Ramp to 140 BPM over 4 seconds
```

### 3.5 Sample Playback

```javascript
// Sampler - automatic pitch shifting
const piano = new Tone.Sampler({
  urls: {
    C4: "C4.mp3",
    "D#4": "Ds4.mp3",
    "F#4": "Fs4.mp3",
    A4: "A4.mp3",
  },
  baseUrl: "https://r2.example.com/piano/",
  onload: () => console.log("Piano loaded")
}).toDestination();

piano.triggerAttackRelease("E4", "8n"); // Automatically repitched from nearest sample

// Player - direct playback
const player = new Tone.Player("kick.mp3").toDestination();
player.start();
```

### 3.6 LFO & Modulation

```javascript
// LFO
const lfo = new Tone.LFO({
  frequency: 4,
  min: 200,
  max: 4000
}).start();

// Connect to filter
lfo.connect(filter.frequency);

// AutoFilter (built-in LFO → filter)
const autoFilter = new Tone.AutoFilter("4n").toDestination().start();
synth.connect(autoFilter);
```

### 3.7 Bundle Size

| Metric | Value | Notes |
|--------|-------|-------|
| **Unpacked** | ~2.8 MB | Full source |
| **Minified** | ~400-500 KB | Full library |
| **Gzipped** | ~100-120 KB | Compressed transfer |
| **Tree-shaken** | ~50-200 KB | Depends on imports |

**Tree-shaking:** Tone.js supports tree-shaking. Importing individual modules reduces bundle size significantly.

```javascript
// Full import (~400KB minified)
import * as Tone from "tone";

// Selective import (~50-100KB depending on usage)
import { Synth, FeedbackDelay, Reverb } from "tone";
```

### 3.8 Browser Compatibility

- **Chrome**: ✅ Full support
- **Firefox**: ✅ Full support
- **Safari**: ✅ (requires user gesture for AudioContext)
- **Edge**: ✅ Full support
- **iOS Safari**: ✅ (requires user gesture)
- **Chrome Android**: ✅ (may need resume on visibility change)

Uses `standardized-audio-context` shim for maximum compatibility.

### 3.9 Known Limitations

| Limitation | Workaround |
|------------|------------|
| Requires user gesture | Already handled in Keyboardia |
| BPM changes can affect scheduled events | Use `Tone.now()` for immediate scheduling |
| Reverb is async (IR generation) | Await `reverb.ready` promise |
| No MIDI file playback | Convert to JSON first |

---

## 4. Implementation Options

### Option A: Extend Current Implementation

Build new features on top of existing raw Web Audio API code.

**Effort Estimate:**

| Feature | Effort | Complexity |
|---------|--------|------------|
| Dual oscillator | 2-3 days | Medium |
| Filter envelope | 1-2 days | Low |
| LFO system | 2-3 days | Medium |
| Reverb (ConvolverNode) | 2-3 days | Medium |
| Delay (DelayNode) | 1-2 days | Low |
| Chorus | 2-3 days | Medium |
| Sampler with pitch shifting | 3-5 days | High |
| FM synthesis | 3-5 days | High |
| **Total** | **16-26 days** | — |

**Pros:**
- No new dependencies
- Full control over implementation
- No bundle size increase
- Existing patterns maintained

**Cons:**
- Significant development time
- Must handle edge cases ourselves
- No battle-tested abstractions
- Higher maintenance burden

### Option B: Adopt Tone.js (Full Replacement)

Replace all audio code with Tone.js.

**Effort Estimate:**

| Task | Effort | Complexity |
|------|--------|------------|
| Learn Tone.js API | 2-3 days | — |
| Replace SynthEngine | 2-3 days | Medium |
| Replace AudioEngine | 2-3 days | Medium |
| Replace Scheduler | 3-5 days | High |
| Adapt multiplayer sync | 2-3 days | Medium |
| Add new synth types | 1-2 days | Low |
| Add effects | 1-2 days | Low |
| Add sampler | 1 day | Low |
| Testing & debugging | 3-5 days | — |
| **Total** | **17-26 days** | — |

**Pros:**
- Rich built-in synths (FM, AM, Membrane, Metal, etc.)
- Full effects suite out of the box
- Battle-tested, well-documented
- Musical time notation ("4n", "8t")
- Built-in Sampler with auto-pitch-shifting
- Active community and maintenance

**Cons:**
- +100-120KB gzipped bundle size
- Learning curve for team
- Must adapt existing patterns
- Transport may conflict with custom scheduler
- Loss of fine-grained control

### Option C: Hybrid Approach

Keep existing scheduler and sample playback. Use Tone.js for:
- Advanced synth types (FMSynth, DuoSynth)
- Effects chain
- Sampler

**Effort Estimate:**

| Task | Effort | Complexity |
|------|--------|------------|
| Integrate Tone.js synths | 2-3 days | Medium |
| Integrate Tone.js effects | 1-2 days | Low |
| Integrate Tone.js Sampler | 1-2 days | Low |
| Wire to existing scheduler | 2-3 days | Medium |
| Multiplayer sync for new features | 2-3 days | Medium |
| Testing | 2-3 days | — |
| **Total** | **10-16 days** | — |

**Pros:**
- Faster path to new features
- Keep battle-tested scheduler
- Incremental adoption
- Can cherry-pick Tone.js features
- Smaller bundle if tree-shaken

**Cons:**
- Two audio paradigms in codebase
- Potential timing conflicts
- More complex architecture
- May not fully utilize Tone.js Transport

---

## 5. Migration Analysis

### 5.1 What Changes with Tone.js Adoption

#### 5.1.1 Scheduler Changes

| Current | Tone.js | Implication |
|---------|---------|-------------|
| Custom lookahead scheduler | `Tone.Transport` | Different scheduling model |
| `setInterval` + AudioContext time | `Tone.Loop`, `scheduleRepeat` | Must migrate all scheduling |
| Manual drift correction | Built-in | Simplifies code |
| Polymetric via `%` | Must implement manually | Transport doesn't natively support |

**Critical:** Our polymetric sequencing (tracks with different step counts) is not natively supported by Tone.Transport. We would need to either:
1. Keep our scheduler and use Tone.js only for synthesis/effects
2. Implement polymetric logic on top of Transport

#### 5.1.2 Synthesis Changes

| Current | Tone.js | Benefit |
|---------|---------|---------|
| `SynthVoice` class | `Tone.Synth`, `Tone.MonoSynth` | More presets, less code |
| Manual oscillator setup | Declarative config | Cleaner code |
| Single oscillator | `DuoSynth`, `FMSynth`, etc. | Rich sounds |
| Manual ADSR | `Tone.Envelope` | Built-in curves |

#### 5.1.3 Sample Playback Changes

| Current | Tone.js | Benefit |
|---------|---------|---------|
| Manual BufferSource | `Tone.Player` | Simpler API |
| Manual pitch via playbackRate | `Tone.Sampler` auto-pitch | Multi-sampled instruments |
| Custom sample loading | `Tone.Buffer` | Progress callbacks |

#### 5.1.4 Effects

| Current | Tone.js | Benefit |
|---------|---------|---------|
| Only compression | Full effect suite | Reverb, delay, chorus, etc. |
| Manual node wiring | `.connect()` chaining | Cleaner routing |

### 5.2 Multiplayer Sync Implications

Both the current implementation and Tone.js require the same multiplayer sync approach:

1. **State in KV:** Store synth/effect parameters in session state
2. **WebSocket broadcast:** Send parameter changes to all clients
3. **Server validation:** Validate bounds before applying
4. **Deterministic playback:** Same inputs → same audio

Tone.js does NOT automatically handle multiplayer sync. We must implement the same patterns regardless of which option we choose.

### 5.3 Bundle Size Impact

| Scenario | Current | With Tone.js | Delta |
|----------|---------|--------------|-------|
| **Current bundle** | ~250KB gzipped | — | — |
| **Full Tone.js** | — | ~370KB gzipped | +120KB |
| **Tree-shaken** | — | ~300-320KB | +50-70KB |

Impact: ~0.3-0.5 seconds additional load time on 3G.

### 5.4 Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Timing conflicts between scheduler and Transport | Medium | High | Use hybrid approach or full migration |
| Bundle size affects mobile UX | Low | Medium | Tree-shake aggressively |
| Learning curve delays delivery | Medium | Medium | Spike first, document patterns |
| Tone.js bugs affect stability | Low | Medium | Pin version, test thoroughly |
| Polymetric breaks with Transport | High | High | Keep custom scheduler |

---

## 6. Recommendations

### 6.1 Recommended Approach: Option C (Hybrid)

**Rationale:**
1. Our custom scheduler is battle-tested and supports polymetric sequencing natively
2. Tone.js Transport doesn't support polymetric without custom work
3. We can incrementally adopt Tone.js features without full rewrite
4. Lower risk, faster delivery

### 6.2 Implementation Plan

#### Phase 1: Add Tone.js Effects (1-2 days)

Add global effects bus using Tone.js:

```typescript
import { Reverb, FeedbackDelay, Chorus } from "tone";

// Create effects
const reverb = new Reverb({ decay: 2, wet: 0.3 });
const delay = new FeedbackDelay({ delayTime: "8n", feedback: 0.3, wet: 0.2 });

// Connect master output through effects
masterGain.connect(reverb);
reverb.connect(delay);
delay.toDestination();
```

**Multiplayer sync:** Add `effects` to `SessionState`, broadcast on change.

#### Phase 2: Add Tone.js Sampler (1-2 days)

Replace manual pitch-shifting with Tone.Sampler:

```typescript
import { Sampler } from "tone";

const piano = new Sampler({
  urls: {
    C2: "C2.mp3",
    C3: "C3.mp3",
    C4: "C4.mp3",
    C5: "C5.mp3",
  },
  baseUrl: "/api/samples/piano/",
});

// In scheduler, trigger notes
piano.triggerAttackRelease(note, duration, time);
```

#### Phase 3: Add Advanced Synths (2-3 days)

Add Tone.js synth types as new presets:

```typescript
import { FMSynth, DuoSynth, MembraneSynth, MetalSynth } from "tone";

const synthTypes = {
  'fm-epiano': new FMSynth({ /* DX7-style config */ }),
  'duo-lead': new DuoSynth({ /* rich lead config */ }),
  'membrane-kick': new MembraneSynth({ /* 808-style config */ }),
  'metal-cymbal': new MetalSynth({ /* cymbal config */ }),
};
```

#### Phase 4: Enhance Existing Synths (2-3 days)

Add dual oscillator and LFO to our existing SynthEngine:
- Could use Tone.js `Oscillator` and `LFO` components
- Or implement natively for full control

### 6.3 What to Keep vs Replace

| Component | Keep | Replace | Notes |
|-----------|------|---------|-------|
| **Scheduler** | ✅ | | Polymetric support, battle-tested |
| **SynthEngine (basic)** | ✅ | | Works well, 19 presets |
| **AudioEngine (samples)** | ✅ | | Procedural samples work |
| **Effects** | | ✅ Tone.js | Major capability gap |
| **Sampler (instruments)** | | ✅ Tone.js | Auto pitch-shifting |
| **FM/AM Synths** | | ✅ Tone.js | Complex to implement |
| **Master routing** | Hybrid | | Keep master, add effects |

### 6.4 Success Criteria

- [ ] Reverb and delay effects work in multiplayer (synced)
- [ ] Piano sampler plays full 4-octave range from 4 samples
- [ ] FM synth preset sounds like DX7 electric piano
- [ ] Bundle size increase < 80KB gzipped
- [ ] No timing drift introduced
- [ ] All 443 existing tests pass
- [ ] New features have tests

### 6.5 Timeline Estimate

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Effects integration | 2 days | Reverb + Delay in multiplayer |
| Sampler integration | 2 days | Piano instrument |
| Advanced synths | 3 days | FM, DuoSynth presets |
| Testing & polish | 2 days | Stability, edge cases |
| **Total** | **9 days** | Full feature set |

---

## Appendix A: Tone.js Integration Code Sketch

```typescript
// src/audio/toneEffects.ts
import { Reverb, FeedbackDelay, Chorus, getDestination, connect } from "tone";

export interface EffectsState {
  reverb: { decay: number; wet: number };
  delay: { time: string; feedback: number; wet: number };
  chorus: { frequency: number; depth: number; wet: number };
}

export class ToneEffectsChain {
  private reverb: Reverb;
  private delay: FeedbackDelay;
  private chorus: Chorus;

  constructor() {
    this.reverb = new Reverb({ decay: 2, wet: 0 });
    this.delay = new FeedbackDelay({ delayTime: "8n", feedback: 0.3, wet: 0 });
    this.chorus = new Chorus({ frequency: 1.5, depth: 0.5, wet: 0 });

    // Chain: input → chorus → delay → reverb → destination
    this.chorus.connect(this.delay);
    this.delay.connect(this.reverb);
    this.reverb.toDestination();
  }

  get input() {
    return this.chorus;
  }

  setReverbWet(wet: number) {
    this.reverb.wet.value = wet;
  }

  setDelayWet(wet: number) {
    this.delay.wet.value = wet;
  }

  // ... other setters

  applyState(state: EffectsState) {
    this.reverb.decay = state.reverb.decay;
    this.reverb.wet.value = state.reverb.wet;
    this.delay.delayTime.value = state.delay.time;
    this.delay.feedback.value = state.delay.feedback;
    this.delay.wet.value = state.delay.wet;
    // ...
  }
}
```

---

## Appendix B: Session State Changes

```typescript
// Addition to GridState
interface GridState {
  // ... existing fields

  effects: {
    reverb: { decay: number; wet: number };
    delay: { time: string; feedback: number; wet: number };
    chorus: { frequency: number; depth: number; wet: number };
  };
}

// New WebSocket message types
type EffectsMessage =
  | { type: 'set_reverb'; decay?: number; wet?: number }
  | { type: 'set_delay'; time?: string; feedback?: number; wet?: number }
  | { type: 'set_chorus'; frequency?: number; depth?: number; wet?: number };
```

---

## Appendix C: Sources

- [Tone.js Official Site](https://tonejs.github.io/)
- [Tone.js GitHub](https://github.com/Tonejs/Tone.js/)
- [Tone.js Transport Wiki](https://github.com/Tonejs/Tone.js/wiki/Transport)
- [Tone.js Effects Wiki](https://github.com/Tonejs/Tone.js/wiki/Effects)
- [Tone.js Performance Wiki](https://github.com/Tonejs/Tone.js/wiki/Performance)
- [Bundlephobia](https://bundlephobia.com/package/tone)
