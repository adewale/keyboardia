import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, getBaseUrl, waitForAppReady } from './global-setup';

async function openProductionMotionStates(page: Page, request: APIRequestContext) {
  const track = (id: string, name: string) => ({
    id, name, sampleId: 'kick',
    steps: [true, ...Array(127).fill(false)],
    parameterLocks: Array(128).fill(null),
    volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
  });
  const created = await request.post(`${getBaseUrl()}/api/sessions`, {
    data: { state: { tracks: [track('track-1', 'Kick'), track('track-2', 'Kick 2')], tempo: 120, swing: 0, version: 1 } },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/s/${id}`);
  await waitForAppReady(page);
  await expect(page.locator('.track-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Copy', exact: true }).first().click();
  const paste = page.getByRole('button', { name: 'Paste', exact: true }).first();
  await expect(paste).toBeVisible();

  const activeStep = page.locator('.step-cell').first();
  await expect(activeStep).toHaveClass(/active/);
  await activeStep.click({ modifiers: ['Shift'] });
  const panel = page.locator('.plock-inline');
  await expect(panel).toBeVisible();

  return {
    sessionButton: page.locator('.session-btn.publish-btn'),
    stepCell: page.locator('.step-cell').first(),
    panel,
    paste,
  };
}

test.describe('shared motion accessibility', () => {
  test('uses short interaction feedback on production controls in standard motion mode @blocking', async ({ page, request }) => {
    const { sessionButton, stepCell, panel, paste } = await openProductionMotionStates(page, request);

    await expect(sessionButton).toHaveCSS('transition-duration', '0.09s');
    await expect(stepCell).toHaveCSS('transition-property', 'scale');
    await expect(stepCell).toHaveCSS('transition-duration', '0.09s');
    await expect(panel).toHaveCSS('animation-name', 'kb-panel-in');
    await expect(paste).toHaveCSS('animation-name', 'kb-paste-in');
  });

  test('removes production transitions and animations for reduced motion @blocking', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { sessionButton, stepCell, panel, paste } = await openProductionMotionStates(page, request);

    await expect(sessionButton).toHaveCSS('transition-duration', '0s');
    await expect(stepCell).toHaveCSS('transition-duration', '0s');
    await expect(panel).toHaveCSS('animation-name', 'none');
    await expect(paste).toHaveCSS('animation-name', 'none');

    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('.orientation-hint')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.portrait-play-btn')).toHaveCSS('transition-duration', '0s');
  });
});
