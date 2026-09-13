import * as Tone from 'tone';
import {
  ADVANCED_SYNTH_PRESETS,
  AdvancedSynthVoice,
  advancedVelocityFilterFrequency,
  type AdvancedSynthPresetId,
} from '../audio/advancedSynth';
import {
  GENERATED_INSTRUMENT_QUALITY_PROFILES,
  proceduralVelocityLowpassHz,
  type GeneratedInstrumentQualityProfile,
} from '../audio/generated-instrument-quality';
import { createSynthesizedSamples } from '../audio/samples';
import {
  ADVANCED_SOURCE_GAIN_DB,
  TONE_SOURCE_GAIN_DB,
  dbToGain,
} from '../audio/source-calibration';
import { SynthEngine, SYNTH_PRESETS, semitoneToFrequency } from '../audio/synth';
import {
  TONE_SYNTH_PRESETS,
  ToneSynthManager,
  type ToneSynthType,
} from '../audio/toneSynths';
import {
  amplitudeModulationDepthDb,
  boundaryDiscontinuityDbfs,
  boundaryDiscontinuityExcessDb,
  dcOffset,
  estimateFundamental,
  logAttackTime,
  logSpectralDistance,
  loudnessKMax,
  nonFiniteSampleCount,
  peakDbfs,
  rmsDb,
  spectralCentroidHz,
  spectralFlux,
  temporalCentroidSeconds,
  truePeakDbfs,
} from './audio-measures';

const SAMPLE_RATE = 44_100 as const;
const HIGH_SAMPLE_RATE = 88_200;
const START_SECONDS = 0.05;
const RENDER_SECONDS = 2.4;

const BEFORE_SYNTH_GAIN_DB: Readonly<Record<string, number>> = {
  hoover: -10,
  growl: -10,
};

const BEFORE_TONE_GAIN_DB: Readonly<Partial<Record<ToneSynthType, number>>> = {
  'fm-epiano': -6,
  'fm-bell': -8,
  'am-bell': -8,
  'am-tremolo': -7,
  'metal-cymbal': -11,
  'metal-hihat': -10,
  'pluck-string': -6,
};

type AuditImplementation = 'before' | 'after';
type ToneBaseSynth = Tone.FMSynth | Tone.AMSynth | Tone.MembraneSynth
  | Tone.MetalSynth | Tone.PluckSynth | Tone.DuoSynth;

export interface GeneratedVoiceAudit {
  id: string;
  engine: GeneratedInstrumentQualityProfile['engine'];
  role: GeneratedInstrumentQualityProfile['role'];
  canonical: {
    peakDbfs: number;
    truePeakDbfs: number;
    rmsDb: number;
    loudnessKMax: number;
    dcOffset: number;
    nonFiniteSamples: number;
    logAttackTime: number;
    temporalCentroidSeconds: number;
    spectralCentroidHz: number;
    spectralFlux: number;
    amplitudeModulationDepthDb: number;
    earlyToLateCentroidRatio: number;
    boundaryDiscontinuityDbfs: number;
    boundaryDiscontinuityExcessDb: number;
    releaseTailRmsDb: number;
  };
  pitch: null | {
    lowCents: number;
    middleCents: number;
    highCents: number;
    minimumConfidence: number;
  };
  velocity: {
    softCentroidHz: number;
    canonicalCentroidHz: number;
    hardCentroidHz: number;
    softToCanonicalRatio: number;
    hardToCanonicalRatio: number;
  };
  articulation: {
    shortTemporalCentroidSeconds: number;
    sustainedTemporalCentroidSeconds: number;
    shortReleaseTailRmsDb: number;
    sustainedReleaseTailRmsDb: number;
  };
  aliasingLogSpectralDistanceDb: number | null;
  renderWallMilliseconds: number;
}

export interface GeneratedCatalogueAudit {
  schemaVersion: 1;
  implementation: AuditImplementation;
  sampleRate: number;
  voiceCount: number;
  conditionRenderCount: number;
  totalRenderWallMilliseconds: number;
  polyphony: Record<'procedural32' | 'native16' | 'tone16' | 'advanced8', {
    voices: number;
    renderWallMilliseconds: number;
    realtimeFactor: number;
    peakDbfs: number;
    nonFiniteSamples: number;
  }>;
  voices: Record<string, GeneratedVoiceAudit>;
}

function seededRandom(seed = 0x734d2c19): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state, 1_664_525) + 1_013_904_223 >>> 0;
    return state / 0x1_0000_0000;
  };
}

function copyChannel(buffer: AudioBuffer | Tone.ToneAudioBuffer): Float32Array {
  return new Float32Array(buffer.getChannelData(0));
}

function noteName(semitone: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const absolute = semitone + 48;
  return `${names[((absolute % 12) + 12) % 12]}${Math.floor(absolute / 12)}`;
}

async function renderProcedural(
  profile: GeneratedInstrumentQualityProfile,
  sampleRate: number,
  semitone: number,
  midiVelocity: number,
  implementation: AuditImplementation,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.round(RENDER_SECONDS * sampleRate), sampleRate);
  const samples = await createSynthesizedSamples(
    context as unknown as AudioContext,
    seededRandom(),
  );
  const sample = samples.get(profile.presetId);
  if (!sample?.buffer) throw new Error(`Procedural sample unavailable: ${profile.id}`);

  const source = context.createBufferSource();
  source.buffer = sample.buffer;
  source.playbackRate.value = 2 ** (semitone / 12);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, START_SECONDS);
  gain.gain.linearRampToValueAtTime(sample.playbackGain ?? 1, START_SECONDS + 0.003);
  const cutoff = implementation === 'after'
    ? proceduralVelocityLowpassHz(profile.presetId, midiVelocity)
    : null;
  if (cutoff === null) {
    source.connect(gain);
  } else {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(cutoff, sampleRate / 2);
    filter.Q.value = 0.2;
    source.connect(filter).connect(gain);
  }
  gain.connect(context.destination);
  source.start(START_SECONDS);
  return copyChannel(await context.startRendering());
}

async function renderNative(
  profile: GeneratedInstrumentQualityProfile,
  sampleRate: number,
  semitone: number,
  durationSeconds: number,
  midiVelocity: number,
  implementation: AuditImplementation,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.round(RENDER_SECONDS * sampleRate), sampleRate);
  const engine = new SynthEngine();
  const output = context.createGain();
  output.connect(context.destination);
  engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
  const currentPreset = SYNTH_PRESETS[profile.presetId];
  const preset = implementation === 'before'
    ? {
        ...currentPreset,
        outputGainDb: BEFORE_SYNTH_GAIN_DB[profile.presetId] ?? currentPreset.outputGainDb,
        osc1Detune: undefined,
        osc2: currentPreset.osc2 && (profile.presetId === 'supersaw' || profile.presetId === 'hypersaw')
          ? {
              ...currentPreset.osc2,
              detune: profile.presetId === 'supersaw' ? 25 : 50,
            }
          : currentPreset.osc2,
      }
    : currentPreset;
  engine.playNote(
    `audit-${profile.presetId}`,
    semitoneToFrequency(semitone),
    preset,
    START_SECONDS,
    durationSeconds,
    1,
    undefined,
    midiVelocity,
  );
  return copyChannel(await context.startRendering());
}

function createToneSynth(type: string): ToneBaseSynth {
  switch (type) {
    case 'fm': return new Tone.FMSynth();
    case 'am': return new Tone.AMSynth();
    case 'membrane': return new Tone.MembraneSynth();
    case 'metal': return new Tone.MetalSynth();
    case 'pluck': return new Tone.PluckSynth();
    case 'duo': return new Tone.DuoSynth();
    default: throw new Error(`Unknown Tone synth type: ${type}`);
  }
}

async function renderToneBefore(
  profile: GeneratedInstrumentQualityProfile,
  sampleRate: number,
  semitone: number,
  durationSeconds: number,
): Promise<Float32Array> {
  const presetId = profile.presetId as ToneSynthType;
  const preset = TONE_SYNTH_PRESETS[presetId];
  const rendered = await Tone.Offline(() => {
    const synth = createToneSynth(preset.type);
    synth.set(preset.config);
    const gain = new Tone.Gain(dbToGain(
      BEFORE_TONE_GAIN_DB[presetId] ?? TONE_SOURCE_GAIN_DB[presetId],
    )).toDestination();
    synth.connect(gain);
    if (preset.type === 'pluck') {
      (synth as Tone.PluckSynth).triggerAttack(noteName(semitone), START_SECONDS);
    } else {
      (synth as Exclude<ToneBaseSynth, Tone.PluckSynth>).triggerAttackRelease(
        noteName(semitone),
        durationSeconds,
        START_SECONDS,
        1,
      );
    }
  }, RENDER_SECONDS, 1, sampleRate);
  return copyChannel(rendered);
}

async function renderToneAfter(
  profile: GeneratedInstrumentQualityProfile,
  sampleRate: number,
  semitone: number,
  durationSeconds: number,
  midiVelocity: number,
): Promise<Float32Array> {
  const rendered = await Tone.Offline(() => {
    const manager = new ToneSynthManager();
    void manager.initialize();
    manager.getOutput()?.toDestination();
    manager.playNote(
      profile.presetId as ToneSynthType,
      noteName(semitone),
      durationSeconds,
      START_SECONDS,
      1,
      midiVelocity,
    );
  }, RENDER_SECONDS, 1, sampleRate);
  return copyChannel(rendered);
}

async function renderAdvanced(
  profile: GeneratedInstrumentQualityProfile,
  sampleRate: number,
  semitone: number,
  durationSeconds: number,
  midiVelocity: number,
): Promise<Float32Array> {
  const presetId = profile.presetId as AdvancedSynthPresetId;
  const preset = ADVANCED_SYNTH_PRESETS[presetId];
  const rendered = await Tone.Offline(() => {
    const voice = new AdvancedSynthVoice();
    voice.initialize();
    voice.applyPreset(preset);
    voice.setFilterFrequency(advancedVelocityFilterFrequency(preset.filter.frequency, midiVelocity));
    const gain = new Tone.Gain(dbToGain(
      ADVANCED_SOURCE_GAIN_DB[presetId as keyof typeof ADVANCED_SOURCE_GAIN_DB],
    )).toDestination();
    voice.getOutput()?.connect(gain);
    voice.triggerAttackRelease(
      semitoneToFrequency(semitone),
      durationSeconds,
      START_SECONDS,
      1,
    );
  }, RENDER_SECONDS, 1, sampleRate);
  return copyChannel(rendered);
}

async function render(
  profile: GeneratedInstrumentQualityProfile,
  implementation: AuditImplementation,
  options: { sampleRate?: number; semitone?: number; duration?: number; velocity?: number } = {},
): Promise<Float32Array> {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const semitone = options.semitone ?? 0;
  const duration = options.duration ?? profile.durationsSeconds[1];
  const velocity = options.velocity ?? 90;
  switch (profile.engine) {
    case 'sample':
      return renderProcedural(profile, sampleRate, semitone, velocity, implementation);
    case 'synth':
      return renderNative(profile, sampleRate, semitone, duration, velocity, implementation);
    case 'tone':
      return implementation === 'before'
        ? renderToneBefore(profile, sampleRate, semitone, duration)
        : renderToneAfter(profile, sampleRate, semitone, duration, velocity);
    case 'advanced':
      return renderAdvanced(profile, sampleRate, semitone, duration, velocity);
  }
}

function sliceSeconds(
  pcm: Float32Array,
  sampleRate: number,
  startSeconds: number,
  endSeconds: number,
): Float32Array {
  return pcm.slice(
    Math.max(0, Math.round(startSeconds * sampleRate)),
    Math.min(pcm.length, Math.round(endSeconds * sampleRate)),
  );
}

function downsample2x(highRate: Float32Array): Float32Array {
  const output = new Float32Array(Math.floor(highRate.length / 2));
  const halfTaps = 16;
  for (let index = 0; index < output.length; index++) {
    const centre = index * 2;
    let value = 0;
    let weights = 0;
    for (let tap = -halfTaps + 1; tap <= halfTaps; tap++) {
      const sourceIndex = centre + tap;
      if (sourceIndex < 0 || sourceIndex >= highRate.length) continue;
      const x = tap / 2;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const window = 0.5 + 0.5 * Math.cos(Math.PI * tap / halfTaps);
      const weight = sinc * window;
      value += highRate[sourceIndex] * weight;
      weights += weight;
    }
    output[index] = weights === 0 ? 0 : value / weights;
  }
  return output;
}

function centroidWindow(pcm: Float32Array, startSeconds: number, endSeconds: number): number {
  return spectralCentroidHz(sliceSeconds(pcm, SAMPLE_RATE, startSeconds, endSeconds), SAMPLE_RATE);
}

function expectedFrequency(profile: GeneratedInstrumentQualityProfile, semitone: number): number {
  return (profile.expectedFundamentalHz ?? semitoneToFrequency(0)) * 2 ** (semitone / 12);
}

function pitchMeasure(
  pcm: Float32Array,
  profile: GeneratedInstrumentQualityProfile,
  semitone: number,
): ReturnType<typeof estimateFundamental> {
  const start = profile.role === 'pad' ? 0.52 : 0.1;
  const end = profile.role === 'pad' ? 0.78 : 0.45;
  return estimateFundamental(
    pcm,
    SAMPLE_RATE,
    expectedFrequency(profile, semitone),
    { start: Math.round(start * SAMPLE_RATE), end: Math.round(end * SAMPLE_RATE) },
  );
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}

function roundedRecord<T extends Record<string, number>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, round(value)]),
  ) as T;
}

async function auditVoice(
  profile: GeneratedInstrumentQualityProfile,
  implementation: AuditImplementation,
): Promise<GeneratedVoiceAudit> {
  const started = performance.now();
  const duration = profile.durationsSeconds[1];
  const [canonical, soft, hard, low, high, short] = await Promise.all([
    render(profile, implementation),
    render(profile, implementation, { velocity: 40 }),
    render(profile, implementation, { velocity: 127 }),
    render(profile, implementation, { semitone: -12 }),
    render(profile, implementation, { semitone: 12 }),
    render(profile, implementation, { duration: profile.durationsSeconds[0] }),
  ]);

  const earlyStart = START_SECONDS + 0.01;
  const earlyEnd = Math.min(START_SECONDS + duration * 0.35, earlyStart + 0.16);
  const lateStart = START_SECONDS + duration * 0.62;
  const lateEnd = Math.min(START_SECONDS + duration * 0.92, lateStart + 0.16);
  const earlyCentroid = centroidWindow(canonical, earlyStart, earlyEnd);
  const lateCentroid = centroidWindow(canonical, lateStart, lateEnd);
  const analysis = sliceSeconds(canonical, SAMPLE_RATE, START_SECONDS, START_SECONDS + duration);
  const tail = sliceSeconds(canonical, SAMPLE_RATE, RENDER_SECONDS - 0.1, RENDER_SECONDS);
  const sustainAnalysis = sliceSeconds(
    canonical,
    SAMPLE_RATE,
    START_SECONDS + duration * 0.25,
    START_SECONDS + duration * 0.8,
  );
  const canonicalCentroid = spectralCentroidHz(analysis, SAMPLE_RATE);
  const softCentroid = spectralCentroidHz(
    sliceSeconds(soft, SAMPLE_RATE, START_SECONDS, START_SECONDS + duration),
    SAMPLE_RATE,
  );
  const hardCentroid = spectralCentroidHz(
    sliceSeconds(hard, SAMPLE_RATE, START_SECONDS, START_SECONDS + duration),
    SAMPLE_RATE,
  );

  let pitch: GeneratedVoiceAudit['pitch'] = null;
  if (profile.pitched && profile.expectedFundamentalHz) {
    const lowPitch = pitchMeasure(low, profile, -12);
    const middlePitch = pitchMeasure(canonical, profile, 0);
    const highPitch = pitchMeasure(high, profile, 12);
    pitch = roundedRecord({
      lowCents: lowPitch.centsError,
      middleCents: middlePitch.centsError,
      highCents: highPitch.centsError,
      minimumConfidence: Math.min(lowPitch.confidence, middlePitch.confidence, highPitch.confidence),
    });
  }

  let aliasingLogSpectralDistanceDb: number | null = null;
  const advancedPreset = profile.engine === 'advanced'
    ? ADVANCED_SYNTH_PRESETS[profile.presetId as AdvancedSynthPresetId]
    : null;
  const aliasComparable = profile.pitched
    && profile.id !== 'chord'
    && (advancedPreset?.noiseLevel ?? 0) === 0
    && profile.id !== 'tone:pluck-string';
  if (aliasComparable) {
    const highRate = await render(profile, implementation, { sampleRate: HIGH_SAMPLE_RATE });
    const reference = downsample2x(highRate);
    const normalWindow = sliceSeconds(canonical, SAMPLE_RATE, 0.1, 0.45);
    const referenceWindow = sliceSeconds(reference, SAMPLE_RATE, 0.1, 0.45);
    aliasingLogSpectralDistanceDb = round(logSpectralDistance(normalWindow, referenceWindow));
  }

  const shortTail = sliceSeconds(short, SAMPLE_RATE, RENDER_SECONDS - 0.1, RENDER_SECONDS);
  const boundaries = profile.engine === 'sample'
    ? [START_SECONDS * SAMPLE_RATE]
    : [START_SECONDS * SAMPLE_RATE, (START_SECONDS + duration) * SAMPLE_RATE];
  return {
    id: profile.id,
    engine: profile.engine,
    role: profile.role,
    canonical: {
      ...roundedRecord({
        peakDbfs: peakDbfs(canonical),
        truePeakDbfs: truePeakDbfs(canonical),
        rmsDb: rmsDb(canonical),
        loudnessKMax: loudnessKMax(canonical, SAMPLE_RATE),
        dcOffset: dcOffset(canonical),
        nonFiniteSamples: nonFiniteSampleCount(canonical),
        logAttackTime: logAttackTime(analysis, SAMPLE_RATE),
        temporalCentroidSeconds: temporalCentroidSeconds(analysis, SAMPLE_RATE),
        spectralCentroidHz: canonicalCentroid,
        spectralFlux: spectralFlux(analysis),
        amplitudeModulationDepthDb: amplitudeModulationDepthDb(sustainAnalysis),
        earlyToLateCentroidRatio: lateCentroid > 0 ? earlyCentroid / lateCentroid : 0,
        boundaryDiscontinuityDbfs: boundaryDiscontinuityDbfs(canonical, boundaries),
        boundaryDiscontinuityExcessDb: boundaryDiscontinuityExcessDb(canonical, boundaries),
        releaseTailRmsDb: rmsDb(tail),
      }),
    },
    pitch,
    velocity: roundedRecord({
      softCentroidHz: softCentroid,
      canonicalCentroidHz: canonicalCentroid,
      hardCentroidHz: hardCentroid,
      softToCanonicalRatio: canonicalCentroid > 0 ? softCentroid / canonicalCentroid : 1,
      hardToCanonicalRatio: canonicalCentroid > 0 ? hardCentroid / canonicalCentroid : 1,
    }),
    articulation: roundedRecord({
      shortTemporalCentroidSeconds: temporalCentroidSeconds(
        sliceSeconds(short, SAMPLE_RATE, START_SECONDS, START_SECONDS + profile.durationsSeconds[0]),
        SAMPLE_RATE,
      ),
      sustainedTemporalCentroidSeconds: temporalCentroidSeconds(analysis, SAMPLE_RATE),
      shortReleaseTailRmsDb: rmsDb(shortTail),
      sustainedReleaseTailRmsDb: rmsDb(tail),
    }),
    aliasingLogSpectralDistanceDb,
    renderWallMilliseconds: round(performance.now() - started),
  };
}

async function measureStress(
  voices: number,
  renderStress: () => Promise<Float32Array>,
): Promise<GeneratedCatalogueAudit['polyphony'][keyof GeneratedCatalogueAudit['polyphony']]> {
  const started = performance.now();
  const pcm = await renderStress();
  const renderWallMilliseconds = performance.now() - started;
  return roundedRecord({
    voices,
    renderWallMilliseconds,
    realtimeFactor: 1 / (renderWallMilliseconds / 1000),
    peakDbfs: peakDbfs(pcm),
    nonFiniteSamples: nonFiniteSampleCount(pcm),
  });
}

async function runPolyphonyStress(
  implementation: AuditImplementation,
): Promise<GeneratedCatalogueAudit['polyphony']> {
  const procedural32 = await measureStress(32, async () => {
    const context = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
    const samples = await createSynthesizedSamples(
      context as unknown as AudioContext,
      seededRandom(0x83dc291a),
    );
    const ids = ['kick', 'snare', 'hihat', 'bass', 'lead', 'pluck', 'chord', 'pad'];
    for (let index = 0; index < 32; index++) {
      const source = context.createBufferSource();
      const sample = samples.get(ids[index % ids.length])!;
      source.buffer = sample.buffer;
      source.playbackRate.value = 2 ** (((index % 5) - 2) / 12);
      const gain = context.createGain();
      gain.gain.value = (sample.playbackGain ?? 1) / 32;
      source.connect(gain).connect(context.destination);
      source.start(START_SECONDS);
    }
    return copyChannel(await context.startRendering());
  });

  const native16 = await measureStress(16, async () => {
    const context = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
    const output = context.createGain();
    output.gain.value = 1 / 16;
    output.connect(context.destination);
    const engine = new SynthEngine();
    engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
    for (let index = 0; index < 16; index++) {
      engine.playNote(
        `stress-${index}`,
        semitoneToFrequency((index % 12) - 6),
        SYNTH_PRESETS[index % 2 ? 'lead' : 'pad'],
        START_SECONDS,
        0.45,
        1,
        undefined,
        90,
      );
    }
    return copyChannel(await context.startRendering());
  });

  const tone16 = await measureStress(16, async () => {
    const toneIds = Object.keys(TONE_SYNTH_PRESETS) as ToneSynthType[];
    const rendered = await Tone.Offline(() => {
      const mix = new Tone.Gain(1 / 16).toDestination();
      for (let index = 0; index < 16; index++) {
        const presetId = toneIds[index % toneIds.length];
        if (implementation === 'before') {
          const preset = TONE_SYNTH_PRESETS[presetId];
          const synth = createToneSynth(preset.type);
          synth.set(preset.config);
          const sourceGain = new Tone.Gain(dbToGain(
            BEFORE_TONE_GAIN_DB[presetId] ?? TONE_SOURCE_GAIN_DB[presetId],
          ));
          synth.connect(sourceGain).connect(mix);
          if (preset.type === 'pluck') {
            (synth as Tone.PluckSynth).triggerAttack(noteName((index % 12) - 6), START_SECONDS);
          } else {
            (synth as Exclude<ToneBaseSynth, Tone.PluckSynth>).triggerAttackRelease(
              noteName((index % 12) - 6),
              0.35,
              START_SECONDS,
              1,
            );
          }
          continue;
        }
        const manager = new ToneSynthManager();
        void manager.initialize();
        manager.getOutput()?.connect(mix);
        manager.playNote(
          presetId,
          noteName((index % 12) - 6),
          0.35,
          START_SECONDS,
          1,
          implementation === 'after' ? 40 + index * 5 : 90,
        );
      }
    }, 1, 1, SAMPLE_RATE);
    return copyChannel(rendered);
  });

  const advanced8 = await measureStress(8, async () => {
    const rendered = await Tone.Offline(() => {
      const mix = new Tone.Gain(1 / 8).toDestination();
      for (let index = 0; index < 8; index++) {
        const voice = new AdvancedSynthVoice();
        const preset = ADVANCED_SYNTH_PRESETS.supersaw;
        voice.initialize();
        voice.applyPreset(preset);
        voice.setFilterFrequency(advancedVelocityFilterFrequency(preset.filter.frequency, 90));
        voice.getOutput()?.connect(mix);
        voice.triggerAttackRelease(
          semitoneToFrequency((index % 8) - 4),
          0.45,
          START_SECONDS,
          1,
        );
      }
    }, 1, 1, SAMPLE_RATE);
    return copyChannel(rendered);
  });

  return { procedural32, native16, tone16, advanced8 };
}

export async function runGeneratedCatalogueAudit(
  implementation: AuditImplementation,
): Promise<GeneratedCatalogueAudit> {
  const started = performance.now();
  const voices: Record<string, GeneratedVoiceAudit> = {};
  // Tone.Offline swaps a global Tone context, so voices must be isolated even
  // though each voice's Web Audio renders are internally parallel.
  for (const profile of GENERATED_INSTRUMENT_QUALITY_PROFILES) {
    voices[profile.id] = await auditVoice(profile, implementation);
  }
  const polyphony = await runPolyphonyStress(implementation);
  return {
    schemaVersion: 1,
    implementation,
    sampleRate: SAMPLE_RATE,
    voiceCount: Object.keys(voices).length,
    conditionRenderCount: GENERATED_INSTRUMENT_QUALITY_PROFILES.length * 6,
    totalRenderWallMilliseconds: round(performance.now() - started),
    polyphony,
    voices,
  };
}
