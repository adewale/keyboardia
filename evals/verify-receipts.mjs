#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReceipt } from './receipt.mjs';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalsDir, '..');

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
let failed = false;
for (const path of receiptFiles(paths)) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`${path}: ${error.message}\n`);
    failed = true;
    continue;
  }
  const errors = verifyReceipt(receipt, { repoRoot });
  if (errors.length > 0) {
    process.stderr.write(`${path}:\n- ${errors.join('\n- ')}\n`);
    failed = true;
  } else {
    process.stdout.write(`${path}: valid\n`);
  }
}
if (failed) process.exitCode = 1;

