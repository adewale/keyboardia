import { describe, expect, it } from 'vitest';

import {
  formatIssueActions,
  reviewIssueBurden,
  scoreInstrument,
  type InstrumentScoreInput,
} from '../scripts/instrument-quality-rubric';

const cleanInput: InstrumentScoreInput = {
  calibrationPresent: true,
  liveMeasured: true,
  liveSilent: false,
  livePeakDbfs: -6,
  categoryRmsDeltaDb: 0,
  sampleFileCount: 0,
  sampleIssues: [],
  maxRootDistanceSemitones: null,
  medianVelocityLayers: null,
  targetVelocityLayers: 0,
  medianRoundRobins: null,
  targetRoundRobins: 0,
};

describe('instrument quality rubric', () => {
  it('leaves evidence completeness out of an otherwise clean quality score', () => {
    expect(scoreInstrument(cleanInput)).toEqual({
      score: 0,
      band: 'baseline',
      components: [],
    });
    expect(scoreInstrument({ ...cleanInput, liveMeasured: false })).toEqual(
      scoreInstrument(cleanInput),
    );
  });

  it('treats live silence as a fatal-sized improvement priority', () => {
    const result = scoreInstrument({ ...cleanInput, liveSilent: true });
    expect(result.score).toBe(40);
    expect(result.band).toBe('critical');
    expect(result.components).toContainEqual({
      id: 'live-silence',
      points: 40,
      detail: 'Canonical live sequencer note was silent',
    });
  });

  it('treats any complete-matrix fatal finding as critical repair debt', () => {
    const result = scoreInstrument({ ...cleanInput, dryPcmFatalCount: 7 });
    expect(result.score).toBe(40);
    expect(result.band).toBe('critical');
    expect(result.components).toContainEqual({
      id: 'dry-pcm-fatal',
      points: 40,
      detail: '7 fatal delivered-PCM matrix findings',
    });
  });

  it('reports every issue action instead of truncating after two classes', () => {
    expect(formatIssueActions(
      { FIRST: 3, SECOND: 2, THIRD: 1 },
      { FIRST: 'fix first', SECOND: 'fix second', THIRD: 'fix third' },
    )).toEqual(['fix first (3)', 'fix second (2)', 'fix third (1)']);
  });

  it('normalizes accepted sample findings by decoded file count', () => {
    const issues = Array.from({ length: 10 }, () => ({
      severity: 'review' as const,
      code: 'PITCH_DEVIATION',
    }));
    expect(reviewIssueBurden(issues, 10)).toEqual({ weightedFindings: 20, points: 10 });
    expect(reviewIssueBurden(issues, 100)).toEqual({ weightedFindings: 20, points: 1 });
  });

  it('keeps unwaived errors separate from normalized review debt', () => {
    const result = scoreInstrument({
      ...cleanInput,
      sampleFileCount: 1,
      sampleIssues: [{ severity: 'error', code: 'DECODE_FAILED' }],
    });
    expect(result.score).toBe(20);
    expect(result.components.map(component => component.id)).toEqual(['sample-errors']);
  });

  it('caps each continuous coverage and level component', () => {
    const result = scoreInstrument({
      ...cleanInput,
      livePeakDbfs: 30,
      categoryRmsDeltaDb: -100,
      maxRootDistanceSemitones: 30,
      medianVelocityLayers: 0,
      targetVelocityLayers: 4,
      medianRoundRobins: 0,
      targetRoundRobins: 4,
    });
    expect(Object.fromEntries(result.components.map(component => [component.id, component.points]))).toEqual({
      'post-track-headroom': 12,
      'level-review-priority': 6,
      'root-distance': 8,
      'velocity-coverage': 8,
      'round-robin-coverage': 6,
    });
    expect(result.score).toBe(40);
  });
});
