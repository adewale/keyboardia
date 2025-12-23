/**
 * Option C: Server-side Sequencing Integration Tests
 *
 * These tests verify the full integration flow between client and server
 * for mutation tracking with serverSeq-based selective clearing.
 *
 * Unlike the unit tests in mutation-sequencing.test.ts which test logic patterns,
 * these tests use the actual MockLiveSession to simulate real server behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockLiveSession } from '../worker/mock-durable-object';

/**
 * Client-side mutation tracker that mirrors the real implementation.
 * This tests the Option C algorithm with real MockLiveSession messages.
 */
class IntegrationMutationTracker {
  private pendingMutations = new Map<number, {
    seq: number;
    type: string;
    trackId: string;
    step?: number;
    sentAt: number;
    state: 'pending' | 'confirmed';
    confirmedAtServerSeq?: number;
  }>();

  private clientSeq = 0;
  private stats = { pending: 0, confirmed: 0, cleared: 0 };

  /**
   * Track a new mutation (called when sending a message)
   */
  trackMutation(type: string, trackId: string, step?: number): number {
    const seq = ++this.clientSeq;
    this.pendingMutations.set(seq, {
      seq,
      type,
      trackId,
      step,
      sentAt: Date.now(),
      state: 'pending',
    });
    this.stats.pending++;
    return seq;
  }

  /**
   * Confirm a mutation with serverSeq (called when receiving broadcast with clientSeq)
   */
  confirmMutation(clientSeq: number, serverSeq?: number): void {
    const mutation = this.pendingMutations.get(clientSeq);
    if (mutation && mutation.state === 'pending') {
      mutation.state = 'confirmed';
      mutation.confirmedAtServerSeq = serverSeq;
      this.stats.pending--;
      this.stats.confirmed++;
    }
  }

  /**
   * Clear mutations based on snapshot serverSeq (Option C algorithm)
   */
  clearOnSnapshot(snapshotServerSeq?: number): number {
    const MAX_CONFIRMED_AGE_MS = 60000;
    const now = Date.now();
    const toDelete: number[] = [];

    for (const [clientSeq, mutation] of this.pendingMutations) {
      if (mutation.state !== 'confirmed') {
        continue;
      }

      const confirmedAt = mutation.confirmedAtServerSeq;

      if (confirmedAt !== undefined && snapshotServerSeq !== undefined) {
        if (confirmedAt <= snapshotServerSeq) {
          toDelete.push(clientSeq);
        }
      } else if (now - mutation.sentAt > MAX_CONFIRMED_AGE_MS) {
        toDelete.push(clientSeq);
      }
    }

    for (const clientSeq of toDelete) {
      this.pendingMutations.delete(clientSeq);
      this.stats.cleared++;
    }

    return toDelete.length;
  }

  getStats() {
    return { ...this.stats };
  }

  getPendingCount() {
    return Array.from(this.pendingMutations.values()).filter(m => m.state === 'pending').length;
  }

  getConfirmedCount() {
    return Array.from(this.pendingMutations.values()).filter(m => m.state === 'confirmed').length;
  }

  getTotalInMap() {
    return this.pendingMutations.size;
  }

  getMutation(seq: number) {
    return this.pendingMutations.get(seq);
  }
}

describe('Option C: Server-side Sequencing Integration', () => {
  let session: MockLiveSession;

  beforeEach(() => {
    session = new MockLiveSession('test-session');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('serverSeq in broadcasts', () => {
    it('includes seq in toggle_step broadcast', async () => {
      const ws = session.connect('player-1');
      const onmessage = vi.fn();
      ws.onmessage = onmessage;

      // Add a track first
      session['state'].tracks = [{
        id: 'track-1',
        name: 'Test',
        sampleId: 'kick',
        steps: [false, false, false, false],
        muted: false,
        soloed: false,
        volume: 1,
        transpose: 0,
        parameterLocks: [],
        playbackMode: 'oneshot' as const,
      }];

      // Clear initial messages
      await vi.advanceTimersByTimeAsync(10);
      onmessage.mockClear();

      // Send toggle with clientSeq
      ws.send(JSON.stringify({
        type: 'toggle_step',
        trackId: 'track-1',
        step: 0,
        seq: 1,  // clientSeq
      }));

      await vi.advanceTimersByTimeAsync(10);

      // Check broadcast includes seq (serverSeq) and clientSeq
      const calls = onmessage.mock.calls;
      const toggleMessage = calls.find(call => {
        const msg = JSON.parse(call[0].data);
        return msg.type === 'step_toggled';
      });

      expect(toggleMessage).toBeDefined();
      const msg = JSON.parse(toggleMessage![0].data);
      expect(msg.seq).toBeDefined();
      expect(typeof msg.seq).toBe('number');
      expect(msg.clientSeq).toBe(1);
    });

    it('includes serverSeq in snapshot response', async () => {
      const ws = session.connect('player-1');
      const onmessage = vi.fn();
      ws.onmessage = onmessage;

      // Wait for initial state_sync
      await vi.advanceTimersByTimeAsync(10);
      onmessage.mockClear();

      // Request snapshot
      ws.send(JSON.stringify({ type: 'request_snapshot' }));

      await vi.advanceTimersByTimeAsync(10);

      const snapshotCall = onmessage.mock.calls.find(call => {
        const msg = JSON.parse(call[0].data);
        return msg.type === 'snapshot';
      });

      expect(snapshotCall).toBeDefined();
      const snapshot = JSON.parse(snapshotCall![0].data);
      expect(snapshot.serverSeq).toBeDefined();
      expect(typeof snapshot.serverSeq).toBe('number');
    });

    it('increments serverSeq on each broadcast', async () => {
      const ws = session.connect('player-1');
      const onmessage = vi.fn();
      ws.onmessage = onmessage;

      session['state'].tracks = [{
        id: 'track-1',
        name: 'Test',
        sampleId: 'kick',
        steps: [false, false, false, false],
        muted: false,
        soloed: false,
        volume: 1,
        transpose: 0,
        parameterLocks: [],
        playbackMode: 'oneshot' as const,
      }];

      await vi.advanceTimersByTimeAsync(10);
      onmessage.mockClear();

      // Send multiple toggles
      ws.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 0, seq: 1 }));
      await vi.advanceTimersByTimeAsync(10);

      ws.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 1, seq: 2 }));
      await vi.advanceTimersByTimeAsync(10);

      ws.send(JSON.stringify({ type: 'toggle_step', trackId: 'track-1', step: 2, seq: 3 }));
      await vi.advanceTimersByTimeAsync(10);

      const seqs = onmessage.mock.calls
        .map(call => JSON.parse(call[0].data))
        .filter(msg => msg.type === 'step_toggled')
        .map(msg => msg.seq);

      expect(seqs.length).toBe(3);
      expect(seqs[1]).toBeGreaterThan(seqs[0]);
      expect(seqs[2]).toBeGreaterThan(seqs[1]);
    });
  });

  describe('mutation clearing with serverSeq', () => {
    it('clears mutation when confirmed before snapshot', async () => {
      const tracker = new IntegrationMutationTracker();
      session.connect('player-1');  // Connect to initialize session

      session['state'].tracks = [{
        id: 'track-1',
        name: 'Test',
        sampleId: 'kick',
        steps: [false, false, false, false],
        muted: false,
        soloed: false,
        volume: 1,
        transpose: 0,
        parameterLocks: [],
        playbackMode: 'oneshot' as const,
      }];

      await vi.advanceTimersByTimeAsync(10);

      // Track a mutation
      const clientSeq = tracker.trackMutation('toggle_step', 'track-1', 0);
      expect(tracker.getStats().pending).toBe(1);

      // Simulate server confirmation at serverSeq=1
      tracker.confirmMutation(clientSeq, 1);
      expect(tracker.getStats().confirmed).toBe(1);
      expect(tracker.getConfirmedCount()).toBe(1);

      // Simulate snapshot arriving with serverSeq=5 (after the confirmation)
      const cleared = tracker.clearOnSnapshot(5);
      expect(cleared).toBe(1);
      expect(tracker.getTotalInMap()).toBe(0);
    });

    it('retains mutation when confirmed after snapshot (race condition fix)', async () => {
      const tracker = new IntegrationMutationTracker();

      // Track a mutation
      const clientSeq = tracker.trackMutation('toggle_step', 'track-1', 0);

      // Snapshot arrives FIRST with serverSeq=100
      // At this point, mutation is still pending (no confirmedAtServerSeq)
      let cleared = tracker.clearOnSnapshot(100);
      expect(cleared).toBe(0);  // Pending mutations are not cleared
      expect(tracker.getTotalInMap()).toBe(1);

      // NOW confirmation arrives with serverSeq=101 (AFTER snapshot)
      tracker.confirmMutation(clientSeq, 101);
      expect(tracker.getMutation(clientSeq)?.confirmedAtServerSeq).toBe(101);

      // Even if we run clearing again with the old snapshot's serverSeq,
      // this mutation should be retained because 101 > 100
      cleared = tracker.clearOnSnapshot(100);
      expect(cleared).toBe(0);
      expect(tracker.getTotalInMap()).toBe(1);

      // Only a new snapshot with serverSeq >= 101 would clear it
      cleared = tracker.clearOnSnapshot(101);
      expect(cleared).toBe(1);
      expect(tracker.getTotalInMap()).toBe(0);
    });

    it('handles multiple mutations with mixed timing', async () => {
      const tracker = new IntegrationMutationTracker();

      // Track three mutations
      const seq1 = tracker.trackMutation('toggle_step', 'track-1', 0);
      const seq2 = tracker.trackMutation('toggle_step', 'track-1', 1);
      const seq3 = tracker.trackMutation('toggle_step', 'track-1', 2);

      expect(tracker.getStats().pending).toBe(3);

      // Confirm mutation 1 at serverSeq=10
      tracker.confirmMutation(seq1, 10);

      // Confirm mutation 2 at serverSeq=15
      tracker.confirmMutation(seq2, 15);

      // Mutation 3 is still pending

      expect(tracker.getPendingCount()).toBe(1);
      expect(tracker.getConfirmedCount()).toBe(2);

      // Snapshot arrives with serverSeq=12
      // Should clear seq1 (confirmed at 10 <= 12)
      // Should retain seq2 (confirmed at 15 > 12)
      // Should retain seq3 (still pending)
      const cleared = tracker.clearOnSnapshot(12);
      expect(cleared).toBe(1);
      expect(tracker.getTotalInMap()).toBe(2);
      expect(tracker.getMutation(seq1)).toBeUndefined();
      expect(tracker.getMutation(seq2)).toBeDefined();
      expect(tracker.getMutation(seq3)).toBeDefined();
    });
  });

  describe('backwards compatibility (no serverSeq)', () => {
    it('clears old confirmed mutations by age when serverSeq unavailable', async () => {
      const tracker = new IntegrationMutationTracker();

      // Track and confirm a mutation WITHOUT serverSeq
      const clientSeq = tracker.trackMutation('toggle_step', 'track-1', 0);
      tracker.confirmMutation(clientSeq, undefined);  // No serverSeq

      // Snapshot arrives without serverSeq
      let cleared = tracker.clearOnSnapshot(undefined);
      expect(cleared).toBe(0);  // Not old enough yet

      // Advance time past 60 seconds
      vi.advanceTimersByTime(61000);

      // Now it should be cleared by age fallback
      cleared = tracker.clearOnSnapshot(undefined);
      expect(cleared).toBe(1);
      expect(tracker.getTotalInMap()).toBe(0);
    });

    it('retains pending mutations regardless of age', async () => {
      const tracker = new IntegrationMutationTracker();

      // Track mutation but don't confirm
      tracker.trackMutation('toggle_step', 'track-1', 0);

      // Advance time past 60 seconds
      vi.advanceTimersByTime(61000);

      // Pending mutations should not be cleared by clearOnSnapshot
      const cleared = tracker.clearOnSnapshot(undefined);
      expect(cleared).toBe(0);
      expect(tracker.getTotalInMap()).toBe(1);
    });
  });

  describe('stats accuracy through full lifecycle', () => {
    it('maintains accurate stats through mutation lifecycle', () => {
      const tracker = new IntegrationMutationTracker();

      // Initial state
      expect(tracker.getStats()).toEqual({ pending: 0, confirmed: 0, cleared: 0 });

      // Track mutations
      const seq1 = tracker.trackMutation('toggle_step', 'track-1', 0);
      const seq2 = tracker.trackMutation('toggle_step', 'track-1', 1);
      expect(tracker.getStats()).toEqual({ pending: 2, confirmed: 0, cleared: 0 });

      // Confirm one
      tracker.confirmMutation(seq1, 10);
      expect(tracker.getStats()).toEqual({ pending: 1, confirmed: 1, cleared: 0 });

      // Confirm the other
      tracker.confirmMutation(seq2, 11);
      expect(tracker.getStats()).toEqual({ pending: 0, confirmed: 2, cleared: 0 });

      // Clear on snapshot
      tracker.clearOnSnapshot(15);
      expect(tracker.getStats()).toEqual({ pending: 0, confirmed: 2, cleared: 2 });
      expect(tracker.getTotalInMap()).toBe(0);
    });

    it('handles rapid toggles correctly', () => {
      const tracker = new IntegrationMutationTracker();

      // Rapid toggles on same step
      const seq1 = tracker.trackMutation('toggle_step', 'track-1', 0);
      const seq2 = tracker.trackMutation('toggle_step', 'track-1', 0);
      const seq3 = tracker.trackMutation('toggle_step', 'track-1', 0);

      expect(tracker.getPendingCount()).toBe(3);

      // All get confirmed
      tracker.confirmMutation(seq1, 1);
      tracker.confirmMutation(seq2, 2);
      tracker.confirmMutation(seq3, 3);

      expect(tracker.getPendingCount()).toBe(0);
      expect(tracker.getConfirmedCount()).toBe(3);

      // Snapshot clears all
      tracker.clearOnSnapshot(5);
      expect(tracker.getTotalInMap()).toBe(0);
    });
  });

  describe('full flow with MockLiveSession', () => {
    it('simulates complete mutation flow with real server messages', async () => {
      const tracker = new IntegrationMutationTracker();
      const ws = session.connect('player-1');
      const onmessage = vi.fn();
      ws.onmessage = onmessage;

      session['state'].tracks = [{
        id: 'track-1',
        name: 'Test',
        sampleId: 'kick',
        steps: [false, false, false, false],
        muted: false,
        soloed: false,
        volume: 1,
        transpose: 0,
        parameterLocks: [],
        playbackMode: 'oneshot' as const,
      }];

      await vi.advanceTimersByTimeAsync(10);
      onmessage.mockClear();

      // Step 1: Client sends mutation
      const clientSeq = tracker.trackMutation('toggle_step', 'track-1', 0);
      ws.send(JSON.stringify({
        type: 'toggle_step',
        trackId: 'track-1',
        step: 0,
        seq: clientSeq,
      }));

      await vi.advanceTimersByTimeAsync(10);

      // Step 2: Extract serverSeq from broadcast and confirm
      const toggleCall = onmessage.mock.calls.find(call => {
        const msg = JSON.parse(call[0].data);
        return msg.type === 'step_toggled';
      });
      expect(toggleCall).toBeDefined();

      const toggleMsg = JSON.parse(toggleCall![0].data);
      expect(toggleMsg.clientSeq).toBe(clientSeq);
      expect(toggleMsg.seq).toBeDefined();

      tracker.confirmMutation(toggleMsg.clientSeq, toggleMsg.seq);
      expect(tracker.getConfirmedCount()).toBe(1);

      // Step 3: Request snapshot
      onmessage.mockClear();
      ws.send(JSON.stringify({ type: 'request_snapshot' }));
      await vi.advanceTimersByTimeAsync(10);

      const snapshotCall = onmessage.mock.calls.find(call => {
        const msg = JSON.parse(call[0].data);
        return msg.type === 'snapshot';
      });
      expect(snapshotCall).toBeDefined();

      const snapshot = JSON.parse(snapshotCall![0].data);
      expect(snapshot.serverSeq).toBeGreaterThanOrEqual(toggleMsg.seq);

      // Step 4: Clear mutations based on snapshot
      const cleared = tracker.clearOnSnapshot(snapshot.serverSeq);
      expect(cleared).toBe(1);
      expect(tracker.getTotalInMap()).toBe(0);
    });

    it('simulates race condition where snapshot arrives first', async () => {
      const tracker = new IntegrationMutationTracker();
      const ws = session.connect('player-1');
      const onmessage = vi.fn();
      ws.onmessage = onmessage;

      session['state'].tracks = [{
        id: 'track-1',
        name: 'Test',
        sampleId: 'kick',
        steps: [false, false, false, false],
        muted: false,
        soloed: false,
        volume: 1,
        transpose: 0,
        parameterLocks: [],
        playbackMode: 'oneshot' as const,
      }];

      await vi.advanceTimersByTimeAsync(10);

      // Get initial serverSeq from a snapshot
      ws.send(JSON.stringify({ type: 'request_snapshot' }));
      await vi.advanceTimersByTimeAsync(10);

      const initialSnapshot = onmessage.mock.calls
        .map(call => JSON.parse(call[0].data))
        .find(msg => msg.type === 'snapshot');
      const initialServerSeq = initialSnapshot.serverSeq;

      onmessage.mockClear();

      // Client tracks mutation LOCALLY
      const clientSeq = tracker.trackMutation('toggle_step', 'track-1', 0);

      // Simulate: snapshot arrives BEFORE toggle is confirmed
      // (In real world, this happens due to network timing)
      tracker.clearOnSnapshot(initialServerSeq);
      expect(tracker.getTotalInMap()).toBe(1);  // Pending mutation retained!

      // Now send the toggle
      ws.send(JSON.stringify({
        type: 'toggle_step',
        trackId: 'track-1',
        step: 0,
        seq: clientSeq,
      }));
      await vi.advanceTimersByTimeAsync(10);

      // Get confirmation with new serverSeq
      const toggleMsg = onmessage.mock.calls
        .map(call => JSON.parse(call[0].data))
        .find(msg => msg.type === 'step_toggled');

      expect(toggleMsg.seq).toBeGreaterThan(initialServerSeq);

      // Confirm with the new serverSeq
      tracker.confirmMutation(clientSeq, toggleMsg.seq);

      // Try clearing with OLD snapshot serverSeq - should NOT clear
      const cleared1 = tracker.clearOnSnapshot(initialServerSeq);
      expect(cleared1).toBe(0);
      expect(tracker.getTotalInMap()).toBe(1);

      // Only a new snapshot would clear it
      const cleared2 = tracker.clearOnSnapshot(toggleMsg.seq + 1);
      expect(cleared2).toBe(1);
      expect(tracker.getTotalInMap()).toBe(0);
    });
  });
});
