/**
 * Tests for lazy audio loading
 *
 * These tests verify the lazy loading behavior of the audio engine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureAudioLoaded,
  getAudioEngine,
  isAudioLoaded,
  isLazyAudioEnabled,
  _resetForTesting,
} from './lazyAudioLoader';

describe('lazyAudioLoader', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('isLazyAudioEnabled', () => {
    it('returns a boolean', () => {
      expect(typeof isLazyAudioEnabled()).toBe('boolean');
    });
  });

  describe('when lazy loading is disabled (default)', () => {
    // In test environment, VITE_LAZY_AUDIO is not set, so lazy loading is disabled

    it('isAudioLoaded returns true immediately', () => {
      // In eager mode, audio is always considered "loaded"
      expect(isAudioLoaded()).toBe(true);
    });

    it('getAudioEngine returns the engine', async () => {
      const engine = await getAudioEngine();
      expect(engine).toBeDefined();
      expect(typeof engine.isInitialized).toBe('function');
    });

    it('ensureAudioLoaded does nothing in eager mode', () => {
      // Should not throw
      expect(() => ensureAudioLoaded()).not.toThrow();
    });
  });

  describe('_resetForTesting', () => {
    it('resets internal state', () => {
      // Call reset
      _resetForTesting();

      // Should not throw on subsequent calls
      expect(() => _resetForTesting()).not.toThrow();
    });
  });

  describe('getAudioEngine', () => {
    it('returns consistent engine instance', async () => {
      const engine1 = await getAudioEngine();
      const engine2 = await getAudioEngine();

      // Both should be the same singleton instance
      expect(engine1).toBe(engine2);
    });

    it('engine has expected methods', async () => {
      const engine = await getAudioEngine();

      expect(typeof engine.isInitialized).toBe('function');
      expect(typeof engine.initialize).toBe('function');
      expect(typeof engine.getCurrentTime).toBe('function');
    });
  });

  describe('ensureAudioLoaded', () => {
    it('can be called multiple times without error', () => {
      ensureAudioLoaded();
      ensureAudioLoaded();
      ensureAudioLoaded();

      // Should not throw
      expect(true).toBe(true);
    });

    it('is idempotent', async () => {
      // Call multiple times
      ensureAudioLoaded();
      ensureAudioLoaded();

      // Getting the engine should still work
      const engine = await getAudioEngine();
      expect(engine).toBeDefined();
    });
  });
});

// Note: Full audio engine integration tests are in engine.test.ts
// These tests focus on the lazy loading mechanism itself
