#!/usr/bin/env npx tsx
/**
 * Generate public/instruments/LICENSE.md from the manifests' `credits`
 * fields.
 *
 * The manifests are the single source of truth for attribution — the
 * June 2026 sample audit found LICENSE.md had drifted seven instruments
 * behind reality. Regenerate with:
 *
 *   npm run generate:license
 *
 * instrument-license-doc-sync.test.ts fails CI when this file is stale.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = path.join(SCRIPT_DIR, '..', 'public', 'instruments');
const OUTPUT_FILE = path.join(INSTRUMENTS_DIR, 'LICENSE.md');

export interface Credits {
  source: string;
  url: string;
  license: string;
}

interface ManifestInfo {
  id: string;
  name: string;
  credits: Credits;
}

export function readManifests(instrumentsDir: string): ManifestInfo[] {
  const dirs = fs
    .readdirSync(instrumentsDir)
    .filter(d => fs.existsSync(path.join(instrumentsDir, d, 'manifest.json')))
    .sort();

  return dirs.map(dir => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(instrumentsDir, dir, 'manifest.json'), 'utf-8')
    );
    if (!manifest.credits?.source || !manifest.credits?.url || !manifest.credits?.license) {
      throw new Error(
        `${dir}/manifest.json is missing credits.{source,url,license} — ` +
        `every shipped sample must carry its attribution`
      );
    }
    return { id: manifest.id, name: manifest.name, credits: manifest.credits };
  });
}

export function renderLicenseMd(manifests: ManifestInfo[]): string {
  const lines: string[] = [
    '# Instrument Sample Licenses',
    '',
    '<!-- GENERATED FILE — do not edit by hand. -->',
    '<!-- Source of truth: each instrument\'s manifest.json `credits` field. -->',
    '<!-- Regenerate with: npm run generate:license -->',
    '',
    'All samples used in Keyboardia are free to use, with licenses ranging',
    'from Public Domain to CC0 to permissive free-use terms.',
    '',
    '| Instrument | Source | License |',
    '|---|---|---|',
  ];

  for (const m of manifests) {
    lines.push(
      `| ${m.name} (\`${m.id}\`) | [${m.credits.source}](${m.credits.url}) | ${m.credits.license} |`
    );
  }

  lines.push(
    '',
    '## Sources',
    ''
  );

  const bySource = new Map<string, ManifestInfo[]>();
  for (const m of manifests) {
    const list = bySource.get(m.credits.url) ?? [];
    list.push(m);
    bySource.set(m.credits.url, list);
  }

  for (const [url, instruments] of [...bySource.entries()].sort()) {
    const { source, license } = instruments[0].credits;
    lines.push(`### ${source}`);
    lines.push('');
    lines.push(`- **URL:** ${url}`);
    lines.push(`- **License:** ${license}`);
    lines.push(`- **Used by:** ${instruments.map(i => `\`${i.id}\``).join(', ')}`);
    lines.push('');
  }

  lines.push(
    '---',
    '',
    'All samples are free to use in any project without attribution, though we',
    'gratefully acknowledge these sources for making high-quality samples freely',
    'available.',
    ''
  );

  return lines.join('\n');
}

function main(): void {
  const manifests = readManifests(INSTRUMENTS_DIR);
  fs.writeFileSync(OUTPUT_FILE, renderLicenseMd(manifests));
  console.log(`Wrote ${OUTPUT_FILE} (${manifests.length} instruments)`);
}

// Only run as a script, not when imported by the doc-sync test.
if (process.argv[1] && process.argv[1].endsWith('generate-license-md.ts')) {
  main();
}
