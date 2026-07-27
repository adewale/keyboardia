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
import { createInitialState } from '../src/shared/state-mutations';
import { sessionTrackToTrack } from '../src/types';
import { applyMcpSessionEdit } from '../src/worker/mcp-edits';

const MCP_SAMPLED_INSTRUMENTS = [
  ['jazz-brush-snare', 'sampled:brushes-snare', 'brushes-snare'],
  ['jazz-ride-cymbal', 'sampled:acoustic-ride', 'acoustic-ride'],
  ['take5-alto-sax', 'sampled:alto-sax', 'alto-sax'],
] as const;

describe('MCP-to-browser sampled instrument boundary', () => {
  it.each(MCP_SAMPLED_INSTRUMENTS)(
    'preserves a complete playable sampled track for %s',
    (trackId, sampleId, instrumentId) => {
      const result = applyMcpSessionEdit(createInitialState(), {
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
