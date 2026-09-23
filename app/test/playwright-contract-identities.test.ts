import { describe, expect, it } from 'vitest';
import {
  diffPlaywrightIdentities,
  formatPlaywrightIdentityDiff,
  parsePlaywrightListIdentities,
  playwrightIdentitiesFromManifestLines,
  playwrightIdentityManifestLines,
} from '../scripts/playwright-contract-identities.mjs';

describe('Playwright lane identity contracts', () => {
  const listing = [
    'Listing tests:',
    '  [chromium] › e2e/example.spec.ts:10:3 › Example › first contract',
    '  [chromium] › e2e/example.spec.ts:20:3 › Example › second contract',
    'Total: 2 tests in 1 file',
  ].join('\n');

  it('parses project, file, and full title without unstable source positions', () => {
    expect(parsePlaywrightListIdentities(listing)).toEqual([
      'chromium\0example.spec.ts › Example › first contract',
      'chromium\0example.spec.ts › Example › second contract',
    ]);
  });

  it('reports the exact contract change when a test identity is silently substituted', () => {
    const original = parsePlaywrightListIdentities(listing);
    const substituted = original.map(identity => identity.replace('second contract', 'replacement'));
    const diff = diffPlaywrightIdentities(original, substituted);

    expect(formatPlaywrightIdentityDiff(diff)).toBe([
      'Missing expected identities:',
      '  - chromium :: example.spec.ts › Example › second contract',
      'Unexpected identities:',
      '  + chromium :: example.spec.ts › Example › replacement',
    ].join('\n'));
  });

  it('round-trips the reviewable project and title lines', () => {
    const identities = parsePlaywrightListIdentities(listing);

    expect(playwrightIdentitiesFromManifestLines(playwrightIdentityManifestLines(identities)))
      .toEqual(identities);
  });
});
