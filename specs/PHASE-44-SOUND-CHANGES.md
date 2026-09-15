# Phase 44 — Sound Changes and Their Measurable Impact

**Date**: 2026-08-19
**Driver**: `specs/research/TONE-NETS-COMPARISON-2026-08.md`
**Predecessor**: `specs/SOUND-QUALITY-PARITY-PLAN.md` (Phase 43, implemented)
**Status**: Implemented 2026-08-22; independently re-audited and corrected
2026-09-13 (see §§8, 10–12). Baselines in §1 originate at
`58264dd5ae274f63b1cd80b72aa823b76b21f28b` and were re-measured after the
audit. Unit, offline-render, performance, and Chromium browser-capture gates
pass. Silent-voice warm-up is not indicated by the first-use sampled fixture;
the previously open cold Tone, advanced, and whole-engine domains are now
measured in §8. The physical-iPhone ringer-switch and device-latency gate
remains open and is not inferred from CI.

This plan now distinguishes three claim levels:

1. **Internal improvement** — a bug is removed, or a preregistered
   Keyboardia-only metric moves without breaking its guards.
2. **Objective cross-product difference** — the same observable is collected
   repeatedly on both products, with the different workloads disclosed. This
   can establish latency or capability coverage; it cannot establish taste.
3. **Listener preference** — a level-matched, randomized first-contact study
   shows a preregistered preference with uncertainty reported.

§8 makes a level-2 startup comparison. **Nothing here claims level 3.** No
listening test was run, and none of these changes should be described as
making Keyboardia sound better than another product until one is.

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

1. **The bypass caps the measured scope.** Every unlocked step — the default,
   and most notes in most sessions — renders through the bypassed graph by
   construction. The change makes the velocity lane expressive; it does not
   change how a session with no volume locks sounds at all. Tone Nets' filter
   acts on every note. That trade is deliberate (it is what makes the change
   shippable without a migration), but it means this change narrows the
   per-note gap only where users reach for dynamics.
2. **A static cutoff is one of three per-voice elements, not all of them.**
   The SF2 bank pairs its velocity-dependent cutoff with a filter *envelope*
   on 89% of zones and a vibrato LFO on 100% — the attack-opens-filter motion
   that the comparison identified structurally. This change supplies the
   velocity slice only; per-note motion stays out of scope (see §9).

**Effort.** Medium. **Claim level:** internal metric improvement.

---

## 4. What the measurements demote — loop points

`specs/research/TONE-NETS-COMPARISON-2026-08.md` §4.7 listed sustain loops as a
lesson, reasoning from the SF2's 100% loop rate. **The measurement in §1.2 does
not support acting on it**, and this plan drops it:

- The sustaining instruments already hold far longer than any realistic tied
  note: `string-section` 9.34 s, `french-horn` 9.70 s, `alto-sax` 5.86 s,
  `clean-guitar` 5.10 s. `hammond-organ` is the one instrument that declares a
  loop, but its 4.48 s median is not the shortest sustaining library
  (`finger-bass` is 3.90 s). Loop presence therefore does not establish that
  the other libraries need loops.
- A note *can* exceed those ceilings — 60 BPM with a 128-step track fully tied
  is 32 s — but that is an extreme session, not the common case.
- The two genuinely short instruments, `slap-bass` (0.42 s) and
  `acoustic-guitar` (2.06 s), are plucked. A decay to silence is correct
  behaviour there, not a defect.

**Instead:** add a library-level regression guard so a future sample swap
cannot degrade the typical root silently. Assert that every *sustaining*
instrument's **median native-root** usable seconds is at least the longest tied
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
| `pumpingProfile` on an exact replay of the captured 16-track pre-compressor programme | same synchronized programme replayed once dry and once wet | no new pumping — reverb energy is downstream and must not drive the compressor |

The production-browser probes now supply the thresholds and evidence across
the audit reruns: full-band tail +19.7 to +21.1 dB and high-band tail +23.6 to
+25.1 dB from the corrected 300 ms boundary, bass-body low band within
±0.109 dB, wet true peak within 0.013 dB of dry, maximum K-weighted loudness
within 0.055 LU. The capacity gate captures a real 16-track pre-compressor
programme once, stops the scheduler, and replays those exact samples through
the production master path under dry and wet room states. Three repeated
48 kHz runs produced a 0.000 dB compressor-attenuation delta, matching the
graph topology: the room branches after the compressor and cannot causally
change its gain reduction. Exact peak ordering in the separate live room probe
varies below its repeat floor, so that gate allows the measured floor plus
0.01 dB instead of claiming bit-stability. The committed assertions retain
useful margin around those observations rather than comparing against an
offline reverb proxy.

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
| **Voice warm-up** | Measure before adding silent voices | One first-use priority-loaded `slap-bass` fixture with a preinitialized dry master: 38.7–54.7 ms DOM-click-event-to-audible across 13 fresh Chromium contexts after the late-note fix; its pre-compressor repeat null was 0 dB peak and ≤0.000002 dB RMS spread, while the retained heard-output diagnostic was ≤0.010/0.005 dB peak/RMS. A zero-lead negative control failed the source RMS gate in 2/12 contexts. | **Not indicated for the sampled fixture only:** the cold matrix establishes first-output latency, but does not compare first-note versus steady-state latency in the other three domains; silent playback would perturb round-robin/choke state |
| **Clock-liveness gate** | Every transport start samples `currentTime` after any resume path, including already-`running`, gesture-resumed, suspended, and interrupted contexts | Helper tests cover frozen/advance/timeout; engine and transport tests fail if the caller omits the check. Timeout is non-fatal but logged; cancellation prevents an obsolete start. | Small |
| **`navigator.mediaSession`** | Lock-screen transport and metadata | Play and pause are idempotent state commands across pending startup, cancellation, independently paused output, and active transport—not toggles. Lifecycle integration tests exercise each state. | Small |

---

## 7. Implementation order (historical)

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

## 8. Objective Keyboardia-versus-Tone-Nets comparison

The comparison is deliberately about **observable improvements**, not whether
one timbre is more pleasing. A spectral distance between the two products
would mostly measure different samples, instruments, note scheduling, and
arrangements; smaller distance would mean “more similar”, not “better”. The
valid cross-product measurements are therefore capability coverage and a
single product-boundary performance observable: user start action to first PCM
at each product's master bus.

On 2026-09-13, Playwright Chromium 143 on an arm64 Mac at 48 kHz ran five
fresh-browser-context trials per path against warm local servers. An
`AudioWorkletProcessor` scans each render quantum, retains the exact absolute
frame of the first master-bus sample at or above `1e-4`, and maps that frame to
the page clock with `AudioContext.getOutputTimestamp()`. A control recovered a
source scheduled at context time 0.1 s with 0 ms frame error while the main
thread was deliberately blocked for more than 700 ms. Observer readiness is
also bound to a known pre-emission application event: Keyboardia holds the
awaited scheduler-release boundary until the worklet is ready, while Tone Nets
requires readiness before its first source-to-master connection. The
Keyboardia wait is included in its latency. A deliberately 250 ms-late pulsed
observer still retained a positive silent prefix but measured the second pulse
400 ms after the true first pulse; the boundary rule rejected the case that the
old silent-prefix heuristic would have accepted. The observer is a zero-gain
side branch and does not replace the audible route.
Keyboardia starts from a loaded session page and times the first transport
click. Tone Nets starts from its loaded landing page and times MIDI selection,
its required first-contact action. Its path includes MIDI ingest, fetch/parse
of the 7,557,598-byte SF2, deliberate stabilization delays, worklet creation,
and warm-up notes. That is a meaningful product-boundary comparison, but not
an equal-work microbenchmark.

| Product/path | Min | Median | p95 (= max at n=5) | Tone Nets / path median |
|---|---:|---:|---:|---:|
| Keyboardia whole engine + native `synth:lead` | 243.0 ms | **244.5 ms** | 270.1 ms | 4.97× |
| Keyboardia cold Tone `tone:fm-epiano` | 345.9 ms | **354.5 ms** | 375.3 ms | 3.43× |
| Keyboardia cold advanced `advanced:supersaw` | 370.0 ms | **383.6 ms** | 398.5 ms | 3.17× |
| Tone Nets first MIDI/SF2 sound | 1,195.2 ms | **1,215.9 ms** | 1,243.8 ms | 1.00× |

This establishes that the tested Keyboardia medians are 68.4–79.9% lower than
Tone Nets' tested first-contact median on this machine. An immediately preceding
valid five-trial Keyboardia batch recorded one 755.9 ms advanced contention
outlier (its engine-exposed and Tone-ready milestones were delayed in the same
trial), although the final retained batch's advanced maximum is 398.5 ms. At
n=5, reported p95 is the observed maximum, not a population tail estimate. It
does **not** establish that Keyboardia's engine is universally faster, that a
different device preserves the ratio, or that listeners prefer its output.

The Keyboardia matrix is a gating E2E test and writes
`test-results/audio-capture/browser-cold-startup-matrix.json`. Tone Nets is
measured by `npm run measure:tone-nets-startup`; the script refuses to run if
any of the ten frozen HTML, CSS, JavaScript, SoundFont, or background-media assets
differs from the §7 hashes in the comparison document. Both retain every trial
rather than only the median. The final paired raw values and control results
are checked in as
[`TONE-NETS-STARTUP-RECEIPT-2026-09-13.md`](./research/TONE-NETS-STARTUP-RECEIPT-2026-09-13.md).

The remaining comparative gap is now named correctly: **listener preference**,
not “a matched capture”. A matched timbre capture without a validated perceptual
endpoint would be objective data attached to an invalid quality inference.

## 9. Scorecard: original baseline versus audited state

Added 2026-08-22, after re-verifying both anchors: `origin/main` is still the
pinned `58264dd`, and the live Tone Nets deploy hashes byte-identical to the
§7 receipt of the comparison doc (same index page SHA-256, same asset
fingerprints, same 7,557,598-byte SoundFont). Both sides of the comparison are
frozen, so the baseline numbers stand.

The plan is implemented. “Current” below means the audited PR state, not the
original 2026-08-19 baseline.

| Dimension | Original baseline | Current audited state | Remaining vs Tone Nets |
|---|---|---|---|
| Mobile audibility (iOS ringer switch) | direct Web Audio destination | final media-element route implemented; physical result unclaimed | physical iPhone ringer-off and latency gate |
| Velocity → timbre, sampled path | 0% centroid spread on 12/26 instruments | 29.7–30.3% v40-v127 centroid drop on 281 requested notes for six tonal gain-only instruments; v≥90 bypass | unlocked steps unchanged by design; no time-varying filter motion |
| Per-note motion (filter envelope, LFO) | none | none — out of scope | full gap: SF2 has a filter envelope on 89% of zones, LFO on 100% |
| Default space | `reverb.wet: 0` | 0.15 bass-protected, new sessions only; browser tail/body/peak/LU/pumping gates pass | per-instrument depth — Tone Nets carries sends per zone |
| Startup (warm-up, clock-liveness) | clock trusted state; warm-up only a hypothesis | liveness gate plus sampled-first-use and three-domain cold matrix; late real-time sampled notes use `max(3 ms, 513 / sampleRate)` lead so the de-click ramp reaches the audio thread intact; retained medians 244.5/354.5/383.6 ms; a preceding valid batch exposed one 755.9 ms advanced outlier | device matrix; no silent warm-up indicated for the sampled fixture only |
| `navigator.mediaSession` | absent | idempotent play/pause lifecycle implemented and tested | — |
| Device quality tiers | none | none — not carried into this plan | comparison §4.8 remains open |
| Source material | 582 files / 36 MB with real layers and round robins | unchanged | different breadth/structure trade-off; no preference claim |
| Timing / multiplayer | worklet scheduler, live collaborative transport | unchanged | Tone Nets has a different fixed-MIDI timing job |
| Objective cross-product evidence | static architecture only | repeated first-contact PCM measurement with frozen assets | device generalization |
| Listener preference evidence | none | none | randomized, level-matched study if a preference claim is wanted |

The implementation also changed the epistemics: the gap is now instrumented.
`measure:velocity-timbre` and `simulate:velocity-filter` re-derive every number
in this table from the shipped assets, so after any landing the same commands
show exactly which rows moved.

## 10. Implementation record (2026-08-22)

What shipped, and in which lane each preregistered target was verified. Product
changes are **internal improvements**; the frozen-reference startup row is an
**objective cross-product difference** under the disclosed asymmetric
workloads. Neither is a listener-preference claim.

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
| Default room | Tone effects + real master chain | Chromium deterministic probe + exact paired replay of a captured 16-track capacity programme | corrected tail boundary; bass-body/peak/LU bounds; same-input wet-vs-dry capacity pumping | passed |
| Legacy room migration | HTTP hydration + real master chain | effects-absent stored session | exact dry state plus live render at explicit-dry repeat null | passed |
| Sampled first use | preload + scheduler + sampled voice | priority-loaded `slap-bass`, five hits; master preinitialized; 13 fresh contexts | 38.7–54.7 ms DOM event to audible; source-tap repeat null 0/≤0.000002 dB peak/RMS; heard-output diagnostic ≤0.010/0.005 dB; zero-lead mutation fails source RMS in 2/12 contexts | passed with `max(3 ms, 513 / sampleRate)` real-time sampled lead; 10.6875 ms at 48 kHz; no silent voice warm-up indicated in this fixture |
| Cold engine startup | transport + engine/preload + master output | five fresh contexts each for native, Tone, advanced | audio-thread-retained first master-PCM frame; scheduler-boundary, pulsed-late-install, overload, and 700 ms main-thread-block controls | passed; retained medians 244.5/354.5/383.6 ms; preceding-batch max 755.9 ms disclosed |
| Frozen Tone Nets reference | external first-contact path | five fresh contexts; exact ten-asset hash gate | MIDI selection to audio-thread-retained first master-PCM frame; readiness before first master input | measured; median 1,215.9 ms |
| Sustaining library statistic | validator | eight classified manifests | median native-root duration ≥2 s; no every-note claim | passed |
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
  16-track fixture captures one capacity programme, then replays those exact
  pre-compressor samples through dry and wet production master states. The
  migration lane loads an actual effects-absent stored session before comparing
  it with explicit dry.
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
  already `running`. The browser capture found that scheduling the first sampled
  note at `currentTime` could deliver its 3 ms de-click ramp partly in the past.
  The real-time sampled path now uses
  `max(3 ms, 513 / sampleRate seconds)`—four 128-frame render quanta plus one
  frame—when the requested event has less lead; at 48 kHz that is a disclosed
  10.6875 ms floor. Sufficiently future-scheduled sampled events keep their
  requested time, offline sampled renders retain a zero floor, and
  native/Tone/advanced paths are unchanged. Thirteen fresh browser contexts
  then held the causal
  pre-compressor repeat null below 0.000002 dB RMS. This removes a
  late-scheduling transient; it is not silent voice warm-up. The retained
  negative/guarded receipt is
  [`SAMPLED-FIRST-USE-RECEIPT-2026-09-13.md`](./research/SAMPLED-FIRST-USE-RECEIPT-2026-09-13.md).
  A separate five-trial-per-domain browser
  test now measures cold Tone, advanced-instrument, and whole-engine first PCM;
  retained medians were 244.5/354.5/383.6 ms on the recorded environment. One
  advanced trial in the immediately preceding valid batch reached 755.9 ms
  under same-trial initialization contention.
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
13. **The comparison initially trusted a main-thread audio observer and a
    partial external receipt.** `ScriptProcessorNode` can lose the actual onset
    buffer during a long main-thread stall, and `getOutputTimestamp()` cannot
    reconstruct samples the callback never saw. The connect shim also rebuilt
    optional arguments, changing an explicit-`undefined` overload. The final
    oracle retains the exact first-PCM frame in an AudioWorklet, proves it under
    a 700 ms main-thread block, preserves and tests connect overloads, and hash-
    gates all ten executed Tone Nets startup assets rather than four visible
    entry assets. A later audit showed that a positive silent prefix still does
    not prove early attachment: a late observer can miss one pulse, collect
    silence, and report the next. The oracle now binds readiness to each app's
    known pre-emission boundary and keeps the pulsed counterexample as a guard.
14. **The sampled warm-up fixture gated the wrong causal story.** Its original
    assertion collapsed five heard-output windows into one spread. A CI run
    exceeded the 0.3 dB RMS bound even though peak level was stable. The retained
    zero-lead counterexample failed at the source tap in 2/12 contexts: within
    its first-256-frame window, frames 0–142 differed and 143–255 were equal.
    The failed attack fits a 16-frame ramp rather than the intended 144-frame
    ramp, isolating one lost 128-frame render quantum rather than loading or
    master gain.
    The first scheduler event had been clamped to `currentTime`, so its 3 ms
    de-click automation sometimes reached the audio thread one render quantum
    late. The production fix reserves four quanta plus one frame for late/near-
    deadline real-time sampled notes. The fixture now aligns and reports
    pre-compressor and heard-output
    taps separately, gates the causal source tap at 0.01 dB, writes its evidence
    before assertions, and leaves the stateful master result as a diagnostic.
    Its schema-v3 report retains the exact first 256 causal source frames.
15. **A shared fixture was mistaken for a paired audio experiment, and its
    required lane existed only in CI.** The capacity test captured dry and wet
    windows sequentially while 16 live schedulers continued to run. Those
    windows named the same session but did not contain the same input samples;
    oscillator/sample phase and render-quantum placement could therefore swamp
    a 0.1 dB causal budget. A macOS 48 kHz run narrowly crossed it at +0.103 dB,
    while Linux at 44.1 kHz reported +1.373 dB. The same Linux run also exposed
    +0.152 dBFS/+0.152 dBTP at the user output: the −1.75 dB trim had been
    calibrated too close to one platform's observed ceiling. The production
    trim is now −2.25 dB. The test captures one live capacity programme and
    replays the exact pre-compressor samples twice through the production
    master graph, changing only the room state; three 48 kHz repeats measured
    0.000 dB pumping delta and remained below −0.76 dBTP. The complete five-test
    dev-only PCM file is now an exact-inventory pre-push gate. Cross-platform
    safety is enforced in the required Linux CI lane rather than inferred from
    a single hardware sample rate.

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
than a claim inferred from WebKit or Chromium emulation. §8 closes the objective
desktop first-contact comparison; a randomized, level-matched listening study
remains necessary only if release language asserts listener preference.

## 12. Feasibility of the three remaining Tone Nets-inspired features

These are implementation decisions derived from the current production graph,
not from a belief that copying Tone Nets must sound better.

| Candidate | Viability | Likely objective impact | Required proof | Decision |
|---|---|---|---|---|
| Sampled-note filter envelopes and LFOs | **Medium.** Native and advanced synths already have both; only the sampled path is missing them. An envelope can automate the existing `BiquadFilterNode`, but motion on default-velocity notes would remove the deliberate v≥90 byte-identical bypass. A per-note Web Audio LFO adds an oscillator and gain node per active sampled voice; a shared/worklet design is cheaper but changes retrigger/phase semantics. | Moves sampled per-note motion from 0 configured instruments toward an explicit subset; creates measurable time-varying centroid/pitch/amplitude instead of a static velocity cutoff. CPU/node count and legacy-session timbre also rise. | Opt-in manifest schema; attack/hold/release centroid trajectories; v90 legacy null for instruments without the option; 16-track capacity, late-note, long-task, and voice-cleanup gates; ablation with motion disabled. | **Prototype after Phase 44, do not roll out globally.** Start with filter envelopes on 2–3 sustaining tonal instruments. Add LFO only after capacity data chooses per-voice versus shared/worklet architecture. |
| Per-instrument reverb-send depth | **Medium-high.** The current room send is after all track buses have already mixed, so a scalar cannot simply be added to the manifest. `TrackBus` needs a post-fader/post-pan send feeding a shared reverb input while its dry output continues to master. Defaults can be derived from instrument ID without changing session schema; user-authored overrides would require synced state. | Allows the existing measured 0.15 room to keep drums/bass drier while lengthening tonal tails. It narrows the structural gap from one global send toward Tone Nets' per-zone sends, but does not prove a preferred mix. | Graph-termination and no-double-dry tests; send=0 dry null; send ordering across preregistered instrument classes; existing bass-body, peak, LU, tail, and 16-track pumping gates; instrument-change lifecycle test. | **Best next engine candidate.** Implement class/instrument defaults first, with no UI or session field, then decide whether authored overrides justify schema work. |
| Device-specific quality tiers | **Conditional.** Keyboardia already has an iOS cache tier, but its allocation models differ: native has one global 16-voice pool, advanced has eight voices per track, and the Tone path reuses one monophonic instance per base synth type rather than an eight-voice pool; pitch-shift grain size is 1024. UA-only mobile classification is too coarse; `deviceMemory` is absent on Safari and `hardwareConcurrency` may be clamped. | Can trade polyphony where a pool exists, graph cost, and pitch-shift latency/quality to reduce late notes and long tasks on constrained devices, or increase headroom on proven desktop hardware. A wrong tier silently lowers quality or steals notes. | Physical low/mid/high device matrix; dropped/late-note and voice-steal counters (current metrics have late notes and long tasks but no audio-underrun/dropout counter); spectral/latency tests for each grain size; deterministic override and safe fallback. | **Not viable as an automatic default yet.** First add dropout/voice-steal observability and a local Auto/Eco/High override, then calibrate thresholds on physical devices. Do not copy Tone Nets' `isMobile()` switch. |

The priority follows expected information gain: per-instrument sends reuse the
room whose safety is already measured; sampled motion needs a constrained
prototype to discover its CPU and migration cost; quality tiers cannot be
trusted until the engine can observe the failures they are meant to prevent.

## 13. Completion boundary and open work

Phase 44's code and desktop automated gates are implemented. The following
items must not be collapsed into that statement:

| Item | Phase 44 status | What closes it |
|---|---|---|
| Physical mobile output | **Open release gate** | Safari and Chrome on a physical iPhone with ringer off, plus added output-latency measurement |
| Startup generalization | **Measured on one desktop environment only** | preregistered physical/device/browser matrix; five-trial p95 here is the observed maximum, not a population tail estimate |
| Silent voice warm-up | **Rejected only for the sampled `slap-bass` fixture** | first-note-versus-steady ablations for native, Tone, and advanced paths before making a broader claim |
| Sustain loops | **Deliberately demoted, not missing** | no action while the manifest-driven duration guard passes; add instrument-specific loops only after a requested-note/session failure |
| Sampled filter envelopes/LFOs | **Feasibility assessed; not implemented** | the constrained prototype and gates in §12 |
| Per-instrument reverb sends | **Feasibility assessed; not implemented** | derived-default graph prototype and gates in §12; schema/UI only if authored overrides are justified |
| Device quality tiers | **Not viable for automatic rollout yet** | dropout/underrun and voice-steal observability, local override, then physical calibration |
| Listener preference | **Unmeasured and outside the objective comparison** | randomized, level-matched listener study with confidence intervals, only if preference language is desired |
