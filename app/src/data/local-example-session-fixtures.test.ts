import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_STEPS } from '../shared/constants';
import { EXAMPLE_SESSIONS } from './example-sessions';

interface LocalExampleSessionFixture {
  id: string;
  sourceId: string;
  name: string;
  state: {
    tempo: number;
    swing: number;
    version: number;
    tracks: Array<{
      sampleId: string;
      stepCount: number;
      steps: boolean[];
      parameterLocks: Array<unknown>;
    }>;
  };
}

const LOCAL_EXAMPLE_SESSION_FIXTURES = JSON.parse(
  readFileSync(new URL('./__fixtures__/homepage-example-sessions.json', import.meta.url), 'utf8'),
) as LocalExampleSessionFixture[];

describe('local example session fixtures', () => {
  it('provides a complete session matching every homepage example', () => {
    expect(LOCAL_EXAMPLE_SESSION_FIXTURES).toHaveLength(EXAMPLE_SESSIONS.length);

    for (const example of EXAMPLE_SESSIONS) {
      const fixture = LOCAL_EXAMPLE_SESSION_FIXTURES.find(
        candidate => candidate.id === example.localUuid,
      );

      expect(fixture).toBeDefined();
      expect(fixture).toMatchObject({
        sourceId: expect.any(String),
        name: example.name,
        state: {
          tempo: example.tempo,
          swing: expect.any(Number),
          version: 1,
        },
      });
      expect(fixture!.state.tracks.length).toBeGreaterThan(0);
      for (const track of fixture!.state.tracks) {
        expect(track.steps).toHaveLength(MAX_STEPS);
        expect(track.parameterLocks).toHaveLength(MAX_STEPS);
        expect(track.stepCount).toBeGreaterThan(0);
        expect(track.stepCount).toBeLessThanOrEqual(MAX_STEPS);
      }
    }
  });

  it('keeps source aliases unique and preserves the authored showcase sessions', () => {
    expect(new Set(LOCAL_EXAMPLE_SESSION_FIXTURES.map(fixture => fixture.sourceId)).size)
      .toBe(EXAMPLE_SESSIONS.length);

    const fingerBass = LOCAL_EXAMPLE_SESSION_FIXTURES.find(fixture => fixture.name === 'Finger Bass Funk')!;
    const vibes = LOCAL_EXAMPLE_SESSION_FIXTURES.find(fixture => fixture.name === 'Vibes & Strings')!;
    const holby = LOCAL_EXAMPLE_SESSION_FIXTURES.find(fixture => fixture.name === 'Holby')!;

    expect(fingerBass.state.tracks.map(track => track.sampleId)).toContain('sampled:finger-bass');
    expect(vibes.state.tracks.map(track => track.sampleId)).toEqual(expect.arrayContaining([
      'sampled:vibraphone',
      'sampled:strings',
    ]));
    expect(holby.state.tracks).toHaveLength(10);
  });
});
