# Property-Based Testing Program Completion Receipt — 2026-09

This receipt closes the literal acceptance criteria in issue #97. It records
what is automated, what was deliberately rejected after review, and the
negative checks used to prove the new oracles can fail. All temporary sabotage
edits were reverted before commit.

## Completion map

| Task | Result |
|---|---|
| T1 — shrinkable schedules | `state-machine-fuzz`, `overlap-fuzz`, `eviction-recovery` Layer 11, and `scheduler-mutation-race` now generate decisions with fast-check. Render patterns remain deterministic fixtures under §16 Rule 3. |
| T2 — failing-example database | All four lanes replay `test/integration/known-failures.json` first. A final failed `fc.check` emits `PBT_COUNTEREXAMPLE=<json>`; the host-side promotion script appends and deduplicates it. Both weekly jobs upload the changed JSON and a Git patch, then restore the original failing status. |
| T3 — generator discipline | Contract bounds, constructive ordered pairs, and retained semantic/low-rejection guards are documented in the changed arbitraries and properties. |
| T4 — witness-paired properties | §16 is binding; the July audit's reducer sabotage ends with 215 killed tests and zero importing suites surviving. |
| T5 — catalogue sweep | The adopted and rejected candidates are enumerated in §17.1; MCP JSON robustness and generated maximum-session coverage close the remaining adopted gaps. |
| T6 — unit evolution | The start-of-pass top ten and their dispositions are enumerated in §17.2. The weekly timeout remains 20 minutes. |

## Negative checks

| Oracle | Temporary subject sabotage | Observed minimal failure |
|---|---|---|
| Concurrent overlap schedule | Reused a broadcast sequence number on every fifth mutation. | Seed 11 shrank to **5 operations in one wave** (`path=0:0:2:2:2:2`). |
| Stateful lifecycle command model | Suppressed `flushPendingKVSave()` when the last WebSocket disconnected. | Seed 1 shrank 7 times to **2 commands**: `ws_swing(1)`, `disconnect`. The generated marker contained the exact replayable array. |
| Scheduler mutation race | Disabled the Phase-22 BPM-reformulation path while playback was active. | The failure shrank to **1 operation**: `tempo(73)`. |
| Eviction-recovery Layer 11 | Let global mutations broadcast acknowledgements without calling `persistToDoStorage()`. | Seed 1 shrank 4 times to **2 operations** with `evictAfter: 1`: `swing(0)`, `tempo(60)`. |
| Session-state array rejection | Removed the `Array.isArray(state)` guard. | PR-002b failed on `[]` after one shrink: the partial validator returned `valid: true`. |
| MCP JSON robustness | Injected a parser crash for valid JSON arrays in `guardMcpRequest()`. | PR-004 failed on `[]` after one shrink. |

These are subject faults, not generator removals. All four schedule lanes meet
T1's at-most-five-operation shrinking criterion; the two lifecycle kills
exercise persistence boundaries rather than merely proving that a coverage
counter increments.

## Runtime receipt

The complete unit suite was timed immediately before and after the completion
changes on the same checkout and machine:

| Run | Vitest files/tests | Wall clock |
|---|---:|---:|
| Before | 268 passed, 1 skipped / 4,673 passed, 1 skipped | 27.99 s |
| After | 269 passed, 1 skipped / 4,677 passed, 1 skipped | 27.11 s |

The difference is ordinary run-to-run noise; importantly, the suite did not
grow outside its existing runtime class and the committed CI budget remains 20
minutes. The full Workers integration suite also passes: 12 files, 138 tests.
