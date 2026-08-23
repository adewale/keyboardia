import { test, expect, getBaseUrl, useMockAPI, waitForAppReady } from './global-setup';
import { NEW_SESSION_EFFECTS_STATE } from '../src/shared/effects-defaults';

test.describe('mock publish contract', () => {
  test.skip(!useMockAPI, 'This contract targets the local mock API');

  test('loads the seeded Holby example with ten tracks @blocking', async ({ page, request }) => {
    const base = getBaseUrl();
    const sessionUrl = `${base}/api/sessions/8444f694-0a9a-41f3-815d-b9c6eb518c50`;
    const readStartedAt = Date.now();
    const sessionResponse = await request.get(sessionUrl);
    expect(sessionResponse.ok()).toBe(true);
    expect((await sessionResponse.json()).lastAccessedAt).toBeGreaterThanOrEqual(readStartedAt);

    await page.goto(`${base}/s/8444f694-0a9a-41f3-815d-b9c6eb518c50`);
    await expect(page.locator('.track-row')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.getByText('Holby', { exact: true })).toBeVisible();
    await expect(page.locator('.orphan-banner')).toHaveCount(0);
  });

  test('applies production defaults and rejects production-invalid input @blocking', async ({ request }) => {
    const base = getBaseUrl();
    const createdResponse = await request.post(`${base}/api/sessions`);
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();
    const stored = await request.get(`${base}/api/sessions/${created.id}`).then(response => response.json());
    expect(stored.state).toEqual({
      tracks: [],
      tempo: 120,
      swing: 0,
      effects: NEW_SESSION_EFFECTS_STATE,
      scale: { root: 'C', scaleId: 'minor-pentatonic', locked: true },
      version: 1,
    });

    const invalidCases = [
      { state: { tracks: [], tempo: 500, swing: 0, version: 1 } },
      { state: { tracks: [], tempo: 120, swing: 0, scale: { root: 'H', scaleId: 'major', locked: false }, version: 1 } },
      { name: '<script>alert(1)</script>', state: { tracks: [], tempo: 120, swing: 0, version: 1 } },
    ];
    for (const data of invalidCases) {
      const response = await request.post(`${base}/api/sessions`, { data });
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'Validation failed' });
    }

    const invalidPut = await request.put(`${base}/api/sessions/${created.id}`, {
      data: { state: { tracks: [], tempo: 500, swing: 0, version: 1 } },
    });
    expect(invalidPut.status()).toBe(400);

    const oversized = await request.post(`${base}/api/sessions`, {
      data: { padding: 'x'.repeat(70_000) },
    });
    expect(oversized.status()).toBe(413);
  });

  test('preserves named extended session state when publishing @blocking', async ({ request }) => {
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
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();

    const publishedResponse = await request.post(`${base}/api/sessions/${created.id}/publish`);
    expect(publishedResponse.status()).toBe(201);
    const published = await publishedResponse.json();

    expect(published).toEqual({
      id: expect.any(String),
      immutable: true,
      url: `/s/${published.id}`,
      sourceId: created.id,
    });

    const storedResponse = await request.get(`${base}/api/sessions/${published.id}`);
    expect(storedResponse.ok()).toBe(true);
    expect(await storedResponse.json()).toMatchObject({
      id: published.id,
      name: 'Replayable example',
      immutable: true,
      remixedFrom: created.id,
      state,
    });

    const patchResponse = await request.patch(`${base}/api/sessions/${published.id}`, {
      data: { name: 'Mutated' },
    });
    expect(patchResponse.status()).toBe(403);

    const putResponse = await request.put(`${base}/api/sessions/${published.id}`, {
      data: { state: { ...state, tempo: 99 } },
    });
    expect(putResponse.status()).toBe(403);

    const republishResponse = await request.post(`${base}/api/sessions/${published.id}/publish`);
    expect(republishResponse.status()).toBe(400);
  });

  test('replays and REST-persists effects and scale through the client @blocking', async ({ page, request }) => {
    const base = getBaseUrl();
    const state = {
      tracks: [],
      tempo: 123,
      swing: 4,
      version: 1,
      effects: {
        bypass: false,
        reverb: { decay: 2.4, wet: 0.2 },
        delay: { time: '8n', feedback: 0.3, wet: 0.1 },
        chorus: { frequency: 1.5, depth: 0.5, wet: 0.25 },
        distortion: { amount: 0.4, wet: 0.05 },
      },
      scale: { root: 'D', scaleId: 'natural-minor', locked: true },
    };
    const createdResponse = await request.post(`${base}/api/sessions`, {
      data: { name: 'Extended state', state },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();

    await page.goto(`${base}/s/${created.id}`);
    await waitForAppReady(page);
    await expect(page.getByLabel('Root note')).toHaveValue('D');
    await expect(page.getByLabel('Scale type')).toHaveValue('natural-minor');
    await expect(page.getByRole('button', { name: 'Constrain notes to selected scale' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Open effects panel' }).click();
    await expect(page.locator('#transport-reverb-mix')).toHaveValue('0.2');

    await page.getByLabel('Root note').selectOption('E');
    await page.locator('#transport-reverb-mix').fill('0.35');

    await expect.poll(async () => {
      const response = await request.get(`${base}/api/sessions/${created.id}`);
      return (await response.json()).state;
    }, { timeout: 12_000 }).toMatchObject({
      effects: { reverb: { wet: 0.35 } },
      scale: { root: 'E', scaleId: 'natural-minor', locked: true },
    });

    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByLabel('Root note')).toHaveValue('E');
    await page.getByRole('button', { name: 'Open effects panel' }).click();
    await expect(page.locator('#transport-reverb-mix')).toHaveValue('0.35');
  });

  test('publishes the latest edit made while a transition flush is in flight @blocking', async ({ page, request }) => {
    const base = getBaseUrl();
    const createdResponse = await request.post(`${base}/api/sessions`, {
      data: { state: { tracks: [], tempo: 120, swing: 0, version: 1 } },
    });
    const created = await createdResponse.json();

    let releaseFirstPut!: () => void;
    const firstPutGate = new Promise<void>(resolve => { releaseFirstPut = resolve; });
    let markFirstPutSeen!: () => void;
    const firstPutSeen = new Promise<void>(resolve => { markFirstPutSeen = resolve; });
    let heldFirstPut = false;
    await page.route(`**/api/sessions/${created.id}`, async route => {
      if (route.request().method() === 'PUT' && !heldFirstPut) {
        heldFirstPut = true;
        markFirstPutSeen();
        await firstPutGate;
      }
      await route.continue();
    });

    await page.goto(`${base}/s/${created.id}`);
    await waitForAppReady(page);
    await page.locator('#tempo').fill('121');

    const publishResponsePromise = page.waitForResponse(
      response => response.url().endsWith(`/api/sessions/${created.id}/publish`) && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Publish' }).click();
    await firstPutSeen;
    await expect(page.getByRole('button', { name: 'Publishing...' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Remix' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'New' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Invite/ })).toBeDisabled();

    // This rerender happens after Publish captured its original callback but
    // before its first flush returns.
    await page.locator('#tempo').fill('122');
    releaseFirstPut();

    const publishResponse = await publishResponsePromise;
    expect(publishResponse.status()).toBe(201);
    const published = await publishResponse.json();
    await expect.poll(async () => {
      const [source, snapshot] = await Promise.all([
        request.get(`${base}/api/sessions/${created.id}`).then(response => response.json()),
        request.get(`${base}/api/sessions/${published.id}`).then(response => response.json()),
      ]);
      return [source.state.tempo, snapshot.state.tempo];
    }).toEqual([122, 122]);
  });

  test('flushes pending state before exposing a share link @blocking', async ({ page, request }) => {
    const base = getBaseUrl();
    const createdResponse = await request.post(`${base}/api/sessions`, {
      data: { state: { tracks: [], tempo: 120, swing: 0, version: 1 } },
    });
    const created = await createdResponse.json();
    await page.goto(`${base}/s/${created.id}`);
    await waitForAppReady(page);

    await page.locator('#tempo').fill('124');
    await page.getByRole('button', { name: /Invite/ }).click();
    await page.getByRole('button', { name: 'Copy Link' }).click();

    await expect.poll(async () => {
      const stored = await request.get(`${base}/api/sessions/${created.id}`).then(response => response.json());
      return stored.state.tempo;
    }).toBe(124);
  });

  test('preserves remix lineage and increments the source count @blocking', async ({ request }) => {
    const base = getBaseUrl();
    const createdResponse = await request.post(`${base}/api/sessions`, {
      data: { name: 'Source', state: { tracks: [], tempo: 115, swing: 2, version: 1 } },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();

    const remixResponse = await request.post(`${base}/api/sessions/${created.id}/remix`);
    expect(remixResponse.status()).toBe(201);
    const remix = await remixResponse.json();
    expect(remix).toEqual({
      id: expect.any(String),
      remixedFrom: created.id,
      url: `/s/${remix.id}`,
    });

    const [storedRemix, updatedSource] = await Promise.all([
      request.get(`${base}/api/sessions/${remix.id}`).then(response => response.json()),
      request.get(`${base}/api/sessions/${created.id}`).then(response => response.json()),
    ]);
    expect(storedRemix).toMatchObject({
      id: remix.id,
      name: null,
      immutable: false,
      remixedFrom: created.id,
      remixedFromName: 'Source',
      state: { tracks: [], tempo: 115, swing: 2, version: 1 },
    });
    expect(updatedSource.remixCount).toBe(1);
  });
});
