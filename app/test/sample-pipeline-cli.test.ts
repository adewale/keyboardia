import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseSampleRecipe } from '../scripts/sample-pipeline-core';
import {
  coverageRegressionBlockers,
  parseSamplePipelineArgs,
  playableRangeRegression,
  unresolvedSourceAuditIssues,
} from '../scripts/sample-pipeline-cli';
import type { PipelineAuditReport } from '../scripts/sample-pipeline-audit';

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

  it('blocks every coverage regression before a listening handoff', () => {
    expect(playableRangeRegression({ min: 18, max: 66 }, { min: 26, max: 45 }))
      .toBe('playable range regressed from 18..66 to 26..45');
    expect(playableRangeRegression({ min: 18, max: 66 }, { min: 18, max: 66 })).toBeUndefined();
    expect(playableRangeRegression({ min: 18, max: 66 }, { min: 12, max: 72 })).toBeUndefined();
    const before = {
      mappings: 1, roots: 1, largestRootGap: 1, worstShiftSemitones: 2,
      meanShiftSemitones: 1, completeVelocityRoots: 1, velocityRootCompleteness: 1,
      maxRoundRobins: 1, orphanFiles: 0, payloadBytes: 1,
    };
    expect(coverageRegressionBlockers(before, {
      ...before,
      orphanFiles: 1,
      worstShiftSemitones: 3,
      velocityRootCompleteness: 0.5,
    }, { min: 18, max: 66 }, { min: 26, max: 45 })).toEqual([
      '1 candidate orphan file(s)',
      'worst pitch-shift distance regressed',
      'velocity-root completeness regressed',
      'playable range regressed from 18..66 to 26..45',
    ]);
  });

  it('allows only explicitly remediated DC source findings through the master gate', () => {
    const raw = JSON.parse(fs.readFileSync('test/fixtures/sample-pipeline/recipe.json', 'utf8'));
    raw.mapping.samples[0].processing = { removeDc: true };
    const parsed = parseSampleRecipe(raw);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const issue = (code: string) => ({
      severity: 'error' as const,
      code,
      instrumentId: 'sample-pipeline-fixture',
      file: 'masters/C4.wav',
      message: code,
    });
    const report = {
      version: 1,
      instrumentId: 'sample-pipeline-fixture',
      hardErrors: 2,
      reviewFlags: 0,
      issues: [issue('DC_OFFSET'), issue('FLAT_TOP_CLIPPING')],
      entries: [],
    } as PipelineAuditReport;

    expect(unresolvedSourceAuditIssues(parsed.value.recipe, report).map(finding => finding.code))
      .toEqual(['FLAT_TOP_CLIPPING']);
    delete raw.mapping.samples[0].processing;
    const unremediated = parseSampleRecipe(raw);
    if (!unremediated.ok) throw new Error(unremediated.errors.join('\n'));
    expect(unresolvedSourceAuditIssues(unremediated.value.recipe, report).map(finding => finding.code))
      .toEqual(['DC_OFFSET', 'FLAT_TOP_CLIPPING']);
  });
});
