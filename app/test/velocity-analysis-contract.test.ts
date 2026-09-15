import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  manifestMeasurementTargets,
  summarizeVelocityCentroids,
} from '../scripts/measure-velocity-timbre';
import {
  playbackProbes,
  requireMeasuredCentroidDrop,
} from '../scripts/simulate-velocity-filter';

function manifest(id: string): Parameters<typeof manifestMeasurementTargets>[0] {
  return JSON.parse(
    fs.readFileSync(path.resolve('public/instruments', id, 'manifest.json'), 'utf8'),
  ) as Parameters<typeof manifestMeasurementTargets>[0];
}

describe('velocity analysis manifest contract', () => {
  it('uses declared velocity zones even when filenames carry no layer suffix', () => {
    expect(new Set(manifestMeasurementTargets(manifest('finger-bass')).map(target => target.layer)))
      .toEqual(new Set(['0-32', '33-64', '65-96', '97-127']));
    expect(new Set(manifestMeasurementTargets(manifest('steel-drums')).map(target => target.layer)))
      .toEqual(new Set(['0-40', '41-64', '65-88', '89-112', '113-127']));
  });

  it('measures only manifest-referenced files and preserves mapped segments', () => {
    const targets = manifestMeasurementTargets({
      id: 'sabotage',
      sprite: 'sprite.m4a',
      samples: [{ note: 60, file: 'ignored.wav', offset: 1.25, duration: 0.5 }],
    });
    expect(targets).toEqual([{
      file: 'sprite.m4a',
      note: 60,
      layer: '0-127',
      articulation: 'default',
      startSeconds: 1.25,
      endSeconds: 1.75,
    }]);
  });

  it('uses the production higher-root tie-break when simulating pitch-shifted playback', () => {
    const [probe] = playbackProbes({
      id: 'sabotage',
      playableRange: { min: 61, max: 61 },
      samples: [
        { note: 60, file: 'lower.wav' },
        { note: 62, file: 'higher.wav' },
      ],
    });
    expect(probe.mapping.note).toBe(62);
    expect(probe.file).toBe('higher.wav');
    expect(probe.playbackRate).toBeCloseTo(2 ** (-1 / 12), 12);
  });

  it('cannot mistake a brighter single-layer high note for velocity response', () => {
    const summary = summarizeVelocityCentroids([
      { note: 48, articulation: 'sustain', layer: '0-63', centroidHz: 500 },
      { note: 48, articulation: 'sustain', layer: '64-127', centroidHz: 500 },
      { note: 48, articulation: 'staccato', layer: '0-127', centroidHz: 1_500 },
      { note: 72, articulation: 'sustain', layer: '0-127', centroidHz: 1_500 },
    ]);

    expect(summary.centroidSpreadByNotePct).toEqual({
      '48/staccato': 0,
      '48/sustain': 0,
      '72': 0,
    });
    expect(summary.centroidSpreadPct).toBe(0);
    // Retain the global diagnostic so the test proves it would have recreated
    // the old false result if it were still used as the velocity metric.
    expect(summary.centroidByLayerHz['0-127']).toBeGreaterThan(
      summary.centroidByLayerHz['0-63'],
    );
  });

  it('fails closed when any calibrated dry or filtered probe is unmeasurable', () => {
    expect(() => requireMeasuredCentroidDrop('kalimba', 60, 48_000, null, 700))
      .toThrow('kalimba@60/48000: dry probe is not measurable');
    expect(() => requireMeasuredCentroidDrop('kalimba', 60, 48_000, 1_000, null))
      .toThrow('kalimba@60/48000: filtered probe is not measurable');
    expect(requireMeasuredCentroidDrop('kalimba', 60, 48_000, 1_000, 700)).toBe(30);
  });
});
