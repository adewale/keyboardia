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

  // Copy and Paste live in the editor dock's Track pane (a drum track docks
  // there from its name); Paste shows on another track's Track pane.
  const dock = page.getByTestId('editor-dock');
  const actions = dock.getByRole('group', { name: 'Track actions' });
  await page.locator('.track-row .track-name').first().click();
  await actions.getByRole('button', { name: 'Copy', exact: true }).click();
  await dock.getByRole('group', { name: 'Docked track' }).getByRole('button', { name: 'Kick 2', exact: true }).click();
  const paste = actions.getByRole('button', { name: 'Paste', exact: true });
  await expect(paste).toBeVisible();

  return {
    sessionButton: page.locator('.session-btn.publish-btn'),
    stepCell: page.locator('.step-cell').first(),
    paste,
  };
}

/** Shift+click an active step: its lock editor opens in the dock's Step pane. */
async function openStepPanel(page: Page) {
  const activeStep = page.locator('.step-cell').first();
  await expect(activeStep).toHaveClass(/active/);
  await activeStep.click({ modifiers: ['Shift'] });
  const panel = page.locator('.plock-inline');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('shared motion accessibility', () => {
  test('uses short interaction feedback on production controls in standard motion mode @blocking', async ({ page, request }) => {
    const { sessionButton, stepCell, paste } = await openProductionMotionStates(page, request);

    await expect(sessionButton).toHaveCSS('transition-duration', '0.09s');
    await expect(stepCell).toHaveCSS('transition-property', 'scale');
    await expect(stepCell).toHaveCSS('transition-duration', '0.09s');
    await expect(paste).toHaveCSS('animation-name', 'kb-paste-in');
    // The Step pane replaces the Track pane, so the panel is checked second.
    const panel = await openStepPanel(page);
    await expect(panel).toHaveCSS('animation-name', 'kb-panel-in');
  });

  test('removes production transitions and animations for reduced motion @blocking', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { sessionButton, stepCell, paste } = await openProductionMotionStates(page, request);

    await expect(sessionButton).toHaveCSS('transition-duration', '0s');
    await expect(stepCell).toHaveCSS('transition-duration', '0s');
    await expect(paste).toHaveCSS('animation-name', 'none');
    const panel = await openStepPanel(page);
    await expect(panel).toHaveCSS('animation-name', 'none');

    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('.orientation-hint')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.portrait-play-btn')).toHaveCSS('transition-duration', '0s');
  });
});
