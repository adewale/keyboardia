/**
 * MessageQueue tests.
 *
 * This class had no tests at all, which is the wrong place for a gap: every
 * outbound mutation passes through it while the client is disconnected
 * (multiplayer.ts wires it up as `new MessageQueue({ maxSize: 100, maxAge:
 * 30000 })`). Its whole job is deciding what to drop, so an untested eviction
 * or expiry rule is a silent-edit-loss bug in a multiplayer app — the failure
 * mode where a user's work vanishes and nothing reports an error.
 *
 * The eviction and expiry paths are the point of these tests; the happy path is
 * the least interesting thing here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageQueue, getMessagePriority } from './MessageQueue';
import { MAX_MESSAGE_SIZE } from '../shared/constants';
import type { ClientMessage } from '../shared/message-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const highMsg = (id = 'track-1'): ClientMessage => ({
  type: 'add_track',
  track: {
    id,
    name: 'Track',
    sampleId: 'kick',
    steps: Array(16).fill(false),
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  },
} as unknown as ClientMessage);

const normalMsg = (step = 0): ClientMessage =>
  ({ type: 'toggle_step', trackId: 'track-1', step }) as unknown as ClientMessage;

const lowMsg = (x = 0): ClientMessage =>
  ({ type: 'cursor_move', x, y: 0 }) as unknown as ClientMessage;

/** Collect what replay() actually sends, in order. */
function recorder() {
  const sent: string[] = [];
  const send = (data: string) => void sent.push(data);
  return { sent, send, types: () => sent.map(s => JSON.parse(s).type) };
}

describe('getMessagePriority', () => {
  it('classifies structural changes as high priority', () => {
    expect(getMessagePriority('add_track')).toBe('high');
    expect(getMessagePriority('delete_track')).toBe('high');
    expect(getMessagePriority('set_track_sample')).toBe('high');
    expect(getMessagePriority('request_snapshot')).toBe('high');
  });

  it('classifies regenerable/transient updates as low priority', () => {
    expect(getMessagePriority('cursor_move')).toBe('low');
    expect(getMessagePriority('play')).toBe('low');
    expect(getMessagePriority('stop')).toBe('low');
    expect(getMessagePriority('clock_sync_request')).toBe('low');
  });

  it('classifies user edits as normal priority', () => {
    expect(getMessagePriority('toggle_step')).toBe('normal');
    expect(getMessagePriority('set_tempo')).toBe('normal');
    expect(getMessagePriority('set_swing')).toBe('normal');
  });
});

describe('MessageQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enqueue', () => {
    it('queues ordinary messages', () => {
      const q = new MessageQueue();
      q.enqueue(normalMsg());
      q.enqueue(highMsg());
      expect(q.size).toBe(2);
    });

    it('refuses to queue time-sensitive message types', () => {
      const q = new MessageQueue();
      q.enqueue({ type: 'clock_sync_request' } as unknown as ClientMessage);
      q.enqueue({ type: 'state_hash', hash: 'abc' } as unknown as ClientMessage);

      // Replaying a clock sync after reconnect would measure the wrong latency,
      // and a state hash computed before the gap is stale by definition.
      expect(q.size).toBe(0);
    });
  });

  describe('eviction when full', () => {
    it('evicts a low priority message to make room', () => {
      const q = new MessageQueue({ maxSize: 3 });
      q.enqueue(lowMsg(1));
      q.enqueue(normalMsg(1));
      q.enqueue(normalMsg(2));

      q.enqueue(highMsg());

      expect(q.size).toBe(3);
      const r = recorder();
      q.replay(r.send);
      // The cursor_move is gone; both edits and the structural change survive.
      expect(r.types()).toEqual(['add_track', 'toggle_step', 'toggle_step']);
    });

    it('evicts a normal priority message when no low priority one exists', () => {
      const q = new MessageQueue({ maxSize: 2 });
      q.enqueue(normalMsg(1));
      q.enqueue(normalMsg(2));

      q.enqueue(highMsg());

      const r = recorder();
      q.replay(r.send);
      expect(r.types()).toEqual(['add_track', 'toggle_step']);
    });

    it('evicts the oldest message within the sacrificed priority', () => {
      const q = new MessageQueue({ maxSize: 3 });
      q.enqueue(normalMsg(1)); // oldest normal — should be the one dropped
      q.enqueue(normalMsg(2));
      q.enqueue(normalMsg(3));

      q.enqueue(highMsg());

      const r = recorder();
      q.replay(r.send);
      const steps = r.sent.map(s => JSON.parse(s)).filter(m => m.type === 'toggle_step').map(m => m.step);
      expect(steps).toEqual([2, 3]);
    });

    it('never evicts a high priority message to make room', () => {
      const q = new MessageQueue({ maxSize: 2 });
      q.enqueue(highMsg('a'));
      q.enqueue(highMsg('b'));

      // Queue is full of structural changes. Rather than lose one, the new
      // message is refused.
      q.enqueue(normalMsg());

      const r = recorder();
      q.replay(r.send);
      expect(r.types()).toEqual(['add_track', 'add_track']);
    });

    // Documents a real data-loss path rather than asserting it is fine: a
    // queue saturated with structural changes silently drops further ones.
    // 100 un-flushed add_tracks is not a realistic session, but if this ever
    // becomes reachable the failure is invisible, so pin the behaviour.
    it('drops a NEW high priority message when the queue is all high priority', () => {
      const q = new MessageQueue({ maxSize: 2 });
      q.enqueue(highMsg('a'));
      q.enqueue(highMsg('b'));

      q.enqueue(highMsg('c'));

      expect(q.size).toBe(2);
      const r = recorder();
      q.replay(r.send);
      const ids = r.sent.map(s => JSON.parse(s).track.id);
      expect(ids).toEqual(['a', 'b']);
      expect(ids).not.toContain('c');
    });
  });

  describe('replay ordering', () => {
    it('sends high priority first, then normal, then low', () => {
      const q = new MessageQueue();
      q.enqueue(lowMsg());
      q.enqueue(normalMsg());
      q.enqueue(highMsg());

      const r = recorder();
      q.replay(r.send);

      expect(r.types()).toEqual(['add_track', 'toggle_step', 'cursor_move']);
    });

    it('preserves insertion order within a priority level', () => {
      const q = new MessageQueue();
      q.enqueue(normalMsg(1));
      vi.advanceTimersByTime(10);
      q.enqueue(normalMsg(2));
      vi.advanceTimersByTime(10);
      q.enqueue(normalMsg(3));

      const r = recorder();
      q.replay(r.send);

      expect(r.sent.map(s => JSON.parse(s).step)).toEqual([1, 2, 3]);
    });
  });

  describe('expiry', () => {
    it('drops messages older than maxAge and keeps the rest', () => {
      const q = new MessageQueue({ maxAge: 1000 });
      q.enqueue(normalMsg(1)); // will be stale
      vi.advanceTimersByTime(1500);
      q.enqueue(normalMsg(2)); // still fresh

      const r = recorder();
      q.replay(r.send);

      expect(r.sent.map(s => JSON.parse(s).step)).toEqual([2]);
    });

    it('treats a message exactly at maxAge as still valid', () => {
      const q = new MessageQueue({ maxAge: 1000 });
      q.enqueue(normalMsg(1));
      vi.advanceTimersByTime(1000); // now - timestamp === maxAge, not > maxAge

      const r = recorder();
      q.replay(r.send);

      expect(r.sent).toHaveLength(1);
    });
  });

  describe('oversized messages', () => {
    it('drops a message that would exceed MAX_MESSAGE_SIZE instead of sending it', () => {
      const q = new MessageQueue();
      const huge = {
        type: 'toggle_step',
        trackId: 'x'.repeat(MAX_MESSAGE_SIZE + 1),
        step: 0,
      } as unknown as ClientMessage;

      q.enqueue(huge);
      q.enqueue(normalMsg(7));

      const r = recorder();
      q.replay(r.send);

      // The good message still gets through — one oversized entry must not
      // poison the whole replay.
      expect(r.sent).toHaveLength(1);
      expect(JSON.parse(r.sent[0]).step).toBe(7);
    });
  });

  describe('lifecycle', () => {
    it('empties the queue after replay so a second reconnect does not resend', () => {
      const q = new MessageQueue();
      q.enqueue(normalMsg());

      const first = recorder();
      q.replay(first.send);
      expect(first.sent).toHaveLength(1);
      expect(q.size).toBe(0);

      const second = recorder();
      q.replay(second.send);
      expect(second.sent).toEqual([]);
    });

    it('empties the queue even when every message was dropped as stale', () => {
      const q = new MessageQueue({ maxAge: 100 });
      q.enqueue(normalMsg());
      vi.advanceTimersByTime(500);

      const r = recorder();
      q.replay(r.send);

      expect(r.sent).toEqual([]);
      expect(q.size).toBe(0);
    });

    it('replays nothing for an empty queue', () => {
      const q = new MessageQueue();
      const r = recorder();
      q.replay(r.send);
      expect(r.sent).toEqual([]);
    });

    it('clear() discards queued messages without sending them', () => {
      const q = new MessageQueue();
      q.enqueue(normalMsg());
      q.enqueue(highMsg());

      q.clear();

      expect(q.size).toBe(0);
      const r = recorder();
      q.replay(r.send);
      expect(r.sent).toEqual([]);
    });
  });

  describe('defaults', () => {
    it('defaults to maxSize 100', () => {
      const q = new MessageQueue();
      for (let i = 0; i < 120; i++) q.enqueue(normalMsg(i));
      expect(q.size).toBe(100);
    });

    it('defaults to a 30s maxAge', () => {
      const q = new MessageQueue();
      q.enqueue(normalMsg());
      vi.advanceTimersByTime(30_001);

      const r = recorder();
      q.replay(r.send);
      expect(r.sent).toEqual([]);
    });
  });
});
