# Sample Pipeline v2 red–green–refactor evidence

This is the durable test ledger required by `specs/SAMPLE-PIPELINE-V2-PLAN.md`. Tests are named by their exact Vitest assertion; sabotage cases are retained so the gates can be re-proven rather than trusting a one-time screenshot.

| Stage | Red assertion / injected defect | Green implementation | Refactor / retained gap test |
|---|---|---|---|
| 1 | `reports all malformed boundary fields instead of silently defaulting`; traversal, malformed digest, duplicate ID/output, out-of-range MIDI | strict aggregate parser, branded values, normalized paths, exact SHA-256 | arbitrary-JSON property test; unknown-field and symlink sabotage |
| 2 | `removes staging output and leaves no candidate when any encode fails`; injected second-encode failure | sibling staging, one render per unique source/output, cleanup, fsync, rename | pre-render TOCTOU mutation test; immutable private source snapshot; tampered-candidate reopen test |
| 3 | `emits explicit channel and delivery policy without an accidental downmix`; absent `-ac` policy | explicit preserve/mono method, codec/container/rate/bitrate | decoded sample-rate/channel mismatch sabotage; real ffprobe measurements |
| 4 | `rejects lossy masters and velocity gaps at construction time`; output/mapping collisions and mixed RR groups | explicit mappings plus operational SFZ include/macro/path/hash import | random-range/absent-source/traversal/malformed-opcode sabotage; committed production recipe depth tests |
| 5 | `applies one uniform render gain to a group instead of normalizing layers independently` | measured anchor + one group gain + delivery ceiling; per-sample runtime gain | stale anchor and velocity-energy findings remain observable; steel-drums rejected successive unsafe ceiling candidates |
| 6 | invalid trim/offset/loop bounds, malformed loop declarations, and the observed invalid `atrim:end=` ffmpeg chain | one valid ffmpeg filter chain; explicit 10 Hz DC remediation; bounded recipe values; runtime offsets/tuning/loops | real ffmpeg contract plus decoded `START_OFFSET_OUT_OF_BOUNDS`, `END_OFFSET_OUT_OF_BOUNDS`, and `LOOP_OUT_OF_BOUNDS` gates |
| 7 | hard velocity switches and repeated identical RR selection | normalized adjacent-layer crossfade and declared-index deterministic RR | property tests over velocity 0–127; playback tests prove gain sum and RR cycle; legacy-overlap order retained |
| 8 | `does not claim readiness when any priority mapping fails`; one background HTTP 503; simultaneous deep-library loads; duplicate mappings; one hung tail | complete priority sets, aggregate six-way fetch/decode semaphore, in-flight file deduplication, immediate background installs, states/failures/retry | multi-instrument pressure, registry retry, cache-owner-after-priority, individual/sprite/manifest disposal race tests |
| 9 | flat-top PCM, duplicate delivery bytes, wrong delivery format, output mutation, silent mapping events | canonical decoded audit, duplicate/coverage/runtime/browser/hash gates | flat-top, duplicate, rate/channel, stale hash, undispositioned/stale review, and candidate-tamper sabotage tests |
| 10 | wrong report hash/WebKit evidence/anchor set, unreviewed finding, oversized decoded candidate, and quarantined ID offered in the picker | absolute comparisons, ≤96 MiB committed baselines, batched review dashboard, exact-hash decision parser, and promotion | two-step fixture proves no rebuild; actual-runtime listening page; accepted fixture promotion; 27-ID disposition ledger |

## Commands

```bash
# Focused green suite (88 tests at completion)
npx vitest run \
  test/sample-pipeline-core.test.ts \
  test/sample-pipeline-runner.test.ts \
  test/sample-pipeline-audit.test.ts \
  test/sample-pipeline-evidence.test.ts \
  test/sample-pipeline-cli.test.ts \
  test/sample-pipeline-full.test.ts \
  test/sample-pipeline-recipes.test.ts \
  test/sample-pipeline-sfz.test.ts \
  test/sample-pipeline-baselines.test.ts \
  test/sample-pipeline-upgrade-ledger.test.ts \
  test/sample-pipeline-review-index.test.ts \
  src/audio/sample-selection.test.ts \
  src/audio/sample-selection.property.test.ts \
  src/audio/sampled-instrument-loading.test.ts \
  src/audio/sampled-instrument.playback.test.ts

# Real tool/browser contract
RUN_REAL_SAMPLE_PIPELINE=1 npx vitest run test/sample-pipeline-real-contract.test.ts

# Repository gates
npm run test:unit
npm run build
npm run lint
npm run validate:all
npm run samples:lab:check
```

## Observed integration red

The first end-to-end fixture run failed at `executePlannedBuild` with `ENOENT ... .candidate.<id>.tmp`, proving that nested fresh candidate parents were not created. The runner was changed to create only the staging parent, and `replacement full command end-to-end fixture` then passed. The production steel-drums exercise also rejected, in order: one source with `FLAT_TOP_CLIPPING`, AAC without fast-start (`DECODE_FAILED`), and several unsafe decoded group ceilings. Each failure caused recipe/render-policy changes; no failing candidate was promoted.

Generated production listening output remains ignored. Ten candidates are decision-ready; Finger Bass YR is mechanically verified but blocked on its playable-range contraction. Human decisions are deliberately not represented as green until a person completes each exact seeded review and all finding dispositions. The ledger keeps the overall program in `awaiting-human-decisions` rather than allowing tooling completion to masquerade as asset promotion.
