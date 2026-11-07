/**
 * Two-way horizontal scroll sync between two scrollers.
 *
 * Used by the landscape editor dock (specs/PIANO-ROLL-DOCK.md, Mobile): there
 * each row's `.steps` scrolls on its own, so the dock cannot share one
 * scroller with every row the way it does on desktop. It aligns with the
 * docked row only, by keeping the two scroll positions equal.
 */

/** The part of an element the sync needs, so tests can pass plain objects. */
export interface HorizontalScroller {
  scrollLeft: number;
  addEventListener(type: 'scroll', listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: 'scroll', listener: () => void): void;
}

/**
 * Keep `follower.scrollLeft` equal to `leader.scrollLeft` and the other way
 * round. The follower first takes the leader's position. Returns a function
 * that stops the sync.
 *
 * Each write makes the written scroller fire its own scroll event a frame
 * later. Copying that echo back would drag the other scroller to a position it
 * has already left during a continuing gesture, so the sync remembers what it
 * wrote and ignores the event that reports exactly that.
 */
export function syncHorizontalScroll(leader: HorizontalScroller, follower: HorizontalScroller): () => void {
  const written = new Map<HorizontalScroller, number>();

  const copy = (from: HorizontalScroller, to: HorizontalScroller) => {
    const before = to.scrollLeft;
    to.scrollLeft = from.scrollLeft;
    // Read back: the browser clamps to the scroller's range.
    const after = to.scrollLeft;
    if (Math.abs(after - before) >= 0.5) written.set(to, after);
  };

  const follow = (self: HorizontalScroller, other: HorizontalScroller) => () => {
    const echo = written.get(self);
    if (echo !== undefined) {
      written.delete(self);
      if (Math.abs(self.scrollLeft - echo) < 1) return;
    }
    if (Math.abs(other.scrollLeft - self.scrollLeft) < 1) return;
    copy(self, other);
  };

  const onLeaderScroll = follow(leader, follower);
  const onFollowerScroll = follow(follower, leader);
  copy(leader, follower);
  leader.addEventListener('scroll', onLeaderScroll, { passive: true });
  follower.addEventListener('scroll', onFollowerScroll, { passive: true });
  return () => {
    leader.removeEventListener('scroll', onLeaderScroll);
    follower.removeEventListener('scroll', onFollowerScroll);
  };
}
