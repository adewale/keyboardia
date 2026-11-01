import { addAudioTime, type AudioTime, type Seconds } from './audio-time';

export interface AutomatableAudioParam {
  readonly value: unknown;
  cancelAndHoldAtTime?(time: number): unknown;
  cancelScheduledValues(time: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, timeConstant: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface TimestampedParameterUpdate<Name extends string = string> {
  parameter: Name;
  value: number;
  effectiveAt: AudioTime;
}

export type TimestampedParameterAutomation<Name extends string = string> =
  | (TimestampedParameterUpdate<Name> & { curve: 'step' })
  | (TimestampedParameterUpdate<Name> & { curve: 'target'; duration: Seconds })
  | (TimestampedParameterUpdate<Name> & { curve: 'linear'; duration: Seconds });

export function cancelParameterAutomation(
  param: AutomatableAudioParam,
  effectiveAt: AudioTime,
): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(effectiveAt);
  } else {
    param.cancelScheduledValues(effectiveAt);
  }
}

export function applyParameterAutomation<Name extends string>(
  param: AutomatableAudioParam,
  event: TimestampedParameterAutomation<Name>,
): void {
  if (!Number.isFinite(event.value)) {
    throw new RangeError(`Automation value must be finite; received ${String(event.value)}`);
  }
  cancelParameterAutomation(param, event.effectiveAt);

  switch (event.curve) {
    case 'step':
      param.setValueAtTime(event.value, event.effectiveAt);
      return;
    case 'target':
      if (event.duration <= 0) throw new RangeError('Target automation duration must be positive');
      param.setTargetAtTime(event.value, event.effectiveAt, event.duration);
      return;
    case 'linear':
      if (event.duration <= 0) throw new RangeError('Linear automation duration must be positive');
      if (typeof param.value !== 'number') {
        throw new TypeError('Linear automation requires a numeric current parameter value');
      }
      param.setValueAtTime(param.value, event.effectiveAt);
      param.linearRampToValueAtTime(
        event.value,
        addAudioTime(event.effectiveAt, event.duration),
      );
  }
}
