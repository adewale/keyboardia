// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXAMPLE_SESSIONS,
  getExampleHref,
  getExampleRemixTarget,
} from './example-sessions';

interface DemoTrack {
  steps: boolean[];
  stepCount: number;
}

interface DemoState {
  tempo: number;
  tracks: DemoTrack[];
  effects: object;
  scale: object;
}

interface DemoSession {
  name: string;
  description: string;
  state: DemoState;
}

function condenseToThumbnail(track: DemoTrack): boolean[] {
  const steps = track.steps.slice(0, track.stepCount);
  if (steps.length <= 16) {
    return [...steps, ...Array<boolean>(16 - steps.length).fill(false)];
  }

  const ratio = steps.length / 16;
  return Array.from({ length: 16 }, (_, index) => {
    const start = Math.floor(index * ratio);
    const end = Math.floor((index + 1) * ratio);
    return steps.slice(start, end).some(Boolean);
  });
}

describe('Holby example session', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is a replayable named-state artifact and derives its thumbnail from the capture', () => {
    const demo = JSON.parse(
      readFileSync(resolve(process.cwd(), 'scripts/demo-sessions/holby.json'), 'utf8'),
    ) as DemoSession;
    const holby = EXAMPLE_SESSIONS.find((session) => session.name === 'Holby');

    expect(demo.name).toBe('Holby');
    expect(demo.description).toBeTruthy();
    expect(demo.state.tracks).toHaveLength(10);
    expect(demo.state.effects).toBeTruthy();
    expect(demo.state.scale).toBeTruthy();
    expect(holby).toEqual({
      uuid: '51d6fb69-afb9-4ac2-bf38-d57bca011ac6',
      localUuid: '10000000-0000-4000-8000-000000000022',
      name: demo.name,
      tempo: demo.state.tempo,
      tracks: demo.state.tracks.slice(0, 4).map((track) => ({
        steps: condenseToThumbnail(track),
        pan: 0,
      })),
    });
  });

  it('keeps every curated thumbnail centered unless spatial intent is explicitly authored', () => {
    expect(EXAMPLE_SESSIONS.flatMap(session => session.tracks).every(track => track.pan === 0)).toBe(true);
  });

  it('uses an absolute staging URL from local builds backed by the real API', () => {
    const holby = EXAMPLE_SESSIONS.find((session) => session.name === 'Holby')!;
    expect(getExampleHref(holby)).toBe(
      'https://staging.keyboardia.dev/s/51d6fb69-afb9-4ac2-bf38-d57bca011ac6',
    );
  });

  it('uses the dedicated same-origin Holby fixture in mock mode', () => {
    vi.stubEnv('VITE_USE_MOCK_API', '1');
    const holby = EXAMPLE_SESSIONS.find((session) => session.name === 'Holby')!;
    expect(getExampleHref(holby)).toBe('/s/10000000-0000-4000-8000-000000000022');
    expect(getExampleRemixTarget(holby)).toEqual({
      sourceId: '10000000-0000-4000-8000-000000000022',
    });
  });

  it('routes a non-mock local remix through the deployment that owns the source', () => {
    const shaker = EXAMPLE_SESSIONS.find((session) => session.name === 'Shaker Groove')!;
    expect(getExampleRemixTarget(shaker, {
      environment: 'local',
      origin: 'http://127.0.0.1:5174',
      useMockApi: false,
    })).toEqual({
      sourceId: 'd2de21b9-6f2d-4fbb-b599-d9f246ce345c',
      apiBase: 'https://staging.keyboardia.dev/api/sessions',
      destinationOrigin: 'https://staging.keyboardia.dev',
    });
  });

  it('routes examples absent from staging through production', () => {
    const mellow = EXAMPLE_SESSIONS.find((session) => session.name === 'Mellow Goodness')!;
    expect(getExampleRemixTarget(mellow, {
      environment: 'staging',
      origin: 'https://staging.keyboardia.dev',
      useMockApi: false,
    })).toEqual({
      sourceId: '5c38321b-0099-4a9f-9635-4bc7340a0b3c',
      apiBase: 'https://keyboardia.dev/api/sessions',
      destinationOrigin: 'https://keyboardia.dev',
    });
  });

  it('keeps every local fixture ID explicit and unique', () => {
    expect(EXAMPLE_SESSIONS.every(session => session.localUuid)).toBe(true);
    expect(new Set(EXAMPLE_SESSIONS.map(session => session.localUuid)).size)
      .toBe(EXAMPLE_SESSIONS.length);
  });
});
