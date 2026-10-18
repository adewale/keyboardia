import { test, expect, getBaseUrl, useMockAPI, type Page } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * P-lock (parameter lock) editor tests
 *
 * Shift+click on an active step opens the editor dock's Step pane for that
 * step (specs/PIANO-ROLL-DOCK.md, phase 6). The ParameterLockEditor renders in
 * the dock's toolbar, not in a strip between rows. Uses Playwright best
 * practices with proper waits.
 *
 * The Step pane leaves when:
 * 1. Escape is pressed (back to Notes; a drum track, which has no Notes,
 *    closes the dock)
 * 2. The same step is Shift+clicked again (toggle)
 * 3. The Notes chip is clicked
 * and it switches when a different step is Shift+clicked. It no longer
 * closes on a click elsewhere.
 */

/**
 * Create a test session with one track and some active steps
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  // Don't pre-activate step 0 - tests will activate it via click
  // Only pre-activate steps 4 and 8 for tests that need multiple steps
  const steps = Array(128).fill(false);
  steps[4] = true;
  steps[8] = true;

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps,
        parameterLocks: Array(128).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'test-track-2',
        name: 'Lead',
        sampleId: 'synth:lead',
        steps,
        parameterLocks: Array(128).fill(null),
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

test.describe('P-lock editor', () => {
  test.beforeEach(async ({ page, request }) => {
    // Create a session via API and navigate to it
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');

    // Wait for the grid to load
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Real-backend runs verify the WebSocket path. Mock mode still exercises
    // deterministic local grid/focus behavior without claiming multiplayer.
    if (!useMockAPI) {
      await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });
    }

    // Wait for the tracks to appear
    await expect(page.locator('.track-row')).toHaveCount(2, { timeout: 5000 });
  });

  const dock = (page: Page) => page.getByTestId('editor-dock');
  const plockEditor = (page: Page) => dock(page).locator('.plock-inline');
  const paneChip = (page: Page, name: string) => dock(page)
    .getByRole('group', { name: 'Dock pane' })
    .getByRole('button', { name, exact: true });
  const leadStep = (page: Page, index: number) => page.locator('.track-row').nth(1).locator('.step-cell').nth(index);

  test('should open the Step pane on Shift+click of an active step', async ({ page }) => {
    // Get the first step cell and activate it
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Verify step is now active
    await expect(firstStep).toHaveClass(/active/);

    // Shift+click to open the dock's Step pane
    await firstStep.click({ modifiers: ['Shift'] });

    await expect(dock(page)).toHaveClass(/\bopen\b/);
    await expect(dock(page)).toHaveAttribute('data-pane', 'step');
    await expect(paneChip(page, 'Step')).toHaveAttribute('aria-pressed', 'true');
    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });

    // It names the step and the track; the cell keeps its selection ring.
    await expect(plockEditor(page).locator('.plock-step')).toContainText('Step 1');
    await expect(dock(page).locator('.dock-title')).toContainText('Kick');
    await expect(dock(page).locator('.dock-title')).toContainText('step 1');
    await expect(firstStep).toHaveClass(/selected/);

    // No strip opens between the rows.
    await expect(page.locator('.track-row-wrapper .plock-inline')).toHaveCount(0);
  });

  test('stays open on a click elsewhere; Escape leaves it', async ({ page }) => {
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();
    await firstStep.click({ modifiers: ['Shift'] });
    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });

    // The strip closed on an outside click; the Step pane is a pane, not a popover.
    await page.locator('.app-header').click();
    await expect(plockEditor(page)).toBeVisible();

    // Escape with focus in the pane leaves it. A drum track has no Notes,
    // so the dock closes.
    await plockEditor(page).locator('.plock-slider.pitch').focus();
    await page.keyboard.press('Escape');
    await expect(plockEditor(page)).not.toBeVisible({ timeout: 2000 });
    await expect(dock(page)).not.toHaveClass(/\bopen\b/);
  });

  test('Escape on the grid leaves the Step pane', async ({ page }) => {
    const step = leadStep(page, 4);
    await step.click({ modifiers: ['Shift'] });
    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });
    await step.focus();

    await page.keyboard.press('Escape');
    // A melodic track goes back to Notes, the dock stays open.
    await expect(plockEditor(page)).not.toBeVisible({ timeout: 2000 });
    await expect(dock(page)).toHaveClass(/\bopen\b/);
    await expect(dock(page)).toHaveAttribute('data-pane', 'notes');
    await expect(step).not.toHaveClass(/selected/);
  });

  test('Escape inside the dock steps back to Notes, then closes', async ({ page }) => {
    await leadStep(page, 4).click({ modifiers: ['Shift'] });
    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });
    await plockEditor(page).locator('.plock-slider.volume').focus();

    await page.keyboard.press('Escape');
    await expect(dock(page)).toHaveAttribute('data-pane', 'notes');
    // Focus stays in the dock, on the pane now showing.
    await expect(paneChip(page, 'Notes')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dock(page)).not.toHaveClass(/\bopen\b/);
  });

  test('should close p-lock editor when clicking same step again', async ({ page }) => {
    // Activate a step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Open p-lock editor
    await firstStep.click({ modifiers: ['Shift'] });
    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });

    // Shift+click same step again to toggle closed
    await firstStep.click({ modifiers: ['Shift'] });

    // Verify p-lock editor is hidden
    await expect(plockEditor(page)).not.toBeVisible({ timeout: 2000 });
    await expect(firstStep).not.toHaveClass(/selected/);
  });

  test('should switch p-lock editor to different step on Shift+click', async ({ page }) => {
    // Activate first two steps
    const firstStep = page.locator('.step-cell').first();
    const secondStep = page.locator('.step-cell').nth(1);

    await firstStep.click();
    await secondStep.click();

    // Open p-lock editor on first step
    await firstStep.click({ modifiers: ['Shift'] });
    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });
    await expect(plockEditor(page).locator('.plock-step')).toContainText('Step 1');

    // Shift+click second step - should switch to it
    await secondStep.click({ modifiers: ['Shift'] });

    // Editor should still be visible but showing step 2
    await expect(plockEditor(page)).toBeVisible();
    await expect(plockEditor(page).locator('.plock-step')).toContainText('Step 2');
    await expect(secondStep).toHaveClass(/selected/);
    await expect(firstStep).not.toHaveClass(/selected/);
  });

  test('a step on another track switches the dock to that track', async ({ page }) => {
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();
    await firstStep.click({ modifiers: ['Shift'] });
    await expect(dock(page).locator('.dock-title b')).toHaveText('Kick');

    await leadStep(page, 8).click({ modifiers: ['Shift'] });
    await expect(dock(page).locator('.dock-title b')).toHaveText('Lead');
    await expect(plockEditor(page).locator('.plock-step')).toContainText('Step 9');
    await expect(page.locator('.track-row-wrapper.docked')).toHaveCount(1);
    // The roll highlights the selected column.
    await expect(dock(page).locator('.piano-roll-editor .sel-col')).toBeVisible();
  });

  test('clear action is named and restores focus to the invoking step @blocking', async ({ page }) => {
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();
    await firstStep.click({ modifiers: ['Shift'] });

    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });

    await plockEditor(page).locator('.plock-slider.pitch').fill('5');
    const clearButton = page.getByRole('button', { name: 'Clear lock' });
    await expect(clearButton).toBeVisible();
    await clearButton.focus();
    await expect(clearButton).toBeFocused();

    await clearButton.click();
    await expect(plockEditor(page)).not.toBeVisible({ timeout: 2000 });
    await expect(firstStep).toBeFocused();
  });

  test('the Notes chip leaves the Step pane without stealing focus back to the step @blocking', async ({ page }) => {
    const step = leadStep(page, 4);
    await step.click({ modifiers: ['Shift'] });

    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });
    await plockEditor(page).locator('.plock-slider.pitch').focus();

    await paneChip(page, 'Notes').click();

    await expect(plockEditor(page)).not.toBeVisible({ timeout: 2000 });
    await expect(dock(page)).toHaveAttribute('data-pane', 'notes');
    // Safari intentionally does not focus buttons on pointer click, so the
    // cross-browser invariant is that focus is not stolen back to the step.
    await expect(step).not.toBeFocused();
  });

  // NOTE: "tooltip should show pitch and volume values on hover" test was removed.
  // Covered by unit tests in src/components/StepCell.test.tsx:
  // - SC-T01 through SC-T10: Tooltip content generation tests
  // - Verifies Step number, Pitch, Volume, and edit instructions are in tooltip

  test('p-lock changes should persist and show in tooltip', async ({ page }) => {
    // Activate a step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Open p-lock editor
    await firstStep.click({ modifiers: ['Shift'] });
    await expect(plockEditor(page)).toBeVisible({ timeout: 2000 });

    // Change pitch to +5
    const pitchSlider = plockEditor(page).locator('.plock-slider.pitch');
    await pitchSlider.fill('5');

    // Change volume to 50%
    const volumeSlider = plockEditor(page).locator('.plock-slider.volume');
    await volumeSlider.fill('50');

    // Leave the Step pane
    await volumeSlider.focus();
    await page.keyboard.press('Escape');
    await expect(plockEditor(page)).not.toBeVisible({ timeout: 2000 });

    // Verify tooltip shows the new values
    const title = await firstStep.getAttribute('title');
    expect(title).toContain('+5');
    expect(title).toContain('50%');
  });
});
