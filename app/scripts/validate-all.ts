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
 * 3. Sample Quality - Decodes samples and emits objective quality metrics,
 *    including active-RMS velocity layer ordering
 * 4. Release Times - Validates release time consistency
 * 5. Sync Checklist - Ensures multiplayer sync implementation is complete
 * 6. Sample Load Budgets - Bounds transfer size before runtime network/decode verification
 *
 * Usage:
 *   npx tsx scripts/validate-all.ts
 *   npm run validate:all
 */

import { execSync } from 'child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export interface ValidatorCommand {
  entrypoint: string;
  args?: readonly string[];
  /** Runtime inputs read through the filesystem rather than imported as modules. */
  inputs?: readonly string[];
}

export type ValidatorProfile = 'samples' | 'worker';

export interface ValidatorDefinition {
  name: string;
  profile: ValidatorProfile;
  commands: readonly ValidatorCommand[];
  description: string;
}

function diagnosticTail(value: string, maximumCharacters = 4_000): string {
  const trimmed = value.trim();
  if (trimmed.length <= maximumCharacters) return trimmed;
  return `[earlier output omitted]\n${trimmed.slice(-maximumCharacters)}`;
}

export const VALIDATORS = [
  {
    name: 'Manifest Validation',
    profile: 'samples',
    commands: [{
      entrypoint: 'scripts/validate-manifests.ts',
      inputs: ['public/instruments/', 'src/audio/sampled-instrument.ts'],
    }],
    description: 'Checks manifests, sample files, and registry completeness',
  },
  {
    name: 'Playable Range Validation',
    profile: 'samples',
    commands: [{
      entrypoint: 'scripts/validate-playable-ranges.ts',
      inputs: ['public/instruments/'],
    }],
    description: 'Ensures default note (C4) is within playable range',
  },
  {
    name: 'Sample Quality Audit',
    profile: 'samples',
    commands: [{
      entrypoint: 'scripts/validate-sample-quality.ts',
      args: ['--strict'],
      inputs: ['public/instruments/', 'scripts/sample-quality-baseline.json'],
    }],
    description: 'Decodes samples and blocks every unwaived pitch, onset, level, loop, phase, and clipping finding',
  },
  {
    name: 'Enrichment/Curation Receipt',
    profile: 'samples',
    commands: [{
      entrypoint: 'scripts/promote-complete-sample-enrichment.ts',
      args: ['--verify-only'],
      inputs: [
        'public/instruments/',
        'public/__sample-pipeline/',
        'sample-pipeline/enrichment/',
        'sample-pipeline/remediation-receipts/',
      ],
    }],
    description: 'Checks shipped and archived sample hashes, curated mappings, source revisions, and license profile',
  },
  {
    name: 'Sustain Ceiling Guard',
    profile: 'samples',
    commands: [{
      entrypoint: 'scripts/validate-sustain-ceiling.ts',
      inputs: ['public/instruments/'],
    }],
    description: 'Ensures sustaining instruments hold past the longest 16-step tied note',
  },
  {
    name: 'Velocity Filter Calibration',
    profile: 'samples',
    commands: [
      {
        entrypoint: 'scripts/validate-velocity-filter-calibration.ts',
        inputs: [
          'public/instruments/',
          'src/audio/velocity-filter-anchors.json',
          'src/audio/velocity-filter-anchors-48000.json',
        ],
      },
      {
        entrypoint: 'scripts/simulate-velocity-filter.ts',
        args: ['--sample-rate', '44100'],
        inputs: ['public/instruments/', 'src/audio/velocity-filter-anchors.json'],
      },
      {
        entrypoint: 'scripts/simulate-velocity-filter.ts',
        args: ['--sample-rate', '48000'],
        inputs: ['public/instruments/', 'src/audio/velocity-filter-anchors-48000.json'],
      },
    ],
    description: 'Binds calibration to every playable note and checks the 26-35% timbre target on production mappings',
  },
  {
    name: 'Release Time Validation',
    profile: 'samples',
    commands: [{
      entrypoint: 'scripts/validate-release-times.ts',
      inputs: ['public/instruments/'],
    }],
    description: 'Validates release time consistency across instruments',
  },
  {
    name: 'Sample Load Budget Validation',
    profile: 'samples',
    commands: [{
      entrypoint: 'scripts/validate-sample-load-budgets.ts',
      inputs: ['public/instruments/'],
    }],
    description: 'Checks priority and background payload sizes against the static transfer budget',
  },
  {
    name: 'Sync Checklist Validation',
    profile: 'worker',
    commands: [{
      entrypoint: 'scripts/validate-sync-checklist.ts',
      inputs: [
        'src/shared/message-types.ts',
        'src/shared/messages.ts',
        'src/sync/multiplayer.ts',
        'src/worker/live-session.ts',
        'src/worker/types.ts',
      ],
    }],
    description: 'Ensures multiplayer sync implementation is complete',
  },
] as const satisfies readonly ValidatorDefinition[];

export function validatorsForProfile(profile?: ValidatorProfile): readonly ValidatorDefinition[] {
  return profile ? VALIDATORS.filter(validator => validator.profile === profile) : VALIDATORS;
}

export function validatorEntrypoints(profile?: ValidatorProfile): string[] {
  return [...new Set(validatorsForProfile(profile).flatMap(validator =>
    validator.commands.map(command => command.entrypoint)))].sort();
}

export interface ValidatorDeclaredInput {
  entrypoint: string;
  input: string;
}

export function validatorDeclaredInputs(profile?: ValidatorProfile): ValidatorDeclaredInput[] {
  return validatorsForProfile(profile).flatMap(validator =>
    validator.commands.flatMap(command =>
      (command.inputs ?? []).map(input => ({ entrypoint: command.entrypoint, input }))));
}

function displayCommand(command: ValidatorCommand): string {
  return ['node', '--import', 'tsx', command.entrypoint, ...(command.args ?? [])].join(' ');
}

function validatorScript(validator: ValidatorDefinition): string {
  return validator.commands.map(displayCommand).join(' && ');
}

function runValidator(validator: ValidatorDefinition): ValidatorResult {
  const start = Date.now();
  const script = validatorScript(validator);
  try {
    const output = execSync(script, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      name: validator.name,
      script,
      passed: true,
      duration: Date.now() - start,
      output,
    };
  } catch (e: unknown) {
    const error = e as { stdout?: string; stderr?: string; message?: string };
    return {
      name: validator.name,
      script,
      passed: false,
      duration: Date.now() - start,
      output: error.stdout,
      error: error.stderr || error.message,
    };
  }
}

function main(): void {
  const profileIndex = process.argv.indexOf('--profile');
  const requestedProfile = profileIndex >= 0 ? process.argv[profileIndex + 1] : undefined;
  if (profileIndex >= 0 && requestedProfile === undefined) {
    throw new Error('--profile requires samples or worker');
  }
  if (requestedProfile !== undefined && requestedProfile !== 'samples' && requestedProfile !== 'worker') {
    throw new Error('--profile must be samples or worker');
  }
  const validators = validatorsForProfile(requestedProfile);
  console.log(`\n${colors.bold}🔍 UNIFIED SYSTEM INTEGRITY VALIDATOR${colors.reset}\n`);
  console.log(`${colors.dim}Running ${requestedProfile ?? 'all'} validators to ensure system integrity${colors.reset}\n`);
  console.log('═'.repeat(70) + '\n');

  const results: ValidatorResult[] = [];

  for (const validator of validators) {
    console.log(`${colors.cyan}▶${colors.reset} ${validator.name}`);
    console.log(`  ${colors.dim}${validator.description}${colors.reset}`);

    const result = runValidator(validator);
    results.push(result);

    if (result.passed) {
      console.log(`  ${colors.green}✓ Passed${colors.reset} ${colors.dim}(${result.duration}ms)${colors.reset}\n`);
    } else {
      console.log(`  ${colors.red}✗ Failed${colors.reset} ${colors.dim}(${result.duration}ms)${colors.reset}`);
      if (result.output?.trim()) {
        console.log(`  ${colors.red}Output:\n${diagnosticTail(result.output)}${colors.reset}`);
      }
      if (result.error) {
        console.log(`  ${colors.red}Error:\n${diagnosticTail(result.error)}${colors.reset}\n`);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
