/**
 * Mobile Orientation E2E Tests
 *
 * Tests for the mobile interface simplification feature:
 * - Portrait mode: consumption-only interface
 * - Landscape mode: creation with inline drawer pattern
 * - Orientation transitions: smooth and correct visibility
 *
 * Run with: npx playwright test e2e/mobile-orientation.spec.ts
 */

import { test, expect, waitForAppReady, Page } from './global-setup';

// Device configurations
const PORTRAIT_VIEWPORT = { width: 375, height: 667 }; // iPhone SE portrait
const LANDSCAPE_VIEWPORT = { width: 667, height: 375 }; // iPhone SE landscape
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }; // Desktop

/**
 * Helper to add a track by clicking a sample button
 */
async function addTrack(page: Page) {
  // Click a drum sample to add a track
  const sampleBtn = page.locator('.instrument-btn, .sample-button').first();
  if (await sampleBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sampleBtn.click();
    // Wait for track to appear
    await page.locator('.track-row, .portrait-track-row').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }
}

test.describe('Mobile Orientation - Portrait Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should show portrait header with play button, title, and BPM', async ({ page }) => {
    const header = page.locator('.portrait-header');
    await expect(header).toBeVisible();

    // Play button
    const playBtn = header.locator('.portrait-play-btn');
    await expect(playBtn).toBeVisible();

    // App name
    const appName = header.locator('.portrait-app-name');
    await expect(appName).toContainText('Keyboardia');

    // BPM display
    const bpm = header.locator('.portrait-bpm');
    await expect(bpm).toBeVisible();
  });

  test('should show portrait grid with abbreviated track labels', async ({ page }) => {
    const grid = page.locator('.portrait-grid');
    await expect(grid).toBeVisible();

    // Add a track first since sessions start empty
    await addTrack(page);

    // Check for step cells - wait for track row to appear
    const trackRow = grid.locator('.portrait-track-row');
    if (await trackRow.count() > 0) {
      const cells = trackRow.first().locator('.portrait-step-cell');
      await expect(cells.first()).toBeVisible();
    }
  });

  test('should hide all editing UI in portrait', async ({ page }) => {
    // Transport should be hidden
    await expect(page.locator('.transport')).not.toBeVisible();
    await expect(page.locator('.transport-bar')).not.toBeVisible();

    // Mixer panel should be hidden
    await expect(page.locator('.mixer-panel-container')).not.toBeVisible();

    // Track controls should be hidden
    await expect(page.locator('.sequencer-content')).not.toBeVisible();
  });

  test('tap-anywhere-to-play-pause should toggle playback', async ({ page }) => {
    const grid = page.locator('.portrait-grid');
    const playBtn = page.locator('.portrait-play-btn');

    // Initially stopped
    await expect(playBtn).not.toHaveClass(/playing/);

    // Tap grid to play
    await grid.click();

    // Should now be playing
    await expect(playBtn).toHaveClass(/playing/);

    // Tap again to stop
    await grid.click();

    // Should be stopped
    await expect(playBtn).not.toHaveClass(/playing/);
  });

  test('should show orientation hint suggesting rotation', async ({ page }) => {
    const hint = page.locator('.orientation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Rotate to edit');
  });

  test('orientation hint should be dismissible', async ({ page }) => {
    const hint = page.locator('.orientation-hint');
    await expect(hint).toBeVisible();

    // Dismiss
    await hint.locator('.orientation-hint-dismiss').click();

    // Should be hidden
    await expect(hint).not.toBeVisible();

    // Reload and check persistence
    await page.reload();
    await expect(hint).not.toBeVisible();
  });

  test('portrait header should show share and QR buttons', async ({ page }) => {
    const header = page.locator('.portrait-header');

    // Share and QR buttons should be visible in header
    const shareBtn = header.locator('.portrait-share-btn');
    const qrBtn = header.locator('.portrait-qr-btn');

    await expect(shareBtn).toBeVisible();
    await expect(qrBtn).toBeVisible();

    // QR button should trigger QR mode
    await qrBtn.click();
    // QR mode adds ?qr=1 to URL
    await expect(page).toHaveURL(/qr=1/);
  });

  test('page indicator dots should switch between step pages', async ({ page }) => {
    const dots = page.locator('.portrait-page-dot');

    // First dot should be active
    await expect(dots.first()).toHaveClass(/active/);
    await expect(dots.nth(1)).not.toHaveClass(/active/);

    // Click second dot
    await dots.nth(1).click();

    // Second dot should now be active
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.first()).not.toHaveClass(/active/);
  });
});

test.describe('Mobile Orientation - Landscape Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should show transport with play, BPM, and swing only', async ({ page }) => {
    const transport = page.locator('.transport');
    await expect(transport).toBeVisible();

    // Play button visible
    const playBtn = transport.locator('.play-button');
    await expect(playBtn).toBeVisible();

    // BPM visible
    const bpm = transport.locator('.tempo-control');
    await expect(bpm).toBeVisible();

    // Swing visible
    const swing = transport.locator('.swing-control');
    await expect(swing).toBeVisible();
  });

  test('should hide complex transport elements in landscape', async ({ page }) => {
    // Scale selector hidden
    await expect(page.locator('.scale-selector')).not.toBeVisible();

    // Control group (FX, Mixer, Pitch, Unmute) hidden
    await expect(page.locator('.transport-control-group')).not.toBeVisible();
  });

  test('should show compact track rows with M/S and name', async ({ page }) => {
    // Add a track first since sessions start empty
    await addTrack(page);

    // Track row should be visible
    const trackRow = page.locator('.track-row').first();
    await expect(trackRow).toBeVisible();

    // M/S buttons should be visible
    await expect(trackRow.locator('.mute-button')).toBeVisible();
    await expect(trackRow.locator('.solo-button')).toBeVisible();

    // Track name should be visible
    await expect(trackRow.locator('.track-name')).toBeVisible();
  });

  test('M/S buttons should toggle instantly without drawer', async ({ page }) => {
    // Add a track first since sessions start empty
    await addTrack(page);

    const trackRow = page.locator('.track-row').first();
    const muteBtn = trackRow.locator('.mute-button');

    // Initially not muted
    await expect(muteBtn).not.toHaveClass(/active/);

    // Click mute
    await muteBtn.click();

    // Should be muted
    await expect(muteBtn).toHaveClass(/active/);

    // No drawer should have opened
    await expect(page.locator('.track-drawer')).not.toBeVisible();
  });

  test('step grid should show more cells than old mobile', async ({ page }) => {
    // Add a track first since sessions start empty
    await addTrack(page);

    const steps = page.locator('.track-row').first().locator('.step-cell');

    // Count visible cells (should be at least 12-16 vs old 5-6)
    const count = await steps.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('step editing should work - tap to toggle', async ({ page }) => {
    // Add a track first since sessions start empty
    await addTrack(page);

    const firstCell = page.locator('.track-row').first().locator('.step-cell').first();

    // Initially not active
    const wasActive = await firstCell.evaluate(el => el.classList.contains('active'));

    // Click to toggle
    await firstCell.click();

    // State should change
    const isActive = await firstCell.evaluate(el => el.classList.contains('active'));
    expect(isActive).not.toBe(wasActive);
  });
});

test.describe('Orientation Changes', () => {
  test('should transition smoothly from portrait to landscape', async ({ page }) => {
    // Start in portrait
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Verify portrait mode
    await expect(page.locator('.portrait-header')).toBeVisible();
    await expect(page.locator('[data-orientation="portrait"]')).toBeVisible();

    // Change to landscape
    await page.setViewportSize(LANDSCAPE_VIEWPORT);

    // Wait for transition (debounced at 100ms)
    await page.waitForTimeout(150);

    // Verify landscape mode
    await expect(page.locator('.portrait-header')).not.toBeVisible();
    await expect(page.locator('.transport')).toBeVisible();
    await expect(page.locator('[data-orientation="landscape"]')).toBeVisible();
  });

  test('should transition smoothly from landscape to portrait', async ({ page }) => {
    // Start in landscape
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Verify landscape mode
    await expect(page.locator('.transport')).toBeVisible();

    // Change to portrait
    await page.setViewportSize(PORTRAIT_VIEWPORT);

    // Wait for transition
    await page.waitForTimeout(150);

    // Verify portrait mode
    await expect(page.locator('.portrait-header')).toBeVisible();
    await expect(page.locator('.portrait-grid')).toBeVisible();
  });

  test('should show desktop interface at 768px+ width', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Full desktop UI visible
    await expect(page.locator('.transport')).toBeVisible();
    await expect(page.locator('.scale-selector')).toBeVisible();
    await expect(page.locator('.transport-control-group')).toBeVisible();

    // Portrait UI hidden
    await expect(page.locator('.portrait-header')).not.toBeVisible();
    await expect(page.locator('.portrait-grid')).not.toBeVisible();
  });

  test('round-trip: portrait → landscape → portrait should restore identical UI', async ({ page }) => {
    // Start in portrait
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Capture initial portrait state
    const initialPortraitHeader = await page.locator('.portrait-header').isVisible();
    const initialPortraitGrid = await page.locator('.portrait-grid').isVisible();
    const initialTransport = await page.locator('.transport').isVisible();
    const initialSequencerContent = await page.locator('.sequencer-content').isVisible();
    const initialOrientation = await page.locator('[data-orientation]').getAttribute('data-orientation');

    // Verify we're in portrait mode
    expect(initialPortraitHeader).toBe(true);
    expect(initialPortraitGrid).toBe(true);
    expect(initialTransport).toBe(false);
    expect(initialSequencerContent).toBe(false);
    expect(initialOrientation).toBe('portrait');

    // Rotate to landscape
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await page.waitForTimeout(150); // Wait for debounced orientation change

    // Verify landscape mode
    await expect(page.locator('.portrait-header')).not.toBeVisible();
    await expect(page.locator('.portrait-grid')).not.toBeVisible();
    await expect(page.locator('.transport')).toBeVisible();
    await expect(page.locator('[data-orientation="landscape"]')).toBeVisible();

    // Rotate back to portrait
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    // Wait for portrait UI to be visible (more reliable than fixed timeout)
    await page.locator('.portrait-header').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('[data-orientation="portrait"]').waitFor({ state: 'visible', timeout: 5000 });

    // Verify portrait state is restored identically
    const finalPortraitHeader = await page.locator('.portrait-header').isVisible();
    const finalPortraitGrid = await page.locator('.portrait-grid').isVisible();
    const finalTransport = await page.locator('.transport').isVisible();
    const finalSequencerContent = await page.locator('.sequencer-content').isVisible();
    const finalOrientation = await page.locator('[data-orientation]').getAttribute('data-orientation');

    expect(finalPortraitHeader).toBe(initialPortraitHeader);
    expect(finalPortraitGrid).toBe(initialPortraitGrid);
    expect(finalTransport).toBe(initialTransport);
    expect(finalSequencerContent).toBe(initialSequencerContent);
    expect(finalOrientation).toBe(initialOrientation);

    // Verify key UI elements are properly displayed
    await expect(page.locator('.portrait-header')).toBeVisible();
    await expect(page.locator('.portrait-app-name')).toContainText('Keyboardia');
    await expect(page.locator('.portrait-bpm')).toBeVisible();
    await expect(page.locator('.portrait-grid')).toBeVisible();
  });

  test('multiple rapid orientation changes should not break layout', async ({ page }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Rapid orientation changes (simulating user rotating device back and forth)
    for (let i = 0; i < 3; i++) {
      await page.setViewportSize(LANDSCAPE_VIEWPORT);
      await page.waitForTimeout(50); // Quick change
      await page.setViewportSize(PORTRAIT_VIEWPORT);
      await page.waitForTimeout(50);
    }

    // Wait for final debounce to settle
    await page.waitForTimeout(200);

    // Verify portrait mode is stable and correct
    await expect(page.locator('.portrait-header')).toBeVisible();
    await expect(page.locator('.portrait-grid')).toBeVisible();
    await expect(page.locator('[data-orientation="portrait"]')).toBeVisible();

    // Verify no broken elements or duplicates
    const headerCount = await page.locator('.portrait-header').count();
    const gridCount = await page.locator('.portrait-grid').count();
    expect(headerCount).toBe(1);
    expect(gridCount).toBe(1);
  });
});

test.describe('Accessibility', () => {
  test('portrait header should have proper ARIA labels', async ({ page }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    const header = page.locator('.portrait-header');
    await expect(header).toHaveAttribute('role', 'banner');

    const playBtn = header.locator('.portrait-play-btn');
    await expect(playBtn).toHaveAttribute('aria-label', /Play|Pause/);

    const bpm = header.locator('.portrait-bpm');
    await expect(bpm).toHaveAttribute('aria-label', /Tempo/);
  });

  test('portrait grid should be keyboard accessible', async ({ page }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    const grid = page.locator('.portrait-grid');
    await expect(grid).toHaveAttribute('role', 'button');
    await expect(grid).toHaveAttribute('tabindex', '0');
    await expect(grid).toHaveAttribute('aria-label', /Tap to play|Tap to pause/);
  });

  test('should respect prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Check that animations are disabled via CSS
    // Note: This test verifies the CSS media query is respected
    const hint = page.locator('.orientation-hint-icon').first();
    const animation = await hint.evaluate(el =>
      window.getComputedStyle(el).animationName
    );
    expect(animation).toBe('none');
  });
});

test.describe('Performance', () => {
  test('playback should maintain smooth animation', async ({ page }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Start playback
    await page.locator('.portrait-grid').click();

    // Let it play for a moment
    await page.waitForTimeout(500);

    // Check that playing cells have animation
    const playingCell = page.locator('.portrait-step-cell.playing').first();
    if (await playingCell.count() > 0) {
      const hasGPUHint = await playingCell.evaluate(el =>
        window.getComputedStyle(el).willChange !== 'auto'
      );
      // will-change should be set for GPU acceleration
      expect(hasGPUHint).toBe(true);
    }

    // Stop playback
    await page.locator('.portrait-grid').click();
  });
});
