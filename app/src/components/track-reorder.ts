import type { Track } from '../types';

type TrackRef = Pick<Track, 'id'>;

type TrackReorderResolution =
  | { kind: 'noop' }
  | { kind: 'missing-track' }
  | { kind: 'reorder'; trackId: string; fromIndex: number; toIndex: number };

/**
 * Resolve a browser drop expressed in stable track IDs against the latest
 * state. A remote collaborator can remove either track between drag start and
 * drop, so missing IDs are distinct from an intentional no-op.
 */
export function resolveTrackReorder(
  tracks: readonly TrackRef[],
  droppedTrackId?: string | null,
  targetTrackId?: string | null,
): TrackReorderResolution {
  if (!droppedTrackId || !targetTrackId || droppedTrackId === targetTrackId) {
    return { kind: 'noop' };
  }

  const fromIndex = tracks.findIndex((track) => track.id === droppedTrackId);
  const toIndex = tracks.findIndex((track) => track.id === targetTrackId);
  if (fromIndex === -1 || toIndex === -1) return { kind: 'missing-track' };
  if (fromIndex === toIndex) return { kind: 'noop' };

  return { kind: 'reorder', trackId: droppedTrackId, fromIndex, toIndex };
}
