import { describe, expect, it } from 'vitest';

import { buildReviewIndex } from '../scripts/sample-pipeline-review-index';

describe('batched human review handoff', () => {
  it('fails closed instead of presenting mechanically failed evidence as decision-ready', () => {
    expect(() => buildReviewIndex([{
      instrumentId: 'failed',
      status: 'decision-ready',
      preliminaryBlockers: ['worst pitch-shift distance regressed'],
      current: { mappings: 1, roots: 1, maxRoundRobins: 1, payloadBytes: 100, worstShiftSemitones: 1, velocityRootCompleteness: 1 },
      candidate: {
        mappings: 1,
        roots: 1,
        maxRoundRobins: 1,
        orphanFiles: 0,
        worstShiftSemitones: 2,
        velocityRootCompleteness: 1,
        deliveryFiles: 1,
        payloadBytes: 100,
        decodedPcmBytes: 100,
        hardErrors: 0,
        reviewFlags: 0,
        reviewCodes: {},
        runtimeEventsChecked: 1,
        runtimeSilentEvents: 0,
        chromiumDecoded: 1,
        webkitDecoded: 1,
      },
    }])).toThrow('does not satisfy mechanical review gates');
  });

  it('requires the full listening protocol and never fabricates an accepted decision', () => {
    const html = buildReviewIndex([{
      instrumentId: 'test-<instrument>',
      status: 'decision-ready',
      current: { mappings: 1, roots: 1, maxRoundRobins: 1, payloadBytes: 100, worstShiftSemitones: 6, velocityRootCompleteness: 1 },
      candidate: {
        mappings: 8,
        roots: 4,
        maxRoundRobins: 2,
        orphanFiles: 0,
        worstShiftSemitones: 3,
        velocityRootCompleteness: 1,
        deliveryFiles: 8,
        payloadBytes: 200,
        decodedPcmBytes: 300,
        hardErrors: 0,
        reviewFlags: 2,
        reviewCodes: { PITCH_DEVIATION: 2 },
        runtimeEventsChecked: 1024,
        runtimeSilentEvents: 0,
        chromiumDecoded: 8,
        webkitDecoded: 8,
      },
    }]);

    expect(html).toContain('Blinded low/mid/high anchors reviewed');
    expect(html).toContain('Actual-runtime musical phrase and full-set review completed');
    expect(html).toContain('Required exact-finding disposition rationale');
    expect(html).toContain('Choose only after review');
    expect(html).toContain('button.disabled=!(checks&&text&&decision&&dispositions)');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
    expect(html).not.toContain('test-<instrument>');
    expect(html).toContain('test-\\u003cinstrument>');
  });
});
