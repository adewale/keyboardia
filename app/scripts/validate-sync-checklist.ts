#!/usr/bin/env npx tsx
/**
 * Sync Checklist Validator
 *
 * Validates that all multiplayer sync checklist items are complete for each
 * message type. This helps prevent bugs where a new synced feature is added
 * but one of the required steps is missed.
 *
 * For each message type in MUTATING_MESSAGE_TYPES, checks:
 * 1. ClientMessageBase has the type in worker/types.ts
 * 2. ServerMessageBase has the corresponding broadcast type
 * 3. live-session.ts has a case in the switch statement
 * 4. live-session.ts has a handler method
 * 5. multiplayer.ts has a case in the switch statement
 * 6. multiplayer.ts has a handler method
 * 7. actionToMessage has a case (if applicable)
 *
 * Usage:
 *   npx tsx scripts/validate-sync-checklist.ts
 *
 * Add to package.json:
 *   "validate:sync": "npx tsx scripts/validate-sync-checklist.ts"
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

/**
 * All mutating message types that require sync implementation.
 * Keep in sync with MUTATING_MESSAGE_TYPES in worker/types.ts
 */
const MUTATING_TYPES = [
  'toggle_step',
  'set_tempo',
  'set_swing',
  'mute_track',
  'solo_track',
  'set_parameter_lock',
  'add_track',
  'delete_track',
  'clear_track',
  'set_track_sample',
  'set_track_volume',
  'set_track_transpose',
  'set_track_step_count',
  'set_effects',
  'set_fm_params',
] as const;

/**
 * Mapping from client message type to server broadcast type.
 * Some types have special naming conventions.
 */
const CLIENT_TO_SERVER_MAP: Record<string, string> = {
  toggle_step: 'step_toggled',
  set_tempo: 'tempo_changed',
  set_swing: 'swing_changed',
  mute_track: 'track_muted',
  solo_track: 'track_soloed',
  set_parameter_lock: 'parameter_lock_set',
  add_track: 'track_added',
  delete_track: 'track_deleted',
  clear_track: 'track_cleared',
  set_track_sample: 'track_sample_set',
  set_track_volume: 'track_volume_set',
  set_track_transpose: 'track_transpose_set',
  set_track_step_count: 'track_step_count_set',
  set_effects: 'effects_changed',
  set_fm_params: 'fm_params_changed',
};

/**
 * Message types that don't need actionToMessage handling.
 * These are sent via special functions or handled differently.
 */
const SKIP_ACTION_TO_MESSAGE = new Set([
  'toggle_step', // Uses TOGGLE_STEP action which needs special handling
  'mute_track', // Mute is local-only (not synced)
  'solo_track', // Solo is local-only (not synced)
  'add_track', // Uses sendAddTrack() helper
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Known acronyms that should stay uppercase in PascalCase
 */
const ACRONYMS = new Set(['fm', 'kv', 'id', 'ws', 'do']);

/**
 * Convert snake_case to PascalCase
 * e.g., "set_track_volume" -> "SetTrackVolume"
 * Handles known acronyms: "set_fm_params" -> "SetFMParams"
 */
function toPascalCase(snakeCase: string): string {
  return snakeCase
    .split('_')
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
}

/**
 * Convert snake_case to SCREAMING_SNAKE_CASE
 * e.g., "set_track_volume" -> "SET_TRACK_VOLUME"
 */
function toScreamingSnake(snakeCase: string): string {
  return snakeCase.toUpperCase();
}

// ============================================================================
// Validation Logic
// ============================================================================

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateChecklist(
  workerTypes: string,
  liveSession: string,
  multiplayer: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const msgType of MUTATING_TYPES) {
    const serverType = CLIENT_TO_SERVER_MAP[msgType];

    // Check 1: ClientMessageBase has the type
    if (!workerTypes.includes(`type: '${msgType}'`)) {
      errors.push(`[worker/types.ts] Missing ClientMessageBase: type: '${msgType}'`);
    }

    // Check 2: ServerMessageBase has the broadcast type
    if (serverType && !workerTypes.includes(`type: '${serverType}'`)) {
      errors.push(`[worker/types.ts] Missing ServerMessageBase: type: '${serverType}'`);
    }

    // Check 3: Server switch case
    if (!liveSession.includes(`case '${msgType}':`)) {
      errors.push(`[live-session.ts] Missing switch case: case '${msgType}':`);
    }

    // Check 4: Server handler method
    const serverHandler = `handle${toPascalCase(msgType)}`;
    // Check for method definition (handles both regular and arrow function styles)
    const hasServerHandler =
      liveSession.includes(`${serverHandler}(`) ||
      liveSession.includes(`${serverHandler} =`);
    if (!hasServerHandler) {
      errors.push(`[live-session.ts] Missing handler method: ${serverHandler}`);
    }

    // Check 5: Client switch case (for server broadcast type)
    if (serverType && !multiplayer.includes(`case '${serverType}':`)) {
      errors.push(`[multiplayer.ts] Missing switch case: case '${serverType}':`);
    }

    // Check 6: Client handler method
    if (serverType) {
      const clientHandler = `handle${toPascalCase(serverType)}`;
      const hasClientHandler =
        multiplayer.includes(`${clientHandler}(`) ||
        multiplayer.includes(`${clientHandler} =`);
      if (!hasClientHandler) {
        errors.push(`[multiplayer.ts] Missing handler method: ${clientHandler}`);
      }
    }

    // Check 7: actionToMessage case (if applicable)
    if (!SKIP_ACTION_TO_MESSAGE.has(msgType)) {
      const actionType = toScreamingSnake(msgType);
      // Look for the action type in actionToMessage function
      if (!multiplayer.includes(`case '${actionType}':`)) {
        warnings.push(
          `[multiplayer.ts] actionToMessage may be missing case '${actionType}':` +
            ` (check if this action type needs sync)`
        );
      }
    }
  }

  // Bonus: Check that MUTATING_MESSAGE_TYPES in types.ts matches our list
  for (const msgType of MUTATING_TYPES) {
    if (!workerTypes.includes(`'${msgType}'`)) {
      warnings.push(
        `[worker/types.ts] '${msgType}' may be missing from MUTATING_MESSAGE_TYPES set`
      );
    }
  }

  return { errors, warnings };
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const srcDir = path.join(__dirname, '..', 'src');

  // Read source files
  let workerTypes: string;
  let liveSession: string;
  let multiplayer: string;

  try {
    workerTypes = fs.readFileSync(path.join(srcDir, 'worker', 'types.ts'), 'utf-8');
    liveSession = fs.readFileSync(path.join(srcDir, 'worker', 'live-session.ts'), 'utf-8');
    multiplayer = fs.readFileSync(path.join(srcDir, 'sync', 'multiplayer.ts'), 'utf-8');
  } catch (err) {
    console.error('Error reading source files:', err);
    process.exit(1);
  }

  // Run validation
  const { errors, warnings } = validateChecklist(workerTypes, liveSession, multiplayer);

  // Output results
  console.log('\n=== Sync Checklist Validation ===\n');

  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.error(`Errors (${errors.length}):`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.log('');
    console.error('Sync checklist validation FAILED');
    process.exit(1);
  }

  console.log('Sync checklist validation PASSED');
  console.log(`  - ${MUTATING_TYPES.length} message types validated`);
  console.log(`  - ${warnings.length} warnings`);
  console.log(`  - 0 errors`);
}

// Run the validation
main();
