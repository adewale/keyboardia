# Instrument audio-quality remediation report — 2026-08-22

## Scope and claim boundary

The production/evaluator subject is
`553398b93f16b31a258e254dba12257dd0dce2f2`, based on `main` at
`58264dd5ae274f63b1cd80b72aa823b76b21f28b`. Later commits publish the
reviewed reports/evidence and apply semantics-preserving CI inventory/error-
propagation maintenance; they do not change scored audio, receipt metrics, or
ranking decisions.

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
bands, components, silence decisions, and above-zero classifications. Their
maximum per-instrument raw-energy spread is 0.338 dB, below the prospective
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

An aggregate live-score delta is deliberately not published. Both control
captures completed 99/99, but their `noise` peak differed by 3.982 dB and
therefore failed the 0.5 dB stability gate. The comparator retained both runs
and stopped; it did not average them or select the favorable receipt. The raw
artifacts and hashes are preserved in
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
| `synth:growl` post-track peak | 0.41455 | 0.25672 | Both control runs and both candidate runs are internally stable for this voice; bounded modulation plus calibration lowers peak 4.16 dB and RMS 3.83 dB without muting or removing spectral motion. |
| Procedural note-edge gain | default GainNode value could leak at an event boundary | intrinsic value is zero before automation | Regression proves initialization order. Both final candidate receipts produce the lower, stable `noise` peak; original-main's two-run instability is retained as evidence, not hidden. |
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
- Sample dispositions bind source SHA, manifest SHA, six-decimal canonical
  measured value, threshold, baseline, and evaluator identity. Canonicalization
  removes sub-micro cross-platform decoder noise without changing raw metrics or
  pass/fail thresholds.
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
  these are headroom priorities. Global bass trims were tested and reverted
  because they caused hard tonal-loudness mismatches.
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
   post-track headroom, the hi-hat role level, and the Tone timing contract.
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

The frozen candidate has two independently retained 99-instrument live
receipts and rankings, a strict 26-instrument decoded receipt, and real
Chromium/WebKit decode coverage. The final CI/command ledger is recorded in the
PR description and must match the pushed head.

The clean detached validation run passed TypeScript, repository ESLint, all six
aggregate validators, 23 changed evaluator/runtime test files (727 tests), the
strict 26/605/582 decoded audit, 605/605 mappings in Chromium and WebKit, and
the representative 6/1,683 PCM smoke. All accepted smoke captures were
non-silent, exact length, zero drift, and free of fatal findings/evidence gaps;
the fresh-context replay was byte-identical. Two earlier process attempts with
128-frame worklet drift were rejected and retained rather than hidden.

From a clean checkout of `553398b93f16b31a258e254dba12257dd0dce2f2`:

```sh
cd app
npm run audit:instrument-quality:evidence
npm run audit:instrument-quality:matrix:smoke
node --import tsx scripts/audit-instrument-quality.ts \
  --require-evidence \
  --evaluator-commit 553398b93f16b31a258e254dba12257dd0dce2f2 \
  --subject-commit 553398b93f16b31a258e254dba12257dd0dce2f2
```

`audit:instrument-quality:full` is expected to fail until the complete matrix
and PCM artifact root are supplied. Reconstruct the control with the command in
[`INSTRUMENT-AUDIO-QUALITY-CONTROL-REPRODUCTION.md`](./INSTRUMENT-AUDIO-QUALITY-CONTROL-REPRODUCTION.md). Every rerun must honor the same stability gate: it may fail closed again or emit a newly stable comparison, but it must never average, discard, or select a favorable control run.
