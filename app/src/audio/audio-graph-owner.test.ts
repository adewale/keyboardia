import { describe, expect, it, vi } from 'vitest';
import { AudioGraphOwner } from './audio-graph-owner';

function fakeContext() {
  const terminal = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 0 },
  } as unknown as GainNode;
  const destination = {} as AudioDestinationNode;
  const context = {
    destination,
    createGain: vi.fn(() => terminal),
  } as unknown as AudioContext;
  return { context, terminal, destination };
}

describe('AudioGraphOwner', () => {
  it('owns one stable terminal connected directly on desktop', () => {
    const { context, terminal, destination } = fakeContext();
    const graph = new AudioGraphOwner(context, 7, {
      shouldUseMediaElement: () => false,
    });

    expect(graph.kind).toBe('direct');
    expect(graph.getOutputInput(7)).toBe(terminal);
    expect(terminal.connect).toHaveBeenCalledOnce();
    expect(terminal.connect).toHaveBeenCalledWith(destination);
  });

  it('rejects stale generations before they can connect into a replacement graph', () => {
    const { context } = fakeContext();
    const graph = new AudioGraphOwner(context, 11, {
      shouldUseMediaElement: () => false,
    });
    const source = { connect: vi.fn() } as unknown as AudioNode;

    expect(() => graph.connect(source, 10)).toThrow(/stale audio graph generation/i);
    expect(source.connect).not.toHaveBeenCalled();
    graph.connect(source, 11);
    expect(source.connect).toHaveBeenCalledWith(graph.getOutputInput(11));
  });

  it('owns mobile unlock and disposes the complete terminal route idempotently', () => {
    const { context, terminal } = fakeContext();
    const mobileOutput = {
      connect: vi.fn().mockReturnValue(true),
      unlock: vi.fn(),
      dispose: vi.fn(),
    };
    const graph = new AudioGraphOwner(context, 3, {
      shouldUseMediaElement: () => true,
      createMediaElementOutput: () => mobileOutput,
    });

    expect(graph.kind).toBe('media-element');
    expect(mobileOutput.connect).toHaveBeenCalledWith(terminal, context);
    graph.unlock();
    graph.dispose();
    graph.dispose();
    expect(mobileOutput.unlock).toHaveBeenCalledOnce();
    expect(mobileOutput.dispose).toHaveBeenCalledOnce();
    expect(terminal.disconnect).toHaveBeenCalledOnce();
    expect(() => graph.getOutputInput(3)).toThrow(/disposed/i);
  });

  it('falls back to the native destination if mobile routing cannot be built', () => {
    const { context, terminal, destination } = fakeContext();
    const graph = new AudioGraphOwner(context, 5, {
      shouldUseMediaElement: () => true,
      createMediaElementOutput: () => ({
        connect: vi.fn().mockReturnValue(false),
        unlock: vi.fn(),
        dispose: vi.fn(),
      }),
    });

    expect(graph.kind).toBe('direct');
    expect(terminal.connect).toHaveBeenCalledWith(destination);
  });
});
