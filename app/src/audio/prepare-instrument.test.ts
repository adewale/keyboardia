import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  isInitialized: vi.fn(),
  isInitializing: vi.fn(),
  initialize: vi.fn(),
  isToneInitialized: vi.fn(),
  initializeTone: vi.fn(),
  preloadInstrumentsForTracks: vi.fn(),
}));

vi.mock('./engine', () => ({ audioEngine: engine }));

import { prepareInstrument } from './prepare-instrument';

describe('prepareInstrument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.isInitialized.mockReturnValue(true);
    engine.isInitializing.mockReturnValue(false);
    engine.isToneInitialized.mockReturnValue(true);
    engine.initialize.mockResolvedValue(undefined);
    engine.initializeTone.mockResolvedValue(undefined);
    engine.preloadInstrumentsForTracks.mockResolvedValue(undefined);
  });

  it('waits for base and Tone initialization before warming a track synth', async () => {
    const order: string[] = [];
    engine.isInitialized.mockReturnValue(false);
    engine.isInitializing.mockReturnValue(true);
    engine.isToneInitialized.mockReturnValue(false);
    engine.initialize.mockImplementation(async () => { order.push('base'); });
    engine.initializeTone.mockImplementation(async () => { order.push('tone'); });
    engine.preloadInstrumentsForTracks.mockImplementation(async () => { order.push('preload'); });

    await prepareInstrument('tone:fm-bass', 'track-1');

    expect(order).toEqual(['base', 'tone', 'preload']);
    expect(engine.preloadInstrumentsForTracks).toHaveBeenCalledWith([
      { id: 'track-1', sampleId: 'tone:fm-bass' },
    ]);
  });

  it('does not create an AudioContext for a remote change before user intent', async () => {
    engine.isInitialized.mockReturnValue(false);
    engine.isInitializing.mockReturnValue(false);

    await prepareInstrument('advanced:supersaw', 'track-1');

    expect(engine.initialize).not.toHaveBeenCalled();
    expect(engine.initializeTone).not.toHaveBeenCalled();
    expect(engine.preloadInstrumentsForTracks).not.toHaveBeenCalled();
  });

  it('preloads sampled buffers without starting Tone.js', async () => {
    await prepareInstrument('sampled:808-kick');

    expect(engine.initializeTone).not.toHaveBeenCalled();
    expect(engine.preloadInstrumentsForTracks).toHaveBeenCalledWith([
      { sampleId: 'sampled:808-kick' },
    ]);
  });
});
