# The SQLite WAL-Reset Bug: What Keyboardia Should Learn From It

**Research Date**: 2026-08-13
**Method**: Read the Antithesis write-up, the Tailscale post-mortem, the SQLite
3.51.3 release log, and press coverage (sources in §7; the Hacker News thread
was rate-limited and not read). External pages were read through a summarizing
fetch on 2026-08-13, so quotes are as relayed by that fetch, not hand-copied
from the page. Every claim about *Keyboardia* below was verified directly
against the working tree at the commit this document lands in, with file and
line references.
**Status**: Analysis and recommendations only. No production code changed.

> Prior art gap: before this document, "Antithesis", "WAL", "write-ahead",
> and "deterministic simulation" appeared nowhere in this repository, even
> though both Durable Object classes run on SQLite-backed storage
> (`app/wrangler.jsonc` migrations v1/v2, `new_sqlite_classes`).

---

## 1. The incident, from three vantage points

### 1.1 The bug itself (SQLite's account)

A rare data race between a **checkpoint** and a **write transaction** in
SQLite's write-ahead-log subsystem. If a write lands at a precise moment
during a checkpoint, the checkpointer concludes that pages have been copied
from the WAL into the main database file when they have not. Those committed
pages are never backfilled and are permanently lost; the database corrupts
because *other* pages that reference them — index pages, for example — do get
written. The fix adds a check that detects when the WAL has been reset by
another thread mid-checkpoint.

Preconditions, per the advisory: WAL mode, **two or more connections to the
same file from separate threads or processes**, and a write and a checkpoint
colliding at the same instant.

Two facts make this story unusual:

- **Lifespan**: present from SQLite 3.7.0 (2010-07-21, the release that
  introduced WAL) through 3.51.2 (2026-01-09); fixed in 3.51.3 (2026-03-13).
  Roughly sixteen years inside one of the most heavily tested codebases in
  existence — 100% branch coverage, billions of test executions.
- **Reproducibility**: the SQLite developers reported never reproducing it
  organically. They had to add special logic that deliberately forces the
  racing schedule just to verify their own fix.

### 1.2 Tailscale's six months

Tailscale hit the bug in production because they run SQLite in a non-standard
configuration with aggressive manual checkpointing, which multiplied the
collision odds enormously.

- **Symptoms**: 19 corruption incidents over ~6 months starting August 2025
  (with a deceptive six-week quiet stretch in the middle); `PRAGMA
  integrity_check` failures found by scanning backups; **committed writes that
  later transactions could not see**; and a metric showing SQLite copying
  *more pages out of the WAL than the WAL contained* — an impossible number.
  User-visible impact: shard downtime, device connection failures.
- **Debugging kit they had to build**: streaming transaction logs (so any
  incident could be deterministically replayed), continuous integrity checks
  over S3 backups, and a tracing VFS shim (`tmstmpvfs`) written by the SQLite
  developers themselves to log low-level file activity. The shim is what
  finally exposed the race.
- **Fix verification**: after deploying 3.51.3's fix, Tailscale patched their
  driver to **log a warning whenever a write and a checkpoint overlapped** —
  the dangerous schedule, not the failure. Two months later the warning fired
  and no corruption followed. That near-miss log line is what proved the fix.
- **Their stated lesson**: "Running boring technology in a non-standard way is
  a risk."

### 1.3 Antithesis's fifteen minutes

Carl Sverre at Antithesis took stock SQLite 3.51.2, added **two generic
assertions** — "no committed write is ever lost" and "the database passes
integrity_check" — and ran a **completely generic workload**: concurrent
writes and checkpoints from multiple connections, exactly what production
does all day. No bug-specific reproduction logic. Their deterministic
simulation platform, which explores thread schedules and replays failures
exactly, surfaced the bug in about 15 minutes on the first run
(instrumented fork: `github.com/antithesishq/sqlite`, tree
`3.51.2-instrumented`).

The contrast is the point: six months of production incidents, custom VFS
tooling, and SQLite's own maintainers on one side; two obvious assertions
plus schedule exploration on the other.

---

## 2. The transferable lessons

None of these require SQLite, Antithesis, or a database. They apply to any
stateful concurrent system — which is what `LiveSessionDurableObject` is.

**L1 — Test suites measure the interleavings you explored, not the ones that
exist.** Sixteen years of near-total branch coverage never once produced the
racing schedule. Line/branch coverage says nothing about *schedule* coverage.
A test lane that cannot force or randomize event ordering cannot find — or
even verify the fix for — this class of bug (SQLite had to add deliberate
race-forcing logic to test theirs).

**L2 — Generic invariants plus a realistic concurrent workload beat clever
bug-specific tests.** The two assertions that caught a sixteen-year-old bug
are properties every stateful system has: *nothing acknowledged is ever
lost*, and *state is always structurally valid*. The workload was "what
production does anyway." The sophistication was all in the harness that
explored schedules, not in the test's knowledge of the bug.

**L3 — Corruption is detected far from where it is caused.** Tailscale saw
the bug in backup scans and metrics, never at the racing write. If you only
validate state at the moment of mutation, you learn about corruption from
your users. Continuously verifying the *secondary copies* is what bounded
their blast radius.

**L4 — Impossible metrics are the earliest signal.** "Copied more pages than
available" was visible in telemetry well before root cause. Conservation
violations — a counter going backwards, an output exceeding its input — are
cheap to check and almost always mean memory-vs-storage divergence. Alert on
impossible, not just on error.

**L5 — Instrument the near-miss, not just the failure.** The single most
elegant move in the story is Tailscale's post-fix warning on the *dangerous
overlap itself*. It converts "we haven't seen corruption lately" (absence of
evidence) into "the race occurred N times and was survived every time"
(evidence). A silent risky window is unmeasurable; a logged one is a metric.

**L6 — Boring technology in a non-standard configuration is where latent
bugs surface.** Most SQLite users will never hit this bug; Tailscale's
checkpointing strategy made them the ones who did. Every deviation from a
platform's paved path concentrates probability of meeting bugs nobody else
will ever see — those deviations deserve an explicit inventory, each with
its own tests and telemetry.

**L7 — Deterministic replay collapses debugging time.** Both success stories
rest on replay: Tailscale streamed transaction logs so incidents could be
re-run; Antithesis replays the exact failing schedule on demand. Without
replay, a rare race is six months of forensics. Record enough to reconstruct
the sequence of mutations, and a production incident becomes a test case.

---

## 3. Where Keyboardia already practices this (verified)

The repo is further along than most codebases on L2–L4's *mechanisms*:

| Practice | Where | Lesson |
|---|---|---|
| Structural invariant validation after every mutation, with production logging | `app/src/worker/invariants.ts:339,366` (`validateStateInvariants`, `logInvariantStatus`); called from `validateAndRepairState` in `app/src/worker/live-session.ts:2630` | L2 |
| Auto-repair with logged repair list | `repairStateInvariants` (`app/src/worker/invariants.ts:389`), applied at `live-session.ts:2640` | L2/L5 |
| Client/server canonical state hash — our `integrity_check` across the network boundary | `app/src/sync/canonicalHash.ts`; born from the production hash-mismatch incident (`docs/LESSONS-LEARNED.md` Lesson 14) | L2/L3 |
| Property-based testing culture (fast-check) | `app/package.json:134`; `app/src/worker/validation.property.test.ts`; Lesson 26 | L2 |
| Real-DO testing discipline — "Do not create a second in-memory implementation of `LiveSessionDurableObject`" | `specs/TESTING.md` boundary rule | L1 (prerequisite) |
| Documented production-only failure modes and wake-path discipline | Lessons 13, 14, 40 in `docs/LESSONS-LEARNED.md` | L6 |
| Dual-storage awareness, including that DO and KV can diverge | `docs/STORAGE-ARCHITECTURE.md`; Lesson 2 | L3 |

**Exposure to the actual bug**: both DO classes are SQLite-backed
(`app/wrangler.jsonc`, `new_sqlite_classes` migrations v1/v2), so Keyboardia
literally runs on SQLite — but as a single embedded connection inside
Cloudflare's single-threaded actor runtime, with Cloudflare owning the SQLite
version and its patch cadence. The advisory's preconditions (two or more
connections from separate threads/processes checkpointing concurrently) do
not exist at our layer, and Cloudflare's internal configuration is not
observable from this repo. The transferable value here is the method, not a
patch. The dependency is still worth knowing about: "our storage engine had
a sixteen-year-old data-loss race" is exactly the kind of platform fact that
justifies keeping the KV secondary copy and verifying it (G4 below).

---

## 4. The gaps, each anchored to verified code

### G1 (L1/L2): We randomize inputs, never schedules

Our property tests are strong on *value* space (`fc.assert` over states and
mutations) but nothing in any lane races mutations against the events that
reorder them in production: hibernation/eviction wake, reconnection, the KV
save debounce, snapshot pushes. Those orderings are exactly where Lessons 2,
13, 14, and 40 came from — each was discovered in production, which is the
expensive way.

**Proposal — a "no lost acked mutation" harness** (the direct translation of
the Antithesis workload):

- Runs in the workers-pool lane against the real `LiveSessionDurableObject`
  (the `specs/TESTING.md` boundary rule already mandates this).
- N simulated clients issue randomized mutation streams and record every
  server ack (`seq`/`clientSeq`).
- Between steps, the harness injects the reordering events we actually have:
  simulated eviction (drop the instance, reload from storage — Lesson 40's
  wake paths), reconnect with `ack` replay, forced `saveToKV`, snapshot
  pushes.
- Terminal assertions, all generic: every acked mutation is reflected in
  final state or provably superseded by a later acked mutation on the same
  field; `validateStateInvariants` passes; client-side and server-side
  canonical hashes agree; `serverSeq` never regressed.
- Seed-reported and re-runnable, like the existing fast-check lanes (L7:
  a failing seed is a replay).

This finds the same *class* of bug the Antithesis run found, at the layer
where Keyboardia actually owns the concurrency.

### G2 (L4): Our one known impossible metric is currently silent

`serverSeq` is restored from storage on construction
(`live-session.ts:183-187`) but persisted only every 100 mutating broadcasts
(`live-session.ts:2564-2570`) and on KV saves (`live-session.ts:2596`). An
eviction between persists therefore wakes the DO with a `serverSeq` lower
than sequence numbers already sent to clients. A reconnecting client can then
present `msg.ack > this.serverSeq` — a client that has "seen the future,"
impossible under normal operation and precisely the counter-regression shape
of the WAL-Reset bug (a durability cursor lagging the events it covers).

Today that case vanishes: `ackGap = this.serverSeq - msg.ack` goes negative
and fails the `ackGap > ACK_GAP_THRESHOLD` test (`live-session.ts:934-943`),
so no log, no snapshot, no metric. This is not asserted to be a live
corruption bug — the window is bounded by the persistence cadence, and
snapshot flows may paper over it — but it is exactly what L4/L5 say to make
visible. One conditional (`if (ackGap < 0)`) logging a wide event, plus a
snapshot push to resynchronize, turns an invisible near-miss into a counted
one. Sequence-number reuse also interacts with Phase 26 selective mutation
clearing, which keys on `seq` — a reason to *measure* before assuming the
window is harmless.

### G3 (L5): Repair happens, but repair *rate* is not a first-class signal

`validateAndRepairState` logs violations and repairs via `console.warn`
(`live-session.ts:2637-2643`), and the debug endpoint exposes point-in-time
invariant status (`live-session.ts:2662-2666`). What Tailscale's story adds:
the *frequency* of violations/repairs is itself the health metric. A repaired
violation is a survived near-miss; a rising rate is the warning firing.
Proposal: count invariant violations and repairs in the Observability 2.0
wide events (per session, per context string), so the question "how often
does state need repair in production, and is it increasing?" has an answer
without grepping logs.

### G4 (L3): Nothing continuously verifies the DO→KV copy

`docs/STORAGE-ARCHITECTURE.md` names KV as the read-optimized copy and
backup; Lesson 2 documents that DO and KV state *have* diverged. Publishing,
remixing, and REST reads all serve from KV (`app/src/worker/sessions.ts`).
Yet no code path ever compares what landed in KV against DO truth —
divergence is discovered the Tailscale-before-tooling way, by a user.
Proposal: a sampled convergence check — after a `saveToKV` settles (or on a
periodic alarm), read the KV copy back, canonical-hash both sides, and emit
a wide event on mismatch. Sampling keeps KV read costs negligible; even 1%
sampling converts "KV is probably fine" into a measured error rate.

### G5 (L6): Our paved-path deviations are documented piecemeal, not inventoried

Keyboardia's non-standard choices, assembled from existing docs and code:
dual-storage with debounced propagation (STORAGE-ARCHITECTURE.md);
`serverSeq` durability split from state durability (`live-session.ts:2564`,
`2596`); WebSocket Hibernation with manual wake-path state reload (Lesson
40); auto-repair-on-violation rather than fail-stop (`live-session.ts:2640`);
alarm-based expiry bookkeeping in the allocator
(`session-allocator.ts:142-168`). Each is individually justified; the lesson
is that *this list* is where latent platform bugs will surface for us and
nobody else, so each entry should carry a test and a near-miss counter (G1
and G2 cover the first three). Keeping the inventory as a living section in
STORAGE-ARCHITECTURE.md costs a paragraph.

### G6 (L7): No server-side mutation journal for replay

Client-side debug tracing exists (`?debug=1`, persistent logs), and wide
events record aggregates, but no artifact reconstructs *the sequence of
mutations* that produced a bad session state. Tailscale's transaction-log
streaming is the model: a bounded ring (say, the last 256 mutating messages
with `seq`, type, and payload digest) in DO storage would let an on-call
engineer replay the path into any corrupted state through the real reducer.
Cost-aware caveat: SQLite-backed DO storage bills per row written
(`specs/research/DURABLE-OBJECTS-COSTS.md`), so this belongs behind sampling
or a per-session debug flag, not on by default.

---

## 5. Recommended order

| # | Action | Gap | Effort | Payoff |
|---|---|---|---|---|
| 1 | Log + resync on negative `ackGap` | G2 | ~10 lines | Makes our known impossible state visible; directly tests the eviction/seq hypothesis in production |
| 2 | Invariant-violation and repair counters in wide events | G3 | Small | Turns existing checks into a trend line; the "warning fired" signal |
| 3 | Sampled DO→KV convergence audit | G4 | Small-medium | First continuous verification of the backup copy we already pay for |
| 4 | "No lost acked mutation" schedule-exploration harness | G1 | Medium | Finds the bug class *before* production does; verifies fixes for it |
| 5 | Deviation inventory section in STORAGE-ARCHITECTURE.md | G5 | Trivial | Focuses future testing/telemetry where risk concentrates |
| 6 | Opt-in mutation journal for replay | G6 | Medium | Six-month forensics → one afternoon, when the day comes |

Items 1–3 are pure observability with no behavior change beyond one
resynchronizing snapshot; item 4 is where the durable engineering value is.

---

## 6. What this document does not claim

- Not that Keyboardia is exposed to the WAL-Reset bug itself. Our layer
  can't create its preconditions, and the platform owns the patch.
- Not that G2 is a live data-loss bug. It is an unobserved window whose
  size is bounded by persistence cadence; the recommendation is to measure
  it, which is cheaper than proving it harmless by argument.
- Not that "Antithesis found in 15 minutes what took Tailscale 6 months"
  means production debugging was wasted effort. The 15-minute run happened
  *after* the fix existed and benefited from a purpose-built simulation
  platform. The honest version: the *method* — generic invariants, realistic
  concurrent workload, schedule exploration, deterministic replay — is what
  finds this bug class, and every piece of that method except the hypervisor
  is adoptable in our existing test lanes.

---

## 7. Sources

- Antithesis, "Breaking the WAL" (Carl Sverre, 2026-08-12):
  https://antithesis.com/blog/2026/wal-reset-bug/
- Tailscale, "How Tailscale helped find the SQLite WAL-Reset bug"
  (2026-08): https://tailscale.com/blog/sqlite-wal-reset-bug
- SQLite 3.51.3 release log (2026-03-13):
  https://sqlite.org/releaselog/3_51_3.html
- The Register, "Deeply buried 16-year-old SQLite bug caused last year's
  Tailscale outages" (2026-08-12):
  https://www.theregister.com/databases/2026/08/12/deeply-buried-16-year-old-sqlite-bug-caused-last-years-tailscale-outages/5287004
- Instrumented reproduction fork:
  https://github.com/antithesishq/sqlite (tree `3.51.2-instrumented`)
- Not read: the Hacker News thread (HTTP 429 at research time).

Related internal documents: `docs/LESSONS-LEARNED.md` (Lessons 2, 13, 14,
26, 40), `specs/TESTING.md`, `docs/STORAGE-ARCHITECTURE.md`,
`docs/BUG-PATTERNS.md`, `specs/research/CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md`.
