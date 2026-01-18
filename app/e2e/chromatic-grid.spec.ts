import { test, expect, getBaseUrl, useMockAPI } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

// Skip tests that require real backend for session persistence
test.skip(useMockAPI, 'Chromatic grid tests require real backend for session API');

/**
 * Chromatic Grid Redesign Tests
 *
 * Tests for the two-mode chromatic grid:
 * - "Events" mode (default): Shows key intervals + pitches with notes
 * - "All" mode: Shows all 49 chromatic pitches
 *
 * Key requirement: Notes at non-key-interval pitches (like -8, -9, -10, -11)
 * must be visible and never hidden (Guardrail #1).
 */

/**
 * Create a test session with notes at non-key-interval pitches
 * This mimics the bug case from session 592c0308 where Piano 2 had
 * pitches at -8, -9, -10, -11 which were invisible in the old grid.
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  const steps = Array(128).fill(false);
  // Activate steps 0-3
  steps[0] = true;
  steps[1] = true;
  steps[2] = true;
  steps[3] = true;

  // Parameter locks with non-key-interval pitches
  const parameterLocks = Array(128).fill(null);
  parameterLocks[0] = { pitch: -8 };
  parameterLocks[1] = { pitch: -9 };
  parameterLocks[2] = { pitch: -10 };
  parameterLocks[3] = { pitch: -11 };

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-piano',
        name: 'Piano',
        sampleId: 'sampled:piano',
        steps,
        parameterLocks,
        volume: 1,
        muted: false,
        soloed: false,
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
 * Check if running on a mobile browser project.
 */
function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

test.describe('Chromatic Grid Redesign', () => {
  test.beforeEach(async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');

    // Wait for the grid to load
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Wait for WebSocket connection
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Wait for track to appear
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
  });

  test('should show view mode segmented control when chromatic grid is expanded', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');
    // Click the pitch toggle to expand chromatic grid
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    // Wait for chromatic grid to appear
    const chromaticGrid = page.locator('.chromatic-grid');
    await expect(chromaticGrid).toBeVisible({ timeout: 5000 });

    // Verify segmented control is visible
    const viewModeControl = page.locator('.chromatic-view-mode-control');
    await expect(viewModeControl).toBeVisible();

    // Verify both buttons exist
    const eventsButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'Events' });
    const allButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'All' });
    await expect(eventsButton).toBeVisible();
    await expect(allButton).toBeVisible();

    // Verify Events is active by default
    await expect(eventsButton).toHaveClass(/chromatic-view-mode-control__button--active/);
  });

  test('should show non-key-interval pitches in Events mode (guardrail #1)', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');
    // Click the pitch toggle to expand chromatic grid
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    // Wait for chromatic grid to appear
    const chromaticGrid = page.locator('.chromatic-grid');
    await expect(chromaticGrid).toBeVisible({ timeout: 5000 });

    // The track has notes at pitches -8, -9, -10, -11
    // These are NOT key intervals, but should be visible due to guardrail #1

    // Check that pitch labels for -8, -9, -10, -11 are visible
    // Pitch labels show the value like "-8", "-9" etc.
    const pitch8Label = page.locator('.pitch-label .pitch-value', { hasText: '-8' });
    const pitch9Label = page.locator('.pitch-label .pitch-value', { hasText: '-9' });
    const pitch10Label = page.locator('.pitch-label .pitch-value', { hasText: '-10' });
    const pitch11Label = page.locator('.pitch-label .pitch-value', { hasText: '-11' });

    await expect(pitch8Label).toBeVisible();
    await expect(pitch9Label).toBeVisible();
    await expect(pitch10Label).toBeVisible();
    await expect(pitch11Label).toBeVisible();
  });

  test('should toggle to All mode and show 49 rows', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');
    // Click the pitch toggle to expand chromatic grid
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    // Wait for chromatic grid to appear
    const chromaticGrid = page.locator('.chromatic-grid');
    await expect(chromaticGrid).toBeVisible({ timeout: 5000 });

    // Click the "All" button
    const allButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'All' });
    await allButton.click();

    // Verify All button is now active
    await expect(allButton).toHaveClass(/chromatic-view-mode-control__button--active/);

    // Verify Events button is no longer active
    const eventsButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'Events' });
    await expect(eventsButton).not.toHaveClass(/chromatic-view-mode-control__button--active/);

    // In All mode, we should have 49 pitch rows (from +24 to -24)
    const pitchLabels = page.locator('.pitch-label');
    await expect(pitchLabels).toHaveCount(49);

    // Verify the view mode class is applied
    await expect(chromaticGrid).toHaveClass(/view-mode-all/);
  });

  test('should add view-mode-all class for dimmed chromatic styling', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');
    // Click the pitch toggle to expand chromatic grid
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    const chromaticGrid = page.locator('.chromatic-grid');
    await expect(chromaticGrid).toBeVisible({ timeout: 5000 });

    // Initially in events mode
    await expect(chromaticGrid).toHaveClass(/view-mode-events/);

    // Switch to All mode
    const allButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'All' });
    await allButton.click();

    // Verify class changed
    await expect(chromaticGrid).toHaveClass(/view-mode-all/);
    await expect(chromaticGrid).not.toHaveClass(/view-mode-events/);

    // Switch back to Events
    const eventsButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'Events' });
    await eventsButton.click();

    await expect(chromaticGrid).toHaveClass(/view-mode-events/);
    await expect(chromaticGrid).not.toHaveClass(/view-mode-all/);
  });

  test('should have correct tooltip on mode buttons', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');
    // Click the pitch toggle to expand chromatic grid
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    await expect(page.locator('.chromatic-grid')).toBeVisible({ timeout: 5000 });

    // Check tooltip attributes
    const eventsButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'Events' });
    const allButton = page.locator('.chromatic-view-mode-control__button', { hasText: 'All' });

    await expect(eventsButton).toHaveAttribute('title', 'Show key intervals plus pitches with notes');
    await expect(allButton).toHaveAttribute('title', 'Show all 49 chromatic pitches (-24 to +24)');
  });
});

/**
 * Create a test session with notes that will be out-of-scale when C major is locked
 * C major: C, D, E, F, G, A, B (indices 0, 2, 4, 5, 7, 9, 11)
 * Out-of-scale: C#, D#, F#, G#, A# (indices 1, 3, 6, 8, 10)
 */
async function createScaleLockTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  const steps = Array(128).fill(false);
  // Activate steps 0-3
  steps[0] = true;
  steps[1] = true;
  steps[2] = true;
  steps[3] = true;

  // Parameter locks with pitches that are out-of-scale in C major
  const parameterLocks = Array(128).fill(null);
  parameterLocks[0] = { pitch: 0 };  // C - in scale
  parameterLocks[1] = { pitch: 1 };  // C# - OUT of scale
  parameterLocks[2] = { pitch: 3 };  // D# - OUT of scale
  parameterLocks[3] = { pitch: 7 };  // G - in scale

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-piano',
        name: 'Piano',
        sampleId: 'sampled:piano',
        steps,
        parameterLocks,
        volume: 1,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  });
}

test.describe('Chromatic Grid Scale Lock', () => {
  test.beforeEach(async ({ page, request }) => {
    const { id } = await createScaleLockTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');

    // Wait for the grid to load
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Wait for WebSocket connection
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });

    // Wait for track to appear
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
  });

  test('should show out-of-scale warning badge when scale is locked with out-of-scale notes', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');

    // First, open scale sidebar and lock to C major
    const scaleSidebarToggle = page.locator('[data-testid="scale-sidebar-toggle"]');
    if (await scaleSidebarToggle.isVisible()) {
      await scaleSidebarToggle.click();
    }

    // Wait for scale sidebar to appear
    const scaleSidebar = page.locator('.scale-sidebar');
    await expect(scaleSidebar).toBeVisible({ timeout: 5000 });

    // Set root to C (if not already)
    const rootSelect = page.locator('.scale-sidebar select').first();
    await rootSelect.selectOption('C');

    // Set scale to major
    const scaleSelect = page.locator('.scale-sidebar select').nth(1);
    await scaleSelect.selectOption('major');

    // Toggle scale lock ON
    const lockToggle = page.locator('.scale-lock-toggle');
    if (await lockToggle.isVisible()) {
      await lockToggle.click();
    }

    // Wait for scale lock to be active
    await expect(page.locator('.scale-sidebar--locked')).toBeVisible({ timeout: 2000 });

    // Click the pitch toggle to expand chromatic grid
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    // Wait for chromatic grid to appear
    const chromaticGrid = page.locator('.chromatic-grid');
    await expect(chromaticGrid).toBeVisible({ timeout: 5000 });

    // Verify out-of-scale warning badge is visible (2 notes are out of scale: C#, D#)
    const warningBadge = page.locator('.chromatic-out-of-scale-warning');
    await expect(warningBadge).toBeVisible();
    await expect(warningBadge).toContainText('out of scale');
  });

  test('should still show out-of-scale pitches when scale is locked (guardrail #1)', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');

    // Open scale sidebar and lock to C major
    const scaleSidebarToggle = page.locator('[data-testid="scale-sidebar-toggle"]');
    if (await scaleSidebarToggle.isVisible()) {
      await scaleSidebarToggle.click();
    }

    const scaleSidebar = page.locator('.scale-sidebar');
    await expect(scaleSidebar).toBeVisible({ timeout: 5000 });

    const rootSelect = page.locator('.scale-sidebar select').first();
    await rootSelect.selectOption('C');

    const scaleSelect = page.locator('.scale-sidebar select').nth(1);
    await scaleSelect.selectOption('major');

    const lockToggle = page.locator('.scale-lock-toggle');
    if (await lockToggle.isVisible()) {
      await lockToggle.click();
    }

    await expect(page.locator('.scale-sidebar--locked')).toBeVisible({ timeout: 2000 });

    // Expand chromatic grid
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    const chromaticGrid = page.locator('.chromatic-grid');
    await expect(chromaticGrid).toBeVisible({ timeout: 5000 });

    // Verify out-of-scale pitches +1 (C#) and +3 (D#) are still visible
    // This is guardrail #1: notes should never be hidden
    const pitch1Label = page.locator('.pitch-label .pitch-value', { hasText: '+1' });
    const pitch3Label = page.locator('.pitch-label .pitch-value', { hasText: '+3' });

    await expect(pitch1Label).toBeVisible();
    await expect(pitch3Label).toBeVisible();

    // Verify they have out-of-scale class
    const pitch1Row = page.locator('.pitch-label.out-of-scale .pitch-value', { hasText: '+1' });
    const pitch3Row = page.locator('.pitch-label.out-of-scale .pitch-value', { hasText: '+3' });

    await expect(pitch1Row).toBeVisible();
    await expect(pitch3Row).toBeVisible();
  });

  test('should apply scale-locked class to chromatic grid when scale is locked', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Chromatic grid expand toggle hidden on mobile');

    // Expand chromatic grid first
    const pitchToggle = page.locator('.expand-toggle').first();
    await pitchToggle.click();

    const chromaticGrid = page.locator('.chromatic-grid');
    await expect(chromaticGrid).toBeVisible({ timeout: 5000 });

    // Initially no scale-locked class
    await expect(chromaticGrid).not.toHaveClass(/scale-locked/);

    // Open scale sidebar and lock
    const scaleSidebarToggle = page.locator('[data-testid="scale-sidebar-toggle"]');
    if (await scaleSidebarToggle.isVisible()) {
      await scaleSidebarToggle.click();
    }

    const scaleSidebar = page.locator('.scale-sidebar');
    await expect(scaleSidebar).toBeVisible({ timeout: 5000 });

    const lockToggle = page.locator('.scale-lock-toggle');
    if (await lockToggle.isVisible()) {
      await lockToggle.click();
    }

    // Verify scale-locked class is now applied
    await expect(chromaticGrid).toHaveClass(/scale-locked/);
  });
});
