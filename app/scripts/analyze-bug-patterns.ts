#!/usr/bin/env npx ts-node
/**
 * Bug Pattern Analysis Tool
 *
 * This script analyzes the codebase for known bug patterns and potential issues.
 * Run it after fixing a bug to check for similar issues elsewhere.
 *
 * Usage:
 *   npx ts-node scripts/analyze-bug-patterns.ts
 *   npx ts-node scripts/analyze-bug-patterns.ts --pattern audio-context-mismatch
 *   npx ts-node scripts/analyze-bug-patterns.ts --category singleton
 *
 * This tool:
 * 1. Scans code for patterns associated with known bugs
 * 2. Reports potential issues with file locations
 * 3. Provides fix guidance from the bug pattern registry
 */

import * as fs from 'fs';
import * as path from 'path';

// Import bug patterns (we'll inline the essential data to avoid import issues)
// In production, you'd import from '../src/utils/bug-patterns'

interface CodePattern {
  patternId: string;
  name: string;
  severity: string;
  regex: string;
  description: string;
  fixSummary: string;
}

// Bug patterns with their code signatures
const CODE_PATTERNS: CodePattern[] = [
  // =============================================================================
  // SERIALIZATION BOUNDARY MISMATCH (Phase 12 bug)
  // =============================================================================
  // Root cause: Track (client) and SessionTrack (server) had different field
  // optionality, causing JSON.stringify to produce different output.
  // See docs/bug-patterns.md "Serialization Boundary Mismatch" for details.
  {
    patternId: 'serialization-boundary-mismatch',
    name: 'Optional field in shared type',
    severity: 'high',
    regex: '(SessionTrack|SessionState)\\s*\\{[^}]*\\w+\\?:',
    description: 'Optional field in server type may cause JSON serialization mismatch with client',
    fixSummary: 'Ensure field exists in both Track and SessionTrack. If optional, add to canonicalizeForHash()',
  },
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
  // Root cause: useCallback with state dependencies was used as useEffect dependency,
  // causing effect to re-run on every state change (WebSocket reconnection storm).
  // See docs/bug-patterns.md "Unstable Callback in useEffect Dependency" for details.
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
  // AUDIO CONTEXT MISMATCH (existing pattern)
  // =============================================================================
  // AudioContext Mismatch
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

  // Stale State - only flag setTimeouts in audio/ that aren't tracked
  // Skip React effects which use cleanup returns
  {
    patternId: 'stale-state-after-stop',
    name: 'Untracked setTimeout in audio code',
    severity: 'medium',
    regex: 'setTimeout\\s*\\(\\s*\\(\\)\\s*=>\\s*\\{[^}]{0,200}(?<!pendingTimers\\.add)',
    description: 'setTimeout in audio code without pendingTimers tracking',
    fixSummary: 'Add timer to pendingTimers Set and clear in stop()',
  },
  {
    patternId: 'stale-state-after-stop',
    name: 'Missing isRunning check in callback',
    severity: 'medium',
    regex: 'setTimeout\\s*\\(\\s*\\(\\)\\s*=>\\s*\\{(?!.*isRunning)',
    description: 'Timer callback without isRunning guard',
    fixSummary: 'Add if (!this.isRunning) return; at start of callback',
  },

  // Silent Instrument
  {
    patternId: 'silent-instrument',
    name: 'Play method without logging',
    severity: 'low',
    regex: 'play(Note|Synth|Sample)\\s*\\([^)]*\\)\\s*\\{[^}]{0,50}(?!logger)',
    description: 'Playback method without diagnostic logging',
    fixSummary: 'Add logger.audio.log at entry point',
  },

  // Race Condition
  {
    patternId: 'play-before-ready',
    name: 'Play without readiness check',
    severity: 'high',
    regex: 'playSampledInstrument\\s*\\([^)]*\\)(?!.*isReady)',
    description: 'Playing sampled instrument without checking if ready',
    fixSummary: 'Add isSampledInstrumentReady() check before playing',
  },

  // Memory Leak
  {
    patternId: 'memory-leak',
    name: 'Missing disconnect on AudioNode',
    severity: 'medium',
    regex: 'createBufferSource\\s*\\(\\)(?!.*onended.*disconnect)',
    description: 'AudioBufferSourceNode without disconnect cleanup',
    fixSummary: 'Add source.onended = () => source.disconnect()',
  },
  {
    patternId: 'memory-leak',
    name: 'Missing dispose call',
    severity: 'medium',
    regex: 'new\\s+Tone\\.\\w+(?!.*dispose)',
    description: 'Tone.js node creation without dispose in cleanup',
    fixSummary: 'Add .dispose() call in cleanup/dispose method',
  },

  // =============================================================================
  // SINGLETON MISSING HMR CLEANUP (Phase 26 bug)
  // =============================================================================
  // Root cause: Singletons with external resources (event listeners, timers,
  // WebSocket) leak during HMR because old instance resources aren't cleaned up.
  // See: src/utils/bug-patterns.ts "singleton-missing-hmr-cleanup" for details.
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
  {
    patternId: 'singleton-missing-hmr-cleanup',
    name: 'setInterval in singleton module',
    severity: 'medium',
    regex: 'setInterval\\s*\\(',
    description: 'Interval timer that may leak during HMR if not cleaned up',
    fixSummary: 'Ensure module has registerHmrDispose() that clears interval',
  },

  // =============================================================================
  // ASYNC ENGINE INITIALIZATION RACE CONDITION (Phase 29 bug)
  // =============================================================================
  // Root cause: Code checks isInitialized() but not isToneSynthReady() before
  // playing Tone.js-based instruments (tone:* or advanced:*).
  // See docs/bug-patterns.md "Async Engine Initialization Race Condition" for details.
  {
    patternId: 'async-init-race-condition',
    name: 'playAdvancedSynth without readiness check',
    severity: 'high',
    regex: 'playAdvancedSynth\\s*\\([^)]*\\)',
    description: 'Calling playAdvancedSynth without checking isToneSynthReady("advanced")',
    fixSummary: 'Add isToneSynthReady("advanced") check before calling playAdvancedSynth',
  },
  {
    patternId: 'async-init-race-condition',
    name: 'playToneSynth without readiness check',
    severity: 'high',
    regex: 'playToneSynth\\s*\\([^)]*\\)',
    description: 'Calling playToneSynth without checking isToneSynthReady("tone")',
    fixSummary: 'Add isToneSynthReady("tone") check before calling playToneSynth',
  },

  // =============================================================================
  // SILENT SKIP ANTI-PATTERN (Phase 29 meta-bug)
  // =============================================================================
  // Root cause: Adding a "check and skip" guard without proactive initialization.
  // The guard prevents the resource from ever being used because nothing triggers init.
  // See docs/BUG-PATTERNS.md "Silent Skip Anti-Pattern" for details.
  {
    patternId: 'silent-skip-antipattern',
    name: 'Readiness check without initialization trigger',
    severity: 'high',
    // Match: if (isToneSynthReady) { play() } without preceding initializeTone()
    // This is a heuristic - look for isToneSynthReady check in functions without await initializeTone
    regex: 'if\\s*\\(\\s*(?:audioEngine|engine)\\.isToneSynthReady\\s*\\([^)]*\\)\\s*\\)\\s*\\{',
    description: 'Readiness check may skip forever if initialization never triggered. Verify initializeTone() is called before this check.',
    fixSummary: 'Add: if (!engine.isToneInitialized()) { await engine.initializeTone(); } before the readiness check',
  },
  {
    patternId: 'silent-skip-antipattern',
    name: 'Sampled instrument check without load trigger',
    severity: 'medium',
    // Match: if (isSampledInstrumentReady) { play() } without preceding loadSampledInstrument
    regex: 'if\\s*\\(\\s*(?:audioEngine|engine)\\.isSampledInstrumentReady\\s*\\([^)]*\\)\\s*\\)\\s*\\{',
    description: 'Sampled instrument check may skip forever if loading never triggered. Verify loadSampledInstrument() is called before this check.',
    fixSummary: 'Add: if (!engine.isSampledInstrumentReady(id)) { await engine.loadSampledInstrument(id); } before playing',
  },

  // =============================================================================
  // TONE.JS CONTEXT SUSPENSION DESYNC (Phase 29 bug)
  // =============================================================================
  // Root cause: When browser suspends AudioContext (tab background, sleep), resuming
  // only the Web Audio context leaves Tone.js synths in a desync state.
  // See docs/BUG-PATTERNS.md "Tone.js Context Suspension Desync" for details.
  {
    patternId: 'tone-context-suspension-desync',
    name: 'audioContext.resume without Tone.start',
    severity: 'high',
    // Match: audioContext.resume() not followed by Tone.start() in same block
    regex: 'await\\s+(?:this\\.)?audioContext(?:!)?\\.resume\\(\\)(?!.*Tone\\.start)',
    description: 'Resuming AudioContext without also resuming Tone.js. Tone.js synths may stop working after tab backgrounding.',
    fixSummary: 'Add: if (this.toneInitialized) { await Tone.start(); } after audioContext.resume()',
  },
  {
    patternId: 'tone-context-suspension-desync',
    name: 'ensureAudioReady without Tone resume',
    severity: 'medium',
    // Match: ensureAudioReady function that only checks audioContext state
    regex: 'ensureAudioReady\\s*\\([^)]*\\)\\s*:\\s*Promise<boolean>\\s*\\{[^}]*resume\\(\\)(?!.*Tone\\.start)',
    description: 'ensureAudioReady resumes Web Audio but not Tone.js. May cause "worked then stopped" bug.',
    fixSummary: 'Add Tone.start() call after audioContext.resume() when toneInitialized is true',
  },
];

interface AnalysisResult {
  file: string;
  line: number;
  pattern: CodePattern;
  match: string;
  context: string;
}

/**
 * Check if a pattern should apply to a file based on path
 */
function shouldApplyPattern(pattern: CodePattern, filePath: string): boolean {
  // Stale state patterns only apply to audio code
  if (pattern.patternId === 'stale-state-after-stop') {
    return filePath.includes('/audio/');
  }
  // Memory leak patterns apply to audio and utils
  if (pattern.patternId === 'memory-leak') {
    return filePath.includes('/audio/') || filePath.includes('/utils/');
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
  // Silent skip patterns apply to components and hooks (UI code calling audio)
  if (pattern.patternId === 'silent-skip-antipattern') {
    return filePath.endsWith('.tsx') || filePath.includes('/hooks/');
  }
  return true;
}

/**
 * Scan a file for bug patterns
 */
function scanFile(filePath: string, patterns: CodePattern[]): AnalysisResult[] {
  const results: AnalysisResult[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const pattern of patterns) {
      // Skip patterns that don't apply to this file type
      if (!shouldApplyPattern(pattern, filePath)) continue;

      const regex = new RegExp(pattern.regex, 'gm');
      let match;

      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Get context (surrounding lines) - use ±5 lines to capture setTimeout tracking patterns
        const startLine = Math.max(0, lineNumber - 5);
        const endLine = Math.min(lines.length - 1, lineNumber + 5);
        const context = lines.slice(startLine, endLine + 1).join('\n');

        // Skip if context shows proper cleanup (React effect pattern)
        if (context.includes('return () => clearTimeout')) continue;
        if (context.includes('pendingTimers.add')) continue;
        if (context.includes('pendingCleanups.add')) continue;

        // Skip unstable callback warnings if using useStableCallback or ref pattern
        if (pattern.patternId === 'unstable-callback-in-effect') {
          if (context.includes('useStableCallback')) continue;
          if (context.includes('Ref.current')) continue;
          if (context.includes('stateRef')) continue;
          if (context.includes('// FIXED') || context.includes('// Stable')) continue;
        }

        // Skip serialization boundary warnings for documented optional fields
        if (pattern.patternId === 'serialization-boundary-mismatch') {
          if (context.includes('canonicalizeForHash')) continue;
          if (context.includes('// Optional for backwards')) continue;
          if (context.includes('OPTIONAL_SESSION_TRACK_FIELDS')) continue;
        }

        // Skip HMR warnings if file already has proper HMR handling
        if (pattern.patternId === 'singleton-missing-hmr-cleanup') {
          // Check the entire file for registerHmrDispose, not just context
          if (content.includes('registerHmrDispose')) continue;
          // Also skip the hmr.ts file itself (it's the helper, not a singleton)
          if (filePath.includes('hmr.ts')) continue;
          // Skip files that are just type definitions or constants
          if (filePath.includes('.d.ts')) continue;
          // Skip test files
          if (filePath.includes('.test.')) continue;

          // For the "Singleton export" pattern specifically, only flag if file
          // also has external resources (addEventListener, setInterval, setTimeout)
          if (pattern.name === 'Singleton with addEventListener but no HMR') {
            const hasExternalResources =
              content.includes('addEventListener') ||
              content.includes('setInterval') ||
              content.includes('new WebSocket') ||
              // setTimeout is too common, only flag if also has pending timer tracking
              (content.includes('setTimeout') && !content.includes('pendingTimers'));
            if (!hasExternalResources) continue;
          }
        }

        // Skip async init race condition warnings if context has readiness checks
        if (pattern.patternId === 'async-init-race-condition') {
          // Skip if context shows readiness check
          if (context.includes('isToneSynthReady')) continue;
          // Skip engine.ts itself (it's the implementation, not consumer)
          if (filePath.includes('engine.ts')) continue;
          // Skip scheduler.ts (it already has proper readiness checks)
          if (filePath.includes('scheduler.ts')) continue;
          // Skip test files
          if (filePath.includes('.test.')) continue;
          // Skip the debug tool (it's for debugging, not production)
          if (filePath.includes('audio-debug.ts')) continue;
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

      if (entry.isDirectory()) {
        // Skip node_modules and test directories for faster scanning
        if (entry.name !== 'node_modules' && !entry.name.includes('test')) {
          results.push(...scanDirectory(fullPath, patterns, extensions));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext) && !entry.name.includes('.test.')) {
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
Bug Pattern Analysis Tool

Usage:
  npx ts-node scripts/analyze-bug-patterns.ts [options]

Options:
  --pattern <id>    Only check specific pattern (e.g., audio-context-mismatch)
  --category <cat>  Only check patterns in category (e.g., singleton)
  --dir <path>      Directory to scan (default: ./src)
  --help            Show this help

Examples:
  npx ts-node scripts/analyze-bug-patterns.ts
  npx ts-node scripts/analyze-bug-patterns.ts --pattern stale-state-after-stop
  npx ts-node scripts/analyze-bug-patterns.ts --dir ./src/audio
      `);
      process.exit(0);
    }
  }

  console.log('🔍 Bug Pattern Analysis Tool\n');
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
