# Bounded Correctness Plan — Local Execution Receipt

**Date**: 2026-08-13
**What this is**: every task in `specs/BOUNDED-CORRECTNESS-TESTING-PLAN.md`
was executed locally, in scoped form, in one session. This receipt records
what ran, the exact numbers, what was found, and what was consciously not
done. Environment: Node 22.22.2, vitest 4.1.9, workerd via
`@cloudflare/vitest-pool-workers` 0.16 — the real Worker/DO/storage stack
ran in-process for every integration result below.
**Production cost**: $0. Nothing was deployed; no shipped code changed
(every sabotage edit was reverted; `git status` on shipped paths is clean).

## Task outcomes

| Task | Outcome | Artifact |
|---|---|---|
| B1 seq-regression consequence tests | **Done — headline finding F1** | `test/integration/seq-regression.test.ts` (2 tests), `src/sync/seq-regression.test.ts` (3 tests) |
| B2 overlap + multi-client fuzz | **Done — green under 53 seeds** | `test/integration/overlap-fuzz.test.ts` |
| B3 playback × mutation race lane | **Done — no seam escalation needed** | `src/audio/scheduler-mutation-race.test.ts` |
| B4 musical conservation oracles | **Done — 10 tests, 3 subjects** | `scale-entry.property.test.ts`, `midi-core.roundtrip.property.test.ts`, `session-render-conservation.render.test.ts` |
| B5 soak + seed promotion | **Done — 242 fresh seeds, 0 to promote** | `FUZZ_SEEDS` binding in `test/integration/vitest.config.ts` |
| B6 kill-validation | **Done — 6/6 kills** | sabotage log below |
| B7 client reconnect-boundary lane | **Partially folded into B1's client half** (2 of its 3 tests cross the reconnect boundary; scripted scenarios, not generated schedules) | `src/sync/seq-regression.test.ts` |
| B8 deviation inventory | **Done** | `docs/STORAGE-ARCHITECTURE.md` §Paved-Path Deviation Inventory |

Gates after all additions: `validate:test-antipatterns` ✅ (315 files),
`validate:test-links` ✅, `tsc -b` ✅, unit suite **4,659 passed / 1
skipped**, integration suite **138 passed** (12 files).

## Findings, ranked

### F1 — The eviction seq-regression has a real, bounded consequence: reconnect churn, not data loss

The full causal chain is now pinned by green tests at each link:

1. **Server** (`test/integration/seq-regression.test.ts`): three mutations
   broadcast seq 1–3; an ungraceful `evictDurableObject` discards the
   in-memory counter (persisted only every 100 broadcasts / on graceful
   flush); the next mutation on the SAME hibernated socket broadcasts
   **seq 1 again**. REST reads still return the latest state — the
   regression is a protocol-counter problem, not a storage problem.
2. **Server**: a client acking a pre-eviction seq (ack > serverSeq) gets no
   snapshot, no log — `ackGap > ACK_GAP_THRESHOLD` is false for negative
   gaps. The same test proves a positive gap of 52 DOES push a snapshot, so
   the silence is measured by a working detector.
3. **Client** (`src/sync/seq-regression.test.ts`): regressed-epoch frames
   are **applied, not dropped** (no remote-update loss). Each is counted
   out-of-order; the 11th trips `scheduleReconnect()`. Neither the
   reconnect path nor `handleOpen()` resets `SyncHealth` — only the public
   `disconnect()` does, and it never runs — so the stale high-water
   `lastServerSeq` survives the reconnect, outgoing mutations carry a stale
   `ack` (the value the server silently ignores), and the churn cycle
   re-arms every ≤11 mutating frames **until the new epoch's counter climbs
   past the old high-water mark**, at which point it self-heals.

Phase-26 selective clearing was analyzed but not end-to-end tested:
`clearOnSnapshot` only deletes *confirmed* mutations, and cross-epoch
comparisons err toward keeping them indefinitely (its age-fallback branch is
unreachable when both serverSeqs are defined; aging-out happens via the
separate interval-driven `pruneOldMutations()`) — so mis-clear looks
unlikely by reading, but that is analysis, not evidence.

**User-visible symptom to watch for**: a client in a busy session
reconnecting every few seconds after a server restart/eviction, healing on
its own after roughly (old seq − new seq) further mutations.

### F2 — Overlap correctness holds at our altitude

The overlap fuzz drove 3 real WS clients firing waves with no awaits
between sends (12 concurrent mutations per wave, 3 waves per seed) and
asserted: per-client seq conservation (every client sees exactly
(low, high], each seq once), last-broadcast-wins state equality,
cross-client snapshot + REST convergence, and server invariants. Result:
**green on 53 fresh seeds** (3 fixed + 40 soak + 10 contamination-rerun).
The sequential state-machine fuzz separately passed **182 fresh seeds**
(2 smoke + 180 soak). Nothing to promote into the regression seed sets.
The DO actor model is doing its job for WS-vs-WS overlap; the risk the
learnings doc predicted concentrates in the lifecycle seam (F1), not in
message concurrency.

### F3 — The audio scheduler is robust under racing mutations, and the lane re-finds a real historical bug

Virtual-time harness: mocked engine clock + fake timers advance in 25 ms
lockstep; seeded tempo/stepCount/track-add/track-delete mutations land
between lookahead ticks through the live `getState`. Oracles: never
schedule into the past, no near-duplicate triggers, per-track monotone
times, clean stop (timers drained). **Green, 3 seeds × 2 s virtual.**
Kill-validation doubled as historical validation: disabling the Phase-22
BPM-change reformula (the documented pre-fix bug) makes the lane fail with
notes scheduled ~100 ms into the past on 2 of 3 seeds — the lane finds the
bug this subsystem actually had.

**Seam finding**: no shipped-code change was needed. The scoped plan's
feared escalation (a virtual-clock seam) did not materialize — the existing
`vi.mock('./engine')` pattern plus `getState` injection was sufficient.

### F4 — Every new oracle has a demonstrated kill (6/6)

| Sabotage (all reverted) | Oracle that caught it |
|---|---|
| Toggle write dropped, broadcast still announces the value (the WAL-Reset shape: lost committed write) | overlap-fuzz last-broadcast-wins vs snapshot (`t1:9: expected false to be true`) |
| Every 5th broadcast reuses its seq | overlap-fuzz seq conservation (via quiescence: the missing seq never arrives) |
| Negative-ack resync added (the plausible future fix) | seq-regression silence assertion fails — the pin will flag the fix |
| Last scheduled hit silenced in the render path | onset conservation, 4/4 seeds |
| `encodeMidi` drops step 0 | MIDI note-on conservation, property fails in 2 runs |
| Tempo-change reformula disabled | race-lane past-scheduling oracle, 2/3 seeds |

### F5 — The harness-honesty ledger (anti-pattern #14, lived)

Four times, the first signal was false and the fix was distinguishing
harness failure from subject failure:

1. **Soak "failures" were timeouts**: 50-seed batches exceeded the fuzz's
   fixed 120 s timeout and reported FAIL. Fix shipped: the timeout now
   scales with seed count, so a soak batch cannot masquerade as an oracle
   failure.
2. **The "snapshot after negative ack" was the handshake snapshot** sitting
   in the listener buffer. Fix: consume connection-setup frames before
   absence assertions.
3. **Two soak batches were contaminated** by a sabotage edit running in the
   same working tree at the same time (their failure signature matched the
   sabotage exactly; the same 10 seeds pass clean). Rule adopted: sabotage
   runs and soaks never share a working tree. Accidental upside: 20 extra
   seeds confirmed the lost-write kill.
4. **The race lane's first crash was its own fabricated state**:
   `{...undefined, stepCount}` after a delete shrank the track list built a
   track with no `steps` — a state the reducer can never produce, admitted
   by an `as Track` cast. Harness fixed to construct only reachable states;
   the scheduler was innocent.

### F6 — Costs

- Production: **$0** (nothing deployed, no telemetry, no new storage or KV
  traffic).
- Added PR-lane runtime, measured: client seq-regression ~1.0 s; server
  seq-regression ~0.6 s and overlap fuzz ~0.5 s inside the integration
  suite (whole integration suite: 19.0 s); scale/MIDI properties ~1.0 s;
  onset renders ~0.9 s; race lane ~1.0 s. Total ≈ **+5 s across lanes** —
  within every budget the plan set.
- Soak: ~22 minutes wall-clock total in this session (bounded batches),
  242 fresh seeds across the two fuzzes.

## Not done / left open

- **`fc.scheduler()` was not used.** The plan named it as the exploration
  mechanism for B2/B3/B7; the delivered lanes hand-roll seeded schedules
  (`mulberry32`) instead — which explore but do not *shrink*. The receipt's
  original "Done" labels understated this substitution; the shrinkability
  upgrade is now tracked as T1 of the PBT program (issue #97).
- **Nightly CI wiring** for the soak (the mechanism — `FUZZ_SEEDS` — is in
  place and exercised; adding the workflow file is a deliberate follow-up).
- **Historical-commit archaeology** beyond the tempo-reformula re-find
  (checking out pre-fix commits of Lessons 2/5/14/40).
- **REST-vs-WS overlap and eviction-inside-wave** in the overlap fuzz
  (named exclusions in its header).
- **Any fix for F1** — the tests pin current behavior; the natural fixes
  (persist `serverSeq` with every state write, resync on negative gap,
  reset `SyncHealth` on reconnect) are one decision and three small diffs
  away, and the inverse-kill test will flag the server half the moment it
  changes.

## Addendum — multi-agent audit remediation (2026-08-13)

A five-dimension adversarial audit of this branch (simplicity, oracle
precision, harness correctness, doc-claims accuracy, blast radius; ~60 doc
claims verified, 56 held) produced confirmed findings that were then fixed
in place:

- **Oracle precision (high)**: the negative-ack silence test used `ack: 50`
  against `serverSeq = 1` — gap −49, whose *magnitude* is also under the
  50 threshold, so a `Math.abs(ackGap)`-based detector would have passed it.
  Now `ack: 100` (gap −99): the test discriminates the sign, and the
  re-run `abs()` sabotage fails it as required.
- **Harness (high)**: a malformed `FUZZ_SEEDS` override (`"abc"`, `","` —
  or `"0xc0ffee"`, which radix-10 `parseInt` coerces to 0 despite being a
  committed seed) silently reduced both fuzz lanes to a zero-seed vacuous
  pass (reproduced: 3 ms green run). Parsing is now fail-closed
  (`parseSeedOverride` in `src/test/seeded-random.ts`).
- **Harness (medium)**: `waitFor`'s timeout left a dangling frame-consuming
  waiter that could swallow frames a later `absent()` asserts about; it now
  removes itself. `absent()` was simplified to pure buffer inspection,
  which is also immune to waiter interference.
- **Calibration (medium)**: the race lane's `>= 5` trigger floor became a
  liveness assertion (last trigger in the final quarter of the run); the
  tempo generator now respects `MAX_TEMPO`; the render lane asserts the
  refractory's two bounds explicitly and compares onset times against a
  literal grid rather than the subject's own `getStepDuration`. The
  auditor's suggested near-duplicate threshold (1.0× min step duration)
  was itself refuted by running it: seed 777 produces a legitimate
  38.5 ms gap because consecutive BPM-change rebases compound compression
  beyond any single-change derivation. Final form: a 1 ms exact
  double-fire epsilon, with catch-up-burst pathologies owned by the
  never-into-the-past oracle (which is what killed the historical
  sabotage).
- **Hygiene (low)**: `mulberry32`/`randInt` re-declarations replaced with
  imports from `src/test/seeded-random.ts` (three files); the scheduler
  race lane resets the instance registry per case and stops the scheduler
  in `afterEach`; integration teardowns await the DO's async close work;
  two tautological assertions removed; the redundant monotonicity oracle
  folded into the near-duplicate oracle (which implies it).
- **Docs**: this receipt's B7 row corrected (2 of 3 tests cross the
  reconnect boundary; scripted, not generated schedules); the
  `fc.scheduler()` substitution disclosed under "Not done"; the plan's
  lookahead figure corrected to 150 ms (`SCHEDULE_AHEAD_SEC = 0.15` — the
  100 ms figure also persists in older docs: `README.md`,
  `specs/ARCHITECTURE.md`, `specs/AUDIOWORKLET-ENGINE.md`, follow-up
  material); the deviation inventory's allocator row now points at the
  real covering test (`mcp-adapter.test.ts`).

Adversarially refuted (recorded so they are not re-raised): the `absent()`
waiter type-cast was *correct* (both cleanup paths verified) — replaced
anyway because the buffer-only form is simpler and stronger; the overlap
fuzz's quiescence predicate cannot pass wrongly (reused seqs stall it into
timeout; the strict per-client equality is safe because the DO serializes
one identical frame to every socket); the 400 ms absence window rests on
causal ordering (ack check precedes mutation dispatch), not timing luck;
`swing: 0` in the race fixture is not load-bearing (all fixture steps are
even, so the swing path is dead there either way).
