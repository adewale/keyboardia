# Test Placement Analysis — are we testing things in the right places?

> **Status: items 1-4 of the recommended order are implemented.** Numbers in the
> tables below are the *before* state that motivated the work; the outcome is
> recorded in "What changed" at the end.

A tier-integrity review (step 4) and invariant-placement review (step 7) of the
[testing-best-practices](https://github.com/adewale/testing-best-practices)
framework. The companion to `TEST-AUDIT-2026-07.md`, which asked whether tests
*work*; this asks whether they are in the right *place*.

Measured after main's "remove-test-theatre" merge, so the numbers reflect the
current tree.

## The shape today

| Tier | Files | Tests | Wall clock | Per test | Needs |
|---|---|---|---|---|---|
| `src/**` co-located unit | 165 | 2,941 | ~41s (whole unit run) | ~9ms | node/jsdom |
| `test/unit` | 7 | 152 | (same run) | ~9ms | node |
| `test/integration` | 17 | 270 | 25s | ~93ms | Workers pool |
| `test/staging` | 5 | 101 | not in CI | — | live server |
| `test/benchmarks` | 1 | 9 | not in CI | — | node |
| `e2e` | 37 | 282 | ~25min | ~5,900ms | browser + server |

By count the pyramid is fine: roughly **11 : 1 : 1** unit : integration : e2e.

By cost it is not. E2E is **~650× more expensive per test than unit** and
**~63× integration**, and accounts for the overwhelming majority of the suite's
wall clock. That ratio is the lens for everything below: a test only belongs in
e2e if it verifies something the cheaper tiers *cannot*.

---

## Finding 1 — Track reorder is verified 88 times through drag-and-drop, and the unit replacement already exists

**The single biggest misplacement in the suite.**

Five spec files — `track-reorder`, `-comprehensive`, `-precision`,
`-single-track-drag`, `-bug-fixes` — hold **88 e2e tests**. Sampling what they
assert:

```
should reorder first track to last position
should reorder middle track up
should swap adjacent tracks (down)
should NOT reorder when dragging to same position
should handle 8 tracks (max) correctly
drag index 0 to index 2 - first to third position
```

That is the input/output matrix of `reorder_tracks`, which is a **pure 12-line
array splice** (`src/shared/state-mutations.ts:318`) with no DOM involvement:

```ts
const fromIndex = state.tracks.findIndex(t => t.id === trackId);
if (fromIndex === -1 || toIndex < 0 || toIndex >= state.tracks.length || fromIndex === toIndex) return state;
const tracks = [...state.tracks];
const [moved] = tracks.splice(fromIndex, 1);
tracks.splice(toIndex, 0, moved);
```

**The unit coverage is already written.** `src/state/grid.test.ts` contains
describes named, verbatim:

```
describe('precise position validation (covers track-reorder-precision.spec.ts)')
describe('chained operations (covers track-reorder-comprehensive.spec.ts)')
```

Someone did the migration from the unit side, named the e2e files they were
replacing, and never deleted them. The duplication is not accidental — it is a
half-finished piece of work.

**The cost is not theoretical.** These 88 tests are the *entire* flake cluster:
in a real-backend run, 59 of 69 failures came from this group, all as uniform
40.0s timeouts — the drag interaction failing to complete, not the app computing
a wrong order. They are simultaneously the most expensive, most fragile, and
most redundant tests in the suite.

**The repo already has the convention for fixing this.** Eleven e2e tests have
already been deleted in favour of a pointer, across six spec files:

```ts
// NOTE: "Space/Enter activates focused elements" test was removed.
// Covered by src/components/keyboard-handlers.test.ts:
// - E-001: Space key on step should dispatch toggle
```

### What should stay in e2e

Reorder does have genuinely browser-level behaviour, and it should keep a small
spec — roughly 8-10 tests, not 88:

- a drag handle exists and is the only drag affordance (`should not trigger drag from non-handle areas`)
- `drag-target` class appears on hover and clears on leave/cancel
- no ghost/duplicate tracks from duplicate HTML5 DnD events
- exactly one reorder per drag operation
- order persists across a page reload

Everything that asserts *which index ends up where* belongs in `grid.test.ts`,
where it runs in microseconds and cannot flake.

---

## Finding 2 — 9 of 17 "integration" tests never cross an integration boundary

| Touches real Workers runtime (`cloudflare:test`) | Does not |
|---|---|
| `collaboration-contract` (10) | `canonical-hash-completeness` (20) |
| `eviction-recovery` (20) | `connection-storm` (16) |
| `live-session` (31) | `message-types` (11) |
| `mcp-journeys` (4) | `mobile-ui-functionality` (19) |
| `published-session-ux` (6) | `mutation-tracking` (13) |
| `social-preview` (17) | `pattern-ops-sync` (22) |
| `state-hash-parity` (5) | `shared-types` (9) |
| `state-machine-fuzz` (6) | `sync-health` (25) |
| | `validators` (36) |

The right-hand column — 171 tests — imports client modules directly and asserts
on pure functions. They are unit tests that pay Workers-pool startup for no
boundary crossing, and their location implies a guarantee (that the real Durable
Object honours this) which they do not provide.

This is **improved** from the pre-merge state (12 of 19), because main's
`collaboration-contract.test.ts` replaced several mock-based files with real-DO
ones. The remaining nine should move to `test/unit` or co-locate in `src/`.

Note `validators.test.ts` (36 tests) is the largest: server-side input
validation is genuinely worth testing against the real runtime, so this one may
be better *upgraded* to use `cloudflare:test` than moved down.

---

## Finding 3 — `test/unit` vs `src/**` co-location has no stated rule

165 test files sit next to their subject in `src/`; 7 live in `test/unit`. There
is no documented criterion, and at least one is plainly on the wrong side:
`test/unit/useLongPress.test.ts` tests a hook whose siblings
(`useKeyboard`, `useStableCallback`, `useMultiplayer`, `callback-stability`) all
have co-located tests in `src/hooks/`.

The others in `test/unit` (`golden-mutations`, `reducer-mutation-equivalence`,
`sync-classification`, `sync-layer-coverage`, `mutation-types`, `ghost-avatar`)
share a real trait — they test *cross-module agreement* rather than one module,
so no single `src/` directory is their natural home. That is a defensible rule;
it just is not written down anywhere. Write it down, and move `useLongPress`.

---

## Finding 4 — Gaps: production modules with no test at any tier

Ordered by risk, not size.

| Module | Lines | Why it matters |
|---|---|---|
| `src/sync/MessageQueue.ts` | 203 | **Highest-value gap.** A bounded queue (`maxSize: 100, maxAge: 30000`) that `multiplayer.ts:436` puts every outbound mutation through while disconnected. Eviction here means silently dropped edits — data loss in a multiplayer app — and nothing tests it. |
| `src/shared/state-adapters.ts` | 164 | Converts between client and wire state; sits on the sync path. |
| `src/audio/slicer.ts` | 184 | Pure-ish audio logic; cheap to unit test. |
| `src/components/PianoRoll.tsx` | 284 | Whole feature surface, no test. |
| `src/components/MixerPanel.tsx` | 172 | " |
| `src/components/LoopRuler.tsx` | 228 | " |
| `src/components/Recorder.tsx` | 311 | " |

Lower priority, and arguably correct to leave — step 7 of the framework says
test investment should match artifact lifetime, and debug tooling is the most
disposable code in the tree: `log-store.ts` (560), `debug-tracer.ts` (505),
`debug-coordinator.ts` (361), `DebugOverlay.tsx` (283), `DebugContext.tsx` (314).

`src/data/example-sessions.ts` (1,101 lines) is data, not logic — a schema
validation test would be worth more than unit tests.

---

## Finding 5 — Correctly placed; do not move these

Worth stating explicitly, because a naive "push everything down" reading of
Finding 1 would damage them:

- **`e2e/drag-to-paint.spec.ts`** (18 tests, the densest browser usage in the suite). The repo documents precisely why this cannot move down: jsdom does not implement pointer capture, so `fireEvent` passes on code that fails in a real browser. This is the textbook case *for* e2e.
- **`e2e/visual.spec.ts`** — screenshot comparison has no cheaper tier.
- **`e2e/multiplayer.spec.ts`** — two independent browser contexts over a real WebSocket. Cannot be faked.
- **`e2e/session-api-contract.spec.ts`** — deliberately runs the *same* contract against whichever backend Playwright starts, mock or real Worker. That is mock-fidelity testing at the HTTP boundary, and it is a genuinely good design.
- **`src/audio/mock-fidelity.test.ts`** — asserts every method the unit-test mocks stub actually exists on the real class. Cheap insurance against mock drift, correctly at unit level.
- **`test/integration/eviction-recovery.test.ts`** — hibernation, cold wake, KV flush against a real Durable Object. Exactly what the integration tier is for.

---

## Finding 6 — main's cleanup did not leave holes

Main's merge deleted 11 test files, which looked alarming. Checked each subject
for surviving coverage:

| Deleted | Subject still covered by |
|---|---|
| `volume-plock.test.ts` | `sync-types`, `VelocityLane`, `midiExport.fidelity`, `scheduler-velocity-routing` |
| `engine-sampled.test.ts` | `engine-legacy-paths.characterization`, `engine-sampled-passthrough` |
| `mutation-sequencing-integration.test.ts` | `src/sync/mutation-sequencing.test.ts` |
| `mock-durable-object.test.ts` (2,726 lines) | `collaboration-contract`, `live-session` (real DO) |
| `multiplayer-sync.test.ts` | (this was the TEST-05 theatre — correctly deleted) |

The pattern was consistently *mock-based tests replaced by real-runtime contract
tests*. That is a tier upgrade, not a coverage loss.

---

## Recommended order

| # | Action | Effort | Payoff |
|---|---|---|---|
| 1 | Collapse the 88 reorder e2e tests to ~8-10 browser-specific ones, pointing at `grid.test.ts` per the existing convention | ~half day | Removes the suite's entire flake cluster and most of its wall clock |
| 2 | Test `MessageQueue` | ~1-2h | Closes the highest-risk gap; pure class, trivial to test |
| 3 | Move the 9 non-boundary files out of `test/integration` (or upgrade `validators` to the real runtime) | ~2h, mechanical | Honest tiers; faster integration run |
| 4 | Write down the `test/unit` vs co-located rule; move `useLongPress.test.ts` | ~15min | Stops the split drifting further |
| 5 | Cover `state-adapters` and `slicer` | ~2h | Sync-path and audio-logic gaps |
| 6 | Leave the debug tooling untested, deliberately, and say so in `specs/TESTING.md` | ~10min | Turns an implicit gap into a stated decision |

Item 1 is worth more than the rest combined: it is the only change that makes
the expensive tier smaller *and* more trustworthy at the same time.

### One caution on item 1

The 59 drag timeouts were observed against a substituted open-source Chromium.
Before deleting anything, confirm on CI's official Playwright build whether those
drags pass there. If they do, the reorder e2e tests are merely redundant and
slow. If they do not, they are also broken, and the deletion is even clearer —
but the distinction should be established from evidence, not assumed.


---

## What changed

Items 1-4 of the recommended order are done.

| Tier | Before | After |
|---|---|---|
| unit (`src/**` + `test/unit`) | 3,093 tests | 4,866 tests (+171 moved in, +21 new) |
| `test/integration` | 17 files / 270 tests / 25.1s | **8 files / 99 tests / 16.8s** — every one crosses the real Workers boundary |
| `e2e` | 282 tests | **245 tests** |
| e2e reorder specs | 5 files / 88 tests | 4 files / 46 tests, 43 passing in ~1 min |

### 1. Reorder e2e collapsed — 88 → 46

`track-reorder-precision.spec.ts` deleted outright (26 tests): the whole file was
a from→to index matrix, and `grid.test.ts:2112` had been written to replace it,
naming the file, without the file ever being removed.

Three whole describes removed from `-comprehensive` (Basic Reorder Operations,
Same Position Edge Cases, Rapid Consecutive Drags = 12 tests) and two from
`-bug-fixes` (Two Track Scenarios, Maximum Tracks Scenario = 4 tests). Whole
describes rather than individual tests, so each removal is one coherent theme
and reviewable as a unit. A pointer comment in `track-reorder.spec.ts` records
what moved where.

**A correction to this document's own analysis:** the first draft classified the
`BUG 3: Stale targetTrackId` tests ("rapid drag should land on correct target",
"zigzag drag pattern") as redundant logic. They are not — they test stale
drag-event state, a genuine browser-event bug class. That whole describe stays.

**And a correction to the caution at the end of Finding 1:** the 59 drag
timeouts were *not* a broken interaction. Running the specs under the mock API
gives 20 passed / 0 failed in 38.5s. Drag-and-drop works; the timeouts were an
artifact of the real-backend run. So these tests were redundant and slow, not
broken — which weakens the case for deleting them, and is why the cut was made
conservatively (46 kept, not the ~37 first proposed).

### 2. `MessageQueue` covered — 21 tests

The highest-value gap is closed. The tests were sabotage-verified rather than
assumed: six independent mutations of the class were each caught.

| Sabotage | Tests failed |
|---|---|
| evict high priority instead of protecting it | 2 |
| never expire stale messages | 3 |
| ignore priority when replaying | 3 |
| forget to clear the queue after replay | 2 |
| queue time-sensitive messages anyway | 1 |
| send oversized messages | 1 |

One test documents a real data-loss path rather than papering over it: a queue
saturated with high-priority messages silently drops further ones. Not reachable
in a realistic session, but invisible if it ever becomes so.

### 3. Integration tier is honest — 9 files moved to `test/unit`

`canonical-hash-completeness`, `connection-storm`, `message-types`,
`mobile-ui-functionality`, `mutation-tracking`, `pattern-ops-sync`,
`shared-types`, `sync-health`, `validators`. All used identical `../../src/`
import depth, so the move needed no import rewrites. 8 of 8 remaining
integration files import `cloudflare:test`.

`validators.test.ts` (36 tests) is worth revisiting: server-side input validation
genuinely benefits from running against the real runtime, so it is a candidate
for *upgrading* back rather than staying in unit permanently. Moving it down was
the honest description of what it does today.

### 4. The rule is written down

`specs/TESTING.md` §5 now opens with "Where does a test go?" — a first-match-wins
table, the literal `cloudflare:test` criterion for the integration tier, the
capability-not-realism criterion for e2e, and the pointer-comment convention.
`useLongPress.test.ts` moved from `test/unit/` to `src/hooks/` alongside every
other hook test.

### Still open

Items 5 and 6: coverage for `state-adapters.ts` and `slicer.ts`, and stating the
debug-tooling decision (now done as part of item 4's rule).


---

## Item 5 — the `validators.ts` upgrade, and what it found

The open question from item 3 was whether `validators.test.ts` (36 tests) should
be *upgraded* to run against the real Workers runtime rather than sitting in
`test/unit`. Doing it produced a different answer than expected, and a
production bug.

### Moving the tests to the real runtime would have been pointless

The 36 tests call pure functions: `validators.toggleStep({...}, mockState)` →
`{valid, sanitized, error}`. Running those inside a Workers runtime changes
nothing — `Math.min` behaves identically there. The tier was never the problem.

### `src/worker/validators.ts` is unreachable from production

Nothing imports it except its own two test suites (36 unit + 28 property = **64
tests**). It does not appear in the build output. The live server validates
through an entirely separate mechanism: inline `validate` callbacks on
`createGlobalMutationHandler` in `live-session.ts`, plus `./validation` and
`../shared/validation`.

This is precisely the failure mode `test/unit/sync-layer-coverage.test.ts` was
written after — *"listed in SYNCED_ACTIONS but never wired up ... so the bug
shipped"* — except here it is 345 lines of validation logic and 64 tests
guarding a door that is not in the wall.

### The bug that gap was hiding

`validators.ts` has tests named "rejects non-numeric tempo" and "rejects NaN
tempo". The live path only clamped:

```ts
validate: (msg) => ({ ...msg, tempo: clamp(msg.tempo, MIN_TEMPO, MAX_TEMPO) }),
```

`clamp` is `Math.max(min, Math.min(max, value))` — range control, not type
control. `Math.min(180, 'fast')` is `NaN`, and `Math.max(60, NaN)` is `NaN`. So:

> A client sending `{type: 'set_tempo', tempo: 'fast'}` over the WebSocket set
> the shared session's tempo to NaN, which was persisted to Durable Object
> storage and broadcast to every collaborator.

Confirmed against a real Durable Object, not reasoned about: the stored tempo
came back as `null` (JSON's rendering of NaN). `set_swing` with `null` survived
by luck — `null` coerces to `0`, which is in range — so the exposure was
non-numeric strings, `undefined`, and objects.

### The fix

`GlobalMutationConfig.validate` could only transform (`(msg) => TMsg`), with no
way to say "discard this message". It now returns `TMsg | null`, and the handler
returns early on `null` — applying nothing, persisting nothing, broadcasting
nothing. Both `handleSetTempo` and `handleSetSwing` guard with
`Number.isFinite` before clamping.

Sabotage-verified: removing the tempo guard reproduces `tempo became null`
exactly.

### What the upgrade actually produced

`test/integration/validator-enforcement.test.ts` — 7 tests that never import a
validator. They open a real WebSocket to a real Durable Object, send hostile
input, and assert on what is broadcast and what `/debug` reports as stored,
cross-checked against the server's own `validateStateInvariants`. Because they
test the behaviour rather than the module, they survive whichever way the
`validators.ts` decision goes.

### Still open — a decision, not a task

`src/worker/validators.ts` and its 64 tests are annotated, not deleted. Either
wire the module into `live-session.ts` (making those 64 tests meaningful), or
delete all three files. Deleting 345 lines of production code and 64 tests is a
call for someone with product context, so it is flagged rather than made.


---

## Where `validators.ts` came from, and whether the real path is covered

Two follow-up questions, answered from the history and the code.

### Where and why it exists

`git log --follow` gives four commits; the one that created it (`58bb046`,
2026-01-14) is a 726-file, 218,000-line bulk import whose message is about
ESLint warnings in unrelated files. So the commit says nothing — but the file's
own header does:

```
REFACTOR-06: Consolidated Validation Module
All message validation logic in one place with consistent interface.
Each validator returns { valid, sanitized?, error? }
```

It is a **consolidation refactor whose migration never happened.** The module
was written; `live-session.ts` was never changed to call it; the inline
`validate` callbacks stayed the production path. `REFACTOR-06` appears nowhere
else in the repository — no spec, no plan, no roadmap entry. The task ID is
orphaned, which is consistent with a refactor abandoned partway.

**There is direct precedent for how this project resolves that.** Commit
`ba99b4d` (2026-03-08):

> `refactor: Remove dead note-player.ts module and test`
>
> Strategy/Chain pattern for note dispatch that was never wired in. The
> scheduler's `switch(instrumentType)` with direct audioEngine calls has been
> the production path since day one.

Identical shape — a consolidation module written, never wired, original inline
implementation still in production — and the decision then was to delete it.
`validators.ts` is the same case, missed by that sweep.

### Is the real path covered?

Now, yes — but writing the comparison found two more instances of the same bug.

| `validators.ts` | Real handler | Real enforcement | Status |
|---|---|---|---|
| `toggleStep` | `handleToggleStep:1247` | `isValidNumberInRange` + `Number.isInteger` + bounds | already correct |
| `setParameterLock` | `handleSetParameterLock:1362` | `isValidNumberInRange` + `Number.isInteger` + `validateParameterLock` | already correct |
| `setEffects` | `handleSetEffects:2098` | explicit `typeof !== 'number'` per field | already correct |
| `setFMParams` | `handleSetFMParams:2211` | explicit `typeof !== 'number'` per field | already correct |
| `setTempo` | `handleSetTempo:1297` | bare `clamp` | **was vulnerable — fixed** |
| `setSwing` | `handleSetSwing:1315` | bare `clamp` | **was vulnerable — fixed** |
| `setTrackVolume` | `handleSetTrackVolume:2006` | bare `clamp` | **was vulnerable — fixed** |
| `setTrackTranspose` | `handleSetTrackTranspose:2021` | `Math.round(clamp(...))` | **was vulnerable — fixed** |

The split is exactly along one line: handlers that check types explicitly were
fine; handlers that relied on `clamp` alone were not. `clamp` is range control,
never type control.

`Math.round` does not rescue it either — `Math.round(NaN)` is `NaN`, so
transpose was vulnerable despite looking more defensive than the others.

An asymmetry worth noting: `createTrackMutationHandler` **already** supported
`validate` returning `null` to reject ("return null to reject" in its type), and
its callers simply never used it. `createGlobalMutationHandler` did not support
rejection at all. So volume and transpose could have been fixed without touching
any factory; tempo and swing needed the capability added.

### Coverage now

`test/integration/validator-enforcement.test.ts` — 9 tests against a real
Durable Object, importing no validator: range clamping (tempo, swing), type
hostility (tempo, swing, volume, transpose), and referential validity (unknown
track, out-of-range step). They assert on what is broadcast, what `/debug`
reports as stored, and the server's own `validateStateInvariants`.

The `validators.ts` decision is unchanged and still open — but the argument for
deletion is now stronger, because the real path is covered on its own terms by
tests that do not depend on that module existing.


---

## Resolution: `validators.ts` deleted

Deleted, following the `note-player.ts` precedent.

| Removed | |
|---|---|
| `src/worker/validators.ts` | 345 lines, unreachable from production |
| `test/unit/validators.test.ts` | 36 tests |
| `VA-002e: setTempo validator is idempotent` | 1 test |

**The property-test file was not deleted, and that mattered.** Despite being
named `validators.property.test.ts`, only 1 of its 28 tests touched
`validators`. The other 27 exercise `./invariants` — `clamp`,
`validateParameterLock`, `validateStateInvariants`, `repairStateInvariants`,
`validateCursorPosition` — all live code reached from `live-session.ts`.
Deleting the file by its name would have silently dropped 27 tests covering
code that does run. It was renamed to `invariants-validation.property.test.ts`
instead (`invariants.property.test.ts` was already taken by the EF/SN/LR
debug-invariant properties), and the sibling file's cross-reference to the old
name was updated.

Clamp idempotence — the only property VA-002e covered — is still tested, against
`clamp` directly, which is the function the live handlers actually call.

Checked afterwards: every remaining export of `invariants.ts` still has a
production consumer, so the deletion left no second layer of dead code.

Verified: build succeeds, tsc clean, lint 0 errors, 4,829 unit tests
(−37 exactly as predicted), 108 integration.

### What replaced it

Nothing, deliberately. `validators.ts` was a consolidation layer that never got
consumed; the live handlers already validate inline, and four of the eight were
correct all along. The three that were not are now fixed and pinned by
`test/integration/validator-enforcement.test.ts`, which tests the server's
behaviour rather than any particular module — so it would have caught this
regardless of which implementation was in place, and will keep working if the
handlers are ever refactored again.


---

## The near-duplicate filenames — cause, overlap, lesson

Renaming the surviving property file collided with an existing
`invariants.property.test.ts`. `git mv` refused rather than clobbering it, which
was worth following up: the two names were not just similar, they were
**inverted**.

### What each file actually tested

| File | Imported | Exercised |
|---|---|---|
| `invariants.property.test.ts` | `./validation` — **never `./invariants`** | `validateSessionName` ×14, `validateSessionState` ×10, `isBodySizeValid` ×6, `isValidUUID` ×4 |
| `validators.property.test.ts` | `./invariants` | `validateParameterLock` ×16, `isValidNumberInRange` ×8, `clamp` ×6, `validateStateInvariants` ×4 |

The file named *invariants* tested `validation.ts`. The file named *validators*
tested `invariants.ts`. Neither name matched its import.

### Why it happened

Four modules in the same neighbourhood, all meaning roughly "check the values":

```
src/worker/validation.ts    isValidUUID, validateSessionState, validateSessionName, isBodySizeValid
src/worker/invariants.ts    clamp, isValidNumberInRange, validateParameterLock, validateStateInvariants
src/worker/validators.ts    (deleted — the consolidation that never landed)
src/shared/validation.ts    sanitize*, clamp*, isValidNumber, isValidStepIndex
```

Test files were named for the **concept** they were about rather than the
**module they import** — and with four near-synonymous concepts, the labels
detached from the code and drifted.

The second cause is visible in the old header of `invariants.property.test.ts`:

> "Tests invariants from invariants.ts, validation.ts, and state-mutations.ts
> **that weren't covered by validators.property.test.ts**."

Its scope was defined **by negation** — "whatever the other file doesn't do".
That boundary is invisible from inside the file, unenforceable by any tool, and
rots the moment either file changes. It rotted completely: the file stopped
importing `invariants.ts` at all, and then the file it was defined against was
deleted, leaving the header pointing at nothing.

### Is there actual duplicated coverage?

Between those two files, **none** — zero shared functions. They were cleanly
disjoint, just mislabelled. Renaming was sufficient; no tests were merged or
dropped.

There is one genuine overlap next door, and it is legitimate:
`validation.test.ts` (29 tests, example-based) and the newly-renamed
`validation.property.test.ts` (34 tests, property-based) both cover
`validateSessionState`, `validateSessionName` and `isValidUUID`. Examples plus
properties on one module is a good pairing — it was only ever a naming problem
that this was impossible to see.

### The module-level duplication behind it

Chasing the names surfaced dead and duplicated production code:

| Symbol | Where | Production users |
|---|---|---|
| `clampTempo` | `shared/validation.ts` | **0** |
| `clampSwing` | `shared/validation.ts` | **0** |
| `clampTranspose` | `shared/validation.ts` | **0** |
| `clampVolume` | `shared/validation.ts` | 3 |
| `isValidNumber` | `shared/validation.ts` | 0 — until now |

`isValidNumber` is `typeof value === 'number' && Number.isFinite(value)` — the
exact guard I had just hand-written inline four times in `live-session.ts` while
fixing the NaN bug. The helper already existed and nothing used it. The handlers
now call it.

`clampTempo`/`clampSwing`/`clampTranspose` remain unused: `live-session.ts`
calls the generic `clamp(v, MIN_TEMPO, MAX_TEMPO)` from `./invariants` instead.
Left alone rather than deleted — that is a fifth thread and this one is long
enough — but it is the same pattern as `validators.ts`: a tidier API written
alongside the original, never adopted.

### Final naming

| File | Module under test |
|---|---|
| `validation.test.ts` | `validation.ts`, by example |
| `validation.property.test.ts` | `validation.ts`, by property |
| `invariants.property.test.ts` | `invariants.ts`, by property |

### The rule this produced

Added to `specs/TESTING.md`:

> **Name a test file after the module it imports, not the concept it covers.**
> If `foo.test.ts` does not import `foo`, one of the two names is wrong.
>
> **Never define a test file's scope by negation.** "Covers what X doesn't" is
> invisible, unenforceable, and stale the moment X changes.


---

## Is the naming problem happening elsewhere? Yes — and worse

`validators.ts` was not a one-off. Scanning all 211 test files for "does this
file import the module its name claims" found **17 findings in three kinds**,
now checked by `app/scripts/check-test-subject-links.ts`.

### REIMPL (5) — the dangerous kind

The test is named for a module, does not import it, and **defines its own copy
of that module's logic instead**. Every copy has drifted from its original.

| Test | Copies | Original |
|---|---|---|
| `scheduler.test.ts` (28 tests) | `getTrackStep`, `shouldTrackTrigger` | inline at `scheduler.ts:463` |
| `TrackRow.test.ts` (17) | `isMelodicInstrument` | `TrackRow.tsx:35` |
| `VelocityLane.test.ts` (38) | `getVelocityLevel`, `calculateVelocityFromY`, +2 | `VelocityLane.tsx:33` |
| `og-image.test.tsx` | `condenseSteps` | `og-image.tsx:67` |
| `audio-debug.test.ts` | `parseInstrumentId` | `instrument-types.ts:54` — **exported** |

Two concrete drifts:

```
scheduler.ts:463   globalStep % (track.stepCount ?? DEFAULT_STEP_COUNT)   + bounds check
test copy          globalStep % trackStepCount                            (neither)

TrackRow.tsx:35    'sampled:' -> melodic UNLESS in the drums category
test copy          'sampled:' -> return true
```

The consequence is sharper than "the test might be wrong". `TrackRow.test.ts`
has a test called *"drum samples should NOT show keyboard view"* which only
exercises bare (`kick`) and `tone:`-prefixed ids — never `sampled:` drums.
It cannot: **the copy has no such branch to exercise.** The test's reach is
bounded by the copy, not by production, so production's sampled-drum logic has
no coverage here and the gap is exactly the shape of the divergence.

**Why the copies exist** is visible in the table: four of the five originals are
module-private, not exported. Someone wanted to test private logic, could not
import it, and duplicated it. The exception is `parseInstrumentId`, which *is*
exported — that copy has no excuse at all.

The fix is to export the function (or lift it to a module) and import it. A
copy is not a test of anything but itself.

### ORPHAN (9) — the mild kind

Named for a module that exists, never imports it, no local reimplementation.
Several are legitimate black-box tests that should simply be renamed:
`live-session.test.ts` and `social-preview.test.ts` drive the real Worker
through `SELF.fetch` rather than importing, which is correct for the
integration tier. Others are genuinely misfiled: `TrackRow.test.ts` is mostly a
`sample-constants` test, `message-types.test.ts` imports `messages.ts`.

### DEAD (3) — shortlist, not verdict

Modules imported only by their own tests: `useStableCallback.ts`,
`mcp-evals.ts`, `identity.ts`. Same class as `validators.ts`. Flagged for a
human — `mcp-evals.ts` arrived days ago and is plausibly about to be wired up.

### The detector

`app/scripts/check-test-subject-links.ts`. Building it taught its own lesson
about heuristics: the first version reported 34 findings, of which half were
noise —

- `index.ts` barrels, `__fixtures__`, `src/test/` helpers are *correctly*
  test-only;
- `*.worker.ts` / `*.worklet.ts` are loaded by URL, never imported;
- `src/worker/mcp.ts` is reached through `await import('./mcp')`, and an
  import-only regex calls it dead.

After excluding those and matching dynamic imports, 34 → 17. It exits 0: the
findings are catalogued, not yet fixed, and a gate that fails on day one gets
disabled on day two.

---

## Closing state

Both checkers are now wired into the `lint` CI job (`validate:test-antipatterns`
gating, `validate:test-links` advisory) and documented in `specs/TESTING.md`.

| Finding | Was | Now |
|---|---|---|
| REIMPL — tests exercising a private copy of the logic they name | 5 | 0 |
| ORPHAN — tests naming a module they never import | 9 | 0 |
| DEAD — modules imported only by their own tests | 3 (after `validators.ts`) | 0 |
| Always-green patterns | 3 undiscovered | 0 |

### The three DEAD findings, resolved

Investigating them showed that "dead" covered three different situations, and
that deleting on the strength of the report would have been wrong in all three.

**`utils/identity.ts` was not dead — it was duplicated.** `live-session.ts`
carried a hand-copied version under the comment *"duplicated from
utils/identity.ts for worker"*: same 18 colours, same 73 animals, same hash.
Nothing imported the original, not even a test. The copies agreed — 0 mismatches
over 20,000 ids — but nothing enforced it, and both indices are `hash %
list.length`, so appending one animal to one list renames *every existing
player* on that side. Two people in a session would see different names for each
other, and a returning player would come back as somebody else.

Moved to `shared/identity.ts`, imported by the worker, 41 lines of duplication
removed from `live-session.ts`, and given its first tests (11, 6/6 sabotage
kills) — which now cover the code that ships rather than the copy that didn't.
This is `validators.ts` mirrored: there the tested module was unreachable; here
the tested module was unreachable *and* the reachable one was a copy of it.

**`mcp-evals.ts` was misclassified.** It is eval cases plus a pure scorer — test
support by nature, in the same category as `__fixtures__`, which the checker
already excludes. It has no runner and does not want one in production. The fix
was to the checker (`-evals.ts` is now excluded), not to the module.

**`useStableCallback.ts` was a bypassed abstraction.** Unused, while six
production sites hand-rolled the exact pattern it encapsulates — a `useRef` plus
a `useEffect` that copies a prop or a callback into it. Adopted at all six
(`useKeyboard`, `StepSequencer` ×4, `TrackDrawer`).

That adoption is a small correctness win, not just tidying: `useStableGetter`
updates the ref *during render*, while the hand-rolled version updated it in an
effect. The hand-rolled form left a window between render and effect flush in
which a keypress ran the previous render's handlers.

Worth recording why the abstraction was bypassed, since that is the reusable
lesson: adopting it required adding the stable getters to three dependency
arrays, because `react-hooks/exhaustive-deps` and the React compiler cannot see
that they never change. Hand-rolling a ref sidesteps that argument with the
linter entirely. An abstraction that costs more at the call site than the
pattern it replaces will keep losing, however good it is.

### Finding 4 gaps — closed

`MessageQueue.ts` (21 tests, sabotage-verified 6 ways), `state-adapters.ts`
(16 tests, 7/7 kills) and `slicer.ts` (9 tests, 4/4 kills) are covered. The
remaining Finding 4 entries are component surfaces (`PianoRoll`, `MixerPanel`,
`LoopRuler`, `Recorder`), which the tier rule in `specs/TESTING.md` puts in the
browser rather than jsdom, and the debug tooling that step 7 says to leave alone.

Two of the three closures changed production code, which is the argument for
having prioritised them by risk rather than by size:

- `state-adapters.ts` was silently dropping `GridState.focus` on every synced
  edit (see `docs/TEST-AUDIT-2026-07.md` §15).
- `slicer.ts` had four unreachable exports carrying two defects: a units bug
  (onset *seconds* assigned to a field named `startSample`, then divided by the
  sample rate again) and a dropped leading slice. They are repaired and tested
  rather than removed. This is the linkage family at *export* granularity: the
  DEAD check asks "does anything import this module", and a module can pass that
  question while most of its surface fails it. Worth knowing before trusting a
  green DEAD report — `detectTransients` kept `slicer.ts` off the list while the
  broken four sat behind it.

### The lesson that generalises

Every problem in this document is the same problem seen from a different angle:
**a test's name is a claim about what it covers, and nothing was checking the
claim.** `validators.property.test.ts` importing `./invariants`, five test files
copying the logic they were named for, a header defining its scope as another
file's complement, and 64 tests for a module that never ran — all of them
survive any amount of careful test *writing*, because the tests themselves were
fine. What was wrong was the wiring between test and subject, and that is
mechanically checkable, which is why it is now checked.
