#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const INSTRUMENT_IDS = [
  'acoustic-kick',
  'acoustic-snare',
  'acoustic-hihat-closed',
  'acoustic-hihat-open',
  'acoustic-ride',
  'acoustic-crash',
  'finger-bass',
  'steel-drums',
] as const;

const EVIDENCE_REPORTS = [
  'objective-audit.json',
  'browser-decode.json',
  'before-after.json',
  'runtime-contract.json',
  'source-master-audit.json',
  'build-report.json',
] as const;

interface OutputRecord { file: string; sha256: string; sizeBytes: number }
interface BuildReport {
  manifestSha256: string;
  outputs: OutputRecord[];
  recipeSha256: string;
  sourceRevision: string;
}

interface AuditReport { hardErrors: number; reviewFlags: number; entries: Array<{ file: string }> }
interface BrowserReport {
  chromium: boolean;
  webkit: boolean;
  entries: Array<{ browser: string; file: string; ok: boolean }>;
}

interface ComparisonReport {
  before: { coverage: Coverage; runtime: Runtime };
  after: { coverage: Coverage; runtime: Runtime };
}

interface Coverage {
  mappings: number;
  roots: number;
  worstShiftSemitones: number;
  velocityRootCompleteness: number;
  orphanFiles: number;
  maxRoundRobins: number;
  payloadBytes: number;
}

interface Runtime { silentEvents: number; eventsChecked: number; deterministicRoundRobinGroups: number }

interface BeforeBaseline {
  instruments: Record<string, ComparisonReport['before']>;
}

interface EnrichmentLockEntry {
  id: string;
  sourceRevision: string;
  selectedLosslessMasters: number;
  explicitMappings: number;
}

interface EnrichmentLock {
  licenseProfile: string[];
  instruments: EnrichmentLockEntry[];
}

interface CurationEntry {
  id: string;
  after: { files: number; mappings: number; payloadBytes: number };
  manifestSha256: string;
  shipped: OutputRecord[];
  unshipped: OutputRecord[];
}

interface CurationReceipt {
  version: 1;
  instruments: CurationEntry[];
}

interface RemediationCalibrationReceipt {
  version: 1;
  claim: 'objective-manifest-calibration';
  perceptualPreferenceClaimed: false;
  instruments: Array<{
    id: string;
    previousManifestSha256: string;
    manifestSha256: string;
    audioBytesChanged: false;
  }>;
}

interface VerifiedCandidate {
  id: string;
  candidateRoot: string;
  reportRoot: string;
  build: BuildReport;
  audit: AuditReport;
  browser: BrowserReport;
  comparison: ComparisonReport;
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, 'utf8')) as T;
}

function writeJson(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(filename: string): string {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function originalBefore(id: string): ComparisonReport['before'] {
  const baseline = readJson<BeforeBaseline>(path.resolve('sample-pipeline', 'enrichment', 'before-baseline.json'));
  const entry = baseline.instruments[id];
  assert(entry, `${id}: immutable before baseline is missing`);
  return entry;
}

function verifyCandidate(id: string): VerifiedCandidate {
  const pipelineRoot = path.resolve('public', '__sample-pipeline', `enrichment-${id}`);
  const candidateRoot = path.join(pipelineRoot, 'candidate');
  const reportRoot = path.join(pipelineRoot, 'reports');
  const build = readJson<BuildReport>(path.join(candidateRoot, 'build-report.json'));
  const audit = readJson<AuditReport>(path.join(reportRoot, 'objective-audit.json'));
  const browser = readJson<BrowserReport>(path.join(reportRoot, 'browser-decode.json'));
  const comparison = readJson<ComparisonReport>(path.join(reportRoot, 'before-after.json'));

  assert(build.outputs.length > 0, `${id}: build report has no outputs`);
  assert(sha256(path.join(candidateRoot, 'manifest.json')) === build.manifestSha256, `${id}: manifest hash mismatch`);
  const outputFiles = new Set(build.outputs.map(output => output.file));
  assert(outputFiles.size === build.outputs.length, `${id}: duplicate build output`);
  for (const output of build.outputs) {
    const filename = path.join(candidateRoot, ...output.file.split('/'));
    assert(fs.statSync(filename).size === output.sizeBytes, `${id}/${output.file}: output size mismatch`);
    assert(sha256(filename) === output.sha256, `${id}/${output.file}: output hash mismatch`);
  }

  assert(audit.hardErrors === 0, `${id}: objective audit has ${audit.hardErrors} hard errors`);
  assert(audit.entries.length === build.outputs.length, `${id}: objective audit does not cover every output`);
  assert(browser.chromium && browser.webkit, `${id}: both browser engines must pass`);
  assert(browser.entries.length === build.outputs.length * 2, `${id}: browser audit does not cover every output twice`);
  for (const engine of ['chromium', 'webkit']) {
    const entries = browser.entries.filter(entry => entry.browser === engine);
    assert(entries.length === build.outputs.length, `${id}: ${engine} file count mismatch`);
    assert(entries.every(entry => entry.ok && outputFiles.has(entry.file)), `${id}: ${engine} has a failed or stale decode`);
  }

  const before = comparison.before.coverage;
  const after = comparison.after.coverage;
  assert(after.mappings >= before.mappings, `${id}: mapping coverage regressed`);
  assert(after.roots >= before.roots, `${id}: root coverage regressed`);
  assert(after.worstShiftSemitones <= before.worstShiftSemitones, `${id}: pitch-shift coverage regressed`);
  assert(after.velocityRootCompleteness >= before.velocityRootCompleteness, `${id}: velocity coverage regressed`);
  assert(after.orphanFiles === 0, `${id}: candidate contains orphan audio files`);
  assert(comparison.after.runtime.silentEvents === 0, `${id}: runtime has unmapped events`);
  return { id, candidateRoot, reportRoot, build, audit, browser, comparison };
}

function verifyPromoted(id: string): void {
  const productionRoot = path.resolve('public', 'instruments', id);
  const evidenceRoot = path.resolve('sample-pipeline', 'enrichment', 'evidence', id);
  const receiptPath = path.join(evidenceRoot, 'promotion.json');
  const receipt = readJson<{ outputs: OutputRecord[]; manifestSha256: string; perceptualPreferenceClaimed: boolean; before: ComparisonReport['before']; after: ComparisonReport['after']; sourceRevision: string; recipeSha256: string; committedRecipeSha256: string; evidenceSha256: Record<string, string> }>(receiptPath);
  const lock = readJson<EnrichmentLock>(path.resolve('sample-pipeline', 'enrichment', 'lock.json'));
  const locked = lock.instruments.find(entry => entry.id === id);
  assert(locked, `${id}: enrichment lock entry is missing`);
  assert(lock.licenseProfile.every(license => license === 'CC0-1.0' || license === 'Unlicense'), `${id}: enrichment changes the permitted license profile`);
  assert(receipt.perceptualPreferenceClaimed === false, `${id}: receipt must not claim perceptual preference`);
  assert(JSON.stringify(receipt.before) === JSON.stringify(originalBefore(id)), `${id}: receipt no longer contains the immutable pre-enrichment baseline`);
  assert(receipt.sourceRevision === locked.sourceRevision, `${id}: promoted source revision differs from the completeness lock`);
  assert(sha256(path.resolve('sample-pipeline', 'enrichment', 'recipes', `${id}.json`)) === receipt.committedRecipeSha256, `${id}: committed enrichment recipe hash mismatch`);
  for (const report of EVIDENCE_REPORTS) {
    const expected = receipt.evidenceSha256?.[report];
    assert(expected && sha256(path.join(evidenceRoot, report)) === expected, `${id}: ${report} is missing or differs from the promotion receipt`);
  }
  const curationPath = path.resolve('sample-pipeline', 'enrichment', 'technical-curation.json');
  if (fs.existsSync(curationPath)) {
    const curation = readJson<CurationReceipt>(curationPath).instruments.find(entry => entry.id === id);
    assert(curation, `${id}: technical curation receipt is missing`);
    const productionManifestSha256 = sha256(path.join(productionRoot, 'manifest.json'));
    if (productionManifestSha256 !== curation.manifestSha256) {
      const remediation = readJson<RemediationCalibrationReceipt>(
        path.resolve('sample-pipeline', 'remediation-receipts', 'manifest-calibrations.json'),
      );
      const calibration = remediation.instruments.find(entry => entry.id === id);
      assert(remediation.claim === 'objective-manifest-calibration', `${id}: manifest remediation claim is invalid`);
      assert(remediation.perceptualPreferenceClaimed === false, `${id}: manifest remediation must not claim perceptual preference`);
      assert(calibration, `${id}: changed curated manifest has no remediation receipt`);
      assert(calibration.previousManifestSha256 === curation.manifestSha256, `${id}: manifest remediation does not start at the curated hash`);
      assert(calibration.manifestSha256 === productionManifestSha256, `${id}: manifest remediation does not bind the production hash`);
      assert(calibration.audioBytesChanged === false, `${id}: manifest-only remediation cannot claim changed audio bytes`);
    }
    const manifest = readJson<{ samples: unknown[] }>(path.join(productionRoot, 'manifest.json'));
    assert(manifest.samples.length === curation.after.mappings, `${id}: curated mapping count mismatch`);
    const physical = fs.readdirSync(productionRoot).filter(file => /\.(?:m4a|mp3|wav)$/i.test(file)).sort();
    assert(physical.length === curation.after.files, `${id}: curated shipped file count mismatch`);
    for (const output of curation.shipped) {
      const filename = path.join(productionRoot, output.file);
      assert(fs.existsSync(filename) && sha256(filename) === output.sha256, `${id}/${output.file}: curated delivery hash mismatch`);
    }
    for (const output of curation.unshipped) {
      const filename = path.resolve('sample-pipeline', 'enrichment', 'unshipped-delivery', id, output.file);
      assert(fs.existsSync(filename) && sha256(filename) === output.sha256, `${id}/${output.file}: archived delivery hash mismatch`);
    }
    return;
  }
  assert(sha256(path.join(productionRoot, 'manifest.json')) === receipt.manifestSha256, `${id}: promoted manifest hash mismatch`);
  const manifest = readJson<{ samples: unknown[] }>(path.join(productionRoot, 'manifest.json'));
  assert(manifest.samples.length === locked.explicitMappings, `${id}: production does not contain every locked mapping`);
  assert(receipt.after.coverage.mappings === locked.explicitMappings, `${id}: receipt mapping count differs from the completeness lock`);
  const physical = fs.readdirSync(productionRoot).filter(file => /\.(?:m4a|mp3|wav)$/i.test(file)).sort();
  assert(physical.length === locked.selectedLosslessMasters, `${id}: production does not contain every usable locked source master`);
  assert(physical.length === receipt.outputs.length, `${id}: promoted output count mismatch`);
  for (const output of receipt.outputs) {
    const filename = path.join(productionRoot, ...output.file.split('/'));
    assert(fs.statSync(filename).size === output.sizeBytes, `${id}/${output.file}: promoted size mismatch`);
    assert(sha256(filename) === output.sha256, `${id}/${output.file}: promoted hash mismatch`);
  }
}

function promote(candidate: VerifiedCandidate): void {
  const productionRoot = path.resolve('public', 'instruments', candidate.id);
  const evidenceRoot = path.resolve('sample-pipeline', 'enrichment', 'evidence', candidate.id);
  const parent = path.dirname(productionRoot);
  const transaction = randomUUID();
  const staging = path.join(parent, `.${candidate.id}.automatic-enrichment-${transaction}`);
  const backup = path.join(parent, `.${candidate.id}.before-enrichment-${transaction}`);
  assert(fs.existsSync(productionRoot), `${candidate.id}: production instrument is missing`);
  fs.mkdirSync(staging);
  try {
    for (const output of candidate.build.outputs) {
      fs.copyFileSync(path.join(candidate.candidateRoot, ...output.file.split('/')), path.join(staging, ...output.file.split('/')));
    }
    fs.copyFileSync(path.join(candidate.candidateRoot, 'manifest.json'), path.join(staging, 'manifest.json'));
    fs.renameSync(productionRoot, backup);
    fs.renameSync(staging, productionRoot);

    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.mkdirSync(evidenceRoot, { recursive: true });
    for (const report of EVIDENCE_REPORTS.filter(report => report !== 'build-report.json')) {
      fs.copyFileSync(path.join(candidate.reportRoot, report), path.join(evidenceRoot, report));
    }
    fs.copyFileSync(path.join(candidate.candidateRoot, 'build-report.json'), path.join(evidenceRoot, 'build-report.json'));
    writeJson(path.join(evidenceRoot, 'promotion.json'), {
      version: 1,
      instrumentId: candidate.id,
      acceptanceBasis: 'owner-directed-automatic-enrichment',
      authority: 'Explicit user request in the 2026-08-12 Keyboardia sound-quality task',
      perceptualPreferenceClaimed: false,
      automaticGates: {
        sourceHashes: true,
        deliveryHashes: true,
        objectiveHardErrors: candidate.audit.hardErrors,
        objectiveReviewFlags: candidate.audit.reviewFlags,
        chromiumDecoded: candidate.build.outputs.length,
        webkitDecoded: candidate.build.outputs.length,
        runtimeEventsChecked: candidate.comparison.after.runtime.eventsChecked,
        runtimeSilentEvents: candidate.comparison.after.runtime.silentEvents,
      },
      before: originalBefore(candidate.id),
      after: candidate.comparison.after,
      recipeSha256: candidate.build.recipeSha256,
      committedRecipeSha256: sha256(path.resolve('sample-pipeline', 'enrichment', 'recipes', `${candidate.id}.json`)),
      sourceRevision: candidate.build.sourceRevision,
      evidenceSha256: Object.fromEntries(EVIDENCE_REPORTS.map(report => [report, sha256(path.join(evidenceRoot, report))])),
      manifestSha256: candidate.build.manifestSha256,
      outputs: candidate.build.outputs,
    });
    verifyPromoted(candidate.id);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (fs.existsSync(backup)) {
      if (fs.existsSync(productionRoot)) fs.rmSync(productionRoot, { recursive: true, force: true });
      fs.renameSync(backup, productionRoot);
    }
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
}

function main(): void {
  const verifyOnly = process.argv.includes('--verify-only');
  const repairBefore = process.argv.includes('--repair-before');
  const repairEvidenceHashes = process.argv.includes('--repair-evidence-hashes');
  if (repairEvidenceHashes) {
    for (const id of INSTRUMENT_IDS) {
      const evidenceRoot = path.resolve('sample-pipeline', 'enrichment', 'evidence', id);
      const receiptPath = path.join(evidenceRoot, 'promotion.json');
      const receipt = readJson<Record<string, unknown>>(receiptPath);
      writeJson(receiptPath, {
        ...receipt,
        committedRecipeSha256: sha256(path.resolve('sample-pipeline', 'enrichment', 'recipes', `${id}.json`)),
        evidenceSha256: Object.fromEntries(EVIDENCE_REPORTS.map(report => [report, sha256(path.join(evidenceRoot, report))])),
      });
      verifyPromoted(id);
    }
    console.log(`✓ pinned all evidence hashes in ${INSTRUMENT_IDS.length} promotion receipts`);
    return;
  }
  if (repairBefore) {
    for (const id of INSTRUMENT_IDS) {
      const receiptPath = path.resolve('sample-pipeline', 'enrichment', 'evidence', id, 'promotion.json');
      const receipt = readJson<Record<string, unknown>>(receiptPath);
      writeJson(receiptPath, { ...receipt, before: originalBefore(id) });
      verifyPromoted(id);
    }
    console.log(`✓ restored immutable before baselines in ${INSTRUMENT_IDS.length} promotion receipts`);
    return;
  }
  if (verifyOnly) {
    for (const id of INSTRUMENT_IDS) verifyPromoted(id);
    console.log(`✓ ${INSTRUMENT_IDS.length} promoted enrichment libraries match their exact receipts`);
    return;
  }
  const candidates = INSTRUMENT_IDS.map(verifyCandidate);
  for (const candidate of candidates) promote(candidate);
  console.log(`✓ promoted ${candidates.length} automatically verified enrichment libraries without claiming perceptual preference`);
}

main();
