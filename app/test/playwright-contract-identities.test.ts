import { describe, expect, it } from 'vitest';
import {
  collectPlaywrightAnnotations,
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

  it('lists helper retries recorded as runtime annotations, per attempt', () => {
    // Shape of a Playwright 1.57 JSON report whose test pushed an annotation
    // with test.info().annotations at run time.
    const annotation = { type: 'api-retry', description: 'Session create attempt 1 failed (HTTP 429)' };
    const report = {
      suites: [{
        title: 'example.spec.ts',
        file: 'example.spec.ts',
        specs: [],
        suites: [{
          title: 'Example',
          file: 'example.spec.ts',
          specs: [{
            title: 'creates a session',
            file: 'example.spec.ts',
            tests: [{
              projectName: 'chromium',
              annotations: [annotation],
              results: [{ status: 'passed', annotations: [annotation, { type: 'issue' }] }],
            }],
          }, {
            title: 'no retries',
            file: 'example.spec.ts',
            tests: [{ projectName: 'chromium', annotations: [], results: [{ annotations: [] }] }],
          }],
        }],
      }],
    };

    expect(collectPlaywrightAnnotations(report, 'api-retry')).toEqual([
      'chromium :: example.spec.ts › creates a session — Session create attempt 1 failed (HTTP 429)',
    ]);
    expect(collectPlaywrightAnnotations(report, 'unrelated')).toEqual([]);
  });

  it('round-trips the reviewable project and title lines', () => {
    const identities = parsePlaywrightListIdentities(listing);

    expect(playwrightIdentitiesFromManifestLines(playwrightIdentityManifestLines(identities)))
      .toEqual(identities);
  });
});
