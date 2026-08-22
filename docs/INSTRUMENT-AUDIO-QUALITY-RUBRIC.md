# Instrument audio-quality rubric

## Claim boundary

This rubric ranks **measurable technical improvement priority** for every
selectable Keyboardia instrument. It does not turn audio engineering metrics
into a claim that one timbre is more realistic, pleasant, or musically useful
than another. Those claims require a level-matched listening comparison.

The catalogue currently contains 99 IDs: 22 procedural Web Audio buffers, 32
native Web Audio synth presets, 11 Tone presets, eight advanced Tone voices,
and 26 sampled instruments. The evaluator must fail or lower its evidence grade
when an ID is missing; it must never silently drop an instrument.

Two outputs stay separate:

1. **Priority score (0–100, larger is worse):** deterministic repair debt from
   measurements and role-aware source coverage.
2. **Evidence grade (A/B/C/F):** how much actual audio was observed. Evidence
   gaps do not become invented quality points.

A zero score means “no technical deficit detected by the available lanes,” not
“perfect sound.” A hash-bound waiver changes CI disposition only. It does not
erase the underlying finding from the score.

## Executable v1 lanes

`npm run audit:instrument-quality:v1` runs and joins these sources:

| Lane | Scope | What it establishes | What it does not establish |
|---|---|---|---|
| Catalogue + calibration | all 99 | ID, engine, category, explicit source trim | audible output or timbre |
| Chromium sequencer probe | all 99, one representative in-range note | real preparation, routing, continuous per-track sample peak, whole-window RMS, non-silence | inter-sample true peak, full range, release, spectral quality, preference |
| Decoded source audit | all 582 files used by 26 sampled instruments | headroom, clipping, DC, onset, tail, pitch estimate, loop seam, stereo/mono, layer/note levels | whether a flagged source sounds objectionable |
| Manifest coverage | 26 sampled instruments | root distance, velocity-layer count, same-layer alternatives | artistic value of more layers/samples |

The aggregator is `app/scripts/audit-instrument-quality.ts`; pure scoring lives
in `app/scripts/instrument-quality-rubric.ts`. JSON and Markdown reports are
written under ignored `app/reports/instrument-quality/` unless paths are
supplied. Matrix plans and receipts live there as well, so Playwright clearing
its `test-results/` output directory cannot delete a receipt before aggregation.

The browser test runs before the decoded audit because Playwright clears its
configured results directory at startup.

The live lane connects every post-track bus and `masterGain` to an
`AudioWorklet` accumulator for an exact 2.5-second render-frame window. It
visits every channel sample, reports the maximum absolute PCM sample, and
computes RMS from the sum of squares over the whole window. The receipt binds
the sample rate, captured-frame count, and channel-sample count for each track
and session, so a polled analyser window or maximum-block RMS cannot satisfy
the schema. “Peak” in this lane means continuous **sample peak**, not an
oversampled inter-sample true-peak estimate.

## V1 priority score

All point functions are committed, bounded, and tested. Components add and the
total is capped at 100.

| Component | Points | Deterministic rule |
|---|---:|---|
| Missing source calibration | 20 | fixed if the catalogue ID has no explicit manifest/fixed trim |
| Silent canonical live note | 40 | fixed when both measured peak and RMS are below the committed silence gates |
| Complete-matrix fatal finding | 40 | fixed if any fatal gate is present in a verified full dry-PCM receipt |
| Unwaived decoded-source error | up to 40 | 20 per error |
| Source headroom | up to 12 | `1.5 × max(0, live track peak dBFS)` |
| Category-level outlier | up to 6 | `max(0, (abs(RMS delta) − 18) / 2)` against the category median; a review prompt, never auto-normalization |
| Accepted/review source burden | up to 30 | `5 × weighted findings / decoded unique files` |
| Sample-root distance | up to 8 | `max(0, worst nearest-root distance − 4)` semitones |
| Velocity-layer shortfall | up to 8 | four points per missing role-target layer |
| Same-layer variation shortfall | up to 6 | three points per missing role-target alternate |

Review-finding weights prevent a late onset from counting the same as a mono
collapse while normalization prevents a 215-file pack from losing merely
because it exposes more source material:

| Weight | Finding |
|---:|---|
| 3 | clipping samples, DC, loop seam, negative phase/mono loss, velocity inversion, note-level step, range overextension |
| 2 | tail truncation, pitch deviation, unchecked loop |
| 1 | hot peak, residual leading silence |
| 2 | unknown future review code (fail-visible default) |

The current role targets are deliberately small and attainable:

- three velocity layers and two same-layer takes for acoustic kick, snare,
  hats, ride, and crash;
- two layers for piano, mallets, guitars, basses, sax, horn, and strings;
- two same-layer takes for finger bass and steel drums;
- no variation penalty for deliberate fixed 808/electronic one-shots,
  sustained Hammond, vinyl texture, or synthesized voices.

Adding samples is not automatically an improvement. Targets identify a
measurable expressive-coverage gap; a candidate still needs blinded A/B review.

Priority bands are: critical `>=40`, high `>=25`, medium `>=12`, low `>0`, and
baseline `0`. Sorting is score descending, weaker evidence first, then stable
instrument ID.

## Existing decoded-source thresholds

The v1 evaluator consumes the canonical sample audit rather than duplicating
it. Its current review/failure boundaries are:

- decoded lossy-source peak above −2.5 dBFS as a codec crest-margin review;
  exact lossless PCM instead uses clipping/flat-top checks, while true delivered
  headroom is measured only at the post-track PCM/browser lane;
- DC above −60 dBFS for review and −40 dBFS for failure;
- effective onset above 10 ms;
- free tail ending above −35 dB relative to peak;
- pitch estimate over 10 cents at confidence at least 0.52;
- stereo correlation below −0.2 or mono loss worse than 3 dB;
- loop boundary value jump above −35 dB relative to peak or boundary-slope
  discontinuity above 4× the local derivative RMS;
- velocity inversion worse than 1 dB;
- adjacent-note/layer step above 3 dB;
- range extension more than six semitones beyond an outer root;
- canonical tonal K-weighted loudness outside ±2.5 dB of piano C4-mf.

Pitch flags for bells, mallets, bass fundamentals, or other inharmonic material
are review evidence, not permission to auto-retune. The current estimator also
searches near the expected root and folds cents, so it cannot prove absence of
broad octave mistakes.

## Evidence grades

- **A:** every shipped source file decoded/analyzed and one real Chromium
  sequencer note observed.
- **B:** real Chromium sequencer note plus static engine/configuration checks,
  but no complete isolated PCM sweep.
- **C:** static evidence only because the live receipt is absent.
- **F:** the canonical live note is silent.

This makes the main limitation visible: all 26 sampled instruments can reach A,
while procedural/native/Tone/advanced instruments currently reach B. Their
schema tests and one live note are not a full timbre evaluation.

## Dry PCM matrix evaluator API

`app/scripts/instrument-quality-matrix.ts` now commits 99 role profiles, builds
all 1,683 required cases, validates contiguous finite PCM, calculates metrics
and gates, hashes canonical float PCM, and fails closed on incomplete receipts.
It scores delivered PCM by musical role, never by engine. Every profile records:

```text
role, pitch mode, envelope class, loudness class, descriptive velocity policy,
release policy, seed-replay policy, mono-fold policy, and render lengths
```

Required render matrix:

| Case | Matrix | Purpose |
|---|---|---|
| Canonical | dry, centered, effects off, MIDI 90 | common safety/level/envelope anchor |
| Range | min/Q1/mid/Q3/max plus worst repitch point | silence, pitch and continuity |
| Velocity | MIDI 32/64/90/127 | amplitude/timbre response and layer cliffs |
| Release | role-specific gate plus 1.5–3 s tail | clicks, truncation, stuck voices |
| Repeats | 16 hits at seed A, seed B, and a fresh seed-A replay | bit-exact replay; for declared procedural voices, whether the seed mechanism changes any PCM |
| Polyphony | role-appropriate chord or eight-hit overlap | aggregate safety/level stress only; it does not prove individual-voice survival |
| Stereo | centered dry capture and mono fold | phase/translation only; it does not grade artistic width |

Recommended technical dimensions total 100: functional coverage 20, signal
safety/translation 15, timing/envelope 15, level/dynamics 15, pitch or
transient-role fidelity 15, and behavioral/timbral consistency 20. Across a
matrix, aggregate each metric as `0.50 × worst + 0.30 × P10 + 0.20 × median` so
one broken note remains visible without rewarding small sample maps.

Hard gates for the full lane include missing required capture, non-finite PCM,
frame gaps, any declared note silent, heard true peak above 0 dBTP,
scale-invariant flat-top shape, DC above −40 dBFS, high-confidence **absolute**
pitch error above 50 cents, and mono loss above 3 dB. Tonal single-note cases
with no reliable absolute fundamental fail closed as inconclusive, rather than
passing; octave errors are not cent-folded. A residual above −40 dBFS in the
pinned 100 ms window beginning exactly two seconds after note-off is fatal only
for profiles declaring a voice-lifecycle
release. Natural-decay one-shots (including rides and cymbals) retain the tail
metric for truncation/decay review without being forced silent.

Use a pinned evaluator commit against candidate branches. A branch must not
change its own weights or thresholds and then grade itself. The receipt stores
Node/platform, browser identity when supplied by the adapter, pinned 44.1 kHz
sample rate, adapter identity/hash, evaluator/subject commits, evaluator-tree
hash, plan/profile identity, unique capture attempts, and per-case PCM hashes.
Every complete receipt must be accompanied by its content-addressed
`planar-f32le-v1` sidecars. Keep those large raw artifacts in durable CI artifact
storage (not Git) for as long as the receipt is claimed as independently
verifiable; a JSON hash without the matching bytes is not evidence.
`planar-f32le-v1` is headerless IEEE-754 Float32 little-endian PCM: every frame
of channel 0, then every frame of channel 1 when present. The pinned receipt
supplies sample rate, channel count, and frame count, so the verifier requires
an exact `channels × frames × 4` byte geometry before decoding.

The repository contains a production-path Chromium adapter that schedules the
real sampled, procedural-sample, native-synth, Tone.js, and advanced-synth
renderers and records the centered post-track/pre-master bus at exactly
44.1 kHz. Each attempt uses a fresh seeded Chromium process and browser context,
Chromium's pinned `playback` latency mode, and an AudioWorklet that fails closed
on missing frames or any `currentFrame` discontinuity. Process isolation avoids
render gaps observed when successive real-time AudioContexts shared one
headless Chromium process. The seeded generator resets immediately before audio
engine initialization, so unrelated page startup cannot consume part of a
procedural instrument's random sequence. A case may use at most three fresh
process attempts. Only a typed nonzero-render-drift rejection or a failure at an
explicit browser/context cleanup boundary is retryable; generic capture errors
remain authoritative and are never hidden by teardown errors. Every rejected
attempt is retained in the smoke receipt, and PCM from a cleanup-failed attempt
is discarded. Accepted PCM still requires zero missing frames, zero render drift,
and a clean process teardown. Relative note and gate times
are quantized once to 44.1 kHz render frames before absolute scheduling, avoiding
cross-context floating-point boundary ambiguity. The quick smoke proves this adapter path
with six captures (five engine families plus a distinct seed-A replay); it is
explicitly **not** the complete 1,683-case matrix:

```sh
cd app
npm run audit:instrument-quality:matrix:plan   # emits instructions only
npm run audit:instrument-quality:matrix:smoke  # real 6/1,683 Chromium captures
npm run audit:instrument-quality:matrix:verify # recomputes a supplied receipt from raw PCM
```

`AudioWorklet.currentFrame` is treated as the authoritative render clock. A
repeat or skip fails the attempt rather than being relabelled as harmless
diagnostic noise. The smoke receipt is durable under ignored
`app/reports/instrument-quality/`, declares `complete: false`, binds the full
subject commit, and verifies that the same commit remains clean immediately
before it writes the receipt.

`npm run audit:instrument-quality:full` is deliberately fail-closed: it now
requires that verified receipt in addition to v1 evidence. Use
`npm run audit:instrument-quality:v1` for the currently executable browser-note
and decoded-source lanes. Neither a plan nor the representative smoke is
silently upgraded to complete-matrix evidence.

Full verification requires canonical full Git commit IDs, exact matrix
evaluator/subject/tree binding, and evaluator sources byte-identical to the
pinned evaluator commit. It also verifies that the adapter is a real,
repository-contained file with the recorded byte hash; loads every canonical
planar Float32LE sidecar; validates byte geometry and finite samples; recomputes
the PCM hash, metrics, findings, evidence gaps, and cross-case comparisons; and
rejects any fatal finding or evidence gap. Missing or modified raw artifacts
therefore fail closed. A dirty evaluator is reported as unpinned in v1 and is
rejected in full mode. Use `--pcm-root <path>` when the sidecars are restored
outside the default `reports/instrument-quality/dry-pcm-matrix-pcm/` directory.

Cross-case claims are deliberately limited. The receipt records velocity
active-RMS/loudness/centroid deltas, aggregate polyphony deltas, mono-fold
metrics, and descriptive spectral centroid. These are measurements, not
preferred-response thresholds. Seed A must replay bit-exactly or the receipt is
invalidated as a harness/determinism failure. For the small committed set of
seed-controlled procedural voices, A/B hash inequality means only that the
variation mechanism changed PCM; it does not prove audible or desirable
timbral variety.

Because large PCM buffers are not embedded in JSON, external receipt
validation can prove schema, geometry, provenance, hashes, gate consistency,
and cross-case consistency, but cannot independently recompute a metric from
the audio bytes. Preserve the ephemeral PCM artifacts when forensic
recomputation is required; a hash by itself is not proof of metric correctness.

## Listening gate

Automation can establish safety, consistency, and regression. It cannot prove
realism, naturalness, mix fit, lack of fatigue, or preference. Candidate sound
changes therefore use the existing A/B page with:

- onset alignment and RMS/loudness matching for comparison mode;
- unscaled unity gain for null mode;
- randomized/blind A/B order;
- low/mid/high range anchors, soft/medium/hard strikes, and repeated notes;
- separate 1–5 ratings for cleanliness, articulation, sustain/tail,
  range/dynamics continuity, and role fit.

Report listener-level results and uncertainty. Do not blend a perceptual score
into the technical score until sample size, weighting, and success criteria are
preregistered.
