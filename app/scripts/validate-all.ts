#!/usr/bin/env npx tsx
/**
 * Unified System Integrity Validator
 *
 * Runs all validation scripts to ensure the entire system is properly configured.
 * This is the single command to verify everything works before deployment.
 *
 * Validators included:
 * 1. Manifests - Sample files, SAMPLED_INSTRUMENTS, INSTRUMENT_CATEGORIES (UI)
 * 2. Playable Ranges - Ensures default note (C4) is playable
 * 3. Release Times - Validates release time consistency
 * 4. Sync Checklist - Ensures multiplayer sync implementation is complete
 *
 * Usage:
 *   npx tsx scripts/validate-all.ts
 *   npm run validate:all
 */

import { execSync } from 'child_process';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

interface ValidatorResult {
  name: string;
  script: string;
  passed: boolean;
  duration: number;
  output?: string;
  error?: string;
}

const VALIDATORS = [
  {
    name: 'Manifest Validation',
    script: 'npx tsx scripts/validate-manifests.ts',
    description: 'Checks manifests, sample files, and registry completeness',
  },
  {
    name: 'Playable Range Validation',
    script: 'npx tsx scripts/validate-playable-ranges.ts',
    description: 'Ensures default note (C4) is within playable range',
  },
  {
    name: 'Velocity Layer Validation',
    script: 'npx tsx scripts/validate-velocity-layers.ts',
    description: 'Ensures velocity layers are ordered by actual volume levels',
  },
  {
    name: 'Release Time Validation',
    script: 'npx tsx scripts/validate-release-times.ts',
    description: 'Validates release time consistency across instruments',
  },
  {
    name: 'Sync Checklist Validation',
    script: 'npx tsx scripts/validate-sync-checklist.ts',
    description: 'Ensures multiplayer sync implementation is complete',
  },
];

function runValidator(validator: { name: string; script: string }): ValidatorResult {
  const start = Date.now();
  try {
    const output = execSync(validator.script, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      name: validator.name,
      script: validator.script,
      passed: true,
      duration: Date.now() - start,
      output,
    };
  } catch (e: unknown) {
    const error = e as { stdout?: string; stderr?: string; message?: string };
    return {
      name: validator.name,
      script: validator.script,
      passed: false,
      duration: Date.now() - start,
      output: error.stdout,
      error: error.stderr || error.message,
    };
  }
}

function main(): void {
  console.log(`\n${colors.bold}🔍 UNIFIED SYSTEM INTEGRITY VALIDATOR${colors.reset}\n`);
  console.log(`${colors.dim}Running all validators to ensure system integrity${colors.reset}\n`);
  console.log('═'.repeat(70) + '\n');

  const results: ValidatorResult[] = [];

  for (const validator of VALIDATORS) {
    console.log(`${colors.cyan}▶${colors.reset} ${validator.name}`);
    console.log(`  ${colors.dim}${validator.description}${colors.reset}`);

    const result = runValidator(validator);
    results.push(result);

    if (result.passed) {
      console.log(`  ${colors.green}✓ Passed${colors.reset} ${colors.dim}(${result.duration}ms)${colors.reset}\n`);
    } else {
      console.log(`  ${colors.red}✗ Failed${colors.reset} ${colors.dim}(${result.duration}ms)${colors.reset}`);
      if (result.error) {
        console.log(`  ${colors.red}Error: ${result.error.slice(0, 200)}${colors.reset}\n`);
      }
    }
  }

  // Summary
  console.log('═'.repeat(70));
  console.log(`\n${colors.bold}SUMMARY${colors.reset}\n`);

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`  Total validators: ${results.length}`);
  console.log(`  ${colors.green}Passed:${colors.reset} ${passed.length}`);
  console.log(`  ${colors.red}Failed:${colors.reset} ${failed.length}`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  if (failed.length > 0) {
    console.log(`\n${colors.red}${colors.bold}FAILED VALIDATORS:${colors.reset}\n`);
    for (const result of failed) {
      console.log(`  ${colors.red}✗${colors.reset} ${result.name}`);
      console.log(`    ${colors.dim}Run: ${result.script}${colors.reset}`);
    }
    console.log(`\n${colors.red}${colors.bold}⚠️  System integrity check FAILED${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`\n${colors.green}${colors.bold}✓ All validators passed - system integrity verified${colors.reset}\n`);
  process.exit(0);
}

main();
