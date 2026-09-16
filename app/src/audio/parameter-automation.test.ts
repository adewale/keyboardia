import { describe, expect, it, vi } from 'vitest';
import { audioTime, seconds } from './audio-time';
import {
  applyParameterAutomation,
  cancelParameterAutomation,
} from './parameter-automation';

function parameter() {
  return {
    value: 0.25,
    cancelAndHoldAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

describe('timestamped parameter automation', () => {
  it('anchors target automation at the supplied AudioTime', () => {
    const param = parameter();
    applyParameterAutomation(param, {
      parameter: 'filterFrequency',
      value: 1200,
      effectiveAt: audioTime(12.5),
      curve: 'target',
      duration: seconds(0.02),
    });

    expect(param.cancelAndHoldAtTime).toHaveBeenCalledWith(12.5);
    expect(param.setTargetAtTime).toHaveBeenCalledWith(1200, 12.5, 0.02);
  });

  it('schedules a step without consulting local now', () => {
    const param = parameter();
    applyParameterAutomation(param, {
      parameter: 'pan',
      value: -0.5,
      effectiveAt: audioTime(20),
      curve: 'step',
    });
    expect(param.setValueAtTime).toHaveBeenCalledWith(-0.5, 20);
  });

  it('schedules a linear ramp ending at effectiveAt + duration', () => {
    const param = parameter();
    applyParameterAutomation(param, {
      parameter: 'gain',
      value: 0.8,
      effectiveAt: audioTime(4),
      curve: 'linear',
      duration: seconds(0.1),
    });
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.25, 4);
    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 4.1);
  });

  it('falls back to cancelScheduledValues and exposes explicit cancellation', () => {
    const param = parameter();
    delete (param as Partial<typeof param>).cancelAndHoldAtTime;
    cancelParameterAutomation(param, audioTime(7));
    expect(param.cancelScheduledValues).toHaveBeenCalledWith(7);
  });
});
