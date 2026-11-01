/**
 * Cross-runtime contract: an MCP-created shared track must retain the identity
 * and defaults that the browser audio classifier consumes.
 *
 * This deliberately imports both Worker edit logic and browser adapters, so it
 * lives outside src rather than implying that either production runtime may
 * depend on the other.
 */
import { describe, expect, it } from 'vitest';
import { getSampledInstrumentId, parseInstrumentId } from '../src/audio/instrument-types';
import type { SessionState } from '../src/shared/state';
import { sessionTrackToTrack } from '../src/types';
import { applyMcpSessionEdit } from '../src/worker/mcp-edits';

const MCP_SAMPLED_INSTRUMENTS = [
  ['jazz-brush-snare-a7f3c29d', 'sampled:brushes-snare', 'brushes-snare'],
  ['jazz-ride-cymbal-b8e4d30f', 'sampled:acoustic-ride', 'acoustic-ride'],
  ['take5-alto-sax-c9f5e410', 'sampled:alto-sax', 'alto-sax'],
] as const;

/**
 * The empty session this contract starts from. Previously imported as
 * `createInitialState` from `shared/state-mutations`, which was a test fixture
 * living in production code; it was removed as an unreachable export and every
 * caller now owns its own.
 */
function emptySession(): SessionState {
  return { tracks: [], tempo: 120, swing: 0, version: 1 };
}

describe('MCP-to-browser sampled instrument boundary', () => {
  it.each(MCP_SAMPLED_INSTRUMENTS)(
    'preserves a complete playable sampled track for %s',
    (trackId, sampleId, instrumentId) => {
      const result = applyMcpSessionEdit(emptySession(), {
        operation: 'add_track',
        track_id: trackId,
        sample_id: sampleId,
      });

      expect(result.changed).toBe(true);
      expect(result.events).toHaveLength(1);
      const event = result.events[0];
      expect(event?.type).toBe('track_added');
      if (!event || event.type !== 'track_added') throw new Error('Expected track_added');

      const browserTrack = sessionTrackToTrack(event.track);
      expect(browserTrack).toMatchObject({
        id: trackId,
        sampleId,
        muted: false,
        soloed: false,
        volume: 1,
        transpose: 0,
        stepCount: 16,
      });
      expect(browserTrack.steps).toHaveLength(128);
      expect(browserTrack.parameterLocks).toHaveLength(128);
      expect(parseInstrumentId(browserTrack.sampleId)).toMatchObject({
        type: 'sampled',
        presetId: instrumentId,
      });
      expect(getSampledInstrumentId(browserTrack.sampleId)).toBe(instrumentId);
    },
  );
});
