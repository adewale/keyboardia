/**
 * Bug Pattern Registry
 *
 * This module documents known bug patterns, their symptoms, detection strategies,
 * and fixes. It provides:
 *
 * 1. Pattern definitions - Structured documentation of known bugs
 * 2. Runtime detection - Functions that can detect patterns at runtime
 * 3. Codebase scanning - Patterns for static analysis
 * 4. Log-based detection - Query persistent logs for symptom patterns
 * 5. Fix guidance - Steps to resolve each pattern
 *
 * When a bug is fixed, add a new pattern here so:
 * - Future developers can recognize the symptoms
 * - Automated tools can detect similar issues
 * - The fix is documented for reference
 */

import { tracer } from './debug-tracer';
import type { StoredLog } from './log-store';

/**
 * Bug pattern severity levels
 */
export type BugSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Bug pattern categories
 */
export type BugCategory =
  | 'audio-context'
  | 'singleton'
  | 'state-management'
  | 'timing'
  | 'memory-leak'
  | 'race-condition'
  | 'routing';

/**
 * Bug pattern definition
 */
export interface BugPattern {
  id: string;
  name: string;
  category: BugCategory;
  severity: BugSeverity;
  description: string;
  symptoms: string[];
  rootCause: string;
  detection: {
    runtime?: () => BugDetectionResult;
    codePatterns?: string[]; // Regex patterns to search in code
    logPatterns?: string[];  // Patterns to look for in logs
  };
  fix: {
    summary: string;
    steps: string[];
    codeExample?: string;
  };
  prevention: string[];
  relatedFiles: string[];
  testFile?: string;
  dateDiscovered?: string;
  prLink?: string;
}

/**
 * Result of runtime bug detection
 */
export interface BugDetectionResult {
  detected: boolean;
  confidence: 'certain' | 'likely' | 'possible';
  evidence: Record<string, unknown>;
  message?: string;
}

/**
 * Registry of all known bug patterns
 */
export const BUG_PATTERNS: BugPattern[] = [
  // ============================================================================
  // AUDIO CONTEXT BUGS
  // ============================================================================
  {
    id: 'audio-context-mismatch',
    name: 'AudioContext Mismatch (HMR)',
    category: 'audio-context',
    severity: 'critical',
    description:
      'Tone.js nodes created in different AudioContexts cannot be connected. ' +
      'This commonly occurs during Hot Module Reload when singleton patterns ' +
      'retain stale nodes from the previous context.',
    symptoms: [
      'InvalidAccessError: cannot connect to an AudioNode belonging to a different audio context',
      'Audio stops working after HMR/hot reload',
      'Works after full page refresh but breaks after code changes',
    ],
    rootCause:
      'Singleton instances (getXXX() functions) cache Tone.js nodes. During HMR, ' +
      'a new AudioContext is created but the singleton retains nodes from the old context. ' +
      'When new code tries to connect fresh nodes to cached nodes, the error occurs.',
    detection: {
      runtime: () => detectAudioContextMismatch(),
      codePatterns: [
        'let\\s+\\w+Instance.*=\\s*null',  // Singleton pattern
        'if\\s*\\(!\\w+Instance\\)',        // Lazy initialization
        'new\\s+Tone\\.\\w+',               // Tone.js node creation
      ],
      logPatterns: [
        'cannot connect to an AudioNode',
        'different audio context',
      ],
    },
    fix: {
      summary: 'Use fresh instances instead of singletons for Tone.js components',
      steps: [
        '1. Identify all singleton getters for Tone.js components (getEffectsChain, getSynthManager, etc.)',
        '2. In the main engine initialization, use `new ClassName()` instead of `getClassName()`',
        '3. Add a safeguard to verify Tone.js context matches engine context',
        '4. Keep singletons for backwards compatibility but document the risk',
      ],
      codeExample: `
// BAD: Singleton can retain stale nodes
this.effects = getEffectsChain();

// GOOD: Fresh instance in current context
this.effects = new ToneEffectsChain();
await this.effects.initialize();

// SAFEGUARD: Verify context match
const toneContext = Tone.getContext().rawContext;
if (toneContext !== this.audioContext) {
  throw new Error('AudioContext mismatch');
}
`,
    },
    prevention: [
      'Document which classes create Tone.js nodes',
      'Add context verification in engine initialization',
      'Use fresh instances for Tone.js components in main initialization',
      'Add tests that verify context consistency (audio-context-safety.test.ts)',
    ],
    relatedFiles: [
      'src/audio/engine.ts',
      'src/audio/toneEffects.ts',
      'src/audio/advancedSynth.ts',
      'src/audio/toneSynths.ts',
    ],
    testFile: 'src/audio/audio-context-safety.test.ts',
    dateDiscovered: '2024-12-16',
  },

  // ============================================================================
  // STATE MANAGEMENT BUGS
  // ============================================================================
  {
    id: 'stale-state-after-stop',
    name: 'Stale State After Stop',
    category: 'state-management',
    severity: 'medium',
    description:
      'Logs or callbacks continue to fire after playback is stopped, ' +
      'indicating state is not being properly cleaned up.',
    symptoms: [
      '"Playing" logs continue after hitting stop',
      'UI updates continue after stop',
      'Memory usage grows over time',
    ],
    rootCause:
      'Pending timers (setTimeout) or scheduled Web Audio events are not ' +
      'properly cleared when stop() is called. The scheduler sets isRunning=false ' +
      'but events already queued continue to fire.',
    detection: {
      runtime: () => detectStaleStateAfterStop(),
      codePatterns: [
        'setTimeout\\(',
        'setInterval\\(',
        '\\.start\\(',
        '\\.stop\\(',
      ],
      logPatterns: [
        'Playing.*after.*stop',
        'isRunning.*false.*but',
      ],
    },
    fix: {
      summary: 'Track all pending timers and clear them on stop',
      steps: [
        '1. Maintain a Set of pending timer IDs',
        '2. When creating a timer, add it to the Set',
        '3. In timer callback, remove from Set',
        '4. In stop(), iterate Set and clearTimeout each',
        '5. Clear the Set after cleanup',
      ],
      codeExample: `
private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();

// When creating timer
const timer = setTimeout(() => {
  this.pendingTimers.delete(timer);
  // ... callback logic
}, delay);
this.pendingTimers.add(timer);

// In stop()
for (const timer of this.pendingTimers) {
  clearTimeout(timer);
}
this.pendingTimers.clear();
`,
    },
    prevention: [
      'Always track async operations that need cleanup',
      'Add isRunning checks in timer callbacks',
      'Use the playback-state-debug.ts assertions',
      'Add invariant: isRunning=false implies pendingTimers.size=0',
    ],
    relatedFiles: [
      'src/audio/scheduler.ts',
      'src/audio/playback-state-debug.ts',
    ],
    testFile: 'src/audio/playback-state-debug.test.ts',
  },

  // ============================================================================
  // ROUTING BUGS
  // ============================================================================
  {
    id: 'silent-instrument',
    name: 'Silent Instrument (No Audio Output)',
    category: 'routing',
    severity: 'high',
    description:
      'An instrument is scheduled to play but produces no sound. ' +
      'This can be due to routing issues, initialization failures, or state problems.',
    symptoms: [
      'Scheduler logs show note being scheduled',
      'No sound is heard',
      'No follow-up logs from the engine/synth',
      'Other instruments work fine',
    ],
    rootCause:
      'Multiple possible causes: ' +
      '1. Engine method not being called (routing gap) ' +
      '2. AudioContext suspended/not running ' +
      '3. Gain node set to 0 ' +
      '4. Component not initialized ' +
      '5. Solo/mute state incorrect',
    detection: {
      runtime: () => detectSilentInstrument(),
      codePatterns: [
        'if\\s*\\(!.*Ready\\)',
        'return;\\s*$',  // Early returns
      ],
      logPatterns: [
        'Playing.*but no.*sound',
        'not ready',
        'not initialized',
      ],
    },
    fix: {
      summary: 'Add comprehensive logging to trace the audio path',
      steps: [
        '1. Add logging at each step: scheduler → engine method → synth/sampler',
        '2. Verify AudioContext state is "running"',
        '3. Check gain node values in the path',
        '4. Verify solo/mute state is correct',
        '5. Check if component is initialized/ready',
      ],
      codeExample: `
// Add logging at each level
// Scheduler
logger.audio.log(\`Playing \${preset} at step \${step}\`);

// Engine
logger.audio.log(\`playSynthNote: preset=\${preset}, freq=\${freq}\`);

// Synth
logger.audio.log(\`SynthEngine.playNote: creating voice\`);
logger.audio.log(\`Voice started: freq=\${freq}\`);
`,
    },
    prevention: [
      'Add instrumentation at each level of the audio path',
      'Create integration tests that verify sound output',
      'Add assertions for initialization state before playing',
      'Use the debug tracer to trace note playback',
    ],
    relatedFiles: [
      'src/audio/scheduler.ts',
      'src/audio/engine.ts',
      'src/audio/synth.ts',
      'src/audio/advancedSynth.ts',
    ],
  },

  // ============================================================================
  // RACE CONDITION BUGS
  // ============================================================================
  {
    id: 'play-before-ready',
    name: 'Play Before Ready (Race Condition)',
    category: 'race-condition',
    severity: 'high',
    description:
      'Attempting to play an instrument before it has finished initializing, ' +
      'resulting in silent notes or errors.',
    symptoms: [
      'First few notes are silent',
      'Works after a short delay',
      'Intermittent failures',
      '"not ready" warnings in logs',
    ],
    rootCause:
      'Async initialization (sample loading, Tone.js setup) is not awaited ' +
      'before playback starts. User can press play before loading completes.',
    detection: {
      runtime: () => detectPlayBeforeReady(),
      codePatterns: [
        'isReady\\(\\)',
        'isInitialized\\(\\)',
        'ensureLoaded\\(',
      ],
      logPatterns: [
        'not ready',
        'skipping',
        'not initialized',
      ],
    },
    fix: {
      summary: 'Check readiness before playing, skip gracefully if not ready',
      steps: [
        '1. Add isReady() check before playing',
        '2. If not ready, skip the note (do not fall back to different sound)',
        '3. Preload commonly-used instruments during initialization',
        '4. Show loading state in UI',
      ],
      codeExample: `
// In scheduler
if (!audioEngine.isSampledInstrumentReady(preset)) {
  logger.audio.warn(\`\${preset} not ready, skipping\`);
  return; // Skip, don't fall back
}
audioEngine.playSampledInstrument(preset, ...);

// In engine initialization
await this.preloadAllSampledInstruments();
`,
    },
    prevention: [
      'Preload instruments during engine initialization',
      'Add isReady() checks at all playback entry points',
      'Never fall back to different sound (confuses users)',
      'Show loading indicator in UI',
    ],
    relatedFiles: [
      'src/audio/scheduler.ts',
      'src/audio/engine.ts',
      'src/audio/sampled-instrument.ts',
    ],
    testFile: 'src/audio/sampled-instrument-integration.test.ts',
  },
];

// ============================================================================
// RUNTIME DETECTION FUNCTIONS
// ============================================================================

/**
 * Detect AudioContext mismatch
 */
function detectAudioContextMismatch(): BugDetectionResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (window as any).__audioEngine__;
    if (!engine?.audioContext) {
      return { detected: false, confidence: 'possible', evidence: { reason: 'No engine' } };
    }

    // Check if Tone.js context matches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Tone = (window as any).Tone;
    if (!Tone) {
      return { detected: false, confidence: 'possible', evidence: { reason: 'No Tone.js' } };
    }

    const toneContext = Tone.getContext?.()?.rawContext;
    const engineContext = engine.audioContext;

    if (toneContext && engineContext && toneContext !== engineContext) {
      return {
        detected: true,
        confidence: 'certain',
        evidence: {
          toneContextId: toneContext.toString(),
          engineContextId: engineContext.toString(),
        },
        message: 'Tone.js and AudioEngine have different AudioContexts!',
      };
    }

    return { detected: false, confidence: 'certain', evidence: { match: true } };
  } catch (e) {
    return { detected: false, confidence: 'possible', evidence: { error: String(e) } };
  }
}

/**
 * Detect stale state after stop
 */
function detectStaleStateAfterStop(): BugDetectionResult {
  // This would need to be called after stop() and check if events continue
  // For now, return a placeholder
  return {
    detected: false,
    confidence: 'possible',
    evidence: { note: 'Requires observation after stop()' },
  };
}

/**
 * Detect silent instrument issues
 */
function detectSilentInstrument(): BugDetectionResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (window as any).__audioEngine__;
    if (!engine) {
      return { detected: false, confidence: 'possible', evidence: { reason: 'No engine' } };
    }

    const issues: string[] = [];

    // Check AudioContext state
    if (engine.audioContext?.state !== 'running') {
      issues.push(`AudioContext state: ${engine.audioContext?.state}`);
    }

    // Check master gain
    if (engine.masterGain?.gain?.value === 0) {
      issues.push('Master gain is 0');
    }

    if (issues.length > 0) {
      return {
        detected: true,
        confidence: 'likely',
        evidence: { issues },
        message: `Potential audio issues: ${issues.join(', ')}`,
      };
    }

    return { detected: false, confidence: 'certain', evidence: { checksPass: true } };
  } catch (e) {
    return { detected: false, confidence: 'possible', evidence: { error: String(e) } };
  }
}

/**
 * Detect play-before-ready race condition
 */
function detectPlayBeforeReady(): BugDetectionResult {
  // Check recent traces for "not ready" warnings
  try {
    const traces = window.__getTraces__?.() || [];
    const notReadyTraces = traces.filter(
      t => t.type === 'warning' && (
        t.name.includes('not ready') ||
        t.data?.message?.toString().includes('not ready')
      )
    );

    if (notReadyTraces.length > 0) {
      return {
        detected: true,
        confidence: 'certain',
        evidence: { count: notReadyTraces.length, recent: notReadyTraces.slice(-5) },
        message: `Found ${notReadyTraces.length} "not ready" warnings`,
      };
    }

    return { detected: false, confidence: 'certain', evidence: {} };
  } catch {
    return { detected: false, confidence: 'possible', evidence: {} };
  }
}

// ============================================================================
// LOG-BASED DETECTION (Persisted Logs)
// ============================================================================

/**
 * Result of log-based detection
 */
export interface LogBasedDetectionResult {
  patternId: string;
  detected: boolean;
  matchingLogs: StoredLog[];
  message?: string;
}

/**
 * Search persisted logs for bug pattern symptoms
 * This is async because it queries IndexedDB
 */
export async function detectFromStoredLogs(
  minutes: number = 30
): Promise<Map<string, LogBasedDetectionResult>> {
  const results = new Map<string, LogBasedDetectionResult>();

  // Dynamically import to avoid circular dependency
  let queryLogs: typeof import('./log-store').queryLogs;
  try {
    const logStore = await import('./log-store');
    queryLogs = logStore.queryLogs;
  } catch {
    // Log store not available
    return results;
  }

  const startTime = Date.now() - minutes * 60 * 1000;

  for (const pattern of BUG_PATTERNS) {
    const logPatterns = pattern.detection.logPatterns || [];
    if (logPatterns.length === 0) continue;

    const matchingLogs: StoredLog[] = [];

    // Query logs from the time window
    try {
      const logs = await queryLogs({ startTime, limit: 5000 });

      // Check each log against pattern's logPatterns
      for (const log of logs) {
        const logText = `${log.message} ${JSON.stringify(log.data || {})}`;
        for (const logPattern of logPatterns) {
          if (logText.toLowerCase().includes(logPattern.toLowerCase())) {
            matchingLogs.push(log);
            break; // Don't count same log multiple times
          }
        }
      }
    } catch {
      // Query failed, skip this pattern
      continue;
    }

    results.set(pattern.id, {
      patternId: pattern.id,
      detected: matchingLogs.length > 0,
      matchingLogs,
      message: matchingLogs.length > 0
        ? `Found ${matchingLogs.length} log entries matching pattern "${pattern.name}"`
        : undefined,
    });
  }

  return results;
}

/**
 * Search logs for a specific symptom text
 */
export async function searchLogsForSymptom(
  symptomText: string,
  minutes: number = 60
): Promise<StoredLog[]> {
  try {
    const logStore = await import('./log-store');
    const startTime = Date.now() - minutes * 60 * 1000;
    const logs = await logStore.queryLogs({ startTime, limit: 10000 });

    const lowerSymptom = symptomText.toLowerCase();
    return logs.filter(log => {
      const logText = `${log.message} ${JSON.stringify(log.data || {})}`;
      return logText.toLowerCase().includes(lowerSymptom);
    });
  } catch {
    return [];
  }
}

/**
 * Get error logs from the last N minutes (useful for quick diagnostics)
 */
export async function getRecentErrors(minutes: number = 30): Promise<StoredLog[]> {
  try {
    const logStore = await import('./log-store');
    const startTime = Date.now() - minutes * 60 * 1000;
    return await logStore.queryLogs({ level: 'error', startTime, limit: 500 });
  } catch {
    return [];
  }
}

// ============================================================================
// BUG PATTERN API
// ============================================================================

/**
 * Run all runtime detections
 */
export function runAllDetections(): Map<string, BugDetectionResult> {
  const results = new Map<string, BugDetectionResult>();

  for (const pattern of BUG_PATTERNS) {
    if (pattern.detection.runtime) {
      try {
        const result = pattern.detection.runtime();
        results.set(pattern.id, result);

        if (result.detected) {
          tracer.warning(
            'bug-detection',
            `Pattern detected: ${pattern.name}`,
            result.message || `Bug pattern ${pattern.id} detected`,
            { patternId: pattern.id, ...result.evidence }
          );
        }
      } catch (e) {
        results.set(pattern.id, {
          detected: false,
          confidence: 'possible',
          evidence: { error: String(e) },
        });
      }
    }
  }

  return results;
}

/**
 * Get pattern by ID
 */
export function getPattern(id: string): BugPattern | undefined {
  return BUG_PATTERNS.find(p => p.id === id);
}

/**
 * Get patterns by category
 */
export function getPatternsByCategory(category: BugCategory): BugPattern[] {
  return BUG_PATTERNS.filter(p => p.category === category);
}

/**
 * Search patterns by symptom keyword
 */
export function searchPatternsBySymptom(keyword: string): BugPattern[] {
  const lower = keyword.toLowerCase();
  return BUG_PATTERNS.filter(p =>
    p.symptoms.some(s => s.toLowerCase().includes(lower)) ||
    p.description.toLowerCase().includes(lower)
  );
}

/**
 * Get code patterns for static analysis
 */
export function getAllCodePatterns(): { patternId: string; regex: string }[] {
  const results: { patternId: string; regex: string }[] = [];

  for (const pattern of BUG_PATTERNS) {
    for (const regex of pattern.detection.codePatterns || []) {
      results.push({ patternId: pattern.id, regex });
    }
  }

  return results;
}

// Initialize global interface
export function initBugPatterns(): void {
  if (typeof window === 'undefined') return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__runBugDetection__ = runAllDetections;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__getBugPatterns__ = () => BUG_PATTERNS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__searchBugPatterns__ = searchPatternsBySymptom;

  // Log-based detection functions (query IndexedDB)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__detectFromLogs__ = detectFromStoredLogs;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__searchLogsForSymptom__ = searchLogsForSymptom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__getRecentErrors__ = getRecentErrors;

  console.log(`
🐛 Bug Pattern Registry Initialized
   Runtime detection:    __runBugDetection__()
   Log-based detection:  await __detectFromLogs__(30)      // last 30 min
   Search logs:          await __searchLogsForSymptom__('AudioContext')
   Recent errors:        await __getRecentErrors__(30)
   All patterns:         __getBugPatterns__()
   Search by symptom:    __searchBugPatterns__('silent')
  `);
}
