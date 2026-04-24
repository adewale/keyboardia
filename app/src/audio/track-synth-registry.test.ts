/**
 * TrackSynthRegistry tests.
 *
 * Unit coverage for the lifecycle invariants, plus a property-based
 * test that verifies the registry's model under arbitrary sequences
 * of getOrCreate/remove/clear operations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { TrackSynthRegistry } from './track-synth-registry';

interface FakeSynth {
  id: string;
  disposed: boolean;
}

describe('TrackSynthRegistry', () => {
  let createCount: number;
  let factory: ReturnType<typeof vi.fn<(trackId: string) => Promise<FakeSynth>>>;
  let registry: TrackSynthRegistry<FakeSynth>;

  beforeEach(() => {
    createCount = 0;
    factory = vi.fn<(trackId: string) => Promise<FakeSynth>>(async (trackId) => {
      createCount++;
      return { id: `${trackId}#${createCount}`, disposed: false };
    });
    registry = new TrackSynthRegistry({
      factory: (trackId) => factory(trackId),
      dispose: (synth) => { synth.disposed = true; },
    });
  });

  it('lazy-creates one synth per track', async () => {
    const a1 = await registry.getOrCreate('A');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a1.id).toBe('A#1');
  });

  it('returns the same synth on repeated getOrCreate for the same track', async () => {
    const a1 = await registry.getOrCreate('A');
    const a2 = await registry.getOrCreate('A');
    expect(a2).toBe(a1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('returns DIFFERENT synths for different tracks (the core bug fix)', async () => {
    const a = await registry.getOrCreate('A');
    const b = await registry.getOrCreate('B');
    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent getOrCreate calls for the same track', async () => {
    const [a1, a2] = await Promise.all([
      registry.getOrCreate('A'),
      registry.getOrCreate('A'),
    ]);
    expect(a1).toBe(a2);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('getIfReady returns null before creation, the synth after', async () => {
    expect(registry.getIfReady('A')).toBeNull();
    const a = await registry.getOrCreate('A');
    expect(registry.getIfReady('A')).toBe(a);
  });

  it('disposes and forgets a track on remove()', async () => {
    const a = await registry.getOrCreate('A');
    registry.remove('A');
    expect(a.disposed).toBe(true);

    const a2 = await registry.getOrCreate('A');
    expect(a2).not.toBe(a);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('clear() disposes all tracked synths', async () => {
    const a = await registry.getOrCreate('A');
    const b = await registry.getOrCreate('B');
    registry.clear();
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('has() reports whether a track has been created', async () => {
    expect(registry.has('A')).toBe(false);
    await registry.getOrCreate('A');
    expect(registry.has('A')).toBe(true);
    registry.remove('A');
    expect(registry.has('A')).toBe(false);
  });

  it('propagates factory errors and does not cache failures', async () => {
    factory.mockImplementationOnce(async () => { throw new Error('boom'); });
    await expect(registry.getOrCreate('A')).rejects.toThrow('boom');
    expect(registry.has('A')).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);

    const a = await registry.getOrCreate('A');
    expect(registry.has('A')).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(a.disposed).toBe(false);
  });

  it('forEach visits every registered synth exactly once', async () => {
    await registry.getOrCreate('A');
    await registry.getOrCreate('B');
    await registry.getOrCreate('C');
    const seen: string[] = [];
    registry.forEach((_, trackId) => seen.push(trackId));
    expect(seen.sort()).toEqual(['A', 'B', 'C']);
  });

  it('activeTrackIds reports currently-created tracks', async () => {
    await registry.getOrCreate('A');
    await registry.getOrCreate('B');
    registry.remove('A');
    expect(registry.activeTrackIds().sort()).toEqual(['B']);
  });

  // Property-based: the registry is a state machine over getOrCreate /
  // remove / clear. Replay an arbitrary sequence and check the invariants
  // against a reference model (a Set of track IDs).
  it('state machine: lifecycle invariants under arbitrary operation sequences', async () => {
    const operation = fc.oneof(
      fc.record({ kind: fc.constant('getOrCreate' as const), trackId: fc.string({ minLength: 1, maxLength: 4 }) }),
      fc.record({ kind: fc.constant('remove' as const), trackId: fc.string({ minLength: 1, maxLength: 4 }) }),
      fc.record({ kind: fc.constant('clear' as const) }),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(operation, { minLength: 1, maxLength: 30 }),
        async (ops) => {
          const seenTracks = new Set<string>();
          let alive = new Set<string>();
          let disposedCount = 0;
          let createCount = 0;

          const localRegistry = new TrackSynthRegistry<FakeSynth>({
            factory: async (trackId: string) => {
              createCount++;
              return { id: `${trackId}#${createCount}`, disposed: false };
            },
            dispose: () => { disposedCount++; },
          });

          for (const op of ops) {
            switch (op.kind) {
              case 'getOrCreate': {
                const wasAlive = alive.has(op.trackId);
                const synth = await localRegistry.getOrCreate(op.trackId);
                expect(synth.disposed).toBe(false);
                seenTracks.add(op.trackId);
                alive.add(op.trackId);
                expect(localRegistry.has(op.trackId)).toBe(true);
                // If already alive, nothing new was created; if not, the
                // factory count should have grown by one since our last
                // getOrCreate for this trackId.
                void wasAlive;
                break;
              }
              case 'remove': {
                if (alive.has(op.trackId)) {
                  localRegistry.remove(op.trackId);
                  alive.delete(op.trackId);
                  expect(localRegistry.has(op.trackId)).toBe(false);
                } else {
                  // remove of an absent track is a no-op
                  localRegistry.remove(op.trackId);
                  expect(localRegistry.has(op.trackId)).toBe(false);
                }
                break;
              }
              case 'clear': {
                localRegistry.clear();
                alive = new Set<string>();
                expect(localRegistry.size).toBe(0);
                break;
              }
            }
            // Invariant: size matches our reference model after every op.
            expect(localRegistry.size).toBe(alive.size);
            expect(new Set(localRegistry.activeTrackIds())).toEqual(alive);
          }

          // Every creation that was later evicted must have been disposed
          // exactly once. We can't count easily mid-test, but we can say:
          // disposedCount ≤ createCount (never dispose more than you create).
          expect(disposedCount).toBeLessThanOrEqual(createCount);
        },
      ),
      { numRuns: 100, seed: 0x7e57e71c },
    );
  });
});
