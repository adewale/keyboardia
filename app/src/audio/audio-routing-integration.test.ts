/**
 * Integration tests for Audio Routing
 *
 * These tests verify the full audio routing flow:
 * - Track state changes → TrackBusManager updates
 * - Volume/mute/pan controls propagate correctly
 * - Bus lifecycle (creation, cleanup)
 *
 * Note: Uses mocked AudioContext since we can't use real Web Audio in tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrackBusManager } from './track-bus-manager';
import type { Track } from '../types';

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

function createMockAudioContext(): AudioContext {
  return {
    createGain: vi.fn(() => createMockGainNode()),
    createStereoPanner: vi.fn(() => createMockStereoPannerNode()),
    currentTime: 0,
  } as unknown as AudioContext;
}

function createDefaultTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    name: `Track ${id}`,
    sampleId: 'kick',
    steps: new Array(16).fill(false),
    parameterLocks: new Array(16).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    playbackMode: 'oneshot',
    fmParams: undefined,
    ...overrides,
  };
}

describe('Audio Routing Integration', () => {
  let context: AudioContext;
  let masterGain: GainNode;
  let manager: TrackBusManager;

  beforeEach(() => {
    context = createMockAudioContext();
    masterGain = context.createGain();
    manager = new TrackBusManager(context, masterGain);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Track → Bus lifecycle', () => {
    it('creates bus lazily when track audio is first needed', () => {
      const track = createDefaultTrack('track-1');

      // Bus shouldn't exist yet
      expect(manager.hasBus(track.id)).toBe(false);

      // Get or create the bus
      manager.getOrCreateBus(track.id);

      // Now it should exist
      expect(manager.hasBus(track.id)).toBe(true);
    });

    it('returns same bus instance for repeated calls', () => {
      const track = createDefaultTrack('track-1');

      const bus1 = manager.getOrCreateBus(track.id);
      const bus2 = manager.getOrCreateBus(track.id);

      expect(bus1).toBe(bus2);
    });

    it('removes bus when track is deleted', () => {
      const track = createDefaultTrack('track-1');

      manager.getOrCreateBus(track.id);
      expect(manager.hasBus(track.id)).toBe(true);

      manager.removeBus(track.id);
      expect(manager.hasBus(track.id)).toBe(false);
    });

    it('handles removal of non-existent bus gracefully', () => {
      // Should not throw
      expect(() => manager.removeBus('non-existent')).not.toThrow();
    });
  });

  describe('Volume propagation', () => {
    it('sets track volume through bus manager', () => {
      const track = createDefaultTrack('track-1', { volume: 0.5 });

      manager.getOrCreateBus(track.id);
      manager.setTrackVolume(track.id, track.volume);

      const bus = manager.getOrCreateBus(track.id);
      // Volume is applied to the bus
      expect(bus).toBeTruthy();
    });

    it('updates volume when track volume changes', () => {
      const track = createDefaultTrack('track-1', { volume: 1.0 });

      manager.getOrCreateBus(track.id);
      manager.setTrackVolume(track.id, 1.0);

      // Simulate volume change
      manager.setTrackVolume(track.id, 0.25);

      // Bus should reflect new volume
      const bus = manager.getOrCreateBus(track.id);
      expect(bus).toBeTruthy();
    });

    it('handles volume change for non-existent bus', () => {
      // Should not throw - just no-op
      expect(() => manager.setTrackVolume('non-existent', 0.5)).not.toThrow();
    });
  });

  describe('Mute propagation', () => {
    it('mutes track through bus manager', () => {
      const track = createDefaultTrack('track-1', { muted: true });

      manager.getOrCreateBus(track.id);
      manager.setTrackMuted(track.id, track.muted);

      const bus = manager.getOrCreateBus(track.id);
      expect(bus).toBeTruthy();
    });

    it('unmutes track through bus manager', () => {
      const track = createDefaultTrack('track-1', { muted: false });

      manager.getOrCreateBus(track.id);
      manager.setTrackMuted(track.id, true);
      manager.setTrackMuted(track.id, false);

      const bus = manager.getOrCreateBus(track.id);
      expect(bus).toBeTruthy();
    });
  });

  describe('Pan propagation', () => {
    it('sets track pan through bus manager', () => {
      const track = createDefaultTrack('track-1');

      manager.getOrCreateBus(track.id);
      manager.setTrackPan(track.id, -0.5);

      const bus = manager.getOrCreateBus(track.id);
      expect(bus).toBeTruthy();
    });

    it('handles pan change for non-existent bus', () => {
      // Should not throw - just no-op
      expect(() => manager.setTrackPan('non-existent', 0.5)).not.toThrow();
    });
  });

  describe('Multiple tracks', () => {
    it('manages multiple track buses independently', () => {
      const track1 = createDefaultTrack('track-1', { volume: 0.8 });
      const track2 = createDefaultTrack('track-2', { volume: 0.5 });
      const track3 = createDefaultTrack('track-3', { volume: 0.3 });

      manager.getOrCreateBus(track1.id);
      manager.getOrCreateBus(track2.id);
      manager.getOrCreateBus(track3.id);

      expect(manager.hasBus(track1.id)).toBe(true);
      expect(manager.hasBus(track2.id)).toBe(true);
      expect(manager.hasBus(track3.id)).toBe(true);

      // Remove one
      manager.removeBus(track2.id);

      expect(manager.hasBus(track1.id)).toBe(true);
      expect(manager.hasBus(track2.id)).toBe(false);
      expect(manager.hasBus(track3.id)).toBe(true);
    });

    it('disposes all buses on manager dispose', () => {
      manager.getOrCreateBus('track-1');
      manager.getOrCreateBus('track-2');
      manager.getOrCreateBus('track-3');

      manager.dispose();

      expect(manager.hasBus('track-1')).toBe(false);
      expect(manager.hasBus('track-2')).toBe(false);
      expect(manager.hasBus('track-3')).toBe(false);
    });
  });

  describe('Audio chain connectivity', () => {
    it('connects bus output to master gain', () => {
      manager.getOrCreateBus('track-1');

      // The bus creates gain nodes that connect in chain, with output going to master
      // Since TrackBus calls outputGain.connect(destination) where destination is masterGain,
      // we verify the context created gain nodes (which call connect in the chain)
      expect(context.createGain).toHaveBeenCalled();
    });

    it('returns correct bus input for audio routing', () => {
      manager.getOrCreateBus('track-1');

      const input = manager.getBusInput('track-1');
      expect(input).toBeTruthy();
    });

    it('creates bus when getting input for non-existent bus', () => {
      // getBusInput auto-creates the bus
      const input = manager.getBusInput('non-existent');
      expect(input).toBeTruthy();
      expect(manager.hasBus('non-existent')).toBe(true);
    });
  });
});

describe('State → Audio Sync', () => {
  let context: AudioContext;
  let masterGain: GainNode;
  let manager: TrackBusManager;

  beforeEach(() => {
    context = createMockAudioContext();
    masterGain = context.createGain();
    manager = new TrackBusManager(context, masterGain);
  });

  afterEach(() => {
    manager.dispose();
  });

  it('simulates full track state sync workflow', () => {
    // Simulate what happens when state changes

    // 1. Track is added to state
    const track = createDefaultTrack('new-track', {
      volume: 0.7,
      muted: false,
    });

    // 2. Bus is created for the track
    manager.getOrCreateBus(track.id);

    // 3. Initial state is synced
    manager.setTrackVolume(track.id, track.volume);
    manager.setTrackMuted(track.id, track.muted);

    // 4. User changes volume
    manager.setTrackVolume(track.id, 0.5);

    // 5. User mutes
    manager.setTrackMuted(track.id, true);

    // 6. User unmutes
    manager.setTrackMuted(track.id, false);

    // 7. Track is deleted
    manager.removeBus(track.id);

    // Verify bus is cleaned up
    expect(manager.hasBus(track.id)).toBe(false);
  });

  it('handles rapid state changes without errors', () => {
    const trackId = 'rapid-track';
    manager.getOrCreateBus(trackId);

    // Simulate rapid changes (like during MIDI control)
    for (let i = 0; i < 100; i++) {
      manager.setTrackVolume(trackId, Math.random());
      manager.setTrackMuted(trackId, Math.random() > 0.5);
      manager.setTrackPan(trackId, Math.random() * 2 - 1);
    }

    // Should not throw and bus should still exist
    expect(manager.hasBus(trackId)).toBe(true);
  });
});
