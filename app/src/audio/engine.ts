import type { Sample } from '../types';
import { createSynthesizedSamples } from './samples';
import { synthEngine, SYNTH_PRESETS, semitoneToFrequency, type SynthParams } from './synth';
import { logger } from '../utils/logger';
import { ToneEffectsChain, type EffectsState, DEFAULT_EFFECTS_STATE } from './toneEffects';
import { ToneSynthManager, isToneSynth, getToneSynthPreset, type ToneSynthType } from './toneSynths';
import {
  AdvancedSynthEngine,
  isAdvancedSynth,
  getAdvancedSynthPresetId,
  ADVANCED_SYNTH_PRESETS,
} from './advancedSynth';
import {
  sampledInstrumentRegistry,
  SAMPLED_INSTRUMENTS,
  isSampledInstrument,
} from './sampled-instrument';
import { collectSampledInstruments } from './instrument-types';
import { tracer } from '../utils/debug-tracer';
import { runAllDetections } from '../utils/bug-patterns';
import { TrackBusManager } from './track-bus-manager';
import { TrackSynthRegistry } from './track-synth-registry';
import { pitchSemitonesToWorkletRatio } from './pitch-shift-range';
import { computeEnvelopeStart } from './envelope-anchor';
import { registerHmrDispose } from '../utils/hmr';
import { supportsAudioWorklet, loadWorkletModule } from './worklet-support';
import { MeteringHost, meteringHost } from './metering-host';
import { upgradeToWorkletScheduler } from './scheduler';
import { audioMetrics, type AudioMetricsSnapshot } from './metrics/audio-metrics';
import * as Tone from 'tone';

// iOS Safari uses webkitAudioContext
const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

// Audio Engineering Constants
const FADE_TIME = 0.003; // 3ms fade to prevent clicks/pops

// Grain size used by pitch-shift.worklet.ts. The worklet introduces one
// grain of latency before producing meaningful output, so the envelope
// ramp on its output must be delayed by grainSize / sampleRate seconds.
// KEEP IN SYNC with processorOptions.grainSize (default 1024).
const PITCH_SHIFT_GRAIN_SIZE = 1024;
const COMPRESSOR_SETTINGS = {
  threshold: -6,    // Start compressing at -6dB
  knee: 12,         // Soft knee for natural sound
  ratio: 4,         // 4:1 compression ratio
  attack: 0.003,    // 3ms attack
  release: 0.25,    // 250ms release
};

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private samples: Map<string, Sample> = new Map();
  private trackBusManager: TrackBusManager | null = null; // Phase 25: Unified audio bus
  private initialized = false;
  private unlockListenerAttached = false;
  private unlockHandler: (() => Promise<void>) | null = null; // Store reference for cleanup

  // Race condition prevention flags
  private resumeInProgress = false;
  private resumePromise: Promise<void> | null = null;

  // Tone.js integration (Phase 22: Synthesis Engine)
  private toneEffects: ToneEffectsChain | null = null;
  private toneSynthRegistry: TrackSynthRegistry<ToneSynthManager>;
  private advancedSynthRegistry: TrackSynthRegistry<AdvancedSynthEngine>;
  // Shared, eagerly-created synth instances used for SamplePicker preview
  // and any other trackId-less play call. They connect directly to the
  // effects chain (no track bus, no metering slot). See merged_bug_002.
  private previewToneSynth: ToneSynthManager | null = null;
  private previewAdvancedSynth: AdvancedSynthEngine | null = null;
  private toneInitialized = false;
  private toneInitPromise: Promise<void> | null = null;
  private effectsChainConnected = false; // Track if masterGain was rerouted to effects
  private pitchShiftLoaded = false;

  // Shared-control overrides applied to every (current and future) per-track
  // synth instance. `undefined` means "leave the engine's default/preset
  // value alone". Used by XY-pad and FM-param setters to fan out state.
  private advancedOverrides: {
    filterFrequency?: number;
    filterResonance?: number;
    lfoRate?: number;
    lfoAmount?: number;
    attack?: number;
    release?: number;
    oscMix?: number;
  } = {};
  private toneOverrides: {
    fmParams?: { harmonicity: number; modulationIndex: number };
  } = {};

  constructor() {
    this.toneSynthRegistry = new TrackSynthRegistry<ToneSynthManager>({
      factory: async (trackId) => this.createToneSynthForTrack(trackId),
      dispose: (synth) => synth.dispose(),
    });
    this.advancedSynthRegistry = new TrackSynthRegistry<AdvancedSynthEngine>({
      factory: async (trackId) => this.createAdvancedSynthForTrack(trackId),
      dispose: (synth) => synth.dispose(),
    });
  }

  private async createToneSynthForTrack(trackId: string): Promise<ToneSynthManager> {
    if (!this.audioContext || !this.trackBusManager) {
      throw new Error('Cannot create per-track tone synth: engine not initialized');
    }
    const manager = new ToneSynthManager();
    await manager.initialize();
    const output = manager.getOutput();
    const busInput = this.trackBusManager.getBusInput(trackId);
    if (output) {
      // Tone.Gain.connect accepts native AudioNodes via Tone's compat layer;
      // cast via the param type of connect() to satisfy the mixed-type API.
      output.connect(busInput as Parameters<typeof output.connect>[0]);
    }
    // Apply any shared-control overrides set before this track existed.
    if (this.toneOverrides.fmParams) {
      manager.setFMParams(
        this.toneOverrides.fmParams.harmonicity,
        this.toneOverrides.fmParams.modulationIndex,
      );
    }
    logger.audio.log(`Created ToneSynthManager for track ${trackId}`);
    return manager;
  }

  private async createAdvancedSynthForTrack(trackId: string): Promise<AdvancedSynthEngine> {
    if (!this.audioContext || !this.trackBusManager) {
      throw new Error('Cannot create per-track advanced synth: engine not initialized');
    }
    const synth = new AdvancedSynthEngine();
    await synth.initialize();
    const output = synth.getOutput();
    const busInput = this.trackBusManager.getBusInput(trackId);
    if (output) {
      output.connect(busInput as Parameters<typeof output.connect>[0]);
    }
    const ov = this.advancedOverrides;
    if (ov.filterFrequency !== undefined) synth.setFilterFrequency(ov.filterFrequency);
    if (ov.filterResonance !== undefined) synth.setFilterResonance(ov.filterResonance);
    if (ov.lfoRate !== undefined) synth.setLfoRate(ov.lfoRate);
    if (ov.lfoAmount !== undefined) synth.setLfoAmount(ov.lfoAmount);
    if (ov.attack !== undefined) synth.setAttack(ov.attack);
    if (ov.release !== undefined) synth.setRelease(ov.release);
    if (ov.oscMix !== undefined) synth.setOscMix(ov.oscMix);
    logger.audio.log(`Created AdvancedSynthEngine for track ${trackId}`);
    return synth;
  }

  /** Eagerly create the tone synth for a track (avoids first-note latency). */
  async warmToneSynthForTrack(trackId: string): Promise<void> {
    if (!this.toneInitialized) return;
    await this.toneSynthRegistry.getOrCreate(trackId);
  }

  /** Eagerly create the advanced synth for a track (avoids first-note latency). */
  async warmAdvancedSynthForTrack(trackId: string): Promise<void> {
    if (!this.toneInitialized) return;
    await this.advancedSynthRegistry.getOrCreate(trackId);
  }

  /**
   * Ensure the shared preview synths exist. Used by trackId-less play
   * calls (e.g. SamplePicker hover). Connected directly to the effects
   * chain so they bypass the per-track bus and metering pipeline. See
   * merged_bug_002 — without this the first preview was silent and
   * leaked a phantom track bus + metering slot.
   */
  private async ensurePreviewSynths(): Promise<void> {
    const effectsInput = this.toneEffects?.getInput();
    if (this.previewToneSynth === null) {
      const m = new ToneSynthManager();
      await m.initialize();
      const out = m.getOutput();
      if (out && effectsInput) {
        out.connect(effectsInput as Parameters<typeof out.connect>[0]);
      }
      this.previewToneSynth = m;
    }
    if (this.previewAdvancedSynth === null) {
      const a = new AdvancedSynthEngine();
      await a.initialize();
      const out = a.getOutput();
      if (out && effectsInput) {
        out.connect(effectsInput as Parameters<typeof out.connect>[0]);
      }
      this.previewAdvancedSynth = a;
    }
  }

  /**
   * Get the AudioContext for creating worklet nodes.
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create AudioContext (must be triggered by user gesture)
    // Use webkitAudioContext for older iOS Safari
    this.audioContext = new AudioContextClass();

    // Resume if suspended or interrupted (iOS-specific state)
    // iOS can put the context in 'interrupted' state
    if (this.audioContext.state === 'suspended' || (this.audioContext.state as string) === 'interrupted') {
      logger.audio.log('AudioContext state:', this.audioContext.state, '- attempting resume');
      await this.audioContext.resume();
      logger.audio.log('AudioContext state after resume:', this.audioContext.state);
    }

    // Create master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1.0;

    // Phase 25: Initialize track bus manager for unified audio routing
    this.trackBusManager = new TrackBusManager(this.audioContext, this.masterGain);

    // Create compressor/limiter to prevent clipping when multiple sources play
    // This is essential - without it, 8 samples at 0.85 each could sum to 6.8 (clipping)
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = COMPRESSOR_SETTINGS.threshold;
    this.compressor.knee.value = COMPRESSOR_SETTINGS.knee;
    this.compressor.ratio.value = COMPRESSOR_SETTINGS.ratio;
    this.compressor.attack.value = COMPRESSOR_SETTINGS.attack;
    this.compressor.release.value = COMPRESSOR_SETTINGS.release;

    // Signal chain: tracks -> masterGain -> compressor -> destination
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.audioContext.destination);

    // Initialize synth engine
    synthEngine.initialize(this.audioContext, this.masterGain);

    // Initialize sampled instrument registry (Phase 22)
    // Phase 23: Lazy loading - instruments load on-demand, not at startup
    sampledInstrumentRegistry.initialize(this.audioContext, this.masterGain);
    for (const instrumentId of SAMPLED_INSTRUMENTS) {
      sampledInstrumentRegistry.register(instrumentId, '/instruments');
    }
    logger.audio.log('Registered sampled instruments (lazy loading enabled):', SAMPLED_INSTRUMENTS);

    // Load synthesized samples
    this.samples = await createSynthesizedSamples(this.audioContext);

    // Phase W: Initialize AudioWorklet modules (metering, etc.)
    // Non-blocking — worklets are optional enhancements
    this.initializeWorklets().catch(err => {
      logger.audio.warn('AudioWorklet initialization failed (non-fatal):', err);
    });

    // Phase W: Wire up audio metrics providers
    audioMetrics.setContextInfoProvider(() => ({
      state: this.audioContext?.state ?? 'unknown',
      sampleRate: this.audioContext?.sampleRate ?? 0,
      baseLatency: (this.audioContext as AudioContext & { baseLatency?: number })?.baseLatency ?? 0,
    }));

    audioMetrics.setVoiceUtilizationProvider(() => {
      let advancedActive = 0;
      this.advancedSynthRegistry.forEach((synth) => {
        advancedActive += synth.getDiagnostics()?.activeVoices ?? 0;
      });
      return {
        synthEngine: { active: synthEngine.getVoiceCount(), max: 16 },
        advancedSynth: { active: advancedActive, max: 8 },
      };
    });

    this.initialized = true;

    // Note: Debug tools (initDebugTracer, initPlaybackDebug, initBugPatterns) are
    // initialized by debug-coordinator.ts on page load, not here.
    // This prevents double-initialization when AudioEngine initializes on first play.

    // Expose engine reference for debug tools
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__audioEngine__ = this;

    // Run initial bug detection (logs warnings if patterns detected)
    if (typeof window !== 'undefined' && window.__DEBUG_TRACE__) {
      const detectionResults = runAllDetections();
      for (const [patternId, result] of detectionResults) {
        if (result.detected) {
          tracer.warning('bug-detection', `Pattern detected: ${patternId}`, result.message || 'Bug pattern detected', result.evidence);
        }
      }
    }

    logger.audio.log('AudioEngine initialized, state:', this.audioContext.state);
    logger.audio.log('Loaded samples:', Array.from(this.samples.keys()));

    // Mobile Chrome workaround: attach document-level listeners to unlock audio
    // This handles cases where the audio context gets re-suspended
    this.attachUnlockListeners();

    // Initialize Tone.js effects and synths (async, non-blocking)
    // This is done after basic initialization so audio can start playing
    // while effects are being set up
    this.initializeTone().catch(err => {
      logger.audio.error('Failed to initialize Tone.js:', err);
    });
  }

  /**
   * Initialize Tone.js effects and advanced synths
   * Called automatically after basic initialization
   * Uses promise locking to prevent concurrent initialization attempts
   * Public to allow external components to trigger Tone.js initialization on demand
   */
  async initializeTone(): Promise<void> {
    // Already initialized
    if (this.toneInitialized) return;

    // CRITICAL: Require AudioEngine to be initialized first
    // Without our own AudioContext, Tone.js would use its auto-created context,
    // causing a mismatch when we later create our AudioContext
    if (!this.audioContext) {
      throw new Error('Cannot initialize Tone.js: AudioEngine.audioContext is not set. Call initialize() first.');
    }

    // Initialization in progress - wait for existing promise
    if (this.toneInitPromise) {
      return this.toneInitPromise;
    }

    // Create and store the initialization promise
    this.toneInitPromise = (async () => {
      try {
        // CRITICAL: Set Tone.js to use our existing AudioContext BEFORE starting
        // This ensures all Tone.js nodes are in the same context as our native nodes
        // (masterGain, compressor, etc.) so they can be connected together.
        //
        // Phase 29 fix: Tone.js auto-creates its own AudioContext when imported.
        // We need to switch to our context. IMPORTANT: Do NOT close the old context
        // as that corrupts Tone.js internal state. Just call setContext() and let
        // the old context be garbage collected.
        const existingToneContext = Tone.getContext();
        if (existingToneContext.rawContext !== this.audioContext) {
          logger.audio.log('Switching Tone.js to engine context (old context will be GC\'d)');
        }
        // Safe to use ! here because we checked this.audioContext exists above
        Tone.setContext(this.audioContext!);

        // Start Tone.js audio context (now using our context)
        await Tone.start();
        logger.audio.log('Tone.js started, context state:', Tone.getContext().state);

        // SAFEGUARD: Verify Tone.js is using our AudioContext
        // This catches HMR issues where Tone.js might have a stale context
        const toneContext = Tone.getContext().rawContext;
        if (toneContext !== this.audioContext) {
          // Log detailed diagnostics but don't throw - try to proceed anyway
          logger.audio.error('AudioContext mismatch detected!', {
            toneContextState: toneContext.state,
            engineContextState: this.audioContext?.state,
            toneContextSampleRate: toneContext.sampleRate,
            engineContextSampleRate: this.audioContext?.sampleRate,
          });
          // Instead of throwing, try to force Tone.js to use our context
          logger.audio.log('Attempting to force Tone.js context switch...');
          Tone.setContext(this.audioContext!);
          await Tone.start();
          logger.audio.log('Tone.js context after force switch:', Tone.getContext().state);
        }

        // Initialize effects chain
        this.toneEffects = new ToneEffectsChain();
        await this.toneEffects.initialize();

        // Connect master gain to effects chain input
        // Signal flow: masterGain -> toneEffects -> destination
        // Note: We disconnect from compressor and route through effects instead
        // Only do this once - prevent errors on retry if first attempt partially succeeded
        if (this.masterGain && this.compressor && !this.effectsChainConnected) {
          const effectsInput = this.toneEffects.getInput();
          if (effectsInput) {
            // CRITICAL: Actually connect masterGain to effects chain!
            // This routes ALL audio (procedural samples, synth:* presets, piano)
            // through the effects before reaching destination.
            // Effects are dry by default (wet=0), users enable via FX panel.
            //
            // BUG FIX: Wrap in try-catch to handle partial connection failures
            try {
              // Disconnect masterGain from compressor (original: masterGain -> compressor -> destination)
              this.masterGain.disconnect(this.compressor);

              // Connect masterGain to effects input. Since we called Tone.setContext() above,
              // both our native nodes and Tone.js nodes are in the same AudioContext.
              // We use Tone.connect() which handles the native-to-Tone bridging.
              Tone.connect(this.masterGain, effectsInput);

              this.effectsChainConnected = true;
              logger.audio.log('Master gain connected to Tone.js effects chain');
            } catch (connectError) {
              // Reconnect to compressor as fallback to maintain audio path
              logger.audio.error('Failed to connect effects chain, falling back:', connectError);
              try {
                this.masterGain.connect(this.compressor);
              } catch {
                // Ignore - compressor may not be connected
              }
            }
          }
        }

        // Per-track synth instances are created lazily by the registries
        // and connected to that track's bus, not to a shared effects input.
        // The global Tone.js infrastructure (context, effects chain,
        // masterGain routing) is now fully prepared.

        this.toneInitialized = true;

        // Eagerly create the shared preview synths so SamplePicker hover
        // never gets a silent first note (merged_bug_002). Failures here
        // are non-fatal — preview just falls back to no-op.
        await this.ensurePreviewSynths().catch((err) => {
          logger.audio.warn('Preview synth init failed (previews will be silent):', err);
        });

        logger.audio.log('Tone.js infrastructure ready (per-track synths created on demand)');
      } catch (err) {
        // Clear promise on error to allow retry
        this.toneInitPromise = null;
        logger.audio.error('Tone.js initialization error:', err);
        throw err;
      }
    })();

    return this.toneInitPromise;
  }

  /**
   * Initialize AudioWorklet modules (metering, etc.)
   * Non-blocking — worklets are optional enhancements that fall back gracefully.
   */
  private async initializeWorklets(): Promise<void> {
    if (!this.audioContext || !supportsAudioWorklet(this.audioContext)) {
      logger.audio.log('AudioWorklet not supported, skipping worklet initialization');
      return;
    }

    // Initialize metering worklet for per-track level analysis
    try {
      const loaded = await meteringHost.initialize(this.audioContext);
      if (loaded) {
        logger.audio.log('Metering worklet initialized');
        // Retroactively connect any track buses created before the worklet loaded
        this.connectExistingBusesToMetering();
      }
    } catch (err) {
      logger.audio.warn('Metering worklet failed to load:', err);
    }

    // Load pitch-shift worklet for high-quality pitch shifting
    try {
      const pitchShiftUrl = new URL('./worklets/pitch-shift.worklet.ts', import.meta.url);
      this.pitchShiftLoaded = await loadWorkletModule(this.audioContext, pitchShiftUrl, 'pitch-shift-worklet');
    } catch (err) {
      logger.audio.warn('Pitch-shift worklet failed to load:', err);
    }

    // bug_004: shared-LFO worklet loader removed. The worklet processor
    // and its consumer wiring were never connected — voices used their
    // own per-voice Tone.LFO instances. Resurrect by re-adding the
    // worklet file + loader and wiring voice modulation to its outputs.

    // Attempt worklet scheduler upgrade (behind feature flag, default: off)
    try {
      await upgradeToWorkletScheduler(this.audioContext);
    } catch (err) {
      logger.audio.warn('Scheduler worklet upgrade failed:', err);
    }
  }

  /**
   * Connect all existing track buses to the metering worklet.
   * Called after the worklet loads (which is async and may complete
   * after track buses have already been created).
   */
  private connectExistingBusesToMetering(): void {
    if (!this.trackBusManager || !meteringHost.isAvailable()) return;
    for (const trackId of this.trackBusManager.getActiveTrackIds()) {
      const bus = this.trackBusManager.getOrCreateBus(trackId);
      meteringHost.connectTrack(trackId, bus.getOutputNode());
    }
    logger.audio.log(`Connected ${this.trackBusManager.getBusCount()} existing buses to metering`);
  }

  /**
   * Get a snapshot of all audio performance metrics.
   * Used by the debug overlay and window.audioDebug.metrics().
   */
  getAudioMetrics(): AudioMetricsSnapshot {
    return audioMetrics.getSnapshot();
  }

  /**
   * Get the metering host for connecting track meters.
   */
  getMeteringHost(): MeteringHost {
    return meteringHost;
  }

  /**
   * Check if AudioWorklet is supported in the current context.
   */
  supportsWorklets(): boolean {
    return this.audioContext ? supportsAudioWorklet(this.audioContext) : false;
  }

  /**
   * Mobile Chrome workaround: attach document-level listeners to unlock audio.
   * Chrome on Android requires user gesture to start audio, and the context
   * can become suspended again after periods of inactivity.
   * @see https://developer.chrome.com/blog/autoplay
   *
   * Uses promise locking to prevent concurrent resume() calls when multiple
   * events fire (e.g., touchstart + touchend on single tap).
   */
  private attachUnlockListeners(): void {
    if (this.unlockListenerAttached) return;
    this.unlockListenerAttached = true;

    // Store handler reference for cleanup
    this.unlockHandler = async () => {
      // Only unlock if we have a context and it's suspended
      if (!this.audioContext || this.audioContext.state !== 'suspended') {
        return;
      }

      // Prevent concurrent resume() calls
      if (this.resumeInProgress) {
        // Wait for existing resume to complete
        if (this.resumePromise) {
          await this.resumePromise;
        }
        return;
      }

      this.resumeInProgress = true;
      logger.audio.log('Unlocking AudioContext via user gesture');

      this.resumePromise = (async () => {
        try {
          await this.audioContext!.resume();
          logger.audio.log('AudioContext unlocked, state:', this.audioContext!.state);

          // Phase 29 fix: Also resume Tone.js context when Web Audio is unlocked
          // This ensures Tone.js synths (advanced:*, tone:*) resume after browser
          // suspends the AudioContext (e.g., tab goes to background).
          if (this.toneInitialized) {
            await Tone.start();
            logger.audio.log('Tone.js context resumed after unlock');
          }
        } catch (e) {
          logger.audio.error('Failed to unlock AudioContext:', e);
        } finally {
          this.resumeInProgress = false;
          this.resumePromise = null;
        }
      })();

      await this.resumePromise;
    };

    // Listen for various user gestures that can unlock audio
    // touchstart is crucial for mobile Chrome
    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, this.unlockHandler!, { once: false, passive: true });
    });

    logger.audio.log('Audio unlock listeners attached');
  }

  // Note: Audio unlock listeners are not removed because AudioEngine is a singleton
  // that persists for the lifetime of the application. If a dispose() method is
  // needed in the future, unlockHandler reference is available for cleanup.

  /**
   * Ensure audio context is running (call before playback)
   * Returns true if audio is ready to play
   *
   * iOS Safari can put the context in 'interrupted' state which also needs resume()
   * @see https://developer.apple.com/forums/thread/23499
   *
   * Phase 29 fix: Also ensures Tone.js context is resumed when Web Audio context
   * was suspended. This fixes the "instruments worked then stopped" bug where
   * Tone.js synths (advanced:*, tone:*) stop producing sound after browser
   * suspends the AudioContext (e.g., tab goes to background).
   */
  async ensureAudioReady(): Promise<boolean> {
    if (!this.audioContext) {
      logger.audio.warn('AudioContext not created');
      return false;
    }

    const state = this.audioContext.state as string;
    if (state === 'suspended' || state === 'interrupted') {
      logger.audio.log('Resuming AudioContext before playback, state:', state);
      try {
        await this.audioContext.resume();
        logger.audio.log('AudioContext resumed, state:', this.audioContext.state);

        // Phase 29 fix: Also resume Tone.js context if initialized
        // When the Web Audio context is suspended and resumed, Tone.js's internal
        // transport and nodes may be in an inconsistent state. Calling Tone.start()
        // ensures Tone.js is synchronized with the resumed AudioContext.
        if (this.toneInitialized) {
          logger.audio.log('Resuming Tone.js context after Web Audio resume...');
          await Tone.start();
          logger.audio.log('Tone.js context resumed, state:', Tone.getContext().state);
        }
      } catch (e) {
        logger.audio.error('Failed to resume AudioContext:', e);
        return false;
      }
    }

    return this.audioContext.state === 'running';
  }

  /**
   * Play a synthesizer note (real-time synthesis, not sample-based)
   * Phase 25: Added trackId for per-track audio routing via TrackBusManager
   * @param volume - Volume multiplier from P-lock (0-1, default 1)
   * @param trackId - Optional track ID for per-track audio routing
   */
  playSynthNote(
    noteId: string,
    presetName: string,
    semitone: number,
    time: number,
    duration?: number,
    volume: number = 1,
    trackId?: string
  ): void {
    const preset = SYNTH_PRESETS[presetName];
    if (!preset) {
      logger.audio.warn(`playSynthNote: Unknown preset "${presetName}", falling back to "lead"`);
    }
    const actualPreset = preset || SYNTH_PRESETS.lead;
    const frequency = semitoneToFrequency(semitone);

    logger.audio.log(`playSynthNote: noteId=${noteId}, preset=${presetName}, freq=${frequency.toFixed(1)}Hz, time=${time.toFixed(3)}, vol=${volume}`);

    // Phase 25: Route through TrackBusManager if trackId provided
    const destination = trackId && this.trackBusManager
      ? this.trackBusManager.getBusInput(trackId)
      : undefined;

    synthEngine.playNote(noteId, frequency, actualPreset, time, duration, volume, destination);
  }

  /**
   * Play a synth note with custom parameters
   */
  playSynthNoteWithParams(
    noteId: string,
    params: SynthParams,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    const frequency = semitoneToFrequency(semitone);
    synthEngine.playNote(noteId, frequency, params, time, duration);
  }

  stopSynthNote(noteId: string): void {
    synthEngine.stopNote(noteId);
  }

  getSynthPresets(): string[] {
    return Object.keys(SYNTH_PRESETS);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if Tone.js synths are initialized and ready.
   * Use this before playing tone:* or advanced:* presets.
   */
  isToneInitialized(): boolean {
    return this.toneInitialized;
  }

  /**
   * Check if Tone.js synths are ready for a specific preset type.
   */
  isToneSynthReady(presetType: 'tone' | 'advanced'): boolean {
    // Per-track synth instances are lazy-created through the registries.
    // "Ready" here means the global Tone.js infrastructure is set up;
    // actual track instances spin up on first play (or via preload).
    void presetType;
    return this.toneInitialized;
  }

  setTrackVolume(trackId: string, volume: number): void {
    // Phase 25: Use TrackBusManager for unified volume control
    if (this.trackBusManager) {
      this.trackBusManager.setTrackVolume(trackId, volume);
    }
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    // Phase 25: Use TrackBusManager for unified mute control
    if (this.trackBusManager) {
      this.trackBusManager.setTrackMuted(trackId, muted);
    }
  }

  /**
   * Play a sample at a specific time.
   *
   * @param sampleId - ID of the sample to play
   * @param trackId - ID of the track (for gain control)
   * @param time - AudioContext time to start playback
   * @param duration - Step duration in seconds (unused, kept for API compatibility)
   * @param pitchSemitones - Pitch shift in semitones (0 = original, 12 = octave up)
   * @param volume - Volume multiplier (0-1)
   */
  playSample(
    sampleId: string,
    trackId: string,
    time: number,
    duration?: number,
    pitchSemitones: number = 0,
    volume: number = 1
  ): void {
    if (!this.audioContext || !this.masterGain) {
      logger.audio.warn('AudioContext not initialized');
      return;
    }

    // Resume audio context if suspended (required by browsers)
    // Note: We don't await here because playSample is sync and called from scheduler
    // The ensureAudioReady() call in handlePlayPause awaits resume before playback starts
    if (this.audioContext.state === 'suspended') {
      logger.audio.log('Resuming suspended AudioContext');
      this.audioContext.resume().catch(err => {
        logger.audio.error('Failed to resume AudioContext:', err);
      });
    }

    const sample = this.samples.get(sampleId);
    if (!sample?.buffer) {
      logger.audio.warn(`Sample not found: ${sampleId}`, 'Available:', Array.from(this.samples.keys()));
      return;
    }

    // Log buffer details at playback time
    if (sampleId.startsWith('recording')) {
      logger.audio.log(`PLAYBACK ${sampleId}: buffer.length=${sample.buffer.length}, buffer.duration=${sample.buffer.duration.toFixed(3)}s, buffer.numberOfChannels=${sample.buffer.numberOfChannels}`);
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = sample.buffer;

    // Phase 25: Get track bus input for unified audio routing
    if (!this.trackBusManager) {
      logger.audio.warn('TrackBusManager not initialized, cannot play sample');
      return;
    }
    const trackInput = this.trackBusManager.getBusInput(trackId);

    // Create envelope gain for click prevention (micro-fades) and P-lock volume.
    // The gain ramp timing depends on whether the pitch-shift worklet is in
    // the chain — the worklet buffers one grain before producing output, so
    // the envelope must wait for that audio to arrive.
    const envGain = this.audioContext.createGain();

    // Apply pitch shift: worklet for large shifts (>6 semitones), native
    // playbackRate otherwise. When we engage the worklet we must
    //   (a) declare stereo output so both channels make it through, and
    //   (b) delay the envelope ramp by one grain so the fade runs over
    //       actual audio, not silence.
    let pitchNode: AudioWorkletNode | null = null;
    let pitchLatencySec = 0;
    if (Math.abs(pitchSemitones) > 6 && this.pitchShiftLoaded && this.audioContext) {
      const srcChannels = source.buffer.numberOfChannels;
      pitchNode = new AudioWorkletNode(this.audioContext, 'pitch-shift-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [srcChannels],
        processorOptions: { grainSize: PITCH_SHIFT_GRAIN_SIZE },
      });
      // Clamp to the worklet's declared parameter range. Web Audio
      // silently clamps out-of-range values, which previously made
      // `|pitchSemitones| > 24` produce wrong pitch with no warning
      // (bug_003). pitchSemitones can reach ±48 (transpose ±24 +
      // p-lock ±24), so this clamp is reachable through normal UI.
      const { ratio: pitchRatio, clamped } = pitchSemitonesToWorkletRatio(pitchSemitones);
      if (clamped) {
        logger.audio.warn(`Pitch shift ${pitchSemitones}st exceeds worklet range, clamped to ±24`);
      }
      (pitchNode.parameters as Map<string, AudioParam>).get('pitchRatio')!.value = pitchRatio;
      source.connect(pitchNode);
      pitchNode.connect(envGain);
      pitchLatencySec = PITCH_SHIFT_GRAIN_SIZE / this.audioContext.sampleRate;
    } else {
      // Native playbackRate (good for ±6 semitones)
      if (pitchSemitones !== 0) {
        source.playbackRate.value = Math.pow(2, pitchSemitones / 12);
      }
      source.connect(envGain);
    }

    // bug_009: anchor the envelope to actualStartTime, not eventTime.
    // For late-arriving notes (currentTime > time) the source's start
    // gets clamped forward; the envelope must move with it or the ramp
    // resolves in the past and the click-prevention fade is bypassed.
    const currentTime = this.audioContext.currentTime;
    const actualStartTime = Math.max(time, currentTime);
    const envStart = computeEnvelopeStart({ eventTime: time, currentTime, pitchLatencySec });
    envGain.gain.setValueAtTime(0, envStart);
    envGain.gain.linearRampToValueAtTime(volume, envStart + FADE_TIME);
    envGain.connect(trackInput);

    // For recordings, try playing immediately to test
    if (sampleId.startsWith('recording')) {
      logger.audio.log(`Starting recording at ${actualStartTime.toFixed(3)}, current=${currentTime.toFixed(3)}, duration limit=${duration?.toFixed(3)}`);
    }

    source.start(actualStartTime);

    // Memory leak fix: disconnect nodes when playback ends. When the pitch
    // worklet is engaged, buffered grains keep emitting for one latency
    // window after the source ends, so defer the disconnect by that much
    // to avoid cutting off the tail.
    source.onended = () => {
      const cleanup = () => {
        source.disconnect();
        pitchNode?.disconnect();
        envGain.disconnect();
      };
      if (pitchLatencySec > 0) {
        setTimeout(cleanup, Math.ceil(pitchLatencySec * 1000) + 10);
      } else {
        cleanup();
      }
    };
  }

  // Play immediately (for preview/testing)
  playNow(sampleId: string): void {
    if (!this.audioContext || !this.masterGain) return;

    const sample = this.samples.get(sampleId);
    if (!sample?.buffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = sample.buffer;
    source.connect(this.masterGain);
    source.start();

    // Memory leak fix: disconnect when done
    source.onended = () => {
      source.disconnect();
    };
  }

  /**
   * Remove a track's audio bus (call when track is deleted).
   * Also disposes any per-track tone/advanced synth instances to prevent
   * leaks when a track goes away.
   */
  removeTrackGain(trackId: string): void {
    this.toneSynthRegistry.remove(trackId);
    this.advancedSynthRegistry.remove(trackId);
    if (this.trackBusManager) {
      this.trackBusManager.removeBus(trackId);
      logger.audio.log(`Removed TrackBus for ${trackId}`);
    }
  }

  /**
   * Dispose any per-track tone/advanced synths for this track without
   * removing its audio bus. Call when a track changes its instrument
   * category (e.g. tone:* → sample:*, or advanced:supersaw →
   * tone:fm-bass) so the next note uses the right synth engine.
   */
  clearTrackSynths(trackId: string): void {
    this.toneSynthRegistry.remove(trackId);
    this.advancedSynthRegistry.remove(trackId);
  }

  /**
   * Get the compressor node (for monitoring/testing)
   */
  getCompressor(): DynamicsCompressorNode | null {
    return this.compressor;
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  /**
   * Convert absolute Web Audio time to relative Tone.js time offset
   *
   * Phase 22: Centralizes Tone.js time conversion to prevent timing bugs.
   * Ensures the offset is always positive (at least 1ms in the future).
   *
   * @param webAudioTime Absolute Web Audio context time
   * @returns Safe relative time offset for Tone.js scheduling
   */
  private toToneRelativeTime(webAudioTime: number): number {
    const relativeTime = webAudioTime - this.getCurrentTime();
    // Ensure minimum 1ms offset to prevent "start time must be greater than previous" errors
    return Math.max(0.001, relativeTime);
  }

  getSampleIds(): string[] {
    return Array.from(this.samples.keys());
  }

  getSample(id: string): Sample | undefined {
    return this.samples.get(id);
  }

  // Add a custom sample (for recordings)
  addSample(sample: Sample): void {
    this.samples.set(sample.id, sample);
    logger.audio.log(`Added sample: ${sample.id}, buffer duration: ${sample.buffer?.duration.toFixed(2)}s, channels: ${sample.buffer?.numberOfChannels}, sampleRate: ${sample.buffer?.sampleRate}, total samples: ${this.samples.size}`);
  }

  /**
   * Decode audio data into a buffer (converts to mono to match synthesized samples)
   * Phase 13B: Added proper error handling for decode failures
   */
  async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('AudioEngine not initialized');
    }

    // Phase 13B: Validate input
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('Cannot decode empty audio data');
    }

    let decodedBuffer: AudioBuffer;
    try {
      decodedBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      // Phase 13B: Handle decode errors gracefully
      // Common causes: corrupted file, unsupported format, empty data
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.audio.error(`Failed to decode audio data: ${message}`);
      throw new Error(`Failed to decode audio: ${message}`);
    }

    // Validate decoded buffer
    if (!decodedBuffer || decodedBuffer.length === 0) {
      throw new Error('Decoded audio buffer is empty');
    }

    // Convert to mono to match synthesized samples format
    const channels = decodedBuffer.numberOfChannels;
    const sampleRate = decodedBuffer.sampleRate;
    const length = decodedBuffer.length;

    logger.audio.log(`Decoded audio: ${channels} channels, ${sampleRate}Hz, ${length} samples`);

    // Create mono buffer
    const monoBuffer = this.audioContext.createBuffer(1, length, sampleRate);
    const monoData = monoBuffer.getChannelData(0);

    if (channels === 1) {
      monoData.set(decodedBuffer.getChannelData(0));
    } else {
      // Mix stereo to mono
      const left = decodedBuffer.getChannelData(0);
      const right = decodedBuffer.getChannelData(1);
      for (let i = 0; i < length; i++) {
        monoData[i] = (left[i] + right[i]) / 2;
      }
    }

    logger.audio.log(`Converted to mono: ${monoBuffer.numberOfChannels} channel, ${monoBuffer.sampleRate}Hz`);
    return monoBuffer;
  }

  // ========================
  // Tone.js Integration API
  // ========================

  /**
   * Check if Tone.js is initialized
   */
  isToneReady(): boolean {
    return this.toneInitialized;
  }

  /**
   * Get current effects state for session persistence
   */
  getEffectsState(): EffectsState {
    return this.toneEffects?.getState() ?? { ...DEFAULT_EFFECTS_STATE };
  }

  /**
   * Apply effects state from session load or multiplayer sync
   */
  applyEffectsState(state: EffectsState): void {
    if (!this.toneEffects) {
      logger.audio.warn('Cannot apply effects state: Tone.js not initialized');
      return;
    }
    this.toneEffects.applyState(state);
  }

  /**
   * Set reverb wet amount (0 = dry, 1 = fully wet)
   */
  setReverbWet(wet: number): void {
    this.toneEffects?.setReverbWet(wet);
  }

  /**
   * Set reverb decay time in seconds
   */
  setReverbDecay(decay: number): void {
    this.toneEffects?.setReverbDecay(decay);
  }

  /**
   * Set delay wet amount
   */
  setDelayWet(wet: number): void {
    this.toneEffects?.setDelayWet(wet);
  }

  /**
   * Set delay time (e.g., "8n", "4n", "16n")
   */
  setDelayTime(time: string): void {
    this.toneEffects?.setDelayTime(time);
  }

  /**
   * Set delay feedback (0 to 0.95)
   */
  setDelayFeedback(feedback: number): void {
    this.toneEffects?.setDelayFeedback(feedback);
  }

  /**
   * Set chorus wet amount
   */
  setChorusWet(wet: number): void {
    this.toneEffects?.setChorusWet(wet);
  }

  /**
   * Set chorus frequency
   */
  setChorusFrequency(frequency: number): void {
    this.toneEffects?.setChorusFrequency(frequency);
  }

  /**
   * Set chorus depth
   */
  setChorusDepth(depth: number): void {
    this.toneEffects?.setChorusDepth(depth);
  }

  /**
   * Set distortion wet amount (0 = dry, 1 = fully wet)
   */
  setDistortionWet(wet: number): void {
    this.toneEffects?.setDistortionWet(wet);
  }

  /**
   * Set distortion amount (0 = clean, 1 = heavy distortion)
   */
  setDistortionAmount(amount: number): void {
    this.toneEffects?.setDistortionAmount(amount);
  }

  /**
   * Enable or disable all effects (bypass mode)
   */
  setEffectsEnabled(enabled: boolean): void {
    this.toneEffects?.setEnabled(enabled);
  }

  /**
   * Check if effects are enabled
   */
  areEffectsEnabled(): boolean {
    return this.toneEffects?.isEnabled() ?? false;
  }

  /**
   * Set FM synthesis parameters for FM synth tracks
   * @param harmonicity Frequency ratio between modulator and carrier (0.5-10)
   * @param modulationIndex Intensity of modulation (0-20)
   */
  setFMParams(harmonicity: number, modulationIndex: number): void {
    this.toneOverrides.fmParams = { harmonicity, modulationIndex };
    this.toneSynthRegistry.forEach((synth) => {
      synth.setFMParams(harmonicity, modulationIndex);
    });
  }

  /**
   * Get current FM synthesis parameters. Returns the shared-control
   * override if any setFMParams call has been made, otherwise the first
   * registered track's FM params, otherwise null.
   */
  getFMParams(): { harmonicity: number; modulationIndex: number } | null {
    if (this.toneOverrides.fmParams) return this.toneOverrides.fmParams;
    const ids = this.toneSynthRegistry.activeTrackIds();
    if (ids.length === 0) return null;
    const first = this.toneSynthRegistry.getIfReady(ids[0]);
    return first?.getFMParams() ?? null;
  }

  /**
   * Play a Tone.js synth note
   * Used for advanced synth types (FM, AM, Membrane, Metal, etc.)
   *
   * Phase 22: Now accepts absolute Web Audio time (consistent with other play methods).
   * Time conversion to Tone.js is handled internally.
   *
   * @param presetName Tone.js synth preset (e.g., "fm-epiano", "membrane-kick")
   * @param semitone Semitone offset from C4 (0 = C4, 12 = C5, -12 = C3)
   * @param time Absolute Web Audio context time to start playback
   * @param duration Note duration (e.g., "8n", "4n", or seconds)
   * @param volume Volume multiplier from P-lock (0-1, default 1)
   * @param trackId Optional track ID for per-track audio routing via TrackBusManager
   */
  playToneSynth(
    presetName: ToneSynthType,
    semitone: number,
    time: number,
    duration: string | number = '8n',
    volume: number = 1,
    trackId?: string
  ): void {
    if (!this.toneInitialized) {
      logger.audio.warn('Cannot play Tone.js synth: not initialized');
      return;
    }

    // No trackId → SamplePicker preview path (or test). Use the shared
    // pre-created preview synth so the first note isn't dropped and no
    // phantom track bus/metering slot is allocated. See merged_bug_002.
    let synth: ToneSynthManager | null;
    if (!trackId) {
      synth = this.previewToneSynth;
      if (!synth) {
        // initializeTone() should have populated this; if it didn't, the
        // preview infrastructure failed and we can't recover here.
        logger.audio.warn('Preview tone synth not ready — skipping note');
        return;
      }
    } else {
      synth = this.toneSynthRegistry.getIfReady(trackId);
      if (!synth) {
        // Not pre-warmed. Kick off async creation for next time and skip
        // this note — the scheduler's first dispatch after adding a track
        // falls into this branch if preloadInstrumentsForTracks didn't run.
        this.toneSynthRegistry.getOrCreate(trackId).catch((err) => {
          logger.audio.error('Deferred tone synth creation failed:', err);
        });
        logger.audio.warn(`Tone synth for track ${trackId} not ready — skipping note`);
        return;
      }
    }

    const noteName = synth.semitoneToNoteName(semitone);
    const toneTime = this.toToneRelativeTime(time);
    synth.playNote(presetName, noteName, duration, toneTime, volume);
  }

  /**
   * Get available Tone.js synth presets. Uses the first created track's
   * list; falls back to the canonical set when no tracks yet exist.
   */
  getToneSynthPresets(): ToneSynthType[] {
    const ids = this.toneSynthRegistry.activeTrackIds();
    if (ids.length === 0) return [];
    return this.toneSynthRegistry.getIfReady(ids[0])?.getPresetNames() ?? [];
  }

  /**
   * Check if a sample ID is a Tone.js synth
   */
  isToneSynthSample(sampleId: string): boolean {
    return isToneSynth(sampleId);
  }

  /**
   * Get Tone.js preset from sample ID
   */
  getToneSynthFromSampleId(sampleId: string): ToneSynthType | null {
    return getToneSynthPreset(sampleId);
  }

  // ========================
  // Advanced Synth API
  // ========================

  /**
   * Play an advanced synth note (dual oscillator, filter envelope, LFO)
   *
   * Phase 22: Now accepts absolute Web Audio time (consistent with other play methods).
   * Time conversion to Tone.js is handled internally.
   *
   * @param presetName Advanced synth preset (e.g., "supersaw", "wobble-bass")
   * @param semitone Semitone offset from C4 (0 = C4, 12 = C5, -12 = C3)
   * @param time Absolute Web Audio context time to start playback
   * @param duration Note duration in seconds
   * @param volume Volume multiplier from P-lock (0-1, default 1)
   * @param trackId Optional track ID for per-track audio routing via TrackBusManager
   */
  playAdvancedSynth(
    presetName: string,
    semitone: number,
    time: number,
    duration: number = 0.3,
    volume: number = 1,
    trackId?: string
  ): void {
    if (!this.toneInitialized) {
      logger.audio.error('playAdvancedSynth BLOCKED: Tone.js not initialized', {
        audioContextState: this.audioContext?.state,
        preset: presetName,
      });
      return;
    }

    let synth: AdvancedSynthEngine | null;
    if (!trackId) {
      synth = this.previewAdvancedSynth;
      if (!synth) {
        logger.audio.warn('Preview advanced synth not ready — skipping note');
        return;
      }
    } else {
      synth = this.advancedSynthRegistry.getIfReady(trackId);
      if (!synth) {
        this.advancedSynthRegistry.getOrCreate(trackId).catch((err) => {
          logger.audio.error('Deferred advanced synth creation failed:', err);
        });
        logger.audio.warn(`Advanced synth for track ${trackId} not ready — skipping note`);
        return;
      }
    }

    if (!synth.isReady()) {
      logger.audio.error('playAdvancedSynth BLOCKED: advanced synth instance not ready', {
        diagnostics: synth.getDiagnostics(),
        preset: presetName,
      });
      return;
    }

    const preset = ADVANCED_SYNTH_PRESETS[presetName];
    if (!preset) {
      logger.audio.warn(`Unknown advanced synth preset: ${presetName}`);
      return;
    }

    synth.setPreset(presetName);
    const toneTime = this.toToneRelativeTime(time);
    synth.playNoteSemitone(semitone, duration, toneTime, volume);
  }

  /**
   * Advanced-synth diagnostics across every active track instance.
   * activeVoices is summed; other fields come from the first instance.
   */
  getAdvancedSynthDiagnostics(): import('./advancedSynth').AdvancedSynthDiagnostics | null {
    const ids = this.advancedSynthRegistry.activeTrackIds();
    if (ids.length === 0) return null;
    const first = this.advancedSynthRegistry.getIfReady(ids[0]);
    const baseline = first?.getDiagnostics();
    if (!baseline) return null;
    let totalActive = 0;
    this.advancedSynthRegistry.forEach((synth) => {
      totalActive += synth.getDiagnostics()?.activeVoices ?? 0;
    });
    return { ...baseline, activeVoices: totalActive };
  }

  // ─── Advanced Synth Parameter Setters (for XY Pad) ──────────────────
  // Fan out to every registered track instance AND store as an override so
  // tracks created later inherit the current shared-control state.

  setFilterFrequency(hz: number): void {
    this.advancedOverrides.filterFrequency = hz;
    this.advancedSynthRegistry.forEach((s) => s.setFilterFrequency(hz));
  }
  setFilterResonance(q: number): void {
    this.advancedOverrides.filterResonance = q;
    this.advancedSynthRegistry.forEach((s) => s.setFilterResonance(q));
  }
  setLfoRate(hz: number): void {
    this.advancedOverrides.lfoRate = hz;
    this.advancedSynthRegistry.forEach((s) => s.setLfoRate(hz));
  }
  setLfoAmount(amount: number): void {
    this.advancedOverrides.lfoAmount = amount;
    this.advancedSynthRegistry.forEach((s) => s.setLfoAmount(amount));
  }
  setAttack(seconds: number): void {
    this.advancedOverrides.attack = seconds;
    this.advancedSynthRegistry.forEach((s) => s.setAttack(seconds));
  }
  setRelease(seconds: number): void {
    this.advancedOverrides.release = seconds;
    this.advancedSynthRegistry.forEach((s) => s.setRelease(seconds));
  }
  setOscMix(mix: number): void {
    this.advancedOverrides.oscMix = mix;
    this.advancedSynthRegistry.forEach((s) => s.setOscMix(mix));
  }

  /**
   * Get available advanced synth presets
   */
  getAdvancedSynthPresets(): string[] {
    return Object.keys(ADVANCED_SYNTH_PRESETS);
  }

  /**
   * Check if a sample ID is an advanced synth
   */
  isAdvancedSynthSample(sampleId: string): boolean {
    return isAdvancedSynth(sampleId);
  }

  /**
   * Get advanced synth preset from sample ID
   */
  getAdvancedSynthFromSampleId(sampleId: string): string | null {
    return getAdvancedSynthPresetId(sampleId);
  }

  // ============================================================
  // Sampled Instruments (Phase 22)
  // ============================================================

  /**
   * Check if a preset name is a sampled instrument (e.g., 'piano')
   */
  isSampledInstrument(presetName: string): boolean {
    return isSampledInstrument(presetName);
  }

  /**
   * Check if a sampled instrument is ready for playback
   */
  isSampledInstrumentReady(instrumentId: string): boolean {
    const instrument = sampledInstrumentRegistry.get(instrumentId);
    return instrument?.isReady() ?? false;
  }

  /**
   * Load a sampled instrument (lazy loading)
   * Returns true if loaded successfully
   */
  async loadSampledInstrument(instrumentId: string): Promise<boolean> {
    return sampledInstrumentRegistry.load(instrumentId);
  }

  /**
   * Preload sampled instruments that are used by tracks
   * Call this when loading a session to ensure instruments are ready before playback
   *
   * Phase 23: Uses centralized collectSampledInstruments utility
   */
  async preloadInstrumentsForTracks(tracks: { id?: string; sampleId: string }[]): Promise<void> {
    // Use centralized utility for consistent handling of synth: and sampled: prefixes
    const instrumentsToLoad = collectSampledInstruments(tracks);

    // Pre-warm per-track tone/advanced synth instances so the first note
    // doesn't pay initialisation latency. Tracks without an `id` are
    // preview-style calls (e.g. SamplePicker) and get no per-track synth.
    const toneWarms: Promise<void>[] = [];
    const advancedWarms: Promise<void>[] = [];
    for (const t of tracks) {
      if (!t.id) continue;
      if (t.sampleId.startsWith('tone:')) {
        toneWarms.push(this.warmToneSynthForTrack(t.id));
      } else if (t.sampleId.startsWith('advanced:')) {
        advancedWarms.push(this.warmAdvancedSynthForTrack(t.id));
      }
    }

    if (instrumentsToLoad.size === 0 && toneWarms.length === 0 && advancedWarms.length === 0) {
      logger.audio.log('No instruments to preload');
      return;
    }

    // Run all three preloads in parallel.
    const [sampledResults] = await Promise.all([
      Promise.all(
        Array.from(instrumentsToLoad).map(async id => {
          const success = await sampledInstrumentRegistry.load(id);
          return { id, success };
        })
      ),
      Promise.all(toneWarms),
      Promise.all(advancedWarms),
    ]);

    const successful = sampledResults.filter(r => r.success).map(r => r.id);
    const failed = sampledResults.filter(r => !r.success).map(r => r.id);

    if (successful.length > 0) {
      logger.audio.log(`Preloaded sampled instruments: ${successful.join(', ')}`);
    }
    if (failed.length > 0) {
      logger.audio.warn(`Failed to preload sampled instruments: ${failed.join(', ')}`);
    }
    if (toneWarms.length > 0 || advancedWarms.length > 0) {
      logger.audio.log(`Pre-warmed ${toneWarms.length} tone + ${advancedWarms.length} advanced synth instance(s)`);
    }
  }

  /**
   * Play a sampled instrument note
   *
   * @param instrumentId The instrument to play (e.g., 'piano')
   * @param noteId Unique ID for this note instance
   * @param midiNote MIDI note number (60 = C4)
   * @param time Absolute Web Audio time to start (currently ignored - plays immediately)
   * @param duration Note duration in seconds
   * @param volume Note volume (0-1)
   */
  playSampledInstrument(
    instrumentId: string,
    noteId: string,
    midiNote: number,
    _time: number,
    duration: number = 0.3,
    volume: number = 1,
    trackId?: string
  ): void {
    const instrument = sampledInstrumentRegistry.get(instrumentId);
    if (!instrument) {
      logger.audio.warn(`Cannot play sampled instrument: ${instrumentId} not registered`);
      return;
    }

    if (!instrument.isReady()) {
      logger.audio.warn(`Cannot play sampled instrument: ${instrumentId} not loaded`);
      return;
    }

    // Route through TrackBusManager if trackId provided (enables metering & per-track volume)
    const destination = trackId && this.trackBusManager
      ? this.trackBusManager.getBusInput(trackId)
      : undefined;

    instrument.playNote(noteId, midiNote, 0, duration, volume, 100, destination);
  }

  /**
   * Get the loading state of a sampled instrument (for UI)
   * Phase 23: Exposes loading state for UI components
   */
  getSampledInstrumentState(instrumentId: string): 'idle' | 'loading' | 'ready' | 'error' {
    return sampledInstrumentRegistry.getState(instrumentId);
  }

  /**
   * Subscribe to sampled instrument state changes (for UI updates)
   * Phase 23: Returns unsubscribe function
   */
  onSampledInstrumentStateChange(
    callback: (instrumentId: string, state: 'idle' | 'loading' | 'ready' | 'error', error?: Error) => void
  ): () => void {
    return sampledInstrumentRegistry.onStateChange(callback);
  }

  /**
   * Acquire cache references for a sampled instrument
   * Phase 23: Call when a track starts using this instrument
   */
  acquireInstrumentSamples(instrumentId: string): void {
    sampledInstrumentRegistry.acquireInstrumentSamples(instrumentId);
  }

  /**
   * Release cache references for a sampled instrument
   * Phase 23: Call when a track stops using this instrument
   */
  releaseInstrumentSamples(instrumentId: string): void {
    sampledInstrumentRegistry.releaseInstrumentSamples(instrumentId);
  }

  /**
   * Dispose all audio resources to prevent memory leaks
   * Called during HMR or explicit cleanup
   */
  dispose(): void {
    logger.audio.log('Disposing AudioEngine...');

    // Stop basic synth engine (clears activeVoices and pending timers)
    synthEngine.stopAll();

    // BUG FIX: Stop and clear Tone.js Transport to prevent stale scheduled events
    // During HMR, the Transport can retain scheduled callbacks from old context
    // that cause "AudioContext mismatch" errors when they try to fire
    try {
      Tone.getTransport().stop();
      Tone.getTransport().cancel(); // Clear all scheduled events
      logger.audio.log('Tone.js Transport stopped and cleared');
    } catch (e) {
      logger.audio.warn('Failed to stop Tone.js Transport:', e);
    }

    // Dispose Tone.js component managers
    this.toneEffects?.dispose();
    // Registries dispose each per-track synth instance via the factory's
    // dispose callback.
    this.toneSynthRegistry.clear();
    this.advancedSynthRegistry.clear();
    // Shared preview synths created at initializeTone — see merged_bug_002.
    this.previewToneSynth?.dispose();
    this.previewAdvancedSynth?.dispose();
    this.previewToneSynth = null;
    this.previewAdvancedSynth = null;

    // Clear track buses
    this.trackBusManager?.dispose();

    // Dispose worklet hosts
    meteringHost.dispose();
    audioMetrics.dispose();

    // Clear sampled instruments
    sampledInstrumentRegistry.dispose();

    // Remove unlock event listeners to prevent stale handlers
    if (this.unlockHandler) {
      const unlockEvents = ['touchstart', 'touchend', 'click', 'keydown'];
      for (const event of unlockEvents) {
        document.removeEventListener(event, this.unlockHandler);
      }
      this.unlockHandler = null;
    }

    // Disconnect native audio nodes
    this.masterGain?.disconnect();
    this.compressor?.disconnect();

    // Clear sample buffers
    this.samples.clear();

    // Reset all state
    this.toneEffects = null;
    this.advancedOverrides = {};
    this.toneOverrides = {};
    this.trackBusManager = null;
    this.masterGain = null;
    this.compressor = null;
    this.toneInitialized = false;
    this.toneInitPromise = null;
    this.effectsChainConnected = false;
    this.initialized = false;
    this.unlockListenerAttached = false;

    // Note: Not closing AudioContext - it may be reused if re-initialized
    // Closing would require user gesture to create a new one

    logger.audio.log('AudioEngine disposed');
  }
}

// Singleton instance
export const audioEngine = new AudioEngine();

// HMR cleanup - prevents event listener leaks during development
registerHmrDispose('AudioEngine', () => audioEngine.dispose());

// Re-export types for convenience
export type { EffectsState, ToneSynthType };
