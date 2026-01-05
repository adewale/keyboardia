import { test, expect } from '@playwright/test';

/**
 * Track Reorder - Single Track Visual Feedback Tests
 *
 * These tests verify that only ONE track shows dragging visual feedback
 * (opacity, scale, .dragging class) during a drag operation.
 *
 * Regression test for reported issue where all tracks appeared to be
 * moving during drag. Tests verify:
 * - Only dragged track has .dragging CSS class
 * - Non-dragged tracks maintain full opacity
 * - Non-dragged tracks have no transform applied
 * - Drag states are properly cleared after drag ends
 *
 * Implementation verified at:
 * - StepSequencer.tsx:586 - isDragging = dragState.draggingTrackId === track.id
 * - TrackRow.tsx:537 - .dragging class applied only when isDragging is true
 */

test.describe('Track Reorder - Single Track Visual Feedback', () => {
  test.beforeEach(async ({ page }) => {
    // Go to home page and start a new session
    await page.goto('/');

    // Click "Start Session" to enter the app (if on homepage)
    const startButton = page.locator('button:has-text("Start Session")');
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }

    // Wait for the instrument picker to be visible (session loads empty)
    await expect(page.getByRole('button', { name: /808 Kick/ })).toBeVisible({ timeout: 10000 });

    // Add 3 tracks by clicking instrument buttons directly
    // Wait for each track to be created before adding the next
    await page.getByRole('button', { name: /808 Hat/ }).first().click();
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(100);

    await page.getByRole('button', { name: /808 Kick/ }).first().click();
    await expect(page.locator('.track-row').nth(1)).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(100);

    await page.getByRole('button', { name: /808 Snare/ }).first().click();
    await expect(page.locator('.track-row').nth(2)).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(100);
  });

  test('only ONE track should have dragging class during drag', async ({ page }) => {
    // Get all track wrappers
    const trackWrappers = page.locator('.track-row-wrapper');
    const trackCount = await trackWrappers.count();
    expect(trackCount).toBeGreaterThanOrEqual(3);

    // Get the first track's drag handle
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');
    const firstTrackWrapper = page.locator('.track-row-wrapper').first();

    // Get bounding box for drag handle
    const handleBox = await firstTrackHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Start drag on the first track's drag handle
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();

    // Move to trigger drag (move down by 100px to drag over other tracks)
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2 + 100
    );

    // Wait for drag state to update
    await page.waitForTimeout(150);

    // ============================================================
    // ASSERTION: Count how many tracks have the 'dragging' class
    // ============================================================
    // Exactly 1 track should have the 'dragging' class
    const draggingTracks = page.locator('.track-row-wrapper.dragging');
    const draggingCount = await draggingTracks.count();

    // First track should definitely be dragging
    await expect(firstTrackWrapper).toHaveClass(/dragging/);

    // Critical assertion: exactly 1 track should have dragging class
    expect(draggingCount).toBe(1);

    // Also verify that OTHER tracks do NOT have the dragging class
    for (let i = 1; i < trackCount; i++) {
      const otherTrackWrapper = trackWrappers.nth(i);
      const classes = await otherTrackWrapper.getAttribute('class');
      expect(classes).not.toContain('dragging');
    }

    // Clean up - release mouse
    await page.mouse.up();
  });

  test('non-dragged tracks should maintain normal opacity during drag', async ({ page }) => {
    // Get the first track's drag handle
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');

    // Get bounding box
    const handleBox = await firstTrackHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Start drag
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();

    // Move to trigger drag
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2 + 100
    );
    await page.waitForTimeout(150);

    // ============================================================
    // ASSERTION: Non-dragged tracks should have opacity: 1
    // ============================================================
    // CSS .track-row-wrapper.dragging sets opacity: 0.5
    // Non-dragged tracks should maintain full opacity

    const secondTrackWrapper = page.locator('.track-row-wrapper').nth(1);
    const thirdTrackWrapper = page.locator('.track-row-wrapper').nth(2);

    // Get computed opacity of non-dragged tracks
    const secondOpacity = await secondTrackWrapper.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    const thirdOpacity = await thirdTrackWrapper.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });

    // Non-dragged tracks should have full opacity (1)
    expect(parseFloat(secondOpacity)).toBe(1);
    expect(parseFloat(thirdOpacity)).toBe(1);

    // Clean up
    await page.mouse.up();
  });

  test('non-dragged tracks should not have transform scale during drag', async ({ page }) => {
    // Get the first track's drag handle
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');

    // Get bounding box
    const handleBox = await firstTrackHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Start drag
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();

    // Move to trigger drag
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2 + 100
    );
    await page.waitForTimeout(150);

    // ============================================================
    // ASSERTION: Non-dragged tracks should NOT have transform
    // ============================================================
    // CSS .track-row-wrapper.dragging sets transform: scale(0.98)

    const secondTrackWrapper = page.locator('.track-row-wrapper').nth(1);
    const thirdTrackWrapper = page.locator('.track-row-wrapper').nth(2);

    // Get computed transform of non-dragged tracks
    const secondTransform = await secondTrackWrapper.evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });
    const thirdTransform = await thirdTrackWrapper.evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });

    // Non-dragged tracks should have no transform (none) or identity matrix
    const isIdentityOrNone = (transform: string) => {
      return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
    };

    expect(isIdentityOrNone(secondTransform)).toBe(true);
    expect(isIdentityOrNone(thirdTransform)).toBe(true);

    // Clean up
    await page.mouse.up();
  });

  test('should clear all dragging states after drag ends', async ({ page }) => {
    // Get the first track's drag handle
    const firstTrackHandle = page.locator('.track-row').first().locator('.track-drag-handle');
    const thirdTrackWrapper = page.locator('.track-row-wrapper').nth(2);

    // Perform a complete drag operation
    await firstTrackHandle.dragTo(thirdTrackWrapper);

    // Wait for drag to complete
    await page.waitForTimeout(200);

    // After drag ends, NO tracks should have the dragging class
    const draggingTracks = page.locator('.track-row-wrapper.dragging');
    const draggingCount = await draggingTracks.count();

    expect(draggingCount).toBe(0);
  });
});
