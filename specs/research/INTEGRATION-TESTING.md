# Integration Testing with vitest-pool-workers

## Overview

This document captures lessons learned from setting up Cloudflare Workers integration tests using `@cloudflare/vitest-pool-workers`.

**Related files:**
- `test/integration/` — Integration test directory
- `test/integration/vitest.config.ts` — Workers pool configuration
- `test/integration/live-session.test.ts` — DO and router tests

---

## Key Decisions

### Separate Test Directory

We use a separate `test/integration/` directory with its own `package.json` because:

1. **vitest version conflict** — `vitest-pool-workers` requires vitest 2.0.x-3.2.x, but our unit tests use vitest 4.x
2. **Different test runners** — Unit tests run in Node.js, integration tests run in Miniflare
3. **Isolated dependencies** — Workers-specific types and tooling stay contained

```
test/
└── integration/
    ├── package.json       # vitest 3.x + vitest-pool-workers
    ├── vitest.config.ts   # Workers pool configuration
    ├── tsconfig.json      # Workers-specific types
    └── live-session.test.ts
```

### Disabled Isolated Storage

We set `isolatedStorage: false` in `vitest.config.ts` because our worker uses `ctx.waitUntil()` for fire-and-forget logging:

```typescript
// vitest.config.ts
export default defineWorkersProject({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,  // Required for waitUntil() usage
        wrangler: {
          configPath: '../../wrangler.jsonc',
        },
      },
    },
  },
});
```

**Why this matters:**
- `isolatedStorage: true` expects all storage operations to complete within the test
- `waitUntil()` creates promises that outlive the request/test context
- The "Failed to pop isolated storage stack frame" error occurs when storage ops are pending

**Trade-offs:**
- Tests share storage state (not automatically cleaned between tests)
- Tests must be designed to be independent or use unique keys
- Can't use `listDurableObjectIds()` to verify cleanup

---

## Patterns

### Consuming Response Bodies

Always consume response bodies to prevent isolated storage issues:

```typescript
// GOOD - consume body even if not asserting content
const response = await stub.fetch('http://placeholder/debug');
expect(response.status).toBe(200);
const body = await response.json();  // Consume!
expect(body).toHaveProperty('connectedPlayers');

// ALSO GOOD - consume with text() if not parsing
const errorResponse = await stub.fetch('http://placeholder/invalid');
expect(errorResponse.status).toBe(404);
await errorResponse.text();  // Consume!
```

### Direct DO Instance Access

Use `runInDurableObject()` to access internal state for white-box testing:

```typescript
import { runInDurableObject } from 'cloudflare:test';

it('can access internal state', async () => {
  const stub = env.LIVE_SESSIONS.get(env.LIVE_SESSIONS.idFromName('test'));

  // Initialize the DO first
  await stub.fetch('http://placeholder/debug');

  // Then access internals
  await runInDurableObject(stub, async (instance) => {
    expect(instance).toHaveProperty('players');
    expect(instance).toHaveProperty('state');
  });
});
```

### Testing Alarms

Use `runDurableObjectAlarm()` to immediately execute scheduled alarms:

```typescript
import { runDurableObjectAlarm } from 'cloudflare:test';

it('alarm saves to KV', async () => {
  // Trigger a state change that schedules an alarm
  // ...

  // Execute alarm immediately (don't wait 5 seconds)
  const alarmRan = await runDurableObjectAlarm(stub);
  expect(alarmRan).toBe(true);

  // Verify side effects
  const stored = await env.SESSIONS.get('session:test');
  expect(stored).not.toBeNull();
});
```

---

## What We Learned

### 1. WebSocket Tests Are Fragile

WebSocket upgrade tests can interfere with isolated storage cleanup. We removed tests that:
- Connect multiple WebSocket clients
- Hold connections open while verifying state
- Send messages and wait for responses

**Alternative approaches:**
- Test WebSocket logic via unit tests with mocks
- Use Playwright E2E tests for real WebSocket behavior
- Keep integration tests focused on HTTP endpoints

### 2. waitUntil() and Testing Don't Mix

Fire-and-forget operations via `ctx.waitUntil()` create problems for isolated storage testing. Options:

1. **Disable isolated storage** (what we did)
2. **Make logging conditional** — Skip logging in test environment
3. **Await logging in tests** — Modify code to return promises for testing

We chose option 1 because:
- No code changes required
- Tests still exercise real behavior
- Trade-off (shared state) is acceptable

### 3. Test File Discovery

Vitest 4.x was picking up test files inside `test/integration/node_modules/` (from dependencies like `zod` that ship with tests). We fixed this by:

1. Creating `vitest.config.ts` in the root
2. Explicitly excluding `test/integration/**`

```typescript
// vitest.config.ts (root)
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      'test/integration/**',  // Integration tests use their own config
    ],
  },
});
```

### 4. npm Scripts Organization

Clear separation of test types:

```json
{
  "scripts": {
    "test": "npm run test:unit",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:integration": "cd test/integration && npm test",
    "test:all": "npm run test:unit && npm run test:integration"
  }
}
```

---

## When to Use Each Test Type

| Test Type | Use For | Speed | Fidelity |
|-----------|---------|-------|----------|
| **Unit (vitest 4.x)** | Business logic, reducers, pure functions | Fast | Low |
| **Unit with mocks** | WebSocket handling, network retry | Fast | Medium |
| **Integration (workers pool)** | Real DO/KV behavior, routing | Medium | High |
| **E2E (Playwright)** | Multi-client sync, browser audio | Slow | Highest |

**Current coverage:**
- Unit: 443 tests
- Integration: 7 tests
- E2E: 0 tests (deferred to Phase 22)

---

## Future Improvements

1. **Add E2E tests** (Phase 22) for:
   - Multi-client WebSocket sync
   - Audio timing verification
   - Cross-browser compatibility

2. **Consider test utilities:**
   - Session factory functions
   - WebSocket test helpers
   - Clock sync verification helpers

3. **CI/CD integration:**
   - Run unit tests on every PR
   - Run integration tests on main branch
   - Run E2E tests nightly or on release

---

## References

- [Cloudflare Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [vitest-pool-workers Examples](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples)
- [Known Issues: Isolated Storage](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage)
