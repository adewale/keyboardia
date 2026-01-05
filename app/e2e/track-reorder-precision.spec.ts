import { test, expect, type Page } from '@playwright/test';

// Skip in CI - requires real backend infrastructure
test.skip(!!process.env.CI, 'Skipped in CI - requires real backend');

/**
 * Track Reorder Precision Tests
 *
 * These tests verify that the dragged track ends up EXACTLY where the
 * drop target highlight indicates it will be dropped.
 *
 * Reorder algorithm:
 *   const [moved] = tracks.splice(fromIndex, 1);  // Remove from original
 *   tracks.splice(toIndex, 0, moved);              // Insert at target position
 *
 * This means: dragging track at index F to track at index T results in the
 * dragged track being placed at index T (after removal and insertion).
 */

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

// Helper: Add a track by clicking instrument button and verify it was added
async function addTrack(page: Page, instrumentPattern: RegExp, expectedCount: number): Promise<void> {
  await page.getByRole('button', { name: instrumentPattern }).first().click();
  // Wait until the expected number of tracks exist
  await expect(page.locator('.track-row').nth(expectedCount - 1)).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(100);
}

// Helper: Perform a complete drag operation and return the final order
async function dragAndGetOrder(
  page: Page,
  fromIndex: number,
  toIndex: number
): Promise<string[]> {
  const fromHandle = page.locator('.track-row').nth(fromIndex).locator('.track-drag-handle');
  const toWrapper = page.locator('.track-row-wrapper').nth(toIndex);

  await fromHandle.dragTo(toWrapper);
  await page.waitForTimeout(200);

  return await getTrackNames(page);
}

// Calculate expected order after reorder
function calculateExpectedOrder(
  originalOrder: string[],
  fromIndex: number,
  toIndex: number
): string[] {
  if (fromIndex === toIndex) return [...originalOrder];

  const result = [...originalOrder];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

test.describe('Track Reorder Precision', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Click "Start Session" if visible
    const startButton = page.locator('button:has-text("Start Session")');
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }

    // Wait for instrument picker
    await expect(page.getByRole('button', { name: /808 Kick/ })).toBeVisible({ timeout: 10000 });

    // Add 5 tracks with distinct names for clear tracking
    // Using different instruments to ensure unique names
    // Each addTrack call verifies the track was created before proceeding
    await addTrack(page, /808 Hat/, 1);     // Track 0
    await addTrack(page, /808 Kick/, 2);    // Track 1
    await addTrack(page, /808 Snare/, 3);   // Track 2
    await addTrack(page, /808 Clap/, 4);    // Track 3
    await addTrack(page, /808 Open/, 5);    // Track 4
  });

  // ============================================================
  // PRECISE POSITION TESTS - Dragging DOWN (fromIndex < toIndex)
  // ============================================================

  test.describe('Dragging Down (to higher index)', () => {
    test('drag index 0 to index 1 - first to second position', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 0, 1);

      const final = await dragAndGetOrder(page, 0, 1);

      expect(final).toEqual(expected);
      // Verify specific positions
      expect(final[0]).toBe(original[1]); // Second becomes first
      expect(final[1]).toBe(original[0]); // First moves to second
    });

    test('drag index 0 to index 2 - first to third position', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 0, 2);

      const final = await dragAndGetOrder(page, 0, 2);

      expect(final).toEqual(expected);
      // Track 0 should now be at index 2
      expect(final[2]).toBe(original[0]);
      // Tracks 1 and 2 shift up
      expect(final[0]).toBe(original[1]);
      expect(final[1]).toBe(original[2]);
    });

    test('drag index 0 to index 4 - first to last position', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 0, 4);

      const final = await dragAndGetOrder(page, 0, 4);

      expect(final).toEqual(expected);
      // First track is now last
      expect(final[4]).toBe(original[0]);
      // All others shift up by one
      expect(final[0]).toBe(original[1]);
      expect(final[1]).toBe(original[2]);
      expect(final[2]).toBe(original[3]);
      expect(final[3]).toBe(original[4]);
    });

    test('drag index 1 to index 3 - middle to further down', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 1, 3);

      const final = await dragAndGetOrder(page, 1, 3);

      expect(final).toEqual(expected);
      // Track 1 should now be at index 3
      expect(final[3]).toBe(original[1]);
    });

    test('drag index 2 to index 4 - middle to last', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 2, 4);

      const final = await dragAndGetOrder(page, 2, 4);

      expect(final).toEqual(expected);
      expect(final[4]).toBe(original[2]);
    });
  });

  // ============================================================
  // PRECISE POSITION TESTS - Dragging UP (fromIndex > toIndex)
  // ============================================================

  test.describe('Dragging Up (to lower index)', () => {
    test('drag index 4 to index 3 - last to second-to-last', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 4, 3);

      const final = await dragAndGetOrder(page, 4, 3);

      expect(final).toEqual(expected);
      // Track 4 moves to index 3, Track 3 shifts down
      expect(final[3]).toBe(original[4]);
      expect(final[4]).toBe(original[3]);
    });

    test('drag index 4 to index 0 - last to first position', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 4, 0);

      const final = await dragAndGetOrder(page, 4, 0);

      expect(final).toEqual(expected);
      // Last track is now first
      expect(final[0]).toBe(original[4]);
      // All others shift down by one
      expect(final[1]).toBe(original[0]);
      expect(final[2]).toBe(original[1]);
      expect(final[3]).toBe(original[2]);
      expect(final[4]).toBe(original[3]);
    });

    test('drag index 3 to index 1 - fourth to second position', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 3, 1);

      const final = await dragAndGetOrder(page, 3, 1);

      expect(final).toEqual(expected);
      expect(final[1]).toBe(original[3]);
    });

    test('drag index 2 to index 0 - middle to first', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 2, 0);

      const final = await dragAndGetOrder(page, 2, 0);

      expect(final).toEqual(expected);
      expect(final[0]).toBe(original[2]);
      expect(final[1]).toBe(original[0]);
      expect(final[2]).toBe(original[1]);
    });
  });

  // ============================================================
  // ADJACENT SWAPS - Both directions
  // ============================================================

  test.describe('Adjacent Swaps', () => {
    test('swap indices 0 and 1', async ({ page }) => {
      const original = await getTrackNames(page);

      // Drag 0 to 1
      const final1 = await dragAndGetOrder(page, 0, 1);
      expect(final1[0]).toBe(original[1]);
      expect(final1[1]).toBe(original[0]);

      // Drag back: now track at 1 to position 0
      const final2 = await dragAndGetOrder(page, 1, 0);
      expect(final2).toEqual(original);
    });

    test('swap indices 1 and 2', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 1, 2);

      const final = await dragAndGetOrder(page, 1, 2);

      expect(final).toEqual(expected);
      expect(final[1]).toBe(original[2]);
      expect(final[2]).toBe(original[1]);
    });

    test('swap indices 3 and 4 (last two)', async ({ page }) => {
      const original = await getTrackNames(page);
      const expected = calculateExpectedOrder(original, 3, 4);

      const final = await dragAndGetOrder(page, 3, 4);

      expect(final).toEqual(expected);
      expect(final[3]).toBe(original[4]);
      expect(final[4]).toBe(original[3]);
    });
  });

  // ============================================================
  // SAME POSITION - No change expected
  // ============================================================

  test.describe('Same Position (No-op)', () => {
    test('drag index 0 to index 0 - no change', async ({ page }) => {
      const original = await getTrackNames(page);

      const final = await dragAndGetOrder(page, 0, 0);

      expect(final).toEqual(original);
    });

    test('drag index 2 to index 2 - no change', async ({ page }) => {
      const original = await getTrackNames(page);

      const final = await dragAndGetOrder(page, 2, 2);

      expect(final).toEqual(original);
    });

    test('drag index 4 to index 4 - no change', async ({ page }) => {
      const original = await getTrackNames(page);

      const final = await dragAndGetOrder(page, 4, 4);

      expect(final).toEqual(original);
    });
  });

  // ============================================================
  // CHAINED OPERATIONS - Multiple drags in sequence
  // ============================================================

  test.describe('Chained Operations', () => {
    test('reverse order through sequential drags', async ({ page }) => {
      const original = await getTrackNames(page);

      // [A, B, C, D, E] -> move A to end -> [B, C, D, E, A]
      await dragAndGetOrder(page, 0, 4);
      // [B, C, D, E, A] -> move B to end -> [C, D, E, A, B]
      await dragAndGetOrder(page, 0, 4);
      // [C, D, E, A, B] -> move C to end -> [D, E, A, B, C]
      await dragAndGetOrder(page, 0, 4);
      // [D, E, A, B, C] -> move D to end -> [E, A, B, C, D]
      const final = await dragAndGetOrder(page, 0, 4);

      // After 4 rotations, E is first, then A, B, C, D
      expect(final[0]).toBe(original[4]); // E
      expect(final[1]).toBe(original[0]); // A
      expect(final[2]).toBe(original[1]); // B
      expect(final[3]).toBe(original[2]); // C
      expect(final[4]).toBe(original[3]); // D
    });

    test('circular shift back to original', async ({ page }) => {
      const original = await getTrackNames(page);

      // Do 5 rotations (move first to last each time)
      for (let i = 0; i < 5; i++) {
        await dragAndGetOrder(page, 0, 4);
      }

      const final = await getTrackNames(page);

      // After 5 full rotations, should be back to original
      expect(final).toEqual(original);
    });

    test('complex sequence maintains consistency', async ({ page }) => {
      const original = await getTrackNames(page);

      // Perform a complex sequence
      await dragAndGetOrder(page, 0, 3); // A to position 3
      await dragAndGetOrder(page, 4, 1); // E to position 1
      await dragAndGetOrder(page, 2, 0); // C to position 0

      const final = await getTrackNames(page);

      // Verify all original tracks still exist
      expect(final.sort()).toEqual([...original].sort());
      expect(final.length).toBe(5);
    });
  });

  // ============================================================
  // EXTREME POSITIONS
  // ============================================================

  test.describe('Extreme Position Moves', () => {
    test('first to last repeatedly', async ({ page }) => {
      const original = await getTrackNames(page);

      // Move first to last
      let result = await dragAndGetOrder(page, 0, 4);
      expect(result[4]).toBe(original[0]);

      // Again
      const newFirst = result[0];
      result = await dragAndGetOrder(page, 0, 4);
      expect(result[4]).toBe(newFirst);
    });

    test('last to first repeatedly', async ({ page }) => {
      const original = await getTrackNames(page);

      // Move last to first
      let result = await dragAndGetOrder(page, 4, 0);
      expect(result[0]).toBe(original[4]);

      // Again
      const newLast = result[4];
      result = await dragAndGetOrder(page, 4, 0);
      expect(result[0]).toBe(newLast);
    });
  });

  // ============================================================
  // VERIFICATION OF INTERMEDIATE POSITIONS
  // ============================================================

  test.describe('All Intermediate Positions', () => {
    test('drag from index 0 to all other indices', async ({ page }) => {
      for (let toIdx = 1; toIdx < 5; toIdx++) {
        // Reload to get fresh state
        await page.reload();
        await expect(page.locator('.track-row').nth(4)).toBeVisible({ timeout: 5000 });

        const original = await getTrackNames(page);
        const expected = calculateExpectedOrder(original, 0, toIdx);

        const final = await dragAndGetOrder(page, 0, toIdx);

        expect(final).toEqual(expected);
        expect(final[toIdx]).toBe(original[0]);
      }
    });

    test('drag from index 4 to all other indices', async ({ page }) => {
      for (let toIdx = 0; toIdx < 4; toIdx++) {
        // Reload to get fresh state
        await page.reload();
        await expect(page.locator('.track-row').nth(4)).toBeVisible({ timeout: 5000 });

        const original = await getTrackNames(page);
        const expected = calculateExpectedOrder(original, 4, toIdx);

        const final = await dragAndGetOrder(page, 4, toIdx);

        expect(final).toEqual(expected);
        expect(final[toIdx]).toBe(original[4]);
      }
    });

    test('drag middle track (index 2) to all other indices', async ({ page }) => {
      for (let toIdx = 0; toIdx < 5; toIdx++) {
        if (toIdx === 2) continue; // Skip same position

        // Reload to get fresh state
        await page.reload();
        await expect(page.locator('.track-row').nth(4)).toBeVisible({ timeout: 5000 });

        const original = await getTrackNames(page);
        const expected = calculateExpectedOrder(original, 2, toIdx);

        const final = await dragAndGetOrder(page, 2, toIdx);

        expect(final).toEqual(expected);
        expect(final[toIdx]).toBe(original[2]);
      }
    });
  });

  // ============================================================
  // REGRESSION: Verify no off-by-one errors
  // ============================================================

  test.describe('Off-by-One Verification', () => {
    test('dragging down: track ends at exact target position, not one before or after', async ({ page }) => {
      const original = await getTrackNames(page);

      // Drag from 1 to 3
      const final = await dragAndGetOrder(page, 1, 3);

      // Track should be at EXACTLY index 3, not 2 or 4
      expect(final[3]).toBe(original[1]);
      expect(final[2]).not.toBe(original[1]);
      if (final.length > 4) {
        expect(final[4]).not.toBe(original[1]);
      }
    });

    test('dragging up: track ends at exact target position, not one before or after', async ({ page }) => {
      const original = await getTrackNames(page);

      // Drag from 3 to 1
      const final = await dragAndGetOrder(page, 3, 1);

      // Track should be at EXACTLY index 1, not 0 or 2
      expect(final[1]).toBe(original[3]);
      expect(final[0]).not.toBe(original[3]);
      expect(final[2]).not.toBe(original[3]);
    });

    test('full matrix: every source to every target', async ({ page }) => {
      // This is a comprehensive test that verifies ALL possible moves
      // We test a smaller subset for performance

      const moves = [
        [0, 2], [0, 4],
        [1, 3], [1, 0],
        [2, 0], [2, 4],
        [3, 1], [3, 4],
        [4, 0], [4, 2],
      ];

      for (const [from, to] of moves) {
        await page.reload();
        await expect(page.locator('.track-row').nth(4)).toBeVisible({ timeout: 5000 });

        const original = await getTrackNames(page);
        const expected = calculateExpectedOrder(original, from, to);

        const final = await dragAndGetOrder(page, from, to);

        expect(final).toEqual(expected);
      }
    });
  });
});
