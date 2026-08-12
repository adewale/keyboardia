import {
  bandRmsDb,
  hitCorrelation,
  loudnessKMax,
  peakDbfs,
  rmsDb,
  spectralCentroidHz,
} from '../src/test/audio-measures';
import { mulberry32 } from '../src/test/seeded-random';
import { createSynthesizedSamples } from '../src/audio/samples';
import { SynthEngine, SYNTH_PRESETS } from '../src/audio/synth';
import {
  MASTER_COMPRESSOR_SETTINGS,
  MASTER_OUTPUT_TRIM_DB,
} from '../src/audio/constants';
import {
  ATTACK_FADE_SEC,
  RELEASE_FLOOR_GAIN,
  RELEASE_TAIL_GUARD_SEC,
  computeNoteSchedule,
} from '../src/audio/note-schedule';
import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 44_100;
const CORE_PRESETS = ['bass', 'lead', 'pad', 'pluck'] as const;
const PROCEDURAL_IDS = [
  'kick',
  'snare',
  'hihat',
  'openhat',
  'bass',
  'lead',
  'pluck',
  'pad',
] as const;

function sliceSeconds(
  source: Float32Array,
  startSeconds: number,
  endSeconds: number,
): Float32Array {
  return source.slice(
    Math.round(startSeconds * SAMPLE_RATE),
    Math.round(endSeconds * SAMPLE_RATE),
  );
}

function round(value: number): number | null {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function firstBelowDb(
  source: Float32Array,
  thresholdDb: number,
  windowMilliseconds = 10,
): number | null {
  const windowFrames = Math.round(SAMPLE_RATE * windowMilliseconds / 1000);
  const requiredWindows = 3;
  for (let start = 0; start + windowFrames * requiredWindows <= source.length; start += windowFrames) {
    let below = true;
    for (let window = 0; window < requiredWindows; window++) {
      const level = rmsDb(source, {
        start: start + window * windowFrames,
        end: start + (window + 1) * windowFrames,
      });
      if (level > thresholdDb) {
        below = false;
        break;
      }
    }
    if (below) return start / SAMPLE_RATE;
  }
  return null;
}

async function renderCorePreset(presetId: typeof CORE_PRESETS[number]): Promise<Float32Array> {
  const { OfflineAudioContext } = await import('node-web-audio-api');
  const context = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * 1.5), SAMPLE_RATE);
  const output = context.createGain();
  output.connect(context.destination);
  const engine = new SynthEngine();
  engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
  engine.playNote(
    `measure-${presetId}`,
    261.625565,
    SYNTH_PRESETS[presetId],
    0.05,
    0.65,
    1,
    undefined,
    90,
  );
  const rendered = await context.startRendering();
  const channel = new Float32Array(rendered.length);
  rendered.copyFromChannel(channel, 0);
  return channel;
}

async function main(): Promise<void> {
  const { OfflineAudioContext } = await import('node-web-audio-api');
  const context = new OfflineAudioContext(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  const samples = await createSynthesizedSamples(
    context as unknown as AudioContext,
    mulberry32(0x43_0011),
  );

  const procedural = Object.fromEntries(PROCEDURAL_IDS.map((sampleId) => {
    const sample = samples.get(sampleId)!;
    const playbackGain = sample.playbackGain ?? 1;
    const pcm = Float32Array.from(
      sample.buffer!.getChannelData(0),
      value => value * playbackGain,
    );
    const variations = (sample as typeof sample & { variations?: readonly AudioBuffer[] }).variations
      ?? [sample.buffer!];
    return [sampleId, {
      peakDbfs: round(peakDbfs(pcm)),
      rmsDb: round(rmsDb(pcm)),
      loudnessKMax: round(loudnessKMax(pcm, SAMPLE_RATE)),
      spectralCentroidHz: round(spectralCentroidHz(pcm, SAMPLE_RATE)),
      lowMidDb: round(bandRmsDb(pcm, SAMPLE_RATE, 80, 2_000)),
      highDb: round(bandRmsDb(pcm, SAMPLE_RATE, 5_000, SAMPLE_RATE / 2)),
      decayBelowMinus60Seconds: firstBelowDb(pcm, -60),
      variationCount: variations.length,
      adjacentVariationCorrelation: variations.length > 1
        ? round(hitCorrelation(
          variations[0].getChannelData(0),
          variations[1].getChannelData(0),
        ))
        : 1,
      playbackGainDb: round(20 * Math.log10(playbackGain)),
    }];
  }));

  const corePresets: Record<string, unknown> = {};
  for (const presetId of CORE_PRESETS) {
    const pcm = await renderCorePreset(presetId);
    const early = sliceSeconds(pcm, 0.06, 0.16);
    const middle = sliceSeconds(pcm, 0.24, 0.34);
    const late = sliceSeconds(pcm, 0.5, 0.6);
    const earlyCentroid = spectralCentroidHz(early, SAMPLE_RATE);
    const middleCentroid = spectralCentroidHz(middle, SAMPLE_RATE);
    const lateCentroid = spectralCentroidHz(late, SAMPLE_RATE);
    corePresets[presetId] = {
      peakDbfs: round(peakDbfs(pcm)),
      loudnessKMax: round(loudnessKMax(pcm, SAMPLE_RATE)),
      earlyCentroidHz: round(earlyCentroid),
      middleCentroidHz: round(middleCentroid),
      lateCentroidHz: round(lateCentroid),
      earlyToLateCentroidRatio: round(earlyCentroid / lateCentroid),
      hasFilterEnvelope: SYNTH_PRESETS[presetId].filterEnv !== undefined,
      hasSecondOscillator: SYNTH_PRESETS[presetId].osc2 !== undefined,
    };
  }

  const releaseSchedule = computeNoteSchedule({
    eventTime: 1,
    currentTime: 0,
    duration: 0.25,
    releaseTime: 0.4,
  });

  const capacityPath = path.resolve('test-results', 'audio-capture', 'browser-capacity-capture.json');
  const calibrationPath = path.resolve('test-results', 'audio-capture', 'browser-capture.json');
  const capacity = fs.existsSync(capacityPath)
    ? JSON.parse(fs.readFileSync(capacityPath, 'utf8')) as {
        summaries: Record<string, { peakDbfs: number }>;
        userOutputTruePeakDbfs: number;
      }
    : null;
  const browserCalibration = fs.existsSync(calibrationPath)
    ? (JSON.parse(fs.readFileSync(calibrationPath, 'utf8')) as { calibration: Record<string, unknown> }).calibration
    : null;
  const result = {
    capturedAt: new Date().toISOString(),
    candidate: 'Complete neutral sound-quality implementation',
    measurementCommand: 'node --import tsx scripts/measure-automatic-audio-improvements.ts --output src/audio/__fixtures__/automatic-improvements-after.json',
    schemaVersion: 1,
    sampleRate: SAMPLE_RATE,
    procedural,
    corePresets,
    release: {
      attackFadeSeconds: ATTACK_FADE_SEC,
      tailGuardSeconds: RELEASE_TAIL_GUARD_SEC,
      representativeSchedule: releaseSchedule,
      releaseFloorGain: RELEASE_FLOOR_GAIN,
      finalGainBeforeHardStop: 0,
    },
    master: {
      compressor: MASTER_COMPRESSOR_SETTINGS,
      outputTrimDb: MASTER_OUTPUT_TRIM_DB,
      ...(capacity ? {
        real16TrackBrowser: {
          preCompressorPeakDbfs: capacity.summaries.preCompressor.peakDbfs,
          postMakeupPeakDbfs: capacity.summaries.postMakeup.peakDbfs,
          heardOutputPeakDbfs: capacity.summaries.userOutput.peakDbfs,
          heardOutputTruePeakDbfs: capacity.userOutputTruePeakDbfs,
        },
      } : {}),
      ...(browserCalibration ? { browserCalibration } : {}),
    },
  };

  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex === -1 ? null : process.argv[outputIndex + 1];
  if (outputIndex !== -1 && !outputPath) throw new Error('--output requires a path');
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

await main();
