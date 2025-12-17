import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initPlaybackDebug,
  registerSchedulerInstance,
  instrumentSchedulerStart,
  instrumentSchedulerStop,
  instrumentNoteSchedule,
  verifySchedulerInvariants,
  assertPlaybackStopped,
  capturePlaybackState,
  logStateSnapshot,
} from './playback-state-debug';
import { logger } from '../utils/logger';

// Mock logger to capture output
vi.mock('../utils/logger', () => ({
  logger: {
    audio: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('playback-state-debug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear window debug state
    if (typeof window !== 'undefined') {
      window.__AUDIO_DEBUG__ = false;
    }
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.__AUDIO_DEBUG__ = false;
    }
  });

  describe('initPlaybackDebug', () => {
    it('should initialize debug interface on window', () => {
      initPlaybackDebug();

      expect(window.__getPlaybackState__).toBeDefined();
      expect(window.__getPlaybackTrace__).toBeDefined();
      expect(window.__clearPlaybackTrace__).toBeDefined();
      expect(window.__assertPlaybackStopped__).toBeDefined();
    });

    it('should return empty state when no snapshots recorded', () => {
      initPlaybackDebug();

      const state = window.__getPlaybackState__();
      expect(state.timestamp).toBe(0);
      expect(state.schedulerIsRunning).toBe(false);
    });

    it('should return empty trace initially', () => {
      initPlaybackDebug();

      const trace = window.__getPlaybackTrace__();
      expect(trace).toEqual([]);
    });
  });

  describe('registerSchedulerInstance', () => {
    it('should track scheduler instances', () => {
      const scheduler1 = { id: 1 };
      registerSchedulerInstance(scheduler1);

      // No error logged for first instance
      expect(logger.audio.error).not.toHaveBeenCalled();
    });

    it('should warn on duplicate registration', () => {
      const scheduler = { id: 1 };
      registerSchedulerInstance(scheduler);
      registerSchedulerInstance(scheduler);

      expect(logger.audio.warn).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );
    });

    it('should error on multiple different instances (when debug enabled)', () => {
      window.__AUDIO_DEBUG__ = true;

      const scheduler1 = { id: 1 };
      const scheduler2 = { id: 2 };

      registerSchedulerInstance(scheduler1);
      registerSchedulerInstance(scheduler2);

      // Should log error for multiple instances
      expect(logger.audio.error).toHaveBeenCalledWith(
        expect.stringContaining('Multiple scheduler instances'),
        expect.any(Object)
      );
    });
  });

  describe('verifySchedulerInvariants', () => {
    it('should return true when all invariants hold', () => {
      const result = verifySchedulerInvariants(
        false, // isRunning
        null,  // timerId
        0,     // pendingTimersCount
        null   // getState
      );

      expect(result).toBe(true);
    });

    it('should detect isRunning=false with timerId set', () => {
      const result = verifySchedulerInvariants(
        false, // isRunning
        123,   // timerId should be null when not running
        0,     // pendingTimersCount
        null   // getState
      );

      expect(result).toBe(false);
      expect(logger.audio.error).toHaveBeenCalledWith(
        expect.stringContaining('INVARIANT VIOLATION'),
        expect.objectContaining({ isRunning: false, timerId: 123 })
      );
    });

    it('should warn on pending timers when not running', () => {
      verifySchedulerInvariants(
        false, // isRunning
        null,  // timerId
        5,     // pendingTimersCount - should be 0
        null   // getState
      );

      expect(logger.audio.warn).toHaveBeenCalledWith(
        expect.stringContaining('INVARIANT WARNING'),
        expect.objectContaining({ pendingTimersCount: 5 })
      );
    });

    it('should detect isRunning=true without getState', () => {
      const result = verifySchedulerInvariants(
        true,  // isRunning
        123,   // timerId
        0,     // pendingTimersCount
        null   // getState should be set when running
      );

      expect(result).toBe(false);
      expect(logger.audio.error).toHaveBeenCalledWith(
        expect.stringContaining('INVARIANT VIOLATION'),
        expect.objectContaining({ isRunning: true })
      );
    });
  });

  describe('assertPlaybackStopped', () => {
    it('should pass assertion when stopped cleanly', () => {
      window.__AUDIO_DEBUG__ = true;

      assertPlaybackStopped(false, null, 0);

      expect(logger.audio.log).toHaveBeenCalledWith(
        expect.stringContaining('Playback stop verified')
      );
    });

    it('should fail assertion when isRunning is still true', () => {
      window.__AUDIO_DEBUG__ = true;

      assertPlaybackStopped(true, null, 0);

      expect(logger.audio.error).toHaveBeenCalledWith(
        expect.stringContaining('ASSERTION FAILED'),
        expect.objectContaining({
          violations: expect.arrayContaining(['isRunning is still true']),
        })
      );
    });

    it('should fail assertion when timerId is not cleared', () => {
      window.__AUDIO_DEBUG__ = true;

      assertPlaybackStopped(false, 123, 0);

      expect(logger.audio.error).toHaveBeenCalledWith(
        expect.stringContaining('ASSERTION FAILED'),
        expect.objectContaining({
          violations: expect.arrayContaining([expect.stringContaining('timerId')]),
        })
      );
    });

    it('should fail assertion when pending timers remain', () => {
      window.__AUDIO_DEBUG__ = true;

      assertPlaybackStopped(false, null, 3);

      expect(logger.audio.error).toHaveBeenCalledWith(
        expect.stringContaining('ASSERTION FAILED'),
        expect.objectContaining({
          violations: expect.arrayContaining([expect.stringContaining('pending timers')]),
        })
      );
    });
  });

  describe('instrumentNoteSchedule (debug mode)', () => {
    it('should error when note scheduled after stop', () => {
      window.__AUDIO_DEBUG__ = true;

      instrumentNoteSchedule('piano', 0, 1.0, false); // isRunning = false

      expect(logger.audio.error).toHaveBeenCalledWith(
        expect.stringContaining('ASSERTION FAILED'),
        expect.objectContaining({
          preset: 'piano',
          step: 0,
        })
      );
    });

    it('should not error when note scheduled during playback', () => {
      window.__AUDIO_DEBUG__ = true;

      instrumentNoteSchedule('piano', 0, 1.0, true); // isRunning = true

      expect(logger.audio.error).not.toHaveBeenCalled();
    });

    it('should be no-op when debug disabled', () => {
      window.__AUDIO_DEBUG__ = false;

      instrumentNoteSchedule('piano', 0, 1.0, false);

      // Should not log anything when debug is disabled
      expect(logger.audio.log).not.toHaveBeenCalled();
      expect(logger.audio.error).not.toHaveBeenCalled();
    });
  });

  describe('capturePlaybackState', () => {
    it('should capture scheduler state', () => {
      const mockScheduler = {
        isPlaying: () => true,
        getCurrentStep: () => 5,
      };

      const state = capturePlaybackState(mockScheduler, 2, 123);

      expect(state.schedulerIsRunning).toBe(true);
      expect(state.schedulerCurrentStep).toBe(5);
      expect(state.schedulerTimerId).toBe(123);
      expect(state.pendingTimersCount).toBe(2);
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it('should handle null scheduler gracefully', () => {
      const state = capturePlaybackState(null, 0, null);

      expect(state.schedulerIsRunning).toBe(false);
      expect(state.schedulerCurrentStep).toBe(-1);
    });
  });

  describe('instrumentSchedulerStart', () => {
    it('should log start event when debug enabled', () => {
      window.__AUDIO_DEBUG__ = true;
      initPlaybackDebug();

      const mockScheduler = {
        isPlaying: () => false,
        getCurrentStep: () => 0,
      };

      instrumentSchedulerStart(mockScheduler, () => false, null);

      expect(logger.audio.log).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG TRACE'),
        expect.any(Object)
      );
    });
  });

  describe('instrumentSchedulerStop', () => {
    it('should log stop event when debug enabled', () => {
      window.__AUDIO_DEBUG__ = true;
      initPlaybackDebug();

      const mockScheduler = {
        isPlaying: () => true,
        getCurrentStep: () => 10,
      };

      instrumentSchedulerStop(mockScheduler, true, 123, 5);

      expect(logger.audio.log).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG TRACE'),
        expect.any(Object)
      );
    });
  });

  describe('trace management', () => {
    it('should track trace entries', () => {
      window.__AUDIO_DEBUG__ = true;
      initPlaybackDebug();

      const mockScheduler = {
        isPlaying: () => true,
        getCurrentStep: () => 0,
      };

      logStateSnapshot(mockScheduler, 0, 123);

      const trace = window.__getPlaybackTrace__();
      expect(trace.length).toBeGreaterThan(0);
      expect(trace[trace.length - 1].event).toBe('state.snapshot');
    });

    it('should clear trace', () => {
      window.__AUDIO_DEBUG__ = true;
      initPlaybackDebug();

      const mockScheduler = {
        isPlaying: () => true,
        getCurrentStep: () => 0,
      };

      logStateSnapshot(mockScheduler, 0, 123);
      expect(window.__getPlaybackTrace__().length).toBeGreaterThan(0);

      window.__clearPlaybackTrace__();
      expect(window.__getPlaybackTrace__().length).toBe(0);
    });
  });
});
