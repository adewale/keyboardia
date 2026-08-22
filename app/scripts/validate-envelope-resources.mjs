import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import process from 'node:process';

const appRoot = process.cwd();
const baseline = JSON.parse(await readFile(
  resolve(appRoot, '../artifacts/envelope-resource-baseline.json'),
  'utf8',
));
const release = baseline.release;
if (!release) throw new Error('Resource baseline has no release contract.');
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

const instrumentRoot = resolve(appRoot, 'public/instruments');
const audioFiles = (await filesBelow(instrumentRoot))
  .filter(file => audioExtensions.has(extname(file).toLowerCase()))
  .sort();
let encodedBytes = 0;
const catalogueHash = createHash('sha256');
for (const file of audioFiles) {
  const bytes = await readFile(file);
  encodedBytes += bytes.byteLength;
  catalogueHash.update(relative(instrumentRoot, file).replaceAll('\\', '/'));
  catalogueHash.update('\0');
  catalogueHash.update(bytes);
  catalogueHash.update('\0');
}
const catalogueSha256 = catalogueHash.digest('hex');

const assetsRoot = resolve(appRoot, 'dist/assets');
const jsFiles = (await filesBelow(assetsRoot))
  .filter(file => extname(file) === '.js');
const gzipByFile = new Map();
for (const file of jsFiles) gzipByFile.set(file, gzipSync(await readFile(file)).byteLength);
const gzipBytes = [...gzipByFile.values()].reduce((sum, bytes) => sum + bytes, 0);

const html = await readFile(resolve(appRoot, 'dist/index.html'), 'utf8');
const initialAssetNames = new Set(
  Array.from(html.matchAll(/(?:src|href)="\/assets\/([^"?]+\.js)"/g), match => match[1]),
);
const entryAssetName = html.match(/<script[^>]+src="\/assets\/([^"?]+\.js)"/)?.[1];
const chunks = Object.fromEntries(
  [...gzipByFile].map(([file, bytes]) => [file.slice(assetsRoot.length + 1), bytes]),
);
const findChunk = (prefix) => Object.entries(chunks)
  .filter(([name]) => name === prefix || name.startsWith(`${prefix}-`));

const maximumRatio = 1 + baseline.budgets.unexplainedRegressionPercent / 100;
const errors = [];
if (audioFiles.length !== release.productionAudio.audioFileCount) {
  errors.push(`audio file count changed: ${audioFiles.length} vs ${release.productionAudio.audioFileCount}`);
}
if (encodedBytes !== release.productionAudio.encodedBytes) {
  errors.push(`encoded audio bytes changed: ${encodedBytes} vs ${release.productionAudio.encodedBytes}`);
}
if (catalogueSha256 !== release.productionAudio.catalogueSha256) {
  errors.push(`audio catalogue hash changed: ${catalogueSha256} vs ${release.productionAudio.catalogueSha256}`);
}
if (gzipBytes > release.javascript.allChunksGzipBytes * maximumRatio) {
  errors.push(`gzipped JavaScript grew more than ${baseline.budgets.unexplainedRegressionPercent}%`);
}

for (const [label, budget] of Object.entries(release.javascript.chunkBudgets)) {
  const matches = budget.entry && entryAssetName
    ? Object.entries(chunks).filter(([name]) => name === entryAssetName)
    : findChunk(budget.prefix);
  if (matches.length !== 1) {
    errors.push(`${label} chunk count is ${matches.length}; expected exactly one ${budget.prefix}-*.js`);
    continue;
  }
  const [[name, bytes]] = matches;
  if (bytes > budget.gzipBytes * maximumRatio) {
    errors.push(`${label} chunk grew more than ${baseline.budgets.unexplainedRegressionPercent}%: ${bytes} vs ${budget.gzipBytes}`);
  }
  if (budget.loading === 'initial' && !initialAssetNames.has(name)) {
    errors.push(`${label} must remain in the initial HTML module graph: ${name}`);
  }
  if (budget.loading === 'lazy' && initialAssetNames.has(name)) {
    errors.push(`${label} crossed into the initial HTML module graph: ${name}`);
  }
}

const sourceFiles = (await filesBelow(resolve(appRoot, 'src')))
  .filter(file => ['.ts', '.tsx', '.js', '.jsx'].includes(extname(file)));
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  if (/\b(?:import|from)\s*['"][^'"]+\.(?:mp3|wav|ogg|flac|m4a)['"]/i.test(source)) {
    errors.push(`sample audio entered the JavaScript module graph: ${file}`);
  }
}

const report = {
  audioFiles: audioFiles.length,
  encodedBytes,
  catalogueSha256,
  gzipBytes,
  initialAssets: [...initialAssetNames].sort(),
  chunks,
  maximumRatio,
};
if (errors.length) {
  console.error('Envelope resource validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(report));
}
