import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  analyzeDryPcmCapture,
  buildDryPcmInstrumentComparisons,
  buildDryPcmMatrixPlan,
  buildInstrumentMatrixCases,
  expectedMatrixFrameCount,
  MATRIX_PCM_ARTIFACT_FORMAT,
  matrixPlanSha256,
  qualityProfileSha256,
  runDryPcmMatrix,
  schedulerMidiForTargetMidi,
  validateDryPcmMatrixReport,
  validateMatrixCoverage,
  type DryPcmCapture,
  type DryPcmMatrixCase,
  type DryPcmMatrixReport,
} from '../scripts/instrument-quality-matrix';
import { INSTRUMENT_QUALITY_PROFILES } from '../scripts/instrument-quality-profiles';

const TEST_ADAPTER = 'test/instrument-quality-matrix.test.ts';
const TEST_ADAPTER_SHA256 = createHash('sha256')
  .update(fs.readFileSync(path.resolve(TEST_ADAPTER)))
  .digest('hex');
let pcmArtifactRoot: string;

function sineCapture(
  matrixCase: DryPcmMatrixCase,
  frequency = 440 * 2 ** (((matrixCase.notes[0]?.midi ?? 69) - 69) / 12),
  amplitude = 0.1,
): DryPcmCapture {
  const sampleRate = matrixCase.sampleRate;
  const frameCount = expectedMatrixFrameCount(matrixCase, sampleRate);
  const channel = Float32Array.from({ length: frameCount }, (_, frame) =>
    Math.sin(2 * Math.PI * frequency * frame / sampleRate) * amplitude
  );
  return {
    captureAttemptId: matrixCase.id,
    sampleRate,
    channels: [channel],
    frameCount,
    capturedFrameCount: frameCount,
    maxRenderFrameDrift: 0,
  };
}

const provenance = {
  evaluatorCommit: 'a'.repeat(40),
  subjectCommit: 'b'.repeat(40),
  evaluatorTreeSha256: 'c'.repeat(64),
  generatedAt: '2026-08-22T00:00:00.000Z',
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  capture: {
    mode: 'offline' as const,
    adapter: TEST_ADAPTER,
    adapterSha256: TEST_ADAPTER_SHA256,
    artifactFormat: MATRIX_PCM_ARTIFACT_FORMAT,
  },
  browser: null,
};

describe('dry PCM instrument matrix', () => {
  // One real capture-and-analysis run shared by the accept test and every
  // tamper variant. Building a matrix report costs a full PCM analysis of all
  // 17 cases, so each tamper test edits a structuredClone of this report (or
  // temporarily rewrites one sidecar and restores it) instead of rebuilding.
  const sharedProfile = INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'kick')!;
  let sharedReport: DryPcmMatrixReport;
  let sharedPcmRoot: string;
  const copy = (): DryPcmMatrixReport => structuredClone(sharedReport);
  const verify = (candidate: DryPcmMatrixReport): void =>
    validateDryPcmMatrixReport(candidate, [sharedProfile], { pcmArtifactRoot: sharedPcmRoot });

  beforeAll(async () => {
    sharedPcmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-matrix-shared-pcm-'));
    sharedReport = await runDryPcmMatrix({
      profiles: [sharedProfile],
      provenance,
      pcmArtifactRoot: sharedPcmRoot,
      capture: async matrixCase => sineCapture(matrixCase),
    });
  }, 60_000);

  afterAll(() => {
    fs.rmSync(sharedPcmRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    pcmArtifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-matrix-pcm-'));
  });

  afterEach(() => {
    fs.rmSync(pcmArtifactRoot, { recursive: true, force: true });
  });

  it('builds all nine case families for every committed profile', () => {
    const plan = buildDryPcmMatrixPlan();
    expect(plan).toHaveLength(99 * 17);
    expect(new Set(plan.map(matrixCase => matrixCase.id)).size).toBe(plan.length);
    for (const profile of INSTRUMENT_QUALITY_PROFILES) {
      const cases = buildInstrumentMatrixCases(profile);
      expect(cases).toHaveLength(17);
      expect(new Set(cases.map(matrixCase => matrixCase.family))).toEqual(new Set([
        'canonical', 'range', 'velocity', 'release', 'repeat-seed-a',
        'repeat-seed-b', 'repeat-seed-a-replay', 'polyphony', 'stereo',
      ]));
      expect(cases.filter(matrixCase => matrixCase.family === 'range')).toHaveLength(6);
      expect(cases.filter(matrixCase => matrixCase.family === 'velocity')).toHaveLength(4);
      expect(cases.every(matrixCase => matrixCase.dry && !matrixCase.effectsEnabled && matrixCase.pan === 0)).toBe(true);
      expect(cases.every(matrixCase => matrixCase.sampleRate === 44_100)).toBe(true);
    }
    expect(matrixPlanSha256(plan)).toMatch(/^[a-f0-9]{64}$/);
    expect(qualityProfileSha256()).toMatch(/^[a-f0-9]{64}$/);

    const kick = INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === 'sampled:808-kick')!;
    const kickRangeCases = buildInstrumentMatrixCases(kick).filter(matrixCase => matrixCase.family === 'range');
    expect(kickRangeCases.find(matrixCase => matrixCase.variant.startsWith('min-'))?.notes[0])
      .toEqual(expect.objectContaining({ targetMidi: 24, midi: 48 }));
    expect(schedulerMidiForTargetMidi(24, 36)).toBe(48);
    expect(kickRangeCases.some(matrixCase => matrixCase.variant.startsWith('worst-root-distance-'))).toBe(true);
  });

  it('fails closed for missing, duplicate, or unexpected receipts', () => {
    const plan = buildDryPcmMatrixPlan(INSTRUMENT_QUALITY_PROFILES.slice(0, 1));
    const complete = plan.map(matrixCase => ({ caseId: matrixCase.id }));
    expect(() => validateMatrixCoverage(plan, complete)).not.toThrow();
    expect(() => validateMatrixCoverage(plan, complete.slice(1))).toThrow(/missing=1/);
    expect(() => validateMatrixCoverage(plan, [...complete, complete[0]])).toThrow(/duplicates=1/);
    expect(() => validateMatrixCoverage(plan, [...complete, { caseId: 'not-in-plan' }])).toThrow(/unexpected=1/);
  });

  it('runs a capture adapter, hashes PCM, and validates the resulting receipt', () => {
    const report = sharedReport;
    expect(report.complete).toBe(true);
    expect(report.results).toHaveLength(17);
    expect(report.results.every(result => /^[a-f0-9]{64}$/.test(result.pcmSha256))).toBe(true);
    expect(report.sampleRates).toEqual([44_100]);
    expect(report.comparisons).toHaveLength(1);
    expect(report.comparisons[0].repeat.seedAReplayExact).toBe(true);
    expect(report.comparisons[0].repeat.alternateSeedDiffers).toBe(false);
    expect(report.results.find(result => result.family === 'repeat-seed-b')?.fatalFindings)
      .toContainEqual(expect.objectContaining({ code: 'ALTERNATE_SEED_VARIATION_MISSING' }));
    expect(report.comparisons[0].velocity.activeRmsDbfs).toHaveLength(4);
    expect(report.comparisons[0].velocity.consecutiveActiveRmsDeltaDb.map(delta => delta.value))
      .toEqual([0, 0, 0]);
    expect(report.comparisons[0].polyphony.policy).toBe('aggregate-safety-only');
    expect(report.comparisons[0].stereo.policy).toBe('mono-fold-only');
    expect(report.comparisons[0].spectral.policy).toBe('descriptive-only');
    // The one full recomputation of an untampered report: every tamper test
    // below starts from this verdict.
    expect(() => verify(report)).not.toThrow();
  }, 30_000);

  it('rejects frame gaps and non-finite PCM before emitting a receipt', async () => {
    const profile = INSTRUMENT_QUALITY_PROFILES.slice(0, 1);
    await expect(runDryPcmMatrix({
      profiles: profile,
      provenance,
      pcmArtifactRoot,
      capture: async matrixCase => ({ ...sineCapture(matrixCase), capturedFrameCount: 1 }),
    })).rejects.toThrow(/incomplete capture/);
    await expect(runDryPcmMatrix({
      profiles: profile,
      provenance,
      pcmArtifactRoot,
      capture: async matrixCase => {
        const capture = sineCapture(matrixCase);
        capture.channels[0][4] = Number.NaN;
        return capture;
      },
    })).rejects.toThrow(/non-finite PCM/);
  });

  it('requires exact planned duration and zero render-frame drift', async () => {
    const profiles = INSTRUMENT_QUALITY_PROFILES.slice(0, 1);
    await expect(runDryPcmMatrix({
      profiles,
      provenance,
      pcmArtifactRoot,
      capture: async matrixCase => {
        const capture = sineCapture(matrixCase);
        return {
          ...capture,
          frameCount: capture.frameCount - 1,
          capturedFrameCount: capture.frameCount - 1,
          channels: [capture.channels[0].slice(0, -1)],
        };
      },
    })).rejects.toThrow(/does not match .* requested frames/);
    await expect(runDryPcmMatrix({
      profiles,
      provenance,
      pcmArtifactRoot,
      capture: async matrixCase => ({ ...sineCapture(matrixCase), maxRenderFrameDrift: 1 }),
    })).rejects.toThrow(/render-frame drift/);
  });

  it('invalidates a receipt when a fresh seed-A replay is not bit-exact', () => {
    const replayId = `${sharedProfile.id}/repeat-seed-a-replay/16-hits`;
    const comparisonsWith = (edit: (replay: DryPcmMatrixReport['results'][number]) => void) => {
      const results = copy().results;
      edit(results.find(result => result.caseId === replayId)!);
      return () => buildDryPcmInstrumentComparisons([sharedProfile], results);
    };

    expect(comparisonsWith(() => {})).not.toThrow();
    expect(comparisonsWith(replay => {
      replay.pcmSha256 = 'f'.repeat(64);
    })).toThrow(/seed-A replay is not bit-exact/);
    expect(comparisonsWith(replay => {
      replay.channels = 2;
    })).toThrow(/seed-A replay is not bit-exact/);
    expect(comparisonsWith(replay => {
      replay.frameCount += 1;
    })).toThrow(/seed-A replay is not bit-exact/);
  });

  it('detects octave-up and octave-down errors with absolute pitch', () => {
    const profile = INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'bass')!;
    const matrixCase = buildInstrumentMatrixCases(profile)
      .find(candidate => candidate.family === 'canonical')!;
    const expectedMidi = matrixCase.notes[0].midi;
    const expectedHz = 440 * 2 ** ((expectedMidi - 69) / 12);

    for (const multiplier of [0.5, 2]) {
      const analyzed = analyzeDryPcmCapture(profile, matrixCase, sineCapture(matrixCase, expectedHz * multiplier));
      expect(analyzed.metrics.pitchConfidence).toBeGreaterThanOrEqual(0.8);
      expect(Math.abs(analyzed.metrics.pitchErrorCents ?? 0)).toBeGreaterThan(1100);
      expect(analyzed.fatalFindings).toContainEqual(expect.objectContaining({ code: 'PITCH_ERROR' }));
    }
  });

  it('records inconclusive tonal pitch as an evidence gap without scoring the sound as fatal', () => {
    const profile = INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'synth:bell')!;
    const matrixCase = buildInstrumentMatrixCases(profile)
      .find(candidate => candidate.family === 'canonical')!;
    const analyzed = analyzeDryPcmCapture(profile, matrixCase, sineCapture(matrixCase, 440, 0));

    expect(analyzed.evidenceGaps).toContainEqual(expect.objectContaining({ code: 'PITCH_INCONCLUSIVE' }));
    expect(analyzed.fatalFindings.map(finding => finding.code)).not.toContain('PITCH_INCONCLUSIVE');
  });

  it('rejects malformed external provenance, metrics, geometry, and pin bindings', () => {
    const report = sharedReport;
    const profile = sharedProfile;
    expect(() => validateDryPcmMatrixReport(report, [profile]))
      .toThrow(/requires canonical raw PCM sidecars/);

    const badCommit = copy();
    badCommit.provenance.evaluatorCommit = 'branch-label';
    expect(() => verify(badCommit)).toThrow(/full evaluator and subject commit/);
    const badRate = copy();
    badRate.sampleRates = [48_000];
    expect(() => verify(badRate)).toThrow(/sampleRates/);
    const badFrames = copy();
    badFrames.results[0].frameCount--;
    expect(() => verify(badFrames)).toThrow(/frame receipt/);
    const badDrift = copy();
    badDrift.results[0].maxRenderFrameDrift = 1;
    expect(() => verify(badDrift)).toThrow(/render-frame drift/);
    const badMetric = copy();
    badMetric.results[0].metrics.dcOffsetDbfs = Number.NaN;
    expect(() => verify(badMetric)).toThrow(/must be finite/);
    // Receipt metrics that cross a gate must carry that gate's finding. These
    // structural checks run before any PCM recomputation, so they are cheap.
    const gateMetrics: Array<Partial<typeof report.results[number]['metrics']>> = [
      { truePeakDbtp: 0.5 },
      { flatTopRuns: 4 },
      { dcOffsetDbfs: -10 },
      { peakDbfs: null, rmsDbfs: null },
    ];
    for (const metrics of gateMetrics) {
      const missingFinding = copy();
      Object.assign(missingFinding.results[0].metrics, metrics);
      expect(() => verify(missingFinding), JSON.stringify(metrics))
        .toThrow(/fatal findings do not match measured gate metrics/);
    }
    expect(() => validateDryPcmMatrixReport(report, [profile], {
      pcmArtifactRoot: sharedPcmRoot,
      expectedBinding: {
        evaluatorCommit: provenance.evaluatorCommit,
        subjectCommit: provenance.subjectCommit,
        evaluatorTreeSha256: provenance.evaluatorTreeSha256,
        evaluatorDirty: true,
      },
    })).toThrow(/dirty evaluator/);
    expect(() => validateDryPcmMatrixReport(report, [profile], {
      pcmArtifactRoot: sharedPcmRoot,
      expectedBinding: {
        evaluatorCommit: 'e'.repeat(40),
        subjectCommit: provenance.subjectCommit,
        evaluatorTreeSha256: provenance.evaluatorTreeSha256,
        evaluatorDirty: false,
      },
    })).toThrow(/pinned evaluator\/subject binding/);
  });

  it('reconstructs claims from raw PCM and rejects forged, absent, or modified evidence', () => {
    const report = sharedReport;
    const result = report.results[0];
    const artifactPath = path.join(sharedPcmRoot, result.pcmArtifact);
    const originalBytes = fs.readFileSync(artifactPath);
    const forgedArtifactPath = path.join(sharedPcmRoot, `${'f'.repeat(64)}.f32le`);
    try {
      const fabricatedMetrics = structuredClone(report);
      fabricatedMetrics.results[0].metrics.spectralCentroidHz =
        (fabricatedMetrics.results[0].metrics.spectralCentroidHz ?? 0) + 1;
      expect(() => verify(fabricatedMetrics)).toThrow(/metrics do not match recomputed PCM analysis/);

      const fabricatedHash = structuredClone(report);
      fabricatedHash.results[0].pcmSha256 = 'f'.repeat(64);
      fabricatedHash.results[0].pcmArtifact = `${'f'.repeat(64)}.f32le`;
      fs.writeFileSync(forgedArtifactPath, originalBytes);
      expect(() => verify(fabricatedHash)).toThrow(/PCM artifact hash mismatch/);

      fs.unlinkSync(artifactPath);
      expect(() => verify(report)).toThrow(/PCM artifact is missing/);
      fs.writeFileSync(artifactPath, originalBytes);

      const modifiedBytes = Buffer.from(originalBytes);
      modifiedBytes[0] ^= 0x01;
      fs.writeFileSync(artifactPath, modifiedBytes);
      expect(() => verify(report)).toThrow(/PCM artifact hash mismatch/);
      fs.writeFileSync(artifactPath, originalBytes);

      fs.writeFileSync(artifactPath, originalBytes.subarray(0, originalBytes.length - 4));
      expect(() => verify(report)).toThrow(/PCM artifact byte geometry/);
      fs.writeFileSync(artifactPath, originalBytes);

      const nonFiniteBytes = Buffer.from(originalBytes);
      nonFiniteBytes.writeFloatLE(Number.NaN, 0);
      fs.writeFileSync(artifactPath, nonFiniteBytes);
      expect(() => verify(report)).toThrow(/non-finite PCM artifact value/);
      fs.writeFileSync(artifactPath, originalBytes);

      const missingAdapter = structuredClone(report);
      missingAdapter.provenance.capture.adapter = 'test/nonexistent-matrix-adapter.ts';
      expect(() => verify(missingAdapter)).toThrow(/capture adapter does not exist/);

      const wrongAdapterHash = structuredClone(report);
      wrongAdapterHash.provenance.capture.adapterSha256 = '0'.repeat(64);
      expect(() => verify(wrongAdapterHash)).toThrow(/capture adapter hash mismatch/);
    } finally {
      // Later tests share these sidecars; restore them even when an
      // expectation above fails part-way through.
      fs.writeFileSync(artifactPath, originalBytes);
      fs.rmSync(forgedArtifactPath, { force: true });
    }
  });

  it('makes strict verification fail closed on fatal findings and evidence gaps', async () => {
    // Fatal findings alone: identical seed-A/seed-B sine PCM gives the shared
    // kick report exactly one ALTERNATE_SEED_VARIATION_MISSING finding and no
    // evidence gaps (kick is unpitched).
    expect(() => validateDryPcmMatrixReport(sharedReport, [sharedProfile], {
      pcmArtifactRoot: sharedPcmRoot,
      requirePass: true,
    })).toThrow(/Strict dry PCM matrix verification failed: 1 fatal findings, 0 evidence gaps/);

    // Evidence gaps alone (reaching the strict-mode message also proves every
    // non-strict check accepted the report): broadband noise on a tonal, replay-only,
    // natural-decay profile has no measurable pitch (PITCH_INCONCLUSIVE on the
    // pitch-gated cases) and nothing that raises a fatal finding. The same
    // seeded noise for every case keeps the seed-A replay bit-exact.
    const tonalProfile = INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'sampled:piano')!;
    expect([tonalProfile.pitchMode, tonalProfile.releasePolicy, tonalProfile.variationPolicy])
      .toEqual(['tonal', 'natural-decay', 'replay-only']);
    const noiseCapture = (matrixCase: DryPcmMatrixCase): DryPcmCapture => {
      const capture = sineCapture(matrixCase, 440, 0);
      let state = 0x2545f491;
      for (let frame = 0; frame < capture.frameCount; frame++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        capture.channels[0][frame] = ((state >>> 0) / 0xffffffff - 0.5) * 0.2;
      }
      return capture;
    };
    const gapReport = await runDryPcmMatrix({
      profiles: [tonalProfile],
      provenance,
      pcmArtifactRoot,
      capture: async matrixCase => noiseCapture(matrixCase),
    });
    expect(() => validateDryPcmMatrixReport(gapReport, [tonalProfile], {
      pcmArtifactRoot,
      requirePass: true,
    })).toThrow(/Strict dry PCM matrix verification failed: 0 fatal findings, [1-9]\d* evidence gaps/);
  }, 60_000);

  it('applies the residual hard gate only to declared voice lifecycles', async () => {
    const profiles = [
      INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'noise')!,
      INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'bass')!,
    ];
    expect(profiles.map(profile => profile.releasePolicy)).toEqual(['natural-decay', 'lifecycle']);
    const releaseCases = profiles.map(profile =>
      buildInstrumentMatrixCases(profile).find(matrixCase => matrixCase.family === 'release')!
    );
    const captureWithResidualOnlyAtTwoSeconds = (matrixCase: DryPcmMatrixCase): DryPcmCapture => {
      const capture = sineCapture(matrixCase, 440, 0);
      const start = Math.round(((matrixCase.notes[0].gateSeconds ?? 0) + 2) * capture.sampleRate);
      const end = start + Math.round(0.1 * capture.sampleRate);
      for (let frame = start; frame < end; frame++) {
        capture.channels[0][frame] = 0.1 * Math.sin(2 * Math.PI * 440 * frame / capture.sampleRate);
      }
      return capture;
    };
    const results = releaseCases.map((matrixCase, index) =>
      analyzeDryPcmCapture(profiles[index], matrixCase, captureWithResidualOnlyAtTwoSeconds(matrixCase))
    );

    expect(results[0].fatalFindings)
      .not.toContainEqual(expect.objectContaining({ code: 'RELEASE_RESIDUAL' }));
    expect(results[1].fatalFindings)
      .toContainEqual(expect.objectContaining({ code: 'RELEASE_RESIDUAL' }));
  });

  it('uses worst-channel DC and release energy while onset uses the earliest audible channel', () => {
    const profile = INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'bass')!;
    const releaseCase = buildInstrumentMatrixCases(profile)
      .find(matrixCase => matrixCase.family === 'release')!;
    const capture = sineCapture(releaseCase, 440, 0);
    const right = new Float32Array(capture.frameCount);
    const onsetFrame = Math.round(0.02 * capture.sampleRate);
    for (let frame = onsetFrame; frame < capture.frameCount; frame++) {
      capture.channels[0][frame] = 0.02;
      right[frame] = -0.02;
    }
    const residualStart = Math.round((releaseCase.notes[0].gateSeconds + 2) * capture.sampleRate);
    for (let frame = residualStart; frame < residualStart + Math.round(0.1 * capture.sampleRate); frame++) {
      capture.channels[0][frame] = 0.02;
      right[frame] = -0.02;
    }
    capture.channels = [capture.channels[0], right];
    const analyzed = analyzeDryPcmCapture(profile, releaseCase, capture);

    expect(analyzed.metrics.leadingSilenceMs).toBeCloseTo(20, 3);
    expect(analyzed.metrics.dcOffsetDbfs).toBeGreaterThan(-40);
    expect(analyzed.fatalFindings).toContainEqual(expect.objectContaining({ code: 'DC_OFFSET' }));
    expect(analyzed.fatalFindings).toContainEqual(expect.objectContaining({ code: 'RELEASE_RESIDUAL' }));
  });

  it('fails exact anti-phase stereo that disappears in mono', () => {
    const profile = INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === 'tone:metal-cymbal')!;
    const stereoCase = buildInstrumentMatrixCases(profile)
      .find(matrixCase => matrixCase.family === 'stereo')!;
    const capture = sineCapture(stereoCase, 1_000, 0.2);
    capture.channels = [capture.channels[0], Float32Array.from(capture.channels[0], value => -value)];

    const analyzed = analyzeDryPcmCapture(profile, stereoCase, capture);

    expect(analyzed.metrics.peakDbfs).toBeGreaterThan(-20);
    expect(analyzed.metrics.stereoCorrelation).toBeCloseTo(-1, 6);
    expect(analyzed.metrics.monoLossDb).toBeLessThan(-100);
    expect(analyzed.fatalFindings)
      .toContainEqual(expect.objectContaining({ code: 'MONO_LOSS' }));
  });

  it('calibrates harmonic pitch policy against shipped Hammond and slap-bass timbres', async () => {
    const contextModule = await import('node-web-audio-api') as {
      OfflineAudioContext: new (channels: number, length: number, sampleRate: number) => {
        decodeAudioData(buffer: ArrayBuffer): Promise<{
          sampleRate: number;
          numberOfChannels: number;
          length: number;
          getChannelData(channel: number): Float32Array;
        }>;
        close?: () => Promise<void>;
      };
    };
    const context = new contextModule.OfflineAudioContext(1, 1, 44_100);
    const captureFile = async (
      profileId: string,
      relativeFile: string,
      targetMidi: number,
    ): Promise<ReturnType<typeof analyzeDryPcmCapture>> => {
      const profile = INSTRUMENT_QUALITY_PROFILES.find(candidate => candidate.id === profileId)!;
      const matrixCase = structuredClone(buildInstrumentMatrixCases(profile)
        .find(candidate => candidate.family === 'canonical')!);
      matrixCase.notes = [{ ...matrixCase.notes[0], midi: targetMidi, targetMidi }];
      const bytes = fs.readFileSync(path.resolve(relativeFile));
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = await context.decodeAudioData(arrayBuffer);
      expect(decoded.sampleRate).toBe(matrixCase.sampleRate);
      const frameCount = expectedMatrixFrameCount(matrixCase, decoded.sampleRate);
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, channelIndex) => {
        const output = new Float32Array(frameCount);
        output.set(decoded.getChannelData(channelIndex).subarray(0, frameCount));
        return output;
      });
      return analyzeDryPcmCapture(profile, matrixCase, {
        captureAttemptId: `${profileId}-fixture`,
        sampleRate: decoded.sampleRate,
        channels,
        frameCount,
        capturedFrameCount: frameCount,
        maxRenderFrameDrift: 0,
      });
    };

    try {
      const hammond = await captureFile(
        'sampled:hammond-organ',
        'public/instruments/hammond-organ/C4.wav',
        60,
      );
      expect(hammond.metrics.pitchObservedCents).toBeLessThan(-1100);
      expect(Math.abs(hammond.metrics.pitchErrorCents ?? Infinity)).toBeLessThan(50);
      expect(hammond.fatalFindings.map(finding => finding.code)).not.toContain('PITCH_ERROR');

      const slap = await captureFile(
        'sampled:slap-bass',
        'public/instruments/slap-bass/slap-c4.mp3',
        60,
      );
      expect(slap.fatalFindings.map(finding => finding.code)).not.toContain('PITCH_ERROR');
    } finally {
      await context.close?.();
    }
  }, 15_000);
});
