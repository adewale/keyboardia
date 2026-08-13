# Bounded Correctness Testing Plan

**Date**: 2026-08-13
**Status**: Proposed (v2 — supersedes v1 of this file, which proposed
production telemetry alongside test lanes; that direction was **declined in
review on 2026-08-13**. This version is bounded by construction: every task
is test-lane or docs only, changes **zero shipped code paths**, and its
recurring cost is CI wall-clock, not production billing.)
**Motivation**: `specs/research/WAL-RESET-BUG-LEARNINGS-2026-08.md`
**Framework**: the [adewale/testing-best-practices](https://github.com/adewale/testing-best-practices)
anti-pattern catalogue and 7-step quality framework, applied here through
its in-repo instantiation — `docs/TEST-AUDIT-2026-07.md` (the July 2026
audit conducted against that skill), the gates it installed
(`validate:test-antipatterns`, `validate:test-links`), its sabotage/kill-rate
method, and the global fast-check seed policy
(`src/test/setup-fast-check.ts`). The skill repository itself was not
readable from this session (repository scope + approval required); the audit
doc encodes the catalogue and framework in enough detail to apply them.

---

## 1. What "bounded" means here, concretely

1. **No shipped-code changes.** Every task lives in `test/`, `e2e/`,
   `*.test.ts`, CI config, or docs. Existing seams only: the real DO via
   `cloudflare:test` (`runInDurableObject`, `evictDurableObject`), the real
   client via `ControlledWebSocket` injection
   (`src/sync/multiplayer-transport.test.ts`), the real audio engine via its
   typed fakes and `getDiagnostics()`, deterministic rendering via
   `src/test/session-render.ts`. If a task discovers it needs a new seam in
   shipped code, that is a **separate decision escalated explicitly**, not
   part of this plan.
2. **Every lane has an explicit budget.** Fixed seed count and op count per
   PR run; hard wall-clock cap for the nightly job. The audit tracks unit
   wall clock to the tenth of a second (39.3s → 41.5s); new lanes state
   their budget up front and are accountable to it in review.
3. **Deterministic and replayable.** All randomness flows through the
   pinned global fast-check seed or an explicit `mulberry32` seed in the
   test, reported on failure (`seed=X op#N` house style). No wall-clock
   waits; no unseeded exploration in a gating lane.
4. **Recurring cost is $0 by construction.** Nothing in this plan touches
   KV, DO storage, wide events, alarms, or client beacons. The only
   recurring spend is CI minutes (free hosted runners on a public repo) and
   the review attention the nightly lane's failures demand.

## 2. Quality bar for every new lane (from the skill, as applied in-tree)

- **Subject linkage** (the audit's own extension, now gated by
  `validate:test-links`): each lane imports and exercises the shipped
  module it names — no ORPHAN, no REIMPL. The `specs/TESTING.md` boundary
  rule stands: never a second implementation of
  `LiveSessionDurableObject`, never a hand-maintained fake asserted against
  another hand-maintained description.
- **Sabotage-calibrated oracles.** The audit's decisive finding: 19 of 24
  convergence properties survived a reducer neutered to `return state` —
  true-but-too-weak oracles. Therefore **a new oracle ships with a
  demonstrated kill**: the PR that adds it names the sabotage (neutered
  reducer, dropped swing delay, seq reuse, …) it was verified to catch.
  No demonstrated kill, no merge.
- **No fault-masking assertions** (catalogue #14): oracles must distinguish
  environment failure from subject failure, the way the codec preflight
  distinguishes "browser can't decode AAC" from "instrument is silent".
  Harness failures (socket didn't open, worker didn't boot) fail loudly as
  harness errors, never as vacuous passes.
- **Anti-pattern gates apply.** New lanes run under
  `validate:test-antipatterns` (no nullified assertions, self-skips,
  tautologies, zero-assertion tests) and register in the reporter/inventory
  contracts so a skip cannot silently turn a lane green.
- **Seed hygiene** per §10a of the audit: property lanes rely on the global
  seed; anything using `fc.sample` seeds explicitly.

---

## 3. Task catalog

### B1 — Eviction seq-regression consequence test
**Half**: sync. **What**: `eviction-recovery.test.ts` already documents that
an ungraceful eviction resets `serverSeq` (persisted every 100 broadcasts,
`live-session.ts:2564-2570`; restored at `:183-187`). The open question is
the *consequence*: after a reset, re-issued sequence numbers meet clients
whose `ack` exceeds the server's counter, and Phase-26 selective mutation
clearing keys on `seq`. Build the repro entirely in CI: k < 100 mutations,
ungraceful `evictDurableObject`, reconnect, replay a high `ack`, then assert
the generic oracle — no acked mutation lost or mis-cleared, client and
server canonical hashes converge. Whatever the outcome, the question closes
with a test instead of a production sensor. **Oracle kill**: sabotage by
forcing a seq reset mid-run and weakening the snapshot push.
**Budget**: one deterministic spec, seconds. **Build**: 1 d. **Impact**: 8.

### B2 — Overlap + multi-client fuzz (extend `state-machine-fuzz.test.ts`)
**Half**: sync. **What**: the existing fuzz serializes ops and uses one
client, so overlap races — the WAL-Reset shape — are structurally out of
reach. Extend it: 2–4 real clients, ops launched *without* awaiting
completion, orderings explored via `fc.scheduler()` (fast-check is already
a dependency; the API is currently unused). Fold the KV oracle upgrade in:
compare full canonical hash at convergence points, not just
tempo/swing/name. Oracles: every acked mutation visible or provably
superseded; `validateStateInvariants` passes; all clients and server agree
at quiescence; `serverSeq` never regresses. **Oracle kill**: the audit's
neutered-reducer sabotage (which 19/24 old properties survived) plus a
seq-reuse sabotage — this lane must catch both. **Budget**: PR lane, fixed
seeds, ≤ 60 s added. **Build**: 4 d. **Impact**: 9.

### B3 — Playback × mutation race lane
**Half**: musical. **What**: the audio equivalent of write-during-checkpoint:
a remote mutation landing while the lookahead scheduler
(`audio/scheduler.ts`, 25 ms timer / 100 ms window) has notes in flight —
tempo change mid-window, `stepCount` change mid-loop, instrument swap
mid-note, track delete with a tied note sounding, stop/start churn. No test
races these today. Drive the real scheduler and engine through the existing
typed audio fakes and DI; explore orderings with `fc.scheduler()`. Oracles:
every expected trigger fires exactly once (conservation), nothing scheduled
in the past, voice count bounded and ledger-clean via `getDiagnostics()`,
timers clean after stop (asserting the existing `playback-state-debug`
checks from the test side — no shipped-code change). If a virtual-clock gap
in the seams emerges, that escalates per §1.1. **Oracle kill**: sabotage
`timing-calculations.ts` (drop the swing delay; skip `advanceStep` on
stepCount change). **Budget**: PR lane ≤ 45 s. **Build**: 5 d.
**Impact**: 9.

### B4 — Musical conservation oracles on deterministic renders
**Half**: musical. **What**: property-generated patterns (polyrhythms 3–128,
swing, ties, parameter locks) rendered through the existing
`OfflineAudioContext` path (`session-render.render.test.ts`), asserting
rendered onset count == scheduled trigger count, no NaN, no unexpected
silence. Same task adds the pure musical properties: MIDI export
round-trip, scale-lock closure (a locked grid never emits an out-of-scale
pitch), polyrhythm cycle math. **Oracle kill**: silence one instrument in
the render path; shift one onset by a step. **Budget**: bounded pattern
count, ≤ 90 s in the lane that owns real audio. **Build**: 2.5 d.
**Impact**: 6.

### B5 — Nightly bounded soak + seed promotion
**Half**: both. **What**: the fixed seeds in the fuzz lanes explore nothing
new after their first run. A scheduled CI job runs the fuzz lanes (today's
single-client fuzz immediately; B2/B3 as they land) with fresh random seeds
under a **hard 15-minute wall-clock cap**, never gating PRs. Any failing
seed is reproduced locally by its printed seed and promoted into the fixed
regression set. Exploration compounds; flake exposure stays zero because
the nightly lane's only output is "a seed to promote". **Build**: 1 d.
**Budget**: 15 min/night, capped in the workflow itself. **Impact**: 6.

### B6 — Historical-bug kill-rate validation
**Half**: both. **What**: the skill's sabotage step upgraded from synthetic
to *real* faults. Resurrect pre-fix commits of documented bugs — Lessons 2,
5, 14, 40 on the sync half; the sampled-instrument preload race on the
musical half — and run the fuzz/race lanes against them. Record the kill
list next to the audit's kill-rate tables; every miss is an oracle gap with
a named fix. Runs locally/CI-on-demand, not per-PR. **Build**: 2.5 d.
**Impact**: 6 — it decides how much to trust B1–B5, exactly as the audit's
sabotage decided how much to trust the convergence suite.

### B7 — Client reconnect-boundary schedule lane
**Half**: sync (client side). **What**: extend the existing
`ControlledWebSocket` fault tests from single scripted faults to seeded
schedules across the reconnect boundary: drop mid-burst, reconnect, vary
snapshot-vs-queued-broadcast arrival order, replay acks. Oracles: the
client queue never loses an acked-or-queued mutation; optimistic state
re-converges to the canonical hash; no duplicate dispatch. All through the
real `MultiplayerConnection` — the transport is already injectable.
**Oracle kill**: sabotage the client queue's requeue-on-reconnect.
**Budget**: PR lane ≤ 20 s. **Build**: 2 d. **Impact**: 5.

### B8 — Paved-path deviation inventory
**Half**: both, docs only. **What**: a living section in
`docs/STORAGE-ARCHITECTURE.md` plus an audio counterpart listing every
deviation from the platform's standard path (dual storage with debounce,
`serverSeq` durability split, hibernation wake reloads, auto-repair,
16-voice stealing, custom lookahead, Tone.js/Web Audio mixing), each entry
pointing at the lane that covers it — B1–B7 give most entries a real
pointer. **Build**: 0.5 d. **Impact**: 3 directly; targets everything else.

### Excluded from this plan (recorded so they don't creep back)
Declined in review, 2026-08-13 — production-touching:
- Negative-`ackGap`/seq-regression **telemetry** (B1 answers the question in
  CI instead), invariant/repair-rate **wide-event counters**, sampled
  **DO→KV production audit**, client **audio-health beacon**.
- **Storage/KV fault-injection seam** — requires refactoring shipped
  persistence code; out of bounded scope.
- **Mutation journal** (per-mutation production cost) and **vendor DST
  platforms** (their remaining edge is inside Cloudflare's platform, which
  is Cloudflare's job).

The conscious trade: the Tailscale near-miss-telemetry lesson (L5 in the
learnings doc) is not adopted. The bounded compensations are B1 (turn the
production question into a repro test) and B6 (prove the oracles can
actually kill). If production visibility is ever wanted, that is a new
decision against the learnings doc, not this plan.

---

## 4. Stack rank (impact ÷ build cost; recurring cost is CI-only everywhere)

| Rank | Task | Half | Impact | Build | CI budget | Ratio |
|---|---|---|---|---|---|---|
| 1 | B1 eviction seq-regression consequence test | sync | 8 | 1 d | seconds, PR lane | 8.0 |
| 2 | B5 nightly bounded soak + seed promotion | both | 6 | 1 d | 15 min/night, hard cap | 6.0 |
| 3 | B8 deviation inventory | both | 3 | 0.5 d | none | 6.0 |
| 4 | B7 client reconnect-boundary schedule lane | sync | 5 | 2 d | ≤ 20 s PR | 2.5 |
| 5 | B6 historical-bug kill-rate validation | both | 6 | 2.5 d | on-demand | 2.4 |
| 6 | B4 musical conservation oracles | musical | 6 | 2.5 d | ≤ 90 s PR | 2.4 |
| 7 | B2 overlap + multi-client fuzz | sync | 9 | 4 d | ≤ 60 s PR | 2.25 |
| 8 | B3 playback × mutation race lane | musical | 9 | 5 d | ≤ 45 s PR | 1.8 |

Total build ≈ 18.5 dev-days. Total recurring production cost: **$0, by
construction**. Total CI addition: ≤ ~3.5 minutes across PR lanes plus a
capped 15-minute nightly.

B2 and B3 rank mid-table on ratio but carry the highest absolute impact —
they are the reason the plan exists. Sequencing resolves the tension:

- **Wave 1 (~2.5 d)**: B1, B5, B8 — the open correctness question closes,
  the soak starts compounding on the fuzz we already have, the inventory
  aims the rest.
- **Wave 2 (~6.5 d)**: B2, then B6 run against it (and against the
  historical corpus) before trusting its green.
- **Wave 3 (~9.5 d)**: B3, B4, B7 — the musical half gets its race lane,
  conservation oracles, and the client boundary gets schedules.
