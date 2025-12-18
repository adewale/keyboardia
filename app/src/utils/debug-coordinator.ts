/**
 * Debug Coordinator
 *
 * Central control point for all debug subsystems. Parses URL flags and
 * coordinates debug mode activation across the application.
 *
 * URL Flags:
 *   ?debug=1         - Enable all debug features (UI overlay, logging, tracing)
 *   ?trace=1         - Enable event tracing only
 *   ?audio-debug=1   - Enable audio state debugging only
 *   ?log=1           - Enable log persistence only
 *   ?bug-detect=1    - Enable periodic bug pattern detection
 *
 * Example: http://localhost:5173/?debug=1
 *
 * This module should be initialized early in app startup (main.tsx).
 */

import { initLogStore, isPersistenceEnabled, storeLog, getLogStats } from './log-store';
import { initDebugTracer } from './debug-tracer';
import { initPlaybackDebug } from '../audio/playback-state-debug';
import { initBugPatterns, runAllDetections } from './bug-patterns';
import { initAudioDebugTools } from '../audio/debug-audio-tools';

// Global type declarations
declare global {
  interface Window {
    __DEBUG_MODE__: boolean;
    __DEBUG_FLAGS__: DebugFlags;
    __runFullDiagnostics__: () => Promise<DiagnosticsReport>;
    __getDebugStatus__: () => DebugStatus;
  }
}

export interface DebugFlags {
  debug: boolean;        // Master flag - enables everything
  trace: boolean;        // Event tracing (debug-tracer.ts)
  audioDebug: boolean;   // Audio state debugging (playback-state-debug.ts)
  logPersist: boolean;   // Log persistence to IndexedDB (log-store.ts)
  bugDetect: boolean;    // Periodic bug pattern detection
}

export interface DebugStatus {
  flags: DebugFlags;
  sessionId: string;
  logStoreEnabled: boolean;
  tracerEnabled: boolean;
  audioDebugEnabled: boolean;
  bugDetectionActive: boolean;
  lastBugDetection: number | null;
  detectedBugs: number;
}

export interface DiagnosticsReport {
  timestamp: string;
  environment: string;
  flags: DebugFlags;
  logStats: {
    totalLogs: number;
    byLevel: Record<string, number>;
    oldestLog: string | null;
    newestLog: string | null;
  };
  bugDetection: {
    patternsChecked: number;
    bugsDetected: Array<{ id: string; confidence: string; evidence: unknown }>;
  };
  recommendations: string[];
}

// Internal state
let bugDetectionInterval: ReturnType<typeof setInterval> | null = null;
let lastBugDetectionTime: number | null = null;
let detectedBugCount = 0;

/**
 * Parse URL flags
 */
function parseUrlFlags(): DebugFlags {
  if (typeof window === 'undefined') {
    return { debug: false, trace: false, audioDebug: false, logPersist: false, bugDetect: false };
  }

  const params = new URLSearchParams(window.location.search);

  const debug = params.get('debug') === '1';

  return {
    debug,
    trace: debug || params.get('trace') === '1',
    audioDebug: debug || params.get('audio-debug') === '1',
    logPersist: debug || params.get('log') === '1' || import.meta.env.DEV,
    bugDetect: debug || params.get('bug-detect') === '1',
  };
}

/**
 * Apply debug flags to all subsystems
 */
function applyDebugFlags(flags: DebugFlags): void {
  if (typeof window === 'undefined') return;

  // Store flags globally
  window.__DEBUG_MODE__ = flags.debug;
  window.__DEBUG_FLAGS__ = flags;

  // Enable tracer
  window.__DEBUG_TRACE__ = flags.trace;
  if (flags.trace) {
    console.log('[Debug Coordinator] Event tracing enabled');
  }

  // Enable audio debug
  window.__AUDIO_DEBUG__ = flags.audioDebug;
  if (flags.audioDebug) {
    console.log('[Debug Coordinator] Audio state debugging enabled');
  }

  // Enable log persistence
  window.__LOG_PERSIST__ = flags.logPersist;
  if (flags.logPersist) {
    console.log('[Debug Coordinator] Log persistence enabled');
  }

  // Start periodic bug detection
  if (flags.bugDetect) {
    startBugDetection();
  }
}

/**
 * Start periodic bug detection
 */
function startBugDetection(): void {
  if (bugDetectionInterval) return;

  console.log('[Debug Coordinator] Periodic bug detection started (every 30s)');

  // Run immediately
  runBugDetection();

  // Then every 30 seconds
  bugDetectionInterval = setInterval(runBugDetection, 30000);
}

/**
 * Run bug detection and log results
 */
function runBugDetection(): void {
  try {
    lastBugDetectionTime = Date.now();
    const results = runAllDetections();

    const detected = Array.from(results.entries())
      .filter(([, result]) => result.detected);

    detectedBugCount = detected.length;

    if (detected.length > 0) {
      console.warn(`[Bug Detection] Found ${detected.length} potential bugs:`);
      for (const [patternId, result] of detected) {
        console.warn(`  - ${patternId}: ${result.message || 'detected'}`);

        // Log to persistent store
        if (isPersistenceEnabled()) {
          storeLog('warn', 'bug-detection', `Pattern detected: ${patternId}`, {
            patternId,
            confidence: result.confidence,
            evidence: result.evidence,
            message: result.message,
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error('[Bug Detection] Error running detection:', error);
  }
}

/**
 * Stop bug detection
 */
function stopBugDetection(): void {
  if (bugDetectionInterval) {
    clearInterval(bugDetectionInterval);
    bugDetectionInterval = null;
    console.log('[Debug Coordinator] Bug detection stopped');
  }
}

/**
 * Get current debug status
 */
function getDebugStatus(): DebugStatus {
  const flags = window.__DEBUG_FLAGS__ || parseUrlFlags();

  return {
    flags,
    sessionId: window.__LOG_SESSION_ID__ || 'unknown',
    logStoreEnabled: isPersistenceEnabled(),
    tracerEnabled: window.__DEBUG_TRACE__ === true,
    audioDebugEnabled: window.__AUDIO_DEBUG__ === true,
    bugDetectionActive: bugDetectionInterval !== null,
    lastBugDetection: lastBugDetectionTime,
    detectedBugs: detectedBugCount,
  };
}

/**
 * Run full diagnostics and return a report
 */
async function runFullDiagnostics(): Promise<DiagnosticsReport> {
  const flags = window.__DEBUG_FLAGS__ || parseUrlFlags();
  const recommendations: string[] = [];

  // Get log statistics
  let logStats = {
    totalLogs: 0,
    byLevel: {} as Record<string, number>,
    oldestLog: null as string | null,
    newestLog: null as string | null,
  };

  try {
    const stats = await getLogStats();
    logStats = {
      totalLogs: stats.totalLogs,
      byLevel: stats.byLevel,
      oldestLog: stats.oldestLog ? new Date(stats.oldestLog).toISOString() : null,
      newestLog: stats.newestLog ? new Date(stats.newestLog).toISOString() : null,
    };

    // Check log store health
    if (stats.totalLogs > 40000) {
      recommendations.push(`Log store has ${stats.totalLogs} entries - consider clearing old logs`);
    }
  } catch {
    recommendations.push('Could not access log store - IndexedDB may be unavailable');
  }

  // Run bug detection
  const bugResults = runAllDetections();
  const detectedBugs = Array.from(bugResults.entries())
    .filter(([, r]) => r.detected)
    .map(([id, r]) => ({
      id,
      confidence: r.confidence,
      evidence: r.evidence,
    }));

  if (detectedBugs.length > 0) {
    recommendations.push(`Found ${detectedBugs.length} potential bugs - review immediately`);
  }

  // Check if debug features are enabled
  if (!flags.trace) {
    recommendations.push('Event tracing is disabled - enable with ?trace=1 for detailed debugging');
  }

  if (!flags.audioDebug) {
    recommendations.push('Audio debugging is disabled - enable with ?audio-debug=1 for audio issues');
  }

  return {
    timestamp: new Date().toISOString(),
    environment: import.meta.env.DEV ? 'development' : 'production',
    flags,
    logStats,
    bugDetection: {
      patternsChecked: bugResults.size,
      bugsDetected: detectedBugs,
    },
    recommendations,
  };
}

/**
 * Initialize the debug coordinator
 * Call this early in app startup (main.tsx)
 */
export function initDebugCoordinator(): void {
  if (typeof window === 'undefined') return;

  // Parse URL flags
  const flags = parseUrlFlags();

  // Initialize all subsystems (order matters)
  initLogStore();           // Must be first - other systems may log
  initDebugTracer();        // Event tracing
  initPlaybackDebug();      // Audio state debugging
  initBugPatterns();        // Bug pattern registry
  initAudioDebugTools();    // Phase 25: TrackBus, FM params, volume metering

  // Apply flags to enable/disable features
  applyDebugFlags(flags);

  // Expose global diagnostic functions
  window.__getDebugStatus__ = getDebugStatus;
  window.__runFullDiagnostics__ = runFullDiagnostics;

  // Log activation
  const enabledFeatures = [];
  if (flags.debug) enabledFeatures.push('full debug mode');
  if (flags.trace) enabledFeatures.push('tracing');
  if (flags.audioDebug) enabledFeatures.push('audio debug');
  if (flags.logPersist) enabledFeatures.push('log persistence');
  if (flags.bugDetect) enabledFeatures.push('bug detection');

  console.log(`
[Debug Coordinator] Initialized
   URL: ${window.location.href}
   Enabled: ${enabledFeatures.length > 0 ? enabledFeatures.join(', ') : 'none (add ?debug=1 to URL)'}

   Commands:
     __getDebugStatus__()        - Get current debug state
     __runFullDiagnostics__()    - Run full diagnostics report
     __getRecentLogs__(100)      - Get recent logs
     __searchLogs__('error')     - Search logs
     __exportLogsToFile__()      - Export logs to JSON file
     __runBugDetection__()       - Check for known bug patterns

   Audio Debug (Phase 25):
     __inspectTrackBuses__()     - Inspect all TrackBus instances
     __visualizeAudioRouting__() - Show audio routing diagram
     __monitorFMParams__()       - Monitor FM synth parameters
     __startVolumeMetering__()   - Start real-time volume metering
  `);

  // Log to persistent store
  if (flags.logPersist) {
    storeLog('log', 'debug-coordinator', 'Debug coordinator initialized', {
      flags,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }).catch(() => {});
  }
}

/**
 * Check if full debug mode is enabled
 */
export function isDebugMode(): boolean {
  return typeof window !== 'undefined' && window.__DEBUG_MODE__ === true;
}

/**
 * Get current debug flags
 */
export function getDebugFlags(): DebugFlags {
  if (typeof window !== 'undefined' && window.__DEBUG_FLAGS__) {
    return window.__DEBUG_FLAGS__;
  }
  return parseUrlFlags();
}

// Export for cleanup
export { stopBugDetection, runBugDetection };
