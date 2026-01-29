# Playwright E2E Testing

E2E tests live in `app/e2e/`. Run with `npm run test:e2e`.

## Key Decisions

### WebSocket Tests Are Local-Only

Tests requiring real WebSocket (multiplayer sync, connection storms) skip in CI:

```typescript
test.skip(!!process.env.CI, 'Requires real WebSocket backend');
```

**Why:** CI should be reliable and fast. WebSocket tests need `wrangler dev` running.

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

Set `USE_MOCK_API=1` for CI to avoid backend dependencies. The mock API provides deterministic responses for session creation and loading.

## Configuration

See `app/playwright.config.ts` for browser projects, timeouts, and retries.
