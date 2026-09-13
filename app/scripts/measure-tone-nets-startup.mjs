#!/usr/bin/env node

/**
 * Reproduce the Phase 44 first-contact startup comparison against the frozen
 * Tone Nets production build. Start that build's preview server first, then
 * pass its local URL here. The asset hashes keep a later deploy or checkout
 * from silently changing the measured subject.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const EXPECTED_ASSETS = [
  {
    path: '/',
    bytes: 20_769,
    sha256: 'b6d5081148baa2c693caab8d392c14ce1d1d11a3b64f1c79b7aa23a65a4100ac',
  },
  {
    path: '/assets/index-D6Mm5cJ7.js',
    bytes: 119_027,
    sha256: '196c447bc8fc6d0e1b7816edf2dd163941d1c15110f2ea15e71d8861d6ba1a3b',
  },
  {
    path: '/assets/index-CAIWfFlo.css',
    bytes: 9_479,
    sha256: '065a073175e5ad1bdb2561e9e654f05d06c5f42e546ca1187d055bae400734fd',
  },
  {
    path: '/assets/vendor-tone-CEpHDcb7.js',
    bytes: 560_475,
    sha256: '153e720f4b45f878d6feeacfbc215cab0493ee88c50eb153b9e772be00b9beab',
  },
  {
    path: '/assets/vendor-three-DPBQW5Ox.js',
    bytes: 616_486,
    sha256: 'a10572eb76aaf31c2865edb41c737b9765225b70abf042a3e929ac753e929d61',
  },
  {
    path: '/assets/rolldown-runtime-B0Z9INg1.js',
    bytes: 901,
    sha256: '5e9b0d884d2ebb14e241ab38b43e41efb61bce2e74d71507b0b95b264fba4047',
  },
  {
    path: '/assets/parser.worker-BGliF577.js',
    bytes: 44_123,
    sha256: 'e37866ef524e1a6ad8847d670434c01e6e223afc7ad94cf25ccaa1ab26cc7f11',
  },
  {
    path: '/assets/spessasynth_processor.min-B_uip0PK.js',
    bytes: 407_436,
    sha256: '72a9b2cd8f9589bcd80b2663d6d8be69386cf2aa887619d827a32de2e99e4439',
  },
  {
    path: '/creative-emu10k1-8mbgmsfx.sf2',
    bytes: 7_557_598,
    sha256: '6c2ff6e9219989e0a2d39e633cbdc7d8f8a575903985160495aeab5d01cc48e6',
  },
  {
    path: '/background.mp3',
    bytes: 46_080,
    sha256: '830b89effd32a7a893486801808792cc1bde8abd076193aaee0c48b3c6f4bb46',
  },
];

const argv = process.argv.slice(2);
function option(name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

const url = option('--url', process.env.TONE_NETS_URL ?? 'http://127.0.0.1:4175/');
const trials = Number(option('--trials', '5'));
const output = option('--output', 'test-results/audio-capture/tone-nets-cold-startup.json');
if (!Number.isInteger(trials) || trials < 1 || trials > 30) {
  throw new Error(`--trials must be an integer from 1 to 30; received ${trials}`);
}

function variableLength(value) {
  const bytes = [value & 0x7f];
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function midiFixture() {
  const events = [];
  const add = (delta, ...bytes) => events.push(...variableLength(delta), ...bytes);
  add(0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20); // 120 BPM
  add(0, 0xc0, 48); // GM String Ensemble 1
  for (const [index, velocity] of [40, 90, 127, 40, 90, 127].entries()) {
    // Put the first note at MIDI time zero. Startup latency must not include
    // authored silence from the comparison fixture.
    add(index === 0 ? 0 : 240, 0x90, 60, velocity);
    add(240, 0x80, 60, 0);
  }
  add(0, 0xff, 0x2f, 0x00);
  const header = Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
  ]);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write('MTrk', 0, 'ascii');
  trackHeader.writeUInt32BE(events.length, 4);
  return Buffer.concat([header, trackHeader, Buffer.from(events)]);
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((sorted.length - 1) * quantile)];
}

function installFirstPcmProbe() {
  const probe = window.__objectiveAudioProbe = {
    attached: false,
    attachedAt: 0,
    workletReadyAt: null,
    actionAt: null,
    firstPcmAt: null,
    firstFrameReceivedAt: null,
    firstContextTime: null,
    silentFramesBeforeFirstPcm: null,
    setupError: null,
    setupDelayMs: 0,
    masterSource: null,
    firstMasterInputConnectedAt: null,
    sampleRate: 0,
    peak: 0,
  };
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    const destination = args[0];
    const result = Reflect.apply(originalConnect, this, args);
    if (!probe.attached && destination instanceof AnalyserNode && this instanceof GainNode) {
      probe.attached = true;
      probe.attachedAt = performance.now();
      probe.masterSource = this;
      const context = this.context;
      const processorName = 'tone-nets-first-pcm-probe';
      const setupDelayMs = probe.setupDelayMs;
      const moduleSource = `
        class ToneNetsFirstPcmProbe extends AudioWorkletProcessor {
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
        registerProcessor('tone-nets-first-pcm-probe', ToneNetsFirstPcmProbe);
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
          processor.port.onmessage = (event) => {
            if (event.data.type !== 'first-pcm' || probe.firstContextTime !== null) return;
            probe.firstFrameReceivedAt = performance.now();
            probe.firstContextTime = event.data.absoluteFrame / context.sampleRate;
            probe.silentFramesBeforeFirstPcm = event.data.silentFramesBeforeFirstPcm;
            probe.peak = event.data.magnitude;
            const mappingStartedAt = performance.now();
            const mapFirstPcmToPageClock = () => {
              const timestamp = context.getOutputTimestamp();
              if (timestamp.performanceTime <= 0) {
                if (performance.now() - mappingStartedAt >= 2_000) {
                  probe.setupError = 'AudioContext.getOutputTimestamp returned no clock mapping';
                } else {
                  setTimeout(mapFirstPcmToPageClock, 5);
                }
                return;
              }
              probe.firstPcmAt = timestamp.performanceTime
                + (probe.firstContextTime - timestamp.contextTime) * 1_000;
            };
            mapFirstPcmToPageClock();
          };
          originalConnect.call(this, processor);
          originalConnect.call(processor, sink);
          originalConnect.call(sink, context.destination);
          probe.sampleRate = context.sampleRate;
          probe.workletReadyAt = performance.now();
        } catch (error) {
          probe.setupError = error instanceof Error ? error.message : String(error);
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
      })();
    }
    if (
      probe.attached
      && probe.masterSource !== null
      && destination === probe.masterSource
      && this !== probe.masterSource
      && probe.firstMasterInputConnectedAt === null
    ) {
      probe.firstMasterInputConnectedAt = performance.now();
    }
    return result;
  };
}

async function verifyFrozenBuild(baseUrl) {
  const observations = [];
  for (const expected of EXPECTED_ASSETS) {
    const assetUrl = new URL(expected.path, baseUrl);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`${assetUrl} returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const observation = { path: expected.path, bytes: bytes.length, sha256 };
    observations.push(observation);
    if (bytes.length !== expected.bytes || sha256 !== expected.sha256) {
      throw new Error(
        `Frozen Tone Nets asset mismatch for ${expected.path}: `
        + `received ${bytes.length} bytes / ${sha256}`,
      );
    }
  }
  return observations;
}

const frozenAssets = await verifyFrozenBuild(url);
const fixtureDirectory = mkdtempSync(join(tmpdir(), 'keyboardia-tone-nets-'));
const fixturePath = join(fixtureDirectory, 'objective-startup.mid');
writeFileSync(fixturePath, midiFixture());

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

try {
  const controlContext = await browser.newContext();
  const controlPage = await controlContext.newPage();
  await controlPage.addInitScript(installFirstPcmProbe);
  await controlPage.goto(url, { waitUntil: 'networkidle' });
  const probeControl = await controlPage.evaluate(async () => {
    const probe = window.__objectiveAudioProbe;
    const audioContext = new AudioContext();
    await audioContext.resume();

    const overloadSource = audioContext.createGain();
    const merger = audioContext.createChannelMerger(2);
    Reflect.apply(overloadSource.connect, overloadSource, [merger, undefined, 1]);
    const parameterDestination = audioContext.createGain();
    overloadSource.connect(parameterDestination.gain, 0);
    overloadSource.disconnect();

    const master = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    const outputSink = audioContext.createGain();
    outputSink.gain.value = 0;
    master.connect(analyser);
    analyser.connect(outputSink);
    outputSink.connect(audioContext.destination);
    while (probe.workletReadyAt === null && probe.setupError === null) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (probe.setupError !== null) throw new Error(probe.setupError);

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
    while (probe.firstContextTime === null && probe.setupError === null) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (probe.setupError !== null) throw new Error(probe.setupError);
    const result = {
      sampleRate: audioContext.sampleRate,
      scheduledContextTime,
      observedContextTime: probe.firstContextTime,
      retainedFrameErrorMs: (probe.firstContextTime - scheduledContextTime) * 1_000,
      mainThreadBlockedMs: performance.now() - blockedAt,
      messageReceived: probe.firstFrameReceivedAt !== null,
      silentFramesBeforeFirstPcm: probe.silentFramesBeforeFirstPcm,
      workletReadyAt: probe.workletReadyAt,
      firstMasterInputConnectedAt: probe.firstMasterInputConnectedAt,
      explicitUndefinedConnectOverload: 'preserved',
      audioParamConnectOverload: 'preserved',
    };
    await audioContext.close();
    return result;
  });
  await controlContext.close();
  if (!probeControl.messageReceived || probeControl.mainThreadBlockedMs < 700) {
    throw new Error('AudioWorklet probe control did not span the deliberate main-thread block');
  }
  if (Math.abs(probeControl.retainedFrameErrorMs) > 256 / probeControl.sampleRate * 1_000) {
    throw new Error(
      `AudioWorklet probe lost the scheduled onset frame: ${probeControl.retainedFrameErrorMs} ms`,
    );
  }
  if (probeControl.silentFramesBeforeFirstPcm < 1) {
    throw new Error('AudioWorklet probe did not retain a silent prefix before the control onset');
  }
  if (probeControl.firstMasterInputConnectedAt < probeControl.workletReadyAt) {
    throw new Error('AudioWorklet probe was not ready before the control source connection');
  }

  const delayedContext = await browser.newContext();
  const delayedPage = await delayedContext.newPage();
  await delayedPage.addInitScript(installFirstPcmProbe);
  await delayedPage.goto(url, { waitUntil: 'networkidle' });
  const delayedInstallControl = await delayedPage.evaluate(async () => {
    const probe = window.__objectiveAudioProbe;
    probe.setupDelayMs = 250;
    const audioContext = new AudioContext();
    await audioContext.resume();
    const master = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    const outputSink = audioContext.createGain();
    outputSink.gain.value = 0;
    master.connect(analyser);
    analyser.connect(outputSink);
    outputSink.connect(audioContext.destination);
    const source = audioContext.createConstantSource();
    const gate = audioContext.createGain();
    source.offset.value = 0.25;
    gate.gain.value = 0;
    source.connect(gate);
    gate.connect(master);
    const firstPulseAt = audioContext.currentTime + 0.02;
    for (const offset of [0, 0.4, 0.8]) {
      gate.gain.setValueAtTime(1, firstPulseAt + offset);
      gate.gain.setValueAtTime(0, firstPulseAt + offset + 0.02);
    }
    source.start(firstPulseAt);
    source.stop(firstPulseAt + 1);
    while (probe.firstContextTime === null && probe.setupError === null) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (probe.setupError !== null) throw new Error(probe.setupError);
    const result = {
      silentFramesBeforeFirstPcm: probe.silentFramesBeforeFirstPcm,
      observedOnsetErrorMs: (probe.firstContextTime - firstPulseAt) * 1_000,
      boundaryViolation: probe.workletReadyAt > probe.firstMasterInputConnectedAt,
    };
    await audioContext.close();
    return result;
  });
  await delayedContext.close();
  if (
    delayedInstallControl.silentFramesBeforeFirstPcm < 1
    || delayedInstallControl.observedOnsetErrorMs <= 200
    || !delayedInstallControl.boundaryViolation
  ) {
    throw new Error('Delayed-installation control did not prove the application-boundary guard');
  }
  probeControl.delayedInstallSilentFrames = delayedInstallControl.silentFramesBeforeFirstPcm;
  probeControl.delayedInstallObservedOnsetErrorMs = delayedInstallControl.observedOnsetErrorMs;
  probeControl.delayedInstallBoundaryViolation = delayedInstallControl.boundaryViolation;
  probeControl.delayedInstallRejected = true;

  const observations = [];
  for (let trial = 0; trial < trials; trial++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(installFirstPcmProbe);

    await page.goto(url, { waitUntil: 'networkidle' });
    const loopToggle = page.locator('#loop-toggle');
    if (await loopToggle.isChecked()) await loopToggle.uncheck();
    const upload = page.locator('#midi-upload');
    await upload.evaluate((element) => {
      element.addEventListener('change', () => {
        window.__objectiveAudioProbe.actionAt = performance.now();
      }, { capture: true, once: true });
    });
    await upload.setInputFiles(fixturePath);
    await page.waitForFunction(
      () => {
        const probe = window.__objectiveAudioProbe;
        return probe?.firstPcmAt !== null || probe?.setupError !== null;
      },
      undefined,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(100);
    const observation = await page.evaluate(() => {
      const probe = window.__objectiveAudioProbe;
      if (
        !probe?.attached
        || probe.actionAt === null
        || probe.firstPcmAt === null
        || probe.firstFrameReceivedAt === null
        || probe.firstContextTime === null
        || probe.silentFramesBeforeFirstPcm === null
        || probe.workletReadyAt === null
        || probe.firstMasterInputConnectedAt === null
      ) {
        throw new Error(probe?.setupError ?? 'Tone Nets master tap did not observe first PCM');
      }
      return {
        trial: 0,
        sampleRate: probe.sampleRate,
        tapAttachedMs: probe.attachedAt - probe.actionAt,
        workletReadyMs: probe.workletReadyAt - probe.actionAt,
        firstMasterInputConnectedMs: probe.firstMasterInputConnectedAt - probe.actionAt,
        actionToMasterPcmMs: probe.firstPcmAt - probe.actionAt,
        messageLagMs: probe.firstFrameReceivedAt - probe.firstPcmAt,
        firstPcmContextTime: probe.firstContextTime,
        silentFramesBeforeFirstPcm: probe.silentFramesBeforeFirstPcm,
        clockMapping: 'audio-frame/getOutputTimestamp',
        peak: probe.peak,
      };
    });
    observation.trial = trial + 1;
    if (observation.clockMapping !== 'audio-frame/getOutputTimestamp') {
      throw new Error(`Trial ${trial + 1} could not map context time to the performance clock`);
    }
    if (observation.workletReadyMs >= observation.actionToMasterPcmMs) {
      throw new Error(`Trial ${trial + 1} emitted PCM before the worklet oracle was ready`);
    }
    if (observation.workletReadyMs > observation.firstMasterInputConnectedMs) {
      throw new Error(`Trial ${trial + 1} connected a master input before the worklet oracle was ready`);
    }
    if (observation.firstMasterInputConnectedMs >= observation.actionToMasterPcmMs) {
      throw new Error(`Trial ${trial + 1} has no pre-emission master-input boundary`);
    }
    if (observation.peak < 1e-4) throw new Error(`Trial ${trial + 1} did not reach the PCM threshold`);
    observations.push(observation);
    await context.close();
  }

  const firstPcm = observations.map(observation => observation.actionToMasterPcmMs);
  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    subject: {
      name: 'Tone Nets',
      source: 'https://github.com/rowan-m/tone-nets',
      sourceCommit: 'd6e9ba837f2e408971458c5ca6f6b63d0c909d76',
      url,
      frozenAssets,
    },
    fixture: {
      definition: 'fresh browser context, warm local server/browser process, DOM change event to first master-bus sample',
      midi: '120 BPM; GM String Ensemble 1; repeated C4 velocities 40/90/127',
      threshold: 1e-4,
      oracle: 'AudioWorklet-retained absolute render frame mapped through AudioContext.getOutputTimestamp(); readiness precedes the first source-to-master connection',
      probeControl,
    },
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      browser: `Chromium ${browser.version()}`,
    },
    summary: {
      trials: observations.length,
      actionToMasterPcmMs: {
        min: Math.min(...firstPcm),
        median: percentile(firstPcm, 0.5),
        p95: percentile(firstPcm, 0.95),
        max: Math.max(...firstPcm),
      },
    },
    observations,
  };
  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
