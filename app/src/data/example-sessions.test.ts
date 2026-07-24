// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_SESSIONS, getExampleHref } from './example-sessions';

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
      localUuid: '8444f694-0a9a-41f3-815d-b9c6eb518c50',
      name: demo.name,
      tempo: demo.state.tempo,
      tracks: demo.state.tracks.slice(0, 4).map((track) => ({
        steps: condenseToThumbnail(track),
      })),
    });
  });

  it('uses an absolute staging URL from local builds backed by the real API', () => {
    const holby = EXAMPLE_SESSIONS.find((session) => session.name === 'Holby')!;
    expect(getExampleHref(holby)).toBe(
      'https://staging.keyboardia.dev/s/51d6fb69-afb9-4ac2-bf38-d57bca011ac6',
    );
  });

  it('uses the seeded same-origin Holby session in mock mode', () => {
    vi.stubEnv('VITE_USE_MOCK_API', '1');
    const holby = EXAMPLE_SESSIONS.find((session) => session.name === 'Holby')!;
    expect(getExampleHref(holby)).toBe('/s/8444f694-0a9a-41f3-815d-b9c6eb518c50');
  });
});
