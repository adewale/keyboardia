# Testing Cloudflare Durable Objects: Comprehensive Research

**Date**: 2025-12-10
**Status**: Research Complete

## Executive Summary

This document provides comprehensive guidance on testing Cloudflare Durable Objects, based on official Cloudflare documentation, community best practices, and real-world examples. It covers testing strategies, tools, configuration, common pitfalls, and practical examples.

**Key Finding**: Cloudflare strongly recommends using the `@cloudflare/vitest-pool-workers` package with Vitest for testing, as it runs tests in the same `workerd` runtime used in production, eliminating behavior mismatches between tests and deployed code.

---

## Table of Contents

1. [Official Cloudflare Testing Guidance](#official-cloudflare-testing-guidance)
2. [Testing Patterns and Strategies](#testing-patterns-and-strategies)
3. [Tools and Frameworks](#tools-and-frameworks)
4. [Mocking Strategies](#mocking-strategies)
5. [Setup and Configuration](#setup-and-configuration)
6. [Testing Patterns with Code Examples](#testing-patterns-with-code-examples)
7. [Common Pitfalls and How to Avoid Them](#common-pitfalls-and-how-to-avoid-them)
8. [Best Practices](#best-practices)
9. [Real-World Examples](#real-world-examples)
10. [Additional Resources](#additional-resources)

---

## Official Cloudflare Testing Guidance

### Recommended Approach

Cloudflare's official position is clear: **use the Workers Vitest integration** for testing Workers and Pages Functions projects.

**Source**: [Improved Cloudflare Workers testing via Vitest and workerd](https://blog.cloudflare.com/workers-vitest-integration/)

### Why Vitest Integration?

For the first time, developers can write unit tests that run within the **same runtime that Cloudflare Workers run on in production**, providing greater confidence that the behavior of your Worker in tests will be the same as when deployed to production.

**Key Capabilities**:
- Direct access to Workers runtime APIs and bindings
- Per-test isolated storage
- Runs fully-locally using Miniflare
- Declarative interface for mocking outbound requests
- Tests connected resources like R2, KV, and Durable Objects
- Multiple Workers applications testing

**Source**: [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

### Official Testing Documentation

Cloudflare provides comprehensive testing documentation with full code examples:

- **Testing with Durable Objects**: [Official Guide](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)
- **Best Practices**: [Durable Objects Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/)
- **Miniflare Durable Objects Storage**: [Testing Documentation](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/)

---

## Testing Patterns and Strategies

### 1. Unit Testing

**Definition**: In a Workers context, a unit test imports and directly calls functions from your Worker then asserts on their return values.

**For Durable Objects**: Use the `runInDurableObject()` function to execute code within a Durable Object's context, allowing you to:
- Call or spy on Durable Object methods
- Access persisted data directly
- Test instance methods and state like standard JavaScript classes

**Source**: [Improved Cloudflare Workers testing via Vitest and workerd](https://blog.cloudflare.com/workers-vitest-integration/)

**Example Pattern**:
```typescript
import { env, runInDurableObject } from "cloudflare:test";
import { it, expect } from "vitest";
import { Counter } from "./index.ts";

it("increments count", async () => {
  const id = env.COUNTER.newUniqueId();
  const stub = env.COUNTER.get(id);

  // Test through normal stub interface
  let response = await stub.fetch("https://example.com");
  expect(await response.text()).toBe("1");

  // Test using runInDurableObject to inspect internal state
  response = await runInDurableObject(stub, async (instance: Counter, state) => {
    expect(instance).toBeInstanceOf(Counter);
    expect(await state.storage.get<number>("count")).toBe(1);

    const request = new Request("https://example.com");
    return instance.fetch(request);
  });

  expect(await response.text()).toBe("2");
});
```

**Source**: [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

### 2. Integration Testing

**Definition**: Integration tests verify how multiple components work together.

**SELF Service Binding**: The integration provides a special `SELF` service binding from the `cloudflare:test` module. `SELF` is a service binding to the default export defined in the main Worker.

**Usage**:
```typescript
import { SELF } from "cloudflare:test";

it("integration test", async () => {
  const response = await SELF.fetch("https://example.com");
  expect(response.status).toBe(200);
});
```

**Important Note**: The main Worker runs in the same isolate/context as tests, so any global mocks will apply to it too.

**Source**: [Improved Cloudflare Workers testing via Vitest and workerd](https://blog.cloudflare.com/workers-vitest-integration/)

### 3. End-to-End Testing with `unstable_dev`

**Pattern**: Use `unstable_dev` from Wrangler combined with Vitest to create integration tests that spin up your Worker and test Durable Object behavior through HTTP requests.

**Example**:
```typescript
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

describe("Worker", () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev("src/index.ts", {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it("handles request", async () => {
    const response = await worker.fetch("http://example.com/path", {
      method: "POST",
      body: "data",
    });
    expect(response.status).toBe(200);
  });
});
```

**Source**: [Testing with Durable Objects - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)

### 4. Testing Durable Object State Management

**Key Test Scenarios**:

1. **Same-path routing**: Verify that POST requests to a path correctly update state accessible to subsequent GET requests on that same path
2. **Path isolation**: Confirm different paths maintain separate Durable Object instances with independent state
3. **State mutation prevention**: Ensure the same POST data isn't processed multiple times when new data arrives
4. **Asynchronous request handling**: Test coordination between concurrent requests

**Source**: [Testing with Durable Objects - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)

---

## Tools and Frameworks

### 1. Vitest with `@cloudflare/vitest-pool-workers`

**Recommended Tool**: Primary testing framework for Cloudflare Workers and Durable Objects.

**Why Vitest?**
- Popular JavaScript testing framework
- Very fast watch mode
- Jest compatibility
- Out-of-the-box TypeScript support
- ES modules and hot-module reloading

**Package**: `@cloudflare/vitest-pool-workers`

**Installation**:
```bash
npm install --save-dev @cloudflare/vitest-pool-workers vitest
```

**Supported Versions**: Currently works with Vitest 2.0.x - 3.2.x

**Source**: [Configuration - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

### 2. Miniflare

**What is Miniflare?**
A fully-local simulator for Cloudflare Workers that executes your Worker code using the same runtime used in production: `workerd`.

**Integration**: Miniflare is integrated directly into Wrangler and powers local development through `wrangler dev`.

**Key Features for Testing**:
- Isolated storage for KV namespaces, caches, Durable Objects, and D1 databases in each test
- Auto-discovery of external services and Durable Objects running on another Miniflare instance
- Persistence to file system with Durable Object persistence option
- Making requests to Durable Objects from outside a Worker using `getDurableObjectNamespace`

**Note on Versions**: Miniflare v2 is now deprecated. Since the release of Miniflare v3 in 2023, almost 90% of Miniflare installations are of v3. New versions use the open-sourced Workers runtime `workerd`.

**Sources**:
- [Miniflare Durable Objects - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/)
- [Miniflare 2.0 announcement](https://blog.cloudflare.com/miniflare/)

### 3. Wrangler Dev

**Purpose**: Local development and testing tool.

**Usage**:
```bash
wrangler dev              # Run locally with Miniflare
wrangler dev --remote     # Test against Cloudflare's network
```

**Local Development Features**:
- Creates standalone, local-only environment mirroring production
- Stores data in `.wrangler/state` folder
- Supports hot-reloading (with some limitations for alarms)
- Integration with Miniflare for fully-local testing

**Remote Development**:
`wrangler dev --remote` opens a tunnel from your local development environment to Cloudflare's global network, letting you test your Durable Objects code in the Workers environment as you write it.

**Important Limitation**: `wrangler dev` has read access to Durable Object storage, but writes are kept in memory and will not affect persistent data (unless you specify `script_name` explicitly in the Durable Object binding).

**Sources**:
- [Development & testing - Cloudflare Workers docs](https://developers.cloudflare.com/workers/development-testing/)
- [Troubleshooting - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

### 4. Wrangler Tail

**Purpose**: Debugging tool for deployed Workers and Durable Objects.

**Usage**:
```bash
wrangler tail
```

**Features**:
- Displays live feed of console and exception logs
- Shows logs for each request served by your Worker code
- Includes both normal Worker requests and Durable Object requests

**Source**: [Troubleshooting - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

---

## Mocking Strategies

### 1. Direct Access with `runInDurableObject()`

**Purpose**: Access Durable Object internals for inspection and mocking.

**Function Signature**:
```typescript
runInDurableObject<O extends DurableObject, R>(
  stub: DurableObjectStub,
  callback: (instance: O, state: DurableObjectState) => R | Promise<R>
): Promise<R>
```

**How It Works**:
1. Temporarily replaces the Durable Object's fetch() handler with your callback
2. Sends a request to the Durable Object
3. Returns the result

**Capabilities**:
- Mock particular methods and properties of Durable Objects
- Spy on method execution
- Access persisted data directly
- Test instance methods and state

**Important Limitation**: Only works with stubs pointing to Durable Objects defined in the **main Worker**. Durable Objects defined in auxiliary workers cannot be accessed directly.

**Source**: [Improved Cloudflare Workers testing via Vitest and workerd](https://blog.cloudflare.com/workers-vitest-integration/)

### 2. Isolated Storage

**Configuration**:
```javascript
// vitest.config.js
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        isolatedStorage: true, // Default
      },
    },
  },
});
```

**Behavior**:
- When enabled, writes to storage performed in a test are automatically undone at the end
- Test's storage environment is copied from the containing suite
- `beforeAll()` hooks can be used to seed data
- Per-test isolated storage ensures test independence

**Important Note**: Incompatible with `.concurrent` tests.

**Source**: [Configuration - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

### 3. Mocking Outbound Requests

**Feature**: The Vitest integration provides a declarative interface for mocking outbound `fetch()` requests.

**Implementation**: Uses undici's MockAgent for this functionality.

**Status**: Deactivated by default and reset before running each test file.

**Source**: [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

### 4. Migration from Miniflare 2

**Legacy Functions** (now deprecated):
- `getMiniflareDurableObjectStorage()`
- `getMiniflareDurableObjectState()`
- `getMiniflareDurableObjectInstance()`
- `runWithMiniflareDurableObjectGates()`

**Modern Replacement**: All replaced with the single `runInDurableObject()` function.

**Rationale**: Consolidating these functions simplifies the API surface and ensures instances are accessed with the correct request context and gating behavior.

**Source**: [Migrate from Miniflare 2 - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-miniflare-2/)

---

## Setup and Configuration

### Step 1: Install Dependencies

```bash
npm install --save-dev @cloudflare/vitest-pool-workers vitest
```

**Note**: Modern versions of npm will install the peer dependency on vitest automatically, but it's recommended to install it explicitly.

### Step 2: Create Vitest Configuration

**File**: `vitest.config.js` or `vitest.config.ts`

```javascript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        isolatedStorage: true,
        singleWorker: true, // Optional: improves performance for many small test files
      },
    },
  },
});
```

**Source**: [Configuration - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

### Step 3: Configure Wrangler

**File**: `wrangler.toml`

```toml
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { name = "COUNTER", class_name = "Counter" }
]

[[migrations]]
tag = "v1"
new_classes = ["Counter"]
```

**Requirements**:
- Compatibility date must be after "2022-10-31"
- Enable `nodejs_compat` compatibility flag

**Source**: [Configuration - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

### Step 4: TypeScript Setup

**File**: `tsconfig.json` (in your tests folder)

```json
{
  "compilerOptions": {
    "types": ["@cloudflare/vitest-pool-workers"]
  },
  "include": [
    "**/*.test.ts",
    ".wrangler/types/**/*.d.ts"
  ]
}
```

**Purpose**:
- Defines types for `cloudflare:test` module
- Includes output of `wrangler types` for proper type checking

**Source**: [Configuration - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

### Step 5: Key Configuration Options

#### `main` (string, optional)
Entry point to Worker run in the same isolate/context as tests.

**Required for**:
- Using `import { SELF } from "cloudflare:test"` for integration tests
- Durable Objects without an explicit `scriptName` if classes are defined in the same Worker

**Note**: Accepts TypeScript files that go through Vite transforms. Automatically reads from wrangler.toml if `wrangler.configPath` is defined.

#### `isolatedStorage` (boolean, optional)
**Default**: `true`

Enables per-test isolated storage where writes are undone after each test. Storage environment copies from parent suite, allowing `beforeAll()` hooks to seed data.

**Important**: Incompatible with `.concurrent` tests.

#### `singleWorker` (boolean, optional)
**Default**: `false`

Runs all tests serially in the same Worker with shared module cache. Can improve performance for projects with many small test files.

**Source**: [Configuration - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

---

## Testing Patterns with Code Examples

### Pattern 1: Basic Durable Object Testing

**Durable Object Implementation**:
```typescript
export class Counter {
  constructor(readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    let count = (await this.state.storage.get<number>("count")) ?? 0;
    void this.state.storage.put("count", ++count);
    return new Response(count.toString());
  }
}
```

**Test**:
```typescript
import { env } from "cloudflare:test";
import { it, expect } from "vitest";

it("increments count", async () => {
  const id = env.COUNTER.newUniqueId();
  const stub = env.COUNTER.get(id);

  let response = await stub.fetch("https://example.com");
  expect(await response.text()).toBe("1");

  response = await stub.fetch("https://example.com");
  expect(await response.text()).toBe("2");
});
```

**Source**: [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

### Pattern 2: Testing with `runInDurableObject()`

```typescript
import { env, runInDurableObject } from "cloudflare:test";
import { it, expect } from "vitest";
import { Counter } from "./index.ts";

it("inspects internal state", async () => {
  const id = env.COUNTER.newUniqueId();
  const stub = env.COUNTER.get(id);

  const response = await runInDurableObject(stub, async (instance: Counter, state) => {
    // Direct access to instance and state
    expect(instance).toBeInstanceOf(Counter);

    // Check initial state
    const count = await state.storage.get<number>("count");
    expect(count).toBeUndefined();

    // Call fetch method directly
    const request = new Request("https://example.com");
    return instance.fetch(request);
  });

  expect(await response.text()).toBe("1");
});
```

**Source**: [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

### Pattern 3: Testing Multiple Durable Object Instances

```typescript
import { env, listDurableObjectIds } from "cloudflare:test";
import { it, expect } from "vitest";

it("manages multiple instances", async () => {
  const id1 = env.COUNTER.newUniqueId();
  const stub1 = env.COUNTER.get(id1);

  const id2 = env.COUNTER.newUniqueId();
  const stub2 = env.COUNTER.get(id2);

  // Increment first counter twice
  await stub1.fetch("https://example.com");
  await stub1.fetch("https://example.com");

  // Increment second counter once
  await stub2.fetch("https://example.com");

  // Verify independent state
  const response1 = await stub1.fetch("https://example.com");
  expect(await response1.text()).toBe("3");

  const response2 = await stub2.fetch("https://example.com");
  expect(await response2.text()).toBe("2");

  // List all created instances
  const ids = await listDurableObjectIds(env.COUNTER);
  expect(ids.length).toBe(2);
});
```

**Source**: [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

### Pattern 4: Testing Alarms

```typescript
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { it, expect, beforeEach } from "vitest";

export class AlarmObject {
  constructor(readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    // Schedule alarm for 60 seconds from now
    await this.state.storage.setAlarm(Date.now() + 60000);
    return new Response("Alarm scheduled");
  }

  async alarm() {
    // Alarm handler logic
    await this.state.storage.put("alarmFired", true);
  }
}

it("tests alarm execution", async () => {
  const id = env.ALARM_OBJECT.newUniqueId();
  const stub = env.ALARM_OBJECT.get(id);

  // Schedule alarm
  await stub.fetch("https://example.com");

  // Immediately run the alarm
  const alarmRan = await runDurableObjectAlarm(stub);
  expect(alarmRan).toBe(true);

  // Verify alarm executed
  const result = await runInDurableObject(stub, async (instance, state) => {
    return await state.storage.get("alarmFired");
  });
  expect(result).toBe(true);
});
```

**Important**: Always clean up alarms after tests since they don't respect isolated storage:
```typescript
beforeEach(async () => {
  // Clean up any lingering alarms
  const id = env.ALARM_OBJECT.newUniqueId();
  const stub = env.ALARM_OBJECT.get(id);
  await runDurableObjectAlarm(stub);
});
```

**Sources**:
- [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- [Alarms - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/api/alarms/)

### Pattern 5: Testing SQLite-backed Durable Objects

```typescript
export class SqliteCounter {
  constructor(readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    // Initialize table if needed
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        id INTEGER PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);

    // Increment counter
    this.state.storage.sql.exec(`
      INSERT INTO counters (id, value) VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET value = value + 1
    `);

    // Get current value
    const result = this.state.storage.sql
      .exec("SELECT value FROM counters WHERE id = 1")
      .one();

    return new Response(result.value.toString());
  }
}

it("tests SQLite storage", async () => {
  const id = env.SQLITE_COUNTER.newUniqueId();
  const stub = env.SQLITE_COUNTER.get(id);

  const response1 = await stub.fetch("https://example.com");
  expect(await response1.text()).toBe("1");

  const response2 = await stub.fetch("https://example.com");
  expect(await response2.text()).toBe("2");

  // Verify internal state with SQL
  const result = await runInDurableObject(stub, async (instance, state) => {
    return state.storage.sql
      .exec("SELECT value FROM counters WHERE id = 1")
      .one();
  });

  expect(result.value).toBe(2);
});
```

**Note**: Cloudflare recommends all new Durable Object namespaces use the SQLite storage backend.

**Sources**:
- [SQLite in Durable Objects](https://blog.cloudflare.com/sqlite-in-durable-objects/)
- [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

---

## Common Pitfalls and How to Avoid Them

### 1. Alarms Not Resetting Between Tests

**Problem**: Durable Object alarms are not reset between test runs and do not respect isolated storage.

**Impact**: Rogue alarms from previous tests can fire during subsequent tests, causing unexpected behavior.

**Solution**: Always clean up alarms in each test:

```typescript
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach } from "vitest";

afterEach(async () => {
  const stub = env.ALARM_OBJECT.get(id);
  // Run any pending alarms
  await runDurableObjectAlarm(stub);
});
```

**Source**: [Known issues - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/)

### 2. WebSockets with Isolated Storage

**Problem**: Using WebSockets with Durable Objects when `isolatedStorage` is enabled is not supported.

**Impact**: Tests will fail or behave unexpectedly.

**Solution**: Set `isolatedStorage: false` in your `vitest.config.ts`:

```javascript
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        isolatedStorage: false,
      },
    },
  },
});
```

**Source**: [Known issues - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/)

### 3. Broken Stubs After Exceptions

**Problem**: Many exceptions leave the `DurableObjectStub` in a "broken" state, such that all attempts to send additional requests will just fail immediately.

**Impact**: Subsequent test assertions fail even though the error was handled.

**Solution**: Create a new stub for each request attempt rather than reusing one that has thrown an exception:

```typescript
// Bad
const stub = env.MY_DO.get(id);
try {
  await stub.fetch("https://example.com");
} catch (error) {
  // stub is now broken
}
await stub.fetch("https://example.com"); // This will fail

// Good
const id = env.MY_DO.newUniqueId();
try {
  const stub1 = env.MY_DO.get(id);
  await stub1.fetch("https://example.com");
} catch (error) {
  // Handle error
}
const stub2 = env.MY_DO.get(id); // Create fresh stub
await stub2.fetch("https://example.com"); // This will work
```

**Source**: [Error handling - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)

### 4. Race Conditions in Async Operations

**Problem**: Even though Durable Objects are single-threaded, async functions with multiple `await` statements can create race conditions.

**Example of Problematic Code**:
```typescript
async getUniqueNumber() {
  let currentValue = await this.storage.get("counter");
  currentValue = currentValue + 1;
  await this.storage.put("counter", currentValue);
  return currentValue;
}
```

**Why This Fails**: If two requests call this method concurrently:
1. Request A reads counter (value: 5)
2. Request B reads counter (value: 5)
3. Request A increments to 6 and writes
4. Request B increments to 6 and writes
5. Result: Both requests get 6, not unique numbers!

**Solution**: Use atomic operations or transactions:

```typescript
// Good: Atomic operation
async getUniqueNumber() {
  let currentValue = (await this.storage.get("counter")) ?? 0;
  currentValue++;
  await this.storage.put("counter", currentValue);
  return currentValue;
}

// Better: Use SQLite transactions for complex operations
async getUniqueNumber() {
  const result = this.state.storage.sql.exec(`
    INSERT INTO counters (id, value) VALUES (1, 1)
    ON CONFLICT(id) DO UPDATE SET value = value + 1
    RETURNING value
  `).one();
  return result.value;
}
```

**Testing for Race Conditions**:
```typescript
it("handles concurrent requests", async () => {
  const id = env.COUNTER.newUniqueId();
  const stub = env.COUNTER.get(id);

  // Fire multiple requests concurrently
  const promises = Array.from({ length: 10 }, () =>
    stub.fetch("https://example.com/increment")
  );

  const responses = await Promise.all(promises);
  const values = await Promise.all(
    responses.map(r => r.text())
  );

  // All values should be unique
  const uniqueValues = new Set(values);
  expect(uniqueValues.size).toBe(10);
});
```

**Source**: [Durable Objects: Easy, Fast, Correct — Choose three](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/)

### 5. Transaction Callback Idempotency

**Problem**: Transaction callbacks can be called multiple times when concurrent operations cause conflicts. If the callback modifies in-memory state, it must be idempotent.

**Impact**: Non-idempotent callbacks can lead to incorrect state when retried.

**Solution**: Ensure transaction callbacks only modify persistent storage, not in-memory state, or make in-memory modifications idempotent:

```typescript
// Bad: Modifies in-memory state
this.inMemoryCounter++; // Not idempotent!
await this.storage.transaction(async () => {
  // This callback may run multiple times
});

// Good: Only modifies storage
await this.storage.transaction(async () => {
  const value = await this.storage.get("counter");
  await this.storage.put("counter", value + 1);
});
```

**Source**: [Durable Objects: Easy, Fast, Correct — Choose three](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/)

### 6. Overload Errors

**Problem**: Single Durable Object instances have processing limits. Exceeding them results in overload errors.

**Types of Overload Errors**:
1. "Too many requests queued" - Total count of queued requests is too high
2. "Too much data queued" - Total size of data in queued requests is too high
3. "Requests queued for too long" - Oldest request has been in queue too long
4. "Too many requests for the same object within a 10 second window"

**Solution**:
- Reduce work per request
- Distribute load across multiple Durable Object instances
- **Do not retry** overload errors (they have `.overloaded` property set to `true`)

**Testing for Overload Handling**:
```typescript
it("handles overload errors gracefully", async () => {
  const id = env.HEAVY_DO.newUniqueId();
  const stub = env.HEAVY_DO.get(id);

  try {
    // Simulate heavy load
    await Promise.all(
      Array.from({ length: 1000 }, () =>
        stub.fetch("https://example.com/heavy-task")
      )
    );
  } catch (error) {
    if (error.overloaded) {
      // Expected - do not retry
      expect(error.message).toContain("overloaded");
    } else {
      throw error;
    }
  }
});
```

**Source**: [Troubleshooting - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

### 7. Alarm Methods After Hot Reload

**Problem**: When developing locally using `wrangler dev`, Durable Object alarm methods may fail after a hot reload.

**Impact**: Alarms stop working until you restart `wrangler dev`.

**Solution**: Close and restart `wrangler dev` after editing code that uses Durable Object alarms.

**Source**: [Troubleshooting - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

### 8. Version Compatibility During Deployments

**Problem**: Code changes for Workers and Durable Objects are released globally in an eventually consistent manner. A request may arrive at the latest version of your Worker, which then calls a Durable Object running the previous version.

**Impact**: Breaking changes in APIs can cause failures during deployments.

**Solution**: Ensure API changes between Workers and Durable Objects are forward and backward compatible:

```typescript
// Bad: Breaking change
// Old version expects: { action: "increment" }
// New version sends: { type: "increment", value: 1 }

// Good: Backward compatible
async fetch(request: Request) {
  const body = await request.json();

  // Support both old and new formats
  const action = body.action ?? body.type;
  const value = body.value ?? 1;

  if (action === "increment") {
    return this.increment(value);
  }
}
```

**Source**: [Troubleshooting - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

### 9. Testing with Auxiliary Workers

**Problem**: `runInDurableObject()` only works with Durable Objects defined in the main Worker, not in auxiliary workers.

**Impact**: Cannot use direct inspection for Durable Objects in auxiliary workers.

**Solution**: Test auxiliary worker Durable Objects through their fetch interface only:

```typescript
// For auxiliary worker DOs, test through fetch only
it("tests auxiliary DO", async () => {
  const response = await env.AUXILIARY_DO.fetch("https://example.com");
  expect(response.status).toBe(200);
  // Cannot use runInDurableObject() here
});
```

**Source**: [Test APIs - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

### 10. Storage Timeout with Large Operations

**Problem**: Large-scale `deleteAll()` operations may timeout.

**Impact**: Tests that need to clear large amounts of data may fail.

**Solution**: These calls progress incrementally, so safe retrying works until completion succeeds:

```typescript
async function clearStorage(storage) {
  let success = false;
  let attempts = 0;
  const maxAttempts = 5;

  while (!success && attempts < maxAttempts) {
    try {
      await storage.deleteAll();
      success = true;
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
```

**Source**: [Troubleshooting - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

---

## Best Practices

### 1. Use Isolated Storage for Test Independence

**Recommendation**: Keep `isolatedStorage: true` (default) to ensure tests don't affect each other.

**Exception**: Set to `false` only when testing WebSockets.

```javascript
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        isolatedStorage: true, // Recommended
      },
    },
  },
});
```

### 2. Seed Data in `beforeAll()` Hooks

Since test storage environments copy from parent suites, use `beforeAll()` to seed shared test data:

```typescript
import { env } from "cloudflare:test";
import { beforeAll, it, expect } from "vitest";

describe("Counter tests", () => {
  let baseId;

  beforeAll(async () => {
    // Seed data that all tests in this suite can access
    baseId = env.COUNTER.newUniqueId();
    const stub = env.COUNTER.get(baseId);
    await stub.fetch("https://example.com"); // Initialize to 1
  });

  it("continues from seeded state", async () => {
    const stub = env.COUNTER.get(baseId);
    const response = await stub.fetch("https://example.com");
    expect(await response.text()).toBe("2"); // 1 from seed + 1
  });
});
```

### 3. Test with Named IDs for Determinism

Use `idFromName()` for deterministic Durable Object IDs in tests:

```typescript
it("uses consistent IDs", async () => {
  // Same name always gives same ID
  const id = env.COUNTER.idFromName("test-counter");
  const stub = env.COUNTER.get(id);

  // Test is repeatable
  const response = await stub.fetch("https://example.com");
  expect(await response.text()).toBe("1");
});
```

### 4. Clean Up Resources

Always clean up alarms and other resources in cleanup hooks:

```typescript
import { afterEach } from "vitest";
import { runDurableObjectAlarm } from "cloudflare:test";

afterEach(async () => {
  // Clean up alarms
  const id = env.MY_DO.newUniqueId();
  const stub = env.MY_DO.get(id);
  await runDurableObjectAlarm(stub);
});
```

### 5. Use `listDurableObjectIds()` for Verification

Verify the expected number of Durable Object instances were created:

```typescript
import { listDurableObjectIds } from "cloudflare:test";

it("creates correct number of instances", async () => {
  // Create some instances
  const id1 = env.COUNTER.newUniqueId();
  const id2 = env.COUNTER.newUniqueId();

  env.COUNTER.get(id1);
  env.COUNTER.get(id2);

  const ids = await listDurableObjectIds(env.COUNTER);
  expect(ids.length).toBeGreaterThanOrEqual(2);
});
```

### 6. Test Error Handling Explicitly

Test both success and failure cases, especially error properties:

```typescript
it("handles retryable errors", async () => {
  const stub = env.MY_DO.get(env.MY_DO.newUniqueId());

  try {
    await stub.fetch("https://example.com/error-endpoint");
    expect.fail("Should have thrown");
  } catch (error) {
    if (error.retryable) {
      // Implement retry logic
      expect(error.retryable).toBe(true);
    } else if (error.overloaded) {
      // Do not retry
      expect(error.overloaded).toBe(true);
    }
  }
});
```

**Source**: [Error handling - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)

### 7. Use SQLite for New Projects

**Recommendation**: Cloudflare recommends all new Durable Object namespaces use the SQLite storage backend.

**Benefits**:
- Full SQL query interface with tables and indexes
- Better performance for complex queries
- Support for up to 10GB per Durable Object
- Point-in-time recovery API

**Configuration**:
```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["MyDurableObject"]
```

**Source**: [SQLite in Durable Objects](https://blog.cloudflare.com/sqlite-in-durable-objects/)

### 8. Test Concurrent Request Handling

Durable Objects handle requests serially but async operations can interleave. Test this explicitly:

```typescript
it("handles concurrent requests correctly", async () => {
  const id = env.COUNTER.newUniqueId();
  const stub = env.COUNTER.get(id);

  // Fire 100 concurrent requests
  const promises = Array.from({ length: 100 }, () =>
    stub.fetch("https://example.com/increment")
  );

  await Promise.all(promises);

  // Verify final state
  const response = await stub.fetch("https://example.com/get");
  expect(await response.text()).toBe("100");
});
```

### 9. Use `singleWorker` for Performance

For projects with many small test files, enable `singleWorker` to improve performance:

```javascript
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
      },
    },
  },
});
```

**Source**: [Configuration - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

### 10. Test Migrations

When making schema changes to SQLite-backed Durable Objects, test migrations explicitly:

```typescript
describe("migration from v1 to v2", () => {
  it("migrates data correctly", async () => {
    const id = env.MY_DO.idFromName("migration-test");
    const stub = env.MY_DO.get(id);

    // Create v1 data
    await stub.fetch("https://example.com/v1/setup");

    // Trigger migration
    await stub.fetch("https://example.com/migrate");

    // Verify v2 schema
    const result = await runInDurableObject(stub, async (instance, state) => {
      return state.storage.sql.exec(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='v2_table'
      `).one();
    });

    expect(result).toBeDefined();
  });
});
```

---

## Real-World Examples

### 1. Official Cloudflare Examples

**GitHub Repository**: [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples)

This repository contains example projects tested with `@cloudflare/vitest-pool-workers`, including:
- Isolated tests using Durable Objects with direct access
- Tests using declarative/imperative outbound request mocks
- Tests using JSRPC with entrypoints and Durable Objects
- Mocking Workers AI and Vectorize bindings in unit tests
- Integration testing with static assets using Puppeteer

**Source**: [Recipes and examples - Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

### 2. Testing Demo from Official Docs

**Full Example**: [jahands/do-demo](https://github.com/jahands/do-demo)

This demo shows comprehensive testing patterns including:
- Request validation testing
- State management across requests
- Path isolation verification
- Asynchronous request coordination

**Source**: [Testing with Durable Objects - Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)

### 3. Community Projects

#### Real-time Collaboration with Yjs
**Project**: [napolab/y-durableobjects](https://github.com/napolab/y-durableobjects)

Real-time collaboration using Yjs on Cloudflare Workers with Durable Objects, eliminating Node.js dependencies. Updated as recently as August 2025 (199 stars).

#### Hono Wrapper for Durable Objects
**Project**: Hono Durable Objects wrapper (96 stars)

Provides testing examples for Durable Objects wrapped with the Hono framework.

**Example**:
```typescript
import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";

export class ChatRoom extends DurableObject {
  app = new Hono();

  constructor(state, env) {
    super(state, env);
    this.app.get("/", (c) => c.text("Chat room"));
  }

  async fetch(request) {
    return this.app.fetch(request);
  }
}
```

**Source**: [Hono - Cloudflare Durable Objects](https://hono.dev/examples/cloudflare-durable-objects)

#### Seat Booking App Tutorial
**Tutorial**: [Build a seat booking app with SQLite in Durable Objects](https://developers.cloudflare.com/durable-objects/tutorials/build-a-seat-booking-app/)

Demonstrates building and testing a real application using:
- TypeScript
- SQLite storage backend
- Local testing with `wrangler dev`
- Seat reservation logic with transaction handling

### 4. WebSocket Testing Patterns

For WebSocket-based Durable Objects, one community approach is to monkey patch the WebSocket provided by the vitest environment to proxy requests directly to the in-process running Durable Object.

**Note**: Remember to set `isolatedStorage: false` when testing WebSockets.

**Source**: Community discussions on [Unit/Integration Testing WebSockets](https://www.answeroverflow.com/m/1410111007455576206)

---

## Additional Resources

### Official Documentation

1. **Testing with Durable Objects**
   [https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)

2. **Test APIs - Cloudflare Workers**
   [https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)

3. **Configuration - Vitest Integration**
   [https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)

4. **Miniflare Durable Objects**
   [https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/)

5. **Best Practices**
   [https://developers.cloudflare.com/durable-objects/best-practices/](https://developers.cloudflare.com/durable-objects/best-practices/)

6. **Error Handling**
   [https://developers.cloudflare.com/durable-objects/best-practices/error-handling/](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)

7. **Troubleshooting**
   [https://developers.cloudflare.com/durable-objects/observability/troubleshooting/](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)

8. **Known Issues**
   [https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/)

### Blog Posts

1. **Improved Cloudflare Workers testing via Vitest and workerd**
   [https://blog.cloudflare.com/workers-vitest-integration/](https://blog.cloudflare.com/workers-vitest-integration/)

2. **SQLite in Durable Objects**
   [https://blog.cloudflare.com/sqlite-in-durable-objects/](https://blog.cloudflare.com/sqlite-in-durable-objects/)

3. **Miniflare 2.0 announcement**
   [https://blog.cloudflare.com/miniflare/](https://blog.cloudflare.com/miniflare/)

4. **Durable Objects: Easy, Fast, Correct — Choose three**
   [https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/)

5. **Durable Objects Alarms**
   [https://blog.cloudflare.com/durable-objects-alarms/](https://blog.cloudflare.com/durable-objects-alarms/)

6. **Building a better testing experience for Workflows**
   [https://blog.cloudflare.com/better-testing-for-workflows/](https://blog.cloudflare.com/better-testing-for-workflows/)

### GitHub Resources

1. **workers-sdk Vitest Examples**
   [https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples)

2. **Durable Objects Testing Demo**
   [https://github.com/jahands/do-demo](https://github.com/jahands/do-demo)

3. **Miniflare Repository**
   [https://github.com/cloudflare/miniflare](https://github.com/cloudflare/miniflare)

### Community Resources

1. **GitHub Topics - Durable Objects**
   [https://github.com/topics/durable-objects](https://github.com/topics/durable-objects)

2. **GitHub Topics - Cloudflare Durable Objects**
   [https://github.com/topics/cloudflare-durable-objects](https://github.com/topics/cloudflare-durable-objects)

3. **Hono Examples**
   [https://hono.dev/examples/cloudflare-durable-objects](https://hono.dev/examples/cloudflare-durable-objects)

4. **The Ultimate Guide to Cloudflare's Durable Objects**
   [https://flaredup.substack.com/p/the-ultimate-guide-to-cloudflares](https://flaredup.substack.com/p/the-ultimate-guide-to-cloudflares)

---

## Summary and Key Takeaways

### Essential Tools
- **Primary**: `@cloudflare/vitest-pool-workers` with Vitest
- **Local Dev**: `wrangler dev` (local) and `wrangler dev --remote` (remote testing)
- **Debugging**: `wrangler tail` for production logs
- **Runtime**: Miniflare 3+ with `workerd` runtime

### Core Testing APIs
- `runInDurableObject()` - Direct access to Durable Object internals
- `runDurableObjectAlarm()` - Immediately execute scheduled alarms
- `listDurableObjectIds()` - Enumerate created instances
- `SELF` - Service binding for integration tests

### Critical Configuration
- Use `isolatedStorage: true` for test independence (except WebSockets)
- Enable `nodejs_compat` compatibility flag
- Set compatibility date after "2022-10-31"
- Configure `main` entry point for SELF and same-Worker Durable Objects

### Common Pitfalls to Avoid
1. Alarms not resetting between tests
2. WebSockets requiring `isolatedStorage: false`
3. Broken stubs after exceptions
4. Race conditions in async operations
5. Non-idempotent transaction callbacks
6. Testing auxiliary worker Durable Objects with `runInDurableObject()`

### Best Practices
1. Use SQLite storage backend for new projects
2. Test concurrent request handling explicitly
3. Clean up alarms in `afterEach()` hooks
4. Create new stubs after exceptions
5. Seed data in `beforeAll()` hooks
6. Test both success and error cases
7. Ensure API compatibility during deployments
8. Use `singleWorker` for performance with many test files

### Production Considerations
- Test migrations when changing schemas
- Verify error handling with `.retryable` and `.overloaded` properties
- Test backward/forward compatibility for zero-downtime deployments
- Monitor for overload conditions
- Implement exponential backoff for retryable errors

---

**Research completed on**: 2025-12-10
**Last updated**: 2025-12-10
**Version**: 1.0
