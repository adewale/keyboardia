# Test Suite Audit — July 2026

Audit of the Keyboardia test suite against the anti-pattern catalogue and 7-step
quality framework in [adewale/testing-best-practices](https://github.com/adewale/testing-best-practices).

> **Status: Phases 1 and 2 are implemented**, plus the seeding work (§10) which
> was raised separately. Phase 3 (§8 weak properties, TEST-05 rewrite) and Phase
> 4 (hygiene) remain open. Each finding below carries its outcome inline.
> The remediation plan at the end has been updated to match.

## Scope and baseline

| Metric | Before | After |
|---|---|---|
| Test files | 250 (`src` 172, `e2e` 36, `test` 42) | 250 |
| Test LOC | 85,065 | — |
| Unit suite | 4,812 passing, 1 skipped, 190 files | 4,808 passing, 1 skipped (4 always-green tests deleted) |
| `expect()` calls | 8,381 | — |
| Weak sole assertions | 382 (4.6%) | unchanged (Phase 4) |
| Tests that cannot fail | 15 identified | 0 remaining |
| Runtime self-skips `test.skip(true, …)` | 34 | 0 |
| Sabotage kill rate, `sync-convergence` | 5 / 24 | 7 / 22 |
| Sabotage kill rate, whole suite | 133 / 4,812 | 135 / 4,808 |
| Unseeded `fc.assert` calls | 398 / 415 | 0 (global seed; see §10a for the `fc.sample` caveat) |
| Gating e2e specs in CI | 0 | 33 (`--grep-invert @visual`) |
| Mock-API e2e failures | 91 / ~189 executed | 2, both codec-environmental (see below) |
| Unit suite wall clock | 39.3s | 41.5s (+2.2s for the seed setup file) |

The suite is in good shape structurally — it already has property-based tests,
Stryker mutation testing, golden-master tests, and a mock-fidelity contract test
(`src/audio/mock-fidelity.test.ts`) that explicitly cites the mock-reality-drift
anti-pattern. The findings below are concentrated pockets, not systemic rot.

## Method

Beyond the catalogue's grep heuristics, correctness claims were verified by
**sabotage**: `applyMutation` in `src/shared/state-mutations.ts` — the reducer
every multiplayer mutation flows through — was neutered to `return state`
(ignoring every mutation), and the suite re-run.

```
Suite-wide:                      133 / 4,812 tests failed
sync-convergence.property.test:   5 / 24 tests failed  ← 19 survived
```

Most files that use `applyMutation` caught it (`golden-mutations`, `grid`,
`tempo-change`, `swing-control`, `copy-paste-range`, `reducer-mutation-equivalence`).
The convergence property suite — the file that owns the core correctness property
of a multiplayer app — did not. That single number drives the P0 list.

The sabotage patch was reverted; `git diff` is clean.

---

## P0 — Tests that cannot fail

### 1. Literal tautologies in `src/sync/sync-convergence.property.test.ts`

Four property tests, 2,500 property runs, comparing a value to itself.

| Line | Test | Assertion |
|---|---|---|
| 278 | SC-005a | `canonicalEqual(serverFinalState, serverFinalState)` — same variable, both sides |
| 283 | SC-005a | `canonicalEqual(snapshotState, serverFinalState)` — `snapshotState` is a second copy of the *same expression* `mutations.reduce(applyMutation, initialState)` |
| 311 | SC-005b | `canonicalEqual(serverState, serverState)` — the test's **only** assertion |
| 339 | SC-005c | `canonicalEqual(clientState, serverState)` — both are the identical expression |
| 97 | SC-001c | `[].reduce(...)` over an **empty array literal**, so the callback never runs; asserts `canonicalEqual(initialState, initialState)` — exercises `canonicalEqual`'s reflexivity, never the reducer |

SC-005a is the case you flagged. It is worse than "asserts nothing": the file
that names itself *Reconnection Recovery* contains no reconnection. The
`beforeDisconnect` slice is computed, then discarded via `void beforeDisconnect`,
with a comment explaining why it isn't needed. The intended property — *client
pre-snapshot state + server snapshot converges to server state* — is never
expressed.

Mitigating context: reconnection **is** genuinely covered elsewhere
(`test/integration/eviction-recovery.test.ts`, `test/staging/multiplayer-sync.test.ts:649`,
`src/worker/mock-durable-object.test.ts:1018`). The damage is a false claim of
SC-005 spec coverage, not a total blind spot.

**Fixed.** SC-005a is now a real property using the previously-discarded
`beforeDisconnect` slice, with an `fc.pre` filter that drops runs where the
client did not actually go stale. SC-005b is a deterministic witness for that
filter, so a reducer that drops mutations fails loudly rather than silently
starving the property of valid runs. SC-005c (a duplicate of the `point=length`
boundary `fc.nat()` already covers) and SC-001c were deleted. Both surviving
tests now fail under the sabotage.

### 2. E2E tests with zero assertions

Each has a name asserting a behavioural claim and a body that only logs.

| File:line | Test | What it actually does |
|---|---|---|
| `e2e/accessibility.spec.ts:109` | focus indicators are visible | reads computed outline → `console.log` |
| `e2e/accessibility.spec.ts:135` | images have alt text | `console.warn` per missing alt; **passes with every image unlabelled** |
| `e2e/keyboard.spec.ts:52` | Shift+Tab navigates backwards | logs forward/backward focus, compares neither |
| `e2e/keyboard.spec.ts:106` | Space toggles playback (if implemented) | `expect(async () => { console.log(...) }).toPass().catch(() => {})` — callback contains no assertion, and the result is discarded |
| `e2e/keyboard.spec.ts:125` | Ctrl+A selects all (if implemented) | logs a count |
| `e2e/keyboard.spec.ts:276` | focus is visible on all focusable elements | `try { ... } catch {}` + log |
| `e2e/mobile-iphone.spec.ts:96` | track rows are scrollable | logs `scrollLeft` before/after a drag |
| `e2e/mobile-iphone.spec.ts:127` | velocity lane is hidden on small screens | `isVisible().catch(() => false)` → log |
| `e2e/playback.spec.ts:147` | playhead position updates correctly during playback | 10 × 150ms sleeps, then `expect(true).toBe(true)` under the comment *"This test is informational"* |

**Fixed.** Six now assert the claim in their name. Three were deleted: the
`(if implemented)` hedges. Space and Delete turned out to be *implemented*
(`useKeyboard.ts:111`, `:117`, both ✅ in specs/KEYBOARD-SHORTCUTS.md) so those
two were rewritten rather than deleted; only Ctrl+A was genuinely absent from
both the hook and the shortcut table, so it went.

Two of these were dead for a second reason: `Delete clears selected steps` and
`can tap to toggle steps` guarded on `.step-cell` visibility, and a fresh
session has no tracks — so the guard was false on every run. They now add a
track first.

### 3. Nullified assertions — `.catch(() => {})` on an `expect`

The assertion runs, rejects, and the rejection is swallowed.

- `e2e/visual.spec.ts:96, 212, 231`
- `e2e/keyboard.spec.ts:137`

```ts
await expect(stepCell).toHaveClass(/active/).catch(() => {});   // never fails
```

Distinct from `.catch(() => {})` on a `waitFor`/`click` (16 further sites), which
is tolerant *setup* — undesirable but not a nullified oracle.

**Fixed.** All four removed. The surrounding `visual.spec.ts` tests also had
vacuous `if (await stepCell.isVisible())` wrappers that never ran; they now add
a track and assert.

### 4. Oracle mismatch — `test/integration/multiplayer-sync.test.ts:97`

`describe('TEST-05: WebSocket Reconnection Scenarios')` — four nested describes,
four tests, **no reconnection anywhere**. Each calls `multiplayer.disconnect()`
on a singleton that was never connected, then asserts zeroes on a fresh object:

```ts
it('tracks reconnection attempts correctly', async () => {
  multiplayer.disconnect();
  expect(multiplayer.getReconnectAttempts()).toBe(0);   // default value
});
```

Every assertion would pass against a stubbed-out module. The names claim the
TEST-05 spec is covered; the bodies assert constructor defaults.

**Not fixed — Phase 3b.** Rewriting this to actually connect → disconnect →
reconnect is a behavioural change to the test, not a repair of a broken oracle,
and it belongs with the other Phase 3 work.

### 5. Fault-masking assertions

- `src/utils/detect-hotspots.test.ts:33, 45` — `output = (err as {stdout?: string}).stdout ?? ''`, then `expect(output).not.toContain('orphaned-vitest-config')`. If the script crashes with no stdout, `output` is `''` and the negative assertion passes. A crash reads as a pass.
- `src/utils/dead-code-audit.test.ts:34` — `isImportedBy()` returns `false` on any grep failure, so every "symbol is not imported" assertion passes vacuously when grep breaks.

**Fixed.** Both now use `spawnSync` and assert the subprocess succeeded before
asserting anything about its output. `detect-hotspots` additionally checks the
report header is present (a pre-mask assertion) and runs the script once in
`beforeAll` instead of three times — 1.8s → 1.1s. `dead-code-audit` distinguishes
grep exit 1 (no matches: a real answer) from any other exit (the search broke:
throw).

---

## P1 — Structural

### 6. The entire E2E tier is non-gating and mock-only

`.github/workflows/ci.yml:177`

```yaml
run: npx playwright test --project=chromium
continue-on-error: true  # E2E tests are advisory - many require real backend
env:
  USE_MOCK_API: '1'
```

Three compounding consequences:

1. **No E2E failure can break the build.** 36 spec files produce zero gating signal in CI.
2. **Real-backend tests never execute in CI.** `USE_MOCK_API=1` trips 13 `test.skip(useMockAPI, ...)` guards — `session-persistence.spec.ts` (7), `new-session.spec.ts:26`, `track-reorder-precision.spec.ts:402`.
3. **`e2e/visual.spec.ts` is `test.skip(isCI)` at file scope** (line 37) — every visual regression test, including its 12 screenshot assertions, runs 0 times in CI.

**Important qualifier:** `app/.husky/pre-push` *is* a real gate. It runs unit
tests, then a smoke suite, then `test:e2e:full` (chromium + webkit), then mobile
Safari — each `exit 1` on failure — and it refuses to run at all unless
`wrangler dev` is live on port 8787. So E2E does gate locally, **against a real
backend**, which means the `useMockAPI` guards in (2) do not fire for developers
who push normally. Those specs run on laptops and nowhere else.

That makes the finding narrower but not less real:

- The gate is bypassable (`git push --no-verify`, which the hook advertises in
  six separate error messages) and unenforceable on anyone's machine.
- CI is the backstop for exactly that case, and it currently backs up nothing.
- The pre-push gate costs ~5 minutes and needs a manually started backend, so
  the incentive to `--no-verify` is significant.
- Nothing reading E2E results in CI is why the P0 rot in §2 and §3 survived:
  those nine tests pass, so the local hook is green too. Only a human reading
  the file would notice, and CI never forced anyone to.

**Fixed.** The single `continue-on-error` job is now three gating jobs:
`e2e-tests` (mock API), `e2e-real-backend` (`wrangler dev` via the existing but
never-CI-wired `test:e2e:full-stack` script), and `e2e-visual` (runner-owned
Linux baselines against the same real Worker path). The latter two were briefly
left advisory and proved why that is unsafe: the real-backend lane duplicated
visual coverage in the wrong environment, and the visual lane failed 9/11 while
GitHub still reported green. They now have disjoint ownership and exact result
contracts (199 pass + 17 declared skips for functional; 11/11 for visual).
The first blocking visual run then exposed a screenshot with the wrong subject:
the 1,355px track row was wider than its 1,280px viewport, so Playwright moved
it under the sticky header and compared the random presence avatar. The test
now captures the in-viewport step strip and asserts its geometry is below the
header before comparing pixels. Artifact review caught two further occlusions:
the sticky action buttons covered the last four cells, and the 600ms remote
change flash outlived the generic 450ms animation wait. The screenshot now
isolates those unrelated actions, waits for the real flash class to expire, and
hit-tests the last cell to prove all 16 cells are exposed.
The real count of `test.skip(useMockAPI, …)` guards is **19 across 14 files**,
not the 13 first reported — that number came from too narrow a grep.

#### 6a. Why the job was advisory: 12 specs could never pass under the mock API

Making the mock-API job gating surfaced the actual reason for
`continue-on-error`, which no comment in the repo recorded. Running the suite
against the mock API produced **91 failures out of ~189 executed tests**, and
almost all of them shared one cause:

```
Locator: locator('.connection-status--connected')
Expected: visible
Error: element(s) not found
```

From `vite.config.ts:35`:

```
WARNING: Does not support WebSockets! Use real backend for multiplayer testing.
```

16 spec files wait for `.connection-status--connected` in `beforeEach` before
asserting anything. That element only appears once a WebSocket connects, and the
mock API has no WebSocket — so under `USE_MOCK_API=1` **every test in those files
failed in setup, on every run, and always had.** Five of the 16 already carried a
file-level `test.skip(useMockAPI, …)`; the other 12 never got one. Four of them
had *per-test* guards on their persistence tests only, which treated the symptom
while the shared `beforeEach` kept failing for every other test in the file.

These were never quarantine candidates — they are real-backend tests that were
simply never labelled. All 12 now carry the file-level guard, which moves them
into `e2e-real-backend` where they can actually pass, and lets the mock-API job
gate on a suite that is genuinely green.

Confirmed pre-existing, not caused by this work: `track-reorder.spec.ts` fails
identically on a stashed (unmodified) tree.

**Result: 91 failures → 2.** Both survivors are `Unable to decode audio data`
across all 303 samples, in `sample-browser-decode.spec.ts` and
`all-instruments-master-output.spec.ts`. Every sample is `.m4a` or `.mp3`
(proprietary codecs) and the container this was verified in substitutes an
open-source Chromium build with no AAC/MP3 decoder, so these two could not be
verified locally. They are expected to pass in CI: `sample-browser-decode.spec.ts`
is *already* a gating step in the `instrument-validation` job today (no
`continue-on-error`), which only holds if the official Playwright chromium
decodes these files. Worth watching on the first CI run regardless.

### 7. 34 runtime self-skips (`test.skip(true, ...)`)

When the app fails to reach the expected state, the test marks itself skipped
rather than failed. A UI regression that prevents adding a track turns these
green-ish (skipped), never red.

| File | Count |
|---|---|
| `e2e/multiplayer.spec.ts` | 12 |
| `e2e/scrollbar.spec.ts` | 9 |
| `e2e/feature-flags.spec.ts` | 5 |
| `e2e/core.spec.ts` | 4 |
| `e2e/session-race.spec.ts` | 3 |
| `e2e/mobile-iphone.spec.ts` | 2 |

Worst instance — `e2e/core.spec.ts:85`, "can delete a track": tries the delete
button, falls back to a context menu, and if both fail
`console.log('Delete button not found via direct click or context menu')` and
**passes**. Delete being entirely broken is a passing test.

**Fixed — all 34 removed.** Preconditions moved into `beforeEach` as assertions,
or into a helper that fails loudly. Genuine environmental skips (`isWebkit`,
`isMobileProject`, the file-level `useMockAPI` guards) were left alone — those
are honest capability gates, and the problem was never that they exist.

The delete-track test turned up something worse than a bad guard: all three
selectors it tried are absent from `TrackRow.tsx`. The real control is
`.action-btn.delete` in `.track-actions`, rendered unconditionally and behind no
menu — so the test had *never* clicked delete in its life. Same story in
`core.spec.ts`'s step-count test (`.step-count-select` does not exist; the real
control is `select.drawer-select` inside the track drawer) — that one was deleted
in favour of the existing reducer and sync coverage.

### 8. Properties too weak to constrain behaviour

These are legitimate properties, but a no-op reducer satisfies all of them —
proven by the sabotage run. A no-op is deterministic, trivially commutative, and
preserves every count.

- SC-001a determinism (`:44`), SC-004a–c commutativity (`:150`–`:230`), SC-006a (`:~420`)
- `reorder_tracks preserves track count` / `preserves all track IDs`

They need a **witness**: assert the mutation actually changed the state it claims
to change, alongside the invariant.

### 9. Tier mislabeling

12 of 19 files in `test/integration/` never import `cloudflare:test` — they
import client modules directly and use fake timers. They are unit tests paying
the Workers-pool startup cost:

`canonical-hash-completeness`, `connection-storm`, `message-types`,
`mobile-ui-functionality`, `multiplayer-sync`, `mutation-tracking`,
`pattern-ops-sync`, `recovery-state`, `rest-api-do-sync`, `shared-types`,
`sync-health`, `validators`.

### 10. Unseeded randomness — property tests were not reproducible

**Missed in the first pass of this audit.** Step 5 of the framework covers
determinism; the first pass checked the `sleep`/`waitForTimeout` half of it and
never checked seeding.

**415 `fc.assert` calls, 17 with an explicit `seed:`, no `fc.configureGlobal`.**
fast-check defaults to a *random seed per run*, so ~96% of property tests
explored a different slice of the input space on every run. Consequences:

- A property failing on 1-in-500 inputs surfaces as intermittent CI noise that
  "goes away" on re-run — a flaky test, by construction.
- Two green runs do not mean the same thing; "the tests passed" was not a
  repeatable claim.

Plus **15 raw `Math.random()` sites**, 6 feeding assertions. The worst was
`src/worker/invariants.property.test.ts:558` — `Math.random()` *inside* an
`fc.property`, which defeats fast-check's shrinking and replay entirely, since
it cannot reproduce a value it did not generate.

The repo already knew better: `test/integration/eviction-recovery.test.ts:181`
uses `mulberry32` with a fixed seed list under the comment *"We avoid
Math.random() precisely so a red run can be replayed."* The practice existed; it
just had not spread.

**Fixed.** `src/test/setup-fast-check.ts` pins the global seed (overridable with
`FC_SEED=<n>`), wired via `setupFiles` in `vitest.config.ts`. `mulberry32` is
lifted into `src/test/seeded-random.ts` and used at the `Math.random()` sites
that fed assertions. Verified: two consecutive runs generate byte-identical
inputs, and `FC_SEED=999` generates different ones.

One knock-on fix: `src/sync/multiplayer.test.ts` disabled jitter with
`vi.spyOn(Math, 'random').mockReturnValue(0.5)`. The rng is now an injected
parameter, so the no-jitter case passes `() => 0.5` explicitly instead of
patching a global that leaked into every later test in the file.

#### 10a. The global seed broke `fc.sample` — found and fixed

Pinning the global seed had a consequence I did not anticipate, and it made
`sync-convergence.property.test.ts` **weaker**, not stronger.

`fc.sample(arb, 1)` with no seed argument starts a fresh `Random` from
fast-check's *global* seed on every call. With no global seed that is a fresh
random each time; with one configured, every bare `fc.sample` in a loop returns
the **identical** draw. Measured:

```
bare fc.sample, global seed set:    1 distinct value  / 20 calls
bare fc.sample, no global seed:    17 distinct values / 20 calls
```

`buildMutationLog` calls `fc.sample(arbMutationForState(state), 1)` in a loop,
so a "20-mutation sequence" silently became the same mutation twenty times —
across all five call sites in that file.

Fixed by giving each draw its own seed via a `sampleMutation(state, seed)`
helper. That restores variety *and* keeps it reproducible, which is strictly
better than the unseeded original:

```
seeded per-draw:  19 distinct values / 20 calls, byte-identical across runs
```

The lesson generalises: a global seed changes the behaviour of every *unseeded*
generator call in the codebase, not just the ones fast-check drives. Anywhere
`fc.sample` is called imperatively, it now needs an explicit varying seed.

**Not done:** a scheduled job running with a random `FC_SEED` to keep widening
coverage while PR runs stay deterministic. A fixed seed stops finding *new*
inputs; that nightly job is the intended counterweight and is still open.

---

## P2 — Hygiene

- **120 `waitForTimeout` calls** in e2e — fixed sleeps instead of web-first assertions. Concentrated in `phase3-refactoring.spec.ts` (34) and `track-reorder-comprehensive.spec.ts` (29).
- **57 fallback locators** — `page.locator('.a, .b').or(page.locator('[data-testid=c]'))`. A test passes if *any* variant matches, so it cannot detect the UI drifting away from the intended selector. Worst: `core.spec.ts` (9), `new-session.spec.ts` (8).
- **2 `expect(true).toBe(true)` "documentation tests"** — `src/shared/copy-paste-range.test.ts:421`, `src/components/drag-to-paint.test.tsx:1352`. Both are 20-line explanatory comments wrapped in a passing test, inflating the green count with prose.
- **~130 decorative `expect(screen.getByText('X')).toBeTruthy()`** (`EffectsPanel.test.tsx` has 19) — `getByText` already throws when absent; the assertion adds nothing. Harmless, low priority.
- **No coverage or mutation ratchet** — `vitest.config.ts` thresholds and Stryker `break: null` are both deliberately informational. Reasonable as a choice; worth revisiting once P0/P1 land.

---

## Remediation plan

Ordered by (signal gained) ÷ (effort). Phases 1 and 2 are **done**; Phase 3
(except the seeding work) and Phase 4 remain.

### Phase 1 — Delete or fix the tests that cannot fail — ✅ DONE

**1a. Rewrite the SC-005 block** so it expresses the property its name claims.
The real invariant needs the discarded `beforeDisconnect` slice:

```ts
// SC-005a: a client that applied a prefix of mutations, then received the
// server snapshot, converges to server state regardless of disconnect point.
const clientPreSnapshot = beforeDisconnect.reduce(applyMutation, initialState);
const serverFinal       = mutations.reduce(applyMutation, initialState);
const clientAfterSnapshot = applySnapshot(clientPreSnapshot, serverFinal);

expect(canonicalEqual(clientAfterSnapshot, serverFinal)).toBe(true);
// witness: the snapshot actually moved the client, or the property is vacuous
fc.pre(!canonicalEqual(clientPreSnapshot, serverFinal));
```

Collapse SC-005b and SC-005c into this parameterised property — as written they
are the `point = 0` and `point = length` boundaries of the same thing, which
`fc.nat()` already covers. Delete SC-001c (it tests `canonicalEqual`'s
reflexivity; if that's wanted, it belongs in `canonicalHash.property.test.ts`
asserting reflexivity explicitly).

*Verification:* re-apply the `applyMutation` no-op sabotage. SC-005 must fail.

**Result: 7/22 failing, up from 5/24.** SC-005a and SC-005b both kill the mutant
now, which was the point. But the "≥20/24" figure originally written here was
wrong: reaching it requires Phase 3a, because the other 15 survivors are the
weak-but-valid properties in §8 (determinism, commutativity, count preservation)
that a no-op reducer satisfies by definition. Fixing the tautologies could never
have moved those. The corrected target for Phase 1 alone is "SC-005 fails", and
the ≥20/24 figure belongs to Phase 3a.

**1b. Convert the 9 zero-assertion e2e tests** (P0 §2). Each already gathers the
right data — it just logs it. Two cases:

- *Real claim, missing oracle* — `images have alt text`, `Shift+Tab navigates backwards`, `track rows are scrollable`, `velocity lane is hidden on small screens`, `focus indicators are visible`. Turn the `console.log` into the assertion (`expect(alt).not.toBeNull()`, `expect(backwardFocus).not.toBe(forwardFocus)`, `expect(newScrollLeft).toBeLessThan(initialScrollLeft)`, …).
- *Unimplemented feature* — the three `(if implemented)` tests and `playhead position updates correctly`. Delete them. A test hedging on whether the feature exists is a TODO; `test.fixme()` with an issue link is the honest form if the intent is to keep them.

**1c. Strip `.catch(() => {})` from the 4 assertion sites** (P0 §3). If the class
genuinely settles asynchronously, `await expect(...).toHaveClass(/active/)` already
retries — the `.catch` was never needed.

**1d. Fix the two fault-masking helpers** (P0 §5). Assert the subprocess
succeeded *before* asserting on its output:

```ts
const res = spawnSync('npx', ['tsx', scriptPath], { encoding: 'utf-8' });
expect(res.error).toBeUndefined();
expect([0, 1]).toContain(res.status);          // 1 = findings exist
expect(res.stdout).not.toBe('');               // pre-mask: we got real output
expect(res.stdout).not.toContain('orphaned-vitest-config');
```

**1e. Delete the 2 `expect(true).toBe(true)` documentation tests**, keeping the
comment bodies as file-level block comments.

### Phase 2 — Make E2E mean something — ✅ DONE

**2a. Split the E2E job in two.** The `continue-on-error: true` blanket exists
because some specs need a real backend — so separate them rather than exempting
all 36 files:

```yaml
- name: E2E (mock API — gating)
  run: npx playwright test --project=chromium --grep-invert @real-backend
  env: { USE_MOCK_API: '1', CI: 'true' }
  # no continue-on-error

- name: E2E (real backend — advisory)
  run: npx playwright test --project=chromium --grep @real-backend
  continue-on-error: true
```

Tag the 13 `test.skip(useMockAPI, ...)` specs `@real-backend` and drop the
runtime guard. This is the change that gives every other e2e fix teeth, and it
makes CI a genuine backstop for `--no-verify` pushes rather than a rubber stamp.

Consider also trimming `pre-push` to Phase 0–2 (manifests, unit, smoke — ~1
minute, no backend needed) once the mock-API job gates in CI. The current
5-minute, backend-required hook is strong enough that bypassing it is rational,
and a gate people skip is worse than a cheaper one they keep.

**2b. Replace the 34 `test.skip(true, ...)` self-skips with failures.** The
precondition ("a track exists", "the backend is up") belongs in `beforeEach` as
an assertion, not mid-test as an escape hatch:

```ts
// before: if (trackCount < 2) { test.skip(true, 'Need at least 2 tracks'); return; }
// after — in beforeEach:
await addTracks(page, 2);
await expect(page.locator('.track-row')).toHaveCount(2);
```

Start with `e2e/core.spec.ts` (the delete-track test that passes when delete is
broken) and `e2e/multiplayer.spec.ts` (12 sites). Genuine environmental skips —
`isWebkit`, `isMobileProject`, the 18 in `drag-to-paint.spec.ts` — are correct as
they are and should stay.

**2c. Resolved: `e2e/visual.spec.ts` is gating in CI.** The suite no longer has
the file-level `test.skip(isCI)`, its four formerly unreachable screenshots have
runner-generated baselines, and all 11 tests run serially against a real Worker.
The baseline regeneration workflow uses that identical environment.

### Phase 3 — Strengthen weak properties (3a, 3b, 3c OPEN; seeding done)

**3a. Add change-witnesses** to the properties a no-op satisfies (P1 §8). Pattern:

```ts
const after = applyMutation(before, mutation);
expect(canonicalEqual(before, after)).toBe(false);   // it did something
expect(after.tracks.length).toBe(before.tracks.length);  // and preserved the invariant
```

**3b. Rewrite `TEST-05` in `test/integration/multiplayer-sync.test.ts`** to
actually connect → disconnect → reconnect, or rename the describes to what they
verify (`'disconnect() resets counters'`) and delete the redundant three. Right
now the names are the bug.

**3c. Add `applyMutation` to `stryker.config.mjs`.** The sabotage experiment was
a manual, one-mutant version of what Stryker automates — and `src/shared/state-mutations.ts`
is exactly the "critical pure module with strong invariants" the config targets.
Consider `break: 70` for this file once Phase 1 lands, making the ratchet real.

### Phase 4 — Hygiene (OPEN)

**4a.** Move the 12 mislabeled files out of `test/integration/` into `test/unit/`
(P1 §9) — removes Workers-pool startup from 12 files and makes the tier name honest.
Mechanical; do it in one commit.

**4b.** Replace `waitForTimeout` with web-first assertions in the two worst files
(63 of 120 sites). `await expect(locator).toHaveClass(...)` instead of
`await page.waitForTimeout(300)`.

**4c.** Narrow fallback locators to one canonical `data-testid` per element,
adding the testid to the component where missing.

**4d.** Add a lint rule so this doesn't regrow. `eslint-plugin-vitest` /
`eslint-plugin-playwright` cover most of it:

- `vitest/expect-expect` — catches zero-assertion tests
- `playwright/no-skipped-test` with `allowConditional: true` — catches `test.skip(true, ...)`
- `playwright/no-wait-for-timeout`
- `playwright/no-conditional-expect` — catches assertions behind `if` guards
- a small custom rule banning `.catch(() => {})` chained onto `expect(...)`

Wire these as warnings first, get to zero, then promote to errors.

---

## Status and what remains

| Phase | Status | Outcome |
|---|---|---|
| 1 — tests that cannot fail | ✅ done | 15 always-green tests fixed or deleted; SC-005 now kills the sabotage mutant |
| 2 — make E2E mean something | ✅ done | mock, real-Worker functional, and runner-owned visual jobs all gate; exact reporter contracts reject new failures, retries, or undeclared skips |
| §10 — seeding | ✅ done | global fixed seed, `FC_SEED` override, `Math.random()` removed from assertion paths, `fc.sample` given per-draw seeds (§10a) |
| 3a — witnesses for weak properties | open | would take `sync-convergence` from 7/22 to ≈20/22 under sabotage |
| 3b — rewrite TEST-05 | resolved upstream | main deleted `test/integration/multiplayer-sync.test.ts` in the "remove-test-theatre" PR |
| 3c — Stryker on `state-mutations.ts` | open | automates what the manual sabotage did by hand |
| 3d — nightly random-seed job | open | the counterweight to a fixed seed; without it, coverage stops widening |
| 4 — hygiene | open | tier relabelling, `waitForTimeout`, fallback locators, lint rules |

### The two caveats, and how they were closed

**1. `e2e-real-backend` was unproven.** Resolved by actually running it, which
found two bugs in the job as written.

`wrangler dev` itself is fine: it builds and is ready in 3s, and
`scripts/test-e2e-full-stack.ts` drives Playwright against it correctly. But the
first full run produced 482 failures, and the breakdown was diagnostic:

| Failures | Cause |
|---|---|
| 248 | `webkit` binary missing |
| 217 | `ECONNREFUSED` partway through the run |
| 1 | the new AAC codec guard (expected) |

Both were faults in my CI job, not the app:

- The script's default scope runs **every** project — chromium, webkit, and the
  webkit-backed mobile profiles — but the job only installed chromium. The
  script had no way to narrow it, so `runE2ETests` now forwards unrecognised
  args to Playwright and CI passes `--project=chromium`.
- Every Playwright worker shares a single `wrangler dev`. The default worker
  count saturated it and the backend started refusing connections — the tests
  were fine, the one backend instance was the bottleneck. CI now passes
  `--workers=2`.

Neither would have been visible without running the job, and both would have
produced a confusing red on the first CI run.

Re-running with both fixes confirmed them: the 248 webkit failures and the 217
`ECONNREFUSED` are gone. The run reached 255 tests (160 passed / 69 failed)
before a local 25-minute cap cut it off, and the residual failures are one
concentrated cluster:

| Failures | Spec |
|---|---|
| 59 | `track-reorder*` (drag-and-drop) |
| 10 | everything else |

**59 of them are uniform 40.0s timeouts** — the per-test timeout, not assertion
failures. That is the signature of the drag interaction never completing at the
browser level, rather than the app computing a wrong track order. The same specs
failed the same way under the mock API before any of this work, and the repo
already carries `test.skip(isWebkit, 'WebKit drag-and-drop broken in Playwright
- see issue #31539')` in `drag-to-paint.spec.ts`, so Playwright drag-and-drop is
a known sore spot here.

This was verified against a substituted open-source Chromium, so it cannot
distinguish "drag-and-drop does not work in this browser build" from "drag-and-
drop is broken in the app". CI, on the official Playwright Chromium, will settle
it — which is precisely why the job is advisory for its first runs.

**Runtime note:** 255 tests took 25 minutes at `--workers=2`. The job currently
runs the *whole* suite against wrangler, which re-runs everything the gating
mock-API job already covered. Scoping it to just the specs that skip under
USE_MOCK_API would cut it substantially and sharpen what a red result means;
that needs per-test tagging, since the guards are `test.skip(useMockAPI, ...)`
calls rather than tags.

The initial advisory runs completed the experiment: Wrangler was stable, while
ten visual failures polluted this functional lane because `visual.spec.ts` was
also selected. The lane now sets `E2E_FUNCTIONAL_ONLY=1`, requires exactly 199
passes and 17 declared skips, and no longer has `continue-on-error`.

Note it complements, rather than duplicates, the `test:e2e:collaboration:worker`
step already in `e2e-tests`: that runs the collaboration contract subset and is
gating; this runs the whole real-backend suite.

**2. Missing and stale visual baselines.** Resolved structurally and verified
from the runner artifact. Ten Linux baselines were replaced with the runner's
exact actual images, including four that had never existed because their tests
previously took no screenshot. `.github/workflows/visual-baselines.yml` remains
manual, but now regenerates through the same serial Chromium + real Worker path
as the gating job. It uploads by default and can push a review branch; it never
updates automatically, which would be the blind-snapshot-update anti-pattern.

**3. The audio-decode tests** (the caveat behind the caveat). The root cause is
now pinned precisely: MP3 decodes fine, **AAC/m4a does not**, on Chromium builds
without proprietary codecs. The catalogue is 180 `.mp3` + 43 `.m4a`.

The fix is not to make them pass in a codec-less browser — it is to stop a
browser limitation from impersonating a data problem. Both tests now assert
codec support up front:

```
Error: this browser cannot decode AAC/m4a (canPlayType: ""). Every .m4a sample
would fail with "Unable to decode audio data" — a missing codec, not a bad
asset. Run with Playwright's bundled Chromium ...
```

instead of 303 identical opaque decode errors, or — worse, in
`all-instruments-master-output.spec.ts` — every m4a-backed instrument being
reported *silent*, which is indistinguishable from the audio-routing regression
that test exists to catch. That is anti-pattern #14 (asserting through
fault-masking code) at the environment level.

### Recommended next step

Phase 3a is the highest value remaining, and it is small. The sabotage
experiment showed that a reducer ignoring every mutation still satisfies
determinism (SC-001a), commutativity (SC-004a–c), and every count-preservation
invariant. Those properties are true but too weak to pin behaviour; pairing each
with a "the state actually changed" witness is a handful of lines per test and
would raise the file's kill rate from 7/22 to roughly 20/22.

---

## Closing pass — the remaining items

Phases 3a, 3c and 4d are now done, along with the coverage gaps and a final
sweep for the patterns this audit is named after. What follows is what changed
and what each change actually bought.

### §11 — Weak properties given change-witnesses (3a, done)

Each property that a do-nothing reducer could satisfy now also asserts that the
mutation *did something*. `sync-convergence.property.test.ts` goes from killing
7 of 22 sabotage mutants to 9 of 22 on the reducer-ignores-everything mutant,
and every property that was previously vacuous now has a witness. The pattern:

```ts
fc.pre(!canonicalEqual(state1, initialState));
expect(canonicalEqual(state1, initialState)).toBe(false);
```

### §12 — Mutation testing on the shared reducer (3c, done)

`stryker.config.mjs` now includes `src/shared/state-mutations.ts` and
`src/audio/track-step.ts` — the two modules where the manual sabotage found the
most vacuous properties, and the two whose logic both client and server depend
on. This automates by tooling what was done by hand above.

### §13 — Parsed checkers instead of two plugins (4d, done)

`eslint-plugin-vitest` and `eslint-plugin-playwright` are not installed here and
pulling in two plugins to get five rules was a poor trade, so the rules use the
TypeScript parser that is already a build dependency:

| Script | npm | Detects | CI |
|---|---|---|---|
| `scripts/check-test-antipatterns.ts` | `validate:test-antipatterns` | nullified assertions, runtime self-skips, tautologies, self-comparisons, always-defined coercions, zero-assertion tests including `test.each` | **gating** |
| `scripts/check-test-subject-links.ts` | `validate:test-links` | ORPHAN (names a module it never imports), REIMPL (copies the logic it claims to test), DEAD (module imported only by its tests) | **gating** |
| `scripts/check-dead-exports.ts` | `validate:dead-exports` | exported symbols unreachable from a runtime entry point | **gating** |
| `scripts/check-unrun-tests.ts` | `validate:unrun-tests` | test files no Vitest or Playwright lane collects, plus stale allowlist entries | **gating** |

All four run in the `lint` job. `npm run validate:test-quality` runs the four.
The two reachability CLIs also have process-level fixtures proving a real
finding returns status 1 and a clean repository returns status 0. This matters:
the first promotion from advisory to gating changed the workflow but left both
CLIs returning success on findings, so their required CI steps were still
false-green. The audit caught and closed that second-order failure.

**The lesson from building the first one.** Its first run reported 17 findings,
13 of which were *this document* and the explanatory comments written during
the audit — every place the prose described `expect(true).toBe(true)` was
reported as an instance of it. A checker whose output is mostly noise gets
muted, which would have been worse than not having it. The scanner now operates
on the TypeScript syntax tree, so comments, strings, multiline bodies, one-line
bodies and `test.each`/`it.each` all follow language structure rather than a
home-grown block parser. Named assertion helpers (`pollKvTempo`,
`expectSessionSynced`, page-object `expectStepActive`) count as assertions.

The pure analyzers have adversarial fixtures for quote styles, dynamic imports,
one-line tests, parameterised tests, swallowed assertions and same-named exports
from different modules. Those fixtures run in the ordinary unit gate, so the
quality checks are no longer untested programs judging the test suite.

### §14 — The last three always-green tests

The checker's first honest run found three in `test/staging/failure-modes.test.ts`
that the manual audit had missed, all the same shape:

```ts
try {
  await player.connect();
  expect(true).toBe(false);   // "should not reach here"
} catch (error) {
  expect(error).toBeDefined();
}
```

This cannot fail. When the server **wrongly accepts** the connection — the only
thing these tests exist to catch — the unreachable assertion throws, its own
`catch` swallows the assertion error, and `expect(error).toBeDefined()` passes
*on that error*. Three tests guarding session-id validation (non-existent
session, malformed uuid, SQL-injection payload) were permanently green.

Replaced with `expectConnectionRefused()`, which captures the outcome outside
the `try` and additionally distinguishes a server refusal from the harness's
own 10-second timeout — the old oracle accepted a hang as success.

This is the argument for the checker in one example: five rounds of manual
review over this suite did not find these, and a 40-line script found them on
its first clean run.

### §15 — The two uncovered modules (coverage gaps, done)

**`src/shared/state-adapters.ts` — 16 tests, 7/7 sabotage kills.**

Every SYNCED action in `gridReducer` routes through `delegateToApplyMutation`
(28 call sites), so a field this adapter forgets to carry is reset by *any* edit
the user makes. `gridReducer`'s own tests could not see this: they assert on the
field the action changed, and an unrelated field being clobbered in transit goes
unnoticed.

**It was dropping one.** `GridState.focus` is declared local-only in `types.ts`
and listed local-only in `SYNCED_ACTIONS`, and `applySessionToGridState`
preserved `isPlaying`, `currentStep` and `selection` but not `focus` — so every
synced edit reset keyboard navigation. Latent today only because nothing reads
`state.focus` yet; Phase 36 is half-wired. Fixed, and the test is written
against the *declared* list of local-only fields rather than a hand-copied one,
so the next local-only field fails here until the adapter carries it.

**`src/audio/slicer.ts` — 20 tests, shipped path now covered.**

Only `detectTransients` shipped. `sliceByTransients`, `sliceEqual`,
`extractSlice` and `autoSlice` were imported by nothing — `Recorder.tsx` calls
`detectTransients` and did its own cutting inline, correctly, in samples. The
unused half had drifted, and two defects had accumulated behind the silence:

1. **Units.** `sliceByTransients` assigned `detectTransients`' *seconds* straight
   to a field named `startSample`, then divided by the sample rate a second
   time. `autoSlice(ctx, buf, 'transient')` asked `createBuffer` for a
   fractional length — which throws in the good case and yields a one-frame
   buffer of silence in the quiet one.
2. **Dropped audio.** It started the first slice at the first onset while its own
   comment said "start and end will be added", so everything before the first
   hit was discarded. A recording with a count-in lost the count-in.

The useful path is repaired and connected to the product rather than left as a
self-contained test island: `Recorder.tsx` now calls `sliceByTransients`,
`sliceFromNormalizedRange` and `extractSlice`. The unused equal-mode wrapper
and `autoSlice` facade were deleted together with tests that could only verify
those unreachable APIs. `Slice` is only ever constructed through unit-safe
helpers, and `extractSlice` clamps out-of-range slices instead of writing NaN
samples. `docs/AUDIO-CONTENT-TOOLS.md` now documents the shipped API.

The reason this sat undetected is worth keeping separate from the fix: it is the
linkage family at **export** granularity rather than module granularity. The
DEAD check asks whether anything imports a module, and `slicer.ts` passed that
question on the strength of one live export while four dead ones sat behind it.
A per-module reachability check cannot see this; a per-export one would.

The tests that remain assert *where* onsets land, not how many there are. A
count-only oracle passes when the detector reports the right number of
transients at entirely the wrong times, which is the failure a user hears:
slices cut through the middle of hits.

### Sabotage results for the new suites

| Sabotage | Caught |
|---|---|
| `slicer`: drop the `relativeDiff > threshold` guard | ✅ |
| `slicer`: drop the minimum-gap guard | ✅ |
| `slicer`: `i * hopSize` → `i * windowSize` | ✅ |
| `slicer`: drop the `/ sampleRate` conversion | ✅ |
| `slicer`: **reintroduce the original units bug** (seconds as sample indices) | ✅ |
| `slicer`: drop the leading slice again | ✅ (4 tests) |
| `slicer`: remove `extractSlice`'s range clamp | ✅ |
| `slicer`: `makeSlice` skips the seconds conversion | ✅ |
| `slicer`: off-by-one in `extractSlice`'s copy | ✅ |
| `slicer`: ignore `maxSlices` | ✅ |
| `adapters`: take mute/solo from the server | ✅ |
| `adapters`: drop `focus` again | ✅ |
| `adapters`: treat an absent `loopRegion` as a clear | ✅ |
| `adapters`: drop the `effects` fallback | ✅ |
| `adapters`: drop the `stepCount` default | ✅ |
| `adapters`: `maybeInvalidateSelection` never clears | ✅ |
| `adapters`: `delegateToApplyMutation` skips `applyMutation` | ✅ |

### §16 — The three DEAD modules

Resolved rather than deleted; the investigation is in
`docs/TEST-PLACEMENT-ANALYSIS.md`. In summary: `utils/identity.ts` was not dead
but *duplicated* into `live-session.ts` (moved to `shared/`, worker wired to it,
41 lines of copy removed, 11 tests added covering the shipped path for the first
time); `mcp-evals.ts` was misclassified and the checker was fixed rather than the
module; `useStableCallback.ts` was a bypassed abstraction, now adopted at all six
sites that hand-rolled it.

Both checkers are green with zero findings.

### Production bugs found by this audit

Four, none of which had a failing test before:

1. **NaN tempo/swing** — `clamp()` is `Math.max(min, Math.min(max, v))`, which
   is range control, not type control. A non-numeric value passed straight
   through as `NaN`, was persisted, and was broadcast to every collaborator.
2. **NaN track volume/transpose** — the same gap on the other handler factory;
   found only by mapping all eight validators rather than the two that failed.
3. **Tone.js drum misclassification** — `TONE_SYNTH_CATEGORIES.drum` already
   holds fully-prefixed ids, and the check prepended `tone:` a second time, so
   every Tone drum was classified melodic and offered a keyboard view.
4. **`focus` reset on every synced edit** — §15 above.

Each was masked by a green test: (1) and (2) by 64 tests for a validator module
nothing imported, (3) by a test file that reimplemented the classifier, (4) by
tests that only ever asserted on the field their action changed.

---

## §17 — Generalising from the bugs: nine families, and a sweep for each

The four production bugs above were each found by chasing a symptom. This pass
treated each as an *instance of a family* and searched the codebase for the
family, which found nine more live bugs in code no symptom had pointed at.

The nine families, and what the sweep turned up:

| Family | Origin | Other instances |
|---|---|---|
| **A. Range control mistaken for type control** | NaN tempo/swing/volume/transpose | **6 more** |
| **B. NaN-blind comparison check** | new | **7** (incl. 1 subtler variant) |
| **C. Double-applied id prefix** | Tone drum misclassification | 0 |
| **D. Field dropped by an explicit-field mapper** | `GridState.focus` | 0 |
| **E. Silently dropped data segment** | slicer's leading slice | 0 |
| **F. Duplicated logic that can diverge** | `validators.ts`, 5 test copies | **1**, already diverged |
| **G. Assertion swallowed by its own `catch`** | 3 staging tests | **1** + a checker gap |
| **H. Any-error-accepted oracle** | `expect(error).toBeDefined()` | 0 beyond G |
| **I. Source-scanning tool assuming one syntax** | single-quote import regex | 0 in gating scripts |

Nine of the sixteen findings were real bugs. Five families came up empty, which
is itself the useful result — C, D, E, H and I were one-offs, not habits.

### Family A — six more unguarded `clamp()` sites

`clamp(v, min, max)` is `Math.max(min, Math.min(max, v))`: range control, not
type control. A non-numeric `v` arrives as `NaN`, is stored, and is broadcast.
Fixing tempo/swing and then volume/transpose one pair at a time missed the rest;
enumerating every `clamp()` reachable from a client message found them.

- **`handleSetTrackSwing`** — no guard at all, sitting directly beside the
  volume and transpose handlers that were fixed. Same factory, same file, same
  shape. This one is squarely a miss from the earlier pass.
- **The effects handler — five of nine numeric parameters.** Its guard checked
  `typeof x === 'number'` on `reverb.wet`, `delay.wet`, `chorus.wet` and
  `distortion.wet`, and left `reverb.decay`, `delay.feedback`,
  `chorus.frequency`, `chorus.depth` and `distortion.amount` unchecked. Nine
  fields, four guarded — the shape of a check written against the example in
  front of the author rather than against the type.

Now every numeric effect field goes through the same `isValidNumber` guard as
tempo, and the rejection log names the offending field. `typeof` alone would not
have been enough anyway: `JSON.parse('1e999')` is `Infinity`.

### Family B — the mirror image, in the module meant to be the backstop

`v < MIN || v > MAX` is **false for NaN**. So a bounds check written with
comparison operators reports a non-finite value as *valid* — and `invariants.ts`
is the storage boundary's second opinion, with `isValidNumberInRange` already
correctly implemented a hundred lines above the checks that didn't use it.

Detection (`validateStateInvariants`): tempo, swing, track volume and stepCount
all reported NaN as valid. **This is the family that weakened one of my own
tests**: `validator-enforcement.test.ts` asserts `invariants.violations` is
empty after hostile input as a second, independent oracle. It could not have
caught a NaN. The primary oracle — `Number.isFinite(state.tempo)` — was doing
all of the work.

Repair (`repairStateInvariants`): the interesting one, because my first diagnosis
was wrong and sabotage caught it. I claimed the repair let NaN through; it did
not. The function clones with `JSON.parse(JSON.stringify(state))`, which turns
NaN into `null`, and `null < MIN_TEMPO` coerces to `0 < 60` and repairs. The
value the comparisons genuinely could not see is a **missing key** —
`JSON.stringify` drops it, and `undefined < 60` and `undefined > 180` are both
false — so a stored state with no tempo came out of the repair still having
none. Which is precisely the legacy/corrupted-KV case the function exists for.

And one subtler variant, the worst of the group:

```ts
const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;   // defaults the LOCAL
if (stepCount < 1 || stepCount > MAX_STEPS) { track.stepCount = ... }
```

`??` defaults the local and never writes the field back. Combined with the JSON
clone turning NaN into `null`, `null ?? 16` is a healthy 16, no branch fires,
and the track escapes the repair with `stepCount: null` — while typed
`number | undefined`. Both the checker and the repairer were blind to it, for
the same reason. Fixed by testing the field, not the defaulted local, and by
distinguishing `undefined` (legitimately "use the default") from `null`.

### Family F — a diverged copy in production, not in a test

`PitchOverview.tsx` carried its own `isMelodicInstrument`, under a comment that
said the quiet part out loud: *"Shared logic from TrackRow - should ideally be
extracted to a utility"*. It had already diverged:

```
canonical         'sampled:' -> melodic UNLESS in SAMPLED_CATEGORIES.drums
PitchOverview     'sampled:' -> return true
```

So `sampled:808-kick` is melodic to the pitch overview and percussive to the
track row — the same disagreement as the five test copies, but between two
production call sites. Now imports the canonical function.

This also closed the coverage hole the upstream issue draft describes. The test
named *"drum samples should NOT show keyboard view"* listed only bare and
`tone:` drums — no `sampled:` entry — so the branch the copy got wrong was never
exercised. It is now driven from `SAMPLED_CATEGORIES.drums`, with a melodic
`sampled:` case alongside it so a classifier returning `false` for everything
cannot pass.

### Family G — the always-green shape my own checker missed

One more instance, in `enforces MAX_PLAYERS limit`:

```ts
try {
  await extraPlayer.connect();
  expect(errorFrame).toBeDefined();     // throws when the server misbehaves
} catch (error) {
  expect(error).toBeDefined();          // ...and passes on that throw
}
```

The checker's `nullified-assertion` rule looks for `.catch(() => {})` and there
isn't one here — the swallowing is structural. Added an
`assertion-swallowed-by-own-catch` rule: an `expect` inside a `try` whose
`catch` asserts only that the caught value exists. Verified against a probe with
one real instance and two legitimate try/catch tests (one asserting on
`error.message`, one with no `expect` in the `try`) — 1 finding, 0 false.

### What the sweep says about the earlier passes

Both A and B are the same root cause seen from two sides: **JavaScript's
comparison and arithmetic operators are silent on NaN**, so any validator built
from `<`, `>`, `Math.min` or `Math.max` treats "not a number" as "in range".
Every instance of both families was in code whose entire job was validation.

The fixes shipped one pair at a time, which is why per-track swing survived two
rounds of fixing its own neighbours. Fixing by family instead of by symptom took
one search per family and found six more instances of A alone.

---

## §18 — Why the checker missed it, and what else it was missing

`instrument-types.isMelodicInstrument` was a dead, wrong export inside a
live module. `check-test-subject-links.ts` could not have found it, because it
asks *does anything import this module* — and `instrument-types.ts` has six
other exports that six production modules import. I wrote that limitation into
the checker's own comment when `slicer.ts` showed it, and then left it there:

> A module can pass that on the strength of one live export while the rest of
> its surface is unreachable — `src/audio/slicer.ts` did.

Knowing about a gap is not the same as closing it. Two bugs went through it.

`scripts/check-dead-exports.ts` closes it at export granularity. It reports
**99 findings on the current head**, in two groups, because they are
not the same problem:

| Group | Count | Meaning |
|---|---|---|
| **Tested but unreachable** | 52 | Imported by tests, by no production code. Green ticks on code nothing runs. |
| **Exported but unimported** | 47 | No consumer at all. Over-exported, or genuinely dead. |

The first group is the dangerous one, and the reason this check is worth having
rather than relying on a bundler's tree-shaking report: **tests are what keep a
dead export alive.** They import it, so it looks used; they pass, so it looks
correct. Both bugs found this way — the slicer's units error and this one — sat
behind passing tests for exactly that reason.

Validated three independent ways before publishing the number, because a
checker that over-reports gets muted (see §13). For a sample of findings —
`createInitialState`, `calculateStepTime`, `TONE_SYNTH_CATEGORIES` — there is
no production import statement, no production text reference, and no occurrence
in the built bundles.

Unlike the original name-only implementation, imports are resolved to their
exact relative module. Importing `createFoo` from module A no longer marks an
unrelated `createFoo` export in module B as live.

This was initially advisory because 99 findings represented a backlog rather
than a useful build gate. The final disposition below cleared the backlog, at
which point new dead runtime exports became blocking.

### Two things the scan surfaced immediately

**`SAMPLED_CATEGORIES` and `TONE_SYNTH_CATEGORIES` are now test-only** — a
direct consequence of consolidating onto `isDrumInstrument` (§17). Their last
production reader was the classifier that got deleted. The drum knowledge now
lives in `DRUM_INSTRUMENT_IDS`, and the category tables are UI grouping data
that nothing groups by. Left in place because
`instrument-classification.test.ts` uses them as an independent oracle — the
tests assert the two lists agree — which is a legitimate use, but it should be
a deliberate one rather than an accident.

**`shared/state-mutations.createInitialState` is a test fixture in production
code.** Seven test files build their starting `SessionState` with it; no
production code does. The app's own initial state comes from a *different*
function of the same name, local to `src/state/grid.tsx`, which returns a
`GridState` with `effects`, `scale`, `isPlaying` and `currentStep`. The two are
not duplicates — different layers, different shapes — but the property tests
explore a state built by a factory the application never calls. Worth moving to
a fixtures module, and worth checking that its shape still matches what the
server actually creates.

### §18a — The value that was salvageable

Before deleting the four `isMelodicInstrument` tests, the question was whether
any of them knew something the replacement does not. Three asserted claims
`instrument-classification.test.ts` already covers. The fourth did:

```ts
expect(isMelodicInstrument('recording-123')).toBe(false);
```

`isDrumInstrument` treated user recordings as **pitched**. It handles a `mic:`
prefix — and nothing produces one. `Recorder.tsx` mints
`recording-${Date.now()}` for a whole take and `slice-${Date.now()}-${i}` for
each auto-slice, so every real recording fell past the check. Consequences, all
live:

- **MIDI export** put recordings on a melodic channel with a General MIDI
  program instead of channel 10 — `isDrumTrack` delegates to this function.
- **`mcp-lifecycle`** counts recordings by filtering for `mic:`, so it reported
  none.
- The chromatic keyboard was offered for arbitrary recorded audio.

`mic:` is consumed in three modules and produced in zero — a prefix the
codebase agreed on and never adopted. The classifier now matches the forms the
recorder actually emits, with the ids in the test taken from the literal
template strings at `Recorder.tsx:193` and `:201` so they cannot drift apart
silently. Sabotage-verified both ways: reverting to `mic:`-only fails, and
unanchoring `startsWith` to `includes` fails.

That is the whole case for reading deleted tests before deleting them. Four
tests, three redundant and one that was the only thing in the codebase that
knew user recordings are not pitched — inside a helper that was itself wrong
about 24 of 99 ids.

---

## §19 — Follow-up: tests that were only testing themselves

The AST checks catch always-green syntax and broken module linkage, but a test
can still look healthy while exercising a local imitation under a different
name. A manual scan for “mirrors”, “simulate” and locally declared business
logic found several more:

- `drag-to-paint-integration.test.tsx` rendered a 665-line test-only
  `MinimalTrackRow`, not `TrackRow`. It was deleted; the real interaction is
  exercised by `e2e/drag-to-paint.spec.ts` and production reducer tests.
- `tempo-change.test.ts` and `swing-control.test.ts` each carried a private copy
  of `TransportBar`'s drag maths. The swing copy used sensitivity **1.0** while
  the UI used **0.3**. Both now import `transport-drag.ts`, which `TransportBar`
  also calls.
- `routing.test.ts` copied `path.startsWith('/s/')`; `worker/index.ts` now calls
  the same `isSessionPagePath` function as the tests.
- `sample-constants.test.ts` tested a copied tooltip that had already drifted
  from `TrackNameEditor` (different separators and no sample ID). The assertions
  now render `TrackNameEditor` and inspect its actual title.
- Local copies of `MUTATING_MESSAGE_TYPES`, Hann/pitch-ratio maths, audio debug
  result types, engine-readiness booleans, OG cache URLs/retry code, and brand
  constants were removed. Existing production-linked suites cover the live
  message set, pitch range/engine and image layout.

### Final disposition of the 52 + 47 findings

The original **52 tested-but-unreachable + 47 exported-but-unimported** figures
were raw output from an import heuristic, not the final semantic result. After
replacing it with entry-point graph reachability, the 99 reconcile to:

| Disposition | Count | Resolution |
|---|---:|---|
| True test-only production exports | 43 | Connected to a shipped caller when the behavior was real; otherwise deleted with copied/self-testing coverage |
| Truly unreferenced exports | 54 | Un-exported or deleted, including obsolete wrappers, constants, hooks and Worker paths |
| Analyzer false positives | 2 | `midiToNoteName` and `sanitizeSessionName` were consumed by build scripts, a root class the old scan never loaded |

All **97 real findings** received a caller-or-delete decision. This was not a
mechanical export purge: scheduler timing and pitch-shifting became shared
production kernels tested through their registered worklets; platform cache
limits and sample generation moved behind real runtime constructors; genuine
build/config consumers were classified as build-only; copied catalogue,
message, reducer, retry, audio and UI implementations were removed.

The corrected graph starts at the browser and Worker entry points and follows
used named/default/namespace imports, re-exports, dynamic imports, and URL-loaded
Worker/AudioWorklet modules. Unused imports and dead-to-dead call chains do not
make a symbol live. Its final report is **523 runtime, 59 legitimate build-only,
0 dead runtime exports**, and any regression now fails CI.

## §20 — Auditing a month of test deletions

`recording-123` raised an obvious question: how often does deleting a test throw
away the only thing that knew something? So every test file deleted in the last
month was checked — 18 files across six commits — and then every test *title*
removed from a surviving file, which is the larger and less visible category.

The method that found `recording-123` was not reading test names. It was
noticing a specific *input literal* that existed nowhere else.
`scripts/deleted-test-knowledge.ts` mechanises that: extract data-shaped string
literals from each deleted file, report the ones that appear nowhere in the
surviving suite. A literal that survived is covered somewhere; one that vanished
is a question to answer by hand.

### The deletions

| Commit | Files | Scale |
|---|---|---|
| `62f0650` "replace drifting doubles with real boundaries" | 12 | −6,473 / +556 lines of tests |
| `3f22d9a` "connect audit coverage to production" | 2 | −826 lines: the pitch-shift property test and the drag-to-paint integration test |
| `1de27d5`, `98f864a`, `c7e6549` (this branch) | 3 | validators, the rename, the reorder matrix |
| `e18b3c7` (this branch) | 1 | the classifier consolidation |

`62f0650` is the one worth noting: **6,473 lines of tests deleted against a
one-line commit message with no body.** The direction is right — the largest
casualty was `mock-durable-object.ts`, a 980-line second implementation of the
Durable Object, which `specs/TESTING.md` explicitly forbids, and its 2,726-line
test was testing that double rather than the product. But a deletion of that
size carries its justification only in the diff.

### What the scan found, and what survived triage

Most vanished literals were **fixture session ids** — `contract-404-test`,
`player-3`, `flush-test`. Names of test data, not knowledge. The signal was
three cases:

**Recovery state names (`applying_snapshot`, `requesting_snapshot`) — correctly
retired.** The deleted test asserted the old three-state recovery enum *no
longer exists*. Those strings are absent from production too, so the guard had
done its job and the states it guarded against are gone. A negative assertion
about a completed migration expires; deleting it was right.

**Three sampled instruments (`french-horn`, `hammond-organ`, `string-section`)
— false alarm.** They looked uncovered because the deleted test hardcoded all
26 instrument ids in a literal array. Six surviving test files reference
`SAMPLED_INSTRUMENTS` and ten reference `isSampledInstrument`, iterating the
constant instead of restating it. The hardcoded list was itself the drift-prone
form: it fails spuriously when an instrument is added and proves nothing extra
when one is not.

**23 synth ids — a real gap, and mine.** `instrument-classification.test.ts`
(deleted in `e18b3c7`, this branch) enumerated 26 `synth:` ids and asserted each
was melodic. My replacement checked nine ids I picked myself: the same
hand-picked-sample weakness, with a smaller sample.

Fixed by making the catalogue the oracle. `INSTRUMENT_CATEGORIES` already files
every instrument under `drums`, `bass`, `keys`, `leads`, `pads` or `fx`, so the
test now walks all 99 ids and asserts each classification matches the category
the picker groups it under. That is broader than the 26 it replaces, and adding
an instrument extends it automatically. Sabotage-verified: filing `synth:organ`
as a drum fails, and removing `sampled:brushes-snare` from the set fails.

The two files deleted in `3f22d9a` came out clean. `pitch-shift.property.test.ts`
went because the worklet it named is not the shipping pitch path; every literal
it held survives elsewhere. `drag-to-paint-integration.test.tsx` looked alarming
— `data-paint-mode` appears nowhere in the suite now — until the deleted source
showed the attribute was set by the test's *own* stub component. It was never a
production selector, so nothing was lost with it. That is the shape to expect
from a well-aimed deletion, and it is why the scan is a triage list rather than
a verdict.

### The larger category: titles removed from surviving files

Deleted *files* are conspicuous. The bigger number is test titles removed from
files that still exist: **636 in the last month** (318 of them on `main`, the
rest from this branch's own rewrites). No file disappears, so nothing draws the
eye, and a rewrite that drops an assertion looks the same in a diff as one that
restates it.

Sweeping those produced one apparent finding and one real methodological lesson,
and the lesson is the more valuable of the two.

`MAX_PLAYERS` is enforced at `live-session.ts:727`. The check that ran in CI,
*"should reject the 11th connection"*, lived in `mock-durable-object.test.ts`
and went with the double in `62f0650`. What survives under that name is in
`test/staging/failure-modes.test.ts`, and `staging` appears in `ci.yml` exactly
once, as `! -path 'e2e/staging/*'` — an exclusion. That staging test is also the
`assertion-swallowed-by-own-catch` instance from Family G above, so even where
it runs it was, until this audit fixed it, green either way.

**And none of that left the limit uncovered.** `da28094` restored it the day
after `62f0650`, in `collaboration-contract.test.ts`, as *"accepts ten
collaborators and rejects the eleventh through the Worker route"* — an
integration test CI runs, asserting the 503, the CORS header, and the body. I
missed it and wrote a duplicate, because I searched for the identifier
`MAX_PLAYERS` and that test spells the limit as `10` and "eleventh". The gap was
one day wide and was already closed.

The lesson §20 draws below is that a grep is not evidence of coverage. I then
used a grep as evidence of its *absence*, which is the same error pointed the
other way and the more dangerous direction: a false negative adds a redundant
test, a false positive of absence would have had me "fix" something that was not
broken. Searching by identifier finds tests that name the constant; it cannot
find tests that assert the behaviour. **Establish coverage by running the lane
against sabotaged production code, not by grepping the suite.** Applied here,
that check answers correctly in one step: break the limit, watch
`collaboration-contract.test.ts` go red.

The duplicate was reverted. What survives is the part of it that was genuinely
new, folded into `da28094`'s test: that refusing the eleventh does not disturb
the ten already in the session, and that the refused upgrade carries no socket.
Sabotage-verified — making the refusal path call `this.players.clear()` leaves
the status, header and body assertions all passing and fails only the new one.

### The lesson, sharpened

Deleting a test is safe when the *knowledge* survives, not when the coverage
number does. Three ways it survives, all seen here:

1. **Superseded** — the thing asserted no longer exists (the recovery enum).
2. **Subsumed** — another test asserts it more generally (`SAMPLED_INSTRUMENTS`
   iterated rather than restated).
3. **Re-expressed** — the same claim, derived from data rather than hardcoded
   (the catalogue-driven classification test).

The failure is a fourth case: **evaporated**, where the assertion was the only
statement of a fact and nothing replaced it. That is what happened to
`recording-123`, and what nearly happened to the synth enumeration.

`MAX_PLAYERS` looked like a third instance and was not. It is worth keeping as
the counter-example: the question is never "does a test mention this?" but
"which lane executes an assertion that can fail when this breaks?" — and that
question is answered by sabotage, in both directions. Grep answers neither.

Checking for it is cheap. `deleted-test-knowledge.ts` took minutes to write and
its output needed about twenty minutes of triage for a month of deletions —
against a live MIDI-export bug, a hand-picked-sample weakness, and an unguarded
connection limit as the return.

One caveat on the numbers this suite reports: the unit count is not fixed.
Several suites build their cases from `readdirSync` over the instrument
directories, so the total moves with which sample assets are present — 5,110
here, 5,183 in an earlier run of the same tree. Only "zero failures" is a
contract; the count is not, and should not be quoted as one.

## §21 — Widening the deletion sweep to the whole recorded history

§20 covered a month. Seven months covers everything `origin/main` records: the
history begins 2026-01-14. **22 deleted test files, 386 test titles removed from
surviving files.** Only four of the deletions predate July, and all four are
clean — but one of them is the best piece of evidence this audit has produced,
and it is three months old.

### The four pre-July deletions

| Commit | Date | File | Verdict |
|---|---|---|---|
| `8f02760` | 03-09 | `lazyAudioLoader.test.ts` | **Superseded** — the module went with it; consumers import `audioEngine` from `engine.ts` directly. Its titles were *"returns a boolean"*, *"can be called multiple times without error"*, *"is idempotent"*: a shim tested at the shim's own level. |
| `6d97bf1` | 04-25 | `worklets/lfo-waveforms.property.test.ts` | **Superseded, and see below.** |
| `61f392a` | 04-26 | `shared-synth-routing.test.ts` | **Superseded** — asserted a broken method *no longer exists*, the same expiring-negative shape as the recovery enum. |
| `b4018a9` | 06-24 | `e2e/instrument-range-render.spec.ts` | **Re-expressed, and strengthened.** |

Two of those were verified rather than taken on trust, which is the whole point
of the exercise. `61f392a`'s body names its replacement — so the replacement was
opened: `per-track-synths.test.ts` asserts *"never disconnects a shared output
when a different track plays (the hijack bug)"*, in the unit lane, on the
behaviour rather than the absence of a method. `b4018a9` moved a Playwright spec
to a node test; the e2e had asserted only `report.length === ids.length`, a
shape check, while the node version asserts that no instrument renders an
`AudioBufferSourceNode` below the silence threshold and that the default
dropped-step pitch is audible. The migration made it stronger.

### The LFO worklet: both halves of the linkage failure in one file

`shared-lfo.worklet.ts` arrived 2026-03-08 in `85cb130`, *"Wire in shared LFO
worklet for AdvancedSynthEngine"*. Its property test opened by explaining
itself:

> These test the pure math functions extracted from `shared-lfo.worklet.ts`.
> Since worklet code can't be imported directly (it runs in a different global
> scope), we re-implement the identical math here and verify its properties.
> Any fix in the worklet must be mirrored here and vice versa.

It was deleted 2026-04-25 in `6d97bf1`, whose body says why:

> Removed unwired shared-LFO worklet code. `AdvancedSynthEngine` created and
> configured a `sharedLfoNode` that was never `.connect()`-ed.

**Forty-eight days.** The test was green throughout and would have stayed green
under any change to the worklet, because it never imported the worklet — and it
would have stayed green under deletion of the worklet, because the worklet was
never connected to the audio graph. Both linkage failures at once: a test not
linked to production, guarding production not linked to anything. Five hundred
property runs per assertion, on a function defined twenty lines above them.

This is the clearest instance in the repository's history of the family drafted
in `docs/upstream-issue-test-linkage.md`, and it argues the case better than the
July examples do, because the file states the anti-pattern in its own docblock
as though it were a design constraint. It is not: the fix is to extract the math
into an importable module the worklet also imports. That is what
`pitch-shift-engine.ts` does now, and it has a differential test against the
worklet to prove the two agree.

### Which files does no lane run?

More literal-hunting had diminishing returns, so the sweep turned to the
structural question underneath it. Of **278** test and spec files on disk, the
unit lane collects 225, the integration lane 9, and Playwright 44. That leaves
**6 files — 103 tests, 226 assertions — that no lane executes**: the five in
`test/staging/` and `e2e/staging/vu-meters.spec.ts`.

Every limit those files exercise was then cross-checked against the lanes that
do run:

| Constant | Files asserting it in a running lane |
|---|---|
| `MAX_STEPS` | 21 |
| `MAX_TEMPO` / `MIN_TEMPO` | 8 |
| `MAX_TRACKS` | 6 |
| `MAX_SWING` | 4 |
| `MAX_MESSAGE_SIZE` | 3 |
| `MAX_VOLUME`, `MAX_TRANSPOSE` | 2 |
| `MAX_PLAYERS` | 1 (`collaboration-contract.test.ts`) |

The staging tier is duplicated, not load-bearing — the correct outcome for a
tier that needs a deployed backend. But 103 unrun tests are 103 tests nobody
maintains, and their assertions rot unobserved: the Family G
`assertion-swallowed-by-own-catch` instance had been sitting in
`failure-modes.test.ts` for months precisely because nothing ever ran it. Either
schedule the tier or accept that it is documentation.

### What bounds this audit

`origin/main` has **two root commits**: `58bb046` (2026-01-14) and `ba99b4d`
(2026-03-08). The second is titled *"refactor: Remove dead note-player.ts module
and test"* and its recorded diff is 775 files and 234,408 insertions with **zero
deletions**. The history is grafted, so the deletion named in that commit's own
subject line is invisible to `--diff-filter=D`.

Every technique here reads recorded diffs, so every technique here inherits that
limit. A deletion audit answers "what did we throw away that git remembers us
throwing away" — which is not the same question, and the gap between them is
exactly as large as the history rewriting that has happened.

## §22 — Continuing to fix: what sabotage found that grep could not

Three sweeps, each following the same rule: find the shape by grep, then decide
by breaking production and watching. Grep proposed 5 + 11 + 12 candidates;
sabotage confirmed 2 + 0 + 2. The three-quarters it eliminated matter as much as
the quarter it kept.

### Vacuous generators — 2 real of 5 flagged

Suites that build their cases from `readdirSync` pass on an empty directory:
nothing to iterate, nothing to compare, green. Moving `public/instruments` aside
proved two of them. `instrument-ranges` compared nothing and reported no
mismatches. `instrument-range-render` rendered nothing and asserted
`summary.length === manifests.length` — `0 === 0`, under a comment reading
"Sanity only".

Both now fail on an empty catalogue: the render suite against
`SAMPLED_INSTRUMENTS`, so a *partial* catalogue also fails, and
`instrument-ranges` on a compared-count floor set well below the current 27.

The other three were fine. `instrument-routing` asserts its manifest ids equal
`SAMPLED_INSTRUMENTS`, `sample-pipeline-decisions` asserts all ten rejections,
`sample-pipeline-runner` reads only directories it creates. Acting on the grep
would have meant "fixing" three working tests.

The same question asked of `.each`-driven suites came back clean for a
structural reason worth writing down: **vitest fails a file when a `describe`
contains no tests**, so an empty `.each` inside its own `describe` self-reports
as `No test found in suite`. Verified with a probe. Emptying `SYNTH_PRESETS`,
`ADVANCED_SYNTH_PRESETS`, `TONE_SYNTH_PRESETS`, `SAMPLED_INSTRUMENTS` and the
three action-classification sets failed every suite that consumes them. The
vulnerable shape is not `.each` — it is the loop that accumulates into an array
and then asserts that array is empty.

### A test that no longer tested anything — `reducer-mutation-equivalence`

Re-running the audit's headline sabotage (`applyMutation` neutered to
`return state`) killed 165 of 4,421. Two of the twelve files that import
`applyMutation` survived, and both were wrong in the same direction.

`reducer-mutation-equivalence.test.ts` — 29 tests, 533 lines — passed in full
with `applyMutation` returning its input untouched. Its premise had expired
without anyone noticing:

> - gridReducer (client) and applyMutation (shared) have duplicate logic

Phase 3 routed every SYNCED case in `gridReducer` through
`delegateToApplyMutation`. Asking the runtime rather than the docblock: **27 of
28 SYNCED actions have no independent client implementation left**;
`SET_SESSION_NAME` is the only exception, and it has no test in the file. Both
sides of every comparison ran the same function, so breaking it broke both sides
identically and the equality held. `f(x) === f(x)`, 29 times, behind an adapter
round-trip that made it look like real work.

It is not worthless — `actionToMessage` and the GridState/SessionState adapters
*are* independent of `applyMutation`, and a break in either still shows up here.
What was missing is the other half of the oracle. Every comparison now goes
through `expectEquivalentAndChanged`, which additionally requires the mutation
to move the state. Under the same sabotage, 28 of 29 now fail.

Two property tests then failed honestly: `arbSwing` draws 0 against a fixture at
swing 0, `arbTranspose` draws 0 against a track at transpose 0. Those runs are
genuine identities, not defects, so they are skipped with `fc.pre` rather than
having the boundary removed from the arbitrary.

### A promise never kept — `sync-layer-coverage`

The second survivor imported `applyMutation as _applyMutation` and never called
it. The underscore is why the linkage checker stayed silent: the module *is*
imported. Its header lists four claims; the fourth, "Round-trip: client → server
→ client produces correct state", had no implementation.

That is precisely the bug class the same header cites — Phase 31B listed pattern
operations in `SYNCED_ACTIONS`, nothing wired them up, and the gap shipped.
`SL-001` only asks that a message is non-null; an action can produce a
well-formed message the server ignores completely and every test still passes.

Implemented: for each routed SYNCED action, build the mock action, convert it,
apply it, and require the state to change. Building it surfaced the fixture trap
immediately — six actions "failed" against a bland fixture because
`createMockAction('SET_TEMPO')` sends 120 to a session already at 120, and
rotate/reverse/mirror/clear are indistinguishable from no-ops on an all-false
pattern. The fixture is now asymmetric and off-default, with the reason written
next to it. `SET_SESSION_NAME` is a documented exception: state-mutations.ts
says `// Only affects metadata, not session state`.

### Where the suite stands

| Sabotage: `applyMutation` → `return state` | Tests killed | Importers surviving |
|---|---|---|
| Audit baseline | 133 / 4,812 | 6 of 12 |
| Start of this pass | 165 / 4,421 | 2 of 12 |
| Now | **215 / 4,444** | **0 of 12** |

Every test file that imports the reducer every multiplayer mutation flows
through now fails when it stops working. That is the number worth tracking —
not the test count, which moves with the sample assets on disk.
