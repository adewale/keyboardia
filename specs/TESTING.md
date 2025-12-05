# Keyboardia Testing Plan

## Overview

Testing a real-time multiplayer audio application presents unique challenges across three domains:
1. **Backend** — Cloudflare Workers + Durable Objects
2. **Frontend** — Web Audio API + WebSocket sync
3. **End-to-End** — Multi-player synchronization accuracy

This document outlines strategies for each layer.

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
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
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
    client1.send(JSON.stringify({ type: "toggle_step", trackId: 0, step: 4 }));

    // Both clients should receive the broadcast
    const msg1 = await client1.nextMessage();
    const msg2 = await client2.nextMessage();

    expect(msg1).toEqual(msg2);
    expect(JSON.parse(msg1).type).toBe("step_changed");
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
| vitest-websocket-mock | Mock WebSocket connections |

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

Use vitest-websocket-mock:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WS from "vitest-websocket-mock";
import { SessionClient } from "../src/sync/websocket";

describe("SessionClient", () => {
  let server: WS;

  beforeEach(async () => {
    server = new WS("ws://localhost/session/test");
  });

  afterEach(() => {
    WS.clean();
  });

  it("receives and processes snapshot on connect", async () => {
    const client = new SessionClient("test");
    await server.connected;

    server.send(JSON.stringify({
      type: "snapshot",
      grid: [],
      tempo: 120,
      players: [],
    }));

    await expect(server).toReceiveMessage(expect.stringContaining("ping"));
    expect(client.tempo).toBe(120);
  });

  it("sends toggle_step message", async () => {
    const client = new SessionClient("test");
    await server.connected;

    client.toggleStep(0, 4);

    await expect(server).toReceiveMessage(
      JSON.stringify({ type: "toggle_step", trackId: 0, step: 4 })
    );
  });
});
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

### Directory Structure

```
keyboardia/
├── src/
│   └── ...
├── test/
│   ├── unit/
│   │   ├── worker.test.ts       # Worker route tests
│   │   ├── session.test.ts      # Durable Object tests
│   │   ├── audio-engine.test.ts # Audio scheduling tests
│   │   ├── sync-engine.test.ts  # Clock sync tests
│   │   └── scheduler.test.ts    # Lookahead scheduler tests
│   ├── integration/
│   │   ├── websocket.test.ts    # WebSocket message flow
│   │   ├── r2.test.ts           # Sample storage
│   │   └── state-sync.test.ts   # State synchronization
│   ├── e2e/
│   │   ├── multi-player.spec.ts # Multi-browser tests
│   │   ├── audio-sync.spec.ts   # Audio alignment tests
│   │   └── reconnection.spec.ts # Network resilience
│   └── fixtures/
│       ├── samples/             # Test audio files
│       └── mocks/               # Shared mock utilities
├── vitest.config.ts             # Vitest configuration
└── playwright.config.ts         # Playwright configuration
```

### Running Tests

```bash
# Unit & integration tests
npm run test

# Watch mode during development
npm run test:watch

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage
```

---

## 6. CI/CD Integration

### GitHub Actions Example

```yaml
name: Test

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run test

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run dev &
      - run: npm run test:e2e
```

---

## Documentation References

### Cloudflare Testing
- [Workers Testing Overview](https://developers.cloudflare.com/workers/testing/)
- [Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Testing Recipes](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

### Web Audio Testing
- [standardized-audio-context-mock](https://www.npmjs.com/package/standardized-audio-context-mock)
- [Web Audio API Best Practices (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)

### WebSocket Testing
- [vitest-websocket-mock](https://github.com/akiomik/vitest-websocket-mock)
- [Testing WebSockets with Vitest](https://thomason-isaiah.medium.com/writing-integration-tests-for-websocket-servers-using-jest-and-ws-8e5c61726b2a)

### E2E Testing
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library](https://testing-library.com/)
