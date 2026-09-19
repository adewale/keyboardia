import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(appRoot, '..');
const inventoryPath = resolve(appRoot, 'e2e/verification-impact.json');
const profileNames = ['browser', 'worker', 'audio', 'visual', 'samples'];

export function selectVerificationScope(paths, inventory) {
  const normalized = [...new Set(paths.map(path => path.trim()).filter(Boolean))].sort();
  const selected = Object.fromEntries(profileNames.map(name => [name, false]));
  const reasons = [];

  for (const path of normalized) {
    if (inventory.selectAllFiles.includes(path)) {
      for (const name of profileNames) selected[name] = true;
      reasons.push(`${path}: verification policy changed`);
      continue;
    }

    if (inventory.ignoredFiles.includes(path)
      || inventory.ignoredPrefixes.some(prefix => path.startsWith(prefix))) {
      continue;
    }

    let matched = false;
    for (const name of profileNames) {
      const profile = inventory.profiles[name];
      if (profile.files.includes(path)
        || profile.prefixes.some(prefix => path.startsWith(prefix))) {
        selected[name] = true;
        matched = true;
      }
    }

    // A new code/configuration path must become expensive, not invisible.
    // Maintainers can narrow it only by reviewing an inventory update.
    if (!matched) {
      for (const name of profileNames) selected[name] = true;
      reasons.push(`${path}: unmatched path selected every T1 profile`);
    }
  }

  return { paths: normalized, selected, reasons };
}

function readChangedPaths(base, head) {
  const diff = spawnSync('git', [
    'diff', '--name-only', '--diff-filter=ACMR', `${base}...${head}`,
  ], { cwd: repoRoot, encoding: 'utf8' });
  if (diff.status !== 0) {
    throw new Error(`Unable to compute verification impact:\n${diff.stderr || diff.stdout}`);
  }
  return diff.stdout.split(/\r?\n/).filter(Boolean);
}

function emit(scope, outputPath) {
  const lines = [
    ...profileNames.map(name => `${name}=${scope.selected[name]}`),
    `full=${scope.full}`,
  ];
  const output = `${lines.join('\n')}\n`;
  if (outputPath) appendFileSync(outputPath, output);
  else process.stdout.write(output);
  process.stdout.write(`${JSON.stringify(scope, null, 2)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const valueAfter = flag => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const tier = valueAfter('--tier');
  const outputPath = valueAfter('--github-output');
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));

  if (inventory.schemaVersion !== 1
    || JSON.stringify(Object.keys(inventory.profiles).sort())
      !== JSON.stringify([...profileNames].sort())) {
    throw new Error('verification-impact.json has an unsupported schema or profile set');
  }

  if (tier === 't2') {
    emit({
      paths: [],
      selected: Object.fromEntries(profileNames.map(name => [name, true])),
      reasons: ['T2 scheduled/manual matrix'],
      full: true,
    }, outputPath);
    return;
  }

  if (tier === 't1') {
    emit({
      paths: [],
      selected: Object.fromEntries(profileNames.map(name => [name, true])),
      reasons: ['manual T1 run without a diff'],
      full: false,
    }, outputPath);
    return;
  }

  const base = valueAfter('--base');
  const head = valueAfter('--head');
  if (!base || !head || /^0+$/.test(base)) {
    emit({
      paths: [],
      selected: Object.fromEntries(profileNames.map(name => [name, true])),
      reasons: ['missing comparison revision; safe T1 fallback'],
      full: false,
    }, outputPath);
    return;
  }

  const scope = selectVerificationScope(readChangedPaths(base, head), inventory);
  emit({ ...scope, full: false }, outputPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
