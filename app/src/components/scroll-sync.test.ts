import { describe, expect, it } from 'vitest';
import { syncHorizontalScroll, type HorizontalScroller } from './scroll-sync';

/** A scroller with a clamped range whose scroll events fire when flushed, like a browser's. */
function fakeScroller(max: number, initial = 0) {
  let position = initial;
  let pending = false;
  const listeners = new Set<() => void>();
  const scroller: HorizontalScroller & { flush: () => void; listeners: Set<() => void> } = {
    get scrollLeft() { return position; },
    set scrollLeft(value: number) {
      const next = Math.max(0, Math.min(max, value));
      if (next !== position) pending = true;
      position = next;
    },
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
    flush: () => {
      if (!pending) return;
      pending = false;
      listeners.forEach(listener => listener());
    },
    listeners,
  };
  return scroller;
}

/** Deliver scroll events until both scrollers are quiet. */
function settle(...scrollers: Array<ReturnType<typeof fakeScroller>>) {
  for (let i = 0; i < 10; i++) scrollers.forEach(scroller => scroller.flush());
}

describe('syncHorizontalScroll', () => {
  it('starts the follower at the leader position', () => {
    const row = fakeScroller(500, 120);
    const dock = fakeScroller(510);
    syncHorizontalScroll(row, dock);
    expect(dock.scrollLeft).toBe(120);
  });

  it('follows in both directions', () => {
    const row = fakeScroller(500);
    const dock = fakeScroller(510);
    syncHorizontalScroll(row, dock);
    settle(row, dock);

    row.scrollLeft = 200;
    settle(row, dock);
    expect(dock.scrollLeft).toBe(200);

    dock.scrollLeft = 40;
    settle(row, dock);
    expect(row.scrollLeft).toBe(40);
  });

  it('does not drag a scroller back with the echo of its own write during a gesture', () => {
    const row = fakeScroller(500);
    const dock = fakeScroller(510);
    syncHorizontalScroll(row, dock);
    settle(row, dock);

    // The person drags the dock: 100, then (before the row's echo arrives) 130.
    dock.scrollLeft = 100;
    dock.flush();
    expect(row.scrollLeft).toBe(100);
    dock.scrollLeft = 130;
    row.flush(); // the echo of the write to 100
    expect(dock.scrollLeft).toBe(130);
    dock.flush();
    settle(row, dock);
    expect(row.scrollLeft).toBe(130);
  });

  it('clamps to the shorter range without oscillating', () => {
    const row = fakeScroller(500);
    const dock = fakeScroller(508);
    syncHorizontalScroll(row, dock);
    dock.scrollLeft = 508;
    settle(row, dock);
    expect(row.scrollLeft).toBe(500);
    expect(dock.scrollLeft).toBe(508);
  });

  it('stops listening when disposed', () => {
    const row = fakeScroller(500);
    const dock = fakeScroller(510);
    const stop = syncHorizontalScroll(row, dock);
    stop();
    expect(row.listeners.size).toBe(0);
    expect(dock.listeners.size).toBe(0);
    row.scrollLeft = 300;
    settle(row, dock);
    expect(dock.scrollLeft).toBe(0);
  });
});
