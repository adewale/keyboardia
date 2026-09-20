import { describe, expect, it } from 'vitest';
import { VALID_SAMPLE_IDS } from './instrument-catalog';
import { ENVELOPE_CAPABILITY_REGISTRY } from './envelope-capabilities';
import {
  ENVELOPE_RENDERER_INVENTORY,
  ENVELOPE_SCHEDULER_PATHS,
  ENVELOPE_VERTICAL_TRIO,
} from '../test/envelope-inventory';

describe('envelope execution inventories', () => {
  it('keeps catalogue, capability and renderer inventories bijective', () => {
    const expected = [...VALID_SAMPLE_IDS].sort();
    expect(Object.keys(ENVELOPE_CAPABILITY_REGISTRY).sort()).toEqual(expected);
    expect(ENVELOPE_RENDERER_INVENTORY.map(row => row.instrumentId)).toEqual(expected);
    expect(ENVELOPE_RENDERER_INVENTORY.every(row => (
      row.scheduled && row.preview && row.mainThread && row.worklet
    ))).toBe(true);
  });

  it('declares both scheduler implementations and direct preview', () => {
    expect(ENVELOPE_SCHEDULER_PATHS.map(path => path.id)).toEqual([
      'main-thread',
      'audio-worklet',
      'direct-preview',
    ]);
  });

  it('pins the synth/finite/loop vertical trio', () => {
    expect(ENVELOPE_VERTICAL_TRIO.map(row => row.instrumentId)).toEqual([
      'synth:pad',
      'sampled:piano',
      'sampled:hammond-organ',
    ]);
  });
});
