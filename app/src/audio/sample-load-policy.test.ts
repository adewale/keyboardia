import { describe, expect, it } from 'vitest';

import {
  estimatedSampleTransferSeconds,
  MAX_CONCURRENT_SAMPLE_LOADS,
} from './sample-load-policy';

describe('sample transfer budget model', () => {
  it('charges shared bandwidth plus one RTT per six-request round', () => {
    expect(MAX_CONCURRENT_SAMPLE_LOADS).toBe(6);
    expect(estimatedSampleTransferSeconds(400_000, 7)).toBeCloseTo(2.3, 6);
  });

  it('does not charge an empty background queue', () => {
    expect(estimatedSampleTransferSeconds(0, 0)).toBe(0);
  });
});
