# Envelope Verification Cost Baseline

**Captured:** 2026-08-03; refreshed 2026-08-22  
**Scope:** local development runner; use as an order-of-magnitude baseline,
not a CI service-level guarantee.

This baseline makes the v2 verification tiers operational. A test is not
“cheap” merely because it is automated: we record its elapsed cost, output
volume, dependencies, and intended cadence before making it a merge gate.

| Gate | Measured result | Cost/use |
|---|---|---|
| `npm run test:envelope:semantic` | 6 files, 72 tests, observed Vitest duration about 0.37 s | T0; run on every local envelope change and PR |
| `npm run test:envelope:pcm` | 4 files, 11 tests, observed Vitest duration about 0.89 s; six real 48 kHz offline renders include native/translated-configuration comparisons for both fixed canaries, plus manifest/metric/migration checks | T1 structural candidate/canary gate; the actual advanced renderer Cartesian render remains T2/T3 |
| `npm run test:envelope:rolling` | 9 files, 229 tests, observed Vitest duration about 0.61 s | T0/T1; old/new state, reducers, transport, hash, and protocol capability |
| `npm run test:envelope:correctness` | 8 files, 263 tests, observed Vitest duration about 0.88 s | T0; flag-off preservation, exact engine/sample release, audio-clock cleanup, and publish/remix state |
| `npm run test:e2e:envelope` | 3 Chromium tests, 6.2 s | T1; deterministic WebSocket-free mode explicitly disables multiplayer, then covers one finite AHD edit, loop/sample capability, and portrait-to-landscape behavior |
| `npm run test:e2e:envelope:correctness` | 2 Chromium tests, observed 3.1–3.9 s | T1; flag-off headless runtime/notation evidence plus real Tone OfflineAudioContext tail-energy evidence |
| `npm run validate:envelope-docs` | 5 synchronized sources, about 0.04 s | T0; no IPC, browser, or network |
| `npm run validate:sync` | 16 message types, about 0.30 s using `node --import tsx` | T0; restricted-runner-safe, no tsx CLI IPC socket |
| selected-file ESLint | clean | T0; run on each touched TypeScript file |
| `npm run typecheck` | pass | T0; app-neutral compile contract |
| `npm run typecheck:worker` | pass | T0; worker/runtime boundary compile contract |
| `npm run test:unit:quiet` | 253 files passed, 1 skipped; 4,694 passed, 1 skipped; observed Vitest duration 34.67 s | T0 PR gate on the present runner; revisit if CI p95 exceeds the budget |
| `npm run validate:test-quality` | 303 antipattern files and 304 collected test files, zero exceptions; about 32 s | T0 PR gate; AST/module-graph analysis dominates its cost |
| `npm run test:integration:built` | 10 files, 135 tests, 5.95 s | T1 worker/MCP/session boundary gate; requires a local listener |
| full-stack desktop smoke | 15 Chromium tests, 9.7 s test time; about 21 s including build and Worker startup | T1; must use the owned full-stack launcher, not Vite alone |
| full-stack mobile | 7 mobile-Safari-profile tests, 36.2 s test time | T1/T2; retain once per relevant PR, broader mobile matrices nightly |
| `npm run test:e2e:collaboration:worker` | 73 serial Chromium tests, 2.3 min test time plus build/startup | T1/T2; expensive broad regression gate for shared state/UI changes and release candidates, not the inner edit loop |
| `npm run build` | pass; Vite phase 1.69–1.85 s after TypeScript | T0/T1 packaging gate; current pre-existing dynamic-import and >500 kB chunk warnings remain visible |
| `npm run check:worker` | 2,013,502 JS bytes; 3,488,558 upload bytes; 946.90 KiB gzip | T0/T1 packaging gate; 11,442 bytes remain under the 3.5 MB upload ratchet, so the next Worker feature must split or reduce code |
| `npm run validate:envelope-resources` | 223 audio files, 13,761,117 encoded bytes, 306,851 gzip JS bytes | T0 resource gate; +24,651 bytes / +8.74% JS, zero audio delta, within the 20% budget |
| `git diff --check` | pass | T0 formatting/integrity check |

`test:unit:quiet` uses `--silent=passed-only`. It suppresses console output
from passing tests while retaining the test list, slow-test timings, failures,
and final counts. The default `test:unit` command remains unchanged for local
debugging.

## Remaining unmeasured gate

All local validator entry points now run without privileged IPC; the complete
test-quality pass is measured above. CI p50/p95, retry rate, runner pricing,
artifact-retention cost, and human listening minutes cannot be inferred from a
single local run and remain explicit release-evidence fields. Likewise, canary
telemetry and one-release-cycle retention require a real deployed cohort; no
local test substitutes for them.

The checked-in machine resource baseline is
`artifacts/envelope-resource-baseline.json`. It separates initial/lazy
JavaScript from 13.12 MiB of static audio and records the 223-file catalogue
hash. Its post-implementation record attributes the 8.74% gzip growth, including
the 4,071-byte lazy notation exporter; no sample asset was added. The PCM policy and cadence are in
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
  failure and are now excluded without weakening the 3.5 MB limit.
