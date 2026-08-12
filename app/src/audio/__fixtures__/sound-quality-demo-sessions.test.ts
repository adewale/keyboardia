import { describe, expect, it } from 'vitest';
import fixtures from './sound-quality-demo-sessions.json';

describe('sound-quality demo fixtures', () => {
  it('materializes every audited demo session with valid 16-step patterns', () => {
    expect(fixtures.sessions.map(session => session.id)).toEqual([
      'S1', 'S2A', 'S2B', 'S2b', 'S3', 'S4', 'S5', 'S6',
    ]);
    for (const session of fixtures.sessions) {
      expect(session.tracks.length, session.id).toBeGreaterThan(0);
      for (const track of session.tracks) {
        expect(track.pattern, `${session.id}/${track.name}`).toHaveLength(16);
        expect(track.pattern, `${session.id}/${track.name}`).toMatch(/^[xXo-]+$/);
        const activeCount = [...track.pattern].filter(value => value !== '-').length;
        if ('pitchOffsets' in track) {
          expect(track.pitchOffsets, `${session.id}/${track.name}`).toHaveLength(activeCount);
        }
        if ('pan' in track) {
          expect(track.pan, `${session.id}/${track.name}`).toBeGreaterThanOrEqual(-1);
          expect(track.pan, `${session.id}/${track.name}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
