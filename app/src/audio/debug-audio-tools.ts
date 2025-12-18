/**
 * Phase 25: Audio Debugging Tools
 *
 * Provides console-accessible debugging utilities for:
 * 1. TrackBus instance inspection
 * 2. Audio routing visualization
 * 3. FM parameter monitoring
 * 4. Volume level metering
 *
 * Usage: Call these functions from the browser console after loading the app
 * Example: window.__inspectTrackBuses__()
 */

import { logger } from '../utils/logger';
import type { AudioEngine } from './engine';

// Type declaration for window globals
declare global {
  interface Window {
    __audioEngine__?: AudioEngine;
    __inspectTrackBuses__: () => TrackBusInspection;
    __visualizeAudioRouting__: () => void;
    __monitorFMParams__: (trackId?: string) => FMMonitorResult;
    __startVolumeMetering__: (trackId?: string) => () => void;
  }
}

export interface TrackBusInfo {
  trackId: string;
  volume: number;
  muted: boolean;
  pan: number;
  isDisposed: boolean;
}

export interface TrackBusInspection {
  busCount: number;
  buses: TrackBusInfo[];
  masterGainValue: number;
  timestamp: string;
}

export interface FMMonitorResult {
  harmonicity: number;
  modulationIndex: number;
  presetDefaults: Record<string, { harmonicity: number; modulationIndex: number }>;
}

/**
 * Get the audio engine from window
 */
function getEngine(): AudioEngine | null {
  if (typeof window === 'undefined') return null;
  return window.__audioEngine__ ?? null;
}

/**
 * 1. TrackBus Instance Inspection
 * Shows all active TrackBus instances with their current state
 */
export function inspectTrackBuses(): TrackBusInspection {
  const engine = getEngine();
  if (!engine) {
    console.warn('[Audio Debug] Audio engine not initialized');
    return { busCount: 0, buses: [], masterGainValue: 0, timestamp: new Date().toISOString() };
  }

  // Access internal trackBusManager (requires exposed method or direct access)
  const trackBusManager = (engine as unknown as { trackBusManager?: TrackBusManagerDebug }).trackBusManager;
  if (!trackBusManager) {
    console.warn('[Audio Debug] TrackBusManager not available');
    return { busCount: 0, buses: [], masterGainValue: 0, timestamp: new Date().toISOString() };
  }

  const activeTrackIds = trackBusManager.getActiveTrackIds?.() ?? [];
  const buses: TrackBusInfo[] = activeTrackIds.map((trackId: string) => ({
    trackId,
    volume: trackBusManager.getTrackVolume?.(trackId) ?? 1,
    muted: trackBusManager.isTrackMuted?.(trackId) ?? false,
    pan: trackBusManager.getTrackPan?.(trackId) ?? 0,
    isDisposed: false,
  }));

  const result: TrackBusInspection = {
    busCount: buses.length,
    buses,
    masterGainValue: 1, // Would need access to masterGain
    timestamp: new Date().toISOString(),
  };

  // Pretty print to console
  console.group('[Audio Debug] TrackBus Inspection');
  console.log(`Active buses: ${result.busCount}`);
  console.table(result.buses);
  console.groupEnd();

  return result;
}

// Type for accessing internal trackBusManager
interface TrackBusManagerDebug {
  getActiveTrackIds(): string[];
  getTrackVolume(trackId: string): number;
  isTrackMuted(trackId: string): boolean;
  getTrackPan(trackId: string): number;
  getBusCount(): number;
}

/**
 * 2. Audio Routing Visualization
 * Logs a text-based visualization of the current audio routing
 */
export function visualizeAudioRouting(): void {
  const engine = getEngine();
  if (!engine) {
    console.warn('[Audio Debug] Audio engine not initialized');
    return;
  }

  const effectsEnabled = engine.areEffectsEnabled?.() ?? false;
  const effectsState = engine.getEffectsState?.() ?? null;
  const trackBusManager = (engine as unknown as { trackBusManager?: TrackBusManagerDebug }).trackBusManager;
  const busCount = trackBusManager?.getBusCount?.() ?? 0;

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                     AUDIO ROUTING DIAGRAM                         ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │                    AUDIO SOURCES                            │  ║
║  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │  ║
║  │  │  Samples  │ │synth:* via│ │tone:* via │ │advanced:* │   │  ║
║  │  │   (${String(busCount).padStart(2)} )   │ │TrackBus   │ │note vol   │ │note vol   │   │  ║
║  │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘   │  ║
║  └────────│─────────────│─────────────│─────────────│─────────┘  ║
║           │             │             │             │             ║
║           └──────┬──────┴──────┬──────┴──────┬──────┘             ║
║                  │             │             │                    ║
║                  ▼             │             │                    ║
║           ┌──────────────┐     │             │                    ║
║           │ TrackBusManager    │             │                    ║
║           │  (per-track        │             │                    ║
║           │   Vol/Mute/Pan)    │             │                    ║
║           └────────┬─────┘     │             │                    ║
║                    │           │             │                    ║
║                    └─────┬─────┴─────┬───────┘                    ║
║                          ▼           ▼                            ║
║                  ┌───────────────────────────┐                    ║
║                  │        Master Gain        │                    ║
║                  └─────────────┬─────────────┘                    ║
║                                │                                  ║
║                                ▼                                  ║
║                  ┌───────────────────────────┐                    ║
║                  │     Tone.js Effects       │ ${effectsEnabled ? '(ACTIVE)' : '(BYPASS)'}          ║
║                  │ Reverb: ${String(effectsState?.reverb?.wet?.toFixed(2) ?? '0.00').padStart(5)}              │                    ║
║                  │ Delay:  ${String(effectsState?.delay?.wet?.toFixed(2) ?? '0.00').padStart(5)}              │                    ║
║                  │ Chorus: ${String(effectsState?.chorus?.wet?.toFixed(2) ?? '0.00').padStart(5)}              │                    ║
║                  └─────────────┬─────────────┘                    ║
║                                │                                  ║
║                                ▼                                  ║
║                  ┌───────────────────────────┐                    ║
║                  │       Compressor          │                    ║
║                  └─────────────┬─────────────┘                    ║
║                                │                                  ║
║                                ▼                                  ║
║                  ┌───────────────────────────┐                    ║
║                  │    Audio Destination      │                    ║
║                  │       (Speakers)          │                    ║
║                  └───────────────────────────┘                    ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
  `);

  // Log additional details
  console.group('[Audio Debug] Routing Details');
  console.log('Track buses:', busCount);
  console.log('Effects enabled:', effectsEnabled);
  if (effectsState) {
    console.log('Effects state:', effectsState);
  }
  console.groupEnd();
}

/**
 * 3. FM Parameter Monitoring
 * Shows current FM synth parameters
 */
export function monitorFMParams(_trackId?: string): FMMonitorResult {
  const engine = getEngine();
  if (!engine) {
    console.warn('[Audio Debug] Audio engine not initialized');
    return {
      harmonicity: 0,
      modulationIndex: 0,
      presetDefaults: {},
    };
  }

  const fmParams = engine.getFMParams?.() ?? { harmonicity: 3, modulationIndex: 10 };

  // FM preset defaults (from toneSynths.ts)
  const presetDefaults: Record<string, { harmonicity: number; modulationIndex: number }> = {
    'fm-epiano': { harmonicity: 3.01, modulationIndex: 10 },
    'fm-bass': { harmonicity: 2, modulationIndex: 8 },
    'fm-bell': { harmonicity: 5.01, modulationIndex: 14 },
  };

  console.group('[Audio Debug] FM Parameters');
  console.log(`Current Harmonicity: ${fmParams.harmonicity}`);
  console.log(`Current Mod Index: ${fmParams.modulationIndex}`);
  console.log('Preset Defaults:', presetDefaults);
  console.log(`
    Harmonicity: Frequency ratio between modulator and carrier
    - Low (0.5-2): Bass tones, subtle modulation
    - Medium (2-5): Electric piano, bell-like tones
    - High (5-10): Metallic, complex harmonics

    Modulation Index: Intensity of FM modulation
    - Low (0-5): Subtle, warm tones
    - Medium (5-12): Classic FM sounds
    - High (12-20): Aggressive, distorted tones
  `);
  console.groupEnd();

  return {
    harmonicity: fmParams.harmonicity,
    modulationIndex: fmParams.modulationIndex,
    presetDefaults,
  };
}

/**
 * 4. Volume Level Metering
 * Starts real-time volume metering for a track
 * Returns a stop function to cancel the metering
 */
export function startVolumeMetering(trackId?: string): () => void {
  const engine = getEngine();
  if (!engine) {
    console.warn('[Audio Debug] Audio engine not initialized');
    return () => {};
  }

  const ctx = engine.getAudioContext?.();
  if (!ctx) {
    console.warn('[Audio Debug] AudioContext not available');
    return () => {};
  }

  // Create an analyser node
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  // For master level, connect to compressor output
  const compressor = engine.getCompressor?.();
  if (compressor) {
    compressor.connect(analyser);
  }

  let running = true;
  let frameCount = 0;

  const meter = () => {
    if (!running) return;

    analyser.getByteFrequencyData(dataArray);

    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const db = 20 * Math.log10(rms / 255);

    // Only log every 10 frames (~6 times per second at 60fps)
    if (frameCount % 10 === 0) {
      const bars = Math.max(0, Math.round((db + 60) / 2));
      const meter = '█'.repeat(bars) + '░'.repeat(30 - bars);
      const label = trackId ? `Track ${trackId}` : 'Master';
      console.log(`[${label}] ${meter} ${db.toFixed(1)} dB`);
    }

    frameCount++;
    requestAnimationFrame(meter);
  };

  console.log('[Audio Debug] Volume metering started. Call the returned function to stop.');
  meter();

  // Return stop function
  return () => {
    running = false;
    analyser.disconnect();
    console.log('[Audio Debug] Volume metering stopped.');
  };
}

/**
 * Initialize audio debug tools
 * Call this during app startup
 */
export function initAudioDebugTools(): void {
  if (typeof window === 'undefined') return;

  // Expose tools globally
  window.__inspectTrackBuses__ = inspectTrackBuses;
  window.__visualizeAudioRouting__ = visualizeAudioRouting;
  window.__monitorFMParams__ = monitorFMParams;
  window.__startVolumeMetering__ = startVolumeMetering;

  logger.audio.log(`
[Audio Debug Tools] Initialized
   Commands:
     __inspectTrackBuses__()        - Inspect all active TrackBus instances
     __visualizeAudioRouting__()    - Show audio routing diagram
     __monitorFMParams__()          - Monitor FM synth parameters
     __startVolumeMetering__()      - Start real-time volume metering (returns stop function)
  `);
}
