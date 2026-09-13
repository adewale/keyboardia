import { describe, expect, it, vi } from 'vitest';
import {
  ProceduralVelocityFilterBank,
} from './procedural-velocity-filter-bank';
import { VELOCITY_FILTER_TIME_CONSTANT_SECONDS } from './velocity-timbre';

function createHarness() {
  const filters: Array<{
    type: BiquadFilterType;
    Q: { value: number };
    frequency: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      setTargetAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    currentTime: 0.1,
    sampleRate: 44_100,
    createBiquadFilter: () => {
      const filter = {
        type: 'lowpass' as BiquadFilterType,
        Q: { value: 0 },
        frequency: {
          setValueAtTime: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      filters.push(filter);
      return filter as unknown as BiquadFilterNode;
    },
  } as unknown as BaseAudioContext;
  const source = () => ({ connect: vi.fn() } as unknown as AudioNode);
  const output = { id: 'track-output' } as unknown as AudioNode;
  return { context, filters, source, output };
}

describe('ProceduralVelocityFilterBank', () => {
  it('keeps canonical notes on the exact bypass path', () => {
    const { context, filters, source, output } = createHarness();
    const bank = new ProceduralVelocityFilterBank(context);
    const note = source();

    expect(bank.connect(note, output, 'track', 'lead', 90, 0.2)).toBeNull();
    expect(note.connect).toHaveBeenCalledWith(output);
    expect(filters).toHaveLength(0);
  });

  it('reuses one track filter and smooths later soft-note cutoff changes', () => {
    const { context, filters, source, output } = createHarness();
    const bank = new ProceduralVelocityFilterBank(context);
    const first = source();
    const second = source();

    const firstCutoff = bank.connect(first, output, 'track', 'lead', 40, 0.2);
    const secondCutoff = bank.connect(second, output, 'track', 'lead', 20, 0.4);
    const filter = filters[0]!;

    expect(firstCutoff).not.toBeNull();
    expect(secondCutoff).not.toBeNull();
    expect(filters).toHaveLength(1);
    expect(bank.size).toBe(1);
    expect(first.connect).toHaveBeenCalledWith(filter);
    expect(second.connect).toHaveBeenCalledWith(filter);
    expect(filter.Q.value).toBe(0.2);
    expect(filter.frequency.setValueAtTime).toHaveBeenCalledWith(firstCutoff, 0.2);
    expect(filter.frequency.setTargetAtTime).toHaveBeenCalledWith(
      secondCutoff,
      0.4,
      VELOCITY_FILTER_TIME_CONSTANT_SECONDS,
    );
  });

  it('disconnects retained filters when a track is removed', () => {
    const { context, filters, source, output } = createHarness();
    const bank = new ProceduralVelocityFilterBank(context);
    bank.connect(source(), output, 'track', 'lead', 40, 0.2);

    bank.remove('track');

    expect(filters[0]!.disconnect).toHaveBeenCalledOnce();
    expect(bank.size).toBe(0);
  });
});
