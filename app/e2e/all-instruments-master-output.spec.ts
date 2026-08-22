import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSessionWithRetry, API_BASE } from './test-utils';
import { test, expect, waitForAppReady } from './global-setup';
import { createE2EContext } from './browser-context';
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
  LIVE_ENGINE_DISPATCH_LAYOUT_BY_METHOD,
  LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK,
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
  LIVE_SESSION_LIFECYCLE,
  LIVE_SILENCE_PEAK_THRESHOLD,
  LIVE_SILENCE_RMS_THRESHOLD,
  LIVE_STEP_COUNT,
  LIVE_TEMPO,
  LIVE_TRIAL_MODE,
  LIVE_UNMUTE_SETTLE_SECONDS,
  expectedLiveEngineDispatchIdentity,
  validateLiveQualityReport,
  type LiveEngineDispatch,
  type LiveQualityReport,
  type LiveSessionResult,
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
    this.terminal = false;
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
    this.terminal = true;
    this.port.postMessage({ type: 'error', message });
  }

  process(inputs, outputs) {
    if (this.terminal) return false;
    // The node is connected before its asynchronous arm acknowledgement. Keep
    // it alive while waiting, but retire it permanently after error or done.
    if (!this.active) return true;
    const renderQuantum = outputs[0]?.[0];
    if (!renderQuantum || renderQuantum.length === 0) {
      this.fail('continuous energy capture received no render quantum');
      return false;
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
        return false;
      }
      for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex++) {
        const channel = input[channelIndex];
        if (!channel || channel.length < frameOffset + framesToCapture) {
          this.fail('input ' + inputIndex + ' channel ' + channelIndex + ' was incomplete');
          return false;
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
      this.terminal = true;
      this.port.postMessage({
        type: 'done',
        capturedFrames: this.capturedFrames,
        armToOnsetFrames: this.armToOnsetFrames,
        measurements,
      });
      return false;
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
  preArmUiUnmutedTrackIds: string[];
  preArmCommandedTrackBusOpenIds: string[];
  observedEngineDispatches: LiveEngineDispatch[];
};

type PreArmIsolationSnapshot = {
  uiUnmutedTrackIds: string[];
  commandedTrackBusOpenIds: string[];
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
  await page.evaluate((trackIds) => {
    type TrackBusManager = { getOrCreateBus: (trackId: string) => unknown };
    type Engine = {
      trackBusManager?: TrackBusManager;
      setTrackMuted?: (trackId: string, muted: boolean) => void;
    };
    type Globals = { __liveQualityCommandedTrackBusOpenIds__?: string[] };
    const globals = window as unknown as Globals & { __audioEngine__?: Engine };
    const engine = globals.__audioEngine__;
    if (!engine?.trackBusManager || !engine.setTrackMuted) {
      throw new Error('Audio engine TrackBus mute control unavailable during isolation setup');
    }
    for (const trackId of trackIds) {
      engine.trackBusManager.getOrCreateBus(trackId);
      engine.setTrackMuted(trackId, true);
    }
    globals.__liveQualityCommandedTrackBusOpenIds__ = [];
  }, tracks.map(track => track.id));
  // Keep every production TrackBus closed for a pinned quiet interval between
  // the muted preload and the first isolated trial.
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
    type Globals = { __liveQualityCommandedTrackBusOpenIds__?: string[] };
    type Engine = {
      trackBusManager?: TrackBusManager;
      setTrackMuted?: (candidateId: string, candidateMuted: boolean) => void;
    };
    const globals = window as unknown as Globals & { __audioEngine__?: Engine };
    const engine = globals.__audioEngine__;
    if (!engine?.trackBusManager || !engine.setTrackMuted) {
      throw new Error('Audio engine TrackBus mute control unavailable');
    }
    engine.trackBusManager.getOrCreateBus(id);
    engine.setTrackMuted(id, shouldMute);
    const commandedOpenIds = new Set(globals.__liveQualityCommandedTrackBusOpenIds__ ?? []);
    if (shouldMute) commandedOpenIds.delete(id);
    else commandedOpenIds.add(id);
    globals.__liveQualityCommandedTrackBusOpenIds__ = [...commandedOpenIds].sort();
  }, { id: trackId, shouldMute: muted });

  // TrackBus mute uses a 10 ms setTargetAtTime ramp. Keep the transition out
  // of the measured window. Do not inspect AudioParam.value as a command
  // receipt here: a short, ended source may leave the disconnected bus without
  // a render pull. The next trial's master-inclusive onset detector is the
  // objective leakage guard: any still-audible tail starts capture before the
  // pinned 450 ms event floor and invalidates the receipt.
  await page.waitForTimeout(LIVE_UNMUTE_SETTLE_SECONDS * 1_000);
}

async function installEngineDispatchProbe(page: Page): Promise<void> {
  await page.evaluate((layouts) => {
    type DispatchMethod =
      | 'playSample'
      | 'playSampledInstrument'
      | 'playSynthNote'
      | 'playToneSynth'
      | 'playAdvancedSynth';
    type PitchUnit = 'semitones-from-c4' | 'midi-note';
    type Dispatch = {
      method: DispatchMethod;
      trackId: string;
      instrumentOrPresetId: string;
      pitchUnit: PitchUnit;
      musicalPitch: number;
      midiVelocity: number;
      noteGain: number;
      eventTimeSeconds: number;
      durationSeconds: number;
      argumentCount: number;
      variationKey: string | null;
    };
    type PlayMethod = (...args: unknown[]) => unknown;
    type Engine = Record<DispatchMethod, PlayMethod>;
    type DispatchProbe = {
      arm: () => void;
      disarm: () => void;
      readAndDisarm: () => Dispatch[];
      uninstall: () => void;
    };
    type Globals = {
      __audioEngine__?: Engine;
      __liveQualityDispatchProbe__?: DispatchProbe;
    };

    const globals = window as unknown as Globals;
    globals.__liveQualityDispatchProbe__?.uninstall();
    const engine = globals.__audioEngine__;
    if (!engine) throw new Error('Audio engine unavailable for dispatch observation');

    const methods = Object.keys(layouts) as DispatchMethod[];
    const ownDescriptors = new Map<DispatchMethod, PropertyDescriptor | undefined>();
    let dispatches: Dispatch[] = [];
    let armed = false;

    for (const method of methods) {
      const original = engine[method];
      if (typeof original !== 'function') {
        throw new Error(`Audio engine dispatch method ${method} is unavailable`);
      }
      ownDescriptors.set(method, Object.getOwnPropertyDescriptor(engine, method));
      Object.defineProperty(engine, method, {
        configurable: true,
        writable: true,
        value: function (this: Engine, ...args: unknown[]): unknown {
          if (armed) {
            const layout = layouts[method];
            const candidateTrackId = args[layout.trackIdSlot];
            const candidateInstrumentOrPresetId = args[layout.instrumentOrPresetIdSlot];
            const candidateVariationKey = layout.variationKeySlot === null
              ? undefined
              : args[layout.variationKeySlot];
            const numericArgument = (slot: number): number => {
              const candidate = args[slot];
              return typeof candidate === 'number' ? candidate : Number.NaN;
            };
            dispatches.push({
              method,
              trackId: typeof candidateTrackId === 'string'
                ? candidateTrackId
                : '<missing-track-id>',
              instrumentOrPresetId: typeof candidateInstrumentOrPresetId === 'string'
                ? candidateInstrumentOrPresetId
                : '<missing-instrument-or-preset-id>',
              pitchUnit: layout.pitchUnit,
              musicalPitch: numericArgument(layout.pitchSlot),
              midiVelocity: numericArgument(layout.midiVelocitySlot),
              noteGain: numericArgument(layout.noteGainSlot),
              eventTimeSeconds: numericArgument(layout.eventTimeSlot),
              durationSeconds: numericArgument(layout.durationSlot),
              argumentCount: args.length,
              variationKey: candidateVariationKey === undefined
                ? null
                : typeof candidateVariationKey === 'string'
                  ? candidateVariationKey
                  : '<invalid-variation-key>',
            });
          }
          return Reflect.apply(original, this, args);
        },
      });
    }

    const probe: DispatchProbe = {
      arm: () => {
        dispatches = [];
        armed = true;
      },
      disarm: () => {
        armed = false;
      },
      readAndDisarm: () => {
        armed = false;
        return dispatches.map(dispatch => ({ ...dispatch }));
      },
      uninstall: () => {
        armed = false;
        for (const method of methods) {
          const descriptor = ownDescriptors.get(method);
          if (descriptor) Object.defineProperty(engine, method, descriptor);
          else delete engine[method];
        }
        if (globals.__liveQualityDispatchProbe__ === probe) {
          delete globals.__liveQualityDispatchProbe__;
        }
      },
    };
    globals.__liveQualityDispatchProbe__ = probe;
  }, LIVE_ENGINE_DISPATCH_LAYOUT_BY_METHOD);
}

async function armTrialObservation(
  page: Page,
  orderedTrackIds: string[],
): Promise<PreArmIsolationSnapshot> {
  return page.evaluate((trackIds) => {
    type DispatchProbe = { arm: () => void };
    type Globals = {
      __liveQualityCommandedTrackBusOpenIds__?: string[];
      __liveQualityDispatchProbe__?: DispatchProbe;
    };
    const globals = window as unknown as Globals;
    const muteButtons = [...document.querySelectorAll<HTMLButtonElement>('.track-row .mute-button')];
    if (muteButtons.length !== trackIds.length) {
      throw new Error('Track UI count changed before isolated trial arm');
    }
    const uiUnmutedTrackIds = muteButtons.flatMap((button, index) =>
      button.getAttribute('aria-pressed') === 'false' ? [trackIds[index]] : []
    );
    const commandedTrackBusOpenIds = [
      ...(globals.__liveQualityCommandedTrackBusOpenIds__ ?? []),
    ].sort();
    if (!globals.__liveQualityDispatchProbe__) {
      throw new Error('Audio engine dispatch probe unavailable before trial arm');
    }
    globals.__liveQualityDispatchProbe__.arm();
    return { uiUnmutedTrackIds, commandedTrackBusOpenIds };
  }, orderedTrackIds);
}

async function readAndDisarmEngineDispatchProbe(page: Page): Promise<LiveEngineDispatch[]> {
  return page.evaluate(() => {
    type DispatchProbe = { readAndDisarm: () => LiveEngineDispatch[] };
    const probe = (window as unknown as {
      __liveQualityDispatchProbe__?: DispatchProbe;
    }).__liveQualityDispatchProbe__;
    if (!probe) throw new Error('Audio engine dispatch probe unavailable after trial');
    return probe.readAndDisarm();
  });
}

async function disarmEngineDispatchProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as unknown as {
      __liveQualityDispatchProbe__?: { disarm: () => void };
    }).__liveQualityDispatchProbe__;
    probe?.disarm();
  });
}

async function uninstallEngineDispatchProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as unknown as {
      __liveQualityDispatchProbe__?: { uninstall: () => void };
    }).__liveQualityDispatchProbe__;
    probe?.uninstall();
  });
}

async function installDeterministicRandom(page: Page): Promise<void> {
  await page.addInitScript(({ seed, algorithm }) => {
    if (algorithm !== 'mulberry32') throw new Error(`Unsupported live-quality RNG ${algorithm}`);
    type RandomReceipt = { seed: number; state: number; calls: number; algorithm: string };
    type RandomResetReceipt = { seed: number; algorithm: string; calls: 0 };
    const globals = window as unknown as {
      __liveQualityRandom__?: RandomReceipt;
      __liveQualityRandomReset__?: RandomResetReceipt;
    };
    Object.defineProperty(globals, '__liveQualityRandomReset__', {
      configurable: false,
      writable: false,
      value: Object.freeze({ seed, algorithm, calls: 0 as const }),
    });
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
    let timeoutId = 0;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error('Timed out arming continuous energy capture')),
        5_000,
      );
    });
    let message: ArmedMessage;
    try {
      message = await Promise.race([armed, timeout]);
    } finally {
      window.clearTimeout(timeoutId);
    }
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

    let timeoutId = 0;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error('Timed out reading continuous energy capture')),
        10_000,
      );
    });
    let result: DoneMessage;
    try {
      result = await Promise.race([probe.done, timeout]);
    } finally {
      window.clearTimeout(timeoutId);
    }
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
    probe.node.port.onmessage = null;
    probe.node.port.close();
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

async function cleanupContinuousEnergyCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Probe = {
      node: AudioWorkletNode;
      sources: AudioNode[];
      keepAlive: GainNode;
    };
    type Globals = { __allInstrumentSequencerProbe__?: Probe };
    const globals = window as unknown as Globals;
    const probe = globals.__allInstrumentSequencerProbe__;
    if (!probe) return;
    probe.sources.forEach((source, inputIndex) => {
      try {
        source.disconnect(probe.node, 0, inputIndex);
      } catch {
        // A completed read or navigation may already have removed this edge.
      }
    });
    probe.node.port.onmessage = null;
    probe.node.port.close();
    try {
      probe.node.disconnect();
    } catch {
      // A completed read may already have disconnected the node.
    }
    try {
      probe.keepAlive.disconnect();
    } catch {
      // A completed read may already have disconnected the keepalive node.
    }
    delete globals.__allInstrumentSequencerProbe__;
  });
}

function getPlayButton(page: Page) {
  return page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first();
}

async function stopPlaybackIfActive(page: Page): Promise<void> {
  const playButton = getPlayButton(page);
  const label = await playButton.getAttribute('aria-label');
  if (label === 'Stop') {
    await playButton.click();
    await expect(playButton).toHaveAttribute('aria-label', 'Play', { timeout: 10_000 });
  } else if (label !== 'Play') {
    throw new Error(`Play button exposed unexpected aria-label ${String(label)}`);
  }
}

async function cleanupIsolatedTrial(
  page: Page,
  trackIndex: number,
  trackId: string,
): Promise<void> {
  const failures: Array<{ action: string; error: unknown }> = [];
  const attempt = async (action: string, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      failures.push({ action, error });
    }
  };
  await attempt('disarm dispatch probe', () => disarmEngineDispatchProbe(page));
  await attempt('stop transport', () => stopPlaybackIfActive(page));
  await attempt('disconnect continuous capture', () => cleanupContinuousEnergyCapture(page));
  await attempt('re-mute UI and TrackBus', () => setTrackMuted(page, trackIndex, trackId, true));
  if (failures.length > 0) {
    const cleanupError = new Error(
      `Isolated trial cleanup failed: ${failures.map(failure => failure.action).join(', ')}`,
    );
    Object.defineProperty(cleanupError, 'failures', { value: failures });
    throw cleanupError;
  }
}

async function readSessionExecution(
  page: Page,
  browserName: string,
  browserVersion: string,
): Promise<LiveSessionResult['execution']> {
  const observed = await page.evaluate(({ seed, algorithm }) => {
    type RandomResetReceipt = { seed: number; algorithm: string; calls: number };
    type RandomState = { seed: number; algorithm: string; calls: number };
    const globals = window as unknown as {
      __liveQualityRandomReset__?: RandomResetReceipt;
      __liveQualityRandom__?: RandomState;
    };
    const reset = globals.__liveQualityRandomReset__;
    const state = globals.__liveQualityRandom__;
    const descriptor = Object.getOwnPropertyDescriptor(globals, '__liveQualityRandomReset__');
    if (reset?.seed !== seed
      || reset.algorithm !== algorithm
      || reset.calls !== 0
      || descriptor?.writable !== false
      || descriptor.configurable !== false
      || !Object.isFrozen(reset)
      || state?.seed !== seed
      || state.algorithm !== algorithm
      || !Number.isInteger(state.calls)
      || state.calls < 0) {
      throw new Error('Fresh document did not expose the pinned deterministic-random reset');
    }
    return {
      userAgent: navigator.userAgent,
      randomReset: { seed: reset.seed, algorithm: reset.algorithm, calls: 0 as const },
    };
  }, { seed: LIVE_RANDOM_SEED, algorithm: LIVE_RANDOM_ALGORITHM });
  if (observed.userAgent.trim().length === 0) {
    throw new Error('Fresh batch page exposed an empty browser user agent');
  }
  return {
    lifecycle: LIVE_SESSION_LIFECYCLE,
    browser: { name: browserName, version: browserVersion, userAgent: observed.userAgent },
    randomReset: observed.randomReset,
  };
}

async function assertAacDecodeSupport(page: Page): Promise<void> {
  const aacSupport = await page.evaluate(() =>
    document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"')
  );
  expect(
    aacSupport,
    `this browser cannot decode AAC/m4a (canPlayType: "${aacSupport}"), so every `
      + 'm4a-backed instrument would be reported silent regardless of routing. Run '
      + 'with Playwright\'s bundled Chromium (npx playwright install chromium).',
  ).not.toBe('');
}

async function shutdownAudioEngine(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const engine = (window as unknown as {
      __audioEngine__?: {
        getAudioContext?: () => AudioContext | null;
        shutdown?: () => Promise<void>;
      };
    }).__audioEngine__;
    if (!engine?.shutdown) {
      throw new Error('Prepared batch page lost AudioEngine.shutdown before teardown');
    }
    const audioContext = engine.getAudioContext?.();
    if (!audioContext) {
      throw new Error('Prepared batch page lost its AudioContext before teardown');
    }
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error('Timed out awaiting AudioEngine.shutdown for batch teardown')),
        10_000,
      );
    });
    try {
      await Promise.race([engine.shutdown(), timeout]);
    } finally {
      window.clearTimeout(timer);
    }
    // AudioEngine.shutdown deliberately catches close() errors. The evaluator
    // must independently prove that this session released the scarce browser
    // media resource before another context is created.
    if (audioContext.state !== 'closed') {
      throw new Error(`AudioContext remained ${audioContext.state} after AudioEngine.shutdown`);
    }
  });
}

async function cleanupBatchRuntime(
  context: BrowserContext,
  page: Page | null,
  audioInitializationAttempted: boolean,
): Promise<void> {
  const failures: Array<{ action: string; error: unknown }> = [];
  const attempt = async (action: string, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      failures.push({ action, error });
    }
  };

  if (page && !page.isClosed()) {
    await attempt('uninstall engine dispatch probe', () => uninstallEngineDispatchProbe(page));
    if (audioInitializationAttempted) {
      await attempt('await AudioEngine.shutdown', () => shutdownAudioEngine(page));
    }
  } else if (audioInitializationAttempted) {
    failures.push({
      action: 'await AudioEngine.shutdown',
      error: new Error('Prepared batch page closed before AudioEngine.shutdown'),
    });
  }
  await attempt('close fresh browser context', () => context.close());

  if (failures.length > 0) {
    const cleanupError = new Error(
      `Batch runtime cleanup failed: ${failures.map(failure => failure.action).join(', ')}`,
    );
    Object.defineProperty(cleanupError, 'failures', { value: failures });
    throw cleanupError;
  }
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

test('every catalog instrument is non-silent at isolated track and masterGain taps', async ({ browser, request, browserName }) => {
  test.setTimeout(900_000);
  const specs = allInstrumentSpecs();
  expect(specs).toHaveLength(99);
  expect(new Set(specs.map(spec => spec.sampleId)).size).toBe(specs.length);
  expect(LIVE_STEP_COUNT * (60 / LIVE_TEMPO / 4)).toBe(LIVE_PATTERN_PERIOD_SECONDS);
  expect(LIVE_ACTIVE_STEP * (60 / LIVE_TEMPO / 4)).toBe(LIVE_ACTIVE_STEP_OFFSET_SECONDS);
  expect(LIVE_ACTIVE_STEP_OFFSET_SECONDS).toBeGreaterThan(LIVE_SCHEDULER_LOOKAHEAD_SECONDS);
  expect(LIVE_PATTERN_PERIOD_SECONDS).toBeGreaterThan(LIVE_CAPTURE_DURATION_SECONDS);
  expect(browserName).toBe('chromium');
  const subjectCommit = cleanSubjectCommit();

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let receiptPublished = false;
  browser.on('disconnected', () => {
    if (!receiptPublished) {
      pageErrors.push('[browser] disconnected before live receipt publication');
    }
  });
  const results: TrackProbeResult[] = [];
  const audioSampleRates = new Set<number>();
  const sessionResults: LiveSessionResult[] = [];
  const browserVersion = browser.version();
  let receiptBrowser: LiveQualityReport['browser'] | null = null;

  for (const [batchIndex, batchSpecs] of chunk(specs, MAX_TRACKS).entries()) {
    const tracks = batchSpecs.map((spec, i) => buildSequencerTrack(spec, batchIndex * MAX_TRACKS + i));
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks,
      tempo: LIVE_TEMPO,
      swing: 0,
      version: 1,
    });
    const diagnosticPrefix = `[batch ${batchIndex + 1} session ${sessionId}]`;
    const context = await createE2EContext(browser, browserName);
    let batchPage: Page | null = null;
    let audioInitializationAttempted = false;
    let batchTeardownStarted = false;
    let cleanupFailure: unknown;
    context.on('close', () => {
      if (!batchTeardownStarted) {
        pageErrors.push(`${diagnosticPrefix} browser context closed unexpectedly`);
      }
    });
    try {
      const page = await context.newPage();
      batchPage = page;
      await installDeterministicRandom(page);
      page.on('pageerror', error => pageErrors.push(`${diagnosticPrefix} ${error.message}`));
      page.on('crash', () => pageErrors.push(`${diagnosticPrefix} page crashed`));
      page.on('close', () => {
        if (!batchTeardownStarted) {
          pageErrors.push(`${diagnosticPrefix} page closed unexpectedly`);
        }
      });
      page.on('console', message => {
        const text = message.text();
        if (
          message.type() === 'error'
          || text.includes('Sample not found')
          || (text.includes('not ready') && text.includes('skipping'))
        ) {
          consoleErrors.push(`${diagnosticPrefix} [${message.type()}] ${text}`);
        }
      });

      await page.goto(`${API_BASE}/s/${sessionId}`);
      await waitForAppReady(page);
      await expect(page.locator('.track-row')).toHaveCount(tracks.length, { timeout: 20_000 });
      // Codec support is checked inside every fresh context so no batch can
      // silently inherit a capability assumption from another document.
      await assertAacDecodeSupport(page);
      const execution = await readSessionExecution(page, browserName, browserVersion);
      if (receiptBrowser === null) receiptBrowser = execution.browser;
      else expect(execution.browser).toEqual(receiptBrowser);

      audioInitializationAttempted = true;
      await prepareAudioForTracks(page, tracks);
      await installEngineDispatchProbe(page);
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
        instruments: batchSpecs.map(spec => spec.sampleId),
        sampleRate: expectedSampleRate,
        execution,
      });

      for (const [i, spec] of batchSpecs.entries()) {
        const trackId = tracks[i].id;
        // Calibration is deliberately single-audible-track. Muted release tails
        // may remain allocated; polyphonic behaviour has separate matrix coverage
        // and must not move an instrument's level rank.
        let energy: EnergyCaptureResult | null = null;
        let isolationSnapshot: PreArmIsolationSnapshot | null = null;
        let observedEngineDispatches: LiveEngineDispatch[] | null = null;
        let trialPrimaryError: unknown;
        let trialCleanupFailure: unknown;
        try {
          await setTrackMuted(page, i, trackId, false);
          await attachContinuousEnergyCapture(page, [trackId]);
          isolationSnapshot = await armTrialObservation(page, tracks.map(track => track.id));
          expect(isolationSnapshot.uiUnmutedTrackIds).toEqual([trackId]);
          expect(isolationSnapshot.commandedTrackBusOpenIds).toEqual([trackId]);
          await armAndStartContinuousEnergyCapture(page);
          energy = await readContinuousEnergyCapture(page);
          await stopPlaybackIfActive(page);
          observedEngineDispatches = await readAndDisarmEngineDispatchProbe(page);
          expect(observedEngineDispatches).toHaveLength(1);
          expect(observedEngineDispatches[0]).toMatchObject(
            expectedLiveEngineDispatchIdentity(spec, trackId),
          );
          expect(Number.isFinite(observedEngineDispatches[0].eventTimeSeconds)).toBe(true);
          expect(observedEngineDispatches[0].eventTimeSeconds).toBeGreaterThanOrEqual(0);
        } catch (error) {
          trialPrimaryError = error;
          throw error;
        } finally {
          try {
            await cleanupIsolatedTrial(page, i, trackId);
          } catch (cleanupError) {
            trialCleanupFailure = cleanupError;
            if (trialPrimaryError instanceof Error) {
              try {
                Object.defineProperty(trialPrimaryError, 'cleanupError', { value: cleanupError });
              } catch {
                // Never replace the trial's primary failure with cleanup metadata.
              }
            }
          }
        }
        if (trialCleanupFailure !== undefined) throw trialCleanupFailure;
        if (!energy || !isolationSnapshot || !observedEngineDispatches) {
          throw new Error(`Isolated trial ${trackId} completed without all evidence fields`);
        }
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
          preArmUiUnmutedTrackIds: isolationSnapshot.uiUnmutedTrackIds,
          preArmCommandedTrackBusOpenIds: isolationSnapshot.commandedTrackBusOpenIds,
          observedEngineDispatches,
        });
      }
    } finally {
      batchTeardownStarted = true;
      try {
        await cleanupBatchRuntime(context, batchPage, audioInitializationAttempted);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (cleanupFailure !== undefined) throw cleanupFailure;
  }

  if (receiptBrowser === null) throw new Error('Live capture produced no browser identity');

  const receipt: LiveQualityReport = {
    schemaVersion: LIVE_RECEIPT_SCHEMA_VERSION,
    claim: LIVE_RECEIPT_CLAIM,
    generatedAt: new Date().toISOString(),
    subjectCommit,
    browser: receiptBrowser,
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
      scheduledActiveStepsPerTrack: LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK,
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
    'Every isolated instrument trial should be non-silent at the pre-processing masterGain tap',
  ).toEqual([]);
  expect(
    silentTracks.map(r => ({ sampleId: r.sampleId, type: r.type, pitch: r.pitch, peak: r.peak, rms: r.rms })),
    'Every catalog instrument should produce per-track output from a scheduled sequencer step',
  ).toEqual([]);

  // Publish only evidence that has passed the producer's runtime assertions
  // and the same pure schema/provenance validator used by the aggregator.
  const endingSubjectCommit = cleanSubjectCommit();
  expect(
    endingSubjectCommit,
    'Live audio evidence subject changed while the browser capture was running',
  ).toBe(subjectCommit);
  validateLiveQualityReport(receipt, subjectCommit);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'live-master-output.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  receiptPublished = true;
});
