import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import process from 'node:process';

const appRoot = process.cwd();
const baseline = JSON.parse(await readFile(
  resolve(appRoot, '../artifacts/envelope-resource-baseline.json'),
  'utf8',
));
const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a']);

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path));
    else result.push(path);
  }
  return result;
}

const audioFiles = (await filesBelow(resolve(appRoot, 'public/instruments')))
  .filter(file => audioExtensions.has(extname(file).toLowerCase()));
let encodedBytes = 0;
for (const file of audioFiles) encodedBytes += (await stat(file)).size;

const jsFiles = (await filesBelow(resolve(appRoot, 'dist/assets')))
  .filter(file => extname(file) === '.js');
let gzipBytes = 0;
for (const file of jsFiles) gzipBytes += gzipSync(await readFile(file)).byteLength;

const maximumRatio = 1 + baseline.budgets.unexplainedRegressionPercent / 100;
const errors = [];
if (audioFiles.length !== baseline.productionAudio.audioFileCount) {
  errors.push(`audio file count changed: ${audioFiles.length} vs ${baseline.productionAudio.audioFileCount}`);
}
if (encodedBytes > baseline.productionAudio.encodedBytesApprox * maximumRatio) {
  errors.push(`encoded audio grew more than ${baseline.budgets.unexplainedRegressionPercent}%`);
}
if (gzipBytes > baseline.javascript.allChunksGzipBytes * maximumRatio) {
  errors.push(`gzipped JavaScript grew more than ${baseline.budgets.unexplainedRegressionPercent}%`);
}

const sourceFiles = (await filesBelow(resolve(appRoot, 'src')))
  .filter(file => ['.ts', '.tsx', '.js', '.jsx'].includes(extname(file)));
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  if (/\b(?:import|from)\s*['"][^'"]+\.(?:mp3|wav|ogg|flac|m4a)['"]/i.test(source)) {
    errors.push(`sample audio entered the JavaScript module graph: ${file}`);
  }
}

if (errors.length) {
  console.error('Envelope resource validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    audioFiles: audioFiles.length,
    encodedBytes,
    gzipBytes,
    thresholds: { maximumRatio },
  }));
}
