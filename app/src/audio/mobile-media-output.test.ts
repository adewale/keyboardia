// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaElementOutput, needsMediaElementOutput } from './mobile-media-output';
import { setMediaSessionPlaybackState } from './media-session';
import { waitForClockAdvance, CLOCK_LIVENESS_TIMEOUT_MS } from './clock-liveness';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const IPADOS_DESKTOP_UA = MAC_UA; // iPadOS 13+ masquerades as macOS

describe('needsMediaElementOutput', () => {
  it('routes phones and tablets through the media element and leaves desktop alone', () => {
    expect(needsMediaElementOutput({ userAgent: IOS_UA, maxTouchPoints: 5 })).toBe(true);
    expect(needsMediaElementOutput({ userAgent: ANDROID_UA, maxTouchPoints: 5 })).toBe(true);
    expect(needsMediaElementOutput({ userAgent: MAC_UA, maxTouchPoints: 0 })).toBe(false);
    // iPadOS desktop-class UA is only distinguishable by multi-touch.
    expect(needsMediaElementOutput({ userAgent: IPADOS_DESKTOP_UA, maxTouchPoints: 5 })).toBe(true);
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
    expect((source.connect as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(streamDestination);
    const element = document.querySelector('audio')!;
    expect(element).not.toBeNull();
    expect(element.getAttribute('playsinline')).toBe('');
    expect(element.style.display).toBe('none');
    expect(element.muted).toBe(false);
    output.dispose();
    expect(document.querySelector('audio')).toBeNull();
    expect(streamDestination.disconnect).toHaveBeenCalled();
  });

  it('reports failure so the caller can fall back when MediaStream output is unsupported', () => {
    const { context, source } = fakeContext(false);
    const output = new MediaElementOutput();
    expect(output.connect(source, context)).toBe(false);
    expect(output.isActive).toBe(false);
    expect(document.querySelector('audio')).toBeNull();
  });

  it('starts the element on unlock and only once', async () => {
    const { context, source } = fakeContext(true);
    const output = new MediaElementOutput();
    output.connect(source, context);
    const element = document.querySelector('audio')!;
    const play = vi.spyOn(element, 'play').mockResolvedValue(undefined);
    output.unlock();
    await Promise.resolve();
    output.unlock();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('retries unlock after a rejected gesture-less play', async () => {
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
    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe('setMediaSessionPlaybackState', () => {
  it('is a no-op without the API and sets state with it', () => {
    expect(() => setMediaSessionPlaybackState('playing', {} as Navigator)).not.toThrow();
    const session = { playbackState: 'none' as MediaSessionPlaybackState, metadata: null };
    const nav = { mediaSession: session } as unknown as Navigator;
    setMediaSessionPlaybackState('playing', nav);
    expect(session.playbackState).toBe('playing');
    setMediaSessionPlaybackState('paused', nav);
    expect(session.playbackState).toBe('paused');
  });
});

describe('waitForClockAdvance', () => {
  it('returns immediately for a clock that already moved', async () => {
    expect(await waitForClockAdvance({ currentTime: 1.5 })).toBe(true);
  });

  it('resolves true once a parked clock starts moving', async () => {
    const context = { currentTime: 0 };
    const wait = waitForClockAdvance(context);
    setTimeout(() => { context.currentTime = 0.01; }, 20);
    expect(await wait).toBe(true);
  });

  it('gives up after the bounded budget on a clock that never moves', async () => {
    const started = Date.now();
    expect(await waitForClockAdvance({ currentTime: 0 }, 60)).toBe(false);
    expect(Date.now() - started).toBeLessThan(CLOCK_LIVENESS_TIMEOUT_MS + 200);
  });
});
