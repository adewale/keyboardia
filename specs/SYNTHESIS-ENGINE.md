# Advanced Synthesis Engine Specification

> **Status:** In Progress
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
7. [Tone.js Best Practices](#7-tonejs-best-practices)
8. [Verification Sessions](#8-verification-sessions)
9. [User Interface Requirements](#9-user-interface-requirements) ← **NEW: Critical for feature completion**

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

- [x] Reverb, delay, chorus, and distortion effects work in multiplayer (synced)
- [ ] Piano sampler plays full 4-octave range from 4 samples
- [x] FM synth presets (fm-epiano, fm-bass, fm-bell) implemented
- [ ] Bundle size increase < 80KB gzipped
- [x] No timing drift introduced
- [x] All 601 tests pass (was 443, added 158 new tests)
- [x] New features have tests (60 tests for Tone.js integration)

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

## 7. Tone.js Best Practices

### 7.1 Audio Context Initialization

```typescript
// CORRECT: Start Tone.js after user gesture
document.querySelector('button').addEventListener('click', async () => {
  await Tone.start();
  console.log('Audio context started, state:', Tone.context.state);
});

// WRONG: Don't call Tone.start() on page load
// The AudioContext will be suspended and audio won't play
```

**Integration with Keyboardia:** Our existing `audioEngine.initialize()` already handles user gesture requirements. When integrating Tone.js, call `Tone.start()` inside the same handler.

### 7.2 Performance Optimization

#### 7.2.1 Latency Configuration

```typescript
// For interactive applications (default)
Tone.setContext(new Tone.Context({ latencyHint: "interactive" }));

// For sustained playback (better stability, higher latency)
Tone.setContext(new Tone.Context({ latencyHint: "playback" }));

// Custom lookahead (default is 0.1 seconds)
Tone.context.lookAhead = 0.05; // 50ms for lower latency
```

**Recommendation:** Use `"interactive"` for step sequencer responsiveness.

#### 7.2.2 Scheduling Best Practices

```typescript
// CORRECT: Schedule slightly in the future to avoid artifacts
Tone.Transport.start("+0.1"); // Start 100ms in the future

// CORRECT: Trigger synths with a small offset
synth.triggerAttackRelease("C4", "8n", Tone.now() + 0.05);

// WRONG: Immediate triggers can cause pops
synth.triggerAttackRelease("C4", "8n"); // May cause click
```

#### 7.2.3 CPU-Intensive Nodes

| Node | CPU Cost | Recommendation |
|------|----------|----------------|
| **ConvolverNode** (Reverb) | High | Use Freeverb for real-time, Reverb for quality |
| **PannerNode (HRTF)** | High | Use stereo panning instead |
| **Multiple oscillators** | Medium | Limit polyphony (Keyboardia: 16 voices max) |
| **AutoFilter/AutoWah** | Medium | Use sparingly |

#### 7.2.4 Visual Synchronization

```typescript
// WRONG: DOM manipulation in audio callback
Tone.Transport.scheduleRepeat((time) => {
  document.querySelector('.step').classList.add('active'); // BAD
}, "16n");

// CORRECT: Use Tone.Draw for visuals
Tone.Transport.scheduleRepeat((time) => {
  Tone.Draw.schedule(() => {
    document.querySelector('.step').classList.add('active');
  }, time);
}, "16n");
```

**Note:** Keyboardia uses its own scheduler with `requestAnimationFrame` for UI updates, which is equivalent.

### 7.3 Memory Management

#### 7.3.1 Disposal Pattern

```typescript
// ALWAYS dispose Tone.js objects when done
const synth = new Tone.Synth().toDestination();
// ... use synth ...
synth.dispose(); // Free memory

// For effects chain
const reverb = new Tone.Reverb();
const delay = new Tone.FeedbackDelay();
// ... use effects ...
reverb.dispose();
delay.dispose();
```

#### 7.3.2 Singleton Pattern for Effects

```typescript
// CORRECT: Create effects once, reuse
class ToneEffectsChain {
  private reverb: Reverb | null = null;

  async initialize() {
    this.reverb = new Reverb({ decay: 2 });
    await this.reverb.ready; // Wait for IR generation
  }

  dispose() {
    this.reverb?.dispose();
    this.reverb = null;
  }
}

// WRONG: Creating new effects per note
function playNote() {
  const reverb = new Reverb(); // Memory leak!
  synth.connect(reverb);
}
```

#### 7.3.3 Noise Buffer Consideration

Tone.js pre-allocates ~5MB for noise buffers (white, pink, brown). If not using NoiseSynth, this memory is wasted but unavoidable with full Tone.js import.

**Mitigation:** Use selective imports to avoid loading unused modules.

### 7.4 iOS/Safari Considerations

```typescript
// iOS Safari may require additional unlock
const unlockAudio = async () => {
  await Tone.start();

  // Additional iOS workaround: play silent buffer
  const buffer = Tone.context.createBuffer(1, 1, 22050);
  const source = Tone.context.createBufferSource();
  source.buffer = buffer;
  source.connect(Tone.context.destination);
  source.start(0);
};

// Attach to user gesture
document.addEventListener('touchstart', unlockAudio, { once: true });
```

**Safari-specific:**
- Maximum 4 AudioContext instances per page
- Ringer switch mutes Web Audio (device must be unmuted)
- iOS 15+ may require `<audio>` element playback first

### 7.5 Reverb Async Handling

```typescript
// Reverb generates impulse response asynchronously
const reverb = new Tone.Reverb({ decay: 2 });

// WRONG: Use immediately (IR may not be ready)
synth.connect(reverb);

// CORRECT: Wait for ready
await reverb.ready;
synth.connect(reverb);

// Or use Freeverb (no async generation)
const freeverb = new Tone.Freeverb(); // Ready immediately
```

### 7.6 Integration Pattern for Hybrid Approach

```typescript
// Pattern: Connect existing AudioEngine to Tone.js effects
class HybridAudioEngine {
  private toneEffects: ToneEffectsChain | null = null;
  private audioContext: AudioContext | null = null;

  async initialize() {
    // 1. Start Tone.js first (shares AudioContext)
    await Tone.start();

    // 2. Use Tone's context for our audio
    this.audioContext = Tone.context.rawContext as AudioContext;

    // 3. Initialize effects
    this.toneEffects = new ToneEffectsChain();
    await this.toneEffects.initialize();

    // 4. Connect our master gain to Tone effects input
    this.masterGain.connect(this.toneEffects.input);
  }
}
```

---

## 8. Verification Sessions

### 8.1 Test Session: Effects Chain

**Purpose:** Verify reverb, delay, and chorus work correctly and sync across multiplayer.

**Session Configuration:**
```typescript
const effectsTestSession = {
  name: "Effects Test Session",
  tracks: [
    { sampleId: "kick", steps: [true, false, false, false, true, false, false, false, ...] },
    { sampleId: "synth:lead", steps: [false, false, true, false, false, false, true, false, ...] },
  ],
  tempo: 120,
  swing: 0,
  effects: {
    reverb: { decay: 2.5, wet: 0.4 },
    delay: { time: "8n", feedback: 0.3, wet: 0.25 },
    chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  },
};
```

**Verification Checklist:**
- [ ] Reverb adds audible space to dry signal
- [ ] Delay creates rhythmic echoes at 8th-note intervals
- [ ] Wet = 0 produces dry signal only
- [ ] Wet = 1 produces fully wet signal
- [ ] Changing reverb decay in one client updates all clients
- [ ] Effects persist after page refresh
- [ ] Effects work on mobile Safari/Chrome

**Automated Tests:**
```typescript
describe('ToneEffectsChain', () => {
  it('initializes with reverb ready', async () => {
    const chain = new ToneEffectsChain();
    await chain.initialize();
    expect(chain.isReady()).toBe(true);
  });

  it('applies reverb wet correctly', () => {
    chain.setReverbWet(0.5);
    expect(chain.getState().reverb.wet).toBe(0.5);
  });

  it('serializes state for multiplayer sync', () => {
    const state = chain.getState();
    expect(state).toMatchObject({
      reverb: { decay: expect.any(Number), wet: expect.any(Number) },
      delay: { time: expect.any(String), feedback: expect.any(Number), wet: expect.any(Number) },
    });
  });
});
```

### 8.2 Test Session: Sampled Piano

**Purpose:** Verify Tone.Sampler plays piano across 4 octaves with correct pitch.

**Session Configuration:**
```typescript
const pianoTestSession = {
  name: "Piano Test Session",
  tracks: [
    {
      sampleId: "sampler:piano",
      steps: [true, false, true, false, true, false, true, false, ...],
      parameterLocks: [
        { pitch: -12 }, // C3
        null,
        { pitch: 0 },   // C4
        null,
        { pitch: 12 },  // C5
        null,
        { pitch: 24 },  // C6
        null,
      ],
    },
  ],
  tempo: 90, // Slower to hear pitch clearly
  swing: 0,
};
```

**Verification Checklist:**
- [ ] All 4 octaves are audible and correctly pitched
- [ ] Intermediate notes (D4, E4, F#4) are repitched from nearest sample
- [ ] No audible artifacts from pitch shifting
- [ ] Sampler loads lazily (not on page load)
- [ ] Loading indicator shown while samples load
- [ ] Works offline after initial load (samples cached)

**Automated Tests:**
```typescript
describe('ToneSampler', () => {
  it('loads piano samples from R2', async () => {
    const sampler = new ToneSamplerInstrument('piano');
    await sampler.load();
    expect(sampler.isLoaded()).toBe(true);
  });

  it('plays correct frequency for C4', () => {
    const freq = sampler.noteToFrequency('C4');
    expect(freq).toBeCloseTo(261.63, 1);
  });

  it('repitches D4 from C4 sample', () => {
    // D4 is 2 semitones above C4
    const playbackRate = sampler.getPlaybackRate('D4');
    expect(playbackRate).toBeCloseTo(Math.pow(2, 2/12), 3);
  });
});
```

### 8.3 Test Session: FM Synth (Electric Piano)

**Purpose:** Verify FMSynth produces DX7-style electric piano sound.

**Session Configuration:**
```typescript
const fmTestSession = {
  name: "FM E-Piano Test",
  tracks: [
    {
      sampleId: "synth:fm-epiano",
      steps: [true, false, false, true, false, false, true, false, ...],
      parameterLocks: [
        { pitch: 0 },
        null,
        null,
        { pitch: 4 }, // E
        null,
        null,
        { pitch: 7 }, // G
        null,
      ],
    },
  ],
  tempo: 100,
  swing: 15,
};
```

**Verification Checklist:**
- [ ] Sound has characteristic FM "bell" attack
- [ ] Tone is bright with harmonic complexity
- [ ] Envelope has percussive attack, medium decay
- [ ] Sounds similar to DX7 Rhodes preset
- [ ] No aliasing or digital artifacts
- [ ] Works at all pitch values (-24 to +24)

**Audio Reference:** Compare to [Ableton Learning Synths FM examples](https://learningsynths.ableton.com/)

**Automated Tests:**
```typescript
describe('ToneFMSynth presets', () => {
  it('has fm-epiano preset with correct harmonicity', () => {
    const preset = TONE_SYNTH_PRESETS['fm-epiano'];
    expect(preset.harmonicity).toBeGreaterThan(1);
    expect(preset.modulationIndex).toBeGreaterThan(5);
  });

  it('produces sound within 100ms of trigger', async () => {
    const output = await measureAudioOutput(() => {
      fmSynth.triggerAttackRelease('C4', '8n');
    });
    expect(output.firstSoundAt).toBeLessThan(0.1);
  });
});
```

### 8.4 Test Session: Polymetric with Effects

**Purpose:** Verify effects work correctly with polymetric sequencing.

**Session Configuration:**
```typescript
const polymetricEffectsSession = {
  name: "Polymetric + Effects",
  tracks: [
    { sampleId: "kick", stepCount: 4, steps: [true, false, false, false] },
    { sampleId: "hihat", stepCount: 8, steps: [true, true, true, true, true, true, true, true] },
    { sampleId: "synth:pad", stepCount: 16, steps: [true, ...Array(15).fill(false)] },
  ],
  tempo: 120,
  swing: 0,
  effects: {
    reverb: { decay: 3, wet: 0.6 },
    delay: { time: "4n", feedback: 0.4, wet: 0.3 },
    chorus: { frequency: 0.5, depth: 0.7, wet: 0.2 },
  },
};
```

**Verification Checklist:**
- [ ] Kick loops every beat (4 steps)
- [ ] Hi-hat loops every half bar (8 steps)
- [ ] Pad plays once per bar (16 steps)
- [ ] All tracks pass through effects chain
- [ ] No timing drift after 1 minute
- [ ] Pattern phases correctly over multiple bars

### 8.5 Test Session: Multiplayer Sync

**Purpose:** Verify two clients hear identical audio with effects.

**Test Procedure:**
1. Client A creates session with effects (reverb wet = 0.5)
2. Client B joins session
3. Verify Client B loads with reverb wet = 0.5
4. Client A changes reverb wet to 0.8
5. Verify Client B updates within 100ms
6. Both clients start playback
7. Record audio from both clients
8. Compare waveforms (should be identical within tolerance)

**Automated Tests:**
```typescript
describe('Multiplayer effects sync', () => {
  it('broadcasts effect changes to all clients', async () => {
    const clientA = await connectToSession(sessionId);
    const clientB = await connectToSession(sessionId);

    clientA.send({ type: 'set_reverb', wet: 0.8 });

    await waitFor(() => {
      expect(clientB.state.effects.reverb.wet).toBe(0.8);
    });
  });

  it('applies effects identically on all clients', async () => {
    // This requires audio comparison testing
    const audioA = await recordAudio(clientA, 2000);
    const audioB = await recordAudio(clientB, 2000);

    expect(compareWaveforms(audioA, audioB)).toBeLessThan(0.01);
  });
});
```

### 8.6 Test Session: Mobile Performance

**Purpose:** Verify effects don't cause performance issues on mobile.

**Test Devices:**
- iPhone 12 (Safari)
- iPhone SE (Safari)
- Pixel 6 (Chrome)
- Samsung Galaxy S21 (Chrome)

**Session Configuration:**
```typescript
const mobileStressTest = {
  name: "Mobile Stress Test",
  tracks: Array(8).fill(null).map((_, i) => ({
    sampleId: i < 4 ? ['kick', 'snare', 'hihat', 'clap'][i] : `synth:${['bass', 'lead', 'pad', 'pluck'][i-4]}`,
    stepCount: 16,
    steps: Array(16).fill(true), // All steps active
  })),
  tempo: 140, // Fast tempo
  effects: {
    reverb: { decay: 2, wet: 0.5 },
    delay: { time: "16n", feedback: 0.5, wet: 0.4 },
    chorus: { frequency: 2, depth: 0.5, wet: 0.3 },
  },
};
```

**Verification Checklist:**
- [ ] No audio glitches/crackles after 1 minute
- [ ] CPU usage < 50% on iPhone 12
- [ ] No dropped frames in UI
- [ ] Memory usage stable (no growth over time)
- [ ] Battery drain acceptable

---

## 9. User Interface Requirements

> **CRITICAL:** This section addresses the "Three Surfaces" alignment requirement from `lessons-learned.md`. Every feature must have: API ✓, State ✓, **UI ✓**.

### 9.1 Why This Section Was Missing

The original spec focused on backend architecture and TypeScript interfaces. It violated the core lesson:

> **"API, UI, and State must align"** — A feature isn't done until all three support it.

Without UI designs:
- Effects were implemented but users can't control them
- New synths were added but users can't select them
- The "cockpit has no controls"

### 9.2 UI Philosophy Alignment

From `UI-PHILOSOPHY.md`, all UI must follow:

| Principle | Application to Effects/Synths |
|-----------|------------------------------|
| **Controls live where they act** | Effects are global → controls in Transport bar |
| **Visual feedback is immediate** | Slider movement = instant audio change |
| **No confirmation dialogs** | Drag slider = effect changes (no "Apply" button) |
| **Modes are visible** | Effect wet/dry is always shown |
| **Progressive disclosure** | Basic controls visible, advanced on expand |

### 9.3 Effects Controls UI

#### 9.3.1 Location: Transport Bar Extension

Effects are global (affect all tracks), so controls belong in the Transport bar alongside BPM and Swing:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [▶]  BPM [====120]  Swing [====30%]  │  [FX]  ← Toggle effects panel   │
└─────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼ (click expands)
┌─────────────────────────────────────────────────────────────────────────┐
│  Effects                                                          [×]   │
├─────────────────────────────────────────────────────────────────────────┤
│  REVERB     [======○====]  30%    Decay [=====○]  2.0s                 │
│  DELAY      [===○=======]  20%    Time [8n ▼]  Feedback [====○]        │
│  CHORUS     [○==========]   0%    Rate [====○]  Depth [====○]          │
│  DISTORT    [○==========]   0%    Drive [====○]                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 9.3.2 Interaction Model

| Action | Result | Sync |
|--------|--------|------|
| Drag wet slider | Immediate effect change | Broadcast to all clients |
| Drag parameter slider | Immediate parameter change | Broadcast to all clients |
| Click [FX] button | Toggle panel visibility | Local only (UI state) |
| Change delay time dropdown | Immediate tempo-sync change | Broadcast to all clients |

#### 9.3.3 Effects Panel Component

```typescript
// app/src/components/EffectsPanel.tsx
interface EffectsPanelProps {
  effects: EffectsState;
  onEffectsChange: (effects: Partial<EffectsState>) => void;
  disabled?: boolean;  // True on published sessions
}
```

#### 9.3.4 Default State

All effects start **dry** (wet = 0):
- User must explicitly enable effects
- Prevents unexpected sound changes for new users
- Aligns with "no surprises" principle

### 9.4 Sample Picker Updates

#### 9.4.1 Current State

```
Add Track:
  Drums: [Kick] [Snare] [Hi-Hat] ...
  Bass:  [Bass] [Sub Bass]
  Samples: [Lead] [Pluck] ...
  FX: [Zap] [Noise]

  Synth:
  Core: [Bass] [Lead] [Pad] [Pluck] [Acid]
  Keys: [Rhodes] [Organ] [Wurli] [Clav]
  Genre: [Funk] [Disco] [Strings] [Brass] [Stab] [Sub]
  Ambient: [Shimmer] [Jangle] [Dream] [Bell]
```

#### 9.4.2 Required Updates

Add new categories for implemented synths:

```
Add Track:
  Drums: [Kick] [Snare] [Hi-Hat] ...
  Bass:  [Bass] [Sub Bass]
  Samples: [Lead] [Pluck] ...
  FX: [Zap] [Noise]

  Synth:                                            ← Existing (Web Audio)
  Core: [Bass] [Lead] [Pad] [Pluck] [Acid]
  Keys: [Rhodes] [Organ] [Wurli] [Clav]
  Genre: [Funk] [Disco] [Strings] [Brass] [Stab] [Sub]
  Ambient: [Shimmer] [Jangle] [Dream] [Bell]

  Advanced:                                         ← NEW (Tone.js)
  FM: [E-Piano] [FM Bass] [Bell]
  Drum: [Membrane] [Tom] [Cymbal] [Hi-Hat]
  Other: [Pluck] [Duo Lead]

  Dual-Osc:                                        ← NEW (Advanced Engine)
  Leads: [Supersaw] [Thick] [Vibrato]
  Bass: [Sub] [Wobble] [Acid]
  Pads: [Warm] [Tremolo]
```

#### 9.4.3 Sample Constants Update

```typescript
// app/src/components/sample-constants.ts

// NEW: Tone.js synth categories
export const TONE_SYNTH_CATEGORIES = {
  fm: ['tone:fm-epiano', 'tone:fm-bass', 'tone:fm-bell'],
  drum: ['tone:membrane-kick', 'tone:membrane-tom', 'tone:metal-cymbal', 'tone:metal-hihat'],
  other: ['tone:pluck-string', 'tone:duo-lead', 'tone:am-bell', 'tone:am-tremolo'],
} as const;

export const TONE_SYNTH_NAMES: Record<string, string> = {
  'tone:fm-epiano': 'E-Piano',
  'tone:fm-bass': 'FM Bass',
  'tone:fm-bell': 'Bell',
  'tone:membrane-kick': 'Membrane',
  'tone:membrane-tom': 'Tom',
  'tone:metal-cymbal': 'Cymbal',
  'tone:metal-hihat': 'Hi-Hat',
  'tone:pluck-string': 'Pluck',
  'tone:duo-lead': 'Duo Lead',
  'tone:am-bell': 'AM Bell',
  'tone:am-tremolo': 'Tremolo',
};

// NEW: Advanced synth categories
export const ADVANCED_SYNTH_CATEGORIES = {
  leads: ['advanced:supersaw', 'advanced:thick-lead', 'advanced:vibrato-lead'],
  bass: ['advanced:sub-bass', 'advanced:wobble-bass', 'advanced:acid-bass'],
  pads: ['advanced:warm-pad', 'advanced:tremolo-strings'],
} as const;

export const ADVANCED_SYNTH_NAMES: Record<string, string> = {
  'advanced:supersaw': 'Supersaw',
  'advanced:thick-lead': 'Thick',
  'advanced:vibrato-lead': 'Vibrato',
  'advanced:sub-bass': 'Sub',
  'advanced:wobble-bass': 'Wobble',
  'advanced:acid-bass': 'Acid',
  'advanced:warm-pad': 'Warm',
  'advanced:tremolo-strings': 'Tremolo',
};
```

### 9.5 Three Surfaces Alignment Checklist

Before marking any feature "done", verify all three surfaces:

#### 9.5.1 Effects

| Surface | Requirement | Status |
|---------|-------------|--------|
| **API** | `audioEngine.setEffects(state)` | ✅ Implemented |
| **State** | `SessionState.effects: EffectsState` | ✅ Implemented |
| **UI** | EffectsPanel with sliders | ❌ **NOT IMPLEMENTED** |

#### 9.5.2 Tone.js Synths

| Surface | Requirement | Status |
|---------|-------------|--------|
| **API** | `audioEngine.playToneSynth(preset, ...)` | ✅ Implemented |
| **State** | Track.sampleId = `"tone:fm-epiano"` | ✅ Works |
| **UI** | Presets in SamplePicker | ❌ **NOT IMPLEMENTED** |

#### 9.5.3 Advanced Synths

| Surface | Requirement | Status |
|---------|-------------|--------|
| **API** | `advancedSynthEngine.playNote(preset, ...)` | ✅ Implemented |
| **State** | Track.sampleId = `"advanced:supersaw"` | ✅ Works |
| **UI** | Presets in SamplePicker | ❌ **NOT IMPLEMENTED** |

### 9.6 Implementation Priority

Based on user value and implementation complexity:

| Priority | Feature | Effort | User Impact |
|----------|---------|--------|-------------|
| **P0** | Add synths to SamplePicker | 1 hour | High - unlocks 19 new sounds |
| **P1** | Basic effects panel (wet sliders) | 2-3 hours | High - users can add reverb/delay |
| **P2** | Full effects panel (all params) | 2-3 hours | Medium - power users |
| **P3** | Sampled instruments | 1-2 days | Medium - piano, strings |
| **P4** | XY Pad / Macros | 2-3 days | Low - advanced feature |

### 9.7 Responsive Design

Effects panel must work on mobile:

```
Desktop (>768px):              Mobile (<768px):
┌──────────────────────┐       ┌──────────────────────┐
│ [▶] BPM Swing [FX]   │       │ [▶] BPM Swing [FX]   │
├──────────────────────┤       └──────────────────────┘
│ Effects              │              ↓ (tap FX)
│ REVERB [====○] 30%   │       ┌──────────────────────┐
│ DELAY  [===○=] 20%   │       │ Effects         [×]  │
│ ...                  │       │ REVERB               │
└──────────────────────┘       │ [================○]  │
                               │ 30%                  │
                               │ Decay [=========○]   │
                               │ ...                  │
                               └──────────────────────┘
                               (Full-width bottom sheet)
```

### 9.8 Published Session Behavior

On published (immutable) sessions:
- Effects panel is visible (shows current settings)
- All controls are **disabled** (greyed out)
- Cursor shows `not-allowed` on hover
- Tooltip: "Remix to modify"

This aligns with existing published session behavior for steps/tracks.

---

## Appendix C: Sources

- [Tone.js Official Site](https://tonejs.github.io/)
- [Tone.js GitHub](https://github.com/Tonejs/Tone.js/)
- [Tone.js Transport Wiki](https://github.com/Tonejs/Tone.js/wiki/Transport)
- [Tone.js Effects Wiki](https://github.com/Tonejs/Tone.js/wiki/Effects)
- [Tone.js Performance Wiki](https://github.com/Tonejs/Tone.js/wiki/Performance)
- [Tone.js Autoplay Wiki](https://github.com/Tonejs/Tone.js/wiki/Autoplay)
- [Bundlephobia](https://bundlephobia.com/package/tone)
- [StartAudioContext Library](https://github.com/tambien/StartAudioContext)
