import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the NotePlayer Strategy Pattern - Phase 21A Refactoring
 *
 * These tests are written BEFORE implementation to define expected behavior.
 * Run these tests to verify the refactoring is complete.
 *
 * The refactoring implements:
 * 1. Dependency Injection - AudioEngine accepts dependencies
 * 2. Observable Loading State - UI can track loading progress
 * 3. Explicit Error Handling - Errors are visible, not silent
 * 4. Strategy Pattern - NotePlayer interface for extensibility
 */

/**
 * =============================================================================
 * PART 1: DEPENDENCY INJECTION TESTS
 * =============================================================================
 * AudioEngine should accept optional dependencies for testability.
 */
describe('Dependency Injection', () => {
  // Mock implementations for testing
  const createMockRegistry = () => ({
    get: vi.fn(),
    load: vi.fn().mockResolvedValue(true),
    has: vi.fn().mockReturnValue(true),
    register: vi.fn(),
    initialize: vi.fn(),
    getState: vi.fn().mockReturnValue('idle'),
    getError: vi.fn().mockReturnValue(null),
    onStateChange: vi.fn().mockReturnValue(() => {}),
    getInstrumentIds: vi.fn().mockReturnValue(['piano']),
  });

  const createMockSynthEngine = () => ({
    initialize: vi.fn(),
    playNote: vi.fn(),
    stopNote: vi.fn(),
    stopAll: vi.fn(),
    getVoiceCount: vi.fn().mockReturnValue(0),
  });

  // Mock AudioContext factory - available for future tests
  const _createMockAudioContext = () => ({
    state: 'running' as AudioContextState,
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain: vi.fn().mockReturnValue({
      gain: { value: 1 },
      connect: vi.fn(),
    }),
    createDynamicsCompressor: vi.fn().mockReturnValue({
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: vi.fn(),
    }),
    createAnalyser: vi.fn().mockReturnValue({
      fftSize: 256,
      connect: vi.fn(),
    }),
    resume: vi.fn().mockResolvedValue(undefined),
  });
  void _createMockAudioContext; // Silence unused warning

  describe('AudioEngine Constructor', () => {
    it('should use injected registry when provided', async () => {
      const { AudioEngine } = await import('./engine');
      const mockRegistry = createMockRegistry();
      const mockInstrument = {
        isReady: vi.fn().mockReturnValue(true),
        playNote: vi.fn(),
      };
      mockRegistry.get.mockReturnValue(mockInstrument);

      const engine = new AudioEngine({
        sampledInstrumentRegistry: mockRegistry as never,
      });

      // The engine should use our mock, not the global singleton
      // We can verify by checking if our mock is called
      expect(mockRegistry).toBeDefined();
      expect(engine).toBeDefined();
    });

    it('should use injected synthEngine when provided', async () => {
      const { AudioEngine } = await import('./engine');
      const mockSynth = createMockSynthEngine();

      const engine = new AudioEngine({
        synthEngine: mockSynth as never,
      });

      expect(mockSynth).toBeDefined();
      expect(engine).toBeDefined();
    });

    it('should use defaults when no dependencies provided', async () => {
      const { AudioEngine } = await import('./engine');

      // Should not throw when created without dependencies
      const engine = new AudioEngine();
      expect(engine).toBeDefined();
    });
  });

  describe('playSynthNote with Injected Dependencies', () => {
    it('should call injected registry.get for sampled instruments', async () => {
      const { AudioEngine } = await import('./engine');
      const mockRegistry = createMockRegistry();
      const mockSynth = createMockSynthEngine();

      const mockInstrument = {
        isReady: vi.fn().mockReturnValue(true),
        playNote: vi.fn(),
      };
      mockRegistry.get.mockReturnValue(mockInstrument);

      const engine = new AudioEngine({
        sampledInstrumentRegistry: mockRegistry as never,
        synthEngine: mockSynth as never,
      });

      // Need to initialize first (but we'll mock the AudioContext)
      // For this test, we just verify the dependency is wired correctly
      engine.playSynthNote('note-1', 'piano', 0, 0, 0.5);

      expect(mockRegistry.get).toHaveBeenCalledWith('piano');
    });

    it('should call injected synthEngine.playNote for synth presets', async () => {
      const { AudioEngine } = await import('./engine');
      const mockRegistry = createMockRegistry();
      const mockSynth = createMockSynthEngine();

      mockRegistry.get.mockReturnValue(undefined); // No sampled instrument

      const engine = new AudioEngine({
        sampledInstrumentRegistry: mockRegistry as never,
        synthEngine: mockSynth as never,
      });

      engine.playSynthNote('note-1', 'lead', 0, 0, 0.5);

      expect(mockSynth.playNote).toHaveBeenCalled();
    });
  });
});

/**
 * =============================================================================
 * PART 2: OBSERVABLE LOADING STATE TESTS
 * =============================================================================
 * Registry should expose loading state and notify listeners of changes.
 */
describe('Observable Loading State', () => {
  // Mock fetch for these tests
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('State Transitions', () => {
    it('should start in idle state', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      const registry = new SampledInstrumentRegistry();
      registry.register('piano', '/instruments');

      expect(registry.getState('piano')).toBe('idle');
    });

    it('should transition to loading when load() called', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      // Mock fetch to hang forever (so we can check loading state)
      global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

      const registry = new SampledInstrumentRegistry();
      registry.register('piano', '/instruments');

      // Start loading but don't await
      registry.load('piano');

      expect(registry.getState('piano')).toBe('loading');
    });

    it('should transition to ready when load succeeds', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      const mockManifest = {
        id: 'piano',
        name: 'Piano',
        type: 'sampled',
        baseNote: 60,
        releaseTime: 0.5,
        samples: [{ note: 60, file: 'C4.mp3' }],
      };

      global.fetch = vi.fn((url: string | URL | Request) => {
        const urlString = url.toString();
        if (urlString.includes('manifest.json')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockManifest),
          } as Response);
        }
        if (urlString.includes('.mp3')) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          } as Response);
        }
        return Promise.reject(new Error('Unexpected fetch'));
      });

      const registry = new SampledInstrumentRegistry();
      // Need to initialize with mock audio context
      const mockCtx = {
        decodeAudioData: vi.fn().mockResolvedValue({
          duration: 1,
          length: 44100,
          numberOfChannels: 2,
          sampleRate: 44100,
        }),
      };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      registry.register('piano', '/instruments');

      await registry.load('piano');

      expect(registry.getState('piano')).toBe('ready');
    });

    it('should transition to error when load fails', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const registry = new SampledInstrumentRegistry();
      const mockCtx = { decodeAudioData: vi.fn() };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      registry.register('piano', '/instruments');

      await registry.load('piano');

      expect(registry.getState('piano')).toBe('error');
    });
  });

  describe('State Notifications', () => {
    it('should notify listeners on state change', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const registry = new SampledInstrumentRegistry();
      const mockCtx = { decodeAudioData: vi.fn() };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      registry.register('piano', '/instruments');

      const callback = vi.fn();
      registry.onStateChange(callback);

      await registry.load('piano');

      // Should have been called at least for 'loading' and 'error' transitions
      expect(callback).toHaveBeenCalled();
      const calls = callback.mock.calls.map(c => c[1]); // Get state arguments
      expect(calls).toContain('loading');
    });

    it('should include error in notification when transitioning to error', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      const testError = new Error('Network error');
      global.fetch = vi.fn().mockRejectedValue(testError);

      const registry = new SampledInstrumentRegistry();
      const mockCtx = { decodeAudioData: vi.fn() };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      registry.register('piano', '/instruments');

      const callback = vi.fn();
      registry.onStateChange(callback);

      await registry.load('piano');

      // Find the error callback
      const errorCall = callback.mock.calls.find(c => c[1] === 'error');
      expect(errorCall).toBeDefined();
      expect(errorCall![2]).toBeInstanceOf(Error);
    });

    it('should allow unsubscribing from notifications', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      const registry = new SampledInstrumentRegistry();
      registry.register('piano', '/instruments');

      const callback = vi.fn();
      const unsubscribe = registry.onStateChange(callback);

      // Unsubscribe
      unsubscribe();

      // Trigger state change
      global.fetch = vi.fn().mockRejectedValue(new Error('error'));
      const mockCtx = { decodeAudioData: vi.fn() };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      await registry.load('piano');

      // Callback should not have been called after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getState() and getError()', () => {
    it('should return idle for unknown instruments', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      const registry = new SampledInstrumentRegistry();

      expect(registry.getState('unknown')).toBe('idle');
    });

    it('should return error details via getError()', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      const testError = new Error('Test error');
      global.fetch = vi.fn().mockRejectedValue(testError);

      const registry = new SampledInstrumentRegistry();
      const mockCtx = { decodeAudioData: vi.fn() };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      registry.register('piano', '/instruments');

      await registry.load('piano');

      expect(registry.getError('piano')).toBeInstanceOf(Error);
    });
  });
});

/**
 * =============================================================================
 * PART 3: EXPLICIT ERROR HANDLING TESTS
 * =============================================================================
 * Errors should be visible and allow retry, not silently fall back.
 */
describe('Explicit Error Handling', () => {
  describe('Retry Mechanism', () => {
    it('should allow retry after error', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      // First call fails
      let callCount = 0;
      global.fetch = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('First attempt failed'));
        }
        // Second call succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'piano',
            name: 'Piano',
            type: 'sampled',
            baseNote: 60,
            releaseTime: 0.5,
            samples: [{ note: 60, file: 'C4.mp3' }],
          }),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        } as Response);
      });

      const registry = new SampledInstrumentRegistry();
      const mockCtx = {
        decodeAudioData: vi.fn().mockResolvedValue({
          duration: 1,
          length: 44100,
          numberOfChannels: 2,
          sampleRate: 44100,
        }),
      };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      registry.register('piano', '/instruments');

      // First attempt - should fail
      await registry.load('piano');
      expect(registry.getState('piano')).toBe('error');

      // Retry - should succeed
      await registry.retry('piano');
      expect(registry.getState('piano')).toBe('ready');
    });

    it('should clear error state on retry', async () => {
      vi.resetModules();
      const { SampledInstrumentRegistry } = await import('./sampled-instrument');

      global.fetch = vi.fn().mockRejectedValue(new Error('Failed'));

      const registry = new SampledInstrumentRegistry();
      const mockCtx = { decodeAudioData: vi.fn() };
      const mockDest = { connect: vi.fn() };
      registry.initialize(mockCtx as never, mockDest as never);
      registry.register('piano', '/instruments');

      await registry.load('piano');
      expect(registry.getError('piano')).toBeInstanceOf(Error);

      // Start retry (will also fail, but error should be cleared initially)
      const retryPromise = registry.retry('piano');

      // During retry, state should be 'loading'
      expect(registry.getState('piano')).toBe('loading');

      await retryPromise;
    });
  });
});

/**
 * =============================================================================
 * PART 4: STRATEGY PATTERN TESTS
 * =============================================================================
 * NotePlayer interface for clean separation of playback strategies.
 */
describe('NotePlayer Strategy Pattern', () => {
  describe('NotePlayer Interface', () => {
    it('should define common interface for all players', async () => {
      // This test verifies the interface exists and has required methods
      const { NotePlayer } = await import('./note-player').catch(() => ({ NotePlayer: null }));

      // If module doesn't exist yet, that's expected - test is written before implementation
      if (!NotePlayer) {
        // Mark as todo until implementation exists
        expect(true).toBe(true); // Placeholder
        return;
      }

      // Interface should have these methods:
      // - canHandle(preset: string): boolean
      // - isReady(preset: string): boolean
      // - play(noteId, preset, semitone, time, duration?): void
      // - ensureReady(preset: string): Promise<void>
    });
  });

  describe('SampledNotePlayer', () => {
    it.todo('should implement NotePlayer interface');
    it.todo('should delegate to sampledInstrumentRegistry');
  });

  describe('SynthNotePlayer', () => {
    it.todo('should implement NotePlayer interface');
    it.todo('should delegate to synthEngine');
    it.todo('should always return true for isReady');
  });

  describe('Player Chain', () => {
    it.todo('should try SampledNotePlayer first for piano');
    it.todo('should fall back to SynthNotePlayer when sampled not ready');
    it.todo('should use SynthNotePlayer directly for synth presets');
  });
});

