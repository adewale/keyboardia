# Spec: ADSR Overhaul — Unify Envelope Semantics, Make Envelopes Session State

**Status**: PROPOSED
**Date**: 2026-08-02
**Related**: `SYNTHESIS-ENGINE.md`, `HELD-NOTES.md`, `SESSION-NOTATION.md`,
`research/TONEJS-COMPARISON.md`, `research/AUDIO_ENGINEERING_101.md` §7,
`../docs/AUDIO-ENGINEERING-PATTERNS.md`

## Overview

ADSR envelopes are implemented three times (native Web Audio synth, Tone.js
advanced synth, sampled-instrument scheduling), are not part of the synced
session document, and are only partially controllable (attack + release,
advanced-synth tracks only, globally rather than per track, ephemeral). This
spec catalogs the concrete bugs in the current implementations and proposes a
phased plan: fix the bugs, promote the envelope to first-class per-track
session state behind one canonical type, expose it in the UI and MCP, then
consolidate the synth engines.

## Goals

1. **One meaning for "release: 0.3"** — a single canonical envelope type and
   one translate module, so envelope values mean the same thing on every
   engine and every preset is portable.
2. **Restore the multiplayer invariant** — envelope changes sync like every
   other sonic dimension; two collaborators always hear the same music.
3. **Persistence and publishability** — envelope moves survive reload, are
   captured by publish, and carry through remix.
4. **Per-track, full-envelope control** — all four ADSR stages editable per
   track (today: two stages, all advanced tracks at once, ephemeral).
5. **Agent parity** — MCP agents can read and shape envelopes, not just swap
   presets whose envelopes are baked in.
6. **Step-sequencer-native expression** — per-step envelope locks, gate time,
   and tempo-relative times, following the hardware idioms
   (Elektron/OP-1/303) our tie implementation already follows.
7. **Fewer envelope implementations** — retire the hand-rolled analytical
   mirror in the native engine, the source of our worst envelope bugs.

## Motivating Questions & Insights

This spec came out of four questions asked while auditing the current ADSR
handling. Recording them here because the answers, not the bullet list of
fixes, are the actual rationale.

### Q1: What would be better/worse if we switched to Tone.js for everything?

- The 2025-12 `research/TONEJS-COMPARISON.md` recommended staying native, but
  its premises are stale: we now ship `tone@15.1.22` for the advanced synth,
  `tone:*` presets, and the effects chain. The bundle-size argument is
  already conceded; the marginal cost of using Tone more is near zero.
- The two worst envelope bugs in our history were both in hand-rolled paths:
  the release-collapse bug (reading `AudioParam.value` at note-off) that
  forced the `holdAtTime`/`amplitudeAt` analytical-mirror machinery, and
  bug_009 (envelope anchored before the pitch worklet's grain latency).
  Consolidating to `Tone.AmplitudeEnvelope` deletes the first class of trap
  entirely.
- But "everything" is unreachable: the sample path (pitch worklet, choke
  groups, LRU cache, manifest `releaseTime`) has no Tone equivalent, and
  migrating `synth:*` presets changes how published sessions sound — Tone's
  default curves differ from our exponential ramps and `release/4` time
  constants. Offline PCM tests get harder under Tone's global-context model.
- **Insight**: the strongest version is "one *synth* engine", not "Tone for
  everything" — fold `synth:*` into the Tone-based advanced engine with a
  per-preset render-comparison gate, keep samples custom, and never adopt
  `Tone.Transport` (our scheduler stays the timing authority).

### Q2: How can users use ADSR through our UI or MCP server today?

- Barely, and unevenly. Preset choice is the primary lever (every preset is a
  baked envelope). The XY pad's Envelope Shape maps attack/release only, hits
  only advanced-synth tracks, applies to all of them at once, and lives in
  ephemeral engine overrides — not synced, not persisted, not publishable.
- Per-step controls interact with the envelope rather than shaping it:
  velocity/volume p-locks scale the peak, `tie` suppresses re-attack.
- MCP has **zero** envelope access: `edit_session` supports only `add_track`,
  `set_track_instrument`, `set_steps` (booleans), and `set_tempo`; an agent
  cannot make a pad swell or tighten a bass release except by swapping
  presets. `analyze_session` doesn't report envelope character either.
- **Insight**: decay and sustain are unreachable *everywhere*; the envelope
  is the only major sonic dimension with no session-state representation —
  effects, FM params, volume, transpose, and swing all sync, envelopes don't.

### Q3: How does ADSR normally work in step synthesizers?

- The gate drives the envelope: a trig opens it, gate time (often a per-step
  % of the step) closes it. At 16ths/120 BPM a step is 125ms, so sustain is
  reached only when the gate outlasts attack + decay — decay dominates at
  step timescales, which is why hardware simplifies to AD/AHD shapes
  (Elektron amp pages, 303, Volcas).
- Ties/slides suppress retriggering so envelopes breathe across steps (303
  slide, Elektron trigless trigs, OP-1 hold — `HELD-NOTES.md` cites the
  OP-1's ADSR + hold directly). Our `tie` p-lock is exactly this idiom.
- Per-step parameter locks on envelope params are the Elektron innovation;
  accent scaling the envelope peak is universal (our velocity lane matches).
- **Insight**: we are already idiomatic on durations, ties, and accent. The
  gaps are gate time, per-step envelope locks, user-facing decay/sustain, and
  tempo-relative envelope times (presets are tuned for 120 BPM and drift
  musically at other tempi).

### Q4: What's wrong with our current approach?

- Three parallel implementations of one concept (plus decay curves baked into
  procedural PCM in `samples.ts`), each with its own bug class and its own
  meaning for "release".
- The native engine maintains duplicated truth: scheduled automation and the
  analytical `amplitudeAt`/`filterFrequencyAt` must agree exactly; drift is a
  silent audible bug — that is precisely how the release-collapse bug
  happened.
- Concrete small defects: a falsy-zero release default (`release || 0.5`),
  wall-clock `setTimeout` voice cleanup racing the audio clock, release-tail
  truncation that contradicts the documented semantics, and XY ranges that
  silently disagree with the type's documented ranges.
- **Insight**: the root cause of the user-facing problems is architectural,
  not audio-DSP: the envelope was never promoted into the session document,
  so every control surface built on top of it (XY pad, future MCP ops)
  inherits ephemerality and non-syncing.

## Current State

### Three envelope implementations

| Path | Mechanism | "release: 0.3" means |
|------|-----------|----------------------|
| Native synth (`synth.ts`) | Hand-scheduled `AudioParam` ramps; analytical mirror (`amplitudeAt`/`filterFrequencyAt`) + `holdAtTime` for note-off | `setTargetAtTime` with time constant `0.3 / 4` (asymptotic; hard stop at `release + 0.05s`) |
| Advanced synth (`advancedSynth.ts`) | `Tone.AmplitudeEnvelope` + `Tone.Envelope` per voice | Bounded ramp over the full 0.3s, Tone curve semantics |
| Sampled instruments (`note-schedule.ts`, `sampled-instrument.ts`) | Fixed 3ms linear attack declick; exponential release to 0.001 over manifest `releaseTime` | Exponential ramp over 0.3s, then hard stop after a 10ms guard |

A fourth expression: procedural drums in `samples.ts` bake exponential decay
curves directly into generated PCM.

The shared `ADSREnvelope` type (`synth-types.ts`) documents attack/decay
0.001–4s and release 0.001–8s, but no consumer enforces or reaches those
ranges.

### Where users can touch ADSR today

- **Preset choice** — every instrument carries a baked, hand-tuned ADSR. This
  is the primary (nearly only) lever.
- **XY pad "Envelope Shape"** (`xyPad.ts`) — X = attack 1ms–1s, Y = release
  50ms–2s. Three limitations: affects only advanced-synth tracks
  (`engine.setAttack` iterates `advancedSynthRegistry` only); applies globally
  to all advanced tracks at once; and lives only in engine overrides — not in
  the session document, so it is not synced, not persisted, and not
  publishable.
- **Per-step interaction, not shaping** — velocity/volume p-locks scale the
  envelope peak and sustain; the `tie` p-lock continues a note without
  re-attacking.
- **MCP: nothing.** `edit_session` supports `add_track`,
  `set_track_instrument`, `set_steps` (booleans only), and `set_tempo`. An
  agent's entire envelope vocabulary is swapping presets, and
  `analyze_session` does not report envelope character.

Decay and sustain are unreachable everywhere.

### The multiplayer inconsistency

`EffectsState` is synced specifically because "everyone hears the same music"
(`sync-types.ts`). `fmParams`, volume, transpose, and swing are synced.
Envelope overrides are the one sonic dimension that is local-only: two
collaborators looking at the same session can hear different music the moment
one of them rides the Envelope Shape pad.

## Problems

### Bugs

1. **Falsy-zero release default** — `advancedSynth.ts`
   (`scheduleVoiceRelease`): `this.preset?.amplitudeEnvelope.release || 0.5`
   treats a legitimate `release: 0` as 0.5s for voice-lifetime purposes.
   Should be `??`.
2. **Wall-clock voice cleanup** — both engines schedule voice teardown with
   `setTimeout` computed from audio-clock arithmetic. Background-tab timer
   throttling delays cleanup relative to the audio clock, releasing voices
   late and pinning the voice cap.
3. **Undocumented release truncation** — native `stop()` hard-stops
   oscillators at `release + 0.05s`, but `setTargetAtTime` with time constant
   `release / 4` has only decayed ~98% by then. Usually inaudible, but the
   tail shape is not the "release seconds" the type documents, and it
   diverges from the Tone engine's bounded-ramp semantics.
4. **Range drift** — XY pad clamps attack ≤ 1s / release ≤ 2s while
   `synth-types.ts` documents ≤ 4s / ≤ 8s. No shared constant; the numbers
   disagree silently.

### Architecture

5. **Three implementations of one concept** with divergent semantics. The two
   worst envelope bugs in the repo's history were each specific to one
   implementation: the release-collapse bug (reading `AudioParam.value` at
   note-off — see `synth-envelope.render.test.ts`) and bug_009 (envelope
   anchored before the pitch worklet's grain latency — see
   `envelope-anchor.ts`).
6. **Envelope is not session state.** Not persisted, not synced, not
   publishable, invisible to MCP. Root cause of the multiplayer inconsistency
   above.
7. **Duplicated truth in the native engine.** The scheduled automation and
   the analytical `amplitudeAt`/`filterFrequencyAt` must agree exactly; any
   drift is a silent audible bug. Well-tested today, but a standing trap for
   every future edit.
8. **Partial control surface.** A and R only, advanced tracks only, global
   only, ephemeral only. D and S exist in every preset but no user or agent
   can touch them.

## Proposal

Phased; each phase ships independently.

### Phase 1 — Bug fixes (small, independent)

- [ ] `advancedSynth.ts`: `release || 0.5` → `release ?? 0.5`.
- [ ] Replace wall-clock `setTimeout` voice cleanup with audio-clock-checked
      reaping (periodic reaper or `ended`-event driven) in both engines.
- [ ] Pick one release convention. Recommended: keep `setTargetAtTime` but
      stop at `release × 1.5` (~99.75% decayed), and document that native
      release is a time constant of `release / 4`; or switch native release
      to a bounded exponential ramp matching Tone. Either way, one documented
      meaning.
- [ ] Centralize envelope ranges in `SYNTH_CONSTANTS` and make the XY pad and
      type docs agree.

### Phase 2 — Canonical envelope as session state (the core change)

- [ ] Add to `sync-types.ts`:

      ```typescript
      /** Per-track amplitude envelope override. Absent = preset default. */
      export interface TrackEnvelope {
        attack: number;   // seconds, clamped to shared range
        decay: number;
        sustain: number;  // 0–1 level
        release: number;
      }
      ```

- [ ] Add optional `envelope?: TrackEnvelope` to `Track` /
      `SessionTrack`, defaulting to the preset's baked values — same
      pattern, validation path, and rolling-deploy posture as `fmParams`.
- [ ] Sync it through the existing granular mutation path
      (`set_track_envelope` message + `track_envelope_set` response),
      worker-validated against the shared clamp.
- [ ] One shared translate module (`audio/envelope-translate.ts`): canonical
      `TrackEnvelope` → each engine's dialect (native ramp parameters, Tone
      envelope fields, sample attack/release). Property-test the clamps;
      offline-render-test the audible equivalence claims.
- [ ] Route XY pad `attack`/`release` writes to the selected track's synced
      envelope instead of ephemeral global engine overrides. This fixes
      local-only, global-across-tracks, and lost-on-reload at once. The
      engine `advancedOverrides` path for envelope fields is then deleted.

### Phase 3 — Expose it (UI + MCP + notation)

- [ ] Per-track envelope editor (four sliders or a drag-editable A/D/S/R
      curve) in the track controls, populated from the effective envelope
      (override ?? preset).
- [ ] MCP: add `set_track_envelope` to `edit_session` operations, validated
      by the same shared clamp; include effective envelope values in
      `get_session` and envelope character in `analyze_session` so agents can
      read and shape the dimension rather than only swapping presets.
- [ ] Extend `SESSION-NOTATION.md` (v2.3) with a track-level `[env:A,D,S,R]`
      annotation in the style of `[fm:H,M]`, mapping to `track.envelope`.
- [ ] MIDI export: document envelope as a listed non-carryable feature
      (matching the existing "report rather than approximate" posture).

### Phase 4 — Engine consolidation (after 2, independently valuable)

- [ ] Fold `synth:*` presets into the Tone-based advanced engine so there is
      one synth envelope implementation, deleting the
      `holdAtTime`/`amplitudeAt` analytical-mirror machinery (problem 7).
- [ ] Migration gate: per-preset offline PCM renders (extend
      `synth-envelope.render.test.ts`) compared before/after; retune presets
      whose renders drift audibly. This is a one-time, bounded retuning cost —
      published sessions must not change character silently.
- [ ] Keep the sample path custom (pitch-worklet latency compensation, choke
      groups, LRU cache, manifest `releaseTime` have no Tone equivalent), but
      have it consume `TrackEnvelope` attack/release through the shared
      translate module.

### Phase 5 — Step-native features (highest musical payoff, needs 2)

- [ ] Per-step envelope p-locks: optional `attack`/`decay`/`release` on
      `ParameterLock` — Elektron-style, and the plumbing is already shaped
      for it. Notation: per-step lists mirroring `[pitches:...]`, e.g.
      `[releases:...]` with `-` for unlocked steps.
- [ ] Per-track gate time (% of step before release starts) so note length is
      not purely grid-derived and `tie` is not the only lengthener. Notation:
      `[gate:75]`. Note: `REMOVE-GATE-MODE.md` removed *sample gating at step
      boundaries*; this is the different, synth-oriented control that spec's
      research cited as the industry-standard articulation model.
- [ ] Optional tempo-relative envelope times (release expressed in step
      fractions) so presets tuned at 120 BPM stay musical at other tempi.

## Example Sessions

What the phases unlock, in `SESSION-NOTATION.md` notation. The `[env:...]`,
`[releases:...]`, and `[gate:...]` annotations are the proposed v2.3
extensions from Phases 3 and 5; everything else is current notation. Unknown
annotations degrade gracefully per the notation spec, so these examples are
shareable today and gain meaning as phases land.

### A. One preset, three characters (Phase 2+3: per-track envelopes)

The same `synth:pad` preset serving as pluck, chords, and swell — impossible
today because the envelope is baked into the preset and XY tweaks hit every
advanced track at once, ephemerally.

```
[bpm:110]
Pluck:  x-x--xx-x-x--x-- [synth:pad, env:0.005,0.15,0.2,0.08, pitches:12,15,12,10,15,12,10,8]
Chords: x-------x------- [synth:pad, env:0.4,0.3,0.8,2.5]
Swell:  x--------------- [synth:pad, env:2.0,0.5,1.0,4.0, transpose:-12]
```

`Pluck` is a tight 5ms-attack stab; `Chords` breathes over two beats;
`Swell` takes two seconds to bloom and four to fade — one instrument, three
envelope identities, all synced, persisted, and publishable.

### B. Acid line with per-step release locks (Phase 5: envelope p-locks + ties)

The 303 move: mostly choked 50ms releases, with two steps locked long so
they sing, and a tie for the slide. Accents (`X`) scale the envelope peak as
they already do today.

```
[bpm:130, swing:55]
Kick: x---x---x---x---
Hat:  --x---x---x---x-
Acid: X-xx--x-X-xx--x- [synth:acid, transpose:-12, env:0.001,0.12,0.3,0.05,
                        pitches:0,0,12,-,-,3,0,0,0,12,-,-,5,0,-,-,
                        releases:-,-,-,-,-,-,0.8,-,-,-,-,-,-,1.2,-,-]
```

Steps 7 and 14 escape the choke and ring over the groove; everything else
stays tight. Today this requires two tracks and still can't be expressed.

### C. "Mr Jangles" (Phases 2+5: velocity vs. envelope attack, on sample tracks)

A piano where every key is struck as hard as possible, against a brush kit
played with varying levels of attack in a smooth jazz feel. The point of the
pairing: **velocity and envelope attack are different dimensions.** The piano
is pinned at maximum velocity (`X` on every hit — zero dynamic variation),
so all the smoothness in the session comes from the drums, which vary both
their strike level (`o`/`x`/`X` scaling the envelope peak) and their onset
shape (per-step `attacks:` locks softening the envelope attack into brush
swells).

```
[bpm:96, swing:62]
Piano: X--X---X--X---X-                  [sampled:piano, pitches:0,4,5,9,7]
Brush: o-o-o-oo-o-o-oo-                  [sampled:brushes-snare, env:0.06,0.1,0.8,0.3,
                                          attacks:0.12,0.08,0.1,0.06,-,0.1,0.08,0.05,-]
Snare: ----x--o----X-o-                  [sampled:acoustic-snare, attacks:-,0.06,-,0.06]
Kick:  o-------o---o---                  [sampled:acoustic-kick]
```

The brush track sweeps in with 50–120ms attacks and two crisper unlocked
hits; the snare keeps its backbeat and rimshot crisp (`-` = no lock ⇒
default onset) while its ghosts are brushed soft; the kick is feathered at
ghost level throughout. Today this session is impossible twice over: sampled
instruments have a hard-coded 3ms declick attack (`note-schedule.ts`), so no
sample can swell — and there are no per-step envelope locks. It also
exercises open question 4: `[env:...]` on a sample track applies
attack/release and ignores decay/sustain.

### D. Gated stabs against a washed pad (Phase 5: gate time)

Gate time decouples articulation from the grid: the stab track releases at
25% of each step regardless of tempo, while the pad holds its gate the full
step and lets its long release overlap.

```
[bpm:124]
Stab: x--x--x-x--x--x- [synth:stab, gate:25, env:0.001,0.2,0.25,0.15]
Pad:  x---------------x--------------- [synth:dreampop, stepCount:32, gate:100, env:1.2,0.4,0.9,6.0]
```

### E. An agent shaping sound over MCP (Phase 3)

Today an agent can only swap presets. After Phase 3, "make the chords
swell more" is one operation:

```json
{
  "operation": "set_track_envelope",
  "track_id": "chords",
  "envelope": { "attack": 0.8, "decay": 0.3, "sustain": 0.85, "release": 3.5 }
}
```

…and `get_session` returns the effective envelope per track, so
`analyze_session` can finally describe articulation ("tight plucks over a
slow-attack pad") instead of being blind to the dimension.

## Non-Goals

- Adopting `Tone.Transport` — the custom scheduler remains the timing
  authority (multiplayer clock sync, drift-free lookahead).
- Migrating sampled instruments to `Tone.Sampler`/`Player`.
- Filter-envelope user controls — the amplitude envelope ships first; the
  same `TrackEnvelope` shape extends to `filterEnvelope?` later if wanted.
- Changing preset defaults — overrides layer on top; absent override ⇒
  today's sound, byte-for-byte in state and (until Phase 4) render-identical.

## Testing

- Property tests for the clamp/translate module (ranges, monotonicity,
  falsy-zero handling).
- Offline PCM render regressions per engine for the release conventions
  (extend `synth-envelope.render.test.ts`).
- Sync convergence: `set_track_envelope` through the worker validation +
  granular broadcast paths, mirroring the `fmParams` tests.
- MCP: schema-strictness and idempotency tests for `set_track_envelope`,
  mirroring `mcp-edits.test.ts`.
- Voice-lifecycle test that survives simulated timer throttling (Phase 1
  cleanup change).
- Notation round-trip tests for `[env:...]`, `[releases:...]`, and
  `[gate:...]` once the v2.3 extensions land.

## Open Questions

1. Should the XY pad write envelope changes at drag-end only (one mutation)
   or throttled during the drag? Effects updates already batch per drag;
   recommend the same batching with a trailing commit.
2. Does `TrackEnvelope` apply to `tone:*` preset synths (FM/membrane/metal)
   in Phase 2, or only `synth:*`/advanced tracks until Phase 4 consolidates?
   Recommend: wherever the translate module can express it, from day one.
3. Per-step envelope p-locks and tied steps: does a tie inherit the first
   step's locked envelope (recommended — one note, one envelope) or re-read
   locks per step?
4. Does `[env:...]` on a sample track mean anything beyond attack/release?
   Recommend: apply attack/release, ignore decay/sustain, and say so in the
   notation spec rather than approximating silently.
