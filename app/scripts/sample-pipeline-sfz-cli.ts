#!/usr/bin/env npx tsx
import fs from 'node:fs';
import path from 'node:path';
import { generateSfzImport } from './sample-pipeline-sfz';
import type { DeliveryPolicy } from './sample-pipeline-core';

interface Options {
  sfzFile: string;
  sourceRoot: string;
  articulation: string;
  container: DeliveryPolicy['container'];
  randomPolicy: 'reject' | 'deterministic-round-robin';
  velocityZeroPolicy: 'reject' | 'extend-lowest-layer';
  includeRoots?: number[];
  mappedRootMidi?: number;
  samplePathIncludes?: string;
  json: string;
}

function usage(): never {
  throw new Error(`Usage:
  npm run samples:import-sfz -- \\
    --sfz /immutable/source/map.sfz \\
    --source-root /immutable/source \\
    --articulation sustain \\
    --container m4a \\
    --json /tmp/import.json \\
    [--random-as-round-robin] \\
    [--extend-velocity-zero] \\
    [--include-roots 36,40,43] \\
    [--mapped-root 36] \\
    [--sample-path-includes /CLOSE/]

Random SFZ regions fail unless --random-as-round-robin explicitly records the deterministic conversion.`);
}

function parseInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires an integer`);
  const parsed = Number(value);
  if (parsed < 0 || parsed > 127) throw new Error(`${flag} must be from 0 to 127`);
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  let randomPolicy: Options['randomPolicy'] = 'reject';
  let velocityZeroPolicy: Options['velocityZeroPolicy'] = 'reject';
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--random-as-round-robin') {
      randomPolicy = 'deterministic-round-robin';
      continue;
    }
    if (arg === '--extend-velocity-zero') {
      velocityZeroPolicy = 'extend-lowest-layer';
      continue;
    }
    if (!arg.startsWith('--')) usage();
    const [flag, inline] = arg.split('=', 2);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (!['--sfz', '--source-root', '--articulation', '--container', '--include-roots', '--mapped-root', '--sample-path-includes', '--json'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    values.set(flag, value);
  }
  const required = (flag: string): string => values.get(flag) ?? usage();
  const container = required('--container');
  if (container !== 'm4a' && container !== 'mp3' && container !== 'wav') throw new Error('--container must be m4a, mp3, or wav');
  const roots = values.get('--include-roots')?.split(',').map(value => parseInteger(value, '--include-roots'));
  return {
    sfzFile: required('--sfz'),
    sourceRoot: required('--source-root'),
    articulation: required('--articulation'),
    container,
    randomPolicy,
    velocityZeroPolicy,
    includeRoots: roots,
    mappedRootMidi: values.has('--mapped-root') ? parseInteger(values.get('--mapped-root')!, '--mapped-root') : undefined,
    samplePathIncludes: values.get('--sample-path-includes'),
    json: required('--json'),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const imported = await generateSfzImport(options);
  if (!imported.ok) throw new Error(`SFZ import failed:\n- ${imported.errors.join('\n- ')}`);
  const output = path.resolve(options.json);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(imported.value, null, 2)}\n`);
  console.log(`✓ ${imported.value.sources.length} immutable lossless sources hashed`);
  console.log(`✓ ${imported.value.mappings.length} explicit mappings emitted`);
  console.log(`✓ preprocessed SFZ SHA-256 ${imported.value.preprocessedSfzSha256}`);
  for (const warning of imported.value.warnings) console.log(`REVIEW: ${warning}`);
  console.log(`Wrote ${output}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
