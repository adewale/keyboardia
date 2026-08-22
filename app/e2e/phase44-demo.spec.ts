import { expect, test, useMockAPI } from './global-setup';

const DEMO_ID = 'b7e0b220-3185-49ef-b9b0-15ab9df76aec';

test.skip(!useMockAPI, 'The Phase 44 demo is a deterministic local mock-API fixture');

test('Whisper to Roar is served at its documented session route', async ({ page, request }) => {
  const response = await request.get(`/api/sessions/${DEMO_ID}`);
  expect(response.ok()).toBe(true);
  const session = await response.json() as {
    id: string;
    name: string;
    state: { tracks: unknown[]; effects?: { reverb: { wet: number } } };
  };
  expect(session.id).toBe(DEMO_ID);
  expect(session.name).toBe('Whisper to Roar');
  expect(session.state.tracks).toHaveLength(7);
  expect(session.state.effects?.reverb.wet).toBe(0.15);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/s/${DEMO_ID}`);
  await expect(page.locator('.track-row')).toHaveCount(7, { timeout: 15_000 });
  await expect(page.locator('.session-name')).toHaveText('Whisper to Roar');
});
