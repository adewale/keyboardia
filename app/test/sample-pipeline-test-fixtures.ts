import fs from 'node:fs';
import path from 'node:path';

/** Small committed PCM fixture used when tests need real lossless container bytes. */
export function fixtureWavBytes(): Buffer {
  return fs.readFileSync(path.resolve('test/fixtures/sample-pipeline/masters/C4.wav'));
}
