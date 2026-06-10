/**
 * Mixer Panel Layout Tests
 *
 * Verifies that VU meters and other mixer channel elements are properly
 * contained within their channel boundaries and scroll correctly.
 *
 * Bug: .track-meter has height: 100% which causes it to overflow
 * the mixer channel, pushing the fader and volume controls outside
 * the channel's visible bounds.
 */

import { test as base, expect, type Page } from '@playwright/test';

const test = base;

/**
 * Navigate to the app, create a session, and add tracks.
 */
async function setupSession(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const startButton = page.locator(
    '.landing-btn.primary, button:has-text("Start Session"), button:has-text("Start"), button:has-text("Create")'
  ).first();
  const isLanding = await startButton.isVisible({ timeout: 3000 }).catch(() => false);

  if (isLanding) {
    await startButton.click();
    await page.waitForURL(/\/s\//, { timeout: 15000 });
  }

  // Wait for app to be ready — sample picker should be visible at bottom
  await page.locator('.sample-picker, .track-row, .app').first().waitFor({
    state: 'visible',
    timeout: 15000,
  });

  // Wait for WebSocket connection (best-effort in mock mode)
  await page.locator('.connection-status--connected').waitFor({
    state: 'visible',
    timeout: 10000,
  }).catch(() => { /* mock mode may not have WS */ });

  // Add first track via sample picker
  const kickBtn = page.locator('button:has-text("808 Kick"), button:has-text("Kick")').first();
  if (await kickBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await kickBtn.click();
    await page.locator('.track-row').first().waitFor({ state: 'visible', timeout: 5000 });
  }

  // Add second track
  const snareBtn = page.locator('button:has-text("808 Snare"), button:has-text("Snare")').first();
  if (await snareBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await snareBtn.click();
    await expect(page.locator('.track-row')).toHaveCount(2, { timeout: 5000 });
  }
}

test.describe('Mixer Panel Layout', () => {
  test('VU meter stays within mixer channel bounds', async ({ page }) => {
    await setupSession(page);

    // Open the mixer panel
    const mixerBtn = page.locator('.mixer-btn, button:has-text("Mixer")').first();
    await expect(mixerBtn).toBeVisible({ timeout: 5000 });
    await mixerBtn.click();
    await expect(page.locator('.mixer-panel-container.expanded')).toBeVisible({ timeout: 5000 });

    // Check that all channel children stay within the channel bounds
    const layoutCheck = await page.evaluate(() => {
      const channels = document.querySelectorAll('.mixer-channel');
      const results: Array<{
        channelIndex: number;
        channelHeight: number;
        overflowingChildren: Array<{ class: string; height: number; bottom: number; channelBottom: number }>;
      }> = [];

      channels.forEach((channel, i) => {
        const channelRect = channel.getBoundingClientRect();
        const overflowing: Array<{ class: string; height: number; bottom: number; channelBottom: number }> = [];

        Array.from(channel.children).forEach(child => {
          const childRect = child.getBoundingClientRect();
          // Allow 1px tolerance for rounding
          if (childRect.bottom > channelRect.bottom + 1) {
            overflowing.push({
              class: child.className,
              height: Math.round(childRect.height),
              bottom: Math.round(childRect.bottom),
              channelBottom: Math.round(channelRect.bottom),
            });
          }
        });

        results.push({
          channelIndex: i,
          channelHeight: Math.round(channelRect.height),
          overflowingChildren: overflowing,
        });
      });

      return results;
    });

    // No channel should have overflowing children
    for (const channel of layoutCheck) {
      expect(
        channel.overflowingChildren,
        `Channel ${channel.channelIndex} has children overflowing: ${JSON.stringify(channel.overflowingChildren)}`
      ).toHaveLength(0);
    }
  });

  test('fader has non-zero height in each channel', async ({ page }) => {
    await setupSession(page);

    await page.locator('.mixer-btn, button:has-text("Mixer")').first().click();
    await expect(page.locator('.mixer-panel-container.expanded')).toBeVisible({ timeout: 5000 });

    // Each fader container should have its designed height (120px)
    const faderHeights = await page.evaluate(() => {
      const faders = document.querySelectorAll('.channel-fader-container');
      return Array.from(faders).map(f => Math.round(f.getBoundingClientRect().height));
    });

    expect(faderHeights.length).toBeGreaterThanOrEqual(1);
    for (const height of faderHeights) {
      expect(height, 'Fader should have its designed height (not collapsed to 0)').toBeGreaterThanOrEqual(100);
    }
  });

  test('mixer channel elements scroll together with page', async ({ page }) => {
    await setupSession(page);

    await page.locator('.mixer-btn, button:has-text("Mixer")').first().click();
    await expect(page.locator('.mixer-panel-container.expanded')).toBeVisible({ timeout: 5000 });

    // Verify we have at least one channel
    await expect(page.locator('.mixer-channel').first()).toBeVisible({ timeout: 5000 });

    // Get initial positions of channel elements
    const initialPositions = await page.evaluate(() => {
      const channel = document.querySelector('.mixer-channel');
      const mixerPanel = document.querySelector('.mixer-panel');
      if (!channel || !mixerPanel) return null;

      // Get first track-meter if exists, otherwise use channel name
      const meterOrName = document.querySelector('.track-meter') || document.querySelector('.channel-name');
      const fader = document.querySelector('.channel-fader-container');

      return {
        channelTop: channel.getBoundingClientRect().top,
        panelTop: mixerPanel.getBoundingClientRect().top,
        innerTop: meterOrName ? meterOrName.getBoundingClientRect().top : null,
        faderTop: fader ? fader.getBoundingClientRect().top : null,
      };
    });

    expect(initialPositions).not.toBeNull();

    // Scroll the page
    await page.evaluate(() => window.scrollBy(0, 150));
    await page.waitForTimeout(100);

    const afterPositions = await page.evaluate(() => {
      const channel = document.querySelector('.mixer-channel');
      const mixerPanel = document.querySelector('.mixer-panel');
      if (!channel || !mixerPanel) return null;

      const meterOrName = document.querySelector('.track-meter') || document.querySelector('.channel-name');
      const fader = document.querySelector('.channel-fader-container');

      return {
        channelTop: channel.getBoundingClientRect().top,
        panelTop: mixerPanel.getBoundingClientRect().top,
        innerTop: meterOrName ? meterOrName.getBoundingClientRect().top : null,
        faderTop: fader ? fader.getBoundingClientRect().top : null,
      };
    });

    expect(afterPositions).not.toBeNull();

    // All elements should have moved by the same amount (within 2px tolerance)
    const panelDelta = afterPositions!.panelTop - initialPositions!.panelTop;
    const channelDelta = afterPositions!.channelTop - initialPositions!.channelTop;
    expect(Math.abs(channelDelta - panelDelta)).toBeLessThan(2);

    if (initialPositions!.innerTop !== null && afterPositions!.innerTop !== null) {
      const innerDelta = afterPositions!.innerTop - initialPositions!.innerTop;
      expect(Math.abs(innerDelta - panelDelta)).toBeLessThan(2);
    }

    if (initialPositions!.faderTop !== null && afterPositions!.faderTop !== null) {
      const faderDelta = afterPositions!.faderTop - initialPositions!.faderTop;
      expect(Math.abs(faderDelta - panelDelta)).toBeLessThan(2);
    }
  });
});
