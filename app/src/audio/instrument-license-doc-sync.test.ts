/**
 * Documentation-code sync test for instrument sample licensing
 * (same pattern as preset-doc-sync.test.ts).
 *
 * The June 2026 sample audit found public/instruments/LICENSE.md had
 * drifted seven instruments behind the shipped manifests. LICENSE.md is
 * now generated from the manifests' `credits` fields; this test fails
 * when it goes stale or when an instrument ships without attribution.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { SAMPLED_INSTRUMENTS } from './sampled-instrument';
import { readManifests, renderLicenseMd } from '../../scripts/generate-license-md';

const INSTRUMENTS_DIR = path.join(__dirname, '..', '..', 'public', 'instruments');
const LICENSE_FILE = path.join(INSTRUMENTS_DIR, 'LICENSE.md');

describe('instrument licensing ↔ documentation sync', () => {
  it.each([...SAMPLED_INSTRUMENTS])(
    '%s has a manifest with full credits (source, url, license)',
    (id) => {
      const manifestPath = path.join(INSTRUMENTS_DIR, id, 'manifest.json');
      expect(fs.existsSync(manifestPath), `${id} has no manifest.json`).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.credits?.source, `${id}: credits.source`).toBeTruthy();
      expect(manifest.credits?.url, `${id}: credits.url`).toBeTruthy();
      expect(manifest.credits?.license, `${id}: credits.license`).toBeTruthy();
    }
  );

  it('LICENSE.md is exactly what the generator produces (no manual drift)', () => {
    const actual = fs.readFileSync(LICENSE_FILE, 'utf-8');
    const expected = renderLicenseMd(readManifests(INSTRUMENTS_DIR));
    expect(actual, 'LICENSE.md is stale — run: npm run generate:license').toBe(expected);
  });

  it('every registered instrument appears in LICENSE.md', () => {
    const licenseText = fs.readFileSync(LICENSE_FILE, 'utf-8');
    for (const id of SAMPLED_INSTRUMENTS) {
      expect(licenseText, `${id} missing from LICENSE.md`).toContain(`\`${id}\``);
    }
  });

  it('fails closed when a CC BY manifest omits attribution or change metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-license-'));
    try {
      fs.mkdirSync(path.join(root, 'candidate'));
      fs.writeFileSync(path.join(root, 'candidate', 'manifest.json'), JSON.stringify({
        id: 'candidate',
        name: 'Candidate',
        credits: { source: 'Source', url: 'https://example.com', license: 'CC BY 4.0' },
      }));
      expect(() => readManifests(root)).toThrow('incomplete CC BY attribution');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders required CC BY attribution, license link, and adaptation notice', () => {
    const markdown = renderLicenseMd([{
      id: 'candidate',
      name: 'Candidate',
      credits: {
        source: 'Source',
        url: 'https://example.com/source',
        license: 'CC BY 4.0',
        attribution: 'Samples by Creator.',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        changes: 'Mapped and encoded once.',
      },
    }]);
    expect(markdown).toContain('Samples by Creator.');
    expect(markdown).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(markdown).toContain('Mapped and encoded once.');
    expect(markdown).not.toContain('without attribution');
  });

  it('no manifest credits a URL that is known to be wrong', () => {
    // The audit found acoustic-guitar crediting a non-existent repo.
    const knownBadUrls = ['github.com/jmsmrtn/discord-sfz-gm-bank'];
    for (const m of readManifests(INSTRUMENTS_DIR)) {
      for (const bad of knownBadUrls) {
        expect(m.credits.url, `${m.id} credits a dead URL`).not.toContain(bad);
      }
    }
  });
});
