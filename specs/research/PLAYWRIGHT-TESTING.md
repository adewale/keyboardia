# Playwright E2E Testing

E2E tests live in `app/e2e/`. Run with `npm run test:e2e`.

## Key Decisions

### WebSocket Tests Need a Real Backend

Mock-mode results do not establish WebSocket, Durable Object, or publication fidelity. Backend-dependent specs are advisory in the default CI E2E job and may skip where they explicitly require `wrangler dev`; run them against a real local or staging backend for authoritative sync evidence.

**To run locally:**
```bash
cd app && npx wrangler dev  # Terminal 1
npm run test:e2e            # Terminal 2
```

### Pre-Push Hook

The pre-push hook (`app/.husky/pre-push`) runs E2E tests before pushing:

1. **Smoke test** - Fast Chromium-only check
2. **Full test** - All browsers if smoke passes

Requires `wrangler dev` on port 8787. Skip with `git push --no-verify`.

### Mock API for CI

Set `USE_MOCK_API=1` for deterministic local/session-contract coverage. The Vite mock reuses production validation and default construction, but it is still limited evidence and must not be used to infer WebSocket or Durable Object behavior.

### Required CI Contracts

- `app/e2e/mock-compatible-files.txt` is the reviewed blocking manifest: five files and exactly 65 Chromium tests.
- Blocking tests use zero retries and require 65 expected, zero skipped, zero flaky, and zero unexpected results from the Playwright JSON report.
- Advisory and blocking runs use separate output, JSON, and HTML paths so one run cannot erase another's diagnostics.
- Motion tests open production controls; injecting synthetic CSS fixtures is not acceptable evidence.
- Deterministic Holby visual tests run on `macos-14` against macOS-only baselines and require two ordinary passes with zero retries/skips.
- Traces, screenshots, videos, JSON, and HTML reports are retained whenever the E2E job or advisory step fails.

## Configuration

See `app/playwright.config.ts` for browser projects, timeouts, retry defaults, and environment-controlled report/output paths. The blocking workflow always overrides retries to zero.
