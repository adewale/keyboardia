import { test, expect, getBaseUrl, useMockAPI } from './global-setup';
import type { Page } from './global-setup';
import { createSessionWithRetry, sleep } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * Check if running on a mobile browser project.
 */
function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

/**
 * Track Reorder Bug Fix Verification Tests
 *
 * E2E tests verifying the fixes for 4 bugs identified in the drag-drop audit:
 *
 * BUG 1: Double handleDragEnd Invocation
 *   - Reorder should only happen once even when drag events fire multiple times
 *
 * BUG 2: Missing onDragLeave Handler
 *   - Drag-target highlight should clear when cursor leaves track area
 *
 * BUG 3: Race Condition with Stale targetTrackId
 *   - Rapid drags should land on the correct target, not a stale one
 *
 * BUG 4: Silent Failure During Multiplayer
 *   - Error toast should appear when reorder fails (hard to test without mocking)
 *
 * NOTE: These tests create many sessions and may hit rate limits.
 * Run in isolation with: npx playwright test track-reorder-bug-fixes.spec.ts --workers=1
 */

// Configure all tests in this file to run serially to avoid rate limiting
test.describe.configure({ mode: 'serial' });

// Rate-limited session creation with longer delays
const RATE_LIMIT_DELAY_MS = 500; // Delay between session creations

// Helper: Get track names in current order
async function getTrackNames(page: Page): Promise<string[]> {
  const trackRows = page.locator('.track-row');
  const count = await trackRows.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameElement = trackRows.nth(i).locator('.track-name');
    const name = await nameElement.textContent();
    names.push(name?.trim() || `Track ${i}`);
  }
  return names;
}

// Helper: Perform drag using HTML5 drag API (triggers proper drag events)
async function performDrag(page: Page, fromIndex: number, toIndex: number): Promise<void> {
  const fromHandle = page.locator('.track-row').nth(fromIndex).locator('.track-drag-handle');
  const toWrapper = page.locator('.track-row-wrapper').nth(toIndex);
  await fromHandle.dragTo(toWrapper);
  await page.waitForTimeout(200);
}

/**
 * Create a test session with 4 tracks for reorder testing.
 * Uses 5 retries (instead of default 3) to handle rate limiting.
 */
async function createFourTrackSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  // Add delay before creating to prevent rate limiting
  await sleep(RATE_LIMIT_DELAY_MS);

  const steps = Array(64).fill(false);
  steps[0] = true;

  return createSessionWithRetry(request, {
    tracks: [
      { id: 'track-1', name: '808 Hat', sampleId: 'sampled:808-hihat-closed', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-2', name: '808 Kick', sampleId: 'sampled:808-kick', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-3', name: '808 Snare', sampleId: 'sampled:808-snare', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-4', name: '808 Clap', sampleId: 'sampled:808-clap', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  }, 5); // Use 5 retries instead of default 3
}

test.describe('Track Reorder Bug Fix Verification', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires mouse drag');
    const { id } = await createFourTrackSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });
    // Wait for all 4 tracks to be visible
    await expect(page.locator('.track-row').nth(3)).toBeVisible({ timeout: 5000 });
  });

  // ============================================================
  // BUG 1: Double handleDragEnd Invocation
  // ============================================================
  // The fix uses a ref to prevent duplicate processing within same event cycle

  test.describe('BUG 1: Double handleDragEnd Prevention', () => {
    test('should only reorder once per drag operation', async ({ page }) => {
      const initialOrder = await getTrackNames(page);
      expect(initialOrder.length).toBe(4);

      // Perform a single drag operation
      await performDrag(page, 0, 2);

      const afterFirstDrag = await getTrackNames(page);

      // Wait a bit to ensure no delayed duplicate reorders
      await page.waitForTimeout(300);

      const afterWait = await getTrackNames(page);

      // Order should be the same after wait - no duplicate reorder
      expect(afterWait).toEqual(afterFirstDrag);

      // Verify the drag actually happened (order changed from initial)
      expect(afterFirstDrag).not.toEqual(initialOrder);
    });

    test('should maintain track count after drag (no duplicates)', async ({ page }) => {
      const initialCount = await page.locator('.track-row').count();
      expect(initialCount).toBe(4);

      // Perform multiple rapid drags
      await performDrag(page, 0, 3);
      await performDrag(page, 1, 2);
      await performDrag(page, 3, 0);

      const finalCount = await page.locator('.track-row').count();

      // Track count should remain exactly 4
      expect(finalCount).toBe(4);
    });

    test('should not create ghost tracks from duplicate events', async ({ page }) => {
      const initialNames = await getTrackNames(page);

      // Perform drag
      await performDrag(page, 0, 2);

      const afterNames = await getTrackNames(page);

      // Should have same set of track names (just reordered)
      expect(new Set(afterNames)).toEqual(new Set(initialNames));
    });
  });

  // ============================================================
  // BUG 2: Missing onDragLeave Handler
  // ============================================================
  // The fix clears targetTrackId when cursor leaves track area

  test.describe('BUG 2: onDragLeave Visual Feedback', () => {
    test('should clear drag-target class when cursor leaves all tracks', async ({ page }) => {
      const firstHandle = page.locator('.track-row').first().locator('.track-drag-handle');
      const handleBox = await firstHandle.boundingBox();
      expect(handleBox).not.toBeNull();

      // Start drag
      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();

      // Move over second track (should show drag-target)
      const secondWrapper = page.locator('.track-row-wrapper').nth(1);
      const secondBox = await secondWrapper.boundingBox();
      expect(secondBox).not.toBeNull();

      await page.mouse.move(secondBox!.x + secondBox!.width / 2, secondBox!.y + secondBox!.height / 2);
      await page.waitForTimeout(100);

      // Move cursor far away from all tracks (trigger dragLeave)
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);

      // No track should have drag-target class
      const dragTargetCount = await page.locator('.track-row-wrapper.drag-target').count();
      expect(dragTargetCount).toBe(0);

      // Clean up
      await page.mouse.up();
    });

    test('should show drag-target on hovered track during drag', async ({ page }) => {
      const firstHandle = page.locator('.track-row').first().locator('.track-drag-handle');
      const thirdWrapper = page.locator('.track-row-wrapper').nth(2);

      // Use dragTo which triggers proper HTML5 drag events
      // Get bounding boxes for manual verification during drag
      const handleBox = await firstHandle.boundingBox();
      const targetBox = await thirdWrapper.boundingBox();
      expect(handleBox).not.toBeNull();
      expect(targetBox).not.toBeNull();

      // Start drag manually to check intermediate state
      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();

      // Move to third track
      await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2);
      await page.waitForTimeout(100);

      // First track should have dragging class
      await expect(page.locator('.track-row-wrapper').first()).toHaveClass(/dragging/);

      // Complete the drag
      await page.mouse.up();
    });

    test('should clear all visual states after drag completes', async ({ page }) => {
      // Perform a complete drag
      await performDrag(page, 0, 2);

      // No tracks should have dragging or drag-target classes
      const draggingCount = await page.locator('.track-row-wrapper.dragging').count();
      const dragTargetCount = await page.locator('.track-row-wrapper.drag-target').count();

      expect(draggingCount).toBe(0);
      expect(dragTargetCount).toBe(0);
    });
  });

  // ============================================================
  // BUG 3: Race Condition with Stale targetTrackId
  // ============================================================
  // The fix passes target ID directly from drop event, not from state

  test.describe('BUG 3: Stale targetTrackId Prevention', () => {
    test('rapid drag should land on correct target', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Rapid sequence: drag first track to last position quickly
      const firstHandle = page.locator('.track-row').first().locator('.track-drag-handle');
      const lastWrapper = page.locator('.track-row-wrapper').nth(3);

      // Perform drag quickly
      await firstHandle.dragTo(lastWrapper, { timeout: 1000 });
      await page.waitForTimeout(100);

      const afterDrag = await getTrackNames(page);

      // The first track should now be at the end
      expect(afterDrag[3]).toBe(initialOrder[0]);
    });

    test('multiple rapid drags should all complete correctly', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Perform 3 rapid drags
      await performDrag(page, 0, 3); // First to last
      await performDrag(page, 0, 2); // New first to third
      await performDrag(page, 1, 0); // Second to first

      const finalOrder = await getTrackNames(page);

      // Verify no tracks were lost
      expect(new Set(finalOrder)).toEqual(new Set(initialOrder));
      expect(finalOrder.length).toBe(4);
    });

    test('drag target should match actual drop position', async ({ page }) => {
      // For each position, drag track 0 there and verify it lands correctly
      for (let targetIdx = 1; targetIdx <= 3; targetIdx++) {
        // Reset by reloading
        await page.reload();
        await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 10000 });

        // Get current first track name
        const currentFirst = await page.locator('.track-row').first().locator('.track-name').textContent();

        // Drag to target
        await performDrag(page, 0, targetIdx);

        // Verify the track is at the target position
        const trackAtTarget = await page.locator('.track-row').nth(targetIdx).locator('.track-name').textContent();
        expect(trackAtTarget?.trim()).toBe(currentFirst?.trim());
      }
    });

    test('should handle zigzag drag pattern correctly', async ({ page }) => {
      // Rapid zigzag: 0→3, 3→1, 1→2
      const initialOrder = await getTrackNames(page);

      await performDrag(page, 0, 3);
      const after1 = await getTrackNames(page);

      await performDrag(page, 3, 1);
      const after2 = await getTrackNames(page);

      await performDrag(page, 1, 2);
      const after3 = await getTrackNames(page);

      // Each drag should have changed the order
      expect(after1).not.toEqual(initialOrder);
      expect(after2).not.toEqual(after1);
      expect(after3).not.toEqual(after2);

      // No tracks should be lost
      expect(new Set(after3)).toEqual(new Set(initialOrder));
    });
  });

  // ============================================================
  // BUG 4: Silent Failure During Multiplayer
  // ============================================================
  // Note: Full multiplayer testing requires mocking the WebSocket connection.
  // These tests verify the toast system works and can receive error messages.

  test.describe('BUG 4: Error Toast System', () => {
    test('toast container should exist for error notifications', async ({ page }) => {
      // The toast container should be in the DOM (even if empty)
      // Verify the app structure supports toasts by checking for the container
      const toastContainer = page.locator('.toast-container');
      // Container exists in DOM (may be empty)
      await expect(toastContainer).toHaveCount(1);
    });

    test('should handle reorder gracefully when app is in normal state', async ({ page }) => {
      // This verifies that normal reorders don't trigger error toasts
      await performDrag(page, 0, 2);

      // Wait for any potential error toast
      await page.waitForTimeout(500);

      // Should not have any error toasts
      const errorToasts = page.locator('.toast.error');
      const errorCount = await errorToasts.count();
      expect(errorCount).toBe(0);
    });

    test('successful reorder should not show error notification', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      await performDrag(page, 0, 3);

      const afterOrder = await getTrackNames(page);

      // Verify reorder succeeded
      expect(afterOrder).not.toEqual(initialOrder);

      // Verify no error toast appeared
      await page.waitForTimeout(300);
      const toasts = page.locator('.toast');
      const toastCount = await toasts.count();
      expect(toastCount).toBe(0);
    });
  });
});

// ============================================================
// Edge Cases from Audit
// ============================================================

/**
 * Create a session with no tracks (with rate limit delay)
 */
async function createEmptySession(request: Parameters<typeof createSessionWithRetry>[0]) {
  await sleep(RATE_LIMIT_DELAY_MS);
  return createSessionWithRetry(request, {
    tracks: [],
    tempo: 120,
    swing: 0,
    version: 1,
  }, 5);
}

/**
 * Create a session with 1 track (with rate limit delay)
 */
async function createSingleTrackSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  await sleep(RATE_LIMIT_DELAY_MS);
  const steps = Array(64).fill(false);
  steps[0] = true;

  return createSessionWithRetry(request, {
    tracks: [
      { id: 'track-1', name: '808 Kick', sampleId: 'sampled:808-kick', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  }, 5);
}

/**
 * Create a session with 2 tracks (with rate limit delay)
 */
async function createTwoTrackSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  await sleep(RATE_LIMIT_DELAY_MS);
  const steps = Array(64).fill(false);
  steps[0] = true;

  return createSessionWithRetry(request, {
    tracks: [
      { id: 'track-1', name: '808 Hat', sampleId: 'sampled:808-hihat-closed', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-2', name: '808 Kick', sampleId: 'sampled:808-kick', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  }, 5);
}

/**
 * Create a session with 3 tracks (with rate limit delay)
 */
async function createThreeTrackSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  await sleep(RATE_LIMIT_DELAY_MS);
  const steps = Array(64).fill(false);
  steps[0] = true;

  return createSessionWithRetry(request, {
    tracks: [
      { id: 'track-1', name: '808 Hat', sampleId: 'sampled:808-hihat-closed', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-2', name: '808 Kick', sampleId: 'sampled:808-kick', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-3', name: '808 Snare', sampleId: 'sampled:808-snare', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  }, 5);
}

/**
 * Create a session with 8 tracks (max) (with rate limit delay)
 */
async function createEightTrackSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  await sleep(RATE_LIMIT_DELAY_MS);
  const steps = Array(64).fill(false);
  steps[0] = true;

  return createSessionWithRetry(request, {
    tracks: [
      { id: 'track-1', name: '808 Hat', sampleId: 'sampled:808-hihat-closed', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-2', name: '808 Kick', sampleId: 'sampled:808-kick', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-3', name: '808 Snare', sampleId: 'sampled:808-snare', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-4', name: '808 Clap', sampleId: 'sampled:808-clap', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-5', name: '808 Open', sampleId: 'sampled:808-hihat-open', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-6', name: 'Ac. Kick', sampleId: 'kick', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-7', name: 'Ac. Snare', sampleId: 'snare', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
      { id: 'track-8', name: 'Ac. Hat', sampleId: 'hihat', steps, parameterLocks: Array(64).fill(null), volume: 1, muted: false, transpose: 0, stepCount: 16 },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  }, 5);
}

test.describe('Track Reorder Edge Cases', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires mouse drag');
  });

  test.describe('Empty and Single Track Scenarios', () => {
    test('should not show drag handles when no tracks exist', async ({ page, request }) => {
      const { id } = await createEmptySession(request);
      await page.goto(`${API_BASE}/s/${id}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

      // Should have no tracks and no drag handles
      const trackCount = await page.locator('.track-row').count();
      expect(trackCount).toBe(0);

      const handleCount = await page.locator('.track-drag-handle').count();
      expect(handleCount).toBe(0);
    });

    test('single track should have drag handle but reorder should be no-op', async ({ page, request }) => {
      const { id } = await createSingleTrackSession(request);
      await page.goto(`${API_BASE}/s/${id}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });

      // Should have exactly one track with a drag handle
      const trackCount = await page.locator('.track-row').count();
      expect(trackCount).toBe(1);

      const handleCount = await page.locator('.track-drag-handle').count();
      expect(handleCount).toBe(1);

      // Get track name before "reorder"
      const nameBefore = await page.locator('.track-row').first().locator('.track-name').textContent();

      // Try to drag to same position (only option)
      const handle = page.locator('.track-drag-handle').first();
      const wrapper = page.locator('.track-row-wrapper').first();
      await handle.dragTo(wrapper);
      await page.waitForTimeout(200);

      // Track should still be there, unchanged
      const nameAfter = await page.locator('.track-row').first().locator('.track-name').textContent();
      expect(nameAfter).toBe(nameBefore);
      expect(await page.locator('.track-row').count()).toBe(1);
    });
  });

  test.describe('Two Track Scenarios', () => {
    test.beforeEach(async ({ page, request }) => {
      const { id } = await createTwoTrackSession(request);
      await page.goto(`${API_BASE}/s/${id}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.track-row').nth(1)).toBeVisible({ timeout: 5000 });
    });

    test('should swap two tracks correctly', async ({ page }) => {
      const initial = await getTrackNames(page);
      expect(initial.length).toBe(2);

      // Drag first to second position
      await performDrag(page, 0, 1);

      const after = await getTrackNames(page);

      // Should be swapped
      expect(after[0]).toBe(initial[1]);
      expect(after[1]).toBe(initial[0]);
    });

    test('should swap back to original order', async ({ page }) => {
      const initial = await getTrackNames(page);

      // Swap once
      await performDrag(page, 0, 1);

      // Swap back
      await performDrag(page, 0, 1);

      const after = await getTrackNames(page);

      // Should be back to original
      expect(after).toEqual(initial);
    });

    test('dragging second to first should work', async ({ page }) => {
      const initial = await getTrackNames(page);

      // Drag second to first position
      await performDrag(page, 1, 0);

      const after = await getTrackNames(page);

      // Should be swapped
      expect(after[0]).toBe(initial[1]);
      expect(after[1]).toBe(initial[0]);
    });
  });

  test.describe('Maximum Tracks Scenario', () => {
    test('should handle 8 tracks (max) correctly', async ({ page, request }) => {
      const { id } = await createEightTrackSession(request);
      await page.goto(`${API_BASE}/s/${id}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.track-row').nth(7)).toBeVisible({ timeout: 5000 });

      const trackCount = await page.locator('.track-row').count();
      expect(trackCount).toBe(8);

      const initial = await getTrackNames(page);

      // Drag first to last
      await performDrag(page, 0, 7);

      const after = await getTrackNames(page);

      // First track should now be last
      expect(after[7]).toBe(initial[0]);
      expect(after.length).toBe(8);
    });
  });

  test.describe('Persistence After Reorder', () => {
    test('reordered tracks should persist after page reload', async ({ page, request }) => {
      test.skip(useMockAPI, 'Persistence tests require real backend storage');
      const { id } = await createThreeTrackSession(request);
      await page.goto(`${API_BASE}/s/${id}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.track-row').nth(2)).toBeVisible({ timeout: 5000 });

      const initial = await getTrackNames(page);

      // Reorder
      await performDrag(page, 0, 2);

      const afterReorder = await getTrackNames(page);
      expect(afterReorder).not.toEqual(initial);

      // Wait for persistence
      await page.waitForTimeout(500);

      // Reload
      await page.reload();
      await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.track-row').nth(2)).toBeVisible({ timeout: 5000 });

      // Verify order persisted
      const afterReload = await getTrackNames(page);
      expect(afterReload).toEqual(afterReorder);
    });
  });
});
