import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SampledInstrument, SampledInstrumentRegistry, type InstrumentManifest } from './sampled-instrument';
import { sampleCache } from './lru-sample-cache';
import { FakeAudioContext, FakeGainNode } from './__fakes__/FakeWebAudio';

function fetchWithFailures(manifest: InstrumentManifest, failures: Set<string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = input.toString();
    if (url.endsWith('manifest.json')) {
      return { ok: true, json: async () => manifest } as Response;
    }
    const filename = url.split('/').at(-1)!;
    if (failures.has(filename)) return { ok: false, status: 503 } as Response;
    const bytes = new TextEncoder().encode(filename);
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as Response;
  }) as typeof fetch;
}

async function createInstrument(manifest: InstrumentManifest, failures = new Set<string>()) {
  vi.stubGlobal('fetch', fetchWithFailures(manifest, failures));
  const context = new FakeAudioContext();
  const instrument = new SampledInstrument(manifest.id, '/instruments');
  instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);
  return { context, instrument };
}

beforeEach(() => sampleCache.clear());
afterEach(() => vi.unstubAllGlobals());

describe('observable progressive readiness (pipeline stage 8)', () => {
  it('loads every velocity and round-robin variant at the priority root before becoming ready', async () => {
    const manifest: InstrumentManifest = {
      id: 'layered-priority',
      name: 'Layered Priority',
      type: 'sampled',
      releaseTime: 0.5,
      samples: [
        { note: 48, file: 'C3.mp3' },
        { note: 60, file: 'C4-soft-rr0.mp3', velocityMin: 0, velocityMax: 63, roundRobinGroup: 'hit', roundRobinIndex: 0 },
        { note: 60, file: 'C4-soft-rr1.mp3', velocityMin: 0, velocityMax: 63, roundRobinGroup: 'hit', roundRobinIndex: 1 },
        { note: 60, file: 'C4-loud.mp3', velocityMin: 64, velocityMax: 127 },
        { note: 72, file: 'C5.mp3' },
      ],
    };
    const { instrument } = await createInstrument(manifest);

    expect(instrument.getLoadState()).toBe('idle');
    await expect(instrument.ensureLoaded()).resolves.toBe(true);
    expect(instrument.getLoadState()).toMatch(/priority-ready|complete/);
    expect(instrument.getVelocityLayerCount(60)).toBe(3);
  });

  it('does not report ready between priority decode and required release-region decode', async () => {
    const manifest: InstrumentManifest = {
      id: 'release-readiness',
      name: 'Release Readiness',
      type: 'sampled',
      releaseTime: 0.5,
      priorityNotes: [60],
      samples: [{ note: 60, file: 'body.mp3', releaseGroup: 'keys' }],
      releaseRegions: [{
        file: 'release.mp3', rootMidi: 60, velocityMin: 0, velocityMax: 127,
        roundRobin: 0, heldDecayDbPerSecond: 0, gainDb: 0, releaseGroup: 'keys',
      }],
    };
    let releaseDecode!: () => void;
    let announceReleaseRequest!: () => void;
    const releaseGate = new Promise<void>(resolve => { releaseDecode = resolve; });
    const releaseRequested = new Promise<void>(resolve => { announceReleaseRequest = resolve; });
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response;
      const filename = url.split('/').at(-1)!;
      if (filename === 'release.mp3') {
        announceReleaseRequest();
        await releaseGate;
      }
      const bytes = new TextEncoder().encode(filename);
      return { ok: true, arrayBuffer: async () => bytes.buffer } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    const loading = instrument.ensureLoaded();
    await releaseRequested;
    expect(instrument.isReady()).toBe(false);
    const concurrent = instrument.ensureLoaded();
    releaseDecode();

    await expect(loading).resolves.toBe(true);
    await expect(concurrent).resolves.toBe(true);
    expect(instrument.isReady()).toBe(true);
  });

  it('bounds background fetch/decode concurrency for deep production instruments', async () => {
    const backgroundCount = 18;
    const manifest: InstrumentManifest = {
      id: 'bounded-background-load',
      name: 'Bounded Background Load',
      type: 'sampled',
      releaseTime: 0.5,
      priorityNotes: [60],
      samples: [
        { note: 60, file: 'priority.mp3' },
        ...Array.from({ length: backgroundCount }, (_, index) => ({ note: 61 + index, file: `background-${index}.mp3` })),
      ],
    };
    let releaseBackground!: () => void;
    const backgroundGate = new Promise<void>(resolve => { releaseBackground = resolve; });
    let activeBackground = 0;
    let maximumBackground = 0;
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response;
      const filename = url.split('/').at(-1)!;
      if (filename.startsWith('background-')) {
        activeBackground++;
        maximumBackground = Math.max(maximumBackground, activeBackground);
        await backgroundGate;
        activeBackground--;
      }
      const bytes = new TextEncoder().encode(filename);
      return { ok: true, arrayBuffer: async () => bytes.buffer } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    await expect(instrument.ensureLoaded()).resolves.toBe(true);
    await vi.waitFor(() => expect(maximumBackground).toBeGreaterThan(0));
    expect(maximumBackground).toBeLessThanOrEqual(6);
    releaseBackground();
    await instrument.waitForBackgroundLoad();
    expect(instrument.getLoadState()).toBe('complete');
    expect(instrument.getSampleNotes()).toHaveLength(backgroundCount + 1);
  });

  it('bounds aggregate fetch/decode concurrency across simultaneous instruments', async () => {
    const manifests = new Map<string, InstrumentManifest>(['one', 'two'].map(id => [id, {
      id,
      name: id,
      type: 'sampled' as const,
      releaseTime: 0.5,
      priorityNotes: [60],
      samples: [
        { note: 60, file: 'priority.mp3' },
        ...Array.from({ length: 10 }, (_, index) => ({ note: 61 + index, file: `background-${index}.mp3` })),
      ],
    }]));
    let releaseBackground!: () => void;
    const gate = new Promise<void>(resolve => { releaseBackground = resolve; });
    let active = 0;
    let maximum = 0;
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      const instrumentId = url.includes('/one/') ? 'one' : 'two';
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifests.get(instrumentId)! } as Response;
      const filename = url.split('/').at(-1)!;
      if (filename.startsWith('background-')) {
        active++;
        maximum = Math.max(maximum, active);
        await gate;
        active--;
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(`${instrumentId}:${filename}`).buffer } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instruments = ['one', 'two'].map(id => {
      const instrument = new SampledInstrument(id, '/instruments');
      instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);
      return instrument;
    });

    await Promise.all(instruments.map(instrument => instrument.ensureLoaded()));
    await vi.waitFor(() => expect(maximum).toBeGreaterThan(0));
    expect(maximum).toBeLessThanOrEqual(6);
    releaseBackground();
    await Promise.all(instruments.map(instrument => instrument.waitForBackgroundLoad()));
  });

  it('deduplicates concurrent mappings that reference one delivery file', async () => {
    const manifest: InstrumentManifest = {
      id: 'shared-file',
      name: 'Shared File',
      type: 'sampled',
      releaseTime: 0.5,
      priorityNotes: [60],
      samples: [
        { note: 60, file: 'shared.mp3', velocityMin: 0, velocityMax: 63 },
        { note: 60, file: 'shared.mp3', velocityMin: 64, velocityMax: 127 },
      ],
    };
    let audioFetches = 0;
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response;
      audioFetches++;
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    await expect(instrument.ensureLoaded()).resolves.toBe(true);
    expect(audioFetches).toBe(1);
    expect(instrument.getVelocityLayerCount(60)).toBe(2);
  });

  it('installs a successful background root before a slow sibling settles', async () => {
    const manifest: InstrumentManifest = {
      id: 'progressive-install',
      name: 'Progressive Install',
      type: 'sampled',
      releaseTime: 0.5,
      priorityNotes: [60],
      samples: [
        { note: 60, file: 'priority.mp3' },
        { note: 61, file: 'fast.mp3' },
        { note: 62, file: 'slow.mp3' },
      ],
    };
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response;
      const filename = url.split('/').at(-1)!;
      if (filename === 'slow.mp3') await slowGate;
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(filename).buffer } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    await expect(instrument.ensureLoaded()).resolves.toBe(true);
    await vi.waitFor(() => expect(instrument.getSampleNotes()).toContain(61));
    expect(instrument.getSampleNotes()).not.toContain(62);
    expect(instrument.getLoadState()).toBe('priority-ready');
    releaseSlow();
    await instrument.waitForBackgroundLoad();
    expect(instrument.getSampleNotes()).toContain(62);
  });

  it('installs successful background samples independently and reports degraded failures', async () => {
    const manifest: InstrumentManifest = {
      id: 'degraded-load',
      name: 'Degraded Load',
      type: 'sampled',
      releaseTime: 0.5,
      samples: [
        { note: 55, file: 'G3.mp3' },
        { note: 60, file: 'C4.mp3' },
        { note: 65, file: 'F4.mp3' },
      ],
    };
    const { instrument } = await createInstrument(manifest, new Set(['F4.mp3']));

    await expect(instrument.ensureLoaded()).resolves.toBe(true);
    await vi.waitFor(() => expect(instrument.getLoadState()).toBe('degraded'));
    expect(instrument.getSampleNotes().sort((a, b) => a - b)).toEqual([55, 60]);
    expect(instrument.getLoadFailures()).toEqual([
      expect.objectContaining({ file: 'F4.mp3', message: expect.stringContaining('503') }),
    ]);
  });

  it('surfaces background degradation through the registry and retries only failed mappings', async () => {
    const failures = new Set(['F4.mp3']);
    const manifest: InstrumentManifest = {
      id: 'registry-retry',
      name: 'Registry Retry',
      type: 'sampled',
      releaseTime: 0.5,
      samples: [
        { note: 60, file: 'C4.mp3' },
        { note: 65, file: 'F4.mp3' },
      ],
    };
    vi.stubGlobal('fetch', fetchWithFailures(manifest, failures));
    const context = new FakeAudioContext();
    const registry = new SampledInstrumentRegistry();
    registry.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);
    registry.register(manifest.id, '/instruments');

    await expect(registry.load(manifest.id)).resolves.toBe(true);
    await vi.waitFor(() => expect(registry.getState(manifest.id)).toBe('error'));
    expect(registry.getError(manifest.id)?.message).toContain('F4.mp3');

    failures.delete('F4.mp3');
    await expect(registry.retry(manifest.id)).resolves.toBe(true);
    expect(registry.getState(manifest.id)).toBe('ready');
    expect(registry.get(manifest.id)?.getSampleNotes().sort((a, b) => a - b)).toEqual([60, 65]);
  });

  it('acquires cache ownership for samples installed after priority readiness', async () => {
    const manifest: InstrumentManifest = {
      id: 'progressive-cache-owner',
      name: 'Progressive Cache Owner',
      type: 'sampled',
      releaseTime: 0.5,
      samples: [
        { note: 60, file: 'C4.mp3' },
        { note: 72, file: 'C5.mp3' },
      ],
    };
    let releaseBackground!: () => void;
    const backgroundReady = new Promise<void>(resolve => { releaseBackground = resolve; });
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response;
      const filename = url.split('/').at(-1)!;
      if (filename === 'C5.mp3') await backgroundReady;
      const bytes = new TextEncoder().encode(filename);
      return { ok: true, arrayBuffer: async () => bytes.buffer } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    await instrument.ensureLoaded();
    instrument.acquireCacheReferences();
    expect(sampleCache.getRefCount('progressive-cache-owner:C4.mp3')).toBe(1);
    releaseBackground();
    await instrument.waitForBackgroundLoad();
    expect(sampleCache.getRefCount('progressive-cache-owner:C5.mp3')).toBe(1);
    instrument.releaseCacheReferences();
    expect(sampleCache.getRefCount('progressive-cache-owner:C4.mp3')).toBe(0);
    expect(sampleCache.getRefCount('progressive-cache-owner:C5.mp3')).toBe(0);
  });

  it('ignores an in-flight background decode after disposal', async () => {
    const manifest: InstrumentManifest = {
      id: 'dispose-during-load',
      name: 'Dispose During Load',
      type: 'sampled',
      releaseTime: 0.5,
      samples: [
        { note: 60, file: 'C4.mp3' },
        { note: 72, file: 'C5.mp3' },
      ],
    };
    let releaseBackground!: () => void;
    const backgroundReady = new Promise<void>(resolve => { releaseBackground = resolve; });
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response;
      const filename = url.split('/').at(-1)!;
      if (filename === 'C5.mp3') await backgroundReady;
      const bytes = new TextEncoder().encode(filename);
      return { ok: true, arrayBuffer: async () => bytes.buffer } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    await expect(instrument.ensureLoaded()).resolves.toBe(true);
    instrument.dispose();
    releaseBackground();
    await Promise.resolve();
    await Promise.resolve();
    expect(instrument.getLoadState()).toBe('idle');
    expect(instrument.getSampleNotes()).toEqual([]);
  });

  it('cannot be resurrected by an in-flight sprite load after disposal', async () => {
    const manifest: InstrumentManifest = {
      id: 'sprite-dispose',
      name: 'Sprite Dispose',
      type: 'sampled',
      sprite: 'all.mp3',
      releaseTime: 0.5,
      samples: [{ note: 60, file: 'all.mp3', offset: 0, duration: 1 }],
    };
    let releaseSprite!: () => void;
    const spriteReady = new Promise<void>(resolve => { releaseSprite = resolve; });
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response;
      await spriteReady;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
    }) as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    const loading = instrument.ensureLoaded();
    await Promise.resolve();
    await Promise.resolve();
    instrument.dispose();
    releaseSprite();
    await expect(loading).resolves.toBe(false);
    expect(instrument.getLoadState()).toBe('idle');
    expect(instrument.isReady()).toBe(false);
  });

  it('cannot install a manifest that resolves after disposal', async () => {
    const manifest: InstrumentManifest = {
      id: 'manifest-dispose',
      name: 'Manifest Dispose',
      type: 'sampled',
      releaseTime: 0.5,
      samples: [{ note: 60, file: 'C4.mp3' }],
    };
    let releaseManifest!: () => void;
    const manifestReady = new Promise<void>(resolve => { releaseManifest = resolve; });
    vi.stubGlobal('fetch', (async () => ({
      ok: true,
      json: async () => { await manifestReady; return manifest; },
    })) as unknown as typeof fetch);
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(context.asAudioContext(), new FakeGainNode() as unknown as AudioNode);

    const loading = instrument.ensureLoaded();
    await Promise.resolve();
    instrument.dispose();
    releaseManifest();
    await expect(loading).resolves.toBe(false);
    expect(instrument.getName()).toBe('Unknown');
    expect(instrument.getLoadState()).toBe('idle');
  });

  it('does not claim readiness when any priority mapping fails', async () => {
    const manifest: InstrumentManifest = {
      id: 'priority-failure',
      name: 'Priority Failure',
      type: 'sampled',
      releaseTime: 0.5,
      priorityNotes: [60],
      samples: [
        { note: 60, file: 'C4-soft.mp3', velocityMin: 0, velocityMax: 63 },
        { note: 60, file: 'C4-loud.mp3', velocityMin: 64, velocityMax: 127 },
        { note: 72, file: 'C5.mp3' },
      ],
    };
    const { instrument } = await createInstrument(manifest, new Set(['C4-loud.mp3']));

    await expect(instrument.ensureLoaded()).resolves.toBe(false);
    expect(instrument.isReady()).toBe(false);
    expect(instrument.getLoadState()).toBe('degraded');
  });
});
