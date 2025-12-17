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

        // Get context (surrounding lines)
        const startLine = Math.max(0, lineNumber - 2);
        const endLine = Math.min(lines.length - 1, lineNumber + 2);
        const context = lines.slice(startLine, endLine + 1).join('\n');

        // Skip if context shows proper cleanup (React effect pattern)
        if (context.includes('return () => clearTimeout')) continue;
        if (context.includes('pendingTimers.add')) continue;

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
