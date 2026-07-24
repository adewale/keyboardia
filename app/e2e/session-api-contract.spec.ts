/**
 * Black-box session API contract.
 *
 * This exact journey runs against whichever backend Playwright starts:
 * Vite's offline backend in normal CI, or the real Worker in a full-stack run.
 * The test never reaches into either implementation's storage.
 */
import { test, expect, getBaseUrl } from './global-setup';

const API_BASE = getBaseUrl();

function state(tempo: number, activeSteps: number[] = []) {
  const steps = Array(128).fill(false);
  for (const step of activeSteps) steps[step] = true;
  return {
    tracks: [{
      id: 'contract-track',
      name: 'Contract Track',
      sampleId: 'sampled:808-kick',
      steps,
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: 16,
    }],
    tempo,
    swing: 12,
    version: 1,
  };
}

test('create, read, replace, rename, remix, and publish share one HTTP contract', async ({ request }) => {
  const create = await request.post(`${API_BASE}/api/sessions`, {
    data: { name: 'Working Copy', state: state(120, [0]) },
  });
  expect(create.status()).toBe(201);
  const created = await create.json() as { id: string; url: string };
  expect(created.url).toBe(`/s/${created.id}`);

  const initial = await request.get(`${API_BASE}/api/sessions/${created.id}`);
  expect(initial.status()).toBe(200);
  await expect(initial.json()).resolves.toMatchObject({
    id: created.id,
    name: 'Working Copy',
    immutable: false,
    remixedFrom: null,
    state: {
      tempo: 120,
      tracks: [{ id: 'contract-track' }],
    },
  });

  const replace = await request.put(`${API_BASE}/api/sessions/${created.id}`, {
    data: { state: state(132, [0, 4]) },
  });
  expect(replace.status()).toBe(200);
  await expect(replace.json()).resolves.toMatchObject({
    id: created.id,
    trackCount: 1,
  });

  const rename = await request.patch(`${API_BASE}/api/sessions/${created.id}`, {
    data: { name: 'Renamed Working Copy' },
  });
  expect(rename.status()).toBe(200);
  await expect(rename.json()).resolves.toMatchObject({
    id: created.id,
    name: 'Renamed Working Copy',
  });

  const updated = await request.get(`${API_BASE}/api/sessions/${created.id}`);
  await expect(updated.json()).resolves.toMatchObject({
    name: 'Renamed Working Copy',
    state: {
      tempo: 132,
      tracks: [{
        steps: expect.arrayContaining([true]),
      }],
    },
  });

  const remix = await request.post(`${API_BASE}/api/sessions/${created.id}/remix`);
  expect(remix.status()).toBe(201);
  const remixed = await remix.json() as { id: string; remixedFrom: string; url: string };
  expect(remixed).toMatchObject({
    remixedFrom: created.id,
    url: `/s/${remixed.id}`,
  });
  const remixedSession = await request.get(`${API_BASE}/api/sessions/${remixed.id}`);
  await expect(remixedSession.json()).resolves.toMatchObject({
    id: remixed.id,
    immutable: false,
    remixedFrom: created.id,
    state: { tempo: 132 },
  });

  const publish = await request.post(`${API_BASE}/api/sessions/${created.id}/publish`);
  expect(publish.status()).toBe(201);
  const published = await publish.json() as {
    id: string;
    immutable: boolean;
    sourceId: string;
    url: string;
  };
  expect(published).toMatchObject({
    immutable: true,
    sourceId: created.id,
    url: `/s/${published.id}`,
  });

  const publishedSession = await request.get(`${API_BASE}/api/sessions/${published.id}`);
  await expect(publishedSession.json()).resolves.toMatchObject({
    id: published.id,
    immutable: true,
    remixedFrom: created.id,
    state: { tempo: 132 },
  });

  const forbidden = await request.put(`${API_BASE}/api/sessions/${published.id}`, {
    data: { state: state(140) },
  });
  expect(forbidden.status()).toBe(403);

  const sourceStillEditable = await request.patch(`${API_BASE}/api/sessions/${created.id}`, {
    data: { name: 'Still Editable' },
  });
  expect(sourceStillEditable.status()).toBe(200);
});
