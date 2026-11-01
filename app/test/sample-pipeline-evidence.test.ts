import { describe, expect, it } from 'vitest';

import {
  comparePipelineEvidence,
  computeCoverageMetrics,
  createListeningCatalog,
  evaluatePromotionGates,
  parseListeningDecision,
  type PipelineEvidence,
} from '../scripts/sample-pipeline-evidence';
import type { InstrumentManifestPlan, SampleRecipe, Sha256 } from '../scripts/sample-pipeline-core';
import type { SampleSource } from '../scripts/sample-lab-core';

const sha = (character: string) => character.repeat(64) as Sha256;

function manifest(samples: InstrumentManifestPlan['samples']): InstrumentManifestPlan {
  return {
    id: 'test-piano',
    name: 'Test Piano',
    type: 'sampled',
    releaseTime: 0.5,
    playableRange: { min: 48, max: 72 },
    credits: { source: 'Fixture', url: 'https://example.com', license: 'Fixture' },
    samples,
  };
}

function evidence(overrides: Partial<PipelineEvidence> = {}): PipelineEvidence {
  return {
    instrumentId: 'test-piano',
    buildReportSha256: sha('a'),
    outputHashes: [sha('b')],
    coverage: {
      mappings: 3,
      roots: 3,
      largestRootGap: 12,
      worstShiftSemitones: 6,
      meanShiftSemitones: 2.9,
      completeVelocityRoots: 3,
      velocityRootCompleteness: 1,
      maxRoundRobins: 1,
      orphanFiles: 0,
      payloadBytes: 1000,
    },
    quality: { hardErrors: 0, reviewFlags: 1 },
    runtime: { eventsChecked: 3200, silentEvents: 0, maxPitchShiftSemitones: 6, deterministicRoundRobinGroups: 0 },
    reviewFindings: ['C4.wav: ONSET_REVIEW'],
    requiredAnchorIds: ['low', 'mid', 'high'],
    pitchSpanSemitones: 24,
    browser: { chromium: true, webkit: true },
    ...overrides,
  };
}

describe('coverage and numerical before/after evidence (stages 9-10)', () => {
  it('measures roots, shifts, complete velocity coverage, round robins, orphans, and payload', () => {
    const metrics = computeCoverageMetrics(
      manifest([
        { note: 48, file: 'C3-soft.wav', velocityMin: 0, velocityMax: 63 },
        { note: 48, file: 'C3-loud.wav', velocityMin: 64, velocityMax: 127 },
        { note: 60, file: 'C4-rr0.wav', velocityMin: 0, velocityMax: 127, roundRobinGroup: 'hit', roundRobinIndex: 0 },
        { note: 60, file: 'C4-rr1.wav', velocityMin: 0, velocityMax: 127, roundRobinGroup: 'hit', roundRobinIndex: 1 },
        { note: 72, file: 'C5.wav', velocityMin: 0, velocityMax: 127 },
      ]),
      [
        { file: 'C3-soft.wav', sizeBytes: 10 },
        { file: 'C3-loud.wav', sizeBytes: 20 },
        { file: 'C4-rr0.wav', sizeBytes: 30 },
        { file: 'C4-rr1.wav', sizeBytes: 40 },
        { file: 'C5.wav', sizeBytes: 50 },
        { file: 'orphan.wav', sizeBytes: 60 },
      ]
    );

    expect(metrics).toMatchObject({
      mappings: 5,
      roots: 3,
      largestRootGap: 12,
      worstShiftSemitones: 6,
      completeVelocityRoots: 3,
      velocityRootCompleteness: 1,
      maxRoundRobins: 2,
      orphanFiles: 1,
      payloadBytes: 210,
    });
  });

  it('reports absolute before/after values and deltas without a quality score', () => {
    const before = evidence();
    const after = evidence({
      coverage: { ...evidence().coverage, roots: 7, worstShiftSemitones: 3, meanShiftSemitones: 1.2, payloadBytes: 2000 },
      quality: { hardErrors: 0, reviewFlags: 2 },
    });
    const comparison = comparePipelineEvidence(before, after);
    expect(comparison.coverageDelta).toMatchObject({
      roots: 4,
      worstShiftSemitones: -3,
      meanShiftSemitones: -1.7,
      payloadBytes: 1000,
    });
    expect(comparison).not.toHaveProperty('score');
    expect(comparison.before).toBe(before);
    expect(comparison.after).toBe(after);
  });
});

describe('hash-bound promotion and listening evidence (stage 10)', () => {
  it('fails closed when browser proof, hard gates, or exact decision hashes do not match', () => {
    const candidate = evidence({ browser: { chromium: true, webkit: false } });
    const parsed = parseListeningDecision({
      version: 1,
      candidateId: 'test-piano',
      buildReportSha256: sha('c'),
      outputHashes: [sha('b')],
      decision: 'accepted',
      reviewer: 'Human Reviewer',
      reviewedAt: '2026-07-10T10:00:00.000Z',
      anchorsReviewed: ['low', 'mid', 'high'],
      pitchSpanSemitones: 24,
      reviewDispositions: { 'C4.wav: ONSET_REVIEW': 'Reviewed; natural instrument attack.' },
      notes: 'Preferred in a blind comparison.',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const gates = evaluatePromotionGates(evidence(), candidate, parsed.value);
    expect(gates.ok).toBe(false);
    expect(gates.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('WebKit'),
      expect.stringContaining('build report hash'),
    ]));
  });

  it('accepts only a matching human decision with three octave-spanning anchors', () => {
    const candidate = evidence();
    const parsed = parseListeningDecision({
      version: 1,
      candidateId: 'test-piano',
      buildReportSha256: sha('a'),
      outputHashes: [sha('b')],
      decision: 'accepted',
      reviewer: 'Human Reviewer',
      reviewedAt: '2026-07-10T10:00:00.000Z',
      anchorsReviewed: ['low', 'mid', 'high'],
      pitchSpanSemitones: 24,
      reviewDispositions: { 'C4.wav: ONSET_REVIEW': 'Reviewed; natural instrument attack.' },
      notes: 'Preferred in a blind comparison.',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(evaluatePromotionGates(evidence(), candidate, parsed.value)).toEqual({ ok: true, blockers: [] });
  });

  it('blocks undispositioned and stale review findings even with accepted hashes', () => {
    const candidate = evidence();
    const parsed = parseListeningDecision({
      version: 1,
      candidateId: 'test-piano',
      buildReportSha256: sha('a'),
      outputHashes: [sha('b')],
      decision: 'accepted',
      reviewer: 'Human Reviewer',
      reviewedAt: '2026-07-10T10:00:00.000Z',
      anchorsReviewed: ['low', 'mid', 'high'],
      pitchSpanSemitones: 24,
      reviewDispositions: { 'old.wav: STALE': 'Old decision.' },
      notes: 'Blind review complete.',
    });
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const gates = evaluatePromotionGates(evidence(), candidate, parsed.value);
    expect(gates.ok).toBe(false);
    expect(gates.blockers.join('\n')).toContain('not dispositioned');
    expect(gates.blockers.join('\n')).toContain('stale review disposition');
  });

  it('builds pitch-matched current/candidate anchors for Sample Lab', () => {
    const source: SampleSource = {
      id: 'fixture-source',
      name: 'Fixture Source',
      homepage: 'https://example.com',
      revision: 'v1',
      license: {
        spdx: 'CC0-1.0',
        scope: 'samples',
        evidenceUrl: 'https://example.com/evidence',
        evidenceRevision: 'v1',
        attribution: 'Fixture Source',
      },
      targets: ['test-piano'],
      formats: ['wav'],
    };
    const recipe = {
      instrument: { id: 'test-piano', name: 'Test Piano' },
      sourceRevision: 'v1',
      mapping: {
        samples: [
          { output: 'C3.m4a', rootMidi: 48 },
          { output: 'C4.m4a', rootMidi: 60 },
          { output: 'C5.m4a', rootMidi: 72 },
        ],
      },
      evidence: {
        anchors: [
          { id: 'low', targetMidi: 48, velocity: 30, currentFile: 'C3.mp3', currentRootMidi: 48, candidateOutput: 'C3.m4a', candidateRootMidi: 48 },
          { id: 'mid', targetMidi: 60, currentFile: 'C4.mp3', currentRootMidi: 60, candidateOutput: 'C4.m4a', candidateRootMidi: 60 },
          { id: 'high', targetMidi: 72, currentFile: 'C5.mp3', currentRootMidi: 72, candidateOutput: 'C5.m4a', candidateRootMidi: 72 },
        ],
      },
    } as unknown as SampleRecipe;

    const catalog = createListeningCatalog({
      recipe,
      source,
      candidateBaseUrl: '/__sample-pipeline/test-piano/candidate',
      currentBaseUrl: '/instruments/test-piano',
      objective: { hardErrors: 0, reviewFlags: 2, browserDecode: true },
    });

    expect(catalog.candidates).toHaveLength(1);
    expect(catalog.candidates[0].comparisons).toHaveLength(3);
    expect(catalog.candidates[0].comparisons[0]).toMatchObject({
      id: 'low',
      targetMidi: 48,
      velocity: 30,
      current: { url: '/instruments/test-piano/C3.mp3', rootMidi: 48 },
      candidate: { url: '/__sample-pipeline/test-piano/candidate/C3.m4a', rootMidi: 48 },
    });
  });
});
