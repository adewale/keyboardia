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

function activeStepIndices(steps: boolean[]): number[] {
  return steps.flatMap((active, index) => active ? [index] : []);
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
  expect(updated.status()).toBe(200);
  const updatedSession = await updated.json() as {
    name: string | null;
    state: { tempo: number; tracks: Array<{ steps: boolean[] }> };
  };
  expect(updatedSession).toMatchObject({
    name: 'Renamed Working Copy',
    state: {
      tempo: 132,
    },
  });
  expect(activeStepIndices(updatedSession.state.tracks[0].steps)).toEqual([0, 4]);

  const remix = await request.post(`${API_BASE}/api/sessions/${created.id}/remix?contract=query`);
  expect(remix.status()).toBe(201);
  const remixed = await remix.json() as { id: string; remixedFrom: string; url: string };
  expect(remixed).toMatchObject({
    remixedFrom: created.id,
    url: `/s/${remixed.id}`,
  });
  const remixedResponse = await request.get(`${API_BASE}/api/sessions/${remixed.id}`);
  expect(remixedResponse.status()).toBe(200);
  const remixedSession = await remixedResponse.json() as {
    id: string;
    immutable: boolean;
    remixedFrom: string;
    state: { tempo: number; tracks: Array<{ steps: boolean[] }> };
  };
  expect(remixedSession).toMatchObject({
    id: remixed.id,
    immutable: false,
    remixedFrom: created.id,
    state: { tempo: 132 },
  });
  expect(activeStepIndices(remixedSession.state.tracks[0].steps)).toEqual([0, 4]);

  const publish = await request.post(`${API_BASE}/api/sessions/${created.id}/publish?contract=query`);
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

  const publishedResponse = await request.get(`${API_BASE}/api/sessions/${published.id}`);
  expect(publishedResponse.status()).toBe(200);
  const publishedSession = await publishedResponse.json() as {
    id: string;
    immutable: boolean;
    remixedFrom: string;
    state: { tempo: number; tracks: Array<{ steps: boolean[] }> };
  };
  expect(publishedSession).toMatchObject({
    id: published.id,
    immutable: true,
    remixedFrom: created.id,
    state: { tempo: 132 },
  });
  expect(activeStepIndices(publishedSession.state.tracks[0].steps)).toEqual([0, 4]);

  const forbidden = await request.put(`${API_BASE}/api/sessions/${published.id}`, {
    data: { state: state(140) },
  });
  expect(forbidden.status()).toBe(403);

  const sourceStillEditable = await request.patch(`${API_BASE}/api/sessions/${created.id}`, {
    data: { name: 'Still Editable' },
  });
  expect(sourceStillEditable.status()).toBe(200);
});

test('invalid requests are rejected without changing the session contract', async ({ request }) => {
  const unsafeCreate = await request.post(`${API_BASE}/api/sessions`, {
    data: {
      name: '<script>alert("contract")</script>',
      state: state(120),
    },
  });
  expect(unsafeCreate.status()).toBe(400);

  const create = await request.post(`${API_BASE}/api/sessions`, {
    data: { name: 'Validation Control', state: state(120, [2]) },
  });
  expect(create.status()).toBe(201);
  const created = await create.json() as { id: string };

  const invalidState = {
    ...state(132, [2, 6]),
    tempo: 'fast',
  };
  const invalidPut = await request.put(`${API_BASE}/api/sessions/${created.id}`, {
    data: { state: invalidState },
  });
  expect(invalidPut.status()).toBe(400);

  const invalidName = await request.patch(`${API_BASE}/api/sessions/${created.id}`, {
    data: { name: 42 },
  });
  expect(invalidName.status()).toBe(400);

  const overlongName = await request.patch(`${API_BASE}/api/sessions/${created.id}`, {
    data: { name: 'x'.repeat(101) },
  });
  expect(overlongName.status()).toBe(400);

  const partialPut = await request.put(`${API_BASE}/api/sessions/${created.id}`, {
    data: { state: { tempo: 130 } },
  });
  expect(partialPut.status()).toBe(400);

  const partialPatch = await request.patch(`${API_BASE}/api/sessions/${created.id}`, {
    data: { state: { tempo: 130 } },
  });
  expect(partialPatch.status()).toBe(400);

  const unchanged = await request.get(`${API_BASE}/api/sessions/${created.id}`);
  expect(unchanged.status()).toBe(200);
  const unchangedSession = await unchanged.json() as {
    name: string | null;
    state: { tempo: number; tracks: Array<{ steps: boolean[] }> };
  };
  expect(unchangedSession.name).toBe('Validation Control');
  expect(unchangedSession.state.tempo).toBe(120);
  expect(activeStepIndices(unchangedSession.state.tracks[0].steps)).toEqual([2]);

  const invalidUuid = await request.get(
    `${API_BASE}/api/sessions/------------------------------------`,
  );
  expect(invalidUuid.status()).toBe(400);

  const invalidSuffix = await request.get(
    `${API_BASE}/api/sessions/${created.id}/publish`,
  );
  expect(invalidSuffix.status()).toBe(404);

  const malformedCreate = await request.post(`${API_BASE}/api/sessions`, {
    headers: { 'Content-Type': 'application/json' },
    data: Buffer.from('{'),
  });
  expect(malformedCreate.status()).toBe(400);
  await expect(malformedCreate.json()).resolves.toMatchObject({
    error: 'Invalid JSON',
  });
});
