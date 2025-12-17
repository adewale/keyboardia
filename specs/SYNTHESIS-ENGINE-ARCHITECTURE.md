# Keyboardia Synthesis Engine Architecture

> Technical reference for the audio synthesis and playback system.

## Overview

Keyboardia uses a hybrid audio architecture combining:
- **Web Audio API** for core sampling, basic synthesis, and scheduling
- **Tone.js** (~200KB) for advanced synthesis and effects (lazy-loaded)
- **Multiplayer sync** via Cloudflare Durable Objects

```
┌─────────────────────────────────────────────────────────────┐
│                    SIGNAL FLOW                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Tracks (Sample/Synth)                                      │
│    ↓ (with pitch/volume per-step locks)                     │
│    ├→ Track Gain Node (volume control per track)            │
│    ↓                                                        │
│  Master Gain (overall volume)                               │
│    ↓                                                        │
│  Compressor/Limiter (prevents clipping)                     │
│    ↓                                                        │
│  Tone.js Effects Chain (if enabled)                         │
│    ├→ Distortion → Chorus → Delay → Reverb                  │
│    ↓                                                        │
│  Audio Destination (speakers)                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Audio Engine (`/audio/engine.ts`)

The main orchestrator for all audio operations.

**Responsibilities:**
- AudioContext lifecycle management (create, suspend, resume)
- Sample playback with pitch shifting
- Synth note triggering
- Track volume management
- Master output chain (gain → compressor → effects)

**Platform Support:**
- iOS Safari (`webkitAudioContext`, "interrupted" state handling)
- Chrome/Firefox/Edge (standard `AudioContext`)
- Mobile (touch event listeners for context unlock)

**Compressor Settings:**
```typescript
threshold: -6dB, knee: 12, ratio: 4:1, attack: 3ms, release: 250ms
```

### 2. Scheduler (`/audio/scheduler.ts`)

Real-time step sequencer with lookahead scheduling.

**Algorithm:**
```
While (nextStepTime < currentTime + SCHEDULE_AHEAD_SEC):
  1. Schedule all samples/synths for current step
  2. Notify UI of step change (for playhead)
  3. Advance to next step
  4. Calculate next step time (drift-free)
```

**Constants:**
| Name | Value | Purpose |
|------|-------|---------|
| `LOOKAHEAD_MS` | 25 | How often to check scheduler |
| `SCHEDULE_AHEAD_SEC` | 0.1 | How far ahead to schedule |
| `STEPS_PER_BEAT` | 4 | 16th note resolution |

**Drift-Free Timing:**
```typescript
// Prevents floating-point accumulation errors
nextStepTime = audioStartTime + (totalStepsScheduled * stepDuration)
```

**Swing:**
- Applied to odd-numbered steps (off-beats)
- Range: 0-100% (50% = triplet feel)

### 3. Synth Engine (`/audio/synth.ts`)

Web Audio API-based subtractive synthesis.

**Architecture:**
- 16-voice polyphonic with voice stealing
- Single oscillator per voice
- Low-pass filter with resonance
- ADSR envelope

**24 Presets:**

| Category | Presets |
|----------|---------|
| Core | bass, lead, pad, pluck, acid |
| Funk/Soul | funkbass, clavinet |
| Acid Jazz | rhodes, organ, wurlitzer |
| Disco | discobass, strings, brass |
| House/Techno | stab, sub |
| Indie/Ambient | shimmer, jangle, dreampop, bell |

### 4. Tone.js Synths (`/audio/toneSynths.ts`)

Advanced synthesis via Tone.js (lazy-loaded).

**11 Presets:**

| Type | Presets | Description |
|------|---------|-------------|
| FM | fm-epiano, fm-bass, fm-bell | DX7-style synthesis |
| AM | am-bell, am-tremolo | Amplitude modulation |
| Membrane | membrane-kick, membrane-tom | Drum synthesis |
| Metal | metal-cymbal, metal-hihat | Metallic percussion |
| Pluck | pluck-string | Karplus-Strong |
| Duo | duo-lead | Parallel synths |

### 5. Advanced Synth (`/audio/advancedSynth.ts`)

Polyphonic dual-oscillator synthesis.

**Architecture:**
```
OSC1 ─┬─→ Filter ─→ Amp Envelope ─→ Output
OSC2 ─┤     ↑            ↑
Noise─┘  Filter Env     LFO
```

**Features:**
- 8-voice polyphony with voice stealing
- Dual oscillators with independent detune
- Filter envelope (separate from amplitude)
- LFO → filter/pitch/amplitude

**8 Presets:**

| Preset | Use Case |
|--------|----------|
| supersaw | EDM/Trance leads |
| sub-bass | Deep bass |
| wobble-bass | Dubstep |
| warm-pad | Ambient/Cinematic |
| vibrato-lead | Melodic lines |
| tremolo-strings | String pads |
| acid-bass | TB-303 style |
| thick-lead | PWM-style |

### 6. Effects Chain (`/audio/toneEffects.ts`)

Four-stage Tone.js effects processor.

**Signal Flow:**
```
Input → Distortion → Chorus → Delay → Reverb → Output
```

**Parameters:**

| Effect | Parameters | Range |
|--------|------------|-------|
| Reverb | decay, wet | 0.1-10s, 0-1 |
| Delay | time, feedback, wet | 8n-4m, 0-0.95, 0-1 |
| Chorus | frequency, depth, wet | 0.1-10Hz, 0-1, 0-1 |
| Distortion | amount, wet | 0-1, 0-1 |

**Delay Time Notation:**
```
32n, 16n, 16t, 8n, 8t, 4n, 4t, 2n, 2t, 1n, 1m, 2m, 4m
```

---

## Lazy Loading System

### Audio Triggers (`/audio/audioTriggers.ts`)

Centralized decision logic for when to load audio.

**Trigger Tiers:**

| Tier | Behavior | Triggers |
|------|----------|----------|
| 1 | Block until ready | play, record, record_stop, add_to_grid |
| 2 | Preload background | step_toggle, add_track, chromatic_click |
| Preview | Only if loaded | preview_hover, preview_pitch, preview_slice |

**Valid User Gestures (AudioContext unlock):**
```
✅ click, contextmenu, auxclick, dblclick, mousedown, mouseup,
   pointerup, touchend, keydown, keyup

❌ mouseenter, mouseover, mousemove, scroll, wheel, focus,
   blur, load, resize
```

**API:**
```typescript
signalMusicIntent(trigger)        // Tier 2: preload in background
requireAudioEngine(trigger)       // Tier 1: block and initialize
tryGetEngineForPreview(trigger)   // Preview: return null if not ready
getAudioLoadingState()            // Observability
```

### Lazy Loader (`/audio/lazyAudioLoader.ts`)

Feature-flagged dynamic import of audio engine.

**Feature Flag:** `VITE_LAZY_AUDIO`
- `true`: Defer Tone.js until music intent
- `false` (default): Eager loading

**Debug (dev mode):**
```javascript
window.__audioTriggers.getState()
// { lazyLoadingEnabled, moduleLoaded, engineInitialized, timestamp }
```

---

## Sample System

### Built-in Samples (`/audio/samples.ts`)

16 procedurally generated samples:

| Category | Samples |
|----------|---------|
| Drums | kick, snare, hihat, clap, tom, rim, cowbell, openhat |
| Bass | bass, subbass |
| Synths | lead, pluck, chord, pad |
| FX | zap, noise |

**Generation Techniques:**
- Kick: Exponential frequency sweep (150→40Hz)
- Snare: Noise + tone mix with dual decay
- Hi-hat: High-frequency noise, fast decay
- Pluck: Harmonics with differential decay

### Sample ID Format

```
"kick"                    // Built-in sample
"synth:lead"              // Web Audio synth
"tone:fm-epiano"          // Tone.js synth
"advanced:supersaw"       // Advanced synth
"recording:{uuid}"        // User recording
"recording:{uuid}_slice_0" // Auto-sliced recording
```

### Recording & Slicing (`/audio/recorder.ts`, `/audio/slicer.ts`)

**Recording:**
- MediaRecorder API for mic input
- Blob → ArrayBuffer → AudioBuffer conversion

**Slicing Modes:**
1. **Transient Detection**: RMS energy onset detection
   - 10ms window, 50% hop
   - Max 16 slices
2. **Equal Division**: Split into N equal parts

---

## Parameter Locks (Elektron-Style)

Per-step overrides for any track parameter.

```typescript
interface ParameterLock {
  pitch?: number;   // -12 to +12 semitones
  volume?: number;  // 0-1 multiplier
}
```

**Application:**
```typescript
const totalPitch = track.transpose + (pLock?.pitch ?? 0);
const effectiveVolume = track.volume * (pLock?.volume ?? 1);
```

---

## Playback Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| oneshot | Play to completion | Drums, one-shots |
| gate | Cut at step boundary | Sustained sounds |

**Pitch Shifting:**
```typescript
source.playbackRate.value = Math.pow(2, semitones / 12);
```

---

## Worker Architecture (`/worker/`)

### State Schema

```typescript
interface SessionState {
  tracks: SessionTrack[];
  tempo: number;        // 60-180 BPM
  swing: number;        // 0-100%
  effects?: EffectsState;
  version: number;
}
```

### Invariants

| Constraint | Value |
|------------|-------|
| MAX_TRACKS | 16 |
| MAX_STEPS | 128 |
| MIN_TEMPO | 60 BPM |
| MAX_TEMPO | 180 BPM |
| MIN_TRANSPOSE | -24 semitones |
| MAX_TRANSPOSE | +24 semitones |

### Multiplayer Sync

- **Clock sync**: Server timestamp + client offset
- **Effects sync**: All effect parameters sync across clients
- **Cursor sync**: Position and currently-editing track

---

## Memory Management

| Issue | Solution |
|-------|----------|
| BufferSourceNode accumulation | `source.onended = disconnect()` |
| OscillatorNode accumulation | setTimeout cleanup after release |
| TrackGain orphans | `removeTrackGain()` on delete |
| Tone.js nodes | `dispose()` method |
| Event listeners | Single document listener, passive |

---

## Performance Optimizations

| Technique | Benefit |
|-----------|---------|
| Compressor/Limiter | Prevents clipping (8+ samples) |
| Voice stealing | Caps CPU on mobile |
| Lookahead scheduling | Accurate timing, 25ms latency |
| Lazy loading | ~500ms faster initial load |
| Drift-free timing | No tempo slip |
| Promise locking | Prevents concurrent resume() |

---

## Reference

### Frequency

- A4 (concert pitch): 440 Hz
- C4 (middle C): 261.625565 Hz
- Semitone ratio: 2^(1/12) ≈ 1.0595

### Envelope Timings

| Type | Range | Use |
|------|-------|-----|
| Fast attack | 1-5ms | Transients |
| Medium attack | 10-50ms | Synths |
| Slow attack | 100-500ms | Pads |
| Fast release | 50-200ms | Drums |
| Slow release | 1-2s+ | Ambient |

### Audio Parameter Ranges

| Parameter | Range |
|-----------|-------|
| Filter frequency | 20 Hz - 20 kHz |
| Filter Q | 0-20 (clamped for stability) |
| Envelope times | 0.001s - 8s |
| Volume | 0-1 (linear) |
| Pan | -1 to +1 |
