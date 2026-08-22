import { describe, expect, it } from 'vitest';

import {
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
      'source-headroom': 12,
      'level-outlier': 6,
      'root-distance': 8,
      'velocity-coverage': 8,
      'round-robin-coverage': 6,
    });
    expect(result.score).toBe(40);
  });
});
