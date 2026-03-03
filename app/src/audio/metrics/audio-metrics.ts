/**
 * AudioMetricsCollector - Centralized audio performance metrics.
 *
 * Collects scheduling jitter, input latency, CPU usage, and worklet health
 * metrics with configurable sampling to limit overhead (<1% CPU).
 *
 * Access via:
 *   - Debug overlay (?debug=1) → Audio Performance section
 *   - Console: window.audioDebug.metrics()
 */

import { RingBuffer } from './ring-buffer';
import { percentile } from './percentile';

// ─── Metric Types ────────────────────────────────────────────────────────

export interface SchedulerJitterMetrics {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  samples: number;
}

export interface InputLatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

export interface VoiceUtilization {
  active: number;
  max: number;
}

export interface CPUMetrics {
  oscillatorCount: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  voiceUtilization: {
    synthEngine: VoiceUtilization;
    advancedSynth: VoiceUtilization;
  };
  contextState: string;
  sampleRate: number;
  baseLatencyMs: number;
}

export interface AudioMetricsSnapshot {
  scheduler: SchedulerJitterMetrics;
  inputLatency: InputLatencyMetrics;
  cpu: CPUMetrics;
  implementation: 'main-thread' | 'worklet';
  collectedAt: number;
}

// ─── Collector ───────────────────────────────────────────────────────────

export class AudioMetricsCollector {
  // Ring buffers for recent samples (keep last 1000)
  private jitterSamples = new RingBuffer<number>(1000);
  private latencySamples = new RingBuffer<number>(1000);
  private driftSamples = new RingBuffer<{ stepCount: number; driftMs: number }>(256);

  // Long task tracking
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private longTaskObserver: PerformanceObserver | null = null;

  // Sampling: only record every Nth event to limit overhead
  private sampleRate = 10;
  private jitterCounter = 0;
  private latencyCounter = 0;

  // Implementation tracking
  private implementation: 'main-thread' | 'worklet' = 'main-thread';

  // External providers (set by engine)
  private getVoiceUtilization: (() => { synthEngine: VoiceUtilization; advancedSynth: VoiceUtilization }) | null = null;
  private getOscillatorCount: (() => number) | null = null;
  private getContextInfo: (() => { state: string; sampleRate: number; baseLatency: number }) | null = null;

  constructor() {
    this.initLongTaskObserver();
  }

  // ─── Recording ───────────────────────────────────────────────────────

  recordJitter(jitterMs: number): void {
    if (++this.jitterCounter % this.sampleRate !== 0) return;
    this.jitterSamples.push(jitterMs);
  }

  recordInputLatency(latencyMs: number): void {
    if (++this.latencyCounter % this.sampleRate !== 0) return;
    this.latencySamples.push(latencyMs);
  }

  recordDrift(stepCount: number, driftMs: number): void {
    this.driftSamples.push({ stepCount, driftMs });
  }

  setImplementation(impl: 'main-thread' | 'worklet'): void {
    this.implementation = impl;
  }

  setSampleRate(rate: number): void {
    this.sampleRate = Math.max(1, rate);
  }

  // ─── External providers ──────────────────────────────────────────────

  setVoiceUtilizationProvider(fn: () => { synthEngine: VoiceUtilization; advancedSynth: VoiceUtilization }): void {
    this.getVoiceUtilization = fn;
  }

  setOscillatorCountProvider(fn: () => number): void {
    this.getOscillatorCount = fn;
  }

  setContextInfoProvider(fn: () => { state: string; sampleRate: number; baseLatency: number }): void {
    this.getContextInfo = fn;
  }

  // ─── Snapshot ────────────────────────────────────────────────────────

  getSnapshot(): AudioMetricsSnapshot {
    const jitters = this.jitterSamples.toArray();
    const latencies = this.latencySamples.toArray();

    const contextInfo = this.getContextInfo?.() ?? {
      state: 'unknown',
      sampleRate: 0,
      baseLatency: 0,
    };

    const voiceUtil = this.getVoiceUtilization?.() ?? {
      synthEngine: { active: 0, max: 16 },
      advancedSynth: { active: 0, max: 8 },
    };

    return {
      scheduler: {
        p50: percentile(jitters, 50),
        p95: percentile(jitters, 95),
        p99: percentile(jitters, 99),
        max: jitters.length > 0 ? Math.max(...jitters) : 0,
        samples: jitters.length,
      },
      inputLatency: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        samples: latencies.length,
      },
      cpu: {
        oscillatorCount: this.getOscillatorCount?.() ?? 0,
        longTaskCount: this.longTaskCount,
        longTaskTotalMs: this.longTaskTotalMs,
        voiceUtilization: voiceUtil,
        contextState: contextInfo.state,
        sampleRate: contextInfo.sampleRate,
        baseLatencyMs: contextInfo.baseLatency * 1000,
      },
      implementation: this.implementation,
      collectedAt: Date.now(),
    };
  }

  // ─── Drift analysis ──────────────────────────────────────────────────

  getDriftAtStep(stepCount: number): number {
    const samples = this.driftSamples.toArray();
    // Find closest sample to requested step count
    let closest = samples[0];
    for (const s of samples) {
      if (closest === undefined || Math.abs(s.stepCount - stepCount) < Math.abs(closest.stepCount - stepCount)) {
        closest = s;
      }
    }
    return closest?.driftMs ?? 0;
  }

  // ─── Reset ───────────────────────────────────────────────────────────

  reset(): void {
    this.jitterSamples.clear();
    this.latencySamples.clear();
    this.driftSamples.clear();
    this.longTaskCount = 0;
    this.longTaskTotalMs = 0;
    this.jitterCounter = 0;
    this.latencyCounter = 0;
  }

  // ─── Long task observer ──────────────────────────────────────────────

  private initLongTaskObserver(): void {
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount++;
          this.longTaskTotalMs += entry.duration;
        }
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      // PerformanceObserver longtask not supported in all browsers
    }
  }

  dispose(): void {
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
  }
}

export const audioMetrics = new AudioMetricsCollector();
