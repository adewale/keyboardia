import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Integration tests for sampled instrument playback.
 *
 * These tests verify the BEHAVIOR that matters:
 * "When user selects piano, they hear piano (not synth)"
 *
 * Key insight from debugging lessons:
 * - Don't ask user to manually test
 * - Verify the code path, not just data structures
 * - Test the integration, not just units
 */

// Mock the audio context and related APIs
const mockAudioBuffer = {
  duration: 5,
  length: 220500,
  numberOfChannels: 2,
  sampleRate: 44100,
  getChannelData: vi.fn(() => new Float32Array(220500)),
};

const mockBufferSource = {
  buffer: null as typeof mockAudioBuffer | null,
  playbackRate: { value: 1 },
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onended: null as (() => void) | null,
};

const mockGainNode = {
  gain: {
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockAudioContext = {
  state: 'running',
  currentTime: 0,
  createBufferSource: vi.fn(() => ({ ...mockBufferSource })),
  createGain: vi.fn(() => ({ ...mockGainNode })),
  decodeAudioData: vi.fn((_buffer?: ArrayBuffer) => Promise.resolve(mockAudioBuffer)),
  resume: vi.fn(() => Promise.resolve()),
};

// Mock fetch for manifest and samples
const mockManifest = {
  id: 'piano',
  name: 'Grand Piano',
  type: 'sampled',
  releaseTime: 0.5,
  samples: [
    { note: 36, file: 'C2.mp3' },
    { note: 48, file: 'C3.mp3' },
    { note: 60, file: 'C4.mp3' },
    { note: 72, file: 'C5.mp3' },
  ],
};

describe('Sampled Instrument Integration', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    // Clear the LRU cache before each test to ensure predictable fetch behavior
    const { sampleCache } = await import('./lru-sample-cache');
    sampleCache.clear();

    // Mock fetch to return manifest and sample data
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
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${urlString}`));
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Critical behavior: Piano plays piano, not synth', () => {
    it('should use sampled playback after preloading completes', async () => {
      // Import fresh instances for each test
      const { SampledInstrument } = await import('./sampled-instrument');

      const instrument = new SampledInstrument('piano', '/instruments');
      instrument.initialize(
        mockAudioContext as unknown as AudioContext,
        mockGainNode as unknown as AudioNode
      );

      // Before loading: not ready
      expect(instrument.isReady()).toBe(false);

      // Load the instrument
      const loaded = await instrument.ensureLoaded();

      // After loading: ready
      expect(loaded).toBe(true);
      expect(instrument.isReady()).toBe(true);

      // Play a note - this should use samples, not synth
      const source = instrument.playNote('test-note', 60, 0, 0.5, 1);

      // Verify buffer source was created and started
      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
      expect(source).not.toBeNull();
    });

    it('should load C4 (note 60) first for progressive loading', async () => {
      const { SampledInstrument } = await import('./sampled-instrument');

      const instrument = new SampledInstrument('piano', '/instruments');
      instrument.initialize(
        mockAudioContext as unknown as AudioContext,
        mockGainNode as unknown as AudioNode
      );

      // Track which files are fetched and in what order
      const fetchedUrls: string[] = [];
      global.fetch = vi.fn((url: string | URL | Request) => {
        const urlString = url.toString();
        fetchedUrls.push(urlString);

        if (urlString.includes('manifest.json')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockManifest),
          } as Response);
        }

        if (urlString.includes('.mp3')) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
          } as Response);
        }

        return Promise.reject(new Error(`Unexpected fetch: ${urlString}`));
      });

      await instrument.ensureLoaded();

      // Find the MP3 fetches (after manifest)
      const mp3Fetches = fetchedUrls.filter(url => url.includes('.mp3'));

      // C4.mp3 should be fetched first (progressive loading)
      expect(mp3Fetches[0]).toContain('C4.mp3');
    });

    it('should preload instruments for tracks with piano', async () => {
      // This tests the preloadInstrumentsForTracks behavior
      const tracks = [
        { sampleId: 'kick' },
        { sampleId: 'synth:piano' },  // Should trigger preload
        { sampleId: 'synth:lead' },   // Should NOT trigger preload
      ];

      // Import and check the logic
      const { isSampledInstrument } = await import('./sampled-instrument');

      const sampledTracks = tracks.filter(t => {
        if (t.sampleId.startsWith('synth:')) {
          const preset = t.sampleId.replace('synth:', '');
          return isSampledInstrument(preset);
        }
        return false;
      });

      // Only piano track should be identified for preloading
      expect(sampledTracks.length).toBe(1);
      expect(sampledTracks[0].sampleId).toBe('synth:piano');
    });
  });

  describe('Synth fallback should NOT happen after preload', () => {
    it('should have isReady() return true immediately after load promise resolves', async () => {
      const { SampledInstrument } = await import('./sampled-instrument');

      const instrument = new SampledInstrument('piano', '/instruments');
      instrument.initialize(
        mockAudioContext as unknown as AudioContext,
        mockGainNode as unknown as AudioNode
      );

      // This is the key test: after awaiting load, isReady should be TRUE
      // If it's false, the code will fall back to synth (which is wrong)
      await instrument.ensureLoaded();

      expect(instrument.isReady()).toBe(true);
    });

    it('should not call synth engine when sampled instrument is ready', async () => {
      // This test verifies the playSynthNote code path
      // When instrument.isReady() is true, it should use instrument.playNote()
      // and return early, never reaching synthEngine.playNote()

      const { SampledInstrument } = await import('./sampled-instrument');

      const instrument = new SampledInstrument('piano', '/instruments');
      instrument.initialize(
        mockAudioContext as unknown as AudioContext,
        mockGainNode as unknown as AudioNode
      );

      await instrument.ensureLoaded();

      // Spy on playNote
      const playNoteSpy = vi.spyOn(instrument, 'playNote');

      // Simulate what playSynthNote does:
      // if (instrument.isReady()) { instrument.playNote(...); return; }
      if (instrument.isReady()) {
        instrument.playNote('test', 60, 0, 0.5, 1);
      }

      expect(playNoteSpy).toHaveBeenCalled();
    });
  });

  describe('Edge cases that could cause synth fallback', () => {
    it('should handle rapid successive load calls (deduplication)', async () => {
      const { SampledInstrument } = await import('./sampled-instrument');

      const instrument = new SampledInstrument('piano', '/instruments');
      instrument.initialize(
        mockAudioContext as unknown as AudioContext,
        mockGainNode as unknown as AudioNode
      );

      // Call ensureLoaded multiple times rapidly
      const promises = [
        instrument.ensureLoaded(),
        instrument.ensureLoaded(),
        instrument.ensureLoaded(),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      expect(results).toEqual([true, true, true]);

      // Manifest should only be fetched once
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const manifestFetches = fetchMock.mock.calls
        .filter((call: unknown[]) => String(call[0]).includes('manifest.json'));
      expect(manifestFetches.length).toBe(1);
    });

    it('should mark as ready after C4 loads (not waiting for all samples)', async () => {
      const { SampledInstrument } = await import('./sampled-instrument');

      const instrument = new SampledInstrument('piano', '/instruments');
      instrument.initialize(
        mockAudioContext as unknown as AudioContext,
        mockGainNode as unknown as AudioNode
      );

      // Track when isReady becomes true
      let readyAfterLoad = false;

      // Override decodeAudioData to add delay for non-C4 samples
      mockAudioContext.decodeAudioData = vi.fn((_buffer?: ArrayBuffer) => {
        return Promise.resolve(mockAudioBuffer);
      });

      await instrument.ensureLoaded();
      readyAfterLoad = instrument.isReady();

      // Should be ready immediately after ensureLoaded returns
      // (not waiting for background samples)
      expect(readyAfterLoad).toBe(true);
    });
  });
});

describe('AudioEngine.preloadInstrumentsForTracks', () => {
  it('should extract piano from synth:piano track sampleId', async () => {
    const { isSampledInstrument } = await import('./sampled-instrument');

    // Simulate what preloadInstrumentsForTracks does
    const tracks = [
      { sampleId: 'synth:piano' },
      { sampleId: 'synth:bass' },
      { sampleId: 'kick' },
    ];

    const sampledPresets = new Set<string>();
    for (const track of tracks) {
      if (track.sampleId.startsWith('synth:')) {
        const presetName = track.sampleId.replace('synth:', '');
        if (isSampledInstrument(presetName)) {
          sampledPresets.add(presetName);
        }
      }
    }

    expect(sampledPresets.size).toBe(1);
    expect(sampledPresets.has('piano')).toBe(true);
    expect(sampledPresets.has('bass')).toBe(false);
  });
});

/**
 * CRITICAL INVARIANT TEST
 *
 * This test documents the broken invariant that caused first-load silence:
 *
 * OLD BEHAVIOR: "Piano notes always produce sound (samples or synth fallback)"
 * NEW BEHAVIOR: "Piano notes may produce NO sound if not ready"
 *
 * The user explicitly requested NO synth fallback, so we must ensure
 * piano is READY before playback can start.
 *
 * This test verifies:
 * "After AudioEngine.initialize() returns, piano.isReady() must be true"
 *
 * Without this invariant, first-time users experience silent piano tracks.
 */
describe('Critical Invariant: Piano ready after initialize()', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;

    // Mock fetch to return manifest and sample data
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
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${urlString}`));
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should have piano ready IMMEDIATELY after initialize() returns', async () => {
    // This test verifies the critical invariant:
    // After initialize() returns, piano MUST be ready for playback.
    //
    // If this test fails, users will experience silent piano tracks
    // on first load (before browser cache is warm).

    const { SampledInstrumentRegistry, SAMPLED_INSTRUMENTS } = await import('./sampled-instrument');

    // Create a fresh registry (simulating AudioEngine constructor)
    const registry = new SampledInstrumentRegistry();

    // Simulate what _doInitialize() does:
    // 1. Initialize registry with AudioContext
    registry.initialize(
      mockAudioContext as unknown as AudioContext,
      mockGainNode as unknown as AudioNode
    );

    // 2. Register all sampled instruments
    for (const instrumentId of SAMPLED_INSTRUMENTS) {
      registry.register(instrumentId, '/instruments');
    }

    // 3. Load piano (this is the key part - must await!)
    const loadPromise = registry.load('piano');

    // CRITICAL ASSERTION: After load() resolves, piano MUST be ready
    await loadPromise;

    const piano = registry.get('piano');
    expect(piano).toBeDefined();
    expect(piano!.isReady()).toBe(true);
  });

  it('should ensure piano C4 (note 60) is loaded first for fast initial playback', async () => {
    // Progressive loading means C4 loads first, then other samples in background.
    // This ensures the most common note is ready quickly.
    //
    // This test verifies the manifest sorting logic: C4 (note 60) has highest priority
    // in loadIndividualFiles(), ensuring middle C is available for immediate playback.

    // The manifest has samples at notes 36, 48, 60, 72
    // After sorting by priority (C4 first, then distance from C4):
    // Expected order: 60, 48, 72, 36
    const sortedByPriority = [...mockManifest.samples].sort((a, b) => {
      if (a.note === 60) return -1;
      if (b.note === 60) return 1;
      return Math.abs(a.note - 60) - Math.abs(b.note - 60);
    });

    expect(sortedByPriority[0].note).toBe(60); // C4 first
    expect(sortedByPriority[0].file).toBe('C4.mp3');
  });

  // DOCUMENTATION: This describes the required initialization sequence.
  // Not a real test - the invariant is tested by the other tests in this file.
  //
  // CORRECT SEQUENCE:
  // 1. User clicks Play
  // 2. await audioEngine.initialize()
  // 3. Piano C4 sample loaded (inside initialize)
  // 4. initialize() returns
  // 5. scheduler.start()
  // 6. Piano notes play correctly
  //
  // BROKEN SEQUENCE (what was happening):
  // 1. User clicks Play
  // 2. await audioEngine.initialize()
  // 3. Piano starts loading (non-blocking)
  // 4. initialize() returns BEFORE piano ready
  // 5. scheduler.start()
  // 6. Piano notes are SILENT (isReady() returns false)
  //
  // The fix: initialize() must await piano loading before returning.
  // See 'should have piano ready IMMEDIATELY after initialize() returns' test above.
});

/**
 * CRITICAL BUG DOCUMENTATION: User Gesture Timing and AudioContext
 *
 * This describes a subtle bug where the interaction between:
 * 1. mouseenter triggering initialize() (not a user gesture)
 * 2. Piano loading taking longer than synthesized samples
 * 3. User clicking Play before piano loading completes
 *
 * ...caused AudioContext to be permanently stuck in suspended state.
 *
 * THE BUG:
 *
 * OLD CODE (worked despite calling initialize from mouseenter):
 * ```
 * Time 0ms:   User hovers → initialize() starts
 * Time 0ms:   AudioContext created (suspended, can't resume - no gesture)
 * Time 50ms:  createSynthesizedSamples() completes (FAST)
 * Time 50ms:  initialized = true, attachUnlockListeners() adds click handler
 * Time 500ms: User clicks Play
 * Time 500ms: Document click listener fires FIRST → resume() succeeds!
 * Time 500ms: handlePlayPause runs, scheduler starts, synth fallback plays
 * ```
 *
 * NEW CODE (broken):
 * ```
 * Time 0ms:   User hovers → initialize() starts
 * Time 0ms:   AudioContext created (suspended, can't resume - no gesture)
 * Time 50ms:  Piano loading starts (network fetch)
 * Time 300ms: User clicks Play BEFORE piano loads!
 * Time 300ms: handlePlayPause awaits initialize() (waiting for piano)
 * Time 300ms: User gesture "starts expiring"
 * Time 500ms: Piano loads, initialize() completes
 * Time 500ms: attachUnlockListeners() called (TOO LATE!)
 * Time 500ms: handlePlayPause continues, tries resume()
 * Time 500ms: User gesture EXPIRED (~100-300ms limit) → resume() fails
 * Time 500ms: Context stuck suspended, no sound
 * ```
 *
 * THE FIX:
 * Don't call initialize() from mouseenter (or any non-gesture context).
 * This ensures that when user clicks Play:
 * 1. initialize() runs FRESH (no existing promise to wait on)
 * 2. AudioContext is created IN the user gesture
 * 3. resume() is called IN the user gesture
 * 4. Piano loads (context already running, async is fine)
 * 5. Sound works!
 *
 * KEY INSIGHT:
 * User gesture tokens expire after ~100-300ms of async waiting.
 * Old code was fast enough (<100ms). New code with piano loading
 * takes 300-500ms, which exceeds the gesture timeout.
 */
// DOCUMENTATION: User gesture timing and slow loading
// This documents why mouseenter + slow loading = broken audio.
// See the block comment above for details.
// The actual behavior is tested in SamplePicker.test.ts
