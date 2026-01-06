# Session Notation Specification

> Implementation specification for Keyboardia's text pattern notation format.

**Version:** 2.0.0
**Last Updated:** January 2026
**Source of Truth:** `app/src/shared/sync-types.ts`, `app/src/shared/state.ts`

---

## Table of Contents

1. [Basic Syntax](#basic-syntax)
2. [Extended Syntax](#extended-syntax)
3. [Expressive Boundaries](#expressive-boundaries)
4. [Three-Layer Architecture](#three-layer-architecture)
5. [JSON Data Model](#json-data-model)
6. [Notation ↔ JSON Mapping](#notation--json-mapping)
7. [Grammar Specification](#grammar-specification)
8. [Version History](#version-history)

---

## Basic Syntax

### Step Symbols

| Symbol | Meaning | JSON Equivalent |
|--------|---------|-----------------|
| `x` | Step ON (note triggered) | `steps[i] = true` |
| `-` | Step OFF (silence) | `steps[i] = false` |
| `o` | Ghost note (soft/quiet) | `steps[i] = true`, `parameterLocks[i].volume = 0.3` |
| `X` | Accent (loud/emphasized) | `steps[i] = true`, `parameterLocks[i].volume = 1.0` |

**Resolution:** 16 characters = 1 bar at 16th-note resolution (default)

### Example Patterns

```
Kick:  x---x---x---x---
Snare: ----x-------x---
HiHat: x-x-x-x-x-x-x-x-
```

---

## Extended Syntax

### Annotation Format

Metadata annotations use bracket syntax after the pattern:

```
Label: pattern [key:value, key:value, ...]
```

### Supported Annotations

| Annotation | Description | Valid Range |
|------------|-------------|-------------|
| `[bpm:120]` | Session tempo | 60-180 BPM |
| `[swing:60]` | Swing percentage | 0-100 |
| `[transpose:-2]` | Track pitch offset | ±12 semitones |
| `[stepCount:32]` | Per-track loop length | See valid step counts |
| `[pitches:0,7,5,3]` | Per-step pitch sequence | ±24 semitones per step |
| `[synth:acid]` | Instrument/preset hint | String identifier |
| `[tie:true]` | Note tie (legato) | Boolean per step |
| `[fm:2.5,8]` | FM synth params (harmonicity, modIndex) | 0.5-10, 0-20 |

### Valid Step Counts

The following step counts are supported for polyrhythmic patterns:

```
Standard:    4, 8, 16, 32, 64, 128
Triplets:    3, 6, 12, 24, 48, 96
Polyrhythm:  5, 7, 9, 10, 11, 13, 14, 15, 18, 20, 21, 27, 28, 36
```

**Source:** `VALID_STEP_COUNTS` in `app/src/shared/sync-types.ts`

### Multi-Bar Patterns

```
Bass (32 steps):
x-------x-------x-------x---x---
```

Or with explicit annotation:
```
Bass: x-------x-------x-------x---x--- [stepCount:32]
```

---

## Expressive Boundaries

### What CAN Be Represented

| Dimension | Notation | Coverage |
|-----------|----------|----------|
| **Rhythm** (binary) | `x` / `-` | Complete |
| **Dynamics** (3 levels) | `o` / `x` / `X` | Sufficient for most genres |
| **Pitch offset** | `[pitches:...]` or p-lock | ±24 semitones (4 octaves) |
| **Volume offset** | `[vol:0.5]` or p-lock | 0-1 multiplier per step |
| **Track transpose** | `[transpose:-2]` | ±12 semitones |
| **Polyrhythm** | `[stepCount:N]` | 3-128 steps (26 valid values) |
| **Swing** | `[swing:60]` | 0-100% (global and per-track) |
| **Tempo** | `[bpm:120]` | 60-180 BPM |
| **Instrument hint** | `[synth:acid]` | 35+ instruments |
| **Multi-track** | Labeled lines | Up to 16 tracks |
| **Note ties** | p-lock `tie: true` | Legato/sustained notes |
| **FM synthesis** | `[fm:H,M]` | Harmonicity + mod index |
| **Scale lock** | Session-level | Root + scale ID |

### What CANNOT Be Represented

| Feature | Status | Notes |
|---------|--------|-------|
| Pitch bends | ❌ | Discrete p-locks only |
| Filter sweeps | ❌ | Per-step only (no automation curves) |
| Chords | ❌ | Monophonic per track (use multiple tracks) |
| Rubato | ❌ | Grid is quantized for multiplayer sync |
| Microtones | ❌ | 12-TET only |
| Continuous LFO | ❌ | Step-based modulation only |

### Architectural Walls

These are fundamental limitations:

1. **Pitch Wall** — 12-TET only, no microtones
2. **Timing Wall** — Quantized grid required for multiplayer sync
3. **Platform Wall** — Web Audio latency (~30-100ms)

---

## Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Plain Text (Human/AI/Community)                       │
│                                                                 │
│  Kick:  x---x---x---x---                                        │
│  Snare: ----x-------x---                                        │
│  HiHat: x-x-x-x-x-x-x-x-                                        │
│                                                                 │
│  • Maximum shareability                                         │
│  • Works in Discord, SMS, email, Reddit                         │
│  • AI can read/write directly                                   │
│  • Rhythm + basic dynamics only                                 │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: Annotated Text (Extended Notation)                    │
│                                                                 │
│  Kick:  x---x---x---x--- [transpose:-2, swing:60]               │
│  Bass:  x-------x------- [synth:acid, pitches:0,7,5,3]          │
│                                                                 │
│  • Still clipboard-friendly                                     │
│  • Machine-parseable with regex                                 │
│  • Pitch sequences, synthesis hints, FM params                  │
│  • Graceful degradation (ignore unknown annotations)            │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: Rich Clipboard / JSON (Full Fidelity)                 │
│                                                                 │
│  See JSON Data Model section below                              │
│                                                                 │
│  • Full parameter lock detail including ties                    │
│  • Round-trip with app state                                    │
│  • FM synthesis parameters                                      │
│  • Effects state, scale state, loop regions                     │
│  • Future-proof (add fields without breaking)                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## JSON Data Model

### SessionState

**Source:** `app/src/shared/state.ts`

```typescript
interface SessionState {
  tracks: SessionTrack[];
  tempo: number;                                    // 60-180 BPM
  swing: number;                                    // 0-100 global swing
  effects?: EffectsState;                           // Reverb, delay, chorus, distortion
  scale?: ScaleState;                               // Key Assistant (root + scale + lock)
  loopRegion?: { start: number; end: number } | null;  // Loop playback region
  version: number;                                  // Schema version for migrations
}
```

### SessionTrack

**Source:** `app/src/shared/state.ts`

```typescript
interface SessionTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];                                 // Up to 128 steps
  parameterLocks: (ParameterLock | null)[];         // Up to 128 slots
  volume: number;                                   // 0-1
  muted: boolean;
  soloed?: boolean;                                 // Solo mode
  transpose: number;                                // -12 to +12 semitones
  stepCount?: number;                               // 1-128, defaults to 16
  fmParams?: FMParams;                              // FM synth: harmonicity + modIndex
  swing?: number;                                   // Per-track swing 0-100 (Phase 31D)
  // playbackMode is DEPRECATED - ignored on load
}
```

### ParameterLock

**Source:** `app/src/shared/sync-types.ts`

```typescript
interface ParameterLock {
  pitch?: number;   // Semitones offset from original (-24 to +24)
  volume?: number;  // 0-1, multiplier on track volume
  tie?: boolean;    // Continue note from previous step (no new attack)
}
```

### FMParams

**Source:** `app/src/shared/sync-types.ts`

```typescript
interface FMParams {
  harmonicity: number;       // 0.5 to 10 - frequency ratio
  modulationIndex: number;   // 0 to 20 - modulation intensity
}
```

### EffectsState

**Source:** `app/src/shared/sync-types.ts`

```typescript
interface EffectsState {
  bypass?: boolean;          // true = dry signal only
  reverb: {
    decay: number;           // 0.1 to 10 seconds
    wet: number;             // 0 to 1
  };
  delay: {
    time: string;            // Musical notation: "8n", "4n", "16n"
    feedback: number;        // 0 to 0.95
    wet: number;             // 0 to 1
  };
  chorus: {
    frequency: number;       // 0.1 to 10 Hz
    depth: number;           // 0 to 1
    wet: number;             // 0 to 1
  };
  distortion: {
    amount: number;          // 0 to 1
    wet: number;             // 0 to 1
  };
}
```

### ScaleState

**Source:** `app/src/shared/sync-types.ts`

```typescript
interface ScaleState {
  root: string;              // 'C', 'C#', 'D', etc.
  scaleId: string;           // 'minor-pentatonic', 'major', 'dorian', etc.
  locked: boolean;           // Constrains ChromaticGrid when true
}
```

### Valid Step Counts

**Source:** `app/src/shared/sync-types.ts`

```typescript
const VALID_STEP_COUNTS = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  18, 20, 21, 24, 27, 28, 32, 36, 48, 64, 96, 128
] as const;
```

---

## Notation ↔ JSON Mapping

### Pattern Symbols

| Text | JSON |
|------|------|
| `x` | `steps[i] = true` |
| `-` | `steps[i] = false` |
| `o` | `steps[i] = true`, `parameterLocks[i] = { volume: 0.3 }` |
| `X` | `steps[i] = true`, `parameterLocks[i] = { volume: 1.0 }` |

### Metadata Annotations

| Text | JSON |
|------|------|
| `[bpm:120]` | `tempo: 120` |
| `[swing:60]` | `swing: 60` (global) or `track.swing: 60` (per-track) |
| `[stepCount:32]` | `track.stepCount: 32` |
| `[transpose:-2]` | `track.transpose: -2` |
| `[pitches:0,7,5,3]` | `parameterLocks[0].pitch = 0`, `[1].pitch = 7`, ... |
| `[tie]` | `parameterLocks[i].tie = true` |
| `[fm:2.5,8]` | `track.fmParams: { harmonicity: 2.5, modulationIndex: 8 }` |

### Round-Trip Fidelity

| Direction | Fidelity |
|-----------|----------|
| **Text → JSON** | Lossless (all notation maps to data) |
| **JSON → Text** | Potentially lossy (effects, scale state not representable in plain text) |

---

## Grammar Specification

### EBNF Grammar

```ebnf
session     = { track_line } ;
track_line  = [ label ":" ] pattern [ metadata ] newline ;
label       = identifier ;
pattern     = { step } ;
step        = "x" | "-" | "o" | "X" ;
metadata    = "[" key_value { "," key_value } "]" ;
key_value   = key ":" value ;
key         = identifier ;
value       = number | string | array ;
array       = "[" value { "," value } "]" ;
```

### Example Parse

```
Input:  "Kick: x---x---x---x--- [bpm:120, swing:60]"

Parsed:
{
  label: "Kick",
  pattern: [true, false, false, false, true, false, false, false, ...],
  metadata: {
    bpm: 120,
    swing: 60
  }
}
```

---

## Version History

| Version | Features | Status |
|---------|----------|--------|
| v1.0 | Basic `x`/`-` patterns | ✅ Implemented |
| v1.1 | Ghost (`o`) and accent (`X`) | ✅ Implemented |
| v1.2 | Bracket metadata (`[key:value]`) | ✅ Implemented |
| v1.3 | Extended pitch range (±24 semitones) | ✅ Implemented |
| v1.4 | Tie support in parameter locks | ✅ Implemented |
| v1.5 | Triplet step counts (3, 6, 12, 24, 48, 96) | ✅ Implemented |
| v1.6 | Polyrhythmic step counts (5, 7, 9, etc.) | ✅ Implemented |
| v1.7 | FM synthesis parameters | ✅ Implemented |
| v1.8 | Per-track swing | ✅ Implemented |
| v1.9 | 128-step patterns | ✅ Implemented |
| v2.0 | Effects (reverb, delay, chorus, distortion) | ✅ Implemented |
| v2.1 | Scale state / Key Assistant | ✅ Implemented |
| v2.2 | Loop regions | ✅ Implemented |

---

## Related Documentation

- **Research & Philosophy:** [`specs/research/SESSION-NOTATION-RESEARCH.md`](./research/SESSION-NOTATION-RESEARCH.md)
- **Type Definitions:** `app/src/shared/sync-types.ts`, `app/src/shared/state.ts`
- **Polyrhythm Details:** [`specs/POLYRHYTHM-SUPPORT.md`](./POLYRHYTHM-SUPPORT.md)

---

*This specification reflects the implementation as of January 2026. For design philosophy, historical context, and future evolution principles, see the research document.*
