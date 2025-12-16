#!/usr/bin/env npx tsx
/**
 * Bug Capture Tool
 *
 * Quickly capture bug information and add it to the bug registry and lessons learned.
 * Use this immediately after fixing a bug while the context is fresh.
 *
 * Usage:
 *   npx tsx scripts/bug-capture.ts --interactive
 *   npx tsx scripts/bug-capture.ts --from-file debug-reports/post-fix-analysis-xxx.json
 *
 * This tool:
 * 1. Collects bug information (symptoms, root cause, fix, prevention)
 * 2. Generates entries for bug-patterns.ts
 * 3. Appends to DEBUGGING-LESSONS-LEARNED.md
 * 4. Runs post-fix analysis automatically
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { execSync } from 'child_process';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

interface BugCapture {
  id: string;
  title: string;
  date: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  symptoms: string[];
  rootCause: string;
  codePattern?: string;
  logPattern?: string;
  fix: {
    summary: string;
    steps: string[];
    codeExample?: string;
  };
  prevention: string[];
  relatedFiles: string[];
  postFixCommand?: string;
}

const CATEGORIES = [
  'audio-context',
  'singleton',
  'state-management',
  'timing',
  'memory-leak',
  'race-condition',
  'routing',
  'multiplayer',
  'ui',
];

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/**
 * Read user input
 */
function createPrompt(): (question: string, defaultValue?: string) => Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return (question: string, defaultValue?: string): Promise<string> => {
    const prompt = defaultValue
      ? `${question} ${c.dim}[${defaultValue}]${c.reset}: `
      : `${question}: `;

    return new Promise(resolve => {
      rl.question(prompt, answer => {
        resolve(answer || defaultValue || '');
      });
    });
  };
}

/**
 * Get next bug ID from lessons learned file
 */
function getNextBugId(): string {
  const lessonsPath = path.join(process.cwd(), 'docs', 'DEBUGGING-LESSONS-LEARNED.md');

  try {
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    const matches = content.match(/## #(\d+):/g);
    if (matches) {
      const ids = matches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
      const maxId = Math.max(...ids);
      return String(maxId + 1).padStart(3, '0');
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return '001';
}

/**
 * Generate bug pattern TypeScript code
 */
function generateBugPatternCode(bug: BugCapture): string {
  return `
  // ============================================================================
  // ${bug.title.toUpperCase()}
  // ============================================================================
  {
    id: '${bug.id}',
    name: '${bug.title}',
    category: '${bug.category}',
    severity: '${bug.severity}',
    description: '${bug.rootCause.replace(/'/g, "\\'")}',
    symptoms: [
      ${bug.symptoms.map(s => `'${s.replace(/'/g, "\\'")}'`).join(',\n      ')}
    ],
    rootCause: '${bug.rootCause.replace(/'/g, "\\'")}',
    detection: {
      ${bug.codePattern ? `codePatterns: ['${bug.codePattern}'],` : ''}
      ${bug.logPattern ? `logPatterns: ['${bug.logPattern}'],` : ''}
    },
    fix: {
      summary: '${bug.fix.summary.replace(/'/g, "\\'")}',
      steps: [
        ${bug.fix.steps.map(s => `'${s.replace(/'/g, "\\'")}'`).join(',\n        ')}
      ],
    },
    prevention: [
      ${bug.prevention.map(p => `'${p.replace(/'/g, "\\'")}'`).join(',\n      ')}
    ],
    relatedFiles: [
      ${bug.relatedFiles.map(f => `'${f}'`).join(',\n      ')}
    ],
    dateDiscovered: '${bug.date}',
  },`;
}

/**
 * Generate markdown entry for lessons learned
 */
function generateLessonsLearnedEntry(bug: BugCapture): string {
  return `

---

## #${bug.id}: ${bug.title}

**Date**: ${bug.date}
**Severity**: ${bug.severity}
**Category**: ${bug.category}

### Symptoms
${bug.symptoms.map(s => `- ${s}`).join('\n')}

### Root Cause
${bug.rootCause}

### Detection Strategy

${bug.logPattern ? `**Log patterns:**\n\`\`\`\n${bug.logPattern}\n\`\`\`\n` : ''}
${bug.codePattern ? `**Code patterns:**\n\`\`\`typescript\n${bug.codePattern}\n\`\`\`\n` : ''}

### Fix

${bug.fix.summary}

${bug.fix.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${bug.fix.codeExample ? `\`\`\`typescript\n${bug.fix.codeExample}\n\`\`\`` : ''}

### Prevention
${bug.prevention.map(p => `- ${p}`).join('\n')}

### Related Files
${bug.relatedFiles.map(f => `- \`${f}\``).join('\n')}

### Post-Fix Analysis
\`\`\`bash
${bug.postFixCommand || `npx tsx scripts/post-fix-analysis.ts --pattern "${bug.codePattern || 'TODO'}"`}
\`\`\`
`;
}

/**
 * Interactive bug capture
 */
async function captureBugInteractive(): Promise<BugCapture> {
  const ask = createPrompt();

  console.log(`\n${c.bright}${c.cyan}Bug Capture Tool${c.reset}`);
  console.log(`${c.dim}Capture bug details while they're fresh in your mind${c.reset}\n`);

  const nextId = getNextBugId();

  // Basic info
  const title = await ask('Bug title (short, descriptive)');
  const id = await ask('Bug ID', nextId);
  const date = await ask('Date discovered', new Date().toISOString().split('T')[0]);

  // Severity
  console.log(`\nSeverity options: ${SEVERITIES.join(', ')}`);
  const severity = (await ask('Severity', 'medium')) as BugCapture['severity'];

  // Category
  console.log(`\nCategory options: ${CATEGORIES.join(', ')}`);
  const category = await ask('Category');

  // Symptoms
  console.log(`\n${c.yellow}Enter symptoms (one per line, empty line to finish):${c.reset}`);
  const symptoms: string[] = [];
  while (true) {
    const symptom = await ask('Symptom');
    if (!symptom) break;
    symptoms.push(symptom);
  }

  // Root cause
  console.log(`\n${c.yellow}Describe the root cause:${c.reset}`);
  const rootCause = await ask('Root cause');

  // Detection patterns
  console.log(`\n${c.yellow}Detection patterns (leave empty to skip):${c.reset}`);
  const codePattern = await ask('Code pattern (regex)');
  const logPattern = await ask('Log pattern');

  // Fix
  console.log(`\n${c.yellow}Describe the fix:${c.reset}`);
  const fixSummary = await ask('Fix summary');

  console.log(`\n${c.yellow}Enter fix steps (one per line, empty line to finish):${c.reset}`);
  const fixSteps: string[] = [];
  while (true) {
    const step = await ask('Step');
    if (!step) break;
    fixSteps.push(step);
  }

  const codeExample = await ask('Code example (single line, or leave empty)');

  // Prevention
  console.log(`\n${c.yellow}Enter prevention guidelines (one per line, empty line to finish):${c.reset}`);
  const prevention: string[] = [];
  while (true) {
    const prev = await ask('Prevention');
    if (!prev) break;
    prevention.push(prev);
  }

  // Related files
  console.log(`\n${c.yellow}Enter related files (one per line, empty line to finish):${c.reset}`);
  const relatedFiles: string[] = [];
  while (true) {
    const file = await ask('File path');
    if (!file) break;
    relatedFiles.push(file);
  }

  // Post-fix command
  const postFixCommand = codePattern
    ? `npx tsx scripts/post-fix-analysis.ts --pattern "${codePattern}"`
    : undefined;

  process.stdin.destroy();

  return {
    id,
    title,
    date,
    severity,
    category,
    symptoms,
    rootCause,
    codePattern: codePattern || undefined,
    logPattern: logPattern || undefined,
    fix: {
      summary: fixSummary,
      steps: fixSteps,
      codeExample: codeExample || undefined,
    },
    prevention,
    relatedFiles,
    postFixCommand,
  };
}

/**
 * Append to lessons learned file
 */
function appendToLessonsLearned(entry: string): void {
  const lessonsPath = path.join(process.cwd(), 'docs', 'DEBUGGING-LESSONS-LEARNED.md');

  if (!fs.existsSync(lessonsPath)) {
    console.log(`${c.yellow}Warning: ${lessonsPath} not found${c.reset}`);
    return;
  }

  const content = fs.readFileSync(lessonsPath, 'utf-8');
  const newContent = content + entry;
  fs.writeFileSync(lessonsPath, newContent);

  console.log(`${c.green}Updated ${lessonsPath}${c.reset}`);
}

/**
 * Run post-fix analysis
 */
function runPostFixAnalysis(bug: BugCapture): void {
  if (!bug.codePattern) {
    console.log(`${c.yellow}Skipping post-fix analysis (no code pattern)${c.reset}`);
    return;
  }

  console.log(`\n${c.cyan}Running post-fix analysis...${c.reset}`);

  try {
    const cmd = `npx tsx scripts/post-fix-analysis.ts --pattern "${bug.codePattern}"`;
    console.log(`${c.dim}$ ${cmd}${c.reset}\n`);
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    console.log(`${c.yellow}Post-fix analysis completed with warnings${c.reset}`);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c.bright}Bug Capture Tool${c.reset}

Quickly capture bug information after fixing it.

${c.bright}Usage:${c.reset}
  npx tsx scripts/bug-capture.ts --interactive
  npx tsx scripts/bug-capture.ts --from-file <report.json>

${c.bright}Options:${c.reset}
  --interactive, -i    Interactively capture bug details
  --from-file <path>   Import from post-fix analysis report
  --no-analyze         Skip post-fix analysis
  --help, -h           Show this help

${c.bright}What this tool does:${c.reset}
  1. Collects bug information interactively
  2. Generates TypeScript code for bug-patterns.ts
  3. Generates markdown for DEBUGGING-LESSONS-LEARNED.md
  4. Runs post-fix analysis to find similar issues
`);
    process.exit(0);
  }

  let bug: BugCapture;

  if (args.includes('--interactive') || args.includes('-i') || args.length === 0) {
    bug = await captureBugInteractive();
  } else if (args.includes('--from-file')) {
    const fileIndex = args.indexOf('--from-file') + 1;
    const filePath = args[fileIndex];
    if (!filePath) {
      console.error('Error: --from-file requires a path');
      process.exit(1);
    }
    // TODO: Implement import from post-fix analysis report
    console.log('Import from file not yet implemented');
    process.exit(1);
  } else {
    console.error('Unknown arguments. Use --help for usage.');
    process.exit(1);
  }

  // Output results
  console.log(`\n${c.bright}${c.green}Bug captured successfully!${c.reset}\n`);

  // Generate and display bug pattern code
  console.log(`${c.bright}Add this to src/utils/bug-patterns.ts:${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(generateBugPatternCode(bug));
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}\n`);

  // Generate lessons learned entry
  const lessonsEntry = generateLessonsLearnedEntry(bug);

  // Ask to append to lessons learned
  const appendLessons = process.argv.includes('--no-append') ? false : true;
  if (appendLessons) {
    appendToLessonsLearned(lessonsEntry);
  } else {
    console.log(`${c.bright}Lessons learned entry:${c.reset}`);
    console.log(lessonsEntry);
  }

  // Run post-fix analysis
  if (!args.includes('--no-analyze')) {
    runPostFixAnalysis(bug);
  }
}

main().catch(console.error);
