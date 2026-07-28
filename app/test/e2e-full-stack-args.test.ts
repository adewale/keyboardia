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

  // The 'all' scope names no --project, so Playwright runs chromium, webkit and
  // both mobile profiles. CI installs chromium only, so the caller has to be
  // able to narrow the run — and this argument was silently dropped when the
  // arg-building was extracted into this module, because nothing tested it.
  it('passes caller arguments through on the all scope', () => {
    expect(buildPlaywrightArgs('all', [], [
      '--project=chromium',
      '--workers=2',
      '--grep-invert=@visual',
    ])).toEqual([
      'playwright',
      'test',
      '--project=chromium',
      '--workers=2',
      '--grep-invert=@visual',
      '--retries=0',
    ]);
  });

  it('needs no passthrough to be usable', () => {
    expect(buildPlaywrightArgs('all', [])).toEqual(['playwright', 'test', '--retries=0']);
  });

  it('ignores a passthrough on scopes that pin their own projects and specs', () => {
    // A scope with a fixed inventory must not be widened by a stray argument;
    // the collaboration lane's --workers=1 is a rate-limit contract, not a
    // preference.
    expect(buildPlaywrightArgs('collaboration', ['e2e/a.spec.ts'], ['--project=webkit']))
      .not.toContain('--project=webkit');
  });

  it('inherits Wrangler output so synchronous Playwright cannot deadlock its pipes', () => {
    expect(getWranglerStdio()).toEqual(['ignore', 'inherit', 'inherit']);
  });
});
