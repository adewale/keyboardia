#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const bundleDirectory = resolve(process.argv[2] ?? '.wrangler/worker-check');
const MAX_JAVASCRIPT_BYTES = 2_050_000;
const MAX_UPLOAD_BYTES = 3_500_000;

const files = readdirSync(bundleDirectory)
  .map((name) => join(bundleDirectory, name))
  .filter((path) => statSync(path).isFile());
const javascript = files.filter((path) => path.endsWith('.js'));
if (javascript.length !== 1) {
  throw new Error(`Expected exactly one Worker JavaScript bundle, found ${javascript.length}.`);
}

const javascriptBytes = statSync(javascript[0]).size;
const uploadBytes = files
  .filter((path) => !path.endsWith('.map') && !path.endsWith('README.md'))
  .reduce((total, path) => total + statSync(path).size, 0);

if (javascriptBytes > MAX_JAVASCRIPT_BYTES) {
  throw new Error(
    `Worker JavaScript grew to ${javascriptBytes} bytes (limit ${MAX_JAVASCRIPT_BYTES}). `
    + 'Inspect the module graph before intentionally raising the ratchet.'
  );
}
if (uploadBytes > MAX_UPLOAD_BYTES) {
  throw new Error(
    `Worker upload grew to ${uploadBytes} bytes (limit ${MAX_UPLOAD_BYTES}). `
    + 'Inspect JavaScript and WASM changes before intentionally raising the ratchet.'
  );
}

const source = readFileSync(javascript[0], 'utf8');
const forbiddenRuntimeMarkers = [
  'ToneAudioNode',
  'tone/build/esm',
  'src/audio/sampled-instrument',
  'LRUSampleCache initialized',
];
const found = forbiddenRuntimeMarkers.filter((marker) => source.includes(marker));
if (found.length > 0) {
  throw new Error(
    `Browser audio runtime leaked into the Worker bundle: ${found.join(', ')}.`
  );
}

console.log(
  `Worker bundle check passed: ${javascriptBytes} JavaScript bytes, ${uploadBytes} upload bytes, no browser audio runtime.`
);
