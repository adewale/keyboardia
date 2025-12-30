/**
 * Audio Health Canary System
 *
 * A continuous monitoring system that detects when audio actually stops working,
 * not just when logs indicate success. Uses Web Audio's AnalyserNode to verify
 * actual audio output.
 *
 * Key insight: Log-based testing can show "success" even when no sound is produced.
 * This canary actually measures audio output to catch silent failures.
 *
 * Usage:
 *   window.__audioCanary__.start()      - Start continuous monitoring
 *   window.__audioCanary__.stop()       - Stop monitoring
 *   window.__audioCanary__.runTest()    - Run a single health check
 *   window.__audioCanary__.getReport()  - Get full diagnostic report
 */

import * as Tone from 'tone';
import { getAudioEngine } from '../audio/lazyAudioLoader';
import { logger } from '../utils/logger';

export interface CanaryTestResult {
  timestamp: number;
  testType: 'synth' | 'advanced' | 'sampled';
  presetOrInstrument: string;
  expectedSound: boolean;
  actualSound: boolean;
  peakAmplitude: number;
  passed: boolean;
  diagnostics?: {
    toneContextState: string;
    engineContextState: string | undefined;
    contextMismatch: boolean;
    advancedSynthReady: boolean;
    toneSynthReady: boolean;
  };
}

export interface CanaryReport {
  startTime: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  lastFailure: CanaryTestResult | null;
  failures: CanaryTestResult[];
  isHealthy: boolean;
  uptime: number;
}

class AudioHealthCanary {
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private report: CanaryReport;
  private testGain: GainNode | null = null;

  constructor() {
    this.report = this.createEmptyReport();
  }

  private createEmptyReport(): CanaryReport {
    return {
      startTime: 0,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      lastFailure: null,
      failures: [],
      isHealthy: true,
      uptime: 0,
    };
  }

  /**
   * Initialize the analyser node for measuring audio output
   */
  private async initAnalyser(): Promise<boolean> {
    try {
      const engine = await getAudioEngine();
      const ctx = engine.getAudioContext();

      if (!ctx) {
        logger.audio.error('[Canary] No AudioContext available');
        return false;
      }

      // Create analyser connected to destination
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      // Create a gain node we can use to route test audio through
      this.testGain = ctx.createGain();
      this.testGain.gain.value = 0.01; // Very quiet - just for measurement
      this.testGain.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      logger.audio.log('[Canary] Analyser initialized');
      return true;
    } catch (e) {
      logger.audio.error('[Canary] Failed to init analyser:', e);
      return false;
    }
  }

  /**
   * Measure if there's actual audio output
   */
  private measureAudio(): { hasSound: boolean; peakAmplitude: number } {
    if (!this.analyser || !this.dataArray) {
      return { hasSound: false, peakAmplitude: 0 };
    }

    this.analyser.getByteTimeDomainData(this.dataArray as Uint8Array<ArrayBuffer>);

    // Find peak deviation from silence (128 = silence in byte domain)
    let maxDeviation = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const deviation = Math.abs(this.dataArray[i] - 128);
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
      }
    }

    // Normalize to 0-1 range
    const peakAmplitude = maxDeviation / 128;

    // Threshold for "has sound" - some deviation expected
    const hasSound = peakAmplitude > 0.01;

    return { hasSound, peakAmplitude };
  }

  /**
   * Get current diagnostic state
   */
  private async getDiagnostics(): Promise<CanaryTestResult['diagnostics']> {
    try {
      const engine = await getAudioEngine();
      const toneCtx = Tone.getContext();
      const engineCtx = engine.getAudioContext();

      return {
        toneContextState: toneCtx.state,
        engineContextState: engineCtx?.state,
        contextMismatch: toneCtx.rawContext !== engineCtx,
        advancedSynthReady: engine.isToneSynthReady('advanced'),
        toneSynthReady: engine.isToneSynthReady('tone'),
      };
    } catch (_e) {
      return {
        toneContextState: 'error',
        engineContextState: undefined,
        contextMismatch: true,
        advancedSynthReady: false,
        toneSynthReady: false,
      };
    }
  }

  /**
   * Run a single health test on an advanced synth
   */
  async testAdvancedSynth(preset: string): Promise<CanaryTestResult> {
    const engine = await getAudioEngine();
    const startTime = Date.now();

    // Play a test note
    const time = engine.getCurrentTime();
    engine.playAdvancedSynth(preset, 0, time, 0.2);

    // Wait for sound to start
    await new Promise(r => setTimeout(r, 100));

    // Measure
    const { hasSound, peakAmplitude } = this.measureAudio();
    const diagnostics = await this.getDiagnostics();

    const result: CanaryTestResult = {
      timestamp: startTime,
      testType: 'advanced',
      presetOrInstrument: preset,
      expectedSound: true,
      actualSound: hasSound,
      peakAmplitude,
      passed: hasSound,
      diagnostics,
    };

    this.recordResult(result);
    return result;
  }

  /**
   * Run a single health test on a native synth
   */
  async testNativeSynth(preset: string): Promise<CanaryTestResult> {
    const engine = await getAudioEngine();
    const startTime = Date.now();

    // Play a test note
    const time = engine.getCurrentTime();
    engine.playSynthNote(`canary-test-${Date.now()}`, preset, 0, time, 0.2);

    // Wait for sound to start
    await new Promise(r => setTimeout(r, 100));

    // Measure
    const { hasSound, peakAmplitude } = this.measureAudio();
    const diagnostics = await this.getDiagnostics();

    const result: CanaryTestResult = {
      timestamp: startTime,
      testType: 'synth',
      presetOrInstrument: preset,
      expectedSound: true,
      actualSound: hasSound,
      peakAmplitude,
      passed: hasSound,
      diagnostics,
    };

    this.recordResult(result);
    return result;
  }

  /**
   * Record a test result and update report
   */
  private recordResult(result: CanaryTestResult): void {
    this.report.totalTests++;

    if (result.passed) {
      this.report.passedTests++;
    } else {
      this.report.failedTests++;
      this.report.lastFailure = result;
      this.report.failures.push(result);

      // Keep only last 10 failures
      if (this.report.failures.length > 10) {
        this.report.failures.shift();
      }

      // Log failure with diagnostics
      logger.audio.error('[Canary] AUDIO FAILURE DETECTED', {
        test: `${result.testType}:${result.presetOrInstrument}`,
        peakAmplitude: result.peakAmplitude,
        diagnostics: result.diagnostics,
      });

      // Attempt auto-repair
      this.attemptRepair(result);
    }

    this.report.isHealthy = this.report.failedTests === 0 ||
      (this.report.passedTests / this.report.totalTests) > 0.9;
    this.report.uptime = Date.now() - this.report.startTime;
  }

  /**
   * Attempt to repair audio system when failure detected
   */
  private async attemptRepair(failedResult: CanaryTestResult): Promise<void> {
    logger.audio.warn('[Canary] Attempting auto-repair...');

    try {
      const engine = await getAudioEngine();
      const diag = failedResult.diagnostics;

      // Check for context mismatch
      if (diag?.contextMismatch) {
        logger.audio.warn('[Canary] Context mismatch detected - this requires page reload');
        console.warn(
          '%c[Audio Canary] CONTEXT MISMATCH DETECTED\n' +
          'Advanced synths may not work. Try refreshing the page.',
          'color: #e74c3c; font-weight: bold; font-size: 14px'
        );
      }

      // Try to resume Tone.js if suspended
      if (diag?.toneContextState !== 'running') {
        logger.audio.log('[Canary] Attempting to resume Tone.js...');
        await Tone.start();
      }

      // Try to resume engine context if suspended
      const ctx = engine.getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        logger.audio.log('[Canary] Attempting to resume AudioContext...');
        await ctx.resume();
      }

      // Re-test after repair
      await new Promise(r => setTimeout(r, 200));
      const { hasSound } = this.measureAudio();

      if (hasSound) {
        logger.audio.log('[Canary] Auto-repair succeeded!');
      } else {
        logger.audio.error('[Canary] Auto-repair failed. Manual intervention needed.');
      }
    } catch (e) {
      logger.audio.error('[Canary] Auto-repair threw error:', e);
    }
  }

  /**
   * Run a full health check cycle
   */
  async runTest(): Promise<CanaryTestResult[]> {
    const results: CanaryTestResult[] = [];

    // Test native synth
    results.push(await this.testNativeSynth('lead'));

    // Test advanced synths (the ones that often break)
    const advancedPresets = ['supersaw', 'thick-lead', 'vibrato-lead'];
    for (const preset of advancedPresets) {
      results.push(await this.testAdvancedSynth(preset));
      await new Promise(r => setTimeout(r, 300)); // Wait between tests
    }

    return results;
  }

  /**
   * Start continuous monitoring
   */
  async start(intervalMs = 30000): Promise<void> {
    if (this.isRunning) {
      logger.audio.warn('[Canary] Already running');
      return;
    }

    const initialized = await this.initAnalyser();
    if (!initialized) {
      logger.audio.error('[Canary] Failed to initialize');
      return;
    }

    this.report = this.createEmptyReport();
    this.report.startTime = Date.now();
    this.isRunning = true;

    logger.audio.log(`[Canary] Started monitoring (interval: ${intervalMs}ms)`);
    console.log(
      '%c[Audio Canary] Monitoring started\n' +
      `Testing every ${intervalMs / 1000}s. Run __audioCanary__.getReport() for status.`,
      'color: #2ecc71; font-weight: bold'
    );

    // Run initial test
    await this.runTest();

    // Start periodic testing
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.runTest();
      }
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.audio.log('[Canary] Stopped monitoring');
    console.log('%c[Audio Canary] Monitoring stopped', 'color: #95a5a6');
  }

  /**
   * Get current health report
   */
  getReport(): CanaryReport {
    this.report.uptime = this.isRunning ? Date.now() - this.report.startTime : this.report.uptime;
    return { ...this.report };
  }

  /**
   * Check if currently healthy
   */
  isHealthy(): boolean {
    return this.report.isHealthy;
  }
}

// Singleton instance
const canary = new AudioHealthCanary();

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as unknown as { __audioCanary__: AudioHealthCanary }).__audioCanary__ = canary;
}

export { canary as audioCanary };
