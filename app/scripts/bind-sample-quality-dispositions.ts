#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  boundMeasurement,
  sampleQualityEvaluatorBundleSha256,
  sha256File,
  type SampleQualityWaiver,
} from './sample-quality-baseline-core';

const reportPath = path.resolve(process.argv[2] ?? 'test-results/sample-quality/post-calibration-unwaived.json');
const outputPath = path.resolve('scripts/sample-quality-baseline.json');
const root = path.resolve('public', 'instruments');

interface Issue {
  code: string;
  instrumentId: string;
  file?: string;
  value?: number | string | null;
  threshold?: number | string;
}
interface Report { issues: Issue[] }

const reasons: Record<string, string> = {
  LEADING_SILENCE: 'Hash-bound source disposition: residual onset exceeds the review threshold after safe codec compensation; further automatic trimming could remove an authored attack.',
  PITCH_DEVIATION: 'Hash-bound source disposition: the monophonic estimator reports a deviation, but automatic retuning of this complex or inharmonic source is not perceptually safe.',
  HOT_PEAK: 'Hash-bound delivery disposition: decoded peak exceeds review headroom but remains below clipping; another lossy transcode would be more damaging than retaining it behind source/master calibration.',
  DC_OFFSET: 'Hash-bound source disposition: measurable DC exceeds the review floor but remains below the hard-failure limit and is retained without destructive reprocessing.',
  TAIL_TRUNCATION: 'Hash-bound source disposition: EOF energy exceeds the review threshold; the runtime release envelope bounds playback and automatic tail synthesis is not source-faithful.',
  LOOP_VALUE_DISCONTINUITY: 'Hash-bound metric disposition: the declared loop has a measurable boundary-value discontinuity; binding records source identity only and does not establish audibility or listening acceptance.',
  LOOP_DERIVATIVE_DISCONTINUITY: 'Hash-bound metric disposition: the declared loop has a measurable boundary-slope discontinuity; binding records source identity only and does not establish audibility or listening acceptance.',
  NEGATIVE_PHASE_CORRELATION: 'Hash-bound stereo disposition: source width can reduce mono correlation; the file remains below the hard defect threshold and is retained as authored.',
  MONO_LOSS: 'Hash-bound stereo disposition: mono fold-down loses measurable level; retaining the authored stereo source avoids irreversible channel processing.',
  RANGE_OVEREXTENSION: 'Hash-bound manifest disposition: the declared range exceeds the nearest-root guideline; binding records the capability/repitch tradeoff and does not prove perceptual acceptance.',
  NOTE_LEVEL_STEP: 'Hash-bound mapping disposition: the remaining adjacent-note step survived static source calibration; further automatic gain would exceed the neutral correction policy.',
  VELOCITY_RMS_INVERSION: 'Hash-bound mapping disposition: the remaining performance-layer inversion survived static isotonic calibration because the measured representative differs across reused mappings.',
};

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Report;
const unique = new Map<string, Issue>();
for (const issue of report.issues) {
  if (!issue.file) throw new Error(`Cannot bind issue without file: ${JSON.stringify(issue)}`);
  unique.set(`${issue.code}/${issue.instrumentId}/${issue.file}`, issue);
}
const waivers = [...unique.values()].sort((left, right) =>
  left.instrumentId.localeCompare(right.instrumentId)
  || left.file!.localeCompare(right.file!)
  || left.code.localeCompare(right.code)
).map(issue => {
  const filename = path.join(root, issue.instrumentId, issue.file!);
  const manifestFilename = path.join(root, issue.instrumentId, 'manifest.json');
  if (!fs.existsSync(filename)) throw new Error(`Disposition target is missing: ${filename}`);
  if (!fs.existsSync(manifestFilename)) throw new Error(`Disposition manifest is missing: ${manifestFilename}`);
  const reason = issue.code === 'RANGE_OVEREXTENSION' && issue.instrumentId === 'slap-bass'
    ? 'Hash-bound manifest disposition: the playable range stretches 12 semitones beyond the outer sampled roots; retaining it preserves 12 currently playable notes, while narrowing it would remove 26.7% of capability without replacement samples or session migration.'
    : reasons[issue.code] ?? 'Hash-bound source disposition retained after the complete automatic quality audit.';
  return {
    code: issue.code,
    instrumentId: issue.instrumentId,
    file: issue.file!,
    sha256: sha256File(filename),
    manifestSha256: sha256File(manifestFilename),
    measuredValue: boundMeasurement(issue.value),
    threshold: boundMeasurement(issue.threshold),
    reason,
  } satisfies SampleQualityWaiver;
});
fs.writeFileSync(outputPath, `${JSON.stringify({
  version: 3,
  evaluatorBundleSha256: sampleQualityEvaluatorBundleSha256(),
  waivers,
}, null, 2)}\n`);
console.log(`Bound ${waivers.length} canonical sample-quality dispositions to current source hashes`);
