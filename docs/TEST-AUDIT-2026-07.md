# Test Suite Audit — July 2026

Audit of the Keyboardia test suite against the anti-pattern catalogue and 7-step
quality framework in [adewale/testing-best-practices](https://github.com/adewale/testing-best-practices).

## Scope and baseline

| Metric | Value |
|---|---|
| Test files | 250 (`src` 172, `e2e` 36, `test` 42) |
| Test LOC | 85,065 |
| Unit suite | 4,812 passing, 1 skipped, 190 files, 39s |
| `expect()` calls | 8,381 |
| Weak sole assertions (`toBeDefined`/`toBeTruthy`/`not.toBeNull`) | 382 (4.6%) |

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

### 3. Nullified assertions — `.catch(() => {})` on an `expect`

The assertion runs, rejects, and the rejection is swallowed.

- `e2e/visual.spec.ts:96, 212, 231`
- `e2e/keyboard.spec.ts:137`

```ts
await expect(stepCell).toHaveClass(/active/).catch(() => {});   // never fails
```

Distinct from `.catch(() => {})` on a `waitFor`/`click` (16 further sites), which
is tolerant *setup* — undesirable but not a nullified oracle.

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

### 5. Fault-masking assertions

- `src/utils/detect-hotspots.test.ts:33, 45` — `output = (err as {stdout?: string}).stdout ?? ''`, then `expect(output).not.toContain('orphaned-vitest-config')`. If the script crashes with no stdout, `output` is `''` and the negative assertion passes. A crash reads as a pass.
- `src/utils/dead-code-audit.test.ts:34` — `isImportedBy()` returns `false` on any grep failure, so every "symbol is not imported" assertion passes vacuously when grep breaks.

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

---

## P2 — Hygiene

- **120 `waitForTimeout` calls** in e2e — fixed sleeps instead of web-first assertions. Concentrated in `phase3-refactoring.spec.ts` (34) and `track-reorder-comprehensive.spec.ts` (29).
- **57 fallback locators** — `page.locator('.a, .b').or(page.locator('[data-testid=c]'))`. A test passes if *any* variant matches, so it cannot detect the UI drifting away from the intended selector. Worst: `core.spec.ts` (9), `new-session.spec.ts` (8).
- **2 `expect(true).toBe(true)` "documentation tests"** — `src/shared/copy-paste-range.test.ts:421`, `src/components/drag-to-paint.test.tsx:1352`. Both are 20-line explanatory comments wrapped in a passing test, inflating the green count with prose.
- **~130 decorative `expect(screen.getByText('X')).toBeTruthy()`** (`EffectsPanel.test.tsx` has 19) — `getByText` already throws when absent; the assertion adds nothing. Harmless, low priority.
- **No coverage or mutation ratchet** — `vitest.config.ts` thresholds and Stryker `break: null` are both deliberately informational. Reasonable as a choice; worth revisiting once P0/P1 land.

---

## Remediation plan

Ordered by (signal gained) ÷ (effort). Phase 1 and 2 are independent and can
land in parallel.

### Phase 1 — Delete or fix the tests that cannot fail (~½ day)

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
Target for the file: ≥20/24 tests failing under sabotage, up from 5/24.

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

### Phase 2 — Make E2E mean something (~1 day, mostly CI config)

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

### Phase 3 — Strengthen weak properties (~½ day)

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

### Phase 4 — Hygiene (opportunistic)

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

## Suggested sequencing

| Phase | Effort | Gates on | Signal gained |
|---|---|---|---|
| 1 | ½ day | — | 15 always-green tests become real; sabotage detection in the convergence suite goes 5/24 → ≥20/24 |
| 2 | 1 day | — | 36 e2e specs go from advisory to gating; 13 real-backend specs execute for the first time |
| 3 | ½ day | Phase 1 | Convergence properties constrain behaviour instead of admitting a no-op |
| 4 | ongoing | Phase 2 | Prevents regrowth; ~12 files leave the Workers pool |

Phase 2 is the one to do first if only one gets done. Phase 1 fixes 15 bad tests;
Phase 2 fixes the reason nobody noticed them.
