import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const appRoot = process.cwd();
const repositoryRoot = resolve(appRoot, '..');

const required = [
  ['contract', resolve(appRoot, 'src/shared/envelope-contract-v2.ts'), [
    "type EnvelopeModel = 'ad' | 'ahd' | 'ar' | 'adsr'",
    "type SamplePlaybackMode = 'trigger' | 'gate' | 'loop'",
  ]],
  ['examples', resolve(appRoot, 'src/shared/__fixtures__/envelope-notation-examples.ts'), [
    '[amp:ad,', '[amp:ahd,', '[amp:ar,', '[amp:adsr,', '[play:loop]', '[lock:',
  ]],
  ['public syntax', resolve(repositoryRoot, 'specs/SESSION-NOTATION.md'), [
    'v2.4', '[amp:', '[play:', '[lock:',
  ]],
  ['sample intake', resolve(repositoryRoot, 'docs/SAMPLE-INTAKE-REQUIREMENTS.md'), [
    'rights and provenance', 'hash', 'decoded', 'loop', 'release',
  ]],
  ['MIDI mapping', resolve(repositoryRoot, 'docs/MIDI-MAPPINGS.md'), [
    'ADSR', 'not',
  ]],
];

const errors = [];
for (const [label, file, markers] of required) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    errors.push(`${label}: cannot read ${file}: ${error.message}`);
    continue;
  }
  for (const marker of markers) {
    if (!source.toLowerCase().includes(marker.toLowerCase())) {
      errors.push(`${label}: missing required marker ${JSON.stringify(marker)}`);
    }
  }
}

if (errors.length > 0) {
  console.error('Envelope documentation validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Envelope documentation validation passed (${required.length} synchronized sources).`);
}
