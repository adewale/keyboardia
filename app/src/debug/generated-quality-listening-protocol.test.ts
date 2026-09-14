import { describe, expect, it } from 'vitest';
import {
  createCounterbalancedTrials,
  type ListeningManifest,
} from './generated-quality-listening-protocol';

function manifest(repeatsPerSection = 2): ListeningManifest {
  const provenance = {
    requestedUrl: 'https://example.test/s/one',
    finalUrl: 'https://example.test/s/one',
    userAgent: 'test',
    assets: [{ url: 'https://example.test/assets/index.js', sha256: 'a'.repeat(64) }],
  };
  return {
    schemaVersion: 2,
    seed: '1'.repeat(64),
    repeatsPerSection,
    sources: {
      baseline: { file: 'a.wav', sha256: 'a'.repeat(64), provenance },
      candidate: { file: 'b.wav', sha256: 'b'.repeat(64), provenance },
    },
    sections: [
      { id: 'one', label: 'One', start: 0, duration: 1 },
      { id: 'two', label: 'Two', start: 1, duration: 1 },
    ],
  };
}

describe('generated quality listening protocol', () => {
  it('presents each source as A exactly once per two-trial section', () => {
    const trials = createCounterbalancedTrials(manifest(), () => 0.25);

    for (const section of ['one', 'two']) {
      const assignments = trials
        .filter(trial => trial.section.id === section)
        .map(trial => trial.a)
        .sort();
      expect(assignments).toEqual(['baseline', 'candidate']);
    }
  });

  it('rejects a design that cannot be counterbalanced', () => {
    expect(() => createCounterbalancedTrials(manifest(3), () => 0.5))
      .toThrow(/positive even number/);
  });
});
