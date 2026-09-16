// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaElementOutput, needsMediaElementOutput } from './mobile-media-output';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';

describe('needsMediaElementOutput', () => {
  it('routes mobile operating systems through media output and leaves desktop alone', () => {
    expect(needsMediaElementOutput({ userAgent: IOS_UA, maxTouchPoints: 5 })).toBe(true);
    expect(needsMediaElementOutput({ userAgent: ANDROID_UA, maxTouchPoints: 5 })).toBe(true);
    expect(needsMediaElementOutput({ userAgent: MAC_UA, maxTouchPoints: 0 })).toBe(false);
    expect(needsMediaElementOutput({ userAgent: MAC_UA, maxTouchPoints: 5 })).toBe(true);
    expect(needsMediaElementOutput(undefined)).toBe(false);
  });
});

interface FakeStreamDestination {
  stream: { id: string };
  disconnect: () => void;
}

function fakeContext(withStreamDestination: boolean) {
  const streamDestination: FakeStreamDestination = {
    stream: { id: 'fake-stream' },
    disconnect: vi.fn(),
  };
  const context = {
    createMediaStreamDestination: withStreamDestination
      ? vi.fn(() => streamDestination)
      : undefined,
  } as unknown as AudioContext;
  const source = { connect: vi.fn() } as unknown as AudioNode;
  return { context, source, streamDestination };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('audio').forEach(element => element.remove());
});

describe('MediaElementOutput', () => {
  it('builds source → MediaStreamDestination → hidden playsinline element', () => {
    const { context, source, streamDestination } = fakeContext(true);
    const output = new MediaElementOutput();

    expect(output.connect(source, context)).toBe(true);
    expect(output.isActive).toBe(true);
    expect(output.getInput()).toBe(streamDestination);
    expect(source.connect).toHaveBeenCalledWith(streamDestination);
    const element = document.querySelector('audio')!;
    expect(element.getAttribute('playsinline')).toBe('');
    expect(element.style.display).toBe('none');
    expect(element.muted).toBe(false);

    output.dispose();
    expect(document.querySelector('audio')).toBeNull();
    expect(streamDestination.disconnect).toHaveBeenCalled();
  });

  it('reports failure so the caller can retain a direct destination route', () => {
    const { context, source } = fakeContext(false);
    const output = new MediaElementOutput();

    expect(output.connect(source, context)).toBe(false);
    expect(output.isActive).toBe(false);
  });

  it('unlocks once, retries a rejection, and restarts after an OS pause', async () => {
    const { context, source } = fakeContext(true);
    const output = new MediaElementOutput();
    output.connect(source, context);
    const element = document.querySelector('audio')!;
    const play = vi.spyOn(element, 'play').mockRejectedValueOnce(new Error('NotAllowedError'));

    output.unlock();
    await Promise.resolve();
    await Promise.resolve();
    play.mockResolvedValue(undefined);
    output.unlock();
    await Promise.resolve();
    output.unlock();
    expect(play).toHaveBeenCalledTimes(2);

    element.dispatchEvent(new Event('pause'));
    output.unlock();
    expect(play).toHaveBeenCalledTimes(3);
  });
});
