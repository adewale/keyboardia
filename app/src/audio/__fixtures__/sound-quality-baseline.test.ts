import { describe, expect, it } from 'vitest';
import baseline from './sound-quality-baseline.json';

describe('sound-quality baseline receipt', () => {
  it('binds objective metrics to the audited pre-change commit and render recipe', () => {
    expect(baseline.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(baseline.lane).toBe('offline-component');
    expect(baseline.reproducibility.pcmCopy).toBe('AudioBuffer.copyFromChannel');
    expect(baseline.metrics.peakDbfs).toBeGreaterThan(0);
    expect(baseline.description).toContain('Dynamics claims are intentionally excluded');
  });
});
