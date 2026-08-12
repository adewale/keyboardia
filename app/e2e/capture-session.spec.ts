import { test, expect, waitForAppReady } from './global-setup';
import { API_BASE, createSessionWithRetry } from './test-utils';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { truePeakDbfs } from '../src/test/audio-measures';

const TOTAL_STEPS = 128;
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/audio-capture');
// Chromium can repeat or skip its diagnostic AudioWorklet currentFrame value
// under a loaded CI scheduler even though successive PCM callbacks remain
// contiguous. Exact frame coverage is enforced by assembleCapture; this bound
// only catches a pathological render-clock jump.
const MAX_CAPTURE_RENDER_DRIFT_FRAMES = 12 * 128;

const CAPACITY_TRACKS = [
  ['sampled-808-kick', 'sampled:808-kick', [0, 4, 8, 12]],
  ['sampled-808-snare', 'sampled:808-snare', [4, 12]],
  ['sampled-808-hat', 'sampled:808-hihat-closed', [0, 2, 4, 6, 8, 10, 12, 14]],
  ['sampled-808-open', 'sampled:808-hihat-open', [6, 14]],
  ['sampled-808-clap', 'sampled:808-clap', [4, 12]],
  ['sampled-acoustic-kick', 'sampled:acoustic-kick', [0, 4, 8, 12]],
  ['sampled-acoustic-snare', 'sampled:acoustic-snare', [4, 12]],
  ['sampled-acoustic-hat', 'sampled:acoustic-hihat-closed', [2, 6, 10, 14]],
  ['sampled-acoustic-ride', 'sampled:acoustic-ride', [0, 4, 8, 12]],
  ['sampled-brushes', 'sampled:brushes-snare', [3, 7, 11, 15]],
  ['sampled-piano', 'sampled:piano', [0, 4, 8, 12]],
  ['sampled-marimba', 'sampled:marimba', [0, 3, 6, 10, 12]],
  ['sampled-bass', 'sampled:finger-bass', [0, 6, 8, 14]],
  ['sampled-strings', 'sampled:string-section', [0, 8]],
  ['native-lead', 'synth:lead', [0, 4, 8, 12]],
  ['tone-fm-bass', 'tone:fm-bass', [0, 6, 8, 14]],
] as const;

function probeTrack(id: string, sampleId: string, activeSteps: readonly number[]) {
  const steps = Array(TOTAL_STEPS).fill(false) as boolean[];
  const parameterLocks = Array(TOTAL_STEPS).fill(null) as Array<{ volume: number } | null>;
  for (const step of activeSteps) {
    steps[step] = true;
    // Explicit locks make consecutive loop passes deterministic by bypassing
    // unlocked-step humanization.
    parameterLocks[step] = { volume: 1 };
  }
  return {
    id,
    name: id,
    sampleId,
    steps,
    parameterLocks,
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };
}

test('captures synchronized pre-compressor, post-makeup, and heard-output PCM', async ({
  page,
  request,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'real master capture is Chromium-only');
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'the production Worker build intentionally omits the development-only PCM capture hook',
  );
  test.setTimeout(90_000);
  const { id } = await createSessionWithRetry(request, {
    tracks: [
      probeTrack('capture-hat', 'hihat', [0, 2, 4, 6, 8, 10, 12, 14]),
      probeTrack('capture-kick', 'kick', [0, 4, 8, 12]),
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  });

  await page.goto(`${API_BASE}/s/${id}`);
  await waitForAppReady(page);
  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first()
    .click();
  await page.waitForFunction(() => {
    const engine = (window as unknown as {
      __audioEngine__?: {
        isToneInitialized?: () => boolean;
        getMasterCaptureTaps?: () => unknown;
      };
      __captureMaster__?: (seconds: number) => Promise<unknown>;
    }).__audioEngine__;
    return Boolean(
      engine?.isToneInitialized?.()
      && engine.getMasterCaptureTaps?.()
      && (window as unknown as { __captureMaster__?: unknown }).__captureMaster__,
    );
  }, undefined, { timeout: 30_000 });
  // Let the deterministic 2 s pattern reach steady periodic state before
  // comparing adjacent passes for the same-build null guard.
  await page.waitForTimeout(2_100);

  const result = await page.evaluate(async () => {
    type Capture = {
      sampleRate: number;
      startFrame: number;
      frameCount: number;
      maxRenderFrameDrift: number;
      taps: Record<string, { channels: Float32Array[] }>;
    };
    const captureMaster = (window as unknown as {
      __captureMaster__: (seconds: number) => Promise<Capture>;
    }).__captureMaster__;
    const capture = await captureMaster(0.75);
    const repeatCapture = await captureMaster(0.75);
    const summaries = Object.fromEntries(Object.entries(capture.taps).map(([name, tap]) => {
      const channel = tap.channels[0];
      let peak = 0;
      let energy = 0;
      let sampleCount = 0;
      for (const samples of tap.channels) {
        for (const value of samples) {
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
          sampleCount++;
        }
      }
      return [name, {
        channels: tap.channels.length,
        frames: channel.length,
        peak,
        peakDbfs: 20 * Math.log10(Math.max(peak, 1e-12)),
        rms: Math.sqrt(energy / Math.max(1, sampleCount)),
      }];
    }));
    const repeatSource = capture.taps.preCompressor.channels[0];
    const repeatTarget = repeatCapture.taps.preCompressor.channels[0];
    const strongestFrame = (data: Float32Array) => {
      let strongest = 0;
      for (let frame = 1; frame < data.length; frame++) {
        if (Math.abs(data[frame]) > Math.abs(data[strongest])) strongest = frame;
      }
      return strongest;
    };
    const repeatSourceStart = strongestFrame(repeatSource);
    const repeatTargetStart = strongestFrame(repeatTarget);
    const repeatAlignmentFrames = repeatTargetStart - repeatSourceStart;
    const repeatFrames = Math.min(
      repeatSource.length - repeatSourceStart,
      repeatTarget.length - repeatTargetStart,
      Math.round(0.5 * capture.sampleRate),
    );
    let sourceEnergy = 0;
    let residualEnergy = 0;
    for (let frame = 0; frame < repeatFrames; frame++) {
      const sourceValue = repeatSource[repeatSourceStart + frame];
      const targetValue = repeatTarget[repeatTargetStart + frame];
      sourceEnergy += sourceValue ** 2;
      residualEnergy += (sourceValue - targetValue) ** 2;
    }
    const sameBuildRepeatNullResidualDb = 10 * Math.log10(
      Math.max(residualEnergy, 1e-24) / Math.max(sourceEnergy, 1e-24),
    );
    return {
      sampleRate: capture.sampleRate,
      startFrame: capture.startFrame,
      frameCount: capture.frameCount,
      maxRenderFrameDrift: capture.maxRenderFrameDrift,
      summaries,
      sameBuildRepeatNullResidualDb,
      repeatAlignmentFrames,
    };
  });

  expect(result.sampleRate).toBeGreaterThanOrEqual(44_100);
  expect(result.startFrame % 128).toBe(0);
  expect(result.maxRenderFrameDrift).toBeLessThanOrEqual(MAX_CAPTURE_RENDER_DRIFT_FRAMES);
  expect(Object.keys(result.summaries).sort()).toEqual([
    'postMakeup',
    'preCompressor',
    'userOutput',
  ]);
  for (const summary of Object.values(result.summaries)) {
    expect(summary.frames).toBe(result.frameCount);
    expect(summary.channels).toBeGreaterThan(0);
    expect(summary.peak).toBeGreaterThan(1e-4);
    expect(summary.rms).toBeGreaterThan(1e-5);
  }
  expect(result.summaries.userOutput.peakDbfs).toBeLessThanOrEqual(0);

  // Stop the sequencer, then drive the real chain with a deterministic probe:
  // a below-threshold sine for through-gain, an impulse for lookahead latency,
  // and a short broadband pileup for gain-recovery measurement.
  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /pause|stop/i }))
    .first()
    .click();
  await page.waitForTimeout(500);
  const calibration = await page.evaluate(async () => {
    type Capture = {
      sampleRate: number;
      startFrame: number;
      frameCount: number;
      taps: Record<string, { channels: Float32Array[] }>;
    };
    type Engine = {
      getAudioContext: () => AudioContext | null;
      masterGain: GainNode | null;
    };
    const globals = window as unknown as {
      __audioEngine__: Engine;
      __captureMaster__: (seconds: number) => Promise<Capture>;
    };
    const context = globals.__audioEngine__.getAudioContext();
    const masterInput = globals.__audioEngine__.masterGain;
    if (!context || !masterInput) throw new Error('Master input unavailable for calibration');

    const now = context.currentTime;
    const impulseBuffer = context.createBuffer(1, 1, context.sampleRate);
    impulseBuffer.getChannelData(0)[0] = 0.1;
    const impulse = context.createBufferSource();
    impulse.buffer = impulseBuffer;
    impulse.connect(masterInput);
    impulse.start(now + 0.14);

    const probe = context.createOscillator();
    const probeGain = context.createGain();
    probe.frequency.value = 8_000;
    probeGain.gain.value = 0.03;
    probe.connect(probeGain).connect(masterInput);
    probe.start(now + 0.25);
    probe.stop(now + 0.95);

    const pileupSources: AudioBufferSourceNode[] = [];
    for (let voice = 0; voice < 16; voice++) {
      const voiceBuffer = context.createBuffer(1, Math.round(0.05 * context.sampleRate), context.sampleRate);
      const voicePcm = voiceBuffer.getChannelData(0);
      const frequency = 80 + voice * 47;
      const phase = voice * 2.399963229728653;
      for (let frame = 0; frame < voicePcm.length; frame++) {
        const edge = Math.min(1, frame / 48, (voicePcm.length - 1 - frame) / 48);
        voicePcm[frame] = 0.055 * Math.max(0, edge)
          * Math.sin(2 * Math.PI * frequency * frame / context.sampleRate + phase);
      }
      const source = context.createBufferSource();
      source.buffer = voiceBuffer;
      source.connect(masterInput);
      source.start(now + 0.55);
      pileupSources.push(source);
    }

    const capture = await globals.__captureMaster__(1);
    const pre = capture.taps.preCompressor.channels[0];
    const post = capture.taps.postMakeup.channels[0];
    const frameAt = (seconds: number) => Math.round(seconds * capture.sampleRate);
    const captureFrameAt = (absoluteTime: number) =>
      Math.round(absoluteTime * capture.sampleRate - capture.startFrame);
    const peakIndex = (data: Float32Array, start: number, end: number) => {
      let index = start;
      for (let frame = start + 1; frame < end; frame++) {
        if (Math.abs(data[frame]) > Math.abs(data[index])) index = frame;
      }
      return index;
    };
    const impulseSearchEnd = captureFrameAt(now + 0.22);
    const preImpulse = peakIndex(pre, 0, impulseSearchEnd);
    const postImpulse = peakIndex(post, 0, impulseSearchEnd);
    const latencyFrames = Math.max(0, postImpulse - preImpulse);
    const rms = (data: Float32Array, start: number, end: number) => {
      let energy = 0;
      for (let frame = start; frame < end; frame++) energy += data[frame] * data[frame];
      return Math.sqrt(energy / Math.max(1, end - start));
    };
    const throughStart = captureFrameAt(now + 0.3);
    const throughEnd = captureFrameAt(now + 0.45);
    const throughGainDb = 20 * Math.log10(
      rms(post, throughStart + latencyFrames, throughEnd + latencyFrames)
      / rms(pre, throughStart, throughEnd),
    );

    const goertzelAmplitude = (
      data: Float32Array,
      frequency: number,
      start: number,
      end: number,
    ) => {
      const omega = 2 * Math.PI * frequency / capture.sampleRate;
      const coefficient = 2 * Math.cos(omega);
      let previous = 0;
      let previous2 = 0;
      for (let frame = start; frame < end; frame++) {
        const value = data[frame] + coefficient * previous - previous2;
        previous2 = previous;
        previous = value;
      }
      const power = previous2 ** 2 + previous ** 2 - coefficient * previous * previous2;
      return 2 * Math.sqrt(Math.max(0, power)) / Math.max(1, end - start);
    };
    const soloHat = goertzelAmplitude(
      post,
      8_000,
      captureFrameAt(now + 0.32) + latencyFrames,
      captureFrameAt(now + 0.35) + latencyFrames,
    );
    const piledHat = goertzelAmplitude(
      post,
      8_000,
      captureFrameAt(now + 0.56) + latencyFrames,
      captureFrameAt(now + 0.59) + latencyFrames,
    );
    const controlledHatDeltaDb = 20 * Math.log10(piledHat / soloHat);

    const windowFrames = frameAt(0.005);
    const profile: number[] = [];
    for (
      let start = captureFrameAt(now + 0.55);
      start + windowFrames + latencyFrames < captureFrameAt(now + 0.95);
      start += windowFrames
    ) {
      const preRms = rms(pre, start, start + windowFrames);
      if (preRms < 1e-5) continue;
      const postRms = rms(post, start + latencyFrames, start + latencyFrames + windowFrames);
      profile.push(20 * Math.log10(Math.max(postRms, 1e-12) / preRms));
    }
    // Exclude the 50 ms broadband burst itself: the budget is the 150 ms
    // recovery after the pileup, not the intentionally loud downbeat.
    const recovery = profile.slice(12, 42);
    const maxAttenuationDb = Math.max(0, -Math.min(...recovery));
    const recoveryMonotonic = recovery.every((gainDb, index) =>
      index === 0 || gainDb >= recovery[index - 1] - 0.1
    );
    const capacityStart = captureFrameAt(now + 0.55);
    const capacityEnd = captureFrameAt(now + 0.60);
    const capacityPrePeak = Math.max(...pre.slice(capacityStart, capacityEnd).map(Math.abs));
    const capacityPostPeak = Math.max(
      ...post.slice(capacityStart + latencyFrames, capacityEnd + latencyFrames).map(Math.abs),
    );
    return {
      latencyFrames,
      throughGainDb,
      maxAttenuationDb,
      recoveryMonotonic,
      controlledHatDeltaDb,
      capacityPrePeakDbfs: 20 * Math.log10(capacityPrePeak),
      capacityPostPeakDbfs: 20 * Math.log10(capacityPostPeak),
    };
  });

  console.log('master capture calibration', calibration);
  expect(result.sameBuildRepeatNullResidualDb).toBeLessThanOrEqual(-60);
  expect(Math.abs(calibration.throughGainDb)).toBeLessThanOrEqual(0.1);
  expect(calibration.latencyFrames).toBeLessThan(result.sampleRate * 0.02);
  expect(calibration.maxAttenuationDb).toBeLessThanOrEqual(4);
  expect(calibration.recoveryMonotonic).toBe(true);
  expect(Math.abs(calibration.controlledHatDeltaDb)).toBeLessThan(2);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'browser-capture.json'),
    JSON.stringify({
      schemaVersion: 1,
      fixture: 'two-track deterministic capture probe plus controlled master-chain canary',
      ...result,
      calibration,
    }, null, 2) + '\n',
  );
});

test('keeps a user-reachable 16-track mixed-engine session below digital full scale', async ({
  page,
  request,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'real master capture is Chromium-only');
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'the production Worker build intentionally omits the development-only PCM capture hook',
  );
  test.setTimeout(90_000);
  const { id } = await createSessionWithRetry(request, {
    tracks: CAPACITY_TRACKS.map(([trackId, sampleId, activeSteps]) =>
      probeTrack(trackId, sampleId, activeSteps)
    ),
    tempo: 120,
    swing: 0,
    version: 1,
  });

  await page.goto(`${API_BASE}/s/${id}`);
  await waitForAppReady(page);
  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first()
    .click();
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __captureMaster__?: unknown }).__captureMaster__
  ), undefined, { timeout: 30_000 });
  // Progressive sample loads are product behavior, but the master-capacity
  // measurement is a steady-state audio test. Keep network/decode startup out
  // of the render-clock diagnostic.
  await page.waitForTimeout(5_000);

  const captured = await page.evaluate(async () => {
    type Capture = {
      sampleRate: number;
      maxRenderFrameDrift: number;
      taps: Record<string, { channels: Float32Array[] }>;
    };
    const capture = await (window as unknown as {
      __captureMaster__: (seconds: number) => Promise<Capture>;
    }).__captureMaster__(2.1);
    const summaries = Object.fromEntries(Object.entries(capture.taps).map(([name, tap]) => {
      let peak = 0;
      let energy = 0;
      let sampleCount = 0;
      for (const channel of tap.channels) {
        for (const value of channel) {
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
          sampleCount++;
        }
      }
      return [name, {
        peak,
        peakDbfs: 20 * Math.log10(Math.max(peak, 1e-12)),
        rms: Math.sqrt(energy / Math.max(1, sampleCount)),
      }];
    }));
    return {
      sampleRate: capture.sampleRate,
      maxRenderFrameDrift: capture.maxRenderFrameDrift,
      trackCount: document.querySelectorAll('.track-row').length,
      summaries,
      userOutputChannels: capture.taps.userOutput.channels.map(channel => Array.from(channel)),
    };
  });

  const userOutputTruePeakDbfs = Math.max(...captured.userOutputChannels.map(channel =>
    truePeakDbfs(channel)
  ));
  const { userOutputChannels: _userOutputChannels, ...result } = captured;
  void _userOutputChannels;
  Object.assign(result, { userOutputTruePeakDbfs });

  console.log('16-track session capture', result);
  expect(result.trackCount).toBe(16);
  expect(result.maxRenderFrameDrift).toBeLessThanOrEqual(MAX_CAPTURE_RENDER_DRIFT_FRAMES);
  expect(result.summaries.preCompressor.rms).toBeGreaterThan(1e-5);
  expect(result.summaries.userOutput.rms).toBeGreaterThan(1e-5);
  expect(result.summaries.userOutput.peakDbfs).toBeLessThanOrEqual(0);
  expect(userOutputTruePeakDbfs).toBeLessThanOrEqual(0);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'browser-capacity-capture.json'),
    JSON.stringify({
      schemaVersion: 1,
      fixture: 'user-reachable 16-track mixed-engine session',
      ...result,
    }, null, 2) + '\n',
  );
});
