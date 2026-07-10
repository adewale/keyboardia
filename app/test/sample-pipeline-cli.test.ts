import { describe, expect, it } from 'vitest';

import { parseSamplePipelineArgs } from '../scripts/sample-pipeline-cli';

describe('replacement samples full CLI contract', () => {
  it('requires a versioned recipe and immutable source root', () => {
    expect(parseSamplePipelineArgs([
      'full',
      '--recipe', 'sample-pipeline/recipes/piano.json',
      '--source-root', '/Volumes/sample-masters',
      '--output', 'public/__sample-pipeline/piano/candidate',
      '--dry-run',
    ])).toEqual({
      command: 'full',
      recipePath: 'sample-pipeline/recipes/piano.json',
      sourceRoot: '/Volumes/sample-masters',
      output: 'public/__sample-pipeline/piano/candidate',
      dryRun: true,
      promote: false,
    });
  });

  it('rejects the destructive legacy full signature instead of guessing defaults', () => {
    expect(() => parseSamplePipelineArgs([
      'full', 'piano', '--input', '/tmp/piano', '--name', 'Piano', '--category', 'keys',
    ])).toThrow(/--recipe/);
  });

  it('requires an exact listening decision for promotion', () => {
    expect(() => parseSamplePipelineArgs([
      'full', '--recipe', 'piano.json', '--source-root', '/masters', '--promote',
    ])).toThrow(/--decision/);
    expect(parseSamplePipelineArgs([
      'full', '--recipe', 'piano.json', '--source-root', '/masters', '--promote', '--decision', 'decision.json',
    ])).toMatchObject({ promote: true, decisionPath: 'decision.json' });
  });
});
