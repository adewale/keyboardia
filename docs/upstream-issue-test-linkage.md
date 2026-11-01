# Draft issue for `adewale/testing-best-practices`

Written during the July 2026 test audit (`docs/TEST-AUDIT-2026-07.md`,
`docs/TEST-PLACEMENT-ANALYSIS.md`). It could not be filed from the session that
produced it — GitHub access there was scoped to `adewale/keyboardia` only — so
it is kept here rather than lost. Copy the body below into a new issue at
https://github.com/adewale/testing-best-practices/issues/new and delete this
file once filed.

---

**Title:** Add an anti-pattern family for tests that aren't linked to the code they claim to test

---

## The gap

The 14 anti-patterns in `references/antipatterns.md` all assume the test is
*connected* to production code, and ask whether it's connected *well*: is the
oracle strong, is the mock faithful, is it deterministic, does it cover the sad
path.

None of them ask the prior question: **does this test exercise the shipped code at
all?**

That question has its own failure modes, and they're invisible to every tool a
team would normally trust. Coverage reports look fine (the code under test *is*
covered — it just isn't the code that ships). Linters are silent. Mutation
testing misses them, because mutating unreachable code produces no test failure
and reads as an equivalent mutant. And the suite is green, which is the whole
problem.

I found four variants in one codebase during a suite audit that used this skill.

## The variants

**1. Tests for unreachable code.** `src/worker/validators.ts` — 345 lines, 64
tests across two files, imported by nothing but those tests, absent from the
build output. A consolidation refactor whose migration never happened: the
module was written, the call sites never changed.

The cost wasn't the wasted tests. The module had tests named `rejects
non-numeric tempo` and `rejects NaN tempo`, while the live path clamped only —
and `clamp(v, 60, 180)` is `Math.max(60, Math.min(180, v))`, which passes a
non-numeric `v` through as `NaN`. A client could set a shared session's tempo to
NaN over the WebSocket, and it was persisted and broadcast to every
collaborator. **64 green tests were describing a protection that did not run,
and the gap they masked was a live state-corruption bug.**

*Detection:* does anything outside the module's own tests import it?

**2. Tests that exercise a reimplementation.** Five test files named for a
module don't import it and define their own copy of its logic instead. All five
copies had drifted:

```
production   globalStep % (track.stepCount ?? DEFAULT_STEP_COUNT)   + bounds check
test copy    globalStep % trackStepCount                            (neither)

production   'sampled:' -> melodic UNLESS in the drums category
test copy    'sampled:' -> return true
```

The consequence is sharper than "the test may be wrong". One of these files has
a test called *"drum samples should NOT show keyboard view"* that never
exercises `sampled:` drums — it *cannot*, because the copy has no such branch.
**The test's reach is bounded by the copy rather than by production, so the
coverage hole is exactly the shape of the divergence.**

Root cause, visible in 4 of the 5: the original is module-private. Someone
wanted to test private logic, couldn't import it, and duplicated it. This is
adjacent to #5 "Testing the mock" but distinct — and worse, because a mock is
obviously a stand-in whereas a copy reads as the real thing.

*Detection:* a test file that names an existing module, doesn't import it, and
defines its own non-fixture functions.

**3. Test files named for a concept rather than the module under test.** In the
same codebase, `invariants.property.test.ts` imported `./validation` and never
`./invariants`, while `validators.property.test.ts` imported `./invariants`. The
names were inverted. Four modules there mean roughly "check the values"
(`validation.ts`, `invariants.ts`, `validators.ts`, `shared/validation.ts`), and
the labels drifted off the code.

This one is cheap to prevent and self-enforcing: if `foo.test.ts` doesn't import
`foo`, one of the two names is wrong.

**4. Scope defined by negation.** The same file's header read:

> "Tests invariants from invariants.ts, validation.ts, and state-mutations.ts
> **that weren't covered by validators.property.test.ts**."

A boundary defined as another file's complement is invisible from inside the
file, unenforceable by any tool, and stale the moment either file changes. It
rotted until the file no longer imported `invariants.ts` at all — and then the
file it was defined *against* was deleted, leaving the header pointing at
nothing.

## Why I think it belongs in the skill

The existing 14 are about **test quality**. This family is about **test
linkage**, and it's upstream of all of them: a perfectly-written test with a
strong oracle, faithful mocks and full sad-path coverage is still worthless if
it isn't pointed at the shipped code. It also fits the skill's existing framing —
step 4 (tier integrity) already asks "do integration tests exercise claimed
boundaries", which is the same question one level up.

Concretely, I'd suggest:

- entries in `references/antipatterns.md`, roughly: *Testing unreachable code*
  (P0 — false confidence, actively masks bugs), *Testing a reimplementation*
  (P1), *Test named for a concept, not a module* (P2), *Scope defined by
  negation* (P2);
- a step in the 7-step audit between "sabotage detection" and "oracle strength":
  **verify the test's subject is reachable from production** — because oracle
  strength is meaningless if the subject never runs;
- a note in the validation loop: *for each module under test, confirm a
  non-test importer exists*.

## Detection is cheap and mostly static

I wrote a checker for this codebase (~90 lines, no deps) that reports all three
mechanical variants. Three lessons from building it, if it's useful:

- The naive version reported 34 findings, half noise. `index.ts` barrels,
  `__fixtures__`, and test-helper directories are *correctly* test-only;
  `*.worker.ts` / `*.worklet.ts` are loaded by URL and never imported. Excluding
  those took it to 17.
- An import-only regex reports dynamically-imported modules as dead — one module
  was reached solely via `await import('./mcp')`. Any implementation needs to
  match both forms.
- **Module granularity isn't enough.** A module can pass "something imports me"
  while most of its exported surface fails it. One module here exported five
  functions; one was live, and the four unused ones had drifted into a units bug
  (seconds passed into a parameter named `startSample`, then divided by the
  sample rate a second time). A per-export check would have caught it; the
  per-module check did not.

Happy to contribute the checker or a reference implementation if that's useful.
