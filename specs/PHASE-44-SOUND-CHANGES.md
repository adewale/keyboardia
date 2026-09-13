# Phase 44 — Sound Changes and Their Measurable Impact

**Date**: 2026-08-19
**Driver**: `specs/research/TONE-NETS-COMPARISON-2026-08.md`
**Predecessor**: `specs/SOUND-QUALITY-PARITY-PLAN.md` (Phase 43, implemented)
**Status**: Implemented 2026-08-22; independently re-audited and corrected
2026-09-13 (see §§10–11). Baselines in §1 originate at
`58264dd5ae274f63b1cd80b72aa823b76b21f28b` and were re-measured after the
audit. Unit, offline-render, performance, and Chromium browser-capture gates
pass. Silent-voice warm-up is not indicated by the first-use sampled fixture;
that result is not generalized to cold Tone/advanced voices or whole-engine
initialization. The physical-iPhone ringer-switch and device-latency gate
remains open and is not inferred from CI.

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

Spectral centroid over a fixed 250 ms window after the same decoded-buffer
start compensation used by production. Layers are compared only within the
same native note and articulation; round robins within a layer are averaged,
each note has equal weight, and a note with only one layer contributes zero.
This removes pitch, articulation, and round-robin coverage as confounds. The
window does not pretend that every instrument has the same attack envelope.

| Instrument | Layers | Centroid spread |
|---|---|---|
| `steel-drums` | 5 manifest zones | **68.1%** |
| `marimba` | 3 manifest zones | **59.7%** |
| `finger-bass` | 4 manifest zones | **47.7%** |
| `acoustic-kick` | 4 manifest zones | **46.6%** |
| `piano` | 3 manifest zones | **35.6%** |
| `vibraphone` | 2 manifest zones | **31.2%** |
| `acoustic-hihat-closed` | 4 manifest zones | **31.1%** |
| `alto-sax` | 2 manifest zones | **24.4%** |
| `acoustic-ride` | 3 manifest zones | 18.0% |
| `acoustic-snare` | 4 manifest zones | 15.3% |
| `acoustic-crash` | 3 manifest zones | 13.6% |
| `brushes-snare` | 3 manifest zones | 11.6% |
| `french-horn` | 2 zones on 7 roots; 2 single-zone roots | **9.5%** |
| `acoustic-hihat-open` | 4 manifest zones | 5.4% |
| the other 12 | one manifest zone | **0% — gain only** |

**12 of 26 sampled instruments respond to velocity with loudness and nothing
else.** A soft hit is a quieter copy of a hard hit, sample-identical.

The earlier filename-based analysis reported `finger-bass`, `steel-drums`, and
`french-horn` as single-layer instruments (and the horn at 1.9%). The first
repair then over-corrected the horn to 34.5% by globally comparing its low-note
layer labels with brighter single-layer high notes. Both were measurement
defects. The table above uses authoritative mappings and paired acoustic
comparisons; a synthetic pitch/articulation confound must measure zero.

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
| `finger-bass` | 1.94 / 3.90 / 5.02 |
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

**What is not measurable here, stated plainly.** This repository's Playwright
iPhone project uses WebKit, but neither it nor Chromium exposes a physical
ringer switch, so CI cannot prove the fix works — only that it did not change
the signal. The acceptance gate is a manual pass on a physical device, Safari
and Chrome iOS, ringer off. And the repo
contains nothing that would let anyone estimate what share of iOS users are
affected; do not put a number on it.

**Risk.** The media element adds output latency, which matters for a sequencer
people play along to. Measure it before shipping (loopback capture, or
`estimateLatencyFrames` against a known impulse) and treat a large regression as
a blocker, not a rounding error. Metering taps are upstream and unaffected.

**Effort.** Small. **Claim level:** functional fix, not a sound claim.

---

## 3. Change 2 — Velocity drives cutoff on the sampled path

**What.** One native low-pass `BiquadFilterNode` per sampled voice. Web Audio
expresses this filter's `Q` AudioParam in decibels, so the non-resonant
Butterworth value is `20 × log10(1/√2) = −3.0103 dB`. Assigning the familiar
linear value `0.7071` is wrong in this API and creates a pass-band boost.

```
c40 = anchor(note, sampleRate) × 2 ** (−1.5 × (1 − 40 / 90))
cutoff(v) = anchor × 2 ** (−1.5 × (1 − v / 90))     for v ≤ 40
cutoff(v) = c40 × (24_000 / c40) ** ((v − 40) / 50) for 40 < v < 90
bypass (no filter node at all)                        for v ≥ 90
```

`anchor` is calibrated per playable note and separately for **exactly** 44.1
and 48 kHz, outside the provenance manifest. `90` is
`DEFAULT_STEP_MIDI_VELOCITY`. Any other hardware rate takes a deliberate
gain-only bypass; it must never alias the nearest table. During progressive
loading, calibration applies only when the source root selected from the
currently loaded set matches the root selected from the complete manifest. A
priority-only fallback root also bypasses until its calibrated root arrives.

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
the six tonal gain-only instruments land at 29.7–30.3% centroid drop at both
44.1 and 48 kHz. The target band is 26–35%, covering the central response of
the genuinely multi-sampled instruments. Recorded-layer instruments are not
calibrated and remain on their authored velocity zones.

**Preregistered acceptance.**

| Metric | Lane | Baseline | Target |
|---|---|---|---|
| `logSpectralDistance`, session with no volume locks, before vs after | offline render | — | **exactly 0** |
| v40 centroid drop vs v127, every calibrated playable note | `npm run validate:velocity-filter` | **0%** | 26–35% at 44.1/48 kHz |
| Native transfer response | `velocity-sample-filter.test.ts`, independent of solver | wrong Q: +1.74 dB at 3 kHz for a 4 kHz cutoff | magnitude ≤ 1 and −3.0103 dB at cutoff |
| Progressive source mismatch | held-background-fetch production render | 55.98% (`string-section@88`) | byte-identical safe bypass until calibrated root loads |
| Unsupported hardware rate | 96 kHz production render | nearest-table alias; up to 39.1% drop | byte-identical safe bypass |
| Instruments that already have layers | calibration structure + shipped-sample render | 5.4–68.1% | no filter calibration; unchanged |
| `truePeakDbfs`, `loudnessKMax`, filtered vs bypassed source | shipped-sample render | unmeasured | ≤ 0.1 dB increase; master browser guards still pass |

**Risk.** One extra node per voice on the hot path. The production
`SampledInstrument.playNote` benchmark now exercises both v40 filter allocation
and the v90 bypass control, with pre-timing assertions that a source and the
expected filter count were actually created. On the audit machine the fake-node
JavaScript orchestration measured about 630k operations/s filtered versus 730k
bypassed (a 1.16× difference). This is a regression baseline for allocation
code, not a browser-DSP or realtime-capacity claim. A wrong anchor makes an
instrument sound muffled at moderate velocity — hence the exhaustive per-note
range gate, transfer-function test, safe fallback policies, and the structural
exclusion of already-layered instruments.

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

**Instead:** add a library-level regression guard so a future sample swap
cannot degrade the typical root silently. Assert that every *sustaining*
instrument's **median native-root** usable seconds exceeds the longest tied
note in a 16-step bar at 120 BPM (2 s). This is not a claim that every pitched
note holds for two seconds: `finger-bass` has a measured 1.94 s minimum, and
pitch shifting changes wall-clock duration. Any broader playback claim needs a
requested-note/velocity render over a separately stated domain.

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

Value: the median library statistic becomes a checked invariant instead of a
property nobody is watching, and the classification it needs is independently
useful. Its deliberately narrow scope is part of the contract.

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

**Revised acceptance contract**, all on the existing three-tap browser capture
lane. The audit corrected two mismatches between the original table and what
the metrics can establish. Low-band protection is measured during the bass
program, where dry energy exists; a post-hit dry-floor ratio is numerically
unstable and does not test whether the kick body is protected. Compressor
pumping is measured on the 16-track capacity fixture, not inferred from the
quiet tail probe. Set the tail threshold from the first capture rather than
guessing it:

| Metric | Window | Target |
|---|---|---|
| `bandRmsDb`, full band | from 300 ms after the last authored burst | measurably above the current dry floor |
| `bandRmsDb`, below 275 Hz | 0.15–0.55 s bass-program body | **within ±0.3 dB of dry** — proves the HPF protects the bass body |
| `truePeakDbfs` at `userOutput` | whole capture | no increase beyond the explicit-dry live-repeat floor + 0.01 dB numerical margin |
| `loudnessKMax` | whole capture | **≤ 1 LU** change |
| `pumpingProfile` on the 16-track capacity fixture | whole capture | no new pumping — reverb energy must not drive the compressor |

The production-browser probes now supply the thresholds and evidence across
the audit reruns: full-band tail +19.7 to +21.1 dB and high-band tail +24.0 to
+25.1 dB from the corrected 300 ms boundary, bass-body low band within
±0.038 dB, wet true peak within 0.013 dB of dry, maximum K-weighted loudness
within 0.055 LU, and 16-track compressor-attenuation delta −0.071 to
+0.095 dB. Exact peak ordering varies below the live repeat floor, so the gate
allows that measured floor plus 0.01 dB instead of claiming bit-stability. The
committed assertions retain useful margin around those observations rather
than comparing against an offline reverb proxy.

**The migration is the hard part, not the DSP.** Changing a default
reinterprets every session that never stored effects. `normalizeSessionEffects`
separates `new-session` from `legacy-session`, so a stored effects-absent
session must hydrate to the exact dry state. The production browser then renders
that hydrated state indistinguishably from explicit dry at the measured
same-build live-capture null: −53.86 dB residual versus a −54.01 dB repeat null,
and 0.019 dB versus 0.013 dB log-spectral distance. “Bit-identical” is retained
for deterministic state/offline lanes; a wall-clock AudioWorklet capture is
correctly judged against its repeat null rather than promised to be byte-stable.

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
| **Voice warm-up** | Measure before adding silent voices | One first-use priority-loaded `slap-bass` fixture with a preinitialized dry master: 28–44 ms DOM-click-event-to-audible across three isolated runs; onset-aligned first/steady spread ≤0.0089 dB peak and ≤0.0022 dB RMS | **Not indicated for this sampled fixture:** silent playback would perturb round-robin/choke state; this does not establish cold Tone/advanced or whole-engine behavior |
| **Clock-liveness gate** | Every transport start samples `currentTime` after any resume path, including already-`running`, gesture-resumed, suspended, and interrupted contexts | Helper tests cover frozen/advance/timeout; engine and transport tests fail if the caller omits the check. Timeout is non-fatal but logged; cancellation prevents an obsolete start. | Small |
| **`navigator.mediaSession`** | Lock-screen transport and metadata | Play and pause are idempotent state commands across pending startup, cancellation, independently paused output, and active transport—not toggles. Lifecycle integration tests exercise each state. | Small |

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
| Startup (warm-up, clock-liveness) | clock trusted state; warm-up only a hypothesis | liveness closed; one sampled first-use fixture does not indicate voice warm-up | cold Tone/advanced and physical/browser lifecycle states remain open domains |
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

The audit now uses one acceptance ledger so broad completion statements cannot
outrun their evidence:

| Requirement | Production entry point | Tested domain | Independent assertion / counterexample | Status |
|---|---|---|---|---|
| Non-resonant velocity filter | `SampledInstrument.playNote` | native low-pass | response ≤1; −3.0103 dB at cutoff; old `Q=0.7071` is a positive control for failure | passed |
| Calibrated soft timbre | same | 281 playable notes × 44.1/48 kHz | 29.7–30.3%; exact probe count required | passed |
| Progressive loading | same | priority-only held fetch, audited range edges | mismatched source root is byte-identical bypass | passed |
| Hardware sample rate | calibration lookup | 32/88.2/96 kHz controls; 96 kHz render | no nearest-table alias; byte-identical bypass | passed |
| Velocity baseline | measurement script | note + articulation pairs, RR averaged | synthetic pitch/articulation confound remains 0 | passed |
| Playback readiness | engine + transport caller | running/frozen, resume/gesture, timeout/cancel | removing the caller check or pending-start latch fails | passed |
| Media Session | sequencer lifecycle | pending, active, OS-pause, retry, unmount | latest play intent survives cancellation but cannot survive unmount | passed |
| Default room | Tone effects + real master chain | Chromium deterministic probe + 16-track capacity fixture | corrected tail boundary; bass-body/peak/LU bounds; capacity pumping against dry | passed |
| Legacy room migration | HTTP hydration + real master chain | effects-absent stored session | exact dry state plus live render at explicit-dry repeat null | passed |
| Sampled first use | preload + scheduler + sampled voice | priority-loaded `slap-bass`, five hits; master preinitialized | 28–44 ms DOM event to audible; onset-aligned ≤0.0089/0.0022 dB peak/RMS spreads | no voice warm-up indicated in this fixture |
| Sustaining library statistic | validator | eight classified manifests | median native-root duration >2 s; no every-note claim | passed |
| Physical mobile output | final media-element route | Safari + Chrome iOS, ringer off | physical audition and latency capture | **open release gate** |

- **Change 2 — velocity → cutoff** (`velocity-sample-filter.ts`,
  `sampled-instrument.ts`). One lowpass per voice, bypassed at
  `DEFAULT_STEP_MIDI_VELOCITY`; DSP calibration is held outside provenance
  manifests in `velocity-filter-anchors*.json`. The solver renders the real
  manifest mapping and pitch ratio for all 281 playable notes on the six
  tonal gain-only instruments, at both 44.1 and 48 kHz. `validate:all` blocks
  any note outside the 26–35% v40 centroid-drop band and rejects calibration
  on a manifest with recorded velocity zones. The curve opens to a transparent
  corner before v90, eliminating the old v89→v90 brightness cliff while the
  v≥90 graph remains byte-identical. The audit corrected Web Audio Q from an
  accidental +0.7071 dB to −3.0103 dB and regenerated both tables. Unsupported
  rates and progressive source mismatches now bypass safely. Independent
  transfer-response, held-fetch, 96 kHz, peak/loudness, and production hot-path
  benchmark controls close the shared-oracle gaps.
- **Change 3 — default room** (`effects-defaults.ts`). New sessions carry
  `reverb.wet 0.15` through the `new-session` fallback
  (`NEW_SESSION_EFFECTS_STATE`), exactly as §5 specifies; the shared
  `DEFAULT_EFFECTS_STATE` baseline the UI and audio chain initialize from
  stays dry (the Stack A identity catalogue renders it, so moving it would
  fail that gate), `LEGACY_MISSING_EFFECTS_STATE` stays 0, and the
  legacy-normalization guard is asserted in `session-defaults.test.ts`.
  `RESET_STATE` now uses the new-session policy, and `createNew()` hydrates
  the server-created snapshot before autosave is enabled, so a disconnected
  client cannot overwrite the server's 0.15 room with a stale dry reset. The
  Chromium production-master captures now pass every revised §5 row: the
  deterministic room probe uses the promised tail boundary and the separate
  16-track fixture measures wet-versus-dry pumping. The migration lane loads an
  actual effects-absent stored session before comparing it with explicit dry.
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
  sustaining instruments pass the deliberately median/native-root statistic;
  measurement visits manifest-referenced
  mappings and mapped segments only, so stale directory files cannot satisfy
  the guard. Plucked instruments remain deliberately unclassified; the 1.94 s
  finger-bass minimum is reported rather than hidden behind the median.
- **§6**: `navigator.mediaSession` play/pause handlers are idempotent transport
  commands across pending and active states. Clock liveness is sampled at every
  playback boundary as well as after a gesture resume, including when state is
  already `running`. The browser capture finds no silent-voice warm-up benefit
  for its first-use sampled fixture. It deliberately makes no broader cold Tone,
  advanced-instrument, or whole-engine claim.
- **Measurement correction** (`measure-velocity-timbre.ts`). Velocity layers
  are paired within note and articulation, round robins are averaged within
  each pair, single-layer notes contribute zero, and decoded onset treatment
  matches production. French horn is 9.49%, not the confounded 34.5% previously
  reported. Missing dry or filtered calibration probes fail closed.
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
6. **We never specified the DSP API's units.** “Butterworth Q” was copied as
   the familiar linear `0.7071`, but Web Audio's low/high-pass Q parameter is
   in decibels. Production and the calibration solver shared the same wrong
   constant, so the solver faithfully calibrated a resonant topology. The
   missing tool was an independent transfer-response test with an ablation of
   the old value.
7. **We mistook two measured rates and a complete library for the playback
   domain.** Hardware can choose 96 kHz, and first play can render from only the
   priority root. Nearest-table lookup and requested-note calibration silently
   invented answers outside their evidence. Explicit supported-rate and loaded-
   source policies, plus negative controls, now fail safely.
8. **We aggregated labels instead of estimating a causal effect.** The 34.5%
   horn result mixed pitch coverage with velocity coverage. The experiment had
   no pairing rule, so authoritative manifest data still answered the wrong
   question. Pairing note and articulation, balancing round robins, and adding
   a synthetic confound fixture turn the metric into the intended comparison.
9. **We tested registration instead of state-machine semantics.** Media Session
   handlers existed, but repeated play could toggle an in-flight start and pause
   could not cancel it. The missing verification was caller-level lifecycle
   testing over pending, active, cancelled, and independently paused states.
10. **We treated prose status as evidence.** The implementation record said the
    only remaining gap was physical while room capture and cold-start work were
    still marked owed elsewhere. The acceptance ledger in §10 now distinguishes
    implemented, measured, passed, rejected, and open, and every completion
    statement points to a production entry point and counterexample.
11. **The benchmark had no branch precondition.** Vitest's benchmark runner did
    not execute the nested setup hook, so the apparent 9.5M operations/s result
    timed an unloaded early return. Unit-runner lifecycle assumptions had leaked
    into a different runner. Module-scope setup plus pre-timing source/filter
    assertions now make the benchmark fail if it does not enter both intended
    production branches; its claim is explicitly limited to fake-node JavaScript
    allocation.
12. **The acceptance ledger named metrics but did not bind their exact windows
    and fixtures.** The room probe started its tail early, checked low-band body
    energy against a row that said tail, and used a quiet source for a row that
    required the 16-track fixture. The revised contract explains why bass
    protection belongs in the body window, moves the tail to the stated boundary,
    and performs the pumping comparison on the capacity session. The sampled
    first-use probe now timestamps the DOM event itself and aligns every hit to
    its observed onset, avoiding both Playwright-dispatch latency and scheduler
    phase error.

The pre-audit suites were green because their oracles were built from the same
assumptions as the implementation: one note, one route, filename-derived or
globally grouped layers, hard-coded exclusion lists, nearest-value fallbacks,
registration checks, and a solver that shared the production DSP constant.
They proved the code matched that model; they did not prove the model matched
playback. The audits supplied the missing independent/adversarial
verification—terminal graph inspection, transfer probes, boundary pairs,
held-loading renders, unsupported-domain controls, synthetic confounds,
lifecycle state tests, cold browser capture, and universal receipt checks—and
therefore found cases outside the old tests' support rather than intermittent
failures inside it.

The remaining Phase 44 release evidence gap is irreducibly physical: CI cannot
prove behavior with an iPhone ringer switch or measure that device's added
output latency. That manual Safari/Chrome iOS pass remains a release gate rather
than a claim inferred from WebKit or Chromium emulation. The broader comparative
gap in §8—a matched reference capture and first-contact listening study—also
remains, so none of these internal results becomes a comparative sound claim.
