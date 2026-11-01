import { BrowserContext, APIRequestContext } from '@playwright/test';
import { test, expect, getBaseUrl, useMockAPI } from './global-setup';
import type { Page } from './global-setup';
import { createSessionWithRetry } from './test-utils';
import { createE2EContext } from './browser-context';

const API_BASE = getBaseUrl();

/**
 * Phase 3 Refactoring E2E Tests
 *
 * These tests verify that the gridReducer → applyMutation refactoring
 * hasn't broken any user-facing behavior. Key areas tested:
 *
 * 1. Core mutations (toggle step, clear track, tempo/swing changes)
 * 2. Pattern operations (rotate, invert, reverse, mirror, Euclidean)
 * 3. Pattern operation sync in multiplayer
 * 4. Selection invalidation after pattern operations
 * 5. Loop region handling
 * 6. Persistence across page refresh
 *
 * NOTE: The pattern operation algorithms are unit tested in src/utils/patternOps.test.ts
 * and src/utils/patternOps.property.test.ts. These E2E tests verify the full user flow:
 * - UI interaction triggers correct operation
 * - Results persist to backend
 * - Changes sync to other clients in multiplayer
 *
 * @see specs/SHARED-MUTATION-REFACTORING-PLAN.md
 * @see src/utils/patternOps.test.ts
 * @see src/utils/patternOps.property.test.ts
 */

// Multiplayer sync tests require real WebSocket backend
test.skip(useMockAPI, 'Phase 3 tests include multiplayer sync requiring real backend');

/**
 * Helper to create a session with a track that has a known pattern.
 * Pattern: steps 0, 4, 8, 12 are active (4-on-the-floor)
 */
async function createTestSession(request: APIRequestContext) {
  const steps = Array(128).fill(false);
  steps[0] = true;
  steps[4] = true;
  steps[8] = true;
  steps[12] = true;

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps,
        parameterLocks: Array(128).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  });
}

/**
 * Helper to open pattern tools panel for a track
 */
async function openPatternTools(page: Page, trackIndex = 0) {
  const trackRow = page.locator('.track-row').nth(trackIndex);
  const patternToolsToggle = trackRow.locator('.pattern-tools-toggle');
  await patternToolsToggle.click();
  // Wait for panel to expand
  await page.waitForTimeout(300);
}

/**
 * Helper to get active step indices for a track
 */
async function getActiveStepIndices(page: Page, trackIndex = 0): Promise<number[]> {
  const trackRow = page.locator('.track-row').nth(trackIndex);
  const stepCells = trackRow.locator('.step-cell');
  const count = await stepCells.count();
  const activeIndices: number[] = [];

  for (let i = 0; i < count; i++) {
    const cell = stepCells.nth(i);
    const classList = await cell.getAttribute('class');
    if (classList?.includes('active')) {
      activeIndices.push(i);
    }
  }

  return activeIndices;
}

async function expectConnected(page: Page) {
  await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10_000 });
}

async function expectActiveStepIndices(
  page: Page,
  expected: number[],
  trackIndex = 0,
) {
  await expect.poll(
    () => getActiveStepIndices(page, trackIndex),
    { timeout: 10_000 },
  ).toEqual(expected);
}

async function getPersistedActiveStepIndices(
  request: APIRequestContext,
  sessionId: string,
): Promise<number[] | null> {
  const response = await request.get(`${API_BASE}/api/sessions/${sessionId}`);
  if (!response.ok()) return null;
  const session = await response.json();
  const track = session.state?.tracks?.[0];
  if (!track) return null;
  return track.steps
    .slice(0, track.stepCount)
    .flatMap((active: boolean, index: number) => active ? [index] : []);
}

// ============================================================================
// SECTION 1: Core Mutation Operations
// ============================================================================

test.describe('Core mutations (delegated to applyMutation)', () => {
  test('toggle step - activates and deactivates', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Find step 1 (should be inactive)
    const step1 = page.locator('.track-row').first().locator('.step-cell').nth(1);
    await expect(step1).not.toHaveClass(/active/);

    // Toggle on
    await step1.click();
    await expect(step1).toHaveClass(/active/);

    // Toggle off
    await step1.click();
    await expect(step1).not.toHaveClass(/active/);
  });

  test('toggle step - persists after refresh', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Toggle step 2 on
    const step2 = page.locator('.track-row').first().locator('.step-cell').nth(2);
    await step2.click();
    await expect(step2).toHaveClass(/active/);

    await expect.poll(
      () => getPersistedActiveStepIndices(request, id),
      { timeout: 12_000 },
    ).toEqual([0, 2, 4, 8, 12]);

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Verify persistence
    const step2After = page.locator('.track-row').first().locator('.step-cell').nth(2);
    await expect(step2After).toHaveClass(/active/);
  });

  // NOTE: "tempo change via drag" test was removed.
  // Playwright's mouse.move() doesn't set e.buttons property (see GitHub issue #12821).
  // Tempo mutation logic is comprehensively tested in src/components/tempo-change.test.ts
});

// ============================================================================
// SECTION 2: Pattern Operations (Single Client)
// ============================================================================

test.describe('Pattern operations (single client)', () => {
  test('rotate right shifts pattern', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Initial pattern: [0, 4, 8, 12]
    const initialActive = await getActiveStepIndices(page);
    expect(initialActive).toEqual([0, 4, 8, 12]);

    // Open pattern tools and click rotate right
    await openPatternTools(page);
    const rotateRight = page.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();
    await page.waitForTimeout(300);

    // Should now be [1, 5, 9, 13]
    const afterRotate = await getActiveStepIndices(page);
    expect(afterRotate).toEqual([1, 5, 9, 13]);
  });

  test('rotate left shifts pattern', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Initial pattern: [0, 4, 8, 12]
    await openPatternTools(page);
    const rotateLeft = page.locator('.pattern-tool-btn[title="Rotate pattern left (wrap)"]');
    await rotateLeft.click();
    await page.waitForTimeout(300);

    // Should now be [3, 7, 11, 15] (wrapped)
    const afterRotate = await getActiveStepIndices(page);
    expect(afterRotate).toEqual([3, 7, 11, 15]);
  });

  test('invert pattern toggles all steps', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Initial: 4 active steps
    const initialActive = await getActiveStepIndices(page);
    expect(initialActive.length).toBe(4);

    await openPatternTools(page);
    const invert = page.locator('.pattern-tool-btn[title="Invert pattern (toggle all steps)"]');
    await invert.click();
    await page.waitForTimeout(300);

    // After invert: 12 active steps (16 - 4)
    const afterInvert = await getActiveStepIndices(page);
    expect(afterInvert.length).toBe(12);

    // The originally active steps should now be inactive
    expect(afterInvert).not.toContain(0);
    expect(afterInvert).not.toContain(4);
    expect(afterInvert).not.toContain(8);
    expect(afterInvert).not.toContain(12);
  });

  test('reverse pattern reverses step order', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Initial pattern: [0, 4, 8, 12]
    await openPatternTools(page);
    const reverse = page.locator('.pattern-tool-btn[title="Reverse pattern"]');
    await reverse.click();
    await page.waitForTimeout(300);

    // Reversed: indices 15-0, 15-4, 15-8, 15-12 = [15, 11, 7, 3]
    const afterReverse = await getActiveStepIndices(page);
    expect(afterReverse.sort((a, b) => a - b)).toEqual([3, 7, 11, 15]);
  });

  test('pattern operation persists after refresh', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Rotate right
    await openPatternTools(page);
    const rotateRight = page.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();

    const afterRotate = await getActiveStepIndices(page);
    expect(afterRotate).toEqual([1, 5, 9, 13]);

    await expect.poll(
      () => getPersistedActiveStepIndices(request, id),
      { timeout: 12_000 },
    ).toEqual([1, 5, 9, 13]);

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Verify persistence
    const afterRefresh = await getActiveStepIndices(page);
    expect(afterRefresh).toEqual([1, 5, 9, 13]);
  });

  test('Euclidean fill distributes steps evenly', async ({ page, request }) => {
    // Start with empty track
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'euclidean-test',
          name: 'Test',
          sampleId: 'kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Open pattern tools
    await openPatternTools(page);

    // Set Euclidean slider to 4 (classic 4-on-the-floor)
    const slider = page.locator('.euclidean-slider');
    await slider.fill('4');
    await page.waitForTimeout(300);

    // Should have exactly 4 active steps
    const activeSteps = await getActiveStepIndices(page);
    expect(activeSteps.length).toBe(4);

    // Steps should be evenly distributed: [0, 4, 8, 12]
    expect(activeSteps).toEqual([0, 4, 8, 12]);
  });
});

// ============================================================================
// SECTION 3: Pattern Operation Sync (Multiplayer)
// ============================================================================

test.describe('Pattern operations sync in multiplayer', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeEach(async ({ browser, browserName }) => {
    context1 = await createE2EContext(browser, browserName);
    context2 = await createE2EContext(browser, browserName);
    page1 = await context1.newPage();
    page2 = await context2.newPage();
  });

  test.afterEach(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('rotate pattern syncs to other client', async ({ request }) => {
    const { id } = await createTestSession(request);

    await Promise.all([
      page1.goto(`${API_BASE}/s/${id}`),
      page2.goto(`${API_BASE}/s/${id}`),
    ]);
    await Promise.all([expectConnected(page1), expectConnected(page2)]);

    // Verify both start with same pattern
    await Promise.all([
      expectActiveStepIndices(page1, [0, 4, 8, 12]),
      expectActiveStepIndices(page2, [0, 4, 8, 12]),
    ]);

    // Client 1 rotates right
    await openPatternTools(page1);
    const rotateRight = page1.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();

    // Verify client 2 received the sync (THIS WAS BROKEN BEFORE PHASE 2)
    await Promise.all([
      expectActiveStepIndices(page1, [1, 5, 9, 13]),
      expectActiveStepIndices(page2, [1, 5, 9, 13]),
    ]);
  });

  test('invert pattern syncs to other client', async ({ request }) => {
    const { id } = await createTestSession(request);

    await Promise.all([
      page1.goto(`${API_BASE}/s/${id}`),
      page2.goto(`${API_BASE}/s/${id}`),
    ]);
    await Promise.all([expectConnected(page1), expectConnected(page2)]);

    // Client 1 inverts
    await openPatternTools(page1);
    const invert = page1.locator('.pattern-tool-btn[title="Invert pattern (toggle all steps)"]');
    await invert.click();

    const inverted = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15];
    await Promise.all([
      expectActiveStepIndices(page1, inverted),
      expectActiveStepIndices(page2, inverted),
    ]);
  });

  test('reverse pattern syncs to other client', async ({ request }) => {
    const { id } = await createTestSession(request);

    await Promise.all([
      page1.goto(`${API_BASE}/s/${id}`),
      page2.goto(`${API_BASE}/s/${id}`),
    ]);
    await Promise.all([expectConnected(page1), expectConnected(page2)]);

    // Client 1 reverses
    await openPatternTools(page1);
    const reverse = page1.locator('.pattern-tool-btn[title="Reverse pattern"]');
    await reverse.click();

    await Promise.all([
      expectActiveStepIndices(page1, [3, 7, 11, 15]),
      expectActiveStepIndices(page2, [3, 7, 11, 15]),
    ]);
  });

  test('multiple pattern operations sync correctly', async ({ request }) => {
    const { id } = await createTestSession(request);

    await Promise.all([
      page1.goto(`${API_BASE}/s/${id}`),
      page2.goto(`${API_BASE}/s/${id}`),
    ]);
    await Promise.all([expectConnected(page1), expectConnected(page2)]);

    await openPatternTools(page1);

    // Client 1: rotate right twice
    const rotateRight = page1.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();
    await expectActiveStepIndices(page1, [1, 5, 9, 13]);
    await rotateRight.click();

    await Promise.all([
      expectActiveStepIndices(page1, [2, 6, 10, 14]),
      expectActiveStepIndices(page2, [2, 6, 10, 14]),
    ]);
  });
});

// ============================================================================
// SECTION 4: Selection Invalidation
// ============================================================================

test.describe('Selection invalidation after pattern operations', () => {
  test('selection clears after rotate', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Select some steps by shift-clicking
    const trackRow = page.locator('.track-row').first();
    const step0 = trackRow.locator('.step-cell').nth(0);
    const step4 = trackRow.locator('.step-cell').nth(4);

    // Click first step to select
    await step0.click({ modifiers: ['Shift'] });
    await page.waitForTimeout(100);

    // Shift-click to extend selection
    await step4.click({ modifiers: ['Shift'] });
    await page.waitForTimeout(200);

    // Verify selection exists (steps have 'selected' class)
    const selectedBefore = await trackRow.locator('.step-cell.selected').count();
    expect(selectedBefore).toBeGreaterThan(0);

    // Rotate pattern
    await openPatternTools(page);
    const rotateRight = page.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();
    await page.waitForTimeout(300);

    // Selection should be cleared (indices now point to different content)
    const selectedAfter = await trackRow.locator('.step-cell.selected').count();
    expect(selectedAfter).toBe(0);
  });
});

// ============================================================================
// SECTION 5: Track Operations
// ============================================================================

test.describe('Track operations', () => {
  test('add track appears and syncs', async ({ browser, browserName, request }) => {
    const { id } = await createTestSession(request);
    const senderContext = await createE2EContext(browser, browserName);
    const receiverContext = await createE2EContext(browser, browserName);
    try {
      const sender = await senderContext.newPage();
      const receiver = await receiverContext.newPage();
      await Promise.all([
        sender.goto(`${API_BASE}/s/${id}`),
        receiver.goto(`${API_BASE}/s/${id}`),
      ]);
      await Promise.all([expectConnected(sender), expectConnected(receiver)]);
      await Promise.all([
        expect(sender.locator('.track-row')).toHaveCount(1),
        expect(receiver.locator('.track-row')).toHaveCount(1),
      ]);

      const instrumentBtn = sender.getByRole('button', { name: /808 Snare/ }).first();
      await expect(instrumentBtn).toBeVisible();
      await instrumentBtn.click();
      await Promise.all([
        expect(sender.locator('.track-row')).toHaveCount(2),
        expect(receiver.locator('.track-row')).toHaveCount(2),
      ]);
    } finally {
      await senderContext.close();
      await receiverContext.close();
    }
  });

  test('clear track removes all steps', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Verify we have active steps
    const activeBefore = await getActiveStepIndices(page);
    expect(activeBefore.length).toBe(4);

    // Right-click on track to get context menu, or use clear button if available
    const trackRow = page.locator('.track-row').first();
    const clearButton = trackRow.locator('.clear-button, button[title*="Clear"]');

    if (await clearButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await clearButton.click();
    } else {
      // Try right-click context menu
      await trackRow.click({ button: 'right' });
      const clearMenuItem = page.locator('text=Clear');
      if (await clearMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        await clearMenuItem.click();
      }
    }

    await page.waitForTimeout(300);

    // All steps should be cleared
    const activeAfter = await getActiveStepIndices(page);
    expect(activeAfter.length).toBe(0);
  });
});

// ============================================================================
// SECTION 6: Edge Cases
// ============================================================================

test.describe('Edge cases', () => {
  test('rapid step toggling does not lose updates', async ({ page, request }) => {
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'rapid-test',
          name: 'Test',
          sampleId: 'kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Rapidly toggle steps 0-7
    const trackRow = page.locator('.track-row').first();
    for (let i = 0; i < 8; i++) {
      await trackRow.locator('.step-cell').nth(i).click();
      await page.waitForTimeout(50); // Small delay between clicks
    }

    const expected = [0, 1, 2, 3, 4, 5, 6, 7];
    await expectActiveStepIndices(page, expected);
    await expect.poll(
      () => getPersistedActiveStepIndices(request, id),
      { timeout: 12_000 },
    ).toEqual(expected);

    // Verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    await expectActiveStepIndices(page, expected);
  });

  test('pattern operations on empty track', async ({ page, request }) => {
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'empty-test',
          name: 'Empty',
          sampleId: 'kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    await openPatternTools(page);

    // Invert on empty track should fill all steps
    const invert = page.locator('.pattern-tool-btn[title="Invert pattern (toggle all steps)"]');
    await invert.click();
    await page.waitForTimeout(300);

    const activeSteps = await getActiveStepIndices(page);
    expect(activeSteps.length).toBe(16); // All steps should be active
  });

  test('operations work after page navigation', async ({ page, request }) => {
    const { id } = await createTestSession(request);

    // Navigate away
    await page.goto(`${API_BASE}/`);
    await page.waitForLoadState('networkidle');

    // Navigate back
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Operations should still work
    const step5 = page.locator('.track-row').first().locator('.step-cell').nth(5);
    await step5.click();
    await expect(step5).toHaveClass(/active/);

    // Pattern operations should work
    await openPatternTools(page);
    const rotateRight = page.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();
    await page.waitForTimeout(300);

    // Verify pattern changed
    const activeSteps = await getActiveStepIndices(page);
    expect(activeSteps).toContain(6); // Step 5 rotated right becomes step 6
  });
});

// ============================================================================
// SECTION 7: Console Error Monitoring
// ============================================================================

test.describe('Error monitoring', () => {
  test('no console errors during normal operations', async ({ page, request }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Perform various operations
    const trackRow = page.locator('.track-row').first();

    // Toggle some steps
    await trackRow.locator('.step-cell').nth(1).click();
    await trackRow.locator('.step-cell').nth(2).click();
    await page.waitForTimeout(200);

    // Pattern operations
    await openPatternTools(page);
    await page.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]').click();
    await page.waitForTimeout(200);
    await page.locator('.pattern-tool-btn[title="Invert pattern (toggle all steps)"]').click();
    await page.waitForTimeout(200);

    // Filter out expected/benign errors (e.g., WebSocket reconnection)
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('WebSocket') &&
        !err.includes('net::') &&
        !err.includes('Failed to load resource')
    );

    expect(criticalErrors).toEqual([]);
  });
});
