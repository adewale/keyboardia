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

**Fixed.** The single `continue-on-error` job is now three jobs: `e2e-tests`
(mock API, **gating**), `e2e-real-backend` (`wrangler dev` via the existing but
never-CI-wired `test:e2e:full-stack` script, advisory pending a few green runs),
and `e2e-visual` (advisory pending baseline confirmation on the runner image).
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

**2c. Un-skip `e2e/visual.spec.ts` in CI** or delete it. Committing chromium
baselines and running them on the pinned CI image makes 12 screenshot assertions
real; leaving `test.skip(isCI)` in place means the file is dead weight. Either is
defensible — the status quo is not.

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
| 2 — make E2E mean something | ✅ done | mock-API job gating (91 failures → 2 environmental); 12 specs correctly labelled real-backend; `visual.spec.ts` runs in CI for the first time |
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

The job stays advisory for one remaining reason: these specs have never run in
CI, so the first runs are expected to surface genuine failures. That is the job
working. Promote it by deleting `continue-on-error` once it has been green a few
times.

Note it complements, rather than duplicates, the `test:e2e:collaboration:worker`
step already in `e2e-tests`: that runs the collaboration contract subset and is
gating; this runs the whole real-backend suite.

**2. Missing visual baselines.** Resolved structurally by
`.github/workflows/visual-baselines.yml` — a `workflow_dispatch` job that
regenerates baselines *on the runner image*, so they never have to come from a
developer machine (the original reason `visual.spec.ts` was skipped in CI at
all). It uploads them as an artifact by default, and can push them to a branch
for image-by-image review. It deliberately never runs automatically: a baseline
that updates itself is the blind-snapshot-update anti-pattern, where a real
regression is absorbed into the expected output.

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

### §13 — Two checkers instead of two plugins (4d, done)

`eslint-plugin-vitest` and `eslint-plugin-playwright` are not installed here and
pulling in two plugins to get five rules was a poor trade, so the rules are two
dependency-free scripts instead:

| Script | npm | Detects | CI |
|---|---|---|---|
| `scripts/check-test-antipatterns.ts` | `validate:test-antipatterns` | nullified assertions, runtime self-skips, tautologies, self-comparisons, zero-assertion tests | **gating** |
| `scripts/check-test-subject-links.ts` | `validate:test-links` | ORPHAN (names a module it never imports), REIMPL (copies the logic it claims to test), DEAD (module imported only by its tests) | advisory |

Both run in the `lint` job. `npm run validate:test-quality` runs the pair.

**The lesson from building the first one.** Its first run reported 17 findings,
13 of which were *this document* and the explanatory comments written during
the audit — every place the prose described `expect(true).toBe(true)` was
reported as an instance of it. A checker whose output is mostly noise gets
muted, which would have been worse than not having it. It now strips comments
and string bodies before matching, and is verified against a probe file
containing one real instance of each pattern plus decoys (comment mentions, a
multi-line `async ({ page, request })` signature, an inline
`JSON.stringify({...})`): 5 real findings, 0 false.

Two parser bugs that mattered, both in the zero-assertion rule:

- The block scanner ended a test body at the first line matching `^\s*\}\)`.
  That is also how `}));` closing an inline object literal looks, and how the
  `}) => {` of a destructured multi-line signature looks. Four healthy tests
  were reported as assertion-free. The terminator now has to *end* the line.
- Named assertion helpers (`pollKvTempo`, `expectSessionSynced`) count as
  assertions; requiring a literal `expect(` reported helper-driven tests as
  empty.

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

**`src/audio/slicer.ts` — 26 tests, 8/8 sabotage kills.**

Only `detectTransients` shipped. `sliceByTransients`, `sliceEqual`,
`extractSlice` and `autoSlice` were imported by nothing — `Recorder.tsx` calls
`detectTransients` and does its own cutting inline, correctly, in samples. The
unused half had drifted, and two defects had accumulated behind the silence:

1. **Units.** `sliceByTransients` assigned `detectTransients`' *seconds* straight
   to a field named `startSample`, then divided by the sample rate a second
   time. `autoSlice(ctx, buf, 'transient')` asked `createBuffer` for a
   fractional length — which throws in the good case and yields a one-frame
   buffer of silence in the quiet one.
2. **Dropped audio.** It started the first slice at the first onset while its own
   comment said "start and end will be added", so everything before the first
   hit was discarded. A recording with a count-in lost the count-in.

Both are repaired rather than deleted. All four exports now have tests, `Slice`
is only ever constructed through one helper so its sample- and second-valued
fields cannot disagree, `extractSlice` clamps out-of-range slices instead of
writing NaN samples, and both slicing functions guarantee their slices tile the
source buffer exactly. `docs/AUDIO-CONTENT-TOOLS.md` documented these with a
call signature that did not match the code — corrected.

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
| `slicer`: **reintroduce the original units bug** (seconds as sample indices) | ✅ (4 tests) |
| `slicer`: drop the leading slice again | ✅ (4 tests) |
| `slicer`: remove `extractSlice`'s range clamp | ✅ |
| `slicer`: `sliceEqual` drops the trailing remainder | ✅ |
| `slicer`: `makeSlice` skips the seconds conversion | ✅ |
| `slicer`: off-by-one in `extractSlice`'s copy | ✅ |
| `slicer`: ignore `maxSlices` | ✅ |
| `slicer`: remove `sliceEqual`'s non-positive guard | ✅ |
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
