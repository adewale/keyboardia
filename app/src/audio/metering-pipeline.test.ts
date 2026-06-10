/**
 * Regression tests for two metering pipeline bugs:
 *
 * - bug_001: VU meter freezes on last non-zero value when a track goes
 *   silent. The worklet previously skipped silent slots from its
 *   postMessage payload, so MeteringHost never had a chance to update
 *   the level back to zero. Fix: worklet emits all slots; host trusts
 *   the incoming levels as the complete current state.
 *
 * - bug_008: MeteringHost reuses a freed slot index without resetting
 *   the worklet's per-slot accumulators. The next sendMeters tick
 *   could attribute one frame of stale level/clipping to the new
 *   track. Fix: disconnectTrack posts a 'resetSlot' message to the
 *   worklet, which zeros the slot's accumulators before they're reused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeteringHost } from './metering-host';

interface MockNode {
  port: { onmessage: ((e: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn<(...a: unknown[]) => void>> };
  disconnect(): void;
}

function makeHostWithMockNode(): { host: MeteringHost; mockNode: MockNode } {
  const host = new MeteringHost();
  const mockNode: MockNode = {
    port: { onmessage: null, postMessage: vi.fn<(...a: unknown[]) => void>() },
    disconnect: vi.fn(),
  };
  // Inject mock state to avoid needing a real AudioContext.
  (host as unknown as { node: unknown }).node = mockNode;
  (host as unknown as { moduleLoaded: boolean }).moduleLoaded = true;
  (host as unknown as { audioContext: unknown }).audioContext = { sampleRate: 48000 };
  return { host, mockNode };
}

function dispatchMeters(host: MeteringHost, levels: Array<{ trackIndex: number; rms: number; peak: number; clipping: boolean }>): void {
  const handle = (host as unknown as { handleMeters: (d: unknown) => void }).handleMeters.bind(host);
  handle({ type: 'meters', levels, timestamp: 0 });
}

describe('Metering pipeline', () => {
  let host: MeteringHost;
  let mockNode: MockNode;
  let busOutput: { connect: () => void; disconnect: () => void };

  beforeEach(() => {
    const setup = makeHostWithMockNode();
    host = setup.host;
    mockNode = setup.mockNode;
    busOutput = { connect: () => {}, disconnect: () => {} };
  });

  describe('bug_001: meter must drop to zero after silence', () => {
    it('updates a track level back to zero when worklet emits a zero level for it', () => {
      host.connectTrack('A', busOutput as unknown as AudioNode);
      // First frame: track is loud
      dispatchMeters(host, [{ trackIndex: 0, rms: 0.6, peak: 0.9, clipping: false }]);
      expect(host.getLevel('A')?.rms).toBeCloseTo(0.6);

      // Next frame: silent. Bug was that worklet skipped this entirely;
      // after the fix it must emit a zero level for the slot.
      dispatchMeters(host, [{ trackIndex: 0, rms: 0, peak: 0, clipping: false }]);
      expect(host.getLevel('A')?.rms).toBe(0);
      expect(host.getLevel('A')?.peak).toBe(0);
    });

    it('decays a track level to zero if a new frame omits it (defensive host behavior)', () => {
      // This guards against any worklet-side regression: even if an update
      // arrives that doesn't list track A, the host should not leave A
      // showing a stale non-zero level forever.
      host.connectTrack('A', busOutput as unknown as AudioNode);
      host.connectTrack('B', busOutput as unknown as AudioNode);
      dispatchMeters(host, [
        { trackIndex: 0, rms: 0.5, peak: 0.7, clipping: false },
        { trackIndex: 1, rms: 0.3, peak: 0.4, clipping: false },
      ]);
      expect(host.getLevel('A')?.rms).toBeCloseTo(0.5);
      expect(host.getLevel('B')?.rms).toBeCloseTo(0.3);

      // Next frame only mentions B. A's level must not freeze.
      dispatchMeters(host, [
        { trackIndex: 1, rms: 0.6, peak: 0.7, clipping: false },
      ]);
      expect(host.getLevel('A')?.rms).toBe(0);
      expect(host.getLevel('A')?.peak).toBe(0);
      expect(host.getLevel('B')?.rms).toBeCloseTo(0.6);
    });
  });

  describe('bug_008: reset accumulators when a slot is reused', () => {
    it('posts a resetSlot message to the worklet on disconnect', () => {
      host.connectTrack('A', busOutput as unknown as AudioNode);
      mockNode.port.postMessage.mockClear();
      host.disconnectTrack('A');
      const calls = mockNode.port.postMessage.mock.calls;
      const resetCall = calls.find(
        (c) => typeof c[0] === 'object' && c[0] !== null && (c[0] as { type?: string }).type === 'resetSlot',
      );
      expect(resetCall).toBeDefined();
      expect((resetCall![0] as { index: number }).index).toBe(0);
    });

    it('reuses the freed slot index for the next connectTrack', () => {
      host.connectTrack('A', busOutput as unknown as AudioNode);
      host.disconnectTrack('A');
      host.connectTrack('B', busOutput as unknown as AudioNode);
      // Both used slot 0 in turn — same index, but reset before reuse.
      const idxByTrackId = (host as unknown as { indexByTrackId: Map<string, number> }).indexByTrackId;
      expect(idxByTrackId.get('B')).toBe(0);
    });
  });
});
