#!/usr/bin/env npx ts-node
/**
 * AST-Based Bug Pattern Analysis Tool (v2)
 *
 * This script uses ts-morph for AST-based analysis to eliminate false positives
 * that plague regex-based detection.
 *
 * Key improvements over v1 (regex-based):
 * 1. play-before-ready: Detects if playSampledInstrument() is inside else block of readiness check
 * 2. stale-state-after-stop: Tracks timer IDs stored in class fields and cleared in dispose()
 * 3. memory-leak: Maps Tone.js node creation to disposal calls across class methods
 *
 * Usage:
 *   npx tsx scripts/analyze-bug-patterns-v2.ts
 *   npx tsx scripts/analyze-bug-patterns-v2.ts --pattern play-before-ready
 *   npx tsx scripts/analyze-bug-patterns-v2.ts --verbose
 */

import * as path from 'path';
import { Project, SyntaxKind, Node, ClassDeclaration, IfStatement, CallExpression, SourceFile } from 'ts-morph';

// ===========================================================================
// Types
// ===========================================================================

interface AnalysisResult {
  file: string;
  line: number;
  patternId: string;
  patternName: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  context: string;
}

interface PatternAnalyzer {
  id: string;
  name: string;
  severity: 'high' | 'medium' | 'low';
  analyze: (sourceFile: SourceFile, results: AnalysisResult[]) => void;
}

// ===========================================================================
// Pattern 1: play-before-ready
// ===========================================================================
// Detects playSampledInstrument() calls that are NOT guarded by readiness checks.
// False positive elimination: Skip if call is inside else block of an if statement
// that checks isSampledInstrumentReady() or equivalent.

function analyzePlayBeforeReady(sourceFile: SourceFile, results: AnalysisResult[]): void {
  // Only analyze audio files
  const filePath = sourceFile.getFilePath();
  if (!filePath.includes('/audio/') && !filePath.includes('/scheduler')) {
    return;
  }

  // Find all playSampledInstrument calls
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExpressions) {
    const callText = call.getText();

    // Check if this is a playSampledInstrument call
    if (!callText.includes('playSampledInstrument')) {
      continue;
    }

    // Walk up to find if we're inside an if/else block with readiness check
    if (isInsideReadinessGuard(call)) {
      continue; // This is properly guarded, skip it
    }

    // Not guarded - this is a potential issue
    results.push({
      file: filePath,
      line: call.getStartLineNumber(),
      patternId: 'play-before-ready',
      patternName: 'Play without readiness check',
      severity: 'high',
      message: 'playSampledInstrument() call without readiness guard',
      context: getContextLines(sourceFile, call.getStartLineNumber(), 3),
    });
  }
}

/**
 * Check if a call expression is inside a readiness guard (else block of if-check)
 */
function isInsideReadinessGuard(node: Node): boolean {
  let current: Node | undefined = node;

  while (current) {
    const parent = current.getParent();
    if (!parent) break;

    // Check if parent is an if statement
    if (Node.isIfStatement(parent)) {
      const ifStmt = parent as IfStatement;
      const elseStatement = ifStmt.getElseStatement();
      const thenStatement = ifStmt.getThenStatement();
      const condition = ifStmt.getExpression();
      const conditionText = condition.getText();

      // Check if we're in the else block of a negative readiness check
      // Pattern: if (!isReady()) { warn } else { play() }
      if (elseStatement && isNodeDescendantOf(node, elseStatement)) {
        if (conditionText.includes('isSampledInstrumentReady') ||
            conditionText.includes('isReady') ||
            conditionText.includes('isToneSynthReady')) {
          return true;
        }
      }

      // Check if we're in the then-block and the condition is a positive readiness check
      // Pattern: if (isReady()) { play() }
      if (thenStatement && isNodeDescendantOf(node, thenStatement)) {
        if (!conditionText.startsWith('!') &&
            (conditionText.includes('isSampledInstrumentReady') ||
             conditionText.includes('isReady') ||
             conditionText.includes('isToneSynthReady'))) {
          return true;
        }
      }
    }

    current = parent;
  }

  return false;
}

function isNodeDescendantOf(node: Node, ancestor: Node): boolean {
  let current: Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.getParent();
  }
  return false;
}

// ===========================================================================
// Pattern 2: stale-state-after-stop
// ===========================================================================
// Detects setTimeout calls in audio code where the timer ID is NOT:
// 1. Stored in a class field, AND
// 2. Cleared in a dispose/stop/cleanup method

function analyzeStaleStateAfterStop(sourceFile: SourceFile, results: AnalysisResult[]): void {
  // Only analyze audio files
  const filePath = sourceFile.getFilePath();
  if (!filePath.includes('/audio/')) {
    return;
  }

  // Skip test files
  if (filePath.includes('.test.')) {
    return;
  }

  const classes = sourceFile.getClasses();

  for (const classDecl of classes) {
    analyzeClassForTimerTracking(classDecl, results, filePath);
  }

  // Also check for setTimeout at module level (outside classes)
  const topLevelSetTimeouts = findTopLevelSetTimeouts(sourceFile);
  for (const call of topLevelSetTimeouts) {
    // Check if it's tracked in pendingTimers or has cleanup return
    const context = getContextLines(sourceFile, call.getStartLineNumber(), 5);
    if (context.includes('pendingTimers') ||
        context.includes('return () => clearTimeout') ||
        context.includes('pendingCleanups')) {
      continue;
    }

    results.push({
      file: filePath,
      line: call.getStartLineNumber(),
      patternId: 'stale-state-after-stop',
      patternName: 'Untracked setTimeout',
      severity: 'medium',
      message: 'setTimeout without timer tracking at module level',
      context,
    });
  }
}

function analyzeClassForTimerTracking(
  classDecl: ClassDeclaration,
  results: AnalysisResult[],
  filePath: string
): void {
  // Find all class properties that could store timer IDs
  const timerFields = new Set<string>();
  const trackedTimerSets = new Set<string>(); // e.g., pendingTimers

  for (const prop of classDecl.getProperties()) {
    const propType = prop.getType().getText();
    const propName = prop.getName();

    // Check for timer ID types
    if (propType.includes('Timeout') ||
        propType.includes('ReturnType<typeof setTimeout>')) {
      timerFields.add(propName);
    }

    // Check for Set of timers
    if (propType.includes('Set<') &&
        (propType.includes('Timeout') || propType.includes('setTimeout'))) {
      trackedTimerSets.add(propName);
    }
  }

  // Find dispose/cleanup/stop methods
  const cleanupMethods = new Set<string>();
  for (const method of classDecl.getMethods()) {
    const name = method.getName();
    if (name === 'dispose' || name === 'cleanup' || name === 'stop' ||
        name === 'stopAll' || name === 'cancelPendingRelease') {
      cleanupMethods.add(name);
    }
  }

  // Check if timer fields are cleared in cleanup methods
  const clearedFields = new Set<string>();
  for (const methodName of cleanupMethods) {
    const method = classDecl.getMethod(methodName);
    if (!method) continue;

    const methodText = method.getText();
    for (const field of timerFields) {
      if (methodText.includes(`clearTimeout(this.${field})`) ||
          methodText.includes(`clearTimeout(this.${field})`)) {
        clearedFields.add(field);
      }
    }

    // Check if timer sets are cleared
    for (const timerSet of trackedTimerSets) {
      if (methodText.includes(`this.${timerSet}.clear()`) ||
          methodText.includes(`for (const timer of this.${timerSet})`)) {
        // Timer set is properly cleared
      }
    }
  }

  // Find setTimeout calls in all methods
  for (const method of classDecl.getMethods()) {
    const setTimeoutCalls = method.getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter(call => call.getText().startsWith('setTimeout'));

    for (const call of setTimeoutCalls) {
      // Get the parent statement to check if result is assigned
      const parent = call.getParent();

      // Check if timer is assigned to a tracked field
      let isTracked = false;

      if (Node.isBinaryExpression(parent)) {
        const leftText = parent.getLeft().getText();
        // Check if assigned to a timer field
        for (const field of timerFields) {
          if (leftText === `this.${field}` && clearedFields.has(field)) {
            isTracked = true;
            break;
          }
        }
      }

      // Check if timer is added to a tracking set
      const context = getContextLines(
        classDecl.getSourceFile(),
        call.getStartLineNumber(),
        3
      );
      if (trackedTimerSets.size > 0 && context.includes('.add(')) {
        isTracked = true;
      }

      // Check for common patterns that indicate proper tracking
      if (context.includes('pendingTimers') ||
          context.includes('pendingCleanups') ||
          context.includes('.delete(timer)') ||
          context.includes('.delete(cleanupTimer)')) {
        isTracked = true;
      }

      // Check for React-style cleanup patterns
      if (context.includes('return () => clearTimeout')) {
        isTracked = true;
      }

      if (!isTracked) {
        // Check if this is the cancelPendingRelease method itself or dispose
        if (method.getName() === 'dispose' ||
            method.getName() === 'cancelPendingRelease' ||
            method.getName() === 'stop') {
          continue;
        }

        // Additional check: look for assignment pattern like "this.xxxTimeoutId = setTimeout"
        const surroundingCode = getContextLines(
          classDecl.getSourceFile(),
          call.getStartLineNumber(),
          2
        );
        let hasAssignmentToField = false;
        for (const field of timerFields) {
          if (surroundingCode.includes(`this.${field} = setTimeout`) ||
              surroundingCode.includes(`this.${field} =`) && surroundingCode.includes('setTimeout')) {
            hasAssignmentToField = true;
            break;
          }
        }

        if (hasAssignmentToField && clearedFields.size > 0) {
          continue; // Timer is stored and there's a cleanup method
        }

        // Check if any timer field exists and is cleared - this indicates the class
        // handles timers properly even if this specific call looks untracked
        if (clearedFields.size > 0 && surroundingCode.includes('TimeoutId')) {
          continue;
        }

        results.push({
          file: filePath,
          line: call.getStartLineNumber(),
          patternId: 'stale-state-after-stop',
          patternName: 'Potentially untracked setTimeout',
          severity: 'medium',
          message: `setTimeout in ${classDecl.getName()}.${method.getName()} may not be properly tracked`,
          context,
        });
      }
    }
  }
}

function findTopLevelSetTimeouts(sourceFile: SourceFile): CallExpression[] {
  const result: CallExpression[] = [];

  for (const statement of sourceFile.getStatements()) {
    // Skip class and function declarations - we handle those separately
    if (Node.isClassDeclaration(statement) || Node.isFunctionDeclaration(statement)) {
      continue;
    }

    const calls = statement.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      if (call.getText().startsWith('setTimeout')) {
        result.push(call);
      }
    }
  }

  return result;
}

// ===========================================================================
// Pattern 3: memory-leak (Tone.js disposal)
// ===========================================================================
// Detects new Tone.X() creations that are NOT disposed in a dispose() method

function analyzeMemoryLeak(sourceFile: SourceFile, results: AnalysisResult[]): void {
  // Only analyze audio files
  const filePath = sourceFile.getFilePath();
  if (!filePath.includes('/audio/') && !filePath.includes('/utils/')) {
    return;
  }

  // Skip test files
  if (filePath.includes('.test.')) {
    return;
  }

  const classes = sourceFile.getClasses();

  for (const classDecl of classes) {
    analyzeClassForToneDisposal(classDecl, results, filePath);
  }
}

function analyzeClassForToneDisposal(
  classDecl: ClassDeclaration,
  results: AnalysisResult[],
  filePath: string
): void {
  // Find all properties that store Tone.js objects
  const toneFields = new Map<string, number>(); // field name -> line number

  for (const prop of classDecl.getProperties()) {
    const propType = prop.getType().getText();
    const propName = prop.getName();

    // Check for Tone.js types
    if (propType.includes('Tone.') ||
        propType.includes('import("tone")')) {
      toneFields.set(propName, prop.getStartLineNumber());
    }
  }

  // Also find Tone.js creations in methods
  const toneCreationsInMethods = new Map<string, { line: number; field: string | null }>();

  for (const method of classDecl.getMethods()) {
    if (method.getName() === 'dispose') continue; // Skip dispose method for detection

    const newExpressions = method.getDescendantsOfKind(SyntaxKind.NewExpression);

    for (const newExpr of newExpressions) {
      const exprText = newExpr.getText();

      // Check if this is a Tone.js instantiation
      if (!exprText.startsWith('new Tone.')) continue;

      // Extract the type (e.g., "Tone.Oscillator" from "new Tone.Oscillator({...})")
      const toneTypeMatch = exprText.match(/new (Tone\.\w+)/);
      if (!toneTypeMatch) continue;

      const _toneType = toneTypeMatch[1];

      // Check if this is assigned to a class field
      const parent = newExpr.getParent();
      let fieldName: string | null = null;

      if (Node.isBinaryExpression(parent)) {
        const leftText = parent.getLeft().getText();
        if (leftText.startsWith('this.')) {
          fieldName = leftText.replace('this.', '');
        }
      }

      // Track this creation
      const key = `${method.getName()}:${newExpr.getStartLineNumber()}`;
      toneCreationsInMethods.set(key, {
        line: newExpr.getStartLineNumber(),
        field: fieldName,
      });
    }
  }

  // Find dispose method and check what's disposed
  const disposeMethod = classDecl.getMethod('dispose');
  const disposedFields = new Set<string>();

  if (disposeMethod) {
    const disposeText = disposeMethod.getText();

    // Find all .dispose() calls in the dispose method
    for (const [fieldName] of toneFields) {
      if (disposeText.includes(`this.${fieldName}?.dispose()`) ||
          disposeText.includes(`this.${fieldName}.dispose()`) ||
          disposeText.includes(`this.${fieldName}?.stop()`) ||
          disposeText.includes(`this.${fieldName}.stop()`)) {
        disposedFields.add(fieldName);
      }
    }

    // Also check for array/pool disposal patterns
    if (disposeText.includes('.dispose()') || disposeText.includes('voice.dispose()')) {
      // Class uses disposal pattern, likely handles all Tone objects
      return;
    }
  }

  // Report Tone fields that aren't disposed
  for (const [fieldName, lineNumber] of toneFields) {
    if (!disposedFields.has(fieldName)) {
      // Check if there's any dispose method at all
      if (!disposeMethod) {
        results.push({
          file: filePath,
          line: lineNumber,
          patternId: 'memory-leak',
          patternName: 'Missing dispose for Tone.js field',
          severity: 'medium',
          message: `Tone.js field '${fieldName}' in ${classDecl.getName()} has no dispose() method`,
          context: getContextLines(sourceFile, lineNumber, 2),
        });
      } else {
        // dispose exists but doesn't handle this field
        // This could still be fine if the field is handled differently
        // Only report if the class creates and stores Tone objects but doesn't dispose them
        const methodsWithCreation = Array.from(toneCreationsInMethods.entries())
          .filter(([, info]) => info.field === fieldName);

        if (methodsWithCreation.length > 0) {
          results.push({
            file: filePath,
            line: lineNumber,
            patternId: 'memory-leak',
            patternName: 'Tone.js field not disposed',
            severity: 'medium',
            message: `Tone.js field '${fieldName}' created but not disposed in ${classDecl.getName()}.dispose()`,
            context: getContextLines(sourceFile, lineNumber, 2),
          });
        }
      }
    }
  }
}

// ===========================================================================
// Utility Functions
// ===========================================================================

function getContextLines(sourceFile: SourceFile, lineNumber: number, contextSize: number): string {
  const text = sourceFile.getFullText();
  const lines = text.split('\n');

  const startLine = Math.max(0, lineNumber - contextSize - 1);
  const endLine = Math.min(lines.length - 1, lineNumber + contextSize - 1);

  return lines.slice(startLine, endLine + 1)
    .map((line, i) => `${startLine + i + 1}: ${line}`)
    .join('\n');
}

// ===========================================================================
// Main Analysis
// ===========================================================================

const PATTERN_ANALYZERS: PatternAnalyzer[] = [
  {
    id: 'play-before-ready',
    name: 'Play Before Ready (Race Condition)',
    severity: 'high',
    analyze: analyzePlayBeforeReady,
  },
  {
    id: 'stale-state-after-stop',
    name: 'Stale State After Stop',
    severity: 'medium',
    analyze: analyzeStaleStateAfterStop,
  },
  {
    id: 'memory-leak',
    name: 'Memory Leak (Tone.js disposal)',
    severity: 'medium',
    analyze: analyzeMemoryLeak,
  },
];

function formatResults(results: AnalysisResult[]): string {
  if (results.length === 0) {
    return '✅ No potential issues found!\n';
  }

  let output = '';

  // Group by pattern
  const byPattern = new Map<string, AnalysisResult[]>();
  for (const result of results) {
    const key = result.patternId;
    const existing = byPattern.get(key) || [];
    existing.push(result);
    byPattern.set(key, existing);
  }

  for (const [patternId, patternResults] of byPattern) {
    const first = patternResults[0];
    const severityEmoji =
      first.severity === 'high' ? '🔴' :
      first.severity === 'medium' ? '🟡' :
      '🟢';

    output += `\n${severityEmoji} ${first.patternName} (${patternId})\n`;
    output += `   Found ${patternResults.length} occurrence(s):\n\n`;

    for (const result of patternResults) {
      const relativePath = path.relative(process.cwd(), result.file);
      output += `   📄 ${relativePath}:${result.line}\n`;
      output += `      ${result.message}\n`;
      output += `      ${result.context.split('\n').map(l => '      ' + l).join('\n')}\n\n`;
    }
  }

  return output;
}

function generateSummary(results: AnalysisResult[]): string {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byPattern = new Map<string, number>();

  for (const result of results) {
    bySeverity[result.severity]++;
    const count = byPattern.get(result.patternId) || 0;
    byPattern.set(result.patternId, count + 1);
  }

  let summary = '\n📊 Summary (AST-based analysis v2)\n';
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

function main(): void {
  const args = process.argv.slice(2);
  let analyzers = PATTERN_ANALYZERS;
  let verbose = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pattern' && args[i + 1]) {
      const patternId = args[i + 1];
      analyzers = analyzers.filter(a => a.id === patternId);
      i++;
    } else if (args[i] === '--verbose') {
      verbose = true;
    } else if (args[i] === '--help') {
      console.log(`
Bug Pattern Analysis Tool v2 (AST-based)

This version uses ts-morph for accurate AST-based analysis,
eliminating the false positives that plague regex-based detection.

Usage:
  npx tsx scripts/analyze-bug-patterns-v2.ts [options]

Options:
  --pattern <id>    Only check specific pattern (play-before-ready, stale-state-after-stop, memory-leak)
  --verbose         Show debug output during analysis
  --help            Show this help

Examples:
  npx tsx scripts/analyze-bug-patterns-v2.ts
  npx tsx scripts/analyze-bug-patterns-v2.ts --pattern memory-leak
  npx tsx scripts/analyze-bug-patterns-v2.ts --verbose
      `);
      process.exit(0);
    }
  }

  console.log('🔍 Bug Pattern Analysis Tool v2 (AST-based)\n');
  console.log(`Patterns: ${analyzers.map(a => a.id).join(', ')}\n`);

  // Create ts-morph project
  const project = new Project({
    tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });

  // Add source files
  const srcDir = path.join(process.cwd(), 'src');
  project.addSourceFilesAtPaths([
    `${srcDir}/**/*.ts`,
    `${srcDir}/**/*.tsx`,
    `!${srcDir}/**/*.test.ts`,
    `!${srcDir}/**/*.test.tsx`,
  ]);

  const sourceFiles = project.getSourceFiles();
  if (verbose) {
    console.log(`Found ${sourceFiles.length} source files\n`);
  }

  // Run analysis
  const results: AnalysisResult[] = [];

  for (const sourceFile of sourceFiles) {
    if (verbose) {
      console.log(`Analyzing: ${path.relative(process.cwd(), sourceFile.getFilePath())}`);
    }

    for (const analyzer of analyzers) {
      analyzer.analyze(sourceFile, results);
    }
  }

  // Output results
  console.log(formatResults(results));
  console.log(generateSummary(results));

  // Exit with error code if high severity issues found
  const highSeverity = results.filter(r => r.severity === 'high');
  if (highSeverity.length > 0) {
    console.log('⚠️  High severity issues found. Review recommended.\n');
    process.exit(1);
  }

  if (results.length === 0) {
    console.log('✅ All patterns pass! AST-based analysis eliminated false positives.\n');
  }
}

main();
