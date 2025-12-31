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
  | 'routing'
  | 'consistency'       // Phase 23: Added for namespace/prefix inconsistency bugs
  | 'multiplayer-sync'  // Phase 25: Added for missing multiplayer synchronization
  | 'hmr';              // Phase 26: Added for HMR cleanup issues

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

  // ============================================================================
  // CONSISTENCY BUGS
  // ============================================================================
  {
    id: 'namespace-inconsistency',
    name: 'Namespace Prefix Inconsistency',
    category: 'consistency',
    severity: 'high',
    description:
      'Multiple code paths handle instrument namespaces (synth:, sampled:, tone:, advanced:) ' +
      'inconsistently. When one path is updated, others may be missed, causing features to ' +
      'work for some track formats but not others.',
    symptoms: [
      'Feature works for synth:piano but not sampled:piano',
      'Tracks created one way work, created another way fail',
      'Preloading misses certain instrument formats',
      'Intermittent failures depending on track configuration',
    ],
    rootCause:
      'Instrument type prefixes are checked in multiple places using raw startsWith() calls. ' +
      'When logic is duplicated: (1) One place gets updated, another does not, ' +
      '(2) New namespaces are added but not to all handlers, ' +
      '(3) Edge cases are handled inconsistently.',
    detection: {
      runtime: () => detectNamespaceInconsistency(),
      codePatterns: [
        'sampleId\\.startsWith\\([\'"]synth:',
        'sampleId\\.startsWith\\([\'"]sampled:',
        'sampleId\\.startsWith\\([\'"]tone:',
        'sampleId\\.startsWith\\([\'"]advanced:',
      ],
      logPatterns: [
        'not ready.*piano',
        'skipping.*sampled',
        'unknown instrument type',
      ],
    },
    fix: {
      summary: 'Use centralized instrument-types.ts utilities instead of raw startsWith()',
      steps: [
        '1. Import from src/audio/instrument-types.ts',
        '2. Use parseInstrumentId() for type detection',
        '3. Use collectSampledInstruments() for preloading',
        '4. Never write raw startsWith() for instrument prefixes',
        '5. Add tests covering ALL namespace formats',
      ],
      codeExample: `
// BAD: Raw startsWith() is duplicated and error-prone
if (track.sampleId.startsWith('synth:')) {
  const preset = track.sampleId.replace('synth:', '');
  // Missing: sampled: format!
}

// GOOD: Centralized utility handles all formats
import { collectSampledInstruments, parseInstrumentId } from './instrument-types';
const instrumentsToLoad = collectSampledInstruments(tracks);
const info = parseInstrumentId(track.sampleId);
`,
    },
    prevention: [
      'Always use instrument-types.ts utilities for namespace handling',
      'Never write raw startsWith() for instrument prefixes',
      'Add tests covering ALL namespace formats when adding features',
      'Search codebase when adding new namespace to find all handlers',
      'Run: grep -rn "sampleId.startsWith" src/ | grep -v test | wc -l (should be minimal)',
    ],
    relatedFiles: [
      'src/audio/instrument-types.ts',
      'src/audio/engine.ts',
      'src/audio/scheduler.ts',
    ],
    testFile: 'src/audio/instrument-types.test.ts',
    dateDiscovered: '2024-12-17',
  },

  // ============================================================================
  // MULTIPLAYER SYNC BUGS
  // ============================================================================
  {
    id: 'missing-multiplayer-sync',
    name: 'Missing Multiplayer Sync for New Feature',
    category: 'multiplayer-sync',
    severity: 'high',
    description:
      'When adding a new feature that modifies state, the multiplayer sync is not updated. ' +
      'The feature works in single-player mode but changes are not synced to other players. ' +
      'This is easy to miss because local testing works fine.',
    symptoms: [
      'Feature works locally but not synced to other users',
      'State resets when another player joins',
      'Changes lost after page refresh (not persisted)',
      'No WebSocket messages seen for the new action',
      'Feature works but others cannot see changes',
    ],
    rootCause:
      'Adding a new state-modifying feature requires updating multiple files: ' +
      '(1) MUTATING_MESSAGE_TYPES to mark action as sync-worthy, ' +
      '(2) ClientMessage/ServerMessage types, ' +
      '(3) live-session.ts handler for server-side processing, ' +
      '(4) multiplayer.ts actionToMessage conversion, ' +
      '(5) multiplayer.ts handler for incoming messages. ' +
      'Missing any of these steps breaks sync.',
    detection: {
      runtime: () => detectMissingMultiplayerSync(),
      codePatterns: [
        'MUTATING_MESSAGE_TYPES',
        'handleSet.*\\(ws,',          // Server handlers
        'actionToMessage\\(',          // Client message conversion
        'case.*_changed:',             // Message handlers
      ],
      logPatterns: [
        'action not in MUTATING',
        'unknown message type',
        'sync failed',
      ],
    },
    fix: {
      summary: 'Follow the complete multiplayer sync checklist when adding new state actions',
      steps: [
        '1. Add action type to MUTATING_MESSAGE_TYPES in worker/types.ts',
        '2. Add ClientMessage type for the action (e.g., set_fm_params)',
        '3. Add ServerMessage type for the broadcast (e.g., fm_params_changed)',
        '4. Add handler in live-session.ts (e.g., handleSetFMParams)',
        '5. Add case to switch statement in live-session.ts handleMessage',
        '6. Add to multiplayer.ts ClientMessage type',
        '7. Add to multiplayer.ts ServerMessage type',
        '8. Add handler in multiplayer.ts (e.g., handleFMParamsChanged)',
        '9. Add case to switch statement in multiplayer.ts handleMessage',
        '10. Add actionToMessage conversion in multiplayer.ts',
        '11. Test with two browser windows',
      ],
      codeExample: `
// CHECKLIST for adding SET_FM_PARAMS:

// 1. worker/types.ts - Add to MUTATING_MESSAGE_TYPES
export const MUTATING_MESSAGE_TYPES = new Set([
  // ... existing
  'set_fm_params',  // <-- ADD THIS
] as const);

// 2. worker/types.ts - ClientMessage type
| { type: 'set_fm_params'; trackId: string; fmParams: FMParams }

// 3. worker/types.ts - ServerMessage type
| { type: 'fm_params_changed'; trackId: string; fmParams: FMParams; playerId: string }

// 4. live-session.ts - Handler
case 'set_fm_params':
  this.handleSetFMParams(ws, player, msg);
  break;

// 5. live-session.ts - handleSetFMParams method
private handleSetFMParams(ws: WebSocket, player: PlayerInfo, msg: { ... }): void {
  // Update state, broadcast to all, schedule KV save
}

// 6-9. multiplayer.ts - Same pattern (ClientMessage, ServerMessage, handler, case)

// 10. multiplayer.ts - actionToMessage
case 'SET_FM_PARAMS':
  return { type: 'set_fm_params', trackId: action.trackId, fmParams: action.fmParams };
`,
    },
    prevention: [
      'Create a multiplayer sync checklist in CONTRIBUTING.md',
      'When adding new state actions, ALWAYS search for "MUTATING_MESSAGE_TYPES" first',
      'Use a template when adding new sync actions (copy existing pattern like SET_EFFECTS)',
      'Test with two browser windows before marking feature complete',
      'Add grep command to CI: grep for new action types not in MUTATING_MESSAGE_TYPES',
      'Add test that verifies all action types have corresponding message types',
    ],
    relatedFiles: [
      'src/worker/types.ts',
      'src/worker/live-session.ts',
      'src/sync/multiplayer.ts',
      'src/types.ts',
      'src/state/grid.tsx',
    ],
    testFile: 'src/worker/types.test.ts',
    dateDiscovered: '2024-12-18',
  },

  // ============================================================================
  // STATE SYNCHRONIZATION BUGS
  // ============================================================================
  {
    id: 'array-count-mismatch',
    name: 'Array/Count Property Mismatch',
    category: 'multiplayer-sync',
    severity: 'high',
    description:
      'When a "count" property (like stepCount, trackCount) is updated, the associated ' +
      'arrays (steps, parameterLocks) must be resized to match. If only the count is updated ' +
      'but arrays are not resized, state becomes inconsistent between client and server, ' +
      'causing data loss on sync or reconnect.',
    symptoms: [
      'Track length changes locally but reverts after sync/reconnect',
      'Steps beyond original length are lost',
      'stepCount is 32 but steps.length is 16',
      'State mismatch warnings in logs',
      'Pattern works locally but not after page refresh',
      'New steps disappear when another player joins',
    ],
    rootCause:
      'When updating a "count" property, the code only sets the count but does not resize ' +
      'associated arrays. For example, SET_TRACK_STEP_COUNT might do: ' +
      'track.stepCount = newCount; // BUG: steps array not resized! ' +
      'The client shows extra steps (UI generates them), but server/persistence only has ' +
      'the original array size. On sync, the shorter server array overwrites client state.',
    detection: {
      runtime: () => detectArrayCountMismatch(),
      codePatterns: [
        'stepCount\\s*=',           // Setting stepCount
        '\\.stepCount\\s*=',        // Property assignment
        'track\\.stepCount',        // Track stepCount access
        'Array\\(\\w+\\)\\.fill',   // Array creation (should use dynamic size)
        'Array\\(MAX_STEPS\\)',     // Hardcoded size (potential bug)
        'Array\\(STEPS_PER_PAGE\\)', // Hardcoded size (potential bug)
      ],
      logPatterns: [
        'stepCount.*mismatch',
        'array length.*differs',
        'state divergence',
        'steps.length !== stepCount',
      ],
    },
    fix: {
      summary: 'When changing count properties, ALWAYS resize associated arrays in the same operation',
      steps: [
        '1. Identify all places where stepCount (or similar) is modified',
        '2. For each, ensure steps[] and parameterLocks[] are resized to match',
        '3. When expanding: fill new slots with false/null',
        '4. When shrinking: truncate arrays with slice(0, newCount)',
        '5. Apply fix to BOTH client reducer AND server handler',
        '6. Add tests that verify arrays match count after each operation',
      ],
      codeExample: `
// BAD: Only sets count, arrays not resized
case 'SET_TRACK_STEP_COUNT':
  return { ...track, stepCount: action.stepCount };  // BUG!

// GOOD: Resize arrays to match new count
case 'SET_TRACK_STEP_COUNT': {
  const oldCount = track.stepCount ?? 16;
  const newCount = action.stepCount;
  let steps = track.steps;
  let locks = track.parameterLocks;

  if (newCount > oldCount) {
    // Expand
    steps = [...steps, ...Array(newCount - oldCount).fill(false)];
    locks = [...locks, ...Array(newCount - oldCount).fill(null)];
  } else if (newCount < oldCount) {
    // Truncate
    steps = steps.slice(0, newCount);
    locks = locks.slice(0, newCount);
  }

  return { ...track, stepCount: newCount, steps, parameterLocks: locks };
}

// ALSO fix in server handler (live-session.ts)!
`,
    },
    prevention: [
      'Create a helper function: resizeTrackArrays(track, newCount) that handles resizing',
      'When modifying count properties, ALWAYS use the helper',
      'Add invariant check: track.steps.length === track.stepCount',
      'Add tests that verify array lengths match counts after every action',
      'Search for "stepCount =" to find all modification points',
      'Grep: grep -rn "stepCount\\s*=" src/ --include="*.ts" | grep -v test',
    ],
    relatedFiles: [
      'src/state/grid.tsx',
      'src/worker/live-session.ts',
      'src/worker/mock-durable-object.ts',
    ],
    testFile: 'src/state/grid.test.ts',
    dateDiscovered: '2024-12-30',
  },

  // ============================================================================
  // HMR (HOT MODULE REPLACEMENT) BUGS
  // ============================================================================
  {
    id: 'singleton-missing-hmr-cleanup',
    name: 'Singleton Missing HMR Cleanup',
    category: 'hmr',
    severity: 'medium',
    description:
      'Singleton modules that acquire external resources (event listeners, timers, ' +
      'WebSocket connections, audio nodes) leak those resources during Hot Module ' +
      'Replacement in development. Each HMR update creates new listeners/timers ' +
      'while old ones remain attached.',
    symptoms: [
      'Event handlers fire multiple times after code changes',
      'Memory usage grows during development session',
      'Audio glitches or duplicate sounds after HMR',
      'WebSocket connections pile up during development',
      'Console shows duplicate log entries after hot reload',
    ],
    rootCause:
      'When Vite performs HMR, it re-evaluates the module, creating a new singleton ' +
      'instance. The old instance is still referenced by event listeners, timers, or ' +
      'other browser APIs. Without explicit cleanup via import.meta.hot.dispose(), ' +
      'these resources accumulate.',
    detection: {
      codePatterns: [
        'export const \\w+ = new \\w+\\(\\)',  // Singleton export pattern
        'document\\.addEventListener',         // Event listener attachment
        'setInterval\\(',                      // Timer creation
        'setTimeout\\(',                       // Timer creation
      ],
      logPatterns: [
        'duplicate.*listener',
        'multiple.*instance',
      ],
    },
    fix: {
      summary: 'Use registerHmrDispose() helper to clean up resources during HMR',
      steps: [
        '1. Import { registerHmrDispose } from "../utils/hmr"',
        '2. After singleton export, call registerHmrDispose with cleanup function',
        '3. Cleanup function should call dispose(), disconnect(), stopAll(), etc.',
        '4. Ensure the cleanup method actually removes listeners/clears timers',
      ],
      codeExample: `
// In your singleton module (e.g., engine.ts):
import { registerHmrDispose } from '../utils/hmr';

export const audioEngine = new AudioEngine();

// HMR cleanup - call dispose to remove event listeners and clear resources
registerHmrDispose('AudioEngine', () => audioEngine.dispose());


// For modules without dispose(), create inline cleanup:
export const myService = new MyService();

registerHmrDispose('MyService', () => {
  myService.stop();
  myService.clearTimers();
});
`,
    },
    prevention: [
      'When creating a singleton with external resources, ALWAYS add registerHmrDispose()',
      'Add "HMR cleanup" comment near singleton export as reminder',
      'Run bug pattern analyzer to detect missing HMR handlers',
      'Document which singletons have external resources in module header',
    ],
    relatedFiles: [
      'src/utils/hmr.ts',
      'src/audio/engine.ts',
      'src/audio/scheduler.ts',
      'src/audio/synth.ts',
      'src/sync/multiplayer.ts',
    ],
    dateDiscovered: '2024-12-23',
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
 * Detect namespace prefix inconsistency
 * Checks if instrument-types.ts utilities are being used consistently
 */
function detectNamespaceInconsistency(): BugDetectionResult {
  // This is primarily a static analysis check, but we can look for symptoms
  try {
    const traces = window.__getTraces__?.() || [];

    // Look for "not ready" warnings that mention specific instrument types
    const inconsistencyTraces = traces.filter(
      t => t.type === 'warning' && (
        t.name.includes('not ready') ||
        t.name.includes('skipping') ||
        t.data?.message?.toString().includes('unknown instrument')
      )
    );

    if (inconsistencyTraces.length > 0) {
      return {
        detected: true,
        confidence: 'likely',
        evidence: {
          count: inconsistencyTraces.length,
          recent: inconsistencyTraces.slice(-5),
          suggestion: 'Check if all instrument namespaces are handled consistently'
        },
        message: `Found ${inconsistencyTraces.length} potential namespace inconsistency warnings`,
      };
    }

    return {
      detected: false,
      confidence: 'possible',
      evidence: {
        note: 'No runtime symptoms detected. Run static analysis: grep -rn "sampleId.startsWith" src/'
      }
    };
  } catch {
    return { detected: false, confidence: 'possible', evidence: {} };
  }
}

/**
 * Detect missing multiplayer sync (Phase 25)
 * Checks if all GridAction types have corresponding message types
 */
function detectMissingMultiplayerSync(): BugDetectionResult {
  // This is primarily a static analysis check
  // At runtime, we can check if recent actions were not synced
  try {
    const traces = window.__getTraces__?.() || [];

    // Look for actions that should have been synced but weren't
    const syncFailures = traces.filter(
      t => t.type === 'warning' && (
        t.name.includes('not in MUTATING') ||
        t.name.includes('unknown message type') ||
        t.name.includes('sync failed')
      )
    );

    if (syncFailures.length > 0) {
      return {
        detected: true,
        confidence: 'certain',
        evidence: {
          count: syncFailures.length,
          recent: syncFailures.slice(-5),
        },
        message: `Found ${syncFailures.length} potential missing sync issues`,
      };
    }

    return {
      detected: false,
      confidence: 'possible',
      evidence: {
        note: 'No runtime symptoms. Run static check: compare GridAction types with MUTATING_MESSAGE_TYPES'
      }
    };
  } catch {
    return { detected: false, confidence: 'possible', evidence: {} };
  }
}

/**
 * Detect array/count mismatch (Phase 29F bug)
 * Checks if track.steps.length matches track.stepCount
 */
function detectArrayCountMismatch(): BugDetectionResult {
  try {
    // Access grid state if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gridState = (window as any).__gridState__;
    if (!gridState?.tracks) {
      return {
        detected: false,
        confidence: 'possible',
        evidence: { reason: 'No grid state available' },
      };
    }

    const mismatches: Array<{ trackId: string; stepCount: number; stepsLength: number }> = [];

    for (const track of gridState.tracks) {
      const stepCount = track.stepCount ?? 16;
      const stepsLength = track.steps?.length ?? 0;

      if (stepsLength !== stepCount && stepsLength < stepCount) {
        // Array is shorter than stepCount - this is the bug!
        mismatches.push({
          trackId: track.id,
          stepCount,
          stepsLength,
        });
      }
    }

    if (mismatches.length > 0) {
      return {
        detected: true,
        confidence: 'certain',
        evidence: { mismatches },
        message: `Found ${mismatches.length} track(s) with steps.length < stepCount`,
      };
    }

    return {
      detected: false,
      confidence: 'certain',
      evidence: { tracksChecked: gridState.tracks.length },
    };
  } catch (e) {
    return {
      detected: false,
      confidence: 'possible',
      evidence: { error: String(e) },
    };
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
