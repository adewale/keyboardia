/**
 * Mobile Orientation E2E Tests
 *
 * Tests for the mobile interface simplification feature:
 * - Portrait mode: consumption-only interface
 * - Landscape mode: creation, with the editor dock as a bottom dock
 * - Orientation transitions: smooth and correct visibility
 *
 * Run with: npx playwright test e2e/mobile-orientation.spec.ts
 */

import { test, expect, waitForAppReady, Page } from './global-setup';
import { createPopulatedSessionWithRetry, createSessionWithRetry } from './test-utils';

// Device configurations
const PORTRAIT_VIEWPORT = { width: 375, height: 667 }; // iPhone SE portrait
const LANDSCAPE_VIEWPORT = { width: 667, height: 375 }; // iPhone SE landscape
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }; // Desktop

// Modern device landscape viewports (width > 768px, which broke the old CSS media queries)
const IPHONE_14_LANDSCAPE = { width: 844, height: 390 }; // iPhone 14
const IPHONE_15_PRO_MAX_LANDSCAPE = { width: 932, height: 430 }; // iPhone 15 Pro Max
const GALAXY_S24_LANDSCAPE = { width: 915, height: 412 }; // Samsung Galaxy S24

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

  test('should show portrait grid with abbreviated track labels', async ({ page, request }) => {
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    const grid = page.locator('.portrait-grid');
    await expect(grid).toBeVisible();

    const trackRows = grid.locator('.portrait-track-row');
    await expect(trackRows).toHaveCount(10);
    await expect(trackRows.first().locator('.portrait-track-label')).not.toBeEmpty();
    await expect(trackRows.first().locator('.portrait-step-cell').first()).toBeVisible();
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

  test('tap-anywhere-to-play-pause should toggle playback @blocking', async ({ page, request, browserName }) => {
    test.skip(browserName === 'webkit', 'Real audio playback is owned by Chromium; headless WebKit can wedge on AudioContext.resume()');
    // Use an owned populated session so browser hit-testing covers header,
    // track-label, and cell coordinates rather than only an empty grid.
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    await expect(page.locator('.portrait-track-row')).toHaveCount(10);
    const playBtn = page.locator('.portrait-play-btn');

    const tapAtCenter = async (selector: string) => {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, `${selector} should have a layout box`).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    };

    await expect(playBtn).not.toHaveClass(/playing/);

    // Exercise real browser hit-testing across representative parts of the
    // advertised surface rather than dispatching directly to the overlay.
    await tapAtCenter('.portrait-step-number');
    await expect(playBtn).toHaveClass(/playing/);

    await tapAtCenter('.portrait-track-label');
    await expect(playBtn).not.toHaveClass(/playing/);

    await tapAtCenter('.portrait-step-cell');
    await expect(playBtn).toHaveClass(/playing/);

    const indicator = await page.locator('.portrait-page-indicator').boundingBox();
    expect(indicator).not.toBeNull();
    await page.mouse.click(indicator!.x + 4, indicator!.y + indicator!.height / 2);
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

  test('partial portrait pages do not expose nonexistent steps @blocking', async ({ page, request }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    await expect(page.locator('.portrait-track-row')).toHaveCount(10);

    const finalPage = page.getByRole('button', { name: 'View steps 25-27' });
    await finalPage.click();
    await expect(page.locator('.portrait-step-number:not(.empty)')).toHaveText(['25', '26', '27']);
    await expect(page.locator('.portrait-track-row').first().locator('[data-step]')).toHaveCount(3);
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
  });

  test('tapping track name should open the dock on its Track pane with Copy/Clear/Delete', async ({ page }) => {
    // Add a track first since sessions start empty
    await addTrack(page);

    const trackName = page.locator('.track-name').first();
    await expect(trackName).toBeVisible();

    // Tap track name: the dock opens on the Track pane (after the 200ms click delay)
    await trackName.click();
    const dock = page.getByTestId('editor-dock');
    await expect(dock).toHaveClass(/\bopen\b/, { timeout: 3000 });
    await expect(dock).toHaveAttribute('data-pane', 'track');

    // The Track pane holds the actions the row has no room for
    const actions = dock.getByRole('group', { name: 'Track actions' });
    await expect(actions.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Clear' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Delete' })).toBeVisible();
    // No drawer and no panel opens under the row
    await expect(page.locator('.track-drawer, .instrument-panel-container')).toHaveCount(0);
  });

  test('landscape track name discloses the dock by keyboard and Escape restores focus @blocking', async ({ page }) => {
    await addTrack(page);

    const trigger = page.locator('.track-name').first();
    const dock = page.getByTestId('editor-dock');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // The dock is always in the document (inert while closed), so the name
    // can always point at it.
    await expect(trigger).toHaveAttribute('aria-controls', 'editor-dock');
    await trigger.focus();
    await trigger.press('Enter');

    await expect(dock).toHaveClass(/\bopen\b/, { timeout: 3000 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(dock).not.toHaveAttribute('inert', '');

    // Escape inside the dock closes it (a drum has no Notes pane to go back
    // to) and hands focus back to the row it was editing.
    await dock.getByRole('group', { name: 'Dock pane' }).getByRole('button', { name: 'Track', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(dock).not.toHaveClass(/\bopen\b/, { timeout: 3000 });
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
    await expect(dock).toHaveAttribute('inert', '');
  });

  test('landscape dock keeps the destructive action distinguishable without hover @blocking', async ({ page }) => {
    await addTrack(page);

    await page.locator('.track-name').first().click();
    const actions = page.getByTestId('editor-dock').getByRole('group', { name: 'Track actions' });
    await expect(actions).toBeVisible({ timeout: 3000 });

    // The dock is the touch surface here: neither :hover nor :focus-visible
    // ever fires there, so Delete must differ from its neighbours at rest.
    const deleteBtn = actions.getByRole('button', { name: 'Delete' });
    const clearBtn = actions.getByRole('button', { name: 'Clear' });
    const deleteBorder = await deleteBtn.evaluate((el) => getComputedStyle(el).borderTopColor);
    const clearBorder = await clearBtn.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(deleteBorder).not.toBe(clearBorder);
  });

  test('landscape dock uses non-overlapping 44px control targets @blocking', async ({ page }) => {
    await addTrack(page);

    await page.locator('.track-name').first().click();
    const dock = page.getByTestId('editor-dock');
    await expect(dock).toHaveClass(/\bopen\b/, { timeout: 3000 });

    type Box = { x: number; y: number; width: number; height: number };
    const overlaps = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5
      && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
    const measure = async (controls: ReturnType<Page['locator']>) => {
      const count = await controls.count();
      expect(count).toBeGreaterThan(0);
      const boxes: Box[] = [];
      for (let index = 0; index < count; index += 1) {
        const box = await controls.nth(index).boundingBox();
        expect(box, `control ${index} should have a layout box`).not.toBeNull();
        expect(box!.width, `control ${index} width`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `control ${index} height`).toBeGreaterThanOrEqual(44);
        boxes.push(box!);
      }
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          expect(overlaps(boxes[a], boxes[b]), `controls ${a} and ${b} should not overlap`).toBe(false);
        }
      }
      return boxes;
    };

    // The strip: pane chips and close, then the Track pane's controls, which
    // scroll sideways in their own lane between them.
    const head = await measure(dock.locator('.dock-pane-chips button, .dock-head-end button'));
    await measure(dock.locator('.dock-pane-track').locator('button:visible, select:visible'));
    const lane = await dock.locator('.dock-pane-track').boundingBox();
    expect(lane).not.toBeNull();
    for (const box of head) expect(overlaps(box, lane!)).toBe(false);
  });

  test('narrow landscape dock scrolls every control into view and disables reduced motion @blocking', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 480, height: 320 });
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);

    const trackName = page.locator('.track-name').first();
    await trackName.focus();
    await page.keyboard.press('Enter');
    const dock = page.getByTestId('editor-dock');
    await expect(dock).toHaveClass(/\bopen\b/);
    const lane = dock.locator('.dock-pane-track');

    const overflow = await lane.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflowX: style.overflowX,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(overflow.overflowX).toBe('auto');
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
    expect(await dock.evaluate(element => getComputedStyle(element).transitionDuration))
      .toMatch(/^0s(, 0s)*$/);

    await lane.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    const laneBox = await lane.boundingBox();
    const deleteBox = await lane.getByRole('button', { name: 'Delete' }).boundingBox();
    expect(laneBox).not.toBeNull();
    expect(deleteBox).not.toBeNull();
    expect(deleteBox!.x).toBeGreaterThanOrEqual(laneBox!.x);
    expect(deleteBox!.x + deleteBox!.width).toBeLessThanOrEqual(laneBox!.x + laneBox!.width + 1);
  });

  test('activating another track name moves the one dock to that track', async ({ page, request }) => {
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);

    const trackNames = page.locator('.track-name');
    await expect(trackNames).toHaveCount(10);
    const dock = page.getByTestId('editor-dock');

    // Keyboard activation avoids conflating dock ownership with
    // horizontal-grid hit testing (covered separately above).
    await trackNames.first().focus();
    await page.keyboard.press('Enter');
    await expect(dock.locator('.dock-title b')).toHaveText('Track 1', { timeout: 3000 });

    await trackNames.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(dock.locator('.dock-title b')).toHaveText('Track 2');
    await expect(dock).toHaveAttribute('data-pane', 'track');
    await expect(page.locator('.track-row-wrapper.docked')).toHaveCount(1);
    await expect(trackNames.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(trackNames.nth(1)).toHaveAttribute('aria-expanded', 'true');
  });

  test('tapping same track name again should close the dock', async ({ page }) => {
    // Add a track first since sessions start empty
    await addTrack(page);

    const trackName = page.locator('.track-name').first();
    const dock = page.getByTestId('editor-dock');

    // Open
    await trackName.click();
    await expect(dock).toHaveClass(/\bopen\b/, { timeout: 3000 });

    // Close by tapping the same name again
    await trackName.click();
    await expect(dock).not.toHaveClass(/\bopen\b/, { timeout: 3000 });
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
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

test.describe('Landscape editor dock', () => {
  /** A melodic track with notes across two pages, and a drum track. */
  function dockSession(request: Parameters<typeof createSessionWithRetry>[0]) {
    const track = (id: string, name: string, sampleId: string, active: number[]) => ({
      id,
      name,
      sampleId,
      steps: Array.from({ length: 128 }, (_, step) => active.includes(step)),
      parameterLocks: Array.from({ length: 128 }, (_, step) => (active.includes(step) ? { pitch: step % 7 } : null)),
      volume: 1,
      pan: 0,
      muted: false,
      transpose: 0,
      stepCount: 32,
    });
    return createSessionWithRetry(request, {
      tracks: [
        track('kick', 'Kick', 'kick', [0, 8, 16, 24]),
        track('lead', 'Lead', 'synth:lead', [0, 4, 8, 12, 20, 28]),
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });
  }

  const leadRow = (page: Page) => page.locator('.track-row-wrapper[data-track-id="lead"]');

  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    const { id } = await dockSession(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    await expect(page.locator('.track-row-wrapper')).toHaveCount(2);
  });

  test('the ♪ toggle opens a bottom dock about 45% of the viewport tall, inert while closed @blocking', async ({ page }) => {
    const dock = page.getByTestId('editor-dock');
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
    await expect(dock).toHaveAttribute('inert', '');
    for (let index = 0; index < 30; index += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[inert]') === null)).toBe(true);
    }

    const toggle = leadRow(page).locator('.expand-toggle');
    await toggle.click();
    await expect(dock).toHaveClass(/\bopen\b/);
    await expect(dock).not.toHaveAttribute('aria-hidden', 'true');
    await expect(dock).toHaveAttribute('data-pane', 'notes');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(leadRow(page)).toHaveClass(/\bdocked\b/);
    await expect(dock.locator('.piano-roll-editor')).toBeVisible();
    // One height in landscape: no detent toggle.
    await expect(dock.getByRole('button', { name: /^(Tall|Compact)$/ })).toHaveCount(0);

    // Pinned to the bottom of the viewport at about 45% of its height, over
    // the rows' scroller, with the same 134px keyboard column as the rows.
    await expect.poll(async () => {
      const box = await dock.boundingBox();
      return box ? Math.round(box.height) : 0;
    }).toBeGreaterThanOrEqual(Math.floor(LANDSCAPE_VIEWPORT.height * 0.45) - 2);
    const [dockBox, tracksBox, keys, column] = await Promise.all([
      dock.boundingBox(),
      page.locator('.tracks').boundingBox(),
      dock.locator('.piano-roll-editor__left').boundingBox(),
      leadRow(page).locator('.track-left').boundingBox(),
    ]);
    expect(Math.abs(dockBox!.y + dockBox!.height - LANDSCAPE_VIEWPORT.height)).toBeLessThanOrEqual(1);
    expect(dockBox!.height).toBeLessThanOrEqual(Math.ceil(LANDSCAPE_VIEWPORT.height * 0.45) + 2);
    expect(Math.abs(dockBox!.x - tracksBox!.x)).toBeLessThanOrEqual(1);
    expect(keys!.width).toBeCloseTo(134, 0);
    expect(Math.abs(keys!.x - column!.x)).toBeLessThanOrEqual(1);
    // The docked row is in view above the dock.
    await expect.poll(async () => {
      const row = await leadRow(page).boundingBox();
      return row ? row.y + row.height <= dockBox!.y + 1 && row.y >= 0 : false;
    }).toBe(true);

    await toggle.click();
    await expect(dock).not.toHaveClass(/\bopen\b/);
    await expect(dock).toHaveAttribute('inert', '');
  });

  test('the roll scrolls with the docked row in both directions, columns aligned @blocking', async ({ page }) => {
    await leadRow(page).locator('.expand-toggle').click();
    const dock = page.getByTestId('editor-dock');
    await expect(dock.locator('.piano-roll-editor')).toBeVisible();
    const steps = leadRow(page).locator('.steps');
    const body = dock.locator('.dock-body');

    const expectAligned = async (step: number) => {
      await expect.poll(async () => {
        const [cell, note] = await Promise.all([
          leadRow(page).locator('.step-cell').nth(step).boundingBox(),
          dock.locator(`.piano-roll-editor .note[data-start="${step}"]`).boundingBox(),
        ]);
        return cell && note ? Math.abs(cell.x - note.x) : Infinity;
      }).toBeLessThan(1);
    };

    await expectAligned(4);
    // The row leads: scrolling the row's cells scrolls the roll.
    await steps.evaluate(element => { element.scrollLeft = 100; });
    await expect.poll(() => body.evaluate(element => element.scrollLeft)).toBe(100);
    await expectAligned(12);
    // The roll leads: scrolling the roll scrolls the row.
    await body.evaluate(element => { element.scrollLeft = 40; });
    await expect.poll(() => steps.evaluate(element => element.scrollLeft)).toBe(40);
    await expectAligned(8);
    // The keyboard stays pinned to the left edge while the roll scrolls.
    const [keys, column] = await Promise.all([
      dock.locator('.piano-roll-editor__left').boundingBox(),
      leadRow(page).locator('.track-left').boundingBox(),
    ]);
    expect(Math.abs(keys!.x - column!.x)).toBeLessThanOrEqual(1);
  });

  test('the dock\'s Track pane edits the docked track', async ({ page }) => {
    await leadRow(page).locator('.track-name').click();
    const dock = page.getByTestId('editor-dock');
    await expect(dock).toHaveAttribute('data-pane', 'track', { timeout: 3000 });
    await expect(dock.locator('.dock-title b')).toHaveText('Lead');

    await dock.getByRole('button', { name: 'Rotate pattern right' }).click();
    await expect(leadRow(page).locator('.step-cell').nth(1)).toHaveClass(/\bactive\b/);
    await expect(leadRow(page).locator('.step-cell').nth(0)).not.toHaveClass(/\bactive\b/);
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

test.describe('Modern Device Landscape Compatibility', () => {
  // These devices have landscape widths > 768px, which previously caused
  // CSS media queries to miss them while JS correctly detected landscape mode.
  // The fix uses data-orientation attribute selectors driven by JS, ensuring
  // a single source of truth for orientation detection.

  const modernDevices = [
    { name: 'iPhone 14', viewport: IPHONE_14_LANDSCAPE },
    { name: 'iPhone 15 Pro Max', viewport: IPHONE_15_PRO_MAX_LANDSCAPE },
    { name: 'Samsung Galaxy S24', viewport: GALAXY_S24_LANDSCAPE },
  ];

  for (const device of modernDevices) {
    test(`${device.name} landscape should show landscape UI, not desktop`, async ({ page }) => {
      await page.setViewportSize(device.viewport);
      await page.goto('/');
      await waitForAppReady(page);

      // JS should detect landscape mode via data-orientation attribute
      await expect(page.locator('[data-orientation="landscape"]')).toBeVisible();

      // Transport should be visible (landscape editing mode)
      await expect(page.locator('.transport')).toBeVisible();

      // Portrait UI should be hidden
      await expect(page.locator('.portrait-header')).not.toBeVisible();
      await expect(page.locator('.portrait-grid')).not.toBeVisible();

      // Complex transport elements should be hidden (landscape simplification)
      await expect(page.locator('.scale-selector')).not.toBeVisible();
      await expect(page.locator('.transport-control-group')).not.toBeVisible();
    });

    test(`${device.name} landscape should show compact track layout`, async ({ page }) => {
      await page.setViewportSize(device.viewport);
      await page.goto('/');
      await waitForAppReady(page);

      // Add a track
      await addTrack(page);

      const trackRow = page.locator('.track-row').first();
      await expect(trackRow).toBeVisible();

      // M/S buttons should be visible (landscape compact layout)
      await expect(trackRow.locator('.mute-button')).toBeVisible();
      await expect(trackRow.locator('.solo-button')).toBeVisible();

      // Track name should be visible
      await expect(trackRow.locator('.track-name')).toBeVisible();

      // Step grid should show many cells (not old mobile 5-6)
      const stepCount = await trackRow.locator('.step-cell').count();
      expect(stepCount).toBeGreaterThanOrEqual(10);
    });
  }
});

test.describe('Accessibility', () => {
  test('portrait header should have proper ARIA labels', async ({ page }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    const header = page.locator('.portrait-header');
    await expect(header).toHaveAttribute('role', 'banner');

    const playBtn = header.locator('.portrait-play-btn');
    await expect(playBtn).toHaveAttribute('aria-label', /Play|Stop/);

    const bpm = header.locator('.portrait-bpm');
    await expect(bpm).toHaveAttribute('aria-label', /Tempo/);
  });

  test('portrait grid exposes accessible playback and 44px page controls @blocking', async ({ page }) => {
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    const grid = page.locator('.portrait-grid');
    await expect(grid).not.toHaveAttribute('role', 'button');
    await expect(grid).not.toHaveAttribute('tabindex', '0');

    const pageDots = page.locator('.portrait-page-dot');
    await expect(pageDots).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const box = await pageDots.nth(index).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(pageDots.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(pageDots.last()).toHaveAttribute('aria-pressed', 'false');

    // The tap-to-play affordance is a full-bleed accessible button layered
    // above presentational content. Page controls remain independently usable.
    await pageDots.last().click();
    await expect(pageDots.last()).toHaveAttribute('aria-pressed', 'true');
    await expect(pageDots.first()).toHaveAttribute('aria-pressed', 'false');

    const tapLayer = page.locator('.portrait-grid-tap-layer');
    await expect(tapLayer).toHaveAttribute('aria-label', 'Play');
    await expect(tapLayer).not.toHaveAttribute('aria-hidden', 'true');
    await expect(tapLayer).not.toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('button', { name: /^(Play|Stop)$/ })).toHaveCount(2);

    const dismissHint = page.getByRole('button', { name: 'Dismiss orientation hint' });
    await expect(dismissHint).toBeVisible();
    const dismissBox = await dismissHint.boundingBox();
    expect(dismissBox?.width).toBeGreaterThanOrEqual(44);
    expect(dismissBox?.height).toBeGreaterThanOrEqual(44);
  });

  test('collapsed track panels are inert during sequential keyboard navigation @blocking', async ({ page, request }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    await expect(page.locator('.track-row')).toHaveCount(10);

    const collapsedPanels = page.locator('.panel-animation-container:not(.expanded)');
    expect(await collapsedPanels.count()).toBeGreaterThan(0);
    for (let index = 0; index < await collapsedPanels.count(); index += 1) {
      await expect(collapsedPanels.nth(index)).toHaveAttribute('aria-hidden', 'true');
      await expect(collapsedPanels.nth(index)).toHaveAttribute('inert', '');
    }

    for (let index = 0; index < 60; index += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[inert]') === null)).toBe(true);
    }
  });

  test('should respect prefers-reduced-motion @blocking', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);

    // Check that animations are disabled via CSS
    // Note: This test verifies the CSS media query is respected
    const hint = page.locator('.orientation-hint').first();
    const animation = await hint.evaluate(el =>
      window.getComputedStyle(el).animationName
    );
    expect(animation).toBe('none');
  });
});

test.describe('Performance', () => {
  test('playback should maintain smooth animation', async ({ page, request, browserName }) => {
    test.skip(browserName === 'webkit', 'Real audio playback is owned by Chromium; headless WebKit can wedge on AudioContext.resume()');
    await page.setViewportSize(PORTRAIT_VIEWPORT);
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    await expect(page.locator('.portrait-track-row')).toHaveCount(10);

    await page.locator('.portrait-grid-tap-layer').click();

    const playingCell = page.locator('.portrait-step-cell.playing').first();
    await expect(playingCell).toBeVisible();
    const hasGPUHint = await playingCell.evaluate(el =>
      window.getComputedStyle(el).willChange !== 'auto'
    );
    expect(hasGPUHint).toBe(true);

    await page.locator('.portrait-grid-tap-layer').click();
    await expect(page.locator('.portrait-play-btn')).not.toHaveClass(/playing/);
  });
});
