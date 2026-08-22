# ADSR Overhaul v2 — Executable Specification

**Status:** CORE CORRECTNESS VERIFIED — SHAPE UI AND PRODUCTION RENDERER CUTOVER PENDING  
**Date:** 2026-08-22  
**Supersedes:** `specs/ADSR-OVERHAUL.md`  
**Protocol capability:** `track-envelope-v2`
**Operational sample requirements:** `docs/SAMPLE-INTAKE-REQUIREMENTS.md`  
**UI evidence:** `specs/research/ENVELOPE-UI-RESEARCH.md`
**XY reuse evidence:** `specs/research/XY-CONTROL-REUSE.md`
**Deferred export research:** `specs/research/EXPORT-FIDELITY-RESEARCH.md`
**Verification cost baseline:** `specs/research/ENVELOPE-VERIFICATION-COST-BASELINE.md`

This document keeps every outcome and phase item from the original ADSR
overhaul, resolves its open questions, and turns the proposal into a sequence
of independently shippable changes with observable acceptance gates. It also
incorporates the failures found while implementing the first version: duplicated
scheduler paths, incomplete sync surfaces, optimistic UI/server divergence,
mock drift, silent capability gaps, sample-envelope ambiguity, and a renderer
migration whose structural tests did not prove audible equivalence.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## Implementation ledger

The original locally executable work in Slices A–D is implemented. The shared v2
contract now crosses production state, validation, sync, persistence, hashing,
reconnect, MCP, notation, main/worklet scheduling, synth adapters, and managed
sample voices. The capability-aware exact editor, selected-track XY batch
transactions, unchanged MIDI boundary, rich examples, cost/resource records,
and stable semantic/PCM/rolling/browser gates are checked in.

The core release profile now has explicit flag-off evidence rather than relying
on structural inference. With `VITE_FEATURE_ENVELOPE_V2=false`, a browser fixture
proves that authoring controls disappear while mixed-unit ADSR, gate, locks,
notation, and the audio-engine runtime retain the authored values. Publish and
remix tests compare the complete canonical state and hash. Native, real Tone
OfflineAudioContext, advanced-adapter, and managed-sample tests exercise an
authored `release: 0.3` plus zero release without wall-clock voice ownership.
The focused correctness commands are first-class CI lanes, not manually selected
files hidden outside the merge workflow.

The 2026-08-22 product-design review found that the delivered editor still jumps
from a compact summary to expert envelope terminology. Slice D therefore has a
remaining D2 refinement: add the musical Shape layer specified in Sections 3.5
and 9.1, relocate the selected-track Start/Tail macro beside its track, and stop
presenting global ephemeral synth XY presets as reusable session controls. This
does not reopen the canonical envelope, scheduler, notation, MCP, or sample
contracts.

Slices E–F are implemented as an evidence-gated migration system, not falsely
marked as a completed production cutover. All 32 published synth presets have
per-preset migration records and remain on the native renderer until their T3
packet contains PCM evidence, two independent listening approvals, canary
telemetry, and a rollback drill. The release-trigger and additional-loop asset
experiments have complete runtime/schema support but are deferred by
`artifacts/envelope-asset-promotion-decision.json`; no unapproved sample bytes
were added. The existing Hammond loop remains supported with decoded-frame
validation. CI p50/p95, human minutes, canary telemetry, and one shipped release
cycle are external release evidence and cannot be manufactured by this change.

Local release-candidate evidence on 2026-08-22 is green: 263 focused
correctness tests, 4,694 full-unit tests, 135 built integration tests, three
editor browser contracts, two flag-off/real-Tone browser contracts, 15
real-Worker desktop smoke contracts, seven real-Worker mobile Safari contracts,
and 73 serial real-Worker collaboration contracts. TypeScript, worker
TypeScript/bundle isolation, ESLint, sync inventory, test-quality, E2E
inventory, documentation freshness, resource budget, production build, and
whitespace integrity also pass. The measured durations and intended cadence are
recorded in the verification-cost baseline; these local results do not stand in
for production canary or human-listening evidence.

### Original-goal status at 2026-08-22

These statuses distinguish implemented architecture from production audio
promotion. **Achieved** means the locally executable code and its direct
verification exist. **Provisional** means the contract is implemented but the
last audible or release-level evidence is still missing. **Pending** means the
current production path deliberately remains unchanged.

| Original goal | Status | Evidence and remaining boundary |
|---|---|---|
| Give `release: 0.3` one meaning across three divergent audio implementations | **Achieved for the authored correctness profile** | The oracle defines authored R as the duration from note-off/current gain to epsilon. Native synth, real Tone OfflineAudioContext/advanced adapters, and managed samples now have direct endpoint, tail-energy, and zero-release evidence for the same resolved `0.3 s`. Untouched legacy preset fallback deliberately keeps its prior sound; complete per-preset renderer-convergence evidence remains a separate T3 gate. |
| Make envelopes per-track, persistent, synchronized, and publishable | **Achieved** | Optional `envelopeV2`, playback mode, gate, and locks cross canonical `SessionState`, validation, granular operations, optimistic and authoritative reducers, hashes, reconnect, Durable Object storage, old/new rolling merges, and worker/client boundaries. Publish and remix copy the complete validated live state rather than reconstructing selected fields. |
| Expose full ADSR through UI, MCP, and notation | **Achieved for the exact, capability-aware surface; D2 pending** | The exact editor, MCP edit/read/analysis operations, and v2.4 parser/serializer all carry A/D/S/R. Instruments that cannot truthfully sustain expose AD, AHD, or AR instead; that is an intentional correction to the universal-ADSR premise, not a missing adapter. The simpler musical Shape layer is still unimplemented. |
| Add sequencer expression through envelope locks, gate, and tempo-relative timing | **Achieved** | Typed onset locks cover A/H/D/R, gate is per track, each duration carries seconds or steps, tied runs have specified semantics, and main/worklet paths are checked against the same onset-time resolver. |
| Eventually consolidate the native and Tone synth renderers | **Pending by design** | The migration ledger, translated candidates, fail-closed routing, PCM harness, approval schema, canary, and rollback mechanism exist. All 32 published native presets remain native until per-preset T3 evidence and one release cycle exist; duplicate renderer code has not been removed. |
| Fix concrete cleanup, range, zero, and release bugs | **Achieved for the scoped defects** | Shared ranges now feed validation, MCP, UI, and XY; `0` no longer falls through a truthy release default; authored native/sample releases have explicit endpoints and guards; source/oscillator `ended` events, Tone's audio clock, and an audio-clock sentinel replace wall-clock voice teardown. The remaining scheduler/UI timers are not voice-lifetime authorities. |

The third and fifth rows are deliberately not collapsed into a single
“ADSR complete” claim. The exact authoring feature is present; beginner UI
refinement is separate; and renderer consolidation requires stronger audible
evidence than adapter-level semantic tests.

## 1. Outcomes

The completed overhaul MUST provide:

1. One documented meaning for authored attack, decay, sustain, release, and
   gate values across all engines that claim the corresponding capability.
2. Per-track envelope state that syncs, persists, publishes, remixes, hashes,
   validates, and survives rolling deployments.
3. Full A/D/S/R control in the UI and MCP wherever the instrument can express
   it, and honest AD, AHD, or AR control where that is the actual musical
   model, with visible and machine-readable capability reporting elsewhere.
4. A beginner-readable musical Shape layer plus selected-track Start/Tail XY
   control with one synced mutation per drag and exact A/H/D/S/R escape hatches.
5. Per-note attack/hold/decay/release locks, gate time, ties, and
   tempo-relative times with identical main-thread and worklet scheduling.
6. Session notation round-tripping and accurate documentation of which new
   envelope features the existing simple MIDI export does not carry.
7. Audio-clock voice cleanup and no falsy-zero or release-tail regressions.
8. One synth renderer only after every published `synth:*` preset passes a
   committed offline-PCM migration gate.

### Non-goals

- `Tone.Transport` does not become the timing authority.
- Sample playback is not migrated to `Tone.Sampler` or `Tone.Player`.
- The first delivery does not add user-facing filter, pitch, FM-index, pan, or
  effect-send envelopes. Section 5 explains how the same evaluator can later
  drive those destinations without overloading the amplitude-envelope state.
- Existing sessions with no authored override MUST keep their current sound.
- Unlooped one-shot samples do not pretend to support meaningful sustain.
- MIDI export remains the current one-click SMF Type 1 performance export. This
  release does not add a project package, stems, DAWproject, target profiles,
  loss-report UI, VST3/CLAP/AU instrument, or native DAW project generation.
  `specs/research/EXPORT-FIDELITY-RESEARCH.md` records future options but is not
  normative for v2 implementation.
- The first delivery does not add arbitrary user mapping, XY motion recording,
  sound morph snapshots, or a generic `XYPadState` to the session document.

### Architecture-only release profile

The architecture-correctness work MAY ship without exposing the new graphical
editor. The release is split into four cumulative profiles so UI readiness
cannot block correctness and UI hiding cannot disable safe playback:

| Profile | Included | Explicitly excluded | May be described as |
|---|---|---|---|
| **Core correctness** | optional canonical fields, validation/repair, protocol capability, persistence, hashing/reconnect, resolver/oracle, main/worklet scheduling, engine/sample adapters, cleanup/range/zero fixes | graphical editing, MCP/notation authoring, renderer cutover | envelope architecture and playback-correctness release |
| **Headless authoring** | Core plus MCP, notation v2.4, public syntax docs, round-trip and inactive-capability diagnostics | graphical editing | agent/text authoring preview |
| **Human editing** | Headless plus exact editor, then the D2 Shape/Start/Tail layer and its accessibility/browser evidence | renderer cutover | capability-aware envelope feature |
| **Renderer convergence** | Human editing plus approved preset cohorts, canary/rollback evidence, one-cycle retention, native deletion | unapproved presets or assets | completed ADSR overhaul |

Core readers and audio adapters MUST preserve and render valid authored state
even when graphical editing is disabled. `VITE_FEATURE_ENVELOPE_V2` is therefore
defined as an **editor-exposure flag**, separate from the always-readable
protocol/runtime capability; it SHOULD be renamed
`VITE_FEATURE_ENVELOPE_UI_V2` in a compatibility-preserving cleanup. Disabling
the UI flag hides only editing controls; it MUST NOT strip fields, decline
capability negotiation, bypass the resolver, or revert audio to legacy values.
A client that can render but not edit SHOULD show a read-only envelope summary
when authored state is present, so headless or remote edits are not invisible.

An architecture-only release is objectively valuable: it removes split-brain
state and scheduling behavior, makes reconnection deterministic, protects new
fields from old writers, and fixes defined edge-case audio failures. It does
not satisfy the original human-editing outcome and MUST NOT be marketed as
“full ADSR in Keyboardia.”

### Objective sound-quality claim

This work primarily improves **correctness, consistency, and controllability**,
not intrinsic timbre or fidelity. A shared envelope contract does not create a
richer oscillator, cleaner sample, wider bandwidth, lower noise floor, or more
natural source recording. Renderer consolidation is required to produce no
audible regression; it is not assumed to sound better.

There are nevertheless objective audible improvements where old behavior
violated an authored or existing contract:

- release no longer truncates early or substitutes a default for authored zero;
- an authored R reaches the declared endpoint and retains its measured tail;
- sampled-envelope onset is anchored after pitch-worklet latency rather than
  before audible output;
- background throttling cannot make wall-clock cleanup pin or prematurely reap
  a voice;
- shared ranges prevent different surfaces from clamping the same value
  differently;
- resolver parity prevents the same session sounding different solely because
  main-thread or worklet scheduling was selected.

Those improvements are measured as timing-landmark error, tail-energy error,
new clipping samples, stuck/late voice counts, and main/worklet or client-state
parity—not as a universal “sound quality” score. Existing sessions without an
authored override intentionally keep their preset sound, so the expected
whole-catalogue result for them is no change. Better source realism from a
validated sustain loop or release-trigger recording would be a separate asset
quality claim requiring blind listening, source/licence evidence, and resource
budget approval.

## 2. What v1 taught us

The original proposal diagnosed the architecture well, but was not yet an
executable specification. In particular:

- “Where the translate module can express it” did not define a capability
  registry, expected behavior for unsupported fields, or a conformance test.
- “Audible equivalence” had no fixtures, metrics, tolerances, or approval
  artifact. Configuration equality could pass while gain staging, filter
  motion, LFO phase, polyphony, and release curves still changed the PCM.
- Envelope scheduling exists on both the main thread and in the scheduler
  worklet. Updating one path is a silent split-brain audio bug.
- A synced field crosses more surfaces than the proposal named: client action,
  optimistic reducer, wire request and response, worker validation, canonical
  state, persistence repair, hash, broadcast classification, reconnect,
  logging, MCP schemas, fixtures, and documentation.
- UI dragging needs a transaction definition. Without it, local preview,
  server acknowledgment, pointer cancellation, and collaboration can disagree.
- Fakes can be internally consistent while lying about the real engine API.
  Contract/fidelity tests are required at every fake boundary.
- Sample attack must be anchored to audible output, not merely source start;
  the pitch worklet adds grain latency. Release tails need an explicit stop
  guard rather than an arbitrary timer.
- A control can render and sync yet still be a silent no-op for a particular
  instrument. Capability must be data, not an inference scattered through UI,
  audio, MCP, and analysis code.
- A green unit suite is insufficient. The successful test stack needs timing
  oracles, offline audio renders, two-client convergence, full-stack worker
  tests, real-browser responsive checks, schema/doc freshness checks, dead-code
  checks, and a reliable local mock session.
- A summary plus an expert curve is still a semantic jump. Users need a middle
  layer that starts from audible character and musical intent, then reveals the
  exact A/H/D/S/R model without changing state.
- A reusable gesture is not the same thing as a reusable feature. The effects,
  envelope, and synth XY presets currently have different target scopes and
  persistence guarantees; reuse needs an explicit state and transaction
  contract per mapping.
- A feature flag must state whether it gates authoring, protocol, or runtime.
  Structural separation is not evidence: run the app flag-off and prove that
  authored state still hashes, publishes, remixes, serializes, and sounds the
  same.
- A new control must not borrow another control's semantic selector or compete
  for its fixed grid cell. The envelope launcher initially reused Pattern
  Tools, breaking 14 single- and multi-client pattern contracts; one Track
  Tools launcher with an envelope entry removed the collision without widening
  the track row.
- Browser harnesses that import Vite source modules need an explicit CI owner.
  Focused Vite tests execute them; production-Worker inventories count them as
  intentional skips instead of attempting unavailable `/src` or `/e2e` routes.

These are now requirements rather than reviewer suggestions.

## 3. Locked product decisions

### 3.1 XY and slider transactions

Envelope dragging follows the existing effects batching model:

1. `pointerdown` captures the authoritative baseline.
2. Pointer movement updates a local draft and local audio preview at frame rate.
3. `pointerup` sends exactly one granular mutation containing the final value.
4. `pointercancel` or lost capture commits the last visible draft exactly once.
5. Escape restores the baseline and sends no mutation.
6. A rejected mutation restores the server value and announces the failure.

Keyboard increments are already atomic and send one mutation per key action.
No drag emits a mutation stream.

The normalized two-dimensional gesture and transaction lifecycle MAY be reused,
but mappings MUST be owned by their destination domain. Every macro declares a
visible global/track/step target, derives position from canonical state, exposes
both underlying values independently, and proves persistence and two-client
convergence. Global effect macros remain in the FX panel. Track and step macros
live beside the selected track or step. The current filter/LFO/oscillator XY
setters fan out local overrides to all advanced synths and therefore MUST NOT be
promoted as authored session features until equivalent canonical per-track
state exists.

### 3.2 Envelope model and playback behavior

“ADSR” is not the universal control surface. Keyboardia supports four explicit
amplitude models:

| Model | Meaning | Default use |
|---|---|---|
| `ad` | attack to peak, then decay to silence; note-off is irrelevant | short synthesized and sampled drums |
| `ahd` | attack, hold at peak, then decay to silence; note-off is irrelevant | natural-decay one-shots and longer percussion |
| `ar` | attack to peak, hold while gated, release from the current level | gated one-shots and simple pluck/noise models |
| `adsr` | attack, decay to sustain, hold while gated, then release | synth voices and validated looped samples |

Sample playback behavior is a separate choice:

- `trigger` ignores note-off and completes its AD/AHD shape or reaches the end
  of the buffer;
- `gate` responds to note-off and applies AR; a finite buffer may still end
  before the authored release completes;
- `loop` repeats a validated sustain region until note-off and applies ADSR.

This follows the useful split in Ableton Simpler between one-shot and classic
looped behavior and the hardware pattern of simpler drum envelopes alongside
full synth ADSR. It does not conflate a synth's mono/poly/legato voice mode with
sample playback mode.

The design synthesis is grounded in the reviewed primary product manuals:

| Inspiration | Relevant behavior | Keyboardia lesson |
|---|---|---|
| [Ableton Simpler/Sampler](https://www.ableton.com/en/manual/live-instrument-reference/) | Classic has ADSR and looping; One-Shot separates Trigger/Gate and fade controls; Sampler adds sustain/release loops | separate playback from envelope shape; loop/release regions are asset features |
| [TE OP-1](https://teenage.engineering/guides/op-1) and [original synth guide](https://teenage.engineering/guides/op-1/original/synthesizer-mode) | synths expose ADSR; drum controls use attack/gain/release/smooth rather than pretending to be a synth | choose a model appropriate to source identity |
| [TE OP-Z](https://teenage.engineering/guides/op-z/sampling) | drum sampling distinguishes gate, trigger, and loop; synth samples expose loop points | make `play` explicit for sampled voices |
| [TE OP-XY](https://teenage.engineering/guides/op-xy/instrument) | amp and filter envelopes are separate destinations | reserve `amp` in notation; do not overload future filter state |
| [Elektron Digitakt II](https://www.elektron.se/wp-content/uploads/2025/07/Digitakt-2-User-Manual_ENG_OS1.15A_250708.pdf) | AHD or ADSR plus per-trig parameter locks | support multiple models and onset-owned sparse locks |
| [Korg volca sample](https://cdn.korg.com/us/support/download/files/e518b46c4409eec373231272f6360f3d.pdf) | simple attack/decay and per-part loop behavior | drums do not require four stages to be expressive |
| [Roland TB-303](https://static.roland.com/assets/media/pdf/TB-303-Graphic-Tour.pdf) | decay, accent, slide, gate/tie behavior rather than a general amp ADSR | preserve ties/gate as first-class sequencer expression |

Every `tone:*` instrument whose real adapter passes the capability contract
uses the declared model. FM, AM, Mono, and Duo synths are expected to support
`adsr`. Membrane, Metal, pluck, and noise models MAY instead declare `ad`,
`ahd`, `ar`, or `none`. An external gain stage is acceptable only when it is
per voice and does not reshape other overlapping notes.

### 3.3 Ties and locks

A tied run is one note and one envelope. Only the onset step resolves envelope
locks. Locks on continuation steps are retained in state but ignored until that
step becomes a new onset after the tie is removed.

### 3.4 Samples

Existing sample instruments default from manifest data rather than all being
forced into AR:

- drums and other natural one-shots default to `trigger` plus AD or AHD;
- a user-selected gated one-shot uses `gate` plus AR;
- only a sample with validated loop metadata may use `loop` plus ADSR;
- a recorded release trigger is an asset layer, not the R stage. R shapes the
  outgoing gain; a release trigger starts separate recorded audio at note-off.

Unsupported authored models and fields remain round-trippable, visibly
inactive, and reported by UI, MCP, analysis, and notation. There is no silent
approximation. Existing sessions without an override retain their preset sound.

### 3.5 Learning path and musical Shape vocabulary

Envelope editing uses three progressive layers that share one canonical draft:

1. **Summary:** `Shape Pluck · Note length · Preset` plus a miniature curve.
2. **Shape:** separate `Playback` from `Character`; offer capability-aware
   `Hit`, `Pluck`, `Hold`, and `Swell` recipes plus `Start: Sharp–Gentle` and
   `Tail: Tight–Long` controls.
3. **Details:** show the exact AD/AHD/AR/ADSR model, graph, stage values, units,
   active/inactive reasons, and notation-safe representation.

The layers are views of the same state, not beginner and expert modes with
different data. Opening Details MUST be lossless. Recipes are versioned,
documented mappings to canonical values. They MUST NOT silently select Loop,
claim sustain for a finite source, or change playback behavior. Friendly labels
such as `Instant`, `Short`, `Medium`, `Long`, and beat-relative durations are
derived presentations; exact values remain editable.

The required learning sequence is hear, name, compare, combine, explain, then
explore. The four embedded exercises are: tighten a snare, lengthen a pluck,
make a pad swell, and make the looped Hammond release naturally. Animation may
show onset, phase, note-off, and tail for the selected auditioned track, but is
not the timing oracle and MUST respect reduced-motion settings.

## 4. Canonical envelope contract

### 4.1 State

```ts
type EnvelopeDuration =
  | { value: number; unit: 'seconds' }
  | { value: number; unit: 'steps' };

type TrackEnvelope =
  | { model: 'ad'; attack: EnvelopeDuration; decay: EnvelopeDuration }
  | { model: 'ahd'; attack: EnvelopeDuration; hold: EnvelopeDuration;
      decay: EnvelopeDuration }
  | { model: 'ar'; attack: EnvelopeDuration; release: EnvelopeDuration }
  | { model: 'adsr'; attack: EnvelopeDuration; decay: EnvelopeDuration;
      sustain: number; release: EnvelopeDuration };

type SamplePlaybackMode = 'trigger' | 'gate' | 'loop';

interface Track {
  envelope?: TrackEnvelope;        // absent = preset default
  samplePlaybackMode?: SamplePlaybackMode; // sampled/procedural tracks only
  gate?: number;                   // 0..100, absent = preset default (usually 90)
}

interface ParameterLock {
  attack?: EnvelopeDuration;
  hold?: EnvelopeDuration;
  decay?: EnvelopeDuration;
  release?: EnvelopeDuration;
}
```

All new fields are optional for backward compatibility. `sustain` is a
normalized level, not a time. A per-note lock is a partial override; sustain is
track-scoped in v2. The v2.3 `TrackEnvelope` plus `EnvelopeTimeUnit` shape is an
accepted legacy wire/persistence adapter, not the new canonical form.

Durations carry their own unit. This is slightly larger state, but avoids the
detached `[envUnit:...]` problem and permits a musically useful fast attack in
milliseconds with a tempo-relative release. The UI MAY offer “convert all
stages” as a convenience; conversion is explicit and never changes a bare
global unit flag.

### 4.2 Ranges and unit conversion

One runtime-neutral module owns all ranges and clamps. UI, worker, MCP,
notation, fakes, and audio adapters import it.

| Field | Seconds mode | Steps mode |
|---|---:|---:|
| Attack | 0..4 s | 0..48 sixteenth steps |
| Hold | 0..8 s | 0..96 sixteenth steps |
| Decay | 0..8 s | 0..96 sixteenth steps |
| Sustain | 0..1 | 0..1 |
| Release | 0..8 s | 0..96 sixteenth steps |
| Gate | 0..100% | 0..100% |

At tempo `bpm`, one step is `60 / bpm / 4` seconds. “Convert all stage units”
MUST convert A/H/D/R atomically so the audible durations remain unchanged at
the current tempo. It is one server mutation and one undo entry. Clamping after
conversion is reported to the user; the step ranges above cover the entire
seconds range at Keyboardia's maximum 180 BPM.

Values authored in steps scale with the tempo snapshot taken at note onset.
Values authored in seconds do not. A tempo edit does not bend an already
started voice; it affects later onsets. This keeps the resolver single-shot,
main/worklet behavior deterministic, and automation discontinuity-free.

### 4.3 Precedence

For each active field, the effective value is:

```text
onset-step lock > track override > preset value > canonical fallback
```

Locks are resolved field-by-field, so an attack lock does not discard track
decay or release. Engine adapters consume an already resolved envelope; they do
not repeat precedence logic. An authored model unsupported by the current
instrument is preserved but inactive; the preset model is effective until the
user selects a supported model or resets the override.

### 4.4 Reference amplitude behavior

Authored envelopes use one normalized evaluator with model-specific phases:

- Gain starts at `epsilon = 0.0001`.
- Attack reaches the velocity-scaled peak exactly at `onset + A`.
- AHD hold remains at peak until `onset + A + H`.
- AD/AHD decay reaches epsilon at the declared decay end and ignores note-off.
- ADSR decay reaches `peak * S` exactly at `onset + A + D` and sustain holds
  that level until note-off.
- AR holds at peak until note-off.
- AR/ADSR release starts from the analytically correct current gain, reaches
  epsilon exactly after R, and stops after a 10 ms guard.
- A, H, D, or R equal to zero is an immediate transition and MUST remain zero.
- In AR, note-off during attack, and in ADSR, note-off during attack or decay,
  releases from the current curve value without a discontinuity.
  `cancelAndHoldAtTime`, or its tested fallback, is required. AD/AHD continue
  to ignore note-off.

The initial attack and decay ramps are linear in normalized gain; release is a
bounded exponential ramp to epsilon. Velocity and track volume scale the peak
after the shape is resolved. Adapters MAY use native engine curves only when
the conformance render is within Section 8 tolerances.

Preset fallback may retain its existing engine-owned curve until that preset's
renderer migration is approved. The canonical curve is mandatory for any
authored override and for all presets after the final cutover.

### 4.5 Gate, duration, and ties

For a tied run of `N` sixteenth steps in a gated model, release starts at:

```text
onset + ((N - 1) + gate / 100) * stepDuration
```

Thus a 90% one-step note releases at 0.9 steps; a three-step tie holds two full
steps plus 90% of the third. Gate zero is valid. `trigger` playback ignores gate
and note-off. Ties across page and loop boundaries use the same formula and
MUST have explicit tests. Release may overlap later notes; voice identity, not
pitch alone, determines teardown.

The scheduler computes a pure `ResolvedNoteEnvelope` once. Both the main-thread
scheduler and worklet consume that value. The envelope anchor is audible-output
time, including pitch-worklet grain latency where applicable.

### 4.6 Voice lifetime

- No voice cleanup depends on wall-clock `setTimeout` accuracy.
- Voices are reaped against `AudioContext.currentTime` or a trustworthy ended
  event.
- Background-tab timer throttling MUST NOT pin voices or violate the cap.
- Stop time equals envelope completion plus the documented guard.
- `release: 0` MUST never fall through to a default via truthiness.

## 5. What else the envelope timeline can express

An envelope is a phase timeline, not intrinsically a volume control. The same
AD, AHD, AR, or ADSR evaluator can later drive filter cutoff, pitch, FM index,
wavetable position, pan, distortion drive, or an effect send. Those are
separate modulation destinations with their own amount, polarity, range, and
safety rules. They SHOULD share a future `EnvelopeTimeline` evaluator, but MUST
NOT reuse the amplitude-specific track state key.

For sample playback, “full ADSR” means placing a gain envelope after each
sample voice:

1. fade from silence to peak during A;
2. fall from peak to `S * peak` during D;
3. hold that level while the gate is open;
4. fade from the current level to silence during R.

That changes only the recorded waveform's loudness. It cannot undo a piano's
baked decay, recreate missing sustain, or extend a one-shot beyond its buffer.
D/S can reshape a transient and body, but sustain is useful only if audio still
exists. Truly sustained sample ADSR therefore requires a manifest-validated
loop region and held-note listening QA. A natural release additionally needs a
tail after the loop or a separately mapped release-trigger sample; neither is
implied by an R knob. Time-stretching or automatically inventing a sustain loop
is out of scope.

## 6. Capability registry and sample-source audit

This section records the product decision and audited opportunities. Every new
or replacement asset and every promotion to loop/release capability MUST also
satisfy the durable intake, mapping, browser, listening, identity, and resource
requirements in `docs/SAMPLE-INTAKE-REQUIREMENTS.md`. The actionable candidate
queue is maintained in `app/sample-lab/README.md`; neither list is permission to
ship unreviewed source material.

### 6.1 Capability schema

Capabilities are checked-in runtime data consumed by UI, MCP, analysis,
notation warnings, and tests—not duplicated conditionals. Supported envelope
models, playback behavior, and source-material features are separate axes:

```ts
interface EnvelopeCapability {
  models: Array<'ad' | 'ahd' | 'ar' | 'adsr'>;
  samplePlaybackModes?: Array<'trigger' | 'gate' | 'loop'>;
  sustainSource: 'oscillator' | 'finite-buffer' | 'sample-loop' | 'none';
  releaseSource: 'gain-only' | 'source-tail' | 'release-trigger' | 'none';
  lockableStages: Array<'attack' | 'hold' | 'decay' | 'release'>;
}
```

Sample manifests additionally describe assets; capability is derived only from
validated metadata:

```ts
interface SustainLoop {
  startFrame: number;       // decoded PCM frame in the pinned source asset
  endFrame: number;         // exclusive
  crossfadeFrames: number;  // 0 only with an explicit click-free approval
  direction: 'forward';     // reverse/ping-pong are future work
}

interface ReleaseRegion {
  file: string;
  rootMidi: number;
  velocityMin: number;
  velocityMax: number;
  roundRobin: number;
  heldDecayDbPerSecond: number; // release gets quieter the longer note was held
  gainDb: number;
}

interface SampleRegionPlayback {
  defaultEnvelope?: TrackEnvelope;
  sustainLoop?: SustainLoop;
  releaseGroup?: string;
}
```

The intake artifact records the decoded sample rate and converts pinned frames
to runtime seconds after decode; authors do not hand-edit approximate MP3
timestamps. A loop MUST satisfy `0 <= start < end <= decodedLength`, contain at
least two stable periods at the lowest served pitch, and keep the crossfade at
or below half the loop. Release regions MUST cover the declared pitch/velocity
map without ambiguous overlaps. Round-robin selection is deterministic from
session ID, track ID, onset step, and voice ordinal so collaborators and PCM
tests choose the same layer.

At note-off, R shapes the primary voice. A mapped release-trigger starts as a
separate natural-decay one-shot at the same audible clock time, with gain based
on velocity and held duration. R does not time-stretch that recording, and a
zero R does not falsely erase the recorded key/string release. The release
layer's own tail and voice cost are reported separately. Release triggers are
inactive in `trigger` playback because that mode intentionally ignores
note-off.

| Instrument path | Required declaration | Implementation rule |
|---|---|---|
| `synth:*` native presets | normally `adsr`, oscillator sustain | Native initially; approved presets migrate individually |
| `advanced:*` | declared per preset | Tone envelope adapter or conformant per-voice gain stage |
| `tone:*` FM/AM/Mono/Duo | normally `adsr`, oscillator sustain | Map every voice's amplitude envelope |
| Membrane/Metal/pluck/noise | `ad`, `ahd`, or `ar` as proven | Never use a track-global gain wrapper for polyphony |
| sampled natural one-shot | `ad`/`ahd`, `trigger`, finite buffer | Outer gain may shorten/soften but cannot create sustain |
| sampled gated one-shot | `ar`, `gate`, finite buffer | Release may be truncated by buffer end |
| sampled loop instrument | `adsr`, `loop`, sample loop | Requires validated per-region loop metadata |
| procedural one-shot PCM | `ad`/`ahd` or `ar` as proven | Baked decay remains part of PCM |
| unknown/quarantined | no models | Controls disabled; warning returned |

Each registry row MUST be backed by an instrument-matrix test that calls the
real adapter, not only a fake. Adding a preset without a capability declaration
fails CI.

### 6.2 What the shipped library actually contains

The 26 shipped sampled instruments currently contain 223 manifest regions. Of
those, only Hammond Organ's 13 regions carry loop metadata. All other manifests
have finite buffers. This is the baseline; source folder names such as
“sustain” do not upgrade a manifest to `sample-loop`.

| Shipped family | Source evidence and useful adjacent material | v2 decision |
|---|---|---|
| 808 and acoustic/brush drums | one-shot variants, velocities, round robins, open/closed hats, cymbal chokes | trigger AD/AHD; enrich articulation/choke, not ADSR |
| Martin HD28 acoustic guitar | source SFZ uses sample-specific hold plus long decay and sustain 0; no separate release layer or authored sustain loop found | trigger AHD; do not claim sustain |
| Iowa Steinway piano | chromatic pp/mf/ff natural decays; no release-trigger set identified | trigger AHD or gated AR; recorded piano release remains absent |
| Weresax alto sax | p/f layers, two mics/RRs, wind noise; derivative saxcordion/synth maps use continuous looping, while the natural sax map does not | keep finite gated sax; evaluate derivative loops only as a separately named instrument |
| VSCO French horn | sustain, staccato, and mute recordings; official SFZ uses attack/release but no loop opcode | finite gate/AR now; loop authoring requires new metadata and listening |
| VSCO string sections | sus-vib, pizzicato, spiccato, and tremolo material; official section SFZ has no loop opcode | split articulations before attempting looped ADSR |
| Meatbass-derived finger bass | pizzicato has four layers/four RRs and noises; source also has genuinely looped arco maps | current pluck stays AHD; add looped arco as a separate upright-bass instrument, not a silent identity swap |
| Growlybass-derived slap bass | sustain/staccato/scrape variants; Dirty/Angry mappings use five-RR release samples | release-trigger candidate for a sustained Growlybass variant; preserve current short-slap identity |
| Black & Green clean guitar | ordinary, staccato, hammer-on, feedback, and dense release samples; feedback has continuous loops | highest-value same-source release-trigger experiment; feedback is a separate articulation |
| VCSL marimba/kalimba/vibraphone | deeper layers/RRs; vibraphone also has soft/hard and bowed material | natural strikes use AHD; bowed material is a separate finite/loop-research instrument |
| jSteelDrum2 | more strike depth and variation, no sustain/release asset advantage identified | trigger AHD |
| setBfree/FreePats Hammond | all shipped roots already have validated loop metadata | first sampled ADSR/loop conformance target |
| procedural vinyl crackle | generated finite/continuous source under app control | declare an honest procedural mode; no external release layer |

### 6.3 Proposed-source opportunities

The existing sample lab and research registry were checked for material that
changes envelope behavior, not merely note density:

| Proposed source | Useful material | Recommendation |
|---|---|---|
| Black & Green, Emilyguitar, Shinyguitar | real release-trigger samples plus noises; Black & Green also has staccato/hammer/feedback | prioritize one narrowly curated guitar release experiment |
| Growlybass and Swagbass | sustained/staccato layers and mapped release triggers | evaluate after engine release-trigger support; do not replace the current slap identity by accident |
| Meatbass | looped arco and unlooped five-layer arco plus pizzicato | best same-license proof of looped sampled ADSR, under a new upright-arco ID |
| Greg Sullivan Pianet T | separate release samples; CP80/Wurlitzer use natural AHD-style decay | Pianet is the best proposed keyboard release-trigger candidate |
| Headroom Piano | five dynamics/two mic perspectives and envelope release control, but no release-trigger or loop mapping found | depth upgrade only; not an ADSR-enrichment source |
| Salamander Grand Piano | hammer/key-release, string resonance, and pedal-noise layers | strongest piano realism option, but CC BY 3.0, much larger payload, and outside the current CC0 posture |
| FreePats FSBS clean/direct, Bass YR, and Spanish classical | alternative pickups/finger-pick identities and size tiers; no release/loop advantage established in reviewed maps | treat as timbre/depth candidates, not ADSR evidence |
| FreePats FM Piano #1 | finite recordings of a Hexter/DX7-style patch; the source itself recommends the synthesizer for flexibility | natural AHD sample at most; prefer Keyboardia's FM engine for editable ADSR |
| FreePats VCSL tenor sax | published infinite-sustain loops | evaluate as a separately sourced looped-sax candidate if WebAudio loop QA passes |
| VSCO/VCSL | extensive articulations, velocities, and RRs | use for articulation-specific instruments; never infer loops from “sustain” filenames |
| Virtuosity/Muldjord drum sources | velocities, mic positions, bleed, and choke/mute behavior | improve drum realism and choke semantics, not ADSR |

Primary evidence was reviewed at pinned revisions: [Discord GM
`7a9c478`](https://github.com/sfzinstruments/Discord-SFZ-GM-Bank/tree/7a9c478fe331f94f246d33332f0adedb25bbbe27),
[VSCO raw `4403009`](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e)
and [SFZ `6dd651d`](https://github.com/sgossner/VSCO-2-CE/tree/6dd651d55dde97fd4028699be9d4481f26917891),
[Meatbass `ac9e859`](https://github.com/sfzinstruments/karoryfer.meatbass/tree/ac9e859564bda286ab5ec672d00ff1aa2fef2895),
[Weresax `a4d756b`](https://github.com/sfzinstruments/karoryfer.weresax/tree/a4d756b21d2a573aca0d840cce7e71ba5effd4c6),
[Growlybass `4f48326`](https://github.com/sfzinstruments/karoryfer.growlybass/tree/4f483268fc66b5a6d5781d421c0d11b8d08d3fc6),
[Black & Green `b3b3249`](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars/tree/b3b3249d37dc977a1a297bd2dc053e6d9b6b805c),
[Emilyguitar `b4920dc`](https://github.com/sfzinstruments/karoryfer.emilyguitar/tree/b4920dc662fd9cad6dcaccdeecffdd91c8725d8c),
[Shinyguitar `57243cc`](https://github.com/sfzinstruments/karoryfer.shinyguitar/tree/57243cca85277dbcc120ce17c6178032f93c80f3),
[Swagbass `9d10fca`](https://github.com/sfzinstruments/karoryfer.swagbass/tree/9d10fcae71af1975988ddecd5af1c95d372c7355),
[Headroom `2a7df3f`](https://github.com/sfzinstruments/BengtNilsson.HeadroomPiano/tree/2a7df3f7252227a3484202c1d61bc1bfe352a971),
[Greg Sullivan E-Pianos `8c3e581`](https://github.com/sfzinstruments/GregSullivan.E-Pianos/tree/8c3e581acda3594b553948ff0222d4f84a698376),
and [FSBS clean `afdffc5`](https://github.com/freepats/e-guitar-FSBS-clean/tree/afdffc528fb22f225b7ce37cf0ccfb6b401710db).
The FreePats and Iowa claims use their primary project pages. Future work MUST
re-run this audit if a source revision changes.

Before any asset is promoted, the intake artifact MUST pin the upstream commit,
license evidence, exact files, hashes, root/velocity/RR mapping, encoded size,
decoded memory estimate, onset/loop/release metadata, and an A/B disposition.

### 6.4 Sample enrichment order

1. Ship the correct models against current assets: AD/AHD for triggers, AR for
   finite gates, and ADSR only for Hammond loops.
2. Add one release-trigger vertical slice from Black & Green or Pianet T. Prove
   duration-sensitive release level, RR selection, voice accounting, and cache
   behavior before adding more assets.
3. Add Meatbass looped arco under a new instrument ID as the looped-multisample
   vertical slice. Validate every loop at low/high pitch and velocity.
4. Only then evaluate authored loops for VSCO horn/strings or Weresax-derived
   voices. A source “sustain” label is insufficient evidence.

## 7. State, sync, persistence, and rolling deployment

### 7.1 Granular mutations

The protocol defines validated granular operations for:

- `set_track_envelope` / `track_envelope_set` (full envelope or `null` reset),
- `convert_track_envelope_units` / corresponding response, with the converted
  durations included atomically,
- `set_track_sample_playback_mode` / corresponding response,
- `set_track_gate` / corresponding response,
- per-step envelope-lock changes through the existing p-lock mutation.

Every mutation carries a client operation ID. Optimistic state is reconciled by
acknowledgment or authoritative rejection. Broadcasts include the originating
player ID. Duplicate operation IDs are idempotent.

### 7.2 Required surfaces

Every new field MUST be represented in:

1. shared types and defaults;
2. client reducer and action creator;
3. request and response unions;
4. worker validation and clamp/repair;
5. canonical live-session state;
6. granular broadcast classification;
7. persistence, reload, publish, and remix;
8. canonical hash and convergence comparison;
9. reconnect/full-snapshot adapters;
10. structured logs with values redacted only where policy requires;
11. fakes/arbitraries and boundary-contract tests;
12. MCP schema fixture, docs, and generated public skill metadata.

`npm run validate:sync`, dead-export checks, schema freshness, and doc-sync tests
make this checklist executable.

### 7.3 Rolling-version matrix

| Client | Worker | Required behavior |
|---|---|---|
| v2 | v2 | Full controls and granular sync |
| v1 | v2 | Unknown optional snapshot fields preserved server-side; no envelope broadcasts the client cannot parse |
| v2 | v1 | Capability absent; controls are read-only/disabled and no optimistic mutation is sent |
| disconnected v2 | upgraded v2 | Queued supported operations replay once; stale operations reconcile by ID |

The worker advertises `track-envelope-v2`. UI and XY controls MUST gate on that
capability. An older client changing unrelated state MUST NOT erase envelope
fields. The server canonical document, not a client's partial snapshot, is the
merge authority.

Invalid persisted values are repaired through the shared validator, counted in
telemetry, and returned as clamped canonical state. Repairs do not crash session
load.

## 8. Test and verification system

### 8.1 Pure semantic oracle

A runtime-neutral module calculates:

- unit conversion;
- envelope-model and playback-mode compatibility;
- effective-field precedence;
- tied-run duration and final gate;
- amplitude at any timestamp;
- stop/reap time;
- capability-aware active and ignored fields.

Property tests cover finite/non-finite input, zero values, min/max BPM, range
boundaries, ties across boundaries, early note-off, and round-trip conversion.
They also prove that a tempo edit cannot retime an already-started voice and
does affect the next onset.
Production adapters and tests share data types, not implementation code that
would make the oracle tautological.

### 8.2 Scheduler parity

The same table-driven vectors run against:

- the pure oracle;
- the main-thread scheduler;
- scheduler worklet messages and callbacks;
- native, advanced, Tone, sample, and procedural trigger adapters.

Assertions include onset, note-off, effective A/H/D/S/R, playback mode, gate,
lock precedence, audible anchor, loop boundaries, release-trigger start, tail
end, and voice ID. Any engine path missing a vector fails the
instrument-matrix inventory.

### 8.3 Offline PCM migration gate

At 48 kHz, each affected `synth:*` preset is rendered before and after
migration using:

- pitches MIDI 36, 60, and 84 where playable;
- velocities 0.25, 0.7, and 1.0;
- gates 25%, 90%, and 100%;
- one-step, four-step-tied, early-release, and eight-voice phrase fixtures;
- neutral track bus/effects plus one representative effects-on phrase.

The harness records PCM, stage landmarks, peak, RMS, tail energy, spectral
centroid, clipping, and active-voice count. Automatic approval requires:

- envelope landmark error <= `max(5 ms, 2% of the authored stage)`;
- peak delta <= 0.5 dB;
- RMS delta <= 1.0 dB;
- release-tail energy delta <= 1.0 dB;
- median spectral-centroid delta <= 5%;
- no new samples above full scale and no dropped/stuck voices.

An exception requires a checked-in per-fixture rationale, before/after audio,
metric report, and two-person listening approval. A single global boolean is
not the approval artifact. A checked-in per-preset migration manifest controls
the renderer so presets can canary and roll back independently. The native path
is deleted only after all presets have shipped approved for one release cycle.

The full Cartesian preset matrix is a release/cutover gate, not an every-commit
gate. During an ordinary PR, CI renders changed presets plus two fixed canaries
from different engine families. Nightly CI renders the complete inventory and
publishes only metric summaries and failed/changed audio. This preserves the
original audible-equivalence requirement without multiplying routine compute,
storage, and listening cost by the entire catalogue.

Sample-loop and release-trigger approval uses a different matrix: each source
region at its root pitch, the extreme transpositions it serves, low/high
velocity, short/long gate, and two repeated cycles. Automatic checks detect DC
steps, crossfade discontinuity, periodic peak/RMS jumps, premature buffer end,
release-trigger timing, and stuck voices. A human listens to all changed loop
regions and release mappings once; later unchanged runs use hashes and metrics.

### 8.4 Collaboration and persistence

Automated tests MUST cover:

- two browsers editing different envelope fields concurrently;
- two browsers racing the same field with documented last-writer behavior;
- exactly one remote update after a drag;
- rejection/reconciliation and reconnect replay;
- old/new client-worker combinations from Section 7.3;
- reload, publish, remix, and canonical-hash convergence;
- unrelated old-client edits preserving new fields.
- a flag-off/headless client loading, preserving, rendering, publishing, and
  remixing authored envelope state without mounting an editable envelope UI.

### 8.5 UI and accessibility

Component and real-browser tests verify:

- effective preset value versus authored override and reset behavior;
- collapsed summary, musical Shape layer, and exact editor as one reversible
  draft, with model-appropriate A/H/D/S/R, per-stage duration-unit,
  playback-mode, and gate labels;
- stable Hit/Pluck/Hold/Swell recipe fixtures, friendly Start/Tail labels,
  playback/character separation, and lossless Details disclosure;
- graph/field/audio landmark agreement, reversible nonlinear time mappings,
  focus order, arrow/Page/Home/End keys, exact entry, and friendly live values;
- disabled or absent stages plus an explanation for the current model;
- no silent controls for `none` instruments;
- desktop editor, intentional portrait rotate state, and supported mobile view;
- every graph drag has a single-pointer and keyboard alternative, and targets
  meet WCAG 2.2 sizing/spacing requirements;
- track Shape XY affects only the selected track and commits once per drag;
- every XY macro exposes target scope, two exact alternative inputs, domain
  state derivation, cancellation, rejection, and two-client convergence;
- global synth XY presets remain unavailable as authored controls until their
  filter/LFO/oscillator destinations become canonical per-track state;
- a deterministic `USE_MOCK_API=1` seeded session can produce visual evidence.
- disabling the editor-exposure flag removes authoring controls without
  changing resolved audio, serialized state, MCP/notation output, or protocol
  capability; authored state has a read-only disclosure or diagnostic.

Visual screenshots are evidence for layout, not proof of audio behavior.

### 8.6 MCP, notation, and MIDI

- MCP schemas reject unknown fields, invalid ranges, missing tracks, and
  unsupported instruments; retries are idempotent.
- `get_session` returns authored and effective envelope, per-stage duration
  units, sample playback mode, gate, capability, and ignored fields.
- `analyze_session` translates step units at session tempo before describing
  articulation and reports capability limitations.
- Notation has parser/serializer/unknown-annotation round trips for the v2.4
  typed forms in Section 9.3 and import tests for the v2.3 forms
  `[env:A,D,S,R]`, `[envUnit:seconds|steps]`, `[attacks:...]`,
  `[decays:...]`, and `[releases:...]`.
- The same PR updates `specs/SESSION-NOTATION.md`: supported annotations,
  expressive boundaries, canonical JSON, mapping table, EBNF, examples,
  compatibility, and version history. A generated freshness test fails when
  parser/schema examples and the public syntax document disagree.
- The existing browser MIDI exporter, filename behavior, SMF Type 1 structure,
  GM mappings, track filtering, timing, velocity, pitch, and tie behavior remain
  unchanged and keep their current regression tests.
- New envelope models/values/units, sample playback modes, sustain loops,
  release assets, gate percentages, and envelope p-locks are not added to MIDI
  in v2. `docs/MIDI-MAPPINGS.md` and `specs/MIDI-EXPORT.md` say this plainly.
- The exporter does not invent CC72/73/75 approximations. A Keyboardia share or
  remix link—not MIDI—is the existing way to retain editable session state.

### 8.7 Required commands

Slice-specific tests run during development. Before any slice merges:

```sh
cd app
npm run typecheck
npm run typecheck:worker
npm run lint
npm run test:unit
npm run validate:sync
npm run validate:test-quality
npm run build
```

When the slice touches worker, persistence, browser, or audio integration, its
corresponding gate also runs:

```sh
npm run test:integration
npm run test:e2e:smoke
npm run test:e2e:mobile
npm run test:e2e:full-stack:smoke
npm run check:worker
```

Slice A adds stable scripts named `test:envelope:semantic`,
`test:envelope:pcm`, `test:envelope:rolling`, and `test:e2e:envelope`; later
slices MUST use those names in CI. CI fails if a discovered test is unrun, a
fake has no real contract subject, generated schemas are stale, or a production
export is dead.

All required validators MUST run in the restricted local/CI runner without
opening a privileged listener or IPC socket. Slice A replaces the current
`tsx` CLI execution path where necessary. Normal successful test output is a
concise summary; audio debug logs are opt-in or emitted on failure, not tens of
thousands of lines on every green run.

### 8.8 Cost-aware verification policy

Verification cost is a design input. CI MUST record wall time, runner-minutes,
artifact bytes, retry count, and human-review minutes per gate. The baseline is
checked in monthly; a >20% unexplained regression in any dimension blocks the
slice. The gate tiers are:

| Tier | When | Required evidence | Cost posture |
|---|---|---|---|
| T0 fast | every local change/PR | types, lint, semantic oracle, reducer/protocol unit tests, notation properties, existing MIDI regression tests | no browser, no stored PCM or large assets; target feedback in minutes |
| T1 affected integration | every relevant PR | changed engine paths, real adapter plus fake fidelity, one desktop browser, worker/persistence/sync paths touched by diff | impact-selected; no blanket catalogue render |
| T2 amortized matrix | nightly | all schedulers/instruments, browser/mobile matrix, full sync and sample metadata audit | full compute, summaries retained; audio only for deltas/failures |
| T3 release/cutover | before renderer or sample capability promotion | full PCM catalogue, all changed loops/releases, two-person listening, canary telemetry, rollback drill | deliberately expensive and infrequent |

Rules:

- Change-impact selection is generated from the checked-in engine/capability
  inventory; a developer cannot manually omit an affected path.
- Risk gates are never skipped to meet a time budget. Work is split or deferred
  instead.
- One automatic retry is allowed only for failures classified as infrastructure.
  A second failure is a flake defect and blocks merge.
- Passing PCM is represented by hashes and metrics. Full uncompressed PCM is
  not stored. Exceptions and human approvals retain compressed before/after
  comparison renders for one release cycle.
- Human listening is scoped to changed presets/assets plus fixed canaries; no
  person repeatedly auditions byte-identical assets.
- Browser screenshots prove layout only. They never substitute for timing,
  state-convergence, or audio evidence.
- The six coarse slices in Section 10 require three independent audits each:
  18 reviews total, rather than imposing audit overhead on tiny mechanical PRs.

## 9. User and agent surfaces

### 9.1 Track editor and XY pad

The accepted UI design is the capability-aware three-level editor in
`specs/research/ENVELOPE-UI-RESEARCH.md`, replacing an always-visible row of
four linear sliders.

The collapsed per-track summary leads with musical intent—for example
`Shape Pluck · Note length · Preset`—plus a miniature envelope and any inactive
authored warning. Its accessible description also reports the effective model
and sample behavior. Activating it expands a Shape editor directly below that
track on desktop and in the same semantic component as a bottom sheet on mobile.
Instrument changes immediately recalculate effective values and capability
without deleting an authored override.

The Shape layer contains:

- `Playback` choices presented separately from sound character, mapping only to
  capability-supported `Trigger`/`Gate`/`Loop` behavior;
- documented `Hit`, `Pluck`, `Hold`, and `Swell` recipes;
- `Start: Sharp–Gentle` and `Tail: Tight–Long` controls with friendly values;
- audition and comparison that animate onset, current phase, note-off, and tail
  for the selected track only; and
- a `Details` disclosure that opens the exact layer without changing sound.

The exact layer contains:

- model and `Trigger`/`Gate`/`Loop` choices restricted by capability;
- a live SVG curve built from the semantic oracle, with large direct handles;
- one exact field per active stage, with reversible nonlinear position mapping,
  editable numeric value, and per-stage `ms`/`s`/`st` unit;
- source capability, Preset/Override, inactive reason, Reset, and local audition;
- keyboard, screen-reader, and single-pointer equivalents for every drag.

The nonlinear mapping gives millisecond values usable travel while retaining
long tails; the field, not the graph coordinate, is the canonical value. The
graph and audio share pure landmark calculations but no mutable UI state. No
charting or virtual-knob dependency is added.

This structure follows research supporting multiple levels of interaction and
semantic directness, plus Ableton Learning Synths' progression from audible
experience through vocabulary and recipes to an expert playground. It also
follows WAI guidance that a custom slider needs conventional keyboard semantics
and that drag behavior needs a single-pointer alternative. The evidence and
links are retained in the research document rather than becoming implementation
folklore.

Per-step locks remain in the selected-step editor. The Envelope Shape XY target
becomes the Shape layer's optional `Start`/`Tail` performance macro, visibly
labelled with the selected track and the active stages it changes. It uses the
same unit conversion, clamp, draft, one-commit transaction, undo, and
reconciliation path as the curve and fields. It does not get a second persisted
XY position. The old global ephemeral envelope override is removed after
characterization proves no remaining caller depends on it.

Global Space, Reverb, and Delay macros remain in the FX panel because they write
synced global effects. The current Filter, LFO, and Oscillator XY presets are
local fan-out overrides across advanced synth tracks; they MUST be hidden or
clearly marked developer preview until canonical selected-track state exists.
Candidate reuse for selected-step pitch/velocity, per-track tone/movement,
mixing, four-corner morphing, and motion recording is governed by
`specs/research/XY-CONTROL-REUSE.md`; none is smuggled into this envelope slice.

### 9.2 MCP

`edit_session` supports:

```json
{
  "operation": "set_track_envelope",
  "track_id": "chords",
  "envelope": {
    "model": "adsr",
    "attack": 0.8,
    "decay": 0.3,
    "sustain": 0.85,
    "release": 3.5,
    "duration_unit": "seconds"
  },
  "gate": 90
}
```

The compact MCP input above applies `duration_unit` to all timed stages. The
canonical response expands every duration to `{ value, unit }`; a caller MAY
instead send that expanded form to mix units. `envelope: null` resets to the
preset. The response includes authored values, effective values, playback mode,
capability, and ignored fields. The operation is validated by the same code as
WebSocket mutations and has the same canonical logging.

### 9.3 Session notation v2.4

The notation names the destination (`amp`), the envelope model, and the unit of
every duration. It does not depend on a detached unit annotation or assume that
four numbers always mean ADSR:

```text
[amp:ad,2ms,400ms]
[amp:ahd,2ms,0.5st,400ms]
[amp:ar,5ms,250ms]
[amp:adsr,10ms,200ms,0.7,2st]
```

Duration tokens use `ms`, `s`, or `st`; `st` means one sixteenth-note step.
Mixed duration units are legal because units belong to values. Sustain is the
only unitless envelope value. The serializer emits the shortest decimal that
round-trips to canonical state, normalizes negative zero, and never emits a
bare duration.

Sample note-off behavior is separate from shape:

```text
[play:trigger] [amp:ahd,2ms,0.5st,400ms]
[play:gate] [amp:ar,5ms,250ms] [gate:90%]
[play:loop] [amp:adsr,10ms,200ms,0.7,2st] [gate:100%]
```

`play` means sample-voice playback, not sequencer looping or synth polyphony.
It is valid only for sampled/procedural instruments. The serializer emits
authored overrides, not derived capability defaults.

Ties belong in the pattern rather than a detached boolean. `~` is an active
continuation cell that suppresses retrigger, so `x~~~----x~------` contains two
onsets. A leading `~` is valid only when the final cell of the same cyclic track
continues into it; otherwise parsing reports a semantic error. Only the onset
cell owns envelope locks.

Per-step locks are sparse, explicit, and 1-based for musicians:

```text
[lock:1,attack,5ms] [lock:1,decay,0.5st]
[lock:9,release,2st]
```

Valid stage names are `attack`, `hold`, `decay`, and `release`. A syntactically
valid lock on an inactive stage or tie continuation is preserved and reported
as inactive. This is intentionally more verbose for a few locks and much less
error-prone than several parallel vectors whose indices can drift. Dense
machine exchange remains available through the structured JSON clipboard.

Canonical annotation order is `play`, `amp`, `gate`, then ascending `lock`
step/stage. The parser validates syntax without needing the instrument
registry; semantic validation then reports model/playback incompatibility
without deleting authored data. Unknown annotations continue to round-trip.

The v2.4 parser accepts v2.3 `[env:...]`, `[envUnit:...]`, `[gate:N]`, and dense
lock lists as legacy input. Missing legacy units mean seconds. Serialization
always emits v2.4. Tests assert semantic round-trip, stable ordering, legacy
normalization, unknown preservation, mixed units, ties at wrap, and unsupported
model warnings.

### 9.4 Original examples as executable v2.4 fixtures

The expanded executable corpus is
[`app/src/shared/__fixtures__/envelope-notation-examples.ts`](../app/src/shared/__fixtures__/envelope-notation-examples.ts),
with its coverage map in
[`specs/ENVELOPE-NOTATION-EXAMPLES.md`](./ENVELOPE-NOTATION-EXAMPLES.md).
It retains the original examples below and adds source/playback truth cases,
cyclic ties and inactive data, mixed-time polyrhythms, v2.3 migration,
boundaries/capability failures, and a complete musical performance. The Slice A
parser/serializer contract consumes these now; production notation wiring
remains a Slice D exit condition.

All five original examples remain acceptance fixtures, canonicalized as:

```text
A-Pluck:  x-x--xx-x-x--x-- [synth:pad] [amp:adsr,5ms,150ms,0.2,80ms]
A-Chords: x-------x------- [synth:pad] [amp:adsr,400ms,300ms,0.8,2.5s]
A-Swell:  x--------------- [synth:pad] [amp:adsr,2s,500ms,1,4s]

B-Acid: X-xx--x-X~xx--x- [synth:acid] [amp:adsr,1ms,120ms,0.3,50ms] [lock:7,release,800ms] [lock:15,release,1.2s]

C-Brush: o-o-o-oo-o-o-oo- [sampled:brushes-snare] [play:trigger] [amp:ahd,60ms,100ms,300ms] [lock:1,attack,120ms] [lock:3,attack,80ms] [lock:7,attack,100ms] [lock:8,attack,50ms]

D-Stab: x--x--x-x--x--x- [synth:stab] [gate:25%] [amp:adsr,1ms,200ms,0.25,150ms]
D-Pad:  x---------------x--------------- [synth:dreampop] [stepCount:32] [gate:100%] [amp:adsr,1.2s,400ms,0.9,6s]
```

Fixture E is the MCP operation in Section 9.2. Existing pitch, transpose,
tempo, and swing annotations remain unchanged. The original acid dense vector
placed its second release beside a silent cell and the brush vector was shorter
than `stepCount`; the canonical fixtures deliberately correct those alignment
ambiguities. Legacy import preserves the old data and reports inactive or
missing positions rather than guessing.

### 9.5 MIDI boundary

The v2 release keeps the existing one-click Standard MIDI File export. It
continues to export the current note/performance subset and does not acquire a
new chooser, package, render path, target profile, or import workflow.

MIDI is deliberately outside the envelope round-trip contract. The v2.4
notation and Keyboardia share/remix session are the editable representations of
the new state. MIDI retains only what the current encoder already represents;
new envelope and sample-playback fields are ignored rather than encoded as
misleading controller hints. The public MIDI documentation lists those losses.

`specs/research/EXPORT-FIDELITY-RESEARCH.md` remains a deferred decision record
if richer export becomes a separately funded feature. None of its project,
audio, DAWproject, or plug-in work is a dependency of this plan.

## 10. Implementation slices

These are logical slices; this implementation delivers them in one worktree at
the user's request. “Done” means its locally executable code, tests, docs,
generated artifacts, and multi-agent audit findings are resolved. Release
promotion remains separately evidence-gated. No slice may rely on a later slice
to make its current behavior safe.

### Slice A — Foundation, legacy correctness, and proof harnesses

**Implementation disposition:** complete locally; CI percentile telemetry will
accumulate in real CI rather than being invented from one machine.

- Check in the semantic decision record, envelope/playback/asset capability
  schema, complete preset and scheduler-path inventories, sample-source audit,
  PCM fixture manifest, sample-intake requirements, verification-cost baseline,
  and separate initial-JS/static-audio/decoded-memory baselines.
- Add the stable semantic, PCM, rolling, and browser test scripts; ensure CI
  discovers rather than silently omits their tests.
- Capture native synth PCM baselines and sample hashes before changing
  production audio. Add deterministic mock sessions and desktop/mobile visual
  fixtures.
- Add `validate:envelope-docs`, initially checking schema/example/source links;
  Slice D extends it to parser/serializer fixtures and the v2.4 public syntax.
- Fix falsy-zero handling, replace wall-clock teardown with audio-clock reaping
  in both synth engines, centralize ranges, and characterize voice caps,
  background throttling, early note-off, preview, and scheduled playback.

**Exit:** every engine/preset/sample mode is inventoried, the four original
Phase 1 boxes pass, baselines reproduce within declared platform tolerances,
existing MIDI regression tests remain green, and measured gate costs are
published.

### Slice B — Canonical state, sync, persistence, and rolling deployment

**Implementation disposition:** complete locally, including the explicit
flag-off headless conformance fixture added by the 2026-08-22 release-profile
revision.

- Add optional discriminated `TrackEnvelope`, per-duration units, sample
  playback mode, gate, and A/H/D/R p-lock fields plus the v2.3 adapter.
- Cover defaults, shared validation, repair, reducers, wire unions, worker
  handlers, operation IDs, granular broadcasts, reconnect, canonical hash,
  persistence, reload, publish, remix, logs, arbitraries, and boundary tests.
- Advertise protocol capability and execute every old/new client-worker
  combination plus two-client races and rejection/reconciliation.
- Treat `VITE_FEATURE_ENVELOPE_V2` only as editor exposure. Add the flag-off
  headless fixture proving valid v2 state still loads, renders, hashes,
  reconnects, publishes, and remixes without editable controls.
- Do not expose editable controls until the end-to-end protocol passes.

**Exit:** legacy sessions sound unchanged; new fields survive every storage and
collaboration path; old clients cannot erase them; invalid data repairs
deterministically; `test:envelope:rolling` passes.

### Slice C — Complete playback semantics across engines and samples

**Implementation disposition:** complete for engine/runtime support and the
existing catalogue. Optional new asset promotions remain correctly deferred.

- Implement the independent semantic oracle and production resolver for AD,
  AHD, AR, and ADSR, including mixed duration units, early note-off, zero times,
  gate, ties/wrap, lock precedence, audible-output anchoring, and voice IDs.
- Integrate main-thread and worklet scheduling in the same PR and run the same
  vectors against both.
- Wire every native, advanced, expressive Tone, sample, and procedural family;
  preview, scheduled playback, prewarm, switching, disposal, polyphony, choke,
  LRU, and fake-fidelity tests use real adapters as contract subjects.
- Keep finite sample defaults honest: natural triggers use AD/AHD, gated
  one-shots use AR, and Hammond is the first looped ADSR sample.
- Add one narrowly curated release-trigger sample experiment and one looped
  sample experiment behind capability flags. Promotion can occur in Slice F;
  the engine behavior and resource accounting land here.

**Exit:** oracle/main/worklet resolved events are identical; every catalogue row
has a truthful capability and audible matrix evidence; no control is a silent
no-op; long releases, loop crossfades, and release triggers stay within the
documented voice/memory budget.

### Slice D — Human and agent editing surfaces

**Implementation disposition:** core complete; D2 Shape-layer refinement
specified on 2026-08-22 and still to implement.

- Keep the shipped compact summary, semantic SVG curve, nonlinear per-stage
  fields, sample behavior, gate, Reset, inactive-authoring explanation, atomic
  conversion, undo, rejection, and reconciliation. Do not add a chart/knob
  dependency.
- Keep runtime/protocol behavior independent of editor visibility. With the UI
  flag off, hide mutation controls but preserve a read-only indication for
  authored remote/MCP/notation state and prove that audio is unchanged.
- Add the musical Shape layer between summary and exact controls, with separate
  Playback and Character, versioned Hit/Pluck/Hold/Swell recipes, Start/Tail,
  friendly values, compare/audition, phase animation, and lossless Details.
- Relocate selected-track XY attack/release as the Shape layer's Start/Tail
  macro through the same batch-per-drag mutation path; remove the characterized
  global ephemeral envelope override and do not persist duplicate XY position.
- Keep global effects macros in FX. Hide or label Filter/LFO/Oscillator presets
  as developer preview until their targets have canonical per-track state.
- Ship strict MCP edit/read/analysis, generated schemas, evaluation fixtures,
  public agent-skill metadata, and validation equivalence with WebSocket edits.
- Implement notation v2.4, v2.3 import normalization, inline ties, sparse locks,
  and unknown preservation. Update every affected section of
  `specs/SESSION-NOTATION.md` and document the deliberately lossy unchanged
  MIDI boundary in `docs/MIDI-MAPPINGS.md` in this PR;
  `validate:envelope-docs` enforces schema/parser/example freshness.
- Keep the existing one-click MIDI UI and encoder behavior unchanged; run its
  regression suite to prevent the envelope work from changing exported notes.
- Verify desktop, portrait, mobile, keyboard, screen reader, deterministic mock,
  and two-browser behavior.

**Exit:** observed novice/expert tasks show users can complete the four guided
Shape exercises, predict note-off behavior, and reach exact values without
losing state;
one drag means one mutation; remote UI/audio converge; graph/field/audio agree;
all UI, MCP, notation, and analysis surfaces agree on active/inactive
semantics; the deliberately narrower MIDI export stays unchanged and its
regression tests pass; generated artifacts, public syntax, and visual evidence
are current.

### Slice E — Renderer migration by reversible cohorts

**Implementation disposition:** migration mechanism and all 32 fail-closed
records complete; production cohort promotion awaits external T3 evidence.

- Structurally translate small cohorts of `synth:*` presets using the shared
  resolver and per-preset migration manifest.
- For every cohort, run changed-preset plus canary PCM in PR CI, full nightly
  PCM, and the T3 complete catalogue before promotion. Retune only with a
  checked-in exception artifact and two-person listening approval.
- Canary each cohort, monitor clipping, stuck/late voices, CPU/voice growth, and
  rollback success. A failing preset remains native without blocking approved
  cohorts.
- The native path remains available throughout this slice; this is the explicit
  explanation for the earlier “renderer cutover deliberately disabled” state.
  The first implementation had new controls and translation code, but lacked
  audible-equivalence evidence across all presets, so enabling the cutover
  would have converted an unverified structural refactor into a product-wide
  sound change.

**Exit:** every enabled preset has machine metrics, listening evidence, canary
telemetry, and a tested rollback entry; no unapproved preset is silently routed.

### Slice F — Asset promotion, final cutover, and consolidation

**Implementation disposition:** release decisions, feature flags, intake
contract, runtime support, resource accounting, and cleanup validators complete.
New asset promotion and native-renderer deletion are withheld until the T3
release conditions below actually occur.

- Decide the release-trigger and looped-sample experiments through blind A/B,
  exact license/commit/hash intake, payload and decoded-memory budgets, loop
  audition, release matching, and mobile-cache tests. Promote only separately
  named instruments when identity changes.
- Migrate remaining synth presets; run the full published-session corpus and T3
  release gate; keep the canary for one release cycle.
- Remove native analytical amplitude mirroring, the global ephemeral envelope,
  legacy write paths, and duplicate renderer code only after rollback and
  retention conditions are satisfied. Keep v2.3 read compatibility for the
  documented deprecation window.
- Retain custom sample scheduling and the custom transport. Archive approvals,
  metrics, and rollback data; run dead-export and generated-file checks.

**Exit:** all original traceability rows are green, every synth preset uses the
approved renderer, promoted sample capabilities match their manifests, there is
one synth amplitude-envelope implementation, and no P0-P2 audit finding or dead
production path remains.

## 11. Multi-agent audit protocol

At the end of every slice, three independent reviews run before reconciliation:

1. **Audio/timing reviewer:** curve math, clock domains, voice lifecycle,
   scheduler/worklet parity, PCM evidence.
2. **State/protocol reviewer:** validation, persistence, hashing, rolling
   versions, reconnect, MCP/schema equivalence.
3. **Product/test reviewer:** UI transactions, accessibility, responsive
   behavior, notation/MIDI, test independence, fake fidelity, unrun tests.

Reviewers receive the spec and diff but not one another's conclusions. Findings
are merged into a severity/owner/evidence table. The implementation author
reproduces every P0–P2 finding, fixes or rejects it with evidence, and reruns the
affected gate. Agents may discover problems; only executable evidence closes
them.

The final integrated audit followed this protocol. It produced 19 P1/P2
findings across the three domains, all of which were reproduced, fixed, and
covered by regression evidence; there was no P0 and no unresolved P0–P2. The
finding-by-finding ledger is
`artifacts/envelope-v2-multi-agent-audit.md`.

## 12. Traceability to every original box

| Original requirement | v2 owner |
|---|---|
| Falsy-zero fix | Slice A |
| Audio-clock voice cleanup in both engines | Slice A |
| One release convention | Slices A and C |
| Central ranges and XY agreement | Slices A and D |
| Canonical `TrackEnvelope` session state | Slice B |
| Defaults like `fmParams` and rolling posture | Slice B |
| Granular validated sync | Slice B |
| Shared translate module and property/PCM tests | Slices A and C |
| Selected-track synced XY; delete ephemeral override | Slices D and F |
| Beginner-to-expert Shape learning layer and reusable-XY governance | Slice D2 |
| Per-track full-envelope editor | Slice D |
| MCP edit/read/analysis | Slice D |
| Session notation, upgraded to v2.4 with v2.3 import and public syntax-doc refresh | Slice D |
| Document the existing MIDI export's non-carryability without expanding it | Slice D |
| Fold `synth:*` into advanced engine | Slices E and F |
| Per-preset PCM migration gate and retuning | Slices A, E, and F |
| Keep sample path custom; consume honest AD/AHD/AR/ADSR | Slices C and F |
| Per-step A/D/R locks, plus H where active | Slices B, C, and D |
| Per-track gate | Slices B, C, and D |
| Tempo-relative times | Slices B, C, and D |
| Do not adopt Tone transport | Non-goals and all scheduler slices |
| Preserve preset defaults when override is absent | Slices B, C, and E |

The original five-phase sequence is also preserved at a coarser level: Phase 1
correctness is Slice A; Phase 2 canonical state is Slices B-C; Phase 3 UI, MCP,
and notation exposure is Slice D; Phase 4 renderer convergence is Slices E-F
with an explicit evidence-gated cutover; and Phase 5 step-native expression is
implemented across Slices B-D.

## 13. Costs, downsides, and stopping rules

This design is more truthful than applying four knobs everywhere, but it costs
more than a universal cosmetic ADSR.

### 13.1 Runtime and asset costs

- Per-voice gain automation adds nodes/events and cleanup work. Long releases
  increase simultaneous voices and make voice stealing more audible.
- A crossfaded sample loop can require two overlapping sources per voice.
  A release-trigger layer briefly adds another source. Together they can more
  than double peak sampled-voice count, CPU, and decoded-memory pressure.
- Dynamic layers, round robins, sustain material, and release recordings grow
  download, cache, repository, decode, and mobile-memory cost. Encoded size is
  not the budget; decoded PCM and peak concurrent voices are.
- Tempo-relative stages require a policy at tempo changes. Live retiming is
  more expressive but risks discontinuities and automation churn. v2 snapshots
  tempo for the entire voice at note-on; the new tempo applies to later voices.

The measured 2026-08-03 baseline is 13.12 MiB of encoded production audio
across 223 files and 914 seconds. Decoding the whole catalogue would be about
275.8 MiB of `Float32` PCM. These files are copied as static deployment assets
and fetched per selected instrument, so sample additions do not belong in the
initial JavaScript bundle—but “not JS” does not mean free: they increase the
deployed site, offline/cache storage, selected-instrument transfer, background
decode, and eviction pressure.

At the current mean bitrate, another minute is approximately 0.91 MiB encoded.
At 44.1 kHz it is about 10.1 MiB decoded mono or 20.2 MiB decoded stereo. A
hundred one-second stereo release recordings are therefore modest on the wire
but roughly 33.6 MiB if all remain decoded, already larger than the normal iOS
cache. Candidate decisions use measured values, not these planning estimates.

The 2026-08-03 production build preloads 218.1 KiB of gzipped JavaScript and
already exceeds the older `< 200KB` target in `specs/STATUS.md`. The complete
build directory is 14.33 MiB, of which 13.12 MiB is sample audio. The editor is
reached through the code-split StepSequencer path, and the UI should have a
small JavaScript impact: the curve is repository-native SVG/CSS and shared pure
functions. Slice A records initial and lazy gzipped JS by chunk; Slice D fails
if sample audio enters the module graph, a new chart/knob dependency appears,
the editor breaks that lazy boundary, or any chunk grows without a reviewed
attribution and budget disposition.

Each promoted instrument therefore needs explicit limits for encoded bytes,
decoded bytes, preload latency, ordinary and worst-case voices, and release
tail. Promotion stops if a supported mobile device exceeds the agreed audio
glitch, memory, or first-play budget.

### 13.2 Musical and product downsides

- An outer envelope cannot recover sustain that was not recorded. A long S on
  a piano or plucked guitar may only hold the dying noise floor.
- Loops can sound periodic, freeze bow/breath evolution, phase at crossfades,
  or expose codec boundaries. A mathematically smooth loop can still sound
  artificial.
- Recorded release samples are not the R stage. They must match pitch,
  velocity, note duration, pedal/choke state, and gain; a mismatch can sound
  more fake than a simple fade.
- AHD/AD/AR/ADSR plus trigger/gate/loop is more terminology and UI than four
  universal sliders. Capability explanations and good preset defaults are
  mandatory to avoid intimidating users.
- A two-axis macro trades precision for immediacy and couples two edits. Bad
  mappings create accidental changes, poor recall, and accessibility work. XY
  is therefore optional, target-scoped, and backed by independent exact inputs;
  not every pair of parameters should become a pad.
- Per-stage time units are precise and notation-safe, but increase schema,
  editing, and MCP complexity. The UI should default all stages together and
  reveal mixed units only when authored.
- Envelope p-locks can create sharp level changes and very long overlapping
  tails. They complicate voice caps, analysis, undo, and collaboration.
- Changing a source to gain release layers or loops can change instrument
  identity. Meatbass arco is not “finger bass,” and sustained Growlybass is not
  the current short slap sound. New identities need new IDs and human A/B.
- MIDI cannot faithfully carry most of this state. Exports remain playable but
  omit the new envelope, playback-mode, gate, loop/release, and p-lock
  expression. That is an accepted v2 limitation, documented rather than hidden
  behind controller mappings that receivers interpret inconsistently.

### 13.3 Engineering and verification costs

- The state crosses client, worker, persistence, hash, reconnect, MCP,
  notation, analysis, generated docs, main scheduler, and worklet. Every new
  model multiplies boundary cases.
- Offline audio comparisons are sensitive to browser/audio-engine revisions,
  codec delay, random modulation, and floating-point noise. Baseline review and
  deterministic seeds become permanent maintenance work.
- Human listening is the scarce resource. Loop periodicity and release realism
  cannot be fully automated, so asset breadth must be curated rather than
  maximized.
- Rolling deployment and authored-but-inactive data are safer, but they require
  more protocol branches and clearer error reporting than destructive coercion.

The cost controls in Section 8.8 are normative. If the T2 matrix cannot finish
reliably in its measured nightly window, reduce catalogue/fixture duplication
using pairwise coverage and fixed canaries; do not delete the semantic,
scheduler-parity, rolling, or release-cutover gates. If two listening reviewers
cannot distinguish an enriched asset from the simpler current version, prefer
the smaller implementation and asset set.

## 14. Implementation blockers and release gates

The original architectural blockers are closed in code. The later product-design
review found two narrower UI/scope blockers: the missing musical middle layer
and global ephemeral synth XY mappings that look more durable than they are.
The earlier verification gap between runtime and editor visibility is now
closed by semantic and browser flag-off fixtures plus exact publish/remix state
comparison. The app can ship the v2 state, exact editing, notation, and truthful
sample behavior without silently rerouting every existing synth preset or
importing unapproved audio, but the full product definition is not complete
until D2 lands.

| Former blocker | Implemented disposition |
|---|---|
| Fixed four-number ADSR and detached unit | Discriminated AD/AHD/AR/ADSR with per-duration units, legacy repair, and `track-envelope-v2` rolling capability |
| Synthetic full ADSR for finite samples | Complete 99-ID capability registry with trigger/AHD, gate/AR, loop/ADSR, or explicit unsupported semantics |
| Continuously mutating four-slider editor | Exact capability editor with typed durations, atomic unit conversion, Reset, keyboard support, and one commit per pointer transaction; D2 adds the missing musical Shape layer |
| Generic-looking XY presets with unequal state guarantees | Effects and selected-track envelope mappings have canonical batch commits; D2 relocates Shape and hides/labels global ephemeral synth mappings until per-track state exists |
| Raw sample source without note-off ownership | Managed voice owns body blends, loops, release regions, audio-clock cleanup, deterministic stealing, and completion |
| Main/worklet and renderer timing split | Shared resolved-note-event v2 contract with parity and audible-output anchor tests |
| Timestamp-only loops and no release schema | Decoded-frame sustain-loop validation plus release-group/velocity/round-robin schema; unsupported crossfades degrade truthfully |
| Formatter-only notation | v2.4 parser, canonical serializer, legacy importer, seven executable examples, public grammar, and live Copy Notation export |
| Missing/expensive/unrun verification | Stable semantic, PCM, rolling, browser, full-stack, inventory, dead-export, schema, docs, and resource gates with measured local costs |
| Restricted-runner IPC and noisy green tests | IPC-free validator entry points and quiet full-suite command |
| Unbudgeted asset candidates | Sample-intake packet, machine budget fields, source research, TODO candidates, and explicit defer decision |
| Rolling-state data loss risk | Old/new fixtures, granular operations, canonical hash, persistence/reconnect preservation, and editing hidden from incapable workers |

### 14.1 What remains

Two locally executable UI tasks remain, followed by release-evidence work that
depends on complete local renders, observed users, or production time:

1. Implement the three-layer Summary → Shape → Details flow, versioned recipes,
   Start/Tail labels, selected-track phase audition, and the four guided tasks.
2. Move the envelope macro beside its track; retain global effects macros; hide
   or explicitly mark global Filter/LFO/Oscillator XY as developer preview until
   canonical per-track state and reconciliation exist.
3. Generate the full per-preset T3 PCM matrix and retain metric reports for the
   exact release revision.
4. Obtain two independent listening approvals per promoted cohort, record
   canary telemetry, and perform the rollback drill.
5. Keep the approved renderer canary alive for one real release cycle before
   deleting the native rollback route.
6. For any new release or loop sample, pin exact source/license/hash data, run
   blind A/B and mobile memory/first-use tests, then approve its separate asset
   packet.
7. Measure CI p50/p95, retry rate, artifact storage, runner spend, and human
   listening minutes from the actual CI/release environment.

Until those facts exist, `isSynthRendererApproved` fails closed per preset, all
32 published synths remain native, both optional sample experiments default
off, and the asset decision records zero new audio bytes. That is successful
implementation of the safety policy, not a disabled or half-wired feature.

## 15. Release definition of done

The **Core correctness** profile is independently releasable when:

- absent overrides reproduce current preset behavior;
- authored state passes semantic, scheduler-parity, cleanup, range, zero,
  rolling-version, persistence, hash, publish, and remix gates;
- the editor-exposure flag-off fixture proves the same state and resolved audio
  with and without editable controls;
- every active adapter declares capability and consumes one resolved note
  event; and
- release notes call it an architecture/correctness release and make no global
  timbre, fidelity, renderer-convergence, or full-UI claim.

The **completed overhaul** requires the later profiles and is complete only
when:

- every traceability row is green;
- every preset has a capability and real-adapter test;
- unit, integration, full-stack, worker, desktop, and mobile gates pass;
- Summary, Shape, and Details are one reversible draft; the four guided tasks
  pass with novice and experienced users using pointer, touch, and keyboard;
- every shipped XY macro declares target scope and canonical state, exposes two
  exact alternatives, and passes batch, cancel, rejection, persistence, and
  two-client convergence tests;
- the original example sessions parse and behave as documented;
- notation v2.4 round-trips and every v2.3 example imports canonically;
- `specs/SESSION-NOTATION.md` describes the shipped v2.4 grammar/examples and
  passes generated documentation-freshness validation;
- the existing one-click MIDI export passes its regression suite unchanged and
  the public MIDI documentation explicitly lists the v2 fields it omits;
- two-client sound state converges across reconnect and rolling versions;
- all `synth:*` PCM approvals exist and the canary period has passed;
- every promoted loop/release asset has pinned source/hash/license, resource
  budgets, the completed sample-intake packet, machine metrics, and listening
  disposition;
- native analytical amplitude mirroring and global ephemeral envelope
  overrides are removed;
- MCP fixtures, public agent skill docs, notation, MIDI docs, and screenshots
  are current;
- dead-export, unrun-test, test-antipattern, sync-checklist, and generated-file
  validations pass;
- the final three-agent audit has no unresolved P0–P2 finding;
- CI cost telemetry is within the approved budget or has a checked-in,
  owner-dated exception.
