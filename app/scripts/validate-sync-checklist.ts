#!/usr/bin/env npx tsx
/**
 * Sync Checklist Validator
 *
 * Validates the runtime wiring for every message in the production
 * MESSAGE_TO_STATE_BROADCAST map. Message classification itself is enforced
 * exhaustively by TypeScript in shared/messages.ts; this script checks that
 * each classified mutation reaches the Worker, the browser, and (where the
 * action has enough context) actionToMessage.
 *
 * Usage:
 *   npm run validate:sync
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  MESSAGE_TO_STATE_BROADCAST,
  type MutatingMessageType,
} from '../src/shared/messages';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MUTATING_ENTRIES = Object.entries(MESSAGE_TO_STATE_BROADCAST) as Array<
  [MutatingMessageType, (typeof MESSAGE_TO_STATE_BROADCAST)[MutatingMessageType]]
>;

interface DedicatedSendRoute {
  actionType: string;
  sender: string;
  hook: string;
}

/** Mutations whose Grid action cannot be converted directly to a wire message. */
const DEDICATED_SEND_ROUTES = {
  add_track: {
    actionType: 'ADD_TRACK',
    sender: 'sendAddTrack',
    hook: 'handleTrackAdded',
  },
  batch_clear_steps: {
    actionType: 'DELETE_SELECTED_STEPS',
    sender: 'sendBatchClearSteps',
    hook: 'handleBatchClearSteps',
  },
  batch_set_parameter_locks: {
    actionType: 'APPLY_TO_SELECTION',
    sender: 'sendBatchSetParameterLocks',
    hook: 'handleBatchSetParameterLocks',
  },
  reorder_tracks: {
    actionType: 'REORDER_TRACKS',
    sender: 'sendReorderTracks',
    hook: 'handleTrackReorder',
  },
} as const satisfies Partial<Record<MutatingMessageType, DedicatedSendRoute>>;

const ACRONYMS = new Set(['fm', 'kv', 'id', 'ws', 'do']);

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

function toScreamingSnake(snakeCase: string): string {
  return snakeCase.toUpperCase();
}

function sourceSection(source: string, startMarker: string): string | null {
  const start = source.indexOf(startMarker);
  if (start === -1) return null;
  const nextExport = source.indexOf('\nexport ', start + startMarker.length);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

function callbackSection(owner: string, callbackName: string): string | null {
  const marker = `const ${callbackName} = useCallback`;
  const start = owner.indexOf(marker);
  if (start === -1) return null;
  const nextCallback = owner.indexOf('\n  const handle', start + marker.length);
  const returnBlock = owner.indexOf('\n\n  return {', start + marker.length);
  const ends = [nextCallback, returnBlock].filter((index) => index !== -1);
  return owner.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

function returnedApiSection(owner: string): string | null {
  const start = owner.indexOf('\n  return {');
  if (start === -1) return null;
  const end = owner.indexOf('\n  };', start);
  return owner.slice(start, end === -1 ? undefined : end);
}

export interface ValidationResult {
  errors: string[];
}

/**
 * Check source wiring while keeping the production map as the only message
 * inventory. Source inspection is intentional here: this gate catches a
 * missing dispatch branch or handler before an end-to-end scenario happens to
 * exercise that particular operation.
 */
export function validateChecklist(
  liveSession: string,
  multiplayer: string,
  useMultiplayer: string,
): ValidationResult {
  const errors: string[] = [];
  const syncHookOwner = sourceSection(useMultiplayer, 'export function useMultiplayerSync');
  const returnedSyncApi = syncHookOwner && returnedApiSection(syncHookOwner);

  for (const [msgType, serverType] of MUTATING_ENTRIES) {
    if (!liveSession.includes(`case '${msgType}':`)) {
      errors.push(`[live-session.ts] Missing switch case: case '${msgType}':`);
    }

    const serverHandler = `handle${toPascalCase(msgType)}`;
    const hasServerHandler =
      liveSession.includes(`${serverHandler}(`) ||
      liveSession.includes(`${serverHandler} =`);
    if (!hasServerHandler) {
      errors.push(`[live-session.ts] Missing handler method: ${serverHandler}`);
    }

    if (!multiplayer.includes(`case '${serverType}':`)) {
      errors.push(`[multiplayer.ts] Missing switch case: case '${serverType}':`);
    }

    const clientHandler = `handle${toPascalCase(serverType)}`;
    const hasClientHandler =
      multiplayer.includes(`${clientHandler}(`) ||
      multiplayer.includes(`${clientHandler} =`);
    if (!hasClientHandler) {
      errors.push(`[multiplayer.ts] Missing handler method: ${clientHandler}`);
    }

    const dedicatedRoute = DEDICATED_SEND_ROUTES[
      msgType as keyof typeof DEDICATED_SEND_ROUTES
    ] as DedicatedSendRoute | undefined;
    if (dedicatedRoute) {
      if (!multiplayer.includes(`case '${dedicatedRoute.actionType}':`)) {
        errors.push(
          `[multiplayer.ts] Missing dedicated action case: case '${dedicatedRoute.actionType}':`,
        );
      }

      const functionStart = multiplayer.indexOf(`export function ${dedicatedRoute.sender}`);
      if (functionStart === -1) {
        errors.push(`[multiplayer.ts] Missing dedicated sender: ${dedicatedRoute.sender}`);
      } else {
        const nextFunction = multiplayer.indexOf('\nexport function ', functionStart + 1);
        const functionSource = multiplayer.slice(
          functionStart,
          nextFunction === -1 ? undefined : nextFunction,
        );
        if (!functionSource.includes(`type: '${msgType}'`)) {
          errors.push(
            `[multiplayer.ts] ${dedicatedRoute.sender} does not send type: '${msgType}'`,
          );
        }
      }

      const hookSource = syncHookOwner && callbackSection(syncHookOwner, dedicatedRoute.hook);
      if (!hookSource) {
        errors.push(`[useMultiplayer.ts] Missing dedicated hook: ${dedicatedRoute.hook}`);
      } else if (!hookSource.includes(`${dedicatedRoute.sender}(`)) {
        errors.push(
          `[useMultiplayer.ts] ${dedicatedRoute.hook} does not call ${dedicatedRoute.sender}`,
        );
      }
      if (!returnedSyncApi || !new RegExp(`\\b${dedicatedRoute.hook}\\b`).test(returnedSyncApi)) {
        errors.push(`[useMultiplayer.ts] Dedicated hook is not returned: ${dedicatedRoute.hook}`);
      }
    } else {
      const actionType = toScreamingSnake(msgType);
      if (!multiplayer.includes(`case '${actionType}':`)) {
        errors.push(`[multiplayer.ts] Missing actionToMessage case: case '${actionType}':`);
      }
    }
  }

  return { errors };
}

function main(): void {
  const srcDir = path.join(__dirname, '..', 'src');

  let liveSession: string;
  let multiplayer: string;
  let useMultiplayer: string;
  try {
    liveSession = fs.readFileSync(path.join(srcDir, 'worker', 'live-session.ts'), 'utf-8');
    multiplayer = fs.readFileSync(path.join(srcDir, 'sync', 'multiplayer.ts'), 'utf-8');
    useMultiplayer = fs.readFileSync(path.join(srcDir, 'hooks', 'useMultiplayer.ts'), 'utf-8');
  } catch (err) {
    console.error('Error reading source files:', err);
    process.exit(1);
  }

  const { errors } = validateChecklist(liveSession, multiplayer, useMultiplayer);

  console.log('\n=== Sync Checklist Validation ===\n');
  if (errors.length > 0) {
    console.error(`Errors (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    console.error('\nSync checklist validation FAILED');
    process.exit(1);
  }

  console.log('Sync checklist validation PASSED');
  console.log(`  - ${MUTATING_ENTRIES.length} message types validated`);
  console.log('  - 0 errors');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
