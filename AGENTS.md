# Agent guide

Keyboardia is a multiplayer step sequencer: a React client, a Cloudflare Worker
with Durable Objects, and an MCP server. Code and tests live in `app/`; run the
commands below from `app/`. Testing policy is enforced by executable gates, so
this file lists them rather than restating them. Details: `specs/TESTING.md`.

## Verify a change

| Tier | Command | When |
|---|---|---|
| T0 | `npm run validate:manifests && npm run validate:e2e-inventories && npm run test:unit` | Before every push. The pre-push hook runs exactly this. |
| Heavy unit lanes | `npm run test:audio-render` and `npm run test:verification-tooling` | When you touch audio rendering or the verification tooling. CI runs both on every PR. |
| T1 | `KEYBOARDIA_VERIFY_T1=1 git push` | Targeted browser lanes. CI picks T1 profiles from the changed paths (`scripts/select-verification-scope.mjs`, `e2e/verification-impact.json`); an unmatched path selects every profile. |
| T2 | `KEYBOARDIA_VERIFY_T2=1 git push` | Full desktop browser matrix against a local Worker. CI runs it on push to `main`, weekly and on dispatch. |

Also run what CI runs for the files you touched: `npm run lint`,
`npm run typecheck`, `npm run validate:test-quality`, and
`npm run test:integration` (Workers runtime; run `npm ci` in `test/integration`
first).

## Gates CI blocks on

- `validate:test-antipatterns`: tests that cannot fail (swallowed assertions,
  runtime self-skips, tautologies, tests with no assertion).
- `validate:test-links`: a test must import the module it is named after and
  must not reimplement it; a module imported only by its tests is dead.
- `validate:dead-exports`: no runtime export that only tests reach.
- `validate:unrun-tests`: every test file is collected by some lane.
- Playwright lane contracts (`scripts/assert-playwright-stats.mjs`): exact
  passed and skipped counts, `flaky: 0`, `unexpected: 0`, and exact test
  identities from `e2e/lane-contracts.json` and `e2e/lane-identities.json`.
  Adding, renaming or skipping an E2E test means updating those files in the
  same change (`npm run update:e2e-lane-identities`), where a reviewer sees it.

## Rules

- Never add retries, skips, `continue-on-error`, `|| true`, or a larger
  timeout to make a check pass. Find the cause. If a test is genuinely heavy,
  move it to the right lane with a measurement.
- A bug fix comes with a regression test that fails when the fix is reverted or
  disabled. Show that control in the PR (see the PR template).
- Do not create a second in-memory implementation of `LiveSessionDurableObject`.
  Exercise the real one in the Workers runtime (`test/integration`) or through
  a local Worker.
- Tests and dev servers never talk to a deployed Worker. Browser lanes use
  `USE_MOCK_API=1` or a Worker the run starts itself (`npm run test:e2e:full-stack`).
- Missing capabilities fail, they do not skip: use `requireOfflineAudio()` from
  `src/test/session-render.ts` for native audio.
- The unit lane has a 15-second global timeout. A measured slow test may
  declare a local timeout in that test; raising the global is a review event.

## Background

- `specs/TESTING.md`: where a test goes, lanes, and the gates in detail.
- `docs/TEST-AUDIT-2026-07.md`: why each gate exists.
- `docs/LESSONS-LEARNED.md`: history, not policy. Where an older lesson
  conflicts with a gate or a rule above, the gate and the rule win.
