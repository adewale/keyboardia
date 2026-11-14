#!/usr/bin/env npx tsx
/** Executed sync contracts. TypeScript classifies the protocol exhaustively;
 * these keepers execute the actual client, hook and Durable Object boundaries.
 * Private method spelling and switch formatting have no authority here. */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project', 'unit',
  'test/unit/sync-layer-coverage.test.ts', 'src/sync/dedicated-sync-senders.test.ts',
  'src/sync/multiplayer.test.ts', 'src/sync/multiplayer-transport.test.ts',
  'src/hooks/useMultiplayer-capability.test.ts'], {cwd: appRoot, stdio: 'inherit'});
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
  'collaboration-contract.test.ts'], {cwd: resolve(appRoot, 'test/integration'), stdio: 'inherit'});
