# Phase 44 — Sound Changes and Their Measurable Impact

**Date**: 2026-08-19
**Driver**: `specs/research/TONE-NETS-COMPARISON-2026-08.md`
**Predecessor**: `specs/SOUND-QUALITY-PARITY-PLAN.md` (Phase 43, implemented)
**Status**: Implemented 2026-08-22 (see §10) except the graph warm-up.
Baselines in §1 are measured at
`58264dd5ae274f63b1cd80b72aa823b76b21f28b`; the unit- and offline-lane
targets are verified, the browser-capture and physical-device gates are
recorded in §10 as still owed.

This plan keeps Phase 43's two claim levels:

1. **Internal improvement** — a bug is removed, or a preregistered
   Keyboardia-only metric moves without breaking its guards.
2. **Comparative improvement** — a matched capture or first-contact study
   shows a preregistered benefit with uncertainty reported.

**Nothing here claims level 2.** No listening test was run, and none of these
changes should be described as making Keyboardia sound better than anything
until one is.

---

## 1. Measured baseline

Two new scripts produce these numbers, so they can be re-run after any change:

```bash
cd app
npm run measure:velocity-timbre     # what velocity actually does, per instrument
npm run simulate:velocity-filter    # what the proposed filter would buy
```

### 1.1 Velocity response, measured

Post-onset spectral centroid across each instrument's velocity layers, over a
fixed 250 ms window so attack length and level cannot bias it:

| Instrument | Layers | Centroid spread |
|---|---|---|
| `steel-drums` | 5 manifest zones | **65.1%** |
| `marimba` | 3 manifest zones | **62.1%** |
| `finger-bass` | 4 manifest zones | **48.3%** |
| `acoustic-kick` | 4 manifest zones | **47.5%** |
| `french-horn` | 2 manifest zones plus fallback | **34.5%** |
| `piano` | 3 manifest zones | **31.5%** |
| `acoustic-hihat-closed` | 4 manifest zones | **30.4%** |
| `vibraphone` | 2 manifest zones | **30.5%** |
| `alto-sax` | 2 manifest zones | **26.2%** |
| `acoustic-ride` | 3 manifest zones | 17.9% |
| `acoustic-snare` | 4 manifest zones | 16.3% |
| `acoustic-crash` | 3 manifest zones | 13.6% |
| `brushes-snare` | 3 manifest zones | 11.6% |
| `acoustic-hihat-open` | 4 manifest zones | 5.6% |
| the other 12 | one manifest zone | **0% — gain only** |

**12 of 26 sampled instruments respond to velocity with loudness and nothing
else.** A soft hit is a quieter copy of a hard hit, sample-identical.

The earlier filename-based analysis reported `finger-bass`, `steel-drums`, and
`french-horn` as single-layer instruments (and the horn at 1.9%). Those were
measurement defects: the filenames do not encode the manifest's velocity
zones. The table above is derived from the authoritative mappings.

### 1.2 Sustain ceiling, measured

Seconds until a sample falls below −60 dBFS relative to its own peak. Only
mappings carrying a `LoopSpec` repeat, and exactly one manifest declares one
(`hammond-organ`), so for everything else this is a hard ceiling on note length:

| Instrument | min / median / max (s) |
|---|---|
| `french-horn` | 3.86 / 9.70 / 14.04 |
| `string-section` | 7.48 / 9.34 / 11.64 |
| `piano` | 4.86 / 6.98 / 7.00 |
| `alto-sax` | 4.58 / 5.86 / 6.84 |
| `clean-guitar` | 3.96 / 5.10 / 5.92 |
| `hammond-organ` (looped) | 4.04 / 4.48 / 5.00 |
| `finger-bass` | 1.96 / 3.90 / 5.02 |
| `acoustic-guitar` | 0.76 / 2.06 / 4.72 |
| `slap-bass` | 0.38 / 0.42 / 0.50 |

§4 explains why this table demotes a recommendation rather than creating one.

---

## 2. Change 1 — Mobile output through a media element

**What.** On mobile, connect `outputTrim` to a
`MediaStreamAudioDestinationNode` and play its stream through a hidden
`<audio playsinline>` element, instead of connecting to `ctx.destination`.
Desktop path unchanged. Start `.play()` inside the existing unlock gesture
(`engine.ts` unlock listeners), never outside it.

**Why.** `grep -rn "createMediaStreamDestination" app/src` → no matches. Web
Audio routed to `ctx.destination` on iOS obeys the physical ringer switch;
audio routed through an `HTMLMediaElement` does not.
`specs/research/MOBILE-LESSONS.md:96` already names this the **most common**
cause of "no sound on mobile" and its current remedy is *"Check that the mute
switch doesn't show orange"* — an instruction to the user, not a fix. Tone Nets
implements the fix in about fifteen lines.

**Measurable impact.**

| Metric | Lane | Baseline | Target |
|---|---|---|---|
| Mobile branch builds the media path; desktop branch does not | unit, fake context | n/a | asserted |
| `logSpectralDistance` at the `userOutput` tap, before vs after | `e2e/capture-session.spec.ts` | — | **0** (taps sit upstream of the destination) |
| Every existing dynamics assertion in the capture lane | `e2e/capture-session.spec.ts` | passing | still passing |
| Audible with the ringer switch off | **manual, physical iPhone** | fails | passes |

**What is not measurable here, stated plainly.** Playwright's iPhone profile is
Chromium, not WebKit, and has no ringer switch, so CI cannot prove the fix
works — only that it did not change the signal. The acceptance gate is a manual
pass on a physical device, Safari and Chrome iOS, ringer off. And the repo
contains nothing that would let anyone estimate what share of iOS users are
affected; do not put a number on it.

**Risk.** The media element adds output latency, which matters for a sequencer
people play along to. Measure it before shipping (loopback capture, or
`estimateLatencyFrames` against a known impulse) and treat a large regression as
a blocker, not a rounding error. Metering taps are upstream and unaffected.

**Effort.** Small. **Claim level:** functional fix, not a sound claim.

---

## 3. Change 2 — Velocity drives cutoff on the sampled path

**What.** One `BiquadFilterNode` per sampled voice:

```
c40 = anchor(note, sampleRate) × 2 ** (−1.5 × (1 − 40 / 90))
cutoff(v) = anchor × 2 ** (−1.5 × (1 − v / 90))     for v ≤ 40
cutoff(v) = c40 × (24_000 / c40) ** ((v − 40) / 50) for 40 < v < 90
bypass (no filter node at all)                        for v ≥ 90
```

`anchor` is calibrated per playable note and separately for 44.1 and 48 kHz,
outside the provenance manifest. `90` is `DEFAULT_STEP_MIDI_VELOCITY`.

**Why this shape and not the existing synth curve.** `velocityFilterCutoff`
(`synth.ts:120`) scales a *preset* cutoff by `0.3 + 0.7·√(v/127)`. Sampled
instruments have no preset cutoff, and anchoring it high enough to be
transparent at full velocity leaves it transparent at low velocity too — the
curve does nothing when ported directly. The SF2 gets its result differently:
per-zone cutoffs that are already partly closed (median 1,267 Hz) plus a
velocity modulator that sweeps down about two octaves. The curve above is that
idea with per-note acoustic calibration. Its second branch opens smoothly to a
transparent corner before the byte-identical bypass.

**The zero-regression property — this is the point of the bypass.** Unlocked
steps use velocity 90. Bypassing at `v ≥ 90` means every step without an
explicit volume lock renders through a byte-identical graph. So unlike a
default change, this ships without reinterpreting anyone's saved music.

**Measured impact.** At velocity 40, all 281 calibrated playable notes across
the six tonal gain-only instruments land at 29.8–30.2% centroid drop at both
44.1 and 48 kHz. The target band is 26–35%, covering the central response of
the genuinely multi-sampled instruments. Recorded-layer instruments are not
calibrated and remain on their authored velocity zones.

**Preregistered acceptance.**

| Metric | Lane | Baseline | Target |
|---|---|---|---|
| `logSpectralDistance`, session with no volume locks, before vs after | offline render | — | **exactly 0** |
| v40 centroid drop vs v127, every calibrated playable note | `npm run validate:velocity-filter` | **0%** | 26–35% at 44.1/48 kHz |
| Instruments that already have layers | calibration structure + shipped-sample render | 5.6–65.1% | no filter calibration; unchanged |
| `truePeakDbfs`, `loudnessKMax` at `userOutput` | `e2e/capture-session.spec.ts` | current | unchanged (a lowpass must not raise either) |

**Risk.** One extra node per voice on the hot path; check it against the
existing `audio-hot-paths.bench.ts` before and after. A wrong anchor makes an
instrument sound muffled at moderate velocity — hence the exhaustive per-note
range gate and the structural exclusion of already-layered instruments.

**Reconsidered limits (2026-08-22).** Two consequences of this design deserve
stating as plainly as its benefits:

1. **The bypass caps the audible payoff.** Every unlocked step — the default,
   and most notes in most sessions — renders through the bypassed graph by
   construction. The change makes the velocity lane expressive; it does not
   change how a session with no volume locks sounds at all. Tone Nets' filter
   acts on every note. That trade is deliberate (it is what makes the change
   shippable without a migration), but it means this change narrows the
   per-note gap only where users reach for dynamics.
2. **A static cutoff is one of three per-voice elements, not all of them.**
   The SF2 bank pairs its velocity-dependent cutoff with a filter *envelope*
   on 89% of zones and a vibrato LFO on 100% — the attack-opens-filter motion
   the comparison credited as a large part of why that bank reads as "played".
   This change supplies the velocity slice only; per-note motion stays out of
   scope (see §9).

**Effort.** Medium. **Claim level:** internal metric improvement.

---

## 4. What the measurements demote — loop points

`specs/research/TONE-NETS-COMPARISON-2026-08.md` §4.7 listed sustain loops as a
lesson, reasoning from the SF2's 100% loop rate. **The measurement in §1.2 does
not support acting on it**, and this plan drops it:

- The sustaining instruments already hold far longer than any realistic tied
  note: `string-section` 9.34 s, `french-horn` 9.70 s, `alto-sax` 5.86 s,
  `clean-guitar` 5.10 s. `hammond-organ` is the one instrument that declares a
  loop, and it is also the one whose samples are shortest among the sustainers —
  consistent, not coincidental.
- A note *can* exceed those ceilings — 60 BPM with a 128-step track fully tied
  is 32 s — but that is an extreme session, not the common case.
- The two genuinely short instruments, `slap-bass` (0.42 s) and
  `acoustic-guitar` (2.06 s), are plucked. A decay to silence is correct
  behaviour there, not a defect.

**Instead:** add a regression guard so a future sample swap cannot introduce
the problem silently. Assert that every *sustaining* instrument's median usable
seconds exceeds the longest tied note in a 16-step bar at 120 BPM (2 s).

That guard needs something the manifests do not currently carry: `type` is
uniformly `sampled`, and `instrument-classification.ts` distinguishes drums,
kicks and basses but not sustain. So the work is a `sustain` classification
plus the test, not the test alone.

Against the eight instruments a user would expect to hold a note, **all eight
pass today**: `finger-bass` 3.90 s, `hammond-organ` 4.48 s, `vibraphone`
4.98 s, `clean-guitar` 5.10 s, `alto-sax` 5.86 s, `piano` 6.98 s,
`string-section` 9.34 s, `french-horn` 9.70 s. `acoustic-guitar` (2.06 s) and
`slap-bass` (0.42 s) belong on the decaying side of that line, not under a
waiver — they are plucked, and classifying them as sustaining would be the
error.

Value: the ceiling becomes a checked invariant instead of a property nobody is
watching, and the classification it needs is independently useful.

---

## 5. Change 3 — Default reverb wet 0 → 0.15

**What.** Move the **`new-session`** fallback in `normalizeSessionEffects`
to `reverb.wet: 0.15`. Leave `legacy-session` at 0.

**Why.** `app/src/shared/effects-defaults.ts:9` ships fully dry.
`specs/SOUND-QUALITY-PARITY-PLAN.md:508` already specified this value, already
recorded the diagnosis at line 662 (*"dry stops dead — phone speaker in a
closet"*), and the bass-protected send it needs was built and shipped: HPF at
275 Hz, 15 ms predelay, parallel wet gain, limiter (`toneEffects.ts:172-195`,
`constants.ts`). Only the default was never flipped. Tone Nets is independent
support for the diagnosis: its bank carries a reverb send on 99% of zones.

**Preregistered acceptance**, all on the existing three-tap browser capture
lane. Set the tail threshold from the first capture rather than guessing it:

| Metric | Window | Target |
|---|---|---|
| `bandRmsDb`, full band | from 300 ms after the last hit | measurably above the current dry floor |
| `bandRmsDb`, below 275 Hz | same | **within ±0.3 dB of dry** — proves the HPF protects the kick |
| `truePeakDbfs` at `userOutput` | whole capture | **no increase** |
| `loudnessKMax` | whole capture | **≤ 1 LU** change |
| `pumpingProfile` on the 16-track capacity fixture | whole capture | no new pumping — reverb energy must not drive the compressor |

**The migration is the hard part, not the DSP.** Changing a default
reinterprets every session that never stored effects. `normalizeSessionEffects`
already separates `new-session` from `legacy-session`, so the guard is:
**a stored legacy session renders bit-identical after the change.** That
assertion is the gate; without it this change is not shippable.

**Not measured here.** I deliberately did not build an offline reverb proxy.
Phase 43's v4 audit found proxy fixtures to be its main source of wrong
conclusions, and it established that the Node compressor is ~17 dB off spec, so
anything touching the dynamics path has to be measured in the browser.

**Effort.** Small change, medium verification. **Claim level:** internal metric
improvement plus a no-regression guarantee. Not a preference claim, and it
should not be described as one in a changelog.

---

## 6. Smaller changes

| Change | What | Measurable impact | Effort |
|---|---|---|---|
| **Graph warm-up** | Fire a silent note through the real instrument path at play-arm, master at 0 | `hitLevelVariationDb` between the first hit and steady state on a cold capture; `leadingSilenceMs`; `audioMetrics` scheduler jitter over the first 500 ms. Baseline unmeasured — needs a cold browser capture, which does not exist yet and is the first task. | Small |
| **Clock-liveness gate** | Wait for `ctx.currentTime` to actually advance before declaring ready, instead of trusting `state === 'running'` | Unit-testable with a fake context whose clock is frozen; functional, no acoustic metric | Small |
| **`navigator.mediaSession`** | Lock-screen transport and metadata | E2E presence assertion only; no audio metric. Real value is that it pairs with Change 1 and tells iOS this is a media app | Small |

---

## 7. Ordering

1. **Change 1 (mobile output).** Silence versus sound outranks timbre. It is
   also independent of everything else here.
2. **The loop-point regression guard (§4).** One test, closes a measurement
   that is currently unwatched.
3. **Change 2 (velocity → cutoff).** Largest measured acoustic effect of
   anything in this plan, and the bypass design means it ships without a
   migration.
4. **Change 3 (reverb default).** Smallest diff, largest blast radius. It needs
   the legacy-session bit-identical guard first.
5. **§6 items**, as capacity allows.

## 8. What would make any of this a comparative claim

None of the above. Phase 43 left one gap open and this plan does not close it:
a matched capture of Keyboardia against a reference app, and a first-contact
listening study with its uncertainty reported. Until that exists, every
statement in this plan is about Keyboardia's own measurements moving, and
should be written that way in commits, changelog, and release notes.

## 9. Scorecard: the gap with and without this plan

Added 2026-08-22, after re-verifying both anchors: `origin/main` is still the
pinned `58264dd`, and the live Tone Nets deploy hashes byte-identical to the
§7 receipt of the comparison doc (same index page SHA-256, same asset
fingerprints, same 7,557,598-byte SoundFont). Both sides of the comparison are
frozen, so the baseline numbers stand.

**The branch that carries this plan ships no engine change.** It adds the
measurement scripts, this plan, and unit-gate timeout fixes; the shipped sound
today is byte-identical with or without it. "With" below therefore means "if
every change in §2–§6 lands as specified".

| Dimension | Without (today) | With §2–§6 landed | Remaining vs Tone Nets |
|---|---|---|---|
| Mobile audibility (iOS ringer switch) | silent | audible — gated on a physical-device pass, not CI | none, once the device test passes |
| Velocity → timbre, sampled path | 0% centroid spread on 12/26 instruments | 26–35% band on locked steps for six tonal gain-only instruments, verified at every playable note at 44.1/48 kHz | unlocked steps unchanged by design; no response above v90 |
| Per-note motion (filter envelope, LFO) | none | none — out of scope | full gap: SF2 has a filter envelope on 89% of zones, LFO on 100% |
| Default space | `reverb.wet: 0` | 0.15 bass-protected, new sessions only | per-instrument depth — the SF2 balances sends per zone; ours is one global wet (§4.9 of the comparison, not committed here) |
| Startup (warm-up, clock-liveness) | absent | closed if §6 lands | — |
| `navigator.mediaSession` | absent | closed if §6 lands | — |
| Device quality tiers | none | none — not carried into this plan | comparison §4.8 remains open |
| Source material | Keyboardia ahead | unchanged | our advantage either way |
| Timing / multiplayer | Keyboardia ahead | unchanged | our advantage either way |
| Comparative listening evidence | none | none | unchanged — §8 still applies to every row above |

What the branch *did* change is the epistemics: the gap is now instrumented.
`measure:velocity-timbre` and `simulate:velocity-filter` re-derive every number
in this table from the shipped assets, so after any landing the same commands
show exactly which rows moved.

## 10. Implementation record (2026-08-22)

What shipped, and in which lane each preregistered target was verified.
Claim level for everything here: **internal improvement** (§8 unchanged —
no comparative claim).

- **Change 2 — velocity → cutoff** (`velocity-sample-filter.ts`,
  `sampled-instrument.ts`). One lowpass per voice, bypassed at
  `DEFAULT_STEP_MIDI_VELOCITY`; DSP calibration is held outside provenance
  manifests in `velocity-filter-anchors*.json`. The solver renders the real
  manifest mapping and pitch ratio for all 281 playable notes on the six
  tonal gain-only instruments, at both 44.1 and 48 kHz. `validate:all` blocks
  any note outside the 26–35% v40 centroid-drop band and rejects calibration
  on a manifest with recorded velocity zones. The curve opens to a transparent
  corner before v90, eliminating the old v89→v90 brightness cliff while the
  v≥90 graph remains byte-identical.
- **Change 3 — default room** (`effects-defaults.ts`). New sessions carry
  `reverb.wet 0.15` through the `new-session` fallback
  (`NEW_SESSION_EFFECTS_STATE`), exactly as §5 specifies; the shared
  `DEFAULT_EFFECTS_STATE` baseline the UI and audio chain initialize from
  stays dry (the Stack A identity catalogue renders it, so moving it would
  fail that gate), `LEGACY_MISSING_EFFECTS_STATE` stays 0, and the
  legacy-normalization guard is asserted in `session-defaults.test.ts`.
  `RESET_STATE` now uses the new-session policy, and `createNew()` hydrates
  the server-created snapshot before autosave is enabled, so a disconnected
  client cannot overwrite the server's 0.15 room with a stale dry reset.
  **Still owed:** the browser-capture acceptance rows in §5 (tail rise,
  low-band ±0.3 dB, true peak, LU, pumping) — this container has no WebKit
  and the capture lane runs in CI.
- **Change 1 — mobile output** (`mobile-media-output.ts`, `engine.ts`).
  Both the native and Tone-effects master chains terminate in the same
  MediaStreamDestination → hidden `playsinline` element. It starts before the
  first gesture-path `await`, is retried even while AudioContext says
  `running`, and re-arms after an OS pause; desktop stays on `destination`.
  Verified: both final routes, fallback, running-context unlock, gesture retry,
  external pause, and dispose. **Still owed:** the
  physical-iPhone ringer-switch pass and the output-latency measurement —
  CI cannot provide either.
- **§4 guard** (`instrument-classification.ts`,
  `scripts/validate-sustain-ceiling.ts`, in `validate:all`). Eight
  sustaining instruments pass; measurement visits manifest-referenced
  mappings and mapped segments only, so stale directory files cannot satisfy
  the guard. Plucked instruments remain deliberately unclassified.
- **§6**: `navigator.mediaSession` state and play/pause action handlers are
  wired into the transport. Clock liveness now requires advancement from the
  value observed after every resume, including a previously non-zero value.
  **Deferred:** graph warm-up — its own acceptance requires a cold
  browser capture that does not exist yet.
- **Demo session**: `scripts/demo-sessions/whisper-to-roar.json`, seeded in
  the mock API (`/s/b7e0b220-3185-49ef-b9b0-15ab9df76aec` with
  `USE_MOCK_API=1`) and held to its promises by
  `src/data/phase44-demo-session.test.ts`: ≥6 filtered soft strikes, ≥2
  bypass accents, tied string sustains, kit ghost layers, the 0.15 room.
  `e2e/phase44-demo.spec.ts` binds the documented UUID to both the exact mock
  API response and the browser route.
- **Provenance:** DSP calibration no longer mutates sample manifests.
  `mapping-calibration.json` and `technical-curation.json` are bound by tests
  across every entry, not only the ten historical listening-decision IDs; the
  audit repaired seven stale manifest receipts at once. Sample-content hashes
  and immutable pre-enrichment baselines remain unchanged.

## 11. Post-audit failure analysis (2026-08-23)

The audit found failures because the implementation and its tests shared the
same simplified models:

1. **We verified components, not the terminal behavior.** The media-element
   helper worked, but Tone initialization later replaced its final route. A
   `running` AudioContext was also treated as proof that the independent media
   element was playing. The missing contract was end-to-end graph termination
   after every optional processor is installed.
2. **We treated filenames and directory contents as authority.** Velocity
   layers were inferred from suffixes and sustain inspected every audio file.
   Playback is manifest-driven, so both analyses answered a different question
   from production. Manifest mappings, velocity zones, offsets, and playable
   ranges are now the common source of truth; the solver imports production's
   higher-root nearest-sample selector instead of reimplementing its tie-break.
3. **We validated a point instead of the domain.** One slap-bass C4 render and
   a broad 15–50% threshold could not detect failures at note-range edges,
   source switches, sample-rate changes, or the v89/v90 discontinuity. The gate
   now crosses all playable notes, both common sample rates, the bypass edge,
   and the exact audited regression notes.
4. **We confused a local reset with a server transition.** The New flow never
   applied the session returned by the server, so its local dry default could
   win the next autosave. Server-created state is now hydrated under the same
   apply-before-save state machine as an ordinary session load.
5. **We used enumerated examples where universal invariants were required.**
   Hard-coded “layered” and receipt lists omitted the failing instruments.
   Sabotage tests now derive those sets, and receipt hashes are checked for
   every calibration entry. The strict all-validator also fails on every stale
   hash-bound quality waiver.

The pre-audit suites were green because their oracles were built from the same
assumptions as the implementation: one note, one route, filename-derived
layers, hard-coded exclusion lists, and a broad acoustic threshold. They proved
the code matched that model; they did not prove the model matched playback.
The audit supplied the missing independent/adversarial verification—terminal
graph inspection, boundary pairs, range-edge renders, manifest sabotage, and
universal receipt checks—and therefore found cases outside the old tests'
support rather than intermittent failures inside it.

The remaining evidence gap is irreducibly physical: CI cannot prove behavior
with an iPhone ringer switch or measure that device's added output latency.
That manual Safari/Chrome iOS pass remains a release gate rather than a claim
inferred from Chromium.
