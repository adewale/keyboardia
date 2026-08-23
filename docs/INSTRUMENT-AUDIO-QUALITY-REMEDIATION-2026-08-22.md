# Instrument audio-quality remediation report — 2026-08-22

## Scope and claim boundary

The retained measured production/ranking subject and evaluator are
`fb6c341941b6d7485d61bf4e63132b80b9128cd1`, rebased onto `main` at
`702ad0c525bd73844858c7ee7eddfb5a646e2c52`. The historical audio control is
`58264dd5ae274f63b1cd80b72aa823b76b21f28b`; it predates the remediation and
is not presented as the current PR base. The retained receipts and rankings
remain bound to `fb6c341`; they are not relabelled as evidence for a later
commit.

Two post-measurement commits harden CI and receipt verification without changing
production audio, assets, manifests, the sample-evaluator bundle, its baseline,
scoring thresholds, or ranking inputs. `a6bc402b0a17bde64e3e963bc266579deffe494b`
raises only two matrix integrity-test time budgets from 30 to 60 seconds.
`d360cf8f093ea3c8a1cfe94224a5c888fe90e2ec` scopes cross-platform tolerances
for five raw decoded aggregate fields when a retained receipt is compared with
a fresh decode. Because that second change is in the instrument evaluator's
source closure, the final verifier has a different evaluator-tree hash; it does
not retroactively regenerate or supersede the `fb6c341` ranking.

The complete worst-first table is
[`INSTRUMENT-AUDIO-QUALITY-AUDIT.md`](./INSTRUMENT-AUDIO-QUALITY-AUDIT.md), the
measurement contract is
[`INSTRUMENT-AUDIO-QUALITY-RUBRIC.md`](./INSTRUMENT-AUDIO-QUALITY-RUBRIC.md),
and the live branch/PR analysis is
[`INSTRUMENT-AUDIO-QUALITY-BRANCH-SCOPE.md`](./INSTRUMENT-AUDIO-QUALITY-BRANCH-SCOPE.md).

This is a technical repair-priority report, not a preference ranking. It keeps
three categories separate:

1. delivered-audio or runtime improvements;
2. evaluator fixes that make a measurement more truthful; and
3. disposition-accepted findings that remain measured debt.

## Current result

| Measure | Candidate result |
|---|---:|
| Instruments audible through the production sequencer | **99/99** |
| Repair-priority score | **155.2** |
| Priority bands | **0 critical / 0 high / 6 medium / 8 low / 85 baseline** |
| Post-track sample peaks above 0 dBFS | **3** |
| Decoded findings | **203 disposition-accepted** |
| Unwaived decoded errors / reviews | **0 / 0** |
| Complete dry-PCM matrix | **not run (0/1,683)** |
| Level-matched blind listening | **not run** |

Two independent candidate captures produce exactly the same 99 ranks, scores,
bands, components, silence decisions, above-zero classifications, and stable
production-dispatch projection. Their maximum per-instrument raw-energy spread
is 0.142 dB, below the prospective
0.5 dB evaluator-stability alarm. This proves repeatability of these technical
decisions in the captured environment, not bit-identical synth PCM.

The same final decoded evaluator reports **256 findings** on the original-main
scored paths and **203** here: **53 fewer (20.7%)**. The reduction is exactly:

- `LEADING_SILENCE`: 43 → 0
- `LOOP_VALUE_DISCONTINUITY`: 3 → 0
- `NOTE_LEVEL_STEP`: 3 → 0
- `TAIL_TRUNCATION`: 12 → 10
- `HOT_PEAK`: 21 → 19

All other decoded finding classes are unchanged.

An aggregate live-score delta is deliberately not published. The first fresh
control capture completed 99/99 instruments and 99 exact dispatches. The
independent second process lost its page execution context before it could
publish a receipt. The fail-closed workflow used zero Playwright retries, so no
control repeatability spread, ranking, or aggregate live score is admissible.
It did not average or select a favorable run. The valid decoded/control
artifacts, failed-run result, and hashes are preserved in
[`instrument-audio-quality-controlled-comparison-2026-08-22.json`](./evidence/instrument-audio-quality-controlled-comparison-2026-08-22.json).

## What is objectively better

| Area | Before | After | Objective reason |
|---|---:|---:|---|
| Decoded review findings | 256 | 203 | Same evaluator, thresholds, and original-main scored paths; 53 named findings no longer reproduce. |
| Hammond loop boundaries | 3 value discontinuities | 0 | Thirteen authoritative CC0 PCM16 WAVs use source loop coordinates adapted to Web Audio semantics; rendered-boundary tests verify value and slope continuity. |
| Acoustic guitar delivery | 15 AAC/M4A generation files; 2 tail findings | 15 one-generation PCM16 WAVs; 0 tail findings | Pinned CC0 sources receive a documented 10 ms EOF fade and 6 ms zero pad; receipt binds delivered bytes and transform. |
| Effective onset findings | 43 | 0 | Runtime/audit distinguish codec priming from authored attack; all 605 mappings decode in Chromium and WebKit without fixed 42 ms wind trims. |
| Finger-bass adjacent steps | 3.235 / 3.304 dB | 2.435 / 2.404 dB | Root-local gain edits clear the 3 dB gate with a deliberate 2.5 dB margin; global level is not lowered. |
| Steel-pan 62→63 step | 4.727 dB | 2.427 dB | Every MIDI-63 velocity zone receives the same local correction and now clears with margin. |
| `synth:growl` topology | unbounded resonant modulation could create extreme output | bounded modulation plus calibrated output | Focused render gates require finite, non-silent output, spectral motion, and peak at or below -3 dBFS. No cross-control live delta is claimed. |
| Procedural note-edge gain | default GainNode value could leak at an event boundary | intrinsic value is zero before automation | Regression proves initialization happens before scheduled attack automation; the current seeded PCM smoke replay is byte-identical. |
| Voice lifecycle | wall-clock cleanup; advanced `release=0` became 0.5 s | audio-clock retirement; authored zero preserved | Clock-driven, tempo-aware retirement and inactive-voice reuse regressions cover native and advanced paths. |
| Tone context mismatch | initialization/recovery could report ready with nodes on a stale context | fail closed before construction/reuse | Tests force a context switch failure and require initialization/recovery to reject. |

The Hammond source bytes are not needlessly attenuated: the exact PCM masters
are shipped and the existing -3 dB playback trim remains in the manifest.
Acoustic and Hammond remediation receipts record source identifiers, licences,
delivery hashes, mappings, and transforms. The 28 replacement files add
7,337,323 tracked bytes (1,379,673 → 8,716,996; 6.32×).

Slap bass's 28–72 playable range is intentionally retained. Narrowing it to
34–66 would make 12 of 45 formerly playable notes silent; clearing a rule by
removing 26.7% of the capability is not an audio repair.

## What the evaluator now proves more honestly

- Every selectable ID has a committed role profile and a deterministic
  1,683-case plan for pitch/range, velocity, replay, release, stereo, and
  polyphony.
- A complete matrix receipt is not trusted without raw PCM sidecars. The
  verifier reconstructs samples, recomputes metrics and hashes, validates the
  adapter identity, and rejects fatal findings.
- The live lane uses isolated single-track production dispatch, continuous
  AudioWorklet accumulation at post-track and pre-processing `masterGain` taps,
  exact geometry, fresh browser contexts, seeded RNG, dispatch/isolation
  receipts, closed-context checks, and two-run decision comparison.
- Sample dispositions bind source SHA, manifest SHA, a six-decimal stored
  measured value, exact threshold, baseline, and evaluator identity. Disposition
  matching keeps its `0.000001` absolute tolerance. For whole-receipt canonical
  recomputation, other decoder-derived numbers also keep `0.000001` except for
  five raw fields: `samples.spectral.centroidHz` allows `0.001` Hz;
  `samples.dcOffsetDb` and `samples.tailLevelDbRelPeak` allow `0.001` dB; and
  `samples.peakDb` and `samples.crestFactorDb` allow `0.00001` dB. Thresholds,
  metadata, finding decisions, counts, mappings, and hashes remain exact. No
  value is averaged, rewritten, or selected. Because the original unrounded
  reference is not stored, a receipt tolerance does not itself bound the true
  decoder-to-decoder difference.
- Loop checks use the actual continuous Web Audio boundary instead of
  correlating phase-unrelated windows.
- Stereo activity is derived from either channel, so exact anti-phase audio
  becomes a mono-loss failure instead of a null pass.
- Pitch policy detects absolute octave errors while preregistering harmonic or
  pitch-class handling for Hammond and bass. Inconclusive estimation is an
  evidence gap, not an accusation that the instrument is defective.
- Reports retain every improvement action and reject filtered/stale receipts;
  accepted dispositions still contribute repair-priority points.

The representative browser adapter smoke covers 6/1,683 cases across sampled,
procedural, native, Tone, and advanced paths. Accepted captures are non-silent,
exact length, zero drift, and have no fatal finding or evidence gap. That proves
the capture mechanism; it does not upgrade the matrix to complete.

## What is not resolved, and why

The 203 decoded findings are still review debt:

| Finding | Count | Why it was not changed automatically |
|---|---:|---|
| Pitch deviation | 144 | Root/harmonic truth needs listening and source metadata; scalar pitch is unsafe for ensemble, organ, bass, and inharmonic material. |
| Hot lossy-source peak | 19 | Requires authenticated lossless masters or a deliberate playback/source-trim decision after content and mix calibration. |
| Mono loss | 12 | Requires authoritative piano/marimba sources and level-matched stereo/mono review. |
| Tail truncation | 10 | Requires verified source identity and release-context listening. |
| Negative phase correlation | 9 | Must be adjudicated with mono loss and stereo intent. |
| DC offset | 8 | Requires exact alto-sax master identity before a source-domain repair. |
| Range overextension | 1 | Slap bass needs new roots or an explicit capability tradeoff; silent edge-note removal was rejected. |

Additional measurable gaps:

- Slap bass (+2.3 dBFS), kalimba (+2.4), and finger bass (+2.1) exceed 0 dBFS
  at the isolated post-track sample-peak tap. Web Audio floats internally, but
  these are headroom priorities. Broad trims are deferred until per-family and
  final-topology calibration plus level-matched listening can distinguish peak
  control from a tonal-balance regression.
- Ten sampled packs exceed the four-semitone nearest-root target: slap 12;
  French horn 7; acoustic guitar, clean guitar, kalimba, piano, marimba, finger
  bass, steel pan, and vibraphone 6.
- Five packs have one median velocity layer where the role profile targets two:
  slap bass, acoustic guitar, clean guitar, kalimba, and strings. Duplicating a
  file would not create real dynamics.
- The live tap reports sample peak, not inter-sample true peak, and its master
  canary is before compressor/effects/output. The full post-effects/listening
  question remains outside this lane.
- Real-time Tone/advanced starts are about 4,800 frames (~100 ms) later than
  native paths because Tone's lookahead is added after relative-time conversion.
  That changes groove/playability and needs a focused fix and timing evidence.
- The 73 non-sampled instruments have one isolated canonical live note plus
  static checks in the ranking. A zero score means no defect detected by those
  lanes, not equal or perfect timbre.
- No level-matched blind panel or full 1,683-case PCM artifact exists.

## Topologically sorted remaining work

The dependencies are common: trustworthy baselines and source provenance must
precede destructive edits; content and topology must settle before calibration.

1. **P0 — integrate branches safely.** Merge this PR, then rebase PR 87 and PR
   98 in that order; retain this PR's assets, runtime regressions, and evidence
   rules while regenerating evidence after each sound change.
2. **Q0 + S0 — evidence and sources in parallel.** Capture all 1,683 raw PCM
   cases and preregister listening; hydrate and authenticate the affected
   lossless masters.
3. **A0 — adjudicate.** Decide root/pitch truth, stereo intent, tail intent,
   post-track headroom, role balance, and the Tone timing contract.
4. **S1 — repair source content.** Perform approved pitch, DC, phase, tail,
   root, and genuine velocity-layer work in parallel by pack.
5. **S2 — encode once.** Produce delivery assets once from lossless sources;
   never transcode lossy-to-lossy to clear a metric.
6. **M0 — finalize maps.** After bytes/roots/layers settle, smooth adjacent
   gains and finalize onset/range metadata.
7. **C0 — calibrate final topology.** Resolve post-track headroom and role
   balance, then test mono, polyphony, tails, pumping, and mix capacity.
8. **V0 — certify.** Rerun strict decoded, Chromium/WebKit decode, repeated
   live decisions, the complete matrix with PCM, and blind comparisons.

This should be tracked in a detailed umbrella issue after this PR is stable.
The PR should say `Tracks #…`, not `Fixes #…`, because the dependency-bound work
is intentionally not complete here.

## Verification and reproduction

The `fb6c341` candidate has two independently retained 99-instrument live
receipts and rankings, a strict 26-instrument decoded receipt, and real
Chromium/WebKit decode coverage. The final CI/command ledger is recorded in the
PR description and must match the pushed head.

The frozen-code audit passed TypeScript, repository ESLint, all six aggregate
validators, the canonical/adversarial 605-mapping evidence suite, the strict
26/605/582 decoded audit, and focused live/runtime tests. Clean schema-v2
browser receipts decode 605/605 mappings in Chromium and WebKit. All accepted
captures in the fresh 6/1,683 PCM smoke were
non-silent, exact length, zero drift, and free of fatal findings/evidence gaps;
the fresh-context replay was byte-identical. One 128-frame Tone worklet attempt
was rejected and retained before its valid retry.

The first publication-head Actions run exposed three Ubuntu unit-test failures.
Two matrix integrity tests completed too slowly for their 30-second budgets;
`a6bc402` changes only those budgets to 60 seconds. The positive canonical
recomputation also rejected a macOS receipt on Node 24.19 Linux because five raw
aggregate decoder fields exceeded the generic `0.000001` bound while all
threshold, structure, finding, and decision bindings remained unchanged.
`d360cf8` adds only the path- and unit-scoped tolerances above. Its focused
cross-platform tests reject values outside each bound, and the full positive
and 203-finding-deletion suites passed **10/10 on macOS** and **10/10 on Node
24.19 Linux x64**.

Fresh clean-`d360cf8` diagnostics reproduced the decoded totals (26 instruments,
605 mappings, 582 files, 203 accepted findings, 0 errors/reviews), decoded all
605 mappings in both Chromium and WebKit, and completed one schema-v7 live run
with 99/99 audible instruments, 99 exact dispatches, and no page or console
errors. The independent live confirmation then failed after about 8.0 minutes,
before publishing a receipt, when the target page, context, or browser became
unavailable during the per-trial stop/cleanup phase; the trace does not
distinguish which one. Playwright retry count was zero and no retry was run.
Therefore no `d360cf8` two-run repeatability result or ranking is published;
the retained `fb6c341` pair remains the measured evidence.

A Noble arm64 container running the official linux-x64 Node 24.19 binary under
emulation also reproduced the formerly fragile piano/alto decoded subset with
36 accepted findings and 0 errors/reviews. This exercises the x64 Node/V8
decoder arithmetic; it is not represented as a full native amd64 Ubuntu run.
The pushed-head GitHub Actions result remains the merge gate.

The following commands reproduce the retained ranking, so they intentionally
use a clean checkout of `fb6c341941b6d7485d61bf4e63132b80b9128cd1`:

```sh
cd app
npm run audit:instrument-quality:evidence
npm run audit:instrument-quality:matrix:smoke
node --import tsx scripts/audit-instrument-quality.ts \
  --require-evidence \
  --evaluator-commit fb6c341941b6d7485d61bf4e63132b80b9128cd1 \
  --subject-commit fb6c341941b6d7485d61bf4e63132b80b9128cd1
```

`audit:instrument-quality:full` is expected to fail until the complete matrix
and PCM artifact root are supplied. Reconstruct the control with the command in
[`INSTRUMENT-AUDIO-QUALITY-CONTROL-REPRODUCTION.md`](./INSTRUMENT-AUDIO-QUALITY-CONTROL-REPRODUCTION.md). Every rerun must honor the same stability gate: it may fail closed again or emit a newly complete comparison, but it must never average, discard, retry, or select a favorable control result.
