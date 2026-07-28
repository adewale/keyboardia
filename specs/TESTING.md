# Keyboardia Testing Plan

## Overview

Testing a real-time multiplayer audio application presents unique challenges across three domains:
1. **Backend** — Cloudflare Workers + Durable Objects
2. **Frontend** — Web Audio API + WebSocket sync
3. **End-to-End** — Multi-player synchronization accuracy

This document outlines strategies for each layer.

### Boundary rule

Prefer the narrowest controllable seam that still executes production code:

- Worker, Durable Object, storage, and server WebSocket behavior run together in
  the Cloudflare Workers test runtime.
- Client fault tests inject only a controllable `WebSocket` transport into the
  real `MultiplayerConnection`.
- Browser session tests send black-box HTTP requests to either the offline Vite
  backend or the real Worker; the same contract test must pass against both.
- E2E backend ownership is explicit. `e2e/mock-compatible-files.txt` contains
  the strict zero-skip mock subset; `e2e/worker-required-files.txt` contains
  every spec that guards behavior with `useMockAPI` plus the shared Worker
  contracts. `npm run validate:e2e-inventories` fails when a real-backend guard
  is introduced without Worker coverage. `e2e/test-title-inventory.txt` also
  commits every exact Chromium file/suite/title identity, so replacing or
  silently dropping a test requires an explicit inventory review.
- Reporter statistics are release contracts, not summaries. Required mock and
  Worker lanes reject any skipped, flaky, or unexpected result; the remaining
  offline lane ratchets its reviewed pass/skip totals so a new skip cannot turn
  a regression green.
- The real-Worker lane runs with one browser worker. It intentionally exercises
  the complete Worker-owned inventory below the production limit of 100 session
  creates per IP per minute; increasing Playwright concurrency turns the
  functional contract into a rate-limit load test and produces cascading,
  non-diagnostic navigation timeouts.
- The full-stack runner must inherit Wrangler's stdout/stderr. It launches
  Playwright synchronously, so piped Worker logs cannot be drained by Node and
  can fill the OS buffer, deadlocking the server partway through the suite.
- Audio fakes implement typed production surfaces. Do not add runtime tests that
  compare one hand-maintained fake with another hand-maintained description.

Do not create a second in-memory implementation of `LiveSessionDurableObject`.
It will not share production routing, validation, persistence, or protocol
changes and can pass while the application is broken.

---

## 1. Backend Testing (Cloudflare Workers + Durable Objects)

### Recommended Stack

| Tool | Purpose | Documentation |
|------|---------|---------------|
| Vitest | Test runner (Cloudflare recommended) | [Workers Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) |
| @cloudflare/vitest-pool-workers | Run tests inside Workers runtime | [Get Started](https://developers.cloudflare.com/workers/testing/vitest-integration/get-started/write-your-first-test/) |
| Miniflare | Local Workers simulator | [Miniflare](https://miniflare.dev/) |

### Configuration

```typescript
// test/integration/vitest.config.ts  (vitest-pool-workers 0.16 / vitest 4)
// The 0.10-era defineWorkersConfig/defineWorkersProject({ test.poolOptions.workers })
// was removed in the v3→v4 migration; the pool is now a plugin.
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "../../wrangler.jsonc" } })],
  test: { name: "keyboardia-integration" },
});
```

### Test Categories

#### 1.1 Unit Tests — Worker Routes

Test HTTP routing logic in isolation:

```typescript
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("Worker routes", () => {
  it("GET /new creates session and redirects", async () => {
    const request = new Request("http://localhost/new");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/\/session\/[\w-]+/);
  });

  it("GET /session/:id returns 404 for invalid session", async () => {
    const request = new Request("http://localhost/session/nonexistent");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});
```

#### 1.2 Integration Tests — Durable Objects

Test Durable Object state management with isolated storage per test:

```typescript
import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("SessionDurableObject", () => {
  it("accepts WebSocket upgrade", async () => {
    const response = await SELF.fetch("http://localhost/session/test-session", {
      headers: { "Upgrade": "websocket" },
    });

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  it("broadcasts state changes to all connected clients", async () => {
    // Connect two clients
    const client1 = await connectWebSocket("test-session");
    const client2 = await connectWebSocket("test-session");

    // Client 1 sends a change
    client1.send(JSON.stringify({
      type: "toggle_step",
      trackId: "shared-track",
      step: 4,
      seq: 1,
    }));

    // Both clients should receive the broadcast
    const msg1 = await client1.nextMessage();
    const msg2 = await client2.nextMessage();

    expect(msg1).toEqual(msg2);
    expect(JSON.parse(msg1)).toMatchObject({
      type: "step_toggled",
      trackId: "shared-track",
      step: 4,
      clientSeq: 1,
    });
  });

  it("sends snapshot on join", async () => {
    const client = await connectWebSocket("test-session");
    const msg = await client.nextMessage();

    expect(JSON.parse(msg).type).toBe("snapshot");
  });

  it("removes player on disconnect", async () => {
    const client1 = await connectWebSocket("test-session");
    const client2 = await connectWebSocket("test-session");

    // Wait for join messages
    await client1.nextMessage(); // snapshot
    await client1.nextMessage(); // player_joined (client2)

    client2.close();

    const leaveMsg = await client1.nextMessage();
    expect(JSON.parse(leaveMsg).type).toBe("player_left");
  });
});
```

#### 1.3 Durable Object Hibernation Tests

Verify state restoration after hibernation:

```typescript
describe("Hibernation recovery", () => {
  it("restores WebSocket sessions after hibernation", async () => {
    const client = await connectWebSocket("hibernate-test");
    await client.nextMessage(); // snapshot

    // Simulate hibernation by triggering alarm
    // (implementation depends on test setup)

    // Send message after wake
    client.send(JSON.stringify({ type: "ping" }));
    const response = await client.nextMessage();

    expect(response).toBeDefined();
  });
});
```

#### 1.4 R2 Integration Tests

Test sample upload/download:

```typescript
describe("Sample storage", () => {
  it("uploads sample to R2", async () => {
    const sampleData = new ArrayBuffer(1000);
    const response = await SELF.fetch("http://localhost/session/test/upload", {
      method: "POST",
      body: sampleData,
      headers: { "Content-Type": "audio/webm" },
    });

    expect(response.status).toBe(200);
    const { url } = await response.json();
    expect(url).toMatch(/^https:\/\//);
  });

  it("rejects samples over size limit", async () => {
    const largeSample = new ArrayBuffer(1024 * 1024); // 1MB
    const response = await SELF.fetch("http://localhost/session/test/upload", {
      method: "POST",
      body: largeSample,
    });

    expect(response.status).toBe(413);
  });
});
```

---

## 2. Frontend Testing (Web Audio + Sync)

### Recommended Stack

| Tool | Purpose |
|------|---------|
| Vitest | Test runner (consistent with backend) |
| @testing-library/react | Component testing |
| standardized-audio-context-mock | Mock Web Audio API |
| Injected WebSocket factory | Fault injection around the production client |

### Test Categories

#### 2.1 Audio Engine Unit Tests

Mock the AudioContext to test scheduling logic:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioEngine } from "../src/audio/engine";

// Mock AudioContext
const mockAudioContext = {
  currentTime: 0,
  destination: {},
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    gain: { value: 1 },
  })),
  createBufferSource: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    buffer: null,
  })),
  decodeAudioData: vi.fn(),
};

describe("AudioEngine", () => {
  let engine: AudioEngine;

  beforeEach(() => {
    engine = new AudioEngine(mockAudioContext as any);
  });

  it("schedules notes at correct audio time", () => {
    mockAudioContext.currentTime = 1.0;

    engine.scheduleNote("kick", 1.5);

    expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
    const source = mockAudioContext.createBufferSource.mock.results[0].value;
    expect(source.start).toHaveBeenCalledWith(1.5);
  });

  it("stops sample at gate end (gated playback)", () => {
    mockAudioContext.currentTime = 1.0;
    const stepDuration = 0.125; // 16th note at 120 BPM

    engine.scheduleNote("kick", 1.5, stepDuration);

    const source = mockAudioContext.createBufferSource.mock.results[0].value;
    expect(source.stop).toHaveBeenCalledWith(1.5 + stepDuration);
  });
});
```

#### 2.2 Clock Sync Unit Tests

Test offset calculation:

```typescript
import { describe, it, expect } from "vitest";
import { SyncEngine } from "../src/sync/clock";

describe("SyncEngine", () => {
  it("calculates server offset correctly", () => {
    const sync = new SyncEngine();

    // Simulate ping/pong with 20ms RTT
    const clientSendTime = 1000;
    const serverTime = 1010;
    const clientReceiveTime = 1020;

    sync.updateOffset(clientSendTime, serverTime, clientReceiveTime);

    // Server is 10ms ahead, RTT is 20ms, so offset should be 0
    // offset = serverTime - clientSendTime - (RTT/2) = 1010 - 1000 - 10 = 0
    expect(sync.offset).toBe(0);
  });

  it("converts server time to local audio time", () => {
    const sync = new SyncEngine();
    sync.offset = 50; // Server is 50ms ahead

    const mockAudioContext = { currentTime: 2.0 };
    const serverTime = Date.now() + 50 + 100; // 100ms in the future (server time)

    const audioTime = sync.toAudioTime(serverTime, mockAudioContext as any);

    // Should be ~2.1 seconds (current + 100ms)
    expect(audioTime).toBeCloseTo(2.1, 1);
  });
});
```

#### 2.3 Scheduler Tests

Test lookahead scheduling pattern:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../src/audio/scheduler";

describe("Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules notes within lookahead window", () => {
    const scheduleNote = vi.fn();
    const scheduler = new Scheduler({
      scheduleNote,
      lookaheadMs: 25,
      scheduleAheadSec: 0.1,
      tempo: 120,
    });

    scheduler.start();
    vi.advanceTimersByTime(25);

    expect(scheduleNote).toHaveBeenCalled();
  });

  it("does not schedule notes beyond lookahead", () => {
    const scheduleNote = vi.fn();
    const scheduler = new Scheduler({
      scheduleNote,
      lookaheadMs: 25,
      scheduleAheadSec: 0.1,
      tempo: 120,
    });

    scheduler.start();
    vi.advanceTimersByTime(25);

    // At 120 BPM, 16th notes are 125ms apart
    // With 100ms lookahead, should only schedule 1 note
    const scheduledTimes = scheduleNote.mock.calls.map(c => c[1]);
    const maxTime = Math.max(...scheduledTimes);

    expect(maxTime).toBeLessThan(0.1); // 100ms in seconds
  });
});
```

#### 2.4 WebSocket Integration Tests

Use two complementary suites:

1. `test/integration/collaboration-contract.test.ts` connects real Workers
   WebSockets to `LiveSessionDurableObject`. It verifies the initial `snapshot`,
   broadcast parity, `clientSeq` echoes, monotonic server ordering, playback
   presence, idempotent track acknowledgements, effects durability, the
   collaborator limit, and final persisted state for multiple collaborators.
2. `src/sync/multiplayer-transport.test.ts` supplies a controllable socket
   factory to the production `MultiplayerConnection`. It verifies queued edit
   replay, abnormal disconnect/reconnect, and gap-triggered snapshot recovery
   without implementing a fake server.

Run them with:

```bash
npx vitest run src/sync/multiplayer-transport.test.ts
npm run test:integration -- collaboration-contract.test.ts
```

#### 2.5 Component Tests

Test React components with testing-library:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepCell } from "../src/components/StepCell";

describe("StepCell", () => {
  it("renders active state", () => {
    render(<StepCell active={true} onClick={() => {}} />);

    const cell = screen.getByRole("button");
    expect(cell).toHaveClass("active");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<StepCell active={false} onClick={onClick} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalled();
  });

  it("shows playing indicator during playback", () => {
    render(<StepCell active={true} playing={true} onClick={() => {}} />);

    expect(screen.getByTestId("playing-indicator")).toBeInTheDocument();
  });
});
```

---

## 3. End-to-End Testing

### Recommended Stack

| Tool | Purpose |
|------|---------|
| Playwright | Browser automation |
| Puppeteer (Cloudflare recipe) | Workers integration |

### Test Categories

#### 3.1 Multi-Browser Sync Tests

Test that multiple browsers stay synchronized:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Multi-player sync", () => {
  test("two players see same grid state", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Both join same session
    await page1.goto("http://localhost:8787/session/sync-test");
    await page2.goto("http://localhost:8787/session/sync-test");

    // Wait for connection
    await page1.waitForSelector("[data-testid='grid']");
    await page2.waitForSelector("[data-testid='grid']");

    // Player 1 toggles a step
    await page1.click("[data-testid='step-0-4']");

    // Both should show step as active
    await expect(page1.locator("[data-testid='step-0-4']")).toHaveClass(/active/);
    await expect(page2.locator("[data-testid='step-0-4']")).toHaveClass(/active/);
  });

  test("late joiner receives current state", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    await page1.goto("http://localhost:8787/session/late-join-test");
    await page1.waitForSelector("[data-testid='grid']");

    // Set up some state
    await page1.click("[data-testid='step-0-0']");
    await page1.click("[data-testid='step-1-4']");

    // Second player joins late
    const page2 = await context2.newPage();
    await page2.goto("http://localhost:8787/session/late-join-test");
    await page2.waitForSelector("[data-testid='grid']");

    // Should see existing state
    await expect(page2.locator("[data-testid='step-0-0']")).toHaveClass(/active/);
    await expect(page2.locator("[data-testid='step-1-4']")).toHaveClass(/active/);
  });
});
```

#### 3.2 Audio Sync Accuracy Test

The "Same Music Test" from SPEC.md — verify audio alignment:

```typescript
test.describe("Audio sync accuracy", () => {
  test("audio playback aligned within 20ms", async ({ browser }) => {
    // This test requires audio capture capabilities
    // Consider using Web Audio API's AnalyserNode for comparison

    const context1 = await browser.newContext({
      permissions: ["microphone"], // If using audio capture
    });
    const context2 = await browser.newContext({
      permissions: ["microphone"],
    });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await page1.goto("http://localhost:8787/session/audio-sync-test");
    await page2.goto("http://localhost:8787/session/audio-sync-test");

    // Start playback
    await page1.click("[data-testid='play-button']");

    // Record timestamps when audio events fire
    const timestamps1 = await page1.evaluate(() => {
      return (window as any).__audioTimestamps;
    });
    const timestamps2 = await page2.evaluate(() => {
      return (window as any).__audioTimestamps;
    });

    // Compare timestamps - should be within 20ms
    for (let i = 0; i < timestamps1.length; i++) {
      const diff = Math.abs(timestamps1[i] - timestamps2[i]);
      expect(diff).toBeLessThan(20);
    }
  });
});
```

#### 3.3 Reconnection Test

Test graceful reconnection after disconnect:

```typescript
test("reconnects and restores state after disconnect", async ({ page }) => {
  await page.goto("http://localhost:8787/session/reconnect-test");
  await page.waitForSelector("[data-testid='grid']");

  // Make some changes
  await page.click("[data-testid='step-0-0']");

  // Simulate network disconnect
  await page.context().setOffline(true);

  // Wait for disconnect indicator
  await expect(page.locator("[data-testid='connection-status']")).toHaveText("Disconnected");

  // Reconnect
  await page.context().setOffline(false);

  // Should reconnect and restore state
  await expect(page.locator("[data-testid='connection-status']")).toHaveText("Connected");
  await expect(page.locator("[data-testid='step-0-0']")).toHaveClass(/active/);
});
```

---

## 4. Performance Testing

### Metrics to Track

| Metric | Target | Tool |
|--------|--------|------|
| Time to first sound | < 30s | Playwright + custom timing |
| Click-to-sound latency | < 50ms | Web Audio timestamps |
| Sync drift between players | < 20ms | Multi-browser comparison |
| WebSocket message latency | < 100ms | Custom instrumentation |
| Memory usage (30 min session) | Stable | Chrome DevTools Protocol |

### Load Testing

Test session capacity:

```typescript
test.describe("Load testing", () => {
  test("handles 10 concurrent players", async ({ browser }) => {
    const pages = await Promise.all(
      Array(10).fill(null).map(async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("http://localhost:8787/session/load-test");
        await page.waitForSelector("[data-testid='grid']");
        return page;
      })
    );

    // All should be connected
    for (const page of pages) {
      await expect(page.locator("[data-testid='player-count']")).toHaveText("10");
    }

    // Clean up
    await Promise.all(pages.map(p => p.close()));
  });
});
```

---

## 5. Test Organization

### Where does a test go?

One rule, applied in order. The first match wins.

| Put it in | When | Cost per test |
|---|---|---|
| `src/<dir>/X.test.ts` (co-located) | It tests one module. This is the default and covers ~90% of tests. | ~9ms |
| `app/test/unit/` | It tests *agreement between* modules, so no single `src/` directory is its home — e.g. "every SYNCED_ACTION has a handler", reducer/mutation equivalence, golden masters. | ~9ms |
| `app/test/integration/` | **It executes against the real Workers runtime** (`import { env } from 'cloudflare:test'`). Durable Object lifecycle, KV, hibernation, WebSocket server behaviour. | ~93ms |
| `app/e2e/` | It needs a real browser for something the tiers above cannot do: pointer/drag semantics, layout and scroll, focus rings, screenshots, or two clients over a live WebSocket. | ~5,900ms |

**The integration rule is literal.** If a file in `test/integration/` does not
import `cloudflare:test`, it is a unit test in the wrong directory — it pays the
Workers-pool startup cost for no boundary crossing, and its location implies a
guarantee (that the real Durable Object honours this) that it does not provide.
Nine such files were moved out in July 2026; keep it at zero.

**The e2e rule is about capability, not realism.** "It's more realistic" is not a
reason — everything is more realistic in a browser. The question is whether a
cheaper tier *can* verify the claim. If the answer is yes, the e2e test is
duplicate coverage running ~650x slower and flaking on drag timing. When you
remove one, leave the pointer behind, which is the established convention here:

```ts
// NOTE: "Space/Enter activates focused elements" test was removed.
// Covered by src/components/keyboard-handlers.test.ts:
// - E-001: Space key on step should dispatch toggle
```

**Name a test file after the module it imports, not the concept it covers.** If
`foo.test.ts` does not import `foo`, one of the two names is wrong. In July 2026
`invariants.property.test.ts` was found to test `validation.ts` while
`validators.property.test.ts` tested `invariants.ts` — the names had detached
from the code because four modules in `src/worker` and `src/shared` all mean
roughly "check the values" (`validation.ts`, `invariants.ts`, `validators.ts`,
`shared/validation.ts`).

Where one module needs both example-based and property-based coverage, use
`foo.test.ts` and `foo.property.test.ts`. That pairing is visible; two files
named after different concepts is not.

**Never define a test file's scope by negation.** A header reading "tests what
`other.test.ts` doesn't cover" describes a boundary no tool can enforce and no
reader can see. It rots the moment either file changes, and it left one file
pointing at another that had been deleted.

**Deliberately untested:** the debug tooling (`src/utils/log-store.ts`,
`debug-tracer.ts`, `debug-coordinator.ts`, `src/debug/*`) is short-lived
diagnostic code where test investment would not pay back. That is a decision,
not an oversight — see `docs/TEST-PLACEMENT-ANALYSIS.md`.


### Current Directory Structure

```
app/
├── src/
│   ├── audio/
│   │   ├── samples.test.ts       # Sample ID parity tests
│   │   ├── scheduler.test.ts     # Lookahead scheduler tests
│   │   ├── synth.test.ts         # Synth preset tests
│   │   └── synth-sessions.test.ts # Synth audibility tests
│   │
│   ├── components/
│   │   └── SamplePicker.test.ts  # UI sample coverage tests
│   │
│   ├── hooks/
│   │   └── useSession.test.ts    # Session hook state machine tests
│   │
│   ├── state/
│   │   └── grid.test.ts          # Grid state reducer tests
│   │
│   ├── sync/
│   │   ├── multiplayer.test.ts   # WebSocket client unit tests
│   │   └── multiplayer-transport.test.ts # Real client with transport faults
│   │
│   └── worker/
│       ├── types.test.ts         # Type parity tests
│       └── logging.test.ts       # Logging utility tests
│
├── test/integration/
│   ├── collaboration-contract.test.ts # Real Worker/DO/WebSocket collaboration
│   └── eviction-recovery.test.ts # Real storage and hibernation behavior
│
├── e2e/
│   ├── session-api-contract.spec.ts # Same black-box API journey for mock/real backends
│   └── session-persistence.spec.ts # Playwright E2E tests
│
├── vitest.config.ts              # Unit test config (jsdom)
├── vitest.workers.config.ts      # Integration test config (Workers pool)
└── playwright.config.ts          # E2E test config
```

### Running Tests

```bash
# Unit tests only
npm run test:unit

# Integration tests (Workers runtime)
npm run test:integration

# All tests
npm run test:all

# E2E tests
npm run test:e2e

# One black-box contract against the offline backend
USE_MOCK_API=1 npx playwright test e2e/session-api-contract.spec.ts --project=chromium

# The same black-box contract against a real local Worker
npm run test:e2e:session-contract:worker

# What CI runs: the contract plus the specs that block on a real snapshot
npm run test:e2e:collaboration:worker

# Full browser stack with the real Worker and WebSockets
npm run test:e2e:full-stack

# Watch mode during development
npm run test:unit -- --watch

# Static checks on the tests themselves (see below)
npm run validate:test-quality
```

### Checking the tests themselves

Four TypeScript-parser-based checks run in the `lint` CI job. They exist because
every pattern they detect shipped here as apparently valid coverage — see
`docs/TEST-AUDIT-2026-07.md`.

```bash
npm run validate:test-antipatterns   # gating
npm run validate:test-links          # gating
npm run validate:dead-exports        # gating
npm run validate:unrun-tests         # gating, zero exceptions
npm run validate:test-quality        # all four
```

`validate:test-antipatterns` **fails the build**. It reports assertions
nullified by `.catch(() => {})`, runtime self-skips (`test.skip(true, ...)`),
tautologies (`expect(true).toBe(true)`), self-comparisons, and tests with no
assertion at all. Matching runs over comment-stripped source, so describing one
of these patterns in a comment is not reported as an instance of it.

`validate:test-links` **fails the build** on three kinds of test that are not
connected to the code they claim to cover:

| Finding | Meaning | Fix |
|---|---|---|
| ORPHAN | `foo.test.ts` never imports `foo` | rename the test, or point it at the module |
| REIMPL | the test defines its own copy of the logic it names | export the real function and import it |
| DEAD | a module is imported only by its own tests | delete the module, or wire it up |

DEAD needs a human call — a module can be legitimately new — but the call must
be made in the change that introduces it. The gate does not preserve a standing
exception. The last accumulated DEAD finding, `src/worker/validators.ts`, had
64 green tests describing a protection that did not run, and the gap it masked
was a live state-corruption bug.

`validate:dead-exports` traces import, export, re-export, dynamic-import, Worker
entry, and build-tool reachability. Runtime exports used only by tests are
findings; build-only exports are reported separately and accepted.

`validate:unrun-tests` asks Vitest and Playwright what they actually collect.
Every test file must belong to a lane. There is no permanent allowlist: wire a
unique contract into CI, or delete redundant test theatre.

The offline backend deliberately does not implement WebSockets. Browser tests
that work in both modes must call `waitForCollaborationReady(page)` rather than
asserting `.connection-status--connected` directly; the helper is a no-op only
when `USE_MOCK_API=1`.

Because that helper is a no-op offline, a spec relying on it proves nothing
about the connected path when CI runs it with `USE_MOCK_API=1`. Any spec that
needs an authoritative snapshot before it edits therefore also belongs in the
sorted `e2e/worker-required-files.txt` manifest. The inventory validator derives
all `test.skip(useMockAPI, ...)` guards from source and fails if the manifest
misses one. Both the offline Chromium matrix and real-Worker path are blocking.

---

## 6. CI/CD Integration

The authoritative workflow is `.github/workflows/ci.yml` and uses the
repository-wide Node version. Every Playwright report is checked against both
reviewed pass/skip totals and the exact title inventory:

1. **Mock-compatible Chromium:** five manifest files, 65 passed, zero skipped.
2. **Remaining offline Chromium:** 82 passed and 69 reviewed backend-dependent
   skips; a new or renamed skip fails the contract.
3. **Worker-owned Chromium subset:** 12 manifest files, 73 passed, zero skipped,
   serialized below the production session-create rate limit.
4. **Full real-backend browsers:** the functional suite runs against an owned
   Wrangler process in Chromium (200 passed, 17 reviewed skips) and broad
   WebKit (154 passed, 52 reviewed browser/project skips; seven real-audio
   specs are excluded and four playback tests in mixed files are among the
   reviewed skips because headless WebKit can wedge on `AudioContext.resume()`).
5. **Visuals:** three deterministic Holby screenshots gate on pinned `macos-14`;
   11 tagged screenshots gate on the Linux real-Worker runner. Platform
   baselines are not interchangeable.

The full-stack launcher rejects an occupied port, tags health with a per-run
nonce, races readiness against early Worker exit, enforces a 30-minute wall
timeout, and terminates the detached process group on completion or signal.

Unit tests retain Vitest's five-second global timeout. A measured slow property or render test may declare a local timeout in that test only. Do not reintroduce probabilistic WebSocket doubles as “chaos” evidence; named faults need a deterministic seam or a real Worker contract with an assertion proving the fault occurred.

---

## Documentation References

### Cloudflare Testing
- [Workers Testing Overview](https://developers.cloudflare.com/workers/testing/)
- [Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Testing Recipes](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

### Web Audio Testing
- [standardized-audio-context-mock](https://www.npmjs.com/package/standardized-audio-context-mock)
- [Web Audio API Best Practices (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)

### E2E Testing
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library](https://testing-library.com/)
