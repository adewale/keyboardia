import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  QUARANTINED_SAMPLED_INSTRUMENTS,
  SAMPLED_INSTRUMENTS,
} from '../src/audio/sampled-instrument';
import { parseSampleRecipe } from '../scripts/sample-pipeline-core';

interface LedgerEntry {
  id: string;
  status: 'retained-audited' | 'candidate-rejected-current-retained' | 'candidate-blocked-current-retained' | 'promoted-legacy-reviewed' | 'quarantined';
  evidence?: string[];
  candidate?: { recipe: string; baseline: string; decision?: string };
  rationale: string;
}

interface UpgradeLedger {
  version: number;
  programStatus: string;
  completedAt: string;
  humanReview: {
    stage: string;
    result: string;
    statement: string;
    candidatePromotions: number;
  };
  instruments: LedgerEntry[];
}

const appRoot = path.resolve('.');
const repositoryRoot = path.resolve('..');
const ledger = JSON.parse(fs.readFileSync('sample-pipeline/instrument-upgrades.json', 'utf8')) as UpgradeLedger;
const resolveEvidence = (filename: string): string => {
  const appRelative = path.resolve(appRoot, filename);
  return fs.existsSync(appRelative) ? appRelative : path.resolve(repositoryRoot, filename);
};

describe('existing-instrument upgrade disposition ledger', () => {
  it('accounts for every active and quarantined exact ID exactly once', () => {
    const expected = [...SAMPLED_INSTRUMENTS, ...Object.keys(QUARANTINED_SAMPLED_INSTRUMENTS)].sort();
    const actual = ledger.instruments.map(entry => entry.id).sort();
    expect(ledger.version).toBe(1);
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(27);
  });

  it('records the completed human evaluation and validates every retain/reject/block disposition', () => {
    const rejected = ledger.instruments.filter(entry => entry.status === 'candidate-rejected-current-retained');
    const blocked = ledger.instruments.filter(entry => entry.status === 'candidate-blocked-current-retained');
    expect(rejected).toHaveLength(10);
    expect(blocked.map(entry => entry.id)).toEqual(['finger-bass']);
    expect(ledger.programStatus).toBe('evaluation-complete-current-retained');
    expect(Date.parse(ledger.completedAt)).not.toBeNaN();
    expect(ledger.humanReview).toEqual(expect.objectContaining({
      stage: 'blinded-low-mid-high-anchors',
      result: 'current-preferred-for-all-decision-ready-candidates',
      candidatePromotions: 0,
    }));

    for (const entry of ledger.instruments) {
      expect(entry.rationale.trim().length, entry.id).toBeGreaterThan(20);
      if (entry.status === 'candidate-rejected-current-retained' || entry.status === 'candidate-blocked-current-retained') {
        expect(entry.candidate, entry.id).toBeDefined();
        const recipePath = resolveEvidence(entry.candidate!.recipe);
        const baselinePath = resolveEvidence(entry.candidate!.baseline);
        expect(fs.existsSync(recipePath), entry.id).toBe(true);
        expect(fs.existsSync(baselinePath), entry.id).toBe(true);
        const parsed = parseSampleRecipe(JSON.parse(fs.readFileSync(recipePath, 'utf8')));
        if (!parsed.ok) throw new Error(`${entry.id}: ${parsed.errors.join('\n')}`);
        expect(parsed.value.recipe.instrument.id).toBe(entry.id);
        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        expect(baseline.instrumentId).toBe(entry.id);
        expect(baseline.status).toBe(entry.status === 'candidate-blocked-current-retained' ? 'blocked' : 'decision-ready');
        if (entry.status === 'candidate-blocked-current-retained') {
          expect(entry.candidate!.decision).toBeUndefined();
          expect(baseline.preliminaryBlockers.join('\n')).toContain('playable range');
          expect(fs.existsSync(path.resolve('sample-pipeline/decisions', `${entry.id}.json`)), entry.id).toBe(false);
        } else {
          expect(entry.candidate!.decision).toBe(`sample-pipeline/decisions/${entry.id}.json`);
          expect(fs.existsSync(resolveEvidence(entry.candidate!.decision!)), entry.id).toBe(true);
        }
      } else if (entry.status === 'quarantined') {
        expect(SAMPLED_INSTRUMENTS).not.toContain(entry.id);
        expect(fs.existsSync(path.resolve('public/instruments', entry.id))).toBe(false);
        expect(entry.evidence?.length).toBeGreaterThan(0);
      } else {
        expect(SAMPLED_INSTRUMENTS).toContain(entry.id);
        expect(fs.existsSync(path.resolve('public/instruments', entry.id, 'manifest.json')), entry.id).toBe(true);
        expect(entry.evidence?.length).toBeGreaterThan(0);
      }
      for (const evidence of entry.evidence ?? []) expect(fs.existsSync(resolveEvidence(evidence)), `${entry.id}: ${evidence}`).toBe(true);
    }
  });
});
