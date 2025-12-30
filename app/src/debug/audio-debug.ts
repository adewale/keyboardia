/**
 * Audio Debug Utility
 *
 * Exposes audio system state to the browser console for debugging.
 * Access via window.audioDebug in the browser console.
 *
 * Usage:
 *   window.audioDebug.status()          - Show full audio system status
 *   window.audioDebug.testInstrument('advanced:supersaw') - Test specific instrument
 *   window.audioDebug.testAllInstruments() - Test all instruments
 *   window.audioDebug.testAdvancedSynths() - Test just advanced synths (Fat Saw, Thick, etc.)
 *
 * Created for Phase 29 debugging (instruments not producing sound).
 */

import { getAudioEngine } from '../audio/lazyAudioLoader';
import { INSTRUMENT_CATEGORIES, CATEGORY_ORDER } from '../components/sample-constants';
import { ADVANCED_SYNTH_PRESETS } from '../audio/advancedSynth';
import { SYNTH_PRESETS } from '../audio/synth';

interface InstrumentTestResult {
  id: string;
  name: string;
  type: string;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Audio Debug API exposed to browser console
 */
export const audioDebug = {
  /**
   * Get comprehensive audio system status
   */
  async status(): Promise<Record<string, unknown>> {
    console.log('%c[Audio Debug] Checking audio system status...', 'color: #3498db; font-weight: bold');

    const engine = await getAudioEngine();

    const status = {
      initialized: engine.isInitialized(),
      toneInitialized: engine.isToneInitialized(),
      audioContextState: engine.getAudioContext()?.state ?? 'no context',
      currentTime: engine.getCurrentTime(),
      // Check readiness for each engine type
      engineReadiness: {
        sample: engine.isInitialized(),
        synth: engine.isInitialized(),
        tone: engine.isToneSynthReady('tone'),
        advanced: engine.isToneSynthReady('advanced'),
        sampled: engine.isInitialized(),
      },
      // Available presets
      presets: {
        synth: engine.getSynthPresets(),
        tone: engine.getToneSynthPresets(),
        advanced: engine.getAdvancedSynthPresets(),
      },
    };

    console.log('%c[Audio Debug] Status:', 'color: #3498db; font-weight: bold');
    console.table(status.engineReadiness);
    console.log('Full status:', status);

    return status;
  },

  /**
   * Test a specific instrument
   */
  async testInstrument(instrumentId: string): Promise<InstrumentTestResult> {
    console.log(`%c[Audio Debug] Testing instrument: ${instrumentId}`, 'color: #e67e22; font-weight: bold');

    const engine = await getAudioEngine();
    const currentTime = engine.getCurrentTime();

    // Parse instrument type from ID
    let type = 'sample';
    let preset = instrumentId;

    if (instrumentId.startsWith('synth:')) {
      type = 'synth';
      preset = instrumentId.replace('synth:', '');
    } else if (instrumentId.startsWith('tone:')) {
      type = 'tone';
      preset = instrumentId.replace('tone:', '');
    } else if (instrumentId.startsWith('advanced:')) {
      type = 'advanced';
      preset = instrumentId.replace('advanced:', '');
    } else if (instrumentId.startsWith('sampled:')) {
      type = 'sampled';
      preset = instrumentId.replace('sampled:', '');
    }

    const result: InstrumentTestResult = {
      id: instrumentId,
      name: preset,
      type,
      status: 'skipped',
      details: {},
    };

    try {
      switch (type) {
        case 'synth': {
          const presetExists = preset in SYNTH_PRESETS;
          result.details = {
            presetExists,
            engineReady: engine.isInitialized(),
          };

          if (!presetExists) {
            result.status = 'error';
            result.error = `Preset "${preset}" not found in SYNTH_PRESETS`;
          } else {
            engine.playSynthNote(`debug-${instrumentId}-${Date.now()}`, preset, 0, currentTime, 0.3);
            result.status = 'success';
            console.log(`%c  [SUCCESS] synth:${preset} - triggered at time ${currentTime.toFixed(3)}`, 'color: #2ecc71');
          }
          break;
        }

        case 'tone': {
          const toneReady = engine.isToneSynthReady('tone');
          result.details = {
            toneReady,
            availablePresets: engine.getToneSynthPresets(),
          };

          if (!toneReady) {
            result.status = 'error';
            result.error = 'Tone.js synths not ready';
          } else {
            engine.playToneSynth(preset as Parameters<typeof engine.playToneSynth>[0], 0, currentTime, 0.3);
            result.status = 'success';
            console.log(`%c  [SUCCESS] tone:${preset} - triggered at time ${currentTime.toFixed(3)}`, 'color: #2ecc71');
          }
          break;
        }

        case 'advanced': {
          const advancedReady = engine.isToneSynthReady('advanced');
          const presetExists = preset in ADVANCED_SYNTH_PRESETS;
          result.details = {
            advancedReady,
            presetExists,
            availablePresets: Object.keys(ADVANCED_SYNTH_PRESETS),
            presetConfig: presetExists ? ADVANCED_SYNTH_PRESETS[preset] : null,
          };

          if (!advancedReady) {
            result.status = 'error';
            result.error = 'Advanced synth engine not ready';
            console.log(`%c  [ERROR] advanced:${preset} - engine not ready`, 'color: #e74c3c');
          } else if (!presetExists) {
            result.status = 'error';
            result.error = `Preset "${preset}" not found in ADVANCED_SYNTH_PRESETS`;
            console.log(`%c  [ERROR] advanced:${preset} - preset not found`, 'color: #e74c3c');
          } else {
            console.log(`  Calling engine.playAdvancedSynth("${preset}", 0, ${currentTime.toFixed(3)}, 0.3)`);
            engine.playAdvancedSynth(preset, 0, currentTime, 0.3);
            result.status = 'success';
            console.log(`%c  [SUCCESS] advanced:${preset} - triggered at time ${currentTime.toFixed(3)}`, 'color: #2ecc71');
          }
          break;
        }

        case 'sampled': {
          const instrumentReady = engine.isSampledInstrumentReady(preset);
          result.details = {
            instrumentReady,
          };

          if (!instrumentReady) {
            result.status = 'skipped';
            result.error = `Sampled instrument "${preset}" not loaded`;
            console.log(`%c  [SKIPPED] sampled:${preset} - not loaded`, 'color: #f39c12');
          } else {
            const noteId = `debug-${preset}-${Date.now()}`;
            engine.playSampledInstrument(preset, noteId, 60, currentTime, 0.3);
            result.status = 'success';
            console.log(`%c  [SUCCESS] sampled:${preset} - triggered at time ${currentTime.toFixed(3)}`, 'color: #2ecc71');
          }
          break;
        }

        default: {
          // Regular sample
          result.details = {
            engineReady: engine.isInitialized(),
          };
          engine.playNow(instrumentId);
          result.status = 'success';
          console.log(`%c  [SUCCESS] ${instrumentId} - triggered`, 'color: #2ecc71');
        }
      }
    } catch (error) {
      result.status = 'error';
      result.error = error instanceof Error ? error.message : String(error);
      console.log(`%c  [ERROR] ${instrumentId} - ${result.error}`, 'color: #e74c3c');
    }

    return result;
  },

  /**
   * Test all advanced synth presets specifically
   */
  async testAdvancedSynths(): Promise<InstrumentTestResult[]> {
    console.log('%c[Audio Debug] Testing all advanced synth presets...', 'color: #9b59b6; font-weight: bold');

    const engine = await getAudioEngine();
    const results: InstrumentTestResult[] = [];

    // First check engine status
    const advancedReady = engine.isToneSynthReady('advanced');
    console.log(`  Advanced synth engine ready: ${advancedReady}`);

    if (!advancedReady) {
      console.log('%c  [ERROR] Advanced synth engine not initialized!', 'color: #e74c3c');
      console.log('  This is likely why Fat Saw and Thick are not producing sound.');
      console.log('  Check: Has Tone.js context been started? Is there an unlock gesture?');
    }

    const presets = Object.keys(ADVANCED_SYNTH_PRESETS);
    console.log(`  Found ${presets.length} presets:`, presets);

    // Test each preset with delay to hear them
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i];
      console.log(`\n  [${i + 1}/${presets.length}] Testing: advanced:${preset}`);

      const result = await this.testInstrument(`advanced:${preset}`);
      results.push(result);

      // Wait 500ms between tests so we can hear each one
      if (i < presets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Summary
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'error').length;
    const skipped = results.filter(r => r.status === 'skipped').length;

    console.log('\n%c[Audio Debug] Advanced Synth Test Summary:', 'color: #9b59b6; font-weight: bold');
    console.log(`  Success: ${successful}, Failed: ${failed}, Skipped: ${skipped}`);

    if (failed > 0) {
      console.log('%c  Failed presets:', 'color: #e74c3c');
      results.filter(r => r.status === 'error').forEach(r => {
        console.log(`    - ${r.id}: ${r.error}`);
      });
    }

    return results;
  },

  /**
   * Test all instruments across all categories
   */
  async testAllInstruments(): Promise<Record<string, InstrumentTestResult[]>> {
    console.log('%c[Audio Debug] Testing ALL instruments...', 'color: #3498db; font-weight: bold');
    console.log('  This will play each instrument - adjust volume if needed!');

    const results: Record<string, InstrumentTestResult[]> = {};

    for (const categoryKey of CATEGORY_ORDER) {
      const category = INSTRUMENT_CATEGORIES[categoryKey];
      console.log(`\n%c[Category: ${category.label}]`, 'color: #3498db; font-weight: bold');

      results[categoryKey] = [];

      for (const instrument of category.instruments) {
        const result = await this.testInstrument(instrument.id);
        results[categoryKey].push(result);

        // Short delay between tests
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Summary by category
    console.log('\n%c[Audio Debug] Test Summary by Category:', 'color: #3498db; font-weight: bold');
    for (const [category, categoryResults] of Object.entries(results)) {
      const successful = categoryResults.filter(r => r.status === 'success').length;
      const failed = categoryResults.filter(r => r.status === 'error').length;
      const skipped = categoryResults.filter(r => r.status === 'skipped').length;
      console.log(`  ${category}: ${successful} success, ${failed} failed, ${skipped} skipped`);
    }

    return results;
  },

  /**
   * Debug the audio connection chain
   */
  async debugConnectionChain(): Promise<void> {
    console.log('%c[Audio Debug] Checking audio connection chain...', 'color: #e67e22; font-weight: bold');

    const engine = await getAudioEngine();
    const ctx = engine.getAudioContext();

    if (!ctx) {
      console.log('%c  [ERROR] No AudioContext!', 'color: #e74c3c');
      return;
    }

    console.log(`  AudioContext state: ${ctx.state}`);
    console.log(`  AudioContext sampleRate: ${ctx.sampleRate}`);
    console.log(`  AudioContext currentTime: ${ctx.currentTime.toFixed(3)}`);

    console.log('\n  Engine state:');
    console.log(`    initialized: ${engine.isInitialized()}`);
    console.log(`    toneInitialized: ${engine.isToneInitialized()}`);
    console.log(`    tone synth ready: ${engine.isToneSynthReady('tone')}`);
    console.log(`    advanced synth ready: ${engine.isToneSynthReady('advanced')}`);

    // Check destination
    console.log(`\n  AudioContext destination: ${ctx.destination ? 'exists' : 'MISSING'}`);
    console.log(`    channelCount: ${ctx.destination.channelCount}`);
    console.log(`    maxChannelCount: ${ctx.destination.maxChannelCount}`);

    // Try to play a simple test tone directly via Web Audio API
    console.log('\n  Playing raw Web Audio test tone (500ms)...');
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440; // A4
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);

    console.log('%c  If you heard a tone, Web Audio is working.', 'color: #2ecc71');
    console.log('%c  If not, check: audio permissions, hardware mute, system volume.', 'color: #f39c12');
  },

  /**
   * Show how to enable verbose logging for audio system
   */
  enableVerboseLogging(): void {
    console.log('%c[Audio Debug] Verbose logging info:', 'color: #9b59b6; font-weight: bold');
    console.log('  Audio system uses logger.audio for logging.');
    console.log('  In dev mode, all [Audio] logs appear automatically.');
    console.log('  To persist logs, set: window.__LOG_PERSIST__ = true');
    console.log('  Then query with: await __getRecentLogs__(100)');
  },

  /**
   * Check if a specific preset exists
   */
  checkPreset(presetId: string): void {
    console.log(`%c[Audio Debug] Checking preset: ${presetId}`, 'color: #3498db');

    // Parse the preset ID
    if (presetId.startsWith('advanced:')) {
      const name = presetId.replace('advanced:', '');
      const exists = name in ADVANCED_SYNTH_PRESETS;
      console.log(`  Advanced preset "${name}": ${exists ? 'EXISTS' : 'NOT FOUND'}`);
      if (exists) {
        console.log('  Configuration:', ADVANCED_SYNTH_PRESETS[name]);
      } else {
        console.log('  Available presets:', Object.keys(ADVANCED_SYNTH_PRESETS));
      }
    } else if (presetId.startsWith('synth:')) {
      const name = presetId.replace('synth:', '');
      const exists = name in SYNTH_PRESETS;
      console.log(`  Synth preset "${name}": ${exists ? 'EXISTS' : 'NOT FOUND'}`);
      if (!exists) {
        console.log('  Available presets:', Object.keys(SYNTH_PRESETS));
      }
    } else {
      console.log('  Unknown preset type. Expected "synth:" or "advanced:" prefix.');
    }
  },

  /**
   * Force initialize Tone.js and test all engines
   * Use this when instruments aren't making sound
   */
  async forceInitAndTest(): Promise<void> {
    console.log('%c[Audio Debug] Force initializing Tone.js...', 'color: #e74c3c; font-weight: bold');

    const engine = await getAudioEngine();

    // Check current state
    console.log(`  Before: initialized=${engine.isInitialized()}, toneInitialized=${engine.isToneInitialized()}`);

    // CRITICAL: Engine must be initialized first (requires user gesture to create AudioContext)
    if (!engine.isInitialized()) {
      console.error('%c  AudioEngine not initialized. Click/tap anywhere to unlock audio first.', 'color: #e74c3c');
      console.log('  Note: AudioContext requires user gesture (click/tap) to start.');
      return;
    }

    // Force Tone.js initialization
    if (!engine.isToneInitialized()) {
      console.log('  Calling initializeTone()...');
      try {
        await engine.initializeTone();
        console.log('%c  Tone.js initialized successfully!', 'color: #2ecc71');
      } catch (err) {
        console.error('%c  Tone.js initialization FAILED:', 'color: #e74c3c', err);
        return;
      }
    }

    // Check state after init
    console.log(`  After: initialized=${engine.isInitialized()}, toneInitialized=${engine.isToneInitialized()}`);
    console.log(`  tone synth ready: ${engine.isToneSynthReady('tone')}`);
    console.log(`  advanced synth ready: ${engine.isToneSynthReady('advanced')}`);

    // Test each type with delay
    console.log('\n  Testing each synth type with 500ms delay...');

    // Test native synth
    console.log('\n  1. Testing native synth (synth:lead)...');
    const time1 = engine.getCurrentTime();
    engine.playSynthNote('debug-test-1', 'lead', 0, time1, 0.3);
    await new Promise(r => setTimeout(r, 500));

    // Test Tone.js synth
    if (engine.isToneSynthReady('tone')) {
      console.log('  2. Testing Tone.js synth (tone:fm-bass)...');
      const time2 = engine.getCurrentTime();
      engine.playToneSynth('fm-bass', 0, time2, 0.3);
    } else {
      console.log('%c  2. Tone.js synth NOT READY - skipping', 'color: #f39c12');
    }
    await new Promise(r => setTimeout(r, 500));

    // Test advanced synth
    if (engine.isToneSynthReady('advanced')) {
      console.log('  3. Testing advanced synth (advanced:supersaw)...');
      const time3 = engine.getCurrentTime();
      engine.playAdvancedSynth('supersaw', 0, time3, 0.3);
    } else {
      console.log('%c  3. Advanced synth NOT READY - skipping', 'color: #f39c12');
    }
    await new Promise(r => setTimeout(r, 500));

    console.log('\n%c[Audio Debug] Test complete. Results:', 'color: #3498db; font-weight: bold');
    console.log('  - If you heard 3 different sounds, all engines work');
    console.log('  - If you heard only the first sound, Tone.js engines have issues');
    console.log('  - If you heard nothing, check Web Audio (run debugConnectionChain)');
  },

  /**
   * Test Tone.js directly by creating a simple synth
   * This bypasses the engine to test if Tone.js itself works
   */
  async testToneJsDirect(): Promise<void> {
    console.log('%c[Audio Debug] Testing Tone.js directly...', 'color: #9b59b6; font-weight: bold');

    // Dynamically import Tone to avoid loading it unnecessarily
    const Tone = await import('tone');

    console.log(`  Tone.js version: ${Tone.version || 'unknown'}`);
    console.log(`  Tone context state: ${Tone.getContext().state}`);

    // Try to start Tone
    if (Tone.getContext().state !== 'running') {
      console.log('  Starting Tone.js context...');
      await Tone.start();
      console.log(`  Context state after start: ${Tone.getContext().state}`);
    }

    // Create a simple synth and play a note
    console.log('  Creating simple Tone.js synth...');
    const synth = new Tone.Synth().toDestination();

    console.log('  Playing C4 for 500ms...');
    synth.triggerAttackRelease('C4', '8n');

    // Clean up after a second
    await new Promise(r => setTimeout(r, 1000));
    synth.dispose();

    console.log('%c  If you heard a note, Tone.js is working correctly!', 'color: #2ecc71');
    console.log('%c  If not, there may be a context or permission issue.', 'color: #f39c12');
  },

  /**
   * Get detailed info about why an instrument might not be playing
   */
  async diagnoseInstrument(instrumentId: string): Promise<void> {
    console.log(`%c[Audio Debug] Diagnosing: ${instrumentId}`, 'color: #e67e22; font-weight: bold');

    const engine = await getAudioEngine();
    const ctx = engine.getAudioContext();

    console.log('\n  1. Basic checks:');
    console.log(`     AudioContext exists: ${!!ctx}`);
    console.log(`     AudioContext state: ${ctx?.state}`);
    console.log(`     Engine initialized: ${engine.isInitialized()}`);

    const type = instrumentId.split(':')[0];
    const preset = instrumentId.split(':')[1];

    console.log(`\n  2. Instrument type: ${type}`);

    switch (type) {
      case 'synth':
        console.log(`     Uses: Native Web Audio synth`);
        console.log(`     Preset "${preset}" exists: ${preset in SYNTH_PRESETS}`);
        console.log(`     Requirements: Just engine.isInitialized()`);
        console.log(`     Current status: ${engine.isInitialized() ? 'READY' : 'NOT READY'}`);
        break;

      case 'tone':
        console.log(`     Uses: Tone.js synth`);
        console.log(`     Requirements: engine.isToneSynthReady('tone')`);
        console.log(`     Tone.js initialized: ${engine.isToneInitialized()}`);
        console.log(`     Tone synth ready: ${engine.isToneSynthReady('tone')}`);
        console.log(`     Current status: ${engine.isToneSynthReady('tone') ? 'READY' : 'NOT READY'}`);
        if (!engine.isToneSynthReady('tone')) {
          console.log('%c     FIX: Run await audioDebug.forceInitAndTest()', 'color: #e74c3c');
        }
        break;

      case 'advanced':
        console.log(`     Uses: Advanced dual-oscillator synth (Tone.js)`);
        console.log(`     Preset "${preset}" exists: ${preset in ADVANCED_SYNTH_PRESETS}`);
        console.log(`     Requirements: engine.isToneSynthReady('advanced')`);
        console.log(`     Tone.js initialized: ${engine.isToneInitialized()}`);
        console.log(`     Advanced synth ready: ${engine.isToneSynthReady('advanced')}`);
        console.log(`     Current status: ${engine.isToneSynthReady('advanced') ? 'READY' : 'NOT READY'}`);
        if (!engine.isToneSynthReady('advanced')) {
          console.log('%c     FIX: Run await audioDebug.forceInitAndTest()', 'color: #e74c3c');
        }
        break;

      case 'sampled':
        console.log(`     Uses: Multi-sampled instrument`);
        console.log(`     Requirements: Samples must be loaded`);
        console.log(`     Instrument ready: ${engine.isSampledInstrumentReady(preset)}`);
        console.log(`     Current status: ${engine.isSampledInstrumentReady(preset) ? 'READY' : 'NOT READY (needs loading)'}`);
        break;

      default:
        console.log(`     Uses: Procedural sample`);
        console.log(`     Requirements: Just engine.isInitialized()`);
        console.log(`     Current status: ${engine.isInitialized() ? 'READY' : 'NOT READY'}`);
    }

    console.log('\n  3. Suggested action:');
    if (!engine.isInitialized()) {
      console.log('%c     Engine not initialized. Click/tap anywhere to initialize audio.', 'color: #e74c3c');
    } else if ((type === 'tone' || type === 'advanced') && !engine.isToneInitialized()) {
      console.log('%c     Tone.js not initialized. Run: await audioDebug.forceInitAndTest()', 'color: #e74c3c');
    } else {
      console.log('%c     All requirements met. Try playing a note.', 'color: #2ecc71');
    }
  },

  /**
   * Get advanced synth diagnostics
   * Shows detailed stats about the AdvancedSynthEngine
   */
  async getAdvancedSynthDiagnostics(): Promise<Record<string, unknown> | null> {
    console.log('%c[Audio Debug] Getting advanced synth diagnostics...', 'color: #9b59b6; font-weight: bold');

    const engine = await getAudioEngine();
    const diagnostics = engine.getAdvancedSynthDiagnostics();

    if (!diagnostics) {
      console.log('%c  Advanced synth not initialized', 'color: #e74c3c');
      return null;
    }

    console.log('%c  Advanced Synth State:', 'color: #3498db');
    console.log(`    Ready: ${diagnostics.ready}`);
    console.log(`    Voices: ${diagnostics.voiceCount} total, ${diagnostics.activeVoices} active`);
    console.log(`    Output connected: ${diagnostics.outputConnected}`);
    console.log(`    Current preset: ${diagnostics.currentPreset}`);
    console.log(`    Tone.js context: ${diagnostics.toneContextState} @ ${diagnostics.toneContextSampleRate}Hz`);

    console.log('%c  Play Statistics:', 'color: #3498db');
    console.log(`    Attempts: ${diagnostics.playAttempts}`);
    console.log(`    Successes: ${diagnostics.playSuccesses}`);
    console.log(`    Failures: ${diagnostics.playFailures}`);

    if (diagnostics.failureReasons.length > 0) {
      console.log('%c  Recent Failures:', 'color: #e74c3c');
      diagnostics.failureReasons.forEach((reason, i) => {
        console.log(`    ${i + 1}. ${reason}`);
      });
    }

    const lastPlayAgo = diagnostics.lastPlayAttempt > 0
      ? `${((Date.now() - diagnostics.lastPlayAttempt) / 1000).toFixed(1)}s ago`
      : 'never';
    const lastSuccessAgo = diagnostics.lastSuccessfulPlay > 0
      ? `${((Date.now() - diagnostics.lastSuccessfulPlay) / 1000).toFixed(1)}s ago`
      : 'never';

    console.log('%c  Timing:', 'color: #3498db');
    console.log(`    Last play attempt: ${lastPlayAgo}`);
    console.log(`    Last successful play: ${lastSuccessAgo}`);

    return diagnostics as unknown as Record<string, unknown>;
  },

  /**
   * Start live monitoring of audio state
   * Logs state changes every N seconds
   */
  startMonitor(intervalMs: number = 2000): () => void {
    console.log(`%c[Audio Debug] Starting live monitor (every ${intervalMs}ms)...`, 'color: #2ecc71; font-weight: bold');
    console.log('  Call the returned function or audioDebug.stopMonitor() to stop');

    let lastState = '';
    const checkState = async () => {
      const engine = await getAudioEngine();
      const ctx = engine.getAudioContext();
      const advDiag = engine.getAdvancedSynthDiagnostics();

      const state = JSON.stringify({
        ctxState: ctx?.state,
        toneInit: engine.isToneInitialized(),
        advReady: advDiag?.ready,
        advAttempts: advDiag?.playAttempts,
        advSuccesses: advDiag?.playSuccesses,
        advFailures: advDiag?.playFailures,
        toneCtxState: advDiag?.toneContextState,
      });

      if (state !== lastState) {
        lastState = state;
        const parsed = JSON.parse(state);
        const hasIssue = parsed.ctxState !== 'running' ||
          parsed.toneCtxState !== 'running' ||
          !parsed.advReady ||
          (parsed.advFailures > 0 && parsed.advFailures === parsed.advAttempts);

        const color = hasIssue ? '#e74c3c' : '#2ecc71';
        console.log(
          `%c[Monitor ${new Date().toLocaleTimeString()}]`,
          `color: ${color}`,
          parsed
        );

        if (hasIssue) {
          console.log('%c  ⚠️ Issue detected! Run audioDebug.getAdvancedSynthDiagnostics() for details', 'color: #f39c12');
        }
      }
    };

    const intervalId = setInterval(checkState, intervalMs);
    checkState(); // Run immediately

    const stop = () => {
      clearInterval(intervalId);
      console.log('%c[Audio Debug] Monitor stopped', 'color: #95a5a6');
    };

    // Store for stopMonitor()
    (this as unknown as { _monitorId: ReturnType<typeof setInterval> })._monitorId = intervalId;

    return stop;
  },

  /**
   * Stop the live monitor if running
   */
  stopMonitor(): void {
    const monitorId = (this as unknown as { _monitorId?: ReturnType<typeof setInterval> })._monitorId;
    if (monitorId) {
      clearInterval(monitorId);
      delete (this as unknown as { _monitorId?: ReturnType<typeof setInterval> })._monitorId;
      console.log('%c[Audio Debug] Monitor stopped', 'color: #95a5a6');
    } else {
      console.log('%c[Audio Debug] No monitor running', 'color: #95a5a6');
    }
  },

  /**
   * Diagnose and repair context suspension issues
   * Use this when instruments "worked then stopped working"
   */
  async repairContext(): Promise<void> {
    console.log('%c[Audio Debug] Diagnosing context state...', 'color: #e67e22; font-weight: bold');

    const engine = await getAudioEngine();
    const webAudioContext = engine.getAudioContext();

    // Import Tone.js dynamically
    const Tone = await import('tone');
    const toneContext = Tone.getContext();

    console.log('\n  1. Context state check:');
    console.log(`     Web Audio context state: ${webAudioContext?.state ?? 'no context'}`);
    console.log(`     Tone.js context state: ${toneContext.state}`);
    console.log(`     Engine initialized: ${engine.isInitialized()}`);
    console.log(`     Tone.js initialized: ${engine.isToneInitialized()}`);

    // Check if contexts are mismatched
    if (webAudioContext && toneContext.rawContext !== webAudioContext) {
      console.log('%c  [WARNING] Context mismatch detected!', 'color: #f39c12');
      console.log('     Tone.js is using a different AudioContext than the engine.');
      console.log('     This can cause instruments to stop working.');
    }

    // Try to repair
    console.log('\n  2. Attempting repair...');

    if (webAudioContext?.state === 'suspended') {
      console.log('     Web Audio context is suspended. Attempting resume...');
      try {
        await webAudioContext.resume();
        console.log(`     Web Audio resumed: ${webAudioContext.state}`);
      } catch (_e) {
        console.log('%c     Failed to resume Web Audio context', 'color: #e74c3c');
      }
    }

    if (toneContext.state !== 'running') {
      console.log('     Tone.js context is not running. Attempting start...');
      try {
        await Tone.start();
        console.log(`     Tone.js started: ${toneContext.state}`);
      } catch (_e) {
        console.log('%c     Failed to start Tone.js context', 'color: #e74c3c');
      }
    }

    // Re-check state
    console.log('\n  3. Post-repair state:');
    console.log(`     Web Audio context state: ${webAudioContext?.state ?? 'no context'}`);
    console.log(`     Tone.js context state: ${Tone.getContext().state}`);
    console.log(`     Advanced synth ready: ${engine.isToneSynthReady('advanced')}`);
    console.log(`     Tone synth ready: ${engine.isToneSynthReady('tone')}`);

    // Test
    console.log('\n  4. Quick test...');
    if (engine.isToneSynthReady('advanced')) {
      console.log('     Playing test note (advanced:supersaw)...');
      engine.playAdvancedSynth('supersaw', 0, engine.getCurrentTime(), 0.3);
      console.log('%c     If you heard a sound, the repair was successful!', 'color: #2ecc71');
    } else {
      console.log('%c     Advanced synth still not ready.', 'color: #e74c3c');
      console.log('     Try: await audioDebug.forceInitAndTest()');
    }
  },
};

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as unknown as { audioDebug: typeof audioDebug }).audioDebug = audioDebug;
}

export type AudioDebug = typeof audioDebug;
