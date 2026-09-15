import { test, expect, waitForAppReady } from './global-setup';
import { API_BASE, createSessionWithRetry } from './test-utils';
import { createE2EContext } from './browser-context';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bandRmsDb,
  estimateLatencyFrames,
  hitLevelVariationDb,
  logSpectralDistance,
  loudnessKMax,
  pumpingProfile,
  truePeakDbfs,
} from '../src/test/audio-measures';
import {
  LEGACY_MISSING_EFFECTS_STATE,
  NEW_SESSION_EFFECTS_STATE,
} from '../src/shared/effects-defaults';

const TOTAL_STEPS = 128;
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/audio-capture');
// Chromium can repeat or skip its diagnostic AudioWorklet currentFrame value
// under a loaded CI scheduler even though successive PCM callbacks remain
// contiguous. Exact frame coverage is enforced by assembleCapture; this bound
// only catches a pathological render-clock jump.
const MAX_CAPTURE_RENDER_DRIFT_FRAMES = 12 * 128;
const COLD_START_TRIALS = 5;

const COLD_START_SCENARIOS = [
  { id: 'whole-engine-native', sampleId: 'synth:lead' },
  { id: 'tone-instrument', sampleId: 'tone:fm-epiano' },
  { id: 'advanced-instrument', sampleId: 'advanced:supersaw' },
] as const;

function installColdStartupProbe(): void {
  type Candidate = {
    source: GainNode;
    attachedAt: number;
    workletReadyAt: number | null;
    firstPcmAt: number | null;
    firstFrameReceivedAt: number | null;
    firstPcmContextTime: number | null;
    silentFramesBeforeFirstPcm: number | null;
    setupError: string | null;
    peak: number;
  };
  type Probe = {
    clickAt: number | null;
    engineExposedAt: number | null;
    toneInitStartedAt: number | null;
    toneInitFinishedAt: number | null;
    preloadStartedAt: number | null;
    preloadFinishedAt: number | null;
    schedulerBoundaryReleasedAt: number | null;
    engine: {
      masterGain: GainNode | null;
      initializeTone: () => Promise<void>;
      preloadInstrumentsForTracks: (tracks: unknown[]) => Promise<void>;
    } | null;
    candidates: Candidate[];
    setupDelayMs: number;
  };
  type ProbeWindow = Window & typeof globalThis & { __coldStartupProbe__: Probe };

  const probe: Probe = {
    clickAt: null,
    engineExposedAt: null,
    toneInitStartedAt: null,
    toneInitFinishedAt: null,
    preloadStartedAt: null,
    preloadFinishedAt: null,
    schedulerBoundaryReleasedAt: null,
    engine: null,
    candidates: [],
    setupDelayMs: 0,
  };
  (window as ProbeWindow).__coldStartupProbe__ = probe;

  type ConnectArgs = [destination: AudioNode | AudioParam, output?: number, input?: number];
  type Connect = (this: AudioNode, ...args: ConnectArgs) => AudioNode | void;
  const originalConnect = AudioNode.prototype.connect as Connect;
  (AudioNode.prototype as unknown as { connect: Connect }).connect = function (...args) {
    const destination = args[0];
    const result = Reflect.apply(originalConnect, this, args) as AudioNode | void;
    if (this instanceof GainNode && destination instanceof DynamicsCompressorNode) {
      const candidate: Candidate = {
        source: this,
        attachedAt: performance.now(),
        workletReadyAt: null,
        firstPcmAt: null,
        firstFrameReceivedAt: null,
        firstPcmContextTime: null,
        silentFramesBeforeFirstPcm: null,
        setupError: null,
        peak: 0,
      };
      probe.candidates.push(candidate);
      const context = this.context as AudioContext;
      const processorName = `cold-first-pcm-probe-${probe.candidates.length}`;
      const setupDelayMs = probe.setupDelayMs;
      const moduleSource = `
        class ColdFirstPcmProbe extends AudioWorkletProcessor {
          constructor() {
            super();
            this.found = false;
            this.silentFrames = 0;
          }
          process(inputs) {
            if (!this.found) {
              const input = inputs[0] || [];
              const frames = input[0]?.length || 0;
              for (let frame = 0; frame < frames; frame++) {
                let magnitude = 0;
                for (const channel of input) {
                  magnitude = Math.max(magnitude, Math.abs(channel[frame] || 0));
                }
                if (magnitude >= 1e-4) {
                  this.found = true;
                  this.port.postMessage({
                    type: 'first-pcm',
                    absoluteFrame: currentFrame + frame,
                    magnitude,
                    silentFramesBeforeFirstPcm: this.silentFrames,
                  });
                  break;
                }
                this.silentFrames++;
              }
            }
            return true;
          }
        }
        registerProcessor(${JSON.stringify(processorName)}, ColdFirstPcmProbe);
      `;
      void (async () => {
        const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
        try {
          if (setupDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, setupDelayMs));
          }
          await context.audioWorklet.addModule(moduleUrl);
          const processor = new AudioWorkletNode(context, processorName, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          const sink = context.createGain();
          sink.gain.value = 0;
          processor.port.onmessage = (event: MessageEvent<{
            type: string;
            absoluteFrame: number;
            magnitude: number;
            silentFramesBeforeFirstPcm: number;
          }>) => {
            if (event.data.type !== 'first-pcm' || candidate.firstPcmContextTime !== null) return;
            candidate.firstFrameReceivedAt = performance.now();
            candidate.firstPcmContextTime = event.data.absoluteFrame / context.sampleRate;
            candidate.silentFramesBeforeFirstPcm = event.data.silentFramesBeforeFirstPcm;
            candidate.peak = event.data.magnitude;
            const mappingStartedAt = performance.now();
            const mapFirstPcmToPageClock = () => {
              const timestamp = context.getOutputTimestamp();
              if (timestamp.performanceTime <= 0) {
                if (performance.now() - mappingStartedAt >= 2_000) {
                  candidate.setupError = 'AudioContext.getOutputTimestamp returned no clock mapping';
                } else {
                  setTimeout(mapFirstPcmToPageClock, 5);
                }
                return;
              }
              candidate.firstPcmAt = timestamp.performanceTime
                + (candidate.firstPcmContextTime! - timestamp.contextTime) * 1_000;
            };
            mapFirstPcmToPageClock();
          };
          originalConnect.call(this, processor);
          originalConnect.call(processor, sink);
          originalConnect.call(sink, context.destination);
          candidate.workletReadyAt = performance.now();
        } catch (error) {
          candidate.setupError = error instanceof Error ? error.message : String(error);
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
      })();
    }
    return result;
  };

  let engine: Probe['engine'] = null;
  Object.defineProperty(window, '__audioEngine__', {
    configurable: true,
    get: () => engine,
    set: (value: NonNullable<Probe['engine']>) => {
      engine = value;
      probe.engine = value;
      probe.engineExposedAt = performance.now();

      const initializeTone = value.initializeTone.bind(value);
      value.initializeTone = async () => {
        probe.toneInitStartedAt ??= performance.now();
        await initializeTone();
        probe.toneInitFinishedAt ??= performance.now();
      };

      const preload = value.preloadInstrumentsForTracks.bind(value);
      value.preloadInstrumentsForTracks = async (tracks: unknown[]) => {
        probe.preloadStartedAt ??= performance.now();
        await preload(tracks);
        probe.preloadFinishedAt ??= performance.now();

        // StepSequencer awaits this method immediately before scheduler.start().
        // Hold that application boundary until the audio-thread observer is
        // attached, so a late observer cannot mistake a later note for onset.
        const deadline = performance.now() + 2_000;
        let candidate: Candidate | undefined;
        while (performance.now() < deadline) {
          candidate = value.masterGain
            ? probe.candidates.find(entry => entry.source === value.masterGain)
            : undefined;
          if (candidate?.setupError !== null && candidate?.setupError !== undefined) {
            throw new Error(candidate.setupError);
          }
          if (candidate?.workletReadyAt !== null && candidate?.workletReadyAt !== undefined) {
            probe.schedulerBoundaryReleasedAt ??= performance.now();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        throw new Error('Cold-start worklet was not ready before the scheduler boundary');
      };
    },
  });
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((sorted.length - 1) * quantile)];
}

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

test('captures sampled first-use timing before deciding whether to warm a voice', async ({
  page,
  request,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'real master capture is Chromium-only');
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'the production Worker build intentionally omits the development-only PCM capture hook',
  );
  test.setTimeout(90_000);
  const { id } = await createSessionWithRetry(request, {
    tracks: [probeTrack('cold-sampled-probe', 'sampled:slap-bass', [0, 4, 8, 12])],
    tempo: 120,
    swing: 0,
    effects: LEGACY_MISSING_EFFECTS_STATE,
    version: 1,
  });

  await page.goto(`${API_BASE}/s/${id}`);
  await waitForAppReady(page);
  // A reversible edit gesture initializes the engine without starting the
  // transport, so capture can be armed before this instrument's first voice.
  // This deliberately does not claim that the whole audio graph is cold.
  const dormantStep = page.locator('.track-row').first().locator('.step-cell').nth(1);
  await dormantStep.click();
  await page.waitForFunction(() => {
    const globals = window as unknown as {
      __audioEngine__?: { isToneInitialized?: () => boolean; getMasterCaptureTaps?: () => unknown };
      __captureMaster__?: unknown;
    };
    return Boolean(
      globals.__audioEngine__?.isToneInitialized?.()
      && globals.__audioEngine__?.getMasterCaptureTaps?.()
      && globals.__captureMaster__,
    );
  }, undefined, { timeout: 30_000 });
  await dormantStep.click();

  const capturePromise = page.evaluate(async () => {
    type Capture = {
      sampleRate: number;
      startFrame: number;
      taps: Record<string, { channels: Float32Array[] }>;
    };
    const capture = await (window as unknown as {
      __captureMaster__: (seconds: number) => Promise<Capture>;
    }).__captureMaster__(3.2);
    return {
      sampleRate: capture.sampleRate,
      startFrame: capture.startFrame,
      preCompressor: Array.from(capture.taps.preCompressor.channels[0]),
      user: Array.from(capture.taps.userOutput.channels[0]),
    };
  });
  await page.waitForTimeout(100);
  const playButton = page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first();
  await playButton.evaluate((element) => {
    element.addEventListener('click', () => {
      const globals = window as unknown as {
        __audioEngine__: { getAudioContext: () => AudioContext | null };
        __coldPlayClickContextTime__?: number;
      };
      globals.__coldPlayClickContextTime__ =
        globals.__audioEngine__.getAudioContext()?.currentTime ?? 0;
    }, { capture: true, once: true });
  });
  await playButton.click();
  const capture = await capturePromise;
  const clickContextTime = await page.evaluate(() => (
    (window as unknown as { __coldPlayClickContextTime__?: number })
      .__coldPlayClickContextTime__ ?? 0
  ));

  const threshold = 1e-4;
  const hitIntervalFrames = Math.round(capture.sampleRate * 0.5);
  // Scheduler callbacks can land on adjacent render quanta. Locate each real
  // onset near its expected half-second boundary before comparing level; using
  // the first onset plus exact intervals turns timing jitter into false RMS
  // variation when a fixed analysis window clips a sample's decay.
  const onsetSearchRadiusFrames = Math.round(capture.sampleRate * 0.02);
  const findHitStarts = (samples: readonly number[], tapName: string) => {
    const firstHitFrame = samples.findIndex(value => Math.abs(value) >= threshold);
    if (firstHitFrame < 0) throw new Error(`No onset found in ${tapName}`);
    return Array.from({ length: 5 }, (_, index) => {
      if (index === 0) return firstHitFrame;
      const expectedFrame = firstHitFrame + index * hitIntervalFrames;
      const searchStart = Math.max(0, expectedFrame - onsetSearchRadiusFrames);
      const searchEnd = Math.min(samples.length, expectedFrame + onsetSearchRadiusFrames);
      const relativeOnset = samples
        .slice(searchStart, searchEnd)
        .findIndex(value => Math.abs(value) >= threshold);
      if (relativeOnset < 0) {
        throw new Error(`No onset found for ${tapName} sampled hit ${index + 1}`);
      }
      return searchStart + relativeOnset;
    });
  };
  const preCompressorHitStarts = findHitStarts(capture.preCompressor, 'pre-compressor');
  const userOutputHitStarts = findHitStarts(capture.user, 'user-output');
  const analysisWindowFrames = Math.round(capture.sampleRate * 0.3);
  expect(preCompressorHitStarts.at(-1)! + analysisWindowFrames)
    .toBeLessThanOrEqual(capture.preCompressor.length);
  expect(userOutputHitStarts.at(-1)! + analysisWindowFrames)
    .toBeLessThanOrEqual(capture.user.length);
  const preCompressorLevelVariation = hitLevelVariationDb(
    capture.preCompressor,
    preCompressorHitStarts,
    analysisWindowFrames,
  );
  const userOutputLevelVariation = hitLevelVariationDb(
    capture.user,
    userOutputHitStarts,
    analysisWindowFrames,
  );
  const firstHitFrame = userOutputHitStarts[0];
  const clickFrame = Math.round(clickContextTime * capture.sampleRate - capture.startFrame);
  const leadingSilenceMs = Math.max(0, firstHitFrame - clickFrame) / capture.sampleRate * 1_000;
  const preCompressorOnsetOffsetsFrames = preCompressorHitStarts.map((frame, index) =>
    frame - (preCompressorHitStarts[0] + index * hitIntervalFrames)
  );
  const userOutputOnsetOffsetsFrames = userOutputHitStarts.map((frame, index) =>
    frame - (userOutputHitStarts[0] + index * hitIntervalFrames)
  );
  const prefixFrames = 256;
  const first256PreCompressorFrames = {
    encoding: 'JSON array of exact Float32 samples',
    frames: prefixFrames,
    first: capture.preCompressor.slice(
      preCompressorHitStarts[0],
      preCompressorHitStarts[0] + prefixFrames,
    ),
    steady: capture.preCompressor.slice(
      preCompressorHitStarts[1],
      preCompressorHitStarts[1] + prefixFrames,
    ),
  };
  const coldEvidence = {
    leadingSilenceMs,
    preCompressorOnsetOffsetsFrames,
    userOutputOnsetOffsetsFrames,
    preCompressorLevelVariation,
    userOutputLevelVariation,
    first256PreCompressorFrames,
  };
  console.log('sampled first-use capture', {
    leadingSilenceMs,
    preCompressorOnsetOffsetsFrames,
    userOutputOnsetOffsetsFrames,
    preCompressorLevelVariation,
    userOutputLevelVariation,
  });

  mkdirSync(REPORT_DIR, { recursive: true });
  const report = JSON.stringify({
    schemaVersion: 3,
    fixture: 'first use of one priority-loaded sampled instrument, preinitialized dry master',
    sampleRate: capture.sampleRate,
    ...coldEvidence,
  }, null, 2) + '\n';
  writeFileSync(resolve(REPORT_DIR, 'browser-sampled-first-use-capture.json'), report);
  const receiptTag = process.env.SAMPLED_FIRST_USE_RECEIPT_TAG;
  if (receiptTag) {
    if (!/^[a-z0-9-]+$/.test(receiptTag)) {
      throw new Error('SAMPLED_FIRST_USE_RECEIPT_TAG must contain only lowercase letters, digits, and hyphens');
    }
    writeFileSync(
      resolve(
        REPORT_DIR,
        `browser-sampled-first-use-capture-${receiptTag}-${String(testInfo.repeatEachIndex + 1).padStart(2, '0')}.json`,
      ),
      report,
    );
  }

  expect(leadingSilenceMs).toBeLessThanOrEqual(500);
  expect(Math.max(...preCompressorOnsetOffsetsFrames.map(Math.abs)))
    .toBeLessThanOrEqual(onsetSearchRadiusFrames);
  expect(Math.max(...userOutputOnsetOffsetsFrames.map(Math.abs)))
    .toBeLessThanOrEqual(onsetSearchRadiusFrames);
  // Voice warm-up and late scheduling affect the sampled source path, while
  // the stateful master compressor/limiter can add its own variation. Gate the
  // causal pre-compressor tap and retain user-output spread as a diagnostic.
  expect(preCompressorLevelVariation.peakSpreadDb).toBeLessThanOrEqual(0.01);
  expect(preCompressorLevelVariation.rmsSpreadDb).toBeLessThanOrEqual(0.01);
});

test('measures cold Tone, advanced, and whole-engine action-to-first-master-PCM startup', async ({
  browser,
  request,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'real startup audio is Chromium-only');
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'the production Worker build intentionally omits the development-only startup probe',
  );
  test.setTimeout(180_000);

  // Prove the injected observer itself before using it as an oracle. The
  // explicit-undefined overload catches wrappers that accidentally shift the
  // destination input argument, while the blocked main thread proves that the
  // worklet retains the audio-render frame instead of timing a late callback.
  const controlContext = await createE2EContext(browser, browserName);
  await controlContext.addInitScript(installColdStartupProbe);
  const controlPage = await controlContext.newPage();
  await controlPage.goto(API_BASE);
  const probeControl = await controlPage.evaluate(async () => {
    type ControlCandidate = {
      source: GainNode;
      workletReadyAt: number | null;
      firstPcmContextTime: number | null;
      firstFrameReceivedAt: number | null;
      silentFramesBeforeFirstPcm: number | null;
      setupError: string | null;
    };
    const probe = (window as unknown as {
      __coldStartupProbe__: { candidates: ControlCandidate[]; setupDelayMs: number };
    }).__coldStartupProbe__;
    const audioContext = new AudioContext();
    await audioContext.resume();

    const overloadSource = audioContext.createGain();
    const merger = audioContext.createChannelMerger(2);
    Reflect.apply(overloadSource.connect, overloadSource, [merger, undefined, 1]);
    const parameterDestination = audioContext.createGain();
    overloadSource.connect(parameterDestination.gain, 0);
    overloadSource.disconnect();

    const master = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    const outputSink = audioContext.createGain();
    outputSink.gain.value = 0;
    master.connect(compressor);
    compressor.connect(outputSink);
    outputSink.connect(audioContext.destination);
    const candidate = probe.candidates.find(entry => entry.source === master);
    if (!candidate) throw new Error('AudioWorklet startup control was not attached');
    while (candidate.workletReadyAt === null && candidate.setupError === null) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (candidate.setupError !== null) throw new Error(candidate.setupError);

    const source = audioContext.createConstantSource();
    source.offset.value = 0.25;
    source.connect(master);
    const scheduledContextTime = audioContext.currentTime + 0.1;
    source.start(scheduledContextTime);
    source.stop(scheduledContextTime + 0.1);
    const blockedAt = performance.now();
    while (performance.now() - blockedAt < 700) {
      // Deliberately occupy the main thread across the scheduled audio onset.
    }
    while (candidate.firstPcmContextTime === null && candidate.setupError === null) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (candidate.setupError !== null) throw new Error(candidate.setupError);
    const result = {
      sampleRate: audioContext.sampleRate,
      scheduledContextTime,
      observedContextTime: candidate.firstPcmContextTime,
      retainedFrameErrorMs:
        (candidate.firstPcmContextTime - scheduledContextTime) * 1_000,
      mainThreadBlockedMs: performance.now() - blockedAt,
      messageReceived: candidate.firstFrameReceivedAt !== null,
      silentFramesBeforeFirstPcm: candidate.silentFramesBeforeFirstPcm,
      explicitUndefinedConnectOverload: 'preserved',
      audioParamConnectOverload: 'preserved',
      delayedInstallSilentFrames: null as number | null,
      delayedInstallObservedOnsetErrorMs: null as number | null,
      delayedInstallBoundaryViolation: false,
      delayedInstallRejected: false,
    };
    await audioContext.close();

    probe.setupDelayMs = 250;
    const lateContext = new AudioContext();
    await lateContext.resume();
    const lateMaster = lateContext.createGain();
    const lateCompressor = lateContext.createDynamicsCompressor();
    const lateSink = lateContext.createGain();
    lateSink.gain.value = 0;
    lateMaster.connect(lateCompressor);
    lateCompressor.connect(lateSink);
    lateSink.connect(lateContext.destination);
    const lateCandidate = probe.candidates.find(entry => entry.source === lateMaster);
    if (!lateCandidate) throw new Error('Delayed-installation control was not attached');
    const lateSource = lateContext.createConstantSource();
    const lateGate = lateContext.createGain();
    lateSource.offset.value = 0.25;
    lateGate.gain.value = 0;
    lateSource.connect(lateGate);
    const sourceBoundaryAt = performance.now();
    lateGate.connect(lateMaster);
    const firstPulseAt = lateContext.currentTime + 0.02;
    for (const offset of [0, 0.4, 0.8]) {
      lateGate.gain.setValueAtTime(1, firstPulseAt + offset);
      lateGate.gain.setValueAtTime(0, firstPulseAt + offset + 0.02);
    }
    lateSource.start(firstPulseAt);
    lateSource.stop(firstPulseAt + 1);
    while (lateCandidate.firstPcmContextTime === null && lateCandidate.setupError === null) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (lateCandidate.setupError !== null) throw new Error(lateCandidate.setupError);
    result.delayedInstallSilentFrames = lateCandidate.silentFramesBeforeFirstPcm;
    result.delayedInstallObservedOnsetErrorMs =
      (lateCandidate.firstPcmContextTime! - firstPulseAt) * 1_000;
    result.delayedInstallBoundaryViolation = lateCandidate.workletReadyAt! > sourceBoundaryAt;
    result.delayedInstallRejected =
      result.delayedInstallBoundaryViolation
      && result.delayedInstallObservedOnsetErrorMs > 200
      && lateCandidate.silentFramesBeforeFirstPcm! > 0;
    probe.setupDelayMs = 0;
    await lateContext.close();
    return result;
  });
  await controlContext.close();
  expect(probeControl.messageReceived).toBe(true);
  expect(probeControl.mainThreadBlockedMs).toBeGreaterThanOrEqual(700);
  expect(probeControl.silentFramesBeforeFirstPcm).toBeGreaterThan(0);
  expect(probeControl.delayedInstallSilentFrames).toBeGreaterThan(0);
  expect(probeControl.delayedInstallObservedOnsetErrorMs).toBeGreaterThan(200);
  expect(probeControl.delayedInstallBoundaryViolation).toBe(true);
  expect(probeControl.delayedInstallRejected).toBe(true);
  expect(Math.abs(probeControl.retainedFrameErrorMs))
    .toBeLessThanOrEqual(256 / probeControl.sampleRate * 1_000);

  const results: Record<string, Array<Record<string, number | string | null>>> = {};
  for (const scenario of COLD_START_SCENARIOS) {
    results[scenario.id] = [];
    for (let trial = 0; trial < COLD_START_TRIALS; trial++) {
      const { id } = await createSessionWithRetry(request, {
        tracks: [probeTrack(`cold-${scenario.id}-${trial}`, scenario.sampleId, [0, 4, 8, 12])],
        tempo: 120,
        swing: 0,
        effects: LEGACY_MISSING_EFFECTS_STATE,
        version: 1,
      });
      const context = await createE2EContext(browser, browserName);
      await context.addInitScript(installColdStartupProbe);
      const page = await context.newPage();
      try {
        await page.goto(`${API_BASE}/s/${id}`);
        await waitForAppReady(page);
        const playButton = page
          .locator('[data-testid="play-button"]')
          .or(page.getByRole('button', { name: /play/i }))
          .first();
        await playButton.evaluate((element) => {
          element.addEventListener('click', () => {
            const probe = (window as unknown as {
              __coldStartupProbe__: { clickAt: number | null };
            }).__coldStartupProbe__;
            probe.clickAt = performance.now();
          }, { capture: true, once: true });
        });
        await playButton.click();
        await page.waitForFunction(() => {
          const globals = window as unknown as {
            __coldStartupProbe__?: {
              engine: { masterGain: GainNode | null } | null;
              candidates: Array<{
                source: GainNode;
                firstPcmAt: number | null;
                setupError: string | null;
              }>;
            };
          };
          const probe = globals.__coldStartupProbe__;
          const master = probe?.engine?.masterGain;
          const candidate = master
            ? probe?.candidates.find(entry => entry.source === master)
            : undefined;
          return Boolean(
            master
            && (candidate?.firstPcmAt != null || candidate?.setupError != null)
          );
        }, undefined, { timeout: 15_000 });

        const observation = await page.evaluate(() => {
          const probe = (window as unknown as {
            __coldStartupProbe__: {
              clickAt: number;
              engineExposedAt: number;
              toneInitStartedAt: number | null;
              toneInitFinishedAt: number | null;
              preloadStartedAt: number | null;
              preloadFinishedAt: number | null;
              schedulerBoundaryReleasedAt: number;
              engine: { masterGain: GainNode; getAudioContext: () => AudioContext | null };
              candidates: Array<{
                source: GainNode;
                attachedAt: number;
                workletReadyAt: number;
                firstPcmAt: number;
                firstFrameReceivedAt: number;
                firstPcmContextTime: number;
                silentFramesBeforeFirstPcm: number;
                setupError: string | null;
                peak: number;
              }>;
            };
          }).__coldStartupProbe__;
          const candidate = probe.candidates.find(entry => entry.source === probe.engine.masterGain);
          if (!candidate) throw new Error('Master startup tap was not attached');
          if (candidate.setupError !== null) throw new Error(candidate.setupError);
          const relative = (value: number | null) => value === null ? null : value - probe.clickAt;
          return {
            trial: 0,
            sampleRate: probe.engine.getAudioContext()?.sampleRate ?? 0,
            clickToMasterGraphMs: candidate.attachedAt - probe.clickAt,
            clickToWorkletReadyMs: candidate.workletReadyAt - probe.clickAt,
            clickToEngineExposedMs: probe.engineExposedAt - probe.clickAt,
            clickToToneInitStartMs: relative(probe.toneInitStartedAt),
            clickToToneReadyMs: relative(probe.toneInitFinishedAt),
            clickToPreloadStartMs: relative(probe.preloadStartedAt),
            clickToPreloadReadyMs: relative(probe.preloadFinishedAt),
            clickToSchedulerBoundaryReleaseMs:
              probe.schedulerBoundaryReleasedAt - probe.clickAt,
            clickToMasterPcmMs: candidate.firstPcmAt - probe.clickAt,
            messageLagMs: candidate.firstFrameReceivedAt - candidate.firstPcmAt,
            firstPcmContextTime: candidate.firstPcmContextTime,
            silentFramesBeforeFirstPcm: candidate.silentFramesBeforeFirstPcm,
            clockMapping: 'audio-frame/getOutputTimestamp',
            peak: candidate.peak,
          };
        });
        observation.trial = trial + 1;
        expect(observation.clockMapping).toBe('audio-frame/getOutputTimestamp');
        expect(observation.sampleRate).toBeGreaterThanOrEqual(44_100);
        expect(observation.clickToMasterPcmMs).toBeGreaterThanOrEqual(0);
        expect(observation.clickToMasterPcmMs).toBeLessThan(5_000);
        expect(observation.clickToWorkletReadyMs).toBeLessThan(observation.clickToMasterPcmMs);
        expect(observation.clickToWorkletReadyMs)
          .toBeLessThanOrEqual(observation.clickToSchedulerBoundaryReleaseMs);
        expect(observation.clickToSchedulerBoundaryReleaseMs)
          .toBeLessThan(observation.clickToMasterPcmMs);
        expect(observation.peak).toBeGreaterThanOrEqual(1e-4);
        results[scenario.id].push(observation);
      } finally {
        await context.close();
      }
    }
  }

  const summary = Object.fromEntries(Object.entries(results).map(([scenario, trials]) => {
    const firstPcm = trials.map(trial => trial.clickToMasterPcmMs as number);
    const engine = trials.map(trial => trial.clickToEngineExposedMs as number);
    const tone = trials
      .map(trial => trial.clickToToneReadyMs)
      .filter((value): value is number => typeof value === 'number');
    return [scenario, {
      trials: firstPcm.length,
      clickToMasterPcmMs: {
        min: Math.min(...firstPcm),
        median: percentile(firstPcm, 0.5),
        p95: percentile(firstPcm, 0.95),
        max: Math.max(...firstPcm),
      },
      clickToEngineExposedMs: {
        min: Math.min(...engine),
        median: percentile(engine, 0.5),
        p95: percentile(engine, 0.95),
        max: Math.max(...engine),
      },
      clickToToneReadyMs: tone.length === 0 ? null : {
        min: Math.min(...tone),
        median: percentile(tone, 0.5),
        p95: percentile(tone, 0.95),
        max: Math.max(...tone),
      },
    }];
  }));
  console.log('cold startup matrix', summary);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'browser-cold-startup-matrix.json'),
    JSON.stringify({
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      fixture: 'fresh browser context, warm local server, first transport click and first master-bus sample',
      oracle: 'AudioWorklet-retained absolute render frame mapped through AudioContext.getOutputTimestamp(); readiness precedes the awaited scheduler-release boundary',
      threshold: 1e-4,
      probeControl,
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        browser: `${browserName} ${browser.version()}`,
      },
      summary,
      observations: results,
    }, null, 2) + '\n',
  );
});

test('proves the default-room bounds and a production-path legacy dry render', async ({
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

  const legacyState = {
    tracks: [probeTrack('legacy-room-probe', 'synth:lead', [0, 4, 8, 12])],
    tempo: 120,
    swing: 0,
    version: 1,
  };
  const { id } = await createSessionWithRetry(request, legacyState);
  const stored = await request.put(`${API_BASE}/api/sessions/${id}`, {
    data: { state: legacyState },
  });
  expect(stored.ok()).toBe(true);

  await page.goto(`${API_BASE}/s/${id}`);
  await waitForAppReady(page);
  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first()
    .click();
  await page.waitForFunction(() => {
    const globals = window as unknown as {
      __audioEngine__?: { isToneInitialized?: () => boolean };
      __captureMaster__?: unknown;
    };
    return Boolean(globals.__audioEngine__?.isToneInitialized?.() && globals.__captureMaster__);
  }, undefined, { timeout: 30_000 });
  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /pause|stop/i }))
    .first()
    .click();
  await page.waitForTimeout(500);

  const captures = await page.evaluate(async ({ explicitDry, newSession }) => {
    type Capture = {
      sampleRate: number;
      startFrame: number;
      taps: Record<string, { channels: Float32Array[] }>;
    };
    type Effects = typeof explicitDry;
    type Engine = {
      getAudioContext: () => AudioContext | null;
      getEffectsState: () => Effects;
      applyEffectsState: (effects: Effects) => void;
      masterGain: GainNode | null;
    };
    const globals = window as unknown as {
      __audioEngine__: Engine;
      __captureMaster__: (seconds: number) => Promise<Capture>;
    };
    const context = globals.__audioEngine__.getAudioContext();
    const masterInput = globals.__audioEngine__.masterGain;
    if (!context || !masterInput) throw new Error('Master input unavailable for room capture');

    const hydratedEffects = globals.__audioEngine__.getEffectsState();
    const runProbe = async (effects: Effects | null) => {
      if (effects) globals.__audioEngine__.applyEffectsState(effects);
      // Effects parameters slew and the master compressor has finite recovery.
      await new Promise(resolve => setTimeout(resolve, 350));

      const startTime = context.currentTime + 0.15;
      const programFrames = Math.round(context.sampleRate * 0.8);
      const buffer = context.createBuffer(1, programFrames, context.sampleRate);
      const pcm = buffer.getChannelData(0);
      for (let frame = 0; frame < pcm.length; frame++) {
        const edge = Math.min(1, frame / 128, (pcm.length - 1 - frame) / 128);
        const bass = 0.025 * Math.max(0, edge)
          * Math.sin(2 * Math.PI * 110 * frame / context.sampleRate);
        const burstSeconds = frame / context.sampleRate - 0.65;
        const burst = burstSeconds >= 0 && burstSeconds < 0.07
          ? 0.045 * (1 - burstSeconds / 0.07) * (
            Math.sin(2 * Math.PI * 1_300 * burstSeconds)
            + 0.7 * Math.sin(2 * Math.PI * 2_900 * burstSeconds + 0.4)
            + 0.4 * Math.sin(2 * Math.PI * 5_100 * burstSeconds + 1.1)
          )
          : 0;
        pcm[frame] = bass + burst;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(masterInput);
      source.start(startTime);

      const capture = await globals.__captureMaster__(1.35);
      return {
        sampleRate: capture.sampleRate,
        programStartFrame: Math.round(startTime * capture.sampleRate - capture.startFrame),
        user: Array.from(capture.taps.userOutput.channels[0]),
        pre: Array.from(capture.taps.preCompressor.channels[0]),
        post: Array.from(capture.taps.postMakeup.channels[0]),
      };
    };

    const legacy = await runProbe(null);
    const dry = await runProbe(explicitDry);
    const dryRepeat = await runProbe(explicitDry);
    const wet = await runProbe(newSession);
    return { hydratedEffects, legacy, dry, dryRepeat, wet };
  }, {
    explicitDry: LEGACY_MISSING_EFFECTS_STATE,
    newSession: NEW_SESSION_EFFECTS_STATE,
  });

  expect(captures.hydratedEffects).toEqual(LEGACY_MISSING_EFFECTS_STATE);
  const sampleRate = captures.dry.sampleRate as 44_100 | 48_000;
  expect(captures.legacy.sampleRate).toBe(sampleRate);
  expect(captures.wet.sampleRate).toBe(sampleRate);
  const relativeWindow = (
    capture: typeof captures.dry,
    fromSeconds: number,
    toSeconds: number,
    tap: 'user' | 'pre' | 'post' = 'user',
  ) => capture[tap].slice(
    capture.programStartFrame + Math.round(fromSeconds * sampleRate),
    capture.programStartFrame + Math.round(toSeconds * sampleRate),
  );

  const comparePrograms = (left: number[], right: number[]) => {
    const length = Math.min(left.length, right.length);
    let leftEnergy = 0;
    let residualEnergy = 0;
    for (let frame = 0; frame < length; frame++) {
      leftEnergy += left[frame] ** 2;
      residualEnergy += (left[frame] - right[frame]) ** 2;
    }
    return {
      residualDb: 10 * Math.log10(
        Math.max(residualEnergy, 1e-24) / Math.max(leftEnergy, 1e-24),
      ),
      spectralDistanceDb: logSpectralDistance(left, right),
    };
  };
  const legacyComparison = comparePrograms(
    relativeWindow(captures.legacy, 0, 0.78),
    relativeWindow(captures.dry, 0, 0.78),
  );
  const repeatNull = comparePrograms(
    relativeWindow(captures.dry, 0, 0.78),
    relativeWindow(captures.dryRepeat, 0, 0.78),
  );

  // The final authored burst ends at 0.72 s, so this starts 300 ms later.
  const dryTail = relativeWindow(captures.dry, 1.02, 1.30);
  const wetTail = relativeWindow(captures.wet, 1.02, 1.30);
  const fullBandTailRiseDb = bandRmsDb(wetTail, sampleRate, 20, 20_000)
    - bandRmsDb(dryTail, sampleRate, 20, 20_000);
  const highBandTailRiseDb = bandRmsDb(wetTail, sampleRate, 500, 20_000)
    - bandRmsDb(dryTail, sampleRate, 500, 20_000);
  const dryBody = relativeWindow(captures.dry, 0.15, 0.55);
  const wetBody = relativeWindow(captures.wet, 0.15, 0.55);
  const lowBandDeltaDb = bandRmsDb(wetBody, sampleRate, 20, 275)
    - bandRmsDb(dryBody, sampleRate, 20, 275);
  const dryPeakDbfs = truePeakDbfs(captures.dry.user);
  const repeatNullPeakDeltaDb = truePeakDbfs(captures.dryRepeat.user) - dryPeakDbfs;
  const peakDeltaDb = truePeakDbfs(captures.wet.user) - dryPeakDbfs;
  const loudnessDeltaLu = loudnessKMax(Float32Array.from(captures.wet.user), sampleRate)
    - loudnessKMax(Float32Array.from(captures.dry.user), sampleRate);
  const latencyFrames = estimateLatencyFrames(
    relativeWindow(captures.dry, 0, 0.95, 'pre'),
    relativeWindow(captures.dry, 0, 0.95, 'post'),
    Math.round(sampleRate * 0.02),
  );
  const dryPumping = pumpingProfile(
    relativeWindow(captures.dry, 0, 0.95, 'pre'),
    relativeWindow(captures.dry, 0, 0.95, 'post'),
    sampleRate,
    { latencyFrames },
  );
  const wetPumping = pumpingProfile(
    relativeWindow(captures.wet, 0, 0.95, 'pre'),
    relativeWindow(captures.wet, 0, 0.95, 'post'),
    sampleRate,
    { latencyFrames },
  );
  const pumpingDeltaDb = wetPumping.maxAttenuationDb - dryPumping.maxAttenuationDb;

  const roomEvidence = {
    legacyResidualDb: legacyComparison.residualDb,
    legacySpectralDistanceDb: legacyComparison.spectralDistanceDb,
    repeatNullResidualDb: repeatNull.residualDb,
    repeatNullSpectralDistanceDb: repeatNull.spectralDistanceDb,
    fullBandTailRiseDb,
    highBandTailRiseDb,
    lowBandDeltaDb,
    peakDeltaDb,
    repeatNullPeakDeltaDb,
    loudnessDeltaLu,
    pumpingDeltaDb,
    latencyFrames,
  };
  console.log('default-room and legacy render capture', roomEvidence);

  // A live AudioWorklet capture is not byte-stable across wall-clock runs, so
  // compare legacy hydration with the same-build explicit-dry repeat floor.
  expect(legacyComparison.residualDb).toBeLessThanOrEqual(repeatNull.residualDb + 3);
  expect(legacyComparison.spectralDistanceDb)
    .toBeLessThanOrEqual(repeatNull.spectralDistanceDb + 0.25);
  expect(fullBandTailRiseDb).toBeGreaterThan(1);
  expect(highBandTailRiseDb).toBeGreaterThan(1);
  expect(Math.abs(lowBandDeltaDb)).toBeLessThanOrEqual(0.3);
  // Wall-clock AudioWorklet captures are not bit-stable. Treat any apparent
  // increase inside the explicit-dry repeat floor (plus 0.01 dB numerical
  // margin) as unchanged, rather than asserting impossible exact equality.
  expect(peakDeltaDb).toBeLessThanOrEqual(Math.abs(repeatNullPeakDeltaDb) + 0.01);
  expect(loudnessDeltaLu).toBeLessThanOrEqual(1);
  expect(pumpingDeltaDb).toBeLessThanOrEqual(0.1);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'browser-room-capture.json'),
    JSON.stringify({
      schemaVersion: 1,
      fixture: 'legacy hydration plus deterministic bass-and-room probe',
      sampleRate,
      ...roomEvidence,
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

  const captured = await page.evaluate(async (newSession) => {
    type Capture = {
      sampleRate: number;
      maxRenderFrameDrift: number;
      taps: Record<string, { channels: Float32Array[] }>;
    };
    const globals = window as unknown as {
      __captureMaster__: (seconds: number) => Promise<Capture>;
      __audioEngine__: { applyEffectsState: (effects: typeof newSession) => void };
    };
    globals.__audioEngine__.applyEffectsState(newSession);
    await new Promise(resolve => setTimeout(resolve, 350));
    const capture = await globals.__captureMaster__(2.1);
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
      capacityProgramChannels: capture.taps.preCompressor.channels.map(channel => Array.from(channel)),
    };
  }, NEW_SESSION_EFFECTS_STATE);

  // Stop the live scheduler before replaying its captured 16-track programme.
  // Comparing two independently scheduled live windows is not a paired test:
  // source phase and render-quantum placement vary enough to swamp a 0.1 dB
  // pumping budget. Replaying the exact captured input keeps the production
  // graph and capacity-level waveform while changing only the room state.
  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /pause|stop/i }))
    .first()
    .click();
  await page.waitForTimeout(350);

  const replay = await page.evaluate(async ({ explicitDry, newSession, programChannels }) => {
    type Capture = {
      sampleRate: number;
      startFrame: number;
      maxRenderFrameDrift: number;
      taps: Record<string, { channels: Float32Array[] }>;
    };
    type Effects = typeof explicitDry;
    type Engine = {
      applyEffectsState: (effects: Effects) => void;
      getAudioContext: () => AudioContext | null;
      masterGain: GainNode | null;
    };
    const globals = window as unknown as {
      __captureMaster__: (seconds: number) => Promise<Capture>;
      __audioEngine__: Engine;
    };
    const context = globals.__audioEngine__.getAudioContext();
    const masterInput = globals.__audioEngine__.masterGain;
    if (!context || !masterInput) throw new Error('Master input unavailable for capacity replay');
    const programFrames = Math.min(...programChannels.map(channel => channel.length));
    const programSeconds = programFrames / context.sampleRate;

    const runReplay = async (effects: Effects) => {
      globals.__audioEngine__.applyEffectsState(effects);
      await new Promise(resolve => setTimeout(resolve, 350));
      const buffer = context.createBuffer(programChannels.length, programFrames, context.sampleRate);
      programChannels.forEach((channel, index) => {
        buffer.copyToChannel(Float32Array.from(channel.slice(0, programFrames)), index);
      });
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(masterInput);
      const startTime = context.currentTime + 0.15;
      source.start(startTime);
      const capture = await globals.__captureMaster__(programSeconds + 0.3);
      const programStartFrame = Math.round(startTime * capture.sampleRate - capture.startFrame);
      const paddingFrames = Math.round(capture.sampleRate * 0.05);
      const analysisStart = Math.max(0, programStartFrame - paddingFrames);
      const analysisEnd = programStartFrame + programFrames + paddingFrames;
      return {
        maxRenderFrameDrift: capture.maxRenderFrameDrift,
        pre: Array.from(capture.taps.preCompressor.channels[0].slice(analysisStart, analysisEnd)),
        post: Array.from(capture.taps.postMakeup.channels[0].slice(analysisStart, analysisEnd)),
      };
    };

    return {
      dry: await runReplay(explicitDry),
      wet: await runReplay(newSession),
    };
  }, {
    explicitDry: LEGACY_MISSING_EFFECTS_STATE,
    newSession: NEW_SESSION_EFFECTS_STATE,
    programChannels: captured.capacityProgramChannels,
  });

  const userOutputTruePeakDbfs = Math.max(...captured.userOutputChannels.map(channel =>
    truePeakDbfs(channel)
  ));
  const latencyFrames = estimateLatencyFrames(
    replay.dry.pre,
    replay.dry.post,
    Math.round(captured.sampleRate * 0.02),
  );
  const dryPumping = pumpingProfile(replay.dry.pre, replay.dry.post, captured.sampleRate, {
    latencyFrames,
  });
  const wetPumping = pumpingProfile(replay.wet.pre, replay.wet.post, captured.sampleRate, {
    latencyFrames,
  });
  const capacityPumpingDeltaDb = wetPumping.maxAttenuationDb - dryPumping.maxAttenuationDb;
  const {
    userOutputChannels: _userOutputChannels,
    capacityProgramChannels: _capacityProgramChannels,
    ...result
  } = captured;
  void _userOutputChannels;
  void _capacityProgramChannels;
  Object.assign(result, {
    userOutputTruePeakDbfs,
    capacityPumpingDeltaDb,
    dryMaxAttenuationDb: dryPumping.maxAttenuationDb,
    wetMaxAttenuationDb: wetPumping.maxAttenuationDb,
    latencyFrames,
  });

  console.log('16-track session capture', result);
  expect(result.trackCount).toBe(16);
  expect(result.maxRenderFrameDrift).toBeLessThanOrEqual(MAX_CAPTURE_RENDER_DRIFT_FRAMES);
  expect(replay.dry.maxRenderFrameDrift).toBeLessThanOrEqual(MAX_CAPTURE_RENDER_DRIFT_FRAMES);
  expect(replay.wet.maxRenderFrameDrift).toBeLessThanOrEqual(MAX_CAPTURE_RENDER_DRIFT_FRAMES);
  expect(result.summaries.preCompressor.rms).toBeGreaterThan(1e-5);
  expect(result.summaries.userOutput.rms).toBeGreaterThan(1e-5);
  expect(result.summaries.userOutput.peakDbfs).toBeLessThanOrEqual(0);
  expect(userOutputTruePeakDbfs).toBeLessThanOrEqual(0);
  expect(capacityPumpingDeltaDb).toBeLessThanOrEqual(0.1);

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
