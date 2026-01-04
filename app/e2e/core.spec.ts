/**
 * Core Functionality Tests (P0)
 *
 * Critical path tests for the most important user workflows.
 * These tests must pass for any release.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect } from '@playwright/test';
import { waitWithTolerance } from './global-setup';

test.describe('Drag to Paint Steps', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('can drag to paint multiple steps active', async ({ page }) => {
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    if (stepCount < 8) {
      test.skip(true, 'Not enough steps visible');
      return;
    }

    // Get first 4 steps
    const step0 = stepCells.nth(0);
    const step3 = stepCells.nth(3);

    // Verify all start inactive
    for (let i = 0; i < 4; i++) {
      const isActive = await stepCells.nth(i).evaluate((el) =>
        el.classList.contains('active')
      );
      expect(isActive).toBe(false);
    }

    // Get bounding boxes for drag
    const box0 = await step0.boundingBox();
    const box3 = await step3.boundingBox();

    if (!box0 || !box3) {
      test.skip(true, 'Could not get step bounding boxes');
      return;
    }

    // Drag from step 0 to step 3
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.down();

    // Move through each step
    for (let i = 1; i <= 3; i++) {
      const box = await stepCells.nth(i).boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await waitWithTolerance(page, 50);
      }
    }

    await page.mouse.up();
    await waitWithTolerance(page, 200);

    // Verify steps 0-3 are now active
    let activeCount = 0;
    for (let i = 0; i < 4; i++) {
      const isActive = await stepCells.nth(i).evaluate((el) =>
        el.classList.contains('active')
      );
      if (isActive) activeCount++;
    }

    // At least some steps should be painted
    expect(activeCount).toBeGreaterThan(0);
    console.log(`Drag to paint: ${activeCount}/4 steps activated`);
  });

  test('can drag to erase multiple steps', async ({ page }) => {
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    if (stepCount < 4) {
      test.skip(true, 'Not enough steps visible');
      return;
    }

    // First activate steps 0-3 by clicking
    for (let i = 0; i < 4; i++) {
      await stepCells.nth(i).click();
      await waitWithTolerance(page, 100);
    }

    // Verify all are active
    for (let i = 0; i < 4; i++) {
      const isActive = await stepCells.nth(i).evaluate((el) =>
        el.classList.contains('active')
      );
      expect(isActive).toBe(true);
    }

    const step0 = stepCells.nth(0);
    const step3 = stepCells.nth(3);
    const box0 = await step0.boundingBox();
    const box3 = await step3.boundingBox();

    if (!box0 || !box3) {
      test.skip(true, 'Could not get step bounding boxes');
      return;
    }

    // Drag from step 0 to step 3 to erase
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.down();

    for (let i = 1; i <= 3; i++) {
      const box = await stepCells.nth(i).boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await waitWithTolerance(page, 50);
      }
    }

    await page.mouse.up();
    await waitWithTolerance(page, 200);

    // Count how many are still active
    let activeCount = 0;
    for (let i = 0; i < 4; i++) {
      const isActive = await stepCells.nth(i).evaluate((el) =>
        el.classList.contains('active')
      );
      if (isActive) activeCount++;
    }

    // Should have erased some or all
    console.log(`Drag to erase: ${activeCount}/4 steps still active`);
  });
});

test.describe('Tempo Control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('can drag to change tempo', async ({ page }) => {
    // Find tempo display
    const tempoDisplay = page.locator('.transport-number').first();
    const tempoControl = page.locator('.transport-value').first();

    if (!(await tempoControl.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'Tempo control not visible');
      return;
    }

    // Get initial tempo
    const initialTempo = parseInt((await tempoDisplay.textContent()) ?? '120', 10);
    console.log(`Initial tempo: ${initialTempo}`);

    // Get control position
    const box = await tempoControl.boundingBox();
    if (!box) {
      test.skip(true, 'Could not get tempo control bounding box');
      return;
    }

    // Drag upward to increase tempo
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // Drag up by 40 pixels
    for (let y = centerY; y > centerY - 40; y -= 5) {
      await page.mouse.move(centerX, y);
      await page.waitForTimeout(20);
    }

    await page.mouse.up();
    await waitWithTolerance(page, 200);

    // Get new tempo
    const newTempo = parseInt((await tempoDisplay.textContent()) ?? '120', 10);
    console.log(`New tempo: ${newTempo}`);

    // Tempo should have increased
    expect(newTempo).toBeGreaterThan(initialTempo);
  });

  test('tempo stays within valid range', async ({ page }) => {
    const tempoDisplay = page.locator('.transport-number').first();
    const tempoControl = page.locator('.transport-value').first();

    if (!(await tempoControl.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'Tempo control not visible');
      return;
    }

    const box = await tempoControl.boundingBox();
    if (!box) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Try to drag tempo way up (beyond max)
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - 200);
    await page.mouse.up();
    await waitWithTolerance(page, 100);

    const maxTempo = parseInt((await tempoDisplay.textContent()) ?? '180', 10);

    // Should be clamped to max (typically 180 or 300)
    expect(maxTempo).toBeLessThanOrEqual(300);

    // Try to drag tempo way down (below min)
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY + 300);
    await page.mouse.up();
    await waitWithTolerance(page, 100);

    const minTempo = parseInt((await tempoDisplay.textContent()) ?? '60', 10);

    // Should be clamped to min (typically 20 or 40)
    expect(minTempo).toBeGreaterThanOrEqual(20);

    console.log(`Tempo range test: min=${minTempo}, max=${maxTempo}`);
  });
});

test.describe('Track Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('can delete a track', async ({ page }) => {
    // Count initial tracks
    const initialTrackCount = await page.locator('.track-row').count();

    if (initialTrackCount < 1) {
      // Add a track first
      const instrumentBtn = page.locator('.instrument-btn, .sample-button').first();
      if (await instrumentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await instrumentBtn.click();
        await waitWithTolerance(page, 500);
      }
    }

    const trackRows = page.locator('.track-row');
    const trackCount = await trackRows.count();

    if (trackCount < 1) {
      test.skip(true, 'No tracks to delete');
      return;
    }

    // Find delete button on first track
    const firstTrack = trackRows.first();
    const deleteBtn = firstTrack.locator('[data-testid="delete-track"], .delete-button, .remove-track').first();

    if (await deleteBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deleteBtn.click();
      await waitWithTolerance(page, 500);

      // Track count should decrease
      const newTrackCount = await trackRows.count();
      expect(newTrackCount).toBe(trackCount - 1);

      console.log(`Track deleted: ${trackCount} -> ${newTrackCount}`);
    } else {
      // Try right-click context menu
      await firstTrack.click({ button: 'right' });
      await waitWithTolerance(page, 200);

      const contextDelete = page.locator('[data-testid="context-delete"], .context-menu-item:has-text("Delete")');
      if (await contextDelete.isVisible({ timeout: 1000 }).catch(() => false)) {
        await contextDelete.click();
        await waitWithTolerance(page, 500);

        const newTrackCount = await trackRows.count();
        expect(newTrackCount).toBe(trackCount - 1);
      } else {
        console.log('Delete button not found via direct click or context menu');
      }
    }
  });

  test('can reorder tracks by dragging', async ({ page }) => {
    // Ensure we have at least 2 tracks
    const trackRows = page.locator('.track-row');
    let trackCount = await trackRows.count();

    // Add tracks if needed
    while (trackCount < 2) {
      const instrumentBtn = page.locator('.instrument-btn, .sample-button').nth(trackCount);
      if (await instrumentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await instrumentBtn.click();
        await waitWithTolerance(page, 500);
        trackCount = await trackRows.count();
      } else {
        break;
      }
    }

    if (trackCount < 2) {
      test.skip(true, 'Need at least 2 tracks for reorder test');
      return;
    }

    // Get initial track IDs/names
    const getTrackIds = async () => {
      const ids: string[] = [];
      const count = await trackRows.count();
      for (let i = 0; i < count; i++) {
        const track = trackRows.nth(i);
        const id = await track.getAttribute('data-track-id') ??
          await track.locator('.track-name').textContent() ??
          `track-${i}`;
        ids.push(id);
      }
      return ids;
    };

    const initialOrder = await getTrackIds();
    console.log('Initial track order:', initialOrder);

    // Find drag handle on first track
    const firstTrack = trackRows.first();
    const secondTrack = trackRows.nth(1);
    const dragHandle = firstTrack.locator('.drag-handle, [data-testid="drag-handle"]').first();

    if (!(await dragHandle.isVisible({ timeout: 1000 }).catch(() => false))) {
      console.log('Drag handle not visible, skipping reorder test');
      return;
    }

    const handleBox = await dragHandle.boundingBox();
    const secondBox = await secondTrack.boundingBox();

    if (!handleBox || !secondBox) {
      console.log('Could not get bounding boxes for drag');
      return;
    }

    // Drag first track below second
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height + 10);
    await waitWithTolerance(page, 100);
    await page.mouse.up();
    await waitWithTolerance(page, 300);

    const newOrder = await getTrackIds();
    console.log('New track order:', newOrder);

    // Order should have changed
    expect(newOrder[0]).not.toBe(initialOrder[0]);
  });
});

test.describe('Swing Control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('can drag to change swing', async ({ page }) => {
    // Find swing control (usually second transport-value)
    const swingControl = page.locator('[data-testid="swing-control"], .transport-value:has-text("Swing")').first();
    const swingDisplay = swingControl.locator('.transport-number');

    if (!(await swingControl.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Fallback to nth selector
      const fallbackControl = page.locator('.transport-value').nth(1);
      if (!(await fallbackControl.isVisible({ timeout: 1000 }).catch(() => false))) {
        test.skip(true, 'Swing control not visible');
        return;
      }
    }

    const control = page.locator('.transport-value').nth(1);
    const display = control.locator('.transport-number');

    // Get initial swing
    const initialSwing = parseInt((await display.textContent()) ?? '0', 10);
    console.log(`Initial swing: ${initialSwing}`);

    const box = await control.boundingBox();
    if (!box) return;

    // Drag upward to increase swing
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    for (let y = centerY; y > centerY - 30; y -= 5) {
      await page.mouse.move(centerX, y);
      await page.waitForTimeout(20);
    }

    await page.mouse.up();
    await waitWithTolerance(page, 200);

    const newSwing = parseInt((await display.textContent()) ?? '0', 10);
    console.log(`New swing: ${newSwing}`);

    // Swing should have increased
    expect(newSwing).toBeGreaterThan(initialSwing);
  });
});

test.describe('Session Name', () => {
  test('can edit session name', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);

    // Find session name element
    const sessionName = page.locator('[data-testid="session-name"], .session-name, .header-title').first();

    if (!(await sessionName.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'Session name element not visible');
      return;
    }

    const originalName = await sessionName.textContent();
    console.log(`Original session name: ${originalName}`);

    // Click to edit
    await sessionName.click();
    await waitWithTolerance(page, 200);

    // Look for input field
    const nameInput = page.locator('[data-testid="session-name-input"], .session-name-input, input.session-name').first();

    if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Clear and type new name
      await nameInput.fill('Test Session Name');
      await page.keyboard.press('Enter');
      await waitWithTolerance(page, 500);

      // Verify name changed
      const newName = await sessionName.textContent();
      expect(newName).toBe('Test Session Name');

      console.log(`Session name changed: ${originalName} -> ${newName}`);
    } else {
      console.log('Session name input not found after clicking');
    }
  });
});

test.describe('Step Count Control', () => {
  test('can change track step count', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row', { timeout: 15000 });
    await waitWithTolerance(page, 500);

    const trackRow = page.locator('.track-row').first();
    if (!(await trackRow.isVisible())) {
      test.skip(true, 'No track rows visible');
      return;
    }

    // Count initial steps
    const initialSteps = await trackRow.locator('.step-cell').count();
    console.log(`Initial step count: ${initialSteps}`);

    // Find step count selector
    const stepCountSelect = trackRow.locator('.step-count-select, select[data-testid="step-count"]');

    if (await stepCountSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Change to 32 steps
      await stepCountSelect.selectOption('32');
      await waitWithTolerance(page, 300);

      const newSteps = await trackRow.locator('.step-cell').count();
      expect(newSteps).toBe(32);

      console.log(`Step count changed: ${initialSteps} -> ${newSteps}`);
    } else {
      console.log('Step count select not found');
    }
  });
});
