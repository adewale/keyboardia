// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_SESSIONS } from './example-sessions';

interface DemoTrack {
  steps: boolean[];
  stepCount: number;
}

interface DemoSession {
  name: string;
  tempo: number;
  tracks: DemoTrack[];
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
  it('uses the published staging copy locally and derives its thumbnail from the captured demo', () => {
    const demo = JSON.parse(
      readFileSync(resolve(process.cwd(), 'scripts/demo-sessions/holby.json'), 'utf8'),
    ) as DemoSession;
    const holby = EXAMPLE_SESSIONS.find((session) => session.name === 'Holby');

    expect(demo.name).toBe('Holby');
    expect(demo.tracks).toHaveLength(10);
    expect(holby).toEqual({
      uuid: '51d6fb69-afb9-4ac2-bf38-d57bca011ac6',
      name: demo.name,
      tempo: demo.tempo,
      tracks: demo.tracks.slice(0, 4).map((track) => ({
        steps: condenseToThumbnail(track),
      })),
    });
  });
});
