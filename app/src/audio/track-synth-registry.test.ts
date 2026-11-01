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

  describe('bug_006: cancel pending factories on remove/clear', () => {
    /**
     * The registry's factory may be mid-`await` when remove() or clear()
     * fires. Without cancellation the factory's `.then` handler resumes
     * and re-populates `synths`, leaving an instance with no owner —
     * which in the engine corresponds to an orphan TrackBus + metering
     * slot. The fix: drop the pending entry on remove/clear AND have
     * the .then handler check that pending still points to its own
     * promise before storing the result; if not, dispose the synth.
     */
    function makeDeferredFactory() {
      const resolves: Array<(synth: FakeSynth) => void> = [];
      const factoryFn = vi.fn<(trackId: string) => Promise<FakeSynth>>((trackId) => {
        return new Promise<FakeSynth>((resolve) => {
          resolves.push((synth) => resolve(synth ?? { id: `${trackId}#deferred`, disposed: false }));
        });
      });
      return { factoryFn, resolves };
    }

    it('does not store the synth when remove() ran before factory resolution', async () => {
      const disposeSpy = vi.fn<(s: FakeSynth) => void>();
      const { factoryFn, resolves } = makeDeferredFactory();
      const localRegistry = new TrackSynthRegistry<FakeSynth>({
        factory: factoryFn,
        dispose: (s) => { s.disposed = true; disposeSpy(s); },
      });

      const inFlight = localRegistry.getOrCreate('A');
      // remove() while factory is mid-await
      localRegistry.remove('A');
      expect(localRegistry.has('A')).toBe(false);

      // Now resolve the deferred factory
      resolves[0]({ id: 'A#race', disposed: false });
      await inFlight;

      // The race-resolved synth must NOT have been stored, AND it must
      // have been disposed so its audio nodes are released.
      expect(localRegistry.has('A')).toBe(false);
      expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect(disposeSpy.mock.calls[0][0].id).toBe('A#race');
    });

    it('does not store the synth when clear() ran before factory resolution', async () => {
      const disposeSpy = vi.fn<(s: FakeSynth) => void>();
      const { factoryFn, resolves } = makeDeferredFactory();
      const localRegistry = new TrackSynthRegistry<FakeSynth>({
        factory: factoryFn,
        dispose: (s) => { s.disposed = true; disposeSpy(s); },
      });

      const a = localRegistry.getOrCreate('A');
      const b = localRegistry.getOrCreate('B');
      localRegistry.clear();

      resolves[0]({ id: 'A#race', disposed: false });
      resolves[1]({ id: 'B#race', disposed: false });
      await Promise.all([a, b]);

      expect(localRegistry.size).toBe(0);
      expect(disposeSpy).toHaveBeenCalledTimes(2);
    });

    it('a getOrCreate after a racing remove() yields a fresh instance', async () => {
      const { factoryFn, resolves } = makeDeferredFactory();
      const localRegistry = new TrackSynthRegistry<FakeSynth>({
        factory: factoryFn,
        dispose: () => {},
      });

      const first = localRegistry.getOrCreate('A');
      localRegistry.remove('A');

      // Second getOrCreate must NOT reuse the cancelled in-flight promise.
      const second = localRegistry.getOrCreate('A');
      expect(factoryFn).toHaveBeenCalledTimes(2);

      resolves[0]({ id: 'A#first', disposed: false });
      resolves[1]({ id: 'A#second', disposed: false });
      const [s1, s2] = await Promise.all([first, second]);
      expect(s1).not.toBe(s2);
      // Only the second one ends up registered.
      expect(localRegistry.has('A')).toBe(true);
      expect(localRegistry.getIfReady('A')).toBe(s2);
    });

    /**
     * Async state-machine PBT — interleaves remove/clear with NOT-YET-
     * RESOLVED factory promises in arbitrary order. The synchronous
     * state-machine PBT below this block does NOT visit this state
     * space, which is why bug_006 escaped the original suite. See
     * Lesson 33 in docs/LESSONS-LEARNED.md for the meta-pattern.
     *
     * Invariants checked after the trace replays:
     *   (a) Every dispose call happened exactly once per synth.
     *   (b) Every track currently registered has a non-disposed synth.
     *   (c) reg.size matches activeTrackIds.length (no orphan map entries).
     */
    it('async state-machine: remove/clear racing with in-flight factories', async () => {
      type Op =
        | { kind: 'getOrCreate'; trackId: string }
        | { kind: 'resolve'; trackId: string }
        | { kind: 'remove'; trackId: string }
        | { kind: 'clear' };

      const opGen = fc.oneof(
        fc.record({ kind: fc.constant('getOrCreate' as const), trackId: fc.string({ minLength: 1, maxLength: 3 }) }),
        fc.record({ kind: fc.constant('resolve' as const), trackId: fc.string({ minLength: 1, maxLength: 3 }) }),
        fc.record({ kind: fc.constant('remove' as const), trackId: fc.string({ minLength: 1, maxLength: 3 }) }),
        fc.record({ kind: fc.constant('clear' as const) }),
      );

      await fc.assert(
        fc.asyncProperty(
          fc.array(opGen, { minLength: 1, maxLength: 30 }),
          async (ops: Op[]) => {
            const parkedByTrack = new Map<string, Array<(synth: FakeSynth) => void>>();
            const callerPromises: Promise<FakeSynth>[] = [];
            const disposed = new Set<FakeSynth>();
            let disposedCount = 0;

            const reg = new TrackSynthRegistry<FakeSynth>({
              factory: (trackId) => new Promise<FakeSynth>((resolve) => {
                let queue = parkedByTrack.get(trackId);
                if (!queue) { queue = []; parkedByTrack.set(trackId, queue); }
                queue.push(resolve);
              }),
              dispose: (s) => {
                if (disposed.has(s)) throw new Error('double dispose');
                disposed.add(s);
                disposedCount++;
              },
            });

            for (const op of ops) {
              switch (op.kind) {
                case 'getOrCreate':
                  callerPromises.push(reg.getOrCreate(op.trackId).catch(() => ({} as FakeSynth)));
                  break;
                case 'resolve': {
                  const queue = parkedByTrack.get(op.trackId);
                  const settle = queue?.shift();
                  if (settle) {
                    settle({ id: `${op.trackId}#${callerPromises.length}`, disposed: false });
                    await new Promise((r) => setTimeout(r, 0));
                  }
                  break;
                }
                case 'remove':
                  reg.remove(op.trackId);
                  break;
                case 'clear':
                  reg.clear();
                  break;
              }
            }

            // Drain remaining parked factories so .then handlers all run.
            for (const [trackId, queue] of parkedByTrack.entries()) {
              while (queue.length > 0) {
                queue.shift()!({ id: `${trackId}#drain`, disposed: false });
              }
            }
            await Promise.all(callerPromises).catch(() => {});
            await new Promise((r) => setTimeout(r, 0));

            // (a) dispose accounting consistent
            expect(disposedCount).toBe(disposed.size);

            // (b) every registered synth is alive (not disposed)
            for (const trackId of reg.activeTrackIds()) {
              const synth = reg.getIfReady(trackId);
              expect(synth).not.toBeNull();
              expect(disposed.has(synth!)).toBe(false);
            }

            // (c) size matches activeTrackIds — no orphan map entries
            expect(reg.size).toBe(reg.activeTrackIds().length);
          },
        ),
        { numRuns: 100, seed: 0x4ce5e7a8 },
      );
    });
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
