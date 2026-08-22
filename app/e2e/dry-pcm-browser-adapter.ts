import { randomUUID } from 'node:crypto';

import { chromium, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import {
  expectedMatrixFrameCount,
  MATRIX_SAMPLE_RATE,
  type DryPcmCapture,
  type DryPcmMatrixCase,
} from '../scripts/instrument-quality-matrix';
import { createE2EContext } from './browser-context';

const TOTAL_STEPS = 128;
const CAPTURE_LEAD_SECONDS = 0.35;

/**
 * Test-only recorder. It receives the real TrackBus output after the centered
 * pan/output stages and before the master/effects chain. The worklet copies
 * one uninterrupted render interval. AudioWorklet currentFrame is the
 * authoritative render-clock index: any discontinuity is returned as render
 * drift and rejected by the adapter.
 */
const CAPTURE_WORKLET_SOURCE = String.raw`
class KeyboardiaDryPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = false;
    this.startFrame = 0;
    this.frameCount = 0;
    this.capturedFrames = 0;
    this.maxRenderFrameDrift = 0;
    this.left = null;
    this.right = null;
    this.attemptId = '';
    this.port.onmessage = event => {
      if (event.data.type !== 'arm') return;
      const startFrame = Math.floor(event.data.startFrame);
      const frameCount = Math.floor(event.data.frameCount);
      if (startFrame <= currentFrame || frameCount <= 0) {
        this.port.postMessage({
          type: 'error',
          message: 'Capture arm point is not in the future or has no frames',
        });
        return;
      }
      this.startFrame = startFrame;
      this.frameCount = frameCount;
      this.capturedFrames = 0;
      this.maxRenderFrameDrift = 0;
      this.left = new Float32Array(frameCount);
      this.right = new Float32Array(frameCount);
      this.attemptId = event.data.attemptId;
      this.armed = true;
      this.port.postMessage({ type: 'armed', startFrame, frameCount });
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) for (const channel of output) channel.fill(0);
    if (!this.armed) return true;

    const input = inputs[0] || [];
    const quantumFrames = input[0]?.length || output?.[0]?.length || 128;
    const quantumEnd = currentFrame + quantumFrames;
    if (quantumEnd <= this.startFrame) return true;

    const sourceOffset = this.capturedFrames === 0
      ? Math.max(0, this.startFrame - currentFrame)
      : 0;
    const actualFrame = currentFrame + sourceOffset;
    const expectedFrame = this.startFrame + this.capturedFrames;
    this.maxRenderFrameDrift = Math.max(
      this.maxRenderFrameDrift,
      Math.abs(actualFrame - expectedFrame),
    );
    const length = Math.min(
      quantumFrames - sourceOffset,
      this.frameCount - this.capturedFrames,
    );
    if (length <= 0) return true;

    const leftInput = input[0] || new Float32Array(quantumFrames);
    const rightInput = input[1] || leftInput;
    this.left.set(leftInput.subarray(sourceOffset, sourceOffset + length), this.capturedFrames);
    this.right.set(rightInput.subarray(sourceOffset, sourceOffset + length), this.capturedFrames);
    this.capturedFrames += length;

    if (this.capturedFrames === this.frameCount) {
      this.armed = false;
      const left = this.left.buffer;
      const right = this.right.buffer;
      this.port.postMessage({
        type: 'done',
        attemptId: this.attemptId,
        startFrame: this.startFrame,
        frameCount: this.frameCount,
        capturedFrames: this.capturedFrames,
        maxRenderFrameDrift: this.maxRenderFrameDrift,
        channels: [left, right],
      }, [left, right]);
    }
    return true;
  }
}

registerProcessor('keyboardia-dry-pcm-capture', KeyboardiaDryPcmCaptureProcessor);
`;

export interface BrowserCaptureDiagnostics {
  captureAttemptId: string;
  caseId: string;
  sessionId: string;
  trackId: string;
  randomSeed: number;
  randomAlgorithm: 'mulberry32';
  randomCalls: number;
  scheduleLeadFrames: number;
  maxRenderFrameDrift: number;
  tap: 'track-bus-output-post-pan-pre-master';
  effectsEnabled: false;
  pan: 0;
  audioContextSampleRate: typeof MATRIX_SAMPLE_RATE;
  latencyHint: 'playback';
  browserVersion: string;
  userAgent: string;
}

export interface ChromiumDryPcmCaptureAdapterOptions {
  browser: Browser;
  request: APIRequestContext;
  baseUrl: string;
}

export interface ChromiumIsolatedDryPcmCaptureAdapterOptions {
  request: APIRequestContext;
  baseUrl: string;
}

function inactiveTrack(trackId: string, instrumentId: string): Record<string, unknown> {
  return {
    id: trackId,
    name: `Quality capture: ${instrumentId}`,
    sampleId: instrumentId,
    steps: Array(TOTAL_STEPS).fill(false),
    parameterLocks: Array(TOTAL_STEPS).fill(null),
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };
}

async function createSession(
  request: APIRequestContext,
  baseUrl: string,
  trackId: string,
  instrumentId: string,
): Promise<string> {
  const response = await request.post(`${baseUrl}/api/sessions`, {
    data: {
      tracks: [inactiveTrack(trackId, instrumentId)],
      tempo: 120,
      swing: 0,
      version: 1,
    },
  });
  if (!response.ok()) {
    throw new Error(`Could not create quality-capture session: ${response.status()} ${response.statusText()}`);
  }
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error('Quality-capture session response did not contain an ID');
  }
  return body.id;
}

async function waitForSession(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.track-row').waitFor({ state: 'visible', timeout: 20_000 });
}

async function prepareProductionAudio(page: Page, matrixCase: DryPcmMatrixCase, trackId: string): Promise<void> {
  const playButton = page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first();
  await playButton.click();
  await page.waitForFunction(() => {
    const engine = (window as unknown as {
      __audioEngine__?: { isInitialized?: () => boolean; getAudioContext?: () => AudioContext | null };
    }).__audioEngine__;
    return Boolean(engine?.isInitialized?.() && engine.getAudioContext?.());
  }, undefined, { timeout: 30_000 });

  await page.evaluate(async ({ instrumentId, id }) => {
    type PreparedEngine = {
      getAudioContext: () => AudioContext | null;
      initializeTone: () => Promise<void>;
      isToneInitialized: () => boolean;
      preloadInstrumentsForTracks: (tracks: Array<{ id: string; sampleId: string }>) => Promise<void>;
      setEffectsEnabled: (enabled: boolean) => void;
      areEffectsEnabled: () => boolean;
      setTrackVolume: (trackId: string, volume: number) => void;
      setTrackPan: (trackId: string, pan: number) => void;
    };
    const engine = (window as unknown as { __audioEngine__?: PreparedEngine }).__audioEngine__;
    if (!engine) throw new Error('Production AudioEngine is unavailable');
    if (instrumentId.startsWith('tone:') || instrumentId.startsWith('advanced:')) {
      if (!engine.isToneInitialized()) await engine.initializeTone();
    }
    await engine.preloadInstrumentsForTracks([{ id, sampleId: instrumentId }]);

    // Progressive sample loading deliberately makes the priority root playable
    // before the rest. A range matrix must wait for the real registry's
    // background decodes or it would measure a temporary nearest-root choice.
    if (instrumentId.startsWith('sampled:')) {
      const modulePath = '/src/audio/sampled-instrument.ts';
      const registryModule = await import(modulePath) as {
        sampledInstrumentRegistry: {
          get: (instrumentId: string) => { waitForBackgroundLoad: () => Promise<string> } | undefined;
        };
      };
      const instrument = registryModule.sampledInstrumentRegistry.get(instrumentId.slice('sampled:'.length));
      if (!instrument) throw new Error(`Sampled instrument ${instrumentId} was not registered`);
      const state = await instrument.waitForBackgroundLoad();
      if (state !== 'complete') throw new Error(`${instrumentId} background load ended in ${state}`);
    }

    engine.setEffectsEnabled(false);
    engine.setTrackVolume(id, 1);
    engine.setTrackPan(id, 0);
    const context = engine.getAudioContext();
    if (!context || context.sampleRate !== 44_100) {
      throw new Error(`Pinned 44100 Hz AudioContext unavailable (got ${context?.sampleRate ?? 'none'})`);
    }
    if (engine.areEffectsEnabled()) throw new Error('Effects bypass did not engage');
  }, { instrumentId: matrixCase.instrumentId, id: trackId });

  // The fixture contains no active steps; stopping still isolates the direct
  // matrix dispatch from the scheduler clock and its future loop iterations.
  await playButton.click();
  await page.waitForTimeout(50);
}

async function captureInPage(
  page: Page,
  matrixCase: DryPcmMatrixCase,
  trackId: string,
  captureAttemptId: string,
): Promise<{
  sampleRate: number;
  frameCount: number;
  capturedFrames: number;
  maxRenderFrameDrift: number;
  channels: number[][];
  randomCalls: number;
  scheduleLeadFrames: number;
  userAgent: string;
}> {
  return page.evaluate(async ({ captureCase, id, attemptId, workletSource, leadSeconds }) => {
    type TrackBus = { getOutputNode: () => AudioNode };
    type MatrixEngine = {
      getAudioContext: () => AudioContext | null;
      areEffectsEnabled: () => boolean;
      trackBusManager?: {
        getOrCreateBus: (trackId: string) => TrackBus;
        getActiveTrackIds: () => string[];
      };
      playSampledInstrument: (
        preset: string, noteId: string, midi: number, time: number, duration: number,
        volume: number, trackId: string, velocity: number,
      ) => void;
      playSynthNote: (
        noteId: string, preset: string, semitone: number, time: number, duration: number,
        volume: number, trackId: string, velocity: number,
      ) => void;
      playToneSynth: (
        preset: never, semitone: number, time: number, duration: number,
        volume: number, trackId: string, velocity: number,
      ) => void;
      playAdvancedSynth: (
        preset: string, semitone: number, time: number, duration: number,
        volume: number, trackId: string, velocity: number,
      ) => void;
      playSample: (
        sampleId: string, trackId: string, time: number, duration: number,
        semitone: number, volume: number, velocity: number, variationKey: string,
      ) => void;
    };
    type WorkletDone = {
      type: 'done';
      attemptId: string;
      frameCount: number;
      capturedFrames: number;
      maxRenderFrameDrift: number;
      channels: ArrayBuffer[];
    };
    type WorkletArmed = { type: 'armed'; startFrame: number; frameCount: number };
    type WorkletError = { type: 'error'; message: string };

    const globals = window as unknown as {
      __audioEngine__?: MatrixEngine;
      __qualityMatrixRandom__?: { seed: number; calls: number };
    };
    const engine = globals.__audioEngine__;
    const context = engine?.getAudioContext();
    const manager = engine?.trackBusManager;
    if (!engine || !context || !manager) throw new Error('Production track bus is unavailable');
    if (context.sampleRate !== captureCase.sampleRate) {
      throw new Error(`AudioContext is ${context.sampleRate} Hz, expected ${captureCase.sampleRate} Hz`);
    }
    if (engine.areEffectsEnabled()) throw new Error('Matrix capture requires effects bypass');

    const blobUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    const recorder = new AudioWorkletNode(context, 'keyboardia-dry-pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    const keepAlive = context.createGain();
    keepAlive.gain.value = 0;
    recorder.connect(keepAlive).connect(context.destination);
    const trackOutput = manager.getOrCreateBus(id).getOutputNode();
    trackOutput.connect(recorder);
    const activeTrackIds = manager.getActiveTrackIds();
    if (activeTrackIds.length !== 1 || activeTrackIds[0] !== id) {
      throw new Error(`Capture is not isolated to ${id}: ${activeTrackIds.join(', ')}`);
    }

    const frameCount = Math.round(captureCase.durationSeconds * context.sampleRate);
    const requestedStart = Math.ceil(
      (context.currentTime + leadSeconds) * context.sampleRate / 128,
    ) * 128;
    let armedResolve!: (message: WorkletArmed) => void;
    let doneResolve!: (message: WorkletDone) => void;
    let armedReject!: (error: Error) => void;
    let doneReject!: (error: Error) => void;
    let armedReceived = false;
    const armed = new Promise<WorkletArmed>((resolve, reject) => {
      armedResolve = resolve;
      armedReject = reject;
    });
    const done = new Promise<WorkletDone>((resolve, reject) => {
      doneResolve = resolve;
      doneReject = reject;
    });
    recorder.port.onmessage = (event: MessageEvent<WorkletDone | WorkletArmed | WorkletError>) => {
      if (event.data.type === 'armed') {
        armedReceived = true;
        armedResolve(event.data);
      }
      else if (event.data.type === 'done') doneResolve(event.data);
      else {
        const error = new Error(event.data.message);
        if (armedReceived) doneReject(error);
        else armedReject(error);
      }
    };
    const timeoutId = window.setTimeout(() => {
      const error = new Error(`Timed out capturing ${captureCase.id}`);
      if (armedReceived) doneReject(error);
      else armedReject(error);
    }, (captureCase.durationSeconds + leadSeconds + 8) * 1_000);
    recorder.port.postMessage({
      type: 'arm',
      startFrame: requestedStart,
      frameCount,
      attemptId,
    });
    const armedMessage = await armed;
    const startTime = armedMessage.startFrame / context.sampleRate;
    const scheduleLeadFrames = Math.floor((startTime - context.currentTime) * context.sampleRate);
    if (scheduleLeadFrames < Math.round(0.05 * context.sampleRate)) {
      throw new Error(
        `Main thread received the arm point too late (${scheduleLeadFrames} frames of lead)`,
      );
    }

    const preset = captureCase.instrumentId.includes(':')
      ? captureCase.instrumentId.slice(captureCase.instrumentId.indexOf(':') + 1)
      : captureCase.instrumentId;
    captureCase.notes.forEach((note, index) => {
      const absoluteTime = startTime + note.startSeconds;
      const noteId = `${attemptId}-note-${index}`;
      const semitone = note.midi - 60;
      if (captureCase.instrumentId.startsWith('sampled:')) {
        engine.playSampledInstrument(
          preset, noteId, note.midi, absoluteTime, note.gateSeconds, 1, id, note.velocity,
        );
      } else if (captureCase.instrumentId.startsWith('synth:')) {
        engine.playSynthNote(
          noteId, preset, semitone, absoluteTime, note.gateSeconds, 1, id, note.velocity,
        );
      } else if (captureCase.instrumentId.startsWith('tone:')) {
        engine.playToneSynth(
          preset as never, semitone, absoluteTime, note.gateSeconds, 1, id, note.velocity,
        );
      } else if (captureCase.instrumentId.startsWith('advanced:')) {
        engine.playAdvancedSynth(
          preset, semitone, absoluteTime, note.gateSeconds, 1, id, note.velocity,
        );
      } else {
        engine.playSample(
          captureCase.instrumentId,
          id,
          absoluteTime,
          note.gateSeconds,
          semitone,
          1,
          note.velocity,
          `quality-matrix-seed-${captureCase.random.seed}-event-${index}`,
        );
      }
    });

    try {
      const result = await done;
      if (result.attemptId !== attemptId) throw new Error('Capture attempt identity changed in the worklet');
      return {
        sampleRate: context.sampleRate,
        frameCount: result.frameCount,
        capturedFrames: result.capturedFrames,
        maxRenderFrameDrift: result.maxRenderFrameDrift,
        channels: result.channels.map(buffer => Array.from(new Float32Array(buffer))),
        randomCalls: globals.__qualityMatrixRandom__?.calls ?? -1,
        scheduleLeadFrames,
        userAgent: navigator.userAgent,
      };
    } finally {
      window.clearTimeout(timeoutId);
      trackOutput.disconnect(recorder);
      recorder.disconnect();
      keepAlive.disconnect();
    }
  }, {
    captureCase: matrixCase,
    id: trackId,
    attemptId: captureAttemptId,
    workletSource: CAPTURE_WORKLET_SOURCE,
    leadSeconds: CAPTURE_LEAD_SECONDS,
  });
}

/** A real Chromium capture callback suitable for runDryPcmMatrix. */
export class ChromiumDryPcmCaptureAdapter {
  private readonly diagnostics: BrowserCaptureDiagnostics[] = [];
  private attemptSequence = 0;
  private readonly options: ChromiumDryPcmCaptureAdapterOptions;

  constructor(options: ChromiumDryPcmCaptureAdapterOptions) {
    this.options = options;
  }

  getDiagnostics(): readonly BrowserCaptureDiagnostics[] {
    return this.diagnostics;
  }

  async capture(matrixCase: DryPcmMatrixCase): Promise<DryPcmCapture> {
    if (
      !matrixCase.dry
      || matrixCase.effectsEnabled
      || matrixCase.pan !== 0
      || matrixCase.sampleRate !== MATRIX_SAMPLE_RATE
    ) {
      throw new Error(`${matrixCase.id}: adapter accepts only centered dry 44100 Hz cases`);
    }
    const seed = matrixCase.random.seed;
    if (!matrixCase.random.locked || typeof seed !== 'number' || !Number.isInteger(seed)) {
      throw new Error(`${matrixCase.id}: deterministic capture requires an integer locked seed`);
    }
    const expectedFrames = expectedMatrixFrameCount(matrixCase, MATRIX_SAMPLE_RATE);
    const captureAttemptId = randomUUID();
    const trackId = `quality-matrix-${++this.attemptSequence}`;
    const sessionId = await createSession(
      this.options.request,
      this.options.baseUrl,
      trackId,
      matrixCase.instrumentId,
    );
    const context = await createE2EContext(this.options.browser, 'chromium');
    await context.addInitScript(({ sampleRate, seed }) => {
      const nativeAudioContext = window.AudioContext;
      if (!nativeAudioContext) throw new Error('Chromium AudioContext is unavailable');
      const forcedAudioContext = new Proxy(nativeAudioContext, {
        construct(target, argumentsList) {
          const requested = (argumentsList[0] ?? {}) as AudioContextOptions;
          // The production app normally accepts Chromium's low-latency
          // default. A multi-second evidence recorder instead pins the
          // browser's playback-quality buffering so an overloaded CI host
          // cannot turn a scheduling underrun into silently packed PCM.
          return Reflect.construct(
            target,
            [{ ...requested, sampleRate, latencyHint: 'playback' }],
            target,
          );
        },
      });
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        writable: true,
        value: forcedAudioContext,
      });

      let state = seed >>> 0;
      let calls = 0;
      Math.random = () => {
        calls++;
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        const result = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        const receipt = (window as unknown as {
          __qualityMatrixRandom__?: { seed: number; calls: number };
        }).__qualityMatrixRandom__;
        if (receipt) receipt.calls = calls;
        return result;
      };
      (window as unknown as {
        __qualityMatrixRandom__?: { seed: number; calls: number };
      }).__qualityMatrixRandom__ = { seed, calls: 0 };
    }, { sampleRate: MATRIX_SAMPLE_RATE, seed });

    const page = await context.newPage();
    try {
      await page.goto(`${this.options.baseUrl}/s/${sessionId}`);
      await waitForSession(page);
      await prepareProductionAudio(page, matrixCase, trackId);
      const captured = await captureInPage(page, matrixCase, trackId, captureAttemptId);
      if (captured.sampleRate !== MATRIX_SAMPLE_RATE) {
        throw new Error(`${matrixCase.id}: Chromium rendered at ${captured.sampleRate} Hz`);
      }
      if (captured.frameCount !== expectedFrames || captured.capturedFrames !== expectedFrames) {
        throw new Error(
          `${matrixCase.id}: incomplete capture ${captured.capturedFrames}/${captured.frameCount}/${expectedFrames}`,
        );
      }
      if (captured.channels.some(channel => channel.length !== expectedFrames)) {
        throw new Error(`${matrixCase.id}: returned channel geometry is not contiguous`);
      }
      if (captured.maxRenderFrameDrift !== 0) {
        throw new Error(
          `${matrixCase.id}: AudioWorklet render-frame drift was ${captured.maxRenderFrameDrift}`,
        );
      }
      if (captured.randomCalls < 0) throw new Error(`${matrixCase.id}: seeded random receipt is missing`);
      this.diagnostics.push({
        captureAttemptId,
        caseId: matrixCase.id,
        sessionId,
        trackId,
        randomSeed: seed,
        randomAlgorithm: 'mulberry32',
        randomCalls: captured.randomCalls,
        scheduleLeadFrames: captured.scheduleLeadFrames,
        maxRenderFrameDrift: captured.maxRenderFrameDrift,
        tap: 'track-bus-output-post-pan-pre-master',
        effectsEnabled: false,
        pan: 0,
        audioContextSampleRate: MATRIX_SAMPLE_RATE,
        latencyHint: 'playback',
        browserVersion: this.options.browser.version(),
        userAgent: captured.userAgent,
      });
      return {
        captureAttemptId,
        sampleRate: captured.sampleRate,
        channels: captured.channels.map(channel => Float32Array.from(channel)),
        frameCount: captured.frameCount,
        capturedFrameCount: captured.capturedFrames,
        maxRenderFrameDrift: captured.maxRenderFrameDrift,
      };
    } finally {
      await context.close();
    }
  }
}

/**
 * Process-isolated capture callback suitable for long matrix runs.
 *
 * Reusing one headless Chromium process across several real-time AudioContexts
 * produced observed 128-frame render gaps on later attempts. A fresh process
 * per case keeps that browser runtime state outside the evidence. The inner
 * adapter still rejects every missing frame or render-clock discontinuity.
 */
export class ChromiumIsolatedDryPcmCaptureAdapter {
  private readonly diagnostics: BrowserCaptureDiagnostics[] = [];
  private readonly options: ChromiumIsolatedDryPcmCaptureAdapterOptions;

  constructor(options: ChromiumIsolatedDryPcmCaptureAdapterOptions) {
    this.options = options;
  }

  getDiagnostics(): readonly BrowserCaptureDiagnostics[] {
    return this.diagnostics;
  }

  async capture(matrixCase: DryPcmMatrixCase): Promise<DryPcmCapture> {
    const browser = await chromium.launch({ headless: true });
    try {
      const adapter = new ChromiumDryPcmCaptureAdapter({
        browser,
        request: this.options.request,
        baseUrl: this.options.baseUrl,
      });
      const capture = await adapter.capture(matrixCase);
      this.diagnostics.push(...adapter.getDiagnostics());
      return capture;
    } finally {
      await browser.close();
    }
  }
}
