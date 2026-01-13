#!/usr/bin/env npx ts-node
/**
 * Bug Pattern Analysis Tool v2.0
 *
 * This script analyzes the codebase for known bug patterns and potential issues.
 * Run it after fixing a bug to check for similar issues elsewhere.
 *
 * Improvements in v2.0:
 * - Filters out comments and JSDoc from analysis
 * - Class-level dispose detection for memory-leak patterns
 * - Timer tracking detection for stale-state patterns
 * - Suppression annotations (@bug-pattern-ignore, @safe:)
 * - File-level pre-filtering for performance
 * - Better contextual matching to reduce false positives
 *
 * Usage:
 *   npx ts-node scripts/analyze-bug-patterns.ts
 *   npx ts-node scripts/analyze-bug-patterns.ts --pattern audio-context-mismatch
 *   npx ts-node scripts/analyze-bug-patterns.ts --category singleton
 *
 * Suppression:
 *   // @bug-pattern-ignore memory-leak
 *   // @safe: disposed in cleanup() method
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface CodePattern {
  patternId: string;
  name: string;
  severity: string;
  regex: string;
  description: string;
  fixSummary: string;
}

interface FileAnalysis {
  hasDisposeMethod: boolean;
  disposeTargets: string[];           // What gets disposed: ['reverb', 'delay', ...]
  hasPendingTimersTracking: boolean;
  trackedTimerIds: string[];          // Timer IDs tracked: ['releaseTimeoutId', ...]
  hasHmrCleanup: boolean;
  hasTypeParityCheck: boolean;
  hasOnendedCleanup: boolean;
}

interface AnalysisResult {
  file: string;
  line: number;
  pattern: CodePattern;
  match: string;
  context: string;
}

// =============================================================================
// EXCLUDED PATHS AND PATTERNS
// =============================================================================

// Files/directories to completely skip
const EXCLUDED_PATHS = [
  '/docs/',
  'bug-patterns.ts',      // Contains example code patterns
  '.test.ts',             // Test files often have intentional patterns
  '.test.tsx',
  '.spec.ts',
  '.d.ts',                // Type definitions only
  'audio-health-canary.ts', // Health check tool - intentionally tests without guards
  'audio-debug.ts',       // Debug tool - intentionally tests edge cases
];

// =============================================================================
// BUG PATTERNS
// =============================================================================

const CODE_PATTERNS: CodePattern[] = [
  // =============================================================================
  // SERIALIZATION BOUNDARY MISMATCH (Phase 12 bug)
  // =============================================================================
  {
    patternId: 'serialization-boundary-mismatch',
    name: 'Parallel interface definition',
    severity: 'medium',
    regex: 'interface\\s+(Session)?Track\\s*\\{',
    description: 'Track/SessionTrack are parallel types that must stay in sync',
    fixSummary: 'When adding fields, add to BOTH types and update types.test.ts parity check',
  },

  // =============================================================================
  // UNSTABLE CALLBACK IN USEEFFECT (Phase 12 connection storm bug)
  // =============================================================================
  {
    patternId: 'unstable-callback-in-effect',
    name: 'useCallback with state dependencies',
    severity: 'high',
    regex: 'useCallback\\s*\\([^)]*,\\s*\\[[^\\]]*(?:state|props|tracks|tempo|swing)',
    description: 'Callback depends on state/props - reference changes on every update. If used in useEffect, causes re-runs.',
    fixSummary: 'Use useStableCallback hook or ref pattern. See src/hooks/useStableCallback.ts',
  },
  {
    patternId: 'unstable-callback-in-effect',
    name: 'Callback function in useEffect deps',
    severity: 'medium',
    regex: 'useEffect\\s*\\([^)]*,\\s*\\[[^\\]]*(?:get|on|handle)\\w+[^\\]]*\\]\\)',
    description: 'Function in useEffect dependencies - verify it has stable reference',
    fixSummary: 'If callback uses state, wrap with useStableCallback or use ref pattern',
  },

  // =============================================================================
  // AUDIO CONTEXT MISMATCH
  // =============================================================================
  {
    patternId: 'audio-context-mismatch',
    name: 'Singleton with Tone.js nodes',
    severity: 'high',
    regex: 'let\\s+\\w+Instance\\s*:\\s*\\w+\\s*\\|\\s*null\\s*=\\s*null',
    description: 'Singleton pattern that may cache Tone.js nodes across HMR',
    fixSummary: 'Use fresh instances in engine.ts instead of singleton getters',
  },
  {
    patternId: 'audio-context-mismatch',
    name: 'Lazy singleton initialization',
    severity: 'high',
    regex: 'if\\s*\\(!\\w+Instance\\)\\s*\\{[^}]*new\\s+\\w+',
    description: 'Lazy initialization that caches across HMR',
    fixSummary: 'Document risk level and ensure engine uses fresh instances',
  },

  // =============================================================================
  // STALE STATE AFTER STOP
  // =============================================================================
  {
    patternId: 'stale-state-after-stop',
    name: 'Untracked setTimeout in audio code',
    severity: 'medium',
    regex: 'setTimeout\\s*\\(',
    description: 'setTimeout in audio code without pendingTimers tracking',
    fixSummary: 'Add timer to pendingTimers Set and clear in stop()',
  },

  // =============================================================================
  // MEMORY LEAK
  // =============================================================================
  {
    patternId: 'memory-leak',
    name: 'Missing disconnect on AudioNode',
    severity: 'medium',
    regex: 'createBufferSource\\s*\\(\\)',
    description: 'AudioBufferSourceNode without disconnect cleanup',
    fixSummary: 'Add source.onended = () => source.disconnect()',
  },
  {
    patternId: 'memory-leak',
    name: 'Missing dispose call',
    severity: 'medium',
    regex: 'new\\s+Tone\\.\\w+',
    description: 'Tone.js node creation without dispose in cleanup',
    fixSummary: 'Add .dispose() call in cleanup/dispose method',
  },

  // =============================================================================
  // SINGLETON MISSING HMR CLEANUP (Phase 26 bug)
  // =============================================================================
  {
    patternId: 'singleton-missing-hmr-cleanup',
    name: 'Singleton with addEventListener but no HMR',
    severity: 'high',
    regex: 'export const \\w+ = new \\w+\\(\\)',
    description: 'Singleton export pattern - verify HMR cleanup if module has external resources',
    fixSummary: 'Add registerHmrDispose() after singleton export. See src/utils/hmr.ts',
  },
  {
    patternId: 'singleton-missing-hmr-cleanup',
    name: 'Event listener in singleton module',
    severity: 'medium',
    regex: 'document\\.addEventListener\\s*\\(',
    description: 'Event listener that may leak during HMR if not cleaned up',
    fixSummary: 'Ensure module has registerHmrDispose() that removes listener',
  },

  // =============================================================================
  // ASYNC ENGINE INITIALIZATION RACE CONDITION (Phase 29 bug)
  // =============================================================================
  {
    patternId: 'async-init-race-condition',
    name: 'playAdvancedSynth without readiness check',
    severity: 'high',
    regex: '(?:engine|audioEngine)\\.playAdvancedSynth\\s*\\(',
    description: 'Calling playAdvancedSynth without checking isToneSynthReady("advanced")',
    fixSummary: 'Add isToneSynthReady("advanced") check before calling playAdvancedSynth',
  },
  {
    patternId: 'async-init-race-condition',
    name: 'playToneSynth without readiness check',
    severity: 'high',
    regex: '(?:engine|audioEngine)\\.playToneSynth\\s*\\(',
    description: 'Calling playToneSynth without checking isToneSynthReady("tone")',
    fixSummary: 'Add isToneSynthReady("tone") check before calling playToneSynth',
  },

  // =============================================================================
  // PLAY WITHOUT READINESS CHECK
  // =============================================================================
  {
    patternId: 'play-before-ready',
    name: 'Play without readiness check',
    severity: 'high',
    regex: '(?:engine|audioEngine)\\.playSampledInstrument\\s*\\(',
    description: 'Playing sampled instrument without checking if ready',
    fixSummary: 'Add isSampledInstrumentReady() check before playing',
  },

  // =============================================================================
  // TONE.JS CONTEXT SUSPENSION DESYNC (Phase 29 bug)
  // =============================================================================
  {
    patternId: 'tone-context-suspension-desync',
    name: 'audioContext.resume without Tone.start',
    severity: 'high',
    regex: 'await\\s+(?:this\\.)?audioContext(?:!)?\\.resume\\(\\)',
    description: 'Resuming AudioContext without also resuming Tone.js. Tone.js synths may stop working after tab backgrounding.',
    fixSummary: 'Add: if (this.toneInitialized) { await Tone.start(); } after audioContext.resume()',
  },
];

// =============================================================================
// COMMENT STRIPPING
// =============================================================================

interface CommentRange {
  start: number;
  end: number;
}

/**
 * Find all comment ranges in the source code.
 * Returns ranges that should be excluded from pattern matching.
 */
function findCommentRanges(content: string): CommentRange[] {
  const ranges: CommentRange[] = [];

  // Match single-line comments: // ...
  const singleLineRegex = /\/\/[^\n]*/g;
  let match;
  while ((match = singleLineRegex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Match multi-line comments and JSDoc: /* ... */ and /** ... */
  const multiLineRegex = /\/\*[\s\S]*?\*\//g;
  while ((match = multiLineRegex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Match template literal strings (may contain code-like text)
  const templateRegex = /`[^`]*`/g;
  while ((match = templateRegex.exec(content)) !== null) {
    // Only exclude if it looks like documentation/example code
    if (match[0].includes('playSampledInstrument') ||
        match[0].includes('playAdvancedSynth') ||
        match[0].includes('new Tone.')) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  return ranges;
}

/**
 * Check if a position is inside a comment
 */
function isInComment(position: number, commentRanges: CommentRange[]): boolean {
  return commentRanges.some(range => position >= range.start && position < range.end);
}

// =============================================================================
// FILE-LEVEL PRE-ANALYSIS
// =============================================================================

/**
 * Pre-analyze a file to detect safeguards at file/class level.
 * This allows us to skip pattern checks when safeguards exist.
 */
function preAnalyzeFile(content: string): FileAnalysis {
  // Find dispose methods and what they dispose
  const disposeTargets: string[] = [];
  const disposeMethodMatch = content.match(/dispose\s*\(\s*\)[\s\S]*?\{([\s\S]*?)\n\s*\}/);
  if (disposeMethodMatch) {
    const disposeBody = disposeMethodMatch[1];
    // Find this.xxx?.dispose() or this.xxx.dispose() patterns
    const disposeCallRegex = /this\.(\w+)\??\.\s*dispose\s*\(\s*\)/g;
    let match;
    while ((match = disposeCallRegex.exec(disposeBody)) !== null) {
      disposeTargets.push(match[1]);
    }
  }

  // Find tracked timer IDs (xxxTimeoutId, xxxTimerId patterns that get cleared)
  const trackedTimerIds: string[] = [];
  const timerIdRegex = /this\.(\w+(?:Timeout|Timer)Id)\s*=\s*setTimeout/g;
  let match;
  while ((match = timerIdRegex.exec(content)) !== null) {
    const timerId = match[1];
    // Verify there's a corresponding clearTimeout
    if (content.includes(`clearTimeout(this.${timerId})`)) {
      trackedTimerIds.push(timerId);
    }
  }

  // Check for pendingTimers.add or pendingCleanups.add pattern
  const hasPendingTimersTracking = /pending(?:Timers|Cleanups)\.add\s*\(/.test(content);

  // Check for source.onended cleanup
  const hasOnendedCleanup = /\.onended\s*=\s*\(\s*\)\s*=>\s*\{?[^}]*disconnect/.test(content);

  return {
    hasDisposeMethod: disposeTargets.length > 0 || /dispose\s*\(\s*\)\s*(?::\s*void)?\s*\{/.test(content),
    disposeTargets,
    hasPendingTimersTracking,
    trackedTimerIds,
    hasHmrCleanup: /registerHmrDispose/.test(content),
    hasTypeParityCheck: /AssertSameKeys/.test(content),
    hasOnendedCleanup,
  };
}

// =============================================================================
// SUPPRESSION ANNOTATION DETECTION
// =============================================================================

/**
 * Check if a pattern is suppressed by an annotation comment.
 *
 * Supported annotations:
 *   // @bug-pattern-ignore <pattern-id>
 *   // @bug-pattern-ignore *
 *   // @safe: <reason>
 *   /* @intentional: <reason> *\/
 */
function hasSuppression(context: string, patternId: string): boolean {
  // @bug-pattern-ignore <pattern-id> or @bug-pattern-ignore *
  const ignoreMatch = context.match(/@bug-pattern-ignore\s+(\S+)/);
  if (ignoreMatch && (ignoreMatch[1] === patternId || ignoreMatch[1] === '*')) {
    return true;
  }

  // @safe: <reason> - general safety annotation
  if (/@safe:/.test(context)) {
    return true;
  }

  // @intentional: <reason>
  if (/@intentional:/.test(context)) {
    return true;
  }

  return false;
}

// =============================================================================
// CLASS-LEVEL ANALYSIS
// =============================================================================

/**
 * Find the class that contains a given line number.
 * Returns the class body if found, null otherwise.
 * Currently unused but kept for potential future enhancements.
 */
function _findEnclosingClass(content: string, lineNumber: number): { name: string; body: string } | null {
  const lines = content.split('\n');
  const targetIndex = lineNumber - 1;

  // Walk backwards to find class declaration
  let braceCount = 0;
  let classStartLine = -1;
  let className = '';

  for (let i = targetIndex; i >= 0; i--) {
    const line = lines[i];

    // Count braces to track nesting
    braceCount += (line.match(/\}/g) || []).length;
    braceCount -= (line.match(/\{/g) || []).length;

    // Look for class declaration
    const classMatch = line.match(/class\s+(\w+)/);
    if (classMatch && braceCount <= 0) {
      classStartLine = i;
      className = classMatch[1];
      break;
    }
  }

  if (classStartLine === -1) return null;

  // Find class end (matching closing brace)
  braceCount = 0;
  let classEndLine = -1;
  let foundFirstBrace = false;

  for (let i = classStartLine; i < lines.length; i++) {
    const line = lines[i];

    for (const char of line) {
      if (char === '{') {
        braceCount++;
        foundFirstBrace = true;
      } else if (char === '}') {
        braceCount--;
        if (foundFirstBrace && braceCount === 0) {
          classEndLine = i;
          break;
        }
      }
    }

    if (classEndLine !== -1) break;
  }

  if (classEndLine === -1) return null;

  return {
    name: className,
    body: lines.slice(classStartLine, classEndLine + 1).join('\n'),
  };
}

/**
 * Check if a Tone.js node variable has a corresponding dispose() call.
 * Uses a simpler file-level approach that's more reliable than class parsing.
 */
function hasClassLevelDispose(content: string, lineNumber: number, _matchIndex: number): boolean {
  // Get the full line containing the match to find the variable assignment
  const lines = content.split('\n');
  const line = lines[lineNumber - 1] || '';

  // Extract the variable name from the line
  // Patterns: this.xxx = new Tone.Yyy OR const xxx = new Tone.Yyy
  const thisAssignMatch = line.match(/this\.(\w+)\s*=\s*new\s+Tone\./);
  const constAssignMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*new\s+Tone\./);

  let varName: string | null = null;
  if (thisAssignMatch) {
    varName = thisAssignMatch[1];
  } else if (constAssignMatch) {
    varName = constAssignMatch[1];
  }

  // For return statements like `return new Tone.FMSynth()`, check if the
  // containing structure (class/manager) has a dispose method that disposes synths
  if (!varName) {
    // Check if file has a dispose method that disposes synths from a collection
    if (/synth\.dispose\(\)|\.dispose\(\)/.test(content) &&
        /dispose\s*\(\s*\)\s*(?::\s*void)?\s*\{/.test(content)) {
      return true;
    }
    return false;
  }

  // Check if this variable is disposed anywhere in the file
  // This handles cases where dispose is in the same class or a related cleanup method
  const disposePattern = new RegExp(`this\\.${varName}\\??\\.(dispose|disconnect)\\s*\\(`);
  return disposePattern.test(content);
}

// =============================================================================
// TIMER TRACKING DETECTION
// =============================================================================

/**
 * Check if a setTimeout call is properly tracked.
 */
function isTimerTracked(content: string, matchIndex: number, fileAnalysis: FileAnalysis): boolean {
  // Get the line containing the setTimeout
  const beforeMatch = content.substring(0, matchIndex);
  const lineStart = beforeMatch.lastIndexOf('\n') + 1;
  const lineEnd = content.indexOf('\n', matchIndex);
  const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd);

  // Check if it's assigned to a tracked timer ID
  // Pattern: this.xxxTimeoutId = setTimeout( OR this.xxxId = window.setTimeout(
  const timerIdMatch = line.match(/this\.(\w+(?:Timeout|Timer)?Id)\s*=\s*(?:window\.)?setTimeout/);
  if (timerIdMatch) {
    const timerId = timerIdMatch[1];
    // Check if tracked or if there's a corresponding clearTimeout
    if (fileAnalysis.trackedTimerIds.includes(timerId)) {
      return true;
    }
    // Also accept if there's clearTimeout anywhere for this timer
    if (content.includes(`clearTimeout(this.${timerId})`)) {
      return true;
    }
  }

  // Check if it's added to pendingTimers or pendingCleanups
  // Pattern: const timer = setTimeout(...); pendingTimers.add(timer)
  if (fileAnalysis.hasPendingTimersTracking) {
    // Look for pendingTimers.add or pendingCleanups.add in the context (next several lines)
    // Need larger window because setTimeout callbacks can be multi-line
    const contextEnd = Math.min(matchIndex + 500, content.length);
    const context = content.substring(matchIndex, contextEnd);
    if (/pending(?:Timers|Cleanups)\.add\s*\(/.test(context)) {
      return true;
    }
  }

  // Also check if this specific setTimeout is assigned to a variable that's added to tracking
  // Pattern: const cleanupTimer = setTimeout(...); this.pendingCleanups.add(cleanupTimer);
  const varMatch = line.match(/(?:const|let)\s+(\w+)\s*=\s*(?:window\.)?setTimeout/);
  if (varMatch) {
    const timerVar = varMatch[1];
    // Check if this variable is added to a tracking set
    if (content.includes(`pendingTimers.add(${timerVar})`) ||
        content.includes(`pendingCleanups.add(${timerVar})`) ||
        content.includes(`this.pendingTimers.add(${timerVar})`) ||
        content.includes(`this.pendingCleanups.add(${timerVar})`)) {
      return true;
    }
  }

  // Check for React useEffect cleanup pattern
  // Pattern: return () => clearTimeout(
  const functionContext = content.substring(Math.max(0, matchIndex - 500), matchIndex + 300);
  if (/return\s*\(\s*\)\s*=>\s*\{?[^}]*clearTimeout/.test(functionContext)) {
    return true;
  }

  return false;
}

// =============================================================================
// READINESS CHECK DETECTION
// =============================================================================

/**
 * Check if there's a readiness guard before a play call.
 */
function hasReadinessGuard(content: string, matchIndex: number, guardPattern: RegExp): boolean {
  // Get the enclosing function body (look back up to 1000 chars)
  const lookbackStart = Math.max(0, matchIndex - 1000);
  const beforeMatch = content.substring(lookbackStart, matchIndex);

  // Find the most recent function start
  const funcMatch = beforeMatch.match(/(?:function\s+\w+|(?:async\s+)?(?:\w+\s*)?(?:=>|\{))[^]*$/);
  if (!funcMatch) {
    // No function context found, check the immediate context
    return guardPattern.test(beforeMatch.substring(beforeMatch.length - 200));
  }

  const funcBody = funcMatch[0];
  return guardPattern.test(funcBody);
}

// =============================================================================
// PATTERN APPLICATION RULES
// =============================================================================

/**
 * Check if a pattern should apply to a file based on path
 */
function shouldApplyPattern(pattern: CodePattern, filePath: string): boolean {
  // Stale state patterns only apply to audio code
  if (pattern.patternId === 'stale-state-after-stop') {
    return filePath.includes('/audio/');
  }
  // Memory leak patterns apply to audio
  if (pattern.patternId === 'memory-leak') {
    return filePath.includes('/audio/');
  }
  // Serialization boundary patterns only apply to type definition files
  if (pattern.patternId === 'serialization-boundary-mismatch') {
    return filePath.includes('types.ts');
  }
  // Unstable callback patterns apply to React components and hooks
  if (pattern.patternId === 'unstable-callback-in-effect') {
    return filePath.endsWith('.tsx') || filePath.includes('/hooks/');
  }
  // HMR patterns apply to audio, sync, and utils (singleton-heavy areas)
  if (pattern.patternId === 'singleton-missing-hmr-cleanup') {
    return filePath.includes('/audio/') ||
           filePath.includes('/sync/') ||
           filePath.includes('/utils/');
  }
  // Async init patterns apply to components and hooks
  if (pattern.patternId === 'async-init-race-condition') {
    return filePath.endsWith('.tsx') || filePath.includes('/hooks/');
  }
  // Play before ready patterns
  if (pattern.patternId === 'play-before-ready') {
    return !filePath.includes('engine.ts'); // Skip the engine itself
  }
  // Tone context desync
  if (pattern.patternId === 'tone-context-suspension-desync') {
    return filePath.includes('/audio/') || filePath.endsWith('.tsx');
  }
  return true;
}

// =============================================================================
// MAIN SCANNING LOGIC
// =============================================================================

/**
 * Scan a file for bug patterns with improved false-positive filtering
 */
function scanFile(filePath: string, patterns: CodePattern[]): AnalysisResult[] {
  const results: AnalysisResult[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Pre-analyze file for safeguards
    const fileAnalysis = preAnalyzeFile(content);

    // Find comment ranges to exclude
    const commentRanges = findCommentRanges(content);

    for (const pattern of patterns) {
      // Skip patterns that don't apply to this file type
      if (!shouldApplyPattern(pattern, filePath)) continue;

      const regex = new RegExp(pattern.regex, 'gm');
      let match;

      while ((match = regex.exec(content)) !== null) {
        // Skip if match is inside a comment
        if (isInComment(match.index, commentRanges)) continue;

        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Get context (surrounding lines)
        const startLine = Math.max(0, lineNumber - 6);
        const endLine = Math.min(lines.length - 1, lineNumber + 6);
        const context = lines.slice(startLine, endLine + 1).join('\n');

        // Check for suppression annotation
        if (hasSuppression(context, pattern.patternId)) continue;

        // Pattern-specific false positive filtering

        // MEMORY LEAK: Check for class-level dispose or onended cleanup
        if (pattern.patternId === 'memory-leak') {
          // For Tone.js nodes (pattern regex matches "new Tone."), check class-level dispose
          if (pattern.regex.includes('Tone') || pattern.name.includes('dispose')) {
            if (hasClassLevelDispose(content, lineNumber, match.index)) continue;
          }
          // For AudioNodes (createBufferSource), check for onended cleanup
          if (pattern.name.includes('AudioNode') || pattern.name.includes('disconnect') || pattern.regex.includes('BufferSource')) {
            if (fileAnalysis.hasOnendedCleanup) continue;
            // Also check in immediate context
            if (context.includes('.onended') && context.includes('disconnect')) continue;
          }
        }

        // STALE STATE: Check for timer tracking
        if (pattern.patternId === 'stale-state-after-stop') {
          if (isTimerTracked(content, match.index, fileAnalysis)) continue;
          // Also skip React effect cleanup patterns
          if (context.includes('return () => clearTimeout')) continue;
        }

        // UNSTABLE CALLBACK: Skip if using stable patterns
        if (pattern.patternId === 'unstable-callback-in-effect') {
          if (context.includes('useStableCallback')) continue;
          if (context.includes('Ref.current')) continue;
          if (context.includes('stateRef')) continue;
        }

        // SERIALIZATION BOUNDARY: Skip if type parity enforced
        if (pattern.patternId === 'serialization-boundary-mismatch') {
          if (fileAnalysis.hasTypeParityCheck) continue;
          if (context.includes('canonicalizeForHash')) continue;
          if (context.includes('AssertSameKeys')) continue;
          // Check if there's a worker/types.test.ts with parity checks (known location)
          try {
            const srcDir = filePath.substring(0, filePath.lastIndexOf('/src/') + 5);
            const workerTestPath = path.join(srcDir, 'worker', 'types.test.ts');
            if (fs.existsSync(workerTestPath)) {
              const testContent = fs.readFileSync(workerTestPath, 'utf-8');
              if (testContent.includes('AssertSameKeys') || testContent.includes('Track/SessionTrack field parity')) {
                continue;
              }
            }
          } catch {
            // Ignore errors reading test file
          }
        }

        // HMR CLEANUP: Skip if already has HMR handling
        if (pattern.patternId === 'singleton-missing-hmr-cleanup') {
          if (fileAnalysis.hasHmrCleanup) continue;
          // For singleton pattern, only flag if file has external resources
          if (pattern.name.includes('Singleton')) {
            const hasExternalResources =
              content.includes('addEventListener') ||
              content.includes('setInterval') ||
              content.includes('new WebSocket');
            if (!hasExternalResources) continue;
          }
        }

        // ASYNC INIT RACE: Check for readiness guards
        if (pattern.patternId === 'async-init-race-condition') {
          const guardPattern = pattern.name.includes('Advanced')
            ? /isToneSynthReady\s*\(\s*['"]advanced['"]\s*\)/
            : /isToneSynthReady\s*\(\s*['"]tone['"]\s*\)/;
          if (hasReadinessGuard(content, match.index, guardPattern)) continue;
        }

        // PLAY BEFORE READY: Check for readiness guards
        if (pattern.patternId === 'play-before-ready') {
          if (hasReadinessGuard(content, match.index, /isSampledInstrumentReady/)) continue;
          // Also check for isReady() call in the function
          if (hasReadinessGuard(content, match.index, /\.isReady\s*\(\s*\)/)) continue;
        }

        // TONE CONTEXT DESYNC: Check if Tone.start follows
        if (pattern.patternId === 'tone-context-suspension-desync') {
          // Look ahead for Tone.start() - needs enough chars to find it after comments
          const afterMatch = content.substring(match.index, match.index + 600);
          if (/Tone\.start\s*\(\s*\)/.test(afterMatch)) continue;
          // Skip if before Tone is initialized (e.g., in initialize())
          if (context.includes('toneInitialized = false') ||
              context.includes('// Create master gain') ||
              context.includes('toneInitialized')) continue;
          // Skip if this is Recorder (doesn't use Tone.js)
          if (filePath.includes('Recorder.tsx')) continue;
        }

        results.push({
          file: filePath,
          line: lineNumber,
          pattern,
          match: match[0].substring(0, 100),
          context,
        });
      }
    }
  } catch (_error) {
    // Skip files that can't be read
  }

  return results;
}

/**
 * Recursively scan directory
 */
function scanDirectory(
  dirPath: string,
  patterns: CodePattern[],
  extensions: string[] = ['.ts', '.tsx']
): AnalysisResult[] {
  const results: AnalysisResult[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip excluded paths
      if (EXCLUDED_PATHS.some(excluded => fullPath.includes(excluded))) {
        continue;
      }

      if (entry.isDirectory()) {
        // Skip node_modules
        if (entry.name !== 'node_modules') {
          results.push(...scanDirectory(fullPath, patterns, extensions));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          results.push(...scanFile(fullPath, patterns));
        }
      }
    }
  } catch (_error) {
    // Skip directories that can't be read
  }

  return results;
}

/**
 * Format results for console output
 */
function formatResults(results: AnalysisResult[]): string {
  if (results.length === 0) {
    return '✅ No potential issues found!\n';
  }

  let output = '';

  // Group by pattern
  const byPattern = new Map<string, AnalysisResult[]>();
  for (const result of results) {
    const key = result.pattern.patternId;
    const existing = byPattern.get(key) || [];
    existing.push(result);
    byPattern.set(key, existing);
  }

  for (const [patternId, patternResults] of byPattern) {
    const pattern = patternResults[0].pattern;
    const severityEmoji =
      pattern.severity === 'high' ? '🔴' :
      pattern.severity === 'medium' ? '🟡' :
      '🟢';

    output += `\n${severityEmoji} ${pattern.name} (${patternId})\n`;
    output += `   ${pattern.description}\n`;
    output += `   Fix: ${pattern.fixSummary}\n`;
    output += `   Found ${patternResults.length} occurrence(s):\n\n`;

    for (const result of patternResults) {
      const relativePath = path.relative(process.cwd(), result.file);
      output += `   📄 ${relativePath}:${result.line}\n`;
      output += `   ${result.context.split('\n').map(l => '      ' + l).join('\n')}\n\n`;
    }
  }

  return output;
}

/**
 * Generate summary statistics
 */
function generateSummary(results: AnalysisResult[]): string {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byPattern = new Map<string, number>();

  for (const result of results) {
    const severity = result.pattern.severity as keyof typeof bySeverity;
    bySeverity[severity]++;

    const count = byPattern.get(result.pattern.patternId) || 0;
    byPattern.set(result.pattern.patternId, count + 1);
  }

  let summary = '\n📊 Summary\n';
  summary += '─'.repeat(40) + '\n';
  summary += `Total potential issues: ${results.length}\n`;
  summary += `  🔴 High severity:   ${bySeverity.high}\n`;
  summary += `  🟡 Medium severity: ${bySeverity.medium}\n`;
  summary += `  🟢 Low severity:    ${bySeverity.low}\n\n`;

  if (byPattern.size > 0) {
    summary += 'By pattern:\n';
    for (const [pattern, count] of byPattern) {
      summary += `  - ${pattern}: ${count}\n`;
    }
  }

  return summary;
}

/**
 * Main entry point
 */
function main(): void {
  const args = process.argv.slice(2);
  let patterns = CODE_PATTERNS;
  let targetDir = path.join(process.cwd(), 'src');

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pattern' && args[i + 1]) {
      const patternId = args[i + 1];
      patterns = patterns.filter(p => p.patternId === patternId);
      i++;
    } else if (args[i] === '--category' && args[i + 1]) {
      const category = args[i + 1];
      patterns = patterns.filter(p => p.patternId.includes(category));
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      targetDir = args[i + 1];
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Bug Pattern Analysis Tool v2.0

Usage:
  npx ts-node scripts/analyze-bug-patterns.ts [options]

Options:
  --pattern <id>    Only check specific pattern (e.g., audio-context-mismatch)
  --category <cat>  Only check patterns in category (e.g., singleton)
  --dir <path>      Directory to scan (default: ./src)
  --help            Show this help

Suppression annotations (add to code to skip false positives):
  // @bug-pattern-ignore <pattern-id>   Skip specific pattern
  // @bug-pattern-ignore *              Skip all patterns for this line
  // @safe: <reason>                    Mark as intentionally safe

Examples:
  npx ts-node scripts/analyze-bug-patterns.ts
  npx ts-node scripts/analyze-bug-patterns.ts --pattern stale-state-after-stop
  npx ts-node scripts/analyze-bug-patterns.ts --dir ./src/audio
      `);
      process.exit(0);
    }
  }

  console.log('🔍 Bug Pattern Analysis Tool v2.0\n');
  console.log(`Scanning: ${targetDir}`);
  console.log(`Patterns: ${patterns.length}\n`);

  const results = scanDirectory(targetDir, patterns);

  console.log(formatResults(results));
  console.log(generateSummary(results));

  // Exit with error code if high severity issues found
  const highSeverity = results.filter(r => r.pattern.severity === 'high');
  if (highSeverity.length > 0) {
    console.log('⚠️  High severity issues found. Review recommended.\n');
    process.exit(1);
  }
}

main();
