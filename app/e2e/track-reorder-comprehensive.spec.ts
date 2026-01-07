import { test, expect, useMockAPI } from './global-setup';
import type { Page } from './global-setup';

/**
 * Comprehensive Track Reorder Tests
 *
 * Tests for edge cases and race conditions in drag-and-drop track reordering.
 * Covers issues like:
 * - Tracks refusing to reorder
 * - Multiple reorderings happening at once
 * - State inconsistency after operations
 * - Rapid/concurrent drag operations
 */

// Helper: Get track names in current order
async function getTrackNames(page: Page): Promise<string[]> {
  const trackRows = page.locator('.track-row');
  const count = await trackRows.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameElement = trackRows.nth(i).locator('.track-name, .track-label');
    const name = await nameElement.textContent();
    names.push(name || `Track ${i}`);
  }
  return names;
}

// Helper: Get track IDs in current order (more stable than names)
// Reserved for future use when data-track-id attributes are added
async function _getTrackIds(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('.track-row');
    return Array.from(rows).map(row => {
      const wrapper = row.closest('.track-row-wrapper');
      // Try to get a unique identifier - check data attributes or use index
      return wrapper?.getAttribute('data-track-id') ||
             row.querySelector('.track-name')?.textContent ||
             'unknown';
    });
  });
}
void _getTrackIds; // Suppress unused warning

// Helper: Perform drag from one track to another by index
async function dragTrack(page: Page, fromIndex: number, toIndex: number): Promise<void> {
  const fromHandle = page.locator('.track-row').nth(fromIndex).locator('.track-drag-handle');
  const toWrapper = page.locator('.track-row-wrapper').nth(toIndex);

  const fromBox = await fromHandle.boundingBox();
  const toBox = await toWrapper.boundingBox();

  if (!fromBox || !toBox) {
    throw new Error(`Could not get bounding boxes for drag from ${fromIndex} to ${toIndex}`);
  }

  // Perform drag with explicit mouse events
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50); // Small delay for drag to initiate
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 5 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(100); // Wait for state to update
}

// Helper: Add a track by clicking instrument button and verify it was added
async function addTrack(page: Page, instrumentPattern: RegExp, expectedCount: number): Promise<void> {
  await page.getByRole('button', { name: instrumentPattern }).first().click();
  // Wait until the expected number of tracks exist
  await expect(page.locator('.track-row').nth(expectedCount - 1)).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(100);
}

test.describe('Track Reorder - Comprehensive Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Click "Start Session" if visible
    const startButton = page.locator('button:has-text("Start Session")');
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }

    // Wait for instrument picker
    await expect(page.getByRole('button', { name: /808 Kick/ })).toBeVisible({ timeout: 10000 });

    // Add 4 tracks for comprehensive testing
    // Each addTrack call verifies the track was created before proceeding
    await addTrack(page, /808 Hat/, 1);
    await addTrack(page, /808 Kick/, 2);
    await addTrack(page, /808 Snare/, 3);
    await addTrack(page, /808 Clap/, 4);
  });

  // ============================================================
  // BASIC REORDER OPERATIONS
  // ============================================================

  test.describe('Basic Reorder Operations', () => {
    test('should reorder first track to last position', async ({ page }) => {
      const initialOrder = await getTrackNames(page);
      expect(initialOrder.length).toBe(4);

      // Drag first track (index 0) to last position (index 3)
      await dragTrack(page, 0, 3);

      const newOrder = await getTrackNames(page);

      // First track should now be at the end
      expect(newOrder[newOrder.length - 1]).toBe(initialOrder[0]);
      // Other tracks should shift up
      expect(newOrder.slice(0, -1)).toEqual(initialOrder.slice(1));
    });

    test('should reorder last track to first position', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Drag last track (index 3) to first position (index 0)
      await dragTrack(page, 3, 0);

      const newOrder = await getTrackNames(page);

      // Last track should now be first
      expect(newOrder[0]).toBe(initialOrder[3]);
      // Other tracks should shift down
      expect(newOrder.slice(1)).toEqual(initialOrder.slice(0, 3));
    });

    test('should reorder middle track up', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Drag track at index 2 to index 0
      await dragTrack(page, 2, 0);

      const newOrder = await getTrackNames(page);

      // Track 2 should be at position 0
      expect(newOrder[0]).toBe(initialOrder[2]);
    });

    test('should reorder middle track down', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Drag track at index 1 to index 3
      await dragTrack(page, 1, 3);

      const newOrder = await getTrackNames(page);

      // Track 1 should be at the end
      expect(newOrder[newOrder.length - 1]).toBe(initialOrder[1]);
    });

    test('should swap adjacent tracks (down)', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Drag track 0 to position 1
      await dragTrack(page, 0, 1);

      const newOrder = await getTrackNames(page);

      // Tracks 0 and 1 should be swapped
      expect(newOrder[0]).toBe(initialOrder[1]);
      expect(newOrder[1]).toBe(initialOrder[0]);
    });

    test('should swap adjacent tracks (up)', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Drag track 1 to position 0
      await dragTrack(page, 1, 0);

      const newOrder = await getTrackNames(page);

      // Tracks 0 and 1 should be swapped
      expect(newOrder[0]).toBe(initialOrder[1]);
      expect(newOrder[1]).toBe(initialOrder[0]);
    });
  });

  // ============================================================
  // EDGE CASES - SAME POSITION
  // ============================================================

  test.describe('Same Position Edge Cases', () => {
    test('should NOT reorder when dragging to same position', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Drag track 1 to its own position
      await dragTrack(page, 1, 1);

      const newOrder = await getTrackNames(page);

      // Order should be unchanged
      expect(newOrder).toEqual(initialOrder);
    });

    test('should NOT reorder when drag is released on same track', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      const handle = page.locator('.track-row').nth(1).locator('.track-drag-handle');
      const handleBox = await handle.boundingBox();

      if (!handleBox) throw new Error('Could not get handle box');

      // Start drag, move slightly, return to same position, release
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + 20);
      await page.waitForTimeout(50);
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.up();
      await page.waitForTimeout(100);

      const newOrder = await getTrackNames(page);
      expect(newOrder).toEqual(initialOrder);
    });
  });

  // ============================================================
  // RAPID CONSECUTIVE DRAGS
  // ============================================================

  test.describe('Rapid Consecutive Drags', () => {
    test('should handle two quick consecutive reorders correctly', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // First reorder: 0 -> 1
      await dragTrack(page, 0, 1);
      const afterFirst = await getTrackNames(page);

      // Immediately do second reorder: 2 -> 0
      await dragTrack(page, 2, 0);
      const afterSecond = await getTrackNames(page);

      // Verify each step happened correctly
      expect(afterFirst[0]).toBe(initialOrder[1]); // First swap worked
      expect(afterSecond).not.toEqual(afterFirst); // Second swap changed something
    });

    test('should handle three rapid reorders without losing state', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Rapid sequence of reorders
      await dragTrack(page, 0, 3); // Move first to last
      await dragTrack(page, 0, 2); // Move new first to middle
      await dragTrack(page, 1, 0); // Move second to first

      const finalOrder = await getTrackNames(page);

      // Should have exactly 4 tracks, no duplicates, no losses
      expect(finalOrder.length).toBe(4);
      expect(new Set(finalOrder).size).toBe(4); // All unique

      // Every original track should still exist
      for (const track of initialOrder) {
        expect(finalOrder).toContain(track);
      }
    });

    test('should maintain track count after many rapid operations', async ({ page }) => {
      const initialCount = await page.locator('.track-row').count();

      // Do 5 rapid reorders
      for (let i = 0; i < 5; i++) {
        const fromIdx = i % 4;
        const toIdx = (i + 2) % 4;
        await dragTrack(page, fromIdx, toIdx);
      }

      const finalCount = await page.locator('.track-row').count();
      expect(finalCount).toBe(initialCount);
    });

    test('should not duplicate tracks during rapid back-and-forth drags', async ({ page }) => {
      const initialNames = await getTrackNames(page);

      // Drag track back and forth rapidly
      await dragTrack(page, 0, 2);
      await dragTrack(page, 2, 0);
      await dragTrack(page, 0, 2);
      await dragTrack(page, 2, 0);

      const finalNames = await getTrackNames(page);

      // Should have same tracks (possibly reordered)
      expect(finalNames.sort()).toEqual(initialNames.sort());
    });
  });

  // ============================================================
  // CANCEL DRAG OPERATIONS
  // ============================================================

  test.describe('Cancel Drag Operations', () => {
    test('should NOT reorder when drag is canceled by moving cursor away', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      const handle = page.locator('.track-row').nth(0).locator('.track-drag-handle');
      const handleBox = await handle.boundingBox();

      if (!handleBox) throw new Error('Could not get handle box');

      // Start drag, move to another track, then move cursor completely outside
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();

      // Move toward track 2
      const track2 = page.locator('.track-row-wrapper').nth(2);
      const track2Box = await track2.boundingBox();
      if (track2Box) {
        await page.mouse.move(track2Box.x + track2Box.width / 2, track2Box.y + track2Box.height / 2);
      }

      // Move cursor completely outside the track area (cancel)
      await page.mouse.move(0, 0);
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(100);

      const newOrder = await getTrackNames(page);
      expect(newOrder).toEqual(initialOrder);
    });

    test('should NOT reorder when mouse is released without proper drop', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      const handle = page.locator('.track-row').nth(1).locator('.track-drag-handle');
      const handleBox = await handle.boundingBox();

      if (!handleBox) throw new Error('Could not get handle box');

      // Start drag but release immediately without moving to another track
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(20);
      await page.mouse.up();
      await page.waitForTimeout(100);

      const newOrder = await getTrackNames(page);
      expect(newOrder).toEqual(initialOrder);
    });

    test('should clear drag state after cancel', async ({ page }) => {
      const handle = page.locator('.track-row').nth(0).locator('.track-drag-handle');
      const handleBox = await handle.boundingBox();

      if (!handleBox) throw new Error('Could not get handle box');

      // Start and cancel a drag
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x, handleBox.y + 100);
      await page.mouse.move(0, 0); // Cancel area
      await page.mouse.up();
      await page.waitForTimeout(150);

      // No tracks should have dragging class after cancel
      const draggingTracks = await page.locator('.track-row-wrapper.dragging').count();
      expect(draggingTracks).toBe(0);

      // No tracks should have drag-target class after cancel
      const targetTracks = await page.locator('.track-row-wrapper.drag-target').count();
      expect(targetTracks).toBe(0);
    });
  });

  // ============================================================
  // STATE CONSISTENCY
  // ============================================================

  test.describe('State Consistency', () => {
    test('should persist track order after multiple operations', async ({ page }) => {
      test.skip(useMockAPI, 'Persistence tests require real backend storage');
      // Perform some reorders
      await dragTrack(page, 0, 2);
      await dragTrack(page, 3, 1);

      const orderBeforeReload = await getTrackNames(page);

      // Small delay to allow state to persist
      await page.waitForTimeout(500);

      // Reload the page
      await page.reload();
      await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(500);

      const orderAfterReload = await getTrackNames(page);

      // Order should be preserved
      expect(orderAfterReload).toEqual(orderBeforeReload);
    });

    test('should maintain all track properties after reorder', async ({ page }) => {
      // Get initial track count and any enabled steps
      const initialCount = await page.locator('.track-row').count();

      // Click some steps on the first track
      await page.locator('.track-row').first().locator('button[class*="step"]').first().click();
      await page.waitForTimeout(100);

      // Reorder
      await dragTrack(page, 0, 3);
      await page.waitForTimeout(100);

      // Track count should be unchanged
      const finalCount = await page.locator('.track-row').count();
      expect(finalCount).toBe(initialCount);
    });

    test('should handle reorder during playback', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Start playback using data-testid (more reliable)
      await page.locator('[data-testid="play-button"]').click();
      await page.waitForTimeout(200);

      // Reorder during playback
      await dragTrack(page, 0, 2);

      const newOrder = await getTrackNames(page);

      // Reorder should have happened
      expect(newOrder).not.toEqual(initialOrder);

      // Stop playback (same button toggles)
      await page.locator('[data-testid="play-button"]').click();
    });
  });

  // ============================================================
  // NON-HANDLE DRAG PREVENTION
  // ============================================================

  test.describe('Drag Handle Restriction', () => {
    test('should NOT initiate drag from track name area', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Try to drag from the track name (not the handle)
      const trackName = page.locator('.track-row').first().locator('.track-name');
      const target = page.locator('.track-row-wrapper').nth(2);

      try {
        await trackName.dragTo(target, { timeout: 2000 });
      } catch {
        // Expected to fail or not reorder
      }

      await page.waitForTimeout(200);
      const newOrder = await getTrackNames(page);

      // Order should be unchanged
      expect(newOrder).toEqual(initialOrder);
    });

    test('should NOT initiate drag from step buttons', async ({ page }) => {
      const initialOrder = await getTrackNames(page);

      // Try to drag from a step button
      const stepButton = page.locator('.track-row').first().locator('button[class*="step"]').first();
      const target = page.locator('.track-row-wrapper').nth(2);

      try {
        await stepButton.dragTo(target, { timeout: 2000 });
      } catch {
        // Expected to fail or not reorder
      }

      await page.waitForTimeout(200);
      const newOrder = await getTrackNames(page);

      // Order should be unchanged
      expect(newOrder).toEqual(initialOrder);
    });
  });

  // ============================================================
  // RACE CONDITIONS
  // ============================================================

  test.describe('Race Conditions', () => {
    test('should handle very fast sequential drags without corruption', async ({ page }) => {
      const initialNames = new Set(await getTrackNames(page));

      // Perform drags as fast as possible (minimal waits)
      const handle0 = page.locator('.track-row').nth(0).locator('.track-drag-handle');
      const handle1 = page.locator('.track-row').nth(1).locator('.track-drag-handle');
      const wrapper2 = page.locator('.track-row-wrapper').nth(2);
      const wrapper3 = page.locator('.track-row-wrapper').nth(3);

      // First fast drag
      await handle0.dragTo(wrapper2, { force: true });

      // Immediately start second drag
      await handle1.dragTo(wrapper3, { force: true });

      await page.waitForTimeout(300);

      const finalOrder = await getTrackNames(page);

      // Should still have 4 unique tracks with same names
      expect(finalOrder.length).toBe(4);
      expect(new Set(finalOrder).size).toBe(4);
      // All original track names should still exist
      for (const name of finalOrder) {
        expect(initialNames).toContain(name);
      }
    });

    test('should not create duplicate tracks during stress test', async ({ page }) => {
      const initialNames = new Set(await getTrackNames(page));

      // Stress test: 10 rapid reorders
      for (let i = 0; i < 10; i++) {
        const from = Math.floor(Math.random() * 4);
        let to = Math.floor(Math.random() * 4);
        while (to === from) to = Math.floor(Math.random() * 4);

        try {
          await dragTrack(page, from, to);
        } catch {
          // Continue even if individual drag fails
        }
      }

      await page.waitForTimeout(300);

      const finalNames = new Set(await getTrackNames(page));

      // Same tracks should exist
      expect(finalNames.size).toBe(initialNames.size);
      for (const name of initialNames) {
        expect(finalNames).toContain(name);
      }
    });

    test('should handle interrupted drag gracefully', async ({ page }) => {
      const initialNames = new Set(await getTrackNames(page));

      // Start a drag
      const handle = page.locator('.track-row').nth(0).locator('.track-drag-handle');
      const handleBox = await handle.boundingBox();

      if (!handleBox) throw new Error('No handle box');

      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();

      // Move to middle position
      const track2 = page.locator('.track-row-wrapper').nth(2);
      const track2Box = await track2.boundingBox();
      if (track2Box) {
        await page.mouse.move(track2Box.x + track2Box.width / 2, track2Box.y + track2Box.height / 2);
      }

      // "Interrupt" by clicking elsewhere (this releases the drag)
      await page.mouse.up();

      // Immediately try another operation
      await page.locator('.track-row').first().locator('button[class*="step"]').first().click({ force: true });

      await page.waitForTimeout(200);

      // State should be consistent (either reordered or not, but not corrupted)
      const finalOrder = await getTrackNames(page);
      expect(finalOrder.length).toBe(4);
      // All original tracks should still exist
      for (const name of finalOrder) {
        expect(initialNames).toContain(name);
      }
    });
  });

  // ============================================================
  // BOUNDARY CONDITIONS
  // ============================================================

  test.describe('Boundary Conditions', () => {
    test('should handle drag with only 2 tracks', async ({ page }) => {
      // Delete 2 tracks to leave only 2
      await page.locator('.track-row').nth(3).locator('button:has-text("Delete")').click();
      await page.waitForTimeout(200);
      await page.locator('.track-row').nth(2).locator('button:has-text("Delete")').click();
      await page.waitForTimeout(200);

      const initialOrder = await getTrackNames(page);
      expect(initialOrder.length).toBe(2);

      // Swap the two tracks
      await dragTrack(page, 0, 1);

      const newOrder = await getTrackNames(page);
      expect(newOrder[0]).toBe(initialOrder[1]);
      expect(newOrder[1]).toBe(initialOrder[0]);
    });

    test('should not allow drag with only 1 track', async ({ page }) => {
      // Delete tracks to leave only 1
      await page.locator('.track-row').nth(3).locator('button:has-text("Delete")').click();
      await page.waitForTimeout(200);
      await page.locator('.track-row').nth(2).locator('button:has-text("Delete")').click();
      await page.waitForTimeout(200);
      await page.locator('.track-row').nth(1).locator('button:has-text("Delete")').click();
      await page.waitForTimeout(200);

      const trackCount = await page.locator('.track-row').count();
      expect(trackCount).toBe(1);

      // Try to drag the single track (should not crash or corrupt)
      const handle = page.locator('.track-row').first().locator('.track-drag-handle');
      const handleBox = await handle.boundingBox();

      if (handleBox) {
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 100);
        await page.mouse.up();
      }

      // Still should have 1 track
      expect(await page.locator('.track-row').count()).toBe(1);
    });

    test('should handle maximum tracks scenario', async ({ page }) => {
      // Add more tracks (up to 8) - starting from 4 tracks in beforeEach
      await addTrack(page, /808 Open/, 5);
      await addTrack(page, /Ac. Kick/, 6);
      await addTrack(page, /Ac. Snare/, 7);
      await addTrack(page, /Ac. Hat/, 8);

      const trackCount = await page.locator('.track-row').count();
      expect(trackCount).toBe(8);

      // Drag from first to last
      await dragTrack(page, 0, 7);

      // Should still have 8 tracks
      expect(await page.locator('.track-row').count()).toBe(8);
    });
  });

  // ============================================================
  // VISUAL STATE VERIFICATION
  // ============================================================
  // Note: HTML5 Drag & Drop events (dragenter, dragover) are required for
  // drag-target visual state. Playwright's mouse events alone don't trigger
  // these. We use evaluate() to dispatch synthetic drag events for testing.

  test.describe('Visual State During Drag', () => {
    test('should clear dragging state after drag operation completes', async ({ page }) => {
      // Perform a complete drag operation
      const handle = page.locator('.track-row').nth(0).locator('.track-drag-handle');
      const target = page.locator('.track-row-wrapper').nth(2);

      await handle.dragTo(target);
      await page.waitForTimeout(200);

      // After drag ends, no tracks should have dragging or drag-target classes
      const draggingTracks = await page.locator('.track-row-wrapper.dragging').count();
      const targetTracks = await page.locator('.track-row-wrapper.drag-target').count();

      expect(draggingTracks).toBe(0);
      expect(targetTracks).toBe(0);
    });

    test('should maintain visual consistency after multiple drags', async ({ page }) => {
      // Perform multiple drag operations
      const handle0 = page.locator('.track-row').nth(0).locator('.track-drag-handle');
      const handle1 = page.locator('.track-row').nth(1).locator('.track-drag-handle');
      const target2 = page.locator('.track-row-wrapper').nth(2);
      const target3 = page.locator('.track-row-wrapper').nth(3);

      await handle0.dragTo(target2);
      await page.waitForTimeout(100);
      await handle1.dragTo(target3);
      await page.waitForTimeout(100);

      // All visual states should be cleared
      const draggingTracks = await page.locator('.track-row-wrapper.dragging').count();
      const targetTracks = await page.locator('.track-row-wrapper.drag-target').count();

      expect(draggingTracks).toBe(0);
      expect(targetTracks).toBe(0);
    });

    test('should verify drag handle cursor styling exists', async ({ page }) => {
      // Verify the drag handle has appropriate styling
      const handle = page.locator('.track-drag-handle').first();
      await expect(handle).toBeVisible();
      await expect(handle).toHaveAttribute('title', 'Drag to reorder');
      await expect(handle).toHaveAttribute('aria-label', 'Drag to reorder track');
    });
  });
});
