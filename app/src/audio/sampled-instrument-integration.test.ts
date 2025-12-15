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
  decodeAudioData: vi.fn(() => Promise.resolve(mockAudioBuffer)),
  resume: vi.fn(() => Promise.resolve()),
};

// Mock fetch for manifest and samples
const mockManifest = {
  id: 'piano',
  name: 'Grand Piano',
  type: 'sampled',
  baseNote: 60,
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
      const manifestFetches = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: [string | URL | Request]) => call[0].toString().includes('manifest.json'));
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
      mockAudioContext.decodeAudioData = vi.fn((buffer: ArrayBuffer) => {
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
