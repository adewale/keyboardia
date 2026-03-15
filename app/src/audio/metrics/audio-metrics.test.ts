import { describe, it, expect, beforeEach } from 'vitest';
import { AudioMetricsCollector } from './audio-metrics';

describe('AudioMetricsCollector', () => {
  let collector: AudioMetricsCollector;

  beforeEach(() => {
    collector = new AudioMetricsCollector();
    // Set sample rate to 1 so every event is recorded
    collector.setSampleRate(1);
  });

  describe('jitter recording', () => {
    it('records jitter samples', () => {
      collector.recordJitter(1.5);
      collector.recordJitter(2.0);
      collector.recordJitter(0.5);

      const snap = collector.getSnapshot();
      expect(snap.scheduler.samples).toBe(3);
      expect(snap.scheduler.p50).toBeCloseTo(1.5, 1);
      expect(snap.scheduler.max).toBeCloseTo(2.0, 1);
    });

    it('respects sample rate', () => {
      collector.setSampleRate(3);
      // Only every 3rd call is recorded
      collector.recordJitter(1);
      collector.recordJitter(2);
      collector.recordJitter(3); // recorded
      collector.recordJitter(4);
      collector.recordJitter(5);
      collector.recordJitter(6); // recorded

      const snap = collector.getSnapshot();
      expect(snap.scheduler.samples).toBe(2);
    });
  });

  describe('input latency recording', () => {
    it('records latency samples', () => {
      collector.recordInputLatency(10);
      collector.recordInputLatency(20);
      collector.recordInputLatency(30);

      const snap = collector.getSnapshot();
      expect(snap.inputLatency.samples).toBe(3);
      expect(snap.inputLatency.p50).toBeCloseTo(20, 1);
    });
  });

  describe('implementation tracking', () => {
    it('defaults to main-thread', () => {
      const snap = collector.getSnapshot();
      expect(snap.implementation).toBe('main-thread');
    });

    it('tracks worklet implementation', () => {
      collector.setImplementation('worklet');
      const snap = collector.getSnapshot();
      expect(snap.implementation).toBe('worklet');
    });
  });

  describe('reset', () => {
    it('clears all collected data', () => {
      collector.recordJitter(5);
      collector.recordInputLatency(10);
      collector.reset();

      const snap = collector.getSnapshot();
      expect(snap.scheduler.samples).toBe(0);
      expect(snap.inputLatency.samples).toBe(0);
    });
  });

  describe('drift recording', () => {
    it('records drift at step count', () => {
      collector.recordDrift(16, 0.5);
      collector.recordDrift(32, 1.2);
      collector.recordDrift(64, 0.3);

      expect(collector.getDriftAtStep(16)).toBe(0.5);
      expect(collector.getDriftAtStep(64)).toBe(0.3);
    });

    it('returns closest drift for missing step', () => {
      collector.recordDrift(16, 0.5);
      collector.recordDrift(64, 1.0);

      // Step 20 is closer to 16 than 64
      expect(collector.getDriftAtStep(20)).toBe(0.5);
      // Step 50 is closer to 64 than 16
      expect(collector.getDriftAtStep(50)).toBe(1.0);
    });
  });

  describe('external providers', () => {
    it('uses voice utilization provider', () => {
      collector.setVoiceUtilizationProvider(() => ({
        synthEngine: { active: 5, max: 16 },
        advancedSynth: { active: 3, max: 8 },
      }));

      const snap = collector.getSnapshot();
      expect(snap.cpu.voiceUtilization.synthEngine.active).toBe(5);
      expect(snap.cpu.voiceUtilization.advancedSynth.active).toBe(3);
    });

    it('uses context info provider', () => {
      collector.setContextInfoProvider(() => ({
        state: 'running',
        sampleRate: 48000,
        baseLatency: 0.01,
      }));

      const snap = collector.getSnapshot();
      expect(snap.cpu.contextState).toBe('running');
      expect(snap.cpu.sampleRate).toBe(48000);
      expect(snap.cpu.baseLatencyMs).toBeCloseTo(10, 1);
    });
  });
});
