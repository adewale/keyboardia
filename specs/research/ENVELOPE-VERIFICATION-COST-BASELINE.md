# Envelope Verification Cost Baseline

**Captured:** 2026-08-03; refreshed 2026-09-20
**Scope:** local development runner; use as an order-of-magnitude baseline,
not a CI service-level guarantee.

This baseline makes the v2 verification tiers operational. A test is not
“cheap” merely because it is automated: we record its elapsed cost, output
volume, dependencies, and intended cadence before making it a merge gate.

| Gate | Measured result | Cost/use |
|---|---|---|
| `npm run test:envelope:semantic` | 6 files, 75 tests, observed rebased Vitest duration 0.20 s | T0; run on every local envelope change and PR |
| `npm run test:envelope:pcm` | 4 files, 13 tests, observed Vitest duration 0.75 s; real 48 kHz offline renders include native/translated-configuration comparisons for both fixed canaries, plus release, manifest, metric, and migration checks | T1 structural candidate/canary gate; authoritative owner of the envelope native-render file; the actual advanced renderer Cartesian render remains T2/T3 |
| `npm run test:envelope:rolling` | 9 files, 231 tests, observed rebased Vitest duration 0.48 s | T0/T1; pre-v1/v1/v2 state, reducers, transport, hash, and protocol capability |
| `npm run test:envelope:correctness` | 7 files, 271 tests, observed Vitest duration 0.87 s; headless correctness without native PCM duplication | T0; flag-off preservation, exact engine/sample release, audio-clock cleanup, and publish/remix state |
| `npm run test:audio-render` | 5 files, 20 tests, observed Vitest duration 4.73 s | T1; authoritative owner of the general native-render files; excludes the envelope canary owned by `test:envelope:pcm` |
| `npm run test:e2e:envelope` | 3 Chromium tests, 5.3 s on the rebased head | T1; deterministic WebSocket-free mode explicitly disables multiplayer, then covers one finite AHD edit, loop/sample capability, and portrait-to-landscape behavior |
| `npm run test:e2e:envelope:correctness` | 2 Chromium tests, 3.1 s on the rebased head | T1; flag-off headless runtime/notation evidence plus real Tone OfflineAudioContext tail-energy evidence |
| `npm run validate:envelope-docs` | 4 synchronized documents, 7 executable examples, about 0.2 s | T0; parses and serializes the documented notation against the runtime contract; no browser or network |
| `npm run validate:sync` | 20 message types, about 0.30 s using `node --import tsx` | T0; restricted-runner-safe, no tsx CLI IPC socket |
| selected-file ESLint | clean | T0; run on each touched TypeScript file |
| `npm run typecheck` | pass | T0; app-neutral compile contract |
| `npm run typecheck:worker` | pass | T0; worker/runtime boundary compile contract |
| `npm run test:unit:quiet` | 313 files passed, 1 skipped; 5,132 passed, 1 skipped; `*.render.test.ts` are deliberately excluded and run once by their named render owners; observed local duration about 70.5 s | T0 PR gate on the present runner; revisit if CI p95 exceeds the budget |
| `npm run validate:test-quality` | 375 antipattern files and 380 collected test files, zero exceptions; about 46 s | T0 PR gate; AST/module-graph analysis dominates its cost |
| `npm run test:integration:built` | 12 files, 140 tests, 7.55 s | T1 worker/MCP/session boundary gate; requires a local listener |
| full-stack desktop smoke | 15 Chromium tests, 10.1 s test time; 22.8 s including build and Worker startup | T1; must use the owned full-stack launcher, not Vite alone |
| real two-browser envelope convergence | included in 10 multiplayer contracts, 18.9 s test time after build/startup | T1; built Worker, two independent contexts, atomic Gate→AR adaptation, remote release edit, and reload persistence |
| full-stack mobile | 7 mobile-Safari-profile tests, 36.2 s test time | T1/T2; retain once per relevant PR, broader mobile matrices nightly |
| `npm run test:e2e:collaboration:worker` | 77 serial Chromium tests, observed CI step time 3 min 19 s including build/startup | T1; complete checked-in Worker-required inventory for affected persistence/sync PRs, not the inner edit loop |
| `npm run build` | pass; Vite phase 1.84–1.94 s after TypeScript | T0/T1 packaging gate; current pre-existing dynamic-import and >500 kB chunk warnings remain visible |
| `npm run check:worker` | 2,030,400 JS bytes; 3,505,836 upload bytes; 950.34 KiB gzip | T0/T1 packaging gate; the measured envelope MCP/public-skill delta is 68,765 upload bytes (2.00%) over PR 87's original head. The reviewed ratchet is 3,525,000 bytes, leaving 19,164 bytes; browser audio/UI/notation code remains excluded |
| `npm run validate:envelope-resources` | 582 audio files, 42,914,625 encoded bytes, 326,402 bytes gzip JS | T0 resource gate remeasured after rebasing onto PR 116; the PR adds zero audio bytes |
| `git diff --check` | pass | T0 formatting/integrity check |

`test:unit:quiet` uses `--silent=passed-only`. It suppresses console output
from passing tests while retaining the test list, slow-test timings, failures,
and final counts. Both general unit commands exclude native render files.
`test:audio-render` owns the five general renderer files and
`test:envelope:pcm` owns the envelope render canary; pre-push and CI invoke both
owners. Before this correction, the envelope renderer ran four times in one CI
job (unit, audio-render, PCM, and correctness), and its general-unit execution
could lose one of two sequential native renders under full-suite contention.
Retries or wider PCM tolerances would have hidden that lane-design defect.
The unrun-test validator now asks the real unit, general-render, and
envelope-PCM collectors separately, verifies their package-script contract,
and requires every native render file to have exactly one owner.

## Remaining unmeasured gate

All local validator entry points now run without privileged IPC; the complete
test-quality pass is measured above. CI emits a machine-readable record for
each envelope lane containing wall time, estimated runner-minutes, artifact
bytes, observed retry count, configured runner cost, actual human-review
minutes, runner, and commit, retained for 30 days. Missing runner pricing is
reported as `null`, not zero; automated lanes report zero human minutes. CI
p50/p95 and release listening cost cannot be inferred from a single local run
and remain explicit release-evidence fields. Likewise, canary
telemetry and one-release-cycle retention require a real deployed cohort; no
local test substitutes for them.

The checked-in machine resource baseline is
`artifacts/envelope-resource-baseline.json`. It verifies the exact 582-file,
42,914,625-byte catalogue hash and separately enforces the initial entry,
StepSequencer-lazy, notation-lazy, and scheduler-worklet chunk boundaries. Its
post-implementation record attributes the gzip growth; no sample asset was
added by this implementation. The PCM policy and cadence are in
`artifacts/envelope-pcm-baseline-manifest.json`; neither artifact claims human
approval.

## Cost policy

- Keep the semantic gate below one second of test-runner time and free of
  browser, PCM, sample decoding, and network dependencies.
- Keep full unit tests quiet by default in CI; retain detailed output for slow
  files and failures.
- Measure CI p50/p95 before setting hard wall-clock budgets; local figures alone
  are insufficient.
- PR PCM renders should select changed capabilities plus fixed canaries. The
  full instrument/pitch/velocity/gate matrix remains nightly or release-only.
- Any new sample/loop verification reports downloaded bytes, decoded memory,
  render time, artifact retention, and listening time separately.
- Packaging checks clean their owned dry-run output before measurement; stale
  content-addressed assets previously produced a false 1,329-byte Worker-ratchet
  failure and remain excluded. The Worker ratchet was deliberately raised by
  25,000 bytes after comparing the exact original-head and release bundles;
  the 19,164-byte remainder is a reviewed budget, not unbounded platform room.
- CI implements the cadence mechanically. A conservative checked-in impact
  inventory selects T1 profiles from the diff and sends unknown code paths to
  every profile. The residual offline Chromium sweep, full real-backend
  Chromium/WebKit/mobile matrix, duplicate macOS visual lane, and full
  instrument/sample validators run on the nightly or manually requested T2
  workflow. Before this split, the PR browser jobs alone consumed 44 min 44 s
  of wall time (24 min 56 s mock plus 19 min 48 s real backend); browser
  installation accounted for under one minute of that total.
- The first exact-head T1 run after the split completed those same named browser
  jobs in 7 min 52 s of runner time (3 min 44 s mock plus 4 min 8 s real
  Worker): 36 min 52 s, or 82.5%, less per affected PR. The run still gated the
  75-test mock manifest, five focused envelope/audio browser tests, and the
  77-test real-Worker inventory. This is a cadence saving, not deleted evidence:
  the residual Chromium, WebKit, mobile, macOS, and catalogue work moved to T2.
- Local pre-push follows the same shape: unit, focused PCM, real-Worker smoke,
  and one mobile contract by default; `KEYBOARDIA_VERIFY_T2=1` appends the exact
  complete Chromium and WebKit disposition contracts. Exact full-matrix counts
  stay validated even when their execution is deferred.
