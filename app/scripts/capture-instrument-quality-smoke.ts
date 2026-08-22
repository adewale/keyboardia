#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, request } from '@playwright/test';

import { ChromiumDryPcmCaptureAdapter } from '../e2e/dry-pcm-browser-adapter';
import {
  analyzeDryPcmCapture,
  buildDryPcmMatrixPlan,
  pcmSha256,
  type DryPcmMatrixCase,
} from './instrument-quality-matrix';
import {
  INSTRUMENT_QUALITY_PROFILE_BY_ID,
  INSTRUMENT_QUALITY_PROFILES,
} from './instrument-quality-profiles';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(THIS_DIR, '..');
const OUTPUT = resolve(APP_ROOT, 'reports/instrument-quality/dry-pcm-browser-smoke.json');
const PORT = 5199;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FULL_COMMIT_ID = /^[a-f0-9]{40}$/;

function sha256File(pathname: string): string {
  return createHash('sha256').update(readFileSync(pathname)).digest('hex');
}

function cleanSubjectCommit(): string {
  const subjectCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  }).trim();
  if (!FULL_COMMIT_ID.test(subjectCommit)) {
    throw new Error(`Smoke capture requires a full 40-character subject commit, got ${subjectCommit}`);
  }
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  }).trim();
  if (status.length > 0) {
    throw new Error(
      'Smoke capture refuses a dirty subject tree; commit the candidate and rerun so PCM has attributable provenance',
    );
  }
  return subjectCommit;
}

function energy(channels: readonly Float32Array[]): { peak: number; rms: number } {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (const channel of channels) {
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      count++;
    }
  }
  return { peak, rms: Math.sqrt(sumSquares / Math.max(1, count)) };
}

function selectCases(): DryPcmMatrixCase[] {
  const plan = buildDryPcmMatrixPlan();
  const ids = [
    'sampled:piano/canonical/midi-90',
    'snare/repeat-seed-a/16-hits',
    'snare/repeat-seed-a-replay/16-hits',
    'synth:lead/canonical/midi-90',
    'tone:fm-epiano/canonical/midi-90',
    'advanced:supersaw/canonical/midi-90',
  ];
  return ids.map(id => {
    const matrixCase = plan.find(candidate => candidate.id === id);
    if (!matrixCase) throw new Error(`Pinned smoke case disappeared: ${id}`);
    return matrixCase;
  });
}

async function main(): Promise<void> {
  const subjectCommit = cleanSubjectCommit();
  process.env.USE_MOCK_API = '1';
  const { createServer } = await import('vite');
  const server = await createServer({
    root: APP_ROOT,
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
    logLevel: 'warn',
  });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const api = await request.newContext();
  try {
    const adapter = new ChromiumDryPcmCaptureAdapter({ browser, request: api, baseUrl: BASE_URL });
    const captures = [];
    for (const matrixCase of selectCases()) {
      process.stdout.write(`Capturing ${matrixCase.id} ... `);
      const capture = await adapter.capture(matrixCase);
      const profile = INSTRUMENT_QUALITY_PROFILE_BY_ID.get(matrixCase.instrumentId);
      if (!profile) throw new Error(`Missing quality profile for ${matrixCase.instrumentId}`);
      const measured = energy(capture.channels);
      if (measured.peak <= 1e-4 || measured.rms <= 1e-5) {
        throw new Error(`${matrixCase.id} was silent (peak=${measured.peak}, rms=${measured.rms})`);
      }
      if (capture.maxRenderFrameDrift !== 0) {
        throw new Error(`${matrixCase.id} render-frame drift was ${capture.maxRenderFrameDrift}`);
      }
      const analysis = analyzeDryPcmCapture(profile, matrixCase, capture);
      captures.push({
        caseId: matrixCase.id,
        instrumentId: matrixCase.instrumentId,
        family: matrixCase.family,
        captureAttemptId: capture.captureAttemptId,
        pcmSha256: pcmSha256(capture),
        sampleRate: capture.sampleRate,
        channels: capture.channels.length,
        frameCount: capture.frameCount,
        capturedFrameCount: capture.capturedFrameCount,
        maxRenderFrameDrift: capture.maxRenderFrameDrift,
        ...measured,
        metrics: analysis.metrics,
        fatalFindings: analysis.fatalFindings,
        evidenceGaps: analysis.evidenceGaps,
      });
      process.stdout.write('ok\n');
    }

    const seedA = captures.find(item => item.caseId === 'snare/repeat-seed-a/16-hits');
    const replay = captures.find(item => item.caseId === 'snare/repeat-seed-a-replay/16-hits');
    if (!seedA || !replay || seedA.pcmSha256 !== replay.pcmSha256) {
      throw new Error('Fresh-context seed-A replay was not byte-exact');
    }
    if (new Set(captures.map(item => item.captureAttemptId)).size !== captures.length) {
      throw new Error('Capture attempts were not distinct');
    }

    const adapterPath = resolve(APP_ROOT, 'e2e/dry-pcm-browser-adapter.ts');
    const receipt = {
      schemaVersion: 1,
      claim: 'representative-dry-post-track-capture-smoke-not-complete-matrix',
      complete: false,
      generatedAt: new Date().toISOString(),
      subjectCommit,
      subjectTreeClean: true,
      limitation: 'Six representative attempts prove the adapter path; they are not the 1,683-case quality matrix.',
      expectedMatrixCaseCount: buildDryPcmMatrixPlan().length,
      capturedCaseCount: captures.length,
      profileCount: INSTRUMENT_QUALITY_PROFILES.length,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      adapter: {
        path: 'e2e/dry-pcm-browser-adapter.ts',
        sha256: sha256File(adapterPath),
        captureCallback: 'ChromiumDryPcmCaptureAdapter.capture(DryPcmMatrixCase)',
        sampleRate: 44_100,
        latencyHint: 'playback',
        tap: 'track-bus-output-post-pan-pre-master',
        seedAlgorithm: 'mulberry32',
        freshBrowserContextPerAttempt: true,
      },
      browser: {
        name: 'chromium',
        version: browser.version(),
        userAgent: adapter.getDiagnostics()[0]?.userAgent,
      },
      deterministicReplay: {
        caseId: seedA.caseId,
        replayCaseId: replay.caseId,
        exact: true,
        pcmSha256: seedA.pcmSha256,
      },
      captures,
      diagnostics: adapter.getDiagnostics(),
    };
    mkdirSync(dirname(OUTPUT), { recursive: true });
    const finalSubjectCommit = cleanSubjectCommit();
    if (finalSubjectCommit !== subjectCommit) {
      throw new Error(
        `Smoke capture subject changed during the run: ${subjectCommit} -> ${finalSubjectCommit}`,
      );
    }
    writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`Wrote honest ${captures.length}/${receipt.expectedMatrixCaseCount} smoke receipt to ${OUTPUT}`);
  } finally {
    await api.dispose();
    await browser.close();
    await server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
