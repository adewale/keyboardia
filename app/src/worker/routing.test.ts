/**
 * Worker SPA Routing Tests
 *
 * Tests that the worker correctly routes SPA paths to index.html
 * for client-side routing.
 */

import { describe, it, expect } from 'vitest';
import { isSessionPagePath } from './routing';

describe('SPA Routing', () => {
  describe('session routes should serve SPA', () => {
    it('should serve SPA for /s/new', () => {
      expect(isSessionPagePath('/s/new')).toBe(true);
    });

    it('should serve SPA for /s/{uuid}', () => {
      expect(isSessionPagePath('/s/550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should serve SPA for /s/any-string', () => {
      expect(isSessionPagePath('/s/any-string')).toBe(true);
    });

    it('should serve SPA for /s/123', () => {
      expect(isSessionPagePath('/s/123')).toBe(true);
    });

    it('should serve SPA for /s/with-dashes-and-numbers-123', () => {
      expect(isSessionPagePath('/s/with-dashes-and-numbers-123')).toBe(true);
    });
  });

  describe('API routes should NOT serve SPA', () => {
    it('should not serve SPA for /api/sessions', () => {
      expect(isSessionPagePath('/api/sessions')).toBe(false);
    });

    it('should not serve SPA for /api/sessions/{id}', () => {
      expect(isSessionPagePath('/api/sessions/550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('should not serve SPA for /ws/sessions/{id}', () => {
      expect(isSessionPagePath('/ws/sessions/550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('should not serve SPA for /live-debug/{id}', () => {
      expect(isSessionPagePath('/live-debug/550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });
  });

  describe('static assets should NOT serve SPA', () => {
    it('should not serve SPA for root /', () => {
      expect(isSessionPagePath('/')).toBe(false);
    });

    it('should not serve SPA for /assets/index.js', () => {
      expect(isSessionPagePath('/assets/index.js')).toBe(false);
    });

    it('should not serve SPA for /keyboardia.svg', () => {
      expect(isSessionPagePath('/keyboardia.svg')).toBe(false);
    });
  });
});

describe('Regression: /s/new must work', () => {
  /**
   * This test documents the bug that was fixed.
   *
   * Previously, the worker used this regex for SPA routing:
   *   path.match(/^\/s\/[a-f0-9-]{36}$/)
   *
   * This only matched 36-character UUIDs, so /s/new returned 404.
   *
   * The fix changed it to:
   *   path.startsWith('/s/')
   */
  it('should not require exactly 36 characters after /s/', () => {
    // The old regex: /^\/s\/[a-f0-9-]{36}$/
    const oldRegex = /^\/s\/[a-f0-9-]{36}$/;

    // These would fail with the old regex
    expect(oldRegex.test('/s/new')).toBe(false);
    expect(oldRegex.test('/s/test')).toBe(false);
    expect(oldRegex.test('/s/123')).toBe(false);

    // But they should all serve the SPA
    expect(isSessionPagePath('/s/new')).toBe(true);
    expect(isSessionPagePath('/s/test')).toBe(true);
    expect(isSessionPagePath('/s/123')).toBe(true);
  });

  it('should still work for valid UUIDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(isSessionPagePath(`/s/${uuid}`)).toBe(true);
  });
});
