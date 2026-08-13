# Correctness Exploration Plan

**Date**: 2026-08-13
**Status**: Proposed
**Motivation**: `specs/research/WAL-RESET-BUG-LEARNINGS-2026-08.md` — the
SQLite WAL-Reset incident distilled to a method: generic invariants,
realistic concurrent workloads, schedule exploration, deterministic replay,
and production near-miss telemetry. This plan turns that method into ranked
tasks across **both halves of the product**: the sync/persistence stack
(Worker, DO, KV, WebSockets) and the musical stack (scheduler, synths,
voices, rendering). The audio engine is a concurrent system too — remote
mutations race the lookahead scheduler in every multiplayer session — and it
currently has weaker invariants and zero production visibility compared to
the worker side.

Every task carries an explicit **recurring production cost**, because
production runs cost real money and this repo has already been burned once:
the KV free-tier daily write quota was exhausted in production and saves
silently failed (`specs/QUOTA-OBSERVABILITY.md`).

---

## 1. Cost model

Unit economics, from this repo's own analyses
(`specs/research/DURABLE-OBJECTS-COSTS.md`,
`specs/research/COST-ANALYSIS-DO-STORAGE.md`,
`specs/research/CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md`):

| Unit | Rate | Notes |
|---|---|---|
| KV write | $5.00/M (1M/mo free; free tier historically capped at 1k/day) | **Scarcest unit** — caused a real silent-data-loss incident |
| KV read | $0.50/M (10M/mo free) | Cheap; plenty of free headroom |
| DO request | $0.15/M | Cheap |
| DO duration | $12.50/M GB-s, billed at 128 MB while active | ≈ **$0.0056 per DO-hour awake**. The expensive unit to waste |
| DO SQLite rows | ~$1.00/M written, reads near-free | Listed free in Dec 2025; billing effective 2026-01-07 — treat as billed |
| Workers Logs (wide events) | Billed **per event** (~$0.60/M past included 20M/mo; verify at implementation) | **Adding fields to an existing event costs $0** |
| CI minutes | $0 (public repo, hosted runners) | Bounded wall-time is still a constraint |

Four design rules fall out, and every task below obeys them:

1. **Piggyback, never alarm.** Checks run inside DOs that are already awake
   for another reason. An hourly 1-second audit alarm across 10k session DOs
   is ~900k GB-s/mo ≈ $11/mo of duration for zero user value — the
   anti-pattern to refuse in review.
2. **Fields, not events.** Production telemetry lands as new fields on wide
   events we already emit (billed per event, not per field). New event
   types need justification.
3. **Never spend KV writes on observability.** Reads are fine (sampled);
   writes are the unit that has already caused an incident.
4. **Every production knob has a sampling rate** defaulting low, so the
   worst-case bill is capped by configuration, not by traffic.

Impact scoring below = severity of the bug class it addresses × likelihood
it actually surfaces/prevents that class × how blind we are today (1–10).
Cost = build effort in dev-days + recurring $/mo at current scale
(~10k sessions/day planning number from the cost docs). Rank = impact ÷
cost, cheap sensors first; the two big harnesses carry the highest
*absolute* impact and anchor Wave 2.

---

## 2. Task catalog

### T1 — Impossible-state telemetry: negative `ackGap` / `serverSeq` regression
**Half**: sync. **What**: `ackGap = serverSeq - msg.ack` going negative (a
client that has "seen the future" after an eviction restored a stale
`serverSeq`) is currently swallowed by the `ackGap > ACK_GAP_THRESHOLD`
check (`live-session.ts:934-943`). Log a wide-event field, count it, and
push a resync snapshot. Also count wake-time `serverSeq` restores that are
lower than the last broadcast value. **Why**: our one *known* impossible
state; decides whether Phase-26 selective mutation clearing (keyed on `seq`)
has a real defect. **Build**: 0.5 d. **Recurring**: $0 (fields on existing
events; fires only on the impossible path). **Impact**: 7.

### T2 — Invariant-violation and repair-rate counters in wide events
**Half**: sync (extends to audio via T8). **What**:
`validateAndRepairState` already runs after every mutation
(`live-session.ts:2630`) but reports via `console.warn`. Add
violation/repair counts and contexts to the session wide event so "how
often does state need repair, and is it rising?" is a query. A rising
repair rate is the Tailscale "warning fired" signal. **Build**: 1 d.
**Recurring**: $0 (fields). **Impact**: 6.

### T3 — Overlap + multi-client fuzz (extend `state-machine-fuzz.test.ts`)
**Half**: sync. **What**: the existing fuzz serializes ops and uses one
client, so overlap races — the WAL-Reset shape — are structurally out of
reach. Extend it: 2–4 real clients, ops launched *without* awaiting
completion, orderings explored by `fc.scheduler()` (fast-check is already a
dependency; the API is currently unused). Oracles, all generic: every acked
mutation visible in final state or provably superseded; invariants pass;
canonical hashes agree across all clients and server at quiescence;
`serverSeq` never regresses. Targets the known-risky overlaps first:
mutation during `saveToKV`, REST PUT racing a WS mutation, evict
mid-persist, mutations during snapshot push. **Build**: 4 d (quiescence
detection and the superseded-write oracle are the hard parts).
**Recurring**: $0 (CI only). **Impact**: 9 — highest absolute, with T4.

### T4 — Playback × mutation race lane (audio scheduler under virtual time)
**Half**: musical. **What**: the audio equivalent of write-during-checkpoint
is a remote mutation landing while the lookahead scheduler (25 ms timer,
100 ms window, `audio/scheduler.ts`) has notes in flight: tempo change
mid-window, `stepCount` change mid-loop, instrument swap mid-note, track
delete with a tied note sounding, transport stop/start churn,
suspend/resume. No test today races these against active playback; the
lesson corpus (sampled-instrument race, Tone.js time conversion, wake-path
bugs) says this space is rich. Harness: real scheduler + engine behind a
virtual clock seam, `fc.scheduler()` orderings, oracles: every expected
trigger fires exactly once (conservation), nothing scheduled in the past,
voices bounded, timers clean after stop (extends
`playback-state-debug.ts`'s three checks). **Build**: 5 d (clock seam is
most of it). **Recurring**: $0 (CI only). **Impact**: 9 — this race runs in
*every multiplayer session*, unlike evictions; it is the product's audible
correctness.

### T5 — Musical conservation oracles on deterministic renders
**Half**: musical. **What**: build on the existing offline-render infra
(`src/test/session-render.ts`, `session-render.render.test.ts`, onset
detection already cross-browser-hardened): property-based patterns
(polyrhythms 3–128, swing, ties, parameter locks) rendered through
`OfflineAudioContext`, asserting rendered onset count == scheduled trigger
count, no NaN/unexpected silence/clipping. Add pure-function musical
properties in the same task: MIDI export round-trip, scale-lock closure
(locked grid never emits out-of-scale pitch), polyrhythm cycle math.
Slots into the sound-quality lane (`specs/SOUND-QUALITY-PARITY-PLAN.md`)
rather than a new lane. **Build**: 2.5 d. **Recurring**: $0 (CI compute,
bounded). **Impact**: 6.

### T6 — Voice/node ledger invariants in the audio engine
**Half**: musical. **What**: deepen `playback-state-debug.ts` from three
lifecycle checks to conservation ledgers: voices created = released +
stolen + active (engine already exposes `activeVoices` diagnostics); Tone
node created/disposed accounting (the leak class from LESSONS-LEARNED);
never-schedule-in-past and NaN-param guards at the `scheduleNote` boundary.
Always-on in tests and dev; behind `?debug=1` in production (client-side —
$0 server cost until T8 reports it). **Build**: 2.5 d. **Recurring**: $0.
**Impact**: 6. Feeds T8's counters.

### T7 — Sampled DO→KV convergence audit
**Half**: sync. **What**: KV is the read path users actually hit (REST,
published sessions) and Lesson 2 documents real divergence — yet nothing
ever verifies the copy. After a KV-writing event settles (create, REST
PUT/PATCH, last-disconnect flush — the DO is already awake), sampled
read-back + canonical-hash compare + wide-event field on mismatch.
Never alarm-driven, adds zero KV writes. **Build**: 1.5 d. **Recurring**:
~$0 — at 10% sampling and current scale, ≈6k KV reads/day ≈ 180k/mo, deep
inside the 10M free tier; ~$2.50/mo at 100× scale, capped by the sampling
knob. **Impact**: 6.

### T8 — Client audio-health beacon
**Half**: musical (the production-money task). **What**: production audio
failure is invisible today — no client telemetry exists (verified: no
beacon, no telemetry endpoint). On session end, `navigator.sendBeacon` a
sampled (default 10%) counter payload — voice steals, scheduler overruns
(loop latency > lookahead), AudioContext state flaps, decode failures, T6
ledger violations, drift stats — logged server-side as **one** wide event.
v1 can ship on existing diagnostics (`engine.getDiagnostics()`,
`playback-state-debug` violations); T6 deepens it. **Build**: 2.5 d.
**Recurring**: at current scale ≈1k beacons/day ≈ 30k requests + 30k log
events/mo — inside included quotas, effectively $0; ~$0.90/mo at 100×;
worst case capped by the sampling knob. **Impact**: 7 — largest single
blind-spot reduction on the musical half.

### T9 — Nightly fresh-seed soak + seed promotion
**Half**: both. **What**: the fixed 10 seeds in `state-machine-fuzz`
explore nothing new after their first run. Add a scheduled CI job running
the fuzz lanes (existing today; T3/T4 join as they land) with fresh random
seeds for a bounded wall-time budget; any failing seed is promoted into the
fixed regression set with its `seed=X op#N` tag. This is the Antithesis
economics — continuous exploration — at $0 vendor cost. **Build**: 1 d.
**Recurring**: $0 (CI). **Impact**: 6, compounding.

### T10 — Validate the harnesses against historical bugs
**Half**: both. **What**: a schedule explorer that has never re-found a
known real bug is unproven tooling. Resurrect pre-fix commits of documented
bugs (Lessons 2, 5, 14, 40 on the sync half; the sampled-instrument
preload race on the musical half), run T3/T4 against them, record the kill
list in the lessons doc. Calibrates oracle strength; Antithesis proved
itself on one 16-year bug, we have a corpus. **Build**: 2.5 d.
**Recurring**: $0. **Impact**: 5 (meta, but decides how much to trust
everything above). Sequenced after T3/T4.

### T11 — Storage/KV fault-injection seam
**Half**: sync. **What**: the server-side lanes have lifecycle events but
no *failure* vocabulary. A thin facade over `ctx.storage`/KV lets T3
schedules include `storage.put` rejection and KV 429s — the exact class of
the real quota incident, where saves failed silently. Consistent with the
`specs/TESTING.md` "narrowest controllable seam" doctrine, but it touches
persistence paths, so it costs review care. **Build**: 3 d. **Recurring**:
$0. **Impact**: 5.

### T12 — Paved-path deviation inventory
**Half**: both. **What**: a living section in
`docs/STORAGE-ARCHITECTURE.md` (plus an audio counterpart note): every
place we deviate from the platform's standard path — dual storage with
debounce, `serverSeq` durability split, hibernation wake reloads,
auto-repair-on-violation, alarm bookkeeping, and on the musical side
16-voice stealing, custom lookahead, Tone.js/Web Audio mixing — each entry
pointing at its test and its near-miss counter. Tailscale's one-line
lesson operationalized. **Build**: 0.5 d. **Recurring**: $0. **Impact**: 3
directly, but it targets every other task.

### Deferred
- **Mutation journal for replay** — the only proposal whose recurring cost
  scales *per mutation* (~doubles DO row writes at ~$1/M, now billed).
  Forensic value only until an incident demands it; revisit then, behind a
  per-session debug flag.
- **Buying Antithesis (or similar)** — its remaining edge over the above is
  exploring *inside* the platform (real eviction semantics, Cloudflare's
  SQLite, network), which is mostly Cloudflare's job. Priced and shaped for
  infra companies; revisit only if we ever run our own stateful backend.
- **Anything alarm-driven** — see design rule 1.

---

## 3. Stack rank (impact ÷ cost)

| Rank | Task | Half | Impact | Build | Recurring $/mo (current → 100×) | Ratio |
|---|---|---|---|---|---|---|
| 1 | T1 impossible-state telemetry (`ackGap`/seq) | sync | 7 | 0.5 d | $0 → $0 | 14.0 |
| 2 | T2 invariant/repair-rate counters | sync | 6 | 1 d | $0 → $0 | 6.0 |
| 3 | T9 nightly fresh-seed soak + promotion | both | 6 | 1 d | $0 (CI) | 6.0 |
| 4 | T12 deviation inventory | both | 3 | 0.5 d | $0 | 6.0 |
| 5 | T7 sampled DO→KV convergence audit | sync | 6 | 1.5 d | ~$0 → ~$2.50 | 4.0 |
| 6 | T8 client audio-health beacon | musical | 7 | 2.5 d | ~$0 → ~$0.90 | 2.8 |
| 7 | T6 voice/node ledger invariants | musical | 6 | 2.5 d | $0 | 2.4 |
| 8 | T5 musical conservation oracles | musical | 6 | 2.5 d | $0 (CI) | 2.4 |
| 9 | T3 overlap + multi-client fuzz | sync | 9 | 4 d | $0 (CI) | 2.25 |
| 10 | T10 historical-bug validation | both | 5 | 2.5 d | $0 | 2.0 |
| 11 | T4 playback × mutation race lane | musical | 9 | 5 d | $0 (CI) | 1.8 |
| 12 | T11 fault-injection seam | sync | 5 | 3 d | $0 | 1.7 |
| — | Mutation journal | sync | 3 | 2 d | scales per mutation | deferred |

Total recurring production cost of the entire plan at current scale:
**≈ $0/month** (everything rides free tiers, included quotas, existing
events, and CI). The plan's real cost is ~26 dev-days of build time, and
the two most expensive builds (T3, T4) are also the two highest-impact
items.

## 4. Sequencing

Ratio order front-loads sensors; dependency order tempers it:

- **Wave 1 — sensors (~4.5 d)**: T1, T2, T9, T12, T7. Production starts
  reporting near-misses immediately; the soak starts accumulating schedule
  coverage on the fuzz we already have.
- **Wave 2 — the backbone (~11.5 d)**: T3, then T4, then T10 to validate
  both against the historical corpus. Highest absolute impact in the plan.
- **Wave 3 — depth (~8 d)**: T6 → T8 (beacon gains ledger counters), T5,
  T11.

Every wave leaves the system strictly more observable or more explored;
no task depends on a deferred item.
