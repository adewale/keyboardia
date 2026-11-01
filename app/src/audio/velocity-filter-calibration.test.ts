import { describe, expect, it } from 'vitest';
import { velocityFilterAnchorHz } from './velocity-filter-calibration';

describe('velocityFilterAnchorHz sample-rate domain', () => {
  it('serves only independently calibrated rates', () => {
    expect(velocityFilterAnchorHz('string-section', 60, 44_100)).toBeTypeOf('number');
    expect(velocityFilterAnchorHz('string-section', 60, 48_000)).toBeTypeOf('number');
  });

  it.each([32_000, 88_200, 96_000])(
    'uses the safe gain-only path at unsupported %i Hz instead of borrowing a table',
    (sampleRate) => {
      expect(velocityFilterAnchorHz('string-section', 60, sampleRate)).toBeUndefined();
    },
  );
});
