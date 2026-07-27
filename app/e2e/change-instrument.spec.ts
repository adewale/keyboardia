import { test, expect, getBaseUrl } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * Change Instrument (issue #63) in a real browser.
 *
 * The shared operation, the broadcast contract, and the MCP path are pinned at
 * narrower seams (src/shared/track-instrument.test.ts,
 * test/integration/collaboration-contract.test.ts, and
 * test/integration/mcp-journeys.test.ts). What only a browser can prove is that
 * a person can reach the control, that the picker commits a catalog ID, and
 * that the row they were working on survives the swap intact.
 *
 * See specs/CHANGE-INSTRUMENT.md.
 */

function sessionState() {
  const steps = Array(64).fill(false);
  steps[0] = true;
  steps[6] = true;

  return {
    tracks: [
      {
        id: 'instrument-track',
        name: 'Ada Lead',
        sampleId: 'kick',
        steps,
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'bystander-track',
        name: 'Bystander',
        sampleId: 'snare',
        steps: Array(64).fill(false),
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
  };
}

test.describe('Change instrument', () => {
  test('replaces a track sound while keeping its pattern, name, and position @blocking', async ({ page, request }) => {
    const { id } = await createSessionWithRetry(request, sessionState());
    await page.goto(`${API_BASE}/s/${id}`);
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });

    const toggle = page.getByTestId('change-instrument-instrument-track');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // The picker is generated from the canonical catalog — the same catalog
    // that fills Add Track and the MCP instrument enum.
    const picker = page.locator('#instrument-panel-instrument-track .sample-picker');
    await expect(picker.getByText('Change Instrument')).toBeVisible();
    await expect(picker.getByTestId('set-instrument-kick'))
      .toHaveAttribute('aria-current', 'true');

    const row = page.locator('.track-row-wrapper').first();
    await expect(row.locator('.step-cell.active')).toHaveCount(2);

    await picker.getByTestId('set-instrument-sampled:808-kick').click();

    // Committing closes the picker so the result is visible.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // The custom name survives: this is instrument replacement, not renaming.
    await expect(row.locator('.track-name')).toHaveText('Ada Lead');
    // The pattern survives.
    await expect(row.locator('.step-cell.active')).toHaveCount(2);
    // The track keeps its place in the list.
    await expect(page.locator('.track-row-wrapper').nth(1).locator('.track-name'))
      .toHaveText('Bystander');

    // Re-opening reflects the new instrument, which is what a person checks
    // when they want to know what a track is playing now.
    await toggle.click();
    await expect(picker.getByTestId('set-instrument-sampled:808-kick'))
      .toHaveAttribute('aria-current', 'true');
    await expect(picker.getByTestId('set-instrument-kick'))
      .not.toHaveAttribute('aria-current', 'true');
  });

  test('offers no instrument control on a published session @blocking', async ({ page, request }) => {
    const { id } = await createSessionWithRetry(request, sessionState());
    const publishResponse = await request.post(`${API_BASE}/api/sessions/${id}/publish`);
    expect(publishResponse.status()).toBe(201);
    const published = await publishResponse.json();

    await page.goto(`${API_BASE}/s/${published.id}`);
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });

    // A published session can only be listened to, so the control is absent
    // rather than present-and-disabled.
    await expect(page.getByTestId('change-instrument-instrument-track')).toHaveCount(0);
    await expect(page.locator('.instrument-panel-container')).toHaveCount(0);
  });
});
