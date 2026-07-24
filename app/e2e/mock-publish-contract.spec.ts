import { test, expect, getBaseUrl, useMockAPI } from './global-setup';

test.describe('mock publish contract', () => {
  test.skip(!useMockAPI, 'This contract targets the local mock API');

  test('loads the seeded Holby example with ten tracks', async ({ page }) => {
    const base = getBaseUrl();
    await page.goto(`${base}/s/8444f694-0a9a-41f3-815d-b9c6eb518c50`);

    await expect(page.locator('.track-row')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.getByText('Holby', { exact: true })).toBeVisible();
  });

  test('preserves named extended session state when publishing', async ({ request }) => {
    const base = getBaseUrl();
    const state = {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
      effects: {
        bypass: false,
        reverb: { decay: 2, wet: 0 },
        delay: { time: '8n', feedback: 0.3, wet: 0 },
        chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
        distortion: { amount: 0.4, wet: 0 },
      },
      scale: { root: 'C', scaleId: 'minor-pentatonic', locked: false },
    };

    const createdResponse = await request.post(`${base}/api/sessions`, {
      data: { name: 'Replayable example', state },
    });
    expect(createdResponse.ok()).toBe(true);
    const created = await createdResponse.json();

    const publishedResponse = await request.post(`${base}/api/sessions/${created.id}/publish`);
    expect(publishedResponse.ok()).toBe(true);
    const published = await publishedResponse.json();

    expect(published).toMatchObject({
      name: 'Replayable example',
      immutable: true,
      state,
    });
  });
});
