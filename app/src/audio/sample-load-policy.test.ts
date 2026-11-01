import { describe, expect, it } from 'vitest';

import {
  estimatedSampleTransferSeconds,
  MAX_CONCURRENT_BACKGROUND_SAMPLE_LOADS,
  MAX_CONCURRENT_SAMPLE_LOADS,
} from './sample-load-policy';

describe('sample transfer budget model', () => {
  it('charges shared bandwidth plus one RTT per configured request round', () => {
    expect(MAX_CONCURRENT_SAMPLE_LOADS).toBe(6);
    expect(MAX_CONCURRENT_BACKGROUND_SAMPLE_LOADS).toBe(5);
    expect(estimatedSampleTransferSeconds(400_000, 7)).toBeCloseTo(2.3, 6);
    expect(estimatedSampleTransferSeconds(400_000, 6, 5)).toBeCloseTo(2.3, 6);
  });

  it('does not charge an empty background queue', () => {
    expect(estimatedSampleTransferSeconds(0, 0)).toBe(0);
  });
});
