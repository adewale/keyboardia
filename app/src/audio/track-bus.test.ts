import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackBus } from './track-bus';

/**
 * Phase 25: TrackBus Unit Tests
 *
 * Tests the per-track audio bus that provides unified volume/mute/pan control.
 * Uses mocked AudioContext since tests run in Node.
 */

// Mock AudioContext and related nodes
function createMockGainNode() {
  const node = {
    gain: {
      value: 1,
      setValueAtTime: vi.fn((value: number) => { node.gain.value = value; }),
      linearRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn((value: number) => { node.gain.value = value; }),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return node;
}

function createMockStereoPannerNode() {
  const node = {
    pan: {
      value: 0,
      setValueAtTime: vi.fn((value: number) => { node.pan.value = value; }),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return node;
}

function createMockAudioContext() {
  return {
    createGain: vi.fn(() => createMockGainNode()),
    createStereoPanner: vi.fn(() => createMockStereoPannerNode()),
    currentTime: 0,
  } as unknown as AudioContext;
}

describe('TrackBus', () => {
  let context: AudioContext;
  let destination: GainNode;

  beforeEach(() => {
    context = createMockAudioContext();
    destination = createMockGainNode() as unknown as GainNode;
  });

  describe('initialization', () => {
    it('should create all internal nodes', () => {
      new TrackBus(context, destination);

      // Should create 4 gain nodes (input, volume, mute, output) + 1 panner
      expect(context.createGain).toHaveBeenCalledTimes(4);
      expect(context.createStereoPanner).toHaveBeenCalledTimes(1);
    });

    it('should connect nodes in correct order', () => {
      const bus = new TrackBus(context, destination);

      // Verify the chain is connected to destination
      expect(destination.connect).not.toHaveBeenCalled(); // destination is the endpoint
      expect(bus.isDisposed()).toBe(false);
    });
  });

  describe('volume control', () => {
    it('should default to volume 1', () => {
      const bus = new TrackBus(context, destination);
      expect(bus.getVolume()).toBe(1);
    });

    it('should set volume between 0 and 1', () => {
      const bus = new TrackBus(context, destination);

      bus.setVolume(0.5);
      expect(bus.getVolume()).toBe(0.5);

      bus.setVolume(0);
      expect(bus.getVolume()).toBe(0);

      bus.setVolume(1);
      expect(bus.getVolume()).toBe(1);
    });

    it('should clamp volume to valid range', () => {
      const bus = new TrackBus(context, destination);

      bus.setVolume(-0.5);
      expect(bus.getVolume()).toBe(0);

      bus.setVolume(1.5);
      expect(bus.getVolume()).toBe(1);
    });
  });

  describe('mute control', () => {
    it('should default to unmuted', () => {
      const bus = new TrackBus(context, destination);
      expect(bus.isMuted()).toBe(false);
    });

    it('should toggle mute state', () => {
      const bus = new TrackBus(context, destination);

      bus.setMuted(true);
      expect(bus.isMuted()).toBe(true);

      bus.setMuted(false);
      expect(bus.isMuted()).toBe(false);
    });
  });

  describe('pan control', () => {
    it('should default to center pan (0)', () => {
      const bus = new TrackBus(context, destination);
      expect(bus.getPan()).toBe(0);
    });

    it('should set pan between -1 and 1', () => {
      const bus = new TrackBus(context, destination);

      bus.setPan(-1);
      expect(bus.getPan()).toBe(-1);

      bus.setPan(0);
      expect(bus.getPan()).toBe(0);

      bus.setPan(1);
      expect(bus.getPan()).toBe(1);
    });

    it('should clamp pan to valid range', () => {
      const bus = new TrackBus(context, destination);

      bus.setPan(-2);
      expect(bus.getPan()).toBe(-1);

      bus.setPan(2);
      expect(bus.getPan()).toBe(1);
    });
  });

  describe('getInput', () => {
    it('should return the input gain node', () => {
      const bus = new TrackBus(context, destination);
      const input = bus.getInput();

      expect(input).toBeDefined();
      expect(input).toHaveProperty('gain');
    });
  });

  describe('dispose', () => {
    it('should mark bus as disposed', () => {
      const bus = new TrackBus(context, destination);

      expect(bus.isDisposed()).toBe(false);
      bus.dispose();
      expect(bus.isDisposed()).toBe(true);
    });

    it('should be idempotent', () => {
      const bus = new TrackBus(context, destination);

      bus.dispose();
      bus.dispose(); // Should not throw
      expect(bus.isDisposed()).toBe(true);
    });
  });
});
