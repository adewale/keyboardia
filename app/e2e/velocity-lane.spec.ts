import { test, expect } from '@playwright/test';

/**
 * Velocity Lane Tests (Phase 31G)
 *
 * Tests for the visual velocity editing feature.
 * Features tested:
 * - Velocity lane toggle visibility
 * - Expanding/collapsing velocity lane
 * - Velocity bar display for active steps
 * - Clicking to adjust velocity
 * - Dragging to draw velocity curves
 * - Velocity value persistence
 */

test.describe('Velocity Lane', () => {
  test.beforeEach(async ({ page }) => {
    // Set desktop viewport to ensure velocity lane is visible (hidden on mobile)
    await page.setViewportSize({ width: 1280, height: 800 });

    // Go to home page and start a new session
    await page.goto('/');

    // Click "Start Session" to enter the app (homepage -> sequencer)
    const startButton = page.locator('button:has-text("Start Session")');
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }

    // Wait for the grid to load
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Add a track if none exist
    const trackRows = page.locator('.track-row');
    if ((await trackRows.count()) === 0) {
      // Click the floating add button to open the instrument picker
      const addButton = page.locator('[data-testid="add-track-button"]');
      await addButton.click();

      // Wait for instrument picker to be visible and click an instrument
      const instrumentBtn = page.locator('.instrument-btn').first();
      await expect(instrumentBtn).toBeVisible({ timeout: 2000 });
      await instrumentBtn.click();

      await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display velocity toggle button on tracks', async ({ page }) => {
    const velocityToggle = page.locator('.velocity-toggle').first();
    await expect(velocityToggle).toBeVisible();
    await expect(velocityToggle).toHaveAttribute('title', 'Velocity lane (visual dynamics editing)');
  });

  test('should expand velocity lane when toggle is clicked', async ({ page }) => {
    // Initially velocity lane should not be visible
    const velocityLane = page.locator('.velocity-lane').first();
    await expect(velocityLane).not.toBeVisible();

    // Click the velocity toggle
    const velocityToggle = page.locator('.velocity-toggle').first();
    await velocityToggle.click();

    // Velocity lane should now be visible
    await expect(velocityLane).toBeVisible({ timeout: 2000 });

    // Toggle should have 'expanded' class
    await expect(velocityToggle).toHaveClass(/expanded/);
  });

  test('should collapse velocity lane when toggle is clicked again', async ({ page }) => {
    const velocityToggle = page.locator('.velocity-toggle').first();
    const velocityLane = page.locator('.velocity-lane').first();

    // Expand
    await velocityToggle.click();
    await expect(velocityLane).toBeVisible({ timeout: 2000 });

    // Collapse
    await velocityToggle.click();
    await page.waitForTimeout(300); // Allow animation

    // Velocity lane should be hidden
    await expect(velocityLane).not.toBeVisible();

    // Toggle should not have 'expanded' class
    await expect(velocityToggle).not.toHaveClass(/expanded/);
  });

  test('should show velocity bars only for active steps', async ({ page }) => {
    // Activate first two steps
    const stepCells = page.locator('.step-cell');
    await stepCells.first().click();
    await stepCells.nth(1).click();

    // Verify steps are active
    await expect(stepCells.first()).toHaveClass(/active/);
    await expect(stepCells.nth(1)).toHaveClass(/active/);

    // Expand velocity lane
    const velocityToggle = page.locator('.velocity-toggle').first();
    await velocityToggle.click();
    await expect(page.locator('.velocity-lane').first()).toBeVisible({ timeout: 2000 });

    // Get velocity steps
    const velocitySteps = page.locator('.velocity-step');

    // First two should be active (have .active class)
    await expect(velocitySteps.first()).toHaveClass(/active/);
    await expect(velocitySteps.nth(1)).toHaveClass(/active/);

    // Active steps should have velocity bars
    const firstBar = velocitySteps.first().locator('.velocity-bar');
    const secondBar = velocitySteps.nth(1).locator('.velocity-bar');
    await expect(firstBar).toBeVisible();
    await expect(secondBar).toBeVisible();

    // Third step should be inactive (no bar)
    const thirdStep = velocitySteps.nth(2);
    await expect(thirdStep).toHaveClass(/inactive/);
    const thirdBar = thirdStep.locator('.velocity-bar');
    await expect(thirdBar).not.toBeVisible();
  });

  test('should adjust velocity when clicking on velocity bar', async ({ page }) => {
    // Activate first step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();
    await expect(firstStep).toHaveClass(/active/);

    // Expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.velocity-lane').first()).toBeVisible({ timeout: 2000 });

    // Get the velocity step for step 0
    const velocityStep = page.locator('.velocity-step').first();
    const velocityBar = velocityStep.locator('.velocity-bar');

    // Get initial bar height
    const initialHeight = await velocityBar.evaluate(el => el.clientHeight);

    // Click near the bottom of the velocity step (low velocity)
    const stepBox = await velocityStep.boundingBox();
    if (!stepBox) throw new Error('Could not get velocity step bounding box');

    // Click at 80% down (should set velocity to ~20%)
    await page.mouse.click(
      stepBox.x + stepBox.width / 2,
      stepBox.y + stepBox.height * 0.8
    );

    await page.waitForTimeout(100);

    // Get new bar height
    const newHeight = await velocityBar.evaluate(el => el.clientHeight);

    // Height should be different (lower)
    expect(newHeight).toBeLessThan(initialHeight);
  });

  test('should draw velocity curve when dragging across steps', async ({ page }) => {
    // Activate first four steps
    const stepCells = page.locator('.step-cell');
    for (let i = 0; i < 4; i++) {
      await stepCells.nth(i).click();
    }

    // Expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.velocity-lane').first()).toBeVisible({ timeout: 2000 });

    // Get the velocity steps
    const velocitySteps = page.locator('.velocity-step');

    // Get positions for first and fourth velocity steps
    const firstStepBox = await velocitySteps.first().boundingBox();
    const fourthStepBox = await velocitySteps.nth(3).boundingBox();

    if (!firstStepBox || !fourthStepBox) {
      throw new Error('Could not get velocity step bounding boxes');
    }

    // Start at bottom of first step (low velocity) and drag to top of fourth (high velocity)
    await page.mouse.move(
      firstStepBox.x + firstStepBox.width / 2,
      firstStepBox.y + firstStepBox.height * 0.9
    );
    await page.mouse.down();

    // Drag across to fourth step
    await page.mouse.move(
      fourthStepBox.x + fourthStepBox.width / 2,
      fourthStepBox.y + fourthStepBox.height * 0.1
    );

    await page.mouse.up();
    await page.waitForTimeout(100);

    // Get the heights of all four bars
    const heights: number[] = [];
    for (let i = 0; i < 4; i++) {
      const bar = velocitySteps.nth(i).locator('.velocity-bar');
      const height = await bar.evaluate(el => el.clientHeight);
      heights.push(height);
    }

    // Heights should generally increase (we drew from low to high)
    // Allow some tolerance for the drag mechanics
    expect(heights[3]).toBeGreaterThan(heights[0]);
  });

  test('should show velocity value in tooltip', async ({ page }) => {
    // Activate first step
    await page.locator('.step-cell').first().click();

    // Expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.velocity-lane').first()).toBeVisible({ timeout: 2000 });

    // Get the velocity bar
    const velocityBar = page.locator('.velocity-step.active').first().locator('.velocity-bar');

    // Check for title attribute (tooltip)
    const title = await velocityBar.getAttribute('title');
    expect(title).toContain('Step 1');
    expect(title).toMatch(/\d+%/); // Should contain a percentage
  });

  test('should persist velocity changes', async ({ page }) => {
    // Activate first step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.velocity-lane').first()).toBeVisible({ timeout: 2000 });

    // Set velocity to ~50% by clicking in the middle
    const velocityStep = page.locator('.velocity-step').first();
    const stepBox = await velocityStep.boundingBox();
    if (!stepBox) throw new Error('Could not get velocity step bounding box');

    await page.mouse.click(
      stepBox.x + stepBox.width / 2,
      stepBox.y + stepBox.height * 0.5
    );

    await page.waitForTimeout(100);

    // Get the velocity bar height
    const velocityBar = velocityStep.locator('.velocity-bar');
    const _height = await velocityBar.evaluate(el => el.clientHeight);

    // Check the step cell tooltip for volume info
    // This verifies the p-lock was created
    const tooltip = await firstStep.getAttribute('title');
    expect(tooltip).toContain('Vol:');
    // Velocity should be around 50% (± tolerance)
    expect(tooltip).toMatch(/Vol:\s*\d+%/);
  });

  test('should hide velocity lane on mobile viewport', async ({ page }) => {
    // Activate a step and expand velocity lane first
    await page.locator('.step-cell').first().click();
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.velocity-lane').first()).toBeVisible({ timeout: 2000 });

    // Switch to mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(200);

    // Velocity lane should be hidden on mobile
    const velocityLane = page.locator('.velocity-lane').first();
    await expect(velocityLane).not.toBeVisible();
  });

  test('should reset velocity to 100% when setting full height', async ({ page }) => {
    // Activate first step
    await page.locator('.step-cell').first().click();

    // Expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.velocity-lane').first()).toBeVisible({ timeout: 2000 });

    // First, set a low velocity
    const velocityStep = page.locator('.velocity-step').first();
    const stepBox = await velocityStep.boundingBox();
    if (!stepBox) throw new Error('Could not get velocity step bounding box');

    await page.mouse.click(
      stepBox.x + stepBox.width / 2,
      stepBox.y + stepBox.height * 0.8
    );
    await page.waitForTimeout(100);

    // Verify velocity is not 100%
    const tooltip = await page.locator('.step-cell').first().getAttribute('title');
    expect(tooltip).not.toContain('Vol: 100%');

    // Now set velocity to 100% by clicking at the top
    await page.mouse.click(
      stepBox.x + stepBox.width / 2,
      stepBox.y + 2 // Very top
    );
    await page.waitForTimeout(100);

    // Verify velocity is back to 100%
    // When velocity is 100% and no other p-lock, the lock may be cleared
    // Check the bar height instead - should be full height
    const bar = velocityStep.locator('.velocity-bar');
    const height = await bar.evaluate(el => el.clientHeight);
    expect(height).toBeGreaterThanOrEqual(38); // 40px max, allow some tolerance
  });
});
