# Phase 44 — Sound Changes and Their Measurable Impact

**Date**: 2026-08-19
**Driver**: `specs/research/TONE-NETS-COMPARISON-2026-08.md`
**Predecessor**: `specs/SOUND-QUALITY-PARITY-PLAN.md` (Phase 43, implemented)
**Status**: Implemented 2026-08-22 (see §10) except the graph warm-up and
the `french-horn` content work in §6. Baselines in §1 are measured at
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
| `marimba` | ff/mf/pp | **62.1%** |
| `piano` | ff/mf/pp | **31.5%** |
| `vibraphone` | ff/mf | **30.5%** |
| `alto-sax` | loud/soft | **26.2%** |
| `brushes-snare` | hard/single | 5.3% |
| `french-horn` | loud/soft | **1.9%** |
| the other 20 | single | **0% — gain only** |

**20 of 26 sampled instruments respond to velocity with loudness and nothing
else.** A soft hit is a quieter copy of a hard hit, sample-identical.

`french-horn` is a separate finding: it ships two velocity layers that are
acoustically almost the same file. That is a content defect, not an engine gap,
and no amount of filtering fixes it — it only hides it.

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
cutoff(v) = anchor × 2 ** (−1.5 × (1 − v / 90))    for v < 90
bypass (no filter node at all)                      for v ≥ 90
```

`anchor` is per-instrument, stored in the manifest, seeded at 2× the
instrument's measured dry centroid from §1.1. `90` is
`DEFAULT_STEP_MIDI_VELOCITY`.

**Why this shape and not the existing synth curve.** `velocityFilterCutoff`
(`synth.ts:120`) scales a *preset* cutoff by `0.3 + 0.7·√(v/127)`. Sampled
instruments have no preset cutoff, and anchoring it high enough to be
transparent at full velocity leaves it transparent at low velocity too — the
curve does nothing when ported directly. The SF2 gets its result differently:
per-zone cutoffs that are already partly closed (median 1,267 Hz) plus a
velocity modulator that sweeps down about two octaves. The curve above is that
idea with a per-instrument anchor.

**The zero-regression property — this is the point of the bypass.** Unlocked
steps use velocity 90. Bypassing at `v ≥ 90` means every step without an
explicit volume lock renders through a byte-identical graph. So unlike a
default change, this ships without reinterpreting anyone's saved music.

**Measured impact.** Centroid drop at velocity 40, simulated over the real
shipped samples with the real filter:

| Instrument | 1.5 oct | 2.0 oct | 2.5 oct |
|---|---|---|---|
| `french-horn` | 17.6% | 21.9% | 26.7% |
| `string-section` | **29.4%** | 35.3% | 41.4% |
| `steel-drums` | **31.2%** | 36.0% | 39.9% |
| `slap-bass` | **31.9%** | 39.3% | 46.3% |
| `hammond-organ` | **34.3%** | 39.3% | 44.3% |
| `acoustic-guitar` | 43.7% | 49.6% | 54.7% |
| `finger-bass` | 44.0% | 46.6% | 49.2% |
| `clean-guitar` | 44.1% | 47.8% | 51.9% |
| `kalimba` | 56.6% | 63.1% | 68.6% |

The target band is the 26–32% that the genuinely multi-sampled instruments
already occupy (`alto-sax` 26.2%, `vibraphone` 30.5%, `piano` 31.5%).
**1.5 octaves lands four of the nine in that band directly.** The guitars,
`finger-bass` and `kalimba` overshoot it because a flat 2× anchor is wrong for
their spectra — those four need their anchor tuned per instrument, which is
exactly why the anchor belongs in the manifest rather than in a constant.

**Preregistered acceptance.**

| Metric | Lane | Baseline | Target |
|---|---|---|---|
| `logSpectralDistance`, session with no volume locks, before vs after | offline render | — | **exactly 0** |
| Centroid spread across v=40…v=90, per gain-only instrument | `npm run measure:velocity-timbre` (extended to sweep velocity) | **0%** | 26–35% |
| Instruments that already have layers | same | 26.2–62.1% | unchanged within ±2% |
| `truePeakDbfs`, `loudnessKMax` at `userOutput` | `e2e/capture-session.spec.ts` | current | unchanged (a lowpass must not raise either) |

**Risk.** One extra node per voice on the hot path; check it against the
existing `audio-hot-paths.bench.ts` before and after. A wrong anchor makes an
instrument sound muffled at moderate velocity — hence the per-instrument value
and the ±2% guard on already-layered instruments.

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
| **`french-horn` layers** | Re-cut or re-source the loud/soft pair | `measure:velocity-timbre` spread rises from **1.9%** toward the 26%+ the other layered instruments reach | Content work, unbounded |

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
| Velocity → timbre, sampled path | 0% centroid spread on 20/26 instruments | 26–35% band on locked steps; 4/9 instruments immediately, 5/9 after per-manifest anchor tuning | unlocked steps unchanged by design; no response above v90 |
| Per-note motion (filter envelope, LFO) | none | none — out of scope | full gap: SF2 has a filter envelope on 89% of zones, LFO on 100% |
| Default space | `reverb.wet: 0` | 0.15 bass-protected, new sessions only | per-instrument depth — the SF2 balances sends per zone; ours is one global wet (§4.9 of the comparison, not committed here) |
| Startup (warm-up, clock-liveness) | absent | closed if §6 lands | — |
| `navigator.mediaSession` | absent | closed if §6 lands | — |
| Device quality tiers | none | none — not carried into this plan | comparison §4.8 remains open |
| `french-horn` dynamic layers | 1.9% spread (content defect) | unchanged unless the content work in §6 happens | remains until re-sourced |
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
  `DEFAULT_STEP_MIDI_VELOCITY`; anchors are per-manifest
  (`velocityFilterAnchorHz`), solved by
  `npm run simulate:velocity-filter -- --solve` to a 29.5–30.3% centroid
  drop at v40 for all nine target instruments — the flat-anchor overshoot in
  §3's table is gone. Verified: byte-identical PCM at v≥90 with and without
  the anchor on shipped samples (offline render); soft strikes measurably
  darker; layered instruments carry no anchor. The bypass-caps-payoff and
  no-motion limits stated under "Reconsidered limits" stand.
- **Change 3 — default room** (`effects-defaults.ts`). New sessions carry
  `reverb.wet 0.15` through the `new-session` fallback
  (`NEW_SESSION_EFFECTS_STATE`), exactly as §5 specifies; the shared
  `DEFAULT_EFFECTS_STATE` baseline the UI and audio chain initialize from
  stays dry (the Stack A identity catalogue renders it, so moving it would
  fail that gate), `LEGACY_MISSING_EFFECTS_STATE` stays 0, and the
  legacy-normalization guard is asserted in `session-defaults.test.ts`.
  **Still owed:** the browser-capture acceptance rows in §5 (tail rise,
  low-band ±0.3 dB, true peak, LU, pumping) — this container has no WebKit
  and the capture lane runs in CI.
- **Change 1 — mobile output** (`mobile-media-output.ts`, `engine.ts`).
  Mobile terminates in MediaStreamDestination → hidden `playsinline`
  element, started inside the existing unlock gesture; desktop path
  byte-identical; failure falls back to `destination`. Verified: routing,
  fallback, gesture retry, dispose (jsdom units). **Still owed:** the
  physical-iPhone ringer-switch pass and the output-latency measurement —
  CI cannot provide either.
- **§4 guard** (`instrument-classification.ts`,
  `scripts/validate-sustain-ceiling.ts`, in `validate:all`). Eight
  sustaining instruments pass with the exact §1.2 medians; plucked
  instruments deliberately unclassified.
- **§6**: `navigator.mediaSession` transport state wired into both
  scheduler implementations; clock-liveness gate (bounded 250 ms) after
  resume. **Deferred:** graph warm-up — its own acceptance requires a cold
  browser capture that does not exist yet; `french-horn` re-sourcing —
  unbounded content work.
- **Demo session**: `scripts/demo-sessions/whisper-to-roar.json`, seeded in
  the mock API (`/s/b7e0b220-3185-49ef-b9b0-15ab9df76aec` with
  `USE_MOCK_API=1`) and held to its promises by
  `src/data/phase44-demo-session.test.ts`: ≥8 filtered soft strikes, ≥4
  bypass accents, tied string sustains, kit ghost layers, the 0.15 room.
- **Provenance:** adding `velocityFilterAnchorHz` changed nine manifest
  hashes; `mapping-calibration.json` and `technical-curation.json` re-pin
  the amended manifests (sample content untouched — `shipped` hashes
  unchanged), and `clean-guitar` gains a zero-correction calibration entry
  as its pinning home. The immutable pre-enrichment baselines were not
  edited.
