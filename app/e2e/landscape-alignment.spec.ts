/**
 * Landscape Mobile Alignment E2E Tests
 *
 * The landscape row carries the desktop's two-line control block
 * (specs/PIANO-ROLL-DOCK.md, Mobile): the same 134px column, line one
 * identical to desktop, and a 28px controls line holding M, S and the pitch
 * toggle, so the row is 48px. These tests measure that geometry, its
 * alignment with the step cells, and the name's shared left edge.
 *
 * Run with: npx playwright test e2e/landscape-alignment.spec.ts
 */

import { test, expect, waitForAppReady, useMockAPI, Page } from './global-setup';

// Mobile landscape viewports
const LANDSCAPE_VIEWPORT = { width: 667, height: 375 }; // iPhone SE landscape

// Modern device landscape viewports (width > 768px)
const IPHONE_14_LANDSCAPE = { width: 844, height: 390 }; // iPhone 14
const IPHONE_15_PRO_MAX_LANDSCAPE = { width: 932, height: 430 }; // iPhone 15 Pro Max
const GALAXY_S24_LANDSCAPE = { width: 915, height: 412 }; // Samsung Galaxy S24

/**
 * Helper to add a track by clicking a sample button
 */
async function addTrack(page: Page, instrumentName: RegExp = /808 Kick/) {
  // The offline Vite backend has no WebSocket. Full-stack runs wait for the
  // authoritative snapshot so a late LOAD_STATE cannot overwrite the edit.
  if (!useMockAPI) {
    await page.locator('.connection-status--connected').waitFor({
      state: 'visible',
      timeout: 10000
    });
  }

  // Click the instrument button by name
  const sampleBtn = page.getByRole('button', { name: instrumentName }).first();
  await expect(sampleBtn).toBeVisible({ timeout: 5000 });
  await sampleBtn.click();

  // Wait for track row to appear
  await page.locator('.track-row').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200); // Small delay for DOM to settle
}

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const COLUMN_WIDTH = 134;
const TOLERANCE = 2;

type Box = { x: number; y: number; width: number; height: number };

const centreY = (box: Box) => box.y + box.height / 2;

async function boxOf(locator: ReturnType<Page['locator']>): Promise<Box> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element has no layout box');
  return box;
}

/** The name's left edge measured from the control column's left edge. */
async function nameOffset(page: Page): Promise<{ column: Box; offset: number }> {
  const row = page.locator('.track-row').first();
  const column = await boxOf(row.locator('.track-left'));
  const name = await boxOf(row.locator('.track-name'));
  return { column, offset: name.x - column.x };
}

test.describe('Landscape Mobile Alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('the landscape control column is the 134px two-line block', async ({ page }) => {
    await addTrack(page);

    await expect(page.locator('.step-sequencer')).toHaveAttribute('data-orientation', 'landscape');
    const row = page.locator('.track-row').first();
    const column = await boxOf(row.locator('.track-left'));
    const name = await boxOf(row.locator('.track-name'));
    const mute = await boxOf(row.locator('.mute-button'));
    const solo = await boxOf(row.locator('.solo-button'));
    const cell = await boxOf(row.locator('.step-cell').first());

    expect(column.width).toBeCloseTo(COLUMN_WIDTH, 0);
    expect(column.height).toBeCloseTo(48, 0);
    // Line one above line two.
    expect(name.y + name.height).toBeLessThanOrEqual(mute.y + 0.5);
    // The block sits centred on the step cells, so rows still tessellate.
    expect(Math.abs(centreY(column) - centreY(cell))).toBeLessThanOrEqual(TOLERANCE);
    // M and S share the controls line.
    expect(Math.abs(centreY(mute) - centreY(solo))).toBeLessThanOrEqual(TOLERANCE);

    // Badge and lane toggle are hidden in landscape.
    await expect(row.locator('.track-instrument-badge')).toBeHidden();
    await expect(row.locator('.velocity-toggle')).toBeHidden();
  });

  test('all track rows should have consistent vertical alignment', async ({ page }) => {
    await addTrack(page, /808 Kick/);
    await addTrack(page, /808 Snare/);
    await addTrack(page, /808 Clap/);

    const trackRows = page.locator('.track-row');
    await expect(trackRows).toHaveCount(3, { timeout: 5000 });

    const nameEdges: number[] = [];
    for (let i = 0; i < 3; i++) {
      const trackRow = trackRows.nth(i);
      const column = await boxOf(trackRow.locator('.track-left'));
      const cell = await boxOf(trackRow.locator('.step-cell').first());
      const name = await boxOf(trackRow.locator('.track-name'));
      expect(Math.abs(centreY(column) - centreY(cell))).toBeLessThanOrEqual(TOLERANCE);
      nameEdges.push(name.x);
    }
    expect(Math.max(...nameEdges) - Math.min(...nameEdges)).toBeLessThanOrEqual(0.5);
  });

  test('M/S buttons are 28px-tall touch targets on the controls line', async ({ page }) => {
    await addTrack(page);

    const trackRow = page.locator('.track-row').first();
    for (const selector of ['.mute-button', '.solo-button']) {
      const box = await boxOf(trackRow.locator(selector));
      expect(box.height).toBeCloseTo(28, 0);
      expect(box.width).toBeCloseTo(32, 0);
    }
  });
});

test.describe('Desktop and landscape share the control block', () => {
  test('the name sits on the same left edge of a 134px column on both', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);
    await addTrack(page);

    await expect(page.locator('.step-sequencer')).toHaveAttribute('data-orientation', 'desktop');
    const desktop = await nameOffset(page);

    await page.setViewportSize(IPHONE_14_LANDSCAPE);
    await expect(page.locator('.step-sequencer')).toHaveAttribute('data-orientation', 'landscape');
    const landscape = await nameOffset(page);

    expect(desktop.column.width).toBeCloseTo(COLUMN_WIDTH, 0);
    expect(landscape.column.width).toBeCloseTo(COLUMN_WIDTH, 0);
    expect(Math.abs(desktop.offset - landscape.offset)).toBeLessThanOrEqual(0.5);
  });
});

test.describe('Modern Device Landscape Alignment', () => {
  // These devices have landscape widths > 768px. Previously CSS media queries
  // missed them, causing misalignment. Now we use data-orientation selectors.

  const modernDevices = [
    { name: 'iPhone 14', viewport: IPHONE_14_LANDSCAPE },
    { name: 'iPhone 15 Pro Max', viewport: IPHONE_15_PRO_MAX_LANDSCAPE },
    { name: 'Samsung Galaxy S24', viewport: GALAXY_S24_LANDSCAPE },
  ];

  for (const device of modernDevices) {
    test(`${device.name}: the control block is 134px and centred on the step grid`, async ({ page }) => {
      await page.setViewportSize(device.viewport);
      await page.goto('/');
      await waitForAppReady(page);
      await addTrack(page);

      const trackRow = page.locator('.track-row').first();
      const column = await boxOf(trackRow.locator('.track-left'));
      const mute = await boxOf(trackRow.locator('.mute-button'));
      const solo = await boxOf(trackRow.locator('.solo-button'));
      const cell = await boxOf(trackRow.locator('.step-cell').first());

      expect(column.width).toBeCloseTo(COLUMN_WIDTH, 0);
      expect(Math.abs(centreY(mute) - centreY(solo))).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(centreY(column) - centreY(cell))).toBeLessThanOrEqual(TOLERANCE);
    });
  }
});
