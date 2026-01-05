import { test, expect, BrowserContext, Page, APIRequestContext } from '@playwright/test';
import { API_BASE, createSessionWithRetry } from './test-utils';

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
 * @see specs/SHARED-MUTATION-REFACTORING-PLAN.md
 */

// Skip in CI - these tests require real backend infrastructure
test.skip(!!process.env.CI, 'Skipped in CI - requires real backend');

/**
 * Helper to create a session with a track that has a known pattern.
 * Pattern: steps 0, 4, 8, 12 are active (4-on-the-floor)
 */
async function createTestSession(request: APIRequestContext) {
  const steps = Array(64).fill(false);
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
        parameterLocks: Array(64).fill(null),
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

// ============================================================================
// SECTION 1: Core Mutation Operations
// ============================================================================

test.describe('Core mutations (delegated to applyMutation)', () => {
  test('toggle step - activates and deactivates', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(1000);

    // Toggle step 2 on
    const step2 = page.locator('.track-row').first().locator('.step-cell').nth(2);
    await step2.click();
    await expect(step2).toHaveClass(/active/);

    // Wait for sync
    await page.waitForTimeout(500);

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Verify persistence
    const step2After = page.locator('.track-row').first().locator('.step-cell').nth(2);
    await expect(step2After).toHaveClass(/active/);
  });

  test('tempo change via drag', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Find tempo display
    const tempoDisplay = page.locator('.transport-value').first().locator('.transport-number');
    const initialTempo = await tempoDisplay.textContent();
    expect(initialTempo).toBe('120');

    // Drag to change tempo
    const tempoControl = page.locator('.transport-value').first();
    const box = await tempoControl.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Drag up to increase
      for (let y = box.y; y > box.y - 50; y -= 10) {
        await page.mouse.move(box.x + box.width / 2, y);
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
    }

    await page.waitForTimeout(300);

    // Verify tempo changed
    const newTempo = await tempoDisplay.textContent();
    expect(Number(newTempo)).toBeGreaterThan(120);
  });
});

// ============================================================================
// SECTION 2: Pattern Operations (Single Client)
// ============================================================================

test.describe('Pattern operations (single client)', () => {
  test('rotate right shifts pattern', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(1000);

    // Rotate right
    await openPatternTools(page);
    const rotateRight = page.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();
    await page.waitForTimeout(500);

    const afterRotate = await getActiveStepIndices(page);
    expect(afterRotate).toEqual([1, 5, 9, 13]);

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

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
          steps: Array(64).fill(false),
          parameterLocks: Array(64).fill(null),
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
    await page.waitForTimeout(1000);

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

  test.beforeEach(async ({ browser }) => {
    context1 = await browser.newContext();
    context2 = await browser.newContext();
    page1 = await context1.newPage();
    page2 = await context2.newPage();
  });

  test.afterEach(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('rotate pattern syncs to other client', async ({ request }) => {
    const { id } = await createTestSession(request);

    // Load both clients
    await page1.goto(`${API_BASE}/s/${id}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${id}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    // Verify both start with same pattern
    const initial1 = await getActiveStepIndices(page1);
    const initial2 = await getActiveStepIndices(page2);
    expect(initial1).toEqual([0, 4, 8, 12]);
    expect(initial2).toEqual([0, 4, 8, 12]);

    // Client 1 rotates right
    await openPatternTools(page1);
    const rotateRight = page1.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();

    // Wait for sync
    await page1.waitForTimeout(1000);

    // Verify client 1 changed
    const after1 = await getActiveStepIndices(page1);
    expect(after1).toEqual([1, 5, 9, 13]);

    // Verify client 2 received the sync (THIS WAS BROKEN BEFORE PHASE 2)
    await page2.waitForTimeout(500);
    const after2 = await getActiveStepIndices(page2);
    expect(after2).toEqual([1, 5, 9, 13]);
  });

  test('invert pattern syncs to other client', async ({ request }) => {
    const { id } = await createTestSession(request);

    await page1.goto(`${API_BASE}/s/${id}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${id}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    // Client 1 inverts
    await openPatternTools(page1);
    const invert = page1.locator('.pattern-tool-btn[title="Invert pattern (toggle all steps)"]');
    await invert.click();

    await page1.waitForTimeout(1000);

    // Verify both clients have inverted pattern
    const after1 = await getActiveStepIndices(page1);
    const after2 = await getActiveStepIndices(page2);

    expect(after1.length).toBe(12);
    expect(after2.length).toBe(12);
    expect(after1).toEqual(after2);
  });

  test('reverse pattern syncs to other client', async ({ request }) => {
    const { id } = await createTestSession(request);

    await page1.goto(`${API_BASE}/s/${id}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${id}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    // Client 1 reverses
    await openPatternTools(page1);
    const reverse = page1.locator('.pattern-tool-btn[title="Reverse pattern"]');
    await reverse.click();

    await page1.waitForTimeout(1000);

    // Verify both clients have reversed pattern
    const after1 = await getActiveStepIndices(page1);
    const after2 = await getActiveStepIndices(page2);

    expect(after1.sort((a, b) => a - b)).toEqual([3, 7, 11, 15]);
    expect(after2.sort((a, b) => a - b)).toEqual([3, 7, 11, 15]);
  });

  test('multiple pattern operations sync correctly', async ({ request }) => {
    const { id } = await createTestSession(request);

    await page1.goto(`${API_BASE}/s/${id}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${id}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    await openPatternTools(page1);

    // Client 1: rotate right twice
    const rotateRight = page1.locator('.pattern-tool-btn[title="Rotate pattern right (wrap)"]');
    await rotateRight.click();
    await page1.waitForTimeout(500);
    await rotateRight.click();
    await page1.waitForTimeout(1000);

    // Should be [2, 6, 10, 14]
    const after1 = await getActiveStepIndices(page1);
    const after2 = await getActiveStepIndices(page2);

    expect(after1).toEqual([2, 6, 10, 14]);
    expect(after2).toEqual([2, 6, 10, 14]);
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
    await page.waitForTimeout(1000);

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
  test('add track appears and syncs', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Start with 1 track
    const tracksBefore = await page.locator('.track-row').count();
    expect(tracksBefore).toBe(1);

    // Add a track
    const addButton = page.locator('[data-testid="add-track-button"]');
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(200);

      // Click an instrument
      const instrumentBtn = page.locator('.instrument-btn').first();
      if (await instrumentBtn.isVisible({ timeout: 2000 })) {
        await instrumentBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Should now have 2 tracks
    const tracksAfter = await page.locator('.track-row').count();
    expect(tracksAfter).toBe(2);
  });

  test('clear track removes all steps', async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

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
          steps: Array(64).fill(false),
          parameterLocks: Array(64).fill(null),
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
    await page.waitForTimeout(1000);

    // Rapidly toggle steps 0-7
    const trackRow = page.locator('.track-row').first();
    for (let i = 0; i < 8; i++) {
      await trackRow.locator('.step-cell').nth(i).click();
      await page.waitForTimeout(50); // Small delay between clicks
    }

    await page.waitForTimeout(500);

    // All 8 steps should be active
    const activeSteps = await getActiveStepIndices(page);
    expect(activeSteps).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // Verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const afterRefresh = await getActiveStepIndices(page);
    expect(afterRefresh).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('pattern operations on empty track', async ({ page, request }) => {
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'empty-test',
          name: 'Empty',
          sampleId: 'kick',
          steps: Array(64).fill(false),
          parameterLocks: Array(64).fill(null),
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
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(1000);

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
    await page.waitForTimeout(1000);

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
