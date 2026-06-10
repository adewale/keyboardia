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

describe('ring buffer (per-frame metric storage)', () => {
  const buf = new RingBuffer<number>(1000);

  bench('RingBuffer.push (steady state)', () => {
    buf.push(Math.random());
  });

  bench('RingBuffer.toArray (1000 elements)', () => {
    buf.toArray();
  });
});
