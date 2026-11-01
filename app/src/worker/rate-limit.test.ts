import { describe, expect, it } from 'vitest';
import type { Env } from './types';
import {
  RATE_LIMIT_DEFAULTS,
  createRateLimitChecker,
  resolveRateLimit,
} from './rate-limit';

function env(vars: Partial<Env> = {}): Env {
  return vars as Env;
}

describe('resolveRateLimit', () => {
  it('uses the production defaults when nothing is configured', () => {
    expect(resolveRateLimit(env(), 'sessionCreate')).toBe(10);
    expect(resolveRateLimit(env(), 'mcpRequest')).toBe(120);
    expect(resolveRateLimit(env(), 'ogImage')).toBe(100);
  });

  it('applies a configured override', () => {
    expect(resolveRateLimit(env({ SESSION_CREATE_RATE_LIMIT_PER_MINUTE: '100' }), 'sessionCreate'))
      .toBe(100);
    expect(resolveRateLimit(env({ OG_IMAGE_RATE_LIMIT_PER_MINUTE: '250' }), 'ogImage'))
      .toBe(250);
    expect(resolveRateLimit(env({ MCP_RATE_LIMIT_PER_MINUTE: '300' }), 'mcpRequest'))
      .toBe(300);
  });

  it('keeps the buckets independent', () => {
    const configured = env({ SESSION_CREATE_RATE_LIMIT_PER_MINUTE: '100' });

    expect(resolveRateLimit(configured, 'ogImage')).toBe(RATE_LIMIT_DEFAULTS.ogImage);
  });

  it.each(['', '   ', 'lots', '0', '-5', '2.5', 'NaN', 'Infinity'])(
    'falls back to the default rather than disabling the limit for %j',
    (value) => {
      expect(resolveRateLimit(env({ SESSION_CREATE_RATE_LIMIT_PER_MINUTE: value }), 'sessionCreate'))
        .toBe(RATE_LIMIT_DEFAULTS.sessionCreate);
    }
  );
});

describe('checkRateLimit', () => {
  it('allows up to the limit and then refuses', () => {
    const checkRateLimit = createRateLimitChecker();
    const decisions = Array.from({ length: 4 }, () => checkRateLimit('sessionCreate', '1.2.3.4', 3));

    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((decision) => decision.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('counts each IP separately', () => {
    const checkRateLimit = createRateLimitChecker();
    checkRateLimit('sessionCreate', '1.2.3.4', 1);

    expect(checkRateLimit('sessionCreate', '5.6.7.8', 1).allowed).toBe(true);
  });

  /**
   * The regression this guards: both endpoints once shared a counter keyed only
   * by IP, so fetching social previews consumed a visitor's ability to create
   * sessions.
   */
  it('does not let one bucket consume another bucket\'s budget', () => {
    const checkRateLimit = createRateLimitChecker();
    for (let i = 0; i < 5; i++) checkRateLimit('ogImage', '1.2.3.4', 5);

    expect(checkRateLimit('ogImage', '1.2.3.4', 5).allowed).toBe(false);
    expect(checkRateLimit('sessionCreate', '1.2.3.4', 5).allowed).toBe(true);
  });

  it('reports how long until the window resets', () => {
    const checkRateLimit = createRateLimitChecker();
    const decision = checkRateLimit('sessionCreate', '1.2.3.4', 1);

    expect(decision.resetIn).toBeGreaterThan(0);
    expect(decision.resetIn).toBeLessThanOrEqual(60_000);
  });
});
