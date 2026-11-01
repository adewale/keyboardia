/**
 * Nominal units used at audio scheduling boundaries.
 *
 * The brands are erased by TypeScript: values remain primitive numbers, so
 * adopting them does not allocate objects or add pressure to the audio path.
 * Runtime checks happen only when an untyped value enters a unit boundary.
 */
declare const audioTimeBrand: unique symbol;
declare const secondsBrand: unique symbol;
declare const millisecondsBrand: unique symbol;
declare const serverTimeMsBrand: unique symbol;
declare const beatsBrand: unique symbol;
declare const stepsBrand: unique symbol;
declare const stepIndexBrand: unique symbol;

export type AudioTime = number & { readonly [audioTimeBrand]: 'AudioTime' };
export type Seconds = number & { readonly [secondsBrand]: 'Seconds' };
export type Milliseconds = number & { readonly [millisecondsBrand]: 'Milliseconds' };
export type ServerTimeMs = number & { readonly [serverTimeMsBrand]: 'ServerTimeMs' };
export type Beats = number & { readonly [beatsBrand]: 'Beats' };
export type Steps = number & { readonly [stepsBrand]: 'Steps' };
export type StepIndex = number & { readonly [stepIndexBrand]: 'StepIndex' };

function finite(value: number, unit: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${unit} must be finite; received ${String(value)}`);
  }
  return value;
}

function nonNegative(value: number, unit: string): number {
  finite(value, unit);
  if (value < 0) {
    throw new RangeError(`${unit} must be non-negative; received ${value}`);
  }
  return value;
}

export const audioTime = (value: number): AudioTime =>
  nonNegative(value, 'AudioTime') as AudioTime;

/** Signed seconds. Durations that require non-negative values validate locally. */
export const seconds = (value: number): Seconds => finite(value, 'Seconds') as Seconds;

/** Signed milliseconds, useful for lateness and wall-clock differences. */
export const milliseconds = (value: number): Milliseconds =>
  finite(value, 'Milliseconds') as Milliseconds;

export const serverTimeMs = (value: number): ServerTimeMs =>
  nonNegative(value, 'ServerTimeMs') as ServerTimeMs;

export const beats = (value: number): Beats => nonNegative(value, 'Beats') as Beats;
export const steps = (value: number): Steps => nonNegative(value, 'Steps') as Steps;

export const stepIndex = (value: number): StepIndex => {
  nonNegative(value, 'StepIndex');
  if (!Number.isInteger(value)) {
    throw new RangeError(`StepIndex must be an integer; received ${value}`);
  }
  return value as StepIndex;
};

export function addAudioTime(time: AudioTime, duration: Seconds): AudioTime {
  return audioTime(time + duration);
}

export function differenceInSeconds(end: AudioTime, start: AudioTime): Seconds {
  return seconds(end - start);
}

export function differenceInMilliseconds(
  end: ServerTimeMs,
  start: ServerTimeMs,
): Milliseconds {
  return milliseconds(end - start);
}

export function secondsToMilliseconds(value: Seconds): Milliseconds {
  return milliseconds(value * 1000);
}

export function millisecondsToSeconds(value: Milliseconds): Seconds {
  return seconds(value / 1000);
}

function assertTempo(tempoBpm: number): void {
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0) {
    throw new RangeError(`tempoBpm must be finite and positive; received ${String(tempoBpm)}`);
  }
}

export function beatsToSeconds(value: Beats, tempoBpm: number): Seconds {
  assertTempo(tempoBpm);
  return seconds((value * 60) / tempoBpm);
}

export function stepsToSeconds(
  value: Steps,
  tempoBpm: number,
  stepsPerBeat = 4,
): Seconds {
  assertTempo(tempoBpm);
  if (!Number.isFinite(stepsPerBeat) || stepsPerBeat <= 0) {
    throw new RangeError(
      `stepsPerBeat must be finite and positive; received ${String(stepsPerBeat)}`,
    );
  }
  return seconds((value * 60) / (tempoBpm * stepsPerBeat));
}

/** The only clock permitted to define audio scheduling time. */
export interface AudioClock {
  now(): AudioTime;
}

export function audioContextClock(context: Pick<BaseAudioContext, 'currentTime'>): AudioClock {
  return { now: () => audioTime(context.currentTime) };
}
