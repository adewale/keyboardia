import { describe, expect, it } from 'vitest';
import { resolveTrackReorder } from './track-reorder';

const tracks = [{ id: 'track-a' }, { id: 'track-b' }, { id: 'track-c' }];

describe('resolveTrackReorder', () => {
  it('uses the explicit drop target against the latest track order', () => {
    expect(resolveTrackReorder(tracks, 'track-a', 'track-c')).toEqual({
      kind: 'reorder',
      trackId: 'track-a',
      fromIndex: 0,
      toIndex: 2,
    });
  });

  it.each([
    [undefined, 'track-b'],
    ['track-a', undefined],
    ['track-a', 'track-a'],
  ])('treats an incomplete or same-track drop as a no-op', (source, target) => {
    expect(resolveTrackReorder(tracks, source, target)).toEqual({ kind: 'noop' });
  });

  it.each([
    ['removed-source', 'track-b'],
    ['track-a', 'removed-target'],
  ])('reports a collaborator-removed track separately', (source, target) => {
    expect(resolveTrackReorder(tracks, source, target)).toEqual({ kind: 'missing-track' });
  });
});
