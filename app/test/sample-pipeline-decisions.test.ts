import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseListeningDecision } from '../scripts/sample-pipeline-evidence';

const decisionsRoot = path.resolve('sample-pipeline/decisions');
const curationReceipt = JSON.parse(
  fs.readFileSync(path.resolve('sample-pipeline/enrichment/technical-curation.json'), 'utf8'),
) as {
  policy: { perceptualPreferenceClaimed: boolean };
  instruments: Array<{
    id: string;
    manifestSha256: string;
    shipped: Array<{ sha256: string }>;
  }>;
};
const mappingCalibrationReceipt = JSON.parse(
  fs.readFileSync(path.resolve('sample-pipeline/enrichment/mapping-calibration.json'), 'utf8'),
) as {
  instruments: Array<{ id: string; manifestSha256: string }>;
};
const sha256File = (filename: string): string => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const sorted = (values: readonly string[]): string[] => [...values].sort((left, right) => left.localeCompare(right));

describe('exact-hash human rejection decisions', () => {
  it('retains their exact historical evidence without confusing later owner-directed enrichment with human preference', () => {
    const files = fs.readdirSync(decisionsRoot).filter(filename => filename.endsWith('.json')).sort();
    expect(files).toHaveLength(10);

    for (const filename of files) {
      const instrumentId = filename.replace(/\.json$/, '');
      const parsed = parseListeningDecision(JSON.parse(fs.readFileSync(path.join(decisionsRoot, filename), 'utf8')));
      if (!parsed.ok) throw new Error(`${filename}: ${parsed.errors.join('\n')}`);
      const decision = parsed.value;
      const baseline = JSON.parse(fs.readFileSync(path.resolve('sample-pipeline/baselines', filename), 'utf8'));
      const buildPath = path.resolve(baseline.evidence.buildReport);
      const build = JSON.parse(fs.readFileSync(buildPath, 'utf8'));
      const objective = JSON.parse(fs.readFileSync(path.resolve(baseline.evidence.objectiveAudit), 'utf8'));
      const comparison = JSON.parse(fs.readFileSync(path.resolve(baseline.evidence.beforeAfter), 'utf8'));
      const recipe = JSON.parse(fs.readFileSync(path.resolve('sample-pipeline/recipes', filename), 'utf8'));

      expect(decision.candidateId).toBe(instrumentId);
      expect(decision.decision).toBe('rejected');
      expect(decision.buildReportSha256).toBe(sha256File(buildPath));
      expect(sorted(decision.outputHashes)).toEqual(sorted(build.outputs.map((output: { sha256: string }) => output.sha256)));
      expect(sorted(decision.anchorsReviewed)).toEqual(sorted(recipe.evidence.anchors.map((anchor: { id: string }) => anchor.id)));
      expect(decision.pitchSpanSemitones).toBe(
        Math.max(...recipe.evidence.anchors.map((anchor: { targetMidi: number }) => anchor.targetMidi))
        - Math.min(...recipe.evidence.anchors.map((anchor: { targetMidi: number }) => anchor.targetMidi)),
      );
      expect(decision.notes).toContain('I kept preferring the current samples in all the blind tests.');

      const exactFindings = objective.issues
        .filter((issue: { severity: string }) => issue.severity === 'review')
        .map((issue: { file: string; code: string }) => `${issue.file}: ${issue.code}`);
      expect(sorted(Object.keys(decision.reviewDispositions))).toEqual(sorted([...new Set(exactFindings)]));
      expect(Object.values(decision.reviewDispositions).every(disposition =>
        disposition.includes('Unresolved and not waived') && disposition.includes('rejected at the blinded-anchor gate'))).toBe(true);

      const productionRoot = path.resolve('public/instruments', instrumentId);
      const productionManifestPath = path.join(productionRoot, 'manifest.json');
      const productionManifest = JSON.parse(fs.readFileSync(productionManifestPath, 'utf8'));
      const productionHashes = [...new Set<string>(productionManifest.samples.map((sample: { file: string }) => sample.file))]
        .map(file => sha256File(path.join(productionRoot, file)));
      const enrichmentReceiptPath = path.resolve('sample-pipeline/enrichment/evidence', instrumentId, 'promotion.json');
      if (fs.existsSync(enrichmentReceiptPath)) {
        const enrichment = JSON.parse(fs.readFileSync(enrichmentReceiptPath, 'utf8'));
        const curation = curationReceipt.instruments.find(entry => entry.id === instrumentId);
        expect(enrichment.acceptanceBasis).toBe('owner-directed-automatic-enrichment');
        expect(enrichment.perceptualPreferenceClaimed).toBe(false);
        expect(curationReceipt.policy.perceptualPreferenceClaimed).toBe(false);
        expect(curation).toBeDefined();
        expect(sha256File(productionManifestPath)).toBe(curation!.manifestSha256);
        expect(sorted(productionHashes)).toEqual(sorted(curation!.shipped.map(output => output.sha256)));
      } else {
        const calibration = mappingCalibrationReceipt.instruments.find(entry => entry.id === instrumentId);
        expect(sha256File(productionManifestPath)).toBe(
          calibration?.manifestSha256 ?? comparison.before.buildReportSha256,
        );
        expect(sorted(productionHashes)).toEqual(sorted(comparison.before.outputHashes));
      }
      expect(fs.existsSync(path.join(productionRoot, 'build-report.json'))).toBe(false);
    }
  });
});
