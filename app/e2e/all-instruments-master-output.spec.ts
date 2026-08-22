import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSessionWithRetry, API_BASE } from './test-utils';
import { test, expect, waitForAppReady } from './global-setup';
import { INSTRUMENT_CATEGORIES } from '../src/components/sample-constants';
import { getInstrumentRange } from '../src/audio/instrument-ranges';
import { SCHEDULER_BASE_MIDI_NOTE } from '../src/audio/constants';
import { MAX_TRACKS } from '../src/types';
import {
  LIVE_ACTIVE_STEP,
  LIVE_ACTIVE_STEP_OFFSET_SECONDS,
  LIVE_CAPTURE_ALIGNMENT,
  LIVE_CAPTURE_CHANNEL_COUNT,
  LIVE_CAPTURE_DURATION_SECONDS,
  LIVE_CAPTURE_METHOD,
  LIVE_EXPECTED_EVENTS_PER_TRACK,
  LIVE_GENERATED_FROM,
  LIVE_ISOLATION_SCOPE,
  LIVE_MAX_ARM_TO_ONSET_SECONDS,
  LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS,
  LIVE_MIN_ARM_TO_ONSET_SECONDS,
  LIVE_ONSET_THRESHOLD,
  LIVE_PATTERN_PERIOD_SECONDS,
  LIVE_PATTERN_STORAGE_STEP_COUNT,
  LIVE_PEAK_METRIC,
  LIVE_PREPARATION_METHOD,
  LIVE_RANDOM_ALGORITHM,
  LIVE_RANDOM_SEED,
  LIVE_RECEIPT_CLAIM,
  LIVE_RECEIPT_SCHEMA_VERSION,
  LIVE_RMS_METRIC,
  LIVE_SCHEDULER_LOOKAHEAD_SECONDS,
  LIVE_SILENCE_PEAK_THRESHOLD,
  LIVE_SILENCE_RMS_THRESHOLD,
  LIVE_STEP_COUNT,
  LIVE_TEMPO,
  LIVE_TRIAL_MODE,
  LIVE_UNMUTE_SETTLE_SECONDS,
  validateLiveQualityReport,
  type LiveQualityReport,
} from '../scripts/instrument-quality-live-receipt';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = process.env.KEYBOARDIA_INSTRUMENT_QUALITY_REPORT_DIR
  ? resolve(process.env.KEYBOARDIA_INSTRUMENT_QUALITY_REPORT_DIR)
  : resolve(THIS_DIR, '../reports/instrument-quality');

const ENERGY_PROCESSOR_NAME = 'keyboardia-onset-aligned-energy-v2';
const ENERGY_WORKLET_SOURCE = String.raw`
class KeyboardiaContinuousEnergyProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputCount = options.processorOptions.inputCount;
    this.channelCount = options.processorOptions.channelCount;
    this.active = false;
    this.started = false;
    this.targetFrames = 0;
    this.capturedFrames = 0;
    this.armToOnsetFrames = 0;
    this.onsetThreshold = options.processorOptions.onsetThreshold;
    this.sumSquares = [];
    this.sampleCounts = [];
    this.peaks = [];
    this.port.onmessage = event => {
      if (event.data.type !== 'arm') return;
      const frameCount = event.data.frameCount;
      if (!Number.isInteger(frameCount) || frameCount <= 0) {
        this.fail('capture frameCount must be a positive integer');
        return;
      }
      this.targetFrames = frameCount;
      this.capturedFrames = 0;
      this.armToOnsetFrames = 0;
      this.started = false;
      this.sumSquares = new Array(this.inputCount).fill(0);
      this.sampleCounts = new Array(this.inputCount).fill(0);
      this.peaks = new Array(this.inputCount).fill(0);
      this.active = true;
      this.port.postMessage({ type: 'armed', frameCount });
    };
  }

  fail(message) {
    this.active = false;
    this.port.postMessage({ type: 'error', message });
  }

  process(inputs, outputs) {
    if (!this.active) return true;
    const renderQuantum = outputs[0]?.[0];
    if (!renderQuantum || renderQuantum.length === 0) {
      this.fail('continuous energy capture received no render quantum');
      return true;
    }
    let frameOffset = 0;
    if (!this.started) {
      let onsetFrame = -1;
      findOnset:
      for (let frame = 0; frame < renderQuantum.length; frame++) {
        for (let inputIndex = 0; inputIndex < this.inputCount; inputIndex++) {
          const input = inputs[inputIndex];
          if (!input) continue;
          for (let channelIndex = 0; channelIndex < input.length; channelIndex++) {
            const channel = input[channelIndex];
            if (channel && Math.abs(channel[frame] || 0) > this.onsetThreshold) {
              onsetFrame = frame;
              break findOnset;
            }
          }
        }
      }
      if (onsetFrame < 0) {
        this.armToOnsetFrames += renderQuantum.length;
        return true;
      }
      this.started = true;
      frameOffset = onsetFrame;
      this.armToOnsetFrames += onsetFrame;
    }
    const framesToCapture = Math.min(
      renderQuantum.length - frameOffset,
      this.targetFrames - this.capturedFrames,
    );
    for (let inputIndex = 0; inputIndex < this.inputCount; inputIndex++) {
      const input = inputs[inputIndex];
      if (!input || input.length === 0) {
        // Web Audio may expose zero channels while an otherwise-connected input
        // is silent. Those render frames are real zero samples in the pinned
        // explicit-stereo measurement and must remain in the whole-window RMS.
        this.sampleCounts[inputIndex] += framesToCapture * this.channelCount;
        continue;
      }
      if (input.length !== this.channelCount) {
        this.fail(
          'input ' + inputIndex + ' exposed ' + (input ? input.length : 0)
          + ' channels; expected ' + this.channelCount,
        );
        return true;
      }
      for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex++) {
        const channel = input[channelIndex];
        if (!channel || channel.length < frameOffset + framesToCapture) {
          this.fail('input ' + inputIndex + ' channel ' + channelIndex + ' was incomplete');
          return true;
        }
        for (let frame = 0; frame < framesToCapture; frame++) {
          const sample = channel[frameOffset + frame];
          const absolute = Math.abs(sample);
          this.sumSquares[inputIndex] += sample * sample;
          this.sampleCounts[inputIndex] += 1;
          if (absolute > this.peaks[inputIndex]) this.peaks[inputIndex] = absolute;
        }
      }
    }
    this.capturedFrames += framesToCapture;
    if (this.capturedFrames === this.targetFrames) {
      const measurements = this.peaks.map((peak, inputIndex) => ({
        inputIndex,
        peak,
        rms: Math.sqrt(this.sumSquares[inputIndex] / this.sampleCounts[inputIndex]),
        capturedFrames: this.capturedFrames,
        channelSampleCount: this.sampleCounts[inputIndex],
      }));
      this.active = false;
      this.port.postMessage({
        type: 'done',
        capturedFrames: this.capturedFrames,
        armToOnsetFrames: this.armToOnsetFrames,
        measurements,
      });
    }
    return true;
  }
}

registerProcessor('${ENERGY_PROCESSOR_NAME}', KeyboardiaContinuousEnergyProcessor);
`;

type InstrumentType = 'sample' | 'sampled' | 'synth' | 'tone' | 'advanced';

type InstrumentSpec = {
  sampleId: string;
  name: string;
  type: InstrumentType;
  presetId: string;
  pitch: number;
};

type SessionTrack = {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: Array<{ pitch: number; volume: number } | null>;
  volume: number;
  muted: boolean;
  soloed: boolean;
  transpose: number;
  stepCount: number;
};

type TrackProbeResult = InstrumentSpec & {
  trackId: string;
  sessionId: string;
  peak: number;
  rms: number;
  masterPeak: number;
  masterRms: number;
  capturedFrames: number;
  channelSampleCount: number;
  armToOnsetFrames: number;
  randomCalls: number;
};

type EnergyMeasurement = {
  peak: number;
  rms: number;
  capturedFrames: number;
  channelSampleCount: number;
};

type EnergyCaptureResult = {
  sampleRate: number;
  master: EnergyMeasurement;
  tracks: Record<string, EnergyMeasurement>;
  armToOnsetFrames: number;
  randomCalls: number;
};

function representativePitch(sampleId: string): number {
  const range = getInstrumentRange(sampleId);
  const midi = Math.min(range.maxMidi, Math.max(range.minMidi, SCHEDULER_BASE_MIDI_NOTE));
  return midi - SCHEDULER_BASE_MIDI_NOTE;
}

function presetIdFor(sampleId: string, type: InstrumentType): string {
  switch (type) {
    case 'sampled':
      return sampleId.slice('sampled:'.length);
    case 'synth':
      return sampleId.slice('synth:'.length);
    case 'tone':
      return sampleId.slice('tone:'.length);
    case 'advanced':
      return sampleId.slice('advanced:'.length);
    case 'sample':
    default:
      return sampleId;
  }
}

function allInstrumentSpecs(): InstrumentSpec[] {
  return Object.values(INSTRUMENT_CATEGORIES)
    .flatMap(category => category.instruments)
    .map(instrument => ({
      sampleId: instrument.id,
      name: instrument.name,
      type: instrument.type as InstrumentType,
      presetId: presetIdFor(instrument.id, instrument.type as InstrumentType),
      pitch: representativePitch(instrument.id),
    }))
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function trackIdFor(sampleId: string, index: number): string {
  return `audio-smoke-${index}-${sampleId.replace(/[^a-z0-9]+/gi, '-')}`;
}

function buildSequencerTrack(spec: InstrumentSpec, index: number): SessionTrack {
  const steps = Array(LIVE_PATTERN_STORAGE_STEP_COUNT).fill(false) as boolean[];
  const parameterLocks = Array(LIVE_PATTERN_STORAGE_STEP_COUNT).fill(null) as Array<{ pitch: number; volume: number } | null>;
  steps[LIVE_ACTIVE_STEP] = true;
  parameterLocks[LIVE_ACTIVE_STEP] = { pitch: spec.pitch, volume: 1 };
  return {
    id: trackIdFor(spec.sampleId, index),
    name: spec.name,
    sampleId: spec.sampleId,
    steps,
    parameterLocks,
    volume: 1,
    muted: true,
    soloed: false,
    transpose: 0,
    stepCount: LIVE_STEP_COUNT,
  };
}

async function prepareAudioForTracks(page: Page, tracks: SessionTrack[]): Promise<void> {
  // The app initializes/unlocks audio only through a user playback gesture.
  // Tracks are muted in the persisted fixture so this production Play/Stop
  // preload cannot advance a round-robin cursor or leave a release tail in the
  // measured graph. Wait for the async preload to finish and playback to
  // actually enter its running state before stopping it.
  const playButton = getPlayButton(page);
  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', 'Stop', { timeout: 60_000 });
  await page.waitForFunction((tracksToCheck) => {
    type Engine = {
      getAudioContext?: () => AudioContext | null;
      isToneInitialized?: () => boolean;
      isSampledInstrumentReady?: (instrumentId: string) => boolean;
    };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    if (!engine?.getAudioContext?.()) return false;
    const needsTone = tracksToCheck.some(t => t.sampleId.startsWith('tone:') || t.sampleId.startsWith('advanced:'));
    if (needsTone && !engine.isToneInitialized?.()) return false;
    return tracksToCheck
      .filter(t => t.sampleId.startsWith('sampled:'))
      .map(t => t.sampleId.slice('sampled:'.length))
      .every(id => engine.isSampledInstrumentReady?.(id));
  }, tracks, { timeout: 60_000 });
  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', 'Play', { timeout: 10_000 });

  const muteButtons = page.locator('.track-row .mute-button');
  await expect(muteButtons).toHaveCount(tracks.length);
  for (let index = 0; index < tracks.length; index++) {
    await expect(muteButtons.nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  // Keep a pinned quiet interval between the muted preload and the first
  // isolated trial.
  await page.waitForTimeout(LIVE_UNMUTE_SETTLE_SECONDS * 1_000);
}

async function setTrackMuted(
  page: Page,
  trackIndex: number,
  trackId: string,
  muted: boolean,
): Promise<void> {
  const muteButton = page.locator('.track-row .mute-button').nth(trackIndex);
  const expected = String(muted);
  if (await muteButton.getAttribute('aria-pressed') !== expected) {
    await muteButton.click();
  }
  await expect(muteButton).toHaveAttribute('aria-pressed', expected);

  // The sequencer mute suppresses future events, but it does not silence a
  // voice that is already in its release tail. Gate the production TrackBus as
  // well so only the selected track is audible at the master tap. The voice may
  // remain allocated behind its muted bus; this is an audible-routing claim,
  // not a voice-disposal claim.
  await page.evaluate(({ id, shouldMute }) => {
    type TrackBusManager = {
      getOrCreateBus: (candidateId: string) => unknown;
    };
    type Engine = {
      trackBusManager?: TrackBusManager;
      setTrackMuted?: (candidateId: string, candidateMuted: boolean) => void;
    };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    if (!engine?.trackBusManager || !engine.setTrackMuted) {
      throw new Error('Audio engine TrackBus mute control unavailable');
    }
    engine.trackBusManager.getOrCreateBus(id);
    engine.setTrackMuted(id, shouldMute);
  }, { id: trackId, shouldMute: muted });

  // TrackBus mute uses a 10 ms setTargetAtTime ramp. Keep the transition out
  // of the measured window. Do not inspect AudioParam.value as a command
  // receipt here: a short, ended source may leave the disconnected bus without
  // a render pull. The next trial's master-inclusive onset detector is the
  // objective leakage guard: any still-audible tail starts capture before the
  // pinned 450 ms event floor and invalidates the receipt.
  await page.waitForTimeout(LIVE_UNMUTE_SETTLE_SECONDS * 1_000);
}

async function installDeterministicRandom(page: Page): Promise<void> {
  await page.addInitScript(({ seed, algorithm }) => {
    if (algorithm !== 'mulberry32') throw new Error(`Unsupported live-quality RNG ${algorithm}`);
    type RandomReceipt = { seed: number; state: number; calls: number; algorithm: string };
    const globals = window as unknown as { __liveQualityRandom__?: RandomReceipt };
    globals.__liveQualityRandom__ = { seed, state: seed >>> 0, calls: 0, algorithm };
    Math.random = () => {
      const receipt = globals.__liveQualityRandom__;
      if (!receipt) throw new Error('Live-quality seeded random state disappeared');
      receipt.calls++;
      receipt.state = (receipt.state + 0x6d2b79f5) >>> 0;
      let value = receipt.state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }, { seed: LIVE_RANDOM_SEED, algorithm: LIVE_RANDOM_ALGORITHM });
}

async function attachContinuousEnergyCapture(page: Page, trackIds: string[]): Promise<void> {
  await page.evaluate(async ({ ids, processorName, workletSource, channelCount, durationSeconds, onsetThreshold }) => {
    type TrackBus = { getOutputNode: () => AudioNode };
    type TrackBusManager = { getOrCreateBus: (trackId: string) => TrackBus };
    type Engine = {
      getAudioContext?: () => AudioContext | null;
      masterGain?: AudioNode | null;
      trackBusManager?: TrackBusManager;
    };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    const audioContext = engine?.getAudioContext?.();
    const masterGain = engine?.masterGain;
    const trackBusManager = engine?.trackBusManager;
    if (!audioContext || !masterGain || !trackBusManager) {
      throw new Error('Audio engine/masterGain/trackBusManager unavailable');
    }

    const workletGlobals = window as unknown as {
      __allInstrumentEnergyWorkletLoaded__?: boolean;
    };
    if (!workletGlobals.__allInstrumentEnergyWorkletLoaded__) {
      const blobUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
      try {
        await audioContext.audioWorklet.addModule(blobUrl);
        workletGlobals.__allInstrumentEnergyWorkletLoaded__ = true;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    const node = new AudioWorkletNode(audioContext, processorName, {
      numberOfInputs: ids.length + 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { inputCount: ids.length + 1, channelCount, onsetThreshold },
    });
    const sources: AudioNode[] = ids.map(id =>
      trackBusManager.getOrCreateBus(id).getOutputNode()
    );
    sources.push(masterGain);
    sources.forEach((source, inputIndex) => source.connect(node, 0, inputIndex));
    const keepAlive = audioContext.createGain();
    keepAlive.gain.value = 0;
    node.connect(keepAlive).connect(audioContext.destination);

    (window as unknown as {
      __allInstrumentSequencerProbe__?: {
        node: AudioWorkletNode;
        sources: AudioNode[];
        keepAlive: GainNode;
        trackIds: string[];
        frameCount: number;
        done?: Promise<{
          type: 'done';
          capturedFrames: number;
          armToOnsetFrames: number;
          measurements: Array<EnergyMeasurement & { inputIndex: number }>;
        }>;
      };
    }).__allInstrumentSequencerProbe__ = {
      node,
      sources,
      keepAlive,
      trackIds: ids,
      frameCount: Math.round(durationSeconds * audioContext.sampleRate),
    };
  }, {
    ids: trackIds,
    processorName: ENERGY_PROCESSOR_NAME,
    workletSource: ENERGY_WORKLET_SOURCE,
    channelCount: LIVE_CAPTURE_CHANNEL_COUNT,
    durationSeconds: LIVE_CAPTURE_DURATION_SECONDS,
    onsetThreshold: LIVE_ONSET_THRESHOLD,
  });
}

async function armAndStartContinuousEnergyCapture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    type DoneMessage = {
      type: 'done';
      capturedFrames: number;
      armToOnsetFrames: number;
      measurements: Array<EnergyMeasurement & { inputIndex: number }>;
    };
    type ErrorMessage = { type: 'error'; message: string };
    type ArmedMessage = { type: 'armed'; frameCount: number };
    const probe = (window as unknown as {
      __allInstrumentSequencerProbe__?: {
        node: AudioWorkletNode;
        sources: AudioNode[];
        keepAlive: GainNode;
        trackIds: string[];
        frameCount: number;
        done?: Promise<DoneMessage>;
      };
    }).__allInstrumentSequencerProbe__;
    if (!probe) throw new Error('Continuous all-instrument capture was not attached');

    let armedResolve!: (message: ArmedMessage) => void;
    let armedReject!: (error: Error) => void;
    let doneResolve!: (message: DoneMessage) => void;
    let doneReject!: (error: Error) => void;
    const armed = new Promise<ArmedMessage>((resolve, reject) => {
      armedResolve = resolve;
      armedReject = reject;
    });
    probe.done = new Promise<DoneMessage>((resolve, reject) => {
      doneResolve = resolve;
      doneReject = reject;
    });
    // Attach a rejection observer immediately so a worklet error cannot become
    // an unhandled page rejection between the arm and result awaits.
    void probe.done.catch(() => {});
    probe.node.port.onmessage = (event: MessageEvent<DoneMessage | ErrorMessage | ArmedMessage>) => {
      if (event.data.type === 'armed') armedResolve(event.data);
      else if (event.data.type === 'done') doneResolve(event.data);
      else {
        const error = new Error(event.data.message);
        armedReject(error);
        doneReject(error);
      }
    };
    probe.node.port.postMessage({ type: 'arm', frameCount: probe.frameCount });
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Timed out arming continuous energy capture')), 5_000);
    });
    const message = await Promise.race([armed, timeout]);
    if (message.frameCount !== probe.frameCount) {
      throw new Error('Continuous energy worklet armed with the wrong frame count');
    }
    const playButton = document.querySelector<HTMLButtonElement>('[data-testid="play-button"]');
    if (!playButton) throw new Error('Play button unavailable after continuous capture armed');
    // Audio was already unlocked by prepareAudioForTracks. Dispatching the
    // measured restart in this same page task minimizes variable leading
    // silence between the worklet acknowledgement and sequencer step zero.
    playButton.click();
  });
}

async function readContinuousEnergyCapture(page: Page): Promise<EnergyCaptureResult> {
  return page.evaluate(async ({ channelCount, randomSeed, randomAlgorithm }) => {
    type DoneMessage = {
      type: 'done';
      capturedFrames: number;
      armToOnsetFrames: number;
      measurements: Array<EnergyMeasurement & { inputIndex: number }>;
    };
    const probe = (window as unknown as {
      __allInstrumentSequencerProbe__?: {
        node: AudioWorkletNode;
        sources: AudioNode[];
        keepAlive: GainNode;
        trackIds: string[];
        frameCount: number;
        done?: Promise<DoneMessage>;
      };
    }).__allInstrumentSequencerProbe__;
    if (!probe?.done) throw new Error('Continuous all-instrument capture was not armed');

    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Timed out reading continuous energy capture')), 10_000);
    });
    const result = await Promise.race([probe.done, timeout]);
    if (result.capturedFrames !== probe.frameCount) {
      throw new Error(
        `Continuous energy capture returned ${result.capturedFrames}/${probe.frameCount} frames`,
      );
    }
    if (result.measurements.length !== probe.trackIds.length + 1) {
      throw new Error('Continuous energy capture omitted an input');
    }
    if (!Number.isInteger(result.armToOnsetFrames) || result.armToOnsetFrames < 0) {
      throw new Error('Continuous energy capture returned an invalid arm-to-onset interval');
    }

    const byInput = new Map(result.measurements.map(measurement => [measurement.inputIndex, measurement]));
    const tracks: Record<string, EnergyMeasurement> = {};
    for (const [inputIndex, trackId] of probe.trackIds.entries()) {
      const measurement = byInput.get(inputIndex);
      if (!measurement) throw new Error(`Continuous energy capture omitted ${trackId}`);
      if (measurement.channelSampleCount !== probe.frameCount * channelCount) {
        throw new Error(`Continuous energy capture did not cover every sample for ${trackId}`);
      }
      tracks[trackId] = {
        peak: measurement.peak,
        rms: measurement.rms,
        capturedFrames: measurement.capturedFrames,
        channelSampleCount: measurement.channelSampleCount,
      };
    }
    const master = byInput.get(probe.trackIds.length);
    if (!master) throw new Error('Continuous energy capture omitted masterGain');
    if (master.channelSampleCount !== probe.frameCount * channelCount) {
      throw new Error('Continuous energy capture did not cover every masterGain sample');
    }

    probe.sources.forEach((source, inputIndex) => {
      try {
        source.disconnect(probe.node, 0, inputIndex);
      } catch {
        // Navigation also tears down the graph; disconnect is best effort.
      }
    });
    probe.node.disconnect();
    probe.keepAlive.disconnect();
    delete (window as unknown as { __allInstrumentSequencerProbe__?: unknown })
      .__allInstrumentSequencerProbe__;

    type Engine = { getAudioContext?: () => AudioContext | null };
    const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
    const sampleRate = engine?.getAudioContext?.()?.sampleRate;
    if (!sampleRate) throw new Error('AudioContext sample rate unavailable after capture');
    const randomState = (window as unknown as {
      __liveQualityRandom__?: { seed: number; algorithm: string; calls: number };
    }).__liveQualityRandom__;
    if (randomState?.seed !== randomSeed
      || randomState.algorithm !== randomAlgorithm
      || !Number.isInteger(randomState.calls)
      || randomState.calls < 0) {
      throw new Error('Live-quality seeded random receipt is missing or malformed');
    }
    return {
      sampleRate,
      master,
      tracks,
      armToOnsetFrames: result.armToOnsetFrames,
      randomCalls: randomState.calls,
    };
  }, {
    channelCount: LIVE_CAPTURE_CHANNEL_COUNT,
    randomSeed: LIVE_RANDOM_SEED,
    randomAlgorithm: LIVE_RANDOM_ALGORITHM,
  });
}

function getPlayButton(page: Page) {
  return page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first();
}

async function clickPlayButton(page: Page): Promise<void> {
  await getPlayButton(page).click();
}

function cleanSubjectCommit(): string {
  const repositoryRoot = resolve(THIS_DIR, '../..');
  const subjectCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const trackedChanges = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).trim();
  if (trackedChanges.length > 0) {
    throw new Error(
      `Live audio evidence requires a clean tracked subject tree; found:\n${trackedChanges}`,
    );
  }
  if (!/^[a-f0-9]{40}$/.test(subjectCommit)) {
    throw new Error('Live audio evidence requires a full Git subject commit');
  }
  return subjectCommit;
}

test('every catalog instrument sequencer step produces live master output', async ({ page, request, browserName }) => {
  test.setTimeout(900_000);
  const specs = allInstrumentSpecs();
  expect(specs).toHaveLength(99);
  expect(new Set(specs.map(spec => spec.sampleId)).size).toBe(specs.length);
  expect(LIVE_STEP_COUNT * (60 / LIVE_TEMPO / 4)).toBe(LIVE_PATTERN_PERIOD_SECONDS);
  expect(LIVE_ACTIVE_STEP * (60 / LIVE_TEMPO / 4)).toBe(LIVE_ACTIVE_STEP_OFFSET_SECONDS);
  expect(LIVE_ACTIVE_STEP_OFFSET_SECONDS).toBeGreaterThan(LIVE_SCHEDULER_LOOKAHEAD_SECONDS);
  expect(LIVE_PATTERN_PERIOD_SECONDS).toBeGreaterThan(LIVE_CAPTURE_DURATION_SECONDS);
  const subjectCommit = cleanSubjectCommit();
  await installDeterministicRandom(page);

  // Codec precondition — see e2e/sample-browser-decode.spec.ts for the same
  // check and the full reasoning.
  //
  // This test continuously accumulates master/per-track sample peak and
  // full-window RMS, then reports instruments that come out silent. On a
  // Chromium without AAC, every .m4a-backed instrument decodes to
  // nothing and is reported as silent — indistinguishable from a genuine audio
  // routing regression, which is the failure this test exists to catch. Assert
  // the browser can actually decode the catalogue before believing its silence.
  await page.goto('/');
  const aacSupport = await page.evaluate(() =>
    document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"')
  );
  expect(
    aacSupport,
    `this browser cannot decode AAC/m4a (canPlayType: "${aacSupport}"), so every ` +
      'm4a-backed instrument would be reported silent regardless of routing. Run ' +
      'with Playwright\'s bundled Chromium (npx playwright install chromium).'
  ).not.toBe('');

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    const text = msg.text();
    if (
      msg.type() === 'error' ||
      text.includes('Sample not found') ||
      (text.includes('not ready') && text.includes('skipping'))
    ) {
      consoleErrors.push(`[${msg.type()}] ${text}`);
    }
  });

  const results: TrackProbeResult[] = [];
  const audioSampleRates = new Set<number>();
  const sessionResults: Array<{
    sessionId: string;
    instruments: string[];
    sampleRate: number;
  }> = [];

  for (const [batchIndex, batchSpecs] of chunk(specs, MAX_TRACKS).entries()) {
    const tracks = batchSpecs.map((spec, i) => buildSequencerTrack(spec, batchIndex * MAX_TRACKS + i));
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks,
      tempo: LIVE_TEMPO,
      swing: 0,
      version: 1,
    });

    await page.goto(`${API_BASE}/s/${sessionId}`);
    await waitForAppReady(page);
    await expect(page.locator('.track-row')).toHaveCount(tracks.length, { timeout: 20_000 });

    await prepareAudioForTracks(page, tracks);
    const expectedSampleRate = await page.evaluate(() => {
      type Engine = { getAudioContext?: () => AudioContext | null };
      const engine = (window as unknown as { __audioEngine__?: Engine }).__audioEngine__;
      const sampleRate = engine?.getAudioContext?.()?.sampleRate;
      if (!sampleRate) throw new Error('AudioContext sample rate unavailable');
      return sampleRate;
    });
    audioSampleRates.add(expectedSampleRate);
    sessionResults.push({
      sessionId,
      instruments: batchSpecs.map(s => s.sampleId),
      sampleRate: expectedSampleRate,
    });

    for (const [i, spec] of batchSpecs.entries()) {
      const trackId = tracks[i].id;
      // Calibration is deliberately single-audible-track. Muted release tails
      // may remain allocated; polyphonic behaviour has separate matrix coverage
      // and must not move an instrument's level rank.
      await setTrackMuted(page, i, trackId, false);
      await attachContinuousEnergyCapture(page, [trackId]);
      await armAndStartContinuousEnergyCapture(page);
      const energy = await readContinuousEnergyCapture(page);
      await clickPlayButton(page);
      await expect(getPlayButton(page)).toHaveAttribute('aria-label', 'Play', { timeout: 10_000 });
      await setTrackMuted(page, i, trackId, true);
      expect(energy.sampleRate).toBe(expectedSampleRate);

      const trackEnergy = energy.tracks[trackId];
      if (!trackEnergy) throw new Error(`Continuous energy capture omitted ${trackId}`);
      results.push({
        ...spec,
        trackId,
        sessionId,
        ...trackEnergy,
        masterPeak: energy.master.peak,
        masterRms: energy.master.rms,
        armToOnsetFrames: energy.armToOnsetFrames,
        randomCalls: energy.randomCalls,
      });
    }
  }

  const receipt: LiveQualityReport = {
    schemaVersion: LIVE_RECEIPT_SCHEMA_VERSION,
    claim: LIVE_RECEIPT_CLAIM,
    generatedAt: new Date().toISOString(),
    subjectCommit,
    browser: {
      name: browserName,
      version: page.context().browser()?.version() ?? 'unknown',
      userAgent: await page.evaluate(() => navigator.userAgent),
    },
    audioSampleRates: [...audioSampleRates].sort((left, right) => left - right),
    generatedFrom: LIVE_GENERATED_FROM,
    capture: {
      method: LIVE_CAPTURE_METHOD,
      alignment: LIVE_CAPTURE_ALIGNMENT,
      durationSeconds: LIVE_CAPTURE_DURATION_SECONDS,
      channelCount: LIVE_CAPTURE_CHANNEL_COUNT,
      onsetThreshold: LIVE_ONSET_THRESHOLD,
      minArmToOnsetSeconds: LIVE_MIN_ARM_TO_ONSET_SECONDS,
      maxArmToOnsetSeconds: LIVE_MAX_ARM_TO_ONSET_SECONDS,
      trialMode: LIVE_TRIAL_MODE,
      maxConcurrentAudibleTracks: LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS,
      isolationScope: LIVE_ISOLATION_SCOPE,
      peakMetric: LIVE_PEAK_METRIC,
      rmsMetric: LIVE_RMS_METRIC,
    },
    schedule: {
      preparation: LIVE_PREPARATION_METHOD,
      activeStep: LIVE_ACTIVE_STEP,
      activeStepOffsetSeconds: LIVE_ACTIVE_STEP_OFFSET_SECONDS,
      schedulerLookaheadSeconds: LIVE_SCHEDULER_LOOKAHEAD_SECONDS,
      expectedEventsPerTrack: LIVE_EXPECTED_EVENTS_PER_TRACK,
      patternPeriodSeconds: LIVE_PATTERN_PERIOD_SECONDS,
      patternStorageStepCount: LIVE_PATTERN_STORAGE_STEP_COUNT,
      unmuteSettleSeconds: LIVE_UNMUTE_SETTLE_SECONDS,
    },
    random: {
      locked: true,
      seed: LIVE_RANDOM_SEED,
      algorithm: LIVE_RANDOM_ALGORITHM,
    },
    silencePeakThreshold: LIVE_SILENCE_PEAK_THRESHOLD,
    silenceRmsThreshold: LIVE_SILENCE_RMS_THRESHOLD,
    tempo: LIVE_TEMPO,
    stepCount: LIVE_STEP_COUNT,
    sessions: sessionResults,
    instruments: results,
    diagnostics: { pageErrors, consoleErrors },
  };

  const silentTracks = results.filter(r =>
    r.peak <= LIVE_SILENCE_PEAK_THRESHOLD && r.rms <= LIVE_SILENCE_RMS_THRESHOLD
  );
  const silentMasterTrials = results.filter(r =>
    r.masterPeak <= LIVE_SILENCE_PEAK_THRESHOLD && r.masterRms <= LIVE_SILENCE_RMS_THRESHOLD
  );
  expect(pageErrors, 'Browser page errors during all-instrument sequencer output smoke').toEqual([]);
  expect(consoleErrors, 'Console errors/skipped notes during all-instrument sequencer output smoke').toEqual([]);
  expect(
    silentMasterTrials.map(r => ({ sampleId: r.sampleId, peak: r.masterPeak, rms: r.masterRms })),
    'Every isolated instrument trial should produce master output energy',
  ).toEqual([]);
  expect(
    silentTracks.map(r => ({ sampleId: r.sampleId, type: r.type, pitch: r.pitch, peak: r.peak, rms: r.rms })),
    'Every catalog instrument should produce per-track output from a scheduled sequencer step',
  ).toEqual([]);

  // Publish only evidence that has passed the producer's runtime assertions
  // and the same pure schema/provenance validator used by the aggregator.
  validateLiveQualityReport(receipt, subjectCommit);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'live-master-output.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
});
