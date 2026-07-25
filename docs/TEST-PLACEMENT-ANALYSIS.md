# Test Placement Analysis — are we testing things in the right places?

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
