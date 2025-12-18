import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackBusManager } from './track-bus-manager';

/**
 * Phase 25: TrackBusManager Unit Tests
 *
 * Tests the manager that handles all TrackBus instances.
 * Verifies lazy creation, cleanup, and per-track controls.
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

describe('TrackBusManager', () => {
  let context: AudioContext;
  let masterGain: GainNode;

  beforeEach(() => {
    context = createMockAudioContext();
    masterGain = createMockGainNode() as unknown as GainNode;
  });

  describe('initialization', () => {
    it('should start with no buses', () => {
      const manager = new TrackBusManager(context, masterGain);
      expect(manager.getBusCount()).toBe(0);
      expect(manager.getActiveTrackIds()).toEqual([]);
    });
  });

  describe('getOrCreateBus', () => {
    it('should create a bus lazily when first requested', () => {
      const manager = new TrackBusManager(context, masterGain);

      const bus = manager.getOrCreateBus('track-1');
      expect(bus).toBeDefined();
      expect(manager.getBusCount()).toBe(1);
      expect(manager.getActiveTrackIds()).toContain('track-1');
    });

    it('should return same bus for same track ID', () => {
      const manager = new TrackBusManager(context, masterGain);

      const bus1 = manager.getOrCreateBus('track-1');
      const bus2 = manager.getOrCreateBus('track-1');

      expect(bus1).toBe(bus2);
      expect(manager.getBusCount()).toBe(1);
    });

    it('should create separate buses for different tracks', () => {
      const manager = new TrackBusManager(context, masterGain);

      const bus1 = manager.getOrCreateBus('track-1');
      const bus2 = manager.getOrCreateBus('track-2');

      expect(bus1).not.toBe(bus2);
      expect(manager.getBusCount()).toBe(2);
    });
  });

  describe('getBusInput', () => {
    it('should return the input node for a track', () => {
      const manager = new TrackBusManager(context, masterGain);

      const input = manager.getBusInput('track-1');
      expect(input).toBeDefined();
      expect(input).toHaveProperty('gain');
    });
  });

  describe('hasBus', () => {
    it('should return false for non-existent bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      expect(manager.hasBus('track-1')).toBe(false);
    });

    it('should return true for existing bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.getOrCreateBus('track-1');
      expect(manager.hasBus('track-1')).toBe(true);
    });
  });

  describe('volume control', () => {
    it('should set volume for existing bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.getOrCreateBus('track-1');

      manager.setTrackVolume('track-1', 0.5);
      expect(manager.getTrackVolume('track-1')).toBe(0.5);
    });

    it('should return default 1 for non-existent bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      expect(manager.getTrackVolume('track-1')).toBe(1);
    });

    it('should not throw when setting volume for non-existent bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      expect(() => manager.setTrackVolume('track-1', 0.5)).not.toThrow();
    });
  });

  describe('mute control', () => {
    it('should set muted state for existing bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.getOrCreateBus('track-1');

      manager.setTrackMuted('track-1', true);
      expect(manager.isTrackMuted('track-1')).toBe(true);

      manager.setTrackMuted('track-1', false);
      expect(manager.isTrackMuted('track-1')).toBe(false);
    });

    it('should return false for non-existent bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      expect(manager.isTrackMuted('track-1')).toBe(false);
    });
  });

  describe('pan control', () => {
    it('should set pan for existing bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.getOrCreateBus('track-1');

      manager.setTrackPan('track-1', -0.5);
      expect(manager.getTrackPan('track-1')).toBe(-0.5);
    });

    it('should return 0 for non-existent bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      expect(manager.getTrackPan('track-1')).toBe(0);
    });
  });

  describe('removeBus', () => {
    it('should remove an existing bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.getOrCreateBus('track-1');
      expect(manager.getBusCount()).toBe(1);

      manager.removeBus('track-1');
      expect(manager.getBusCount()).toBe(0);
      expect(manager.hasBus('track-1')).toBe(false);
    });

    it('should not throw when removing non-existent bus', () => {
      const manager = new TrackBusManager(context, masterGain);
      expect(() => manager.removeBus('track-1')).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should dispose all buses', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.getOrCreateBus('track-1');
      manager.getOrCreateBus('track-2');
      expect(manager.getBusCount()).toBe(2);

      manager.dispose();
      expect(manager.isDisposed()).toBe(true);
      expect(manager.getActiveTrackIds()).toEqual([]);
    });

    it('should throw when accessing after dispose', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.dispose();

      expect(() => manager.getOrCreateBus('track-1')).toThrow('disposed');
    });

    it('should be idempotent', () => {
      const manager = new TrackBusManager(context, masterGain);
      manager.dispose();
      manager.dispose(); // Should not throw
      expect(manager.isDisposed()).toBe(true);
    });
  });
});
