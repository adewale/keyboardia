#!/usr/bin/env npx tsx
/**
 * Post-Fix Analysis Tool
 *
 * Run this IMMEDIATELY after confirming a bug fix to find similar issues across the codebase.
 * This script is designed to be invoked by Claude Code or manually after debugging sessions.
 *
 * Usage:
 *   npx tsx scripts/post-fix-analysis.ts --pattern "pattern description" --file src/audio/engine.ts
 *   npx tsx scripts/post-fix-analysis.ts --symptom "no sound after HMR"
 *   npx tsx scripts/post-fix-analysis.ts --code-pattern "getInstance\(\)" --risky-context "Tone\."
 *   npx tsx scripts/post-fix-analysis.ts --interactive
 *
 * This tool:
 * 1. Searches for similar code patterns across the codebase
 * 2. Identifies related files that may have the same bug
 * 3. Generates a structured report for review
 * 4. Optionally updates bug-patterns.ts and DEBUGGING-LESSONS-LEARNED.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { AnalysisConfig, AnalysisReport, FileMatch } from './analysis-types';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const SRC_DIR = path.join(process.cwd(), 'src');
const EXTENSIONS = ['.ts', '.tsx'];
const EXCLUDE_DIRS = ['node_modules', 'dist', 'build', '.git', 'coverage'];

/**
 * Recursively get all source files
 */
function getSourceFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.includes(entry.name)) {
          files.push(...getSourceFiles(fullPath));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (EXTENSIONS.includes(ext) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return files;
}

/**
 * Search a file for pattern matches
 */
function searchFile(filePath: string, config: AnalysisConfig): FileMatch[] {
  const matches: FileMatch[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const pattern of config.patterns) {
      const regex = new RegExp(pattern, 'gi');
      let match;

      while ((match = regex.exec(content)) !== null) {
        // Calculate line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Skip if this is the fixed file (we already know about it)
        const relativePath = path.relative(process.cwd(), filePath);
        if (config.fixedFile && relativePath.includes(config.fixedFile)) {
          continue;
        }

        // Check for exclusion patterns
        const lineContent = lines[lineNumber - 1] || '';
        const shouldExclude = config.excludePatterns.some(ep => {
          const excludeRegex = new RegExp(ep, 'i');
          return excludeRegex.test(lineContent);
        });
        if (shouldExclude) continue;

        // Get context (surrounding lines)
        const contextStart = Math.max(0, lineNumber - 3);
        const contextEnd = Math.min(lines.length, lineNumber + 3);
        const context = lines.slice(contextStart, contextEnd);

        // Check for risky context
        const surroundingContent = context.join('\n');
        const hasRiskyContext = config.riskyContexts.some(rc => {
          const riskyRegex = new RegExp(rc, 'i');
          return riskyRegex.test(surroundingContent);
        });

        // Determine risk level
        let riskLevel: 'high' | 'medium' | 'low' = 'low';
        if (hasRiskyContext) {
          riskLevel = 'high';
        } else if (filePath.includes('/audio/') || filePath.includes('/worker/')) {
          riskLevel = 'medium';
        }

        matches.push({
          file: relativePath,
          line: lineNumber,
          content: lineContent.trim(),
          context,
          riskLevel,
          matchedPattern: pattern,
          hasRiskyContext,
        });
      }
    }
  } catch {
    // Skip files that can't be read
  }

  return matches;
}

/**
 * Run the analysis
 */
function runAnalysis(config: AnalysisConfig): AnalysisReport {
  const files = getSourceFiles(SRC_DIR);
  const allMatches: FileMatch[] = [];

  for (const file of files) {
    const matches = searchFile(file, config);
    allMatches.push(...matches);
  }

  // Deduplicate by file:line
  const seen = new Set<string>();
  const uniqueMatches = allMatches.filter(m => {
    const key = `${m.file}:${m.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by risk level
  uniqueMatches.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.riskLevel] - order[b.riskLevel];
  });

  // Generate summary
  const directories = new Set(uniqueMatches.map(m => path.dirname(m.file)));
  const highRisk = uniqueMatches.filter(m => m.riskLevel === 'high').length;
  const mediumRisk = uniqueMatches.filter(m => m.riskLevel === 'medium').length;
  const lowRisk = uniqueMatches.filter(m => m.riskLevel === 'low').length;

  // Generate recommendations
  const recommendations: string[] = [];
  if (highRisk > 0) {
    recommendations.push(`Review ${highRisk} high-risk matches immediately - they have the same risky context as the original bug`);
  }
  if (uniqueMatches.length > 10) {
    recommendations.push('Consider creating a codemod or automated fix for this pattern');
  }
  if (directories.size > 3) {
    recommendations.push('This pattern is spread across multiple directories - consider architectural changes to prevent recurrence');
  }
  if (config.symptom) {
    recommendations.push(`Add this symptom "${config.symptom}" to the bug pattern registry for future detection`);
  }

  return {
    timestamp: new Date().toISOString(),
    config,
    matches: uniqueMatches,
    summary: {
      totalFiles: new Set(uniqueMatches.map(m => m.file)).size,
      totalMatches: uniqueMatches.length,
      highRisk,
      mediumRisk,
      lowRisk,
      affectedDirectories: Array.from(directories),
    },
    recommendations,
  };
}

/**
 * Format the report for console output
 */
function formatReport(report: AnalysisReport): string {
  let output = '';

  output += `\n${colors.bright}${colors.cyan}Post-Fix Analysis Report${colors.reset}\n`;
  output += `${colors.gray}${'─'.repeat(60)}${colors.reset}\n`;
  output += `${colors.gray}Timestamp: ${report.timestamp}${colors.reset}\n\n`;

  // Summary
  output += `${colors.bright}Summary${colors.reset}\n`;
  output += `  Total matches: ${report.summary.totalMatches}\n`;
  output += `  Files affected: ${report.summary.totalFiles}\n`;
  output += `  ${colors.red}High risk: ${report.summary.highRisk}${colors.reset}\n`;
  output += `  ${colors.yellow}Medium risk: ${report.summary.mediumRisk}${colors.reset}\n`;
  output += `  ${colors.green}Low risk: ${report.summary.lowRisk}${colors.reset}\n\n`;

  // Recommendations
  if (report.recommendations.length > 0) {
    output += `${colors.bright}Recommendations${colors.reset}\n`;
    for (const rec of report.recommendations) {
      output += `  ${colors.yellow}!${colors.reset} ${rec}\n`;
    }
    output += '\n';
  }

  // Matches by risk level
  if (report.summary.highRisk > 0) {
    output += `${colors.bright}${colors.red}High Risk Matches${colors.reset}\n`;
    output += `${colors.gray}${'─'.repeat(40)}${colors.reset}\n`;
    for (const match of report.matches.filter(m => m.riskLevel === 'high')) {
      output += formatMatch(match);
    }
    output += '\n';
  }

  if (report.summary.mediumRisk > 0) {
    output += `${colors.bright}${colors.yellow}Medium Risk Matches${colors.reset}\n`;
    output += `${colors.gray}${'─'.repeat(40)}${colors.reset}\n`;
    for (const match of report.matches.filter(m => m.riskLevel === 'medium')) {
      output += formatMatch(match);
    }
    output += '\n';
  }

  if (report.summary.lowRisk > 0 && report.summary.lowRisk <= 10) {
    output += `${colors.bright}${colors.green}Low Risk Matches${colors.reset}\n`;
    output += `${colors.gray}${'─'.repeat(40)}${colors.reset}\n`;
    for (const match of report.matches.filter(m => m.riskLevel === 'low')) {
      output += formatMatch(match);
    }
  } else if (report.summary.lowRisk > 10) {
    output += `${colors.gray}(${report.summary.lowRisk} low-risk matches omitted for brevity)${colors.reset}\n`;
  }

  return output;
}

/**
 * Format a single match
 */
function formatMatch(match: FileMatch): string {
  let output = '';
  output += `\n  ${colors.blue}${match.file}:${match.line}${colors.reset}\n`;
  output += `  Pattern: ${colors.gray}${match.matchedPattern}${colors.reset}\n`;
  if (match.hasRiskyContext) {
    output += `  ${colors.red}! Has risky context${colors.reset}\n`;
  }
  output += `  ${colors.gray}Context:${colors.reset}\n`;
  for (let i = 0; i < match.context.length; i++) {
    const lineNum = match.line - 3 + i + 1;
    const isMatchLine = lineNum === match.line;
    const prefix = isMatchLine ? `${colors.yellow}>` : ' ';
    const lineColor = isMatchLine ? colors.bright : colors.gray;
    output += `    ${prefix}${lineColor}${lineNum.toString().padStart(4)}: ${match.context[i]}${colors.reset}\n`;
  }
  return output;
}

/**
 * Save report to file
 */
function saveReport(report: AnalysisReport, filename?: string): string {
  const reportsDir = path.join(process.cwd(), 'debug-reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const reportFilename = filename || `post-fix-analysis-${Date.now()}.json`;
  const reportPath = path.join(reportsDir, reportFilename);

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

/**
 * Generate suggested bug pattern entry
 */
function generateBugPatternEntry(report: AnalysisReport): string {
  const { config } = report;

  return `
// Add this to src/utils/bug-patterns.ts

{
  id: '${config.bugId || 'new-pattern-' + Date.now()}',
  name: '${config.symptom || 'New Bug Pattern'}',
  category: '${config.category || 'state-management'}',
  severity: '${config.severity || 'medium'}',
  description: 'TODO: Add description',
  symptoms: [
    '${config.symptom || 'TODO: Add symptoms'}',
  ],
  rootCause: 'TODO: Add root cause explanation',
  detection: {
    codePatterns: [
      ${config.patterns.map(p => `'${p}'`).join(',\n      ')}
    ],
    logPatterns: [],
  },
  fix: {
    summary: 'TODO: Add fix summary',
    steps: [
      '1. TODO',
    ],
  },
  prevention: [
    'TODO: Add prevention guidelines',
  ],
  relatedFiles: [
    ${report.matches.slice(0, 5).map(m => `'${m.file}'`).join(',\n    ')}
  ],
  dateDiscovered: '${new Date().toISOString().split('T')[0]}',
}
`;
}

/**
 * Interactive mode for gathering bug details
 */
async function interactiveMode(): Promise<AnalysisConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve);
    });
  };

  console.log(`\n${colors.bright}${colors.cyan}Post-Fix Analysis - Interactive Mode${colors.reset}\n`);

  const symptom = await question('What symptom did you observe? (e.g., "no sound after HMR")\n> ');
  const fixedFile = await question('What file did you fix? (e.g., src/audio/engine.ts)\n> ');
  const codePattern = await question('What code pattern caused the bug? (regex, e.g., "getInstance\\\\(\\\\)")\n> ');
  const riskyContext = await question('What context makes this pattern risky? (regex, e.g., "Tone\\\\.")\n> ');
  const excludePattern = await question('Any patterns to exclude from results? (regex, leave empty to skip)\n> ');

  rl.close();

  return {
    patterns: codePattern ? [codePattern] : [],
    riskyContexts: riskyContext ? [riskyContext] : [],
    excludePatterns: excludePattern ? [excludePattern] : [],
    symptom: symptom || undefined,
    fixedFile: fixedFile || undefined,
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(): AnalysisConfig {
  const args = process.argv.slice(2);
  const config: AnalysisConfig = {
    patterns: [],
    riskyContexts: [],
    excludePatterns: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--pattern':
      case '-p':
        if (nextArg) config.patterns.push(nextArg);
        i++;
        break;
      case '--code-pattern':
      case '-c':
        if (nextArg) config.patterns.push(nextArg);
        i++;
        break;
      case '--risky-context':
      case '-r':
        if (nextArg) config.riskyContexts.push(nextArg);
        i++;
        break;
      case '--exclude':
      case '-e':
        if (nextArg) config.excludePatterns.push(nextArg);
        i++;
        break;
      case '--symptom':
      case '-s':
        config.symptom = nextArg;
        i++;
        break;
      case '--file':
      case '-f':
        config.fixedFile = nextArg;
        i++;
        break;
      case '--bug-id':
        config.bugId = nextArg;
        i++;
        break;
      case '--category':
        config.category = nextArg;
        i++;
        break;
      case '--severity':
        config.severity = nextArg as AnalysisConfig['severity'];
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
${colors.bright}Post-Fix Analysis Tool${colors.reset}

Run this after confirming a bug fix to find similar issues across the codebase.

${colors.bright}Usage:${colors.reset}
  npx tsx scripts/post-fix-analysis.ts [options]

${colors.bright}Options:${colors.reset}
  -p, --pattern <regex>        Pattern that caused the bug
  -c, --code-pattern <regex>   Same as --pattern
  -r, --risky-context <regex>  Context that makes the pattern risky
  -e, --exclude <regex>        Pattern to exclude from results
  -s, --symptom <text>         Symptom that was observed
  -f, --file <path>            File that was fixed (excluded from results)
  --bug-id <id>                ID for the new bug pattern
  --category <cat>             Bug category
  --severity <level>           Bug severity (critical|high|medium|low)
  --interactive                Run in interactive mode
  -h, --help                   Show this help

${colors.bright}Examples:${colors.reset}
  # Find singleton patterns in audio code
  npx tsx scripts/post-fix-analysis.ts \\
    --pattern "getInstance\\(\\)" \\
    --risky-context "Tone\\." \\
    --file src/audio/engine.ts

  # Find setTimeout without cleanup
  npx tsx scripts/post-fix-analysis.ts \\
    --pattern "setTimeout" \\
    --exclude "pendingTimers" \\
    --symptom "logs continue after stop"

  # Interactive mode
  npx tsx scripts/post-fix-analysis.ts --interactive
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let config: AnalysisConfig;

  if (args.includes('--interactive') || args.includes('-i')) {
    config = await interactiveMode();
  } else {
    config = parseArgs();
  }

  // Validate we have something to search for
  if (config.patterns.length === 0) {
    console.log(`${colors.red}Error: No patterns specified. Use --pattern or --interactive.${colors.reset}`);
    console.log('Run with --help for usage information.');
    process.exit(1);
  }

  console.log(`\n${colors.cyan}Running post-fix analysis...${colors.reset}\n`);
  console.log(`Patterns: ${config.patterns.join(', ')}`);
  if (config.riskyContexts.length > 0) {
    console.log(`Risky contexts: ${config.riskyContexts.join(', ')}`);
  }
  if (config.fixedFile) {
    console.log(`Excluding fixed file: ${config.fixedFile}`);
  }

  const report = runAnalysis(config);

  console.log(formatReport(report));

  // Save report
  const reportPath = saveReport(report);
  console.log(`${colors.gray}Report saved to: ${reportPath}${colors.reset}\n`);

  // If matches found, suggest bug pattern entry
  if (report.summary.totalMatches > 0) {
    console.log(`${colors.bright}Suggested Bug Pattern Entry:${colors.reset}`);
    console.log(colors.gray + generateBugPatternEntry(report) + colors.reset);
  }

  // Exit with appropriate code
  if (report.summary.highRisk > 0) {
    console.log(`\n${colors.red}${colors.bright}ACTION REQUIRED: ${report.summary.highRisk} high-risk matches need review${colors.reset}\n`);
    process.exit(1);
  }
}

main().catch(console.error);
