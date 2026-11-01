import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  addAudioTime,
  audioContextClock,
  audioTime,
  beats,
  beatsToSeconds,
  milliseconds,
  seconds,
  secondsToMilliseconds,
  serverTimeMs,
  stepIndex,
  steps,
  stepsToSeconds,
  type AudioTime,
  type Beats,
  type Seconds,
  type ServerTimeMs,
  type Steps,
} from './audio-time';

describe('audio timing units', () => {
  it('are numbers at runtime and distinct at compile time', () => {
    const time = audioTime(12.5);
    const duration = seconds(0.25);
    const wallClock = serverTimeMs(1_000_000);

    expect(typeof time).toBe('number');
    expect(typeof duration).toBe('number');
    expect(typeof wallClock).toBe('number');
    expectTypeOf(time).toEqualTypeOf<AudioTime>();
    expectTypeOf(duration).toEqualTypeOf<Seconds>();
    expectTypeOf(wallClock).toEqualTypeOf<ServerTimeMs>();
    expectTypeOf(time).not.toEqualTypeOf<Seconds>();
  });

  it('requires explicit conversion between musical and clock units', () => {
    const beatCount: Beats = beats(2);
    const stepCount: Steps = steps(8);

    expect(beatsToSeconds(beatCount, 120)).toBe(1);
    expect(stepsToSeconds(stepCount, 120)).toBe(1);
    expect(secondsToMilliseconds(seconds(1.25))).toBe(1250);
    expect(milliseconds(1250)).toBe(1250);
  });

  it('keeps absolute time arithmetic explicit', () => {
    expect(addAudioTime(audioTime(10), seconds(0.125))).toBe(10.125);
  });

  it('adapts the live AudioContext clock without caching its value', () => {
    const context = { currentTime: 1.25 };
    const clock = audioContextClock(context);

    expect(clock.now()).toBe(1.25);
    context.currentTime = 2.5;
    expect(clock.now()).toBe(2.5);
  });

  it.each([
    ['audioTime', () => audioTime(Number.NaN)],
    ['seconds', () => seconds(Number.POSITIVE_INFINITY)],
    ['beats', () => beats(-1)],
    ['steps', () => steps(-1)],
    ['stepIndex', () => stepIndex(1.5)],
    ['serverTimeMs', () => serverTimeMs(Number.NaN)],
  ])('rejects invalid %s values at the construction boundary', (_name, construct) => {
    expect(construct).toThrow(RangeError);
  });
});
