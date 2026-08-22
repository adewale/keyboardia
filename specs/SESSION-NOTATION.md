# Session Notation Specification

> Implementation specification for Keyboardia's text pattern notation format.

**Version:** 2.4.0
**Last Updated:** August 2026
**Source of Truth:** `app/src/shared/session-notation-v24.ts`,
`app/src/shared/envelope-contract-v2.ts`, `app/src/shared/sync-types.ts`,
`app/src/shared/track-pan.ts`

**Implementation status:** v2.4 is the shipped canonical envelope text format.
The runtime-neutral parser and serializer accept v2.4, normalize supported v2.3
envelope input, retain unknown annotations, and emit canonical v2.4. The app's
rich JSON remains the full-fidelity session interchange; text intentionally
omits effects, scale state, and other session-level data described below.
The session toolbar's **Copy Notation** action serializes the current live state
through this implementation, reparses it as a safety check, and writes the
canonical text to the clipboard. Its parser/serializer code is lazy-loaded so
the syntax does not enter the Worker bundle or the initial sequencer chunk.

---

## Table of Contents

1. [Basic Syntax](#basic-syntax)
2. [Extended Syntax](#extended-syntax)
3. [Expressive Boundaries](#expressive-boundaries)
4. [Three-Layer Architecture](#three-layer-architecture)
5. [JSON Data Model](#json-data-model)
6. [Notation ↔ JSON Mapping](#notation--json-mapping)
7. [Grammar Specification](#grammar-specification)
8. [v2.4 Envelope Syntax](#v24-envelope-syntax)
9. [Version History](#version-history)

---

## Basic Syntax

### Step Symbols

| Symbol | Meaning | JSON Equivalent |
|--------|---------|-----------------|
| `x` | Step ON (note triggered) | `steps[i] = true` |
| `-` | Step OFF (silence) | `steps[i] = false` |
| `o` | Ghost note (soft/quiet) | `steps[i] = true`, `parameterLocks[i].volume = 0.3` |
| `X` | Accent (loud/emphasized) | `steps[i] = true`, `parameterLocks[i].volume = 1.0` |
| `~` | Tie continuation owned by the previous cyclic onset | `steps[i] = false`, `parameterLocks[i].tie = true` |

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
Label: pattern [key:value] [key:value] ...
```

Each key has its own bracket. This is normative: several values themselves
contain commas, so a comma-separated list of key/value pairs is ambiguous.

### Supported Annotations

| Annotation | Description | Valid Range |
|------------|-------------|-------------|
| `[bpm:120]` | Session tempo | 60-180 BPM |
| `[swing:60]` | Swing percentage | 0-100 |
| `[transpose:-2]` | Track pitch offset | ±24 semitones |
| `[pan:-20]` | Track stereo position as an integer percentage | -100 (left) to +100 (right) |
| `[stepCount:32]` | Per-track loop length | See valid step counts |
| `[pitches:0,7,5,3]` | Per-step pitch sequence | ±24 semitones per step |
| `[synth:acid]` | Instrument/preset hint | String identifier |
| `[fm:2.5,8]` | FM synth params (harmonicity, modIndex) | 0.5-10, 0-20 |
| `[play:trigger]` | Sample playback behavior | `trigger`, `gate`, or `loop` when supported |
| `[amp:ad,2ms,400ms]` | Attack/decay transient envelope | Typed A and D durations |
| `[amp:ahd,2ms,0.5st,400ms]` | Attack/hold/decay finite-source envelope | Typed A, H, and D durations |
| `[amp:ar,5ms,250ms]` | Attack/release envelope | Typed A and R durations |
| `[amp:adsr,10ms,200ms,0.7,2st]` | Attack/decay/sustain/release envelope | Typed A, D, R; sustain 0-1 |
| `[gate:75%]` | Gate-open percentage of the final tied cell | 0-100% |
| `[lock:9,release,2st]` | Sparse 1-based envelope-stage lock | Active step, timed stage, typed duration |

Durations use `ms`, `s`, or `st`; one `st` is one sixteenth-note sequencer
step. Sustain is unitless. Duplicate singleton annotations, duplicate
step/stage locks, mixed v2.4/v2.3 envelope syntax, and mixed sparse/dense lock
syntax are errors rather than order-dependent guesses.

### Legacy v2.3 input

`[env:A,D,S,R]`, `[envUnit:seconds|steps]`, `[gate:N]`, and dense
`[attacks:...]`, `[decays:...]`, `[releases:...]` vectors are accepted only as
legacy input. They receive the same range validation as v2.4 and serialize back
as canonical `[amp:...]`, percentage gate, and sparse `[lock:...]` forms.

Pan has one intentional unit boundary: session JSON, sync, and audio use the
normalized range `[-1, 1]`, while notation and the mixer display whole percent.
For example, `[pan:-20]` parses to `-0.20`; formatting `0.20` produces
`[pan:20]`. Values outside `[-100, 100]`, decimals, and non-finite values are
rejected rather than clamped at this public boundary.

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
| **Track transpose** | `[transpose:-2]` | ±24 semitones |
| **Stereo position** | `[pan:-20]` | -100% left to +100% right |
| **Polyrhythm** | `[stepCount:N]` | 3-128 steps (26 valid values) |
| **Swing** | `[swing:60]` | 0-100% (global and per-track) |
| **Tempo** | `[bpm:120]` | 60-180 BPM |
| **Instrument hint** | `[synth:acid]` | 35+ instruments |
| **Multi-track** | Labeled lines | Up to 16 tracks |
| **Note ties** | Inline `~` | Cyclic onset ownership and legato continuation |
| **FM synthesis** | `[fm:H,M]` | Harmonicity + mod index |
| **Scale lock** | Session-level | Root + scale ID |
| **Amplitude envelope** | `[amp:model,...]` | Capability-aware AD, AHD, AR, or ADSR override |
| **Mixed envelope units** | `ms`, `s`, `st` per duration | Absolute and tempo-relative stages can coexist |
| **Sample behavior** | `[play:trigger|gate|loop]` | Authored behavior retained even when inactive |
| **Gate time** | `[gate:P%]` | Percentage of final tied cell before release |
| **Envelope p-locks** | `[lock:step,stage,duration]` | Sparse attack/hold/decay/release timing override |

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
│  Kick:  x---x---x---x--- [transpose:-2] [swing:60]              │
│  Bass:  x-------x------- [synth:acid] [pitches:0,7,5,3]         │
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

### Session vs SessionState

There are two related but distinct interfaces:

- **`Session`** — Full session metadata + state (stored in KV, returned by API)
- **`SessionState`** — Just the musical data (tracks, tempo, swing, effects)

```typescript
// Full session record (API/storage)
interface Session {
  id: string;
  name: string | null;           // User-editable session name for display
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  remixedFrom: string | null;
  remixedFromName: string | null;
  remixCount: number;
  immutable: boolean;            // true = published (frozen forever)
  state: SessionState;           // The actual musical data
}
```

**Note:** Session seed files (in `app/scripts/sessions/`) may include `name` and `description` fields for documentation purposes. These are loader hints, not part of `SessionState`.

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
  version: number;                                  // Schema version for migrations (optional in seed files)
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
  pan?: number;                                     // -1 left to +1 right; legacy default 0
  muted: boolean;
  soloed?: boolean;                                 // Solo mode
  transpose: number;                                // -24 to +24 semitones
  stepCount?: number;                               // 1-128, defaults to 16
  fmParams?: FMParams;                              // FM synth: harmonicity + modIndex
  swing?: number;                                   // Per-track swing 0-100 (Phase 31D)
  envelopeV2?: TrackEnvelopeV2;                     // Optional authored AD/AHD/AR/ADSR
  samplePlaybackMode?: "trigger" | "gate" | "loop";
  gate?: number;                                    // Final-step gate percentage, 0-100
  envelope?: TrackEnvelope;                         // Accepted legacy v2.3 ADSR
  envelopeTimeUnit?: "seconds" | "steps";          // Accepted legacy detached unit
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
  attack?: number;  // Per-step attack override, 0-4
  decay?: number;   // Per-step decay override, 0-4
  release?: number; // Per-step release override, 0-8
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
| `[pan:-20]` | `track.pan: -0.20` |
| `[pitches:0,7,5,3]` | `parameterLocks[0].pitch = 0`, `[1].pitch = 7`, ... |
| `~` | `steps[i] = true`, `parameterLocks[i].tie = true`, owned by the previous cyclic onset |
| `[fm:2.5,8]` | `track.fmParams: { harmonicity: 2.5, modulationIndex: 8 }` |
| `[play:gate]` | `track.samplePlaybackMode: "gate"` |
| `[amp:adsr,10ms,200ms,0.7,2st]` | `track.envelopeV2` with model `adsr` and per-stage `{ value, unit }` durations |
| `[gate:75%]` | `track.gate: 75` |
| `[lock:4,release,2st]` | `parameterLocks[3].envelopeV2.release = { value: 2, unit: "steps" }` |

### Round-Trip Fidelity

| Direction | Fidelity |
|-----------|----------|
| **Text → semantic tracks** | Implemented by `parseEnvelopeSessionNotation`; strict diagnostics precede state application |
| **Semantic tracks → text** | Implemented by `serializeEnvelopeSessionNotation`; canonical for supported envelope fields and unknown annotations |
| **Whole session JSON ↔ text** | Intentionally lossy for effects, scale, collaboration metadata, assets, and other session-level fields |

---

## Grammar Specification

### EBNF Grammar

```ebnf
session     = { track_line } ;
track_line  = [ label ":" ] pattern { metadata } newline ;
label       = identifier ;
pattern     = supported_step_count * step ;
step        = "x" | "-" | "o" | "X" | "~" ;
metadata    = "[" key_value "]" ;
key_value   = key ":" value | flag ;
key         = identifier ;
flag        = identifier ;
value       = scalar | vector ;
scalar      = number | identifier ;
vector      = scalar { "," scalar } ;
duration    = number ( "ms" | "s" | "st" ) ;
model       = "ad" | "ahd" | "ar" | "adsr" ;
play_mode   = "trigger" | "gate" | "loop" ;
amp         = "amp:" model "," model_values ;
gate        = "gate:" number [ "%" ] ;
lock        = "lock:" positive_integer "," timed_stage "," duration ;
timed_stage = "attack" | "hold" | "decay" | "release" ;
```

### Example Parse

```
Input:  "Kick: x---x---x---x--- [bpm:120] [swing:60]"

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

## v2.4 Envelope Syntax

v2.4 makes envelope model, destination, playback behavior, and units explicit:

```text
[amp:ad,2ms,400ms]
[amp:ahd,2ms,0.5st,400ms]
[amp:ar,5ms,250ms]
[amp:adsr,10ms,200ms,0.7,2st]

[play:trigger] [amp:ahd,2ms,0.5st,400ms]
[play:gate] [amp:ar,5ms,250ms] [gate:90%]
[play:loop] [amp:adsr,10ms,200ms,0.7,2st] [gate:100%]
```

`ms`, `s`, and `st` are typed duration tokens; `st` is one sixteenth-note
step. Sustain is unitless. `play` describes sampled/procedural source behavior,
not the envelope curve or sequencer loop.

Tied continuation moves into the pattern (`~`) and envelope locks become
sparse, explicit, and 1-based:

```text
Bass: x~~~----x~------ [amp:adsr,5ms,200ms,0.6,2st]
[lock:1,attack,5ms] [lock:9,release,2st]
```

The v2.4 parser accepts the v2.3 `[env:...]`, `[envUnit:...]`, `[gate:N]`, and
dense A/D/R vectors as legacy input. Serialization emits only v2.4. Unknown
annotations and syntactically valid but inactive fields remain round-trippable.

The parser rejects ambiguous duplicate/conflicting envelope annotations before
state application. Capability validation is a separate pass: a syntactically
valid authored value can remain round-trippable while reporting that it is
inactive for the current sound source.

The first executable contract is checked in at:

- [`app/src/shared/session-notation-v24.ts`](../app/src/shared/session-notation-v24.ts) — parser, canonical serializer, legacy normalization, and capability diagnostics;
- [`app/src/shared/envelope-contract-v2.ts`](../app/src/shared/envelope-contract-v2.ts) — runtime-neutral discriminated envelope and duration types;
- [`app/src/shared/envelope-oracle-v2.ts`](../app/src/shared/envelope-oracle-v2.ts) — independent gate/tie, stage-landmark, amplitude, and stop-time oracle;
- [`app/src/shared/__fixtures__/envelope-notation-examples.ts`](../app/src/shared/__fixtures__/envelope-notation-examples.ts) — representative sessions and declared capability fixtures;
- [`app/src/shared/session-notation-v24.test.ts`](../app/src/shared/session-notation-v24.test.ts) — coverage, round-trip, migration, boundary, tie, and warning acceptance tests.

Run `npm run test:envelope:semantic` from `app/` for the fast contract gate and
`npm run validate:envelope-docs` for generated/reference freshness.

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
| v2.3 | Normalized track pan plus legacy ADSR, gate, tempo-relative times, and envelope p-lock input | Legacy import supported |
| v2.4 | Typed envelope models/units, sample playback, inline ties, sparse locks, strict diagnostics, and v2.3 normalization | ✅ Implemented |

---

## Example Sessions

The envelope v2.4 corpus contains seven complementary sessions rather than one
oversized happy path:

1. synth articulation from pluck through swell;
2. honest Tone, trigger-sample, gated-sample, looped-sample, and procedural behavior;
3. cyclic ties, onset ownership, and preserved inactive locks/gate;
4. mixed absolute/step timing across 5-, 7-, 12-, and 32-step tracks;
5. v2.3 seconds/steps and dense-lock migration;
6. zero/max boundaries and capability mismatches;
7. a musically representative full-performance session.

The canonical source is
[`envelope-notation-examples.ts`](../app/src/shared/__fixtures__/envelope-notation-examples.ts),
and [`ENVELOPE-NOTATION-EXAMPLES.md`](./ENVELOPE-NOTATION-EXAMPLES.md)
provides the coverage map and intended use. The tests require every declared
planned notation feature to appear in at least one session.

The existing structured JSON session below continues to demonstrate the
already-shipped non-envelope advanced features:

**[`app/scripts/sessions/advanced-features-showcase.json`](../app/scripts/sessions/advanced-features-showcase.json)**

Features demonstrated:
- **FM synthesis** — `fmParams` with harmonicity and modulationIndex
- **Per-track swing** — Individual swing values per track (0, 15, 25, 40)
- **Effects chain** — Reverb, delay, chorus, distortion with wet/dry mix
- **Loop region** — `loopRegion: { start: 0, end: 32 }`
- **Parameter locks** — Per-step pitch and volume overrides
- **Dynamics** — Volume-based accents and ghost notes
- **Stereo pan** — Stored as normalized `[-1, 1]`; notation uses integer percent at the text boundary

Use this as a reference implementation when creating session seed files.

---

## Related Documentation

- **Research & Philosophy:** [`specs/research/SESSION-NOTATION-RESEARCH.md`](./research/SESSION-NOTATION-RESEARCH.md)
- **Planned v2.4 executable spec:** [`specs/ADSR-OVERHAUL-v2.md`](./ADSR-OVERHAUL-v2.md)
- **v2.4 example coverage:** [`specs/ENVELOPE-NOTATION-EXAMPLES.md`](./ENVELOPE-NOTATION-EXAMPLES.md)
- **Type Definitions:** `app/src/shared/sync-types.ts`, `app/src/shared/state.ts`
- **Polyrhythm Details:** [`specs/POLYRHYTHM-SUPPORT.md`](./POLYRHYTHM-SUPPORT.md)
- **Example Session:** [`app/scripts/sessions/advanced-features-showcase.json`](../app/scripts/sessions/advanced-features-showcase.json)

---

*This specification reflects the shipped v2.4 parser/serializer and session
model as of August 2026. For design philosophy, historical context, and future
evolution principles, see the research document.*
