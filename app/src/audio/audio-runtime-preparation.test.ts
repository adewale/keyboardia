// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine';

function baseReadyEngine(): AudioEngine {
  const engine = new AudioEngine();
  (engine as unknown as { initialized: boolean }).initialized = true;
  vi.spyOn(engine, 'ensureAudioReady').mockResolvedValue(true);
  vi.spyOn(engine, 'preloadInstrumentsForTracks').mockResolvedValue(undefined);
  return engine;
}

describe('AudioEngine.prepareForPlayback', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('publishes ready only after the complete track snapshot is prepared', async () => {
    const engine = baseReadyEngine();

    await expect(engine.prepareForPlayback([{ id: 'kick', sampleId: 'kick' }])).resolves.toBe(true);
    expect(engine.getRuntimeState()).toEqual({
      status: 'ready',
      generation: 1,
      instruments: ['kick'],
    });
  });

  it('publishes failed rather than allowing playback when the clock is not live', async () => {
    const engine = baseReadyEngine();
    vi.mocked(engine.ensureAudioReady).mockResolvedValue(false);

    await expect(engine.prepareForPlayback([])).resolves.toBe(false);
    expect(engine.getRuntimeState()).toMatchObject({
      status: 'failed',
      generation: 1,
      stage: 'preparing',
      message: expect.stringMatching(/clock did not become ready/i),
    });
  });

  it('deduplicates concurrent preparation work', async () => {
    const engine = baseReadyEngine();
    let release!: (ready: boolean) => void;
    vi.mocked(engine.ensureAudioReady).mockImplementationOnce(
      () => new Promise<boolean>(resolve => { release = resolve; }),
    );

    const first = engine.prepareForPlayback([]);
    const second = engine.prepareForPlayback([]);
    release(true);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(engine.ensureAudioReady).toHaveBeenCalledOnce();
  });
});
