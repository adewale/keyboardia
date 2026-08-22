import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { ENVELOPE_DURATION_RANGES_V2, TRACK_GATE_RANGE_V2 } from '../src/shared/envelope-contract-v2.ts';
import { ENVELOPE_NOTATION_EXAMPLE_SESSIONS } from '../src/shared/__fixtures__/envelope-notation-examples.ts';
import {
  parseEnvelopeSessionNotation,
  serializeEnvelopeSessionNotation,
  validateEnvelopeNotationCapability,
} from '../src/shared/session-notation-v24.ts';

const appRoot = process.cwd();
const repositoryRoot = resolve(appRoot, '..');
const paths = {
  publicSyntax: resolve(repositoryRoot, 'specs/SESSION-NOTATION.md'),
  examples: resolve(repositoryRoot, 'specs/ENVELOPE-NOTATION-EXAMPLES.md'),
  sampleIntake: resolve(repositoryRoot, 'docs/SAMPLE-INTAKE-REQUIREMENTS.md'),
  midi: resolve(repositoryRoot, 'docs/MIDI-MAPPINGS.md'),
};

const errors = [];
const sources = {};
for (const [label, file] of Object.entries(paths)) {
  try {
    sources[label] = await readFile(file, 'utf8');
  } catch (error) {
    errors.push(`${label}: cannot read ${file}: ${error.message}`);
  }
}

const requireText = (label, source, expected) => {
  if (!source?.includes(expected)) errors.push(`${label}: missing ${JSON.stringify(expected)}`);
};

// Compare the public duration table to the executable contract. A range change
// now requires a deliberate documentation update in the same diff.
for (const [stage, units] of Object.entries(ENVELOPE_DURATION_RANGES_V2)) {
  requireText(
    'public syntax',
    sources.publicSyntax,
    `| ${stage} | ${units.seconds.min}-${units.seconds.max}s | ${units.steps.min}-${units.steps.max}st |`,
  );
}
requireText(
  'public syntax',
  sources.publicSyntax,
  `| gate | ${TRACK_GATE_RANGE_V2.min}-${TRACK_GATE_RANGE_V2.max}% | Final tied segment |`,
);
for (const row of [
  '| `x` | `steps[i] = true` |',
  '| `-` | `steps[i] = false` |',
  '| `~` | `steps[i] = true`, `parameterLocks[i].tie = true`, owned by the previous cyclic onset |',
  '[pitches:',
  '[volumes:',
  '[trackSwing:',
  '[fm:',
]) requireText('public syntax', sources.publicSyntax, row);

for (const example of ENVELOPE_NOTATION_EXAMPLE_SESSIONS) {
  requireText('examples', sources.examples, `\`${example.id}\``);
  const parsed = parseEnvelopeSessionNotation(example.notation);
  if (parsed.diagnostics.length > 0) {
    errors.push(`${example.id}: parser diagnostics ${JSON.stringify(parsed.diagnostics)}`);
    continue;
  }
  const warnings = parsed.tracks.flatMap(track => (
    validateEnvelopeNotationCapability(track, example.capabilities[track.label])
      .map(diagnostic => diagnostic.code)
  ));
  const expected = [...(example.expectedCapabilityDiagnosticCodes ?? [])];
  if (JSON.stringify(warnings) !== JSON.stringify(expected)) {
    errors.push(`${example.id}: warnings ${JSON.stringify(warnings)} != ${JSON.stringify(expected)}`);
  }
  const canonical = serializeEnvelopeSessionNotation(parsed);
  const reparsed = parseEnvelopeSessionNotation(canonical);
  if (reparsed.diagnostics.length > 0) {
    errors.push(`${example.id}: canonical output does not parse: ${JSON.stringify(reparsed.diagnostics)}`);
  }
}

const normalizedSampleIntake = sources.sampleIntake?.toLowerCase().replace(/\s+/g, ' ');
for (const requirement of [
  'rights and provenance',
  'cryptographic hash',
  'decoded',
  'loop',
  'release',
]) requireText('sample intake', normalizedSampleIntake, requirement);

const normalizedMidi = sources.midi?.replace(/\s+/g, ' ');
for (const unsupported of [
  'A/H/D/S/R values',
  'per-stage units',
  'gate percentage',
  'playback mode',
  'sustain loops',
  'release triggers',
  'envelope locks',
]) requireText('MIDI mapping', normalizedMidi, unsupported);

if (errors.length > 0) {
  console.error('Envelope documentation validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    documents: Object.keys(paths).length,
    executableExamples: ENVELOPE_NOTATION_EXAMPLE_SESSIONS.length,
    durationStages: Object.keys(ENVELOPE_DURATION_RANGES_V2).length,
  }));
}
