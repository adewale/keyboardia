/**
 * Micro-benchmarks for audio hot paths.
 *
 * Skill (Tier 3): "When helpful: a 2x slowdown would be a user-visible
 * bug." Audio scheduling is real-time-critical — these functions are
 * called dozens of times per second per active note. A regression in
 * any of them is audible as scheduling jitter or dropped notes.
 *
 * Run with `npx vitest bench`. Treat these as informational baselines,
 * not CI gates — vitest bench output varies machine-to-machine.
 */
import { bench, describe } from 'vitest';
import { computeJoinOffset } from './scheduler-multiplayer-sync';
import { computeEnvelopeStart } from './envelope-anchor';
import { pitchSemitonesToWorkletRatio } from './pitch-shift-range';
import { computeReceiveLateness, measureAndReportLateness } from './scheduler-worklet-lateness';
import { AudioMetricsCollector } from './metrics/audio-metrics';
import { GrainPitchShifter } from './worklets/pitch-shift-engine';
import { RingBuffer } from './metrics/ring-buffer';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import {
  FakeAudioContext,
  FakeGainNode,
  makeSampleFetchStub,
} from './__fakes__/FakeWebAudio';

const sampledVoiceContext = new FakeAudioContext();
const sampledVoiceDestination = new FakeGainNode();
const sampledVoiceInstrument = new SampledInstrument('bench-filtered', '/instruments', {
  velocityAnchorForNote: () => 4_000,
});
const sampledVoiceManifest: InstrumentManifest = {
  id: 'bench-filtered',
  name: 'Filtered voice benchmark',
  type: 'sampled',
  releaseTime: 0.1,
  samples: [{ note: 60, file: 'C4.wav' }],
};

function clearSampledVoiceNodes(): void {
  for (const source of sampledVoiceContext.createdSources) source.fireEnded();
  sampledVoiceContext.createdSources.length = 0;
  sampledVoiceContext.createdGains.length = 0;
  sampledVoiceContext.createdBiquadFilters.length = 0;
}

// Vitest's benchmark runner does not execute the suite hooks used by the unit
// runner. Initialize at module scope so these benches cannot silently measure
// SampledInstrument's unloaded early-return path.
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = makeSampleFetchStub(sampledVoiceManifest);
  sampledVoiceInstrument.initialize(
    sampledVoiceContext.asAudioContext(),
    sampledVoiceDestination as unknown as AudioNode,
  );
  if (!await sampledVoiceInstrument.ensureLoaded()) {
    throw new Error('benchmark instrument did not load');
  }
} finally {
  globalThis.fetch = originalFetch;
}

// Discriminating controls outside the timed loops prove that the two cases
// reach the intended production branches. This is a fake-node JavaScript
// allocation benchmark; it does not measure browser DSP or render cost.
const filteredProbe = sampledVoiceInstrument.playNote('bench-probe', 60, 0, 0.1, 1, 40);
if (!filteredProbe || sampledVoiceContext.createdBiquadFilters.length !== 1) {
  throw new Error('filtered benchmark probe did not allocate exactly one low-pass filter');
}
clearSampledVoiceNodes();
const bypassProbe = sampledVoiceInstrument.playNote('bench-probe', 60, 0, 0.1, 1, 90);
const bypassFilterCount = Number(sampledVoiceContext.createdBiquadFilters.length);
if (!bypassProbe || bypassFilterCount !== 0) {
  throw new Error('bypass benchmark probe unexpectedly allocated a low-pass filter');
}
clearSampledVoiceNodes();

describe('scheduler hot paths', () => {
  const baseInput = {
    audioStartTime: 10,
    serverStartTime: 1_000_000,
    currentServerTime: 1_000_500,
    tempo: 120,
    maxSteps: 64,
    loopStart: 0,
  };

  bench('computeJoinOffset (mid-step branch)', () => {
    computeJoinOffset(baseInput);
  });

  bench('computeJoinOffset (exact-boundary branch)', () => {
    computeJoinOffset({ ...baseInput, currentServerTime: 1_000_500 + 0 }); // remainder 0
  });

  bench('computeEnvelopeStart', () => {
    computeEnvelopeStart({ eventTime: 5.0, currentTime: 4.95, pitchLatencySec: 0.021 });
  });

  bench('pitchSemitonesToWorkletRatio (in-range)', () => {
    pitchSemitonesToWorkletRatio(7);
  });

  bench('pitchSemitonesToWorkletRatio (clamped out-of-range)', () => {
    pitchSemitonesToWorkletRatio(48);
  });
});

describe('lateness/metrics hot paths', () => {
  const collector = new AudioMetricsCollector();
  const sink = {
    recordJitter: (ms: number) => collector.recordJitter(ms),
    recordLateNote: () => collector.recordLateNote(),
  };

  bench('computeReceiveLateness', () => {
    computeReceiveLateness({ eventTime: 5.0, currentTime: 5.05 });
  });

  bench('measureAndReportLateness (full path)', () => {
    measureAndReportLateness(5.0, 5.05, sink);
  });

  bench('AudioMetricsCollector.recordJitter (with sampleRate=1)', () => {
    collector.recordJitter(2.5);
  });
});

describe('pitch-shift engine', () => {
  const grainSize = 1024;
  const blockSize = 128;
  const inputBlock = new Float32Array(blockSize);
  for (let i = 0; i < blockSize; i++) inputBlock[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
  const outputBlock = new Float32Array(blockSize);

  bench('GrainPitchShifter.write(128 samples)', () => {
    const shifter = new GrainPitchShifter(grainSize);
    shifter.write(inputBlock);
  });

  bench('GrainPitchShifter.read(128 samples) at ratio 1.0', () => {
    const shifter = new GrainPitchShifter(grainSize);
    shifter.write(inputBlock);
    shifter.read(outputBlock, 1.0);
  });

  bench('GrainPitchShifter.read(128 samples) at ratio 0.5 (octave down)', () => {
    const shifter = new GrainPitchShifter(grainSize);
    shifter.write(inputBlock);
    shifter.read(outputBlock, 0.5);
  });
});

describe('sampled voice allocation', () => {
  function allocateAndEndVoice(velocity: number): void {
    const source = sampledVoiceInstrument.playNote('bench', 60, 0, 0.1, 1, velocity);
    if (!source) throw new Error('initialized benchmark instrument returned no source');
    clearSampledVoiceNodes();
  }

  bench('SampledInstrument.playNote (v40 filtered voice)', () => {
    allocateAndEndVoice(40);
  });

  bench('SampledInstrument.playNote (v90 bypass control)', () => {
    allocateAndEndVoice(90);
  });
});

describe('ring buffer (per-frame metric storage)', () => {
  const buf = new RingBuffer<number>(1000);

  bench('RingBuffer.push (steady state)', () => {
    buf.push(Math.random());
  });

  bench('RingBuffer.toArray (1000 elements)', () => {
    buf.toArray();
  });
});
