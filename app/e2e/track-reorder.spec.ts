import { test, expect } from '@playwright/test';

/**
 * Track Reorder Tests (Phase 31G)
 *
 * Tests for the drag-and-drop track reordering feature.
 * Features tested:
 * - Drag handle visibility and accessibility
 * - Dragging tracks to new positions
 * - Visual feedback during drag
 * - Drag cancellation behavior
 * - Edge cases (drag to same position, first/last track)
 */

test.describe('Track Reorder', () => {
  test.beforeEach(async ({ page }) => {
    // Go to home page and start a new session
    await page.goto('/');

    // Click "Start Session" to enter the app (homepage -> sequencer)
    const startButton = page.locator('button:has-text("Start Session")');
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }

    // Wait for the grid to load
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Ensure we have at least 3 tracks for reorder testing
    const trackRows = page.locator('.track-row');
    let trackCount = await trackRows.count();

    while (trackCount < 3) {
      // Click the floating add button to open the instrument picker
      const addButton = page.locator('[data-testid="add-track-button"]');
      await addButton.click();

      // Wait for instrument picker to be visible and click an instrument
      const instrumentBtn = page.locator('.instrument-btn').first();
      await expect(instrumentBtn).toBeVisible({ timeout: 2000 });
      await instrumentBtn.click();

      // Wait for track to be added
      await page.waitForTimeout(200);
      trackCount = await trackRows.count();
    }

    // Wait for tracks to be rendered
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.track-row').nth(2)).toBeVisible({ timeout: 5000 });
  });

  test('should display drag handle on each track', async ({ page }) => {
    const trackRows = page.locator('.track-row');
    const trackCount = await trackRows.count();

    for (let i = 0; i < trackCount; i++) {
      const dragHandle = trackRows.nth(i).locator('.track-drag-handle');
      await expect(dragHandle).toBeVisible();
      // Verify it has the grab cursor
      await expect(dragHandle).toHaveAttribute('title', 'Drag to reorder');
    }
  });

  test('should have accessible drag handles', async ({ page }) => {
    const dragHandle = page.locator('.track-drag-handle').first();
    await expect(dragHandle).toHaveAttribute('aria-label', 'Drag to reorder track');
  });

  test('should reorder tracks when dragged to new position', async ({ page }) => {
    // Get initial track order by reading track names
    const getTrackNames = async () => {
      const trackRows = page.locator('.track-row');
      const count = await trackRows.count();
      const names: string[] = [];
      for (let i = 0; i < count; i++) {
        const nameElement = trackRows.nth(i).locator('.track-name, .track-label');
        const name = await nameElement.textContent();
        names.push(name || `Track ${i}`);
      }
      return names;
    };

    const initialOrder = await getTrackNames();
    expect(initialOrder.length).toBeGreaterThanOrEqual(3);

    // Get the drag handles
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');
    const thirdTrackWrapper = page.locator('.track-row-wrapper').nth(2);

    // Drag first track to third position
    await firstTrackHandle.dragTo(thirdTrackWrapper);

    // Wait for reorder to complete
    await page.waitForTimeout(200);

    // Verify the order changed
    const newOrder = await getTrackNames();

    // First track should now be at a different position
    // The exact position depends on the drop behavior, but order should be different
    expect(newOrder).not.toEqual(initialOrder);
  });

  test('should show visual feedback when dragging', async ({ page }) => {
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');
    const firstTrackWrapper = page.locator('.track-row-wrapper').first();

    // Start drag
    const box = await firstTrackHandle.boundingBox();
    if (!box) throw new Error('Could not get drag handle bounding box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Move slightly to trigger drag
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 50);
    await page.waitForTimeout(100);

    // The dragged track should have the 'dragging' class
    await expect(firstTrackWrapper).toHaveClass(/dragging/);

    // Clean up - finish the drag
    await page.mouse.up();
  });

  test('should show drag target visual when hovering over another track', async ({ page }) => {
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');
    const secondTrackWrapper = page.locator('.track-row-wrapper').nth(1);

    // Start drag from first track
    const box = await firstTrackHandle.boundingBox();
    if (!box) throw new Error('Could not get drag handle bounding box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Move to second track
    const targetBox = await secondTrackWrapper.boundingBox();
    if (!targetBox) throw new Error('Could not get target bounding box');

    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    await page.waitForTimeout(100);

    // The target track should have the 'drag-target' class
    await expect(secondTrackWrapper).toHaveClass(/drag-target/);

    // Clean up
    await page.mouse.up();
  });

  test('should not reorder when drag is canceled', async ({ page }) => {
    const getTrackNames = async () => {
      const trackRows = page.locator('.track-row');
      const count = await trackRows.count();
      const names: string[] = [];
      for (let i = 0; i < count; i++) {
        const nameElement = trackRows.nth(i).locator('.track-name, .track-label');
        const name = await nameElement.textContent();
        names.push(name || `Track ${i}`);
      }
      return names;
    };

    const initialOrder = await getTrackNames();

    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');
    const box = await firstTrackHandle.boundingBox();
    if (!box) throw new Error('Could not get drag handle bounding box');

    // Start drag
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Move over second track
    const secondTrackWrapper = page.locator('.track-row-wrapper').nth(1);
    const targetBox = await secondTrackWrapper.boundingBox();
    if (!targetBox) throw new Error('Could not get target bounding box');

    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    await page.waitForTimeout(100);

    // Move away from all tracks (cancel area)
    await page.mouse.move(0, 0);
    await page.waitForTimeout(50);

    // Release mouse (cancel drag)
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Order should remain unchanged
    const finalOrder = await getTrackNames();
    expect(finalOrder).toEqual(initialOrder);
  });

  test('should not trigger drag from non-handle areas', async ({ page }) => {
    const getTrackNames = async () => {
      const trackRows = page.locator('.track-row');
      const count = await trackRows.count();
      const names: string[] = [];
      for (let i = 0; i < count; i++) {
        const nameElement = trackRows.nth(i).locator('.track-name, .track-label');
        const name = await nameElement.textContent();
        names.push(name || `Track ${i}`);
      }
      return names;
    };

    const initialOrder = await getTrackNames();

    // Try to drag from the track name (not the handle)
    const trackName = page.locator('.track-row').first().locator('.track-name, .track-label');
    const thirdTrackWrapper = page.locator('.track-row-wrapper').nth(2);

    try {
      await trackName.dragTo(thirdTrackWrapper, { timeout: 1000 });
    } catch {
      // Drag may fail which is expected
    }

    await page.waitForTimeout(200);

    // Order should remain unchanged
    const finalOrder = await getTrackNames();
    expect(finalOrder).toEqual(initialOrder);
  });

  test('should handle dragging to same position gracefully', async ({ page }) => {
    const getTrackNames = async () => {
      const trackRows = page.locator('.track-row');
      const count = await trackRows.count();
      const names: string[] = [];
      for (let i = 0; i < count; i++) {
        const nameElement = trackRows.nth(i).locator('.track-name, .track-label');
        const name = await nameElement.textContent();
        names.push(name || `Track ${i}`);
      }
      return names;
    };

    const initialOrder = await getTrackNames();

    // Drag first track back to first position
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');
    const firstTrackWrapper = page.locator('.track-row-wrapper').first();

    await firstTrackHandle.dragTo(firstTrackWrapper);
    await page.waitForTimeout(200);

    // Order should remain unchanged
    const finalOrder = await getTrackNames();
    expect(finalOrder).toEqual(initialOrder);
  });

  test('should persist track order after reorder', async ({ page }) => {
    // Get initial order
    const getFirstTrackName = async () => {
      const nameElement = page.locator('.track-row').first().locator('.track-name, .track-label');
      return await nameElement.textContent();
    };

    const initialFirstTrack = await getFirstTrackName();

    // Drag second track to first position
    const secondTrackHandle = page.locator('.track-row').nth(1).locator('.track-drag-handle');
    const firstTrackWrapper = page.locator('.track-row-wrapper').first();

    await secondTrackHandle.dragTo(firstTrackWrapper);
    await page.waitForTimeout(200);

    const newFirstTrack = await getFirstTrackName();

    // First track should be different
    expect(newFirstTrack).not.toEqual(initialFirstTrack);

    // Add a small delay to allow state to persist
    await page.waitForTimeout(500);

    // Reload the page to verify persistence
    await page.reload();
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Verify the order persisted
    const reloadedFirstTrack = await getFirstTrackName();
    expect(reloadedFirstTrack).toEqual(newFirstTrack);
  });
});
