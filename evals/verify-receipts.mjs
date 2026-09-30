#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReceipt } from './receipt.mjs';
import { verifyExecutionReceipt } from './verify-execution-receipt.mjs';
import {
  validateAutonomousReceipt,
  verifySourceBinding as verifyAutonomousSourceBinding,
} from '../app/scripts/autonomous-discovery-validator.mjs';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalsDir, '..');

function verifyAnyReceipt(receipt) {
  if (receipt?.kind !== 'origin-only-autonomous-skill-discovery') {
    return [
      ...verifyReceipt(receipt, { repoRoot }),
      ...verifyExecutionReceipt(receipt),
    ];
  }
  try {
    validateAutonomousReceipt(receipt);
    verifyAutonomousSourceBinding(receipt.source, repoRoot);
    return [];
  } catch (error) {
    return [error.message];
  }
}

function receiptFiles(paths) {
  const files = [];
  for (const raw of paths) {
    const path = resolve(process.cwd(), raw);
    if (statSync(path).isDirectory()) {
      files.push(...readdirSync(path)
        .filter((name) => name.endsWith('.json'))
        .map((name) => resolve(path, name)));
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

const requested = process.argv.slice(2);
const paths = requested.length > 0 ? requested : [resolve(evalsDir, 'receipts')];
const files = receiptFiles(paths);
// Verifying nothing is not a pass. Receipts are not committed (see
// receipts/README.md), so a run with no arguments or an empty download
// directory must fail rather than exit 0 having checked nothing.
if (files.length === 0) {
  process.stderr.write(
    `No receipt files found in ${paths.join(', ')}; nothing was verified.\n`
    + 'Usage: node evals/verify-receipts.mjs <receipt.json | directory>...\n',
  );
  process.exit(1);
}
let failed = false;
for (const path of files) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`${path}: ${error.message}\n`);
    failed = true;
    continue;
  }
  const errors = verifyAnyReceipt(receipt);
  if (errors.length > 0) {
    process.stderr.write(`${path}:\n- ${errors.join('\n- ')}\n`);
    failed = true;
  } else {
    process.stdout.write(`${path}: valid\n`);
  }
}
if (failed) process.exitCode = 1;
