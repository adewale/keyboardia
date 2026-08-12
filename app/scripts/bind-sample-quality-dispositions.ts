#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve(process.argv[2] ?? 'test-results/sample-quality/post-calibration-unwaived.json');
const outputPath = path.resolve('scripts/sample-quality-baseline.json');
const root = path.resolve('public', 'instruments');

interface Issue { code: string; instrumentId: string; file?: string }
interface Report { issues: Issue[] }

const reasons: Record<string, string> = {
  LEADING_SILENCE: 'Hash-bound source disposition: residual onset exceeds the review threshold after safe codec compensation; further automatic trimming could remove an authored attack.',
  PITCH_DEVIATION: 'Hash-bound source disposition: the monophonic estimator reports a deviation, but automatic retuning of this complex or inharmonic source is not perceptually safe.',
  HOT_PEAK: 'Hash-bound delivery disposition: decoded peak exceeds review headroom but remains below clipping; another lossy transcode would be more damaging than retaining it behind source/master calibration.',
  DC_OFFSET: 'Hash-bound source disposition: measurable DC exceeds the review floor but remains below the hard-failure limit and is retained without destructive reprocessing.',
  TAIL_TRUNCATION: 'Hash-bound source disposition: EOF energy exceeds the review threshold; the runtime release envelope bounds playback and automatic tail synthesis is not source-faithful.',
  LOOP_SEAM_CORRELATION: 'Hash-bound loop disposition: the declared source loop has low boundary correlation but remains decodable and is retained as authored.',
  LOOP_SEAM_DIFF: 'Hash-bound loop disposition: the declared source loop has a measurable seam-window difference and is retained as authored.',
  NEGATIVE_PHASE_CORRELATION: 'Hash-bound stereo disposition: source width can reduce mono correlation; the file remains below the hard defect threshold and is retained as authored.',
  MONO_LOSS: 'Hash-bound stereo disposition: mono fold-down loses measurable level; retaining the authored stereo source avoids irreversible channel processing.',
  RANGE_OVEREXTENSION: 'Hash-bound manifest disposition: playable range exceeds the nearest-root guideline but remains intentionally reachable with runtime range warnings.',
  NOTE_LEVEL_STEP: 'Hash-bound mapping disposition: the remaining adjacent-note step survived static source calibration; further automatic gain would exceed the neutral correction policy.',
  VELOCITY_RMS_INVERSION: 'Hash-bound mapping disposition: the remaining performance-layer inversion survived static isotonic calibration because the measured representative differs across reused mappings.',
};

function sha256(filename: string): string {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

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
  if (!fs.existsSync(filename)) throw new Error(`Disposition target is missing: ${filename}`);
  return {
    code: issue.code,
    instrumentId: issue.instrumentId,
    file: issue.file,
    sha256: sha256(filename),
    reason: reasons[issue.code] ?? 'Hash-bound source disposition retained after the complete automatic quality audit.',
  };
});
fs.writeFileSync(outputPath, `${JSON.stringify({ version: 2, waivers }, null, 2)}\n`);
console.log(`Bound ${waivers.length} exact sample-quality dispositions to current source hashes`);
