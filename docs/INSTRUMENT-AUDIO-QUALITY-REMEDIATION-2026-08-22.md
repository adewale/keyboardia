# Instrument audio-quality remediation report — 2026-08-22

## Scope and provenance

The branch was fetched, pruned, and rebased onto `origin/main` at
`58264dd5ae274f63b1cd80b72aa823b76b21f28b`; Git reported it was already up to
date. The objective report grades the clean subject
`d096b8445356a35d1e58714cba9f97afac3953e0` with the separately pinned evaluator
`aafae6a51a9710ae4419d1eeddfe2b4a492c49cb`.

The complete 99-row worst-first ranking is
[`INSTRUMENT-AUDIO-QUALITY-AUDIT.md`](./INSTRUMENT-AUDIO-QUALITY-AUDIT.md).
The scoring contract is
[`INSTRUMENT-AUDIO-QUALITY-RUBRIC.md`](./INSTRUMENT-AUDIO-QUALITY-RUBRIC.md),
and the exhaustive remote-branch result is
[`INSTRUMENT-AUDIO-QUALITY-BRANCH-SCOPE.md`](./INSTRUMENT-AUDIO-QUALITY-BRANCH-SCOPE.md).

This report distinguishes three things that must not be conflated:

1. a delivered-audio or runtime improvement;
2. an evaluator correction that stops reporting a false defect; and
3. measured debt accepted by a disposition but not repaired.

## Outcome

| Measure | Equivalent original scored paths under final math | Remediated report | Difference |
|---|---:|---:|---:|
| Instruments audible through the real sequencer path | 99/99 | 99/99 | no regression |
| Total repair-priority points | 179.9 | 159.1 | **-20.8 (-11.6%)** |
| Priority bands | 0 high / 7 medium / 9 low / 83 baseline | 0 high / 6 medium / 9 low / 84 baseline | **-1 medium; +1 baseline** |
| Instruments with nonzero repair-priority score | 16 | 15 | **-1** |
| Canonical live peaks above 0 dBFS | 2 | 2 | unchanged |
| Decoded findings | 256 | 203 | **-53 (-20.7%)** |
| Unwaived decoded errors/reviews | 0 / 0 | 0 / 0 | unchanged |

The compatibility snapshot combines original `58264dd5` runtime, assets,
manifests, and source calibration with hardened receipt producers and equivalent
final scoring math. Its Git provenance is necessarily synthetic because the
auditor rejects a mixed tree labelled as literal `58264dd5`. It imports the
newer onset helper, whose 30 ms default behaves identically for the old
manifests, and predates a label-only report wording change. The controlled
summary, method, exceptions, artifact hashes, issue-code totals, and nonzero
instrument scores are retained in
[`instrument-audio-quality-controlled-comparison-2026-08-22.json`](./evidence/instrument-audio-quality-controlled-comparison-2026-08-22.json).
The previous 223.2-point/307-finding report is history, not causal evidence.

| Controlled score mover | Before | After | Change |
|---|---:|---:|---:|
| Acoustic guitar | 18.3 medium | 11.3 low | **-7.0** |
| Alto sax | 20.0 medium | 15.0 medium | **-5.0** |
| French horn | 8.6 low | 3.6 low | **-5.0** |
| Hammond | 3.5 low | 0 baseline | **-3.5** |
| Finger bass | 8.7 low | 8.4 low | **-0.3** |

Steel pan loses one finding but remains at 6 points because its normalized,
capped score component does not cross a band boundary.

Under equivalent scoring semantics, the 53-finding reduction is exactly:
43 leading-silence findings removed, 3 loop-value discontinuities removed,
3 adjacent-note level steps removed, 2 tail-truncation findings removed, and
2 lossy-source hot-peak findings removed. Every other decoded finding class is
unchanged.

## What is objectively better

| Area | Before | After | Why this is an improvement |
|---|---:|---:|---|
| `synth:growl` canonical live peak | -7.6 dBFS | -11.7 dBFS | A bounded filter LFO and calibrated source trim reduce the canonical peak by 4.1 dB and move its role-relative RMS delta from +2.1 to 0 dB. Both controlled captures score 0; the old report's +16.9 dBFS reading was not reproduced and is not used as evidence. Offline tests also require non-silence and spectral motion, so muting cannot earn the pass. |
| Hammond real loop boundary | worst seam jump -26.21 dB; worst derivative ratio 2.65 | all 13 jumps -120 dB; worst derivative ratio 0.551 | The 13 lossy MP3s were replaced by exact-byte authoritative CC0 PCM16 WAVs and their SFZ loop coordinates were adapted to Web Audio's exclusive endpoint. A real `OfflineAudioContext` regression renders the boundary. Under identical scoring Hammond moved from 3.5 points/low to 0 points/baseline. |
| Finger-bass adjacent roots | 3.235 dB and 3.304 dB steps | 2.435 dB and 2.404 dB | Root-local manifest calibration clears the 3 dB discontinuity gate with a deliberate 2.5 dB margin without globally lowering the instrument. |
| Steel-pan 62→63 boundary | 4.727 dB | 2.427 dB | Every MIDI-63 layer was reduced by 2.3 dB; the same decoded adjacent-note metric now clears with margin. |
| Acoustic-guitar delivery | 15 AAC/M4A generation files, two tail flags | 15 one-generation PCM16 WAVs, zero tail flags | Official CC0 lossless sources received a source-domain 10 ms tail fade and 6 ms zero pad. A local source-to-delivery comparison measured 0 cents pitch change, at most 0.026 dB active-RMS change, and at most 0.140 dB peak change; reproducing that comparison requires separately hydrating the source revision and hashes declared by the receipt. |
| Effective onset findings, final evaluator | 43 | 0 | The runtime and audit now distinguish authored silence from codec priming, use any-channel onset consistently, and cap adaptive compensation per manifest. Chromium and WebKit prove the wind attacks are not over-trimmed; fixed 42 ms trims that would have cut real attacks were explicitly rejected. |
| Decoded tail findings | 12 | 10 | Two acoustic-guitar EOF truncations were removed by the lossless source-domain tail transform. The other ten remain reported. |
| Decoded hot-peak findings | 21 | 19 | Two lossy acoustic-guitar crest warnings disappeared when the authoritative lossless delivery replaced AAC. Lossless files are not attenuated merely to game a raw-buffer headroom rule. |
| Envelope lifecycle | wall-clock cleanup; `release=0` became 0.5 s in advanced voices | audio-clock retirement; authored zero preserved | Tests now advance the audio clock and prove cleanup, tempo-aware duration deadlines, release bounds, voice stealing, and persistence into later engine instances. |
| Procedural note-edge envelope | a diagnostic accepted zero-drift replay exposed one different onset frame with identical RNG state | the retained final smoke replay is byte-identical | The voice gain now starts at zero before its scheduled fade. The unit regression proves initialization order, and the final receipt proves exact replay; together they remove the observed unity-gain boundary leak and its one-frame click risk without claiming a listening result. |
| Tone context mismatch | initialization/recovery could report ready while Tone nodes remained on a stale context | initialization and recovery fail closed before constructing or reusing disconnected Tone graphs | A false readiness result is now an exception with regression coverage. |

The acoustic and Hammond deliveries have provenance receipts that bind shipped
bytes to source identifiers, mapping hashes, transformations, and licences.
Hammond is an exact source-byte copy; its existing -3 dB playback trim remains
in the manifest, avoiding needless requantization.

## Evaluator fixes that improve truthfulness

These changes improve the validity of the conclusions rather than the sound:

- The old Hammond checker correlated unrelated five-millisecond windows. The
  replacement checks value and slope continuity at the actual Web Audio loop
  boundary and rejects slope-broken seams.
- Stereo analysis now finds activity from either channel. Exact left/right
  polarity inversion produces a mono-loss failure instead of disappearing from
  the analyser and passing with null metrics.
- Absolute-pitch tests detect octave-up and octave-down sine errors, while
  Hammond and bass profiles use preregistered harmonic/pitch-class policies.
  Estimator uncertainty is evidence debt, not an automatic accusation that a
  valid timbre is broken.
- Every one of the 99 IDs has an exact role profile. The plan contains 1,683
  deterministic dry-PCM cases with exact frame geometry, provenance, pitch,
  release, stereo, range, velocity, repeat, and polyphony lanes.
- Sample dispositions now bind source SHA, manifest SHA, exact measured value,
  threshold, and evaluator identity. A mapping edit can no longer silently
  reuse an audio-file-only waiver.
- The Markdown report retains every improvement action. It no longer truncates
  an instrument to two issue classes while the JSON contains more.
- Live and sample receipts bind the full subject commit, catalogue coverage,
  browser/runtime identity, and clean-tree state. Filtered or stale reports do
  not upgrade unrelated instruments.
- The Chromium track-bus adapter records exact 44.1 kHz PCM after pan and before
  master/effects. It rejects missing frames, records bounded host-underrun
  retries, resets procedural RNG at audio initialization, and quantizes events
  to render frames. The accepted seed-A replay is byte-identical.

The representative adapter smoke passed 6/1,683 cases across sampled,
procedural, native, Tone, and advanced engines. All accepted captures were
non-silent, exact-length, zero-drift, and had no fatal finding or evidence gap.
Two replay process attempts skipped 128 render frames; both were rejected and
retained in the receipt before a zero-drift attempt was accepted. The accepted
seed-A and fresh-context replay share PCM SHA-256
`fadd1aa057d69be054bd16d8175b2e8cc2fd4b7f9555085b90d24ddfeb43a8b4`.
The complete smoke receipt is retained as
[`instrument-audio-quality-dry-pcm-smoke-2026-08-22.json`](./evidence/instrument-audio-quality-dry-pcm-smoke-2026-08-22.json).
This smoke does **not** upgrade the report to complete matrix evidence.

## Remaining measured debt

The current 203 decoded findings remain real review work even though every one
has a disposition bound to source bytes, manifest bytes, measured value,
threshold, and evaluator identity:

| Finding | Count | Dependency before changing sound |
|---|---:|---|
| Pitch deviation | 144 | Harmonic/root adjudication and listening; the scalar estimator is unsafe for inharmonic, ensemble, organ, and bass material. |
| Hot lossy-source peak | 19 | Verified lossless master or a deliberate playback/source-trim decision after final content and mix calibration. |
| Mono loss | 12 | Level-matched stereo/mono listening and authoritative piano/marimba masters. |
| Tail truncation | 10 | Authoritative source identity plus release-context listening. |
| Negative phase correlation | 9 | Stereo polarity/phase adjudication together with the mono-loss work. |
| DC offset | 8 | Exact alto-sax source identity, then source-domain repair before gain calibration. |
| Range overextension | 1 | Add slap-bass roots or accept the existing range. Narrowing 28–72 to 34–66 would silence 12 previously playable edge notes (26.7% of the old range), so it was not presented as a repair. |

Additional current debt:

- `sampled:slap-bass` and `sampled:finger-bass` peak at +2.3 and +3.1 dBFS on
  the canonical post-track path. Global manifest reductions were tested and
  reverted because they created hard tonal-loudness mismatches; topology-aware
  calibration is still required.
- Ten sampled packs exceed the four-semitone root-distance target: slap bass
  12; French horn 7; acoustic guitar, clean guitar, kalimba, piano, marimba,
  finger bass, steel pan, and vibraphone 6.
- Five packs have one median velocity layer where their role target is two:
  slap bass, acoustic guitar, clean guitar, kalimba, and strings. Duplicating a
  file is not a genuine dynamics repair.
- The closed acoustic hi-hat is a role-level outlier at -31.9 dBFS peak in the
  final receipt. It needs level-matched mix-context review, not an automatic
  boost.
- The 73 non-sampled instruments have only a canonical live note plus static
  checks in the ranked report. A zero score is “no detected defect,” not equal
  or perfect timbre.

## Topologically sorted remaining work

The dependencies are common across most residuals: trustworthy evidence and
source provenance must precede destructive waveform work; content/topology must
settle before final level calibration.

1. **Q0 — run the complete baseline matrix and preregister listening.** Execute
   all 1,683 pinned Chromium captures and define level-matched blind A/B tasks
   for judgments the technical gates cannot make.
2. **S0 — hydrate and authenticate lossless masters.** In parallel with Q0,
   recover exact licensed sources for the affected sax, piano, marimba,
   vibraphone, bass, guitar, steel-pan, and orchestral packs.
3. **A0 — adjudicate evidence.** Using Q0 and S0, decide pitch/root truth,
   stereo intent, tail intent, the hi-hat role level, and whether the two bass
   live peaks originate in assets, maps, or post-track topology.
4. **S1 — repair source content.** After A0+S0, perform pitch/root corrections,
   DC removal, stereo/phase repair, tail restoration, and genuine new root or
   velocity recordings. These can run in parallel by pack.
5. **S2 — encode once from lossless.** Only after source changes settle, create
   final delivery assets and enforce decoded crest/headroom without
   lossy-to-lossy transcoding.
6. **M0 — finalize maps and local gain transitions.** With bytes, roots, and
   layers stable, smooth adjacent roots/layers and set any remaining adaptive
   onset metadata.
7. **C0 — perform role/output calibration.** Fix slap/finger topology-aware
   headroom and adjudicated hi-hat level; repeat mono, polyphony, and
   mix-capacity captures.
8. **V0 — rerun all gates and blind comparisons.** Produce a complete matrix
   receipt, Chromium/WebKit decode receipts, strict decoded report, real 99-ID
   live receipt, and listening results. Only then make a broad perceptual claim.

## Branch and issue coverage

GitHub reported eight open PRs and four open issues at the final check. None
implements a validated fix for the remaining decoded findings, roots/layers,
bass headroom, hi-hat calibration, or full-matrix evidence gap. PR 87 remains an
ADSR specification only. PR 98 advanced and opened during final verification;
it now implements a soft-note low-pass for nine sampled packs, a 15% default
reverb for new sessions, and adjacent but incomplete mobile-output/clock work.
Its native route is later bypassed by the Tone effects destination path, its
unlock can be skipped for an already-running context, and its clock failure only
logs rather than failing closed. Three packs already have mapped velocity zones
that its filename-based classifier misses, so the filter rationale and anchors
need re-audit. That is genuine adjacent work on
velocity timbre, but it adds neither real velocity layers nor new roots and
does not clear any current ranked deficit. Its canonical MIDI-90 path is
deliberately bypassed; strict sample validation is currently blocked by an
unrebound manifest disposition, and the changed soft-note sound still needs the
pinned velocity/full matrix and listening before integration; the default
reverb also needs the preregistered tail, peak, loudness, and pumping gates. Its
aggregate raw-duration sustain guard is useful telemetry, but does not prove
every mapped note sustains for two seconds because it ignores playback rate and
manifest offsets. Its strict instrument validation is currently failing on
stale bound manifest evidence. The dormant Safari branch contains old recovery
work; its relevant behavior was reimplemented and tested on current `main`
rather than merging its stale catalogue wholesale.

## Costs and claim boundary

- Replacing 28 lossy acoustic/Hammond files grows their tracked payload from
  1,379,673 bytes to 8,716,996 bytes: **+7,337,323 bytes (6.32×)**.
- No level-matched blind listening panel was run, so this report claims fewer
  measurable defects and safer runtime behavior—not universal preference.
- The full 1,683-case receipt does not exist. `audit:instrument-quality:full`
  fails closed; the six-case smoke is deliberately marked incomplete.
- The 203 dispositions affect CI status only. They do not erase points from the
  ranking or turn review findings into repairs.

## Verification

The frozen subject passed:

- 271 unit-test files: **4,709 passed, 1 skipped**;
- focused evaluator/receipt suite: **53 passed across 10 files**;
- production TypeScript/Vite build;
- repository ESLint;
- all 26 manifests with zero warnings;
- strict decoded audit: **26 instruments / 605 mappings / 582 files / 203
  disposition-accepted / 0 unwaived**;
- Chromium and WebKit browser decode: **605/605 mappings each**;
- Chromium real sequencer output: **99/99 instruments audible**;
- Chromium PCM adapter smoke: **6/1,683 accepted**, exact replay and zero drift;
- deliberate full-matrix verification failure because the complete receipt is
  absent.

Reproduce the currently supportable report from a clean worktree at
`d096b8445356a35d1e58714cba9f97afac3953e0` with:

```sh
cd app
npm run audit:instrument-quality:evidence
npm run audit:instrument-quality:matrix:smoke
node --import tsx scripts/audit-instrument-quality.ts \
  --require-evidence \
  --evaluator-commit aafae6a51a9710ae4419d1eeddfe2b4a492c49cb \
  --subject-commit d096b8445356a35d1e58714cba9f97afac3953e0
```

Use `npm run audit:instrument-quality:full` only after supplying the complete
matrix receipt.
