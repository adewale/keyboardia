/**
 * REFACTOR-07: Connection Storm Detection Integration Tests
 *
 * Verifies that the ConnectionStormDetector utility correctly
 * detects rapid connection attempts for debugging purposes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionStormDetector } from '../../src/utils/connection-storm';

describe('REFACTOR-07: Connection Storm Detection', () => {

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Storm Detection', () => {
    it('detects rapid connections', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // 5 connections in quick succession
      for (let i = 0; i < 5; i++) {
        detector.recordConnection();
      }

      expect(detector.isStorm()).toBe(true);
    });

    it('does not flag normal connection rate', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // 3 connections (below threshold)
      for (let i = 0; i < 3; i++) {
        detector.recordConnection();
      }

      expect(detector.isStorm()).toBe(false);
    });

    it('clears old connections from window', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // 3 connections
      for (let i = 0; i < 3; i++) {
        detector.recordConnection();
      }

      // Wait for window to pass
      vi.advanceTimersByTime(15000);

      // 3 more connections (should not trigger since old ones expired)
      for (let i = 0; i < 3; i++) {
        detector.recordConnection();
      }

      expect(detector.isStorm()).toBe(false);
    });

    it('triggers storm exactly at threshold', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // 4 connections (just below threshold)
      for (let i = 0; i < 4; i++) {
        detector.recordConnection();
      }
      expect(detector.isStorm()).toBe(false);

      // 5th connection triggers storm
      detector.recordConnection();
      expect(detector.isStorm()).toBe(true);
    });

    it('handles connections spanning multiple windows', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // 2 connections
      detector.recordConnection();
      detector.recordConnection();

      // Wait 6 seconds
      vi.advanceTimersByTime(6000);

      // 2 more connections (4 total in window)
      detector.recordConnection();
      detector.recordConnection();
      expect(detector.isStorm()).toBe(false);

      // Wait 5 more seconds (first 2 connections now outside window)
      vi.advanceTimersByTime(5000);

      // Still only 2 connections in window
      expect(detector.isStorm()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('uses default config if not provided', () => {
      const detector = new ConnectionStormDetector();

      // Default is 10s window, 5 threshold
      for (let i = 0; i < 4; i++) {
        detector.recordConnection();
      }
      expect(detector.isStorm()).toBe(false);

      detector.recordConnection();
      expect(detector.isStorm()).toBe(true);
    });

    it('respects custom windowMs', () => {
      const detector = new ConnectionStormDetector({ windowMs: 5000, threshold: 5 });

      // 3 connections
      for (let i = 0; i < 3; i++) {
        detector.recordConnection();
      }

      // Wait 6 seconds (past custom window)
      vi.advanceTimersByTime(6000);

      // 3 more connections (first batch expired)
      for (let i = 0; i < 3; i++) {
        detector.recordConnection();
      }

      expect(detector.isStorm()).toBe(false);
    });

    it('respects custom threshold', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 3 });

      // 2 connections (below custom threshold)
      detector.recordConnection();
      detector.recordConnection();
      expect(detector.isStorm()).toBe(false);

      // 3rd connection triggers storm with threshold of 3
      detector.recordConnection();
      expect(detector.isStorm()).toBe(true);
    });

    it('allows partial config override', () => {
      // Only override threshold, use default windowMs
      const detector = new ConnectionStormDetector({ threshold: 3 });

      detector.recordConnection();
      detector.recordConnection();
      detector.recordConnection();

      expect(detector.isStorm()).toBe(true);
    });
  });

  describe('Reset', () => {
    it('clears storm state', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // Trigger storm
      for (let i = 0; i < 5; i++) {
        detector.recordConnection();
      }
      expect(detector.isStorm()).toBe(true);

      // Reset
      detector.reset();

      expect(detector.isStorm()).toBe(false);
    });

    it('allows new storm detection after reset', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // Trigger storm
      for (let i = 0; i < 5; i++) {
        detector.recordConnection();
      }
      expect(detector.isStorm()).toBe(true);

      // Reset
      detector.reset();

      // New connections should be tracked fresh
      for (let i = 0; i < 5; i++) {
        detector.recordConnection();
      }
      expect(detector.isStorm()).toBe(true);
    });
  });

  describe('Connection Count', () => {
    it('getConnectionCount returns current count in window', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      expect(detector.getConnectionCount()).toBe(0);

      detector.recordConnection();
      expect(detector.getConnectionCount()).toBe(1);

      detector.recordConnection();
      detector.recordConnection();
      expect(detector.getConnectionCount()).toBe(3);
    });

    it('getConnectionCount excludes expired connections', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      detector.recordConnection();
      detector.recordConnection();
      expect(detector.getConnectionCount()).toBe(2);

      // Wait for window to pass
      vi.advanceTimersByTime(15000);

      expect(detector.getConnectionCount()).toBe(0);
    });
  });

  describe('Warning State', () => {
    it('tracks whether storm warning has been shown', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      expect(detector.hasWarned()).toBe(false);

      // Trigger storm
      for (let i = 0; i < 5; i++) {
        detector.recordConnection();
      }

      // Check storm (this would trigger warning in real code)
      detector.isStorm();
      expect(detector.hasWarned()).toBe(false); // Not automatically set

      // Manually mark as warned
      detector.markWarned();
      expect(detector.hasWarned()).toBe(true);
    });

    it('reset clears warning state', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // Trigger storm and mark warned
      for (let i = 0; i < 5; i++) {
        detector.recordConnection();
      }
      detector.markWarned();
      expect(detector.hasWarned()).toBe(true);

      // Reset clears warning
      detector.reset();
      expect(detector.hasWarned()).toBe(false);
    });

    it('clears warning when storm clears', () => {
      const detector = new ConnectionStormDetector({ windowMs: 10000, threshold: 5 });

      // Trigger storm
      for (let i = 0; i < 5; i++) {
        detector.recordConnection();
      }
      detector.markWarned();
      expect(detector.hasWarned()).toBe(true);

      // Wait for connections to expire
      vi.advanceTimersByTime(15000);

      // After checking isStorm (which cleans up), warning should clear
      expect(detector.isStorm()).toBe(false);
      expect(detector.hasWarned()).toBe(false);
    });
  });
});
