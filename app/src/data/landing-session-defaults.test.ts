import { describe, expect, it } from 'vitest';
import { VALID_SAMPLE_IDS } from '../components/sample-constants';
import { LANDING_SAMPLES } from './landing-session-defaults';

describe('landing session instruments', () => {
  it('uses the sampled 808 kit and only active catalog IDs', () => {
    expect(LANDING_SAMPLES).toEqual([
      'sampled:808-kick',
      'sampled:808-snare',
      'sampled:808-hihat-closed',
      'sampled:808-clap',
    ]);
    expect(LANDING_SAMPLES.every(id => VALID_SAMPLE_IDS.has(id))).toBe(true);
  });
});
