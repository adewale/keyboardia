import { describe, expect, it } from 'vitest';
import { buildPlaywrightArgs, getWranglerStdio } from '../scripts/e2e-full-stack-args';

describe('buildPlaywrightArgs', () => {
  it('serializes the complete real-Worker inventory without retries', () => {
    expect(buildPlaywrightArgs('collaboration', ['e2e/a.spec.ts', 'e2e/b.spec.ts'])).toEqual([
      'playwright',
      'test',
      '--project=chromium',
      'e2e/a.spec.ts',
      'e2e/b.spec.ts',
      '--workers=1',
      '--retries=0',
    ]);
  });

  it('does not serialize unrelated scopes', () => {
    expect(buildPlaywrightArgs('session-contract', [])).toEqual([
      'playwright',
      'test',
      '--project=chromium',
      'e2e/session-api-contract.spec.ts',
      '--retries=0',
    ]);
  });

  it('inherits Wrangler output so synchronous Playwright cannot deadlock its pipes', () => {
    expect(getWranglerStdio()).toEqual(['ignore', 'inherit', 'inherit']);
  });
});
