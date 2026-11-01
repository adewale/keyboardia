import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSampleRecipe } from '../scripts/sample-pipeline-core';
import { canonicalRecipeSha256 } from '../scripts/sample-pipeline-runner';

const baselinesRoot = path.resolve('sample-pipeline/baselines');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256File = (filename: string): string => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

interface CandidateBaseline {
  version: number;
  instrumentId: string;
  sourceRevision: string;
  status: 'decision-ready' | 'blocked';
  evidence: {
    buildReport: string;
    objectiveAudit: string;
    browserDecode: string;
    runtimeContract: string;
    beforeAfter: string;
    sourceMasterAudit: string;
  };
  current: { playableRange?: { min: number; max: number } };
  candidate: {
    recipeFileSha256: string;
    recipeCanonicalSha256: string;
    buildReportSha256: string;
    objectiveReportSha256: string;
    browserReportSha256: string;
    runtimeReportSha256: string;
    comparisonReportSha256: string;
    sourceMasterReportSha256: string;
    playableRange?: { min: number; max: number };
    deliveryFiles: number;
    decodedPcmBytes: number;
    hardErrors: number;
    reviewFlags: number;
    reviewCodes: Record<string, number>;
    runtimeEventsChecked: number;
    runtimeSilentEvents: number;
    chromiumDecoded: number;
    webkitDecoded: number;
  };
  preliminaryBlockers: string[];
  promotionBlockedBy: string[];
}

function resolveEvidence(filename: string): string {
  return path.resolve(filename);
}

describe('hash-bound production candidate baselines', () => {
  it('recomputes every durable recipe/report hash and enforces mechanical gates without claiming sonic approval', () => {
    const files = fs.readdirSync(baselinesRoot).filter(filename => filename.endsWith('.json')).sort();
    expect(files).toHaveLength(11);
    const statuses: CandidateBaseline['status'][] = [];
    for (const filename of files) {
      const baseline = JSON.parse(fs.readFileSync(path.join(baselinesRoot, filename), 'utf8')) as CandidateBaseline;
      statuses.push(baseline.status);
      const recipeFile = path.resolve('sample-pipeline/recipes', `${baseline.instrumentId}.json`);
      expect(fs.existsSync(recipeFile), filename).toBe(true);
      const parsed = parseSampleRecipe(JSON.parse(fs.readFileSync(recipeFile, 'utf8')));
      if (!parsed.ok) throw new Error(`${filename}: ${parsed.errors.join('\n')}`);

      expect(baseline.version, filename).toBe(1);
      expect(filename, filename).toBe(`${baseline.instrumentId}.json`);
      expect(baseline.sourceRevision, filename).toBe(parsed.value.recipe.sourceRevision);
      expect(baseline.candidate.recipeFileSha256, filename).toBe(sha256File(recipeFile));
      expect(baseline.candidate.recipeCanonicalSha256, filename).toBe(canonicalRecipeSha256(parsed.value.recipe));

      const evidence = Object.fromEntries(Object.entries(baseline.evidence).map(([key, relative]) => [key, resolveEvidence(relative)])) as Record<keyof CandidateBaseline['evidence'], string>;
      for (const [key, evidenceFile] of Object.entries(evidence)) expect(fs.existsSync(evidenceFile), `${filename}:${key}`).toBe(true);
      expect(sha256File(evidence.buildReport), filename).toBe(baseline.candidate.buildReportSha256);
      expect(sha256File(evidence.objectiveAudit), filename).toBe(baseline.candidate.objectiveReportSha256);
      expect(sha256File(evidence.browserDecode), filename).toBe(baseline.candidate.browserReportSha256);
      expect(sha256File(evidence.runtimeContract), filename).toBe(baseline.candidate.runtimeReportSha256);
      expect(sha256File(evidence.beforeAfter), filename).toBe(baseline.candidate.comparisonReportSha256);
      expect(sha256File(evidence.sourceMasterAudit), filename).toBe(baseline.candidate.sourceMasterReportSha256);

      const build = JSON.parse(fs.readFileSync(evidence.buildReport, 'utf8'));
      const objective = JSON.parse(fs.readFileSync(evidence.objectiveAudit, 'utf8'));
      const browser = JSON.parse(fs.readFileSync(evidence.browserDecode, 'utf8'));
      const runtime = JSON.parse(fs.readFileSync(evidence.runtimeContract, 'utf8'));
      expect(build.recipeSha256, filename).toBe(baseline.candidate.recipeCanonicalSha256);
      expect(build.outputs, filename).toHaveLength(baseline.candidate.deliveryFiles);
      expect(new Set(build.outputs.map((output: { sha256: string }) => output.sha256)).size, filename).toBe(build.outputs.length);
      expect(build.outputs.every((output: { sha256: string }) => sha256Pattern.test(output.sha256)), filename).toBe(true);
      expect(objective.hardErrors, filename).toBe(0);
      expect(browser.chromium, filename).toBe(true);
      expect(browser.webkit, filename).toBe(true);
      expect(browser.entries.filter((entry: { browser: string; ok: boolean }) => entry.browser === 'chromium' && entry.ok), filename).toHaveLength(build.outputs.length);
      expect(browser.entries.filter((entry: { browser: string; ok: boolean }) => entry.browser === 'webkit' && entry.ok), filename).toHaveLength(build.outputs.length);
      expect(runtime.after.silentEvents, filename).toBe(0);
      expect(runtime.after.eventsChecked, filename).toBeGreaterThan(0);

      expect(baseline.candidate.hardErrors, filename).toBe(0);
      expect(baseline.candidate.decodedPcmBytes, filename).toBeGreaterThan(0);
      expect(baseline.candidate.decodedPcmBytes, `${filename} decoded PCM budget`).toBeLessThanOrEqual(96 * 1024 * 1024);
      expect(baseline.candidate.runtimeSilentEvents, filename).toBe(0);
      expect(baseline.candidate.runtimeEventsChecked, filename).toBeGreaterThan(0);
      expect(baseline.candidate.chromiumDecoded, filename).toBe(baseline.candidate.deliveryFiles);
      expect(baseline.candidate.webkitDecoded, filename).toBe(baseline.candidate.deliveryFiles);
      expect(Object.values(baseline.candidate.reviewCodes).reduce((sum, count) => sum + count, 0), filename)
        .toBe(baseline.candidate.reviewFlags);
      expect(baseline.promotionBlockedBy.join('\n'), filename).toContain('human decision');

      if (baseline.status === 'decision-ready' && baseline.current.playableRange) {
        expect(baseline.candidate.playableRange?.min, filename).toBeLessThanOrEqual(baseline.current.playableRange.min);
        expect(baseline.candidate.playableRange?.max, filename).toBeGreaterThanOrEqual(baseline.current.playableRange.max);
        expect(baseline.preliminaryBlockers, filename).toEqual([]);
      }
    }
    expect(statuses.filter(status => status === 'decision-ready')).toHaveLength(10);
    expect(files.filter((filename, index) => statuses[index] === 'blocked')).toEqual(['finger-bass.json']);
  });
});
