# Spec: ADSR Overhaul — Unify Envelope Semantics, Make Envelopes Session State

**Status**: PROPOSED
**Date**: 2026-08-02
**Related**: `SYNTHESIS-ENGINE.md`, `HELD-NOTES.md`, `research/TONEJS-COMPARISON.md`,
`research/AUDIO_ENGINEERING_101.md` §7, `../docs/AUDIO-ENGINEERING-PATTERNS.md`

## Overview

ADSR envelopes are implemented three times (native Web Audio synth, Tone.js
advanced synth, sampled-instrument scheduling), are not part of the synced
session document, and are only partially controllable (attack + release,
advanced-synth tracks only, globally rather than per track, ephemeral). This
spec catalogs the concrete bugs in the current implementations and proposes a
phased plan: fix the bugs, promote the envelope to first-class per-track
session state behind one canonical type, expose it in the UI and MCP, then
consolidate the synth engines.

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

## Step-Sequencer Context

How hardware grooveboxes (Elektron, TE OP-1/OP-Z, TB-303, Volcas) handle
envelopes, for grounding — `HELD-NOTES.md` already cites the OP-1's
ADSR + hold as prior art:

- **The gate drives the envelope.** A trig opens the gate; gate time (often a
  per-step percentage of the step) closes it and starts the release. At 16ths
  and 120 BPM a step is 125ms, so sustain is only reached when the gate
  outlasts attack + decay — decay dominates at step timescales, which is why
  hardware often simplifies to AD/AHD shapes.
- **Ties/slides suppress retriggering** so envelopes breathe across steps —
  our `tie` p-lock is exactly this idiom.
- **Per-step parameter locks on envelope params** (the Elektron innovation) —
  we have the p-lock plumbing but not envelope fields.
- **Accent scales the envelope peak** — our velocity lane matches this.

Keyboardia is idiomatic on durations, ties, and accent. The departures: no
gate-time control, no per-step envelope locks, no user-facing decay/sustain,
and fixed-seconds envelopes with no tempo-relative option (presets are tuned
for 120 BPM).

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

### Phase 3 — Expose it (UI + MCP)

- [ ] Per-track envelope editor (four sliders or a drag-editable A/D/S/R
      curve) in the track controls, populated from the effective envelope
      (override ?? preset).
- [ ] MCP: add `set_track_envelope` to `edit_session` operations, validated
      by the same shared clamp; include effective envelope values in
      `get_session` and envelope character in `analyze_session` so agents can
      read and shape the dimension rather than only swapping presets.
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
      for it.
- [ ] Per-track gate time (% of step before release starts) so note length is
      not purely grid-derived and `tie` is not the only lengthener. Note:
      `REMOVE-GATE-MODE.md` removed *sample gating at step boundaries*; this
      is the different, synth-oriented control that spec's research cited as
      the industry-standard articulation model.
- [ ] Optional tempo-relative envelope times (release expressed in step
      fractions) so presets tuned at 120 BPM stay musical at other tempi.

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
