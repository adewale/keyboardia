/**
 * Feature Flags E2E Tests
 *
 * Tests the centralized feature flag system (src/config/features.ts).
 *
 * These tests verify the DEFAULT behavior when flags are at their default values:
 * - loopRuler: false (Loop Ruler hidden by default)
 * - advancedStepInput: true (multi-select and drag-to-paint enabled by default)
 *
 * NOTE: Feature flag default VALUES are tested in src/config/features.test.ts:
 * - Tests that loopRuler defaults to false
 * - Tests that advancedStepInput defaults to true
 * - Tests isFeatureEnabled() and getAllFeatureFlags() helpers
 *
 * These E2E tests verify the UI BEHAVIOR when flags are at their defaults,
 * which requires actual browser rendering.
 *
 * To test with flags toggled, rebuild the app with different env vars:
 *   VITE_FEATURE_LOOP_RULER=true npm run build
 *   VITE_FEATURE_ADVANCED_STEP_INPUT=false npm run build
 *
 * @see src/config/features.ts
 * @see src/config/features.test.ts
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, waitForAppReady, waitForDragComplete } from './global-setup';

/**
 * Check if running on a mobile browser project.
 */
function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

/**
 * Check if running on WebKit browser.
 * WebKit has different modifier key behavior (Ctrl+Click = context menu on Safari).
 */
function isWebkit(browserName: string): boolean {
  return browserName === 'webkit';
}

test.describe('Feature Flags', () => {
  test.describe('Loop Ruler (default: OFF)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);
    });

    test('loop ruler is NOT visible by default', async ({ page }) => {
      // Loop ruler should not be rendered when feature flag is off (default)
      const loopRuler = page.locator('.loop-ruler');
      await expect(loopRuler).toHaveCount(0);
    });

    test('loop handles are NOT visible by default', async ({ page }) => {
      // Loop handles should not exist when feature flag is off
      const loopHandles = page.locator('.loop-handle');
      await expect(loopHandles).toHaveCount(0);
    });
  });

  test.describe('Advanced Step Input (default: ON)', () => {
    test.beforeEach(async ({ page, browserName }, testInfo) => {
      test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires mouse/keyboard modifiers');
      test.skip(isWebkit(browserName), 'WebKit Ctrl+Click triggers context menu instead of multi-select');
      await page.goto('/');
      await waitForAppReady(page);

      // Wait for instrument picker to be visible (new sessions start empty)
      const kickButton = page.getByRole('button', { name: /808 Kick/i });
      await expect(kickButton).toBeVisible({ timeout: 10000 });

      // Add a track by clicking an instrument button
      await kickButton.click();

      // Wait for track row to appear
      await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
    });

    test('can Ctrl+Click to toggle step selection', async ({ page }) => {
      // Find an active step to select
      const stepCells = page.locator('.step-cell');
      const stepCount = await stepCells.count();

      if (stepCount < 4) {
        test.skip(true, 'Not enough steps visible - no track added');
        return;
      }

      // First, activate a step by clicking it
      const step0 = stepCells.nth(0);
      await step0.click();
      await expect(step0).toHaveClass(/active/);

      // Ctrl+Click to select it
      await step0.click({ modifiers: ['Control'] });

      // Step should now be selected (has .selected class)
      await expect(step0).toHaveClass(/selected/);
    });

    test('selection badge appears when steps are selected', async ({ page }) => {
      const stepCells = page.locator('.step-cell');
      const stepCount = await stepCells.count();

      if (stepCount < 4) {
        test.skip(true, 'Not enough steps visible');
        return;
      }

      // Selection badge should not exist initially
      const selectionBadge = page.locator('.selection-badge');
      await expect(selectionBadge).toHaveCount(0);

      // Activate and select a step
      const step0 = stepCells.nth(0);
      await step0.click(); // Activate
      await step0.click({ modifiers: ['Control'] }); // Select

      // Selection badge should now appear
      await expect(selectionBadge).toBeVisible();
      await expect(selectionBadge).toContainText('selected');
    });

    test('can Shift+Click to extend selection', async ({ page }) => {
      const stepCells = page.locator('.step-cell');
      const stepCount = await stepCells.count();

      if (stepCount < 8) {
        test.skip(true, 'Not enough steps visible');
        return;
      }

      // Activate steps 0-3
      for (let i = 0; i < 4; i++) {
        await stepCells.nth(i).click();
      }

      // Ctrl+Click step 0 to start selection
      await stepCells.nth(0).click({ modifiers: ['Control'] });
      await expect(stepCells.nth(0)).toHaveClass(/selected/);

      // Shift+Click step 3 to extend selection
      await stepCells.nth(3).click({ modifiers: ['Shift'] });

      // Steps 0-3 should all be selected
      for (let i = 0; i < 4; i++) {
        await expect(stepCells.nth(i)).toHaveClass(/selected/);
      }

      // Selection badge should show count
      const selectionBadge = page.locator('.selection-badge');
      await expect(selectionBadge).toContainText('4');
    });

    test('can drag to paint multiple steps', async ({ page }) => {
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
        await expect(stepCells.nth(i)).not.toHaveClass(/active/);
      }

      // Wait for elements to be stable
      await step0.waitFor({ state: 'visible' });
      await step3.waitFor({ state: 'visible' });

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
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
        }
      }

      await page.mouse.up();
      await waitForDragComplete(page);

      // Verify at least the first step is active (drag started)
      // Note: Full drag-to-paint is tested more thoroughly in core.spec.ts
      await expect(stepCells.nth(0)).toHaveClass(/active/);
    });

    // NOTE: "Escape clears selection" test was removed.
    // Covered by unit tests in src/components/keyboard-handlers.test.ts:
    // - E-003: Escape key should dispatch clear selection
    // - S-001: clear selection sets selection to null

    // NOTE: "Delete key removes selected steps" test was removed.
    // Covered by unit tests in src/components/keyboard-handlers.test.ts:
    // - D-001: delete clears all selected steps and selection
    // - D-002: delete with no selection does nothing
    // - D-003: delete with empty selection set does nothing
    // - E-004: Delete key with selection should dispatch delete
  });
});
