import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeNoteSchedule,
  ATTACK_FADE_SEC,
  MIN_NOTE_DURATION_SEC,
  RELEASE_TAIL_GUARD_SEC,
} from './note-schedule';

/**
 * Pure timing maths for sampled-note playback (fix for P1 in
 * SAMPLE-AUDIT-2026-06). Correctness by construction: playNote derives
 * every Web Audio scheduling call from this one total function, so the
 * invariants proved here hold for the real audio graph.
 */
describe('computeNoteSchedule', () => {
  it('starts at the scheduled event time when it is in the future', () => {
    const s = computeNoteSchedule({ eventTime: 5, currentTime: 1, releaseTime: 0.5 });
    expect(s.startTime).toBe(5);
  });

  it('clamps to currentTime when the event is late (Web Audio cannot start in the past)', () => {
    const s = computeNoteSchedule({ eventTime: 1, currentTime: 2, releaseTime: 0.5 });
    expect(s.startTime).toBe(2);
  });

  it('places the declick attack right after the start', () => {
    const s = computeNoteSchedule({ eventTime: 5, currentTime: 0, releaseTime: 0.5 });
    expect(s.attackEnd).toBe(5 + ATTACK_FADE_SEC);
  });

  it('has no release section for sustained notes (duration undefined)', () => {
    const s = computeNoteSchedule({ eventTime: 5, currentTime: 0, releaseTime: 0.5 });
    expect(s.release).toBeUndefined();
  });

  it('anchors the release to the scheduled start, not the wall clock', () => {
    const s = computeNoteSchedule({
      eventTime: 5,
      currentTime: 0,
      duration: 0.5,
      releaseTime: 0.8,
    });
    expect(s.release).toBeDefined();
    expect(s.release!.start).toBe(5.5);
    expect(s.release!.end).toBeCloseTo(6.3, 10);
    expect(s.release!.stopTime).toBeCloseTo(6.3 + RELEASE_TAIL_GUARD_SEC, 10);
  });

  it('enforces the minimum audible duration', () => {
    const s = computeNoteSchedule({
      eventTime: 5,
      currentTime: 0,
      duration: 0.01,
      releaseTime: 0.5,
    });
    expect(s.release!.start).toBe(5 + MIN_NOTE_DURATION_SEC);
  });

  it('property: the schedule is a strictly ordered chain', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e4, noNaN: true }),
        fc.double({ min: 0, max: 1e4, noNaN: true }),
        fc.option(fc.double({ min: 0, max: 60, noNaN: true }), { nil: undefined }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (eventTime, currentTime, duration, releaseTime) => {
          const s = computeNoteSchedule({ eventTime, currentTime, duration, releaseTime });
          expect(s.startTime).toBe(Math.max(eventTime, currentTime));
          expect(s.attackEnd).toBeGreaterThan(s.startTime);
          if (s.release) {
            expect(s.release.start).toBeGreaterThanOrEqual(s.attackEnd);
            expect(s.release.end).toBeGreaterThan(s.release.start);
            expect(s.release.stopTime).toBeGreaterThan(s.release.end);
          } else {
            expect(duration).toBeUndefined();
          }
        }
      )
    );
  });
});
