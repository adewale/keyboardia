# Playwright E2E Testing Strategy

**Date:** 2026-01-07 (Updated)
**Status:** 70% Complete - 24 test files, ~220 tests
**Phase:** 33 (renumbered from 37)

---

## Executive Summary

This spec captures the current state of Playwright testing in Keyboardia, identifies remaining gaps, and proposes improvements.

**Current State (2026-01-07):**
- 24 test files (~220 tests) covering core functionality
- 12 files have tests that skip in CI (50%)
- New additions: accessibility, keyboard, visual, mobile tests
- Network mocking partially implemented via SELF.fetch() in integration tests

**Remaining Work:**
- Enable remaining skipped tests in CI
- Complete cross-browser coverage (Firefox/Safari)
- Implement WebSocket mocking for multiplayer tests

---

## 1. Current State

### 1.1 Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| Config | ✅ | `app/playwright.config.ts` |
| Test Directory | ✅ | `app/e2e/` |
| Test Utilities | ✅ | `app/e2e/test-utils.ts` |
| CI Integration | ✅ | `.github/workflows/ci.yml` |
| Dev Server | ✅ | Vite on port 5175, auto-starts |

**Configuration:**
```typescript
// Current playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
  },
  webServer: {
    command: 'npm run dev -- --port 5175',
    port: 5175,
    reuseExistingServer: true,
  },
});
```

### 1.2 Test Files (24 total, ~4,500 lines)

| File | Focus | CI Status |
|------|-------|-----------|
| `accessibility.spec.ts` | WCAG compliance, axe-core | ⚠️ Partial skip |
| `connection-storm.spec.ts` | WebSocket stability | ⚠️ Partial skip |
| `core.spec.ts` | Core sequencer functions | ⚠️ Partial skip |
| `instrument-audio.spec.ts` | Audio engine init, Tone.js | ⚠️ Partial skip |
| `keyboard.spec.ts` | Keyboard navigation | ⚠️ Partial skip |
| `last-cell-flicker.spec.ts` | Visual stability | ❌ Skipped |
| `mobile-android.spec.ts` | Android viewport tests | ✅ Runs |
| `mobile-iphone.spec.ts` | iPhone viewport tests | ⚠️ Partial skip |
| `multiplayer.spec.ts` | Real-time sync (2 browsers) | ❌ Skipped |
| `new-session.spec.ts` | Session creation | ✅ Runs |
| `phase3-refactoring.spec.ts` | Mutation tracking | ⚠️ Partial skip |
| `pitch-contour-alignment.spec.ts` | CSS/SVG alignment | ✅ Runs |
| `playback.spec.ts` | Playback stability | ✅ Runs |
| `plock-editor.spec.ts` | Parameter lock editing | ✅ Runs |
| `scrollbar.spec.ts` | Horizontal scrolling | ❌ Skipped |
| `session-persistence.spec.ts` | API create/load/update | ✅ Runs |
| `session-race.spec.ts` | Race conditions | ❌ Skipped |
| `track-reorder.spec.ts` | Drag-and-drop | ✅ Runs |
| `track-reorder-bug-fixes.spec.ts` | Reorder edge cases | ✅ Runs |
| `track-reorder-comprehensive.spec.ts` | Full reorder coverage | ✅ Runs |
| `track-reorder-precision.spec.ts` | Precise drag positions | ✅ Runs |
| `track-reorder-single-track-drag.spec.ts` | Single track drag | ✅ Runs |
| `velocity-lane.spec.ts` | Velocity editing | ⚠️ Partial skip |
| `visual.spec.ts` | Visual regression | ✅ Runs |

**Summary:** 12/24 files fully run in CI (50%), 12/24 have some skipped tests

### 1.3 Test Utilities (`test-utils.ts`)

Good patterns present:
- `createSessionWithRetry()` - Exponential backoff for API calls
- `getSessionWithRetry()` - Handles KV eventual consistency
- `sleep()` - Timing utility
- Typed interfaces (`SessionState`, `SessionResponse`)

### 1.4 Strengths

1. **Audio Debug API** - `window.audioDebug` exposes engine state for testing
2. **Race Condition Tests** - `instrument-audio.spec.ts` runs tests 5x to catch intermittent failures
3. **Real Browser Testing** - No mocking, tests actual behavior
4. **CI Report Upload** - Playwright report uploaded on failure for debugging
5. **Thoughtful Skip Logic** - Uses `test.skip(!!process.env.CI)` with clear comments

---

## 2. Gap Analysis

### 2.1 Critical Gaps

| Gap | Impact | Evidence |
|-----|--------|----------|
| **38% tests skip in CI** | Multiplayer, playback, session races untested | 5/13 files have `test.skip` |
| **No network mocking** | Tests flaky, depend on real backend | TEST-AUDIT.md documents 2 production bugs |
| **Chromium only** | Safari/Firefox issues undetected | Config has single browser |
| **No mobile testing** | Responsive bugs undetected | Only 1 viewport check exists |
| **No accessibility testing** | WCAG violations undetected | No axe-core integration |
| **No visual regression** | CSS bugs undetected | No `toHaveScreenshot()` usage |

### 2.2 Production Bugs That Escaped

From `specs/research/TEST-AUDIT.md`:

1. **WebSocket Connection Storm**
   - Cause: Unstable React callback references
   - Why missed: Unit tests mocked WebSocket, didn't catch real timing

2. **State Hash Mismatch**
   - Cause: Serialization boundary differences (client: `soloed: false`, server: `soloed: undefined`)
   - Why missed: No integration test verified hash match after network round-trip

### 2.3 Missing Modern Patterns

| Pattern | Status | Available Since |
|---------|--------|-----------------|
| Network Mocking (`page.route()`) | ❌ Not used | Playwright 1.0 |
| Visual Regression (`toHaveScreenshot()`) | ❌ Not used | Playwright 1.22 |
| Component Testing | ❌ Not used | Playwright 1.45 |
| Accessibility Testing | ❌ Not used | @axe-core/playwright |
| Trace Viewer | ❌ Not configured | Playwright 1.12 |
| Test Fixtures | ⚠️ Basic | Playwright 1.0 |
| Page Object Model | ⚠️ Partial | Best practice |

---

## 3. Proposed Architecture

### 3.1 Configuration (Modern)

```typescript
// playwright.config.ts - Proposed
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,

  // Parallel execution
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,

  // Reporting
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],

  use: {
    baseURL: 'http://localhost:5175',
    headless: true,

    // Tracing for debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',

    // Accessibility
    actionTimeout: 10000,
  },

  // Cross-browser + mobile
  projects: [
    // Desktop browsers
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },

    // Mobile viewports
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],

  webServer: {
    command: 'npm run dev -- --port 5175',
    port: 5175,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

### 3.2 Network Mocking Strategy

The key insight: **mock the backend in CI, use real backend locally**.

```typescript
// e2e/fixtures/network.ts
import { test as base, Page } from '@playwright/test';

// Mock session API responses
async function mockSessionAPI(page: Page, sessionData: SessionState) {
  await page.route('**/api/sessions/**', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: sessionData }),
      });
    } else if (method === 'PUT') {
      // Simulate save, update sessionData
      const body = await route.request().postDataJSON();
      Object.assign(sessionData, body);
      await route.fulfill({ status: 200 });
    } else {
      await route.continue();
    }
  });
}

// Mock WebSocket for multiplayer tests
async function mockWebSocket(page: Page) {
  await page.addInitScript(() => {
    // Intercept WebSocket constructor
    const RealWebSocket = window.WebSocket;
    window.WebSocket = class MockWebSocket extends RealWebSocket {
      constructor(url: string) {
        // In CI, use mock; locally, use real
        if (url.includes('localhost')) {
          super(url);
        } else {
          // Return mock that tracks connection attempts
          super(url);
        }
      }
    };
  });
}

// Export as fixture
export const test = base.extend<{ mockAPI: typeof mockSessionAPI }>({
  mockAPI: async ({ page }, use) => {
    await use((data) => mockSessionAPI(page, data));
  },
});
```

### 3.3 Test Fixtures

```typescript
// e2e/fixtures/session.fixture.ts
import { test as base } from '@playwright/test';

type SessionFixture = {
  freshSession: { id: string; url: string };
  sessionWithTracks: { id: string; url: string; tracks: Track[] };
};

export const test = base.extend<SessionFixture>({
  freshSession: async ({ page, request }, use) => {
    // Create session via API
    const res = await request.post('/api/sessions', {
      data: { tracks: [], tempo: 120, swing: 0, version: 1 },
    });
    const { id } = await res.json();

    await use({ id, url: `/s/${id}` });

    // Cleanup (optional)
  },

  sessionWithTracks: async ({ page, request }, use) => {
    const tracks = [
      { id: 'kick', name: 'Kick', sampleId: 'kick', steps: Array(64).fill(false) },
      { id: 'snare', name: 'Snare', sampleId: 'snare', steps: Array(64).fill(false) },
    ];

    const res = await request.post('/api/sessions', {
      data: { tracks, tempo: 120, swing: 0, version: 1 },
    });
    const { id } = await res.json();

    await use({ id, url: `/s/${id}`, tracks });
  },
});
```

### 3.4 Page Object Model

```typescript
// e2e/pages/sequencer.page.ts
import { Page, Locator, expect } from '@playwright/test';

export class SequencerPage {
  readonly page: Page;
  readonly playButton: Locator;
  readonly stopButton: Locator;
  readonly tempoDisplay: Locator;
  readonly trackRows: Locator;

  constructor(page: Page) {
    this.page = page;
    this.playButton = page.getByTestId('play-button');
    this.stopButton = page.getByTestId('stop-button');
    this.tempoDisplay = page.locator('.transport-number');
    this.trackRows = page.locator('.track-row');
  }

  async goto(sessionUrl: string) {
    await this.page.goto(sessionUrl);
    await this.page.waitForLoadState('networkidle');
  }

  async toggleStep(trackIndex: number, stepIndex: number) {
    const step = this.trackRows.nth(trackIndex).locator('.step-cell').nth(stepIndex);
    await step.click();
    return step;
  }

  async expectStepActive(trackIndex: number, stepIndex: number) {
    const step = this.trackRows.nth(trackIndex).locator('.step-cell').nth(stepIndex);
    await expect(step).toHaveClass(/active/);
  }

  async setTempo(bpm: number) {
    // Drag-to-adjust implementation
    const control = this.page.locator('.transport-value').first();
    const box = await control.boundingBox();
    if (!box) throw new Error('Tempo control not found');

    const currentBpm = Number(await this.tempoDisplay.textContent());
    const delta = bpm - currentBpm;
    const dragDistance = delta * -2; // 2px per BPM

    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dragDistance);
    await this.page.mouse.up();
  }

  async addTrack(instrumentId: string) {
    const picker = this.page.locator('.sample-picker');
    await picker.locator(`[data-instrument="${instrumentId}"]`).click();
  }
}
```

### 3.5 Accessibility Testing

```typescript
// e2e/accessibility.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('sequencer page has no critical violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('.velocity-canvas') // Canvas elements need special handling
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('keyboard navigation works', async ({ page }) => {
    await page.goto('/');

    // Tab through interactive elements
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();

    // Space to toggle step
    await page.keyboard.press('Tab'); // Focus step
    await page.keyboard.press('Space');
    await expect(page.locator('.step-cell:focus')).toHaveClass(/active/);
  });
});
```

### 3.6 Visual Regression Testing

```typescript
// e2e/visual.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('step grid appearance', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for any animations to settle
    await page.waitForTimeout(500);

    await expect(page.locator('.sequencer-grid')).toHaveScreenshot('step-grid.png', {
      maxDiffPixels: 100, // Allow minor anti-aliasing differences
    });
  });

  test('velocity lane expanded', async ({ page }) => {
    await page.goto('/');

    // Expand velocity lane
    await page.locator('[data-testid="velocity-toggle"]').click();
    await page.waitForTimeout(300); // Animation

    await expect(page.locator('.velocity-lane')).toHaveScreenshot('velocity-lane.png');
  });

  test('mobile layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }); // iPhone
    await page.goto('/');

    await expect(page).toHaveScreenshot('mobile-layout.png');
  });
});
```

---

## 4. Test Coverage Plan

### 4.1 Core Sequencer Features

| Feature | Priority | Test Type | Status |
|---------|----------|-----------|--------|
| Step toggle | P0 | E2E | ✅ Exists |
| Drag-to-paint | P0 | E2E | ❌ Missing |
| Multi-select (Ctrl+Click) | P1 | E2E | ❌ Missing |
| Playback start/stop | P0 | E2E | ⚠️ Skipped in CI |
| Tempo control | P1 | E2E | ❌ Missing |
| Swing control | P2 | E2E | ❌ Missing |
| Track add/remove | P0 | E2E | ✅ Exists |

### 4.2 Track Management

| Feature | Priority | Test Type | Status |
|---------|----------|-----------|--------|
| Track reorder | P0 | E2E | ✅ Exists |
| Track mute/solo | P1 | E2E | ⚠️ Multiplayer only |
| Track rename | P2 | E2E | ❌ Missing |
| Track delete | P1 | E2E | ❌ Missing |
| Track copy pattern | P2 | E2E | ❌ Missing |
| Per-track step count | P1 | E2E | ❌ Missing |
| Per-track transpose | P2 | E2E | ❌ Missing |

### 4.3 Velocity & Parameter Locks

| Feature | Priority | Test Type | Status |
|---------|----------|-----------|--------|
| Velocity lane toggle | P1 | E2E | ✅ Exists |
| Velocity adjustment | P1 | E2E | ✅ Exists |
| P-lock editor (Shift+click) | P1 | E2E | ✅ Exists |
| Pitch/volume p-lock | P1 | E2E | ❌ Missing |
| Tie notes | P2 | E2E | ❌ Missing |

### 4.4 Multiplayer Sync

| Feature | Priority | Test Type | Status |
|---------|----------|-----------|--------|
| Step toggle sync | P0 | E2E | ⚠️ Skipped in CI |
| Tempo sync | P0 | E2E | ⚠️ Skipped in CI |
| Track add sync | P0 | E2E | ⚠️ Skipped in CI |
| Track reorder sync | P0 | E2E | ❌ Missing |
| Player join/leave | P1 | E2E | ⚠️ Skipped in CI |
| Cursor sync | P1 | E2E | ❌ Missing |
| Reconnection recovery | P0 | E2E | ⚠️ Skipped in CI |

### 4.5 Session Management

| Feature | Priority | Test Type | Status |
|---------|----------|-----------|--------|
| New session creation | P0 | E2E | ✅ Exists |
| Session load from URL | P0 | E2E | ✅ Exists |
| Session name edit | P2 | E2E | ❌ Missing |
| Remix session | P1 | E2E | ❌ Missing |
| Publish session | P1 | E2E | ❌ Missing |
| MIDI export | P2 | E2E | ❌ Missing |

### 4.6 Audio

| Feature | Priority | Test Type | Status |
|---------|----------|-----------|--------|
| Audio engine init | P0 | E2E | ✅ Exists |
| Instrument preview | P1 | E2E | ✅ Exists |
| Tone.js synth init | P0 | E2E | ✅ Exists |
| Advanced synth init | P0 | E2E | ✅ Exists |
| Audio timing accuracy | P1 | E2E | ❌ Missing |

### 4.7 Non-Functional

| Feature | Priority | Test Type | Status |
|---------|----------|-----------|--------|
| Accessibility (WCAG 2.1 AA) | P1 | E2E | ❌ Missing |
| Visual regression | P2 | E2E | ❌ Missing |
| Mobile responsiveness | P1 | E2E | ⚠️ 1 test only |
| Cross-browser (Firefox) | P2 | E2E | ❌ Missing |
| Cross-browser (Safari) | P1 | E2E | ❌ Missing |
| Performance (LCP < 2.5s) | P2 | E2E | ❌ Missing |

---

## 5. Implementation Plan

### Phase 1: Infrastructure Modernization (Week 1)

1. **Update `playwright.config.ts`**
   - Add cross-browser projects (Firefox, WebKit)
   - Add mobile viewports
   - Enable tracing on first retry
   - Configure reporters for CI

2. **Create test fixtures**
   - Session fixture (fresh, with tracks)
   - Network mocking fixture
   - Two-client fixture

3. **Create page objects**
   - `SequencerPage`
   - `TransportPage`
   - `InstrumentPickerPage`

### Phase 2: Enable Skipped Tests (Week 2)

4. **Add network mocking**
   - Mock API endpoints (`/api/sessions/*`)
   - Mock WebSocket for multiplayer tests
   - Remove `test.skip(!!process.env.CI)` from files

5. **Fix flaky tests**
   - `playback.spec.ts` - Use mock clock or increase tolerance
   - `last-cell-flicker.spec.ts` - Use visual regression instead

6. **Migrate multiplayer tests**
   - Convert `multiplayer.spec.ts` to use mocked WebSocket
   - Ensure deterministic behavior

### Phase 3: Coverage Expansion (Week 3-4)

7. **Add missing P0 tests**
   - Drag-to-paint
   - Tempo/swing controls
   - Session name edit

8. **Add accessibility testing**
   - Install @axe-core/playwright
   - Create accessibility test suite
   - Add keyboard navigation tests

9. **Add visual regression**
   - Baseline screenshots for key states
   - Mobile layout screenshots
   - Component-level screenshots

### Phase 4: Advanced Testing (Week 5)

10. **Add cross-browser coverage**
    - Run full suite on Firefox
    - Run core tests on WebKit
    - Document browser-specific issues

11. **Add performance tests**
    - LCP measurement
    - Time to Interactive
    - Memory usage over time

12. **Add network resilience tests**
    - Offline → reconnect
    - Slow network simulation
    - Packet loss handling

---

## 6. Success Criteria

### Minimum Viable

- [ ] All 13 test files run in CI (no skips)
- [ ] 90%+ of P0 features have E2E tests
- [ ] Accessibility scan passes with 0 critical violations
- [ ] Tests pass on Chromium + Firefox

### Target

- [ ] 100% of P0 and P1 features have E2E tests
- [ ] Visual regression for 5+ key screens
- [ ] Tests pass on all 3 browsers (Chromium, Firefox, WebKit)
- [ ] Mobile tests pass on iOS + Android viewports
- [ ] Trace viewer configured for debugging failures

### Stretch

- [ ] Property-based tests for sync (Phase 32 integration)
- [ ] Performance budget enforcement
- [ ] Flaky test detection and quarantine

---

## 7. Appendix: File Inventory

### Existing Test Files

```
app/e2e/
├── connection-storm.spec.ts    (95 lines)
├── instrument-audio.spec.ts    (476 lines)
├── last-cell-flicker.spec.ts   (51 lines)
├── multiplayer.spec.ts         (338 lines)
├── new-session.spec.ts         (189 lines)
├── pitch-contour-alignment.spec.ts (96 lines)
├── playback.spec.ts            (87 lines)
├── plock-editor.spec.ts        (201 lines)
├── scrollbar.spec.ts           (112 lines)
├── session-persistence.spec.ts (278 lines)
├── session-race.spec.ts        (156 lines)
├── test-utils.ts               (172 lines)
├── track-reorder.spec.ts       (312 lines)
└── velocity-lane.spec.ts       (289 lines)

Total: ~2,852 lines of test code
```

### Proposed New Files

```
app/e2e/
├── fixtures/
│   ├── network.fixture.ts      # API/WebSocket mocking
│   ├── session.fixture.ts      # Session creation/cleanup
│   └── multiplayer.fixture.ts  # Two-client setup
├── pages/
│   ├── sequencer.page.ts       # Page object for main UI
│   ├── transport.page.ts       # Playback controls
│   └── picker.page.ts          # Instrument picker
├── accessibility.spec.ts       # WCAG compliance tests
├── visual.spec.ts              # Visual regression tests
├── mobile.spec.ts              # Mobile-specific tests
└── keyboard.spec.ts            # Keyboard navigation tests
```

---

## 8. References

- [Playwright Documentation](https://playwright.dev/)
- [specs/research/TEST-AUDIT.md](./TEST-AUDIT.md) - Gap analysis that informed this spec
- [specs/TESTING.md](../TESTING.md) - Overall testing strategy
- [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
- [Phase 37 in ROADMAP.md](../ROADMAP.md) - Original roadmap entry
