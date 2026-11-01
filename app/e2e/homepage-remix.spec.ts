import { readFileSync } from 'node:fs';
import { expect, getBaseUrl, test, useMockAPI } from './global-setup';

interface LocalExampleSessionFixture {
  id: string;
  name: string;
  state: {
    tempo: number;
    tracks: Array<{ steps: boolean[]; parameterLocks: Array<unknown> }>;
  };
}

const fixtures = JSON.parse(
  readFileSync(new URL('../src/data/__fixtures__/homepage-example-sessions.json', import.meta.url), 'utf8'),
) as LocalExampleSessionFixture[];
const source = fixtures[0];

test.describe('homepage remix', () => {
  test.skip(!useMockAPI, 'This contract targets dedicated local example fixtures');

  test('remixes a dedicated local fixture and opens its editable copy @blocking', async ({ page, request }) => {
    const base = getBaseUrl();
    const sourceResponse = await request.get(`${base}/api/sessions/${source.id}`);
    expect(sourceResponse.ok()).toBe(true);
    const storedSource = await sourceResponse.json() as LocalExampleSessionFixture;
    expect(storedSource.state.tracks.length).toBe(source.state.tracks.length);
    for (const track of storedSource.state.tracks) {
      expect(track.steps).toHaveLength(128);
      expect(track.parameterLocks).toHaveLength(128);
    }

    let releaseRemix!: () => void;
    const remixGate = new Promise<void>(resolve => { releaseRemix = resolve; });
    await page.route(`**/api/sessions/${source.id}/remix`, async route => {
      await remixGate;
      await route.continue();
    });
    await page.goto(base);

    const remixResponsePromise = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && response.url().endsWith(`/api/sessions/${source.id}/remix`),
    );
    const remixButton = page.getByRole('button', { name: `Remix ${source.name}` });
    await remixButton.click();
    await expect(remixButton).toHaveAttribute('aria-busy', 'true');
    await expect(remixButton).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Remix / }).nth(1)).toBeDisabled();
    releaseRemix();

    const remixResponse = await remixResponsePromise;
    expect(remixResponse.status()).toBe(201);
    const remixed = await remixResponse.json() as { id: string; remixedFrom: string };
    expect(remixed.remixedFrom).toBe(source.id);

    await expect(page).toHaveURL(`${base}/s/${remixed.id}`);
    await expect(page.locator('.track-row')).toHaveCount(source.state.tracks.length);
    await expect(page.locator('.app-header h1')).toBeFocused();

    const storedResponse = await request.get(`${base}/api/sessions/${remixed.id}`);
    expect(storedResponse.ok()).toBe(true);
    expect(await storedResponse.json()).toMatchObject({
      id: remixed.id,
      immutable: false,
      remixedFrom: source.id,
      remixedFromName: source.name,
      state: {
        tempo: source.state.tempo,
      },
    });
  });

  test('shows a recoverable error when the local fixture cannot be remixed @blocking', async ({ page }) => {
    const base = getBaseUrl();
    await page.route(`**/api/sessions/${source.id}/remix`, route => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Session not found' }),
    }));
    await page.goto(base);

    const remixButton = page.getByRole('button', { name: `Remix ${source.name}` });
    await remixButton.click();

    await expect(page.getByRole('alert')).toHaveText(
      `Could not remix “${source.name}”. Please try again.`,
    );
    await expect(remixButton).toBeEnabled();
    await expect(page).toHaveURL(`${base}/`);
  });

  test('keeps clipped example actions out of mobile keyboard navigation @blocking', async ({ page }) => {
    const base = getBaseUrl();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);

    const cards = page.locator('.landing-example-card');
    await expect(cards.nth(0)).toHaveAttribute('aria-hidden', 'false');
    await expect(cards.nth(0)).not.toHaveAttribute('inert');
    await expect(cards.nth(1)).toHaveAttribute('aria-hidden', 'true');
    await expect(cards.nth(1)).toHaveAttribute('inert', '');
    await expect(page.getByRole('link', { name: `Open ${source.name}` })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Remix / })).toHaveCount(1);

    const remixButton = page.getByRole('button', { name: `Remix ${source.name}` });
    await remixButton.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Next examples' })).toBeFocused();

    await page.getByRole('button', { name: 'Next examples' }).click();
    await expect(cards.nth(0)).toHaveAttribute('aria-hidden', 'true');
    await expect(cards.nth(1)).toHaveAttribute('aria-hidden', 'false');
    await expect(page.getByRole('button', { name: 'Previous examples' })).toBeEnabled();
  });
});
