// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { Sample } from '../types';
import { AudioEngine } from './engine';

describe('procedural sample envelope', () => {
  it('starts muted before scheduling the note-edge ramp', () => {
    const automationOrder: string[] = [];
    let intrinsicValue = 1;
    const gainParam = {
      get value() { return intrinsicValue; },
      set value(value: number) {
        intrinsicValue = value;
        automationOrder.push(`value:${value}`);
      },
      setValueAtTime: vi.fn((value: number) => automationOrder.push(`set:${value}`)),
      linearRampToValueAtTime: vi.fn((value: number) => automationOrder.push(`ramp:${value}`)),
    };
    const envelopeGain = {
      gain: gainParam,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const source = {
      buffer: null as AudioBuffer | null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      onended: null as (() => void) | null,
    };
    const context = {
      currentTime: 1,
      state: 'running',
      sampleRate: 44_100,
      createBufferSource: vi.fn(() => source),
      createGain: vi.fn(() => envelopeGain),
    };
    const trackInput = {} as GainNode;
    const engine = new AudioEngine();
    (engine as unknown as { audioContext: AudioContext }).audioContext = context as unknown as AudioContext;
    (engine as unknown as { masterGain: GainNode }).masterGain = {} as GainNode;
    (engine as unknown as { samples: Map<string, Sample> }).samples = new Map([
      ['snare', {
        id: 'snare',
        name: 'Snare',
        url: '',
        buffer: {} as AudioBuffer,
        playbackGain: 1,
      }],
    ]);
    (engine as unknown as { trackBusManager: { getBusInput: () => GainNode } }).trackBusManager = {
      getBusInput: () => trackInput,
    };

    engine.playSample('snare', 'track-1', 2, 0.12);

    expect(automationOrder).toEqual(['value:0', 'set:0', 'ramp:1']);
    expect(source.start).toHaveBeenCalledWith(2);
  });
});
