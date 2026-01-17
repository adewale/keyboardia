#!/usr/bin/env npx tsx
/**
 * Session API CLI Tool
 * Validates session JSON before sending to the API
 *
 * Usage:
 *   npx tsx scripts/session-api.ts create <json-file>
 *   npx tsx scripts/session-api.ts update <session-id> <json-file>
 *   npx tsx scripts/session-api.ts get <session-id>
 *   npx tsx scripts/session-api.ts validate <json-file>
 *
 * Or pipe JSON directly:
 *   echo '{"tracks": [...]}' | npx tsx scripts/session-api.ts create -
 */

import * as fs from 'fs';
import * as path from 'path';

// Import the canonical list of valid sample IDs from the source of truth
import { VALID_SAMPLE_IDS } from '../src/components/sample-constants';

// ============================================================================
// Types (mirrored from src/types.ts and worker/types.ts)
// ============================================================================

interface ParameterLock {
  pitch?: number;
  volume?: number;
  tie?: boolean; // Phase 29B: Continue note from previous step
}

interface Track {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (ParameterLock | null)[];
  volume: number;
  muted: boolean;
  transpose?: number;
  stepCount?: number;
}

interface SessionState {
  tracks: Track[];
  tempo: number;
  swing: number;
  version?: number;
}

// ============================================================================
// Validation
// ============================================================================

interface ValidationError {
  path: string;
  message: string;
}

// VALID_SAMPLE_IDS is now imported from src/components/sample-constants.ts
// This ensures the CLI tool stays in sync with the app's instrument catalog

function validateParameterLock(lock: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (lock === null) return errors;

  if (typeof lock !== 'object') {
    errors.push({ path, message: `Expected object or null, got ${typeof lock}` });
    return errors;
  }

  const obj = lock as Record<string, unknown>;

  if (obj.pitch !== undefined) {
    if (typeof obj.pitch !== 'number') {
      errors.push({ path: `${path}.pitch`, message: `Expected number, got ${typeof obj.pitch}` });
    } else if (obj.pitch < -24 || obj.pitch > 24) {
      errors.push({ path: `${path}.pitch`, message: `Pitch must be between -24 and 24, got ${obj.pitch}` });
    }
  }

  if (obj.volume !== undefined) {
    if (typeof obj.volume !== 'number') {
      errors.push({ path: `${path}.volume`, message: `Expected number, got ${typeof obj.volume}` });
    } else if (obj.volume < 0 || obj.volume > 2) {
      errors.push({ path: `${path}.volume`, message: `Volume must be between 0 and 2, got ${obj.volume}` });
    }
  }

  // Phase 29B: Tie validation
  if (obj.tie !== undefined) {
    if (typeof obj.tie !== 'boolean') {
      errors.push({ path: `${path}.tie`, message: `Expected boolean, got ${typeof obj.tie}` });
    }
  }

  return errors;
}

function validateTrack(track: unknown, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const path = `tracks[${index}]`;

  if (typeof track !== 'object' || track === null) {
    errors.push({ path, message: `Expected object, got ${typeof track}` });
    return errors;
  }

  const t = track as Record<string, unknown>;

  // Required fields
  if (typeof t.id !== 'string' || t.id.length === 0) {
    errors.push({ path: `${path}.id`, message: 'id is required and must be a non-empty string' });
  }

  if (typeof t.name !== 'string' || t.name.length === 0) {
    errors.push({ path: `${path}.name`, message: 'name is required and must be a non-empty string' });
  }

  if (typeof t.sampleId !== 'string' || t.sampleId.length === 0) {
    errors.push({ path: `${path}.sampleId`, message: 'sampleId is required and must be a non-empty string' });
  } else if (!VALID_SAMPLE_IDS.has(t.sampleId) &&
             !t.sampleId.toString().startsWith('recording-') &&
             !t.sampleId.toString().startsWith('slice-')) {
    errors.push({
      path: `${path}.sampleId`,
      message: `Unknown sampleId: "${t.sampleId}". Valid options: ${Array.from(VALID_SAMPLE_IDS).join(', ')}`
    });
  }

  // Steps array
  if (!Array.isArray(t.steps)) {
    errors.push({ path: `${path}.steps`, message: 'steps must be an array of booleans' });
  } else {
    if (t.steps.length === 0) {
      errors.push({ path: `${path}.steps`, message: 'steps array cannot be empty' });
    } else if (t.steps.length > 128) {
      errors.push({ path: `${path}.steps`, message: `steps array too long: ${t.steps.length} (max 128)` });
    }
    t.steps.forEach((step, i) => {
      if (typeof step !== 'boolean') {
        errors.push({ path: `${path}.steps[${i}]`, message: `Expected boolean, got ${typeof step}` });
      }
    });
  }

  // parameterLocks - CRITICAL: must be an array, not an object!
  if (t.parameterLocks !== undefined) {
    if (!Array.isArray(t.parameterLocks)) {
      errors.push({
        path: `${path}.parameterLocks`,
        message: `CRITICAL: parameterLocks must be an ARRAY, not an object! Got: ${typeof t.parameterLocks}. ` +
                 `Use [null, null, {"pitch": 5}, ...] instead of {"2": {"pitch": 5}}`
      });
    } else {
      (t.parameterLocks as unknown[]).forEach((lock, i) => {
        errors.push(...validateParameterLock(lock, `${path}.parameterLocks[${i}]`));
      });
    }
  }

  // Optional numeric fields
  if (t.volume !== undefined) {
    if (typeof t.volume !== 'number') {
      errors.push({ path: `${path}.volume`, message: `Expected number, got ${typeof t.volume}` });
    } else if (t.volume < 0 || t.volume > 2) {
      errors.push({ path: `${path}.volume`, message: `Volume must be between 0 and 2, got ${t.volume}` });
    }
  }

  if (t.transpose !== undefined) {
    if (typeof t.transpose !== 'number') {
      errors.push({ path: `${path}.transpose`, message: `Expected number, got ${typeof t.transpose}` });
    } else if (t.transpose < -24 || t.transpose > 24) {
      errors.push({ path: `${path}.transpose`, message: `Transpose must be between -24 and 24, got ${t.transpose}` });
    }
  }

  // Phase 29F: Updated to support all VALID_STEP_COUNTS including polyrhythmic values
  // Must match src/shared/sync-types.ts VALID_STEP_COUNTS
  const VALID_STEP_COUNTS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 21, 24, 27, 28, 32, 36, 48, 64, 96, 128];
  if (t.stepCount !== undefined) {
    if (typeof t.stepCount !== 'number') {
      errors.push({ path: `${path}.stepCount`, message: `Expected number, got ${typeof t.stepCount}` });
    } else if (!VALID_STEP_COUNTS.includes(t.stepCount)) {
      errors.push({ path: `${path}.stepCount`, message: `stepCount must be one of ${VALID_STEP_COUNTS.join(', ')}, got ${t.stepCount}` });
    }
  }

  if (t.muted !== undefined && typeof t.muted !== 'boolean') {
    errors.push({ path: `${path}.muted`, message: `Expected boolean, got ${typeof t.muted}` });
  }

  return errors;
}

function validateSessionState(state: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof state !== 'object' || state === null) {
    errors.push({ path: 'state', message: `Expected object, got ${typeof state}` });
    return errors;
  }

  const s = state as Record<string, unknown>;

  // Tracks
  if (!Array.isArray(s.tracks)) {
    errors.push({ path: 'tracks', message: 'tracks must be an array' });
  } else {
    if (s.tracks.length > 16) {
      errors.push({ path: 'tracks', message: `Too many tracks: ${s.tracks.length} (max 16)` });
    }
    s.tracks.forEach((track, i) => {
      errors.push(...validateTrack(track, i));
    });
  }

  // Tempo
  if (s.tempo !== undefined) {
    if (typeof s.tempo !== 'number') {
      errors.push({ path: 'tempo', message: `Expected number, got ${typeof s.tempo}` });
    } else if (s.tempo < 60 || s.tempo > 180) {
      errors.push({ path: 'tempo', message: `Tempo must be between 60 and 180, got ${s.tempo}` });
    }
  }

  // Swing
  if (s.swing !== undefined) {
    if (typeof s.swing !== 'number') {
      errors.push({ path: 'swing', message: `Expected number, got ${typeof s.swing}` });
    } else if (s.swing < 0 || s.swing > 100) {
      errors.push({ path: 'swing', message: `Swing must be between 0 and 100, got ${s.swing}` });
    }
  }

  return errors;
}

// ============================================================================
// API Functions
// ============================================================================

const API_BASE = process.env.API_BASE || 'https://keyboardia.dev/api/sessions';

async function createSession(state: SessionState, name?: string): Promise<{ id: string; url: string }> {
  // API accepts { state: {...}, name: "..." } or direct { tracks: [...] } format
  const body = name !== undefined ? { state, name } : state;

  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function updateSession(sessionId: string, state: SessionState): Promise<{ id: string; updatedAt: number }> {
  const response = await fetch(`${API_BASE}/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function getSession(sessionId: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/${sessionId}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function publishSession(sessionId: string): Promise<{ id: string; immutable: boolean }> {
  const response = await fetch(`${API_BASE}/${sessionId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Session API CLI Tool - Validates JSON before sending to API

Usage:
  npx tsx scripts/session-api.ts <command> [options]

Commands:
  create <json-file>              Create a new session from JSON file
  publish <session-id>            Publish a session (make immutable)
  create-publish <json-file>      Create and immediately publish a session
  update <session-id> <json-file> Update existing session
  get <session-id>                Get session data
  validate <json-file>            Validate JSON without sending

Options:
  -                               Read JSON from stdin instead of file

JSON Formats:
  Direct format:   { tracks: [...], tempo: 120, swing: 0, ... }
  Wrapper format:  { state: {...}, name: "Session Name" }

Examples:
  npx tsx scripts/session-api.ts validate session.json
  npx tsx scripts/session-api.ts create session.json
  npx tsx scripts/session-api.ts publish abc-123
  npx tsx scripts/session-api.ts create-publish session.json
  npx tsx scripts/session-api.ts update abc-123 session.json
  echo '{"tracks":[...]}' | npx tsx scripts/session-api.ts create -

  # Create with name:
  echo '{"state":{...}, "name":"My Session"}' | npx tsx scripts/session-api.ts create -

Environment:
  API_BASE                        Override API URL (default: https://keyboardia.dev/api/sessions)
`);
}

async function readInput(source: string): Promise<string> {
  if (source === '-') {
    // Read from stdin
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  } else {
    // Read from file
    const filePath = path.resolve(process.cwd(), source);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'validate': {
        if (args.length < 2) {
          console.error('Error: validate requires a JSON file or -');
          process.exit(1);
        }

        const json = await readInput(args[1]);
        const data = JSON.parse(json);

        // Handle both wrapper { state, name } and direct { tracks, tempo, ... } formats
        let state: SessionState;
        let name: string | undefined;

        if (data.state && typeof data.state === 'object') {
          state = data.state as SessionState;
          name = typeof data.name === 'string' ? data.name : undefined;
        } else {
          state = data as SessionState;
        }

        const errors = validateSessionState(state);

        if (errors.length > 0) {
          console.error('\n❌ Validation failed:\n');
          errors.forEach((err) => {
            console.error(`  ${err.path}: ${err.message}`);
          });
          process.exit(1);
        } else {
          console.log('✅ Validation passed!');
          console.log(`   ${state.tracks?.length || 0} tracks, tempo: ${state.tempo || 120}, swing: ${state.swing || 0}`);
          if (name) {
            console.log(`   Name: ${name}`);
          }
        }
        break;
      }

      case 'create': {
        if (args.length < 2) {
          console.error('Error: create requires a JSON file or -');
          process.exit(1);
        }

        const json = await readInput(args[1]);
        const data = JSON.parse(json);

        // Handle both wrapper { state, name } and direct { tracks, tempo, ... } formats
        let state: SessionState;
        let name: string | undefined;

        if (data.state && typeof data.state === 'object') {
          // Wrapper format: { state: {...}, name?: "..." }
          state = data.state as SessionState;
          name = typeof data.name === 'string' ? data.name : undefined;
        } else {
          // Direct format: { tracks: [...], tempo: ..., ... }
          state = data as SessionState;
        }

        // Validate the state (not the wrapper)
        const errors = validateSessionState(state);
        if (errors.length > 0) {
          console.error('\n❌ Validation failed:\n');
          errors.forEach((err) => {
            console.error(`  ${err.path}: ${err.message}`);
          });
          process.exit(1);
        }

        console.log('✅ Validation passed, creating session...');
        const result = await createSession(state, name);
        console.log(`\n✅ Session created!`);
        console.log(`   ID: ${result.id}`);
        if (name) {
          console.log(`   Name: ${name}`);
        }
        console.log(`   URL: https://keyboardia.dev${result.url}`);
        break;
      }

      case 'update': {
        if (args.length < 3) {
          console.error('Error: update requires <session-id> and <json-file>');
          process.exit(1);
        }

        const sessionId = args[1];
        const json = await readInput(args[2]);
        const data = JSON.parse(json);

        // Validate first
        const errors = validateSessionState(data);
        if (errors.length > 0) {
          console.error('\n❌ Validation failed:\n');
          errors.forEach((err) => {
            console.error(`  ${err.path}: ${err.message}`);
          });
          process.exit(1);
        }

        console.log('✅ Validation passed, updating session...');
        const result = await updateSession(sessionId, data);
        console.log(`\n✅ Session updated!`);
        console.log(`   ID: ${result.id}`);
        console.log(`   Updated at: ${new Date(result.updatedAt).toISOString()}`);
        break;
      }

      case 'get': {
        if (args.length < 2) {
          console.error('Error: get requires a session ID');
          process.exit(1);
        }

        const sessionId = args[1];
        const session = await getSession(sessionId);
        console.log(JSON.stringify(session, null, 2));
        break;
      }

      case 'publish': {
        if (args.length < 2) {
          console.error('Error: publish requires a session ID');
          process.exit(1);
        }

        const sessionId = args[1];
        console.log(`Publishing session ${sessionId}...`);
        const result = await publishSession(sessionId);
        console.log(`\n✅ Session published!`);
        console.log(`   ID: ${result.id}`);
        console.log(`   Immutable: ${result.immutable}`);
        console.log(`   URL: https://keyboardia.dev/s/${result.id}`);
        break;
      }

      case 'create-publish': {
        if (args.length < 2) {
          console.error('Error: create-publish requires a JSON file or -');
          process.exit(1);
        }

        const json = await readInput(args[1]);
        const data = JSON.parse(json);

        // Handle both wrapper { state, name } and direct { tracks, tempo, ... } formats
        let state: SessionState;
        let name: string | undefined;

        if (data.state && typeof data.state === 'object') {
          state = data.state as SessionState;
          name = typeof data.name === 'string' ? data.name : undefined;
        } else {
          state = data as SessionState;
        }

        // Validate first
        const errors = validateSessionState(state);
        if (errors.length > 0) {
          console.error('\n❌ Validation failed:\n');
          errors.forEach((err) => {
            console.error(`  ${err.path}: ${err.message}`);
          });
          process.exit(1);
        }

        console.log('✅ Validation passed, creating session...');
        const createResult = await createSession(state, name);
        console.log(`   Created: ${createResult.id}`);
        if (name) {
          console.log(`   Name: ${name}`);
        }

        console.log('   Publishing...');
        const publishResult = await publishSession(createResult.id);
        console.log(`\n✅ Session created and published!`);
        console.log(`   ID: ${publishResult.id}`);
        console.log(`   URL: https://keyboardia.dev/s/${publishResult.id}`);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
