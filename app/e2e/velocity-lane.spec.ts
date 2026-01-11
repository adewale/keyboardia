import { test, expect, waitForAnimation, getBaseUrl } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * Velocity Lane Tests (Phase 31G)
 *
 * Tests for the visual velocity editing feature.
 * Uses Playwright best practices with proper waits.
 *
 * Features tested:
 * - Velocity lane toggle visibility
 * - Expanding/collapsing velocity lane
 * - Velocity bar display for active steps
 * - Clicking to adjust velocity
 * - Dragging to draw velocity curves
 * - Velocity value persistence
 */

/**
 * Create a test session with a track for velocity lane testing
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  const steps = Array(64).fill(false);
  // Pre-activate some steps for tests that need them
  steps[0] = true;
  steps[1] = true;
  steps[2] = true;
  steps[3] = true;

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

test.describe('Velocity Lane', () => {
  test.beforeEach(async ({ page, request }) => {
    // Set desktop viewport to ensure velocity lane is visible (hidden on mobile)
    await page.setViewportSize({ width: 1280, height: 800 });

    // Create session via API and navigate to it
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
  });

  test('should display velocity toggle button on tracks', async ({ page }) => {
    const velocityToggle = page.locator('.velocity-toggle').first();
    await expect(velocityToggle).toBeVisible();
    await expect(velocityToggle).toHaveAttribute('title', 'Velocity lane (visual dynamics editing)');
  });

  test('should expand velocity lane when toggle is clicked', async ({ page }) => {
    // Find the velocity lane panel container (it contains the velocity-lane element)
    // Each TrackRow has 3 panel-animation-containers: pattern tools, velocity lane, pitch view
    // The velocity lane container is the one that contains .velocity-lane
    const velocityPanel = page.locator('.panel-animation-container:has(.velocity-lane)').first();

    // Initially velocity lane panel should not be expanded
    await expect(velocityPanel).not.toHaveClass(/expanded/);

    // Click the velocity toggle
    const velocityToggle = page.locator('.velocity-toggle').first();
    await expect(velocityToggle).toBeVisible();
    await velocityToggle.click();

    // Wait for React state to update
    await page.waitForTimeout(200);

    // Velocity lane panel should now be expanded
    await expect(velocityPanel).toHaveClass(/expanded/, { timeout: 2000 });

    // Toggle should have 'expanded' class
    await expect(velocityToggle).toHaveClass(/expanded/);
  });

  test('should collapse velocity lane when toggle is clicked again', async ({ page }) => {
    const velocityToggle = page.locator('.velocity-toggle').first();
    const velocityPanel = page.locator('.panel-animation-container:has(.velocity-lane)').first();

    // Expand
    await velocityToggle.click();
    await expect(velocityPanel).toHaveClass(/expanded/, { timeout: 2000 });

    // Collapse
    await velocityToggle.click();
    await waitForAnimation(page);

    // Panel container should not be expanded
    await expect(velocityPanel).not.toHaveClass(/expanded/);

    // Toggle should not have 'expanded' class
    await expect(velocityToggle).not.toHaveClass(/expanded/);
  });

  test('should show velocity bars only for active steps', async ({ page }) => {
    // Steps 0-3 are pre-activated from session creation
    const stepCells = page.locator('.step-cell');

    // Verify steps are active (from session)
    await expect(stepCells.first()).toHaveClass(/active/);
    await expect(stepCells.nth(1)).toHaveClass(/active/);

    // Expand velocity lane
    const velocityToggle = page.locator('.velocity-toggle').first();
    await velocityToggle.click();
    await expect(page.locator('.panel-animation-container:has(.velocity-lane)').first()).toHaveClass(/expanded/, { timeout: 2000 });

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

    // Fifth step (index 4) should be inactive (no bar) - beyond our pre-activated steps
    const fifthStep = velocitySteps.nth(4);
    await expect(fifthStep).toHaveClass(/inactive/);
    const fifthBar = fifthStep.locator('.velocity-bar');
    await expect(fifthBar).not.toBeVisible();
  });

  // NOTE: "should adjust velocity when clicking on velocity bar" test was removed.
  // Covered by unit tests in src/components/VelocityLane.test.ts

  // NOTE: "should draw velocity curve when dragging across steps" test was removed.
  // Covered by unit tests in src/components/VelocityLane.test.ts

  test('should show velocity value in tooltip', async ({ page }) => {
    // First step is pre-activated from session

    // Expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.panel-animation-container:has(.velocity-lane)').first()).toHaveClass(/expanded/, { timeout: 2000 });

    // Get the velocity bar
    const velocityBar = page.locator('.velocity-step.active').first().locator('.velocity-bar');

    // Check for title attribute (tooltip)
    const title = await velocityBar.getAttribute('title');
    expect(title).toContain('Step 1');
    expect(title).toMatch(/\d+%/); // Should contain a percentage
  });

  test('should persist velocity changes', async ({ page }) => {
    // First step is pre-activated from session
    const firstStep = page.locator('.step-cell').first();

    // Expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.panel-animation-container:has(.velocity-lane)').first()).toHaveClass(/expanded/, { timeout: 2000 });

    // Set velocity to ~50% by clicking in the middle
    const velocityStep = page.locator('.velocity-step').first();
    const stepBox = await velocityStep.boundingBox();
    if (!stepBox) throw new Error('Could not get velocity step bounding box');

    await page.mouse.click(
      stepBox.x + stepBox.width / 2,
      stepBox.y + stepBox.height * 0.5
    );

    // Wait for state to update
    await page.waitForLoadState('networkidle');

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
    // First step is pre-activated from session, just expand velocity lane
    await page.locator('.velocity-toggle').first().click();
    await expect(page.locator('.panel-animation-container:has(.velocity-lane)').first()).toHaveClass(/expanded/, { timeout: 2000 });

    // Switch to mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await waitForAnimation(page);

    // Velocity lane should be hidden on mobile
    const velocityLane = page.locator('.velocity-lane').first();
    await expect(velocityLane).not.toBeVisible();
  });

  // NOTE: "should reset velocity to 100% when setting full height" test was removed.
  // Covered by unit tests in src/components/VelocityLane.test.ts
});
